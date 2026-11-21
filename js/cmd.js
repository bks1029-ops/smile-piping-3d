// 스마일산업 3D 배관 — mm 단위 한 줄 배관 명령 파서
// 외부 API 없이 브라우저에서 바로 해석한다. 길이 단위는 기본 mm, `1.5m`처럼 m를 붙이면 미터.
import { BORES, MATERIALS } from './store.js?v=37';

// ── 음성·구어체 보조 정규화 ─────────────────────────────────────────────
// 현장에서 말로 하면 "50에이", "오십에이", "천", "천오백", "1,000" 처럼 들어온다.
// 숫자·관경 표기로 바꿔 두면 아래 파서가 그대로 알아본다.
const KO_DIGIT = { 영: 0, 일: 1, 이: 2, 삼: 3, 사: 4, 오: 5, 육: 6, 칠: 7, 팔: 8, 구: 9 };
const KO_SCALE = { 십: 10, 백: 100, 천: 1000, 만: 10000 };

// '천오백'=1500, '오백'=500, '이천'=2000, '오십'=50 — 단위(십·백·천·만)가 있을 때만 숫자로 본다.
// ('이'·'삼' 같은 한 글자는 '이어'·'삼각' 같은 말과 헷갈릴 수 있어 건드리지 않는다.)
function koNumeralToInt(tok) {
  if (!/^[영일이삼사오육칠팔구십백천만]+$/.test(tok)) return null;
  if (!/[십백천만]/.test(tok)) return null;
  let total = 0;
  let cur = 0;
  for (const ch of tok) {
    if (KO_DIGIT[ch] != null) { cur = KO_DIGIT[ch]; continue; }
    const u = KO_SCALE[ch];
    if (!u) return null;
    total += (cur || 1) * u;
    cur = 0;
  }
  total += cur;
  return total > 0 && total <= 100000 ? total : null;
}

// 고유어 수사 — "스물다섯에이", "서른둘에이", "쉰에이"처럼 십 단위까지 현장에서 쓴다.
const KO_NATIVE_TENS = { 열: 10, 스물: 20, 스무: 20, 서른: 30, 마흔: 40, 쉰: 50, 예순: 60, 일흔: 70, 여든: 80, 아흔: 90 };
const KO_NATIVE_UNIT = { 한: 1, 두: 2, 둘: 2, 세: 3, 셋: 3, 네: 4, 넷: 4, 다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9 };

export function normalizeSpoken(text) {
  let s = String(text == null ? '' : text);
  // 1) 1,000 처럼 숫자 사이에 찍힌 쉼표
  s = s.replace(/(\d),(?=\d{3}(?:\D|$))/g, '$1');
  // 2) '50에이' · '오십에이' · '스물다섯에이' → '50a' (관경)
  s = s.replace(/(열|스물|스무|서른|마흔|쉰|예순|일흔|여든|아흔)(한|두|둘|세|셋|네|넷|다섯|여섯|일곱|여덟|아홉)?\s*(?:에이형|에이급|에이에|에이)(?![가-힣])/g,
    (m, ten, unit) => `${KO_NATIVE_TENS[ten] + (unit ? KO_NATIVE_UNIT[unit] : 0)}a`);
  s = s.replace(/(\d+|[영일이삼사오육칠팔구십백천만]+)\s*(?:에이형|에이급|에이에|에이)(?![가-힣])/g, (m, num) => {
    const n = /^\d+$/.test(num) ? num : koNumeralToInt(num);
    return n == null ? m : `${n}a`;
  });
  // 3) 남은 고유어 수사 → 숫자
  s = s.split(/(\s+)/).map((tok) => {
    const n = koNumeralToInt(tok);
    return n == null ? tok : String(n);
  }).join('');
  return s;
}

