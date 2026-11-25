// 스마일산업 3D 배관 — 데이터 모델 & 샘플 씬
// 단위: 미터(m). Y축이 높이.

// KS 표준 배관 관경 15A~600A 외경(2026-11-21 전체 반영 — 대구경 350A~600A 포함)
export const BORES = {
  '15A':  { od: 0.0217, mm: 21.7 },
  '20A':  { od: 0.0272, mm: 27.2 },
  '25A':  { od: 0.0340, mm: 34.0 },
  '32A':  { od: 0.0427, mm: 42.7 },
  '40A':  { od: 0.0486, mm: 48.6 },
  '50A':  { od: 0.0605, mm: 60.5 },
  '65A':  { od: 0.0763, mm: 76.3 },
  '80A':  { od: 0.0891, mm: 89.1 },
  '100A': { od: 0.1143, mm: 114.3 },
  '125A': { od: 0.1398, mm: 139.8 },
  '150A': { od: 0.1652, mm: 165.2 },
  '200A': { od: 0.2163, mm: 216.3 },
  '250A': { od: 0.2674, mm: 267.4 },
  '300A': { od: 0.3185, mm: 318.5 },
  '350A': { od: 0.3556, mm: 355.6 },
  '400A': { od: 0.4064, mm: 406.4 },
  '450A': { od: 0.4572, mm: 457.2 },
  '500A': { od: 0.5080, mm: 508.0 },
  '550A': { od: 0.5588, mm: 558.8 },
  '600A': { od: 0.6096, mm: 609.6 },
};

// 관경 이름 목록 (작은 것부터) — 드롭다운·프롬프트·명령 파서가 같은 순서를 쓴다.
export const BORE_KEYS = Object.keys(BORES);

// ── 플랜지 외경 (KS B 1503 10K, mm) ────────────────────────────────────
// 배관 끝 플랜지·플랜지 부속·맞물림 플랜지가 모두 이 한 표를 쓴다 —
// 100A(210) > 80A(185) > 50A(155)처럼 관경을 따라 커지고 작아진다.
// (예전에는 부속은 고정 크기·배관은 외경×1.8로 따로 셌다 — 80A가 100A와 구분되지 않았다)
export const FLANGE_OD = {
  '15A': 0.095, '20A': 0.100, '25A': 0.125, '32A': 0.135, '40A': 0.140,
  '50A': 0.155, '65A': 0.175, '80A': 0.185, '100A': 0.210, '125A': 0.250,
  '150A': 0.280, '200A': 0.330, '250A': 0.400, '300A': 0.445, '350A': 0.505,
  '400A': 0.565, '450A': 0.615, '500A': 0.670, '550A': 0.720, '600A': 0.775,
};

// 플랜지 외경(m) — 표에 없는 관경은 배관 외경의 1.8배로 추정한다.
export function flangeOd(bore) {
  if (FLANGE_OD[bore]) return FLANGE_OD[bore];
  const od = BORES[bore] ? BORES[bore].od : BORES['100A'].od;
  return Math.round(od * 1.8 * 1e4) / 1e4;
}

// ── 플랜지 판 두께 (m) ────────────────────────────────────────────────
// 예전에는 단독 플랜지 45mm·배관 끝 40mm로 두꺼워, 볼트를 빼자 '하키 퍽' 같은
// 민무늬 원판으로 보였다(2026-11-25 `31587` 캡처). KS 10K 판 두께를 16~22mm로
// 다듬어 단독 플랜지·배관 끝·맞물림 판·밸브 자기 플랜지가 모두 이 한 표를 쓴다.
//  · 플랜지 부속의 w(면간 두께)도 이 값으로 맞춘다 — 그래야 접합면(±w/2)이
//    판의 바깥면과 정확히 일치해, 플랜지 위에 엘보를 올려도 파묻히지 않는다
//    (2026-11-25 `31589` 캡처).
export const FLANGE_T = {
  '15A': 0.014, '20A': 0.014, '25A': 0.014, '32A': 0.016, '40A': 0.016,
  '50A': 0.016, '65A': 0.018, '80A': 0.018, '100A': 0.020, '125A': 0.020,
  '150A': 0.022, '200A': 0.022, '250A': 0.022, '300A': 0.022, '350A': 0.022,
  '400A': 0.022, '450A': 0.022, '500A': 0.022, '550A': 0.022, '600A': 0.022,
};

export function flangeTh(bore) {
  if (FLANGE_T[bore]) return FLANGE_T[bore];
  const od = BORES[bore] ? BORES[bore].od : BORES['100A'].od;
  return Math.max(0.014, Math.min(0.022, Math.round(od * 0.175 * 1e3) / 1e3));
}

export const MATERIALS = {
  carbon:    { label: '흑관·카본스틸', color: '#4b5057', roughness: 0.58, metalness: 0.6, jacket: 0.0 },
  sus:       { label: 'SUS 스테인리스', color: '#c8ced4', roughness: 0.32, metalness: 0.88, jacket: 0.0 },
  insulated: { label: '보온배관', color: '#c9b48d', roughness: 0.92, metalness: 0.05, jacket: 0.035 },
};

// ── 연결 방식 ────────────────────────────────────────────────────────────────
// none   : 선택안함(기본값) — 배관 끝에 플랜지도 단조 보스도 그리지 않는 매끈한 배관.
// flange : 사용자가 직접 고른 경우에만 배관 끝에 플랜지 원판.
// forged : 단조형(소켓웰드·나사식) — 플랜지 원판 없이 소켓 보스·육각 칼라만.
// 예전 도면(conn 없음)은 플랜지형으로 읽어 호환을 유지한다.
export const CONN_MODES = {
  none: { label: '선택안함', short: '—' },
  flange: { label: '플랜지', short: 'FLG' },
  forged: { label: '단조', short: 'FRG' },
};

// 배관과 만나는 부속 — 속성 패널에서 연결 방식을 바꿀 수 있는 종류
export const CONN_TYPES = new Set([
  'valve', 'bfly', 'yvalve', 'ball', 'check', 'bellows', 'elbow', 'elbow45',
  'tee', 'reducer', 'nipple', 'cap', 'union', 'flow', 'flange',
]);

export function connOf(item) {
  const c = item && item.conn;
  return c === 'forged' ? 'forged' : (c === 'none' ? 'none' : 'flange');
}

// 배관의 연결 방식 — v70부터 기본값은 '선택안함'(자동 플랜지·보스 없음).
// 'none'이 아닌 값은 담아 둔 그대로 지킨다(사용자가 직접 고른 'flange'/'forged').
export function pipeConnOf(v) {
  return v === 'forged' ? 'forged' : (v === 'flange' ? 'flange' : 'none');
}

// 관경 외경(m) — 부속(레듀샤·티)을 실제 관경 크기로 그릴 때 쓴다.
export function boreOd(bore) {
  return (BORES[bore] || BORES['100A']).od;
}

// ── 밸브·피팅 크기 — 달린 배관 관경에 비례 ──────────────────────────────────
// EQUIP_TYPES의 밸브·피팅 기본 w/h/d는 100A(외경 114.3mm) 배관에 달린 치수다.
// 25A 배관에 25A 볼밸브를 달면 외경비만큼 작아져야 배관 굵기와 어울린다.
export const SIZE_REF_BORE = '100A';

// 관경을 따라 크기가 바뀌는 부속 — 밸브류 + 배관에 인라인으로 물리는 피팅·계기
export const BORE_SIZED_TYPES = new Set([
  'valve', 'bfly', 'yvalve', 'ball', 'check',        // 밸브
  'safety_valve',                                    // 안전·감압밸브
  'bellows', 'nipple', 'cap', 'union', 'flange',     // 피팅
  'flow',                                            // 유량계
]);

export function isBoreSized(type) {
  return BORE_SIZED_TYPES.has(type);
}

// 관경 → 크기 배율
export function boreScale(bore) {
  const r = boreOd(bore) / boreOd(SIZE_REF_BORE);
  // plan : 몸체 지름·플랜지·면간거리 — 배관 외경에 정비례해 배관과 맞물린다
  //        (25A 볼밸브 = 100A의 0.30배, 200A = 1.89배)
  // rise : 스템·핸들 높이 — 대구경에서 사람 키만큼 솟지 않도록 외경비의 0.65제곱
  //        (100A 0.58m → 25A 0.26m · 200A 0.88m · 600A 1.72m, 실제 현장 밸브와 비슷한 키)
  return { plan: r, rise: Math.pow(r, 0.65) };
}

// 관경이 바뀐 부속의 몸체·핸들 크기를 새 관경 비율로 다시 잡는다.
// (엘보·레듀샤·티는 각자 관경으로 치수를 뽑으므로 여기서 다루지 않는다)
export function applyBoreSize(spec) {
  const t = spec && EQUIP_TYPES[spec.type];
  if (!t || !isBoreSized(spec.type)) return spec;
  const bore = BORES[spec.bore] ? spec.bore : SIZE_REF_BORE;
  const bs = boreScale(bore);
  spec.bore = bore;
  spec.w = round3(t.defaults.w * bs.plan);
  // 플랜지 — 판 두께(w)와 접시 외경(h·d)을 KS 10K 표 그대로 잡는다
  //  (100A 210mm > 80A 185mm, 두께는 14~22mm). 접합면 ±w/2가 곧 판의 바깥면이다.
  if (spec.type === 'flange') {
    spec.w = round3(flangeTh(bore));
    spec.h = round3(flangeOd(bore));
    spec.d = round3(flangeOd(bore));
    return spec;
  }
  spec.h = round3(t.defaults.h * bs.rise);
  spec.d = round3(t.defaults.d * bs.plan);
  return spec;
}

// ── 엘보(90°·45°) 치수 — KS B 1522 / ASME B16.9 **롱엘보(LR)** 표 그대로 ───────
// face(중심~끝)는 1.5×NPS(인치) 표를 따른다 — 200A(8") = 304.8mm.
// (예전엔 R=1.5×외경에 직관 스텁 Ls=0.18R를 더해 200A가 383mm로, 실제 현장 엘보보다
//  78mm나 길었다 — 2026-11-26 사용자 지적 "엘보값 200a 304.8 이야")
//  · 작은 관경(15A~25A)은 표의 최소값 38.1mm를 쓴다.
export const ELBOW_FACE = {
  '15A': 0.0381, '20A': 0.0381, '25A': 0.0381, '32A': 0.0476, '40A': 0.0572,
  '50A': 0.0762, '65A': 0.0953, '80A': 0.1143, '100A': 0.1524, '125A': 0.1905,
  '150A': 0.2286, '200A': 0.3048, '250A': 0.3810, '300A': 0.4572, '350A': 0.5334,
  '400A': 0.6096, '450A': 0.6858, '500A': 0.7620, '550A': 0.8382, '600A': 0.9144,
};

// 45° LR 엘보 — 중심~끝(B). 200A = 127.0mm (KS B 1522 / ASME B16.9).
export const ELBOW45_FACE = {
  '15A': 0.0159, '20A': 0.0190, '25A': 0.0222, '32A': 0.0254, '40A': 0.0286,
  '50A': 0.0349, '65A': 0.0445, '80A': 0.0508, '100A': 0.0635, '125A': 0.0794,
  '150A': 0.0953, '200A': 0.1270, '250A': 0.1588, '300A': 0.1905, '350A': 0.2223,
  '400A': 0.2540, '450A': 0.2858, '500A': 0.3175, '550A': 0.3429, '600A': 0.3810,
};

// 티 — 중심~끝(C). 본관 전체 길이 w = 2C, 분기 길이 = C. 200A = 177.8mm.
export const TEE_C = {
  '15A': 0.0254, '20A': 0.0286, '25A': 0.0381, '32A': 0.0476, '40A': 0.0572,
  '50A': 0.0635, '65A': 0.0762, '80A': 0.0857, '100A': 0.1048, '125A': 0.1238,
  '150A': 0.1429, '200A': 0.1778, '250A': 0.2159, '300A': 0.2540, '350A': 0.3302,
  '400A': 0.3810, '450A': 0.4318, '500A': 0.4826, '550A': 0.5334, '600A': 0.5842,
};

// 레듀샤 — 전체 길이(H), **큰 관경** 기준. 200A = 152.4mm.
export const REDUCER_H = {
  '15A': 0.0381, '20A': 0.0381, '25A': 0.0508, '32A': 0.0508, '40A': 0.0635,
  '50A': 0.0762, '65A': 0.0889, '80A': 0.0889, '100A': 0.1016, '125A': 0.1270,
  '150A': 0.1397, '200A': 0.1524, '250A': 0.1778, '300A': 0.2032, '350A': 0.3302,
  '400A': 0.3556, '450A': 0.3810, '500A': 0.4064, '550A': 0.4318, '600A': 0.4572,
};

// r   : 배관 외경 반지름 (= 엘보 관 반지름, 배관과 같은 굵기로 앉는다)
// R   : 곡률 반경 — 90°는 R = 중심~끝(실제 LR 엘보는 곡관 접점이 곧 접합면),
//       45°는 R = B / tan22.5° 로 잡아야 두 다리 접점이 표의 B와 정확히 맞는다
// T   : 꼭짓점에서 곡관 접점까지 거리 = 중심~끝(face)
// Ls  : 접점에서 접합면까지 직관 스텁 — 실제 LR 엘보는 0
// face: 꼭짓점 → 접합면 거리 = T + Ls  (배관을 이만큼 당겨 엘보를 앉힌다)
export function elbowDims(type, bore) {
  const b = bore || '100A';
  const od = boreOd(b);
  const r = od / 2;
  const is45 = type === 'elbow45';
  const F = is45 ? (ELBOW45_FACE[b] || 0.0635) : (ELBOW_FACE[b] || 0.1524);
  const R = is45 ? round3(F / Math.tan(Math.PI / 8)) : F;
  const Ls = 0;
  return { od, r, R, Ls, T: F, face: round3(F) };
}

// 티 치수 — C(중심~끝)로 본관 전체 길이 2C·분기 길이 C. builders·ports가 같은 값을 쓴다.
export function teeDims(bore1) {
  const b = BORES[bore1] ? bore1 : '100A';
  const C = TEE_C[b] || 0.1048;
  return { C, L: round3(C * 2), H: C, w: round3(C * 2) };
}

// 레듀샤 치수 — 큰 관경 기준 전체 길이 H가 곧 접합면 사이 거리(w).
export function reducerDims(bore1, bore2) {
  const b1 = BORES[bore1] ? bore1 : '100A';
  const b2 = BORES[bore2] ? bore2 : b1;
  const big = boreOd(b1) >= boreOd(b2) ? b1 : b2;
  const H = REDUCER_H[big] || 0.1016;
  return { H, w: round3(H) };
}

// 엘보 배치용 회전행렬 (행 우선 3×3).
// 로컬 +X = inDir(들어오는 배관 쪽으로 나가는 다리), 로컬 +Y = outDir의 직교 성분.
// 이렇게 돌리면 어느 평면(XY·YZ·XZ)에서 꺾이든 두 입구가 배관과 정확히 일직선이 된다.
export function elbowBasis(inDir, outDir) {
  const nrm = (v) => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  const a = Array.isArray(inDir) && inDir.length === 3 ? nrm(inDir) : [1, 0, 0];
  const b0 = Array.isArray(outDir) && outDir.length === 3 ? nrm(outDir) : [0, 1, 0];
  const d = a[0] * b0[0] + a[1] * b0[1] + a[2] * b0[2];
  let w = [b0[0] - d * a[0], b0[1] - d * a[1], b0[2] - d * a[2]];
  if (Math.hypot(w[0], w[1], w[2]) < 1e-6) w = [0, 1, 0]; // 180° — 꺾임 없음
  w = nrm(w);
  const n = [a[1] * w[2] - a[2] * w[1], a[2] * w[0] - a[0] * w[2], a[0] * w[1] - a[1] * w[0]];
  // 열 = (a, w, n)
  return [a[0], w[0], n[0], a[1], w[1], n[1], a[2], w[2], n[2]];
}

// 진행 방향 벡터 → 3D 회전행렬 (행 우선 3×3, 각 열 = 로컬 X·Y·Z가 향하는 월드 방향).
//  · 로컬 +X = 진행 방향 — 플랜지 원판·밸브 바디가 배관 중심축에 정확히 맞는다.
//    (수직 배관 끝 = 바닥과 평행한 수평 원판, 좌/우 배관 끝 = X를 바라보는 수직 원판,
//     45° 경사관 끝 = 경사축에 수직인 원판)
//  · 로컬 +Y = 가능한 한 월드 위쪽 — 핸드휠·레버가 위를 향한다. 수직 배관은 Z를 기준으로 돌린다.
export function dirBasis(dir) {
  const nrm = (v) => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  let a = Array.isArray(dir) && dir.length === 3 && dir.every((v) => Number.isFinite(Number(v)))
    ? nrm([Number(dir[0]), Number(dir[1]), Number(dir[2])]) : [1, 0, 0];
  if (Math.hypot(a[0], a[1], a[2]) < 1e-6) a = [1, 0, 0];
  // 수직에 가까운 배관은 월드 Y를 기준으로 삼을 수 없으므로 Z를 쓴다.
  const up = Math.abs(a[1]) > 0.95 ? [0, 0, 1] : [0, 1, 0];
  const d = a[0] * up[0] + a[1] * up[1] + a[2] * up[2];
  let b = [up[0] - d * a[0], up[1] - d * a[1], up[2] - d * a[2]];
  if (Math.hypot(b[0], b[1], b[2]) < 1e-6) b = [0, 0, 1];
  b = nrm(b);
  const c = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  // 열 = (a, b, c) — three.js Matrix4.set()이 행 우선이므로 이 순서로 넘긴다.
  return [a[0], b[0], c[0], a[1], b[1], c[1], a[2], b[2], c[2]];
}

