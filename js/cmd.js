// 스마일산업 3D 배관 — mm 단위 한 줄 배관 명령 파서
// 외부 API 없이 브라우저에서 바로 해석한다. 길이 단위는 기본 mm, `1.5m`처럼 m를 붙이면 미터.
import { BORES, MATERIALS } from './store.js?v=14';

// 방향 — 긴 표현을 먼저 본다. (긴 것부터 매칭)
const DIRS = [
  ['오른쪽', 'x', 1], ['우측', 'x', 1], ['오른', 'x', 1], ['우', 'x', 1],
  ['왼쪽', 'x', -1], ['좌측', 'x', -1], ['왼', 'x', -1], ['좌', 'x', -1],
  ['위쪽', 'y', 1], ['위로', 'y', 1], ['위', 'y', 1], ['상승', 'y', 1], ['상', 'y', 1], ['올려', 'y', 1], ['올리', 'y', 1],
  ['아래쪽', 'y', -1], ['아래로', 'y', -1], ['아래', 'y', -1], ['하강', 'y', -1], ['하', 'y', -1], ['내려', 'y', -1], ['내리', 'y', -1],
  ['앞쪽', 'z', 1], ['앞으로', 'z', 1], ['앞', 'z', 1], ['전진', 'z', 1], ['전', 'z', 1],
  ['뒤쪽', 'z', -1], ['뒤로', 'z', -1], ['뒤', 'z', -1], ['후진', 'z', -1], ['후', 'z', -1],
];

// 부속·장비 19종 별칭 (공백을 지운 형태로 비교)
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
  ['티분기관', 'tee'], ['티분기', 'tee'], ['분기관', 'tee'], ['분기', 'tee'], ['티', 'tee'], ['tee', 'tee'],
  ['레듀샤', 'reducer'], ['레듀서', 'reducer'], ['레듀사', 'reducer'], ['이경관', 'reducer'], ['축소관', 'reducer'], ['reducer', 'reducer'],
  ['플랜지', 'flange'], ['플렌지', 'flange'], ['후렌지', 'flange'], ['후랜지', 'flange'], ['flange', 'flange'],
  ['파이프서포트', 'support'], ['서포트', 'support'], ['지지대', 'support'], ['행거', 'support'], ['support', 'support'],
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
    .replace(/[\[\](){}「」『』]/g, ' ')
    .replace(/[,;/·→>]+/g, ' ')
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

/**
 * 한 줄 명령을 실행 단위(ops)로 바꾼다.
 * ops: {op:'seg', axis, sign, meters} | {op:'bore'|'material', ...} | {op:'equip', type} | {op:'newpipe'|'undo'|'reset'|'help'}
 */
export function parseCommand(text) {
  const tokens = tokenize(text);
  const ops = [];
  const unknown = [];
  let pendingDir = null;

  for (const raw of tokens) {
    const t = norm(raw);

    // 관경 (50a/80A/100a/150a/200a)
    const bore = /^(50|80|100|150|200)a$/.exec(t);
    if (bore) { ops.push({ op: 'bore', bore: bore[1] + 'A' }); continue; }

    // 길이 (기본 mm)
    const len = parseLength(t);
    if (len !== null && len > 0) {
      if (pendingDir) {
        ops.push({ op: 'seg', axis: pendingDir.axis, sign: pendingDir.sign, meters: len });
        pendingDir = null;
      } else {
        // 방향 없이 숫자만 있으면 마지막 방향으로 이어 그린다.
        ops.push({ op: 'seg', axis: null, sign: 1, meters: len, loose: true });
      }
      continue;
    }

    // 방향
    let dir = null;
    for (const [word, axis, sign] of DIRS) {
      if (t === word) { dir = { axis, sign }; break; }
    }
    if (dir) { pendingDir = dir; continue; }

    // 재질
    let mat = null;
    for (const [word, id] of MATERIAL_ALIASES) {
      if (t === word) { mat = id; break; }
    }
    if (mat) { ops.push({ op: 'material', material: mat }); continue; }

    // 편의 명령
    let cmd = null;
    const rawLower = String(raw).toLowerCase();
    for (const [word, id] of COMMANDS) {
      if (t === word || rawLower === word) { cmd = id; break; }
    }
    if (cmd) { if (cmd !== 'noop') ops.push({ op: cmd }); continue; }

    // 부속·장비
    let equip = null;
    for (const [word, type] of EQUIP_ALIASES) {
      if (t === word) { equip = type; break; }
    }
    if (equip) { ops.push({ op: 'equip', type: equip }); continue; }

    unknown.push(raw);
  }

  // 방향만 있고 거리가 없는 경우는 무시 (예: "50a 오른쪽")
  return { ops, unknown };
}

export const CMD_HELP = `
  <p class="hint">한 줄로 배관과 부속을 이어서 그립니다. <b>숫자는 mm</b>이고, <code>1.5m</code>처럼 단위를 붙이면 미터입니다.</p>
  <ul>
    <li><code>50a 오른쪽으로 1000 위로 1500</code> — 50A 배관, 오른쪽 1m → 위로 1.5m</li>
    <li><code>100a sus 앞으로 800</code> — 100A 스테인리스, 앞으로 0.8m</li>
    <li><code>80a 왼쪽 600 아래로 300 뒤로 400</code> — 쉼표·공백 모두 구분자로 씁니다</li>
    <li><code>버터플라이</code> · <code>볼밸브</code> · <code>압력계</code> — 지금 위치에 부속을 답니다</li>
    <li><code>새배관</code> — 새 배관을 시작합니다 (지금 위치에서)</li>
    <li><code>되돌리기</code> · <code>초기화</code> — 직전 명령 취소 · 씬 비우기</li>
  </ul>
  <p class="hint">방향: 오른쪽(+X) 왼쪽(−X) 위(+Y) 아래(−Y) 앞(+Z) 뒤(−Z). 관경·재질을 안 쓰면 직전 값을 이어 씁니다(기본 50A 흑관).</p>
`;

export function materialLabel(id) {
  return MATERIALS[id] ? MATERIALS[id].label : id;
}

export function boreLabel(id) {
  return BORES[id] ? id : '50A';
}
