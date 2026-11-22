// 스마일산업 3D 배관 — 사진 확대 타일(2×2 크롭)
// 사용자 요청: "사진을 확대해서 더 디테일하게 보고 그려줄수없어?"
// 한 장의 현장 사진을 그대로 보내면 3m 떨어진 밸브 핸들·플랜지·배관 굵기 차이가 뭉개진다.
// 그래서 사진을 55% 크기로 네 번(좌상·우상·좌하·우하) 잘라 1200px 타일로 만들어
// [전체 사진]과 함께 보낸다 — 전체는 구도, 타일은 디테일을 읽는다.
// localStorage에는 저장하지 않는다. 분석할 때만 메모리에서 만든다.

export const ZOOM_FRACTION = 0.55;   // 사진 한 변의 55% (이웃 타일과 5%가 겹친다)
export const TILE_MAX_SIDE = 1200;   // 타일 긴 변(px)
export const TILE_QUALITY = 0.86;
export const AI_IMAGE_MAX = 6;       // Gemini 요청 한 번에 보내는 이미지 상한

// 잘라 낼 네 모서리 — 라벨은 Gemini가 전체 사진과 짝지을 수 있게 한국어로 준다.
const CORNERS = [
  { key: 'tl', name: '좌상' },
  { key: 'tr', name: '우상' },
  { key: 'bl', name: '좌하' },
  { key: 'br', name: '우하' },
];

function clamp(v, lo, hi) {
  const n = Number(v);
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    if (!src) { reject(new Error('사진이 없습니다.')); return; }
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('사진을 읽지 못했습니다.'));
    img.src = src;
  });
}

// 사진 한 장 → 확대 타일 4개 [{ key, name, src, label, width, height, sourceWidth, sourceHeight }]
// 실패하면 빈 배열을 돌려준다(확대는 부가 기능이라 분석 자체를 막지 않는다).
export async function buildZoomTiles(src, opts) {
  const o = opts || {};
  const fraction = clamp(o.fraction == null ? ZOOM_FRACTION : o.fraction, 0.3, 1);
  const maxSide = Math.max(200, Number(o.maxSide) || TILE_MAX_SIDE);
  const quality = clamp(o.quality == null ? TILE_QUALITY : o.quality, 0.3, 0.98);

  let img;
  try { img = await loadImage(src); } catch (e) { return []; }
  const W = img.naturalWidth || img.width;
  const H = img.naturalHeight || img.height;
  if (!W || !H) return [];

  const cw = Math.max(1, Math.floor(W * fraction));
  const ch = Math.max(1, Math.floor(H * fraction));
  // 타일은 원본보다 크게 늘리지 않는다 — 늘려 봐야 디테일이 생기지 않고 용량만 커진다.
  const scale = Math.min(1, maxSide / Math.max(cw, ch));
  const tw = Math.max(1, Math.round(cw * scale));
  const th = Math.max(1, Math.round(ch * scale));
  const boxes = [
    { x: 0, y: 0 },
    { x: W - cw, y: 0 },
    { x: 0, y: H - ch },
    { x: W - cw, y: H - ch },
  ];

  const out = [];
  for (let i = 0; i < CORNERS.length; i += 1) {
    const c = CORNERS[i];
    const b = boxes[i];
    const canvas = document.createElement('canvas');
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext('2d');
    if (!ctx) return out;
    ctx.fillStyle = '#ffffff';   // 투명 PNG가 JPEG에서 까맣게 나오지 않게
    ctx.fillRect(0, 0, tw, th);
    ctx.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, b.x, b.y, cw, ch, 0, 0, tw, th);
    let dataUrl = '';
    try { dataUrl = canvas.toDataURL('image/jpeg', quality); } catch (e) { dataUrl = ''; }
    canvas.width = 0;
    canvas.height = 0;
    if (!dataUrl || dataUrl.indexOf('data:image/jpeg') !== 0 || dataUrl.length < 128) continue;
    out.push({
      key: c.key,
      name: c.name,
      src: dataUrl,
      label: `[확대 영역 ${i + 1}/4: ${c.name}]`,
      width: tw,
      height: th,
      sourceWidth: W,
      sourceHeight: H,
    });
  }
  return out;
}

// 분석에 보낼 이미지 묶음 만들기 — 사진마다 [전체 사진] + 확대 타일.
//  · 사진 1장 → 전체 1 + 타일 4 = 5장 (4면 모두 확대)
//  · 사진 2장 → 사진마다 전체 1 + 타일 2 = 6장 (사진1은 좌상·우하, 사진2는 우상·좌하 → 둘을 합치면 4면)
//  · 사진 3장 이상 → 확대 없이 전체 사진만 (이미 6장 상한에 가깝고, 사진마다 확대하면
//    구도가 흩어져 Gemini가 같은 장비를 중복으로 잡는다)
// 라벨이 있어야 Gemini가 "이건 같은 사진을 확대한 것"임을 알고 중복 장비를 만들지 않는다.
export async function buildAiImageParts(sources, opts) {
  const raw = (Array.isArray(sources) ? sources : [sources])
    .filter((s) => s && (typeof s === 'string' ? s.length > 0 : !!s.src))
    .slice(0, AI_IMAGE_MAX);
  const photos = raw.map((s, i) => (typeof s === 'string'
    ? { src: s, name: `사진 ${i + 1}` }
    : { src: s.src, name: s.name || `사진 ${i + 1}` }));
  const total = photos.length;
  const perPhoto = total === 1 ? 4 : (total === 2 ? 2 : 0);
  // 사진 2장일 때: 두 사진이 서로 다른 면을 맡게 나눈다.
  const PICKS = { 0: [0, 3], 1: [1, 2] };
  const parts = [];

  for (let p = 0; p < total; p += 1) {
    const tag = total > 1 ? `사진 ${p + 1}/${total} · ` : '';
    parts.push({
      src: photos[p].src,
      kind: 'full',
      name: photos[p].name,
      label: `[${tag}전체 사진]`,
    });
    if (!perPhoto) continue;
    const room = AI_IMAGE_MAX - parts.length;
    if (room <= 0) break;
    let tiles = [];
    try { tiles = await buildZoomTiles(photos[p].src, opts); } catch (e) { tiles = []; }
    const pick = (total === 2 ? PICKS[p].map((k) => tiles[k]) : tiles.slice(0, perPhoto))
      .filter(Boolean)
      .slice(0, room);
    pick.forEach((t, k) => {
      parts.push({
        src: t.src,
        kind: 'tile',
        name: t.name,
        width: t.width,
        height: t.height,
        label: `[${tag}확대 영역 ${k + 1}/${pick.length}: ${t.name}]`,
      });
    });
  }
  return parts;
}