// 계기 정면(법선 n)에 맞춘 3D 회전행렬 (행 우선 3×3, 각 열 = 로컬 X·Y·Z가 향하는 월드 방향).
//  · 로컬 +Z = n — 다이얼이 바깥을 정면으로 보고, 니쁠(−Z)은 배관 중심을 향한다.
//  · 로컬 +Y = 최대한 월드 위쪽 — 다이얼의 12시가 서 있다.
// dirBasis와 같은 형식이라 Matrix4.set()·Fusion rmat에 그대로 쓴다.
export function gaugeBasis(normal) {
  const nrm = (v) => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  const z = Array.isArray(normal) && normal.length === 3
    && normal.every((v) => Number.isFinite(Number(v)))
    ? nrm([Number(normal[0]), Number(normal[1]), Number(normal[2])]) : [0, 0, 1];
  if (Math.hypot(z[0], z[1], z[2]) < 1e-6) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  // 수직으로 선 계기(위를 봄)는 월드 Y를 기준으로 못 세우므로 Z를 쓴다.
  const up = Math.abs(z[1]) > 0.95 ? [0, 0, -1] : [0, 1, 0];
  let x = [up[1] * z[2] - up[2] * z[1], up[2] * z[0] - up[0] * z[2], up[0] * z[1] - up[1] * z[0]];
  const xl = Math.hypot(x[0], x[1], x[2]) || 1;
  x = [x[0] / xl, x[1] / xl, x[2] / xl];
  const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  return [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]];
}

// 이경 부속(레듀샤·티)의 실제 폭(m). builders.js·fusion.js의 치수식과 같다.
//  · 레듀샤: 큰 관경에서 작은 관경으로 줄어드는 원뿔 길이 + 양단 플랜지
//  · 티: 주배관 길이 + 양단 용접 비드
// 이 폭만큼 커서를 전진시켜 앞뒤 배관과 겹치지 않게 한다.
export function fittingNaturalWidth(type, bore1, bore2) {
  if (type === 'reducer') return reducerDims(bore1, bore2).w;
  if (type === 'tee') return teeDims(bore1).w;
  return 0;
}

function round3(v) {
  return Math.round(v * 1000) / 1000;
}

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
  // 헤더 — 가로로 누운 원통형 배관 분배기. 위·아래로 여러 수직 배관이 꽂히는 설비.
  // w = 원통 길이, h = 원통 지름, d = 원통 지름. 바닥 지지 프레임(새들)은 builders.js가 그린다.
  header: {
    cat: 'equip', label: '스팀/배관 헤더', short: 'HDR',
    defaults: { w: 2.4, h: 0.4, d: 0.4 }, color: '#b04a35',
  },
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
  // w는 곧 "배관 방향 실제 길이"다 — builders.js 메시의 좌우 접합면 폭과 1:1로 맞춘 값이다.
  valve: {
    cat: 'valve', label: '게이트밸브', short: 'GV',
    defaults: { w: 0.264, h: 0.58, d: 0.3 }, color: '#cfd4d8',
  },
  bfly: {
    cat: 'valve', label: '기어 버터플라이 밸브', short: 'BF',
    defaults: { w: 0.174, h: 0.46, d: 0.32 }, color: '#1f5fd0',
  },
  // Y자 스트레이너 — 손잡이(핸드휠·스템)가 없는 부속이라 HANDLE_TYPES에도 넣지 않는다.
  // 형상은 buildYValve()가 관경·면간(w)에서 m 단위 실제 치수로 그린다(v69).
  yvalve: {
    cat: 'valve', label: 'Y자 스트레이너 (경사형)', short: 'YV',
    defaults: { w: 0.296, h: 0.34, d: 0.3 }, color: '#c0392b',
  },
  ball: {
    cat: 'valve', label: '볼밸브', short: 'BV',
    defaults: { w: 0.234, h: 0.34, d: 0.24 }, color: '#d8dde2',
  },
  check: {
    cat: 'valve', label: '체크밸브 (웨이퍼)', short: 'CV',
    defaults: { w: 0.108, h: 0.26, d: 0.22 }, color: '#b9bfc6',
  },
  // 안전밸브·감압밸브 — 세로 몸체 + 상부 스프링 보닛 + 측면 토출구. 수직 배관 위에 서는 부속.
  safety_valve: {
    cat: 'valve', label: '안전·감압밸브', short: 'SV', vertical: true,
    defaults: { w: 0.22, h: 0.52, d: 0.22 }, color: '#b9bfc6',
  },

  // ── 피팅 · 서포트 ──
  bellows: {
    cat: 'fitting', label: '벨로우즈 신축관', short: 'EJ',
    defaults: { w: 0.304, h: 0.34, d: 0.34 }, color: '#cfd4d8',
  },
  elbow: {
    cat: 'fitting', label: '90° 엘보', short: 'EL', bore: '100A',
    defaults: { w: 0.1524, h: 0.12, d: 0.12 }, color: '#c9d0d6',
  },
  tee: {
    cat: 'fitting', label: '티 분기관', short: 'TE',
    defaults: { w: 0.2096, h: 0.26, d: 0.22 }, color: '#c9d0d6',
    bore1: '100A', bore2: '100A',
  },
  reducer: {
    cat: 'fitting', label: '레듀샤 (이경관)', short: 'RD',
    defaults: { w: 0.1016, h: 0.22, d: 0.22 }, color: '#c9d0d6',
    bore1: '100A', bore2: '50A',
  },
  nipple: {
    cat: 'fitting', label: '니쁠 (단니쁠)', short: 'NI',
    defaults: { w: 0.146, h: 0.1, d: 0.1 }, color: '#b9c0c7',
  },
  elbow45: {
    cat: 'fitting', label: '45° 엘보', short: 'E45', bore: '100A',
    defaults: { w: 0.0635, h: 0.12, d: 0.12 }, color: '#c9d0d6',
  },
  cap: {
    cat: 'fitting', label: '캡 (엔드캡·마개)', short: 'CP',
    defaults: { w: 0.148, h: 0.11, d: 0.11 }, color: '#c9d0d6',
  },
  union: {
    cat: 'fitting', label: '유니온 (소켓)', short: 'UN',
    defaults: { w: 0.206, h: 0.1, d: 0.1 }, color: '#b9c0c7',
  },
  flange: {
    cat: 'fitting', label: '플랜지', short: 'FL',
    defaults: { w: 0.06, h: 0.26, d: 0.26 }, color: '#9aa3ab',
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
  flow: {
    cat: 'instr', label: '유량계 (플로우미터)', short: 'FM',
    defaults: { w: 0.24, h: 0.44, d: 0.24 }, color: '#8fa7bf',
  },
};

// 카테고리별 타입 목록
export function typesByCategory(cat) {
  return Object.keys(EQUIP_TYPES).filter((k) => EQUIP_TYPES[k].cat === cat);
}

// ── 색상 힌트 — AI가 사진에서 읽은 색을 3D 메쉬에 그대로 입힌다 ─────────────
// 사진 속 색(적색 스팀 헤더·은색 아연도·회색 안전밸브 등)을 hex로 넘기면 그 색으로,
// 없거나 알아볼 수 없으면 장비 기본색을 쓴다.
const NAMED_COLORS = {
  '적색': '#b04a35', '빨강': '#b04a35', '빨간': '#b04a35', '레드': '#b04a35', red: '#b04a35',
  '주황': '#c26a2e', orange: '#c26a2e',
  '은색': '#c8ced4', '은회색': '#c8ced4', '아연': '#c8ced4', 'silver': '#c8ced4', galvanized: '#c8ced4',
  '회색': '#9aa3ab', '그레이': '#9aa3ab', gray: '#9aa3ab', grey: '#9aa3ab',
  '흰색': '#e8ecef', white: '#e8ecef',
  '파랑': '#1f5fd0', '파란': '#1f5fd0', '청색': '#1f5fd0', blue: '#1f5fd0',
  '초록': '#2e7d4f', '녹색': '#2e7d4f', green: '#2e7d4f',
  '노랑': '#d8b02a', '황색': '#d8b02a', yellow: '#d8b02a',
  '검정': '#3a3f44', '검은': '#3a3f44', black: '#3a3f44',
};

// hex(#rrggbb)·#rgb·색 이름 → '#rrggbb'. 알아볼 수 없으면 null.
export function toHexColor(hint) {
  if (typeof hint !== 'string') return null;
  const s = hint.trim();
  const m = /^#([0-9a-f]{6})$/i.exec(s);
  if (m) return '#' + m[1].toLowerCase();
  const m3 = /^#([0-9a-f]{3})$/i.exec(s);
  if (m3) return '#' + m3[1].split('').map((c) => c + c).join('').toLowerCase();
  const key = s.toLowerCase().replace(/\s+/g, '');
  if (NAMED_COLORS[key]) return NAMED_COLORS[key];
  const found = Object.keys(NAMED_COLORS).find((k) => key.includes(k.toLowerCase()));
  return found ? NAMED_COLORS[found] : null;
}

// 장비·배관 색 결정 — 힌트가 있으면 힌트, 없으면 기본값
function colorOf(hint, fallback) {
  return toHexColor(hint) || (toHexColor(fallback) || fallback);
}

// ── 축 방향 ────────────────────────────────────────────────────────────
// x · z = 수평(누운) 배관, y = 수직(세운) 배관. 속성 패널·AI가 이 값으로 방향을 정한다.
export const AXIS_LABELS = { x: '수평 (X)', z: '수평 (Z)', y: '수직 (Y)' };
const AXIS_VALUES = new Set(['x', 'y', 'z']);

// 세로로 세울 수 있는 부속 — 밸브·피팅·계기류
// (엘보·티·레듀샤는 자기 두 다리 방향으로 그려지므로 여기에 넣지 않는다)
export const VERTICAL_TYPES = new Set([
  'valve', 'bfly', 'yvalve', 'ball', 'check', 'safety_valve',
  'bellows', 'flow', 'union', 'flange', 'nipple', 'cap',
]);

export function isVerticalCapable(type) {
  return VERTICAL_TYPES.has(type) || type === 'gauge';
}

// ── 핸들(손잡이) 방향 ──────────────────────────────────────────────────
// 유로가 있고 손잡이·레버·다이얼이 달린 부속만 관 축 둘레로 돌린다.
// (엘보·티·레듀샤는 두 다리 방향이 곧 자세라 돌릴 손잡이가 없다)
//  · yvalve(Y자 스트레이너)는 손잡이가 없는 부속이라 뺐다(v69 `31601`) — 불필요한
//    '핸들 방향' 안내가 뜨지 않는다.
export const HANDLE_TYPES = new Set(['valve', 'bfly', 'ball', 'check', 'flow']);

// 핸들 방향(도) — 배관(유로)은 그대로 두고 스템·핸드휠·레버·Y자 넷만 관 축 둘레로 돈 각도.
export function handleRotOf(spec) {
  const v = num(spec && spec.roll, 0);
  return Math.round(((v % 360) + 360) % 360);
}

// 회전행렬(행 우선 3×3, 열 = 로컬 X·Y·Z가 향하는 월드 방향)을 관 축 둘레로 돌린다.
//  · 로컬 +X(유로 축)는 그대로 — 플랜지·몸체가 배관에 맞물린 자리가 흔들리지 않는다.
//  · 1열(로컬 X)은 두고 2·3열을 X 둘레로 각도만큼 섞는다 (M·RotX).
// builders.js(Three.js 회전)와 fusion.js(rmat 내보내기)가 같은 결과를 쓰도록 한 곳에 둔다.
export function rollBasis(b, deg) {
  const th = (Number(deg) || 0) * Math.PI / 180;
  const round6 = (v) => Math.round(v * 1e6) / 1e6;
  if (!th) return b.map(round6);
  const c = Math.cos(th);
  const s = Math.sin(th);
  const out = b.slice();
  for (let r = 0; r < 3; r += 1) {
    const y = b[r * 3 + 1];
    const z = b[r * 3 + 2];
    out[r * 3 + 1] = c * y + s * z;
    out[r * 3 + 2] = -s * y + c * z;
  }
  return out.map(round6);
}

// ── 3축 회전 — 모든 장비·부속 ─────────────────────────────────────────────
// 사용자 요청(2026-11-25 `31577` 캡처): 어떤 장비·부속을 골라도
//   좌·우(수평) 45° → yaw   : 월드 Y축 둘레
//   위·아래      45° → pitch : 지금 유로(로컬 +X)에 수직인 수평축 둘레
//   축 회전      45° → roll  : 제 유로 축(로컬 +X) 둘레 (밸브·스트레이너는 핸들만)
// 로 돌릴 수 있다. 값은 도(deg)이고 yaw·pitch 는 -180~180으로 정규화해 저장한다.
// builders.js(Three.js 회전)·fusion.js(rmat)·store.js(노즐·접합면)가 같은 식을 쓴다.
export function norm180(deg) {
  const v = num(deg, 0);
  const w = ((v % 360) + 360) % 360;
  return Math.round(w > 180 ? w - 360 : w);
}

// 월드 축 ax 둘레로 deg 만큼 도는 3×3 (행 우선) — 로드리게스 공식.
function axisRot(ax, deg) {
  const t = (Number(deg) || 0) * Math.PI / 180;
  if (!t) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const l = Math.hypot(ax[0], ax[1], ax[2]) || 1;
  const x = ax[0] / l, y = ax[1] / l, z = ax[2] / l;
  const c = Math.cos(t), s = Math.sin(t), k = 1 - c;
  return [
    c + x * x * k, x * y * k - z * s, x * z * k + y * s,
    y * x * k + z * s, c + y * y * k, y * z * k - x * s,
    z * x * k - y * s, z * y * k + x * s, c + z * z * k,
  ];
}

// 위·아래(pitch) 회전축 — 지금 유로(수평 성분)에 수직인 수평축. 유로가 세로면 월드 X.
function pitchAxisOf(h) {
  const ax = [-h[2], 0, h[0]];      // cross(유로, 월드 위쪽) — 양의 각이 유로를 들어 올린다
  return Math.hypot(ax[0], ax[2]) < 1e-6 ? [1, 0, 0] : ax;
}

// 벡터에 yaw·pitch 를 적용 (몸체와 같은 순서: yaw → pitch).
export function extraRotVec(v, yawDeg, pitchDeg) {
  const yaw = num(yawDeg, 0);
  const pitch = num(pitchDeg, 0);
  const h = yaw ? matVec(rotYM(yaw), [v[0], v[1], v[2]]) : [v[0], v[1], v[2]];
  if (!pitch) return h;
  return matVec(axisRot(pitchAxisOf(h), pitch), h);
}

// 회전행렬(행 우선 3×3)에 yaw·pitch 를 덧씌운다 — R = Rpitch · Ryaw · B.
export function extraBasis(b, yawDeg, pitchDeg) {
  const yaw = num(yawDeg, 0);
  const pitch = num(pitchDeg, 0);
  if (!yaw && !pitch) return b.slice();
  let m = yaw ? matMul(rotYM(yaw), b) : b.slice();
  if (pitch) m = matMul(axisRot(pitchAxisOf([m[0], m[3], m[6]]), pitch), m);
  return m;
}

// 축 회전(roll) 값 — 밸브·스트레이너는 핸들만, 나머지는 몸체가 유로 축 둘레로 돈다.
export function rollOf(spec) {
  return num(spec && spec.roll, 0);
}

// 장비·부속의 최종 자세(행 우선 3×3, 각 열 = 로컬 X·Y·Z가 향하는 월드 방향).
// builders.js buildEquipment()와 fusion.js rmat 이 **같은 이 함수**를 쓴다.
//  · 기본 자세: 계기(법선) → 엘보(두 다리) → 진행 방향(dir) → 수직(axis: 'y') → 회전(rot)
//  · 그 위에 3축 회전(yaw·pitch)을 덧씌우고, 마지막에 유로 축 둘레 roll 을 건다.
export function equipBasis(spec) {
  if (!spec) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const type = spec.type;
  const verticalNative = type === 'safety_valve' || type === 'gauge';
  const elbowLike = type === 'elbow' || type === 'elbow45';
  const dirOk = Array.isArray(spec.dir) && spec.dir.length === 3
    && Math.hypot(num(spec.dir[0], 0), num(spec.dir[1], 0), num(spec.dir[2], 0)) > 1e-6;
  let b;
  if (type === 'gauge' && Array.isArray(spec.normal)) {
    b = gaugeBasis(spec.normal);
  } else if (elbowLike && Array.isArray(spec.inDir) && Array.isArray(spec.outDir)) {
    b = elbowBasis(spec.inDir, spec.outDir);
  } else if (!verticalNative && dirOk) {
    b = dirBasis(spec.dir);
  } else if (spec.axis === 'y' && !verticalNative) {
    b = matMul(rotYM(num(spec.rot, 0)), dirBasis([0, 1, 0]));
  } else if (type === 'gauge' && (spec.axis === 'x' || spec.axis === 'z')) {
    // 계기를 배관 옆면에 붙일 때 — 스템(+Y)을 수평으로 눕히고 다이얼은 앞을 본다.
    const base = spec.axis === 'x'
      ? [0, 1, 0, -1, 0, 0, 0, 0, 1]     // Rz(-90°)
      : [1, 0, 0, 0, 0, -1, 0, 1, 0];    // Rx(+90°)
    b = matMul(rotYM(num(spec.rot, 0)), base);
  } else {
    b = rotYM(num(spec.rot, 0));
  }
  return rollBasis(extraBasis(b, spec.yaw, spec.pitch), rollOf(spec));
}

