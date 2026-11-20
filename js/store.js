// 스마일산업 3D 배관 — 데이터 모델 & 샘플 씬
// 단위: 미터(m). Y축이 높이.

export const BORES = {
  '50A':  { od: 0.0605, mm: 60.5 },
  '80A':  { od: 0.0891, mm: 89.1 },
  '100A': { od: 0.1143, mm: 114.3 },
  '150A': { od: 0.1652, mm: 165.2 },
  '200A': { od: 0.2163, mm: 216.3 },
};

export const MATERIALS = {
  carbon:    { label: '흑관·카본스틸', color: '#3b3f44', roughness: 0.62, metalness: 0.65, jacket: 0.0 },
  sus:       { label: 'SUS 스테인리스', color: '#c8ced4', roughness: 0.32, metalness: 0.88, jacket: 0.0 },
  insulated: { label: '보온배관', color: '#c9b48d', roughness: 0.92, metalness: 0.05, jacket: 0.035 },
};

export const EQUIP_TYPES = {
  hx: {
    label: '열교환기', short: 'HX',
    defaults: { w: 3.0, h: 0.75, d: 0.75 }, color: '#b9bfc6',
  },
  pump: {
    label: '펌프', short: 'PUMP',
    defaults: { w: 1.15, h: 0.85, d: 0.6 }, color: '#1f4f9b',
  },
  tank: {
    label: '탱크/드럼', short: 'TK',
    defaults: { w: 0.6, h: 0.9, d: 0.6 }, color: '#1c4a8a',
  },
  panel: {
    label: '제어반', short: 'MCC',
    defaults: { w: 1.2, h: 2.0, d: 0.7 }, color: '#b6bdc4',
  },
  valve: {
    label: '게이트밸브·플랜지', short: 'GV',
    defaults: { w: 0.34, h: 0.55, d: 0.3 }, color: '#cfd4d8',
  },
};

let seq = 0;
export function uid(prefix) {
  seq += 1;
  return (prefix || 'o') + Date.now().toString(36) + seq.toString(36);
}

export function makeEquipment(type, opts) {
  const t = EQUIP_TYPES[type] || EQUIP_TYPES.tank;
  const o = opts || {};
  return {
    id: uid('e'),
    kind: 'equipment',
    type,
    name: o.name || t.label,
    x: num(o.x, 0), y: num(o.y, 0), z: num(o.z, 0),
    w: num(o.w, t.defaults.w),
    h: num(o.h, t.defaults.h),
    d: num(o.d, t.defaults.d),
    rot: num(o.rot, 0),
    color: o.color || t.color,
  };
}

export function makePipe(opts) {
  const o = opts || {};
  return {
    id: uid('p'),
    kind: 'pipe',
    name: o.name || '배관',
    bore: BORES[o.bore] ? o.bore : '100A',
    material: MATERIALS[o.material] ? o.material : 'carbon',
    points: (o.points || []).map((p) => ({ x: num(p.x, 0), y: num(p.y, 0), z: num(p.z, 0) })),
  };
}

function num(v, d) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : d;
}

export function emptyState() {
  return {
    version: 1,
    name: '스마일산업 배관 도면',
    equipment: [],
    pipes: [],
    floorPlan: {
      src: null, aspect: 1, visible: true, opacity: 0.55,
      width: 12, rot: 0, x: 0, z: 0,
    },
  };
}

