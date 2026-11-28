// 스마일산업 3D 배관 — 3D 오브젝트 빌더
import * as THREE from 'three';
import { BORES, MATERIALS, boreOd, boreScale, SIZE_REF_BORE, elbowDims, teeDims, reducerDims, elbowBasis, dirBasis, gaugeBasis, headerBody, hxBody, hxHeadRound, equipNozzles, equipConnectFaces, teeBranch, teePorts, HANDLE_TYPES, flangeOd, flangeTh, equipBasis, equipFlowAxis, FLANGE_MATE_TYPES, extraBasis, rollBasis, rollOf } from './store.js?v=84';

const geoCache = new Map();
const matCache = new Map();

function G(key, make) {
  let g = geoCache.get(key);
  if (!g) { g = make(); geoCache.set(key, g); }
  return g;
}

function MAT(color, roughness, metalness) {
  const key = `${color}|${roughness}|${metalness}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness, metalness });
    matCache.set(key, m);
  }
  return m;
}

function add(parent, geo, material, x, y, z, rx, ry, rz) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x || 0, y || 0, z || 0);
  if (rx) m.rotation.x = rx;
  if (ry) m.rotation.y = ry;
  if (rz) m.rotation.z = rz;
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}


const cyl = (r, h, seg = 24) => G(`cyl|${r.toFixed(4)}|${h.toFixed(4)}|${seg}`, () => new THREE.CylinderGeometry(r, r, h, seg));
const cyl2 = (rt, rb, h, seg = 24) => G(`cyl2|${rt.toFixed(4)}|${rb.toFixed(4)}|${h.toFixed(4)}|${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg));
const box = (w, h, d) => G(`box|${w.toFixed(3)}|${h.toFixed(3)}|${d.toFixed(3)}`, () => new THREE.BoxGeometry(w, h, d));
const torus = (r, t) => G(`tor|${r.toFixed(4)}|${t.toFixed(4)}`, () => new THREE.TorusGeometry(r, t, 8, 32));
const sphere = (r, seg = 18) => G(`sph|${r.toFixed(4)}|${seg}`, () => new THREE.SphereGeometry(r, seg, Math.max(8, Math.round(seg * 0.65))));

// ── 플랜지 판 — 가운데 내경이 뚫린 링 + PCD 볼트 구멍 ────────────────────────
// 예전에는 속이 꽉 찬 원기둥이라 볼트를 빼자 '하키 퍽'처럼 보였다(2026-11-25 `31587`).
// 지금은 ① 가운데 내경 ② PCD 원주 볼트 구멍 ③ 두 구멍이 어둡게 보이도록 판 속에 숨긴
// 어두운 속판으로 그린다. 형상은 치수별로 캐시해 판이 늘어도 무거워지지 않는다.
const FLANGE_DARK = () => MAT('#1a2026', 0.9, 0.2);
const FLANGE_PIPE_T = 0.020;   // 배관 끝 플랜지 기본 두께(20mm)

// 볼트 구멍 규격 — KS 10K처럼 50A 이하는 4개, 65A 이상은 8개. PCD는 외경의 0.84.
function flangeBolts(R) {
  const nBolt = R * 2 <= 0.16 ? 4 : 8;
  return { nBolt, pcdR: R * 0.84, boltR: Math.max(0.0045, R * 0.055) };
}

// 원 둘레 점 배열 — 꼭짓점 수를 직접 정해 저폴리곤으로 유지한다(curveSegments 미사용).
function circlePts(cx, cy, r, n) {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const a = (Math.PI * 2 * i) / n;
    out.push(new THREE.Vector2(cx + Math.cos(a) * r, cy + Math.sin(a) * r));
  }
  return out;
}

function flangeGeo(R, boreR, T, b) {
  const key = `fring|${R.toFixed(4)}|${boreR.toFixed(4)}|${T.toFixed(4)}|${b.nBolt}|${b.boltR.toFixed(4)}`;
  return G(key, () => {
    const shape = new THREE.Shape(circlePts(0, 0, R, 40));
    shape.holes.push(new THREE.Path(circlePts(0, 0, boreR, 26)));
    for (let i = 0; i < b.nBolt; i += 1) {
      const a = (Math.PI * 2 * i) / b.nBolt;
      const px = Math.cos(a) * b.pcdR;
      const py = Math.sin(a) * b.pcdR;
      // 작은 관경(15A~25A 노즐)에서는 구멍이 내경이나 테두리에 붙을 수 있다 — 그럴 땐 빼고 그린다.
      if (b.pcdR - b.boltR < boreR + 0.002 || b.pcdR + b.boltR > R - 0.002) continue;
      shape.holes.push(new THREE.Path(circlePts(px, py, b.boltR, 8)));
    }
    const geo = new THREE.ExtrudeGeometry(shape, { depth: T, bevelEnabled: false, steps: 1 });
    geo.translate(0, 0, -T / 2);   // 판 중심을 원점에 — 어느 축으로 돌려도 제자리
    geo.computeVertexNormals();
    return geo;
  });
}

// 판 한 장 — pos 중심, dir 축(+Z를 dir로 돌린다), 외경 R, 내경 boreR, 두께 T.
// bore를 주면 이 판이 그 관경의 배관 접합 플랜지라는 표시(userData.flange.bore)를 남긴다 —
// v71 전수 검증(모든 판 월드 외경 = flangeOd(bore))이 장면을 훑어 확인하는 데 쓴다.
function flangeMesh(parent, pos, dir, R, boreR, T, material, bore) {
  const b = flangeBolts(R);
  const mesh = new THREE.Mesh(flangeGeo(R, boreR, T, b), material || MAT('#9aa3ab', 0.4, 0.85));
  mesh.position.copy(pos);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.clone().normalize());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.flange = { R, boreR, T, bore: bore || null, metres: true };
  parent.add(mesh);
  // 구멍 속을 채우는 어두운 속판 — 판 몸 안에 숨어 있다가 내경·볼트 구멍으로만 보인다.
  // (구멍으로 배경이 비쳐 밝은 점처럼 보이던 것을 막아, 가까이서도 '뚫린 구멍'으로 읽힌다)
  const plug = new THREE.Mesh(
    G(`fplug|${R.toFixed(4)}|${T.toFixed(4)}`, () => new THREE.CylinderGeometry(R * 0.985, R * 0.985, T * 0.55, 28)),
    FLANGE_DARK(),
  );
  plug.position.copy(mesh.position);
  plug.quaternion.copy(mesh.quaternion)
    .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2));
  plug.receiveShadow = true;
  parent.add(plug);
  return mesh;
}

// ── 플랜지 판을 부모의 w/h/d 배율에서 떼어내는 'm 단위 자식 좌표계' ─────────────
// 부속(게이트밸브·볼밸브·체크밸브·유량계·벨로우즈·버터플라이)은 로컬 형상에 마지막으로
// g.scale.set(w/defW, h/defH, d/defD)를 곱한다. 그런데 h는 rise(외경비의 0.65제곱),
// d는 plan(외경비)이라 두 배율이 다르다 — 그 안에 원형으로 그린 판은 월드에서 **타원**이
// 되고 외경도 표 값에서 벗어났다(50A 게이트밸브 판이 194×155mm, 2026-11-26 `32074`).
//  · 판은 (1/xs, 1/ys, 1/zs)를 곱한 자식 그룹에 그린다. 부모 배율과 곱해져 상쇄되므로
//    월드에서 **정확한 원**이 되고, 그룹 안 좌표는 그대로 m(월드와 같은 단위)다.
//  · 그룹 원점 = 판 중심. 그래서 판 안쪽 좌표는 '판 중심에서 잰 m'이다.
function flangeFrame(parent, at, s) {
  const xs = Math.abs(Number(s && s.x)) || 1;
  const ys = Math.abs(Number(s && s.y)) || 1;
  const zs = Math.abs(Number(s && s.z)) || 1;
  const fg = new THREE.Group();
  fg.position.set((at.x || 0) / xs, (at.y || 0) / ys, (at.z || 0) / zs);
  fg.scale.set(1 / xs, 1 / ys, 1 / zs);
  parent.add(fg);
  return fg;
}

// 부속 로컬 X축 플랜지 판 — 판의 **바깥면이 접합면(±w/2)** 에 정확히 닿는다.
// (예전에는 판은 0.045 두께인데 접합면은 w/2=0.03이라 7~15mm 어긋나 있었고,
//  플랜지 위에 엘보를 올리면 엘보가 판 속으로 파묻히거나 떠 보였다 — 2026-11-25 `31589`)
//  · 판 외경 = flangeOd(bore), 두께 = flangeTh(bore) — Y 스트레이너·단독 플랜지·배관 끝
//    플랜지·장비 노즐 플랜지와 **같은 KS 10K 표**를 쓴다(v71: 전 관경 1:1 일치).
//  · opt.defW/defH/defD : 이 빌더가 마지막에 곱하는 g.scale의 기준값(로컬 기본 치수)
//  · opt.bodyEnd·neckR : 판 안쪽 면과 몸체 끝이 벌어지면 그 사이를 목으로 메운다
//  · opt.T : 판 두께를 표 값 대신 직접 줄 때(m). opt.od : 판 외경을 직접 줄 때(m)
function equipFlangeSide(g, spec, sgn, opt) {
  const o = opt || {};
  const bore = spec.bore || SIZE_REF_BORE;
  const plan = boreScale(bore).plan || 1;
  const defW = o.defW || 0.2;
  const defH = o.defH || defW;
  const defD = o.defD || defW;
  // 각 빌더의 g.scale.set(...)과 **같은 식** — 판을 이 배율에서 되돌린다.
  const S = {
    x: (Number(spec.w) || defW * plan) / defW,
    y: (Number(spec.h) || defH) / defH,
    z: (Number(spec.d) || defD) / defD,
  };
  const W = Math.abs(Number(spec.w) || defW * plan);     // 면간거리(월드 m)
  // 판 두께 — KS 10K 표. 다만 아주 작은 관경(15A 등)은 면간거리보다 판이 두꺼워
  // 양쪽 판이 몸통 안에서 겹치므로, 그릴 수 있는 한도(면간의 45%)까지만 쓴다.
  const T = Math.min(Number(o.T) || flangeTh(bore), W * 0.45);   // 판 두께(월드 m)
  const R = (Number(o.od) || flangeOd(bore)) / 2;       // 판 외경 반지름(월드 m)
  const mat = o.mat || MAT(spec.color, 0.35, 0.9);
  const face = W / 2;                                    // 접합면(월드 x)
  const fg = flangeFrame(g, { x: sgn * (face - T / 2), y: 0, z: 0 }, S);
  // 목 — 몸체 끝(로컬 bodyEnd × 배율)에서 판 안쪽 면까지. 반지름은 관경 비례(plan).
  const bodyEndW = S.x * (o.bodyEnd || 0);
  const innerW = face - T;
  const len = innerW - bodyEndW;
  if (o.neckR && len > 0.002) {
    const nr = o.neckR * plan;
    add(fg, cyl(nr, len, 20), o.neckMat || mat,
      -sgn * (len / 2 + T / 2), 0, 0, 0, 0, Math.PI / 2);
  }
  flangeMesh(fg, new THREE.Vector3(0, 0, 0), new THREE.Vector3(sgn, 0, 0),
    R, boreOd(bore) / 2 * 1.03, T, mat, bore);
}