// 장비·부속의 유로 축(월드 단위벡터) — 3축 회전까지 반영한 실제 축.
// 플랜지 접합면·노즐·맞물림 판이 모두 이 축을 쓴다.
export function equipFlowAxis(e) {
  let ax = [1, 0, 0];
  if (Array.isArray(e.dir) && e.dir.length === 3) {
    const l = Math.hypot(num(e.dir[0], 0), num(e.dir[1], 0), num(e.dir[2], 0));
    if (l > 1e-6) ax = [num(e.dir[0], 0) / l, num(e.dir[1], 0) / l, num(e.dir[2], 0) / l];
  } else if (e.axis === 'y') {
    ax = [0, 1, 0];
  } else {
    const rot = ((Number(e.rot) || 0) % 360 + 360) % 360;
    if (rot === 90) ax = [0, 0, 1];
    else if (rot === 270) ax = [0, 0, -1];
    else if (rot === 180) ax = [-1, 0, 0];
  }
  const v = extraRotVec(ax, e.yaw, e.pitch);
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return { x: v[0] / l, y: v[1] / l, z: v[2] / l };
}

let seq = 0;
export function uid(prefix) {
  seq += 1;
  return (prefix || 'o') + Date.now().toString(36) + seq.toString(36);
}

export function makeEquipment(type, opts) {
  const t = EQUIP_TYPES[type] || EQUIP_TYPES.tank;
  const o = opts || {};
  // 밸브·피팅은 달린 배관 관경을 기억하고, 그 외경에 비례해 몸체·핸들 크기를 잡는다.
  const sized = isBoreSized(type);
  const bore = sized
    ? (BORES[o.bore] ? o.bore : (BORES[o.bore1] ? o.bore1 : SIZE_REF_BORE))
    : null;
  const bs = bore ? boreScale(bore) : null;
  const spec = {
    id: uid('e'),
    kind: 'equipment',
    type,
    name: o.name || t.label,
    x: num(o.x, 0), y: num(o.y, 0), z: num(o.z, 0),
    w: num(o.w, bs ? round3(t.defaults.w * bs.plan) : t.defaults.w),
    h: num(o.h, bs ? round3(t.defaults.h * bs.rise) : t.defaults.h),
    d: num(o.d, bs ? round3(t.defaults.d * bs.plan) : t.defaults.d),
    rot: num(o.rot, 0),
    // 색 — 사진에서 읽은 색 힌트(AI color)가 있으면 그 색, 없으면 장비 기본색
    color: colorOf(o.color, t.color),
    // 연결 방식 — 플랜지(기본) / 단조형(소켓웰드·나사식). 기존 호출은 플랜지로 남는다.
    conn: o.conn === 'forged' ? 'forged' : 'flange',
  };
  if (bore) spec.bore = bore;
  // 플랜지 — 외경은 기본 치수가 아니라 KS 10K 표(관경별)로, 두께(w)도 표 값으로 잡는다.
  // 접합면 ±w/2가 판의 바깥면과 정확히 겹치도록 하는 기준값이다.
  if (type === 'flange' && bore) {
    spec.w = round3(flangeTh(bore));
    spec.h = round3(flangeOd(bore));
    spec.d = round3(flangeOd(bore));
  }
  // 노즐 — 열교환기·헤더·탱크(원형·사각)·펌프. o.nozzles가 있으면 그 값을,
  // 없으면 장비별 기본값(현장 설비처럼 보이는 값)을 그대로 적어 둔다.
  // 열교환기는 자유 노즐 목록(nozList)이 정본 — 위치·방향·개수·관경을 사용자가 직접 고른다.
  if (type === 'hx') {
    spec.hxType = HX_TYPES.includes(o.hxType) ? o.hxType : 'both';
    spec.nozList = hxNozzlesOf({
      type, nozList: o.nozList, nozzles: o.nozzles,
    });
  } else if (NOZZLE_TYPES.has(type)) spec.nozzles = nozzlesOf({ type, nozzles: o.nozzles });
  // 방향 — 밸브·피팅을 수직 배관에 세울 때 axis: 'y'.
  // (안전밸브는 원래 세로로 서는 부속이라 기본이 'y'다)
  if (AXIS_VALUES.has(o.axis)) spec.axis = o.axis;
  else if (t.vertical) spec.axis = 'y';
  // 축 회전(roll) — 밸브·스트레이너는 관 축은 두고 손잡이만, 그 밖의 부속·장비는
  // 몸체가 유로 축 둘레로 돈다(0~359°).
  if (num(o.roll, 0)) spec.roll = handleRotOf({ roll: o.roll });
  // 좌·우(yaw)·위·아래(pitch) 회전 — 모든 장비·부속 공통(2026-11-25 `31577` 요청).
  if (num(o.yaw, 0)) spec.yaw = norm180(o.yaw);
  if (num(o.pitch, 0)) spec.pitch = norm180(o.pitch);
  // 옆에서 니쁠로 달린 계기 — builders.js가 연결 니쁠을 그린다
  if (o.mount === 'side') spec.mount = 'side';
  // 계기 정면 방향(배관 외벽 바깥 단위벡터) — 다이얼이 이쪽을 보고 니쁠은 반대로 꽂힌다.
  if (Array.isArray(o.normal) && o.normal.length === 3
    && o.normal.every((v) => Number.isFinite(Number(v)))) {
    const n = o.normal.map((v) => round3(Number(v)));
    if (Math.hypot(n[0], n[1], n[2]) > 1e-6) spec.normal = n;
  }
  // 배관 끝에 붙은 부속은 진행 방향 벡터를 기억한다 — 3D 회전을 이 벡터로 잡아
  // 플랜지 원판·밸브 바디가 어느 방향(수직·좌우·45° 경사)에서도 배관 축에 딱 맞는다.
  if (Array.isArray(o.dir) && o.dir.length === 3 && o.dir.every((v) => Number.isFinite(Number(v)))) {
    const d = o.dir.map((v) => round3(Number(v)));
    if (Math.hypot(d[0], d[1], d[2]) > 1e-6) spec.dir = d;
  }
  // 엘보는 관경과 두 다리 방향(inDir·outDir)을 기억한다 — 3D 회전은 이 벡터로 잡는다.
  if (type === 'elbow' || type === 'elbow45') {
    spec.bore = BORES[o.bore] ? o.bore : (BORES[o.bore1] ? o.bore1 : (t.bore || '100A'));
    const dims = elbowDims(type, spec.bore);
    spec.w = o.w == null ? dims.face : num(o.w, dims.face);
    spec.h = dims.r * 2;
    spec.d = dims.r * 2;
    if (Array.isArray(o.inDir) && o.inDir.length === 3) spec.inDir = o.inDir.map((v) => round3(Number(v) || 0));
    if (Array.isArray(o.outDir) && o.outDir.length === 3) spec.outDir = o.outDir.map((v) => round3(Number(v) || 0));
    // 두 다리 방향이 없으면 진행 방향(dir)에서 만든다 — 예전에는 로컬 +X가 진행 방향으로
    // 돌아, 입구가 위를 향한 채 뒤집혀 얹혔다(2026-11-25 `31597` 캡처).
    if (!spec.inDir || !spec.outDir) {
      const dv = Array.isArray(spec.dir) && spec.dir.length === 3 ? spec.dir : [1, 0, 0];
      const l = Math.hypot(num(dv[0], 0), num(dv[1], 0), num(dv[2], 0)) || 1;
      const u = [num(dv[0], 0) / l, num(dv[1], 0) / l, num(dv[2], 0) / l];
      const perp = Math.abs(u[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];   // 수평이면 위, 수직이면 +X로 꺾는다
      let outV = perp;
      if (type === 'elbow45') {
        const dg = [u[0] + perp[0], u[1] + perp[1], u[2] + perp[2]];
        const dl = Math.hypot(dg[0], dg[1], dg[2]) || 1;
        outV = [dg[0] / dl, dg[1] / dl, dg[2] / dl];
      }
      // 입구 면은 진행 방향의 **반대**를 본다 — 직전 배관·플랜지와 마주 본다.
      spec.inDir = [round3(-u[0]), round3(-u[1]), round3(-u[2])];
      spec.outDir = outV.map((v) => round3(v));
      delete spec.dir;
    }
  }
  // 이경 부속(레듀샤·티)은 1차/2차 관경을 기억하고, 실제 관경 크기로 폭을 잡는다.
  if (type === 'reducer' || type === 'tee') {
    spec.bore1 = BORES[o.bore1] ? o.bore1 : (t.bore1 || '100A');
    const d2 = type === 'tee' ? spec.bore1 : (t.bore2 || '50A');
    spec.bore2 = BORES[o.bore2] ? o.bore2 : d2;
    if (o.w == null) spec.w = fittingNaturalWidth(type, spec.bore1, spec.bore2);
    // 티의 분기 방향 — 본관 축 둘레 위·아래·앞·뒤 (기본 위)
    if (type === 'tee') spec.branch = TEE_BRANCHES.includes(o.branch) ? o.branch : 'up';
  }
  return spec;
}

export function makePipe(opts) {
  const o = opts || {};
  const pipe = {
    id: uid('p'),
    kind: 'pipe',
    name: o.name || '배관',
    bore: BORES[o.bore] ? o.bore : '100A',
    material: MATERIALS[o.material] ? o.material : 'carbon',
    // 배관 끝단 연결 방식 — '선택안함'(기본, 아무것도 안 그린다) / 직접 고른 플랜지·단조.
    conn: pipeConnOf(o.conn),
    points: (o.points || []).map((p) => ({ x: num(p.x, 0), y: num(p.y, 0), z: num(p.z, 0) })),
  };
  // 사진에서 읽은 관 색(적색 방청관·은색 아연도)이 있으면 재질색 대신 입힌다.
  const pc = toHexColor(o.color);
  if (pc) pipe.color = pc;
  return pipe;
}

function num(v, d) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : d;
}

// ── 헤더(가로 원통 분배기) 치수 ────────────────────────────────────────
// builders.js의 buildHeader와 AI 후처리 보정이 같은 식을 쓰도록 여기 한 곳에 모은다.
//  · spec.y = 바닥(지지 프레임 밑면), stand = 바닥 → 원통 밑면
//  · cy     = 원통 중심 높이 = stand + h/2,  top = 원통 윗면 = stand + h
//  · along  = 원통이 눕는 수평축 ('x' 기본, rot 90°면 'z')
//  기본 헤더(직경 0.4m)면 stand 0.6m · 중심 0.8m · 윗면 1.0m 다.
export function headerStand(spec) {
  const dia = Math.max(0.15, num(spec && spec.h, 0.4));
  return Math.max(0.3, Math.min(1.2, dia * 1.5));
}

export function headerBody(spec) {
  const dia = Math.max(0.15, num(spec && spec.h, 0.4));
  const L = Math.max(0.6, num(spec && spec.w, 2.4));
  const stand = headerStand(spec);
  const r = ((Math.round(num(spec && spec.rot, 0)) % 360) + 360) % 360;
  return {
    dia,
    R: dia / 2,
    L,
    stand,
    cy: stand + dia / 2,
    top: stand + dia,
    along: (r === 90 || r === 270) ? 'z' : 'x',
  };
}

// ── 장비 노즐 (위·아래·왼쪽·오른쪽 / 펌프는 IN·OUT) ────────────────────────
// 열교환기·헤더·탱크(원형·사각)·펌프의 접속구. 속성 패널에서 방향별 관경을 고르면
// 장비 외벽에서 노즐 목 + 플랜지가 돌출되고, 그 **끝점(플랜지 면) 좌표**로
// ✏️ 손 그리기 스냅과 배관 이어그리기가 정확히 붙는다(높이 Y까지 그대로).
// 좌표는 모두 월드 좌표(m)이고 builders.js·main.js·fusion.js가 같은 값을 쓴다.
export const NOZZLE_DIRS = ['up', 'down', 'left', 'right'];

export const NOZZLE_LABELS = {
  up: '위', down: '아래', left: '왼쪽', right: '오른쪽', in: 'IN 흡입', out: 'OUT 토출',
};

// 노즐 관경 — 현장에서 쓰는 15A~200A. 'none'은 노즐 없음.
export const NOZZLE_NONE = 'none';
export const NOZZLE_SIZES = ['15A', '20A', '25A', '32A', '40A', '50A', '65A', '80A', '100A', '125A', '150A', '200A'];
const NOZZLE_SIZE_SET = new Set(NOZZLE_SIZES);

// 노즐을 가진 장비 — 나머지 부속(밸브·피팅·계기)은 노즐을 갖지 않는다.
export const NOZZLE_TYPES = new Set(['header', 'hx', 'tank', 'stank', 'rtank', 'pump']);

// 장비별 기본 노즐 — 새로 놓았을 때 현장 설비처럼 보이는 값.
// (펌프는 흡입이 토출보다 한 치수 크다: 200A 흡입 · 150A 토출)
const NOZZLE_DEFAULTS = {
  header: { up: '150A', down: '50A' },
  hx: { up: '100A', down: '50A' },
  tank: { up: '25A', left: '50A' },
  stank: { up: '100A', left: '100A' },
  rtank: { left: '150A', right: '100A' },
  pump: { in: '200A', out: '150A' },
};

// 그 장비가 쓸 수 있는 노즐 방향 — 펌프만 인·아웃 2곳이다.
export function nozzleDirsOf(type) {
  if (type === 'pump') return ['in', 'out'];
  return NOZZLE_TYPES.has(type) ? NOZZLE_DIRS.slice() : [];
}

export function nozzleDefaults(type) {
  const src = NOZZLE_DEFAULTS[type] || {};
  const out = {};
  nozzleDirsOf(type).forEach((d) => { out[d] = src[d] || NOZZLE_NONE; });
  return out;
}

// 장비의 노즐 설정 — 저장돼 있으면 그 값을, 없으면(예전 도면·새 장비) 기본값을 쓴다.
// 값이 하나라도 저장돼 있으면 저장본이 정본이다(사용자가 '없음'으로 끈 방향을 되살리지 않는다).
export function nozzlesOf(spec) {
  const dirs = nozzleDirsOf(spec && spec.type);
  const out = {};
  if (!dirs.length) return out;
  const src = spec && spec.nozzles;
  const has = !!(src && typeof src === 'object');
  const base = has ? {} : nozzleDefaults(spec.type);
  dirs.forEach((d) => {
    const v = has ? src[d] : base[d];
    out[d] = NOZZLE_SIZE_SET.has(v) ? v : NOZZLE_NONE;
  });
  return out;
}

export function nozzleBore(spec, dir) {
  const all = nozzlesOf(spec);
  return NOZZLE_SIZE_SET.has(all[dir]) ? all[dir] : null;
}

// 노즐 관경 바꾸기 — 'none'이면 그 방향 노즐을 없앤다.
export function setNozzle(spec, dir, bore) {
  if (!spec) return null;
  const dirs = nozzleDirsOf(spec.type);
  if (!dirs.includes(dir)) return null;
  const all = nozzlesOf(spec);
  all[dir] = NOZZLE_SIZE_SET.has(bore) ? bore : NOZZLE_NONE;
  spec.nozzles = all;
  return all;
}

// ── 열교환기 본체 치수 ───────────────────────────────────────────────────
// 현장 사진(2026-11-25)의 쉘앤튜브형: 쉘 양끝에 볼트 체결 바디 플랜지 2쌍 + 둥근 경판(채널),
// 아래에 사각 새들 2개와 가로 보강 바. builders.js·fusion.js·노즐 좌표가 모두 이 식을 쓴다.
//  · w = 전체 길이(양 끝 경판 포함), h = 쉘 지름, y = 바닥, cy = 쉘 중심 높이
export function hxBody(spec) {
  const L = Math.max(0.6, num(spec && spec.w, 3));
  const dia = Math.max(0.2, num(spec && spec.h, 0.75));
  const R = dia / 2;
  const leg = Math.max(0.22, Math.min(0.55, dia * 0.62));
  const cy = leg + R;
  const bodyLen = Math.max(0.3, L * 0.58);                       // 쉘 길이 — 양끝 플랜지·경판 자리를 남긴다
  const flangeT = Math.min(0.09, Math.max(0.04, R * 0.18));       // 플랜지 한 장 두께
  const flangeR = R * 1.2;                                        // 플랜지 반지름(볼트 자리)
  const headLen = Math.max(0.06, Math.min(bodyLen * 0.2, R * 0.85)); // 경판 원통 길이
  const headR = R * 0.86;
  const capDepth = headR * 0.6;                                    // 둥근 경판 깊이(반구를 X로 누른 값)
  const endX = bodyLen / 2 + flangeT * 2 + headLen + capDepth;     // 경판 꼭대기 = 장비 양 끝
  const flatR = flangeR * 0.92;                                    // 평판 커버(블라인드 플랜지) 반지름
  return { L, dia, R, leg, cy, bodyLen, flangeT, flangeR, headLen, headR, capDepth, endX, flatR, saddleX: bodyLen * 0.31 };
}