// 방향 — 긴 표현을 먼저 본다. (긴 것부터 매칭)
const DIRS = [
  ['오른쪽', 'x', 1], ['우측', 'x', 1], ['오른', 'x', 1], ['우', 'x', 1], ['우로', 'x', 1], ['오른쪽으로', 'x', 1],
  ['왼쪽', 'x', -1], ['좌측', 'x', -1], ['왼', 'x', -1], ['좌', 'x', -1], ['좌로', 'x', -1], ['왼쪽으로', 'x', -1],
  ['위쪽', 'y', 1], ['위로', 'y', 1], ['위', 'y', 1], ['상승', 'y', 1], ['상', 'y', 1],
  ['올려', 'y', 1], ['올리', 'y', 1], ['올라', 'y', 1], ['올려줘', 'y', 1], ['올려서', 'y', 1], ['올리고', 'y', 1], ['올라가', 'y', 1],
  ['아래쪽', 'y', -1], ['아래로', 'y', -1], ['아래', 'y', -1], ['하강', 'y', -1], ['하', 'y', -1],
  ['내려', 'y', -1], ['내리', 'y', -1], ['내려줘', 'y', -1], ['내려서', 'y', -1], ['내리고', 'y', -1], ['내려가', 'y', -1], ['내려와', 'y', -1],
  ['앞쪽', 'z', 1], ['앞으로', 'z', 1], ['앞', 'z', 1], ['전진', 'z', 1], ['전', 'z', 1],
  ['나와', 'z', 1], ['나가', 'z', 1], ['나오', 'z', 1], ['앞으로가', 'z', 1],
  ['뒤쪽', 'z', -1], ['뒤로', 'z', -1], ['뒤', 'z', -1], ['후진', 'z', -1], ['후', 'z', -1],
  ['들어가', 'z', -1], ['들어', 'z', -1], ['뒤로가', 'z', -1],
];

// 말버릇·군더더기 — 뜻이 없으므로 무시한다.
const FILLER = new Set([
  '좀', '쫌', '줌', '조금', '약간', '잠깐', '대충', '다시', '한번', '번', '더', '좀더',
  '해줘', '해주세요', '해라', '해봐', '해', '주세요', '줘', '줄래', '줄래요',
  '달아줘', '달아주세요', '달아', '달어', '놔줘', '놔', '놓고', '놔라',
  '가다가', '해서', '써서', '쓰고', '같은', '하나', '한개', '한', '개', '이거', '그거', '저거',
  '바꿔서', '바꿔', '바꾸고', '바꿔줘', '맞춰서', '맞춰', '가면서', '가서', '놓으면', '하면',
  '요', '여기', '거기', '저기', '이쪽', '그쪽', '쪽', '정도', '쯤', '반', '번쯤',
]);

// 지우기 의도
const DELETE_WORDS = new Set(['지워', '지우', '지워줘', '삭제', '삭제해', '삭제해줘', '빼', '빼줘', '없애', '없애줘', '제거', '제거해']);

// 부속·장비 별칭 (공백을 지운 형태로 비교)
const EQUIP_ALIASES = [
  ['열교환기', 'hx'], ['열교환', 'hx'], ['hx', 'hx'],
  ['입형인라인펌프', 'vpump'], ['입형펌프', 'vpump'], ['인라인펌프', 'vpump'], ['인라인', 'vpump'],
  ['입형', 'vpump'], ['수직펌프', 'vpump'], ['vpump', 'vpump'],
  ['원심펌프', 'pump'], ['원심', 'pump'], ['펌프', 'pump'], ['pump', 'pump'],
  ['대형원통저장탱크', 'stank'], ['원통저장탱크', 'stank'], ['저장탱크', 'stank'],
  ['원통탱크', 'stank'], ['대형탱크', 'stank'], ['원통', 'stank'], ['stank', 'stank'],
  ['사각수조', 'rtank'], ['사각탱크', 'rtank'], ['물탱크', 'rtank'], ['수조', 'rtank'], ['rtank', 'rtank'],
  ['소형탱크', 'tank'], ['드럼', 'tank'], ['탱크', 'tank'], ['tank', 'tank'],
  ['제어반', 'panel'], ['mcc', 'panel'], ['panel', 'panel'],
  ['게이트밸브', 'valve'], ['게이트벨브', 'valve'], ['게이트', 'valve'],
  ['밸브', 'valve'], ['벨브', 'valve'], ['valve', 'valve'],
  ['버터플라이밸브', 'bfly'], ['버터플라이벨브', 'bfly'], ['버터플라이', 'bfly'], ['버터', 'bfly'], ['bfly', 'bfly'],
  ['경사형체크밸브', 'yvalve'], ['경사형체크벨브', 'yvalve'], ['경사체크밸브', 'yvalve'],
  ['경사체크벨브', 'yvalve'], ['경사체크', 'yvalve'], ['경사밸브', 'yvalve'], ['경사형', 'yvalve'],
  ['스트레이너밸브', 'yvalve'], ['스트레이너벨브', 'yvalve'], ['스트레이너', 'yvalve'],
  ['와이밸브', 'yvalve'], ['와이벨브', 'yvalve'], ['y밸브', 'yvalve'], ['y벨브', 'yvalve'], ['yvalve', 'yvalve'],
  ['볼밸브', 'ball'], ['볼벨브', 'ball'], ['볼', 'ball'], ['ball', 'ball'],
  ['체크밸브', 'check'], ['체크벨브', 'check'], ['체크', 'check'], ['check', 'check'],
  ['스윙체크밸브', 'check'], ['스윙체크벨브', 'check'], ['스윙체크', 'check'],
  ['벨로우즈신축관', 'bellows'], ['벨로우즈', 'bellows'], ['신축관', 'bellows'],
  ['플렉시블조인트', 'bellows'], ['플렉시블', 'bellows'], ['후렉시블', 'bellows'],
  ['휴렉시블', 'bellows'], ['플랙시블', 'bellows'], ['조인트', 'bellows'], ['bellows', 'bellows'],
  ['90도엘보', 'elbow'], ['엘보우', 'elbow'], ['엘보', 'elbow'], ['곡관', 'elbow'], ['elbow', 'elbow'],
  ['45도엘보', 'elbow45'], ['45엘보', 'elbow45'], ['45°엘보', 'elbow45'], ['45도엘보우', 'elbow45'],
  ['elbow45', 'elbow45'], ['e45', 'elbow45'],
  ['티분기관', 'tee'], ['티분기', 'tee'], ['분기관', 'tee'], ['분기', 'tee'], ['티', 'tee'], ['tee', 'tee'],
  ['레듀샤', 'reducer'], ['레듀서', 'reducer'], ['레듀사', 'reducer'], ['이경관', 'reducer'], ['축소관', 'reducer'], ['reducer', 'reducer'],
  ['육각니쁠', 'nipple'], ['단니쁠', 'nipple'], ['니쁠', 'nipple'], ['니플', 'nipple'], ['니뿔', 'nipple'], ['nipple', 'nipple'],
  ['엔드캡', 'cap'], ['배관캡', 'cap'], ['마개', 'cap'], ['캡', 'cap'], ['endcap', 'cap'], ['cap', 'cap'],
  ['유니온', 'union'], ['커플링', 'union'], ['소켓', 'union'], ['union', 'union'], ['coupling', 'union'],
  ['플랜지', 'flange'], ['플렌지', 'flange'], ['후렌지', 'flange'], ['후랜지', 'flange'], ['flange', 'flange'],
  ['파이프서포트', 'support'], ['서포트', 'support'], ['지지대', 'support'], ['행거', 'support'], ['support', 'support'],
  ['유량계', 'flow'], ['플로우미터', 'flow'], ['플로미터', 'flow'], ['유량', 'flow'], ['flowmeter', 'flow'], ['flow', 'flow'],
  ['압력계', 'gauge'], ['온도계', 'gauge'], ['게이지', 'gauge'], ['계기', 'gauge'], ['gauge', 'gauge'],
].sort((a, b) => b[0].length - a[0].length);