// 두 점을 잇는 원통(단위 높이 원통을 회전·스케일) — 경사 분기관·타이로드·지주 등
function addTube(parent, a, b, r, material, seg = 18) {
  const va = new THREE.Vector3(a[0], a[1], a[2]);
  const vb = new THREE.Vector3(b[0], b[1], b[2]);
  const dir = new THREE.Vector3().subVectors(vb, va);
  const len = dir.length();
  if (len < 1e-5) return null;
  const mesh = new THREE.Mesh(cyl(r, 1, seg), material);
  mesh.scale.y = len;
  mesh.position.copy(va).add(vb).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

const D = (deg) => THREE.MathUtils.degToRad(deg || 0);

// ── 단조형(소켓웰드·나사식) 접합 보스 ────────────────────────────────────────
// conn === 'forged'인 부속·배관 끝은 플랜지 원판 대신 이 보스를 그린다.
//  · pos  : 접합면 중심 (부속의 로컬 좌표, 배관은 월드 좌표)
//  · axis : 배관이 빠져나가는 바깥 방향 단위벡터
//  · r    : 배관·바디 외경 반지름
// 짧은 원통 칼라(소켓 몸통) + 육각 조임부(단조 육각) + 가는 목 + 용접 비드 링으로
// 플랜지 볼트 구멍 없이 깔끔한 소켓·나사 이음으로 보이게 한다.
function socketBoss(parent, pos, axis, r, bodyMat, beadMat, opt) {
  const o = opt || {};
  const w = Math.max(0.008, Number(r) || 0.03);
  const mat = bodyMat || MAT('#c9d0d6', 0.4, 0.8);
  const bead = beadMat || MAT('#8f979f', 0.45, 0.85);
  const ax = new THREE.Vector3(Number(axis && axis[0]) || 0, Number(axis && axis[1]) || 0, Number(axis && axis[2]) || 0);
  if (ax.lengthSq() < 1e-9) ax.set(1, 0, 0);
  ax.normalize();
  const base = new THREE.Vector3(Number(pos[0]) || 0, Number(pos[1]) || 0, Number(pos[2]) || 0);
  const qY = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), ax);
  const qZ = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), ax);
  const put = (mesh, t, q) => {
    mesh.position.copy(base).addScaledVector(ax, t);
    mesh.quaternion.copy(q || qY);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };
  // 소켓 몸통 — 배관을 받는 짧은 원통 칼라 (접합면 안쪽으로 앉는다)
  put(new THREE.Mesh(cyl(w * (o.collar || 1.5), o.h || 0.05, 22), mat), -(o.h || 0.05) * 0.24);
  // 단조 육각 조임부 — 나사식·소켓웰드의 육각 칼라 (배관 위를 살짝 물고 나간다)
  put(new THREE.Mesh(cyl(w * (o.hex || 1.62), 0.026, 6), mat), 0.026);
  // 목(네크) — 배관과 만나는 자리의 가는 칼라
  put(new THREE.Mesh(cyl(w * (o.neck || 1.16), 0.03, 18), bead), -(o.h || 0.05) * 0.24 - 0.038);
  // 용접 비드 링
  put(new THREE.Mesh(torus(w * (o.neck || 1.16) + 0.004, w * 0.085), bead), -(o.h || 0.05) * 0.24 - 0.03, qZ);
}

const isForged = (spec) => !!spec && spec.conn === 'forged';

// ── 스팀/배관 헤더 (가로 원통 분배기 + 볼트 플랜지 + 새들 지지 프레임) ────────
// 현장 사진(2026-11-22)처럼 가로로 누운 원통에 위·아래로 수직 배관이 꽂히는 설비.
// 위에서 아래로: 상부 노즐(수직 분기관 자리) — 원통 — 지지 새들 프레임.
// 치수는 headerBody()가 정한다(spec.y = 바닥, 원통 중심은 stand + h/2).
function buildHeader(spec) {
  const g = new THREE.Group();
  const H = headerBody(spec);
  const R = H.R;
  const L = H.L;
  const cy = H.cy;
  const stand = H.stand;

  const shellMat = MAT(spec.color, 0.55, 0.45);
  const bandMat = MAT(shade(spec.color, 0.86), 0.55, 0.5);
  const steel = MAT('#9aa3ab', 0.4, 0.8);
  const boltMat = MAT('#3f474e', 0.5, 0.85);
  const saddleMat = MAT('#8b949c', 0.6, 0.55);

  // 원통 본체 (X축) + 양단 접시형 경판
  add(g, cyl(R, L, 40), shellMat, 0, cy, 0, 0, 0, Math.PI / 2);
  [-1, 1].forEach((sx) => {
    const cap = add(g, sphere(R, 28), shellMat, sx * (L / 2), cy, 0);
    cap.scale.set(0.55, 1, 1);
    add(g, cyl(R * 0.45, 0.03, 24), bandMat, sx * (L / 2 + R * 0.5), cy, 0, 0, 0, Math.PI / 2);
  });

  // 볼트 플랜지 2쌍 — 사진처럼 원통을 나눠 잇는 두꺼운 접합부
  [-0.3, 0.3].forEach((f) => {
    const x = L * f;
    [-1, 1].forEach((sx) => {
      add(g, cyl(R * 1.18, 0.05, 40), bandMat, x + sx * 0.026, cy, 0, 0, 0, Math.PI / 2);
      for (let i = 0; i < 12; i += 1) {
        const a = (Math.PI * 2 * i) / 12;
        add(g, cyl(0.011, 0.13, 8), boltMat, x + sx * 0.026,
          cy + Math.cos(a) * R * 1.02, Math.sin(a) * R * 1.02, 0, 0, Math.PI / 2);
      }
    });
  });

  // 위·아래·왼쪽·오른쪽 노즐은 buildNozzles()가 속성 패널 설정대로 그린다
  // (예전 고정 노즐 3개·드레인 2개는 없앴다 — '없음'으로 끄면 정말 사라져야 한다).

  // 새들 지지 프레임 2개 — 바닥 보 + 두 기둥 + 원통 받침판
  [-0.3, 0.3].forEach((f) => {
    const x = L * f;
    add(g, box(R * 2.2, 0.05, R * 2.6), saddleMat, x, 0.025, 0);
    [-1, 1].forEach((sz) => {
      add(g, box(0.08, stand, 0.08), saddleMat, x, stand / 2, sz * R * 0.72);
      addTube(g, [x, 0.05, sz * R * 1.12], [x, stand * 0.62, sz * R * 0.72], 0.014, saddleMat, 8);
    });
    add(g, box(0.14, 0.07, R * 1.9), saddleMat, x, stand - 0.03, 0);
  });

  // 명판
  add(g, box(Math.min(0.34, L * 0.16), 0.13, 0.015), MAT('#e4ebf1', 0.4, 0.3), 0, cy + R * 0.1, R + 0.008);
  return g;
}

// ── 열교환기 (쉘앤튜브 — 볼트 체결 바디 플랜지 · 둥근 경판 · 새들 프레임) ────
// 현장 사진(2026-11-25)의 실물처럼: 쉘 양끝에 두꺼운 볼트 플랜지 2쌍,
// 그 밖으로 둥근 접시형 경판(채널)이 붙고, 아래에는 사각 새들 2개를 가로 보강 바로 잇는다.
// 노즐은 고정이 아니라 store.js hxNozzlesOf()의 자유 목록을 buildNozzles()가 그린다.
function buildHX(spec) {
  const g = new THREE.Group();
  const B = hxBody(spec);
  const { R, dia, bodyLen, flangeT, flangeR, headLen, headR, capDepth, leg, cy, saddleX } = B;

  const shellMat = MAT(spec.color, 0.42, 0.78);
  const flangeMat = MAT(shade(spec.color, 0.86), 0.5, 0.82);
  const headMat = MAT(shade(spec.color, 0.95), 0.45, 0.75);
  const boltMat = MAT('#3b444c', 0.55, 0.9);
  const saddleMat = MAT('#8b949c', 0.62, 0.5);
  const plateMat = MAT('#a2aab1', 0.6, 0.55);

  // ① 쉘 본체 + 이음매 밴드
  add(g, cyl(R, bodyLen, 44), shellMat, 0, cy, 0, 0, 0, Math.PI / 2);
  [-0.28, 0.28].forEach((f) => {
    add(g, cyl(R * 1.008, 0.018, 44), flangeMat, bodyLen * f, cy, 0, 0, 0, Math.PI / 2);
  });

  // ② 양끝 — 바디 플랜지 2쌍(볼트 링) + 둥근 경판
  [-1, 1].forEach((sx) => {
    const shellFace = sx * bodyLen / 2;
    // 쉘 쪽 플랜지
    add(g, cyl(flangeR, flangeT, 44), flangeMat, shellFace + sx * flangeT * 0.5, cy, 0, 0, 0, Math.PI / 2);
    // 헤드 쪽 플랜지 — 살짝 작고, 사이에 개스킷 틈이 보이게 띄운다
    add(g, cyl(flangeR * 0.965, flangeT, 44), flangeMat, shellFace + sx * (flangeT * 1.5 + 0.008), cy, 0, 0, 0, Math.PI / 2);
    // 둘레 볼트 16개 (스터드 + 너트)
    const ringR = flangeR * 0.9;
    const studX = shellFace + sx * flangeT;
    for (let i = 0; i < 16; i += 1) {
      const a = (Math.PI * 2 * i) / 16 + 0.2;
      const by = cy + Math.cos(a) * ringR;
      const bz = Math.sin(a) * ringR;
      addTube(g, [studX - sx * flangeT * 0.8, by, bz], [studX + sx * flangeT * 0.95, by, bz],
        Math.max(0.008, flangeT * 0.16), boltMat, 8);
      add(g, cyl(Math.max(0.011, flangeT * 0.22), flangeT * 0.5, 6), boltMat,
        studX + sx * flangeT * 0.95, by, bz, 0, 0, Math.PI / 2);
    }
    // 경판(채널) 원통 + (둥근 접시형 캡 또는 평판 커버)
    const headStart = shellFace + sx * flangeT * 2;
    const headEnd = headStart + sx * headLen;
    const round = hxHeadRound(spec, sx);
    add(g, cyl(headR, headLen, 40), headMat, (headStart + headEnd) / 2, cy, 0, 0, 0, Math.PI / 2);
    if (round) {
      const cap = add(g, sphere(headR, 28), headMat, headEnd, cy, 0);
      cap.scale.set(capDepth / headR, 1, 1);
      // 경판 꼭대기 보스 — 축방향 노즐 자리(비어 있으면 캡만 보인다)
      add(g, cyl(headR * 0.2, capDepth * 0.12, 20), flangeMat,
        headEnd + sx * capDepth * 0.9, cy, 0, 0, 0, Math.PI / 2);
    } else {
      // 평판 커버 — 볼트로 조인 두꺼운 원판 + 가운데 보스(축방향 노즐 자리)
      const coverT = Math.max(0.05, R * 0.18);
      const flatR = flangeR * 0.92;
      add(g, cyl(flatR, coverT, 44), headMat, headEnd + sx * coverT / 2, cy, 0, 0, 0, Math.PI / 2);
      const hubLen = Math.max(0.04, capDepth - coverT);
      add(g, cyl(headR * 0.62, hubLen, 32), flangeMat,
        headEnd + sx * (coverT + hubLen / 2), cy, 0, 0, 0, Math.PI / 2);
      // 커버 둘레 볼트
      for (let i = 0; i < 12; i += 1) {
        const a = (Math.PI * 2 * i) / 12 + 0.15;
        const by = cy + Math.cos(a) * flatR * 0.82;
        const bz = Math.sin(a) * flatR * 0.82;
        addTube(g, [headEnd - sx * coverT * 0.2, by, bz], [headEnd + sx * coverT * 1.15, by, bz],
          Math.max(0.008, flangeT * 0.15), boltMat, 8);
      }
      // 평판 면 테두리 링
      addTube(g, [headEnd + sx * coverT * 0.98, cy, 0], [headEnd + sx * coverT * 1.06, cy, 0],
        flatR * 0.98, plateMat, 44);
    }
    // 경판 하단의 작은 드레인·벤트 보스
    add(g, cyl(Math.max(0.02, R * 0.07), Math.max(0.03, R * 0.12), 14), boltMat,
      (headStart + headEnd) / 2, cy - headR * 0.9, 0);
  });

  // ③ 새들 지지대 — 사각 기둥 2개 + 가로 보강 바 + 바닥 보
  const postW = Math.max(0.1, Math.min(0.26, R * 0.55));
  const postD = dia * 0.88;
  const postH = leg - 0.05;
  [-saddleX, saddleX].forEach((x) => {
    add(g, box(postW * 2.1, 0.05, postD * 1.24), plateMat, x, 0.025, 0);            // 바닥 판
    add(g, box(postW, postH, postD), saddleMat, x, 0.05 + postH / 2, 0);             // 기둥
    add(g, box(postW * 1.2, 0.04, postD * 1.04), plateMat, x, leg - 0.02, 0);        // 쉘 받침판
  });
  // 두 새들 사이를 잇는 가로 보강 바 (사진의 아래 연결 프레임)
  add(g, box(saddleX * 2 - postW * 0.5, Math.max(0.07, leg * 0.18), postW * 0.7), saddleMat,
    0, leg * 0.42, 0);
  // 바닥 앞·뒤 보
  [-1, 1].forEach((sz) => {
    add(g, box(saddleX * 2 + postW * 2.1, 0.055, Math.max(0.07, postD * 0.12)), plateMat,
      0, 0.028, sz * postD * 0.5);
  });

  // ④ 명판 · 리프팅 러그
  add(g, box(Math.min(0.34, bodyLen * 0.18), 0.13, 0.012), MAT('#e4ebf1', 0.4, 0.3),
    bodyLen * 0.14, cy + R * 0.12, R + 0.006);
  [-1, 1].forEach((sx) => {
    const lx = sx * bodyLen * 0.42;
    add(g, box(0.05, 0.11, 0.02), saddleMat, lx, cy + R + 0.05, 0);
    add(g, cyl(0.028, 0.026, 12), boltMat, lx, cy + R + 0.12, 0, 0, 0, Math.PI / 2);
  });

  // 노즐은 buildNozzles()가 자유 목록대로 그린다 (위치·방향·개수·관경 자유)
  return g;
}