// ── 열교환기 자유 노즐 ───────────────────────────────────────────────────
// 열교환기는 현장마다 노즐 위치·개수·방향·관경이 다르다 — 고정 4방향이 아니라
// 원하는 자리에 원하는 만큼 뽑을 수 있게 목록(nozList)으로 기억한다.
//  · at  : 쉘 길이 방향 자리 (좌측 헤드·쉘 좌측·쉘 중앙·쉘 우측·우측 헤드)
//  · dir : 뽑는 방향 (위·아래·앞·뒤 / 좌측 끝·우측 끝 = 경판 중심 축방향)
//  · bore: KS 표준 관경
// 좌·우 끝 노즐은 경판 꼭대기에서 축방향으로 나오므로 at이 좌·우 헤드로 고정된다.
export const HX_AT = ['headL', 'shellL', 'shellC', 'shellR', 'headR'];
export const HX_AT_LABELS = {
  headL: '좌측 헤드', shellL: '쉘 좌측', shellC: '쉘 중앙', shellR: '쉘 우측', headR: '우측 헤드',
};
export const HX_NOZ_DIRS = ['up', 'down', 'front', 'back', 'left', 'right'];
export const HX_NOZ_DIR_LABELS = {
  up: '위', down: '아래', front: '앞', back: '뒤', left: '좌측 끝', right: '우측 끝',
};
const HX_AXIAL = new Set(['left', 'right']);

// ── 열교환기 헤드 타입 ─────────────────────────────────────────────────
// both : 양쪽 둥근 타입 — 좌·우 모두 볼트 플랜지 + 둥근 경판
// one  : 한쪽 둥근 타입 — 왼쪽은 둥근 경판, 오른쪽은 평판 커버 (rot 180°로 반전)
// flat : 양쪽 평판 타입 — 좌·우 모두 볼트 플랜지 + 평판 커버
export const HX_TYPES = ['both', 'one', 'flat'];
export const HX_TYPE_LABELS = { both: '양쪽 둥근', one: '한쪽 둥근', flat: '양쪽 평판' };
export const HX_TYPE_DESC = {
  both: '좌·우 모두 볼트 플랜지 + 둥근 경판',
  one: '왼쪽 둥근 경판 · 오른쪽 평판 커버 (회전 180°로 반전)',
  flat: '좌·우 모두 볼트 플랜지 + 평판 커버',
};

export function hxTypeOf(spec) {
  const t = spec && spec.hxType;
  return HX_TYPES.includes(t) ? t : 'both';
}

// 그쪽(+1 오른쪽 / -1 왼쪽) 헤드가 둥근가? 평판인가?
export function hxHeadRound(spec, side) {
  const t = hxTypeOf(spec);
  if (t === 'both') return true;
  if (t === 'flat') return false;
  return side < 0;   // one — 왼쪽만 둥글다
}

// 새 열교환기의 기본 노즐 — 사진처럼 상단(쉘 좌측) 100A · 하단 드레인(쉘 우측) 50A
const HX_DEFAULT_LIST = [
  ['shellL', 'up', '100A'],
  ['shellR', 'down', '50A'],
];

export function hxDefaultNozzles() {
  return HX_DEFAULT_LIST.map(([at, dir, bore], i) => ({ nid: `n${i + 1}`, at, dir, bore }));
}

// 빠른 프리셋 — 모바일에서 한 번에 고르고 아래에서 미세 조정한다.
export const HX_PRESETS = [
  { key: 'basic', label: '기본 (상2·하2)', list: [
    ['shellL', 'up', '100A'], ['shellR', 'up', '100A'], ['shellL', 'down', '50A'], ['shellR', 'down', '50A'],
  ] },
  { key: 'top2end', label: '상단 좌/우 + 우측', list: [
    ['shellL', 'up', '100A'], ['shellR', 'up', '80A'], ['headR', 'right', '150A'],
  ] },
  { key: 'minimal', label: '최소 (상1·하1)', list: [
    ['shellC', 'up', '100A'], ['shellC', 'down', '50A'],
  ] },
  { key: 'heads', label: '헤드 좌·우 (끝)', list: [
    ['headL', 'left', '150A'], ['headR', 'right', '150A'],
  ] },
  { key: 'clear', label: '모두 비우기', list: [] },
];

function freshHxNid(list) {
  const used = new Set((list || []).map((n) => n && n.nid));
  let i = 1;
  while (used.has(`n${i}`)) i += 1;
  return `n${i}`;
}

// 노즐 한 개 정규화 — 모르는 값은 안전한 기본으로 되돌리고, 좌·우 끝은 경판 자리로 맞춘다.
function normHxNozzle(n, idx) {
  if (!n || typeof n !== 'object') return null;
  const dir = HX_NOZ_DIRS.includes(n.dir) ? n.dir : 'up';
  let at = HX_AT.includes(n.at) ? n.at : 'shellC';
  if (dir === 'left') at = 'headL';
  else if (dir === 'right') at = 'headR';
  const nid = typeof n.nid === 'string' && n.nid ? n.nid
    : (typeof n.id === 'string' && n.id ? n.id : `n${(idx || 0) + 1}`);
  return { nid, at, dir, bore: NOZZLE_SIZE_SET.has(n.bore) ? n.bore : '100A' };
}

// 열교환기의 노즐 목록 — 저장본(nozList)이 정본이다.
// 예전 도면의 방향별 관경(nozzles: up/down/left/right)은 같은 자리의 자유 노즐로 옮기고,
// 둘 다 없으면(새 장비) 기본 목록을 쓴다. 목록이 빈 배열이면 '노즐 없음'이 그대로 유지된다.
export function hxNozzlesOf(spec) {
  if (!spec || spec.type !== 'hx') return [];
  // 저장본이 배열이면 그것이 목록이다 (nozList가 정본, 예전 내보내기 JSON은 nozzles 배열).
  const src = Array.isArray(spec.nozList) ? spec.nozList
    : (Array.isArray(spec.nozzles) ? spec.nozzles : null);
  if (src) {
    const out = [];
    const seen = new Set();
    src.forEach((n, i) => {
      const v = normHxNozzle(n, i);
      if (!v) return;
      if (seen.has(v.nid)) v.nid = freshHxNid(out);
      seen.add(v.nid);
      out.push(v);
    });
    return out;
  }
  if (spec.nozzles && typeof spec.nozzles === 'object') {
    const legacy = nozzlesOf({ type: 'hx', nozzles: spec.nozzles });
    const out = [];
    [['up', 'shellC'], ['down', 'shellC'], ['left', 'headL'], ['right', 'headR']].forEach(([d, at]) => {
      if (NOZZLE_SIZE_SET.has(legacy[d])) out.push({ nid: `n${out.length + 1}`, at, dir: d, bore: legacy[d] });
    });
    return out;
  }
  return hxDefaultNozzles();
}

// 노즐 이름 (화면·토스트) — "쉘 좌측 위"처럼 자리와 방향을 함께 보여 준다.
export function hxNozzleLabel(n) {
  if (!n) return '';
  return `${HX_AT_LABELS[n.at] || ''} ${HX_NOZ_DIR_LABELS[n.dir] || ''}`.trim();
}

// 노즐 한 개 바꾸기 — 넘어온 값(위치·방향·관경)만 바꾼다.
export function setHxNozzle(spec, nid, patch) {
  if (!spec || spec.type !== 'hx') return null;
  const list = hxNozzlesOf(spec);
  const i = list.findIndex((n) => n.nid === nid);
  if (i < 0) return null;
  const next = normHxNozzle({ ...list[i], ...(patch || {}) }, i);
  list[i] = next;
  spec.nozList = list;
  delete spec.nozzles;
  return next;
}

// 노즐 추가 — 아직 쓰지 않은 자리(위치+방향)를 골라 놓는다.
// 자리가 다 찼으면 겹쳐도 하나 더 놓는다(사용자가 직접 자리를 옮길 수 있다).
export function addHxNozzle(spec, patch) {
  if (!spec || spec.type !== 'hx') return null;
  const list = hxNozzlesOf(spec);
  const p = patch || {};
  let at = p.at;
  let dir = p.dir;
  if (!at || !dir) {
    const taken = new Set(list.map((n) => `${n.at}|${n.dir}`));
    const free = [
      ['shellC', 'up'], ['shellL', 'up'], ['shellR', 'up'], ['headL', 'up'], ['headR', 'up'],
      ['shellC', 'down'], ['shellL', 'down'], ['shellR', 'down'], ['headL', 'down'], ['headR', 'down'],
      ['shellC', 'front'], ['shellL', 'front'], ['shellR', 'front'],
      ['shellC', 'back'], ['shellL', 'back'], ['shellR', 'back'],
      ['headL', 'left'], ['headR', 'right'],
    ].find(([a, d]) => !taken.has(`${a}|${d}`)) || ['shellC', 'up'];
    at = at || free[0];
    dir = dir || free[1];
  }
  const n = normHxNozzle({ nid: freshHxNid(list), at, dir, bore: p.bore || '50A' }, list.length);
  list.push(n);
  spec.nozList = list;
  delete spec.nozzles;
  return n;
}

// 노즐 삭제 — 남은 노즐 id는 그대로 둔다(선택·커서가 다른 노즐로 튀지 않게).
export function removeHxNozzle(spec, nid) {
  if (!spec || spec.type !== 'hx') return null;
  const list = hxNozzlesOf(spec).filter((n) => n.nid !== nid);
  spec.nozList = list;
  delete spec.nozzles;
  return list;
}

// 프리셋 적용 — 목록을 통째로 바꾼다.
export function applyHxPreset(spec, key) {
  const p = HX_PRESETS.find((x) => x.key === key);
  if (!spec || spec.type !== 'hx' || !p) return null;
  const list = p.list.map(([at, dir, bore], i) => normHxNozzle({ nid: `n${i + 1}`, at, dir, bore }, i));
  spec.nozList = list;
  delete spec.nozzles;
  return list;
}

// ── 노즐이 붙는 외벽 자리 (장비 로컬 좌표) ────────────────────────────────
// builders.js가 그리는 본체 치수와 정확히 같은 식을 쓴다. p = 외벽 접합점,
// axis = 노즐이 뻗는 바깥 방향(단위벡터).
function nozzleAnchors(spec) {
  const t = spec && spec.type;
  const g = {};
  // 열교환기는 자유 노즐(hxNozzleAnchor)을 쓴다 — 예전 4방향 고정 자리는 없다.
  if (t === 'header') {
    const b = headerBody(spec);
    const endX = b.L / 2 + b.R * 0.55;
    g.up = { p: [0, b.cy + b.R, 0], axis: [0, 1, 0] };
    g.down = { p: [0, b.cy - b.R, 0], axis: [0, -1, 0] };
    g.left = { p: [-endX, b.cy, 0], axis: [-1, 0, 0] };
    g.right = { p: [endX, b.cy, 0], axis: [1, 0, 0] };
    return g;
  }
  if (t === 'tank') {
    // 세운 원통 드럼 — 위는 윗면, 아래는 바닥, 좌·우는 옆면.
    const r = Math.max(0.12, num(spec.w, 0.6) / 2);
    const h = Math.max(0.2, num(spec.h, 0.9));
    g.up = { p: [0, h * 0.98, 0], axis: [0, 1, 0] };
    g.down = { p: [0, h * 0.02, 0], axis: [0, -1, 0] };
    g.left = { p: [-r, h * 0.55, 0], axis: [-1, 0, 0] };
    g.right = { p: [r, h * 0.55, 0], axis: [1, 0, 0] };
    return g;
  }
  if (t === 'stank') {
    // 대형 원통 저장탱크 — 로컬 0.9R·3.0H 원통을 w·h·d 배율로 늘린 본체.
    const sx = Math.max(0.2, num(spec.w, 2) / 2.0);
    const sy = Math.max(0.2, num(spec.h, 3) / 3.0);
    const R = 0.9 * sx;
    g.up = { p: [0, 2.72 * sy, 0], axis: [0, 1, 0] };
    g.down = { p: [0, 0.55 * sy, 0], axis: [0, -1, 0] };
    g.left = { p: [-R, 1.55 * sy, 0], axis: [-1, 0, 0] };
    g.right = { p: [R, 1.55 * sy, 0], axis: [1, 0, 0] };
    return g;
  }
  if (t === 'rtank') {
    // 사각 탱크 — 위·아래는 뚜껑/바닥, 좌·우는 가로(W) 옆면.
    const sx = Math.max(0.2, num(spec.w, 2.4) / 2.4);
    const sy = Math.max(0.2, num(spec.h, 1.8) / 1.8);
    const W = 2.2 * sx;
    g.up = { p: [0, 1.72 * sy, 0], axis: [0, 1, 0] };
    g.down = { p: [0, 0.1 * sy, 0], axis: [0, -1, 0] };
    g.left = { p: [-W / 2, 1.0 * sy, 0], axis: [-1, 0, 0] };
    g.right = { p: [W / 2, 1.0 * sy, 0], axis: [1, 0, 0] };
    return g;
  }
  if (t === 'pump') {
    // 원심펌프 — 흡입은 케이싱 앞(+Z), 토출은 위(+Y). 끝점은 펌프 도면 그대로 고정이라
    // 관경을 바꿔도 스냅 자리가 움직이지 않는다(목 굵기만 바뀐다).
    const sx = Math.max(0.2, num(spec.w, 1.15) / 1.15);
    const sy = Math.max(0.2, num(spec.h, 0.85) / 0.85);
    const sz = Math.max(0.2, num(spec.d, 0.6) / 0.6);
    g.in = {
      p: [0.12 * sx, 0.42 * sy, 0.2 * sz], axis: [0, 0, 1],
      tip: [0.12 * sx, 0.42 * sy, 0.39 * sz],
    };
    g.out = {
      p: [0.12 * sx, 0.58 * sy, 0], axis: [0, 1, 0],
      tip: [0.12 * sx, 0.745 * sy, 0],
    };
    return g;
  }
  return g;
}

// 노즐 목 길이(m) — 관경이 클수록 조금 길게. 끝면은 여기에 플랜지 두께를 더한 곳.
const NOZZLE_NECK_MIN = 0.10;
const NOZZLE_NECK_MAX = 0.30;
const NOZZLE_FLANGE_T = 0.03;

// 열교환기 자유 노즐의 외벽 자리 (로컬 좌표)
//  · 위·아래·앞·뒤는 그 자리의 외벽(쉘이면 R, 헤드면 headR)에 수직으로,
//  · 좌·우 끝은 둥근 경판 꼭대기에서 축방향으로 나온다.
function hxNozzleAnchor(spec, n) {
  const B = hxBody(spec);
  const headCenter = B.bodyLen / 2 + B.flangeT * 2 + B.headLen * 0.5;
  const xAt = {
    headL: -headCenter,
    shellL: -B.bodyLen * 0.3,
    shellC: 0,
    shellR: B.bodyLen * 0.3,
    headR: headCenter,
  }[n.at] || 0;
  if (HX_AXIAL.has(n.dir)) {
    const sx = n.dir === 'left' ? -1 : 1;
    return { p: [sx * B.endX, B.cy, 0], axis: [sx, 0, 0] };
  }
  // 위·아래·앞·뒤는 그 자리의 원통 외벽 — 헤드 쪽이면 헤드 반지름
  const rad = (n.at === 'headL' || n.at === 'headR') ? B.headR : B.R;
  if (n.dir === 'up') return { p: [xAt, B.cy + rad, 0], axis: [0, 1, 0] };
  if (n.dir === 'down') return { p: [xAt, B.cy - rad, 0], axis: [0, -1, 0] };
  if (n.dir === 'front') return { p: [xAt, B.cy, rad], axis: [0, 0, 1] };
  return { p: [xAt, B.cy, -rad], axis: [0, 0, -1] };
}

// 노즐 하나를 월드 좌표로 — 장비 자세(rot · 3축 회전)를 그대로 적용하고,
// 끝점은 목+플랜지 두께만큼 바깥.
function nozzleEntry(spec, dir, bore, a, extra) {
  if (!a) return null;
  const r = boreOd(bore) / 2;
  const neck = Math.max(NOZZLE_NECK_MIN, Math.min(NOZZLE_NECK_MAX, 0.10 + 2.0 * r));
  // 몸체와 같은 회전행렬 — 회전(rot)·좌우(yaw)·위아래(pitch)·축(roll)을 모두 반영해
  // 노즐도 몸체와 함께 돈다 (buildEquipment와 같은 식).
  const M = equipBasis(spec);
  const toWorld = (p) => {
    const w = matVec(M, p);
    return {
      x: round3(num(spec.x, 0) + w[0]),
      y: round3(Math.max(0, num(spec.y, 0) + w[1])),
      z: round3(num(spec.z, 0) + w[2]),
    };
  };
  const rotV = (v) => {
    const w = matVec(M, [v[0], v[1], v[2]]);
    return { x: w[0], y: w[1], z: w[2] };
  };
  const axis = rotV(a.axis);
  const base = toWorld(a.p);
  const tip = a.tip
    ? toWorld(a.tip)
    : {
      x: round3(base.x + axis.x * (neck + NOZZLE_FLANGE_T)),
      y: round3(Math.max(0, base.y + axis.y * (neck + NOZZLE_FLANGE_T))),
      z: round3(base.z + axis.z * (neck + NOZZLE_FLANGE_T)),
    };
  const len = Math.hypot(tip.x - base.x, tip.y - base.y, tip.z - base.z);
  if (len < 1e-4) return null;
  return {
    dir,
    bore,
    r: round3(r),
    base,
    tip,
    axis: { x: round3(axis.x), y: round3(axis.y), z: round3(axis.z) },
    len: round3(len),
    ...(extra || {}),
  };
}