// 띄어 쓴 부속 이름 — 붙여 쓴 형태와 같은 부속 하나로 합친다. ("볼 벨브" → 볼밸브 1개)
// 왼쪽: 공백을 지운 낱말들, 오른쪽: 파서가 아는 한 낱말.
const SPACED_FITTINGS = new Map([
  ['볼벨브', '볼밸브'], ['볼밸브', '볼밸브'],
  ['체크벨브', '체크밸브'], ['체크밸브', '체크밸브'],
  ['게이트벨브', '게이트밸브'], ['게이트밸브', '게이트밸브'],
  ['버터플라이벨브', '버터플라이밸브'], ['버터플라이밸브', '버터플라이밸브'],
  ['스윙체크벨브', '스윙체크'], ['스윙체크밸브', '스윙체크'], ['스윙체크', '스윙체크'],
  ['경사체크벨브', '경사체크'], ['경사체크밸브', '경사체크'], ['경사체크', '경사체크'],
  ['경사형체크벨브', '경사형체크밸브'], ['경사형체크밸브', '경사형체크밸브'],
  ['스트레이너벨브', '스트레이너'], ['스트레이너밸브', '스트레이너'],
  ['와이벨브', '와이밸브'], ['y벨브', 'y밸브'],
]);

// ── 연결 방식 명령 ───────────────────────────────────────────────────────────
// 이후에 놓는 배관·부속의 접합 방식을 바꾼다. (플랜지 = 기본, 단조 = 소켓웰드·나사식)
const CONN_WORDS = new Map([
  ['단조', 'forged'], ['단조형', 'forged'], ['단조타입', 'forged'], ['단조모드', 'forged'], ['단조식', 'forged'],
  ['포지드', 'forged'],
  ['소켓타입', 'forged'], ['소켓형', 'forged'], ['소켓모드', 'forged'], ['소켓웰드', 'forged'], ['소켓식', 'forged'],
  ['나사', 'forged'], ['나사식', 'forged'], ['나사타입', 'forged'], ['나사모드', 'forged'], ['나사형', 'forged'],
  ['플랜지모드', 'flange'], ['플렌지모드', 'flange'], ['플랜지타입', 'flange'], ['플렌지타입', 'flange'],
  ['플랜지형', 'flange'], ['플렌지형', 'flange'], ['플랜지식', 'flange'], ['플렌지식', 'flange'],
]);