// ── 원심펌프 + 모터 ──────────────────────────────────────────────────────────
function buildPump(spec) {
  const g = new THREE.Group();
  const blue = MAT(spec.color, 0.4, 0.55);
  const motorMat = MAT('#33526f', 0.45, 0.65);
  const steel = MAT('#9aa3ab', 0.35, 0.85);
  const dark = MAT('#252b31', 0.7, 0.45);

  // 베이스 프레임
  add(g, box(1.08, 0.1, 0.5), dark, 0.02, 0.05, 0);
  add(g, box(1.08, 0.04, 0.52), dark, 0.02, 0.02, 0);

  // 볼류트 케이싱 (축 Z)
  add(g, cyl(0.24, 0.3, 28), blue, 0.12, 0.42, 0, Math.PI / 2, 0, 0);
  add(g, cyl(0.26, 0.05, 28), blue, 0.12, 0.42, 0.17, Math.PI / 2, 0, 0);
  // 흡입(IN)·토출(OUT) 노즐은 buildNozzles()가 그린다 — 속성 패널에서 관경을 고르면
  // 그 굵기로 케이싱 앞(+Z)·위(+Y)에 서고, 끝점이 손 그리기 스냅 자리가 된다.
  // 베어링 브래킷
  add(g, cyl(0.09, 0.22, 20), steel, 0.37, 0.42, 0, 0, 0, Math.PI / 2);
  // 커플링 가드
  add(g, cyl(0.075, 0.18, 16), dark, 0.52, 0.42, 0, 0, 0, Math.PI / 2);
  // 모터
  add(g, cyl(0.19, 0.04, 24), motorMat, 0.6, 0.42, 0, 0, 0, Math.PI / 2);
  add(g, cyl(0.165, 0.4, 24), motorMat, 0.8, 0.42, 0, 0, 0, Math.PI / 2);
  add(g, cyl(0.152, 0.07, 24), motorMat, 1.02, 0.42, 0, 0, 0, Math.PI / 2);
  add(g, box(0.18, 0.12, 0.16), motorMat, 0.8, 0.6, 0);
  add(g, box(0.05, 0.12, 0.3), dark, 0.68, 0.26, 0);
  add(g, box(0.05, 0.12, 0.3), dark, 0.93, 0.26, 0);
  // 펌프 지지대
  add(g, box(0.26, 0.2, 0.26), blue, 0.12, 0.2, 0);

  g.scale.set(spec.w / 1.15, spec.h / 0.85, spec.d / 0.6);
  return g;
}

// ── 탱크 / 드럼 ──────────────────────────────────────────────────────────────
function buildTank(spec) {
  const g = new THREE.Group();
  const r = Math.max(0.15, spec.w / 2);
  const h = Math.max(0.2, spec.h);
  const bodyMat = MAT(spec.color, 0.5, 0.45);
  const rimMat = MAT(shade(spec.color, 0.78), 0.55, 0.5);

  add(g, cyl(r, h * 0.96, 28), bodyMat, 0, h * 0.5, 0);
  add(g, cyl(r * 1.02, 0.035, 28), rimMat, 0, h * 0.03, 0);
  add(g, cyl(r * 0.99, 0.03, 28), rimMat, 0, h * 0.96, 0);
  [0.33, 0.66].forEach((f) => add(g, torus(r * 1.005, 0.012), rimMat, 0, h * f, 0, Math.PI / 2, 0, 0));
  // 상·하·좌·우 노즐은 buildNozzles()가 그린다 (예전 고정 상부 벤트는 제거)
  return g;
}

// ── 제어반 캐비닛 ────────────────────────────────────────────────────────────
function buildPanel(spec) {
  const g = new THREE.Group();
  const w = Math.max(0.4, spec.w), h = Math.max(0.5, spec.h), d = Math.max(0.25, spec.d);
  const bodyMat = MAT(spec.color, 0.38, 0.75);
  const doorMat = MAT(shade(spec.color, 0.93), 0.32, 0.8);
  const darkMat = MAT('#2b3238', 0.7, 0.4);

  add(g, box(w, h, d), bodyMat, 0, h / 2, 0);
  add(g, box(w * 0.94, h * 0.88, 0.02), doorMat, 0, h * 0.5, d / 2 + 0.011);
  add(g, box(w * 1.02, 0.05, d * 1.02), bodyMat, 0, h + 0.025, 0);
  // 손잡이
  add(g, box(0.03, 0.2, 0.05), darkMat, w * 0.42, h * 0.52, d / 2 + 0.035);
  // 통풍구
  for (let i = 0; i < 4; i += 1) {
    add(g, box(w * 0.4, 0.02, 0.012), darkMat, 0, h * (0.74 + i * 0.035), d / 2 + 0.022);
  }
  // 표시등 · 계기
  add(g, cyl(0.035, 0.03, 16), MAT('#d23b3b', 0.4, 0.2), -w * 0.2, h * 0.9, d / 2 + 0.03, Math.PI / 2, 0, 0);
  add(g, cyl(0.05, 0.03, 16), MAT('#1b2026', 0.5, 0.3), w * 0.18, h * 0.88, d / 2 + 0.03, Math.PI / 2, 0, 0);
  // 받침 · 상부 케이블
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => {
    add(g, box(0.09, 0.09, 0.09), darkMat, sx * (w / 2 - 0.08), 0.045, sz * (d / 2 - 0.08));
  });
  add(g, cyl(0.04, 0.22, 12), darkMat, -w * 0.3, h + 0.13, 0);
  add(g, cyl(0.03, 0.16, 12), darkMat, -w * 0.1, h + 0.1, 0);
  return g;
}

// ── 게이트밸브 (핸드휠 + 플랜지) ────────────────────────────────────────────
function buildValve(spec) {
  const g = new THREE.Group();
  const bodyMat = MAT(spec.color, 0.35, 0.9);
  const darkMat = MAT('#2c3238', 0.65, 0.5);

  // 몸체 (흐름 방향 X)
  add(g, cyl(0.085, 0.14, 20), bodyMat, 0, 0, 0, 0, 0, Math.PI / 2);
  add(g, cyl2(0.09, 0.09, 0.1, 20), bodyMat, 0, 0.05, 0, 0, 0, Math.PI / 2);
  // 양쪽 접합부 — 플랜지 원판 또는 단조 소켓 보스
  const forged = isForged(spec);
  [-1, 1].forEach((sx) => {
    if (forged) {
      socketBoss(g, [sx * 0.1, 0, 0], [sx, 0, 0], 0.085, bodyMat, darkMat);
      return;
    }
    // 얇은 링 판(내경·볼트 구멍) — 바깥면이 접합면(±w/2)에 정확히 닿는다.
    equipFlangeSide(g, spec, sx, { defW: 0.264, defH: 0.58, defD: 0.3, bodyEnd: 0.07, neckR: 0.085, mat: bodyMat });
  });
  // 보닛 · 스템
  add(g, cyl(0.07, 0.09, 20), bodyMat, 0, 0.11, 0);
  add(g, cyl(0.016, 0.26, 12), MAT('#aab2ba', 0.3, 0.95), 0, 0.27, 0);
  // 핸드휠
  add(g, torus(0.17, 0.018), darkMat, 0, 0.4, 0, Math.PI / 2, 0, 0);
  for (let i = 0; i < 3; i += 1) {
    add(g, box(0.33, 0.013, 0.022), darkMat, 0, 0.4, 0, 0, (Math.PI / 3) * i, 0);
  }
  add(g, cyl(0.032, 0.05, 14), darkMat, 0, 0.405, 0);

  // x 배율의 기준값 0.264 = 이 메시의 실제 좌우 폭(m) — 커서 전진 폭과 1:1로 맞춘다.
  g.scale.set(spec.w / 0.264, spec.h / 0.58, spec.d / 0.3);
  return g;
}

// ── 대형 원통 저장탱크 (입형 원통 + 지지다리 + 콘 헤드 + 맨홀 + 노즐) ──────
function buildSTank(spec) {
  const g = new THREE.Group();
  const shellMat = MAT(spec.color, 0.42, 0.75);
  const headMat = MAT(shade(spec.color, 0.88), 0.45, 0.7);
  const legMat = MAT(shade(spec.color, 0.6), 0.6, 0.5);
  const steel = MAT('#8f979f', 0.4, 0.85);
  const dark = MAT('#2c3238', 0.65, 0.5);

  const R = 0.9;
  const legH = 0.55;
  const shellBot = legH + 0.24;
  const shellTop = 2.42;

  // 지지다리 4개 + 베이스 플레이트 · 거싯
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => {
    add(g, box(0.1, legH, 0.1), legMat, sx * 0.62, legH / 2, sz * 0.62);
    add(g, box(0.22, 0.028, 0.22), legMat, sx * 0.62, 0.014, sz * 0.62);
    add(g, box(0.16, 0.14, 0.02), legMat, sx * 0.62, legH - 0.1, sz * 0.44);
  });

  // 하부 원추 헤드 · 쉘 · 상부 콘 헤드
  add(g, cyl2(R, R * 0.5, 0.24, 32), headMat, 0, legH + 0.12, 0);
  add(g, cyl(R, shellTop - shellBot, 32), shellMat, 0, (shellBot + shellTop) / 2, 0);
  add(g, cyl2(R * 0.36, R, 0.3, 32), headMat, 0, shellTop + 0.15, 0);

  // 보강 링
  [0.95, 1.75].forEach((y) => add(g, torus(R * 1.005, 0.012), steel, 0, y, 0, Math.PI / 2, 0, 0));

  // 맨홀 (상부 노즐·측면 노즐은 buildNozzles()가 속성 패널 설정대로 그린다)
  add(g, cyl(0.2, 0.12, 20), headMat, 0, shellTop + 0.36, 0);
  add(g, cyl(0.28, 0.035, 24), steel, 0, shellTop + 0.43, 0);

  // 사다리 (뒤쪽) + 명판
  [-0.16, 0.16].forEach((dx) => add(g, cyl(0.014, 1.9, 8), dark, dx, legH + 1.0, -R - 0.08));
  for (let i = 0; i < 9; i += 1) add(g, cyl(0.011, 0.32, 8), dark, 0, legH + 0.2 + i * 0.2, -R - 0.08, 0, 0, Math.PI / 2);
  add(g, box(0.42, 0.22, 0.02), MAT('#e4ebf1', 0.4, 0.3), 0, 1.5, R + 0.012);

  g.scale.set(spec.w / 2.0, spec.h / 3.0, spec.d / 2.0);
  return g;
}

