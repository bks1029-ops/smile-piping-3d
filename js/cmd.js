// 스마일산업 3D 배관 — mm 단위 한 줄 배관 명령 파서
// 외부 API 없이 브라우저에서 바로 해석한다. 길이 단위는 기본 mm, `1.5m`처럼 m를 붙이면 미터.
import { BORES, MATERIALS } from './store.js?v=16';

// 방향 — 긴 표현을 먼저 본다. (긴 것부터 매칭)
const DIRS = [
  ['오른쪽', 'x', 1], ['우측', 'x', 1], ['오른', 'x', 1], ['우', 'x', 1],
  ['왼쪽', 'x', -1], ['좌측', 'x', -1], ['왼', 'x', -1], ['좌', 'x', -1],
  ['위쪽', 'y', 1], ['위로', 'y', 1], ['위', 'y', 1], ['상승', 'y', 1], ['상', 'y', 1], ['올려', 'y', 1], ['올리', 'y', 1],
  ['아래쪽', 'y', -1], ['아래로', 'y', -1], ['아래', 'y', -1], ['하강', 'y', -1], ['하', 'y', -1], ['내려', 'y', -1], ['내리', 'y', -1],
  ['앞쪽', 'z', 1], ['앞으로', 'z', 1], ['앞', 'z', 1], ['전진', 'z', 1], ['전', 'z', 1],
  ['뒤쪽', 'z', -1], ['뒤로', 'z', -1], ['뒤', 'z', -1], ['후진', 'z', -1], ['후', 'z', -1],
];

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
  ['버터플라이밸브', 'bfly'], ['버터플라이', 'bfly'], ['버터', 'bfly'], ['bfly', 'bfly'],
  ['경사형체크밸브', 'yvalve'], ['경사밸브', 'yvalve'], ['경사형', 'yvalve'],
  ['스트레이너', 'yvalve'], ['와이밸브', 'yvalve'], ['y밸브', 'yvalve'], ['yvalve', 'yvalve'],
  ['볼밸브', 'ball'], ['볼', 'ball'], ['ball', 'ball'],
  ['체크밸브', 'check'], ['체크', 'check'], ['check', 'check'],
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

const MATERIAL_ALIASES = [
  ['스테인리스', 'sus'], ['스테인레스', 'sus'], ['스텐', 'sus'], ['sus', 'sus'],
  ['카본스틸', 'carbon'], ['카본', 'carbon'], ['흑관', 'carbon'], ['탄소강', 'carbon'], ['carbon', 'carbon'],
  ['보온배관', 'insulated'], ['보온', 'insulated'], ['insulated', 'insulated'],
].sort((a, b) => b[0].length - a[0].length);

const COMMANDS = [
  ['새배관', 'newpipe'], ['새파이프', 'newpipe'], ['새로', 'newpipe'], ['줄바꿈', 'newpipe'], ['새줄', 'newpipe'], ['new', 'newpipe'],
  ['되돌리기', 'undo'], ['되돌려', 'undo'], ['언두', 'undo'], ['취소', 'undo'], ['undo', 'undo'],
  ['초기화', 'reset'], ['리셋', 'reset'], ['클리어', 'reset'], ['비우기', 'reset'], ['reset', 'reset'],
  ['도움말', 'help'], ['도움', 'help'], ['예시', 'help'], ['사용법', 'help'], ['help', 'help'], ['?', 'help'],
  ['실행', 'noop'], ['run', 'noop'],
  // 말로 이어 쓰는 연결어·위치 표현은 실행에 영향이 없다
  ['끝에', 'noop'], ['끝', 'noop'], ['다음', 'noop'], ['그다음', 'noop'], ['그리고', 'noop'],
  ['이어서', 'noop'], ['이어', 'noop'], ['연결', 'noop'], ['에', 'noop'],
  ['에서', 'noop'], ['부터', 'noop'], ['까지', 'noop'],
];

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
  s = s.replace(/(으로|로|쪽으로|쪽|에서|부터|까지|를|을)$/u, '');
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

