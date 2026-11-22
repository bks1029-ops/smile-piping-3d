// 스마일산업 3D 배관 — AI 분석에 보낼 사진 묶음
//
// 처음엔 한 장의 현장 사진을 55% 크기로 네 번(좌상·우상·좌하·우하) 잘라 확대 타일을
// 함께 보냈다. 그런데 실제로는 타일이 사진마다 다른 시점처럼 섞여 들어가 AI가 방향을
// 잃고 엉뚱한 대각선 배관을 그리는 일이 생겼다(2026-11-22 사용자 피드백).
// 그래서 지금은 자르지 않고 2048px 고해상도 원본만 보낸다.
// 깊이(Z)와 배관 연결은 "다른 각도(측면·위쪽) 사진"을 함께 올려 잡는 쪽으로 바꿨다.

export const AI_IMAGE_MAX = 6;       // Gemini 요청 한 번에 보내는 이미지 상한

// 분석에 보낼 이미지 묶음 만들기 — 올린 사진을 그대로(자르지 않고) 순서대로 담는다.
// 라벨은 사진이 여러 장일 때만 붙여, AI가 "1번 정면 / 2번 측면"처럼 구분하게 한다.
export async function buildAiImageParts(sources) {
  const raw = (Array.isArray(sources) ? sources : [sources])
    .filter((s) => s && (typeof s === 'string' ? s.length > 0 : !!s.src))
    .slice(0, AI_IMAGE_MAX);
  const photos = raw.map((s, i) => (typeof s === 'string'
    ? { src: s, name: `사진 ${i + 1}` }
    : { src: s.src, name: s.name || `사진 ${i + 1}` }));
  const total = photos.length;
  return photos.map((p, i) => ({
    src: p.src,
    kind: 'full',
    name: p.name,
    label: total > 1 ? `[사진 ${i + 1}/${total}: ${p.name}]` : '[전체 사진]',
  }));
}