// 장비의 노즐 목록 (월드 좌표).
//  · base : 장비 외벽에 닿는 접합점
//  · tip  : 플랜지 접합면 = 배관이 시작되는 점 (손 그리기 스냅 좌표)
//  · axis : 바깥으로 뻗는 방향 (이어 그리는 배관의 초기 방향)
//  · r    : 관 외경 반지름, len = 목+플랜지 길이
//  · hx는 nid·at·label이 함께 온다 (같은 방향에 여러 개가 있을 수 있어 id로 구분)
export function equipNozzles(spec) {
  if (!spec) return [];
  // 열교환기 — 자유 노즐 목록(nozList)이 정본이다. 위치·방향·개수·관경이 모두 자유롭다.
  if (spec.type === 'hx') {
    const out = [];
    hxNozzlesOf(spec).forEach((n) => {
      const e = nozzleEntry(spec, n.dir, n.bore, hxNozzleAnchor(spec, n), {
        nid: n.nid, at: n.at, label: hxNozzleLabel(n),
      });
      if (e) out.push(e);
    });
    return out;
  }
  const dirs = nozzleDirsOf(spec.type);
  if (!dirs.length) return [];
  const anchors = nozzleAnchors(spec);
  const out = [];
  dirs.forEach((dir) => {
    const bore = nozzleBore(spec, dir);
    const a = anchors[dir];
    if (!bore || !a) return;
    const e = nozzleEntry(spec, dir, bore, a);
    if (e) out.push(e);
  });
  return out;
}

// 부속의 접속면 전체(플랜지 체결·용접 모두) — **회전해도 연결을 유지**할 때 쓴다.
// 회전 버튼은 부속을 제 중심으로 돌리므로, 아래에 닿아 있던 면이 공중으로 떠 버린다.
// main.js가 회전 전에 이 목록에서 '지금 붙어 있는 면'을 기억하고, 회전 뒤 같은 면이
// 그 자리에 0mm로 다시 앉도록 중심(x·y·z)을 옮긴다 (2026-11-25 `31585` 캡처).
export function equipConnectFaces(spec) {
  if (!spec || !spec.type) return [];
  // 티 — 직진 A·B + 분기 세 접속구
  if (spec.type === 'tee') return teePorts(spec);
  // 엘보 — 두 다리 끝면 (elbowDims().face)
  //  90° : 두 다리가 직각 → 로컬 X(입구)와 Y(출구) 축 그대로 face만큼.
  //  45° : 두 다리가 135° → 출구 다리는 로컬 X·Y 사이 대각선(-0.707, +0.707) 위에 있다.
  //        (예전엔 90°처럼 Y축 위에 잡아, 포트 자리에 붙인 배관이 엘보 메쉬와 어긋났다 — 2026-11-26)
  if (spec.type === 'elbow' || spec.type === 'elbow45') {
    const dims = elbowDims(spec.type, spec.bore || '100A');
    const b = equipBasis(spec);
    const col = (i) => ({ x: b[i], y: b[3 + i], z: b[6 + i] });
    const cx = col(0);
    const cy = col(1);
    const tipAt = (ax) => ({
      x: round3(num(spec.x, 0) + ax.x * dims.face),
      y: round3(num(spec.y, 0) + ax.y * dims.face),
      z: round3(num(spec.z, 0) + ax.z * dims.face),
    });
    if (spec.type === 'elbow45') {
      const ux = -Math.SQRT1_2;
      const uy = Math.SQRT1_2;
      const axB = { x: cx.x * ux + cy.x * uy, y: cx.y * ux + cy.y * uy, z: cx.z * ux + cy.z * uy };
      const l = Math.hypot(axB.x, axB.y, axB.z) || 1;
      const uB = { x: round3(axB.x / l), y: round3(axB.y / l), z: round3(axB.z / l) };
      return [
        { nid: 'legA', tip: tipAt(cx), axis: cx },
        { nid: 'legB', tip: tipAt(uB), axis: uB },
      ];
    }
    return [cx, cy].map((ax, i) => ({ nid: i === 0 ? 'legA' : 'legB', tip: tipAt(ax), axis: ax }));
  }
  // 플랜지로 체결하는 부속(밸브·신축관·유량계·플랜지) — 양쪽 접합면
  const fl = flangedPorts(spec);
  if (fl.length) return fl;
  // 레듀샤·니쁠·캡·유니온 — 유로 축 양끝 면(용접·나사)
  const half = Math.abs(num(spec.w, 0)) / 2;
  if (!(half > 0.005)) return [];
  const a = equipFlowAxis(spec);
  return [-1, 1].map((sg) => {
    const axis = { x: a.x * sg, y: a.y * sg, z: a.z * sg };
    return {
      nid: sg < 0 ? 'faceA' : 'faceB',
      tip: {
        x: round3(num(spec.x, 0) + axis.x * half),
        y: round3(Math.max(0, num(spec.y, 0) + axis.y * half)),
        z: round3(num(spec.z, 0) + axis.z * half),
      },
      axis,
    };
  });
}

// ── 티(분기관) 접속구 — 직진 양끝 + 분기 끝 ────────────────────────────────
// 티는 본관(1차)과 분기(2차) 관경이 다를 수 있고(이경 티), 분기 방향도 배관 축 둘레로
// 위·아래·앞·뒤 4방향 중 고를 수 있다. 세 접속구 모두 3D에서 직접 눌러 그 자리에서
// 배관을 이어 그린다 — 열교환기·펌프 노즐과 같은 길(equipPorts).
export const TEE_BRANCHES = ['up', 'down', 'front', 'back'];
export const TEE_BRANCH_LABELS = { up: '위', down: '아래', front: '앞', back: '뒤' };
export const TEE_PORT_LABELS = { runA: '직진 A', runB: '직진 B', branch: '분기' };

// 분기 방향 — 티 자신의 좌표계(본관 축 = 로컬 X)에서 수직인 네 방향.
export function teeBranch(spec) {
  const b = spec && spec.branch;
  if (b === 'down') return [0, -1, 0];
  if (b === 'front') return [0, 0, 1];
  if (b === 'back') return [0, 0, -1];
  return [0, 1, 0];
}

// 3x3 회전행렬 도우미 (row-major, world = M · local)
function rotYM(deg) {
  const t = num(deg, 0) * Math.PI / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [c, 0, s, 0, 1, 0, -s, 0, c];
}
function matMul(a, b) {
  const o = new Array(9).fill(0);
  for (let r = 0; r < 3; r += 1) {
    for (let c = 0; c < 3; c += 1) {
      o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    }
  }
  return o;
}
function matVec(m, v) {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

// buildTee()와 정확히 같은 치수·자세 — 로컬 치수를 월드로 옮기는 데 쓴다.
//  · L = 본관 길이, H = 분기 길이, s = 배관 관경에 맞춘 배율(균등)
//  · 자세는 builders.js buildEquipment()와 같은 순서(dir → axis:'y' → rot)
function teeFrame(spec) {
  const b1 = spec.bore1 && BORES[spec.bore1] ? spec.bore1 : '100A';
  const b2 = spec.bore2 && BORES[spec.bore2] ? spec.bore2 : b1;
  const r1 = boreOd(b1) / 2;
  // buildTee()와 같은 표준 치수 — 본관 2C, 분기 C (KS B 1522 / ASME B16.9)
  const td = teeDims(b1);
  const L = td.L;
  const H = td.H;
  const w = num(spec.w, fittingNaturalWidth('tee', b1, b2));
  const s = Math.max(0.05, w) / L;
  let M = rotYM(num(spec.rot, 0));
  const dv = Array.isArray(spec.dir) && spec.dir.length === 3
    ? spec.dir.map((v) => Number(v)) : null;
  if (dv && Math.hypot(dv[0], dv[1], dv[2]) > 1e-6) M = dirBasis(dv);
  else if (spec.axis === 'y') M = matMul(rotYM(num(spec.rot, 0)), dirBasis([0, 1, 0]));
  // 3축 회전도 몸체와 같이 적용 — 분기 방향·접속구 좌표가 같이 돈다.
  M = rollBasis(extraBasis(M, spec.yaw, spec.pitch), rollOf(spec));
  return { b1, b2, r1, r2: boreOd(b2) / 2, L, H, s, M };
}

// 티의 세 접속구 (월드 좌표) — nid: runA(직진 −X 끝) · runB(직진 +X 끝) · branch(분기 끝)
export function teePorts(spec) {
  if (!spec || spec.type !== 'tee') return [];
  const F = teeFrame(spec);
  const B = teeBranch(spec);
  const at = (v) => {
    const w = matVec(F.M, v);
    return {
      x: round3(num(spec.x, 0) + w[0]),
      y: round3(Math.max(0, num(spec.y, 0) + w[1])),
      z: round3(num(spec.z, 0) + w[2]),
    };
  };
  const dirOf = (v) => {
    const w = matVec(F.M, v);
    const l = Math.hypot(w[0], w[1], w[2]) || 1;
    return { x: round3(w[0] / l), y: round3(w[1] / l), z: round3(w[2] / l) };
  };
  const H = F.H * F.s;
  const half = (F.L / 2) * F.s;
  const mk = (nid, p, axis, bore) => ({
    nid,
    dir: nid,
    bore,
    label: TEE_PORT_LABELS[nid],
    r: round3(boreOd(bore) / 2),
    base: { x: round3(p.x - axis.x * 0.02), y: round3(Math.max(0, p.y - axis.y * 0.02)), z: round3(p.z - axis.z * 0.02) },
    tip: p,
    axis,
    len: 0.02,
  });
  return [
    mk('runA', at([-half, 0, 0]), dirOf([-1, 0, 0]), F.b1),
    mk('runB', at([half, 0, 0]), dirOf([1, 0, 0]), F.b1),
    mk('branch', at([B[0] * H, B[1] * H, B[2] * H]), dirOf(B), F.b2),
  ];
}

// 장비·부속의 접속구 — 노즐이 있는 장비는 노즐, 티는 직진 양끝 + 분기 끝,
// 플랜지로 체결하는 부속(밸브·신축관·유량계·플랜지)은 **양쪽 플랜지 접합면**이다.
export function equipPorts(spec) {
  if (!spec) return [];
  if (spec.type === 'tee') return teePorts(spec);
  return [...equipNozzles(spec), ...flangedPorts(spec)];
}

// 플랜지로 체결하는 부속 — 배관이 이 접합면에 맞물림 플랜지로 붙는다.
// (엘보·티·레듀샤는 용접, 장비는 제 노즐 플랜지가 있다)
export const FLANGE_MATE_TYPES = new Set(['valve', 'bfly', 'yvalve', 'ball', 'check', 'bellows', 'flow']);

// 부속의 플랜지 접합면 두 곳 — 손 그리기·잇기가 이 자리에 배관을 붙이고,
// 그 자리에 90°로 들어가면 엘보가 서고 맞물림 플랜지가 붙는다 (2026-11-25 `31578`).
export function flangedPorts(spec) {
  if (!spec || !spec.type) return [];
  const standalone = spec.type === 'flange';
  if (!standalone && !FLANGE_MATE_TYPES.has(spec.type)) return [];
  if (!standalone && (spec.conn || 'flange') === 'forged') return [];
  const half = Math.abs(num(spec.w, 0)) / 2;
  if (!(half > 0.005)) return [];
  const a = equipFlowAxis(spec);
  const bore = BORES[spec.bore] ? spec.bore : null;
  const r = flangeOd(bore || SIZE_REF_BORE) / 2;
  const out = [];
  [-1, 1].forEach((sg) => {
    const axis = { x: a.x * sg, y: a.y * sg, z: a.z * sg };
    const tip = {
      x: round3(num(spec.x, 0) + axis.x * half),
      y: round3(Math.max(0, num(spec.y, 0) + axis.y * half)),
      z: round3(num(spec.z, 0) + axis.z * half),
    };
    out.push({
      nid: sg < 0 ? 'faceA' : 'faceB',
      dir: null,
      bore,
      label: '접합면',
      r: round3(r),
      base: { x: round3(tip.x - axis.x * 0.02), y: round3(Math.max(0, tip.y - axis.y * 0.02)), z: round3(tip.z - axis.z * 0.02) },
      tip,
      axis: { x: round3(axis.x), y: round3(axis.y), z: round3(axis.z) },
      len: 0.02,
      seat: 'flange',
      equipId: spec.id,
      equipName: spec.name || '',
    });
  });
  return out;
}

// ── 장비 본체가 차지하는 공간 ────────────────────────────────────────
// 밸브·피팅이 헤더·탱크 본체 안에 잠기는지 판정하는 데 쓴다.
// 본체끼리는 서로를 밀어내지 않도록 BODY_LIKE로 따로 묶는다.
export const BODY_LIKE = new Set(['header', 'hx', 'tank', 'stank', 'rtank', 'pump', 'vpump', 'panel']);

// 장비 로컬 좌표(회전 전) — rot는 Y축 회전이다.
function toLocal2D(spec, x, z) {
  const th = num(spec && spec.rot, 0) * Math.PI / 180;
  const c = Math.cos(th);
  const s = Math.sin(th);
  const dx = x - num(spec && spec.x, 0);
  const dz = z - num(spec && spec.z, 0);
  return { lx: dx * c - dz * s, lz: dx * s + dz * c };
}

// 본체의 수평 자리(평면 투영)에 (x, z)가 들어오는지 — 높이와 상관없이 본체 위인지 본다.
// AI가 배관 끝·부속 높이를 헤더·탱크 윗면에 맞출 때 쓴다.
export function insideFootprint(spec, x, z, margin) {
  if (!spec) return false;
  const m = margin || 0;
  const { lx, lz } = toLocal2D(spec, x, z);
  if (spec.type === 'header') {
    const b = headerBody(spec);
    const along = b.along === 'z' ? lz : lx;
    const across = b.along === 'z' ? lx : lz;
    return Math.abs(along) <= b.L / 2 + m && Math.abs(across) <= b.R + m;
  }
  if (spec.type === 'tank' || spec.type === 'stank') {
    return Math.hypot(lx, lz) <= Math.max(0.12, num(spec.w, 0.6) / 2) + m;
  }
  if (spec.type === 'rtank') {
    return Math.abs(lx) <= num(spec.w, 2.4) / 2 + m && Math.abs(lz) <= num(spec.d, 1.8) / 2 + m;
  }
  if (spec.type === 'hx') {
    return Math.abs(lx) <= num(spec.w, 3) / 2 + m && Math.abs(lz) <= num(spec.h, 0.75) / 2 + m;
  }
  return false;
}

// 장비 하나의 본체 영역 → { top, bottom, contains(x, y, z, margin) } (없으면 null)
export function equipBody(spec) {
  if (!spec) return null;
  const y0 = num(spec.y, 0);
  if (spec.type === 'header') {
    const b = headerBody(spec);
    const cy = y0 + b.cy;
    return {
      top: y0 + b.top,
      bottom: y0 + b.stand,
      contains: (x, y, z, m) => {
        const g = m || 0;
        const { lx, lz } = toLocal2D(spec, x, z);
        const along = b.along === 'z' ? lz : lx;
        const across = b.along === 'z' ? lx : lz;
        return Math.abs(along) <= b.L / 2 + g
          && y >= y0 + b.stand - g && y <= y0 + b.top + g
          && Math.hypot(across, y - cy) <= b.R + g;
      },
    };
  }
  if (spec.type === 'tank' || spec.type === 'stank') {
    const r = Math.max(0.12, num(spec.w, 0.6) / 2);
    const h = Math.max(0.2, num(spec.h, 0.9));
    return {
      top: y0 + h,
      bottom: y0,
      contains: (x, y, z, m) => {
        const g = m || 0;
        const { lx, lz } = toLocal2D(spec, x, z);
        return Math.hypot(lx, lz) <= r + g && y >= y0 - g && y <= y0 + h + g;
      },
    };
  }
  if (spec.type === 'rtank') {
    const hw = Math.max(0.2, num(spec.w, 2.4) / 2);
    const hd = Math.max(0.2, num(spec.d, 1.8) / 2);
    const h = Math.max(0.2, num(spec.h, 1.8));
    return {
      top: y0 + h,
      bottom: y0,
      contains: (x, y, z, m) => {
        const g = m || 0;
        const { lx, lz } = toLocal2D(spec, x, z);
        return Math.abs(lx) <= hw + g && Math.abs(lz) <= hd + g && y >= y0 - g && y <= y0 + h + g;
      },
    };
  }
  if (spec.type === 'hx') {
    const dia = Math.max(0.2, num(spec.h, 0.75));
    const R = dia / 2;
    const legH = Math.max(0.22, Math.min(0.55, dia * 0.62));
    const half = Math.max(0.3, num(spec.w, 3) / 2);
    const cy = y0 + legH + R;
    return {
      top: cy + R,
      bottom: cy - R,
      contains: (x, y, z, m) => {
        const g = m || 0;
        const { lx, lz } = toLocal2D(spec, x, z);
        return Math.abs(lx) <= half + g && Math.hypot(lz, y - cy) <= R + g;
      },
    };
  }
  return null;
}

// 수직 배관 구간(위·아래로 뻗은 구간) 목록 — AI가 수직 방향을 빼먹은 밸브를 찾는 데 쓴다.
function verticalRuns(state) {
  const runs = [];
  (state.pipes || []).forEach((p) => {
    const pts = p.points || [];
    for (let i = 1; i < pts.length; i += 1) {
      const a = pts[i - 1];
      const b = pts[i];
      const dy = Math.abs(b.y - a.y);
      const horiz = Math.hypot(b.x - a.x, b.z - a.z);
      if (dy < 0.25 || horiz > dy * 0.35) continue; // 수직에서 20° 넘게 기운 구간은 뺀다
      runs.push({ x: a.x, z: a.z, y0: Math.min(a.y, b.y), y1: Math.max(a.y, b.y), bore: p.bore });
    }
  });
  return runs;
}

// 부속이 수직 배관 위에 있으면 자동으로 세우고(x·z를 배관 중심에 스냅) true
export function standOnVerticalPipe(state, spec, radius) {
  if (!spec || !VERTICAL_TYPES.has(spec.type)) return false;
  if (spec.axis === 'y') return false;
  const limit = radius == null ? 0.35 : radius;
  let best = null;
  let bestD = limit;
  verticalRuns(state).forEach((r) => {
    if (spec.y < r.y0 - 0.45 || spec.y > r.y1 + 0.45) return;
    const d = Math.hypot(spec.x - r.x, spec.z - r.z);
    if (d <= bestD) { bestD = d; best = r; }
  });
  if (!best) return false;
  spec.axis = 'y';
  spec.x = round3(best.x);
  spec.z = round3(best.z);
  if (BORES[best.bore] && isBoreSized(spec.type)) {
    spec.bore = best.bore;
    applyBoreSize(spec);
  }
  return true;
}

// 부속이 헤더·탱크 본체에 묻혔으면 본체 위로 올린다(반복해 다른 본체도 피한다).
// y는 부속 중심이다 — 세워 놓았으면 배관 방향 길이(w)의 절반이 아래로 내려와 본체를 스친다.
export function liftOutOfBodies(state, spec) {
  // 계기는 배관 외벽에 붙는 부속이라 본체와 겹쳐도 올리지 않는다(붙인 자리를 지킨다).
  if (!spec || BODY_LIKE.has(spec.type) || spec.type === 'support' || spec.type === 'gauge') return false;
  const half = spec.axis === 'y'
    ? Math.max(0.02, num(spec.w, 0.1) / 2)
    : Math.max(0.02, num(spec.h, 0.1) / 2);
  let moved = false;
  for (let guard = 0; guard < 4; guard += 1) {
    let hit = null;
    (state.equipment || []).forEach((b) => {
      if (b === spec || BODY_LIKE.has(b.type) === false) return;
      const body = equipBody(b);
      if (!body) return;
      if (body.contains(spec.x, spec.y, spec.z, 0.01)) hit = body;
    });
    if (!hit) break;
    // 본체 윗면에서 부속 반높이 + 2cm 위에 앉힌다 — 노즐자리에서 배관으로 이어진 것처럼 보인다.
    spec.y = round3(hit.top + half + 0.02);
    moved = true;
  }
  return moved;
}

// AI 결과 전체를 한 번에 보정한다 — 수직 배관 위 밸브 세우기 → 본체에 묻힌 부속 올리기.
export function postProcessAi(state) {
  const report = { stood: 0, lifted: 0 };
  (state.equipment || []).forEach((spec) => {
    if (standOnVerticalPipe(state, spec)) report.stood += 1;
  });
  (state.equipment || []).forEach((spec) => {
    if (liftOutOfBodies(state, spec)) report.lifted += 1;
  });
  // 마지막에 계기를 배관 외벽에 다시 붙인다 — 세우기·올리기로 배관 자리가 바뀌었을 수 있다.
  alignGauges(state);
  return report;
}

// ── AI 응답 → 장비 타입 이름 맞추기 ──────────────────────────────────────
// Gemini는 자유 텍스트 타입을 돌려주기도 해서, 긴 이름부터 구체적으로 매칭한다.
// (헤더를 stank/tank로 그리던 문제를 막기 위해 헤더·안전밸브를 앞에서 잡는다)
export function aiTypeOf(type) {
  const s = String(type || '').toLowerCase().trim();
  // 프롬프트에 적힌 정식 type 이름(hx·vpump·bfly·stank…)이 그대로 오면 그대로 쓴다.
  // 예전에는 'hx'가 어느 정규식에도 걸리지 않아 tank로 떨어졌다(열교환기가 드럼으로 그려짐).
  if (EQUIP_TYPES[s]) return s;
  if (/header|헤더|매니폴드|manifold|분배기|분배관|collector|distributor/.test(s)) return 'header';
  if (/safety|relief|prv|안전밸브|안전변|감압밸브|감압변|방출밸브/.test(s)) return 'safety_valve';
  if (/heat|exchang|열교환/.test(s)) return 'hx';
  if (/vertical|inline|입형|인라인/.test(s)) return 'vpump';
  if (/pump|펌프/.test(s)) return 'pump';
  if (/storage|저장탱크|원통|silo|vessel/.test(s)) return 'stank';
  if (/rect|수조|저수조|사각/.test(s)) return 'rtank';
  if (/tank|drum|탱크|드럼/.test(s)) return 'tank';
  if (/panel|mcc|control|전기|제어/.test(s)) return 'panel';
  if (/butterfly|버터플라이|bfly/.test(s)) return 'bfly';
  if (/strainer|스트레이너|y[-_ ]?(type|valve|body)|y형|경사/.test(s)) return 'yvalve';
  if (/ball|볼밸브/.test(s)) return 'ball';
  if (/check|체크/.test(s)) return 'check';
  if (/flow|유량|플로우/.test(s)) return 'flow';
  if (/bellows|expansion|flex|신축|벨로우즈/.test(s)) return 'bellows';
  if (/elbow\s*45|45\s*[°도]?\s*elbow|45도?\s*엘보|45°/.test(s)) return 'elbow45';
  if (/elbow|엘보|90/.test(s)) return 'elbow';
  if (/\btee\b|분기|티/.test(s)) return 'tee';
  if (/reducer|레듀샤|이경|축소/.test(s)) return 'reducer';
  if (/nipple|니쁠|니플/.test(s)) return 'nipple';
  if (/end\s*cap|엔드캡|마개|\bcap\b|캡/.test(s)) return 'cap';
  if (/union|유니온|소켓|커플링/.test(s)) return 'union';
  if (/flange|플랜지/.test(s)) return 'flange';
  if (/support|지지|서포|hanger|saddle/.test(s)) return 'support';
  if (/gauge|압력계|온도계|계기|pg|tg/.test(s)) return 'gauge';
  if (/valve|밸브/.test(s)) return 'valve';
  return 'tank';
}

// ── 결정론적 기하 보정기 ────────────────────────────────────────────────
// AI가 뽑은 JSON을 그대로 그리지 않고, 코드로 한 번 더 정밀하게 맞춘다.
//  ① 헤더·탱크 위로 올라가는 수직 배관 끝을 본체 윗면에 정확히 앉힌다
//  ② 직선 배관끼리 0.15m 안에서 어긋난 연결점은 서로 붙여 주고, 0.25m 안에서 살짝 뜬 끝은
//     다른 배관의 끝점이나 구간(티 분기)에 이어 붙인다 — 공중에 뜬 배관을 없앨
//  ③ 수직 배관(0.4m 이내)에 달린 밸브·피팅은 axis='y'로 세우고 배관 중심(x,z)에 스냅
//  ④ 그 부속이 헤더·탱크 내부에 들어가면 본체 윗면 위로 끌어올림
//  ⑤ 수직 배관 옆의 압력계는 배관 외벽 바깥으로 비켜 세워 관 속에 파묻히지 않게 한다
//  ⑥ 대형 장비(탱크·펌프·열교환기·제어반)끼리 겹치면 XZ에서 최소 여백만큼 밀어낸다
// 원본 AI JSON(장비·배관 배열)을 받아 보정본을 돌려준다.
const SNAP_WELD = 0.15;   // 배관 연결점 불이기 거리
const SNAP_JOINT = 0.25;  // 살짝 뜬 배관 끝을 이어 붙이는 거리 (끝점·구간 모두)
const SNAP_BRANCH = 0.6;  // 허공에 뜬 분기 배관 끝을 다른 배관 중심선에 이어 붙이는 거리
const SNAP_TOUCH = 0.05;  // 이미 닿아 있는 것으로 보는 거리 (이어진 배관은 건드리지 않는다)
const SNAP_VERT = 0.4;    // 수직 배관에 달린 부속으로 보는 거리
// 도면(drawing) 입력에서만 허용하는 초근접 정렬 스냅 — 도면에 그려진 끝을 억지로 잇지 않기 위해
// 0.25m·0.6m 보정을 끄고 이 거리 안의 사실상 같은 점만 맞춘다.
const SNAP_DRAWING = 0.12;
const NOZZLE_MAX = 0.4;  // 장비 노즐로 보는 배관 길이 한계(m) — 이보다 짧고 장비에 붙은 배관은 노즐이다
const EQUIP_GAP = 0.15;   // 대형 장비끼리 최소 여백(m)
// 서로 밀어내는 대형 설비 — 앞뒤 거리감(Z)이 무너지는 걸 막는 대상
const MAIN_BODY_TYPES = new Set(['tank', 'pump', 'hx', 'panel', 'stank', 'rtank']);

// 점 p에서 선분 ab 위 가장 가까운 점 — 배관 구간에 끝점을 붙일 때 쓴다.
function closestOnSegment(p, a, b) {
  const vx = b.x - a.x, vy = b.y - a.y, vz = b.z - a.z;
  const L2 = vx * vx + vy * vy + vz * vz;
  if (L2 < 1e-9) {
    return { d: Math.hypot(p.x - a.x, p.y - a.y, p.z - a.z), x: a.x, y: a.y, z: a.z };
  }
  let t = ((p.x - a.x) * vx + (p.y - a.y) * vy + (p.z - a.z) * vz) / L2;
  t = Math.max(0, Math.min(1, t));
  const x = a.x + vx * t, y = a.y + vy * t, z = a.z + vz * t;
  return { d: Math.hypot(p.x - x, p.y - y, p.z - z), x, y, z };
}

// 장비에 붙은 짧은 배관(0.4m 이하)의 '자유 끝' = 장비 노즐 끝.
// 노즐은 플랜지로 짧게 마감되는 것이 정상이라, 다른 배관·다른 노즐로 끌어당겨 꺾어 붙이면
// 도면·사진과 다른 그림이 된다. 한쪽 끝이 장비 본체(담는 범위 0.2m)나 본체 윗면에 앉은 끝이면 노즐로 본다.
function nozzleFreeEnds(pipes, bodies, seatedEnds) {
  const out = new Set();
  (pipes || []).forEach((p, pi) => {
    const pts = (p && p.points) || [];
    if (pts.length < 2) return;
    let len = 0;
    for (let i = 1; i < pts.length; i += 1) {
      len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y, pts[i].z - pts[i - 1].z);
    }
    if (len > NOZZLE_MAX) return;
    const last = pts.length - 1;
    [0, last].forEach((i) => {
      if (seatedEnds.has(`${pi}:${i}`)) return;
      const q = pts[i === 0 ? 1 : last - 1];
      const mounts = (bodies || []).some((b) => b.body.contains(q.x, q.y, q.z, 0.12));
      if (mounts) out.add(`${pi}:${i}`);
    });
  });
  return out;
}