// ── 사각 탱크 · 수조 (보강 리브 프레임 + 맨홀 + 측면 노즐) ───────────────
function buildRTank(spec) {
  const g = new THREE.Group();
  const bodyMat = MAT(spec.color, 0.5, 0.5);
  const frameMat = MAT(shade(spec.color, 0.72), 0.55, 0.6);
  const baseMat = MAT('#5d666e', 0.65, 0.45);
  const steel = MAT('#9aa3ab', 0.35, 0.85);
  const dark = MAT('#2c3238', 0.65, 0.5);

  const W = 2.2;
  const H = 1.62;
  const Dd = 1.62;

  // 본체 · 바닥 베이스 · 상부 뚜껑
  add(g, box(W, H, Dd), bodyMat, 0, H / 2 + 0.1, 0);
  add(g, box(W + 0.16, 0.1, Dd + 0.16), baseMat, 0, 0.05, 0);
  add(g, box(W + 0.08, 0.07, Dd + 0.08), frameMat, 0, H + 0.13, 0);

  // 보강 리브 (앞뒤 수직 + 띠)
  [-0.333, 0, 0.333].forEach((f) => {
    [-1, 1].forEach((sz) => {
      add(g, box(0.07, H, 0.035), frameMat, W * f, H / 2 + 0.1, sz * (Dd / 2 + 0.018));
    });
  });
  [0.42, 0.78].forEach((f) => {
    [-1, 1].forEach((sz) => add(g, box(W + 0.02, 0.07, 0.035), frameMat, 0, H * f + 0.1, sz * (Dd / 2 + 0.018)));
    [-1, 1].forEach((sx) => add(g, box(0.035, 0.07, Dd + 0.02), frameMat, sx * (W / 2 + 0.018), H * f + 0.1, 0));
  });
  // 수평 코너 프레임
  [-1, 1].forEach((sx) => {
    [-1, 1].forEach((sz) => add(g, box(0.06, H, 0.06), frameMat, sx * W / 2, H / 2 + 0.1, sz * Dd / 2));
  });

  // 맨홀 + 경첩
  add(g, cyl(0.26, 0.07, 22), frameMat, 0.5, H + 0.19, 0.35);
  add(g, box(0.12, 0.05, 0.1), dark, 0.76, H + 0.2, 0.35);

  // 측면·상부·바닥 노즐은 buildNozzles()가 속성 패널 설정대로 그린다

  g.scale.set(spec.w / 2.4, spec.h / 1.8, spec.d / 1.8);
  return g;
}

function shade(hex, factor) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(factor);
  return '#' + c.getHexString();
}

// ── 입형 인라인 펌프 (하부 흉입 플랜지 · 세로 모터 · 단자함 · 기초 베이스) ─────
function buildVPump(spec) {
  const g = new THREE.Group();
  const bodyMat = MAT(spec.color, 0.4, 0.6);
  const motorMat = MAT(shade(spec.color, 0.72), 0.45, 0.7);
  const steel = MAT('#9aa3ab', 0.35, 0.85);
  const dark = MAT('#252b31', 0.7, 0.45);

  // 기초 베이스 플레이트 · 앙커 볼트
  add(g, box(0.5, 0.04, 0.5), dark, 0, 0.02, 0);
  add(g, box(0.34, 0.06, 0.34), bodyMat, 0, 0.07, 0);
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => {
    add(g, cyl(0.016, 0.05, 10), steel, sx * 0.2, 0.045, sz * 0.2);
  });

  // 흉입(하부) 플랜지 — 얇은 링 판(내경·볼트 구멍) + 목
  const riseV = (Number(spec.h) || 0.85) / 0.85;
  const vT = 0.016 / riseV;                     // 판 두께(로컬) — 월드 16mm
  flangeMesh(g, new THREE.Vector3(0, 0.115, 0), new THREE.Vector3(0, 1, 0), 0.155, 0.1, vT, steel);
  add(g, cyl(0.1, 0.05, 20), steel, 0, 0.155, 0);

  // 볼류트 케이싱 + 볼트 이어
  add(g, cyl(0.15, 0.2, 28), bodyMat, 0, 0.28, 0);
  add(g, torus(0.152, 0.016), bodyMat, 0, 0.28, 0, Math.PI / 2, 0, 0);
  for (let i = 0; i < 6; i += 1) {
    const a = (Math.PI * 2 * i) / 6;
    add(g, cyl(0.017, 0.035, 8), steel, Math.cos(a) * 0.138, 0.385, Math.sin(a) * 0.138);
  }

  // 토출(상부) 플랜지
  flangeMesh(g, new THREE.Vector3(0, 0.415, 0), new THREE.Vector3(0, 1, 0), 0.155, 0.1, vT, steel);

  // 모터 브래킷 · 모터(냉각핀) · 상단 캡 · 리프팅 아이
  add(g, cyl(0.11, 0.07, 20), motorMat, 0, 0.465, 0);
  add(g, cyl(0.115, 0.25, 26), motorMat, 0, 0.625, 0);
  for (let i = 0; i < 7; i += 1) add(g, cyl(0.121, 0.011, 26), motorMat, 0, 0.53 + i * 0.031, 0);
  add(g, cyl(0.1, 0.035, 20), dark, 0, 0.767, 0);
  add(g, torus(0.03, 0.009), steel, 0.055, 0.8, 0, 0, 0, Math.PI / 2);

  // 단자함 · 명판
  add(g, box(0.12, 0.1, 0.08), motorMat, -0.01, 0.65, 0.125);
  add(g, box(0.1, 0.05, 0.02), MAT('#e4ebf1', 0.4, 0.3), 0, 0.29, 0.152);

  g.scale.set(spec.w / 0.42, spec.h / 0.85, spec.d / 0.42);
  return g;
}

// ── 기어식 버터플라이 밸브 (웨이퍼 바디 + 볼트 플랜지 + 기어박스 + 핸드휠) ──
function buildButterfly(spec) {
  const g = new THREE.Group();
  const bodyMat = MAT(spec.color, 0.35, 0.72);
  const gearMat = MAT(shade(spec.color, 0.78), 0.5, 0.65);
  const steel = MAT('#9aa3ab', 0.35, 0.85);
  const dark = MAT('#2c3238', 0.65, 0.5);

  // 웨이퍼 바디 (흐름 X)
  add(g, cyl(0.115, 0.1, 28), bodyMat, 0, 0, 0, 0, 0, Math.PI / 2);
  // 양단 접합부 — 플랜지면 얇은 링 판, 단조형이면 소켓 보스만
  const forged = isForged(spec);
  [-1, 1].forEach((sx) => {
    if (forged) {
      socketBoss(g, [sx * 0.058, 0, 0], [sx, 0, 0], 0.115, bodyMat, steel);
      return;
    }
    equipFlangeSide(g, spec, sx, { defW: 0.174, defH: 0.46, defD: 0.32, bodyEnd: 0.05, neckR: 0.115, mat: bodyMat });
  });
  // 상·하 루그
  add(g, box(0.09, 0.09, 0.06), bodyMat, 0, 0.13, 0);
  add(g, box(0.09, 0.06, 0.06), bodyMat, 0, -0.13, 0);
  // 스템 넥 · 기어박스 · 핸드휠
  add(g, cyl(0.036, 0.1, 16), steel, 0, 0.185, 0);
  add(g, box(0.15, 0.11, 0.12), gearMat, 0, 0.29, 0);
  add(g, box(0.1, 0.04, 0.09), dark, 0, 0.355, 0.02);
  add(g, cyl(0.014, 0.06, 10), steel, 0, 0.4, 0);
  add(g, torus(0.095, 0.014), dark, 0, 0.435, 0, Math.PI / 2, 0, 0);
  for (let i = 0; i < 3; i += 1) add(g, box(0.19, 0.011, 0.02), dark, 0, 0.435, 0, 0, (Math.PI / 3) * i, 0);
  add(g, cyl(0.022, 0.03, 12), dark, 0, 0.44, 0);

  g.scale.set(spec.w / 0.174, spec.h / 0.46, spec.d / 0.32);
  return g;
}

// ── Y자 스트레이너 (경사형) ───────────────────────────────────────────────────
// 사용자 제보(2026-11-25 `31601`·`31603`): "스트레이너 모양 이거 아니야 손잡이 없는
// y자 스트레이너이고 플렌지 크기는 왜케 안맞아 스트레이너 너무 커 … 50a여서 80a로
// 변경하니까 배관을 잡아먹었어"
//  · 핸드휠·수직 스템은 이 부속에 없다 — 스트레이너는 손잡이 없는 부속이라 통째로 뺐다.
//  · 형상을 **처음부터 m 단위 실제 치수**로 그린다. 예전에는 로컬 형상(0.296×0.5×0.34)에
//    w·h·d 배율을 따로 곱해서, h와 d 배율이 달라 플랜지 판이 타원이 되고 50A 판(195mm)이
//    80A 판(185mm)보다 커졌다. 지금은 판 외경 = flangeOd(bore), 판 두께 = flangeTh(bore),
//    몸체 반지름 = 배관 외경×0.62로 다른 밸브·배관 끝 플랜지와 100% 같은 KS 10K 표를 쓴다
//    (50A 155 < 65A 175 < 80A 185 < 100A 210mm).
function buildYValve(spec) {
  const g = new THREE.Group();
  const bodyMat = MAT(spec.color, 0.42, 0.62);
  const steel = MAT('#9aa3ab', 0.35, 0.85);
  const dark = MAT('#2c3238', 0.65, 0.5);
  const bore = BORES[spec.bore] ? spec.bore : SIZE_REF_BORE;
  const plan = boreScale(bore).plan || 1;
  const od = boreOd(bore);
  const half = Math.max(0.03, (Number(spec.w) || 0.296 * plan) / 2);   // 접합면 = ±half
  const T = Math.min(flangeTh(bore), half * 0.4);                     // KS 10K 판 두께
  const R = flangeOd(bore) / 2;                                       // KS 10K 판 외경 반지름
  const rb = od * 0.62;              // 몸체 반지름 — 배관보다 한 치수 굵은 주조 바디
  const br = od * 0.52;              // Y 바스켓(스크린실) 반지름
  const boreR = (od / 2) * 1.03;     // 판 가운데 내경

  // 유로 방향 직선 바디 (X) — 양 끝은 판 뒤로 들어가는 주조 숄더
  const bodyLen = Math.max(0.01, 2 * (half - T));
  add(g, cyl(rb, bodyLen, 26), bodyMat, 0, 0, 0, 0, 0, Math.PI / 2);
  [-1, 1].forEach((sx) => add(g, cyl(rb * 1.04, T * 0.9, 26), bodyMat,
    sx * (half - T * 1.45), 0, 0, 0, 0, Math.PI / 2));

  // 양단 접합부 — KS 10K 링 판(내경·볼트 구멍), 단조형이면 소켓 보스만
  const forged = isForged(spec);
  [-1, 1].forEach((sx) => {
    if (forged) {
      socketBoss(g, [sx * half, 0, 0], [sx, 0, 0], rb, bodyMat, steel);
      return;
    }
    flangeMesh(g, new THREE.Vector3(sx * (half - T / 2), 0, 0), new THREE.Vector3(sx, 0, 0),
      R, boreR, T, bodyMat, bore);
  });

  // ── Y 바스켓 — 아래로 45°, 하류 쪽으로 비스듬히 뻗고 끝에 볼트 캡(플러그) ──
  // 45°라 수평 이동 = 수직 낙하. 캡이 하류 플랜지 면을 넘지 않도록 방 길이를 잡는다.
  const dx = Math.SQRT1_2;
  const dy = -Math.SQRT1_2;
  const capR = Math.max(0.016, br * 1.26);            // 캡 판 반지름
  const x0 = -0.8 * half;                             // 바스켓 목이 몸체 상류 쪽에 붙는다
  const runX = Math.max(od * 0.72, (half - capR * 0.9) - x0);
  const Lb = runX / dx;
  const A = [x0, -rb * 0.12, 0];
  const B = [x0 + dx * Lb, -rb * 0.12 + dy * Lb, 0];
  // 주조 필렛 — 몸체에서 바스켓으로 이어지는 살집
  addTube(g, A, [A[0] + dx * br * 1.15, A[1] + dy * br * 1.15, 0], br * 1.22, bodyMat, 26);
  addTube(g, A, B, br, bodyMat, 26);                  // 스크린실
  // 캡 자리 목 — 판이 앉는 짧은 칼라
  addTube(g, [B[0] - dx * 0.026, B[1] - dy * 0.026, 0], B, br * 1.04, bodyMat, 26);
  // 볼트 캡 — 링 판 + 가운데 육각 플러그 + 배수 마개
  const capT = Math.max(0.012, Math.min(0.020, T * 0.9));
  const capDir = new THREE.Vector3(dx, dy, 0);
  flangeMesh(g, new THREE.Vector3(B[0] + dx * capT / 2, B[1] + dy * capT / 2, 0), capDir,
    capR, br * 0.66, capT, steel);
  const qY = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), capDir);
  const put = (geo, mat, t) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(B[0] + dx * t, B[1] + dy * t, 0);
    m.quaternion.copy(qY);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    return m;
  };
  put(cyl(br * 0.5, 0.026, 6), dark, capT + 0.013);   // 육각 플러그
  put(cyl(br * 0.2, 0.018, 6), steel, capT + 0.035);  // 배수 마개
  return g;
}

