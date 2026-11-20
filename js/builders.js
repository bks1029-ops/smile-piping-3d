// 스마일산업 3D 배관 — 3D 오브젝트 빌더
import * as THREE from 'three';
import { BORES, MATERIALS, boreOd, elbowDims, elbowBasis } from './store.js?v=22';

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

// ── 열교환기 (쉘앤튜브 + 새들 지지대) ─────────────────────────────────────────
function buildHX(spec) {
  const g = new THREE.Group();
  const L = Math.max(0.6, spec.w);
  const dia = Math.max(0.2, spec.h);
  const R = dia / 2;
  const legH = Math.max(0.22, Math.min(0.55, dia * 0.62));
  const bodyLen = L * 0.74;
  const cy = legH + R;

  const shellMat = MAT(spec.color, 0.45, 0.72);
  const headMat = MAT(shade(spec.color, 0.82), 0.5, 0.7);
  const saddleMat = MAT('#6f7880', 0.65, 0.45);
  const boltMat = MAT('#4e565d', 0.5, 0.85);

  const shell = add(g, cyl(R, bodyLen, 32), shellMat, 0, cy, 0, 0, 0, Math.PI / 2);

  [-1, 1].forEach((sx) => {
    // 채널 플랜지
    add(g, cyl(R * 1.1, 0.075, 32), boltMat, sx * (bodyLen / 2 + 0.038), cy, 0, 0, 0, Math.PI / 2);
    // 볼트 링
    const ring = add(g, torus(R * 1.03, 0.017), boltMat, sx * (bodyLen / 2 + 0.078), cy, 0, 0, Math.PI / 2, 0);
    // 채널 헤드
    add(g, cyl2(R * 0.88, R * 0.6, 0.18, 28), headMat, sx * (bodyLen / 2 + 0.16), cy, 0, 0, 0, Math.PI / 2);
    // 헤드 캡
    add(g, cyl(R * 0.5, 0.05, 20), headMat, sx * (bodyLen / 2 + 0.27), cy, 0, 0, 0, Math.PI / 2);
  });

  // 상부 노즐 + 플랜지
  [-L * 0.24, L * 0.24].forEach((nx) => {
    add(g, cyl(R * 0.3, 0.3, 20), shellMat, nx, legH + dia + 0.15, 0);
    add(g, cyl(R * 0.42, 0.045, 24), boltMat, nx, legH + dia + 0.31, 0);
  });
  // 하부 드레인 노즐
  add(g, cyl(R * 0.18, 0.18, 16), shellMat, L * 0.1, legH + 0.03, 0);

  // 새들 지지대
  [-L * 0.27, L * 0.27].forEach((sx) => {
    add(g, box(0.14, legH, dia * 1.04), saddleMat, sx, legH / 2, 0);
    add(g, box(0.5, 0.06, dia * 1.22), saddleMat, sx, 0.03, 0);
  });

  // 명판
  add(g, box(Math.min(0.55, L * 0.18), 0.16, 0.02), MAT('#e4ebf1', 0.4, 0.3), 0, cy + R * 0.15, R + 0.011);
  // 리프팅 러그
  add(g, box(0.05, 0.16, 0.16), saddleMat, -L * 0.34, cy + R + 0.02, 0);
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
  // 흡입 노즐 + 플랜지
  add(g, cyl(0.11, 0.18, 20), blue, 0.12, 0.42, 0.27, Math.PI / 2, 0, 0);
  add(g, cyl(0.15, 0.04, 20), steel, 0.12, 0.42, 0.37, Math.PI / 2, 0, 0);
  // 토출 노즐 + 플랜지
  add(g, cyl(0.085, 0.24, 20), blue, 0.12, 0.61, 0);
  add(g, torus(0.125, 0.012), steel, 0.12, 0.73, 0, Math.PI / 2, 0, 0);
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
  add(g, cyl(r * 0.12, 0.06, 16), rimMat, r * 0.5, h + 0.02, 0);
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
  // 양쪽 플랜지
  [-1, 1].forEach((sx) => {
    add(g, cyl(0.13, 0.045, 24), bodyMat, sx * 0.095, 0, 0, 0, 0, Math.PI / 2);
    add(g, torus(0.135, 0.012), darkMat, sx * 0.12, 0, 0, 0, Math.PI / 2, 0);
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

  // 맨홀 · 상부 노즐
  add(g, cyl(0.2, 0.12, 20), headMat, 0, shellTop + 0.36, 0);
  add(g, cyl(0.28, 0.035, 24), steel, 0, shellTop + 0.43, 0);
  add(g, cyl(0.07, 0.16, 16), steel, 0.4, shellTop + 0.39, 0);

  // 측면 노즐 (출구·입구) + 플랜지
  [0.95, 2.15].forEach((y) => {
    add(g, cyl(0.07, 0.24, 18), steel, R + 0.08, y, 0, 0, 0, Math.PI / 2);
    add(g, cyl(0.1, 0.03, 20), steel, R + 0.21, y, 0, 0, 0, Math.PI / 2);
  });

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

  // 측면 노즐 2개 + 플랜지
  add(g, cyl(0.075, 0.24, 18), steel, -W / 2 - 0.1, 0.95, 0, 0, 0, Math.PI / 2);
  add(g, cyl(0.105, 0.03, 20), steel, -W / 2 - 0.23, 0.95, 0, 0, 0, Math.PI / 2);
  add(g, cyl(0.06, 0.2, 16), steel, W / 2 + 0.08, 1.35, 0, 0, 0, Math.PI / 2);
  // 바닥 배수 밸브
  add(g, cyl(0.05, 0.16, 14), steel, 0, 0.28, Dd / 2 + 0.06, Math.PI / 2, 0, 0);
  add(g, torus(0.06, 0.012), dark, 0, 0.28, Dd / 2 + 0.14, 0, 0, 0);

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

  // 흉입(하부) 플랜지
  add(g, cyl(0.155, 0.03, 26), steel, 0, 0.115, 0);
  add(g, cyl(0.1, 0.05, 20), steel, 0, 0.155, 0);

  // 볼류트 케이싱 + 볼트 이어
  add(g, cyl(0.15, 0.2, 28), bodyMat, 0, 0.28, 0);
  add(g, torus(0.152, 0.016), bodyMat, 0, 0.28, 0, Math.PI / 2, 0, 0);
  for (let i = 0; i < 6; i += 1) {
    const a = (Math.PI * 2 * i) / 6;
    add(g, cyl(0.017, 0.035, 8), steel, Math.cos(a) * 0.138, 0.385, Math.sin(a) * 0.138);
  }

  // 토출(상부) 플랜지
  add(g, cyl(0.155, 0.03, 26), steel, 0, 0.415, 0);

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
  // 양단 볼트 플랜지 + 볼트
  [-1, 1].forEach((sx) => {
    add(g, cyl(0.165, 0.028, 30), bodyMat, sx * 0.062, 0, 0, 0, 0, Math.PI / 2);
    for (let i = 0; i < 8; i += 1) {
      const a = (Math.PI * 2 * i) / 8;
      add(g, cyl(0.011, 0.05, 8), steel, sx * 0.062, Math.cos(a) * 0.148, Math.sin(a) * 0.148, 0, 0, Math.PI / 2);
    }
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

// ── 경사형(Y자) 체크·스트레이너 밸브 (Y형 바디 + 상하 플랜지 + 핸드휠) ────────
function buildYValve(spec) {
  const g = new THREE.Group();
  const bodyMat = MAT(spec.color, 0.42, 0.6);
  const steel = MAT('#9aa3ab', 0.35, 0.85);
  const dark = MAT('#2c3238', 0.65, 0.5);

  // 본체 (흐름 X)
  add(g, cyl(0.085, 0.22, 24), bodyMat, 0, 0, 0, 0, 0, Math.PI / 2);
  // 양단 플랜지
  [-1, 1].forEach((sx) => {
    add(g, cyl(0.135, 0.03, 26), bodyMat, sx * 0.12, 0, 0, 0, 0, Math.PI / 2);
    add(g, torus(0.14, 0.011), steel, sx * 0.137, 0, 0, 0, Math.PI / 2, 0);
  });
  // Y자 경사 분기 (아래·뒤 45°) + 끝 캡
  addTube(g, [0, 0, 0], [-0.02, -0.19, -0.15], 0.062, bodyMat, 20);
  addTube(g, [-0.019, -0.175, -0.138], [-0.024, -0.228, -0.18], 0.082, steel, 20);
  // 보닛 · 스템 · 핸드휠
  add(g, cyl(0.058, 0.07, 18), bodyMat, 0, 0.1, 0);
  add(g, cyl(0.013, 0.15, 10), steel, 0, 0.21, 0);
  add(g, torus(0.11, 0.014), dark, 0, 0.27, 0, Math.PI / 2, 0, 0);
  for (let i = 0; i < 3; i += 1) add(g, box(0.22, 0.011, 0.02), dark, 0, 0.27, 0, 0, (Math.PI / 3) * i, 0);
  add(g, cyl(0.024, 0.04, 12), dark, 0, 0.275, 0);

  g.scale.set(spec.w / 0.296, spec.h / 0.5, spec.d / 0.34);
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
  [-1, 1].forEach((sx) => add(g, cyl(0.085, 0.024, 22), steel, sx * 0.105, 0, 0, 0, 0, Math.PI / 2));
  add(g, cyl(0.03, 0.04, 14), bodyMat, 0, 0.075, 0);
  add(g, cyl(0.024, 0.06, 12), steel, 0, 0.11, 0);
  add(g, box(0.19, 0.02, 0.024), dark, 0.035, 0.145, 0);
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
  [-1, 1].forEach((sx) => add(g, cyl(0.115, 0.018, 26), steel, sx * 0.045, 0, 0, 0, 0, Math.PI / 2));
  add(g, box(0.1, 0.045, 0.06), bodyMat, 0, 0.105, 0);
  add(g, cyl(0.011, 0.05, 8), steel, 0, 0.14, 0);
  add(g, cyl(0.02, 0.014, 10), dark, 0, 0.165, 0);

  g.scale.set(spec.w / 0.108, spec.h / 0.26, spec.d / 0.22);
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

  // 양단 플랜지
  [-1, 1].forEach((sx) => {
    add(g, cyl(0.15, 0.032, 28), steel, sx * (len / 2 + 0.016), 0, 0, 0, 0, Math.PI / 2);
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

  // 접합면 용접 비드
  add(g, torus(r * 1.02, r * 0.1), beadMat, R + Ls, 0, 0, 0, Math.PI / 2, 0);
  add(g, torus(r * 1.02, r * 0.1), beadMat, 0, R + Ls, 0, Math.PI / 2, 0, 0);

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
  const L = Math.max(0.22, 2.6 * r1 * 2); // 주배관 길이
  const branchH = Math.max(0.1, L * 0.5);
  const s = Math.max(0.05, spec.w) / (L + 0.03);

  add(g, cyl(r1, L, 24), bodyMat, 0, 0, 0, 0, 0, Math.PI / 2); // 주배관 (1차)
  add(g, sphere(r1 * 1.1, 20), bodyMat, 0, 0, 0); // 분기 목
  add(g, cyl(r2, branchH, 22), bodyMat, 0, branchH / 2, 0); // 분기관 (2차)
  add(g, cyl(r2 * 1.4, 0.022, 22), bodyMat, 0, branchH, 0); // 분기 플랜지
  add(g, torus(r1 * 1.03, 0.006), beadMat, L / 2, 0, 0, 0, Math.PI / 2, 0);
  add(g, torus(r1 * 1.03, 0.006), beadMat, -L / 2, 0, 0, 0, Math.PI / 2, 0);
  add(g, torus(r2 * 1.04, 0.006), beadMat, 0, branchH - 0.014, 0, Math.PI / 2, 0, 0);

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
  const L = Math.max(0.1, 0.12 + 0.6 * Math.abs(r1 - r2) * 2);
  const FT = 0.024;
  const s = Math.max(0.05, spec.w) / (L + FT * 2);

  add(g, cyl2(r1, r2, L, 28), bodyMat, 0, 0, 0, 0, 0, Math.PI / 2);
  add(g, cyl(r1 * 1.22, FT, 28), steel, -(L / 2 + FT / 2), 0, 0, 0, 0, Math.PI / 2);
  add(g, cyl(r2 * 1.35, FT, 26), steel, L / 2 + FT / 2, 0, 0, 0, 0, Math.PI / 2);
  add(g, torus(r1 * 1.05, 0.005), beadMat, -(L / 2 - 0.012), 0, 0, 0, Math.PI / 2, 0);
  add(g, torus(r2 * 1.06, 0.005), beadMat, L / 2 - 0.012, 0, 0, 0, Math.PI / 2, 0);

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

  add(g, torus(r * 1.02, r * 0.1), beadMat, T + Ls, 0, 0, 0, Math.PI / 2, 0);
  const bead = new THREE.Mesh(torus(r * 1.02, r * 0.1), beadMat);
  bead.position.set((T + Ls) * u[0], (T + Ls) * u[1], 0);
  bead.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(u[0], u[1], 0));
  bead.castShadow = true;
  g.add(bead);

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
  add(g, torus(r * 1.06, 0.007), beadMat, -0.055, 0, 0, 0, Math.PI / 2, 0);
  add(g, cyl(r * 0.7, 0.03, 6), beadMat, -0.075, 0, 0, 0, 0, Math.PI / 2); // 렌치 자리

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

  // 계기 바디 (흐름 X) + 양단 플랜지·볼트
  add(g, cyl(0.06, 0.18, 24), bodyMat, 0, 0, 0, 0, 0, Math.PI / 2);
  [-1, 1].forEach((sx) => {
    add(g, cyl(0.1, 0.032, 28), steel, sx * 0.104, 0, 0, 0, 0, Math.PI / 2);
    for (let i = 0; i < 6; i += 1) {
      const a = (Math.PI * 2 * i) / 6;
      add(g, cyl(0.011, 0.06, 8), dark, sx * 0.104, Math.cos(a) * 0.082, Math.sin(a) * 0.082, 0, 0, Math.PI / 2);
    }
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

// ── 플랜지 (볼트링 원판) ─────────────────────────────
function buildFlange(spec) {
  const g = new THREE.Group();
  const bodyMat = MAT(spec.color, 0.45, 0.8);
  const boltMat = MAT('#3f474e', 0.5, 0.85);

  add(g, cyl(0.12, 0.045, 32), bodyMat, 0, 0, 0, 0, 0, Math.PI / 2);
  for (let i = 0; i < 8; i += 1) {
    const a = (Math.PI * 2 * i) / 8;
    add(g, cyl(0.014, 0.06, 8), boltMat, 0, Math.cos(a) * 0.093, Math.sin(a) * 0.093, 0, 0, Math.PI / 2);
  }
  add(g, cyl(0.05, 0.05, 22), MAT('#2a3138', 0.7, 0.4), 0, 0, 0, 0, 0, Math.PI / 2);

  g.scale.set(spec.w / 0.06, spec.h / 0.26, spec.d / 0.26);
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

// ── 엽력계·온도계 (원형 다이얼 + 스템) ─────────────
function buildGauge(spec) {
  const g = new THREE.Group();
  const caseMat = MAT(spec.color, 0.35, 0.55);
  const steel = MAT('#9aa3ab', 0.35, 0.85);
  const faceMat = MAT('#f2f6fa', 0.5, 0.05);
  const dark = MAT('#1e242a', 0.6, 0.3);

  // 스템 · 육각 소켓
  add(g, cyl(0.012, 0.1, 12), steel, 0, 0.05, 0);
  add(g, cyl(0.024, 0.03, 6), steel, 0, 0.115, 0);
  // 다이얼 케이스 (면이 +Z 방향)
  add(g, cyl(0.085, 0.04, 28), caseMat, 0, 0.22, 0, Math.PI / 2, 0, 0);
  add(g, torus(0.085, 0.011), steel, 0, 0.22, 0.002, 0, 0, 0);
  add(g, cyl(0.076, 0.006, 28), faceMat, 0, 0.22, 0.023, Math.PI / 2, 0, 0);
  add(g, cyl(0.055, 0.004, 24), MAT('#dfe7ee', 0.6, 0.05), 0, 0.22, 0.026, Math.PI / 2, 0, 0);
  // 바늘 · 중심 핀
  add(g, box(0.06, 0.007, 0.003), dark, 0.012, 0.225, 0.03, 0, 0, -0.5);
  add(g, cyl(0.008, 0.01, 10), dark, 0, 0.22, 0.03, Math.PI / 2, 0, 0);

  g.scale.set(spec.w / 0.2, spec.h / 0.34, spec.d / 0.16);
  return g;
}

// ── 배관 (파이프 + 엘보 조인트 + 플랜지) ─────────────────────────────────────
export function buildPipe(spec, equipments) {
  const g = new THREE.Group();
  const m = MATERIALS[spec.material] || MATERIALS.carbon;
  const bore = BORES[spec.bore] || BORES['100A'];
  const r = bore.od / 2 + (m.jacket || 0);
  const mat = MAT(m.color, m.roughness, m.metalness);
  const flangeMat = MAT('#6a737b', 0.55, 0.7);

  const pts = (spec.points || []).map((p) => new THREE.Vector3(p.x, p.y, p.z));
  const up = new THREE.Vector3(0, 1, 0);
  const unit = G(`ucyl|${r.toFixed(4)}`, () => new THREE.CylinderGeometry(r, r, 1, 18));

  const joints = equipments || [];
  // 배관 끝이 부속(엘보·밸브·플랜지 등)과 만나는 자리면 플랜지를 그리지 않는다 — 용접 이음으로 보이게.
  const jointAt = (p) => joints.some((e) => Math.hypot((e.x || 0) - p.x, (e.y || 0) - p.y, (e.z || 0) - p.z) < 0.28);

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

    // 구간 끝 플랜지 (부속과 만나는 끝은 생략)
    if (i === 1 && !jointAt(a)) addFlange(g, a, dir, r, flangeMat);
    if (i === pts.length - 1 && !jointAt(b)) addFlange(g, b, dir, r, flangeMat);
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

function addFlange(g, pos, dir, r, material) {
  const f = new THREE.Mesh(G(`fcyl|${(r * 1.8).toFixed(4)}`, () => new THREE.CylinderGeometry(r * 1.8, r * 1.8, 0.04, 22)), material);
  f.position.copy(pos);
  f.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  f.castShadow = true;
  g.add(f);
}

export function buildEquipment(spec) {
  const build = EQUIP_BUILDERS[spec.type] || buildTank;
  const g = build(spec);
  g.position.set(spec.x, spec.y, spec.z);
  const elbowLike = spec.type === 'elbow' || spec.type === 'elbow45';
  if (elbowLike && Array.isArray(spec.inDir) && Array.isArray(spec.outDir)) {
    // 진입·진출 벡터로 두 입구를 배관에 정확히 맞춘다 (XY·YZ·XZ 어느 평면이든)
    const b = elbowBasis(spec.inDir, spec.outDir);
    const m = new THREE.Matrix4().set(
      b[0], b[1], b[2], 0,
      b[3], b[4], b[5], 0,
      b[6], b[7], b[8], 0,
      0, 0, 0, 1,
    );
    g.quaternion.setFromRotationMatrix(m);
  } else {
    g.rotation.y = D(spec.rot);
  }
  g.userData.pick = { kind: 'equipment', id: spec.id };
  g.userData.spec = spec;
  return g;
}

const EQUIP_BUILDERS = {
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
  state.pipes.forEach((spec) => root.add(buildPipe(spec, state.equipment)));
  return root;
}
