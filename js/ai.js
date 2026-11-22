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
첨부된 이미지를 분석해서 아래 JSON 객체 하나만 출력하라. JSON 밖에 설명 문장을 쓰지 말 것.

[작업 순서 — 이 순서를 반드시 지켜라]
1) layoutPlan — 좌표를 만들기 전에 사진에서 읽은 구조를 한국어 6~10줄로 먼저 정리한다.
   ① 메인 설비(헤더·탱크·펌프·열교환기)의 종류·크기·위치·바닥 높이
   ② 분기 배관마다 어디서 시작해 어디로 가는지 (수직/수평 방향, 시작·끝 좌표의 대략 값)
   ③ 각 배관 위에 달린 밸브의 종류·방향(axis)·높이
   ④ 압력계·안전밸브·스트레이너 같은 계기·부속의 자리
2) 그 정리에 맞춰 equipment·pipes 좌표를 만든다. layoutPlan의 말과 좌표가 어긋나면 좌표를 고친다.
3) 마지막에 스스로 점검한다: 밸브가 헤더·탱크 몸통 속에 들어가 있지 않은가, 수직 배관 밸브에 axis: "y"를 넣었는가,
   가로로 누운 원통 분배기를 header로 골랐는가.

[최우선 기준 — 정확한 치수보다 라인·장비]
- 이 앱의 목적은 현장을 사람에게 설명하는 것이다. mm 치수를 정확히 맞히는 것보다
  **모든 배관 라인의 시작·꺾임·연결 흐름**과 **장비의 위치·방향·상대 간격**을 사진과 같게 그리는 것이 최우선이다.
- 치수가 1~2m 어긋나 잘못 읽히는 것은 괜찮다. 그러나 없는 라인을 만들거나, 보이는 라인을 빼거나,
  장비의 좌우 순서·바라보는 방향을 뒤집으면 그림이 쓸모없어진다.
- layoutPlan ①②에서 사진에 보이는 배관 라인을 손으로 세어 보고, 그 개수·분기 지점·꺾임 높이를 좌표에 그대로 옮겨라.
- 사진에서 보이는데 이름을 모르는 배관도 빼지 말고 가장 비슷한 bore·material로 넣어라.

[앞뒤 거리감(Z 깊이) — 납작하게 뭉치지 말 것]
- 사진 속 앞줄 배관 / 중간의 펌프·드럼 / 뒤쪽 제어반·후면 배관은 실제로 서로 1m 안팎씩 떨어져 있다.
- 앞줄과 뒤쪽 설비의 Z 간격, 설비 사이의 Z 간격을 최소 0.8~1.5m 이상 넉넉히 주어라.
  모든 장비를 z=0 근처 한 줄에 몰아넣으면 사진과 다른 납작한 그림이 된다.
- 카메라가 비스듬히 본 사진에서 뒤로 갈수록 작게 보이는 것을 원근으로 판단하라 — 작게 보이는 쪽이 먼 쪽(Z가 큰 쪽)이다.
- 바닥에 그은 앞뒤 간격은 equipment의 z 값과 배관 points의 z 값에 모두 반영하라(배관만 앞에 두지 말 것).

[펌프 방향(rot)]
- pump는 흡입·토출 배관이 붙는 방향에 맞춰 rot를 정하라. 모터가 뒤쪽, 흡입구가 앞쪽 배관을 보는 것이 기본이다.
- 흡입 배관이 −X에서 오면 rot 180, +X에서 오면 rot 0, +Z에서 오면 rot 90, −Z에서 오면 rot 270 으로 두어
  모터(몸통 뒤쪽)가 배관 반대쪽을 보게 하라. 0/90/180/270 중 하나를 반드시 골라라.
- 그 펌프의 흡입·토출 배관 끝점은 펌프 몸통 앞·옆면(x±w/2, z±d/2) 노즐 높이에 맞춰라.
- vpump(입형 인라인)는 아래 흡입·위 토출이라 rot는 배관이 지나가는 방향만 맞추면 된다.

[배관 연결 완결성 — 공중에 뜬 배관 금지]
- 사진에서 이어지는 수직·수평 구간과 하부 배관까지 이어서, 끝점 좌표를 서로 맞춰라.
- 배관 끝은 반드시 (a) 다른 배관의 끝점, (b) 다른 배관의 중간(티 분기), (c) 장비의 노즐 중 하나에 닿아야 한다.
  어디에도 닿지 않고 공중에서 끝나는 배관을 만들지 말 것.