// ── 볼밸브 (바디 + 레버 핸들) ─────────────────────────────
function buildBall(spec) {
  const g = new THREE.Group();
  const bodyMat = MAT(spec.color, 0.35, 0.8);
  const steel = MAT('#9aa3ab', 0.35, 0.85);
  const dark = MAT('#2c3238', 0.6, 0.5);

  add(g, sphere(0.075, 20), bodyMat, 0, 0, 0);
  add(g, cyl(0.052, 0.2, 20), bodyMat, 0, 0, 0, 0, 0, Math.PI / 2);
  const forged = isForged(spec);
  [-1, 1].forEach((sx) => {
    if (forged) socketBoss(g, [sx * 0.092, 0, 0], [sx, 0, 0], 0.055, bodyMat, steel);
    else equipFlangeSide(g, spec, sx, { defW: 0.234, defH: 0.34, defD: 0.24, bodyEnd: 0.1, mat: steel });
  });
  add(g, cyl(0.03, 0.04, 14), bodyMat, 0, 0.075, 0);
  add(g, cyl(0.024, 0.06, 12), steel, 0, 0.11, 0);
  // 레버 — 수직(세운) 밸브에서는 유로(X)를 따라가면 안 되므로 옆(Z)으로 뉘인다.
  // dir(배관 진행 벡터)로 세워 놓인 경우도 같은 규칙을 따른다 — 유로가 수직이면 레버는 옆으로.
  const verticalFlow = spec.axis === 'y' || (Array.isArray(spec.dir) && spec.dir.length === 3
    && Math.abs(Number(spec.dir[1]) || 0) > 0.95 * (Math.hypot(...spec.dir.map(Number)) || 1));
  if (verticalFlow) add(g, box(0.024, 0.02, 0.19), dark, 0, 0.145, 0.035);
  else add(g, box(0.19, 0.02, 0.024), dark, 0.035, 0.145, 0);
  add(g, cyl(0.026, 0.03, 12), dark, 0, 0.148, 0);

  g.scale.set(spec.w / 0.234, spec.h / 0.34, spec.d / 0.24);
  return g;
}

// ── 체크밸브 (웨이퍼 · 스윙 바디) ──────────────────────────
function buildCheck(spec) {
  const g = new THREE.Group();
  const bodyMat = MAT(spec.color, 0.4, 0.78);
  const steel = MAT('#9aa3ab', 0.35, 0.85);
  const dark = MAT('#2c3238', 0.6, 0.5);

  add(g, cyl(0.1, 0.06, 26), bodyMat, 0, 0, 0, 0, 0, Math.PI / 2);
  const forged = isForged(spec);
  [-1, 1].forEach((sx) => {
    if (forged) socketBoss(g, [sx * 0.042, 0, 0], [sx, 0, 0], 0.09, bodyMat, steel);
    else equipFlangeSide(g, spec, sx, { defW: 0.108, defH: 0.26, defD: 0.22, bodyEnd: 0.03, neckR: 0.1, mat: steel });
  });
  add(g, box(0.1, 0.045, 0.06), bodyMat, 0, 0.105, 0);
  add(g, cyl(0.011, 0.05, 8), steel, 0, 0.14, 0);
  add(g, cyl(0.02, 0.014, 10), dark, 0, 0.165, 0);

  g.scale.set(spec.w / 0.108, spec.h / 0.26, spec.d / 0.22);
  return g;
}

// ── 안전·감압밸브 (세로 몸체 + 상부 스프링 보닛 + 측면 토출구) ────────────────
// 현장 사진 오른쪽처럼 수직 배관 위에 서서, 위로 스프링 보닛이 솟고 옆으로 토출구가 나온다.
// 로컬 기준: y=0이 부속 중심, 아래(−Y)가 입구(수직 배관에 접합), +X가 토출구.
// 그래서 기본 방향(axis: 'y')에서 따로 돌리지 않아도 세로로 선다.
function buildSafetyValve(spec) {
  const g = new THREE.Group();
  const bodyMat = MAT(spec.color, 0.42, 0.62);
  const bonnetMat = MAT(shade(spec.color, 0.9), 0.45, 0.6);
  const steel = MAT('#9aa3ab', 0.35, 0.85);
  const dark = MAT('#2c3238', 0.65, 0.5);

  // 입구 (아래) — 얇은 링 플랜지 + 목
  // 안전밸브는 세로 몸체라 g.scale의 y(h)·z(d) 배율이 달라 판이 타원이 되었다 — 판은
  // flangeFrame()으로 배율을 되돌려 월드에서 정확한 원으로 그린다(v71).
  const bore = spec.bore || SIZE_REF_BORE;
  const rise = (Number(spec.h) || 0.52) / 0.52;
  const S = { x: (Number(spec.w) || 0.22) / 0.22, y: rise, z: (Number(spec.d) || 0.22) / 0.22 };
  const Y = new THREE.Vector3(0, 1, 0);
  const FR = flangeOd(bore) / 2;                     // KS 10K 판 외경 반지름
  const FT = flangeTh(bore);                         // KS 10K 판 두께
  const ORIGIN = new THREE.Vector3(0, 0, 0);
  const plate = (frame, dir, R, T, material, b) => flangeMesh(frame, ORIGIN, dir, R,
    Math.min(R * 0.8, boreOd(bore) / 2 * 1.03), T, material, b);
  // 입구 — 배관이 체결되는 자리라 외경·두께가 배관 끝 플랜지와 똑같다
  plate(flangeFrame(g, { x: 0, y: -0.16 * S.y, z: 0 }, S), Y, FR, FT, steel, bore);
  add(g, cyl(0.045, 0.09, 18), bodyMat, 0, -0.11, 0);
  // 본체 (세로) + 중간 플랜지 2개 — 보닛·몸체 이음판이라 한 치수 작다
  add(g, cyl(0.068, 0.15, 22), bodyMat, 0, -0.01, 0);
  plate(flangeFrame(g, { x: 0, y: 0.065 * S.y, z: 0 }, S), Y, FR * 0.88, FT * 0.9, steel);
  plate(flangeFrame(g, { x: 0, y: -0.075 * S.y, z: 0 }, S), Y, FR * 0.84, FT * 0.85, steel);
  // 측면 토출구 (+X) + 플랜지
  add(g, cyl(0.04, 0.16, 18), bodyMat, 0.1, -0.01, 0, 0, 0, Math.PI / 2);
  plate(flangeFrame(g, { x: 0.185 * S.x, y: -0.01 * S.y, z: 0 }, S), new THREE.Vector3(1, 0, 0),
    FR * 0.75, FT * 0.85, steel);
  // 보닛 · 스프링 하우징 · 캡 · 조정 나사
  add(g, cyl2(0.048, 0.07, 0.05, 20), bonnetMat, 0, 0.1, 0);
  add(g, cyl(0.056, 0.15, 22), bonnetMat, 0, 0.2, 0);
  add(g, cyl(0.048, 0.03, 20), dark, 0, 0.29, 0);
  add(g, cyl(0.014, 0.06, 10), steel, 0, 0.33, 0);
  add(g, cyl(0.022, 0.025, 6), dark, 0, 0.365, 0);
  // 터는 레버
  add(g, box(0.09, 0.012, 0.02), steel, 0.055, 0.13, 0);

  g.scale.set(spec.w / 0.22, spec.h / 0.52, spec.d / 0.22);
  return g;
}

// ── 벨로우즈 신축관 (주름 원통 + 양단 플랜지 + 타이로드) ──────────────────
function buildBellows(spec) {
  const g = new THREE.Group();
  const bodyMat = MAT(spec.color, 0.32, 0.88);
  const steel = MAT('#8f979f', 0.4, 0.85);
  const dark = MAT('#3a4249', 0.6, 0.5);
  const len = 0.24;

  // 주름 원통 (토러스 5개) + 내부 슬리부
  for (let i = 0; i < 5; i += 1) {
    const x = -len / 2 + 0.035 + i * ((len - 0.07) / 4);
    add(g, torus(0.108, 0.022), bodyMat, x, 0, 0, 0, Math.PI / 2, 0);
  }
  add(g, cyl(0.098, len, 26), bodyMat, 0, 0, 0, 0, 0, Math.PI / 2);
  add(g, cyl(0.055, len + 0.06, 20), dark, 0, 0, 0, 0, 0, Math.PI / 2);

  // 양단 접합부 — 플랜지 또는 단조 소켓 보스
  const forged = isForged(spec);
  [-1, 1].forEach((sx) => {
    if (forged) {
      socketBoss(g, [sx * len / 2, 0, 0], [sx, 0, 0], 0.098, bodyMat, steel);
      return;
    }
    equipFlangeSide(g, spec, sx, { defW: 0.304, defH: 0.34, defD: 0.34, bodyEnd: 0.12, neckR: 0.098, mat: steel });
  });

  // 타이로드 4개 + 너트
  [[0.135, 0], [-0.135, 0], [0, 0.135], [0, -0.135]].forEach(([dy, dz]) => {
    addTube(g, [-len / 2 - 0.02, dy, dz], [len / 2 + 0.02, dy, dz], 0.011, steel, 10);
    [-1, 1].forEach((sx) => add(g, cyl(0.02, 0.028, 8), dark, sx * (len / 2 + 0.01), dy, dz, 0, 0, Math.PI / 2));
  });

  g.scale.set(spec.w / 0.304, spec.h / 0.34, spec.d / 0.34);
  return g;
}

