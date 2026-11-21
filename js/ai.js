// 스마일산업 3D 배관 — Gemini 이미지 분석 (선택 기능)

// 구형 모델은 신규 API 키에서 거절된다(예: models/gemini-2.5-flash → "no longer available to new users").
// 그래서 기본은 최신 flash 모델로 두고, 실패하면 최신 모델로 자동 재시도하고,
// 그래도 안 되면 v1beta/models 목록에서 지금 쓸 수 있는 flash 모델을 찾아 쓴다.
export const DEFAULT_MODEL = 'gemini-3.8-flash';

export const MODEL_OPTIONS = [
  { id: 'gemini-3.8-flash', label: 'gemini-3.8-flash (기본·권장)' },
  { id: 'gemini-4-hydrogen', label: 'gemini-4-hydrogen (최신 4세대)' },
  { id: 'gemini-2.5-flash', label: 'gemini-2.5-flash (구형·기존 키 전용)' },
];

// 예전 기본값으로 저장돼 있던 값 — 새 기본값으로 자동 전환한다.
export const LEGACY_MODELS = [
  'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro',
  'gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-2.0-pro',
  'gemini-1.5-flash', 'gemini-1.5-flash-8b', 'gemini-1.5-pro',
];

const API_ROOT = 'https://generativelanguage.googleapis.com/v1beta';