- 이어지는 두 끝점은 같은 좌표로 적어라. 0.25m 안쪽으로 살짝 어긋난 것은 앱이 붙여 주지만 그보다 크면 끊어진 배관으로 보인다.
- 수직관이 위에서 수평관으로 꺾이면, 그 수평관의 끝점을 수직관 꼭대기와 같은 좌표로 적어라(엘보로 이어진다).

[색 구분 — 부품별로]
- 사진에서 색이 보이면 부품별로 구분해 color를 적어라: 은색 밸브·SUS 배관 "#c8ced4", 흑관·카본 "#3a3f44",
  파랑 기어 버터플라이·설비 "#1f5fd0", 적색 방청·스팀 배관 "#b04a35", 초록 "#2e7d4f", 노랑 "#d8b02a".
- 같은 배관이라도 구간별로 도색이 다르면 구간을 나눠 배관을 따로 만들고 각각 color를 적어라.
- 한 장면에서 은색·흑관·파랑·적색이 모두 보이면 넷 다 구분되어야 한다(전부 흑관으로 뭉개지 말 것).

[사진이 여러 장일 때]
- 첨부된 사진들은 같은 현장(또는 같은 도면)을 다른 각도·다른 구역에서 찍은 것으로 보고, 하나의 일관된 3D 장면으로 종합하라.
- 같은 장비·배관이 여러 사진에 나오면 이름과 위치를 기준으로 하나로 합쳐라. 사진마다 같은 장비를 복제하지 말 것.
- 서로 다른 구역을 찍은 사진들은 사진에 보이는 연결 관계·배관 흐름대로 이어 붙여라. 겹치는 부분은 위치를 맞춰라.
- 평면 도면과 현장 사진이 섞여 있으면 도면의 배치·치수·분기 구조를 우선하고, 사진은 장비 모양·색·부속 확인에 써라.
- 사진마다 확실한 정보가 다르므로, 한 사진에서 본 부속을 다른 사진의 같은 배관 위치에 붙여도 된다.
- 정면 사진 하나와 측면·위쪽에서 찍은 추가 사진이 같이 있으면, 측면·위쪽 사진으로 앞뒤 깊이(Z)와 배관이 꺾이는 방향을 먼저 확정하고 정면 사진으로 좌우(X)를 맞춰라.
  같은 배관이 두 사진에서 다른 길이로 보이면 실제 길이는 더 길게 보이는 쪽(정면에 가까운 쪽)을 따르고, 방향은 측면 사진을 따르라.

[좌표계]
- 단위: 미터(m). 바닥면 y = 0.
- X: 화면 오른쪽(+), Z: 화면 앞쪽(+), Y: 높이(+).
- 장비의 x, z는 장비 중심, y는 장비 밑면 높이(보통 0). 배관 points의 y는 관 중심 높이.
- 밸브·피팅·계기의 y는 그 물체의 중심 높이다 (배관에 달면 배관 중심 높이와 같다).

[장비·부속 equipment 필드]
- type: 아래 26종 중 하나를 정확히 골라 쓸 것
  · "header" 스팀/배관 헤더 — 가로로 누운 원통형 배관 분배기. 위/아래로 여러 수직 배관이 꽂히는 설비.
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
  · "safety_valve" 안전밸브·감압밸브(세로 몸체 + 상부 스프링 보닛 + 측면 토출구)
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
- name: 한국어 이름 (예: "HDR-101 스팀 헤더", "BF-101 버터플라이 밸브", "T-201 저장탱크")
- x, y, z: 위치(m).
  · 헤더·탱크·펌프·열교환기·서포트·제어반은 바닥에 놓으므로 y=0.
  · 밸브·피팅·플랜지·계기는 배관 위에 달리므로 y = 그 배관의 중심 높이.
- w: X방향 길이, h: 높이, d: Z방향 폭 (모두 m)
- rot: Y축 회전 각도(도). 0, 90, 180, 270 중 하나를 우선 사용.
  · 헤더가 좌우(X)로 길면 0, 앞뒤(Z)로 길면 90.
  · 세로로 세운 밸브는 수직축 둘레로 핸들이 나올 방향을 정한다(앞을 보면 0, 옆이면 90).
- axis: 밸브·피팅·계기의 배관 축 방향. "x" 또는 "z" = 수평(누운 배관), "y" = 수직(세운 배관).
  수평 배관에 달면 넣지 않아도 되고(기본 수평), 수직 배관에 달면 반드시 "y"를 넣는다.