// 도면대로 열린 채 둔 배관 끝 개수 — 다른 배관에 닿지도, 장비 본체에 붙지도 않은 끝
function countDrawnOpenEnds(pipes, bodies) {
  let n = 0;
  (pipes || []).forEach((p, pi) => {
    const pts = (p && p.points) || [];
    [0, pts.length - 1].forEach((i) => {
      const q = pts[i];
      if (!q) return;
      if ((bodies || []).some((b) => b.body.contains(q.x, q.y, q.z, 0.15))) return;
      let touch = false;
      (pipes || []).forEach((o, oi) => {
        if (touch || oi === pi) return;
        const q2 = o.points || [];
        for (let k = 1; k < q2.length && !touch; k += 1) {
          if (closestOnSegment(q, q2[k - 1], q2[k]).d <= SNAP_TOUCH) touch = true;
        }
      });
      if (!touch) n += 1;
    });
  });
  return n;
}

// ②-c 허공에 뜬 분기 배관 끝을 0.6m 안의 다른 배관 중심선에 이어 붙인다.
// AI가 현장 사진의 ㄷ자·ㄱ자 분기를 "대충 근처"로 적어 주면 끝점이 도착 배관에서 0.3~0.6m
// 떨어진 공중에 남는다. ②-b(0.25m)로도 못 붙인 끝을 골라, 가장 가까운 상대 배관 선분의
// 직교 투영점(= 상대 배관 중심선 위)으로 끝점을 끌어온다.
//   · 자기 자신 제외 · 이미 0.05m 안으로 닿은 끝은 그대로 둔다(이미 이어진 배관)
//   · 장비 노즐에 앉힌 끝(seatedEnds)은 건드리지 않는다 — 헤더·탱크 연결을 지킨다
//   · 끝이 향하는 **뒤쪽**에 있는 배관으로는 끌어오지 않는다 — 화면 밖으로 나가는 주배관 끝이
//     옆 분기 끝에 끌려가 주배관이 꺾이는 것을 막는 검사
//   · 내려오는(올라가는) 수직 구간은 기울이지 않는다 — 끝점과 위 꺾임점의 (x, z)를 같이 옮긴다
function connectOpenEnds(pipes, seatedEnds, nozzleEnds) {
  const keep = nozzleEnds || new Set();
  let n = 0;
  const ends = [];
  pipes.forEach((p, pi) => {
    ends.push({ pi, i: 0 });
    ends.push({ pi, i: p.points.length - 1 });
  });
  // 이 점이 다른 배관(자기 제외)의 끝점이나 구간에 이미 닿아 있는가
  const touchesOther = (pi, pt) => pipes.some((p, k) => {
    if (k === pi) return false;
    const q = p.points;
    const a = q[0];
    const b = q[q.length - 1];
    if (Math.hypot(pt.x - a.x, pt.y - a.y, pt.z - a.z) <= SNAP_TOUCH) return true;
    if (Math.hypot(pt.x - b.x, pt.y - b.y, pt.z - b.z) <= SNAP_TOUCH) return true;
    for (let i = 1; i < q.length; i += 1) {
      if (closestOnSegment(pt, q[i - 1], q[i]).d <= SNAP_TOUCH) return true;
    }
    return false;
  });
  ends.forEach((A) => {
    const pts = pipes[A.pi].points;
    const pt = pts[A.i];
    if (!pt) return;
    if (seatedEnds.has(`${A.pi}:${A.i}`)) return;
    // 장비 노즐(짧은 배관)의 끝은 끌어다 붙이지 않는다 — 플랜지 마감을 유지한다
    if (keep.has(`${A.pi}:${A.i}`)) return;
    if (touchesOther(A.pi, pt)) return;
    // 가장 가까운 상대 배관 중심선 위의 점
    //   상대 배관의 **열린 끝점**으로는 끌어오지 않는다 — 둘 다 주인 없는 끝이라 어느 쪽이
    //   움직여야 할지 알 수 없고, 주배관 끝이 옆 분기 끝으로 끌려가 주배관이 꺾인다.
    //   (상대 끝점이 이미 다른 배관·장비에 닿아 있으면 그 점으로 이어도 안전하다)
    let best = null;
    pipes.forEach((p, pi) => {
      if (pi === A.pi) return;
      const q = p.points;
      for (let i = 1; i < q.length; i += 1) {
        const hit = closestOnSegment(pt, q[i - 1], q[i]);
        if (hit.d <= SNAP_TOUCH || hit.d > SNAP_BRANCH) continue;
        const nearStart = Math.hypot(hit.x - q[0].x, hit.y - q[0].y, hit.z - q[0].z) < SNAP_TOUCH;
        const last = q[q.length - 1];
        const nearEnd = Math.hypot(hit.x - last.x, hit.y - last.y, hit.z - last.z) < SNAP_TOUCH;
        if ((nearStart && !touchesOther(pi, q[0])) || (nearEnd && !touchesOther(pi, last))) continue;
        if (!best || hit.d < best.d) best = { d: hit.d, x: hit.x, y: hit.y, z: hit.z };
      }
    });
    if (!best) return;
    const inner = pts[A.i === 0 ? 1 : pts.length - 2];
    const prev = pts[A.i === 0 ? 2 : pts.length - 3];
    // 끝이 향하는 바깥 방향 — 배관을 이 방향으로 늘려 닿는 상대만 이어 붙인다.
    // 화면 밖으로 나가는 주배관 끝은 가장 가까운 배관이 자기 **뒤쪽**에 있으므로
    // 이 검사에서 걸러진다(주배관 끝이 옆 분기 끝으로 끌려가 주배관이 꺾이는 것을 막는다).
    const dirx = pt.x - inner.x;
    const diry = pt.y - inner.y;
    const dirz = pt.z - inner.z;
    const dl = Math.hypot(dirx, diry, dirz);
    const fwd = dl < 1e-9 ? 1
      : ((best.x - pt.x) * dirx + (best.y - pt.y) * diry + (best.z - pt.z) * dirz) / dl;
    if (fwd < -0.01) return;
    const vertical = !!prev
      && Math.abs(pt.y - inner.y) > Math.abs(pt.x - inner.x) + Math.abs(pt.z - inner.z);
    const pull = Math.hypot(best.x - pt.x, best.z - pt.z);
    if (vertical && pull <= 0.45) {
      // 수직 구간은 수직을 유지한 채 도착 배관 중심선 위로 옮긴다 —
      // 끝점과 바로 위 꺾임점의 (x, z)를 도착 배관 중심선 값으로 함께 맞춘다.
      if (pull > 1e-6 && Math.hypot(best.x - prev.x, best.z - prev.z) >= 0.1) {
        inner.x = round3(best.x);
        inner.z = round3(best.z);
        pt.x = round3(best.x);
        pt.z = round3(best.z);
      }
      const moved = Math.hypot(best.x - pt.x, best.z - pt.z) > 1e-6;
      if (!moved && Math.abs(best.y - pt.y) < 1e-4) return;
      pt.y = round3(Math.max(0, best.y));
      n += 1;
      return;
    }
    // 바로 앞 점과 5cm도 안 되는 꺾임을 만들면 붙이지 않는다(찌그러진 배관 방지)
    if (inner && Math.hypot(best.x - inner.x, best.y - inner.y, best.z - inner.z) < 0.05) return;
    if (Math.abs(best.y - pt.y) < 1e-4 && pull < 1e-6) return;
    pt.x = round3(best.x);
    pt.y = round3(Math.max(0, best.y));
    pt.z = round3(best.z);
    n += 1;
  });
  return n;
}

