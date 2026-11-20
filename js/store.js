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
  carbon:    { label: '흑관·카본스틸', color: '#4b5057', roughness: 0.58, metalness: 0.6, jacket: 0.0 },
  sus:       { label: 'SUS 스테인리스', color: '#c8ced4', roughness: 0.32, metalness: 0.88, jacket: 0.0 },
  insulated: { label: '보온배관', color: '#c9b48d', roughness: 0.92, metalness: 0.05, jacket: 0.035 },
};

// 부속 카테고리 — [장비] 탭에서 이 순서대로 묶어 보여준다.
export const EQUIP_CATEGORIES = [
  { id: 'equip', label: '장비' },
  { id: 'valve', label: '밸브' },
  { id: 'fitting', label: '피팅 · 서포트' },
  { id: 'instr', label: '계기' },
];

// 표준 부속 라이브러리 (2026-11-20 현장 사진 기준)
export const EQUIP_TYPES = {
  // ── 장비 ──
  hx: {
    cat: 'equip', label: '열교환기', short: 'HX',
    defaults: { w: 3.0, h: 0.75, d: 0.75 }, color: '#b9bfc6',
  },
  pump: {
    cat: 'equip', label: '원심펌프', short: 'PUMP',
    defaults: { w: 1.15, h: 0.85, d: 0.6 }, color: '#1f4f9b',
  },
  vpump: {
    cat: 'equip', label: '입형 인라인 펌프', short: 'VP',
    defaults: { w: 0.42, h: 0.85, d: 0.42 }, color: '#1f4f9b',
  },
  tank: {
    cat: 'equip', label: '탱크/드럼', short: 'TK',
    defaults: { w: 0.6, h: 0.9, d: 0.6 }, color: '#1c4a8a',
  },
  stank: {
    cat: 'equip', label: '대형 원통 저장탱크', short: 'ST',
    defaults: { w: 2.0, h: 3.0, d: 2.0 }, color: '#c3cbd2',
  },
  rtank: {
    cat: 'equip', label: '사각 탱크 (수조)', short: 'RT',
    defaults: { w: 2.4, h: 1.8, d: 1.8 }, color: '#8f99a3',
  },
  panel: {
    cat: 'equip', label: '제어반', short: 'MCC',
    defaults: { w: 1.2, h: 2.0, d: 0.7 }, color: '#b6bdc4',
  },

  // ── 밸브 ──
  valve: {
    cat: 'valve', label: '게이트밸브', short: 'GV',
    defaults: { w: 0.34, h: 0.58, d: 0.3 }, color: '#cfd4d8',
  },
  bfly: {
    cat: 'valve', label: '기어 버터플라이 밸브', short: 'BF',
    defaults: { w: 0.34, h: 0.46, d: 0.32 }, color: '#1f5fd0',
  },
  yvalve: {
    cat: 'valve', label: '경사형 체크·스트레이너', short: 'YV',
    defaults: { w: 0.36, h: 0.5, d: 0.34 }, color: '#c0392b',
  },
  ball: {
    cat: 'valve', label: '볼밸브', short: 'BV',
    defaults: { w: 0.26, h: 0.34, d: 0.24 }, color: '#d8dde2',
  },
  check: {
    cat: 'valve', label: '체크밸브 (웨이퍼)', short: 'CV',
    defaults: { w: 0.24, h: 0.26, d: 0.22 }, color: '#b9bfc6',
  },

  // ── 피팅 · 서포트 ──
  bellows: {
    cat: 'fitting', label: '벨로우즈 신축관', short: 'EJ',
    defaults: { w: 0.38, h: 0.34, d: 0.34 }, color: '#cfd4d8',
  },
  elbow: {
    cat: 'fitting', label: '90° 엘보', short: 'EL',
    defaults: { w: 0.3, h: 0.3, d: 0.22 }, color: '#c9d0d6',
  },
  tee: {
    cat: 'fitting', label: '티 분기관', short: 'TE',
    defaults: { w: 0.34, h: 0.26, d: 0.22 }, color: '#c9d0d6',
  },
  reducer: {
    cat: 'fitting', label: '레듀샤 (이경관)', short: 'RD',
    defaults: { w: 0.32, h: 0.22, d: 0.22 }, color: '#c9d0d6',
  },
  flange: {
    cat: 'fitting', label: '플랜지', short: 'FL',
    defaults: { w: 0.14, h: 0.26, d: 0.26 }, color: '#9aa3ab',
  },
  support: {
    cat: 'fitting', label: '파이프 서포트', short: 'SP',
    defaults: { w: 0.5, h: 0.85, d: 0.4 }, color: '#7d8790',
  },

  // ── 계기 ──
  gauge: {
    cat: 'instr', label: '압력계 · 온도계', short: 'PG',
    defaults: { w: 0.2, h: 0.34, d: 0.16 }, color: '#e2e8ee',
  },
};

