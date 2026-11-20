// 스마일산업 3D 배관 — Gemini 이미지 분석 (선택 기능)

const PROMPT = `너는 배관설비(플랜트) 현장 사진과 2D 도면, 손그림을 3D 배관 레이아웃 데이터로 변환하는 설비 엔지니어다.
첨부된 이미지를 분석해서 아래 JSON 스키마에 맞는 객체 하나만 출력하라. 설명 문장은 넣지 말 것.

[좌표계]
- 단위: 미터(m). 바닥면 y = 0.
- X: 화면 오른쪽(+), Z: 화면 앞쪽(+), Y: 높이(+).
- 장비의 x, z는 장비 중심, y는 장비 밑면 높이(보통 0). 배관 points의 y는 관 중심 높이.

[장비 equipment 필드]
- type: "hx"(열교환기·쉘앤튜브) | "pump"(원심펌프) | "tank"(탱크·드럼) | "panel"(제어반) | "valve"(게이트밸브·플랜지)
- name: 한국어 이름 (예: "E-101 열교환기", "P-101 원심펌프")
- x, y, z: 위치(m), w: X방향 길이, h: 높이, d: Z방향 폭 (모두 m)
- rot: Y축 회전 각도(도). 0, 90, 180, 270 중 하나를 우선 사용.

[배관 pipes 필드]
- name: 한국어 이름 (예: "150A 스팀 메인")
- bore: "50A" | "80A" | "100A" | "150A" | "200A" 중 하나
- material: "carbon"(흑관·카본스틸) | "sus"(스테인리스) | "insulated"(보온배관)
- points: 꺾이는 지점을 모두 포함한 [{x,y,z}, ...] 배열 (최소 2개). 수직 상승/하강과 엘보를 그대로 표현.
- 배관은 장비의 노즐 위치에서 시작하거나 끝나게 맞춰라.

[규칙]
- 사람 키 1.7m, 밸브 핸드휠 지름 0.35m, 100A 배관 외경 0.114m를 스케일 기준으로 삼아 실제 치수에 가깝게 추정하라.
- 장비끼리 겹치지 않게 배치하고, 사진에 보이는 상대 위치·배관 흐름·분기 구조를 최대한 반영하라.
- 사진에서 확실하지 않은 부분은 합리적으로 추정하되, 존재하지 않는 장비를 과도하게 만들지 말 것.
- 장비 최대 25개, 배관 최대 30개.
- notes: 한국어 한 줄 요약 (예: "열교환기 2기와 펌프 2대, 상부 스팀 헤더 구조").

[출력 형식]
{"equipment":[{"type":"hx","name":"E-101 열교환기","x":0,"y":0,"z":0,"w":4.4,"h":0.9,"d":0.9,"rot":0}],"pipes":[{"name":"150A 스팀 메인","bore":"150A","material":"carbon","points":[{"x":-5,"y":3.6,"z":-2},{"x":5,"y":3.6,"z":-2}]}],"notes":""}`;

export async function analyzeImage({ apiKey, model, dataUrl, extraNote }) {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl || '');
  if (!m) throw new Error('이미지를 읽을 수 없습니다. JPG/PNG 파일을 올려주세요.');
  const mimeType = m[1];
  const base64 = m[2];

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const text = extraNote ? `${PROMPT}\n\n[현장 메모]\n${extraNote}` : PROMPT;

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text }, { inlineData: { mimeType, data: base64 } }] }],
        generationConfig: { temperature: 0.15, responseMimeType: 'application/json', maxOutputTokens: 8192 },
      }),
    });
  } catch (e) {
    throw new Error('네트워크 오류로 Gemini에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.');
  }

  if (!res.ok) {
    let detail = `${res.status}`;
    try {
      const err = await res.json();
      detail = (err.error && (err.error.message || err.error.status)) || detail;
    } catch (e) { /* ignore */ }
    if (res.status === 400 || res.status === 403) {
      if (/api key/i.test(detail)) throw new Error(`API 키가 올바르지 않습니다. (${detail})`);
    }
    if (res.status === 429) throw new Error('Gemini 무료 사용량을 초과했습니다. 잠시 후 다시 시도해 주세요.');
    throw new Error(`Gemini 요청 실패 (${detail})`);
  }

  const data = await res.json();
  const cand = data.candidates && data.candidates[0];
  const parts = cand && cand.content && cand.content.parts;
  const raw = parts ? parts.map((p) => p.text || '').join('') : '';
  if (!raw) throw new Error('Gemini가 결과를 반환하지 않았습니다. 사진이 흐리거나 해상도가 낮을 수 있습니다.');

  const jsonText = extractJson(raw);
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e) {
    throw new Error('AI 응답을 해석하지 못했습니다. 다시 시도해 주세요.');
  }
  return parsed;
}

function extractJson(text) {
  let t = String(text).trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fence) t = fence[1].trim();
  const s = t.indexOf('{');
  const e = t.lastIndexOf('}');
  if (s >= 0 && e > s) t = t.slice(s, e + 1);
  return t;
}