// 부속 이름 앞에 붙어 그 한 개만 단조형으로 만드는 말 — "단조 볼밸브", "소켓 엘보", "나사 밸브"
const FORGED_PREFIX = new Set(['단조', '소켓', '나사', '포지드']);

const MATERIAL_ALIASES = [
  ['스테인리스', 'sus'], ['스테인레스', 'sus'], ['스텐', 'sus'], ['sus', 'sus'],
  ['카본스틸', 'carbon'], ['카본', 'carbon'], ['흑관', 'carbon'], ['탄소강', 'carbon'], ['carbon', 'carbon'],
  ['보온배관', 'insulated'], ['보온', 'insulated'], ['insulated', 'insulated'],
].sort((a, b) => b[0].length - a[0].length);

const COMMANDS = [
  ['새배관', 'newpipe'], ['새파이프', 'newpipe'], ['새로', 'newpipe'], ['줄바꿈', 'newpipe'], ['새줄', 'newpipe'], ['new', 'newpipe'],
  ['되돌리기', 'undo'], ['되돌려', 'undo'], ['언두', 'undo'], ['취소', 'undo'], ['undo', 'undo'],
  ['초기화', 'reset'], ['리셋', 'reset'], ['클리어', 'reset'], ['비우기', 'reset'], ['reset', 'reset'],
  ['전체삭제', 'reset'], ['새도면', 'reset'], ['다지워', 'reset'], ['모두지워', 'reset'], ['싹지워', 'reset'],
  ['처음부터', 'reset'], ['빈도면', 'reset'], ['clear', 'reset'],
  ['도움말', 'help'], ['도움', 'help'], ['예시', 'help'], ['사용법', 'help'], ['help', 'help'], ['?', 'help'],
  ['실행', 'noop'], ['run', 'noop'],
  // 말로 이어 쓰는 연결어·위치 표현은 실행에 영향이 없다
  ['끝에', 'noop'], ['끝', 'noop'], ['다음', 'noop'], ['그다음', 'noop'], ['그리고', 'noop'],
  ['이어서', 'noop'], ['에', 'noop'],
  ['에서', 'noop'], ['부터', 'noop'], ['까지', 'noop'],
  // "가장 가까운 배관 연결" 같은 말투
  ['가장', 'noop'], ['제일', 'noop'], ['가까운', 'noop'], ['가까운곳', 'noop'],
];

// 붙이기·잇기 동사 — "벨브에 붙여줘", "오른쪽 배관이랑 이어줘"
const CONNECT_WORDS = new Set([
  '붙여줘', '붙혀줘', '붙여', '붙혀', '붙여라', '붙혀라', '붙여주세요', '붙혀주세요', '붙여봐', '붙혀봐',
  '이어줘', '이어라', '이어봐', '이어주세요', '이어줄래', '잇어줘',
  '연결해줘', '연결해', '연결해라', '연결해주세요', '연결해줄래', '연결',
]);

// 배관을 가리키는 말 (연결 대상)
const PIPE_WORDS = new Set(['배관', '파이프', '관']);

// "엘보써서", "밸브달고" 같은 현장 말투에서 동사 어미를 떼어낸다.
const VERB_SUFFIX = [
  '써서', '쓰고', '쓴', '써', '달고', '달아서', '달아', '달면', '달기',
  '끼고', '끼워서', '끼워', '넣고', '넣어서', '박고', '붙이고', '장착하고', '장착', '설치하고', '설치',
];

const stripSuffix = (t) => {
  let s = String(t).toLowerCase();
  for (const suf of VERB_SUFFIX) {
    if (s.length > suf.length && s.endsWith(suf)) { s = s.slice(0, -suf.length); break; }
  }
  // "오른쪽으로가" → "오른쪽"처럼 조사·어미를 두 번까지 벗긴다.
  for (let i = 0; i < 2; i += 1) {
    const next = s.replace(/(으로|로|쪽으로|쪽|에서|부터|까지|이랑|랑|와|과|를|을|에|가)$/u, '');
    if (next === s) break;
    s = next;
  }
  return s.replace(/\s+/g, '');
};

const norm = (t) => stripSuffix(t);