// 장비가 바닥에서 차지하는 사각형(회전 반영) — rot가 90/270이면 폭과 깊이가 바뀐다.
function footprintBox(spec) {
  const r = (((Math.round(num(spec.rot, 0)) % 360) + 360) % 360);
  const w = Math.max(0.15, num(spec.w, 0.6));
  const d = Math.max(0.15, num(spec.d, 0.6));
  if (r % 90 !== 0) {
    // 45° 같은 중간 각도는 안전하게 원으로 본다
    const rad = Math.max(w, d) / 2;
    return { hw: rad, hd: rad };
  }
  const swap = r === 90 || r === 270;
  return { hw: (swap ? d : w) / 2, hd: (swap ? w : d) / 2 };
}

// ⑥ 대형 장비끼리 겹친 자리를 XZ에서 최소 여백(EQUIP_GAP)까지 밀어낸다.
// AI가 펌프·탱크·제어반을 같은 자리에 몰아넣으면 장비가 서로를 뚫고 들어간 그림이 되고
// 앞뒤 거리감이 사라진다. 겹친 만큼 + 여백만큼만, 겹침이 작은 축으로 반씩 민다.
function separateMainBodies(equipment) {
  const moved = new Set();
  const list = (equipment || []).filter((e) => e && MAIN_BODY_TYPES.has(e.type));
  for (let pass = 0; pass < 20; pass += 1) {
    let hit = false;
    for (let a = 0; a < list.length; a += 1) {
      for (let b = a + 1; b < list.length; b += 1) {
        const A = list[a];
        const B = list[b];
        const fa = footprintBox(A);
        const fb = footprintBox(B);
        const dx = num(B.x, 0) - num(A.x, 0);
        const dz = num(B.z, 0) - num(A.z, 0);
        const ox = fa.hw + fb.hw + EQUIP_GAP - Math.abs(dx);
        const oz = fa.hd + fb.hd + EQUIP_GAP - Math.abs(dz);
        if (ox <= 1e-4 || oz <= 1e-4) continue;   // 한 축이라도 떨어져 있으면 겹치지 않음
        hit = true;
        // 겹침이 작은 축으로 밀면 원래 의도한 배치에서 가장 적게 움직인다.
        if (ox <= oz) {
          const push = ox / 2;
          const s = dx === 0 ? (pass % 2 === 0 ? 1 : -1) : Math.sign(dx);
          A.x = round3(num(A.x, 0) - s * push);
          B.x = round3(num(B.x, 0) + s * push);
        } else {
          const push = oz / 2;
          const s = dz === 0 ? (pass % 2 === 0 ? 1 : -1) : Math.sign(dz);
          A.z = round3(num(A.z, 0) - s * push);
          B.z = round3(num(B.z, 0) + s * push);
        }
        moved.add(A);
        moved.add(B);
      }
    }
    if (!hit) break;
  }
  return moved.size;
}

// ── 계기(압력계·온도계)를 배관 외벽에 직각으로 밀착 ──────────────────────────
// builders.js의 buildGauge와 짝을 맞춘 규약:
//  · 게이지 원점(x, y, z) = 배관 외벽에 닿는 접합점
//  · 로컬 −Z = 니쁠이 배관 속으로 들어가는 방향 (니쁠 끝이 벽 안 10mm까지 꽂힌다)
//  · 로컬 +Z = 다이얼이 보는 바깥 방향,  spec.normal 에 이 단위벡터를 저장
// 그래서 원점을 "배관 위 가장 가까운 점 + 외벽 법선 × 관 반지름"에 두면 니쁠은
// 어떤 방향(+Z·+X·−X·위)의 배관이든 배관 중심을 향해 수직으로 꽂히고 다이얼은 바깥을 본다.
export const GAUGE_REACH = 0.9;   // 계기를 붙일 가장 먼 거리(m)
const GAUGE_AXES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

// 배관 외벽 반지름(보온 자켓 포함) — builders.js buildPipe의 r과 같은 식
export function pipeOuterRadius(pipe) {
  const bore = BORES[pipe && pipe.bore] || BORES['100A'];
  const mat = MATERIALS[pipe && pipe.material] || MATERIALS.carbon;
  return bore.od / 2 + (mat.jacket || 0);
}

// 점에서 가장 가까운 배관 구간 위의 점 — { dist, px, py, pz, dir, pipe }
// dir은 그 구간의 단위 진행 벡터다(계기를 꽂을 방향을 정할 때 축을 가려내는 데 쓴다).
export function nearestPipeHit(pipes, point) {
  let best = null;
  (pipes || []).forEach((pipe) => {
    const pts = (pipe && pipe.points) || [];
    for (let i = 1; i < pts.length; i += 1) {
      const a = pts[i - 1];
      const b = pts[i];
      const vx = b.x - a.x, vy = b.y - a.y, vz = b.z - a.z;
      const L2 = vx * vx + vy * vy + vz * vz;
      if (L2 < 1e-9) continue;
      let t = ((point.x - a.x) * vx + (point.y - a.y) * vy + (point.z - a.z) * vz) / L2;
      t = Math.max(0, Math.min(1, t));
      const px = a.x + vx * t, py = a.y + vy * t, pz = a.z + vz * t;
      const dist = Math.hypot(point.x - px, point.y - py, point.z - pz);
      if (!best || dist < best.dist) {
        const L = Math.sqrt(L2);
        best = { dist, px, py, pz, dir: { x: vx / L, y: vy / L, z: vz / L }, pipe };
      }
    }
  });
  return best;
}

// 계기가 배관에서 빠져나갈 방향(다이얼 정면) — 배관 축에 수직인 6축 중,
// 지금 계기가 놓인 쪽에 가장 가까운 축으로 스냅한다(대각선으로 비뚤게 달지 않게).
// 배관 중심에 그대로 놓였으면 수직관은 +Z(정면), 수평관은 +Y(위)로 단다.
export function gaugeNormalAt(spec, hit) {
  const d = hit.dir;
  let rx = spec.x - hit.px;
  let ry = spec.y - hit.py;
  let rz = spec.z - hit.pz;
  const along = rx * d.x + ry * d.y + rz * d.z;
  rx -= d.x * along;
  ry -= d.y * along;
  rz -= d.z * along;
  const len = Math.hypot(rx, ry, rz);
  if (len < 0.08) return Math.abs(d.y) > 0.7 ? [0, 0, 1] : [0, 1, 0];
  let best = null;
  let bestDot = -2;
  GAUGE_AXES.forEach((a) => {
    const para = a[0] * d.x + a[1] * d.y + a[2] * d.z;
    if (Math.abs(para) > 0.55) return;   // 배관과 나란한 축이면 니쁠이 배관을 스쳐 지나간다
    const dot = (rx * a[0] + ry * a[1] + rz * a[2]) / len;
    if (dot > bestDot + 1e-9) { bestDot = dot; best = a; }
  });
  return best || (Math.abs(d.y) > 0.7 ? [0, 0, 1] : [0, 1, 0]);
}

// 계기 하나를 가장 가까운 배관 외벽에 직각으로 붙인다. 붙일 배관이 없으면 false.
export function attachGaugeToPipe(pipes, spec) {
  if (!spec || spec.type !== 'gauge') return false;
  const hit = nearestPipeHit(pipes, spec);
  if (!hit || hit.dist > GAUGE_REACH) return false;
  const n = gaugeNormalAt(spec, hit);
  const r = pipeOuterRadius(hit.pipe);
  spec.x = round3(hit.px + n[0] * r);
  spec.y = round3(Math.max(0.02, hit.py + n[1] * r));
  spec.z = round3(hit.pz + n[2] * r);
  spec.normal = [n[0], n[1], n[2]];
  spec.mount = 'side';   // 니쁠로 배관에 붙은 계기 (예전 저장분 호환)
  return true;
}

// 씬의 모든 계기를 배관에 다시 붙인다 — AI 배치 직후·명령으로 계기를 달았을 때
export function alignGauges(state) {
  let n = 0;
  ((state && state.equipment) || []).forEach((spec) => {
    if (spec && spec.type === 'gauge' && attachGaugeToPipe((state && state.pipes) || [], spec)) n += 1;
  });
  return n;
}

export function sanitizeAiScene(raw) {
  const src = raw || {};
  // 도면(drawing)이면 "도면에 그려진 그대로"가 최우선이다 — 없는 배관을 상상해 잇지 않는다.
  // photo(현장 사진)는 지금까지처럼 가려진 연결을 자연스럽게 보완한다.
  const drawing = src.inputKind === 'drawing';
  const weldD = drawing ? SNAP_DRAWING : SNAP_WELD;
  const jointD = drawing ? SNAP_DRAWING : SNAP_JOINT;
  const equipment = (Array.isArray(src.equipment) ? src.equipment : [])
    .filter((e) => e && typeof e === 'object')
    .map((e) => ({
      ...e,
      type: aiTypeOf(e.type),
      x: num(e.x, 0),
      y: Math.max(0, num(e.y, 0)),
      z: num(e.z, 0),
    }));
  const pipes = (Array.isArray(src.pipes) ? src.pipes : [])
    .filter((p) => p && Array.isArray(p.points) && p.points.length >= 2)
    .map((p, i) => ({
      ...p,
      name: p.name || `배관 ${i + 1}`,
      points: p.points.map((q) => ({ x: num(q.x, 0), y: Math.max(0, num(q.y, 0)), z: num(q.z, 0) })),
    }));
  const report = { inputKind: drawing ? 'drawing' : 'photo', seated: 0, welded: 0, stood: 0, gauged: 0, lifted: 0, straightened: 0, snapped: 0, branched: 0, spread: 0, nozzleKept: 0, drawHeld: 0 };
  // ⑥ 대형 장비 이격을 먼저 한다 — 배관을 앉히고 붙이는 단계가 최종 장비 위치를 보게 하려는 것이다.
  report.spread = separateMainBodies(equipment);
  const bodies = equipment
    .map((e) => ({ spec: e, body: equipBody(e) }))
    .filter((b) => b.body && (b.spec.type === 'header' || b.spec.type === 'tank'
      || b.spec.type === 'stank' || b.spec.type === 'rtank' || b.spec.type === 'hx'));

  // 본체 자리(수평 투영)에 들어오면 그 본체 윗면 높이를 돌려준다 (없으면 null).
  const topAt = (x, z) => {
    let top = null;
    bodies.forEach((b) => {
      if (!insideFootprint(b.spec, x, z, 0.05)) return;
      top = top == null ? b.body.top : Math.max(top, b.body.top);
    });
    return top;
  };

  // ⓪ 살짝 기운 수직관 바로 세우기 — AI가 수직관 위 끝의 (x, z)를 아래 끝과 몇 cm 다르게
  //    뽑아 배관이 비스듬히 기우는 경우가 있다(사진 30698의 768mm 80A). 수직 성분이
  //    지배적이고(0.3m 이상) 수평 편차가 0.15m 이내인 미세 기울기는 아래 (x, z)에 맞춰
  //    완전 수직으로 만든다. 이 배관에 붙은 밸브·게이지는 아래 ③⑤가 새 좌표로 다시 맞춘다.
  pipes.forEach((p) => {
    const pts = p.points;
    for (let i = 1; i < pts.length; i += 1) {
      const a = pts[i - 1];
      const b = pts[i];
      if (Math.abs(b.y - a.y) < 0.3) continue;
      const horiz = Math.hypot(b.x - a.x, b.z - a.z);
      if (horiz < 1e-6 || horiz > 0.15) continue;
      b.x = a.x;
      b.z = a.z;
      report.straightened += 1;
    }
  });

  // ① 수직 배관 끝을 본체 윗면에 앉히기
  //    장비 위에 앉힌 끝(seatedEnds)은 아래 ②-b에서 다른 배관 쪽으로 끌려가면 안 된다.
  const seatedEnds = new Set();
  pipes.forEach((p, pi) => {
    const pts = p.points;
    const ends = [];
    if (pts.length >= 2) {
      const a = pts[0];
      const b = pts[1];
      if (Math.abs(b.y - a.y) > Math.abs(b.x - a.x) + Math.abs(b.z - a.z)) ends.push({ i: 0, inner: b });
      const c = pts[pts.length - 2];
      const d = pts[pts.length - 1];
      if (Math.abs(d.y - c.y) > Math.abs(d.x - c.x) + Math.abs(d.z - c.z)) ends.push({ i: pts.length - 1, inner: c });
    }
    ends.forEach(({ i, inner }) => {
      const pt = pts[i];
      const top = topAt(pt.x, pt.z);
      if (top == null) return;
      // 공중에 뜬 끝·본체를 뚫은 끝 모두 본체 윗면에 맞춘다 (0.6m 안쪽만).
      if (Math.abs(pt.y - top) > 0.6) return;
      // 본체 위로 0.4m 이하로 솟은 수직 끝은 노즐이다(도면의 N1·N2, 사진의 짧은 플랜지 노즐) —
      // 윗면에 눌러 앉히면 노즐이 사라지므로 그대로 둔다. 도면에서는 0.4m보다 길어도 그린 길이를 지킨다.
      if (pt.y > top + 0.02 && (drawing || Math.abs(pt.y - inner.y) <= NOZZLE_MAX)) return;
      if (Math.abs(pt.y - top) < 0.001) return;
      // 본체 축에 가까우면 수평 위치도 노이즐 자리로 맞춘다 (헤더는 Z, 탱크는 중심).
      const near = bodies.find((b) => Math.abs(b.body.top - top) < 1e-6
        && insideFootprint(b.spec, pt.x, pt.z, 0.6));
      if (near) {
        if (near.spec.type === 'header') {
          if (Math.abs(pt.z - near.spec.z) < 0.45) pt.z = near.spec.z;
        } else if (Math.abs(pt.x - near.spec.x) < 0.6 && Math.abs(pt.z - near.spec.z) < 0.6) {
          pt.x = near.spec.x;
          pt.z = near.spec.z;
        }
      }
      pt.y = round3(top);
      seatedEnds.add(`${pi}:${i}`);
      // 꺾임점이 너무 짧아지면(5cm 미만) 내부 점을 같은 높이로 끌어올림
      if (Math.abs(inner.y - pt.y) < 0.05) inner.y = pt.y;
      report.seated += 1;
    });
  });

  // 노즐(장비에 붙은 0.4m 이하 배관)의 자유 끝 — 아래 ②·②-b·②-c가 끌어당기지 않게 한다.
  const nozzleEnds = nozzleFreeEnds(pipes, bodies, seatedEnds);

  // ② 직선 배관끼리 어긋난 연결점 불이기
  const endsAll = [];
  pipes.forEach((p, pi) => {
    endsAll.push({ pi, i: 0, pt: p.points[0] });
    endsAll.push({ pi, i: p.points.length - 1, pt: p.points[p.points.length - 1] });
  });
  for (let a = 0; a < endsAll.length; a += 1) {
    for (let b = a + 1; b < endsAll.length; b += 1) {
      const A = endsAll[a];
      const B = endsAll[b];
      if (A.pi === B.pi) continue;
      const d = Math.hypot(A.pt.x - B.pt.x, A.pt.y - B.pt.y, A.pt.z - B.pt.z);
      if (d > 1e-4 && d <= weldD) {
        B.pt.x = A.pt.x;
        B.pt.y = A.pt.y;
        B.pt.z = A.pt.z;
        report.welded += 1;
      }
    }
  }

  // ②-b 살짝 뜬 배관 끝을 다른 배관에 이어 붙이기 (0.15~0.25m)
  //    AI가 "여기서 꺾여 이어진다"는 배관을 몇 십 cm 어긋나게 주면 공중에 뜨거나 끊긴 채로 그려진다.
  //    끝점끼리(②)에서 못 붙인 끝을, 다른 배관의 끝점이나 구간(티 분기) 중 더 가까운 쪽으로 당긴다.
  //    단, 끌고 갈 상대를 가려 둔다:
  //     · 장비 위에 앉힌 끝 — 헤더·탱크 노즐 자리를 지킨다(상대 배관이 붙으러 오게 둔다)
  //     · 수직관의 끝 — x,z를 옮기면 수직관이 기울므로 높이(y)만 당긴다
  const verticalEnd = (ref) => {
    const pts = pipes[ref.pi].points;
    const p = pts[ref.i];
    const adj = ref.i === 0 ? pts[1] : pts[pts.length - 2];
    if (!p || !adj) return false;
    return Math.abs(p.y - adj.y) > Math.abs(p.x - adj.x) + Math.abs(p.z - adj.z);
  };
  const endRefs = [];
  pipes.forEach((p, pi) => {
    endRefs.push({ pi, i: 0 });
    endRefs.push({ pi, i: p.points.length - 1 });
  });
  endRefs.forEach((A) => {
    const pa = pipes[A.pi].points[A.i];
    if (!pa) return;
    if (seatedEnds.has(`${A.pi}:${A.i}`)) return;   // 장비 노즐 자리는 그대로
    // 짧은 장비 노즐(0.4m 이하)의 끝은 다른 배관·노즐로 끌어다 꺾지 않는다 — 플랜지 마감을 유지한다
    if (nozzleEnds.has(`${A.pi}:${A.i}`)) { report.nozzleKept += 1; return; }
    let best = null;
    endRefs.forEach((B) => {
      if (B.pi === A.pi) return;
      const pb = pipes[B.pi].points[B.i];
      const d = Math.hypot(pa.x - pb.x, pa.y - pb.y, pa.z - pb.z);
      if (d > 1e-4 && d <= jointD && (!best || d < best.d)) {
        best = { d, x: pb.x, y: pb.y, z: pb.z, how: 'end' };
      }
    });
    pipes.forEach((p, pi) => {
      if (pi === A.pi) return;
      for (let i = 1; i < p.points.length; i += 1) {
        const hit = closestOnSegment(pa, p.points[i - 1], p.points[i]);
        if (hit.d > 1e-4 && hit.d <= jointD && (!best || hit.d < best.d)) {
          best = { d: hit.d, x: hit.x, y: hit.y, z: hit.z, how: 'seg' };
        }
      }
    });
    if (!best) return;
    const vert = verticalEnd(A);
    if (vert) {
      // 수직관은 높이만 당긴다 — x,z를 건드리면 기운 수직관이 된다.
      if (Math.abs(best.y - pa.y) < 1e-4) return;
      pa.y = round3(Math.max(0, best.y));
      report.snapped += 1;
      return;
    }
    // 붙인 자리가 배관을 5cm도 안 되는 꺾임으로 만들면 붙이지 않는다(찌그러진 배관 방지)
    const prev = pipes[A.pi].points[A.i === 0 ? 1 : A.i - 1];
    if (prev && Math.hypot(best.x - prev.x, best.y - prev.y, best.z - prev.z) < 0.05) return;
    pa.x = round3(best.x);
    pa.y = round3(Math.max(0, best.y));
    pa.z = round3(best.z);
    report.snapped += 1;
  });

  // ②-c 허공에 뜬 분기 배관 끝 자동 연결 (0.25~0.6m) — ㄷ자·ㄱ자 우회 배관의 도착점.
  //    ②-b까지 지나도 다른 배관에 닿지 않은 끝을 상대 배관 중심선 위의 투영점으로 끌어온다.
  //    도면(drawing)에서는 이 단계를 건너뛴다 — 도면대로 끊어 놓은 짧은 노즐·스터브 끝이
  //    옆 배관이나 다른 노즐에 억지로 붙으면 도면과 다른 그림이 된다(0.12m 초근접 스냅만 위 ②·②-b가 처리).
  //    끝점이 바뀌었으므로 아래 ③④가 새 좌표 기준으로 밸브·피팅을 다시 맞춘다.
  report.branched = drawing ? 0 : connectOpenEnds(pipes, seatedEnds, nozzleEnds);

  // ③④ 수직 배관 위 밸브·피팅 — 세우기 + 본체 밖으로
  equipment.forEach((e) => {
    if (!VERTICAL_TYPES.has(e.type)) return;
    let best = null;
    let bestD = SNAP_VERT;
    pipes.forEach((p) => {
      const pts = p.points;
      for (let i = 1; i < pts.length; i += 1) {
        const a = pts[i - 1];
        const b = pts[i];
        const dy = Math.abs(b.y - a.y);
        if (dy < 0.3) continue;
        if (dy <= Math.abs(b.x - a.x) + Math.abs(b.z - a.z)) continue;   // 수직 구간만
        if (e.y < Math.min(a.y, b.y) - 0.5 || e.y > Math.max(a.y, b.y) + 0.5) continue;
        const d = Math.hypot(e.x - a.x, e.z - a.z);
        if (d <= bestD) { bestD = d; best = { x: a.x, z: a.z, bore: p.bore }; }
      }
    });
    if (best) {
      e.axis = 'y';
      e.x = round3(best.x);
      e.z = round3(best.z);
      // 관경도 그 수직 배관을 따른다 (압력계는 제외 — 관경과 무관하게 그린다)
      if (e.type !== 'gauge' && BORES[best.bore]) e.bore = best.bore;
      report.stood += 1;
    }
    // 본체 안에 묻혔으면 윗면 위로 (세로로 세운 부속만)
    const inside = bodies.some((b) => b.body.contains(e.x, e.y, e.z, 0.02));
    const top = topAt(e.x, e.z);
    if ((inside || (top != null && e.y < top - 0.01)) && best && top != null) {
      e.y = round3(top + 0.12);
      report.lifted += 1;
    }
  });

  // ⑤ 계기(압력계·온도계) — 가장 가까운 배관 외벽에 니쁠을 직각으로 꽂는다.
  //    수직관이든 수평관이든 같은 규칙: 원점 = 배관 위 가장 가까운 점 + 외벽 법선 × 반지름.
  //    (예전에는 수직관 옆 계기만 손봤고, rot만 돌려 니쁠이 옆으로 빗나가 허공에 떴다)
  equipment.forEach((e) => {
    if (e.type !== 'gauge') return;
    if (attachGaugeToPipe(pipes, e)) report.gauged += 1;
  });

  if (drawing) report.drawHeld = countDrawnOpenEnds(pipes, bodies);

  return { equipment, pipes, inputKind: drawing ? 'drawing' : 'photo', report, layoutPlan: typeof src.layoutPlan === 'string' ? src.layoutPlan : '' };
}