// ── 90° 엘보 피팅 ────────────────────────────────────────
// 꼭짓점(0,0,0)에서 두 다리가 +X·+Y로 나가는 모습으로 그리고, 배치할 때
// inDir/outDir 회전을 걸어 어느 평면에서 꺾여도 두 입구가 배관과 일직선이 되게 한다.
// 곡관은 꼭짓점 안쪽을 도는 원호(중심 (R,R)) — 예전처럼 바깥으로 불룩한 고리(배관을 뚫는) 모양이 아니다.
function buildElbow(spec) {
  const g = new THREE.Group();
  const dims = elbowDims('elbow', spec.bore || spec.bore1);
  const { r, R, Ls } = dims;
  const bodyMat = MAT(spec.color, 0.4, 0.8);
  const beadMat = MAT(shade(spec.color, 0.82), 0.5, 0.7);

  const arc = new THREE.Mesh(
    G(`elbowarc|${R.toFixed(4)}|${r.toFixed(4)}`, () => new THREE.TorusGeometry(R, r, 14, 30, Math.PI / 2)), bodyMat);
  arc.rotation.z = Math.PI;          // 0~90° 호를 돌려 (R,R) 중심의 안쪽 곡관으로
  arc.position.set(R, R, 0);
  arc.castShadow = true;
  arc.receiveShadow = true;
  g.add(arc);

  // 양단 직관 스텁 — 접합면까지 (배관은 이 면에서 끝난다)
  addTube(g, [R, 0, 0], [R + Ls, 0, 0], r, bodyMat, 22);
  addTube(g, [0, R, 0], [0, R + Ls, 0], r, bodyMat, 22);

  // 접합면 — 용접 부위에는 아무 링·비드를 두르지 않는다(사용자: "용접표시 다 없어도 돼").
  //  · 단조형만 소켓 보스를 그린다 — 그것이 소켓웰드·나사 이음의 모습이다.
  if (isForged(spec)) {
    socketBoss(g, [R + Ls, 0, 0], [1, 0, 0], r, bodyMat, beadMat);
    socketBoss(g, [0, R + Ls, 0], [0, 1, 0], r, bodyMat, beadMat);
  }

  return g;
}

// ── 티 분기관 (주배관 1차 관경 + 분기 2차 관경) ──────────
// spec.bore1(주배관) · spec.bore2(분기)의 실제 외경으로 주배관·분기 노즐 지름을 그린다.
function buildTee(spec) {
  const g = new THREE.Group();
  const bodyMat = MAT(spec.color, 0.4, 0.8);
  const beadMat = MAT(shade(spec.color, 0.82), 0.5, 0.7);
  const b1 = spec.bore1 || '100A';
  const b2 = spec.bore2 || b1;
  const r1 = boreOd(b1) / 2;
  const r2 = boreOd(b2) / 2;
  // KS B 1522 / ASME B16.9 — 중심~끝 C에서 본관 전체 길이 2C, 분기 길이는 M(이경 티).
  const dims = teeDims(b1, b2);
  const L = dims.L;             // 주배관 길이 = 2C
  const branchH = dims.M;       // 분기 길이 = M (동경 티는 C)
  // s는 면간폭 w를 본관 길이 L로 나눈 값 — 직진 양 끝면이 정확히 ±w/2에 앉는다.
  const s = Math.max(0.05, spec.w) / L;

  // 분기 방향 — 본관(로컬 X) 축 둘레로 위·아래·앞·뒤 (기본 위)
  const B = teeBranch(spec);
  const end = [B[0] * branchH, B[1] * branchH, B[2] * branchH];

  add(g, cyl(r1, L, 24), bodyMat, 0, 0, 0, 0, 0, Math.PI / 2); // 주배관 (1차)
  add(g, sphere(r1 * 1.1, 20), bodyMat, 0, 0, 0); // 분기 목
  addTube(g, [0, 0, 0], end, r2, bodyMat, 22);   // 분기관 (2차) — 이경이면 실제 외경으로
  if (isForged(spec)) {
    // 단조형 — 분기·양단 모두 소켓 보스 (플랜지 원판 없음)
    socketBoss(g, [-L / 2, 0, 0], [-1, 0, 0], r1, bodyMat, beadMat);
    socketBoss(g, [L / 2, 0, 0], [1, 0, 0], r1, bodyMat, beadMat);
    socketBoss(g, end, B, r2, bodyMat, beadMat);
  } else {
    // 분기 플랜지 — 분기 축에 수직인 얇은 원판. 바깥면이 분기 접합면(포트)과 일치한다.
    addTube(g, [end[0] - B[0] * 0.022, end[1] - B[1] * 0.022, end[2] - B[2] * 0.022],
      [end[0], end[1], end[2]], r2 * 1.4, bodyMat, 24);
    // (용접 비드·보강 링은 v68에서 모두 제거 — 사용자: "용접표시 다 없어도 돼")
  }

  g.scale.set(s, s, s);
  return g;
}

// ── 레듀샤 (이경관 · 1차 관경 → 2차 관경 원뿔) ───────────
// 100A→50A처럼 양단 지름이 실제로 다르게 그려진다. 1차는 −X, 2차는 +X.
function buildReducer(spec) {
  const g = new THREE.Group();
  const bodyMat = MAT(spec.color, 0.4, 0.8);
  const steel = MAT('#9aa3ab', 0.35, 0.85);
  const beadMat = MAT(shade(spec.color, 0.82), 0.5, 0.7);
  const b1 = spec.bore1 || '100A';
  const b2 = spec.bore2 || '50A';
  const r1 = boreOd(b1) / 2;
  const r2 = boreOd(b2) / 2;
  // KS B 1522 / ASME B16.9 — 큰 관경 기준 전체 길이 H가 곧 곰 혼 길이.
  const L = reducerDims(b1, b2).H;
  // 면간거리 w가 곰 혼의 길이 그대로 — 양 끝면이 ±w/2에 0mm로 앉아야
  // 플랜지·노즐 위에 바로 이어 놓았을 때 뜨지 않는다(2026-11-25 `31595`).
  const s = Math.max(0.05, spec.w) / L;

  // 매끈한 테이퍼 곰 혼 — 양떼의 링·용접 칼라는 그리지 않는다(2026-11-25 "레듀샤 양쪽에 링같은건 뭐야").
  add(g, cyl2(r1, r2, L, 28), bodyMat, 0, 0, 0, 0, 0, Math.PI / 2);
  if (isForged(spec)) {
    // 단조형 — 소켓웰드·나사식은 양 끝에 육각 소켓 부스가 있어야 한다(플랜지 판 없음).
    socketBoss(g, [-L / 2, 0, 0], [-1, 0, 0], r1, bodyMat, beadMat, { collar: 1.24, hex: 1.34, neck: 1.06 });
    socketBoss(g, [L / 2, 0, 0], [1, 0, 0], r2, bodyMat, beadMat, { collar: 1.3, hex: 1.42, neck: 1.08 });
  }

  // 곰 혼 끝면이 그대로 접합면이다 — 따로 칼라·링을 더하지 않는다.
  g.scale.set(s, s, s);
  return g;
}

// ── 니쁠 (단니쁠 · 육각 너트부 + 양단 수나사) ────────────
function buildNipple(spec) {
  const g = new THREE.Group();
  const hexMat = MAT(shade(spec.color, 0.95), 0.4, 0.85);
  const steel = MAT('#9aa3ab', 0.35, 0.9);
  const threadMat = MAT('#7d868e', 0.5, 0.75);

  // 중앙 육각 너트부
  add(g, cyl(0.05, 0.05, 6), hexMat, 0, 0, 0, 0, 0, Math.PI / 2);
  add(g, cyl(0.052, 0.008, 6), hexMat, -0.026, 0, 0, 0, 0, Math.PI / 2);
  add(g, cyl(0.052, 0.008, 6), hexMat, 0.026, 0, 0, 0, 0, Math.PI / 2);

  // 양단 수나사 + 나사산 + 끝면
  [-1, 1].forEach((sx) => {
    add(g, cyl(0.03, 0.045, 18), steel, sx * 0.0475, 0, 0, 0, 0, Math.PI / 2);
    for (let i = 0; i < 4; i += 1) {
      add(g, cyl(0.032, 0.005, 18), threadMat, sx * (0.032 + i * 0.012), 0, 0, 0, 0, Math.PI / 2);
    }
    add(g, cyl(0.03, 0.006, 18), threadMat, sx * 0.07, 0, 0, 0, 0, Math.PI / 2);
  });

  g.scale.set(spec.w / 0.146, spec.h / 0.1, spec.d / 0.1);
  return g;
}

// ── 45° 엘보 — 두 다리가 135° 벌어진 곡관 (배관은 45°만 꺾인다) ─────
// 꼭짓점(0,0,0), 다리는 +X 와 (−0.707, +0.707). 곡관 중심은 (T, R).
function buildElbow45(spec) {
  const g = new THREE.Group();
  const dims = elbowDims('elbow45', spec.bore || spec.bore1);
  const { r, R, T, Ls } = dims;
  const bodyMat = MAT(spec.color, 0.4, 0.8);
  const beadMat = MAT(shade(spec.color, 0.82), 0.5, 0.7);
  const A = Math.PI / 4;
  const u = [-Math.SQRT1_2, Math.SQRT1_2];

  const arc = new THREE.Mesh(
    G(`elbow45arc|${R.toFixed(4)}|${r.toFixed(4)}`, () => new THREE.TorusGeometry(R, r, 12, 26, A)), bodyMat);
  arc.rotation.z = -Math.PI * 0.75;   // −135°~−90° 호 → 중심 (T,R) 의 45° 곡관
  arc.position.set(T, R, 0);
  arc.castShadow = true;
  arc.receiveShadow = true;
  g.add(arc);

  addTube(g, [T, 0, 0], [T + Ls, 0, 0], r, bodyMat, 22);
  addTube(g, [T * u[0], T * u[1], 0], [(T + Ls) * u[0], (T + Ls) * u[1], 0], r, bodyMat, 22);

  if (isForged(spec)) {
    socketBoss(g, [T + Ls, 0, 0], [1, 0, 0], r, bodyMat, beadMat);
    socketBoss(g, [(T + Ls) * u[0], (T + Ls) * u[1], 0], [u[0], u[1], 0], r, bodyMat, beadMat);
  }
  // 용접 부위에는 링·비드를 두르지 않는다 — 두 다리 끝면이 그대로 접합면이다.
  return g;
}

// ── 엔드캡 (배관 끝단 마감 · 용접 캡) ─────────────────────
function buildCap(spec) {
  const g = new THREE.Group();
  const bodyMat = MAT(spec.color, 0.4, 0.8);
  const beadMat = MAT(shade(spec.color, 0.82), 0.5, 0.7);
  const r = 0.055;

  add(g, cyl(r, 0.075, 26), bodyMat, -0.02, 0, 0, 0, 0, Math.PI / 2);
  const dome = add(g, sphere(r, 20), bodyMat, 0.018, 0, 0);
  dome.scale.set(0.72, 1, 1);
  if (isForged(spec)) {
    socketBoss(g, [-0.058, 0, 0], [-1, 0, 0], r, bodyMat, beadMat, { collar: 1.3, hex: 1.42, neck: 1.06 });
  } else {
    add(g, cyl(r * 0.7, 0.03, 6), beadMat, -0.075, 0, 0, 0, 0, Math.PI / 2);   // 렌치 자리
  }

  g.scale.set(spec.w / 0.148, spec.h / 0.11, spec.d / 0.11);
  return g;
}

// ── 유니온 (육각 조임 너트 3단 + 소켓 끝단) ─────────────
function buildUnion(spec) {
  const g = new THREE.Group();
  const nutMat = MAT(spec.color, 0.42, 0.82);
  const steel = MAT('#9aa3ab', 0.35, 0.88);
  const dark = MAT('#6f7880', 0.5, 0.7);

  // 중앙 조임 너트 + 양쪽 육각 너트 (3단)
  add(g, cyl(0.05, 0.06, 6), nutMat, 0, 0, 0, 0, 0, Math.PI / 2);
  add(g, cyl(0.043, 0.042, 6), nutMat, -0.047, 0, 0, 0, 0, Math.PI / 2);
  add(g, cyl(0.043, 0.042, 6), nutMat, 0.047, 0, 0, 0, 0, Math.PI / 2);
  // 소켓(테이퍼) 끝단 + 틈새 링
  [-1, 1].forEach((sx) => {
    add(g, cyl2(0.036, 0.03, 0.05, 20), steel, sx * 0.078, 0, 0, 0, 0, Math.PI / 2);
    add(g, cyl(0.038, 0.006, 20), dark, sx * 0.052, 0, 0, 0, 0, Math.PI / 2);
  });

  g.scale.set(spec.w / 0.206, spec.h / 0.1, spec.d / 0.1);
  return g;
}

