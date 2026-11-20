// 스마일산업 3D 배관 — 3D 오브젝트 빌더
import * as THREE from 'three';
import { BORES, MATERIALS } from './store.js';

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

  g.scale.set(spec.w / 0.34, spec.h / 0.58, spec.d / 0.3);
  return g;
}

function shade(hex, factor) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(factor);
  return '#' + c.getHexString();
}

// ── 배관 (파이프 + 엘보 조인트 + 플랜지) ─────────────────────────────────────
export function buildPipe(spec) {
  const g = new THREE.Group();
  const m = MATERIALS[spec.material] || MATERIALS.carbon;
  const bore = BORES[spec.bore] || BORES['100A'];
  const r = bore.od / 2 + (m.jacket || 0);
  const mat = MAT(m.color, m.roughness, m.metalness);
  const flangeMat = MAT('#6a737b', 0.55, 0.7);

  const pts = (spec.points || []).map((p) => new THREE.Vector3(p.x, p.y, p.z));
  const up = new THREE.Vector3(0, 1, 0);
  const unit = G(`ucyl|${r.toFixed(4)}`, () => new THREE.CylinderGeometry(r, r, 1, 18));

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

    // 구간 끝 플랜지
    if (i === 1) addFlange(g, a, dir, r, flangeMat);
    if (i === pts.length - 1) addFlange(g, b, dir, r, flangeMat);
  }

  // 엘보 조인트 (구체)
  for (let i = 1; i < pts.length - 1; i += 1) {
    const s = new THREE.Mesh(G(`sphere|${(r * 1.16).toFixed(4)}`, () => new THREE.SphereGeometry(r * 1.16, 20, 14)), mat);
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
  let g;
  if (spec.type === 'hx') g = buildHX(spec);
  else if (spec.type === 'pump') g = buildPump(spec);
  else if (spec.type === 'panel') g = buildPanel(spec);
  else if (spec.type === 'valve') g = buildValve(spec);
  else g = buildTank(spec);

  g.position.set(spec.x, spec.y, spec.z);
  g.rotation.y = D(spec.rot);
  g.userData.pick = { kind: 'equipment', id: spec.id };
  g.userData.spec = spec;
  return g;
}

export function buildScene(state) {
  const root = new THREE.Group();
  root.name = 'sceneRoot';
  state.equipment.forEach((spec) => root.add(buildEquipment(spec)));
  state.pipes.forEach((spec) => root.add(buildPipe(spec)));
  return root;
}