- bore: 그 부속이 달린 배관 관경("100A" 형식). 넣으면 몸체·핸들 크기가 관경에 비례해 자동으로 잡힌다.
- color: 사진에서 확실한 색이 보이면 hex로 적는다("#b04a35" 적색 방청·스팀, "#c8ced4" 은색 아연도·SUS, "#9aa3ab" 회색, "#1f5fd0" 파랑, "#2e7d4f" 초록, "#d8b02a" 노랑, "#3a3f44" 검정).
  색이 애매하면 넣지 말 것(기본 재질색 유지). 실제 사진 색과 3D가 맞으면 설명이 훨씬 쉬워진다.
- 기본 크기(m) — 사진에서 확실한 근거가 있으면 그 값을 써도 된다:
  header 2.4×0.4×0.4(길이×지름×지름) · hx 3.0×0.75×0.75 · pump 1.15×0.85×0.6 · vpump 0.42×0.85×0.42 ·
  tank 0.6×0.9×0.6 · stank 2.0×3.0×2.0 · rtank 2.4×1.8×1.8 · panel 1.2×2.0×0.7 ·
  valve 0.34×0.58×0.3 · bfly 0.34×0.46×0.32 · yvalve 0.36×0.5×0.34 · ball 0.26×0.34×0.24 · check 0.24×0.26×0.22 ·
  safety_valve 0.22×0.52×0.22 · bellows 0.304×0.34×0.34 · elbow 0.3×0.3×0.22 · elbow45 0.14×0.16×0.11 ·
  tee 0.34×0.26×0.22 · reducer 0.32×0.22×0.22 · nipple 0.146×0.1×0.1 · cap 0.148×0.11×0.11 · union 0.206×0.1×0.1 ·
  flange 0.06×0.26×0.26 · support 0.5×0.85×0.4 · gauge 0.2×0.34×0.16 · flow 0.24×0.44×0.24
- tee·reducer는 관경을 알면 bore1(주배관·1차) / bore2(분기·2차)에 "100A" 형식으로 넣어라 (예: 레듀샤 100A→50A). 모르면 빼도 된다.
- conn: 배관과 만나는 접합 방식. "flange"(플랜지·볼트 원판, 기본값) 또는 "forged"(단조형·소켓웰드·나사식, 플랜지 없이 소켓 보스만).
  사진에서 플랜지 볼트 원판이 보이지 않고 소켓·나사 조임부로 이어지면 "forged"를 써라. 확실하지 않으면 넣지 않는다(기본 플랜지).

[헤더(header) 배치 규칙 — 가장 많이 틀리는 부분]
- 가로로 누운 큰 원통에 배관이 여러 개 꽂히는 설비(스팀 헤더·분배기·매니폴드·드럼 헤더)는 반드시 type: "header"다.
  stank·tank(세로 원통)로 그리면 사진과 전혀 다른 그림이 된다. 절대 tank/stank를 쓰지 말 것.
- header의 y는 0(바닥)이다. 지지 프레임이 포함되어 있고, 원통 중심은 y + h×2, 원통 윗면은 y + h×2.5 높이다.
  (h=0.4 기본이면 중심 0.8m, 윗면 1.0m — 사람 허리 높이의 가로 배관)
- 헤더에서 위로 올라가는 배관은 헤더 윗면(y + h×2.5)에서 시작한다. 헤더 몸통 속(y + h×2 근처)에서 시작하면 안 된다.
- 헤더 아래로 내려가는 드레인·하부 배관은 헤더 밑면(y + h×1.5)에서 시작한다.

[수직 배관과 밸브 — 두 번째로 많이 틀리는 부분]
- 수직으로 올라가거나 내려가는 배관(|y 변화|가 수평 이동보다 큰 구간)에 달린 밸브·피팅은 반드시 axis: "y"를 넣는다.
  axis를 빼면 밸브가 배관 위에 누워서 그려진다.
- axis: "y"인 밸브의 x, z는 그 수직 배관의 중심과 같게 하고, y는 밸브가 실제로 있는 높이로 적는다.
- 수직 배관 밸브는 헤더 윗면보다 위에 있어야 한다. 헤더 몸통 속 좌표(y가 y+h×1.5 ~ y+h×2.5 사이)에 두면 밸브가 묻힌다.
- 압력계(gauge)는 배관에 붙는 작은 계기다. 앱이 가장 가까운 배관 외벽에 니쁠을 직각으로 꽂아 주므로,
  대략 그 배관 옆으로 0.2m 비껴 놓기만 하면 된다(수직관은 옆·앞, 수평관은 위). 방향·회전은 비워 두어도 된다.