// ── 유량계 (플랜지 바디 + 상부 트랜스미터 헤드) ──────────
function buildFlow(spec) {
  const g = new THREE.Group();
  const bodyMat = MAT(spec.color, 0.38, 0.75);
  const steel = MAT('#9aa3ab', 0.35, 0.85);
  const dark = MAT('#2c3238', 0.6, 0.5);
  const face = MAT('#e9f2f7', 0.35, 0.15);

  // 계기 바디 (흐름 X) + 양단 접합부
  add(g, cyl(0.06, 0.18, 24), bodyMat, 0, 0, 0, 0, 0, Math.PI / 2);
  const forged = isForged(spec);
  [-1, 1].forEach((sx) => {
    if (forged) {
      socketBoss(g, [sx * 0.1, 0, 0], [sx, 0, 0], 0.06, bodyMat, steel, { collar: 1.3, hex: 1.42, neck: 1.05 });
      return;
    }
    equipFlangeSide(g, spec, sx, { defW: 0.24, defH: 0.42, defD: 0.24, bodyEnd: 0.09, neckR: 0.06, mat: steel });
  });
  // 상부 스템 · 트랜스미터 헤드 · 표시창
  add(g, cyl(0.035, 0.1, 18), steel, 0, 0.11, 0);
  add(g, cyl(0.055, 0.03, 20), steel, 0, 0.17, 0);
  add(g, cyl(0.082, 0.16, 24), bodyMat, 0, 0.27, 0);
  add(g, cyl(0.086, 0.02, 24), dark, 0, 0.36, 0);
  add(g, box(0.13, 0.08, 0.012), face, 0, 0.28, 0.083);
  add(g, box(0.05, 0.012, 0.014), dark, 0, 0.245, 0.086);
  add(g, cyl(0.014, 0.05, 10), dark, -0.04, 0.4, 0);

  g.scale.set(spec.w / 0.24, spec.h / 0.42, spec.d / 0.24);
  return g;
}

// ── 플랜지 (볼트 구멍 뚫린 링 판) ─────────────────────────────
// 두께는 store의 KS 10K 표(flangeTh) 그대로 — 접합면(±w/2)이 곧 판의 앞뒤 면이다.
// 그래서 이 플랜지 위에 엘보·파이프를 올리면 0mm로 딸 붙는다(2026-11-25 `31589`).
function buildFlange(spec) {
  const g = new THREE.Group();
  const bore = spec.bore || SIZE_REF_BORE;
  const R = Math.max(0.02, (Number(spec.h) || flangeOd(bore)) / 2);
  const T = Math.max(0.008, Number(spec.w) || flangeTh(bore));
  const boreR = Math.min(R * 0.78, boreOd(bore) / 2 * 1.03);
  // 판은 로컬 X축(유로 축)으로 세운다 — 부속 자세(equipBasis)가 이 축을 돌린다.
  flangeMesh(g, new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0), R, boreR, T, MAT(spec.color, 0.45, 0.8), bore);
  return g;
}

// ── 파이프 서포트 (베이스 플레이트 + 지주 + 새들 + U볼트) ─────────────────
function buildSupport(spec) {
  const g = new THREE.Group();
  const postMat = MAT(spec.color, 0.55, 0.6);
  const plateMat = MAT(shade(spec.color, 0.8), 0.6, 0.55);
  const boltMat = MAT('#3f474e', 0.5, 0.85);
  const H = 0.7;

  // 바닥 베이스 플레이트 + 앙커 볼트
  add(g, box(0.34, 0.028, 0.26), plateMat, 0, 0.014, 0);
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => {
    add(g, cyl(0.013, 0.032, 8), boltMat, sx * 0.135, 0.03, sz * 0.09);
  });

  // 수직 지주 + 보강 브레이스
  add(g, box(0.075, H, 0.075), postMat, 0, 0.028 + H / 2, 0);
  [0.34, 0.62].forEach((f) => {
    const y = 0.028 + H * f;
    add(g, box(0.19, 0.02, 0.022), postMat, 0, y, 0);
    [-1, 1].forEach((sx) => addTube(g, [sx * 0.095, y, 0], [sx * 0.02, y - 0.1, 0], 0.011, postMat, 8));
  });

  // 상부 새들 받침 + U볼트
  add(g, box(0.17, 0.03, 0.18), plateMat, 0, 0.028 + H + 0.015, 0);
  add(g, cyl(0.075, 0.13, 20), plateMat, 0, 0.028 + H + 0.05, 0, 0, 0, Math.PI / 2);
  [-1, 1].forEach((sx) => {
    [-1, 1].forEach((sz) => {
      addTube(g, [sx * 0.06, 0.028 + H + 0.02, sz * 0.075], [sx * 0.06, 0.028 + H + 0.12, sz * 0.075], 0.009, boltMat, 8);
    });
  });

  g.scale.set(spec.w / 0.5, spec.h / 0.85, spec.d / 0.4);
  return g;
}

// ── 압력계·온도계 (원형 다이얼 + 꽂히는 니쁠) ────────────────────────────────
// 로컬 규약 — 배관에 꽂히는 방향을 여기 한 곳에서 정한다(store.js attachGaugeToPipe와 짝):
//  · 원점(0,0,0) = 배관 외벽에 닿는 접합점
//  · −Z = 니쁠이 배관 속으로 들어가는 방향 (니쁠 끝이 벽 안 GAUGE_NIP_PEN만큼 꽂힌다)
//  · +Z = 다이얼이 보는 바깥 방향 (다이얼 중심 z ≈ 0.14) · +Y = 다이얼의 12시
// buildEquipment가 로컬 +Z를 spec.normal(배관 바깥 법선)에 맞추므로, 니쁠은 언제나
// 배관 중심을 향해 직각으로 꽂히고 다이얼은 바깥을 정면으로 본다.
const GAUGE_NIP_LEN = 0.055;   // 외벽 접합점 → 육각 소켓까지 니쁠 길이(m)
const GAUGE_NIP_PEN = 0.01;    // 니쁠이 배관 벽 안으로 들어가는 깊이(m)
function buildGauge(spec) {
  const g = new THREE.Group();
  const caseMat = MAT(spec.color, 0.35, 0.55);
  const steel = MAT('#9aa3ab', 0.35, 0.85);
  const faceMat = MAT('#f2f6fa', 0.5, 0.05);
  const dark = MAT('#1e242a', 0.6, 0.3);

  // 크기 배율 (기본 0.2×0.34×0.16 = 압력계 164mm 다이얼 + 140mm 스탠드오프)
  const sx = Math.max(0.4, (Number(spec.w) || 0.2) / 0.2);
  const sy = Math.max(0.4, (Number(spec.h) || 0.34) / 0.34);
  const sz = Math.max(0.4, (Number(spec.d) || 0.16) / 0.16);

  // 니쁠 — 벽을 뚫고 들어가는 깊이는 배율과 상관없이 항상 10mm로 맞춘다.
  const pen = GAUGE_NIP_PEN / sz;
  const nipLen = GAUGE_NIP_LEN + pen;
  add(g, cyl(0.011, nipLen, 14), steel, 0, 0, (GAUGE_NIP_LEN - pen) / 2, Math.PI / 2, 0, 0);
  // 육각 소켓 + 목
  add(g, cyl(0.021, 0.026, 6), steel, 0, 0, GAUGE_NIP_LEN + 0.013, Math.PI / 2, 0, 0);
  add(g, cyl(0.013, 0.03, 14), steel, 0, 0, GAUGE_NIP_LEN + 0.041, Math.PI / 2, 0, 0);
  // 다이얼 케이스 (면이 +Z 바깥을 본다)
  add(g, cyl(0.082, 0.03, 30), caseMat, 0, 0, 0.14, Math.PI / 2, 0, 0);
  add(g, torus(0.084, 0.01), steel, 0, 0, 0.156, 0, 0, 0);
  add(g, cyl(0.072, 0.006, 30), faceMat, 0, 0, 0.158, Math.PI / 2, 0, 0);
  add(g, cyl(0.05, 0.003, 26), MAT('#dfe7ee', 0.6, 0.05), 0, 0, 0.161, Math.PI / 2, 0, 0);
  // 바늘 · 중심 핀
  add(g, box(0.055, 0.006, 0.003), dark, 0.01, 0, 0.164, 0, 0, -0.5);
  add(g, cyl(0.008, 0.01, 10), dark, 0, 0, 0.166, Math.PI / 2, 0, 0);

  g.scale.set(sx, sy, sz);
  g.userData.nipple = { len: GAUGE_NIP_LEN, pen: GAUGE_NIP_PEN };   // 검증용
  return g;
}

// ── 배관 (파이프 + 엘보 조인트 + 플랜지) ─────────────────────────────────────
// 배관을 이으면 그 접합면에 배관 쪽 플랜지 한 장이 맞물리는 부속 — 실물에서 볼트 플랜지로
// 체결하는 밸브·신축관·유량계. (엘보·티·레듀샤는 용접, 장비는 제 노즐 플랜지가 있다)
// (v64) 'flange' 부속은 제 몸이 이미 플랜지 원판+볼트라 여기서 뺐다 —
//       넣어 두면 배관이 이어질 때 매끈한 원판이 한 장 더 덧대어져 튀어나와 보였다.
// (v67) FLANGE_MATE_TYPES는 store.js로 옮겼다 — 손 그리기 접합면(flangedPorts)과 같은 목록을 쓴다.

// 부속의 유로 축 — 배관이 이 축으로 빠져나가는 면이 접합면이다(본체 옆면·위는 다른 자리).
// (buildPipe 안에서 쓴다) 3축 회전(yaw·pitch)까지 반영한 실제 축을 돌려준다.
function flowAxis(e) {
  return equipFlowAxis(e);
}

// ── (v69) 자동 맞물림 플랜지는 그리지 않는다 ─────────────────────────────────
// 사용자 지시(2026-11-26): "자동으로 플렌지 붙는거 빼버려 따로 선택도 안돼서 지우지도
// 못하고 다 갖다 붙여버리네 벨브에 플렌지를 썼으면 다음은 플렌지가 없어야지
// 벨브자체에 플렌지가 있으니까 자동으로 붙이는건 빼자 너무 지저분이 났다"
//  → 밸브↔엘보·티·레듀샤 직결판(buildMateFlanges)과 배관 끝 맞물림 판을 없앴다.
//    플랜지는 사용자가 직접 놓은 `플랜지` 부속만 그린다(선택·삭제 가능).
//
// ── (v70) 배관 끝 자동 플랜지까지 완전 제거 — 연결 방식 3단계 ────────────────
// 사용자 제안(2026-11-26): "연결 선택에 플렌지, 단조 이렇게 있는데 선택안함을 기본으로 두면 어때?"
//  · 'none'   (선택안함 · 기본값) — 배관 양 끝에 아무것도 그리지 않는 매끈한 배관(맞대기 용접형).
//  · 'flange' (플랜지)           — 사용자가 직접 고른 경우에만 배관 끝에 플랜지 원판.
//  · 'forged' (단조)             — 사용자가 직접 고른 경우에만 소켓 보스(소켓웰드·나사식).
// 예전 `32072` 캡처처럼 펌프 노즐·엘보 양쪽·열린 배관 끝마다 선택·삭제도 안 되는 판이
// 자동으로 붙던 것을 없앤다.