// ── 현장 사진 3장(2026-11-20)을 참고한 기본 샘플 씬 ───────────────────────────
// 열교환기 2기 + 원심펌프 2대 + 게이트밸브 매니폴드 + 상부/하부 배관 + 제어반
export function sampleScene() {
  const s = emptyState();
  s.name = '샘플 현장 (열교환기·펌프·밸브 매니폴드)';

  const equip = (type, name, x, z, w, h, d, rot) =>
    makeEquipment(type, { name, x, y: 0, z, w, h, d, rot: rot || 0 });

  s.equipment = [
    equip('hx', 'E-101 쉘앤튜브 열교환기', -3.0, -4.2, 4.6, 0.88, 0.88),
    equip('hx', 'E-102 열교환기', 2.7, -5.0, 3.2, 0.72, 0.72),
    equip('pump', 'P-101 원심펌프', -1.3, 0.9, 1.15, 0.85, 0.6),
    equip('pump', 'P-102 원심펌프', 1.5, 1.2, 1.15, 0.85, 0.6),
    equip('panel', 'MCC-1 제어반', 5.8, -3.2, 1.5, 2.2, 0.8),
    equip('tank', 'D-101 드럼', -5.7, 0.4, 0.6, 0.9, 0.6),
  ];

  // 매니폴드 게이트밸브 (하부 헤더 y=0.95, z=1.6 위에 인라인 배치)
  [-2.6, -0.9, 0.8, 2.5].forEach((x, i) => {
    s.equipment.push(makeEquipment('valve', {
      name: 'GV-' + (101 + i) + ' 게이트밸브', x, y: 0.95, z: 1.6,
      w: 0.34, h: 0.58, d: 0.3,
    }));
  });

  const pipe = (name, bore, material, pts) =>
    makePipe({ name, bore, material, points: pts.map((p) => ({ x: p[0], y: p[1], z: p[2] })) });

  s.pipes = [
    pipe('PL-101 하부 헤더', '150A', 'carbon', [
      [-6.8, 0.95, 1.6], [5.9, 0.95, 1.6],
    ]),
    pipe('PL-102 스팀 메인 (상부)', '150A', 'carbon', [
      [-6.8, 3.6, -1.6], [5.9, 3.6, -1.6],
    ]),
    pipe('PL-103 헤더 분기', '100A', 'carbon', [
      [-4.2, 3.6, -1.6], [-4.2, 1.55, -1.6], [-4.2, 1.55, 1.6], [-4.2, 0.95, 1.6],
    ]),
    pipe('PL-104 P-101 토출', '80A', 'carbon', [
      [-1.3, 0.86, 0.9], [-1.3, 2.6, 0.9], [-1.3, 2.6, -1.6],
    ]),
    pipe('PL-105 P-102 토출', '80A', 'carbon', [
      [1.5, 0.86, 1.2], [1.5, 2.6, 1.2], [1.5, 2.6, -1.6],
    ]),
    pipe('PL-106 E-101 출구', '100A', 'carbon', [
      [-3.0, 1.35, -4.2], [-3.0, 2.3, -4.2], [-3.0, 2.3, -1.6],
    ]),
    pipe('PL-107 E-102 스팀 공급', '100A', 'carbon', [
      [2.7, 3.6, -1.6], [2.7, 2.4, -1.6], [2.7, 2.4, -5.0], [2.7, 1.5, -5.0],
    ]),
    pipe('PL-108 보온 스팀 라인', '80A', 'insulated', [
      [-6.8, 2.3, 3.2], [-0.5, 2.3, 3.2], [-0.5, 1.2, 3.2],
    ]),
    pipe('PL-109 드럼 연결', '50A', 'carbon', [
      [-5.7, 0.35, 0.4], [-5.7, 0.95, 0.4], [-5.7, 0.95, 1.6],
    ]),
  ];
  return s;
}

// 불러온 JSON을 안전한 형태로 정리
export function normalizeState(raw) {
  const s = emptyState();
  if (!raw || typeof raw !== 'object') return s;
  s.name = typeof raw.name === 'string' ? raw.name : s.name;
  if (Array.isArray(raw.equipment)) {
    raw.equipment.forEach((e) => {
      const type = EQUIP_TYPES[e && e.type] ? e.type : 'tank';
      const t = EQUIP_TYPES[type];
      s.equipment.push({
        id: e.id || uid('e'),
        kind: 'equipment',
        type,
        name: typeof e.name === 'string' ? e.name : t.label,
        x: num(e.x, 0), y: Math.max(0, num(e.y, 0)), z: num(e.z, 0),
        w: Math.max(0.1, num(e.w, t.defaults.w)),
        h: Math.max(0.1, num(e.h, t.defaults.h)),
        d: Math.max(0.1, num(e.d, t.defaults.d)),
        rot: num(e.rot, 0),
        color: /^#[0-9a-f]{6}$/i.test(e.color || '') ? e.color : t.color,
      });
    });
  }
  if (Array.isArray(raw.pipes)) {
    raw.pipes.forEach((p) => {
      if (!p || !Array.isArray(p.points) || p.points.length < 2) return;
      s.pipes.push({
        id: p.id || uid('p'),
        kind: 'pipe',
        name: typeof p.name === 'string' ? p.name : '배관',
        bore: BORES[p.bore] ? p.bore : '100A',
        material: MATERIALS[p.material] ? p.material : 'carbon',
        points: p.points.map((pt) => ({ x: num(pt.x, 0), y: Math.max(0, num(pt.y, 0)), z: num(pt.z, 0) })),
      });
    });
  }
  const f = raw.floorPlan || {};
  s.floorPlan = {
    src: typeof f.src === 'string' && f.src.startsWith('data:image') ? f.src : null,
    aspect: num(f.aspect, 1) || 1,
    visible: f.visible !== false,
    opacity: Math.min(1, Math.max(0.05, num(f.opacity, 0.55))),
    width: Math.min(60, Math.max(1, num(f.width, 12))),
    rot: num(f.rot, 0),
    x: num(f.x, 0),
    z: num(f.z, 0),
  };
  return s;
}

export function pipeLength(points) {
  let L = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1], b = points[i];
    L += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  }
  return L;
}