const PROMPT = `너는 배관설비(플랜트) 현장 사진과 2D 도면, 손그림을 3D 배관 레이아웃 데이터로 변환하는 설비 엔지니어다.
첨부된 이미지를 분석해서 아래 JSON 스키마에 맞는 객체 하나만 출력하라. 설명 문장은 넣지 말 것.

[좌표계]
- 단위: 미터(m). 바닥면 y = 0.
- X: 화면 오른쪽(+), Z: 화면 앞쪽(+), Y: 높이(+).
- 장비의 x, z는 장비 중심, y는 장비 밑면 높이(보통 0). 배관 points의 y는 관 중심 높이.

[장비·부속 equipment 필드]
- type: 아래 24종 중 하나를 정확히 골라 쓸 것
  · "hx" 열교환기(쉘앤튜브)
  · "pump" 가로형 원심펌프
  · "vpump" 입형 인라인 펌프(수직 모터 일체형, 하부 흡입·상부 토출)
  · "tank" 소형 탱크·드럼
  · "stank" 대형 원통 저장탱크(지지다리·콘 헤드·맨홀)
  · "rtank" 사각 탱크·수조(보강 리브·맨홀)
  · "panel" 제어반(MCC)
  · "valve" 게이트밸브(핸드휠)
  · "bfly" 기어식 버터플라이 밸브(기어박스+핸드휠, 보통 파랑)
  · "yvalve" 경사형(Y자) 체크밸브·스트레이너(보통 빨강)
  · "ball" 볼밸브(레버 핸들)
  · "check" 체크밸브(웨이퍼·스윙)
  · "bellows" 벨로우즈 신축관(플렉시블 조인트, 타이로드)
  · "elbow" 90° 엘보
  · "elbow45" 45° 엘보
  · "tee" 티(Tee) 분기관
  · "reducer" 레듀샤(이경관)
  · "nipple" 니쁠(단니쁠·육각 니쁠)
  · "cap" 엔드캡·마개
  · "union" 유니온·소켓·커플링
  · "flange" 플랜지(볼트링)
  · "support" 파이프 서포트(지지대·새들·U볼트)
  · "gauge" 압력계·온도계(PG/TG)
  · "flow" 유량계(플로우미터, 플랜지 바디 + 상부 트랜스미터 헤드)
- name: 한국어 이름 (예: "E-101 열교환기", "BF-101 버터플라이 밸브", "T-201 저장탱크")
- x, y, z: 위치(m). y는 물체의 높이 기준이다.
  · 장비·탱크·서포트는 바닥에 놓으므로 y=0.
  · 밸브·피팅·플랜지·계기는 배관 위에 달리므로 y = 그 배관의 중심 높이.
- w: X방향 길이, h: 높이, d: Z방향 폭 (모두 m)
- rot: Y축 회전 각도(도). 0, 90, 180, 270 중 하나를 우선 사용. 부속은 배관이 흐르는 방향으로 맞춘다.
- 기본 크기(m) — 사진에서 확실한 근거가 있으면 그 값을 써도 된다:
  hx 3.0×0.75×0.75 · pump 1.15×0.85×0.6 · vpump 0.42×0.85×0.42 · tank 0.6×0.9×0.6 ·
  stank 2.0×3.0×2.0 · rtank 2.4×1.8×1.8 · panel 1.2×2.0×0.7 · valve 0.34×0.58×0.3 ·
  bfly 0.34×0.46×0.32 · yvalve 0.36×0.5×0.34 · ball 0.26×0.34×0.24 · check 0.24×0.26×0.22 ·
  bellows 0.304×0.34×0.34 · elbow 0.3×0.3×0.22 · elbow45 0.14×0.16×0.11 · tee 0.34×0.26×0.22 · reducer 0.32×0.22×0.22 ·
  nipple 0.146×0.1×0.1 · cap 0.148×0.11×0.11 · union 0.206×0.1×0.1 ·
  flange 0.06×0.26×0.26 · support 0.5×0.85×0.4 · gauge 0.2×0.34×0.16 · flow 0.24×0.44×0.24
- tee·reducer는 관경을 알면 bore1(주배관·1차) / bore2(분기·2차)에 "100A" 형식으로 넣어라 (예: 레듀샤 100A→50A). 모르면 빼도 된다.
- conn: 배관과 만나는 접합 방식. "flange"(플랜지·볼트 원판, 기본값) 또는 "forged"(단조형·소켓웰드·나사식, 플랜지 없이 소켓 보스만).
  사진에서 플랜지 볼트 원판이 보이지 않고 소켓·나사 조임부로 이어지면 "forged"를 써라. 확실하지 않으면 넣지 않는다(기본 플랜지).

[배관 pipes 필드]
- name: 한국어 이름 (예: "150A 스팀 메인")
- bore: "15A" | "20A" | "25A" | "32A" | "40A" | "50A" | "65A" | "80A" | "100A" | "125A" | "150A" | "200A" | "250A" | "300A" | "350A" | "400A" | "450A" | "500A" | "550A" | "600A" 중 하나
- material: "carbon"(흑관·카본스틸) | "sus"(스테인리스) | "insulated"(보온배관)
- points: 꺾이는 지점을 모두 포함한 [{x,y,z}, ...] 배열 (최소 2개). 수직 상승/하강과 엘보를 그대로 표현.
- 배관은 장비의 노즐 위치에서 시작하거나 끝나게 맞춰라.

[규칙]
- 사람 키 1.7m, 밸브 핸드휠 지름 0.35m, 100A 배관 외경 0.114m를 스케일 기준으로 삼아 실제 치수에 가깝게 추정하라.
- 사진에 보이는 밸브·플랜지·신축관·지지대·계기도 빠뜨리지 말고 equipment에 넣어라. 색이 뚜렷하면 color로 알려줘도 된다(예: 파란 기어식 버터플라이, 빨간 경사형 체크밸브).
- 장비끼리 겹치지 않게 배치하고, 사진에 보이는 상대 위치·배관 흐름·분기 구조를 최대한 반영하라.
- 사진에서 확실하지 않은 부분은 합리적으로 추정하되, 존재하지 않는 장비를 과도하게 만들지 말 것.
- 장비 최대 25개, 배관 최대 30개.
- notes: 한국어 한 줄 요약 (예: "열교환기 2기와 펌프 2대, 상부 스팀 헤더 구조").

[출력 형식]
{"equipment":[{"type":"hx","name":"E-101 열교환기","x":0,"y":0,"z":0,"w":4.4,"h":0.9,"d":0.9,"rot":0},{"type":"bfly","name":"BF-101 버터플라이 밸브","x":-2,"y":0.95,"z":1.6,"w":0.34,"h":0.46,"d":0.32,"rot":0}],"pipes":[{"name":"150A 스팀 메인","bore":"150A","material":"carbon","points":[{"x":-5,"y":3.6,"z":-2},{"x":5,"y":3.6,"z":-2}]}],"notes":""}`;