// 카테고리별 타입 목록
export function typesByCategory(cat) {
  return Object.keys(EQUIP_TYPES).filter((k) => EQUIP_TYPES[k].cat === cat);
}

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

  // ── 표준 부속 진열 라인 (2026-11-20 추가) ──────────────────────────────
  // 헤더 배관 1줄에 밸브·피팅을 인라인으로 배치하고, 아래에 서포트와 입형 펌프를 둔다.
  const HDR_Y = 0.6;
  const HDR_Z = 5.2;
  s.pipes.push(pipe('PL-201 부속 진열 헤더', '80A', 'sus', [
    [-6.2, HDR_Y, HDR_Z], [5.4, HDR_Y, HDR_Z], [5.4, 2.1, HDR_Z],
  ]));

  const inline = (type, name, x) =>
    makeEquipment(type, { name, x, y: HDR_Y, z: HDR_Z });

  s.equipment.push(
    inline('bfly', 'BF-101 기어 버터플라이', -4.4),
    inline('yvalve', 'YV-101 경사형 스트레이너', -3.2),
    inline('ball', 'BV-101 볼밸브', -2.0),
    inline('check', 'CV-101 체크밸브', -0.9),
    inline('bellows', 'EJ-101 벨로우즈 신축관', 0.4),
    inline('tee', 'TE-101 티 분기', 1.8),
    inline('reducer', 'RD-101 레듀샤 80A→50A', 3.0),
    inline('flange', 'FL-101 플랜지', 4.2),
    makeEquipment('elbow', { name: 'EL-101 90° 엘보', x: 5.4, y: 2.1, z: HDR_Z, rot: 180 }),
    makeEquipment('gauge', { name: 'PG-101 압력계', x: -5.6, y: HDR_Y, z: HDR_Z }),
    makeEquipment('support', { name: 'SP-101 파이프 서포트', x: -5.0, y: 0, z: HDR_Z, h: HDR_Y - 0.1 }),
    makeEquipment('support', { name: 'SP-102 파이프 서포트', x: 2.6, y: 0, z: HDR_Z, h: HDR_Y - 0.1 }),
    makeEquipment('vpump', { name: 'VP-101 입형 인라인 펌프', x: 0.0, y: 0, z: 6.9 }),
    // 탱크 계통 — 펌프가 있으면 탱크도 (2026-11-20 추가)
    makeEquipment('stank', { name: 'T-201 원통 저장탱크', x: -8.6, y: 0, z: HDR_Z }),
    makeEquipment('rtank', { name: 'T-202 사각 수조', x: 8.4, y: 0, z: HDR_Z }),
    makeEquipment('pump', { name: 'P-201 원심펌프', x: -3.0, y: 0, z: 7.3 }),
  );

  // 탱크 ↔ 펌프 ↔ 헤더 연결
  s.pipes.push(
    pipe('PL-202 탱크 출구', '80A', 'sus', [
      [-7.6, 0.95, HDR_Z], [-6.6, 0.95, HDR_Z], [-6.6, HDR_Y, HDR_Z], [-6.2, HDR_Y, HDR_Z],
    ]),
    pipe('PL-203 펌프 흉입', '80A', 'carbon', [
      [-3.0, 0.95, 7.3], [-3.0, 1.5, 7.3], [-3.0, 1.5, HDR_Z], [-3.0, HDR_Y, HDR_Z],
    ]),
    pipe('PL-204 수조 공급', '80A', 'sus', [
      [5.4, 2.1, HDR_Z], [8.4, 2.1, HDR_Z], [8.4, 1.84, HDR_Z],
    ]),
  );

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