export function buildPipe(spec, equipments, pipes) {
  const g = new THREE.Group();
  const m = MATERIALS[spec.material] || MATERIALS.carbon;
  const bore = BORES[spec.bore] || BORES['100A'];
  const r = bore.od / 2 + (m.jacket || 0);
  // 사진에서 읽은 관 색(적색 방청관·은색 아연도)이 있으면 재질색 대신 입힌다.
  const mat = MAT(spec.color || m.color, m.roughness, m.metalness);
  const flangeMat = MAT('#6a737b', 0.55, 0.7);

  const pts = (spec.points || []).map((p) => new THREE.Vector3(p.x, p.y, p.z));
  const up = new THREE.Vector3(0, 1, 0);
  const unit = G(`ucyl|${r.toFixed(4)}`, () => new THREE.CylinderGeometry(r, r, 1, 18));
  const forged = isForged(spec);

  const joints = equipments || [];
  // 연결 방식 — 'none'(기본) / 'flange'(직접 고름) / 'forged'(직접 고름).
  const connMode = spec.conn === 'forged' ? 'forged' : (spec.conn === 'none' ? 'none' : 'flange');
  // 배관 끝이 부속(엘보·밸브·플랜지 등)이나 장비 노즐 끝과 만나는 자리면 플랜지를 그리지 않는다 —
  // 용접 이음으로 보이게(노즐 플랜지 바로 앞에 판이 하나 더 생기는 것을 막는다).
  // 부속 **중심**에서 뭉뚱그려 재면 200A 엘보(면까지 0.305m)처럼 큰 부속을 놓치므로
  // 접합면 좌표(equipConnectFaces)·노즐 끝 좌표로 직접 확인한다 (2026-11-26 `32072`).
  const jointAt = (p) => joints.some((e) => {
    const near = (q) => Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z) < 0.09;
    if (equipNozzles(e).some((n) => near(n.tip))) return true;
    if (equipConnectFaces(e).some((f) => near(f.tip))) return true;
    return Math.hypot((e.x || 0) - p.x, (e.y || 0) - p.y, (e.z || 0) - p.z) < 0.28;
  });

  // 이 배관 끝이 플랜지식 부속(밸브·스트레이너·유량계)의 접합면에 닿았는가.
  //  · v69부터 이 자리에 배관 쪽 판을 '자동으로' 더 그리지 않는다 — 부속 자체에 플랜지가
  //    있으니 다음에 또 판이 붙으면 지저분하다(2026-11-26 사용자 지시). 그 자리에 판이
  //    필요하면 사용자가 `플랜지` 부속을 직접 놓는다(선택·삭제 가능).
  // 단조형(소켓웰드·나사식) 부속은 플랜지가 없으므로 그대로 용접 이음으로 둔다.
  // 부속의 유로 축 — 모듈 수준 flowAxis()를 그대로 쓴다.
  const mateJoint = (p) => {
    for (const e of joints) {
      if (!FLANGE_MATE_TYPES.has(e.type)) continue;
      if ((e.conn || 'flange') === 'forged') continue;
      const dx = p.x - (e.x || 0), dy = p.y - (e.y || 0), dz = p.z - (e.z || 0);
      const half = Math.abs(Number(e.w) || 0) / 2;
      if (!(half > 0)) continue;
      const ax = flowAxis(e);
      const axial = dx * ax.x + dy * ax.y + dz * ax.z;          // 유로 축 방향 거리
      const lx = dx - ax.x * axial, ly = dy - ax.y * axial, lz = dz - ax.z * axial;
      const lateral = Math.hypot(lx, ly, lz);                    // 축에서 벗어난 거리
      // 면간거리(w/2)에 닿은 접합면인가 — 배관이 살짝 물려 있어 ±60mm 허용, 옆으로는 50mm 안
      if (Math.abs(Math.abs(axial) - half) > 0.06) continue;
      if (lateral > 0.05) continue;
      return e;
    }
    return null;
  };
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1];
    const b = pts[i];
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    if (len < 1e-4) continue;
    const pipe = new THREE.Mesh(unit, mat);
    pipe.scale.y = len;
    pipe.position.copy(a).add(b).multiplyScalar(0.5);
    pipe.quaternion.setFromUnitVectors(up, dir.clone().normalize());
    pipe.castShadow = true;
    pipe.receiveShadow = true;
    g.add(pipe);

    // 배관 끝 접합 — 순서대로 판단한다:
    //  · '선택안함'(기본)이면 **아무것도 그리지 않는다** — 매끈한 맞대기 용접형 배관.
    //  · 다른 배관 끝과 맞닿았으면 용접 비드만(이음선). 플랜지식 부속·장비 노즐이면
    //    아무 판도 그리지 않고(부속 자체 판), '플랜지'를 직접 골랐을 때만 배관 끝 플랜지.
    const endBoss = (p, out, radius) => {
      if (connMode === 'none') return;
      if (connMode === 'forged') socketBoss(g, [p.x, p.y, p.z], [out.x, out.y, out.z], radius, mat, flangeMat, { collar: 1.42, hex: 1.56 });
      // 배관 끝 플랜지 — 두께 KS 10K 표. 접합면(p)이 곧 판 앞뒤의 중심값이다.
      else addFlange(g, p, out, radius, flangeMat, flangeOd(spec.bore) / 2, flangeTh(spec.bore) || FLANGE_PIPE_T, spec.bore);
    };
    // 같은 배관끼리 맞닿은 끝 — 다른 배관의 끝점과 거의 같은 자리인가 (다른 배관은 넘겨받은 목록).
    // 같은 관경·같은 방향으로 이어진 직선 이음이므로 플랜지 원판 대신 용접 비드만 두른다.
    const others = Array.isArray(pipes) ? pipes : [];
    const pipeEndAt = (p) => others.some((op) => op && op.id !== spec.id
      && (op.points || []).some((q) => Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z) < 0.05));
    // 용접 비드 — 매끈한 이음. (2026-11-25 사용자: "용접표시 다 없어도 돼" — 이제 그리지 않는다)
    const weldBead = () => {};
    const endJoint = (p, out, inward) => {
      if (connMode === 'none') return;   // 선택안함 — 배관 끝에 아무것도 그리지 않는다
      if (mateJoint(p)) return;   // 부속 자체 플랜지가 있으니 배관 쪽 판은 그리지 않는다
      if (pipeEndAt(p)) { weldBead(p, out); return; }   // 배관↔배관 직선 이음 — 매끈하게
      if (!jointAt(p)) endBoss(p, out, r);
    };
    if (i === 1) endJoint(a, dir.clone().negate(), dir.clone().normalize());
    if (i === pts.length - 1) endJoint(b, dir, dir.clone().normalize().negate());
  }

  // 엘보 조인트 (구관 — 엘보 부속을 안 놓은 꼭짓점만. 엘보 관 안에 잠기도록 배관과 같은 반지름)
  for (let i = 1; i < pts.length - 1; i += 1) {
    const s = new THREE.Mesh(G(`sphere|${(r * 1.02).toFixed(4)}`, () => new THREE.SphereGeometry(r * 1.02, 18, 12)), mat);
    s.position.copy(pts[i]);
    s.castShadow = true;
    s.receiveShadow = true;
    g.add(s);
  }

  g.userData.pick = { kind: 'pipe', id: spec.id };
  g.userData.spec = spec;
  return g;
}

function addFlange(g, pos, dir, r, material, outer, thick, bore) {
  // outer를 주면 그 반지름으로(맞대는 플랜지와 같은 외경), 없으면 배관 외경의 1.9배.
  // 판 가운데에 배관이 지나가는 내경을 뚫어 두고, PCD 원주에 볼트 구멍을 낸다.
  const R = outer || r * 1.9;
  const T = thick || FLANGE_PIPE_T;
  flangeMesh(g, pos, dir, R, r * 1.03, T, material, bore);
}

// ── 장비 노즐 (목 + 플랜지) ──────────────────────────────
// store.js equipNozzles()가 돌려준 **월드 좌표**(base → tip)를 그대로 쓴다 —
// 속성 패널에서 고른 관경으로 장비 외벽에서 돌출되고, tip(플랜지 면)이 손 그리기 스냅 자리와 똑같다.
// 노즐은 장비 회전·배율이 이미 끝난 좌표라 별도 그룹에 그린다(buildEquipment 참고).
function buildNozzles(spec) {
  const list = equipNozzles(spec);
  if (!list.length) return null;
  const g = new THREE.Group();
  const steel = MAT('#9aa3ab', 0.4, 0.82);
  const ring = MAT('#6f7880', 0.5, 0.8);
  list.forEach((n) => {
    const dir = new THREE.Vector3(n.tip.x - n.base.x, n.tip.y - n.base.y, n.tip.z - n.base.z);
    const len = dir.length();
    if (len < 1e-4) return;
    dir.normalize();
    // 노즐 끝 플랜지 — 얇은 링 판(내경·볼트 구멍). 외경·두께는 **배관 끝 플랜지와 같은
    // KS 10K 표**(flangeOd·flangeTh)를 그대로 쓴다 — 예전에는 노즐 외경의 1.55배(50A
    // 노즐 94mm)라 같은 관경 게이트밸브 판(155mm)보다 훨씬 작아 나란히 보면 크기가 달라
    // 보였다(2026-11-26 `32076` 사용자: "배관 플렌지랑 스트레이너, 벨브, 크기가 다 달라").
    const T = Math.min(flangeTh(n.bore), Math.max(0.008, len * 0.35));
    const at = (t) => [
      n.base.x + dir.x * t, n.base.y + dir.y * t, n.base.z + dir.z * t,
    ];
    // 벽 접합 보강 칼라 → 노즐 목 → 플랜지 판 (판 바깥면 = 끝면 = 스냅 좌표)
    addTube(g, at(0), at(0.012), n.r * 1.26, ring, 20);
    addTube(g, at(0), at(len - T), n.r, steel, 22);
    const c = new THREE.Vector3(...at(len - T / 2));
    flangeMesh(g, c, dir, flangeOd(n.bore) / 2, n.r * 1.03, T, ring, n.bore);
  });
  return g;
}

export function buildEquipment(spec) {
  const build = EQUIP_BUILDERS[spec.type] || buildTank;
  const g = build(spec);
  g.position.set(spec.x, spec.y, spec.z);
  // 자세 — 장비·부속 공통. 회전행렬 하나로 정한다:
  //   · 기본 자세(계기 법선 · 엘보 두 다리 · 진행 방향 dir · 수직 axis:'y' · rot)
  //   · 3축 회전 — 위·아래(pitch, 유로에 수직인 수평축) → 좌·우(yaw, 월드 Y)
  //   · 축 회전(roll) — 유로 축(로컬 +X) 둘레 (밸브·스트레이너는 손잡이만 돈다)
  // store.js equipBasis()는 fusion.js 내보내기와 **같은 함수**라 웹·퓨전360의 자세가 같다.
  const basis = equipBasis(spec);
  g.quaternion.setFromRotationMatrix(new THREE.Matrix4().set(
    basis[0], basis[1], basis[2], 0,
    basis[3], basis[4], basis[5], 0,
    basis[6], basis[7], basis[8], 0,
    0, 0, 0, 1,
  ));
  g.userData.pick = { kind: 'equipment', id: spec.id };
  g.userData.spec = spec;
  // 노즐은 월드 좌표로 그리므로 본체 그룹(회전·배율 적용됨) 밖에 둔다.
  // 둘을 한 그룹으로 묶어 selection·내보내기가 한 장비로 다룰 수 있게 한다.
  const noz = buildNozzles(spec);
  if (!noz) return g;
  const root = new THREE.Group();
  root.add(g);
  root.add(noz);
  root.userData.pick = { kind: 'equipment', id: spec.id };
  root.userData.spec = spec;
  noz.userData.pick = { kind: 'equipment', id: spec.id };
  return root;
}

const EQUIP_BUILDERS = {
  header: buildHeader,
  hx: buildHX,
  pump: buildPump,
  vpump: buildVPump,
  tank: buildTank,
  stank: buildSTank,
  rtank: buildRTank,
  panel: buildPanel,
  valve: buildValve,
  bfly: buildButterfly,
  yvalve: buildYValve,
  ball: buildBall,
  check: buildCheck,
  safety_valve: buildSafetyValve,
  bellows: buildBellows,
  elbow: buildElbow,
  tee: buildTee,
  reducer: buildReducer,
  nipple: buildNipple,
  elbow45: buildElbow45,
  cap: buildCap,
  union: buildUnion,
  flow: buildFlow,
  flange: buildFlange,
  support: buildSupport,
  gauge: buildGauge,
};

export function buildScene(state) {
  const root = new THREE.Group();
  root.name = 'sceneRoot';
  state.equipment.forEach((spec) => root.add(buildEquipment(spec)));
  state.pipes.forEach((spec) => root.add(buildPipe(spec, state.equipment, state.pipes)));
  return root;
}