// ── AI 응답 → 씬 데이터 (앱과 검증 페이지가 같은 경로를 탄다) ────────────────
// 1차 정리(layoutPlan·원본 JSON) → 기하 보정(sanitizeAiScene) → makeEquipment(방향·관경·색)
// → 후처리(수직 세우기·묻힘 방지) — 이 순서가 앱과 검증 페이지에서 같다.
export function aiResultToScene(result) {
  const clean = sanitizeAiScene(result);
  const equipment = clean.equipment
    .map((e) => {
      const spec = makeEquipment(aiTypeOf(e.type), {
        name: e.name,
        x: e.x, y: Math.max(0, Number(e.y) || 0), z: e.z,
        w: e.w, h: e.h, d: e.d,
        rot: e.rot, color: e.color,
        bore: e.bore, bore1: e.bore1, bore2: e.bore2,
        axis: e.axis, conn: e.conn, mount: e.mount, normal: e.normal,
      });
      // 계기는 배관 관경과 상관없이 알아보기 좋은 크기로 그린다.
      if (spec.type === 'gauge') {
        const t = EQUIP_TYPES.gauge;
        spec.w = t.defaults.w;
        spec.h = t.defaults.h;
        spec.d = t.defaults.d;
      }
      return spec;
    })
    .filter((e) => Number.isFinite(e.x) && Number.isFinite(e.z));
  const pipes = clean.pipes.map((p) => makePipe({
    name: p.name, bore: p.bore, material: p.material, color: p.color, points: p.points,
  }));
  const state = { equipment, pipes };
  const pp = postProcessAi(state);
  const report = { ...clean.report };
  report.stood += pp.stood;
  report.lifted += pp.lifted;
  return { equipment, pipes, report, layoutPlan: clean.layoutPlan, inputKind: clean.inputKind };
}

export function emptyState() {
  return {
    version: 1,
    // v70: 배관 연결 방식 3단계(none/flange/forged) 저장 형식.
    connV: 2,
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

  // 매니폴드 게이트밸브 (하부 헤더 y=0.95, z=1.6 위에 인라인 배치) — 150A 헤더 굵기에 맞춘 크기
  [-2.6, -0.9, 0.8, 2.5].forEach((x, i) => {
    s.equipment.push(makeEquipment('valve', {
      name: 'GV-' + (101 + i) + ' 게이트밸브', x, y: 0.95, z: 1.6, bore: '150A',
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
      [-3.0, 1.67, -4.2], [-3.0, 2.3, -4.2], [-3.0, 2.3, -1.6],
    ]),
    pipe('PL-107 E-102 스팀 공급', '100A', 'carbon', [
      [2.7, 3.6, -1.6], [2.7, 2.4, -1.6], [2.7, 2.4, -5.0], [2.7, 1.41, -5.0],
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
    [-6.2, HDR_Y, HDR_Z], [5.4 - elbowDims('elbow', '80A').face, HDR_Y, HDR_Z],
  ]));
  // 엘보 자리에서 배관을 끊고 엘보 접합면에서 다시 올린다 (자동 엘보와 같은 방식)
  s.pipes.push(pipe('PL-201b 부속 진열 헤더 상승', '80A', 'sus', [
    [5.4, HDR_Y + elbowDims('elbow', '80A').face, HDR_Z], [5.4, 2.1, HDR_Z],
  ]));

  const inline = (type, name, x, extra) =>
    makeEquipment(type, { name, x, y: HDR_Y, z: HDR_Z, bore: '80A', ...(extra || {}) });

  s.equipment.push(
    inline('bfly', 'BF-101 기어 버터플라이', -4.4),
    inline('yvalve', 'YV-101 경사형 스트레이너', -3.2),
    inline('ball', 'BV-101 볼밸브', -2.0),
    inline('check', 'CV-101 체크밸브', -0.9),
    inline('bellows', 'EJ-101 벨로우즈 신축관', 0.4),
    inline('tee', 'TE-101 티 분기', 1.8, { bore1: '80A', bore2: '80A' }),
    inline('reducer', 'RD-101 레듀샤 80A→50A', 3.0, { bore1: '80A', bore2: '50A' }),
    inline('flange', 'FL-101 플랜지', 4.2),
    makeEquipment('elbow', {
      name: 'EL-101 90° 엘보', x: 5.4, y: HDR_Y, z: HDR_Z, bore: '80A',
      inDir: [-1, 0, 0], outDir: [0, 1, 0], rot: 90,
    }),
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

  // 샘플의 압력계도 배관 외벽에 직각으로 붙인다(니쁠이 배관 중심을 향하게).
  alignGauges(s);
  return s;
}

// 부속 자리에서 0.6m 안에 있는 가장 가까운 배관의 관경 (없으면 null)
function nearestBore(state, item) {
  let best = null;
  let bestD = 0.6;
  state.pipes.forEach((p) => {
    const pts = p.points || [];
    for (let i = 1; i < pts.length; i += 1) {
      const a = pts[i - 1];
      const b = pts[i];
      const vx = b.x - a.x, vy = b.y - a.y, vz = b.z - a.z;
      const L2 = vx * vx + vy * vy + vz * vz;
      let t = L2 > 1e-9 ? ((item.x - a.x) * vx + (item.y - a.y) * vy + (item.z - a.z) * vz) / L2 : 0;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(item.x - (a.x + vx * t), item.y - (a.y + vy * t), item.z - (a.z + vz * t));
      if (d <= bestD) { bestD = d; best = p.bore; }
    }
  });
  return best;
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
      // 밸브·피팅은 관경에 비례해 크기가 작아질 수 있으므로 하한을 낮게 둔다 (25A 볼밸브 폭 0.07m).
      const floor = isBoreSized(type) ? 0.01 : 0.1;
      const item = {
        id: e.id || uid('e'),
        kind: 'equipment',
        type,
        name: typeof e.name === 'string' ? e.name : t.label,
        x: num(e.x, 0), y: Math.max(0, num(e.y, 0)), z: num(e.z, 0),
        w: Math.max(floor, num(e.w, t.defaults.w)),
        h: Math.max(floor, num(e.h, t.defaults.h)),
        d: Math.max(floor, num(e.d, t.defaults.d)),
        rot: num(e.rot, 0),
        color: /^#[0-9a-f]{6}$/i.test(e.color || '') ? e.color : t.color,
        conn: e.conn === 'forged' ? 'forged' : 'flange',
      };
      // 밸브·피팅이 달린 배관 관경 — 저장된 값을 살린다.
      // (예전 도면은 관경을 기억하지 않으므로 비워 두고, 아래에서 붙어 있는 배관을 보고 채운다)
      if (isBoreSized(type) && BORES[e.bore]) item.bore = e.bore;
      // 플랜지 — 판 두께는 KS 10K 표를 따르고, 접시 외경도 KS 10K 표를 따른다
      // (예전 도면의 0.06 두께·0.26 고정 크기를 바로잡는다 — 접합면이 판 면과 어긋나 있었다).
      if (type === 'flange' && BORES[item.bore]) {
        item.w = round3(flangeTh(item.bore));
        item.h = Math.round(flangeOd(item.bore) * 1000) / 1000;
        item.d = item.h;
      }
      // 세워 놓은 방향(axis: 'y')도 그대로 살린다.
      if (AXIS_VALUES.has(e.axis)) item.axis = e.axis;
      else if (t.vertical) item.axis = 'y';
      // 핸들·축 회전도 저장한다 — 다시 열어도 손잡이·몸체가 돌아간 자리를 유지한다.
      // (밸브·스트레이너는 손잡이만, 다른 부속·장비는 몸체가 유로 축 둘레로 돈다)
      if (num(e.roll, 0)) item.roll = handleRotOf(e);
      // 좌·우(yaw)·위·아래(pitch) 회전 — 모든 장비·부속 공통.
      if (num(e.yaw, 0)) item.yaw = norm180(e.yaw);
      if (num(e.pitch, 0)) item.pitch = norm180(e.pitch);
      if (e.mount === 'side') item.mount = 'side';
      // 계기 정면 방향(배관 외벽 바깥)도 살린다 — 열이 열리면 니쁠이 다시 빗나간다.
      if (type === 'gauge' && Array.isArray(e.normal) && e.normal.length === 3
        && e.normal.every((v) => Number.isFinite(Number(v)))) {
        const n = e.normal.map((v) => round3(Number(v)));
        if (Math.hypot(n[0], n[1], n[2]) > 1e-6) item.normal = n;
      }
      // 진행 방향 벡터(배관 축)가 저장돼 있으면 그대로 살려 3D 회전을 다시 맞춘다.
      if (Array.isArray(e.dir) && e.dir.length === 3 && e.dir.every((v) => Number.isFinite(Number(v)))) {
        const d = e.dir.map((v) => round3(Number(v)));
        if (Math.hypot(d[0], d[1], d[2]) > 1e-6) item.dir = d;
      }
      if (type === 'reducer' || type === 'tee') {
        item.bore1 = BORES[e.bore1] ? e.bore1 : (t.bore1 || '100A');
        item.bore2 = BORES[e.bore2] ? e.bore2 : (type === 'tee' ? item.bore1 : (t.bore2 || '50A'));
        if (type === 'tee') item.branch = TEE_BRANCHES.includes(e.branch) ? e.branch : 'up';
        // v70 — 티·레듀샤도 표준 치수(2C / H)로 맞춘다. 예전 도면의 임의 폭은 표준값으로 바로잡는다.
        item.w = fittingNaturalWidth(type, item.bore1, item.bore2);
      }
      // 노즐 설정 — 저장된 방향별 관경을 살리고, 없으면 기본 노즐로 채운다.
      // 열교환기는 자유 노즐 목록(nozList)을 살린다 — 예전 방향별 관경(nozzles)도 같은 자리로 옮긴다.
      if (type === 'hx') {
        item.hxType = HX_TYPES.includes(e.hxType) ? e.hxType : 'both';
        item.nozList = hxNozzlesOf({ type, nozList: e.nozList, nozzles: e.nozzles });
      }
      else if (NOZZLE_TYPES.has(type)) item.nozzles = nozzlesOf({ type, nozzles: e.nozzles });
      if (type === 'elbow' || type === 'elbow45') {
        item.bore = BORES[e.bore] ? e.bore : (BORES[e.bore1] ? e.bore1 : (t.bore || '100A'));
        const dims = elbowDims(type, item.bore);
        item.w = dims.face;
        item.h = dims.r * 2;
        item.d = dims.r * 2;
        const vec = (v) => (Array.isArray(v) && v.length === 3 && v.every((n) => Number.isFinite(Number(n)))
          ? v.map((n) => round3(Number(n))) : null);
        const i1 = vec(e.inDir);
        const i2 = vec(e.outDir);
        if (i1 && i2) { item.inDir = i1; item.outDir = i2; }
      }
      s.equipment.push(item);
    });
  }
  if (Array.isArray(raw.pipes)) {
    // v70 이전 저장분의 배관 conn('flange' = 당시 기본값이던 자동 플랜지)은
    // 새 기본값 '선택안함'으로 옮긴다 — 예전 도면을 열어도 선택·삭제 안 되는 판이 남지 않게.
    // v70부터 저장분(connV: 2)은 사용자가 직접 고른 'flange'를 그대로 지킨다.
    const legacyConn = !(Number(raw.connV) >= 2);
    raw.pipes.forEach((p) => {
      if (!p || !Array.isArray(p.points) || p.points.length < 2) return;
      s.pipes.push({
        id: p.id || uid('p'),
        kind: 'pipe',
        name: typeof p.name === 'string' ? p.name : '배관',
        bore: BORES[p.bore] ? p.bore : '100A',
        material: MATERIALS[p.material] ? p.material : 'carbon',
        conn: legacyConn ? (p.conn === 'forged' ? 'forged' : 'none') : pipeConnOf(p.conn),
        points: p.points.map((pt) => ({ x: num(pt.x, 0), y: Math.max(0, num(pt.y, 0)), z: num(pt.z, 0) })),
        ...(toHexColor(p.color) ? { color: toHexColor(p.color) } : {}),
      });
    });
  }
  // ── 예전 도면 살리기 — 관경을 모르던 밸브·피팅은 붙어 있는 배관 관경으로 크기를 다시 맞춘다.
  // (2026-11-22 이전 저장분은 모두 100A 크기로 그려져 25A 배관 위에서 터무니없이 컸다)
  s.equipment.forEach((e) => {
    if (!isBoreSized(e.type) || e.bore) return;
    const near = nearestBore(s, e);
    if (near) { e.bore = near; applyBoreSize(e); }
    else e.bore = SIZE_REF_BORE;
  });

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
  // 계기는 배관 외벽에 직각으로 붙는다 — normal이 없는 예전 도면은 배관에서 방향을 다시 잡는다.
  s.equipment.forEach((e) => {
    if (e.type === 'gauge' && !e.normal) attachGaugeToPipe(s.pipes, e);
  });
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