function parseLength(token) {
  const m = /^(\d+(?:\.\d+)?)(mm|cm|m|미터|센치미터|센치)?$/i.exec(token);
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

const BORE_RE = /^(50|80|100|150|200)a$/;

// 관경 순서 (작은 것부터)
const BORE_ORDER = ['50A', '80A', '100A', '150A', '200A'];

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
  const tokens = tokenize(text);
  const unknown = [];

  // 1) 토큰 분류
  const items = tokens.map((raw) => {
    const t = norm(raw);
    if (BORE_RE.test(t)) return { raw, t, kind: 'bore', bore: t.toUpperCase() };
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
    const rawLower = String(raw).toLowerCase();
    for (const [word, id] of COMMANDS) {
      if (t === word || rawLower === word) return { raw, t, kind: 'cmd', cmd: id };
    }
    for (const [word, type] of EQUIP_ALIASES) {
      if (t === word) return { raw, t, kind: 'equip', type };
    }
    return { raw, t, kind: 'unknown' };
  });

  // 2) 이경 부속(레듀샤·티) 앞뒤 관경 모으기 — "100a에서 50a 레듀샤", "100x50 레듀샤", "100a 티 50a 분기"
  const sized = new Map();
  const consumed = new Set();
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

  // 3) 실행 순서로 변환
  const ops = [];
  let pendingDirs = []; // 각도 앞뒤로 온 방향들 (수평 방향 + 위/아래)
  let pendingAngle = 0;
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
      pendingDirs.push({ axis: it.axis, sign: it.sign });
      if (pendingDirs.length > 2) pendingDirs.shift();
      continue;
    }
    if (it.kind === 'material') { ops.push({ op: 'material', material: it.material }); continue; }
    if (it.kind === 'cmd') {
      if (it.cmd !== 'noop') ops.push({ op: it.cmd });
      continue;
    }
    if (it.kind === 'equip') {
      const s = sized.get(i);
      ops.push({ op: 'equip', type: it.type, size1: s && s.size1, size2: s && s.size2 });
      continue;
    }
    if (it.kind === 'len') {
      lastKind = 'len';
      lastEquip = '';
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
  <p class="hint">한 줄로 배관과 부속을 이어서 그립니다. <b>숫자는 mm</b>이고, <code>1.5m</code>처럼 단위를 붙이면 미터입니다.</p>
  <ul>
    <li><code>50a 오른쪽으로 1000 위로 1500</code> — 50A 배관, 오른쪽 1m → 위로 1.5m</li>
    <li><code>100a sus 앞으로 800</code> — 100A 스테인리스, 앞으로 0.8m</li>
    <li><code>80a 왼쪽 600 아래로 300 뒤로 400</code> — 쉼표·공백 모두 구분자로 씁니다</li>
    <li><code>오른쪽 45도 위 1000</code> · <code>45도 위 1000</code> — 45° 경사 상승 1m (수직 0.71m · 수평 0.71m)</li>
    <li><code>왼쪽 45도 아래 800</code> — 45° 경사 하강</li>
    <li><code>100a에서 50a 레듀샤</code> · <code>100x50 레듀샤</code> — 이경 레듀샤(1차 100A·2차 50A), 다음 배관은 50A로 이어집니다</li>
    <li><code>100a 티 50a 분기</code> — 주배관 100A·분기 50A 티</li>
    <li><code>니쁠</code> · <code>45도엘보</code> · <code>캡</code> · <code>유니온</code> · <code>유량계</code> — 지금 위치에 그 부속을 답니다</li>
    <li><code>버터플라이</code> · <code>볼밸브</code> · <code>압력계</code> — 기존 부속도 같은 방식</li>
    <li><code>새배관</code> — 새 배관을 시작합니다 (지금 위치에서)</li>
    <li><code>되돌리기</code> · <code>초기화</code> — 직전 명령 취소 · 씬 비우기</li>
  </ul>
  <p class="hint">방향: 오른쪽(+X) 왼쪽(−X) 위(+Y) 아래(−Y) 앞(+Z) 뒤(−Z). 관경·재질을 안 쓰면 직전 값을 이어 씁니다(기본 50A 흑관).
  타자 없이 그리려면 명령창 옆 <b>🧭 패드</b>를 열어 방향·각도·길이 버튼만 누르면 됩니다.</p>
`;

export function materialLabel(id) {
  return MATERIALS[id] ? MATERIALS[id].label : id;
}

export function boreLabel(id) {
  return BORES[id] ? id : '50A';
}