function tokenize(text) {
  return String(text || '')
    .replace(/[\u200b]/g, '')
    .replace(/[\[\](){}「」『』]/g, ' ')
    // 100x50 / 100×50 같은 이경 표기를 관경 두 개로 나눈다.
    .replace(/(\d{2,3})\s*[x×X]\s*(\d{2,3})/g, '$1a $2a')
    .replace(/45\s*[°˚]/g, '45도')
    .replace(/[-]{1,2}>|→|⇒|=>|~|〜/g, ' ')
    .replace(/[,;/·]+/g, ' ')
    // "오른쪽1000"처럼 붙여 쓴 경우를 나눈다.
    .replace(/([^\d\s.,])(\d)/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

// 낱말로 흩어진 부속 이름을 하나로 붙인다. 붙인 형태가 아는 부속일 때만 합치므로
// "볼 1000"처럼 숫자·방향이 섞인 말은 건드리지 않는다.
function mergeSpacedFittings(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length; i += 1) {
    let hit = null;
    for (let n = 3; n >= 2; n -= 1) {
      if (i + n > tokens.length) continue;
      const key = tokens.slice(i, i + n).join('').toLowerCase();
      if (SPACED_FITTINGS.has(key)) { hit = { n, word: SPACED_FITTINGS.get(key) }; break; }
    }
    if (hit) {
      out.push(hit.word);
      i += hit.n - 1;
    } else {
      out.push(tokens[i]);
    }
  }
  return out;
}

function parseLength(token) {
  const m = /^(\d+(?:\.\d+)?)(mm|cm|m|미터|센치미터|센치|미리|밀리|미리미터|밀리미터)?$/i.exec(token);
  if (!m) return null;
  const v = parseFloat(m[1]);
  if (!Number.isFinite(v)) return null;
  const unit = (m[2] || 'mm').toLowerCase();
  const meters = unit === 'm' || unit === '미터' ? v
    : unit === 'cm' || unit === '센치' || unit === '센치미터' ? v / 100
      : v / 1000;
  return Math.round(meters * 1000) / 1000;
}

// 45도 / 45° / 45deg — 각도. 맨숫자(45)는 mm 길이로 읽으므로 각도로 보지 않는다.
function parseAngle(token) {
  const m = /^(30|45|60|90)(?:도|°|deg|디그리)$/i.exec(token);
  return m ? Number(m[1]) : 0;
}

const BORE_RE = /^(15|20|25|32|40|50|65|80|100|125|150|200|250|300|350|400|450|500|550|600)a$/;

// 관경 순서 (작은 것부터) — KS 표준 15A~600A
const BORE_ORDER = [
  '15A', '20A', '25A', '32A', '40A', '50A', '65A', '80A', '100A', '125A',
  '150A', '200A', '250A', '300A', '350A', '400A', '450A', '500A', '550A', '600A',
];

function nextSmallerBore(bore) {
  const i = BORE_ORDER.indexOf(bore);
  return i > 0 ? BORE_ORDER[i - 1] : BORE_ORDER[0];
}

/**
 * 한 줄 명령을 실행 단위(ops)로 바꾼다.
 * ops: {op:'seg', axis, sign, meters}                     — 90° 방향 이동
 *    | {op:'diag', axis, sign, vert, angle, meters}        — 45° 경사 이동 (axis/sign 없으면 직전 수평 방향)
 *    | {op:'bore'|'material', ...} | {op:'equip', type, size1, size2}
 *    | {op:'newpipe'|'undo'|'reset'|'help'}
 */
export function parseCommand(text) {
  const tokens = mergeSpacedFittings(tokenize(normalizeSpoken(text)));
  const unknown = [];

  // 1) 토큰 분류
  const items = tokens.map((raw) => {
    const t = norm(raw);
    if (BORE_RE.test(t)) return { raw, t, kind: 'bore', bore: t.toUpperCase() };
    // "50미리", "100파이" 같은 현장 말투
    const mmBore = /^(15|20|25|32|40|50|65|80|100|125|150|200|250|300|350|400|450|500|550|600)(미리|미리미터|밀리|밀리미터|파이|빠이|mm)$/i.exec(t);
    if (mmBore) return { raw, t, kind: 'bore', bore: mmBore[1] + 'A' };
    if (DELETE_WORDS.has(t)) return { raw, t, kind: 'delete' };
    if (CONNECT_WORDS.has(t) || CONNECT_WORDS.has(String(raw).toLowerCase())) {
      return { raw, t, kind: 'connect' };
    }
    if (PIPE_WORDS.has(t)) return { raw, t, kind: 'piperef' };
    if (FILLER.has(t)) return { raw, t, kind: 'cmd', cmd: 'noop' };
    const angle = parseAngle(t);
    if (angle) return { raw, t, kind: 'angle', angle };
    const len = parseLength(t);
    if (len !== null && len > 0) return { raw, t, kind: 'len', meters: len };
    for (const [word, axis, sign] of DIRS) {
      if (t === word) return { raw, t, kind: 'dir', axis, sign };
    }
    for (const [word, id] of MATERIAL_ALIASES) {
      if (t === word) return { raw, t, kind: 'material', material: id };
    }
    if (CONN_WORDS.has(t)) return { raw, t, kind: 'conn', conn: CONN_WORDS.get(t) };
    const rawLower = String(raw).toLowerCase();
    for (const [word, id] of COMMANDS) {
      if (t === word || rawLower === word) return { raw, t, kind: 'cmd', cmd: id };
    }
    for (const [word, type] of EQUIP_ALIASES) {
      if (t === word) return { raw, t, kind: 'equip', type };
    }
    return { raw, t, kind: 'unknown' };
  });

  // 1-b) 음성에서 "단조 모드"·"플랜지 타입"처럼 띄어 말한 경우 — 한 낱말로 보고 방식 전환으로 읽는다.
  for (let i = 0; i < items.length - 1; i += 1) {
    const a = items[i];
    const b = items[i + 1];
    if (!['모드', '타입', '형', '식'].includes(b.t)) continue;
    if (!['단조', '포지드', '소켓', '나사', '플랜지', '플렌지'].includes(a.t)) continue;
    const isFlange = a.t === '플랜지' || a.t === '플렌지';
    items[i] = { raw: `${a.raw} ${b.raw}`, t: a.t, kind: 'conn', conn: isFlange ? 'flange' : 'forged' };
    items[i + 1] = { raw: b.raw, t: b.t, kind: 'cmd', cmd: 'noop' };
  }

  // 2) 이경 부속(레듀샤·티) 앞뒤 관경 모으기 — "100a에서 50a 레듀샤", "100x50 레듀샤", "100a 티 50a 분기"
  const sized = new Map();
  const consumed = new Set();

  // 2-0) "단조 볼밸브" · "소켓 엘보" · "나사 밸브" — 부속 앞의 단조/소켓/나사는
  //      모드를 바꾸지 않고 그 한 개 부속만 단조형으로 놓는다.
  const forgedOnce = new Set();
  // 관경("단조 25a 볼밸브")은 건너뛰고 그 뒤 부속을 본다.
  const nextMeaningful = (from) => {
    for (let j = from + 1; j < items.length; j += 1) {
      if (items[j].kind === 'cmd' || items[j].kind === 'bore') continue;
      return j;
    }
    return -1;
  };
  for (let i = 0; i < items.length; i += 1) {
    const it = items[i];
    const isPrefix = (it.kind === 'conn' && FORGED_PREFIX.has(it.t))
      || (it.kind === 'equip' && it.type === 'union' && it.t === '소켓');
    if (!isPrefix) continue;
    const j = nextMeaningful(i);
    if (j < 0 || items[j].kind !== 'equip' || (items[j].type === 'union' && items[j].t === '소켓')) continue;
    forgedOnce.add(j);
    consumed.add(i);
    if (it.kind === 'equip') items[i] = { raw: it.raw, t: it.t, kind: 'conn', conn: 'forged' };
  }

  for (let i = 0; i < items.length; i += 1) {
    const it = items[i];
    if (it.kind !== 'equip' || (it.type !== 'reducer' && it.type !== 'tee')) continue;
    const back = [];
    for (let j = i - 1; j >= 0 && back.length < 3; j -= 1) {
      if (items[j].kind === 'bore') { back.unshift(j); continue; }
      if (items[j].kind === 'cmd') continue;
      break;
    }
    const fwd = [];
    for (let j = i + 1; j < items.length && fwd.length < 2; j += 1) {
      if (items[j].kind === 'bore') { fwd.push(j); continue; }
      if (items[j].kind === 'cmd') continue;
      break;
    }
    const indexes = back.concat(fwd);
    const bores = indexes.map((k) => items[k].bore);
    if (bores.length >= 2) {
      sized.set(i, { size1: bores[0], size2: bores[1] });
      // 관경 두 개는 부속의 1차/2차로만 쓰고, 배관 관경 지정에서는 뺀다.
      indexes.forEach((k) => consumed.add(k));
    } else if (bores.length === 1) {
      const s1 = bores[0];
      sized.set(i, {
        size1: s1,
        size2: it.type === 'tee' ? s1 : nextSmallerBore(s1),
      });
    }
  }

  // 2-b) 연결 명령("벨브에 붙여줘", "오른쪽 배관이랑 이어줘") — 대상을 찾아 배관 하나로 잇는다.
  const verbIdx = items.findIndex((it) => it.kind === 'connect');
  let connectOp = null;
  if (verbIdx >= 0) {
    let targetIdx = -1;
    for (let j = verbIdx - 1; j >= 0; j -= 1) {
      if (items[j].kind === 'equip' || items[j].kind === 'piperef') { targetIdx = j; break; }
    }
    let dir = null;
    for (let j = verbIdx - 1; j >= 0; j -= 1) {
      if (items[j].kind === 'dir') { dir = items[j]; break; }
    }
    const t = targetIdx >= 0 ? items[targetIdx] : null;
    connectOp = {
      op: 'connect',
      target: t && t.kind === 'equip' ? 'equip' : 'pipe',
      type: t && t.kind === 'equip' ? t.type : null,
      axis: dir ? dir.axis : null,
      sign: dir ? dir.sign : 1,
    };
    // 대상으로 쓴 부속 이름은 "그 자리에 달기"가 아니라 "그곳에 잇기"로만 쓴다.
    if (targetIdx >= 0) consumed.add(targetIdx);
  }

  // 3) 실행 순서로 변환
  const ops = [];
  let pendingDirs = []; // 각도 앞뒤로 온 방향들 (수평 방향 + 위/아래)
  let pendingAngle = 0;
  const usedDir = new Set(); // 길이 뒤에서 미리 끌어다 쓴 방향
  let lastKind = '';
  let lastEquip = '';

  for (let i = 0; i < items.length; i += 1) {
    if (consumed.has(i)) continue;
    const it = items[i];
    // "티 분기관", "레듀샤 이경관"처럼 같은 부속을 두 번 부르는 말투는 한 번만 놓는다.
    if (it.kind === 'equip' && lastKind === 'equip' && lastEquip === it.type) continue;
    if (it.kind !== 'cmd') { lastKind = it.kind; lastEquip = it.kind === 'equip' ? it.type : ''; }
    if (it.kind === 'bore') { ops.push({ op: 'bore', bore: it.bore }); continue; }
    if (it.kind === 'angle') { pendingAngle = it.angle; continue; }
    if (it.kind === 'dir') {
      if (usedDir.has(i)) continue;
      pendingDirs.push({ axis: it.axis, sign: it.sign });
      if (pendingDirs.length > 2) pendingDirs.shift();
      continue;
    }
    if (it.kind === 'material') { ops.push({ op: 'material', material: it.material }); continue; }
    if (it.kind === 'conn') { ops.push({ op: 'conn', conn: it.conn }); continue; }
    if (it.kind === 'cmd') {
      if (it.cmd !== 'noop') ops.push({ op: it.cmd });
      continue;
    }
    if (it.kind === 'equip') {
      const s = sized.get(i);
      ops.push({
        op: 'equip', type: it.type, size1: s && s.size1, size2: s && s.size2,
        ...(forgedOnce.has(i) ? { conn: 'forged' } : {}),
      });
      continue;
    }
    if (i === verbIdx && connectOp) { ops.push(connectOp); continue; }
    if (it.kind === 'connect' || it.kind === 'piperef') continue;
    if (it.kind === 'delete') { ops.push({ op: 'delete' }); continue; }
    if (it.kind === 'len') {
      lastKind = 'len';
      lastEquip = '';
      // "500 올려줘"처럼 길이 뒤에 방향이 오는 말투도 받아준다.
      if (!pendingDirs.length && !pendingAngle) {
        for (let j = i + 1; j < items.length && j <= i + 3; j += 1) {
          if (items[j].kind === 'cmd') continue;
          if (items[j].kind === 'dir') {
            pendingDirs.push({ axis: items[j].axis, sign: items[j].sign });
            usedDir.add(j);
          }
          break;
        }
      }
      const horiz = pendingDirs.find((d) => d.axis !== 'y');
      const vert = pendingDirs.find((d) => d.axis === 'y');
      if (pendingAngle && pendingAngle < 90) {
        // 45° 경사: 수평 방향 + 위/아래. 수평 방향이 없으면 직전 방향을 쓴다.
        ops.push({
          op: 'diag',
          axis: horiz ? horiz.axis : null,
          sign: horiz ? horiz.sign : 1,
          vert: vert ? vert.sign : 1,
          angle: pendingAngle,
          meters: it.meters,
        });
      } else if (pendingDirs.length) {
        const d = pendingDirs[pendingDirs.length - 1];
        ops.push({ op: 'seg', axis: d.axis, sign: d.sign, meters: it.meters });
      } else {
        // 방향 없이 숫자만 있으면 마지막 방향으로 이어 그린다.
        ops.push({ op: 'seg', axis: null, sign: 1, meters: it.meters, loose: true });
      }
      pendingDirs = [];
      pendingAngle = 0;
      continue;
    }
    unknown.push(it.raw);
  }

  // 방향·각도만 있고 거리가 없는 경우는 무시 (예: "50a 오른쪽")
  return { ops, unknown };
}

export const CMD_HELP = `
  <p class="hint">한 줄로 배관과 부속을 이어서 그립니다. <b>숫자는 mm</b>이고, <code>1.5m</code>처럼 단위를 붙이면 미터입니다. 관경은 KS 표준 <b>15A~600A</b>(15·20·25·32·40·50·65·80·100·125·150·200·250·300·350·400·450·500·550·600A)를 알아듣습니다.</p>
  <ul>
    <li><code>50a 오른쪽으로 1000 위로 1500</code> — 50A 배관, 오른쪽 1m → 위로 1.5m</li>
    <li><code>20a 오른쪽으로 1000</code> · <code>600a 앞으로 2000</code> — 작은 관경부터 대구경 600A까지 그대로</li>
    <li><code>100a sus 앞으로 800</code> — 100A 스테인리스, 앞으로 0.8m</li>
    <li><code>80a 왼쪽 600 아래로 300 뒤로 400</code> — 쉼표·공백 모두 구분자로 씁니다</li>
    <li><code>오른쪽 45도 위 1000</code> · <code>45도 위 1000</code> — 45° 경사 상승 1m (수직 0.71m · 수평 0.71m)</li>
    <li><code>100a에서 50a 레듀샤</code> · <code>100x50 레듀샤</code> — 이경 레듀샤(1차 100A·2차 50A), 다음 배관은 50A로 이어집니다</li>
    <li><code>단조모드 20a 오른쪽으로 1000 단조 볼밸브 단조 엘보 위로 1000</code> — 이후 부속·배관을 <b>단조형(소켓웰드·나사식)</b>으로: 플랜지 원판 없이 소켓 보스만</li>
    <li><code>플랜지모드</code> · <code>플렌지모드</code> · <code>플랜지타입</code> · <code>플랜지형</code> — 다시 플랜지 접합으로</li>
    <li><code>단조모드</code> · <code>단조타입</code> · <code>단조형</code> · <code>소켓타입</code> · <code>나사식</code> — 단조형으로 전환</li>
    <li><code>단조 볼밸브</code> · <code>소켓 엘보</code> · <code>단조 티</code> · <code>나사 밸브</code> — 앞에 <b>단조·소켓·나사</b>를 붙이면 그 한 개만 단조형</li>
    <li><code>니쁠</code> · <code>45도엘보</code> · <code>캡</code> · <code>유니온</code> · <code>유량계</code> — 지금 위치에 그 부속을 답니다</li>
    <li><code>25a 볼벨브</code> · <code>단조 25a 볼 벨브</code> — 배관 없이 부속부터 바로 답니다(지금 커서·방향, 없으면 오른쪽)</li>
    <li><code>새배관</code> — 새 배관을 시작합니다 (지금 위치에서)</li>
    <li><code>밸브 하나 달아줘</code> · <code>50미리 위로 좀 올려줘 500</code> — 말하듯 써도 알아듣습니다(군더더기 무시)</li>
    <li><code>지워</code> · <code>삭제</code> — 방금 추가한 배관·부속을 지웁니다</li>
    <li><code>되돌리기</code> — 직전 명령 취소 · <code>새도면</code>·<code>전체삭제</code>·<code>다지워</code>·<code>처음부터</code> — 전부 지우고 원점으로</li>
  </ul>
  <p class="hint">
  <b>🎤 말로</b> — 명령창의 🎤을 누르고 말하면 받아쓰기해 바로 실행합니다. <code>오십에이 오른쪽 천</code>, <code>육백에이 앞으로 이천</code>, <code>천오백</code>처럼 구어체 숫자도 <code>50a</code>·<code>600a</code>·<code>1000</code>·<code>1500</code>으로 알아듣습니다.<br>
  <b>🧭 조이스틱</b> — 방향을 고르고 길이만 치고 실행하면 그 방향으로 그려집니다. 같은 방향을 한 번 더 누르면 바로 그립니다.<br>
  <b>자동 엘보</b> — 방향이 꺾이면 90°·45° 엘보가 꼭짓점에 자동으로 들어가고, 배관은 접합면에서 끝나 배관을 뚫지 않습니다.<br>
  방향: <code>[내 시점 기준]</code>은 화면에서 보는 좌·우·앞·뒤, <code>[도면 축 기준]</code>은 고정 X·Z 축. 위/아래는 항상 높이(Y)입니다.
  </p>
`;

export function materialLabel(id) {
  return MATERIALS[id] ? MATERIALS[id].label : id;
}

export function boreLabel(id) {
  return BORES[id] ? id : '50A';
}