- 안전밸브·감압밸브(safety_valve)는 수직 배관 위에 서고, 위로 스프링 보닛이 솟는다. y는 밸브 몸체 중심 높이다.

- 수직으로 올라가는 배관은 위 끝의 x, z를 아래 끝과 **똑같이** 적어라 — 몇 cm씩 비스듬히 기운 수직관은 현장에 없다.
- 압력계(gauge)는 수직관·수평관 어디에나 붙는다. 가장 가까운 배관에서 옆(수직관) 또는 위(수평관)로 0.2m 비켜 놓으면
  앱이 니쁠을 배관에 직각으로 꽂고 다이얼을 바깥으로 돌린다(방향·회전은 몰라도 된다).

[관경 추론 — 사진 비율로]
- 사람 키 1.7m, 밸브 핸드휠 지름 0.35m, 100A 배관 외경 0.114m를 스케일 기준으로 삼아라.
- 헤더 본체 지름이 사람 허리~가슴 높이만큼 두꺼우면 250A~300A, 머리만 하면 300A~350A다.
- 헤더에서 갈라지는 주 분기 수직관은 100A~150A, 큰 설비 연결관은 150A~200A,
  계기·드레인·소구경 바이패스는 15A~25A, 일반 분기 25A~50A로 추론하라.
- 사진에서 굵기가 다른 관이 나란히 보이면 굵은 쪽을 100A 이상, 가는 쪽을 25A 이하로 잡아 비율을 살려라.

[배관 pipes 필드]
- name: 한국어 이름 (예: "150A 스팀 메인")
- bore: "15A" | "20A" | "25A" | "32A" | "40A" | "50A" | "65A" | "80A" | "100A" | "125A" | "150A" | "200A" | "250A" | "300A" | "350A" | "400A" | "450A" | "500A" | "550A" | "600A" 중 하나
- material: "carbon"(흑관·카본스틸) | "sus"(스테인리스) | "insulated"(보온배관)
- color: 사진에서 관 색이 뚜렷하면 hex (적색 방청 배관 "#b04a35", 은색 아연도 "#c8ced4" 등). 없으면 빼도 된다.
- points: 꺾이는 지점을 모두 포함한 [{x,y,z}, ...] 배열 (최소 2개). 수직 상승/하강과 엘보를 그대로 표현.
- 배관은 장비의 노즐 위치에서 시작하거나 끝나게 맞춰라.
- 서로 이어지는 배관의 끝점은 정확히 같은 좌표로 적어라 (0.25m 넘게 어긋나면 끊어진 배관으로 보인다).

[규칙]
- 사진에 보이는 밸브·플랜지·신축관·지지대·계기도 빠뜨리지 말고 equipment에 넣어라.
- 장비끼리 겹치지 않게 배치하고, 사진에 보이는 상대 위치·배관 흐름·분기 구조를 최대한 반영하라.
- 사진에서 확실하지 않은 부분은 합리적으로 추정하되, 존재하지 않는 장비를 과도하게 만들지 말 것.
- 장비 최대 25개, 배관 최대 30개.
- notes: 한국어 한 줄 요약 (예: "적색 스팀 헤더 1기와 수직 분기 3줄, 버터플라이·안전밸브·압력계").