const cleanModel = (m) => String(m || '').trim().replace(/^models\//, '');

// 모델 자체가 없거나 신규 사용자에게 닫힌 경우인지 (키 오류·한도 오류와 구분)
function modelUnavailable(status, detail) {
  if (status === 404) return true;
  const s = String(detail || '');
  return /no longer available|not found|not supported|unsupported|does not exist|decommission|deprecated|discontinued|is not available|no access/i.test(s);
}

// 다른 모델로 바꿔 재시도할 가치가 있는 실패인지.
// - 무료 한도 초과(429)는 모델마다 따로 잡히므로, 다른 후보 모델이나 이 키로 쓸 수 있는
//   다른 Flash/텍스트 모델에서는 성공할 수 있다 → 재시도한다.
// - API 키 자체 오류(400/403 "API key not valid")는 어떤 모델을 써도 결과가 같으므로 재시도하지 않는다.
function modelRetryable(status, detail) {
  const s = String(detail || '');
  if (/api key/i.test(s)) return false;
  if (status === 400 || status === 403) return false;
  if (status === 429) return true;
  if (status === 500 || status === 502 || status === 503 || status === 504) return true;
  return /high demand|overloaded|temporarily unavailable|try again|resource_exhausted|quota|rate limit/i.test(s);
}

async function callModel({ apiKey, model, text, mimeType, base64 }) {
  const url = `${API_ROOT}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: base64 ? [{ text }, { inlineData: { mimeType, data: base64 } }] : [{ text }],
        }],
        generationConfig: { temperature: 0.15, responseMimeType: 'application/json', maxOutputTokens: 16384 },
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
    const e = new Error(`Gemini 요청 실패 (${detail})`);
    e.status = res.status;
    e.detail = detail;
    e.modelUnavailable = modelUnavailable(res.status, detail) || (res.status === 400 && /model/i.test(detail) && /not|invalid/i.test(detail) && !/api key/i.test(detail));
    e.modelRetryable = !e.modelUnavailable && modelRetryable(res.status, detail);
    if (e.modelRetryable) {
      e.message = res.status === 429
        ? `이 모델의 Gemini 무료 사용량이 끝났습니다. 다른 모델로 시도합니다. (${detail})`
        : `Gemini 서버가 지금 혼잡합니다. (${detail})`;
    }
    if (!e.modelUnavailable) {
      if (res.status === 400 || res.status === 403) {
        if (/api key/i.test(detail)) e.message = `API 키가 올바르지 않습니다. (${detail})`;
      }
    }
    throw e;
  }

  const data = await res.json();
  const cand = data.candidates && data.candidates[0];
  if (cand && cand.finishReason === 'MAX_TOKENS') {
    throw new Error('분석 결과가 길어 잘렸습니다. 사진을 나눠 올리거나 현장 메모를 빼고 다시 시도해 주세요.');
  }
  const parts = cand && cand.content && cand.content.parts;
  const raw = parts ? parts.map((p) => p.text || '').join('') : '';
  if (!raw) {
    const block = data.promptFeedback && data.promptFeedback.blockReason;
    if (block) throw new Error(`Gemini가 이 사진을 처리하지 못했습니다 (${block}). 다른 사진으로 시도해 주세요.`);
    throw new Error('Gemini가 결과를 반환하지 않았습니다. 사진이 흐리거나 해상도가 낮을 수 있습니다.');
  }
  return raw;
}

// 지금 이 키로 쓸 수 있는 모델 이름 (flash 계열 우선, 그다음 최신 버전 순)
// 모델 이름 규칙은 세대마다 바뀌므로 flash가 없으면 다른 텍스트 모델도 후보로 남긴다.
export async function listFlashModels(apiKey) {
  try {
    const res = await fetch(`${API_ROOT}/models?pageSize=200&key=${encodeURIComponent(apiKey)}`);
    if (!res.ok) return [];
    const data = await res.json();
    const names = (data.models || [])
      .filter((m) => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
      .map((m) => cleanModel(m.name))
      .filter((n) => !/tts|image|audio|embedding|aqa|live|native|omni|transcribe|lyria|genie/i.test(n));
    return names.sort((a, b) => rank(b) - rank(a));
  } catch (e) {
    return [];
  }
}

function rank(name) {
  return (/flash/i.test(name) ? 10000 : 0) + versionScore(name);
}

function versionScore(name) {
  const nums = (String(name).match(/\d+(?:\.\d+)?/g) || []).map(Number);
  let s = 0;
  for (let i = 0; i < nums.length && i < 2; i++) s += nums[i] * (i === 0 ? 100 : 1);
  return s;
}

// 모델 폴백(고른 모델 → 기본 → 이 키에서 쓸 수 있는 모델 목록)을 한 곳에 모아 둔다.
async function requestWithFallback({ apiKey, model, text, mimeType, base64 }) {
  const tried = new Set();
  const queue = [];
  const push = (id) => {
    const c = cleanModel(id);
    if (c && !tried.has(c)) { tried.add(c); queue.push(c); }
  };
  push(model || DEFAULT_MODEL); // 사용자가 고른 모델
  push(DEFAULT_MODEL);          // 신규 키 기준 최신 기본값
  let listed = false;
  let lastErr = null;
  let attempts = 0;
  let sawQuota = false;   // 429(모델별 무료 한도 초과)를 한 번이라도 받았는지
  let sawOther = false;   // 429가 아닌 다른 실패도 있었는지
  // 서버가 계속 혼잡하거나 모든 모델이 한도에 걸릴 때 모델 수십 개를 끝까지 돌며
  // 오래 기다리지 않도록 횟수를 제한한다.
  const MAX_ATTEMPTS = 8;

  while (queue.length && attempts < MAX_ATTEMPTS) {
    const current = queue.shift();
    attempts++;
    try {
      const raw = await callModel({ apiKey, model: current, text, mimeType, base64 });
      return { raw, model: current };
    } catch (e) {
      lastErr = e;
      // 키 오류·결과 잘림·빈 응답 같은 재시도 무의미한 오류는 바로 알린다.
      if (!e || !(e.modelUnavailable || e.modelRetryable)) throw e;
      if (e.status === 429) sawQuota = true;
      else if (e.modelRetryable) sawOther = true;
      // 아직 목록을 못 봤다면, 이 키에서 실제로 쓸 수 있는 모델을 조회해 대기열에 넣는다.
      // 무료 한도(429)도 모델마다 따로 잡히므로, 목록을 받아 다른 Flash/텍스트 모델로 계속 시도한다.
      if (!listed) {
        listed = true;
        const avail = await listFlashModels(apiKey);
        avail.forEach(push);
      }
      // 과부하는 짧게 지나가는 경우가 많아 다음 모델로 넘어가기 전에 잠깐 쉰다.
      // 무료 한도 초과는 서버 혼잡이 아니라 그 모델의 할당량 문제라 기다릴 필요 없이 바로 다음 모델로 간다.
      if (e.modelRetryable && queue.length && e.status !== 429) {
        await new Promise((r) => setTimeout(r, 600));
      }
    }
  }

  // 모든 후보 모델이 무료 한도에 걸렸다면 그 사실을 분명히 안내한다.
  if (lastErr && lastErr.status === 429) {
    throw new Error('Gemini 무료 사용량을 초과했습니다. 잠시 후 다시 시도하거나 유료 결제를 연결해 주세요.');
  }
  if (sawQuota && !sawOther) {
    throw new Error('Gemini 무료 사용량을 초과했습니다. 잠시 후 다시 시도하거나 유료 결제를 연결해 주세요.');
  }
  if (lastErr && lastErr.modelRetryable) {
    throw new Error('Gemini 서버가 혼잡해 잠시 분석하지 못했습니다. 1~2분 뒤 다시 시도해 주세요.');
  }
  throw lastErr || new Error('Gemini 모델을 찾지 못했습니다. 설정에서 모델을 다시 골라 주세요.');
}

export async function analyzeImage({ apiKey, model, dataUrl, extraNote }) {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl || '');
  if (!m) throw new Error('이미지를 읽을 수 없습니다. JPG/PNG 파일을 올려주세요.');
  const mimeType = m[1];
  const base64 = m[2];
  const text = extraNote ? `${PROMPT}\n\n[현장 메모]\n${extraNote}` : PROMPT;
  const { raw, model: used } = await requestWithFallback({ apiKey, model, text, mimeType, base64 });
  return { data: parseResult(raw), model: used };
}

// ── 자유로운 말 → 명령 (로컬 파서가 못 알아들었을 때만) ─────────────────────
const COMMAND_PROMPT = `너는 배관 3D 앱의 명령 변환기다.
사용자의 자유로운 한국어 문장을 아래 ops JSON으로 바꿔라. 설명 문장은 넣지 말고 JSON 하나만 출력하라.

[동작]
- {"op":"bore","bore":"50A"}                       관경 변경 (15A·20A·25A·32A·40A·50A·65A·80A·100A·125A·150A·200A·250A·300A·350A·400A·450A·500A·550A·600A)
- {"op":"material","material":"carbon|sus|insulated"} 재질 변경
- {"op":"conn","conn":"flange|forged"}                    연결 방식 (flange=플랜지, forged=단조형·소켓웰드·나사식)
- {"op":"seg","axis":"x|y|z","sign":1|-1,"mm":500}  직선 배관 (x=오른쪽/왼쪽, y=위/아래, z=앞/뒤)
- {"op":"diag","axis":"x|z","sign":1|-1,"vert":1|-1,"angle":45,"mm":1000}  45도 경사
- {"op":"newpipe"}                                   새 배관 시작
- {"op":"equip","type":"...","bore1":"100A","bore2":"50A","conn":"forged"}  부속·장비 달기 (conn은 그 부속만 단조형으로 놓을 때)
- {"op":"connect","target":"equip|pipe","type":"valve","axis":"x","sign":1}  가까운 대상까지 잇기
- {"op":"delete","id":"...","name":"..."}          삭제 (방금 추가한 것을 지우면 {"op":"delete"})
- {"op":"move","id":"...","name":"...","x":1,"y":0,"z":2}  이동
- {"op":"undo"} | {"op":"reset"}

[type 값]
hx, pump, vpump, tank, stank, rtank, panel, valve(게이트밸브), bfly(버터플라이), yvalve(경사형·스트레이너),
ball(볼밸브), check(체크밸브), bellows(신축관), elbow(90도 엘보), elbow45(45도 엘보), tee(티), reducer(레듀샤),
nipple(니쁠), cap(캡·마개), union(유니온·소켓), flange(플랜지), support(서포트), gauge(압력계), flow(유량계)

[규칙]
- 길이 단위는 mm. "1미터"=1000, "50미리"는 관경 50A다.
- "단조모드"·"소켓타입"·"나사식"은 이후 부속·배관을 단조형으로, "플랜지모드"는 다시 플랜지로 바꾸는 conn 동작이다.
- "단조 볼밸브"·"소켓 엘보"처럼 부속 앞에 단조·소켓·나사가 붙으면 그 부속 하나만 equip에 "conn":"forged"로 넣는다.
- 현재 씬에 있는 이름/ID를 쓰면 그 대상을 지우거나 옮길 수 있다.
- 문장이 이미 애매하면 가장 그럴듯한 동작 하나만 만들고 say에 짧게 적어라.
- 출력 형식: {"say":"한 줄 요약","ops":[ ... ]}`;

export async function planCommand({ apiKey, model, text, scene }) {
  const prompt = `${COMMAND_PROMPT}\n\n[현재 씬]\n${JSON.stringify(scene)}\n\n[사용자 문장]\n${text}`;
  const { raw } = await requestWithFallback({ apiKey, model, text: prompt });
  const data = parseResult(raw);
  return {
    ops: Array.isArray(data.ops) ? data.ops : [],
    say: typeof data.say === 'string' ? data.say : '',
  };
}

function parseResult(raw) {
  const jsonText = extractJson(raw);
  try {
    return JSON.parse(jsonText);
  } catch (e) {
    throw new Error('AI 응답을 해석하지 못했습니다. 다시 시도해 주세요.');
  }
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