[출력 형식 — layoutPlan을 맨 앞에 둔다]
{"layoutPlan":"1) 메인 설비: 적색 스팀 헤더 HDR-101(길이 2.4m, 지름 0.4m, 바닥 y=0, 윗면 1.0m)가 화면 가운데를 좌우로 지난다.\\n2) 분기 배관: 헤더 윗면 x=-0.8/0/0.8 세 곳에서 100A 수직관이 위로 올라가 상부 헤더(y=3.0)에 닿는다.\\n3) 밸브: 세 수직관에 기어 버터플라이(파랑, axis y, y=1.5), 왼쪽 수직관에 안전밸브(y=2.2)...\\n4) 계기: 각 수직관 옆에 압력계(관 중심에서 +Z로 0.2m)...","equipment":[{"type":"header","name":"HDR-101 스팀 헤더","x":0,"y":0,"z":0,"w":2.4,"h":0.4,"d":0.4,"rot":0,"color":"#b04a35"},{"type":"bfly","name":"BF-101 버터플라이 밸브","x":-0.8,"y":1.5,"z":0,"w":0.17,"h":0.46,"d":0.32,"rot":0,"axis":"y","color":"#1f5fd0"}],"pipes":[{"name":"100A 수직 분기","bore":"100A","material":"carbon","color":"#b04a35","points":[{"x":-0.8,"y":1.0,"z":0},{"x":-0.8,"y":3.0,"z":0}]}],"notes":""}`;

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

async function callModel({ apiKey, model, text, mimeType, base64, images }) {
  const url = `${API_ROOT}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  // 사진 여러 장이면 parts에 텍스트 한 번 + 이미지 N장을 담아 한 번의 요청으로 보낸다.
  // 이미지마다 라벨("[전체 사진]"·"[사진 2/3: 측면]" 같은)을 바로 앞에 붙여, Gemini가
  // 어느 사진이 정면이고 어느 쪽이 다른 각도인지 알고 깊이를 잡게 한다.
  const reqParts = [{ text }];
  const list = Array.isArray(images) && images.length ? images : (base64 ? [{ mimeType, base64 }] : []);
  list.forEach((im, i) => {
    if (!im || !im.base64) return;
    const label = im.label ? String(im.label) : `[사진 ${i + 1}]`;
    reqParts.push({ text: label });
    reqParts.push({ inlineData: { mimeType: im.mimeType || 'image/jpeg', data: im.base64 } });
  });
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: reqParts }],
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
async function requestWithFallback({ apiKey, model, text, mimeType, base64, images }) {
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
      const raw = await callModel({ apiKey, model: current, text, mimeType, base64, images });
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

// data URL → {mimeType, base64}. 여러 장을 받을 때는 한 장씩 여기서 꺼낸다.
function splitDataUrl(dataUrl) {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl || '');
  if (!m) throw new Error('이미지를 읽을 수 없습니다. JPG/PNG 파일을 올려주세요.');
  return { mimeType: m[1], base64: m[2] };
}

// 사진 여러 장(도면·현장 사진·손그림)을 한 번에 분석한다.
// dataUrls에는 data URL 문자열과 {src|dataUrl, label}을 섮어 넣을 수 있다.
// 라벨이 있으면 그 이미지 바로 앞에 라벨 텍스트를 붙여 보낸다(정면/측면 구분용).
// 한 장만 올렸을 때도 같은 경로를 쓴다 — 예전 analyzeImage는 이 함수를 감싼 것이다.
export async function analyzeImages({ apiKey, model, dataUrls, extraNote }) {
  const raw = Array.isArray(dataUrls) ? dataUrls : [dataUrls];
  const list = raw
    .map((it) => {
      if (!it) return null;
      if (typeof it === 'string') return { dataUrl: it, label: '' };
      const d = it.src || it.dataUrl || '';
      return d ? { dataUrl: d, label: typeof it.label === 'string' ? it.label : '' } : null;
    })
    .filter(Boolean);
  if (!list.length) throw new Error('분석할 사진을 한 장 이상 올려주세요.');
  if (list.length > 8) throw new Error('사진은 한 번에 최대 8장까지 분석할 수 있습니다.');
  const images = list.map((it) => ({ ...splitDataUrl(it.dataUrl), label: it.label }));
  const text = extraNote ? `${PROMPT}\n\n[현장 메모]\n${extraNote}` : PROMPT;
  const { raw: out, model: used } = await requestWithFallback({ apiKey, model, text, images });
  return { data: parseResult(out), model: used, count: images.length };
}

export async function analyzeImage({ apiKey, model, dataUrl, extraNote }) {
  return analyzeImages({ apiKey, model, dataUrls: [dataUrl], extraNote });
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
header(스팀·배관 헤더·매니폴드), hx, pump, vpump, tank, stank, rtank, panel, valve(게이트밸브), bfly(버터플라이),
yvalve(경사형·스트레이너), ball(볼밸브), check(체크밸브), safety_valve(안전·감압밸브), bellows(신축관),
elbow(90도 엘보), elbow45(45도 엘보), tee(티), reducer(레듀샤), nipple(니쁠), cap(캡·마개), union(유니온·소켓),
flange(플랜지), support(서포트), gauge(압력계), flow(유량계)

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
