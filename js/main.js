// 스마일산업 3D 배관 — 메인 앱
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  BORES, BORE_KEYS, MATERIALS, EQUIP_TYPES, EQUIP_CATEGORIES, typesByCategory, makeEquipment, makePipe,
  sampleScene, normalizeState, pipeLength, fittingNaturalWidth, elbowDims, dirBasis,
  teeDims, reducerDims,
  CONN_MODES, CONN_TYPES, connOf, isBoreSized, applyBoreSize, SIZE_REF_BORE,
  aiResultToScene, aiTypeOf, isVerticalCapable, AXIS_LABELS, attachGaugeToPipe,
  equipNozzles, nozzlesOf, nozzleBore, setNozzle, nozzleDirsOf, NOZZLE_LABELS, NOZZLE_SIZES, NOZZLE_NONE,
  hxNozzlesOf, hxBody, hxNozzleLabel, setHxNozzle, addHxNozzle, removeHxNozzle, applyHxPreset,
  HX_AT, HX_AT_LABELS, HX_NOZ_DIRS, HX_NOZ_DIR_LABELS, HX_PRESETS,
  HX_TYPES, HX_TYPE_LABELS, HX_TYPE_DESC, hxTypeOf,
  TANK_NOZ_TYPES, TANK_NOZ_FACES, TANK_NOZ_FACE_LABELS, TANK_TYPE_LABELS, TANK_HPOS, TANK_PRESETS,
  tankDims, tankNozzlesOf, tankNozzleLabel, setTankNozzle, addTankNozzle, removeTankNozzle,
  applyTankPreset, tankWallFit, tankHeightSpan, tankLatScale, tankDepthScale,
  equipPorts, teePorts, flangedPorts, TEE_BRANCHES, TEE_BRANCH_LABELS, TEE_PORT_LABELS,
  HANDLE_TYPES, handleRotOf, norm180, equipConnectFaces, equipBasis, equipFlowAxis,
} from './store.js?v=85';
import { buildScene } from './builders.js?v=85';
import { buildFusionScript, downloadText, timestampName } from './fusion.js?v=85';
import { buildOBJ } from './obj.js?v=85';
import { analyzeImages, planCommand, DEFAULT_MODEL, MODEL_OPTIONS, LEGACY_MODELS } from './ai.js?v=85';
import { parseCommand, CMD_HELP } from './cmd.js?v=85';
import { buildDimItems } from './dims.js?v=85';
import { buildAiImageParts } from './zoom.js?v=85';

// 콘솔 오류 감시 (검증용)
window.__errors = window.__errors || [];
window.addEventListener('error', (e) => window.__errors.push('error: ' + (e.message || e.error)));
window.addEventListener('unhandledrejection', (e) => {
  window.__errors.push('promise: ' + ((e.reason && e.reason.message) || e.reason));
});

const STORAGE_KEY = 'smilePiping3D.v1';
const KEY_API = 'smilePiping3D.geminiKey';
const KEY_MODEL = 'smilePiping3D.geminiModel';
const KEY_MODEL_MIGRATED = 'smilePiping3D.geminiModelMigrated';

const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const fmt = (n) => String(Math.round(Number(n) * 100) / 100);
// 부속 크기는 25A에서 0.07m까지 작아진다 — 소수 셋째 자리까지 보여 준다.
const fmtSize = (n) => String(Math.round(Number(n) * 1000) / 1000);
// 밸브·피팅은 작은 값도 다루므로 입력칸 눈금·하한을 낮춘다.
const sizeStep = (spec) => (isBoreSized(spec && spec.type) ? 0.005 : 0.1);
const sizeMin = (spec) => (isBoreSized(spec && spec.type) ? 0.01 : 0.1);
const r3 = (n) => Math.round(Number(n) * 1000) / 1000;
// 이어 그릴 때 입력한 길이에서 값을 빼는 부속 — 티·레듀샤(중심선 기준).
const FIT_DEDUCT_TYPES = new Set(['tee', 'reducer']);
// 접합면 좌표 키 (mm 단위) — 같은 면을 한 번 붙은 뒤 다시 끌려가지 않게 구분한다 (v74).
const magnetKey = (p) => `${Math.round(Number(p.x) * 1000)}|${Math.round(Number(p.y) * 1000)}|${Math.round(Number(p.z) * 1000)}`;
// 두 점 사이 단위벡터 (a → b)
const unit2 = (a, b) => {
  const l = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) || 1;
  return { x: (b.x - a.x) / l, y: (b.y - a.y) / l, z: (b.z - a.z) / l };
};
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const VIEW_NAMES = ['iso', 'top', 'front', 'reset'];

// 손 그리기가 고를 수 있는 6개 3D 축 — 화면에 투영한 방향이 끄는 방향과 가장 가까운 것을 쓴다.
const AXES6 = [
  { axis: 'x', sign: 1, v: { x: 1, y: 0, z: 0 }, label: 'X+' },
  { axis: 'x', sign: -1, v: { x: -1, y: 0, z: 0 }, label: 'X−' },
  { axis: 'z', sign: 1, v: { x: 0, y: 0, z: 1 }, label: 'Z+' },
  { axis: 'z', sign: -1, v: { x: 0, y: 0, z: -1 }, label: 'Z−' },
  { axis: 'y', sign: 1, v: { x: 0, y: 1, z: 0 }, label: 'Y+' },
  { axis: 'y', sign: -1, v: { x: 0, y: -1, z: 0 }, label: 'Y−' },
];

// 45° 대각선 12방향 — XY·XZ·YZ 세 평면에 각각 네 방향씩.
// 45° 모드(조이스틱 `45°`)에서는 6직각과 함께 이 방향들도 화면 투영으로 견주어 고른다.
const AXES45 = (() => {
  const s = Math.SQRT1_2;
  const out = [];
  [['x', 'y'], ['x', 'z'], ['y', 'z']].forEach((pair) => {
    [-1, 1].forEach((p) => {
      [-1, 1].forEach((q) => {
        const v = { x: 0, y: 0, z: 0 };
        v[pair[0]] = p * s;
        v[pair[1]] = q * s;
        // 이어 그리기·커서에 넘길 대표 축은 두 성분 중 큰 쪽(같으면 앞선 축)
        const axis = Math.abs(v[pair[0]]) >= Math.abs(v[pair[1]]) ? pair[0] : pair[1];
        out.push({ axis, sign: v[axis] < 0 ? -1 : 1, v, label: '45°', diag: true });
      });
    });
  });
  return out;
})();
const AXES_ALL = AXES6.concat(AXES45);   // 45° 모드에서 고를 수 있는 모든 방향
const HAND_UP = { x: 0, y: 1, z: 0 };   // 원기둥 미리보기의 기본 축
const HAND_MIN_MM = 300;                // 최소 구간 길이
const HAND_STEP_MM = 100;               // 100mm 단위 반올림
const HAND_SNAP_PX = 40;                // 손끝이 기존 배관(끝·몸통)·커서에 붙는 화면 거리
const HAND_RING_Z = new THREE.Vector3(0, 0, 1);   // 토러스 기본 축(링 면의 법선)
// 옮긴 배관 끝 자석 (v74) — 이 거리 안에 접합면이 있으면 미세 틈 없이 0.000m로 붙인다.
const MOVE_SNAP_DIST = 0.06;            // 60mm — 정말 가까이 댔을 때만 붙는다(2026-11-27 축소)
// 탱크 벽면 자동 노즐 맞춤 (v72) — 배관 끝이 이 거리 안에서 벽을 향해 들어오면 노즐이 따라간다.
const TANK_FIT_DIST = 0.35;             // 외벽에서 0.35m 안
const TANK_FIT_DOT = 0.7;               // 진행 방향이 벽 바깥 법선의 **반대**와 이만큼 나란해야(벽으로 45° 이내)
const TANK_NOZ_MERGE = 0.35;            // 같은 벽면의 기존 노즐을 옮겨 쓸 최대 거리(높이·가로 m)

// 배관을 끊고 그 자리에 앉는 부속(인라인) — 실제 길이(spec.w)만큼 커서가 전진한다.
const INLINE_TYPES = new Set([
  'valve', 'bfly', 'yvalve', 'ball', 'check', 'bellows', 'tee', 'reducer', 'flange',
  'nipple', 'elbow45', 'cap', 'union', 'flow',
]);
const ON_FLOOR_TYPES = new Set(['header', 'hx', 'pump', 'vpump', 'tank', 'stank', 'rtank', 'panel', 'support']);

// ✂️ 배관 중간에 끼워넣을 수 있는 부속·밸브 (v75) — 타입 키는 EQUIP_TYPES의 키와 같다.
const INSERT_GROUPS = [
  {
    label: '티 (T)',
    items: [{ type: 'tee', label: '90° 티 · 이경 티', hint: '속성 패널에서 분기 관경을 바꾸면 이경 티가 됩니다' }],
  },
  {
    label: '밸브',
    items: [
      { type: 'valve', label: '게이트밸브' },
      { type: 'ball', label: '볼밸브' },
      { type: 'bfly', label: '버터플라이밸브' },
      { type: 'check', label: '체크밸브' },
      { type: 'yvalve', label: 'Y스트레이너' },
      { type: 'safety_valve', label: '안전·감압밸브' },
    ],
  },
  {
    label: '피팅',
    items: [
      { type: 'flange', label: '플랜지' },
      { type: 'reducer', label: '레듀샤', hint: '본관에서 한 단계 작은 관경으로 줄입니다' },
      { type: 'bellows', label: '벨로우즈 신축관' },
    ],
  },
];
// 끼워넣은 뒤 양쪽 배관이 남겨야 하는 최소 길이(m) — 이보다 짧아지면 부속이 멈춘다.
const INSERT_MIN_SIDE = 0.05;

function isQuotaError(e) {
  if (!e) return false;
  if (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED') return true;
  if (e.code === 22 || e.code === 1014) return true;
  return /quota|exceed/i.test(String(e.message || e));
}

class App {
  constructor() {
    this.state = this.restore() || sampleScene();
    this.selection = null;
    this.drawMode = false;
    this.draft = [];
    this.draftHeight = 1.5;
    this.undoStack = [];
    this.camAnim = null;
    this.saveTimer = null;
    this.rebuildTimer = 0;
    this.planSrc = null;
    this.planTexture = null;
    this.pendingAi = false;
    this.aiPhotos = [];   // AI 분석 창에 첨부한 사진들(최대 6장)
    this.handGroundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);  // 바닥(y=0) 기준면
    this.aiRunning = false;
    this.wakeLock = null;
    // 한 줄 명령 상태 — 커서(마지막 끝점)와 직전 관경·재질을 이어 쓴다.
    this.cmdCursor = { x: 0, y: 0.5, z: 0 };
    this.cmdBore = '50A';
    this.cmdMaterial = 'carbon';
    // 연결 방식 — 선택안함(기본) / 플랜지 / 단조형(소켓웰드·나사식). 이후 배관·부속에 적용된다.
    this.cmdConn = 'none';
    // 피팅값 자동계산 — 켜면(기본) 꺾임에서 엘보값을 빼고 직관을 그린다(중심선 기준).
    // 끄면 엘보 다음 직관을 입력한 길이 그대로 그린다. localStorage에 기억한다.
    this.fitAuto = true;
    try { this.fitAuto = localStorage.getItem('smilePiping3D.fitAuto') !== 'off'; } catch (e) { /* ignore */ }
    this.cmdRot = 0;
    this.cmdAxis = 'x';
    this.cmdSign = 1;
    this.cmdMarked = false;
    // 🔗 잇기 — 켠 상태에서 접속구를 탭하면 커서에서 그 자리까지 바로 연결한다
    this.linkMode = false;
    this.handSnap = null;
    // 위치 이동 — 방향 버튼 단위(mm)와 드래그 이동 모드
    this.moveStep = 500;
    this.moveDrag = false;
    this.moveDragState = null;
    // ☑️ 여러 개 선택 (v73) — 주 선택(this.selection)에 함께 고른 것들을 더해 같이 옮긴다.
    this.multiSel = [];
    this.multiMode = false;
    this.helpers = [];   // 고른 것마다 하나씩 두는 주황 상자(BoxHelper)
    this.lastMove = null; // 마지막 이동 안내 — "50mm · X +0.05m" 같은 한 줄
    // 🧲 자석 (v74, 기본 켜짐) — 옮긴 배관 끝·부속 접합면이 15cm 안에 오면 0.000m로 붙인다.
    let magSaved = null;
    try { magSaved = localStorage.getItem('smilePiping3D.magnet'); } catch (e) { /* ignore */ }
    this.magnetSnap = magSaved !== 'off';
    // 📋 복사한 장비·배관 (v72) — [📌 붙여넣기]가 이 사양으로 옆에 하나 더 세운다.
    this.clipboard = null;
    this.padOpen = false;
    this.viewbarOpen = false;   // 모바일 보기 바 펼침 상태(기본은 '등각' 1개로 접힘)
    // 방향 기준: 'me' = 지금 보는 화면 기준(기본), 'plan' = 도면 축 기준
    this.dirFrame = 'me';
    this.lastDirV = null;   // 직전에 그린 구간의 진행 방향(단위 벡터) — 명령을 건너 이어서 꺾임을 본다
    this.pending = null;    // 콤팩트 조이스틱에서 고른 방향(길이만 치면 그 방향으로 그린다)
    this.diag45 = false;    // 조이스틱 45° 경사 모드
    // 45° 경사를 어느 평면으로 그릴지 (v85) — 'up' 위 45° · 'down' 아래 45° · 'xz' 수평 45°
    this.diagMode = 'up';
    this.padLen = 1000;     // 조이스틱에서 마지막으로 쓴 길이(mm)
    this.listening = false;
    this.recognition = null;
    // 휴대폰 뒤로가기로 페이지가 나가지 않고 열린 창만 닫히게 하는 상태
    this.overlayEntry = false;
    this.suppressPop = 0;
    this.inPopState = false;
    // ✏️ 손 그리기 — 한 손가락 드래그가 카메라 회전 대신 배관 그리기가 된다.
    this.handMode = false;
    this.focusKey = null;   // 속성 시트 초점을 마지막으로 맞춘 선택(같은 선택은 다시 옮기지 않는다)
    this.handAnchor = null;      // 이번 구간을 시작하는 점 {x,y,z}
    this.handDown = null;        // 지금 누르고 있는 손가락
    this.handTap = null;         // 두 점 찍기 — 첫 점을 찍어 둔 상태 ({ point })
    this.handPreview = null;     // 화면에 보이는 미리보기 { axis, sign, mm, from, to }
    this.handContinued = false;  // 이번 시작점이 기존 배관 끝에서 이어진 것인지
    this.handDirV = null;        // 이어 그릴 때 그 자리로 들어오는 진행 방향
    this.handTouches = new Set();// 지금 화면에 닿아 있는 손가락(포인터) 번호
    this.handDimItem = null;     // 방금 그은 구간의 치수 창이 가리키는 구간 { pipeId, index }
    this.lastPointerType = null; // 마지막으로 캔버스를 누른 입력 종류('touch'·'mouse'·'pen')
    // 모바일 고스트 클릭(Ghost Click) 방어 — 3D에서 장비를 톡 누르면 그 pointerup에서 속성 창이
    // 그 자리에 열리고, 모바일 브라우저가 같은 좌표에 뒤이어 보내는 click이 새로 열린 입력칸에
    // 그대로 꽂혀 키보드가 올라오던 문제(v64까지). 창을 연 직후 짧게 창 안 입력을 잠근다.
    this.propsGuardUntil = 0;
    this.propsGuardTimer = 0;
    this.propsGuardRaf = 0;
    this.propsGhostUntil = 0;     // 뒤늦게 오는 호환 클릭(최대 시한)
    this.propsRealDownAt = 0;     // 속성 창 안을 손·마우스로 실제 누른 시각
    this.propsLastKeyAt = 0;      // 마지막 키 입력 시각(키보드 이동으로 잡힌 초점은 막지 않는다)
    this.fromCanvasTap = false;   // 지금 처리 중인 탭이 3D 캔버스에서 시작됐는지
    // 배관을 어느 끝에서 이어 그릴지 — 사용자가 🔁로 고른 끝(배관 id 별, v76)
    this.pipeEndPrefs = this.pipeEndPrefs || {};
  }

  // ── 초기화 ───────────────────────────────────────────────
  init() {
    this.setupRenderer();
    this.setupScene();
    this.setupFloorPlan();
    this.setupDraft();
    this.setupCmdCursor();
    this.setupDims();
    this.setupHand();
    this.setupHandDim();
    this.setupPrint();
    this.setupOffset45();
    this.setupZoomGuard();
    this.setupKeyboardView();
    this.setupKbDirBar();
    this.setupVoice();
    this.bindUI();
    this.bindPad();
    this.bindSceneEvents();
    this.rebuild();
    this.resize();
    this.loop();

    // 방향 기준은 지난번에 고른 값을 그대로 (기본: 내 시점 기준), 조이스틱은 기본으로 보이게
    let savedFrame = null;
    try { savedFrame = localStorage.getItem('smilePiping3D.dirFrame'); } catch (e) { /* ignore */ }
    this.setDirFrame(savedFrame === 'plan' ? 'plan' : 'me', true);
    this.setPadOpen(true);
    this.setViewbar(false);   // 모바일 보기 바는 '등각' 1개로 접힌 상태로 시작
    this.applyFitAuto();      // 📐 피팅값 자동계산 버튼·스위치를 저장값에 맞춘다
    this.updatePadInfo();
    this.updateMicUi();

    const v = new URLSearchParams(location.search).get('view');
    if (v && VIEW_NAMES.includes(v)) this.setView(v, true);
    else this.setView('iso', true);

    window.addEventListener('resize', () => this.resize());
    if (window.ResizeObserver) {
      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe($('#viewport'));
    }
    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('popstate', () => this.onPopState());
    // 화면이 꺼지거나 다른 앱으로 갔다 오면 wake lock이 풀리므로, 분석 중이면 다시 잡는다.
    document.addEventListener('visibilitychange', () => {
      // 앱을 내리거나 다른 앱으로 가는 순간 — 아직 대기 중인 저장을 바로 기록한다(v81).
      if (document.visibilityState === 'hidden') this.flushPendingSave();
      if (this.aiRunning && document.visibilityState === 'visible') this.acquireWakeLock();
    });
    // 탭을 닫거나 뒤로 가도 마지막 이동이 사라지지 않게 (v81)
    window.addEventListener('pagehide', () => this.flushPendingSave());
    window.addEventListener('beforeunload', () => this.flushPendingSave());
  }

  restore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return normalizeState(JSON.parse(raw));
    } catch (e) { /* ignore */ }
    return null;
  }

  setupRenderer() {
    const canvas = $('#scene');
    // 🖨️ 컷 담기는 renderer.render() 직후 **같은 작업 안에서** 캔버스를 읽는다.
    // (preserveDrawingBuffer 는 켜지 않는다 — 저사양 폰·소프트웨어 렌더링에서 WebGL 프로그램/메모리가
    //  모자라 렌더가 깨지는 사례가 있어, 기본값으로 두고 한 프레임을 그린 즉시 읽는 방식만 쓴다.)
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.raycaster = new THREE.Raycaster();
    // 픽 판정용 두 번째 광선 — handleCanvasTap 의 ray(this.raycaster)를 건드리지 않고
    // 노즐·접합면이 실제로 보이는지 따로 확인한다(v80).
    this.pickRay = new THREE.Raycaster();
  }

  setupScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0d1014);
    // v75 — 멀리서 볼 때 도면이 너무 빨리 어둡게 묻히지 않게 안개 거리를 넓혔다(30~62 → 70~140).
    this.scene.fog = new THREE.Fog(0x0d1014, 70, 140);

    this.camera = new THREE.PerspectiveCamera(48, 1, 0.1, 400);
    this.camera.position.set(12, 9.5, 13);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 1.2, -1.6);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.minDistance = 1.2;
    this.controls.maxDistance = 80;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.screenSpacePanning = true;
    this.controls.zoomSpeed = 0.9;
    this.controls.update();

    // 환경광 (금속 재질 반사)
    try {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      const envScene = new RoomEnvironment();
      this.envRT = pmrem.fromScene(envScene, 0.05);
      this.scene.environment = this.envRT.texture;
      envScene.dispose();
      pmrem.dispose();
    } catch (e) {
      console.warn('환경맵 생성 실패', e);
    }

    this.scene.add(new THREE.HemisphereLight(0xbcd4ff, 0x2a3038, 0.55));

    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(13, 19, 10);
    key.castShadow = true;
    const shadowSize = Math.min(4096, window.innerWidth > 900 ? 4096 : 2048);
    key.shadow.mapSize.set(shadowSize, shadowSize);
    const sc = key.shadow.camera;
    sc.left = -62; sc.right = 62; sc.top = 62; sc.bottom = -62; sc.near = 1; sc.far = 150;
    sc.updateProjectionMatrix();
    key.shadow.bias = -0.0006;
    key.shadow.normalBias = 0.06;
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0x8fb6ff, 0.6);
    fill.position.set(-14, 10, -12);
    this.scene.add(fill);

    const rim = new THREE.DirectionalLight(0xffd9a0, 0.3);
    rim.position.set(2, 8, 16);
    this.scene.add(rim);

    // 바닥 (1m 격자 · 5m 강조선을 텍스처로 그려 거리에서 자연스럽게 사라지게)
    // 인쇄용 흰 배경(v81)에서는 같은 격자를 밝은 회색으로 그린 텍스처로 잠깐 바꿔 끼운다.
    this.groundMat = new THREE.MeshStandardMaterial({ map: this.makeGridTexture(), roughness: 0.95, metalness: 0.02 });
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(150, 150), this.groundMat);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -0.012;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    // 축
    const axisLine = (a, b, color) => {
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...a), new THREE.Vector3(...b)]);
      const m = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.55 });
      return new THREE.Line(g, m);
    };
    this.scene.add(axisLine([0, 0.004, 0], [2.4, 0.004, 0], 0xd9534f));
    this.scene.add(axisLine([0, 0.004, 0], [0, 2.4, 0], 0x3fb950));
    this.scene.add(axisLine([0, 0.004, 0], [0, 0.004, 2.4], 0x3b82f6));
    const lx = this.makeLabel('X', '#ff8f8a'); lx.position.set(2.7, 0.22, 0); this.scene.add(lx);
    const ly = this.makeLabel('Y', '#8ff0a4'); ly.position.set(0, 2.7, 0); this.scene.add(ly);
    const lz = this.makeLabel('Z', '#8fb6ff'); lz.position.set(0, 0.22, 2.7); this.scene.add(lz);
  }

  makeGridTexture(opts) {
    const o = opts || {};
    const S = 512;
    const c = document.createElement('canvas');
    c.width = S; c.height = S;
    const g = c.getContext('2d');
    g.fillStyle = o.back || '#151b21';
    g.fillRect(0, 0, S, S);
    const step = S / 5;
    g.strokeStyle = o.line || '#232d37';
    g.lineWidth = 2;
    for (let i = 1; i < 5; i += 1) {
      const p = Math.round(i * step) + 0.5;
      g.beginPath(); g.moveTo(p, 0); g.lineTo(p, S); g.stroke();
      g.beginPath(); g.moveTo(0, p); g.lineTo(S, p); g.stroke();
    }
    g.strokeStyle = o.strong || '#36434f';
    g.lineWidth = 4;
    g.beginPath(); g.moveTo(2, 0); g.lineTo(2, S); g.stroke();
    g.beginPath(); g.moveTo(0, 2); g.lineTo(S, 2); g.stroke();
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(30, 30);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    return tex;
  }

  makeLabel(text, color) {
    return this.makeText(text, color, 1);
  }

  makeText(text, color, scale) {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 128;
    const g = c.getContext('2d');
    g.clearRect(0, 0, 128, 128);
    g.font = 'bold 68px system-ui, sans-serif';
    g.fillStyle = color;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 64, 68);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 2;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    sprite.scale.set(0.7 * scale, 0.7 * scale, 1);
    return sprite;
  }

  setupFloorPlan() {
    this.planMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.planMesh.rotation.x = -Math.PI / 2;
    this.planMesh.position.y = 0.008;
    this.planMesh.visible = false;
    this.planMesh.renderOrder = -1;
    this.scene.add(this.planMesh);
  }

  setupDraft() {
    this.draftGroup = new THREE.Group();
    this.scene.add(this.draftGroup);
    this.draftMat = new THREE.MeshBasicMaterial({ color: 0xffc23d });
    this.draftLineMat = new THREE.LineBasicMaterial({ color: 0xffc23d, transparent: true, opacity: 0.9 });
  }

  // ── ✏️ 손 그리기 ────────────────────────────────────────
  // 화면을 끌면 그 방향에 가장 가까운 3D 축(6개)으로 스냅해 배관을 바로 긋는다.
  // 시작점은 기존 배관 끝·커서 근처를 누르면 거기서 이어지고, 아니면 누른 바닥 자리다.
  setupHand() {
    this.handPreviewGroup = new THREE.Group();
    this.handPreviewGroup.visible = false;
    this.scene.add(this.handPreviewGroup);

    // 점 표시 — 예전에는 반지름 7.5cm 불투명 공이라 손 그리기 중에 배관 끝·엘보 면을 통째로 가렸다.
    // (2026-11-26 `32087` "손그리기는 아직도 시야 가린다") 지금은 반지름 1.2cm 점만 찍는다.
    const dot = (color) => {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(0.012, 10, 8),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false }),
      );
      m.renderOrder = 997;
      return m;
    };
    this.handMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1, 1, 20, 1, false),
      new THREE.MeshBasicMaterial({ color: 0x5ce1a2, transparent: true, opacity: 0.32, depthWrite: false }),
    );
    this.handMesh.renderOrder = 900;
    this.handPreviewGroup.add(this.handMesh);
    this.handEnd = dot(0x5ce1a2);
    this.handPreviewGroup.add(this.handEnd);
    // 자석 스냅 표시 — 붙을 자리에 청록 링을 띄운다(붙으면 커서 끝도 그 자리로).
    this.handSnapRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.1, 0.014, 8, 28),
      new THREE.MeshBasicMaterial({ color: 0x6fe3ff, transparent: true, opacity: 0.95, depthTest: false }),
    );
    this.handSnapRing.renderOrder = 998;
    this.handSnapRing.visible = false;
    this.handPreviewGroup.add(this.handSnapRing);

    // 이어 그릴 시작점 표시 — 작은 중심점 + 배관 외경에 맞춘 얇은 속빈 링.
    // 링 안쪽은 뚫려 있어 그 자리의 배관 끝·엘보 면이 그대로 보인다.
    this.handAnchorDot = new THREE.Group();
    this.handAnchorCore = dot(0x9dffd0);
    this.handAnchorDot.add(this.handAnchorCore);
    const od = (BORES[this.cmdBore] || BORES['50A']).od;
    this.handAnchorRing = new THREE.Mesh(
      new THREE.TorusGeometry(1, Math.max(0.04, Math.min(0.16, 0.006 / od)), 6, 36),
      new THREE.MeshBasicMaterial({ color: 0x9dffd0, transparent: true, opacity: 0.75, depthTest: false, depthWrite: false }),
    );
    this.handAnchorRing.renderOrder = 996;
    this.handAnchorDot.add(this.handAnchorRing);
    this.handAnchorDot.visible = false;
    this.scene.add(this.handAnchorDot);

    this.handUp = new THREE.Vector3(HAND_UP.x, HAND_UP.y, HAND_UP.z);
    this.handAxisVec = new THREE.Vector3();
    this.handFrom = new THREE.Vector3();
    this.handTo = new THREE.Vector3();

    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', (e) => this.handPointerDown(e));
    canvas.addEventListener('pointermove', (e) => this.handPointerMove(e));
    canvas.addEventListener('pointerup', (e) => this.handPointerUp(e));
    canvas.addEventListener('pointercancel', (e) => this.handPointerCancel(e));
  }

  // 방금 그은 구간의 치수(mm) 입력 창 — 캔버스 위 작은 팝업.
  // 바깥(3D 캔버스)을 톡 누르면 그대로 닫혀 다음 선 긋기가 이어진다.
  setupHandDim() {
    const form = $('#handDim');
    const input = $('#handDimInput');
    if (!form || !input) return;
    form.addEventListener('submit', (ev) => { ev.preventDefault(); this.applyHandDim(); });
    // 누르면 기존 숫자가 통째로 선택돼 바로 숫자만 칠 수 있다.
    input.addEventListener('focus', () => { try { input.select(); } catch (e) { /* ignore */ } });
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') { ev.preventDefault(); this.closeHandDim(); }
    });
    // 휴대폰 키보드가 올라오거나 화면을 확대해 보이는 영역이 줄면,
    // 숫자칸이 키보드에 가려지지 않게 보이는 자리로 다시 밀어 넣는다.
    const vv = window.visualViewport;
    if (vv) {
      const keep = () => { if (this.handDimItem) this.positionHandDim(); };
      vv.addEventListener('resize', keep);
      vv.addEventListener('scroll', keep);
    }
    window.addEventListener('scroll', () => { if (this.handDimItem) this.positionHandDim(); }, { passive: true });
  }

  // ── 화면 확대 방지 ──────────────────────────────────────
  // 휴대폰에서 두 손가락으로 화면 전체를 확대하면 속성(설정) 창까지 같이 커져 화면 밖으로 잘린다.
  // 확대·이동은 3D 화면(카메라)에서만 되게 하고, 브라우저가 그래도 확대해 버린 경우에는
  // 속성 창·서랍을 지금 눈에 보이는 영역 안으로 다시 앉혀 잘리지 않게 한다.
  setupZoomGuard() {
    // iOS Safari: 페이지 핀치 확대·회전 제스처 자체를 막는다 (meta를 무시하는 경우 대비).
    ['gesturestart', 'gesturechange', 'gestureend'].forEach((type) => {
      document.addEventListener(type, (ev) => { ev.preventDefault(); }, { passive: false });
    });
    // 3D 화면 바깥(패널·툴바)에서 시작한 두 손가락 움직임은 페이지 확대에 쓰지 않는다.
    document.addEventListener('touchmove', (ev) => {
      if (ev.touches && ev.touches.length > 1) {
        const t = ev.target;
        if (!(t && t.closest && t.closest('#viewport'))) ev.preventDefault();
      }
    }, { passive: false });
    // 입력칸을 두 번 톡톡 — 더블탭 확대가 남는 브라우저에서도 페이지가 커지지 않게.
    document.addEventListener('dblclick', (ev) => {
      const t = ev.target;
      if (t && t.closest && t.closest('input, textarea, select')) return;
      ev.preventDefault();
    }, { passive: false });
    const fit = () => this.fitPanelsToView();
    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener('resize', fit);
      vv.addEventListener('scroll', fit);
    }
    window.addEventListener('resize', fit);
  }

  // ── 모바일 키보드가 올라올 때의 3D 시야 ──────────────────────────────
  // 명령창에 초점이 가고 휴대폰 키보드가 올라오면 보이는 영역(visualViewport)이 줄어든다.
  //  · 앱 높이를 그 보이는 영역으로 줄인다 — 3D 캔버스가 상단바 아래~명령창 위로 다시 맞춰진다.
  //  · 키보드가 떠 있는 동안만 조이스틱·보기 바·개수 첨을 숨겨 3D 시야를 넓힌다(내려가면 원복).
  //  · 작업 커서가 남은 화면의 한가운데 오도록 카메라 표적을 부드럽게 옮긴다.
  setupKeyboardView() {
    const input = $('#cmdInput');
    const dim = $('#handDimInput');
    if (!input) return;
    this.kbInset = 0;
    this.kbForced = null;      // 검증·테스트용 가상 인셋(px) — 실제 키보드와 같은 경로를 탄다
    const measure = () => {
      if (this.kbForced != null) return Math.max(0, Math.round(this.kbForced));
      const vv = window.visualViewport;
      const raw = vv ? Math.max(0, window.innerHeight - vv.height) : 0;
      return Math.round(raw);
    };
    this.applyKeyboardInset = (px) => {
      const mobile = window.matchMedia('(max-width: 860px)').matches;
      const act = document.activeElement;
      const typing = act === input || (dim && act === dim) || this.cmdFocused || this.kbForced != null;
      const raw = measure();
      // 90px 넘게 줄었고 입력칸에 초점이 있을 때만 키보드로 본다 (주소창 접힘과 구분)
      const inset = (mobile && typing && raw > 90) ? raw : 0;
      if (inset === this.kbInset) return inset;
      this.kbInset = inset;
      document.documentElement.style.setProperty('--kb-inset', `${inset}px`);
      document.body.classList.toggle('kb-open', inset > 0);
      // 키보드가 올라와도 페이지가 위로 밀려 3D가 잘리지 않게 위치를 고정한다.
      if (inset) window.scrollTo(0, 0);
      this.resize();
      if (inset) this.centerCursor();
      return inset;
    };
    this.isKeyboardOpen = () => this.kbInset > 0;
    // 작업 커서를 지금 보이는 3D 화면의 한가운데로 — 카메라 방향·거리는 그대로 두고 표적만 옮긴다.
    this.centerCursor = (dur) => {
      const c = this.cmdCursor;
      if (!c || !this.controls || !this.camera) return;
      const t1 = new THREE.Vector3(c.x, c.y, c.z);
      const off = new THREE.Vector3().subVectors(this.camera.position, this.controls.target);
      const p1 = t1.clone().add(off);
      if (this.controls.target.distanceTo(t1) < 1e-4) return;
      this.camAnim = {
        p0: this.camera.position.clone(), p1,
        t0: this.controls.target.clone(), t1,
        start: performance.now(), dur: dur == null ? 320 : dur,
      };
    };
    input.addEventListener('focus', () => {
      this.cmdFocused = true;
      // 키보드가 올라오는 데는 잠시 걸린다 — 60ms·300ms 두 번 확인한다.
      setTimeout(() => this.applyKeyboardInset(), 60);
      setTimeout(() => this.applyKeyboardInset(), 300);
    });
    input.addEventListener('blur', () => {
      this.cmdFocused = false;
      setTimeout(() => this.applyKeyboardInset(), 40);
    });
    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener('resize', () => this.applyKeyboardInset());
      vv.addEventListener('scroll', () => { if (this.kbInset) window.scrollTo(0, 0); });
    }
    window.addEventListener('resize', () => this.applyKeyboardInset());
    window.addEventListener('orientationchange', () => setTimeout(() => this.applyKeyboardInset(), 200));
  }

  // ── 키보드가 올라온 동안 명령창 바로 위 1줄 방향 버튼 (v76) ──────────────
  // 사용자(2026-11-27 09:54): "키보드 올라와 있을 때 방향 바꾸려면 매번 키보드를 내렸다 다시 열어야 한다"
  //  · ←→앞뒤↑↓ 를 누르면 관경(cmdBore)은 그대로 두고 방향만 바뀐다.
  //  · 버튼을 눌러도 입력칸 초점(모바일 키보드)이 그대로 남아, 숫자만 넣고 [실행]을 계속 누를 수 있다.
  setupKbDirBar() {
    const bar = $('#kbDirBar');
    if (!bar) return;
    $$('[data-kbdir]', bar).forEach((b) => {
      const [axis, s] = b.dataset.kbdir.split(':');
      // 초점을 뺏지 않는다 — pointerdown의 기본 동작(초점 이동)만 막고 click은 그대로 둔다.
      b.addEventListener('pointerdown', (e) => {
        if (document.activeElement === $('#cmdInput')) e.preventDefault();
      });
      b.addEventListener('click', (e) => {
        e.preventDefault();
        this.tapDir(axis, Number(s));
        // 방향만 바꾸고 키보드는 그대로 — 숫자를 이어 넣을 수 있게 초점을 다시 준다.
        this.focusCmdInput();
        this.updateKbDirBar();
      });
    });
    // 45° 상태 칩 — 누를 때마다 90° → 위 45° → 아래 45° → 수평 45° 로 돈다 (v85).
    //  (키보드가 올라오면 조이스틱은 숨는다 — 그때도 45° 상태를 보고 바꿀 수 있어야 한다)
    const chip45 = $('#kbDiag45');
    if (chip45) {
      chip45.addEventListener('pointerdown', (e) => {
        if (document.activeElement === $('#cmdInput')) e.preventDefault();
      });
      chip45.addEventListener('click', (e) => {
        e.preventDefault();
        if (!this.diag45) this.setDiagMode('up');
        else if (this.diagMode === 'up') this.setDiagMode('down');
        else if (this.diagMode === 'down') this.setDiagMode('xz');
        else this.setDiag45(false);
        this.focusCmdInput();
        this.updateKbDirBar();
      });
    }
    this.updateKbDirBar();
  }

  // 1줄 방향 바의 관경·45° 상태·선택 방향 표시를 지금 상태에 맞춘다.
  updateKbDirBar() {
    const bar = $('#kbDirBar');
    if (!bar) return;
    const bore = $('#kbDirBore');
    if (bore) bore.textContent = this.cmdBore || '50A';
    const chip = $('#kbDiag45');
    if (chip) {
      const label = !this.diag45 ? '90°'
        : (this.diagMode === 'down' ? '45°↓' : (this.diagMode === 'xz' ? '45°⤢' : '45°↑'));
      chip.textContent = label;
      chip.classList.toggle('active', !!this.diag45);
      chip.setAttribute('aria-pressed', this.diag45 ? 'true' : 'false');
    }
    const sel = this.pending;
    $$('[data-kbdir]', bar).forEach((b) => {
      const [axis, s] = b.dataset.kbdir.split(':');
      const on = !!sel && (sel.op === 'diag' && sel.axis == null
        ? axis === 'y' && Number(s) === (sel.vert < 0 ? -1 : 1)
        : sel.axis === axis && (sel.sign < 0 ? -1 : 1) === Number(s));
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  // ── 선택한 것이 속성 시트에 가리지 않게 ────────────────────────────────
  // 모바일 속성 시트(화면 아래 40dvh)가 열리면, 방금 고른 부속·배관이 시트 뒤로 숨어
  // 회전을 눌러도 돌아가는 게 보이지 않던 문제(2026-11-25 `31583` 캡처).
  //  · 시트 위에 남은 3D 영역의 한가운데로 **카메라와 표적을 함께 옮긴다**(방향·거리 그대로).
  //  · 같은 선택이 유지되는 동안(회전 버튼을 여러 번 눌러도)은 다시 옮기지 않는다 — 화면이 흔들리지 않게.
  focusSelectedInView(dur) {
    if (!this.camera || !this.controls || !this.renderer) return;
    if (window.innerWidth > 860) return;            // 넓은 화면은 옆 패널이라 가리지 않는다
    const props = $('#props');
    if (!props || props.hidden) return;
    const sel = this.selection;
    if (!sel) return;
    const key = `${sel.kind}:${sel.id}`;
    if (this.focusKey === key) return;
    const cRect = this.renderer.domElement.getBoundingClientRect();
    const sRect = props.getBoundingClientRect();
    if (!cRect.height) return;
    const top = Math.max(cRect.top, 0);
    const bottom = Math.min(sRect.top || cRect.bottom, cRect.bottom);
    const bandH = bottom - top;
    if (bandH < 120) return;                       // 남은 3D 자리가 너무 좁으면 그대로 둔다
    // 대상의 세계 중심 — 실제 메시 묶음의 경계 상자 중심(배관은 선 전체의 가운데)
    let center = null;
    const obj = this.findObject(sel);
    if (obj) {
      const box = new THREE.Box3().setFromObject(obj);
      if (!box.isEmpty()) center = box.getCenter(new THREE.Vector3());
    }
    if (!center) {
      const spec = this.getSelectedSpec();
      if (!spec) return;
      if (Array.isArray(spec.points) && spec.points.length) {
        const n = spec.points.length;
        center = new THREE.Vector3(
          spec.points.reduce((a, p) => a + p.x, 0) / n,
          spec.points.reduce((a, p) => a + p.y, 0) / n,
          spec.points.reduce((a, p) => a + p.z, 0) / n,
        );
      } else {
        center = new THREE.Vector3(spec.x || 0, (spec.y || 0) + (spec.h || 0.3) * 0.5, spec.z || 0);
      }
    }
    this.focusKey = key;
    const proj = center.clone().project(this.camera);
    if (proj.z > 1 || proj.z < -1) return;
    const sy = cRect.top + (-proj.y * 0.5 + 0.5) * cRect.height;
    const want = (top + bottom) / 2;
    const bandMidOk = Math.abs(sy - want) < bandH * 0.18;
    // ① 표적을 대상으로 옮긴다 — 보는 방향(각도)은 그대로.
    const off = new THREE.Vector3().subVectors(this.camera.position, this.controls.target);
    const dir = off.clone().normalize();
    const dist0 = off.length();
    const tanHalf = Math.tan((this.camera.fov * Math.PI / 180) / 2);
    // ② 대상이 화면에서 너무 작으면(멀리서 고른 경우) 적당히 당겨 온다 — 돌아가는 게 보이게.
    let radius = 0.3;
    if (obj) {
      const sp = new THREE.Box3().setFromObject(obj).getBoundingSphere(new THREE.Sphere());
      if (sp.radius > 0.02) radius = sp.radius;
    }
    const sizePx = (2 * radius / (2 * dist0 * tanHalf)) * cRect.height;
    let dist = dist0;
    if (sizePx < 120) dist = Math.min(dist0, Math.max(1.2, radius * 4.2));
    if (bandMidOk && dist === dist0) return;          // 이미 시야 안에 또렷하게 보인다 — 그대로
    const t1 = center.clone();
    const p1 = center.clone().addScaledVector(dir, dist);
    // ③ 남은 3D 영역(시트 위) 한가운데로 화면에서 올린다 — 캔버스 중심과의 차이만큼만.
    const visibleH = 2 * dist * tanHalf;
    const wpp = visibleH / cRect.height;
    const canvasMid = cRect.top + cRect.height / 2;
    const shift = Math.max(-visibleH * 0.4, Math.min(visibleH * 0.4, (canvasMid - want) * wpp));
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    p1.addScaledVector(up, -shift);
    t1.addScaledVector(up, -shift);
    // 지면(0m) 아래로 내려가지 않게 — 카메라가 바닥 밑에서 지면을 보는 일을 막는다.
    if (p1.y < 0.8) {
      const lift = 0.8 - p1.y;
      p1.y += lift;
      t1.y += lift;
    }
    this.camAnim = {
      p0: this.camera.position.clone(), p1,
      t0: this.controls.target.clone(), t1,
      start: performance.now(), dur: dur == null ? 380 : dur,
    };
  }

  // 확대된 채로 들어온 경우(브라우저 '강제 확대'·접근성 설정, 예전 캐시)에도 속성 창·서랍이
  // 화면 밖으로 잘리지 않게, 지금 보이는 영역(visualViewport) 크기로 줄여 그 안에 붙인다.
  // 확대가 풀리면(scale 1) 인라인 값을 지워 원래 CSS 배치로 되돌린다.
  fitPanelsToView() {
    const vv = window.visualViewport;
    const mobile = window.matchMedia('(max-width: 860px)').matches;
    const zoomed = !!(vv && vv.scale > 1.01) && mobile;
    [$('#props'), $('#drawer')].forEach((el) => {
      if (!el) return;
      const shown = !el.hidden && (el.id !== 'drawer' || el.classList.contains('open'));
      if (!zoomed || !shown) {
        ['left', 'right', 'top', 'bottom', 'width', 'max-height'].forEach((k) => el.style.removeProperty(k));
        return;
      }
      const vw = Math.max(160, Math.round(vv.width));
      const vh = Math.max(220, Math.round(vv.height));
      const maxH = Math.round(vh * 0.92);
      el.style.left = `${Math.round(vv.offsetLeft)}px`;
      el.style.right = 'auto';
      el.style.width = `${vw}px`;
      el.style.maxHeight = `${maxH}px`;
      el.style.bottom = 'auto';
      const h = Math.min(el.offsetHeight || Math.round(vh * 0.6), maxH);
      el.style.top = `${Math.round(vv.offsetTop + vh - h)}px`;
    });
  }

  setHandMode(on, quiet) {
    const next = !!on;
    this.handMode = next;
    this.closeHandDim();
    this.handDown = null;
    this.handTap = null;
    this.handTouches.clear();
    this.clearHandPreview();
    const vp = $('#viewport');
    if (vp) vp.classList.toggle('hand-mode', next);
    const btn = $('#btnHand');
    if (btn) {
      btn.classList.toggle('active', next);
      btn.setAttribute('aria-pressed', next ? 'true' : 'false');
    }
    const badge = $('#handBadge');
    if (badge) badge.hidden = !next;
    this.updateHandBadge();
    if (next) {
      if (this.drawMode) this.setDrawMode(false);
      this.clearSelection();
      this.setDrawerOpen(false);
      // 한 손가락 드래그는 그리기 — 카메라 회전만 잠시 끄고, 두 손가락 확대·이동과 오른쪽 버튼 팬은 그대로 둔다.
      this.controls.enableRotate = false;
      this.handAnchor = this.cmdMarked ? { ...this.cmdCursor } : null;
      this.handContinued = !!this.handAnchor;
      this.handDirV = this.handContinued && this.lastDirV ? { ...this.lastDirV } : null;
      this.showHandAnchor();
      if (!quiet) {
        this.toast('✏️ 손 그리기 — 화면을 끌면 그 방향으로 배관이 그려집니다. 두 점을 톡톡 눌러도 됩니다.');
      }
    } else {
      this.controls.enableRotate = true;
      this.handAnchor = null;
      this.handContinued = false;
      this.handDirV = null;
      this.showHandAnchor();
      if (!quiet) this.toast('손 그리기를 껐습니다 — 한 손가락으로 화면을 돌릴 수 있습니다.');
    }
  }

  // 손 그리기 배지에 지금 방향 모드(90° / 45°)를 함께 보여 준다.
  updateHandBadge() {
    const chip = $('#handBadge45');
    if (chip) chip.hidden = !this.diag45;
  }

  // 시작점 표시 — 손 그리기 중에만 보인다. 작은 점 + 배관 외경 크기의 얇은 링.
  showHandAnchor() {
    if (!this.handAnchorDot) return;
    const a = this.handAnchor;
    this.handAnchorDot.visible = !!(this.handMode && a);
    if (!a) return;
    this.handAnchorDot.position.set(a.x, a.y, a.z);
    // 링은 지금 관경 외경에 맞추고, 이어 그리는 방향(배관 축)에 수직으로 둔다 —
    // 링 가운데 구멍으로 배관 끝·엘보 접합면이 그대로 보인다.
    const od = (BORES[this.cmdBore] || BORES['50A']).od;
    if (this.handAnchorRing) this.handAnchorRing.scale.setScalar(Math.max(0.02, od / 2));
    const d = this.handDirV || this.lastDirV;
    if (d && Math.hypot(d.x, d.y, d.z) > 1e-6) {
      this.handRingAxis = this.handRingAxis || new THREE.Vector3();
      this.handRingAxis.set(d.x, d.y, d.z).normalize();
      this.handAnchorRing.quaternion.setFromUnitVectors(HAND_RING_Z, this.handRingAxis);
    } else if (this.camera) {
      this.handAnchorRing.quaternion.copy(this.camera.quaternion);
    }
  }

  // canvas 안 좌표(px)로 옮긴다.
  projectToScreen(p, rect) {
    const v = this.handFrom.set(p.x, p.y, p.z).project(this.camera);
    if (v.z > 1 || v.z < -1) return null;
    return { x: (v.x * 0.5 + 0.5) * rect.width, y: (-v.y * 0.5 + 0.5) * rect.height };
  }

  // 시작점에서 월드 1m만큼 간 축이 화면에서 향하는 방향과 길이(px).
  axisScreen(a, t, rect) {
    const p0 = this.projectToScreen(a, rect);
    const p1 = this.projectToScreen({ x: a.x + t.v.x, y: a.y + t.v.y, z: a.z + t.v.z }, rect);
    if (!p0 || !p1) return null;
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const len = Math.hypot(dx, dy);
    // 화면에서 거의 점으로 보이는 축(정면에서 본 Y 등)은 고르지 않는다.
    if (len < 14) return null;
    return { ux: dx / len, uy: dy / len, pxPerM: len };
  }

  // 손가락 자리(px) → { 축, 방향, 길이(mm) }. 방향을 아직 못 고르면 pick: null.
  handMeasure(cx, cy) {
    const a = this.handAnchor;
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (!a || !rect.width || !rect.height) return null;
    const s0 = this.projectToScreen(a, rect);
    if (!s0) return null;
    const dx = (cx - rect.left) - s0.x;
    const dy = (cy - rect.top) - s0.y;
    const dl = Math.hypot(dx, dy);
    let best = null;
    // 45° 모드면 6직각에 12개 대각선까지 후보에 넣고, 화면에서 끄는 방향과 가장 가까운 것을 고른다.
    const cands = this.diag45 ? AXES_ALL : AXES6;
    cands.forEach((t) => {
      // 바닥에 붙은 시작점에서 아래로 가는 대각선은 바닥에 눌려 45°가 되지 못한다 — 후보에서 뺀다.
      if (t.diag && t.v.y < 0 && a.y < 0.2) return;
      const pr = this.axisScreen(a, t, rect);
      if (!pr) return;
      const dot = dl > 0.5 ? (dx / dl) * pr.ux + (dy / dl) * pr.uy : -1;
      if (!best || dot > best.dot) {
        best = { axis: t.axis, sign: t.sign, label: t.label, diag: !!t.diag, v: t.v, ...pr, dot };
      }
    });
    if (!best || dl < 8 || best.dot < 0.25) return { s0, pick: null, mm: 0 };
    const along = dx * best.ux + dy * best.uy;
    let mm = Math.round((along / best.pxPerM) * 1000 / HAND_STEP_MM) * HAND_STEP_MM;
    mm = Math.max(HAND_MIN_MM, Math.min(60000, mm));
    return { s0, pick: best, mm };
  }

  updateHandPreview(cx, cy) {
    const a = this.handAnchor;
    const m = a ? this.handMeasure(cx, cy) : null;
    if (!m || !m.pick) { this.clearHandPreview(); return; }
    const len = m.mm / 1000;
    const d = m.pick;
    const from = this.handFrom.set(a.x, a.y, a.z);
    // 방향 벡터 그대로 길이를 뻗는다 — 90° 축이든 45° 대각선이든 같은 식이다.
    let to = this.handTo.set(
      a.x + d.v.x * len,
      Math.max(0, a.y + d.v.y * len),
      a.z + d.v.z * len,
    );
    // 자석 스냅 — 끝점이 기존 배관 끝·노즐·티 포트 가까이 오면 그 자리에 착 붙는다.
    // 손가락을 스냅 범위 밖으로 조금 떼면 바로 풀려 자유 길이로 그린다.
    const snap = this.handSnapAt(to);
    this.handSnap = snap ? snap.anchor : null;
    let alignTxt = '';
    if (snap) {
      to = this.handTo.set(snap.anchor.p.x, snap.anchor.p.y, snap.anchor.p.z);
      this.handSnapRing.position.copy(to);
      if (this.camera) this.handSnapRing.quaternion.copy(this.camera.quaternion);
      this.handSnapRing.visible = true;
      this.hideAlign3D();
    } else {
      this.handSnapRing.visible = false;
      // 3축 정렬 가이드 (v76) — 끝점이 기존 배관 끝·엘보 중심·노즐 끝과 거리/높이/길이가
      // 30mm 안으로 맞으면 그 좌표로 딱 붙이고, 밝은 점선과 `정렬` 배지를 띄운다.
      const probe = d.diag ? null
        : this.align3DProbe({ x: to.x, y: to.y, z: to.z }, { axis: d.axis, tol: 0.03 });
      if (probe) {
        // 축을 따라 그리는 중이면 **길이(mm)** 를 맞춰 다시 뻗는다 — 화면·숫자가 함께 바뀐다.
        const av = d.axis === 'x' ? d.v.x : d.axis === 'y' ? d.v.y : d.v.z;
        const len2 = (probe.p[d.axis] - a[d.axis]) * (av < 0 ? -1 : 1);
        if (len2 >= HAND_MIN_MM / 1000) {
          to = this.handTo.set(
            a.x + d.v.x * len2,
            Math.max(0, a.y + d.v.y * len2),
            a.z + d.v.z * len2,
          );
          m.mm = Math.round(len2 * 1000);
        }
        this.showAlign3D({ x: to.x, y: to.y, z: to.z }, probe);
        alignTxt = this.alignAxesText(probe.hits);
      } else {
        this.hideAlign3D();
      }
    }
    const segLen = Math.max(0.001, from.distanceTo(to));
    const segDir = this.handAxisVec.copy(to).sub(from).normalize();
    // 미리보기는 지금 관경의 바깥지름으로 굵게 그린다.
    const od = (BORES[this.cmdBore] || BORES['50A']).od;
    this.handMesh.position.set((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2);
    this.handMesh.scale.set(Math.max(0.02, od / 2), segLen, Math.max(0.02, od / 2));
    this.handMesh.quaternion.setFromUnitVectors(this.handUp, segDir);
    this.handEnd.position.copy(to);
    this.handPreviewGroup.visible = true;
    this.handPreview = {
      axis: d.axis, sign: d.sign, diag: !!d.diag, dir: { x: d.v.x, y: d.v.y, z: d.v.z }, mm: m.mm,
      from: { x: from.x, y: from.y, z: from.z },
      to: { x: to.x, y: to.y, z: to.z },
      snap: snap ? snap.anchor : null,
    };

    // 끌고 있는 손가락 옆에 축·길이(mm)를 보여 준다.
    const el = $('#handTip');
    if (el) {
      const rect = this.renderer.domElement.getBoundingClientRect();
      const glyph = Math.abs(d.ux) >= Math.abs(d.uy) ? (d.ux > 0 ? '→' : '←') : (d.uy < 0 ? '↑' : '↓');
      el.textContent = snap
        ? `🧲 ${snap.anchor.label} ${snap.anchor.bore || ''}에 붙음`
        : (alignTxt
          ? `정렬 ${alignTxt} · ${d.label} ${glyph} ${m.mm.toLocaleString('ko-KR')}mm`
          : `${d.label} ${glyph} ${m.mm.toLocaleString('ko-KR')}mm`);
      const vw = rect.width || 1;
      el.style.left = Math.max(38, Math.min(vw - 38, Math.round(cx - rect.left))) + 'px';
      el.style.top = Math.max(18, Math.round(cy - rect.top - 30)) + 'px';
      el.hidden = false;
    }
  }

  clearHandPreview() {
    this.handPreview = null;
    this.handSnap = null;
    if (this.handSnapRing) this.handSnapRing.visible = false;
    if (this.handPreviewGroup) this.handPreviewGroup.visible = false;
    this.hideAlign3D();
    const el = $('#handTip');
    if (el) el.hidden = true;
  }

  // 접합면 하나의 관경 — 면이 자기 관경(n.bore)을 들고 있으면 그것, 없으면 부속 관경.
  //  티는 직진(bore1)·분기(bore2), 레듀샤는 A면(bore1)·B면(bore2)로 면마다 다르다.
  faceBore(spec, n) {
    if (!spec) return null;
    if (n && BORES[n.bore]) return n.bore;
    const pick = (...list) => list.find((b) => BORES[b]) || null;
    if (spec.type === 'tee') {
      return n && n.nid === 'branch'
        ? pick(spec.bore2, spec.bore1, spec.bore)
        : pick(spec.bore1, spec.bore, spec.bore2);
    }
    if (spec.type === 'reducer') {
      return n && n.nid === 'faceA'
        ? pick(spec.bore1, spec.bore, spec.bore2)
        : pick(spec.bore2, spec.bore, spec.bore1);
    }
    return pick(spec.bore, spec.bore1, spec.bore2);
  }

  // 누른 자리 근처의 기존 배관 위 점 — 끝점뿐 아니라 배관 몸통(티 분기 자리)까지
  // 화면 거리로 찾는다. AI가 뽑은 배관은 y > 0 높이에 떠 있으므로 찾은 3D 좌표(y 포함)를
  // 그대로 handAnchor로 쓴다 — 그 높이 그대로 손 그리기가 이어진다.
  // dir은 그 점으로 들어오는 진행 방향 — 이어 그을 때 엘보 방향을 맞추는 데 쓴다.
  nearestPipeSnap(ev, radiusPx) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const px = ev.clientX - rect.left;
    const py = ev.clientY - rect.top;
    const v = new THREE.Vector3();
    let best = null;
    let bestD = radiusPx;
    const screenOf = (p) => {
      v.set(p.x, p.y, p.z).project(this.camera);
      if (v.z > 1 || v.z < -1) return null;
      return { x: (v.x * 0.5 + 0.5) * rect.width, y: (-v.y * 0.5 + 0.5) * rect.height };
    };
    const take = (d, p, dir, kind, extra) => {
      if (!(d < bestD)) return;
      bestD = d;
      best = {
        x: r3(p.x), y: r3(p.y), z: r3(p.z), dir: dir || null, kind: kind || 'vertex',
        ...(extra || {}),
      };
    };
    const unit = (a, b) => {
      const l = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) || 1;
      return { x: (b.x - a.x) / l, y: (b.y - a.y) / l, z: (b.z - a.z) / l };
    };
    const testPoint = (p, dir, kind, extra) => {
      const s = screenOf(p);
      if (!s) return;
      take(Math.hypot(s.x - px, s.y - py), p, dir, kind, extra);
    };

    // 장비 노즐 끝 — 플랜지 접합면을 먼저 본다. 배관 끝과 같은 자리면 노즐이 이긴다
    // (노즐 관경을 그대로 이어받아야 하므로). 높이(Y)도 노즐 끝 높이 그대로 스냅된다.
    this.state.equipment.forEach((e) => {
      equipNozzles(e).forEach((n) => {
        const s = screenOf(n.tip);
        if (!s) return;
        take(Math.hypot(s.x - px, s.y - py), n.tip, n.axis, 'nozzle', {
          bore: n.bore, nozzleDir: n.dir, equipId: e.id, equipName: e.name,
        });
      });
      // 플랜지 부속·밸브·스트레이너의 플랜지 접합면 — 배관 끝과 똑같이 이 자리에서
      // 손 그리기가 시작·연결된다. (2026-11-26 사용자: "손 그리기는 배관에는 잘 이어져
      // 플렌지는 똑같이 안 이어지고") 예전에는 이 면이 스냅 후보에 없어 손끝이 몇 cm
      // 떨어진 자리에서 배관이 시작됐다.
      flangedPorts(e).forEach((n) => {
        const s = screenOf(n.tip);
        if (!s) return;
        take(Math.hypot(s.x - px, s.y - py), n.tip, n.axis, 'flange', {
          bore: n.bore, equipId: e.id, equipName: e.name, portNid: n.nid, seat: 'flange',
        });
      });
      // 엘보·티·레듀샤·니쁠 같은 용접 접합면 — 배관 끝과 똑같은 자리에서 그 관경을 이어받는다.
      // (v74 — 예전에는 이 면이 후보에 없어, 100A 엘보·티 끝에서 이어 그리면 기본값 50A로 가늘어졌다)
      equipConnectFaces(e).forEach((n) => {
        const s = screenOf(n.tip);
        if (!s) return;
        take(Math.hypot(s.x - px, s.y - py), n.tip, n.axis, 'port', {
          bore: this.faceBore(e, n), equipId: e.id, equipName: e.name, portNid: n.nid,
        });
      });
    });
    this.state.pipes.forEach((pipe) => {
      const pts = pipe.points || [];
      if (pts.length < 2) return;
      // 꼭짓점(배관 끝·중간 엘보) — 점을 먼저 보므로 같은 거리면 꼭짓점이 이긴다.
      for (let i = 0; i < pts.length; i += 1) {
        const prev = pts[i - 1];
        const next = pts[i + 1];
        // 시작점은 그 배관에서 나가는 방향의 반대(밖에서 들어오는 방향), 나머지는 들어오는 방향.
        const dir = prev ? unit(prev, pts[i]) : (next ? unit(next, pts[i]) : null);
        // 관경을 함께 넘긴다 — 이 점에서 이어 그리면 그 배관 관경을 그대로 물려받는다 (v74).
        testPoint(pts[i], dir, 'end', { bore: pipe.bore, label: pipe.name });
      }
      // 선분 몸통 — 화면에서 선분 위 가장 가까운 점의 비율(t)을 3D 점으로 되돌린다.
      for (let i = 0; i < pts.length - 1; i += 1) {
        const a = pts[i];
        const b = pts[i + 1];
        const sa = screenOf(a);
        const sb = screenOf(b);
        if (!sa || !sb) continue;
        const vx = sb.x - sa.x;
        const vy = sb.y - sa.y;
        const l2 = vx * vx + vy * vy;
        let t = l2 > 1e-6 ? ((px - sa.x) * vx + (py - sa.y) * vy) / l2 : 0;
        t = Math.max(0, Math.min(1, t));
        const d = Math.hypot(sa.x + vx * t - px, sa.y + vy * t - py);
        take(d, {
          x: a.x + (b.x - a.x) * t,
          y: a.y + (b.y - a.y) * t,
          z: a.z + (b.z - a.z) * t,
        }, unit(a, b), 'body', { bore: pipe.bore, label: pipe.name });
      }
    });
    if (this.cmdMarked) {
      const s = screenOf(this.cmdCursor);
      if (s) take(Math.hypot(s.x - px, s.y - py), this.cmdCursor, this.lastDirV ? { ...this.lastDirV } : null);
    }
    return best;
  }

  // 옛 이름 — 다른 곳에서 부르던 곳이 있어 그대로 둔다(이제 몸통까지 찾는다).
  nearestEndpointScreen(ev, radiusPx) {
    return this.nearestPipeSnap(ev, radiusPx);
  }

  // 자석 스냅 — 손 그리기 끝점(to)이 기존 접속구 가까이 오면 그 자리에 붙인다.
  // 화면 26px(3D 0.3m 이내) 안이면 붙고, 손가락이 그 밖으로 나가면 곧바로 풀린다.
  handSnapAt(to) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const s0 = this.projectToScreen(this.handAnchor || to, rect);
    const s1 = this.projectToScreen(to, rect);
    if (!s1) return null;
    const v = new THREE.Vector3();
    let best = null;
    const take = (p, label, bore, dir, extra) => {
      if (Math.hypot(p.x - to.x, p.y - to.y, p.z - to.z) > 0.3) return;
      if (this.handAnchor && Math.hypot(p.x - this.handAnchor.x, p.y - this.handAnchor.y, p.z - this.handAnchor.z) < 0.05) return;
      v.set(p.x, p.y, p.z).project(this.camera);
      if (v.z > 1 || v.z < -1) return;
      const sx = (v.x * 0.5 + 0.5) * rect.width;
      const sy = (-v.y * 0.5 + 0.5) * rect.height;
      const d = Math.hypot(sx - s1.x, sy - s1.y);
      if (d > 26 || (best && d >= best.d)) return;
      best = { anchor: { p: { x: p.x, y: p.y, z: p.z }, label, bore: bore || null, dir: dir || null, ...(extra || {}) }, d };
    };
    this.state.equipment.forEach((e) => {
      equipPorts(e).forEach((n) => take(n.tip, `${e.name} ${n.label || ''}`.trim(), n.bore, n.axis, {
        seat: n.seat || null, portAxis: n.axis, equipId: e.id, portNid: n.nid || null,
      }));
      // 엘보·레듀샤·티 용접 접합면도 자석 대상 — 그 면의 관경을 그대로 물려받는다 (v74).
      equipConnectFaces(e).forEach((n) => take(
        n.tip, `${e.name} ${TEE_PORT_LABELS[n.nid] || '접합면'}`.trim(), this.faceBore(e, n), n.axis,
        { equipId: e.id, portNid: n.nid || null },
      ));
    });
    this.state.pipes.forEach((pipe) => {
      const pts = pipe.points || [];
      if (!pts.length) return;
      take(pts[0], `${pipe.name} 시작`, pipe.bore, null);
      take(pts[pts.length - 1], `${pipe.name} 끝`, pipe.bore, null);
    });
    if (this.cmdMarked) take(this.cmdCursor, '커서', this.cmdBore, null);
    void s0;
    return best;
  }

  // 플랜지 접합면에 배관을 딱 체결시킨다 — 90°(또는 45°)로 꺾여 들어가면 그 꺾임에
  // 엘보를 세우고 배관을 엘보 접합면에서 끊는다. 그러면 부속 플랜지 ↔ 맞물림 플랜지가
  // 맞물린 두 장으로 보이고, 배관 끝은 용접 비드만 된다.
  //  (2026-11-25 `31578` "자동으로 엘보 쓰고 플렌지 써주면 좋겠는데")
  seatAtFlangePort(from, snap) {
    const p = snap.p;
    const a = snap.portAxis || { x: 0, y: 0, z: 1 };
    const bore = BORES[snap.bore] ? snap.bore : this.cmdBore;
    const v = { x: p.x - from.x, y: p.y - from.y, z: p.z - from.z };
    const L = Math.hypot(v.x, v.y, v.z);
    if (L < 0.05) return { path: [{ ...from }, { ...p }], elbow: null };
    const u = { x: v.x / L, y: v.y / L, z: v.z / L };
    const da = u.x * a.x + u.y * a.y + u.z * a.z;   // 진행 방향 · 바깥 법선
    // 배관이 바깥에서 접합면 축을 따라 곧장 들어오면 엘보 없이 면에 붙인다.
    if (da < -0.9) return { path: [{ ...from }, { ...p }], elbow: null };
    // 법선 반대(부속 안쪽에서 바깥으로)로 가는 배관이면 이 면이 아니다 — 그냥 직교 경로.
    if (da > 0.9) return { path: this.orthoPath(from, p), elbow: null };
    // 꺽임 각도에 맞는 엘보 — 90°면 엘보, 45°면 45° 엘보.
    const bend = Math.acos(Math.max(-1, Math.min(1, da))) * 180 / Math.PI;
    const type = (bend > 30 && bend < 60) ? 'elbow45' : 'elbow';
    const face = elbowDims(type, bore).face;
    // 엘보는 부속 밖에 서서 바깥 다리 끝면이 정확히 접합면 p에 앉는다.
    const corner = { x: p.x + a.x * face, y: Math.max(0, p.y + a.y * face), z: p.z + a.z * face };
    const path = this.orthoPath(from, corner);
    if (path.length < 2) return { path: this.orthoPath(from, p), elbow: null };
    const last = path[path.length - 1];
    const prev = path[path.length - 2];
    const sg = { x: last.x - prev.x, y: last.y - prev.y, z: last.z - prev.z };
    const sgLen = Math.hypot(sg.x, sg.y, sg.z);
    if (sgLen < 1e-4) return { path: this.orthoPath(from, p), elbow: null };
    const d = { x: sg.x / sgLen, y: sg.y / sgLen, z: sg.z / sgLen };
    // 마지막 구간이 이미 접합면 축과 나란하면 엘보 없이 면까지 붙인다.
    if (d.x * a.x + d.y * a.y + d.z * a.z < -0.9) return { path: [...path, { ...p }], elbow: null };
    // 배관 끝을 엘보 접합면(face)만큼 당겨 엘보 자리를 남긴다.
    if (sgLen < face + 0.02) return { path: [...path, { ...p }], elbow: null };
    const cut = {
      x: r3(last.x - d.x * face),
      y: Math.max(0, r3(last.y - d.y * face)),
      z: r3(last.z - d.z * face),
    };
    return {
      path: path.slice(0, -1).concat([cut]),
      elbow: {
        at: corner,
        type,
        bore,
        inDir: [-d.x, -d.y, -d.z],
        outDir: [-a.x, -a.y, -a.z],
      },
    };
  }

  // 자석으로 붙은 자리까지 배관을 만든다 — 직선으로 닿으면 직선, 아니면 90° 꺾임 경로.
  commitHandSnap() {
    const snap = this.handSnap;
    const a = this.handAnchor;
    if (!snap || !a) return null;
    const from = { x: a.x, y: a.y, z: a.z };
    const d = Math.hypot(snap.p.x - from.x, snap.p.y - from.y, snap.p.z - from.z);
    if (d < 0.05) { this.clearHandPreview(); return null; }
    // 플랜지 접합면이면 축 방향으로 꺾어 앉힌다 (엘보 + 맞물림 플랜지).
    const seated = snap.seat === 'flange' ? this.seatAtFlangePort(from, snap) : null;
    const path = seated ? seated.path : this.orthoPath(from, snap.p);
    const bore = BORES[snap.bore] ? snap.bore : this.cmdBore;
    this.pushUndo('🧲 자석 연결');
    const pipe = makePipe({
      name: this.nextPipeName(), bore, material: this.cmdMaterial, conn: this.cmdConn, points: path,
    });
    this.state.pipes.push(pipe);
    // 꺾여 들어갔으면 그 꺾임에 엘보를 세운다 — 배관 끝은 엘보 접합면에서 끊긴다.
    let elbow = null;
    if (seated && seated.elbow) {
      const e = seated.elbow;
      elbow = makeEquipment(e.type, {
        name: `EL-${100 + this.state.equipment.filter((q) => q.type === e.type).length + 1} 엘보`,
        x: e.at.x, y: e.at.y, z: e.at.z, bore: e.bore,
        inDir: e.inDir, outDir: e.outDir,
        rot: this.rotForDir({ x: e.outDir[0], y: e.outDir[1], z: e.outDir[2] }, this.cmdRot),
      });
      this.state.equipment.push(elbow);
    }
    this.lastAdded = { kind: 'pipe', id: pipe.id };
    const prev = path[path.length - 2] || from;
    const last = path[path.length - 1];
    const dx = last.x - prev.x;
    const dy = last.y - prev.y;
    const dz = last.z - prev.z;
    const l = Math.hypot(dx, dy, dz) || 1;
    this.lastDirV = { x: dx / l, y: dy / l, z: dz / l };
    this.handAnchor = { ...snap.p };
    this.handContinued = true;
    this.handDirV = { ...this.lastDirV };
    this.clearHandPreview();
    this.setCmdBore(bore, true);
    this.setCmdCursor(snap.p, true);
    this.rebuild();
    this.showHandAnchor();
    this.toast(elbow
      ? `🧲 ${snap.label} ${bore}에 엘보로 체결했습니다 · ${fmt(d)}m`
      : `🧲 ${snap.label} ${bore}에 붙여 연결했습니다 · ${fmt(d)}m`, {
      action: '되돌리기', onAction: () => this.undo(),
    });
    return pipe;
  }

  // 손 모드에서 누른 자리 → 바닥 위의 점
  handGroundPoint(ev) {
    const ray = this.raycastAt(ev);
    const hits = ray.intersectObject(this.ground, false);
    if (hits.length) return hits[0].point;
    // 바닥 메쉬 밖(지평선 너머)을 눌러도 그리기가 끊기지 않게 y=0 평면과 만나는 점을 쓴다.
    const p = ray.ray.intersectPlane(this.handGroundPlane, new THREE.Vector3());
    return p || null;
  }

  handPointerDown(e) {
    if (!this.handMode) return;
    // 데스크톱 오른쪽·가운데 버튼은 카메라 조작(이동·확대)에 남겨 둔다.
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // 서랍이 열려 있으면 이 터치는 창을 닫는 데만 쓴다 — 창이 도면을 가린 채 그려지지 않게.
    if (this.closeCoveringPanel()) return;
    this.lastPointerType = e.pointerType || null;
    // 방금 그은 구간의 치수 창이 떠 있으면, 캔버스를 톡 누르는 순간 조용히 닫고 그대로 다음 선을 긋는다.
    if (this.handDimItem) this.closeHandDim();
    this.handTouches.add(e.pointerId);
    if (this.handTouches.size > 1) {
      // 두 손가락 = 확대·이동 — 그리기를 접고 카메라(OrbitControls)에 맡긴다.
      this.handDown = null;
      this.clearHandPreview();
      return;
    }
    if (this.handTap && this.handTap.point) {
      // 두 점 찍기의 둘째 점 — 찍어 둔 시작점에서 잰다.
      this.handAnchor = { ...this.handTap.point };
      this.handContinued = true;
    } else {
      // 기존 배관이 손끝 가까이 있으면 그 위 점(끝·몸통, 높이 그대로)에서 이어 긋는다.
      // 높이 떠 있는 AI 배관은 그 아래 바닥을 눌렀을 때 화면 거리가 멀어 스냅되지 않도록,
      // 바닥 점을 구하기 전에 먼저 배관 위 점을 찾는다.
      const near = this.nearestPipeSnap(e, HAND_SNAP_PX);
      const p = near ? null : this.handGroundPoint(e);
      if (near) {
        this.handAnchor = { x: near.x, y: near.y, z: near.z };
        this.handDirV = near.dir ? { ...near.dir } : null;
        this.handContinued = true;
        // 스냅한 점이 배관 몸통이면 그 자리에 티 분기가 생긴다 — 짧게 알려 준다.
        if (near.kind === 'body' && this.lastPointerType === 'touch') {
          this.toast(`배관 몸통 ${near.y.toFixed(2)}m 높이에 붙였습니다.`);
        }
        // 스냅한 자리가 이미 있는 배관·부속·노즐이면 **그 관경을 그대로 이어받는다**.
        // (v74 — 예전에는 노즐·플랜지만 이어받고 배관 끝·엘보·티·밸브는 무시해서,
        //  100A 배관 끝에서 이어 그리면 기본값 50A로 가늘어졌다. 2026-11-26 `32083` 캡처)
        if (near.bore && BORES[near.bore]) {
          this.setCmdBore(near.bore, true);
          const nm = near.kind === 'flange'
            ? `${near.equipName || '부속'} 플랜지 면`
            : near.kind === 'nozzle'
              ? `${near.equipName || '장비'} ${NOZZLE_LABELS[near.nozzleDir] || ''} 노즐`
              : near.kind === 'port'
                ? `${near.equipName || '부속'} 접합면`
                : `${near.label || '배관'} ${near.kind === 'body' ? '몸통' : '끝'}`;
          this.toast(`${nm} ${near.bore} · 단면 높이 ${near.y.toFixed(2)}m에서 이어 그립니다.`);
        }
        this.setCmdCursor(this.handAnchor, true);
      } else if (p) {
        this.handAnchor = { x: r3(p.x), y: Math.max(0, r3(p.y)), z: r3(p.z) };
        this.handDirV = null;
        this.handContinued = false;
      } else {
        return;
      }
    }
    this.handDown = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
    try { this.renderer.domElement.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    this.showHandAnchor();
  }

  // 3D 도면을 가리고 있는 창(모바일 도구 서랍·속성 창)을 닫는다. 닫았으면 true.
  closeCoveringPanel() {
    const drawer = $('#drawer');
    if (drawer && drawer.classList.contains('open')) {
      this.setDrawerOpen(false);
      return true;
    }
    const props = $('#props');
    if (props && !props.hidden) {
      this.clearSelection();
      return true;
    }
    return false;
  }

  handPointerMove(e) {
    if (!this.handMode) return;
    const d = this.handDown;
    if (!d || e.pointerId !== d.id) return;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) d.moved = true;
    if (d.moved) this.updateHandPreview(e.clientX, e.clientY);
  }

  handPointerUp(e) {
    this.handTouches.delete(e.pointerId);
    if (!this.handMode) return;
    const d = this.handDown;
    if (!d || e.pointerId !== d.id) return;
    this.handDown = null;
    try { this.renderer.domElement.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    if (d.moved) {
      // 자석에 붙어 있으면 그 자리까지 바로 연결한다.
      if (this.handSnap) { this.commitHandSnap(); return; }
      // 끌어서 그리기 — 손을 뗀 자리에서 확정한다.
      const m = this.handMeasure(e.clientX, e.clientY);
      if (!m || !m.pick) {
        this.clearHandPreview();
        this.toast('방향을 잡지 못했습니다. 조금 더 길게 끌어 주세요.', { type: 'err' });
        return;
      }
      this.commitHand(m.pick, m.mm);
      return;
    }
    // 두 점 찍기
    if (this.handTap && this.handTap.point) {
      const m = this.handMeasure(e.clientX, e.clientY);
      if (m && m.pick) {
        this.commitHand(m.pick, m.mm);
        return;
      }
      this.clearHandPreview();
      this.toast('끝점을 시작점에서 조금 더 멀리 찍어 주세요.', { type: 'err' });
      return;
    }
    if (!this.handAnchor) return;
    this.handTap = { point: { ...this.handAnchor } };
    this.clearHandPreview();
    this.showHandAnchor();
    this.toast('시작점을 찍었습니다. 끝점을 누르거나, 여기서 끌어 그리세요.');
  }

  handPointerCancel(e) {
    this.handTouches.delete(e.pointerId);
    if (this.handDown && e.pointerId === this.handDown.id) this.handDown = null;
    this.clearHandPreview();
  }

  // 잰 구간을 실제 배관으로 만든다 — 관경·재질·연결방식은 지금 커서 설정을 그대로 쓰고,
  // 방향이 꺾이면 execOps가 기존 배관 끝을 당기고 그 자리에 엘보를 앉힌다.
  commitHand(pick, mm) {
    const a = this.handAnchor;
    if (!a || !pick) return null;
    const meters = Math.max(HAND_MIN_MM, Math.round(mm / HAND_STEP_MM) * HAND_STEP_MM) / 1000;
    this.handTap = null;
    this.clearHandPreview();
    this.setCmdCursor({ x: a.x, y: Math.max(0, a.y), z: a.z }, true);
    // 새로 시작한 자리면 직전 방향을 지워, 엉뚱한 엘보가 붙지 않게 한다.
    this.lastDirV = this.handContinued && this.handDirV ? { ...this.handDirV } : null;
    // 축이든 45° 대각선이든 고른 방향 벡터를 그대로 넘긴다 (execOps가 3D 방향으로 받는다).
    const dirV = pick.v
      ? { x: pick.v.x, y: pick.v.y, z: pick.v.z }
      : { x: pick.axis === 'x' ? pick.sign : 0, y: pick.axis === 'y' ? pick.sign : 0, z: pick.axis === 'z' ? pick.sign : 0 };
    const res = this.execOps([{ op: 'seg', dir: dirV, meters, world: true }], { source: 'hand' });
    if (res && res.cursor) {
      this.handAnchor = { ...res.cursor };
      this.handContinued = true;
      this.handDirV = dirV;
    } else {
      this.handContinued = false;
      this.handDirV = null;
    }
    this.showHandAnchor();
    // 그은 직후 — 바로 그 배관 위에 치수(mm) 창을 띄워 숫자만 고쳐 바로 넣을 수 있게 한다.
    if (res && res.cursor) this.openHandDimAfterCommit();
    return res;
  }

  // ── 방금 그은 구간의 치수 창 ────────────────────────────
  openHandDimAfterCommit() {
    const added = this.lastAdded;
    let pipe = added && added.kind === 'pipe' ? this.state.pipes.find((p) => p.id === added.id) : null;
    if (!pipe) pipe = this.state.pipes[this.state.pipes.length - 1];
    if (!pipe || !pipe.points || pipe.points.length < 2) return;
    const index = pipe.points.length - 1;
    const a = pipe.points[index - 1];
    const b = pipe.points[index];
    if (!a || !b) return;
    const mm = Math.round(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) * 1000);
    this.showHandDim({ pipeId: pipe.id, index }, mm);
  }

  showHandDim(item, mm) {
    const form = $('#handDim');
    const input = $('#handDimInput');
    if (!form || !input) return;
    this.handDimItem = item;
    input.value = String(mm);
    form.hidden = false;
    this.positionHandDim();
    // 마우스·팬으로 그렸을 때는 바로 숫자를 칠 수 있게 입력칸에 초점을 준다.
    // 터치에서는 키보드가 올라와 다음 선 긋기를 막으므로 초점을 주지 않는다 — 칸을 누르면 전체가 선택된다.
    if (this.lastPointerType && this.lastPointerType !== 'touch') {
      try { input.focus(); input.select(); } catch (e) { /* ignore */ }
    }
  }

  closeHandDim() {
    this.handDimItem = null;
    const form = $('#handDim');
    if (form) form.hidden = true;
  }

  // 치수 창을 그 구간 중점(살짝 위)에 붙인다 — 화면을 돌리거나 크기가 바뀌어도 따라간다.
  // 조이스틱·명령창·보기 바가 있는 쪽은 피해서 위/아래 중 빈 쪽에 붙는다.
  positionHandDim() {
    const form = $('#handDim');
    const it = this.handDimItem;
    if (!form || form.hidden || !it) return;
    const pipe = this.state.pipes.find((p) => p.id === it.pipeId);
    if (!pipe) { this.closeHandDim(); return; }
    const a = pipe.points[it.index - 1];
    const b = pipe.points[it.index];
    if (!a || !b) { this.closeHandDim(); return; }
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const s = this.projectToScreen({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 }, rect);
    if (!s) return;
    const w = form.offsetWidth || 176;
    const h = form.offsetHeight || 36;
    // 지금 눈에 보이는 영역 — 휴대폰 키보드가 올라오면 visualViewport가 줄어든다.
    // 캔버스 로컬 좌표(치수 창이 놓이는 좌표계)로 환산해 그 안에만 앉힌다.
    const vv = window.visualViewport;
    const viewL = vv ? Math.max(0, vv.offsetLeft - rect.left) : 0;
    const viewT = vv ? Math.max(0, vv.offsetTop - rect.top) : 0;
    const viewR = vv ? Math.min(rect.width, vv.offsetLeft + vv.width - rect.left) : rect.width;
    const viewB = vv ? Math.min(rect.height, vv.offsetTop + vv.height - rect.top) : rect.height;
    const pad = 6;
    const x = Math.max(viewL + w / 2 + pad, Math.min(viewR - w / 2 - pad, s.x));
    const x0 = x - w / 2;
    const x1 = x + w / 2;
    // 조이스틱·명령창·보기 바·손 그리기 배지와 겹치는지 — 겹치는 자리는 피한다.
    const hits = (top) => ['#dirPad', '#cmdForm', '#viewbar', '#handBadge'].some((sel) => {
      const el = $(sel);
      if (!el || el.hidden) return false;
      const br = el.getBoundingClientRect();
      if (!br.width || !br.height) return false;
      const l = br.left - rect.left;
      const t = br.top - rect.top;
      return x0 < l + br.width && x1 > l && top < t + br.height && top + h > t;
    });
    const fits = (top) => top >= viewT + pad && top + h <= viewB - pad;
    const above = s.y - 14 - h;   // 배관 위 (상자 아래변이 배관에서 14px 위)
    const below = s.y + 24;       // 배관 아래
    let top = above;
    if (!fits(above) || hits(above)) {
      if (fits(below) && !hits(below)) top = below;
      else top = Math.max(viewT + pad, Math.min(viewB - h - pad, above));
    }
    form.style.left = `${Math.round(x)}px`;
    form.style.top = `${Math.round(top + h)}px`;   // CSS가 translate(-50%, -100%)라 아래변 기준
    form.classList.toggle('below', top === below);   // 배관 아래에 붙었으면 꼬리 방향을 뒤집는다
  }

  // 치수 창에 넣은 mm를 적용 — 배관 길이와 시작점(초록 마커)이 함께 움직인다.
  applyHandDim() {
    const it = this.handDimItem;
    const input = $('#handDimInput');
    if (!it || !input) { this.closeHandDim(); return; }
    const r = this.resizeSegment(it.pipeId, it.index, parseFloat(input.value));
    if (!r.ok) {
      this.toast(r.reason === 'range'
        ? '길이는 50 ~ 100000mm 사이 숫자로 넣어 주세요.'
        : '길이를 잴 수 없는 구간입니다.', { type: 'err' });
      return;
    }
    if (r.changed && r.end) {
      // 다음 선이 어긋나지 않게 시작점도 새 끝점으로 옮긴다.
      this.handAnchor = { x: r.end.x, y: r.end.y, z: r.end.z };
      this.handContinued = true;
      this.setCmdCursor(this.handAnchor, true);
      this.showHandAnchor();
    }
    this.closeHandDim();
    if (r.changed) this.toast(`치수 ${r.oldMm} → ${r.newMm}mm${r.fit ? ` · ${r.fit}` : ''}`);
  }

  // ── 씬 갱신 ──────────────────────────────────────────────
  rebuild() {
    this.refreshScene();
    this.renderProps();
  }

  // ── 배관 치수 라벨 ───────────────────────────────────────
  // 각 배관 구간 중점 옆에 "1000mm (50A)"를 3D 좌표 → 화면 투영으로 얹는다.
  // 기본은 **선택한 배관(또는 방금 그린·수정한 배관) 1개만** 표시해 시야를 가리지 않고,
  // 📏 치수를 켜면 예전처럼 모든 배관 라벨을 한꺼번에 보여 준다(2026-11-25 사용자 선택 1안).
  setupDims() {
    this.dimLayer = $('#dimLayer');
    this.dimNodes = [];
    this.dimItems = [];
    this.dimV = new THREE.Vector3();
    let saved = null;
    try { saved = localStorage.getItem('smilePiping3D.dimsAll'); } catch (e) { /* ignore */ }
    this.dimsAll = saved === 'on';   // 기본 꺼짐 — 한 개만
    this.applyDimToggle();
    // 치수 라벨을 탭하면 길이(mm)를 정확한 숫자로 고칠 수 있다.
    this.dimLayer.addEventListener('click', (ev) => {
      const el = ev.target && ev.target.closest ? ev.target.closest('.dim-label') : null;
      if (!el || el.style.display === 'none') return;
      const item = this.dimItems.find((it) => it.key === el.dataset.key);
      if (item) this.openDimEditor(item);
    });
  }

  // 📏 치수 버튼 — 전체 치수 켜기/끄기 (끄면 선택한 배관 1개만)
  setDims(on) {
    this.dimsAll = !!on;
    try { localStorage.setItem('smilePiping3D.dimsAll', this.dimsAll ? 'on' : 'off'); } catch (e) { /* ignore */ }
    this.applyDimToggle();
    this.refreshDims();
    this.toast(this.dimsAll ? '📏 모든 배관 치수 표시' : '📏 선택한 배관 치수만 표시');
  }

  applyDimToggle() {
    const btn = $('#btnDims');
    if (btn) {
      btn.classList.toggle('active', this.dimsAll);
      btn.setAttribute('aria-pressed', this.dimsAll ? 'true' : 'false');
      btn.title = this.dimsAll
        ? '모든 배관 치수 표시 켜짐 — 누르면 선택한 배관 1개만 표시'
        : '선택한 배관 1개만 치수 표시 — 누르면 모든 배관 치수 표시';
    }
    // 치수 레이어는 언제나 살아 있다 (한 개짜리 라벨을 그리기 위해).
    if (this.dimLayer) this.dimLayer.hidden = false;
  }

  // 지금 치수를 보여 줄 배관 — 선택한 배관 → 방금 그린/수정한 배관 → 마지막 배관.
  dimsFocusPipeId() {
    const has = (id) => !!id && this.state.pipes.some((p) => p.id === id);
    if (this.selection && this.selection.kind === 'pipe' && has(this.selection.id)) return this.selection.id;
    if (this.lastAdded && this.lastAdded.kind === 'pipe' && has(this.lastAdded.id)) return this.lastAdded.id;
    const last = this.state.pipes[this.state.pipes.length - 1];
    return last ? last.id : null;
  }

  refreshDims() {
    const all = buildDimItems(this.state);
    const focus = this.dimsFocusPipeId();
    // 전체 치수가 꺼져 있으면 선택(또는 방금 그린) 배관 하나만 — 나머지는 숨긴다.
    this.dimItems = this.dimsAll ? all : all.filter((it) => it.pipeId === focus);
    this.dimOrder = null; // 라벨 배치 순서(긴 구간 우선)를 다시 계산한다.
    if (!this.dimItems.length) {
      this.clearDimNodes();
      return;
    }
    while (this.dimNodes.length > this.dimItems.length) {
      const n = this.dimNodes.pop();
      n.remove();
    }
    while (this.dimNodes.length < this.dimItems.length) {
      const el = document.createElement('span');
      el.className = 'dim-label';
      this.dimLayer.appendChild(el);
      this.dimNodes.push(el);
    }
    this.dimItems.forEach((it, i) => {
      const el = this.dimNodes[i];
      el.textContent = it.text;
      el.dataset.key = it.key;
      el.title = '눌러서 길이(mm) 수정';
    });
    this.updateDims();
  }

  clearDimNodes() {
    this.dimNodes.forEach((n) => n.remove());
    this.dimNodes = [];
  }

  updateDims() {
    if (!this.dimNodes.length || !this.dimLayer) return;
    const w = this.dimLayer.clientWidth || 1;
    const h = this.dimLayer.clientHeight || 1;
    const v = this.dimV;
    // 겹치면 읽기 어려우니 긴 구간부터 자리를 잡고, 이미 잡힌 라벨과 겹치는 것은 숨긴다.
    const cells = new Set();
    const cw = 34;
    const chh = 17;
    const perChar = w <= 880 ? 5.6 : 6.2;
    const order = this.dimOrder || (this.dimOrder = []);
    if (order.length !== this.dimItems.length) {
      order.length = 0;
      for (let i = 0; i < this.dimItems.length; i += 1) order.push(i);
      order.sort((a, b) => (this.dimItems[b].len || 0) - (this.dimItems[a].len || 0));
    }
    for (let n = 0; n < order.length; n += 1) {
      const i = order[n];
      const it = this.dimItems[i];
      const el = this.dimNodes[i];
      // 방금 그은 구간의 치수 창이 떠 있으면 그 라벨은 숨긴다 — 같은 자리에 겹친다.
      const hd = this.handDimItem;
      if (hd && hd.pipeId === it.pipeId && hd.index === it.index) {
        if (el.style.display !== 'none') el.style.display = 'none';
        continue;
      }
      v.set(it.x, it.y, it.z).project(this.camera);
      const behind = v.z > 1;
      if (behind || v.x < -1.2 || v.x > 1.2 || v.y < -1.2 || v.y > 1.2) {
        if (el.style.display !== 'none') el.style.display = 'none';
        continue;
      }
      const sx = ((v.x + 1) / 2) * w;
      const sy = ((1 - v.y) / 2) * h;
      const bw = Math.max(40, el.textContent.length * perChar + 12);
      const bh = 16;
      const c0 = Math.round((sx - bw / 2) / cw);
      const c1 = Math.round((sx + bw / 2) / cw);
      const r0 = Math.round((sy - bh / 2) / chh);
      const r1 = Math.round((sy + bh / 2) / chh);
      let clash = false;
      for (let cx = c0; cx <= c1 && !clash; cx += 1) {
        for (let ry = r0; ry <= r1; ry += 1) {
          if (cells.has(cx + ':' + ry)) { clash = true; break; }
        }
      }
      if (clash) {
        if (el.style.display !== 'none') el.style.display = 'none';
        continue;
      }
      for (let cx = c0; cx <= c1; cx += 1) {
        for (let ry = r0; ry <= r1; ry += 1) cells.add(cx + ':' + ry);
      }
      if (el.style.display === 'none') el.style.display = '';
      el.style.transform = `translate(-50%, -50%) translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px)`;
    }
  }

  // ── 치수 라벨 탭 → 길이(mm) 정확히 고치기 ────────────────
  openDimEditor(item) {
    const pipe = this.state.pipes.find((p) => p.id === item.pipeId);
    if (!pipe || !pipe.points[item.index] || !pipe.points[item.index - 1]) return;
    const a = pipe.points[item.index - 1];
    const b = pipe.points[item.index];
    const mm = Math.round(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) * 1000);
    this.openModal({
      title: '치수 수정',
      body: `
        <p class="hint">${esc(pipe.name)} · ${item.index}번째 구간 · ${esc(pipe.bore)}</p>
        <label class="field">길이(mm)
          <input type="number" id="dimMm" step="10" min="50" inputmode="numeric" value="${mm}">
        </label>
        <p class="hint">숫자를 바꾸면 그 구간 끝과 뒤로 이어진 배관·장비도 함께 움직입니다.</p>`,
      actions: [
        { label: '적용', cls: 'accent', keep: true, onClick: () => this.applyDimLength(item) },
        { label: '닫기' },
      ],
    });
    const input = $('#dimMm');
    if (input) {
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); this.applyDimLength(item); }
      });
      input.focus();
      input.select();
    }
  }

  applyDimLength(item) {
    const input = $('#dimMm');
    if (!input) return;
    const r = this.resizeSegment(item.pipeId, item.index, parseFloat(input.value));
    if (!r.ok) {
      this.toast(r.reason === 'range'
        ? '길이는 50 ~ 100000mm 사이 숫자로 넣어 주세요.'
        : '길이를 잴 수 없는 구간입니다.', { type: 'err' });
      if (r.reason === 'range') input.focus();
      return;
    }
    this.closeModal();
    if (r.changed) this.toast(`치수 수정 · ${r.oldMm} → ${r.newMm}mm${r.fit ? ` · ${r.fit}` : ''}`);
  }

  // 배관 한 구간의 길이(mm)를 바꿈다 — 그 구간 끝과 뒤로 이어진 배관·장비까지 연쇄로 함께 옮긴다.
  // 치수 라벨 수정 창과 손 그리기 치수 창이 같이 쓴다.
  // 돌려주는 값: { ok, changed, oldMm, newMm, end } — end는 구간 끝(꼭짓점)의 새 좌표.
  resizeSegment(pipeId, index, mm) {
    const pipe = this.state.pipes.find((p) => p.id === pipeId);
    if (!pipe) return { ok: false, reason: 'no-pipe' };
    const i = Number(index);
    const a = pipe.points[i - 1];
    const b = pipe.points[i];
    if (!a || !b) return { ok: false, reason: 'no-seg' };
    if (!Number.isFinite(mm) || mm < 50 || mm > 100000) return { ok: false, reason: 'range' };
    const vx = b.x - a.x, vy = b.y - a.y, vz = b.z - a.z;
    const len = Math.hypot(vx, vy, vz);
    if (len < 1e-4) return { ok: false, reason: 'zero' };
    const oldMm = Math.round(len * 1000);
    const u0 = { x: vx / len, y: vy / len, z: vz / len };
    // ✨ 3축 정렬 — 새 끝점이 다른 배관 끝·엘보 중심·노즐과 길이 방향으로 30mm 안이면
    // 그 자표에 딱 맞는 길이로 바꾸고 점선·`정렬` 배지를 띄운다 (v76 사용자: "길이 맞추기가 되는지 알기 어렵다").
    const snapL = this.alignSnapLength(a, u0, mm, new Set([pipe.id]));
    const mmUse = snapL ? snapL.mm : mm;
    const newMm = Math.round(mmUse);
    const delta = mmUse / 1000 - len;
    if (Math.abs(delta) < 0.0005) {
      // 이미 같은 길이 — 맞물린 자리만 빨리 보여 주고 끝낸다.
      if (snapL) { this.showAlign3D(snapL.p, snapL.probe); this.autoHideAlign3D(2000); }
      return { ok: true, changed: false, oldMm, newMm, end: { x: b.x, y: b.y, z: b.z } };
    }
    const u = u0;

    this.pushUndo(`치수 수정 ${oldMm}→${newMm}mm`);
    // 옮겨야 할 것들의 '원래 좌표 → 새 좌표' 쌍. 이어진 배관·부속은 여기 붙여 연쇄로 따라 옮긴다.
    const step = (p) => ({ x: r3(p.x + u.x * delta), y: Math.max(0, r3(p.y + u.y * delta)), z: r3(p.z + u.z * delta) });
    const pairOf = (p) => ({ from: { x: p.x, y: p.y, z: p.z }, to: step(p) });
    const pairs = pipe.points.slice(i).map(pairOf);
    for (let j = i; j < pipe.points.length; j += 1) pipe.points[j] = step(pipe.points[j]);

    // 이 자리에서 이어지는 다른 배관은 통째로 옮기고, 그 자리에 앉은 부속도 같이 옮긴다.
    // 엘보는 접합면(관경에 따라 50A 0.107m ~ 200A 0.38m)만큼 떨어져 앉으므로 그만큼을 같은 자리로 본다.
    const TOL = Math.max(0.13, Math.round(elbowDims('elbow', pipe.bore).face * 1250) / 1000);
    const near = (p, q) => Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) < TOL;
    const movedPipes = new Set([pipe.id]);
    const movedEq = new Set();
    for (let k = 0; k < pairs.length && k < 400; k += 1) {
      const pr = pairs[k];
      const dx = pr.to.x - pr.from.x;
      const dy = pr.to.y - pr.from.y;
      const dz = pr.to.z - pr.from.z;
      if (!dx && !dy && !dz) continue;
      this.state.pipes.forEach((q) => {
        if (movedPipes.has(q.id)) return;
        if (!q.points.some((p) => near(p, pr.from))) return;
        movedPipes.add(q.id);
        q.points.forEach((p) => {
          const to = { x: r3(p.x + dx), y: Math.max(0, r3(p.y + dy)), z: r3(p.z + dz) };
          pairs.push({ from: { x: p.x, y: p.y, z: p.z }, to });
          p.x = to.x; p.y = to.y; p.z = to.z;
        });
      });
      this.state.equipment.forEach((e) => {
        if (movedEq.has(e.id) || !near(e, pr.from)) return;
        movedEq.add(e.id);
        const to = { x: r3(e.x + dx), y: Math.max(0, r3(e.y + dy)), z: r3(e.z + dz) };
        pairs.push({ from: { x: e.x, y: e.y, z: e.z }, to });
        e.x = to.x; e.y = to.y; e.z = to.z;
      });
    }

    // v72 — 끝점이 탱크 벽면 가까이 오면 그 높이·자리에 노즐을 맞춘다.
    const fit = this.autoFitTankNozzle(pipe, i);
    this.rebuild();
    if (snapL) {
      this.showAlign3D(snapL.p, snapL.probe);
      this.autoHideAlign3D(2000);
    }
    const end = pipe.points[i];
    return {
      ok: true, changed: true, oldMm, newMm,
      fit: fit ? fit.text : null,
      end: end ? { x: end.x, y: end.y, z: end.z } : null,
    };
  }

  refreshScene() {
    if (this.root) this.scene.remove(this.root);
    this.root = buildScene(this.state);
    this.scene.add(this.root);
    this.applyPlan();
    this.refreshHighlight();
    this.renderLists();
    this.updateStats();
    this.refreshDims();
    this.scheduleSave();
  }

  applyPlan() {
    const p = this.state.floorPlan;
    if (!p.src) {
      this.planMesh.visible = false;
      return;
    }
    if (this.planSrc !== p.src) {
      this.planSrc = p.src;
      const tex = new THREE.TextureLoader().load(p.src);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
      this.planTexture = tex;
      this.planMesh.material.map = tex;
      this.planMesh.material.needsUpdate = true;
    }
    const w = p.width;
    const h = w / (p.aspect || 1);
    this.planMesh.scale.set(w, h, 1);
    this.planMesh.position.set(p.x, 0.008, p.z);
    this.planMesh.rotation.set(-Math.PI / 2, 0, THREE.MathUtils.degToRad(p.rot));
    this.planMesh.material.opacity = p.opacity;
    this.planMesh.visible = !!p.visible;
  }

  refreshHighlight() {
    // 고른 것마다 주황 상자 하나 — 여러 개를 골랐으면 모두 표시된다(v73).
    const vp = $('#viewport');
    if (vp) vp.classList.toggle('multi-select', !!this.multiMode);
    (this.helpers || []).forEach((h) => {
      this.scene.remove(h);
      h.geometry.dispose();
      h.material.dispose();
    });
    this.helpers = [];
    this.helper = null;
    if (!this.selection) return;
    const sels = this.selectionList();
    let lost = false;
    sels.forEach((sel) => {
      const obj = this.findObject(sel);
      if (!obj) {
        if (this.selection && sel.kind === this.selection.kind && sel.id === this.selection.id) lost = true;
        return;
      }
      const box = new THREE.BoxHelper(obj, 0xf5a623);
      box.material.depthTest = false;
      box.material.transparent = true;
      box.material.opacity = 0.95;
      box.renderOrder = 999;
      this.scene.add(box);
      this.helpers.push(box);
      if (!this.helper) this.helper = box;
    });
    if (lost) { this.selection = null; this.multiSel = []; this.multiMode = false; }
    // 지워진 것이 함께 선택에 남아 있으면 정리한다.
    this.multiSel = (this.multiSel || []).filter((s) => !!this.specOf(s));
  }

  findObject(sel) {
    if (!this.root || !sel) return null;
    let found = null;
    this.root.traverse((o) => {
      if (found || !o.userData || !o.userData.pick) return;
      if (o.userData.pick.kind === sel.kind && o.userData.pick.id === sel.id) found = o;
    });
    return found;
  }

  getSelectedSpec() {
    if (!this.selection) return null;
    const list = this.selection.kind === 'pipe' ? this.state.pipes : this.state.equipment;
    return list.find((s) => s.id === this.selection.id) || null;
  }

  // ── 여러 개 선택 (v73) ──────────────────────────────────────────────────
  // 주 선택(this.selection) + 함께 고른 것(this.multiSel)을 한 목록으로 다룬다.
  // 목록의 첫째가 속성 창에 열리는 '주 선택'이고, 나머지는 함께 움직이는 것들이다.
  selectionList() {
    const out = [];
    const seen = new Set();
    const push = (sel) => {
      if (!sel) return;
      const k = `${sel.kind}:${sel.id}`;
      if (seen.has(k)) return;
      seen.add(k);
      out.push(sel);
    };
    push(this.selection);
    (this.multiSel || []).forEach(push);
    return out;
  }

  specOf(sel) {
    if (!sel) return null;
    const list = sel.kind === 'pipe' ? this.state.pipes : this.state.equipment;
    return list.find((s) => s.id === sel.id) || null;
  }

  // 지금 고른 것들의 {{ sel, spec }} — 이미 지워진 것은 조용히 뺀다.
  selectedSpecs() {
    return this.selectionList()
      .map((sel) => {
        const spec = this.specOf(sel);
        return spec ? { sel, spec } : null;
      })
      .filter(Boolean);
  }

  // 3D에서 톡 누를 때마다 그 자리를 선택에 더하거나 뺀다 (☑️ 여러 개 선택이 켜져 있을 때).
  toggleMulti(kind, id) {
    const key = `${kind}:${id}`;
    const extraIdx = (this.multiSel || []).findIndex((s) => `${s.kind}:${s.id}` === key);
    if (this.selection && `${this.selection.kind}:${this.selection.id}` === key) {
      // 주 선택을 다시 누르면 뺀다 — 남은 것 중 첫째가 새 주 선택이 된다.
      if (!this.multiSel.length) {
        this.multiMode = false;
        this.clearSelection();
        return;
      }
      this.selection = this.multiSel.shift();
    } else if (extraIdx >= 0) {
      this.multiSel.splice(extraIdx, 1);
    } else if (!this.selection) {
      this.selection = { kind, id };
      this.multiMode = true;
    } else {
      this.multiSel.push({ kind, id });
    }
    this.multiMode = this.selectionList().length > 1;
    this.refreshHighlight();
    this.renderProps();
    this.renderLists();
    const n = this.selectionList().length;
    const last = this.multiSel.length ? this.multiSel[this.multiSel.length - 1] : this.selection;
    const spec = this.specOf(last);
    this.toast(n > 1
      ? `☑️ ${n}개 선택${spec ? ' · ' + spec.name : ''} — 3D에서 톡톡 누르면 늘고 줄어듭니다`
      : `하나만 선택됨${spec ? ' · ' + spec.name : ''}`);
  }

  // 🔗 연결된 것 모두 — 고른 것에 접합면·노즐 끝·배관 끝(또는 배관 몸통)이 닿아 있는 것들을 줄줄이 함께 고른다.
  // 펌프에 붙은 밸브 + 배관 + 엘보 한 줄, 헤더 위에 인라인으로 앉은 밸브까지 한 번에 잡는다.
  linkAllConnected() {
    const seeds = this.selectedSpecs();
    if (!seeds.length) { this.toast('먼저 하나 고르세요.', { type: 'err' }); return; }
    const TOL = 0.2;   // 접합면 0mm가 이상적이지만, 손으로 그린 배관은 몇 cm 틈이 있다
    // 접합점(장비는 노즐·접합면 끝 + 몸통 중심, 배관은 모든 점)과 배관 몸통 선분
    const node = (spec) => {
      if (Array.isArray(spec.points)) {
        const pts = spec.points.map((p) => ({ x: p.x, y: p.y, z: p.z }));
        const segs = [];
        for (let i = 1; i < pts.length; i += 1) segs.push([pts[i - 1], pts[i]]);
        return { pts, segs };
      }
      const pts = [];
      equipPorts(spec).forEach((n) => pts.push({ x: n.tip.x, y: n.tip.y, z: n.tip.z }));
      equipConnectFaces(spec).forEach((f) => pts.push({ x: f.tip.x, y: f.tip.y, z: f.tip.z }));
      pts.push({ x: Number(spec.x) || 0, y: Number(spec.y) || 0, z: Number(spec.z) || 0 });
      return { pts, segs: [] };
    };
    const segDist = (a, b, p) => {
      const vx = b.x - a.x;
      const vy = b.y - a.y;
      const vz = b.z - a.z;
      const L2 = vx * vx + vy * vy + vz * vz;
      let t = L2 ? ((p.x - a.x) * vx + (p.y - a.y) * vy + (p.z - a.z) * vz) / L2 : 0;
      t = Math.max(0, Math.min(1, t));
      return Math.hypot(p.x - (a.x + vx * t), p.y - (a.y + vy * t), p.z - (a.z + vz * t));
    };
    // 두 대상이 붙어 있는가 — 점↔점, 점↔선분(둘 다 방향)
    const touch = (A, B) => {
      for (const a of A.pts) {
        for (const b of B.pts) if (Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) <= TOL) return true;
        for (const [s0, s1] of B.segs) if (segDist(s0, s1, a) <= TOL) return true;
      }
      for (const b of B.pts) {
        for (const [s0, s1] of A.segs) if (segDist(s0, s1, b) <= TOL) return true;
      }
      return false;
    };
    const all = [
      ...this.state.equipment.map((s) => ({ kind: 'equipment', spec: s, node: node(s) })),
      ...this.state.pipes.map((s) => ({ kind: 'pipe', spec: s, node: node(s) })),
    ];
    const chosen = new Set(seeds.map(({ sel }) => `${sel.kind}:${sel.id}`));
    const LIMIT = 80;
    let grew = true;
    while (grew && chosen.size < LIMIT) {
      grew = false;
      const front = all.filter((x) => chosen.has(`${x.kind}:${x.spec.id}`));
      all.forEach((cand) => {
        const k = `${cand.kind}:${cand.spec.id}`;
        if (chosen.has(k) || chosen.size >= LIMIT) return;
        if (front.some((f) => touch(f.node, cand.node))) {
          chosen.add(k);
          grew = true;
        }
      });
    }
    const first = this.selection;
    const firstKey = first ? `${first.kind}:${first.id}` : null;
    this.multiSel = [...chosen]
      .filter((k) => k !== firstKey)
      .map((k) => {
        const cut = k.indexOf(':');
        return { kind: k.slice(0, cut), id: k.slice(cut + 1) };
      })
      .filter((s) => this.specOf(s));
    this.multiMode = this.selectionList().length > 1;
    this.refreshHighlight();
    this.renderProps();
    this.renderLists();
    const n = this.selectionList().length;
    this.toast(n > 1
      ? `🔗 연결된 것 ${n}개를 함께 골랐습니다 — [↔️ 같이 이동]으로 통째로 옮기세요`
      : '이어진 것이 더 없습니다 — 고른 것 하나만 선택돼 있습니다');
  }

  select(kind, id) {
    this.selection = { kind, id };
    this.multiSel = [];
    this.multiMode = false;
    // 속성 창이 열리면 명령창 키보드는 내린다 — 모바일에서 키보드가 3D 시야를 가리지 않게.
    this.blurCmdInput();
    this.refreshHighlight();
    this.renderProps();
    this.renderLists();
    this.refreshDims();      // 이 배관의 치수 라벨만 바로 보이게
    // 선택한 부속·배관의 출구로 주황색 커서를 옆기고 그 방향으로 다음 명령을 이어 쓴다.
    const spec = this.getSelectedSpec();
    if (spec) this.aimAt(spec);
    if (window.innerWidth <= 860) this.setDrawerOpen(false);
    // 3D 탭으로 연 창이면(창이 이미 열려 있던 경우 포함) 뒤따르는 고스트 클릭을 잠근다.
    if (this.fromCanvasTap) this.guardPropsFromGhostTap();
  }

  clearSelection() {
    this.selection = null;
    this.multiSel = [];
    this.multiMode = false;
    this.focusKey = null;
    this.moveDrag = false;
    this.moveDragState = null;
    if (this.renderer) {
      this.renderer.domElement.classList.remove('move-drag');
      const vp = $('#viewport');
      if (vp) vp.classList.remove('move-drag');
    }
    this.refreshHighlight();
    this.renderProps();
    this.renderLists();
    this.refreshDims();
  }

  // rot(도) → 그리기 방향. cmdRotFor()와 같은 규칙을 쓴다.
  headingFromRot(rot) {
    const r = ((Math.round(Number(rot) || 0) % 360) + 360) % 360;
    if (r === 90) return { axis: 'z', sign: 1 };
    if (r === 180) return { axis: 'x', sign: -1 };
    if (r === 270) return { axis: 'z', sign: -1 };
    return { axis: 'x', sign: 1 };
  }

  // 이어 그리기를 시작할 노즐 — 펌프는 토출(OUT) 먼저(없으면 흡입 IN),
  // 나머지 장비는 equipNozzles() 순서(위→아래→왼쪽→오른쪽)의 첫 번째 활성 노즐.
  // 노즐 없는 부속·장비면 null.
  equipAimNozzle(spec) {
    if (!spec) return null;
    const list = equipPorts(spec);
    if (!list.length) return null;
    if (spec.type === 'pump') {
      return list.find((n) => n.dir === 'out') || list.find((n) => n.dir === 'in') || list[0];
    }
    // 티는 흐름이 나가는 쪽(직진 B)에서 이어 그린다 — 들어온 쪽(A)은 이미 배관이 물려 있다.
    if (spec.type === 'tee') return list.find((n) => n.nid === 'runB') || list[0];
    // 플랜지 접합면만 있는 부속(밸브·신축관·유량계·플랜지)은 흐름이 나가는 쪽(+유로 축) 면에서 이어 그린다.
    const seat = list.filter((n) => n.seat);
    if (seat.length) return seat.find((n) => n.nid === 'faceB') || seat[0];
    return list[0];
  }

  // 이어 그릴 관경 — 레듀샤는 나가는 쪽(bore2), 나머지 부속은 관경(bore1 → bore).
  // (v74 — 예전에는 spec.bore만 있는 밸브·엘보에서 관경을 못 찾아 기본 50A로 이어 그려졌다)
  aimBoreOf(spec) {
    if (!spec) return this.cmdBore;
    const pick = (...list) => list.find((b) => BORES[b]) || null;
    if (Array.isArray(spec.points)) return pick(spec.bore, spec.bore1) || this.cmdBore;
    if (spec.type === 'reducer') return pick(spec.bore2, spec.bore, spec.bore1) || this.cmdBore;
    return pick(spec.bore1, spec.bore, spec.bore2) || this.cmdBore;
  }

  // 지금 넣을 부속·배관의 관경 — ① 고른 배관·부속의 관경 ② 현재 명령 관경(cmdBore).
  // (v76 사용자: "티 뿐만 아니라 모든게 다 현재 그리고 있는 사이즈에 맞게 넣어줘야 해")
  //  예전에는 팔레트로 넣은 티·레듀샤가 늘 표 기본값 100A로 들어가, 80A 배관에 100A 티가 박혔다.
  inheritedBore(fallback) {
    const fb = BORES[fallback] ? fallback : (BORES[this.cmdBore] ? this.cmdBore : '100A');
    const spec = this.getSelectedSpec();
    if (spec) {
      if (Array.isArray(spec.points)) {
        if (BORES[spec.bore]) return spec.bore;
      } else {
        const pick = (...list) => list.find((b) => BORES[b]) || null;
        const b = spec.type === 'reducer'
          ? pick(spec.bore2, spec.bore, spec.bore1)
          : pick(spec.bore1, spec.bore, spec.bore2);
        if (b) return b;
      }
    }
    return fb;
  }

  // 노즐 하나를 이어 그리는 자리로 삼는다 — 커서를 끝(플랜지 면)에, 방향은 노즐이 뻗는 쪽으로,
  // 관경은 그 노즐 관경으로. nozContinue(📍 위/아래/…·IN/OUT)와 aimAt(선택·📍 여기서)이 함께 쓴다.
  aimAtNozzle(n) {
    if (!n) return null;
    // 노즐이 뻗는 바깥 방향을 그대로 이어 그리는 방향으로 삼는다(수직 노즐이면 위로).
    const ax = Math.abs(n.axis.y) > Math.max(Math.abs(n.axis.x), Math.abs(n.axis.z)) ? 'y'
      : (Math.abs(n.axis.x) >= Math.abs(n.axis.z) ? 'x' : 'z');
    const sgn = (ax === 'x' ? n.axis.x : ax === 'z' ? n.axis.z : n.axis.y) < 0 ? -1 : 1;
    this.cmdAxis = ax;
    this.cmdSign = sgn;
    this.cmdRot = this.cmdRotFor(ax, sgn);
    this.lastDirV = { x: n.axis.x, y: n.axis.y, z: n.axis.z };
    this.setCmdBore(n.bore, true);
    this.setCmdCursor({ x: n.tip.x, y: Math.max(0, n.tip.y), z: n.tip.z }, true);
    return n;
  }

  // 부속의 출구 — 인라인 부속은 배관이 이어지는 자리,
  // 노즐이 있는 장비(펌프·열교환기·헤더·탱크)는 실제 노즐 끝(플랜지 면), 나머지 설비는 윗면 중심.
  equipExit(spec) {
    const n = this.equipAimNozzle(spec);
    if (n) return { x: n.tip.x, y: Math.max(0, n.tip.y), z: n.tip.z };
    const len = INLINE_TYPES.has(spec.type) ? (spec.w || 0) : 0;
    if (!len) return { x: spec.x, y: r3((spec.y || 0) + (spec.h || 0)), z: spec.z };
    const d = Array.isArray(spec.dir) ? spec.dir : (spec.axis === 'y' ? [0, 1, 0] : null);
    const dl = d ? Math.hypot(d[0], d[1], d[2]) : 0;
    if (dl > 1e-6) {
      const half = len / 2;
      return {
        x: r3(spec.x + (d[0] / dl) * half),
        y: Math.max(0, r3((spec.y || 0) + (d[1] / dl) * half)),
        z: r3(spec.z + (d[2] / dl) * half),
      };
    }
    const h = this.headingFromRot(spec.rot);
    const d2 = len / 2;
    return {
      x: r3(spec.x + (h.axis === 'x' ? h.sign * d2 : 0)),
      y: Math.max(0, r3(spec.y || 0)),
      z: r3(spec.z + (h.axis === 'z' ? h.sign * d2 : 0)),
    };
  }

  // 선택한 것을 "이어 그릴 자리"로 삼는다 — 커서·방향·관경·재질까지.
  // end: 배관의 어느 끝에서 이어 그릴지('start' | 'end'). 없으면 열린 끝을 우선한다(v76).
  aimAt(spec, end) {
    if (!spec) return;
    if (Array.isArray(spec.points) && spec.points.length) {
      const pts = spec.points;
      const side = end === 'start' || end === 'end' ? end : this.pipePrefEnd(spec);
      const i = side === 'start' ? 0 : pts.length - 1;
      const p = pts[i];
      const q = pts.length > 1 ? pts[i === 0 ? 1 : pts.length - 2] : { x: p.x + 1, y: p.y, z: p.z };
      const dx = p.x - q.x, dy = p.y - q.y, dz = p.z - q.z;
      const ax = Math.abs(dx) >= Math.abs(dy) && Math.abs(dx) >= Math.abs(dz) ? 'x'
        : (Math.abs(dz) >= Math.abs(dy) ? 'z' : 'y');
      const delta = ax === 'x' ? dx : ax === 'z' ? dz : dy;
      this.cmdAxis = ax;
      this.cmdSign = delta < 0 ? -1 : 1;
      this.cmdRot = this.cmdRotFor(this.cmdAxis, this.cmdSign);
      const dlen = Math.hypot(dx, dy, dz) || 1;
      this.lastDirV = { x: dx / dlen, y: dy / dlen, z: dz / dlen };
      // 배관은 그 배관 관경을 그대로 이어받는다 — 조이스틱·명령·📍 여기서 모두 같은 값.
      this.setCmdBore(this.aimBoreOf(spec), true);
      if (MATERIALS[spec.material]) this.cmdMaterial = spec.material;
      this.setCmdCursor({ x: p.x, y: p.y, z: p.z }, true);
      return;
    }
    // 노즐이 있는 장비 — 허공의 본체 윗면이 아니라 실제 노즐 끝에 커서를 붙인다.
    const noz = this.equipAimNozzle(spec);
    if (noz) { this.aimAtNozzle(noz); return; }
    const h = this.headingFromRot(spec.rot);
    const dv = Array.isArray(spec.dir) ? spec.dir : (spec.axis === 'y' ? [0, 1, 0] : null);
    if (dv && Math.hypot(dv[0], dv[1], dv[2]) > 1e-6) {
      // 배관 축 방향을 그대로 이어받는다 — 수직·경사 배관 끝에서도 같은 방향으로 계속 간다.
      const l = Math.hypot(dv[0], dv[1], dv[2]);
      const u = { x: dv[0] / l, y: dv[1] / l, z: dv[2] / l };
      this.cmdAxis = Math.abs(u.x) >= Math.abs(u.y) && Math.abs(u.x) >= Math.abs(u.z) ? 'x'
        : (Math.abs(u.z) >= Math.abs(u.y) ? 'z' : 'y');
      this.cmdSign = (this.cmdAxis === 'x' ? u.x : this.cmdAxis === 'z' ? u.z : u.y) < 0 ? -1 : 1;
      this.cmdRot = this.cmdRotFor(this.cmdAxis, this.cmdSign);
      this.lastDirV = u;
    } else {
      this.cmdAxis = h.axis;
      this.cmdSign = h.sign;
      this.cmdRot = this.cmdRotFor(h.axis, h.sign);
      this.lastDirV = h.axis === 'x' ? { x: h.sign, y: 0, z: 0 }
        : h.axis === 'z' ? { x: 0, y: 0, z: h.sign } : { x: 0, y: h.sign, z: 0 };
    }
    // 관경 — 레듀샤는 나가는 쪽(bore2), 티·밸브·엘보·피팅은 자기 관경(bore1 → bore).
    // setCmdBore()로 넣어 조이스틱 하단 관경 표시까지 같이 맞춘다 (v74).
    this.setCmdBore(this.aimBoreOf(spec), true);
    this.setCmdCursor(this.equipExit(spec), true);
  }

  // ── 배관 양끝 이어그리기 (v76) ──────────────────────────────────────
  // 사용자(2026-11-27 09:57): "배관 50A 고르면 엘보 붙은 쪽만 잡하고 반대쪽 열린 끝에서는 안 된다"
  //  · 끝점이 엘보·밸브·티·노즐·플랜지·다른 배관 끝과 3cm 안에 붙어 있으면 '닫힌 끝', 아니면 '열린 끝'.
  pipeEndAttached(pipe, end) {
    const pts = pipe && pipe.points ? pipe.points : [];
    if (pts.length < 2) return false;
    const p = end === 'start' ? pts[0] : pts[pts.length - 1];
    if (!p) return false;
    const TOL = 0.03;
    const near = (q) => !!q && Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z) < TOL;
    for (let k = 0; k < this.state.pipes.length; k += 1) {
      const o = this.state.pipes[k];
      if (!o || o.id === pipe.id) continue;
      const q = o.points || [];
      if (q.length < 2) continue;
      if (near(q[0]) || near(q[q.length - 1])) return true;
    }
    for (let k = 0; k < this.state.equipment.length; k += 1) {
      const e = this.state.equipment[k];
      if (!e) continue;
      if (equipConnectFaces(e).some((n) => near(n && n.tip))) return true;
      if (equipNozzles(e).some((n) => near(n && n.tip))) return true;
    }
    return false;
  }

  // 이 배관에서 이어 그릴 끝 — ① 한쪽만 열려 있으면 그 열린 끝 ②둘 다 열렸거나 둘 다 닫혔으면
  // 사용자가 🔁로 고른 끝(없으면 끝점).
  pipePrefEnd(pipe) {
    if (!pipe) return 'end';
    const sOpen = !this.pipeEndAttached(pipe, 'start');
    const eOpen = !this.pipeEndAttached(pipe, 'end');
    if (sOpen !== eOpen) return sOpen ? 'start' : 'end';
    const saved = this.pipeEndPrefs && this.pipeEndPrefs[pipe.id];
    return saved === 'start' ? 'start' : 'end';
  }

  togglePipeEnd() {
    const spec = this.getSelectedSpec();
    if (!spec || !Array.isArray(spec.points)) return;
    this.pipeEndPrefs = this.pipeEndPrefs || {};
    const cur = this.pipePrefEnd(spec);
    const next = cur === 'start' ? 'end' : 'start';
    this.pipeEndPrefs[spec.id] = next;
    this.aimAt(spec, next);
    this.renderProps();
    this.showEndPick(spec, next);
    const c = this.cmdCursor;
    this.toast(`📍 ${next === 'start' ? '시작점' : '끝점'} 쪽으로 바꿈 · 커서 (${fmt(c.x)}, ${fmt(c.y)}, ${fmt(c.z)})m`);
  }

  // 지금 이어 그릴 끝에 미리보기 링을 하나 띄운다 — 양쪽 다 열렸을 때 어느 쪽인지 보이게.
  showEndPick(pipe, end) {
    if (!pipe || !pipe.points || pipe.points.length < 2) return;
    if (!this.endPickRing) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(1, 0.05, 8, 32),
        new THREE.MeshBasicMaterial({ color: 0x4ce4a4, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false }),
      );
      ring.renderOrder = 997;
      this.endPickRing = ring;
      this.scene.add(ring);
    }
    const pts = pipe.points;
    const p = end === 'start' ? pts[0] : pts[pts.length - 1];
    const q = pts[end === 'start' ? 1 : pts.length - 2] || p;
    const od = (BORES[pipe.bore] || BORES['50A']).od;
    this.endPickRing.position.set(p.x, p.y, p.z);
    this.endPickRing.scale.setScalar(od * 0.85);
    // 링을 배관 축에 수직으로 세우다 — 배관 끝을 딱 감싸는 모양이 된다.
    const dx = p.x - q.x, dy = p.y - q.y, dz = p.z - q.z;
    const L = Math.hypot(dx, dy, dz);
    if (L > 1e-6) {
      this.endPickRing.quaternion.setFromUnitVectors(
        this.endPickUp || (this.endPickUp = new THREE.Vector3(0, 0, 1)),
        new THREE.Vector3(dx / L, dy / L, dz / L),
      );
    }
    this.endPickRing.visible = true;
  }

  hideEndPick() {
    if (this.endPickRing) this.endPickRing.visible = false;
  }

  // 연결 명령("벨브에 붙여줘", "오른쪽 배관이랑 이어줘")이 붙을 대상 찾기
  resolveConnect(op, cursor) {
    const wantPipe = op.target === 'pipe';
    const VALVE_TYPES = new Set(['valve', 'bfly', 'yvalve', 'ball', 'check']);
    const dirOk = (dx, dy, dz) => {
      if (!op.axis) return true;
      const v = op.axis === 'x' ? dx : op.axis === 'y' ? dy : dz;
      return v * (op.sign || 1) > 0.02;
    };
    const dist = (p) => Math.hypot(p.x - cursor.x, p.y - cursor.y, p.z - cursor.z);
    let best = null;
    const consider = (p, label, bore, extra) => {
      const dx = p.x - cursor.x, dy = p.y - cursor.y, dz = p.z - cursor.z;
      const d = Math.hypot(dx, dy, dz);
      if (d < 0.02) return;
      if (!dirOk(dx, dy, dz)) return;
      if (!best || d < best.d) best = { d, p: { x: p.x, y: p.y, z: p.z }, label, bore: bore || null, ...(extra || {}) };
    };

    if (wantPipe) {
      this.state.pipes.forEach((p) => {
        const pts = p.points || [];
        if (!pts.length) return;
        consider(pts[0], p.name);
        consider(pts[pts.length - 1], p.name);
      });
    } else {
      this.state.equipment.forEach((e) => {
        if (op.type && !(op.type === 'valve' ? VALVE_TYPES.has(e.type) : e.type === op.type)) return;
        // 노즐이 있는 장비는 노즐 끝만 연결 후보 — 그 노즐 관경을 그대로 이어받는다.
        // (노즐이 없을 때만 본체 출구를 후보로 둔다)
        const noz = equipPorts(e);
        if (!noz.length) consider(this.equipExit(e), e.name);
        noz.forEach((n) => consider(n.tip, `${e.name} ${n.label || NOZZLE_LABELS[n.dir] || ''}`, n.bore,
          n.seat ? { seat: n.seat, portAxis: n.axis } : null));
      });
    }
    return best;
  }

  // 두 점을 잇는 직교 경로 (수평 → 수직). 이미 맞으면 직선 한 구간.
  orthoPath(a, b) {
    const eps = 0.02;
    const pts = [{ x: a.x, y: a.y, z: a.z }];
    if (Math.abs(b.x - a.x) > eps) pts.push({ x: b.x, y: a.y, z: a.z });
    if (Math.abs(b.z - a.z) > eps) pts.push({ x: b.x, y: a.y, z: b.z });
    if (Math.abs(b.y - a.y) > eps || pts.length === 1) pts.push({ x: b.x, y: b.y, z: b.z });
    // 같은 점이 붙어 있으면 정리
    const out = [pts[0]];
    for (let i = 1; i < pts.length; i += 1) {
      const p = pts[i], q = out[out.length - 1];
      if (Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) > 1e-4) out.push(p);
    }
    return out;
  }

  // ── 45° 자동 잇기 경로 (v85) ──────────────────────────────
  // 두 점을 **정확한 45°**로 잇는다 — 45° 모드에서 🔗 잇기·`연결` 명령이 쓴다.
  //  · 높이차(dy)와 수평차(dh)가 있으면 m = min(|dy|, dh)만큼 45° 대각선을 넣고, 남는 수평은
  //    앞 직관, 남는 높이는 뒤 직관으로 이어 **양쪽 꺾임이 정확히 45°**가 된다
  //    (|dy| ≈ dh면 45° 대각선 한 구간으로 바로 잇는다).
  //  · 같은 높이에서 수평 2축(dx·dz)이 다르면 긴 축으로 먼저 간 뒤 바닥면 45°로 잇는다.
  //  · 플랜지·노즐(seat === 'flange')이면 포트 축으로 짧게 나온 스텁을 먼저 만들고 45°로 꺾어 들어간다
  //    — 그래야 배관이 접합면을 비스듬히 뚫지 않는다.
  // 반환: { points 꼭짓점들, runs 엘보 자리를 비운 직관 구간, elbows 세울 엘보 }
  diag45Path(a, b, opts) {
    const o = opts || {};
    const bore = BORES[o.bore] ? o.bore : this.cmdBore;
    const A = { x: r3(a.x), y: Math.max(0, r3(a.y)), z: r3(a.z) };
    const T = { x: r3(b.x), y: Math.max(0, r3(b.y)), z: r3(b.z) };
    const dist = Math.hypot(T.x - A.x, T.y - A.y, T.z - A.z);
    // ① 포트 축(플랜지·노즐)은 축으로 짧게 나온 스텁 + 엘보로 따로 잇는다
    if (o.portAxis && dist > 0.08) {
      const port = this.diag45PortPath(A, T, o.portAxis, bore);
      if (port) return port;
    }
    // ② A → T 중간 꼭짓점 (정확한 45° 구간)
    const pts = [A].concat(this.diag45Mid(A, T));
    // 겹친 점 정리
    const P = [pts[0]];
    for (let i = 1; i < pts.length; i += 1) {
      const q = P[P.length - 1];
      if (Math.hypot(pts[i].x - q.x, pts[i].y - q.y, pts[i].z - q.z) > 1e-4) P.push(pts[i]);
    }
    if (P.length < 2) return { points: P, runs: [], elbows: [] };
    const pe = this.pathElbows(P, bore);
    return { points: P, runs: pe.runs, elbows: pe.elbows };
  }

  // 경로 꼭짓점의 꺾임(45°·90°)에 엘보를 세우고, 직관 구간을 엘보 face만큼 비운다 (v85).
  //  · 45° 꺾임 → 45° 엘보, 90° 꺾임 → 엘보. 그 밖의 각도는 건너뛰는다.
  pathElbows(path, bore) {
    const P = [];
    (path || []).forEach((q) => {
      const p0 = P[P.length - 1];
      if (!p0 || Math.hypot(q.x - p0.x, q.y - p0.y, q.z - p0.z) > 1e-4) {
        P.push({ x: r3(q.x), y: Math.max(0, r3(q.y)), z: r3(q.z) });
      }
    });
    if (P.length < 2) return { runs: [], elbows: [] };
    const bends = [];
    for (let i = 1; i < P.length - 1; i += 1) {
      const u = unit2(P[i - 1], P[i]);
      const w = unit2(P[i], P[i + 1]);
      const dot = u.x * w.x + u.y * w.y + u.z * w.z;
      const bend = THREE.MathUtils.radToDeg(Math.acos(Math.max(-1, Math.min(1, dot))));
      const type = (bend > 30 && bend < 60) ? 'elbow45' : ((bend > 80 && bend < 100) ? 'elbow' : null);
      bends[i] = type ? { type, u, w, face: elbowDims(type, bore).face, bend } : null;
    }
    const runs = [];
    for (let k = 0; k < P.length - 1; k += 1) {
      const len = Math.hypot(P[k + 1].x - P[k].x, P[k + 1].y - P[k].y, P[k + 1].z - P[k].z);
      if (len < 1e-4) continue;
      const u = unit2(P[k], P[k + 1]);
      let a0 = bends[k] ? bends[k].face : 0;
      let a1 = bends[k + 1] ? bends[k + 1].face : 0;
      // 짧은 구간에서 두 엘보값이 길이를 다 먹으면 80%까지만 남기고 비례해 줄인다
      if (a0 + a1 > len * 0.8) {
        const t = (len * 0.8) / (a0 + a1 || 1);
        a0 *= t;
        a1 *= t;
      }
      if (len - a0 - a1 < 0.002) continue;
      runs.push([
        { x: r3(P[k].x + u.x * a0), y: Math.max(0, r3(P[k].y + u.y * a0)), z: r3(P[k].z + u.z * a0) },
        { x: r3(P[k + 1].x - u.x * a1), y: Math.max(0, r3(P[k + 1].y - u.y * a1)), z: r3(P[k + 1].z - u.z * a1) },
      ]);
    }
    const elbows = [];
    for (let i = 1; i < P.length - 1; i += 1) {
      const bn = bends[i];
      if (!bn) continue;
      elbows.push({
        at: { x: P[i].x, y: P[i].y, z: P[i].z },
        type: bn.type, bore, face: bn.face, bend: bn.bend,
        inDir: [-bn.u.x, -bn.u.y, -bn.u.z],
        outDir: [bn.w.x, bn.w.y, bn.w.z],
      });
    }
    return { runs, elbows };
  }

  // 플랜지·노즐(포트)로 45°로 꺾어 들어가는 경로 (v85).
  //  · 포트 축 바깥으로 엘보 face만큼 나온 모서리까지 45° 경사로 잇고, 그 모서리에 엘보를 세운다.
  //    엘보의 다른 다리 끝면이 정확히 포트 접합면에 앉아 배관이 플랜지를 뚫지 않는다.
  //  · 들어오는 각도가 45°면 45° 엘보, 90°면 90° 엘보, 그 밖이면 예전 방식(seatAtFlangePort)으로.
  diag45PortPath(A, T, portAxis, bore) {
    const ax = portAxis;
    const l = Math.hypot(ax.x || 0, ax.y || 0, ax.z || 0) || 1;
    const u = { x: (ax.x || 0) / l, y: (ax.y || 0) / l, z: (ax.z || 0) / l };
    const f45 = elbowDims('elbow45', bore).face;
    const f90 = elbowDims('elbow', bore).face;
    const C45 = { x: r3(T.x + u.x * f45), y: Math.max(0, r3(T.y + u.y * f45)), z: r3(T.z + u.z * f45) };
    const runsOf = (path) => {
      const out = [];
      for (let i = 1; i < path.length; i += 1) {
        const p0 = path[i - 1];
        const p1 = path[i];
        if (Math.hypot(p1.x - p0.x, p1.y - p0.y, p1.z - p0.z) < 1e-4) continue;
        out.push([{ ...p0 }, { ...p1 }]);
      }
      return out;
    };
    const trimEnd = (run, f, d) => {
      const len = Math.hypot(run[1].x - run[0].x, run[1].y - run[0].y, run[1].z - run[0].z);
      if (!(len > f + 0.02)) return false;
      run[1] = {
        x: r3(run[1].x - d.x * f),
        y: Math.max(0, r3(run[1].y - d.y * f)),
        z: r3(run[1].z - d.z * f),
      };
      return true;
    };
    const c = Math.SQRT1_2;
    const deg = (dot) => THREE.MathUtils.radToDeg(Math.acos(Math.max(-1, Math.min(1, dot))));
    const typeFor = (bend) => ((bend > 30 && bend < 60) ? 'elbow45' : ((bend > 80 && bend < 100) ? 'elbow' : null));

    // ① 45°를 두 번 꺾어 들어가기 — 포트 축과 나란한 직관 → 45° → 대각선 → 45° → 포트 축 스텁.
    //    수직면(위·아래)과 수평면(옆) 네 후보 중 꺾임이 45°(없으면 90°)로 떨어지는 것을 고른다.
    const cands = [];
    [-1, 1].forEach((sy) => {
      const d = { x: -u.x * c, y: sy * c, z: -u.z * c };
      const s2 = (C45.y - A.y) / d.y;      // Q가 A 높이에 오도록
      if (s2 > 2 * f45) cands.push({ d, s: s2 });
    });
    const hx = A.x - C45.x;
    const hz = A.z - C45.z;
    const hl = Math.hypot(hx, hz);
    if (hl > 0.05) {
      const ax2 = hx / hl;
      const az2 = hz / hl;
      const dotA = ax2 * u.x + az2 * u.z;
      const pl = Math.hypot(ax2 - u.x * dotA, az2 - u.z * dotA);
      if (pl > 1e-3) {
        const px = (ax2 - u.x * dotA) / pl;
        const pz = (az2 - u.z * dotA) / pl;
        [-1, 1].forEach((sp) => {
          const d = { x: -u.x * c + px * c * sp, y: 0, z: -u.z * c + pz * c * sp };
          const dp = d.x * px + d.z * pz;
          const s2 = ((C45.x - A.x) * px + (C45.z - A.z) * pz) / (dp || 1);
          if (s2 > 2 * f45) cands.push({ d, s: s2 });
        });
      }
    }
    let planBest = null;
    cands.forEach((cd) => {
      const qy = C45.y - cd.d.y * cd.s;
      if (qy < -1e-6) return;                 // 바닥 아래로 내려가는 후보는 쓰지 않는다
      const Q = {
        x: r3(C45.x - cd.d.x * cd.s),
        y: Math.max(0, r3(qy)),
        z: r3(C45.z - cd.d.z * cd.s),
      };
      const dp = this.diag45Path(A, Q, {});
      if (!dp.runs.length || dp.points.length < 2) return;
      const P = dp.points;
      const uIn = unit2(P[P.length - 2], P[P.length - 1]);
      const bend = deg(uIn.x * cd.d.x + uIn.y * cd.d.y + uIn.z * cd.d.z);
      const type = typeFor(bend);
      if (!type) return;
      const face = elbowDims(type, bore).face;
      const score = (type === 'elbow45' ? 0 : 100) + cd.s * 0.05;
      if (planBest && planBest.score <= score) return;
      planBest = { cd, Q, dp, uIn, type, face, bend, score };
    });
    if (planBest) {
      const runs = planBest.dp.runs.map((r) => [{ ...r[0] }, { ...r[1] }]);
      const lastRun = runs[runs.length - 1];
      if (trimEnd(lastRun, planBest.face, planBest.uIn)) {
        const a0 = {
          x: r3(planBest.Q.x + planBest.cd.d.x * planBest.face),
          y: Math.max(0, r3(planBest.Q.y + planBest.cd.d.y * planBest.face)),
          z: r3(planBest.Q.z + planBest.cd.d.z * planBest.face),
        };
        const a1 = {
          x: r3(C45.x - planBest.cd.d.x * f45),
          y: Math.max(0, r3(C45.y - planBest.cd.d.y * f45)),
          z: r3(C45.z - planBest.cd.d.z * f45),
        };
        if (Math.hypot(a1.x - a0.x, a1.y - a0.y, a1.z - a0.z) > 0.002) runs.push([a0, a1]);
        return {
          points: planBest.dp.points.concat([C45]),
          runs,
          elbows: planBest.dp.elbows.concat([
            {
              at: planBest.Q, type: planBest.type, bore, face: planBest.face, bend: planBest.bend,
              inDir: [-planBest.uIn.x, -planBest.uIn.y, -planBest.uIn.z],
              outDir: [planBest.cd.d.x, planBest.cd.d.y, planBest.cd.d.z],
            },
            {
              at: C45, type: 'elbow45', bore, face: f45, bend: 45,
              inDir: [-planBest.cd.d.x, -planBest.cd.d.y, -planBest.cd.d.z],
              outDir: [-u.x, -u.y, -u.z],
            },
          ]),
        };
      }
    }

    // ② 포트 축으로 곧게 들어오는 경우 — 들어오는 각도가 45°면 45° 엘보, 90°면 90° 엘보
    const plan = [[f45, 'elbow45', 30, 60], [f90, 'elbow', 80, 100]];
    for (let k = 0; k < plan.length; k += 1) {
      const f = plan[k][0];
      const type = plan[k][1];
      const lo = plan[k][2];
      const hi = plan[k][3];
      const C = { x: r3(T.x + u.x * f), y: Math.max(0, r3(T.y + u.y * f)), z: r3(T.z + u.z * f) };
      const dp = this.diag45Path(A, C, {});
      const P = dp.points;
      if (P.length < 2 || !dp.runs.length) continue;
      const d = unit2(P[P.length - 2], P[P.length - 1]);
      const bend = deg(-(d.x * u.x + d.y * u.y + d.z * u.z));
      if (!(bend > lo && bend < hi)) continue;
      const runs = dp.runs.map((r) => [{ ...r[0] }, { ...r[1] }]);
      const lastRun = runs[runs.length - 1];
      const len = Math.hypot(lastRun[1].x - lastRun[0].x, lastRun[1].y - lastRun[0].y, lastRun[1].z - lastRun[0].z);
      if (len > f + 0.02) {
        trimEnd(lastRun, f, d);
      } else if (runs.length > 1) {
        runs.pop();
      } else {
        continue;
      }
      return {
        points: P,
        runs,
        elbows: dp.elbows.concat([{
          at: C, type, bore, face: f, bend,
          inDir: [-d.x, -d.y, -d.z], outDir: [-u.x, -u.y, -u.z],
        }]),
      };
    }
    // ③ 그 밖의 각도 — 예전 방식(90° 엘보 + 직교 경로)으로 물린다
    const seated = this.seatAtFlangePort(A, { p: T, portAxis: u, bore });
    const path = (seated && seated.path) ? seated.path : this.orthoPath(A, T);
    if (seated && seated.elbow) {
      return {
        points: path,
        runs: runsOf(path),
        elbows: [{
          at: seated.elbow.at, type: seated.elbow.type, bore: seated.elbow.bore,
          inDir: seated.elbow.inDir, outDir: seated.elbow.outDir,
        }],
      };
    }
    // 직교 경로의 90° 꼮임에도 엘보를 세운다 (엘보 없는 꼭짓점이 남지 않게)
    const pe = this.pathElbows(path, bore);
    return { points: path, runs: pe.runs, elbows: pe.elbows };
  }

  // A → B 중간 꼭짓점 — 45° 구간을 넣어 만든다 (diag45Path 전용)
  diag45Mid(A, B) {
    const eps = 0.02;
    const dx = B.x - A.x;
    const dy = B.y - A.y;
    const dz = B.z - A.z;
    const dh = Math.hypot(dx, dz);
    const ady = Math.abs(dy);
    const sy = dy < 0 ? -1 : 1;
    const out = [];
    // 수직만 다르면 45°를 넣을 자리가 없다 — 그냥 수직 직관
    if (dh < eps) {
      if (ady > eps) out.push({ ...B });
      return out;
    }
    // 같은 높이 — 바닥면 45°: 긴 축으로 먼저 간 뒤 두 축을 같이 먹는 대각선
    if (ady < eps) {
      const ax = Math.abs(dx);
      const az = Math.abs(dz);
      if (ax < eps || az < eps) { out.push({ ...B }); return out; }
      const m = Math.min(ax, az);
      const pre = ax >= az
        ? { x: A.x + (dx >= 0 ? 1 : -1) * (ax - m), y: A.y, z: A.z }
        : { x: A.x, y: A.y, z: A.z + (dz >= 0 ? 1 : -1) * (az - m) };
      out.push(pre);
      out.push({ ...B });
      return out;
    }
    // 높이차 + 수평차 — m만큼 45° 대각선, 남는 수평·높이는 양쪽 직관으로
    let m = Math.min(ady, dh);
    if (sy < 0) m = Math.min(m, Math.max(0, A.y));   // 바닥을 뚫지 않게
    const remH = dh - m;
    const remV = ady - m;
    const ux = dx / dh;
    const uz = dz / dh;
    if (remH > eps) out.push({ x: A.x + ux * remH, y: A.y, z: A.z + uz * remH });
    out.push({ x: A.x + ux * (remH + m), y: A.y + sy * m, z: A.z + uz * (remH + m) });
    if (remV > eps) out.push({ ...B });
    return out;
  }

  fromHere(end) {
    const spec = this.getSelectedSpec();
    if (!spec) return;
    const noz = this.equipAimNozzle(spec);
    // 노즐이 있는 장비인데 켜둔 노즐이 없으면 어디서 시작할지 알려 준다.
    if (!noz && nozzleDirsOf(spec.type).length) {
      this.toast('켜둔 노즐이 없습니다. 속성 패널의 노즐(관경)에서 이어 그릴 방향을 먼저 고르세요.', { type: 'err' });
      return;
    }
    const isPipe = Array.isArray(spec.points) && spec.points.length > 1;
    const side = isPipe ? (end === 'start' || end === 'end' ? end : this.pipePrefEnd(spec)) : null;
    this.aimAt(spec, side || undefined);
    this.clearSelection();
    const c = this.cmdCursor;
    if (noz) {
      this.toast(`📍 ${noz.label || NOZZLE_LABELS[noz.dir]} 노즐 ${noz.bore} 끝에서 이어 그립니다 · 커서 (${fmt(c.x)}, ${fmt(c.y)}, ${fmt(c.z)})m`);
      return;
    }
    if (isPipe) {
      this.toast(`📍 ${side === 'start' ? '시작점' : '끝점'}에서 이어 그립니다 · ${spec.bore} · 커서 (${fmt(c.x)}, ${fmt(c.y)}, ${fmt(c.z)})m`);
      return;
    }
    this.toast(`📍 여기서 이어 그립니다 · ${this.cmdBore} · 커서 (${fmt(c.x)}, ${fmt(c.y)}, ${fmt(c.z)})m`);
  }

  // 장비 노즐 끝에서 이어 그리기 — 커서를 노즐 플랜지 면에 놓고 노즐 관경을 물려준다.
  // (손 그리기 스냅과 같은 좌표를 쓴다 — 두 길이 같은 자리에서 시작한다)
  // key = 노즐 id(nid) 또는 방향 — 열교환기는 같은 방향에 여러 개가 있을 수 있어 id로 먼저 찾는다.
  nozContinue(key) {
    const spec = this.getSelectedSpec();
    if (!spec || !key) return;
    const list = equipNozzles(spec);
    const n = list.find((x) => x.nid === key) || list.find((x) => x.dir === key);
    if (!n) { this.toast('그 자리에는 노즐이 없습니다. 노즐을 먼저 추가하세요.', { type: 'err' }); return; }
    this.aimAtNozzle(n);
    this.clearSelection();
    this.toast(`📍 ${n.label || NOZZLE_LABELS[n.dir]} 노즐 ${n.bore}에서 이어 그립니다 · 커서 (${fmt(n.tip.x)}, ${fmt(n.tip.y)}, ${fmt(n.tip.z)})m`);
  }

  // ── 탱크 벽면에 배관 끝을 대면 노즐을 그 높이·자리에 맞춘다 (v72) ──────────
  // 사용자: "배관을 가까이 가져다 놓으면 그 높이나 위치에 맞게 자동으로 변경해줘".
  // 배관 끝이 탱크 외벽 TANK_FIT_DIST 안에 와서 그 벽을 향해 들어오면
  //  ① 같은 벽면에 이미 있는 노즐 중 가장 가까운 것을 그 높이·가로로 옮기고
  //  ② 그 노즐에 다른 배관이 이미 물려 있으면 떼지 않고 그 자리에 새 노즐을 뽑아
  //  ③ 맞춘 노즐의 플랜지 면(tip)에 배관 끝을 앉힌다 — 0mm로 맞물린다.
  // 벽과 나란히 지나가는 배관은 건드리지 않는다(자동으로 망가지는 일이 없게).
  nozzleInUse(noz, exceptPipeId) {
    if (!noz) return false;
    const T = 0.08;
    return this.state.pipes.some((pp) => pp && pp.id !== exceptPipeId && (pp.points || []).some(
      (pt) => Math.hypot(pt.x - noz.tip.x, pt.y - noz.tip.y, pt.z - noz.tip.z) < T,
    ));
  }

  autoFitTankNozzle(pipe, index) {
    if (!pipe || !Array.isArray(pipe.points)) return null;
    const i = Number(index);
    const p = pipe.points[i];
    const other = pipe.points[i === 0 ? 1 : i - 1];
    if (!p || !other) return null;
    const dx = p.x - other.x;
    const dy = p.y - other.y;
    const dz = p.z - other.z;
    const L = Math.hypot(dx, dy, dz);
    if (L < 0.05) return null;
    const dir = { x: dx / L, y: dy / L, z: dz / L };
    // 가장 가까운 벽면 하나를 고른다 — 여러 탱크 사이면 더 가까운 쪽.
    let best = null;
    this.state.equipment.forEach((e) => {
      if (!TANK_NOZ_TYPES.has(e.type)) return;
      const fit = tankWallFit(e, p, TANK_FIT_DIST);
      if (!fit) return;
      // v73 — 윗면·바닥면은 높이만 가까우면 탱크에서 멀리 떨어진 자리도 '맞음'이 됐다.
      // (헤더 배관을 50mm 옮겼더니 1.2m 떨어진 드럼 위로 끝점이 튀어 버림) 실제로 그 탱크
      // 몸체 앞·열(0.4m)일 때만 맞춘다.
      if (!this.tankNearPoint(e, p, fit)) return;
      const dot = dir.x * fit.axis.x + dir.y * fit.axis.y + dir.z * fit.axis.z;
      // 노즐 축은 탱크 바깥을 향한다 — 배관은 그 반대로(벽을 향해) 들어와야 한다.
      if (dot > -TANK_FIT_DOT) return;
      const score = fit.dist + (1 - dot) * 0.05;
      if (!best || score < best.score) best = { e, fit, score };
    });
    if (!best) return null;
    const e = best.e;
    const fit = best.fit;
    const list = tankNozzlesOf(e);
    const span = tankHeightSpan(e);
    // ① 이 배관을 따라다니는 노즐이 이미 있으면 그것을 옮긴다 — 같은 배관을 다시
    //    옮길 때마다 노즐이 하나씩 늘어나지 않게(사용자가 점 좌표를 고치는 동안에도).
    let target = list.find((n) => n.pipe === pipe.id) || null;
    if (target) {
      const lv = equipNozzles(e).find((x) => x.nid === target.nid);
      if (lv && this.nozzleInUse(lv, pipe.id)) target = null;
    }
    // ② 없으면 같은 벽면에서 가장 가까운 노즐 — 높이·가로를 m로 환산해 거리를 잰다.
    if (!target) {
      let pick = null;
      let pickD = Infinity;
      list.forEach((n) => {
        if (n.face !== fit.face) return;
        const dh = (n.h - fit.h) * span;
        const du = (n.u - fit.u) * tankLatScale(e, n.face);
        const dv = (n.v - fit.v) * tankDepthScale(e);
        const d = Math.hypot(dh, du, dv);
        if (d < pickD) { pickD = d; pick = n; }
      });
      target = pick && pickD <= TANK_NOZ_MERGE ? pick : null;
      if (target) {
        const liveT = equipNozzles(e).find((n) => n.nid === target.nid);
        if (liveT && this.nozzleInUse(liveT, pipe.id)) target = null;
      }
    }
    const moved = !!target;
    const n = target
      ? setTankNozzle(e, target.nid, { face: fit.face, h: fit.h, u: fit.u, v: fit.v, pipe: pipe.id })
      : addTankNozzle(e, {
        face: fit.face, h: fit.h, u: fit.u, v: fit.v, pipe: pipe.id,
        bore: BORES[pipe.bore] ? pipe.bore : this.cmdBore,
      });
    if (!n) return null;
    const live = equipNozzles(e).find((x) => x.nid === n.nid);
    if (!live) return null;
    // 맞춘 노즐의 플랜지 면에 배관 끝을 앉힌다 — 배관은 벽 쪽으로 몇 cm 늘어난다.
    pipe.points[i] = { x: live.tip.x, y: Math.max(0, live.tip.y), z: live.tip.z };
    const hyd = TANK_TYPE_LABELS[e.type] || '탱크';
    const faceL = TANK_NOZ_FACE_LABELS[fit.face];
    return {
      spec: e,
      nozzle: n,
      face: fit.face,
      moved,
      bore: n.bore,
      y: live.tip.y,
      text: moved
        ? `📍 ${hyd} ${faceL} 노즐을 배관 높이(${fmt(live.tip.y)}m)에 맞췄어요`
        : `📍 ${hyd} ${faceL}에 새 노즐(${n.bore})을 뽑아 배관 높이(${fmt(live.tip.y)}m)에 맞췄어요`,
    };
  }

  // 탱크 벽면 맞춤의 전제 — 그 탱크 몸체 가로 위치가 점에서 0.4m 안인가.
  // (tankWallFit의 윗면·바닥면은 가로 거리를 안 따져서 멀리서도 맞음이 될 수 있다)
  tankNearPoint(tank, p, fit) {
    const f = fit || tankWallFit(tank, p, TANK_FIT_DIST);
    if (!f || !f.local) return false;
    let G;
    try { G = tankDims(tank); } catch (err) { return true; }
    if (!G) return true;
    const lx = f.local.x;
    const lz = f.local.z;
    const hd = G.box
      ? Math.hypot(Math.max(0, Math.abs(lx) - G.halfX), Math.max(0, Math.abs(lz) - G.halfZ))
      : Math.max(0, Math.hypot(lx, lz) - G.R);
    return hd <= 0.4;
  }

  // ── 정렬 안내선 (이동할 때 나란히 맞추기) ───────────────────────────────
  // 다른 장비의 중심 X·Z(또는 노즐 축)에서 150mm 안으로 들어오면 그 축에 딱 붙이고,
  // 바닥에 밝은 점선(하늘색)을 띄워 '나란히 정렬됐다'는 걸 눈으로 확인하게 한다.
  // 이동 중인 장비 아래에는 주황 십자선을 비춘다. (2026-11-26 사용자 요청: 배관은 각이 중요)
  setupAlignGuides() {
    if (this.alignGroup) return;
    const g = new THREE.Group();
    g.renderOrder = 5;
    const mk = (color, opacity) => {
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      const mat = new THREE.LineDashedMaterial({
        color, dashSize: 0.16, gapSize: 0.1, transparent: true, opacity, depthTest: false,
      });
      const line = new THREE.Line(geo, mat);
      line.renderOrder = 7;
      line.visible = false;
      line.frustumCulled = false;
      g.add(line);
      return line;
    };
    this.alignX = mk(0x7fe3ff, 0.95);   // X축 정렬 — Z 방향으로 길게
    this.alignZ = mk(0x7fe3ff, 0.95);   // Z축 정렬 — X 방향으로 길게
    this.crossX = mk(0xf5a623, 0.75);   // 이동 중인 장비 아래 십자선
    this.crossZ = mk(0xf5a623, 0.75);
    this.alignGroup = g;
    this.scene.add(g);
  }

  setGuideLine(line, a, b) {
    if (!line) return;
    const pos = line.geometry.attributes.position;
    pos.setXYZ(0, a.x, a.y, a.z);
    pos.setXYZ(1, b.x, b.y, b.z);
    pos.needsUpdate = true;
    line.geometry.computeBoundingSphere();
    line.computeLineDistances();
    line.visible = true;
  }

  // 150mm 안에서 가장 가까운 다른 장비의 X·Z에 스냅 — 없으면 그대로.
  alignSnapFor(spec, x, z) {
    const RANGE = 0.15;
    let sx = x;
    let sz = z;
    let hitX = null;
    let hitZ = null;
    let bx = RANGE;
    let bz = RANGE;
    this.state.equipment.forEach((e) => {
      if (!e || !spec || e.id === spec.id) return;
      if (!ON_FLOOR_TYPES.has(e.type)) return;   // 바닥에 놓인 장비끼리 나란히
      const dx = Math.abs(e.x - x);
      if (dx <= bx) { bx = dx; sx = e.x; hitX = e; }
      const dz = Math.abs(e.z - z);
      if (dz <= bz) { bz = dz; sz = e.z; hitZ = e; }
    });
    return { x: sx, z: sz, hitX, hitZ };
  }

  // ── 접합면 자석 스냅 — 드래그로 끌어다 놓으면 근처 접합면에 0mm로 붙는다 ──────
  // 2026-11-25 `31599` 캡처: "방향 틀고 드래그 해서 붙이려고 해도 안붙어"
  //  · 내 접합면(플랜지 면·노즐 끝·티 포트·엘보 두 끝) 중 가장 가까운 짝을 찾아
  //    그 면끼리 정확히 포갠다(x·y·z 모두 이동 — 바닥 드래그에서도 높이가 맞춰진다).
  //  · 마주 보는 면(축이 반대)을 우선하고, 거리 0.25m 안만 후보로 본다.
  portSnapFor(spec, nx, ny, nz) {
    const RANGE = 0.25;
    const mine = this.equipPortsOf(spec);
    if (!mine.length) return null;
    const dx = nx - (Number(spec.x) || 0);
    const dy = ny - (Number(spec.y) || 0);
    const dz = nz - (Number(spec.z) || 0);
    const cands = [];
    this.state.equipment.forEach((e) => {
      if (!e || e.id === spec.id) return;
      this.equipPortsOf(e).forEach((p) => cands.push(p));
    });
    this.state.pipes.forEach((pp) => {
      const pts = pp.points || [];
      if (pts.length < 2) return;
      const a = pts[0];
      const b = pts[1];
      const z0 = pts[pts.length - 2];
      const z1 = pts[pts.length - 1];
      const l1 = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) || 1;
      const l2 = Math.hypot(z1.x - z0.x, z1.y - z0.y, z1.z - z0.z) || 1;
      cands.push({ tip: a, axis: { x: (a.x - b.x) / l1, y: (a.y - b.y) / l1, z: (a.z - b.z) / l1 }, label: `${pp.name || '배관'} 시작` });
      cands.push({ tip: z1, axis: { x: (z1.x - z0.x) / l2, y: (z1.y - z0.y) / l2, z: (z1.z - z0.z) / l2 }, label: `${pp.name || '배관'} 끝` });
    });
    if (!cands.length) return null;
    let best = null;
    mine.forEach((m) => {
      const tip = { x: m.tip.x + dx, y: m.tip.y + dy, z: m.tip.z + dz };
      cands.forEach((c) => {
        const d = Math.hypot(tip.x - c.tip.x, tip.y - c.tip.y, tip.z - c.tip.z);
        if (d > RANGE) return;
        const ma = m.axis || { x: 0, y: 0, z: 0 };
        const ca = c.axis || { x: 0, y: 0, z: 0 };
        const dot = ma.x * ca.x + ma.y * ca.y + ma.z * ca.z;
        // 마주 보고 있을 때(축이 반대)를 우선 — 거리만 보면 옆면 위로 붙는 일이 생긴다.
        const score = d + (dot > -0.3 ? 0.08 : 0);
        if (!best || score < best.score) {
          best = {
            score, d, dot, label: c.label || '',
            x: r3(nx + (c.tip.x - tip.x)),
            y: Math.max(0, r3(ny + (c.tip.y - tip.y))),
            z: r3(nz + (c.tip.z - tip.z)),
          };
        }
      });
    });
    return best;
  }

  // 부속의 접합면 목록 — 티는 세 포트, 엘보는 두 다리 끝면, 나머지는 equipPorts(플랜지 면·노즐).
  equipPortsOf(spec) {
    if (!spec || !spec.type) return [];
    const out = equipPorts(spec).map((n) => ({ tip: n.tip, axis: n.axis, label: n.label || '' }));
    if (spec.type === 'elbow' || spec.type === 'elbow45') {
      const b = equipBasis(spec);
      const dims = elbowDims(spec.type, spec.bore || spec.bore1);
      [0, 1].forEach((i) => {
        const ax = { x: b[i], y: b[3 + i], z: b[6 + i] };
        out.push({
          tip: { x: r3(spec.x + ax.x * dims.face), y: r3(Math.max(0, spec.y + ax.y * dims.face)), z: r3(spec.z + ax.z * dims.face) },
          axis: ax,
          label: i === 0 ? '입구' : '출구',
        });
      });
    }
    return out;
  }

  showAlignGuides(x, z, snap) {
    this.setupAlignGuides();
    const y = 0.02;
    this.setGuideLine(this.crossX, { x: x - 1.1, y, z }, { x: x + 1.1, y, z });
    this.setGuideLine(this.crossZ, { x, y, z: z - 1.1 }, { x, y, z: z + 1.1 });
    if (snap && snap.hitX) {
      const z0 = Math.min(snap.hitX.z, z) - 0.9;
      const z1 = Math.max(snap.hitX.z, z) + 0.9;
      this.setGuideLine(this.alignX, { x: snap.x, y: y + 0.002, z: z0 }, { x: snap.x, y: y + 0.002, z: z1 });
    } else if (this.alignX) this.alignX.visible = false;
    if (snap && snap.hitZ) {
      const x0 = Math.min(snap.hitZ.x, x) - 0.9;
      const x1 = Math.max(snap.hitZ.x, x) + 0.9;
      this.setGuideLine(this.alignZ, { x: x0, y: y + 0.002, z: snap.z }, { x: x1, y: y + 0.002, z: snap.z });
    } else if (this.alignZ) this.alignZ.visible = false;
  }

  hideAlignGuides(delay) {
    if (this.alignTimer) clearTimeout(this.alignTimer);
    const off = () => {
      [this.alignX, this.alignZ, this.crossX, this.crossZ].forEach((l) => { if (l) l.visible = false; });
    };
    if (delay) this.alignTimer = setTimeout(off, delay);
    else off();
  }

  // ── 3축 정렬 가이드 (v76) ──────────────────────────────────────────────
  // 사용자(2026-11-27): "위 배관 끝과 아래 배관 끝의 길이·거리·높이를 맞출 때 정렬 여부를
  // 한눈에 볼 수 있게" — 손그리기 끝점·옮긴 배관 끝·부속 중심이 기존 배관 끝·엘보 중심·
  // 노즐 끝·장비 중심과 X(거리)·Y(높이)·Z(길이) 중 하나라도 25mm 안으로 오면,
  // 그 좌표를 정확히 스냅하고 두 점을 잇는 **밝은 점선**과 `정렬` 표시를 띄운다.
  setupAlign3D() {
    if (this.align3DGroup) return;
    const g = new THREE.Group();
    g.renderOrder = 6;
    const mk = (color, opacity) => {
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      const mat = new THREE.LineDashedMaterial({
        color, dashSize: 0.07, gapSize: 0.05, transparent: true, opacity, depthTest: false,
      });
      const line = new THREE.Line(geo, mat);
      line.renderOrder = 8;
      line.visible = false;
      line.frustumCulled = false;
      g.add(line);
      return line;
    };
    // X·Y·Z 세 축에 하나씩 — 밝은 하늘색 점선
    this.align3DLines = [mk(0xc8f4ff, 1), mk(0xc8f4ff, 1), mk(0xc8f4ff, 1)];
    this.align3DGroup = g;
    this.scene.add(g);
  }

  // 정렬 기준점 — 배관 양 끝, 장비 중심, 장비 노즐 끝, 부속 접합면(엘보 두 끝·티 3포트·밸브 면).
  alignRefPoints(exclude) {
    const out = [];
    const ex = exclude instanceof Set ? exclude : new Set(exclude || []);
    (this.state.pipes || []).forEach((p) => {
      const q = p.points || [];
      if (q.length < 2) return;
      if (ex.has(p.id)) return;
      out.push({ p: q[0], label: `${p.name} 시작` });
      out.push({ p: q[q.length - 1], label: `${p.name} 끝` });
    });
    (this.state.equipment || []).forEach((e) => {
      if (ex.has(e.id)) return;
      const c = { x: Number(e.x) || 0, y: Number(e.y) || 0, z: Number(e.z) || 0 };
      out.push({ p: c, label: `${e.name} 중심` });
      equipNozzles(e).forEach((n) => { if (n && n.tip) out.push({ p: n.tip, label: `${e.name} 노즐` }); });
      equipConnectFaces(e).forEach((n) => { if (n && n.tip) out.push({ p: n.tip, label: `${e.name} 접합면` }); });
    });
    return out;
  }

  // p에서 정렬되는 기준점을 찾는다.
  //  · axis — 한 축으로 그리는/늘이는 중이면 그 축만 맞춘다(그 축의 좌표만 바뀌므로).
  //    이때 그 축 말고 다른 축 하나가 1.2m 안에 있으면 된다 — 높이나 거리가 다른
  //    두 나란한 배관의 끝 길이를 맞추는 것이 바로 이 경우다.
  //  · axis를 주지 않으면 X·Y·Z 셋을 모두 본다(이동).
  align3DProbe(p, opts) {
    const o = opts || {};
    const tol = o.tol == null ? 0.025 : o.tol;
    const refs = o.refs || this.alignRefPoints(o.exclude);
    if (!refs.length) return null;
    const ALL = ['x', 'y', 'z'];
    const axes = ALL.indexOf(o.axis) >= 0 ? [o.axis] : ALL;
    const hits = [];
    const same = (r) => Math.hypot(r.p.x - p.x, r.p.y - p.y, r.p.z - p.z) < 0.02;
    axes.forEach((ax) => {
      const others = ALL.filter((a) => a !== ax);
      let best = null;
      refs.forEach((r) => {
        if (same(r)) return;
        const d = Math.abs(r.p[ax] - p[ax]);
        if (d > tol || d < 0.001) return;
        if (!others.some((a) => Math.abs(r.p[a] - p[a]) <= 1.2)) return;
        if (!best || d < best.d) best = { axis: ax, d, ref: r };
      });
      if (best) hits.push(best);
    });
    if (!hits.length) return null;
    const q = { x: p.x, y: p.y, z: p.z };
    hits.forEach((h) => { q[h.axis] = h.ref.p[h.axis]; });
    return { p: q, hits, dist: Math.max(...hits.map((h) => h.d)) };
  }

  alignAxesText(hits) {
    return (hits || []).map((h) => (h.axis === 'x' ? '거리 X' : h.axis === 'y' ? '높이 Y' : '길이 Z')).join(' · ');
  }

  // 점선과 `정렬` 배지를 띄운다 — from은 지금 잡고 있는 점, probe는 align3DProbe 결과.
  showAlign3D(from, probe) {
    this.setupAlign3D();
    const lines = this.align3DLines || [];
    lines.forEach((l) => { l.visible = false; });
    const el = $('#alignBadge');
    if (!probe || !probe.hits || !probe.hits.length) {
      if (el) el.hidden = true;
      this.alignBadgeAt = null;
      return;
    }
    // 새로 띄우는 중이면 예전 자동 숨김 타이머를 끈다 — 드래그하는 동안 꺼지지 않게 (v77).
    if (this.alignHideTimer) { clearTimeout(this.alignHideTimer); this.alignHideTimer = 0; }
    probe.hits.slice(0, 3).forEach((h, i) => {
      const line = lines[i];
      // h.from이 있으면 그 점에서 긋는다 — 여러 끝점이 서로 다른 기준에 맞을 때 (v77).
      if (line) this.setGuideLine(line, h.from || from, h.ref.p);
    });
    if (el) {
      el.textContent = `정렬 · ${this.alignAxesText(probe.hits)}`;
      el.hidden = false;
      this.alignBadgeAt = { x: probe.p.x, y: probe.p.y, z: probe.p.z };
      this.placeAlignBadge();
    }
  }

  placeAlignBadge() {
    const el = $('#alignBadge');
    const p = this.alignBadgeAt;
    if (!el || !p || el.hidden) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const v = this.alignBadgeV || (this.alignBadgeV = new THREE.Vector3());
    v.set(p.x, p.y, p.z).project(this.camera);
    if (v.z > 1 || v.z < -1) { el.hidden = true; return; }
    const sx = (v.x * 0.5 + 0.5) * rect.width;
    const sy = (-v.y * 0.5 + 0.5) * rect.height;
    el.style.left = `${Math.round(sx)}px`;
    el.style.top = `${Math.round(sy - 14)}px`;
  }

  hideAlign3D() {
    (this.align3DLines || []).forEach((l) => { l.visible = false; });
    const el = $('#alignBadge');
    if (el) el.hidden = true;
    this.alignBadgeAt = null;
    if (this.alignHideTimer) { clearTimeout(this.alignHideTimer); this.alignHideTimer = 0; }
  }

  // 이동·길이조절 뒤에는 잠시만 보여 준다 — 점선·배지가 계속 3D 시야에 남지 않게.
  autoHideAlign3D(ms) {
    if (this.alignHideTimer) clearTimeout(this.alignHideTimer);
    this.alignHideTimer = setTimeout(() => {
      this.alignHideTimer = 0;
      this.hideAlign3D();
    }, ms || 1800);
  }

  // 길이 조절(치수 창)용 — 새로 넣은 mm로 뻗은 끝점이 다른 배관 끝·엘보 중심·노즐과
  // 30mm 안에서 길이 방향(X·Y·Z 중 하나)이 맞으면 그 좌표의 길이로 딱 맞춘다(v76).
  // 돌려주는 값: { mm, probe, p } — p는 맞춘 뒤의 끝점 좌표.
  alignSnapLength(a, u, mm, exclude) {
    if (!a || !u || !(mm > 0)) return null;
    const ax = Math.abs(u.x) >= Math.abs(u.y) && Math.abs(u.x) >= Math.abs(u.z) ? 'x'
      : (Math.abs(u.z) >= Math.abs(u.y) ? 'z' : 'y');
    const L = mm / 1000;
    const p2 = { x: a.x + u.x * L, y: a.y + u.y * L, z: a.z + u.z * L };
    const probe = this.align3DProbe(p2, { axis: ax, tol: 0.03, exclude });
    if (!probe) return null;
    const h = probe.hits[0];
    const len = (h.ref.p[ax] - a[ax]) * (u[ax] < 0 ? -1 : 1);
    const mm2 = Math.round(len * 1000);
    if (!(mm2 >= 50 && mm2 <= 100000)) return null;
    return { mm: mm2, probe, p: { x: a.x + u.x * (len), y: a.y + u.y * (len), z: a.z + u.z * (len) } };
  }

  // 버튼 이동(10·50·100·500·1000mm) 뒤 — 누른 보폭 **그대로** 둔 채, 옮긴 끝이 다른 기준점과
  // 15mm 안으로 맞았는지만 밝은 점선과 `정렬` 배지로 알려 준다.
  // (v77 — 2026-11-27 사용자 "다른곳에 정렬하더니 배관을 가져가버리네": 예전 alignSnapMoved는
  //  ±30mm 안이면 X·Y·Z 어느 축이든 좌표를 끌어당겨, +10mm를 눌렀는데 배관이 다른 자리로
  //  튀었다. 이제 버튼 이동은 절대 좌표를 바꾸지 않는다 — 보여 주기만 한다.)
  alignShowMoved(items, tolMm) {
    const list = items || [];
    if (!list.length) return null;
    const tol = (tolMm == null ? 15 : tolMm) / 1000;
    const moving = new Set(list.map((it) => (it.spec || it).id));
    const refs = this.alignRefPoints(moving);
    if (!refs.length) return null;
    const pts = [];
    list.forEach((it) => {
      const spec = it.spec || it;
      if (!spec) return;
      if (Array.isArray(spec.points) && spec.points.length >= 2) {
        pts.push(spec.points[0], spec.points[spec.points.length - 1]);
        return;
      }
      pts.push({ x: Number(spec.x) || 0, y: Number(spec.y) || 0, z: Number(spec.z) || 0 });
      equipPorts(spec).forEach((n) => { if (n && n.tip) pts.push(n.tip); });
    });
    const hits = [];
    const seen = new Set();
    pts.forEach((q) => {
      if (!q) return;
      const probe = this.align3DProbe(q, { refs, tol });
      if (!probe) return;
      probe.hits.forEach((h) => {
        const key = `${h.axis}:${h.ref.label}:${h.ref.p.x.toFixed(2)}:${h.ref.p.y.toFixed(2)}:${h.ref.p.z.toFixed(2)}`;
        if (seen.has(key)) return;
        seen.add(key);
        hits.push({ ...h, from: { x: q.x, y: q.y, z: q.z } });
      });
    });
    if (!hits.length) return null;
    hits.sort((a, b) => a.d - b.d);
    const top = hits.slice(0, 3);
    const best = top[0];
    return {
      from: { x: best.from.x, y: best.from.y, z: best.from.z },
      probe: { p: { x: best.from.x, y: best.from.y, z: best.from.z }, hits: top, dist: best.d },
      txt: this.alignAxesText(top),
    };
  }

  // ── ✨ 드래그 중 3축 정렬 (v77) ────────────────────────────────────────
  // 사용자(2026-11-27): "드래그 할때 떠야 그 위치를 잡지" / "정렬선만 표시 해주고" —
  // 배관·여러 개를 손가락으로 끌고 있는 동안, 옮기는 배관의 양 끝(부속·장비는 중심·노즐 끝)이
  // 다른 배관 끝·엘보 중심·노즐과 X(거리)·Z(길이) 45mm 안으로 오면 밝은 점선과 `정렬` 배지를
  // 실시간으로 띄운다. 바닥 드래그는 높이가 바뀌지 않으므로 X·Z만 본다.
  // 좌표는 끌어가지 않는다(snap:false로 부른다) — 움직이는 도중에 배관을 가져가면 안 된다.
  //  · 돌려주는 값 { dx, dz, from, probe } — dx·dz는 고른 것 전부에 똑같이 더할 보정.
  //  · snap:false면 좌표는 건드리지 않고 "거의 맞음"만 알려 준다(신축 드래그처럼 축에 묶인 이동).
  //  · 보정은 축별 허용치(tol, 기본 45mm)를 넘지 않고, 두 축을 합쳐도 80mm를 넘지 않는다 —
  //    손가락 밑에서 배관이 다른 곳으로 확 튀지 않게 (2026-11-27 "배관을 가져가버리네").
  alignDragSnap(items, movingIds, opts) {
    const o = opts || {};
    const list = items || [];
    if (!list.length || !this.scene) return null;
    const tol = o.tol == null ? 0.045 : o.tol;
    const snap = o.snap !== false;
    const refs = this.alignRefPoints(movingIds);
    if (!refs.length) return null;
    const pts = [];
    list.forEach((it) => {
      const spec = it.spec || it;
      if (!spec) return;
      if (Array.isArray(spec.points) && spec.points.length >= 2) {
        pts.push(spec.points[0], spec.points[spec.points.length - 1]);
        return;
      }
      // 장비·부속 — 중심과 접합면(노즐 끝) 둘 다 본다.
      pts.push({ x: Number(spec.x) || 0, y: Number(spec.y) || 0, z: Number(spec.z) || 0 });
      equipPorts(spec).forEach((n) => { if (n && n.tip) pts.push(n.tip); });
    });
    if (!pts.length) return null;
    const best = { x: null, z: null };
    pts.forEach((q) => {
      const probe = this.align3DProbe(q, { refs, tol });
      if (!probe) return;
      probe.hits.forEach((h) => {
        if (h.axis !== 'x' && h.axis !== 'z') return;   // 높이 Y는 드래그로 바꿀 수 없다
        if (!best[h.axis] || h.d < best[h.axis].h.d) best[h.axis] = { h, q };
      });
    });
    if (!best.x && !best.z) return null;
    const hits = [];
    const dx = snap && best.x ? r3(best.x.h.ref.p.x - best.x.q.x) : 0;
    const dz = snap && best.z ? r3(best.z.h.ref.p.z - best.z.q.z) : 0;
    // 두 축 보정을 합쳐도 80mm를 넘지 않는다 — 손가락에서 멀리 튀는 스냅은 하지 않는다.
    if (Math.hypot(dx, dz) > 0.08) return null;
    if (best.x) {
      const q = best.x.q;
      hits.push({ ...best.x.h, from: { x: snap ? best.x.h.ref.p.x : q.x, y: q.y, z: q.z } });
    }
    if (best.z) {
      const q = best.z.q;
      hits.push({ ...best.z.h, from: { x: q.x, y: q.y, z: snap ? best.z.h.ref.p.z : q.z } });
    }
    const anchor = (best.x || best.z).q;
    const p = { x: r3(anchor.x + dx), y: anchor.y, z: r3(anchor.z + dz) };
    return { dx, dz, from: p, probe: { p, hits, dist: Math.max(...hits.map((h) => h.d)) } };
  }

  // ── 🧲 옮긴 배관 끝 자석 (v74) ────────────────────────────────────────
  // 배관을 방향 버튼·드래그로 옮겼 때 끝점이 기존 접합면(엘보 두 끝·밸브·스트레이너·플랜지 면·
  // 티 3포트·장비 노즐·다른 배관 끝) 15cm 안에 오면, 2~3cm 틈을 남기지 않고 정확히 0.000m로 붙인다.
  // (2026-11-26 `32085` "자동으로 안붙네" — 게이트밸브 위 엘보 입구 바로 앞에서 톱이 남았다)
  //  · 고른 것이 여러 개면 모두 같은 Δ만큼 함께 밀어 서로 자리를 지킨다.
  //  · 🧲 자석을 꺼 두면 아무것도 하지 않는다.
  moveMagnetSnap(items, skipKeys) {
    if (!this.magnetSnap) return null;
    const list = items || [];
    if (!list.length) return null;
    const moving = new Set(list.map((it) => (it.spec || it).id));
    const cands = [];
    const add = (p, label, axis) => {
      if (p) cands.push({ tip: p, label, axis: axis || null });
    };
    this.state.equipment.forEach((e) => {
      equipConnectFaces(e).forEach((n) => add(n.tip, `${e.name || '부속'} ${n.label || (n.nid === 'legA' ? '입구' : n.nid === 'legB' ? '출구' : TEE_PORT_LABELS[n.nid] || '접합면')}`, n.axis));
      equipNozzles(e).forEach((n) => add(n.tip, `${e.name || '장비'} ${NOZZLE_LABELS[n.dir] || ''} 노즐`.trim(), n.axis));
    });
    this.state.pipes.forEach((p) => {
      if (moving.has(p.id)) return;
      const pts = p.points || [];
      if (pts.length < 2) return;
      add(pts[0], `${p.name || '배관'} 시작`);
      add(pts[pts.length - 1], `${p.name || '배관'} 끝`);
    });
    if (!cands.length) return null;
    let best = null;
    list.forEach((it) => {
      const spec = it.spec || it;
      const pts = spec.points || [];
      if (pts.length < 2) return;
      [0, pts.length - 1].forEach((idx) => {
        const pt = pts[idx];
        cands.forEach((c) => {
          const d = Math.hypot(pt.x - c.tip.x, pt.y - c.tip.y, pt.z - c.tip.z);
          if (d > MOVE_SNAP_DIST) return;
          // 방금 붙어 있던 면은 건너뛴다 — 한 번 붙은 뒤 보폭 이동을 계속해도
          // 그 자리로 계속 끌려 돌아가지 않게 (v74).
          if (skipKeys && skipKeys.has(magnetKey(c.tip))) return;
          if (!best || d < best.d) {
            best = { d, spec, index: idx, port: c, from: { x: pt.x, y: pt.y, z: pt.z } };
          }
        });
      });
    });
    if (!best) return null;
    const delta = {
      x: r3(best.port.tip.x - best.from.x),
      y: r3(best.port.tip.y - best.from.y),
      z: r3(best.port.tip.z - best.from.z),
    };
    // 모양은 그대로, 자리만 그 Δ만큼 — 끝점이 접합면에 정확히 앉는다(0.000m).
    list.forEach((it) => {
      const spec = it.spec || it;
      if (Array.isArray(spec.points)) {
        spec.points.forEach((q) => {
          q.x = r3(q.x + delta.x);
          q.y = Math.max(0, r3(q.y + delta.y));
          q.z = r3(q.z + delta.z);
        });
        return;
      }
      spec.x = r3((Number(spec.x) || 0) + delta.x);
      spec.y = Math.max(0, r3((Number(spec.y) || 0) + delta.y));
      spec.z = r3((Number(spec.z) || 0) + delta.z);
    });
    return { ...best, delta };
  }

  // 지금 배관 끝이 정확히 얹혀 있는 접합면 키 — 보폭 이동에서 같은 면으로 계속 끌려가지 않게.
  magnetContactKeys(items) {
    const keys = new Set();
    const list = items || [];
    const ends = [];
    list.forEach((it) => {
      const spec = it.spec || it;
      const pts = spec.points || [];
      if (pts.length < 2) return;
      ends.push(pts[0], pts[pts.length - 1]);
    });
    if (!ends.length) return keys;
    const tips = [];
    this.state.equipment.forEach((e) => {
      equipConnectFaces(e).forEach((n) => { if (n.tip) tips.push(n.tip); });
      equipNozzles(e).forEach((n) => { if (n.tip) tips.push(n.tip); });
    });
    this.state.pipes.forEach((p) => {
      const pts = p.points || [];
      if (pts.length < 2) return;
      tips.push(pts[0], pts[pts.length - 1]);
    });
    ends.forEach((pt) => {
      tips.forEach((t) => {
        if (Math.hypot(pt.x - t.x, pt.y - t.y, pt.z - t.z) < 0.002) keys.add(magnetKey(t));
      });
    });
    return keys;
  }

  setMagnetSnap(on, quiet) {
    this.magnetSnap = !!on;
    try { localStorage.setItem('smilePiping3D.magnet', this.magnetSnap ? 'on' : 'off'); } catch (e) { /* ignore */ }
    this.renderProps();
    if (!quiet) {
      this.toast(this.magnetSnap
        ? '🧲 자석 켜짐 — 옮긴 배관 끝이 접합면 15cm 안에 오면 0.000m로 붙습니다.'
        : '🧲 자석 꺼짐 — 옮긴 자리에 그대로 둡니다.');
    }
  }

  // ── 🔗 이어붙이기 (v74) ──────────────────────────────────────────────
  // 고른 **정확히 2개**의 접속구(배관 양 끝점·엘보 양 끝면·티 3포트·밸브/플랜지 양 면·장비 노즐 끝)
  // 중 가장 가까운 짝을 찾아 0.000m로 딱 붙인다.
  //  · 배관 + 무엇이든: 배관의 그 끝점을 상대 접속구 좌표로 옮긴다(곧게 이어지면 축 연장,
  //    어긋나 있으면 90° 꺾임 + 엘보를 세워 자연스럽게 잇는다).
  //  · 부속/장비 + 부속/장비: 두 번째를 (pA − pB)만큼 통째로 밀어 면을 맞닫는다.
  joinSelectedPair() {
    const items = this.selectedSpecs();
    if (items.length !== 2) {
      this.toast('두 개를 골라야 이어 붙일 수 있습니다.', { type: 'err' });
      return;
    }
    const a = items[0].spec;
    const b = items[1].spec;
    const endsOf = (spec) => {
      if (Array.isArray(spec.points)) {
        const pts = spec.points;
        if (pts.length < 2) return [];
        return [
          { isPipe: true, spec, idx: 0, tip: pts[0], other: pts[1] },
          { isPipe: true, spec, idx: pts.length - 1, tip: pts[pts.length - 1], other: pts[pts.length - 2] },
        ];
      }
      return this.equipPortsOf(spec).map((n) => ({ isPipe: false, spec, tip: n.tip, axis: n.axis, label: n.label }));
    };
    const ea = endsOf(a);
    const eb = endsOf(b);
    if (!ea.length || !eb.length) {
      this.toast('이어 붙일 접속구를 찾지 못했습니다.', { type: 'err' });
      return;
    }
    let best = null;
    ea.forEach((x) => eb.forEach((y) => {
      const d = Math.hypot(x.tip.x - y.tip.x, x.tip.y - y.tip.y, x.tip.z - y.tip.z);
      if (!best || d < best.d) best = { d, x, y };
    }));
    if (!best) return;
    this.pushUndo('🔗 이어붙이기');
    const aPipe = Array.isArray(a.points);
    const bPipe = Array.isArray(b.points);
    if (aPipe && bPipe) {
      // 배관 + 배관 — 가까운 틈(0.5m 이내)이고 거의 같은 축이면 그 끝만 늘려/줄여 잇고,
      // 멀거나 방향이 어긋나 있으면 두 번째 배관을 통째로 밀어 끝점끼리 0.000m로 맞닫는다.
      const near = best.d <= 0.5 && (this.endAligned(best.x, best.y.tip) || this.endAligned(best.y, best.x.tip));
      if (near) {
        if (best.d > 1e-4) this.joinPipeEndTo(best.x, { x: best.y.tip.x, y: best.y.tip.y, z: best.y.tip.z });
      } else {
        this.moveSpecBy(b, best.x.tip.x - best.y.tip.x, best.x.tip.y - best.y.tip.y, best.x.tip.z - best.y.tip.z);
      }
    } else if (aPipe) {
      const t = { x: r3(best.y.tip.x), y: Math.max(0, r3(best.y.tip.y)), z: r3(best.y.tip.z) };
      this.joinPipeEndTo(best.x, t);
    } else if (bPipe) {
      const t = { x: r3(best.x.tip.x), y: Math.max(0, r3(best.x.tip.y)), z: r3(best.x.tip.z) };
      this.joinPipeEndTo(best.y, t);
    } else {
      // 둘 다 배관이 아니면 B를 통째로 밀어 두 면을 포갠다.
      this.moveSpecBy(b, best.x.tip.x - best.y.tip.x, best.x.tip.y - best.y.tip.y, best.x.tip.z - best.y.tip.z);
    }
    this.rebuild();
    const nm = `${a.name} ↔ ${b.name}`;
    this.toast(`🔗 두 개를 이어 붙였어요 · ${nm} · 0.0mm`, {
      action: '되돌리기', onAction: () => this.undo(),
    });
  }

  // 배관 끝이 target 쪽으로 거의 곧게 뻗어 있는가 — 끝점만 늘리면 직선이 유지되는지.
  endAligned(end, target) {
    const a = unit2(end.tip, end.other);
    const b = unit2(end.tip, target);
    return Math.abs(a.x * b.x + a.y * b.y + a.z * b.z) > 0.98;
  }

  // ── ✂️ 배관 중간에 끼워넣기 (v75) ──────────────────────────────────────
  // 배관을 고른 채 부속·밸브를 넣으면 그 배관을 가운데(또는 지정 지점)에서 둘로 나누고,
  // 고른 부속을 같은 관경·같은 축으로 가운데에 앉힌다 — 양쪽 배관 끝이 접합면에 0.000m로 닿는다.
  // 실행취소 한 번이면 나뉘기 전 배관 1개로 그대로 돌아간다.
  openInsertPicker() {
    const spec = this.getSelectedSpec();
    if (!spec || !Array.isArray(spec.points)) {
      this.toast('먼저 끼워넣을 배관을 고르세요.', { type: 'err' });
      return;
    }
    const total = pipeLength(spec.points);
    const mid = Math.round(total * 500);   // 가운데(mm)
    const chips = INSERT_GROUPS.map((g) => `
        <div class="prop-section">${g.label}</div>
        <div class="noz-presets">
          ${g.items.map((it) => `<button class="noz-chip" data-ins="${it.type}"
            title="${esc(it.hint || '')}">${esc(it.label)}</button>`).join('')}
        </div>`).join('');
    this.openModal({
      title: '✂️ 배관 중간에 끼워넣기',
      body: `
        <p class="hint">${esc(spec.name)} · ${esc(spec.bore)} · ${fmt(total)}m 배관을 둘로 나누고,
          고른 부속·밸브를 <b>같은 관경·같은 축</b>으로 끼워 넣습니다(양쪽 틈 0.0mm).</p>
        <label class="field">자를 위치 — 시작점에서 몇 mm
          <input type="number" id="insAt" min="0" step="50" placeholder="${mid}">
        </label>
        <p class="hint">비워 두면 가운데(${mid}mm)에서 자릅니다. 양쪽 배관은 50mm 이상 남습니다.</p>
        ${chips}
        <p class="hint">넣은 뒤 <b>↔️ 위치 이동</b>·<b>✋ 드래그 이동</b>으로 배관 축 방향으로 옮기면
          양쪽 배관 길이가 자동으로 늘고 줄어 틈이 생기지 않습니다.</p>`,
      actions: [{ label: '취소', cls: 'ghost' }],
    });
    const root = $('#modalBody');
    if (root) {
      root.querySelectorAll('[data-ins]').forEach((b) => b.addEventListener('click', () => {
        const at = Number($('#insAt').value);
        this.closeModal();
        this.insertIntoPipe(b.dataset.ins, Number.isFinite(at) && at > 0 ? at : null);
      }));
    }
  }

  // 배관 하나를 둘로 나누고 그 가운데에 부속을 앉힌다 — atMm은 시작점에서 잰 자를 위치(mm).
  insertIntoPipe(type, atMm) {
    const pipe = this.getSelectedSpec();
    const t = EQUIP_TYPES[type];
    if (!pipe || !Array.isArray(pipe.points) || pipe.points.length < 2 || !t) return;
    const pts = pipe.points;
    const total = pipeLength(pts);
    const bore = BORES[pipe.bore] ? pipe.bore : '100A';
    // 레듀샤는 본관 관경에서 한 단계 작은 관경으로 줄인다(이경 티는 속성 패널에서 분기 관경을 고른다).
    const bi = BORE_KEYS.indexOf(bore);
    const smallBore = BORE_KEYS[Math.max(0, bi - 1)] || bore;
    const bore2 = type === 'reducer' ? smallBore : bore;
    // 부속을 먼저 만들어 면간 폭(span)을 잰다 — 배관·부속이 같은 표를 쓰므로 그 폭이 곧 접합면 사이 거리다.
    const same = this.state.equipment.filter((e) => e.type === type).length;
    const fit = makeEquipment(type, {
      name: `${t.short}-${100 + same + 1} ${t.label}`,
      x: 0, y: 0, z: 0, bore, bore1: bore, bore2, conn: 'flange', dir: [1, 0, 0],
    });
    const span = Math.abs(Number(fit.w) || 0);
    const half = span / 2;
    const need = span + INSERT_MIN_SIDE * 2;
    // 자를 변(segment)을 고른다 — 지정 지점이 있는 변을 우선하고, 그 변이 부속보다 짧으면
    // 부속이 들어가는 가장 가까운 변을 고른다. 접합면이 꺾임점 밖으로 나가지 않게 하려는 것이다.
    const segs = [];
    let accAll = 0;
    for (let i = 0; i < pts.length - 1; i += 1) {
      const a0 = pts[i];
      const b0 = pts[i + 1];
      const L0 = Math.hypot(b0.x - a0.x, b0.y - a0.y, b0.z - a0.z);
      segs.push({ i, a: a0, b: b0, L: L0, acc: accAll });
      accAll += L0;
    }
    const longest = segs.reduce((m, g) => Math.max(m, g.L), 0);
    if (longest < need - 1e-9) {
      this.toast(`${t.label}(면간 ${Math.round(span * 1000)}mm)를 넣기에는 배관이 짧습니다 — 한 구간이 ${Math.round(need * 1000)}mm 이상이어야 합니다.`, { type: 'err' });
      return;
    }
    // 자를 자리 — 지정 지점(없으면 가운데), 양쪽에 최소 50mm가 남게만 밀어 준다.
    const want = atMm != null && atMm > 0 ? atMm / 1000 : total / 2;
    const room = segs.filter((g) => g.L >= need - 1e-9);
    const here = room.find((g) => want >= g.acc - 1e-9 && want <= g.acc + g.L + 1e-9);
    const seg = here || room.slice().sort((p, q) =>
      Math.abs(p.acc + p.L / 2 - want) - Math.abs(q.acc + q.L / 2 - want))[0];
    const s = Math.min(Math.max(want, seg.acc + half + INSERT_MIN_SIDE), seg.acc + seg.L - half - INSERT_MIN_SIDE);
    const tt = Math.min(1, Math.max(0, (s - seg.acc) / (seg.L || 1)));
    const a = seg.a;
    const b = seg.b;
    const L = seg.L || 1;
    const ax = { x: (b.x - a.x) / L, y: (b.y - a.y) / L, z: (b.z - a.z) / L };
    const c = { x: a.x + (b.x - a.x) * tt, y: a.y + (b.y - a.y) * tt, z: a.z + (b.z - a.z) * tt };
    const at = (v) => ({ x: r3(c.x + ax.x * v), y: Math.max(0, r3(c.y + ax.y * v)), z: r3(c.z + ax.z * v) });
    // 부속을 먼저 제자리에 앉힌 뒤, **부속이 실제로 내놓는 접합면 좌표**를 그대로 받아
    // 배관 끝을 맞춘다 — 경사진 배관에서도 0.001m 반올림 틈이 생기지 않는다.
    fit.x = r3(c.x);
    fit.y = Math.max(0, r3(c.y));
    fit.z = r3(c.z);
    fit.dir = [r3(ax.x), r3(ax.y), r3(ax.z)];
    const faces0 = equipConnectFaces(fit);
    const dotAx = (f) => f.axis.x * ax.x + f.axis.y * ax.y + f.axis.z * ax.z;
    const faceL = faces0.filter((f) => dotAx(f) < 0).sort((p2, q2) => dotAx(p2) - dotAx(q2))[0];
    const faceR = faces0.filter((f) => dotAx(f) > 0).sort((p2, q2) => dotAx(q2) - dotAx(p2))[0];
    const leftEnd = faceL ? { ...faceL.tip } : at(-half);     // 왼쪽 배관이 끝나는 접합면
    const rightEnd = faceR ? { ...faceR.tip } : at(half);     // 오른쪽 배관이 시작하는 접합면
    const near = (p, q) => Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) < 1e-6;
    const segIdx = seg.i;
    // 왼쪽 배관 — 자른 점 앞까지 + 왼쪽 접합면에서 끝
    const leftPts = [];
    for (let k = 0; k <= segIdx; k += 1) {
      if (tt <= 1e-9 && k === segIdx) break;   // 자른 자리가 꼭짓점 위면 그 점은 오른쪽 배관이 갖는다
      leftPts.push({ ...pts[k] });
    }
    if (!leftPts.length || !near(leftPts[leftPts.length - 1], leftEnd)) leftPts.push({ ...leftEnd });
    // 오른쪽 배관 — 오른쪽 접합면에서 시작해 나머지 점으로
    const rightPts = [{ ...rightEnd }];
    for (let k = (tt >= 1 - 1e-9 ? segIdx + 2 : segIdx + 1); k < pts.length; k += 1) {
      if (near(rightPts[rightPts.length - 1], pts[k])) continue;
      rightPts.push({ ...pts[k] });
    }
    if (leftPts.length < 2 || rightPts.length < 2) {
      this.toast('그 자리에서는 배관을 나눌 수 없습니다 — 다른 위치(mm)를 넣어 보세요.', { type: 'err' });
      return;
    }
    this.pushUndo(`${t.label} 중간 끼워넣기`);
    pipe.points = leftPts;
    // 레듀샤는 뒤쪽 배관 관경도 줄인다 — 큰 관경에서 작은 관경으로 넘어가는 부속이다.
    const right = makePipe({
      name: `${pipe.name} (우측)`,
      bore: type === 'reducer' ? smallBore : pipe.bore,
      material: pipe.material,
      conn: pipe.conn,
      points: rightPts,
      ...(pipe.color ? { color: pipe.color } : {}),
    });
    this.state.pipes.push(right);
    this.state.equipment.push(fit);
    // 이어 그리기·조이스틱도 같은 사이즈로 이어지게 현재 관경을 맞춰 둔다 (v76).
    if (BORES[bore]) this.setCmdBore(bore, true);
    this.lastAdded = { kind: 'equipment', id: fit.id };
    this.selection = { kind: 'equipment', id: fit.id };
    this.multiSel = [];
    this.multiMode = false;
    this.rebuild();
    const l1 = pipeLength(leftPts);
    const l2 = pipeLength(rightPts);
    this.toast(`✂️ ${t.label}을(를) ${pipe.name} 중간에 끼워넣었습니다 · 좌 ${fmt(l1)}m + 우 ${fmt(l2)}m · 틈 0.0mm`,
      { action: '되돌리기', onAction: () => this.undo() });
  }

  // ── 끼워넣은 부속·밸브를 옮기면 양쪽 배관 길이가 따라온다 (v75) ──────────────
  // 부속의 접합면에 0.000m로 마주 닿은 배관 끝을 찾는다 — 그 끝들이 부속을 따라 움직인다.
  stretchPartners(spec) {
    if (!spec || Array.isArray(spec.points) || !spec.type) return [];
    const faces = equipConnectFaces(spec);
    if (!faces.length) return [];
    const tol = 0.004;
    const out = [];
    this.state.pipes.forEach((pipe) => {
      const q = pipe.points || [];
      if (q.length < 2) return;
      [0, q.length - 1].forEach((idx) => {
        if (out.some((o) => o.pipe === pipe && o.idx === idx)) return;
        const p = q[idx];
        const nb = idx === 0 ? q[1] : q[q.length - 2];
        const l = Math.hypot(nb.x - p.x, nb.y - p.y, nb.z - p.z);
        if (l < 1e-6) return;
        const u = { x: (nb.x - p.x) / l, y: (nb.y - p.y) / l, z: (nb.z - p.z) / l };
        const f = faces.find((fc) => {
          if (Math.hypot(p.x - fc.tip.x, p.y - fc.tip.y, p.z - fc.tip.z) > tol) return false;
          // 배관이 그 면에서 바깥으로 나가야(=면과 마주 봐야) 0mm로 맞닿은 것이다.
          return u.x * fc.axis.x + u.y * fc.axis.y + u.z * fc.axis.z > 0.9;
        });
        if (f) out.push({ pipe, idx, face: f, axis: { ...f.axis } });
      });
    });
    return out;
  }

  // 부속을 축 a 위로 d(m)만큼 옮기고, 양쪽 배관 끝을 같은 만큼 데려간다.
  //  · 한쪽 배관은 d만큼 길어지고 반대쪽은 d만큼 짧아진다 — 틈은 그대로 0.000m.
  //  · 끝에서 이어진 구간이 50mm보다 짧아지려 하면 그 자리에서 멈춘다(배관이 뒤집히지 않게).
  //  · 길이는 '끝점→이웃점' 구간으로 잰다 — 배관 총길이는 0을 지나면 다시 늘어나서 부족하다.
  // parts: [{ pipe, idx, pts0 }] (pts0 = 옮기기 전 점들), base = 부속의 처음 자리.
  stretchApply(parts, spec, a, base, d) {
    const MIN = INSERT_MIN_SIDE;
    let lo = -Infinity;
    let hi = Infinity;
    parts.forEach((pt) => {
      const q = pt.pts0;
      const idx = pt.idx;
      const nb = idx === 0 ? q[1] : q[q.length - 2];
      const e = q[idx];
      const s0 = Math.hypot(e.x - nb.x, e.y - nb.y, e.z - nb.z);
      if (!(s0 > 1e-6)) return;
      const ux = (nb.x - e.x) / s0;
      const uy = (nb.y - e.y) / s0;
      const uz = (nb.z - e.z) / s0;
      // d만큼 옮기면 이 구간 길이 = s0 − d·rate — 50mm 아래로는 못 간다.
      const rate = a.x * ux + a.y * uy + a.z * uz;
      if (Math.abs(rate) < 1e-6) return;
      const bound = (s0 - MIN) / rate;
      if (rate > 0) hi = Math.min(hi, bound);
      else lo = Math.max(lo, bound);
    });
    let used = d;
    let clamped = false;
    if (used > hi) { used = hi; clamped = true; }
    if (used < lo) { used = lo; clamped = true; }
    if (!Number.isFinite(used)) used = 0;
    if (Math.abs(used) < 1e-6) used = 0;
    clamped = clamped && Math.abs(used - d) > 1e-6;
    parts.forEach((pt) => {
      const q = pt.pipe.points;
      pt.pts0.forEach((p, i) => { q[i] = { ...p }; });
      if (q.length > pt.pts0.length) q.length = pt.pts0.length;
      const e = pt.pts0[pt.idx];
      q[pt.idx] = {
        x: r3(e.x + a.x * used),
        y: Math.max(0, r3(e.y + a.y * used)),
        z: r3(e.z + a.z * used),
      };
    });
    spec.x = r3(base.x + a.x * used);
    spec.y = Math.max(0, r3(base.y + a.y * used));
    spec.z = r3(base.z + a.z * used);
    return { used, clamped };
  }

  // 방향 버튼(↔️ 위치 이동) 한 번 — 배관 축 방향이면 양쪽 배관 길이가 자동으로 늘고 준다.
  // 축과 다른 방향(옆으로 빼기)이면 null을 돌려 평소 이동으로 넘긴다.
  stretchMove(spec, dx, dy, dz) {
    const found = this.stretchPartners(spec);
    if (!found.length) return null;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-9) return null;
    const u = { x: dx / len, y: dy / len, z: dz / len };
    // 배관 유로 축과 나란한 접합면이 하나라도 있어야 '축 방향 이동'이다.
    const along = found.some((pt) => Math.abs(pt.axis.x * u.x + pt.axis.y * u.y + pt.axis.z * u.z) > 0.99);
    if (!along) return null;
    const parts = found.map((pt) => ({
      pipe: pt.pipe, idx: pt.idx, pts0: pt.pipe.points.map((q) => ({ ...q })),
    }));
    const base = { x: Number(spec.x) || 0, y: Number(spec.y) || 0, z: Number(spec.z) || 0 };
    const r = this.stretchApply(parts, spec, u, base, len);
    const report = parts.map((pt) => ({
      name: pt.pipe.name,
      from: pipeLength(pt.pts0),
      to: pipeLength(pt.pipe.points),
    }));
    return { used: r.used, clamped: r.clamped, report, blocked: !r.used };
  }

  // 장비·부속·배관을 통째로 Δ만큼 옮긴다 — 모양은 그대로.
  moveSpecBy(spec, dx, dy, dz) {
    if (!spec) return;
    if (Array.isArray(spec.points)) {
      spec.points.forEach((q) => {
        q.x = r3(q.x + dx);
        q.y = Math.max(0, r3(q.y + dy));
        q.z = r3(q.z + dz);
      });
      return;
    }
    spec.x = r3((Number(spec.x) || 0) + dx);
    spec.y = Math.max(0, r3((Number(spec.y) || 0) + dy));
    spec.z = r3((Number(spec.z) || 0) + dz);
  }

  // 배관의 한 끝(end)을 target 좌표에 정확히 앉힌다 — 0.000m 이음.
  joinPipeEndTo(end, target) {
    const spec = end.spec;
    const pts = spec.points;
    const other = end.other;
    const dSeg = Math.hypot(target.x - other.x, target.y - other.y, target.z - other.z);
    const dTip = Math.hypot(target.x - end.tip.x, target.y - end.tip.y, target.z - end.tip.z);
    if (dTip < 1e-4) return;
    const uTip = { x: (target.x - end.tip.x) / dTip, y: (target.y - end.tip.y) / dTip, z: (target.z - end.tip.z) / dTip };
    const lOther = Math.hypot(other.x - end.tip.x, other.y - end.tip.y, other.z - end.tip.z) || 1;
    const uOther = { x: (other.x - end.tip.x) / lOther, y: (other.y - end.tip.y) / lOther, z: (other.z - end.tip.z) / lOther };
    const dot = uTip.x * uOther.x + uTip.y * uOther.y + uTip.z * uOther.z;
    // 거의 같은 축이거나 남는 길이가 너무 짧으면 끝점만 옮긴다 — 직선 연장·단축.
    if ((Math.abs(dot) > 0.98 && dSeg > 0.05) || dSeg < 0.1) {
      pts[end.idx] = { x: target.x, y: target.y, z: target.z };
      return;
    }
    // 어긋나 있으면 그 앞 점에서 target까지 90° 경로로 잇고, 꺾인 자리에 엘보를 세운다.
    const path = this.orthoPath(other, target);
    if (path.length < 2) { pts[end.idx] = { x: target.x, y: target.y, z: target.z }; return; }
    const insert = path.slice(1);
    if (end.idx === pts.length - 1) pts.splice(pts.length - 1, 1, ...insert);
    else pts.splice(0, 1, ...insert.slice().reverse());
    // 꺾임마다 엘보 — 배관 사이 각진 모서리가 빈 채로 보이지 않게.
    const bore = BORES[spec.bore] ? spec.bore : this.cmdBore;
    for (let i = 1; i < path.length - 1; i += 1) {
      const cur = path[i];
      const inV = unit2(cur, path[i - 1]);
      const outV = unit2(cur, path[i + 1]);
      const same = this.state.equipment.filter((q) => q.type === 'elbow').length;
      this.state.equipment.push(makeEquipment('elbow', {
        name: `EL-${100 + same + 1} 엘보`,
        x: cur.x, y: cur.y, z: cur.z, bore,
        inDir: [inV.x, inV.y, inV.z], outDir: [outV.x, outV.y, outV.z],
        rot: this.rotForDir({ x: outV.x, y: outV.y, z: outV.z }, this.cmdRot),
      }));
    }
  }

  // ── 선택한 것 위치 이동 (v73) ───────────────────────────────────────────
  // 방향 버튼(←/→/앞/뒤/↑/↓)으로 단위(10·50·100·500·1000mm)만큼 옮긴다.
  //  · 배관도 옮긴다 — 모든 점(points)을 같은 Δ만큼 통째로.
  //  · 여러 개를 골랐으면(☑️) 고른 것 전부에 똑같은 Δ(dx, dy, dz)를 준다.
  // '드래그 이동'을 켜면 3D 바닥에서 손가락으로 끌어 옮긴다. 실행취소(↩) 한 번이면 되돌아온다.
  moveSelectedStep(axis, sign, meters) {
    const items = this.selectedSpecs();
    if (!items.length) return;
    const multi = items.length > 1;
    // 옮기기 전에 이미 딱 붙어 있던 면 — 그 면으로 보폭 이동이 끌려 돌아가지 않게 기억한다.
    const preContact = this.magnetContactKeys(items);
    this.pushUndo(multi ? `${items.length}개 같이 이동` : '위치 이동');
    const dx = axis === 'x' ? sign * meters : 0;
    const dy = axis === 'y' ? sign * meters : 0;
    const dz = axis === 'z' ? sign * meters : 0;
    // ✂️ 끼워넣은 부속·밸브 — 배관 축 방향 이동이면 양쪽 배관 끝이 따라와 길이가 자동으로 늘고 준다 (v75).
    if (!multi && !Array.isArray(items[0].spec)) {
      const one = items[0].spec;
      const st = this.stretchMove(one, dx, dy, dz);
      if (st) {
        this.hideAlignGuides(0);
        this.rebuild();
        const n = Math.round(meters * 1000);
        if (st.blocked) {
          this.undoStack.pop();   // 아무것도 안 움직였으면 되돌릴 것도 남기지 않는다
          this.toast('배관이 50mm보다 짧아질 수 없어 더는 못 옵깁니다.', { type: 'err' });
          return;
        }
        const txt = st.report.map((r) => {
          const dmm = Math.round((r.to - r.from) * 1000);
          return `${r.name} ${fmt(r.from)}→${fmt(r.to)}m (${dmm >= 0 ? '+' : ''}${dmm}mm)`;
        }).join(' · ');
        this.lastMove = `${n}mm · 자동 신축`;
        this.toast(`↔️ ${one.name} 이동 — ${txt} · 틈 0.0mm${st.clamped ? ' (배관 최소 50mm에서 멈춤)' : ''}`,
          { type: st.clamped ? 'err' : 'ok', action: '되돌리기', onAction: () => this.undo() });
        return;
      }
    }
    this.applyMoveDelta(items, dx, dy, dz);
    const spec = items[0].spec;
    // ✨ 정렬 표시 (v77) — 옮긴 배관 끝·부속 중심이 다른 배관 끝·엘보 중심·노즐과 X·Y·Z 중
    // 하나가 15mm 안으로 맞으면 밝은 점선과 `정렬` 배지만 띄운다. 누른 보폭 그대로 두고 좌표는
    // 절대 끌어가지 않는다(2026-11-27 사용자: "다른곳에 정렬하더니 배관을 가져가버리네").
    const al = this.alignShowMoved(items, 15);
    let axisHit = false;
    // 장비는 바닥 십자 안내선만 — 다른 장비와 150mm 안이면 그 축을 보여 준다(좌표는 안 바꿈).
    if (!multi && !Array.isArray(spec.points)) {
      const snap = this.alignSnapFor(spec, spec.x, spec.z);
      axisHit = (axis === 'x' && snap.hitX) || (axis === 'z' && snap.hitZ);
      if (axis !== 'y') this.showAlignGuides(spec.x, spec.z, snap);
      this.hideAlignGuides(axisHit ? 1400 : 600);
    } else {
      this.hideAlignGuides(0);
    }
    // 옮긴 배관 끝이 탱크 벽면 가까이 오면 그 자리에 노즐을 맞춘다 (v72 기능 유지).
    const fits = this.autoFitMovedPipes(items);
    // 🧲 배관 끝이 엘보·밸브·티·노즐·배관 끝 접합면 15cm 안이면 0.000m로 붙인다 (v74).
    const mag = fits.length ? null : this.moveMagnetSnap(items, preContact);
    this.rebuild();
    const n = Math.round(meters * 1000);
    const dTxt = `${axis === 'x' ? 'X' : axis === 'z' ? 'Z' : '높이'} ${sign > 0 ? '+' : '-'}${n}mm`;
    this.lastMove = `${n}mm · ${dTxt}`;
    let where = '';
    if (!Array.isArray(spec.points)) where = ` → (${fmt(spec.x)}, ${fmt(spec.y)}, ${fmt(spec.z)})m`;
    else if (spec.points.length) {
      const a = spec.points[0];
      const b = spec.points[spec.points.length - 1];
      where = ` → (${fmt(a.x)}, ${fmt(a.y)}, ${fmt(a.z)})~(${fmt(b.x)}, ${fmt(b.y)}, ${fmt(b.z)})m`;
    }
    if (fits.length) { this.toast(fits[0], { type: 'ok' }); return; }
    if (mag) {
      this.lastMove = `${n}mm · ${dTxt} · 🧲 ${mag.port.label}`;
      this.toast(`🧲 ${mag.port.label}에 붙었어요 · 0.0mm`, {
        action: '되돌리기', onAction: () => this.undo(),
      });
      return;
    }
    if (al) {
      this.showAlign3D(al.from, al.probe);
      this.autoHideAlign3D(2000);
    }
    this.toast(`${multi ? `${items.length}개 같이 이동` : '위치 이동'} · ${dTxt}${where}${al ? ` · 정렬선 ${al.txt}` : ''}`);
  }

  // 이동 본체 — 고른 것 전부에 같은 Δ를 준다. 배관은 점 전체를, 장비는 중심을 옮긴다.
  // 커서가 그 장비 노즐에 붙어 있었으면 커서도 같이 따라간다(노즐 좌표는 spec에서 다시 계산된다).
  applyMoveDelta(items, dx, dy, dz) {
    if (!dx && !dy && !dz) return;
    let cursorMoved = false;
    items.forEach(({ spec }) => {
      if (Array.isArray(spec.points)) {
        spec.points.forEach((p) => {
          p.x = r3(p.x + dx);
          p.y = Math.max(0, r3(p.y + dy));
          p.z = r3(p.z + dz);
        });
        return;
      }
      const oldTips = equipPorts(spec).map((n) => ({ ...n.tip }));
      const nearNoz = oldTips.some((t) => Math.hypot(t.x - this.cmdCursor.x, t.y - this.cmdCursor.y, t.z - this.cmdCursor.z) < 0.02);
      spec.x = r3((spec.x || 0) + dx);
      spec.y = Math.max(0, r3((spec.y || 0) + dy));
      spec.z = r3((spec.z || 0) + dz);
      if (nearNoz) cursorMoved = true;
    });
    if (cursorMoved) {
      this.setCmdCursor({
        x: this.cmdCursor.x + dx,
        y: Math.max(0, this.cmdCursor.y + dy),
        z: this.cmdCursor.z + dz,
      }, this.cmdMarked);
    }
  }

  // 옮긴 배관의 양 끝이 탱크 벽면 가까이 오면 그 자리에 노즐을 맞춘다 (v72).
  autoFitMovedPipes(items) {
    const texts = [];
    items.forEach(({ spec }) => {
      if (!Array.isArray(spec.points) || spec.points.length < 2) return;
      [0, spec.points.length - 1].forEach((i) => {
        const fit = this.autoFitTankNozzle(spec, i);
        if (fit && fit.text) texts.push(fit.text);
      });
    });
    return texts;
  }

  // 드래그 이동 시작/진행/끝 — 손가락이 바닥(수평면 y=0)을 가리키는 점을 따라간다.
  // 고른 것이 여러 개면 전부 같은 Δ(dx, 0, dz)만큼 함께 움직이고, 배관도 점 전체가 따라온다.
  moveDragStart(ev) {
    const items = this.selectedSpecs();
    if (!items.length) return false;
    const p = this.groundPointAt(ev);
    if (!p) return false;
    this.moveDragState = {
      id: ev.pointerId,
      grab: p,
      moved: false,
      // 처음부터 딱 붙어 있던 면은 자석이 다시 잡아끌지 않게 기억한다 (v74).
      contact: this.magnetContactKeys(items),
      single: items.length === 1 ? items[0].spec : null,
      items: items.map(({ sel, spec }) => ({
        sel,
        spec,
        x0: Array.isArray(spec.points) ? null : Number(spec.x) || 0,
        z0: Array.isArray(spec.points) ? null : Number(spec.z) || 0,
        pts: Array.isArray(spec.points) ? spec.points.map((q) => ({ ...q })) : null,
        group: this.findObject(sel),
      })),
    };
    this.controls.enabled = false;
    // ✂️ 두 배관 사이에 앉은 부속 — 배관 축 방향으로 끌면 양쪽 배관 길이가 따라온다 (v75).
    if (items.length === 1 && !Array.isArray(items[0].spec.points)) {
      const spec1 = items[0].spec;
      const parts = this.stretchPartners(spec1);
      const fa = equipFlowAxis(spec1);
      const pick = parts.find((pt) => Math.abs(pt.axis.x * fa.x + pt.axis.y * fa.y + pt.axis.z * fa.z) > 0.99);
      const hl = pick ? Math.hypot(pick.axis.x, pick.axis.z) : 0;
      // 바닥 드래그는 수평 이동이라, 수평으로 놓인 배관 축에만 신축이 걸린다.
      if (pick && hl > 0.5) {
        this.moveDragState.stretch = {
          spec: spec1,
          a: { x: pick.axis.x / hl, y: 0, z: pick.axis.z / hl },
          base: {
            x: Number(spec1.x) || 0,
            y: Number(spec1.y) || 0,
            z: Number(spec1.z) || 0,
          },
          parts: parts.map((pt) => ({
            pipe: pt.pipe, idx: pt.idx, pts0: pt.pipe.points.map((q) => ({ ...q })),
          })),
          on: null,     // 끄는 방향을 보고 처음 한 번 정한다
          used: null,
        };
      }
    }
    return true;
  }

  groundPointAt(ev) {
    if (!this.renderer) return null;
    const ray = this.raycastAt(ev);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hit = new THREE.Vector3();
    return ray.ray.intersectPlane(plane, hit) ? hit : null;
  }

  moveDragMove(ev) {
    const st = this.moveDragState;
    if (!st || (st.id != null && ev.pointerId !== st.id)) return;
    const p = this.groundPointAt(ev);
    if (!p) return;
    const rawDx = p.x - st.grab.x;
    const rawDz = p.z - st.grab.z;
    if (!st.moved && Math.hypot(rawDx, rawDz) > 0.01) {
      st.moved = true;
      this.pushUndo(st.items.length > 1 ? `${st.items.length}개 같이 드래그 이동` : '드래그 이동');
    }
    if (!st.moved) return;
    const spec = st.single;
    if (spec && !Array.isArray(spec.points)) {
      // ✂️ 배관 축을 따라 끌면 두 배관의 길이가 자동으로 늘고 준다 — 틈 0.000m 유지 (v75).
      const sg = st.stretch;
      if (sg) {
        const raw = Math.hypot(rawDx, rawDz);
        if (sg.on == null && raw > 0.02) {
          sg.on = Math.abs(rawDx * sg.a.x + rawDz * sg.a.z) / raw > 0.7;
        }
        if (sg.on) {
          const r = this.stretchApply(sg.parts, sg.spec, sg.a, sg.base, rawDx * sg.a.x + rawDz * sg.a.z);
          sg.used = r;
          this.hideAlignGuides(0);
          // ✨ 드래그 정렬 (v77) — 신축 중인 부속도 다른 배관 끝·엘보·노즐과 X·Z가 거의 맞으면
          // 밝은 점선·`정렬` 배지로 알려 준다. 자리는 배관 축에 묶여 있으니 옮기지 않고 알려만 준다.
          const al = this.alignDragSnap([{ spec: sg.spec }], new Set([sg.spec.id]),
            { tol: 0.03, snap: false });
          st.align3d = al;
          if (al) this.showAlign3D(al.from, al.probe);
          else this.hideAlign3D();
          // 배관 길이가 눈에 보이게 — 장면만 다시 그린다(속성 창은 그대로).
          this.refreshScene();
          return;
        }
      }
      // 하나만 고른 장비·부속 — 기존처럼 접합면 자석 → 축 정렬.
      let nx = r3(st.items[0].x0 + rawDx);
      let nz = r3(st.items[0].z0 + rawDz);
      // 먼저 접합면 자석 — 근처(0.25m) 접합면이 있으면 그 자리에 0mm로 붙인다.
      const ps = this.portSnapFor(spec, nx, spec.y, nz);
      if (ps) {
        st.portSnap = ps;
        spec.x = ps.x;
        spec.y = ps.y;
        spec.z = ps.z;
        st.align3d = null;
        this.hideAlign3D();          // 접합면 자석이 우선 — 정렬 배지는 끈다
        if (st.items[0].group) st.items[0].group.position.set(spec.x, spec.y, spec.z);
        this.refreshHighlight();
        this.updateDims();
        return;
      }
      st.portSnap = null;
      // 다른 장비와 150mm 안이면 바닥 십자 안내선만 보여 준다 — 좌표는 손가락 그대로 (v77).
      const snap = this.alignSnapFor(spec, nx, nz);
      spec.x = nx;
      spec.z = nz;
      // ✨ 드래그 정렬 (v77) — 좌표는 그대로 두고, 다른 배관 끝·엘보 중심·노즐과 X·Z가
      // 45mm 안이면 밝은 점선과 `정렬` 배지만 띄운다.
      const al = this.alignDragSnap(st.items, new Set([spec.id]), { snap: false });
      st.align3d = al;
      if (al) this.showAlign3D(al.from, al.probe);
      else this.hideAlign3D();
      this.showAlignGuides(nx, nz, snap);
      // 가볍게 따라오게 — 무리한 전체 재구성 없이 그 그룹만 옮긴다.
      if (st.items[0].group) st.items[0].group.position.set(spec.x, spec.y, spec.z);
      this.refreshHighlight();
      this.updateDims();
      return;
    }
    // 배관 · 여러 개 — 고른 것 전부에 같은 Δ(모양은 그대로, 자리만).
    st.portSnap = null;
    this.hideAlignGuides(0);
    st.items.forEach((it) => {
      if (it.pts) {
        it.spec.points.forEach((q, i) => {
          const o = it.pts[i] || q;
          q.x = r3(o.x + rawDx);
          q.y = o.y;
          q.z = r3(o.z + rawDz);
        });
        // 배관 점은 월드 좌표라, 그룹을 같은 Δ만큼만 밀어 화면이 따라오게 한다.
        if (it.group) it.group.position.set(rawDx, 0, rawDz);
        return;
      }
      it.spec.x = r3(it.x0 + rawDx);
      it.spec.z = r3(it.z0 + rawDz);
      if (it.group) it.group.position.set(it.spec.x, it.spec.y, it.spec.z);
    });
    // 🧲 배관 끝이 엘보·밸브·티·노즐·배관 끝 15cm 안이면 0.000m로 붙인다 (v74).
    st.pipeSnap = this.moveMagnetSnap(st.items, st.contact);
    if (st.pipeSnap) {
      const mg = st.pipeSnap.delta;
      st.align3d = null;
      this.hideAlign3D();          // 접합면 자석이 우선 — 정렬 배지는 끈다
      st.items.forEach((it) => {
        if (!it.group) return;
        if (it.pts) it.group.position.set(rawDx + mg.x, mg.y, rawDz + mg.z);
        else it.group.position.set(it.spec.x, it.spec.y, it.spec.z);
      });
    } else {
      // ✨ 드래그 정렬 (v77) — 옮기는 배관 양 끝이 다른 배관 끝·엘보 중심·노즐과 X·Z가
      // 45mm 안이면 밝은 점선과 `정렬` 배지만 띄운다. 좌표는 손가락 위치 그대로 둔다
      // (2026-11-27 사용자: "움직이고 있는데 가져가면 안되지 정렬선만 표시 해주고").
      const al = this.alignDragSnap(st.items, new Set(st.items.map((it) => it.spec.id)),
        { snap: false });
      st.align3d = al;
      if (al) this.showAlign3D(al.from, al.probe);
      else this.hideAlign3D();
    }
    this.refreshHighlight();
    this.updateDims();
  }

  moveDragEnd() {
    const st = this.moveDragState;
    if (!st) return;
    this.moveDragState = null;
    this.controls.enabled = true;
    this.hideAlignGuides(1200);
    // ✨ 드래그 정렬 (v77) — 손을 뗀 뒤에는 1.2초만 남겨 두고 사라진다(맞은 게 없었으면 바로 끈다).
    if (st.align3d) this.autoHideAlign3D(1200);
    else this.hideAlign3D();
    if (!st.moved) return;
    // ✂️ 자동 신축 드래그 — 부속과 양쪽 배관이 함께 움직였다.
    if (st.stretch && st.stretch.used) {
      const rep = st.stretch.parts.map((pt) => {
        const dmm = Math.round((pipeLength(pt.pipe.points) - pipeLength(pt.pts0)) * 1000);
        return `${pt.pipe.name} ${fmt(pipeLength(pt.pts0))}→${fmt(pipeLength(pt.pipe.points))}m (${dmm >= 0 ? '+' : ''}${dmm}mm)`;
      }).join(' · ');
      const cl = st.stretch.used.clamped;
      this.rebuild();
      this.lastMove = `드래그 · 자동 신축`;
      this.toast(`↔️ 자동 신축 — ${rep} · 틈 0.0mm${cl ? ' (배관 최소 50mm에서 멈춤)' : ''}`,
        { type: cl ? 'err' : 'ok', action: '되돌리기', onAction: () => this.undo() });
      return;
    }
    const fits = this.autoFitMovedPipes(st.items.map((it) => ({ spec: it.spec })));
    this.rebuild();
    const spec = this.getSelectedSpec();
    if (fits.length) {
      this.toast(fits[0], { action: '되돌리기', onAction: () => this.undo() });
      return;
    }
    if (st.portSnap && spec) {
      this.toast(`접합면에 붙였습니다 · (${fmt(spec.x)}, ${fmt(spec.y)}, ${fmt(spec.z)})m`, {
        action: '되돌리기', onAction: () => this.undo(),
      });
      return;
    }
    if (st.pipeSnap) {
      this.lastMove = `드래그 이동 · 🧲 ${st.pipeSnap.port.label}`;
      this.toast(`🧲 ${st.pipeSnap.port.label}에 붙었어요 · 0.0mm`, {
        action: '되돌리기', onAction: () => this.undo(),
      });
      return;
    }
    const n = st.items.length;
    const one = spec && !Array.isArray(spec.points)
      ? `(${fmt(spec.x)}, ${fmt(spec.y)}, ${fmt(spec.z)})m` : '';
    this.lastMove = n > 1 ? `${n}개 같이 드래그 이동` : '드래그 이동';
    this.toast(n > 1 ? `${n}개 같이 이동 완료${one ? ' · ' + one : ''}` : `위치 이동${one ? ' → ' + one : ''}`, {
      action: '되돌리기', onAction: () => this.undo(),
    });
  }

  // 접속구·접합면 끝에서 이어 그리기 — 그 자리·방향·관경으로 커서를 옮긴다.
  //  · 티 : 직진 A·직진 B·분기 3포트
  //  · 그 밖의 2포트 부속(엘보·밸브·스트레이너·레듀샤·플랜지·벨로우즈·유량계…) : 앞·뒤 양쪽 면
  //    (2026-11-26 사용자: "엘보 이어그리기 양쪽 다 되야하는데 한쪽만 되고" → "엘보 뿐만 아니라 모두 다")
  portContinue(key) {
    const spec = this.getSelectedSpec();
    if (!spec || !key) return;
    const ports = spec.type === 'tee' ? teePorts(spec) : equipConnectFaces(spec);
    const p = ports.find((x) => x.nid === key);
    if (!p) return;
    const meta = this.portList(spec).find((x) => x.nid === key) || {};
    // 그 접합면의 관경 — 엘보·밸브는 부속 관경, 레듀샤·티는 면별 관경 (v74).
    const bore = this.faceBore(spec, { ...p, bore: meta.bore || p.bore }) || this.cmdBore;
    this.aimAtNozzle({ ...p, bore });
    this.clearSelection();
    const label = spec.type === 'tee' ? TEE_PORT_LABELS[key] : (meta.dirName || '접합면');
    this.toast(`📍 ${label} ${bore} 끝에서 이어 그립니다 · 커서 (${fmt(p.tip.x)}, ${fmt(p.tip.y)}, ${fmt(p.tip.z)})m`);
  }

  // ── 🔗 잇기 — 커서에서 탭한 접속구까지 배관을 바로 연결 ─────────────────
  setLinkMode(on) {
    this.linkMode = !!on;
    const b = $('#cmdLink');
    if (b) {
      b.classList.toggle('on', this.linkMode);
      b.setAttribute('aria-pressed', this.linkMode ? 'true' : 'false');
    }
    if (this.linkMode) {
      this.toast('🔗 잇기 — 커서에서 이을 접속구(티·노즐·배관 끝)를 3D에서 탭하세요. 한 번 연결하면 자동으로 꺼집니다.');
    } else if (on === false) {
      this.toast('잇기를 껐습니다.');
    }
  }

  // 탭한 자리 근처의 접속구 — 장비·티 포트(노즐), 배관 양 끝. bore는 이어 그릴 관경.
  connectTargetAt(ev, radiusPx) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const px = ev.clientX - rect.left;
    const py = ev.clientY - rect.top;
    const v = new THREE.Vector3();
    let best = null;
    const take = (p, label, bore, extra) => {
      v.set(p.x, p.y, p.z).project(this.camera);
      if (v.z > 1 || v.z < -1) return;
      const sx = (v.x * 0.5 + 0.5) * rect.width;
      const sy = (-v.y * 0.5 + 0.5) * rect.height;
      const d = Math.hypot(sx - px, sy - py);
      if (d > radiusPx || (best && d >= best.d)) return;
      best = { p: { x: p.x, y: p.y, z: p.z }, label, bore, d, ...(extra || {}) };
    };
    this.state.equipment.forEach((e) => {
      equipPorts(e).forEach((n) => {
        // 플랜지·노즐은 면의 바깥 방향도 넘긴다 — 45° 잇기가 그 축으로 꺾어 들어간다 (v85).
        take(n.tip, `${e.name} ${n.label || NOZZLE_LABELS[n.dir] || ''}`.trim(), n.bore,
          n.seat ? { seat: n.seat, portAxis: n.axis } : null);
      });
      // 엘보·레듀샤 같은 용접 접합면도 대상 — 그 면의 관경을 물려준다 (v74).
      equipConnectFaces(e).forEach((n) => {
        take(n.tip, `${e.name} ${TEE_PORT_LABELS[n.nid] || '접합면'}`.trim(), this.faceBore(e, n));
      });
    });
    this.state.pipes.forEach((p) => {
      const pts = p.points || [];
      if (!pts.length) return;
      take(pts[0], `${p.name} 시작`, p.bore);
      take(pts[pts.length - 1], `${p.name} 끝`, p.bore);
    });
    return best;
  }

  tryLinkAt(ev) {
    const t = this.connectTargetAt(ev, 38);
    if (!t) {
      this.toast('연결할 접속구·배관 끝을 찾지 못했습니다. 대상에 조금 더 가까이 눌러 주세요.', { type: 'err' });
      return;
    }
    const from = { ...this.cmdCursor };
    const d = Math.hypot(t.p.x - from.x, t.p.y - from.y, t.p.z - from.z);
    if (d < 0.05) { this.toast('이미 그 자리에 커서가 있습니다.'); return; }
    const bore = BORES[t.bore] ? t.bore : this.cmdBore;
    // 45° 모드에서는 정확한 45° 경사로 잇는다 (v85) — 90° 직각 경로는 그대로 둔다.
    const dp = this.diag45
      ? this.diag45Path(from, t.p, { bore, portAxis: t.seat === 'flange' ? t.portAxis : null })
      : null;
    const path = dp ? (dp.points.length ? dp.points : [from, t.p]) : this.orthoPath(from, t.p);
    this.pushUndo(this.diag45 ? '🔗 45° 잇기' : '🔗 잇기');
    let lastPipe = null;
    if (dp && dp.runs.length) {
      dp.runs.forEach((r) => {
        const pipe = makePipe({
          name: this.nextPipeName(), bore, material: this.cmdMaterial, conn: this.cmdConn,
          points: [{ ...r[0] }, { ...r[1] }],
        });
        this.state.pipes.push(pipe);
        lastPipe = pipe;
      });
      // 꺾임에 엘보를 세운다 — 45° 꺾임은 45° 엘보, 90°는 엘보
      dp.elbows.forEach((eb) => {
        const seq = this.state.equipment.filter((q) => q.type === eb.type).length + 1;
        this.state.equipment.push(makeEquipment(eb.type, {
          name: `${EQUIP_TYPES[eb.type].short}-${100 + seq} ${EQUIP_TYPES[eb.type].label}`,
          x: eb.at.x, y: eb.at.y, z: eb.at.z, bore: eb.bore,
          inDir: eb.inDir, outDir: eb.outDir,
          rot: this.rotForDir({ x: eb.outDir[0], y: eb.outDir[1], z: eb.outDir[2] }, this.cmdRot),
        }));
      });
      this.lastAdded = { kind: 'pipe', id: lastPipe.id };
    } else {
      const pipe = makePipe({
        name: this.nextPipeName(), bore, material: this.cmdMaterial, conn: this.cmdConn, points: path,
      });
      this.state.pipes.push(pipe);
      lastPipe = pipe;
      this.lastAdded = { kind: 'pipe', id: pipe.id };
    }
    this.selection = null;
    // 커서·방향을 대상 접속구로 넘긴다 — 바로 이어서 그린다.
    const prev = path[path.length - 2] || from;
    const last = path[path.length - 1];
    const dx = last.x - prev.x;
    const dy = last.y - prev.y;
    const dz = last.z - prev.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    this.lastDirV = { x: dx / len, y: dy / len, z: dz / len };
    this.cmdAxis = Math.abs(dx) >= Math.abs(dy) && Math.abs(dx) >= Math.abs(dz) ? 'x'
      : (Math.abs(dz) >= Math.abs(dy) ? 'z' : 'y');
    this.cmdSign = (this.cmdAxis === 'x' ? dx : this.cmdAxis === 'z' ? dz : dy) < 0 ? -1 : 1;
    this.cmdRot = this.cmdRotFor(this.cmdAxis, this.cmdSign);
    this.setCmdBore(bore, true);
    this.setCmdCursor({ x: t.p.x, y: Math.max(0, t.p.y), z: t.p.z }, true);
    this.rebuild();
    this.setLinkMode(false);
    const n45 = dp ? dp.elbows.filter((e) => e.type === 'elbow45').length : 0;
    const nEl = dp ? dp.elbows.length : 0;
    this.toast(this.diag45
      ? `🔗 ${t.label}에 45°로 연결했습니다 · ${fmt(d)}m · ${bore}${nEl ? ` · 엘보 ${nEl}개(45° ${n45})` : ''}`
      : `🔗 ${t.label}에 연결했습니다 · ${fmt(d)}m · ${bore}`);
  }

  // 광선이 실제로 맞은 것 중 가장 가까운 선택 대상(장비·배관).
  // 3D 화면 픽(노즐·작은 부속)이 눈앞의 물체를 가로채지 않게 하는 기준점이다(v80).
  firstPickHit(ray) {
    if (!this.root) return null;
    const hits = ray.intersectObjects(this.root.children, true);
    for (const h of hits) {
      let o = h.object;
      while (o && o !== this.root) {
        if (o.userData && o.userData.pick) {
          return { kind: o.userData.pick.kind, id: o.userData.pick.id, distance: h.distance };
        }
        o = o.parent;
      }
    }
    return null;
  }

  // 카메라에서 그 점으로 광선을 쏴, 그 점보다 앞(tol 이상)에서 장비·배관이 막고 있으면 가려진 것으로 본다.
  // 캔버스 루트에는 장비·배관만 들어 있어(치수선·라벨은 scene 쪽) 선이 가림으로 잘못 잡히지 않는다.
  portHidden(p, dist, tol) {
    if (!this.root) return false;
    const rc = this.pickRay || (this.pickRay = new THREE.Raycaster());
    const dir = new THREE.Vector3(p.x, p.y, p.z).sub(this.camera.position);
    const len = dir.length();
    if (len < 1e-4) return false;
    rc.set(this.camera.position, dir.normalize());
    rc.far = len + tol;         // 그 점보다 확실히 앞에서 막은 것만 본다
    rc.near = 0;
    const hits = rc.intersectObjects(this.root.children, true);
    return hits.some((h) => h.distance < dist - tol);
  }

  // 손가락으로 장비의 노즐 끝을 직접 눌렀는가 — 32px 안이고, 그 장비 본체 중심보다 그 노즐에
  // 더 가까운 경우에만 노즐 터치로 본다(본체를 눌러 장비를 고른 것과 구분).
  // equipNozzles()를 쓰는 장비 6종(펌프·열교환기·헤더·탱크·대형 원통탱크·사각 탱크)이 모두 같은 길을 쓴다.
  //
  // v80 — 화면 좌표만 보던 예전 판은 앞쪽 엘보·밸브를 누르면 그 뒤(카메라에서 더 먼) 장비의
  // 접합면·노즐이 32px 안에 투영되기만 하면 탭을 가져갔다. 사용자 제보(2026-11-27):
  //   "엘보를 선택하려는데 가까이 있는건 선택안되고 보이지도 않는 멀리있는게 선택되"
  //   이제 ① 손가락이 실제로 맞은 앞쪽 물체(firstHit)보다 뒤에 있으면 제외 ② 카메라에서
  //   그 끝이 다른 장비·배관에 가려져 있으면 제외 ③ 남은 후보가 여럿이면 화면 거리가 비슷할 때
  //   카메라에 가까운(앞에 보이는) 노즐을 고른다.
  nozzlePickAt(ev, radiusPx, firstHit) {
    if (!this.root) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const px = ev.clientX - rect.left;
    const py = ev.clientY - rect.top;
    const screen = (p) => {
      const v = new THREE.Vector3(p.x, p.y, p.z).project(this.camera);
      return { x: (v.x * 0.5 + 0.5) * rect.width, y: (-v.y * 0.5 + 0.5) * rect.height, z: v.z };
    };
    const cam = this.camera.position;
    // 가림 판정 여유 — 플랜지 두께·표면 오차만큼(8cm)은 앞으로 봐준다.
    const TOL = 0.08;
    // 화면에서 이만큼(px) 차이 나면 '비슷한 자리'로 보고 카메라에 가까운 쪽을 고른다.
    const PX_TIE = 8;
    let best = null;
    this.state.equipment.forEach((e) => {
      // 노즐이 있는 장비는 노즐 끝, 티는 직진 양끝 + 분기 끝 — 둘 다 같은 방식으로 집는다.
      const list = equipPorts(e);
      if (!list.length) return;
      // 본체 중심 — nearestPick이 장비를 고를 때 쓰는 자리와 같다.
      const body = screen({ x: e.x, y: (e.y || 0) + Math.min(0.4, (e.h || 0.3) * 0.5), z: e.z });
      if (body.z > 1 || body.z < -1) return;
      const bodyD = Math.hypot(body.x - px, body.y - py);
      // 이 장비 본체를 직접 눌렀으면 그 장비의 노즐 목을 누른 것으로 본다(노즐에서 이어 그리기).
      const sameEquip = !!firstHit && firstHit.kind === 'equipment' && firstHit.id === e.id;
      list.forEach((n) => {
        const s = screen(n.tip);
        if (s.z > 1 || s.z < -1) return;
        const d = Math.hypot(s.x - px, s.y - py);
        if (d > radiusPx || d >= bodyD) return;
        const camDist = Math.hypot(n.tip.x - cam.x, n.tip.y - cam.y, n.tip.z - cam.z);
        // 손가락이 실제로 맞은 앞쪽 물체보다 뒤에 있는 노즐 — 앞의 엘보·배관에 가려졌으므로 제외.
        if (firstHit && !sameEquip && camDist > firstHit.distance + TOL) return;
        // 그 노즐 끝 자체가 다른 장비·배관 뒤에 숨어 있으면(탱크 뒤쪽 노즐 등) 제외.
        if (this.portHidden(n.tip, camDist, TOL)) return;
        if (!best) { best = { kind: 'equipment', id: e.id, nozzle: n, d, camDist }; return; }
        // 화면 거리가 비슷하면 카메라에 가까운 쪽(앞에 보이는 쪽)이 이긴다 — 멀리 있는 노즐이
        // 몇 픽셀 차이로 눈앞의 노즐을 가져가지 않게.
        if (d < best.d - PX_TIE || (Math.abs(d - best.d) <= PX_TIE && camDist < best.camDist)) {
          best = { kind: 'equipment', id: e.id, nozzle: n, d, camDist };
        }
      });
    });
    return best;
  }

  // 노즐 끝을 직접 눌렀을 때 — 그 장비를 고르고 그 노즐에서 바로 이어 그린다.
  // select()가 기본 노즐(펌프 OUT·나머지 첫 방향)로 잡은 커서를 aimAtNozzle()이 그 노즐 끝으로 덮는다.
  selectNozzle(id, n) {
    if (!n) return;
    this.selection = { kind: 'equipment', id };
    this.multiSel = [];
    this.multiMode = false;
    this.refreshHighlight();
    this.renderProps();
    this.renderLists();
    // 바로 조이스틱·명령으로 이어 그릴 수 있게 속성 창은 접어 둔다(모바일에서 64dvh를 가리지 않게).
    const panel = $('#props');
    if (panel) panel.hidden = true;
    this.releaseOverlayEntry();
    this.aimAtNozzle(n);
    if (window.innerWidth <= 860) this.setDrawerOpen(false);
    if (this.fromCanvasTap) this.guardPropsFromGhostTap();
    const c = this.cmdCursor;
    this.toast(`📍 ${n.label || NOZZLE_LABELS[n.dir]} 노즐 ${n.bore}에서 이어 그립니다 · 커서 (${fmt(c.x)}, ${fmt(c.y)}, ${fmt(c.z)})m`);
  }

  // 손가락 터치가 작은 부속을 빗나가도 화면 기준 32px 안의 가장 가까운 것을 고른다.
  nearestPick(ev, radiusPx) {
    if (!this.root) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const px = ev.clientX - rect.left;
    const py = ev.clientY - rect.top;
    const v = new THREE.Vector3();
    const cam = this.camera.position;
    // 화면에서 이만큼(px) 차이 나면 '비슷한 자리'로 보고 카메라에 가까운 쪽을 고른다(v80).
    const PX_TIE = 8;
    let best = null;
    const test = (pick, x, y, z) => {
      v.set(x, y, z).project(this.camera);
      if (v.z > 1 || v.z < -1) return;
      const sx = (v.x * 0.5 + 0.5) * rect.width;
      const sy = (-v.y * 0.5 + 0.5) * rect.height;
      const d = Math.hypot(sx - px, sy - py);
      if (d > radiusPx) return;
      const camDist = Math.hypot(x - cam.x, y - cam.y, z - cam.z);
      if (!best || d < best.d - PX_TIE
        || (Math.abs(d - best.d) <= PX_TIE && camDist < best.camDist)) {
        best = { pick, d, camDist };
      }
    };
    this.state.equipment.forEach((e) => {
      test({ kind: 'equipment', id: e.id }, e.x, e.y + Math.min(0.4, (e.h || 0.3) * 0.5), e.z);
    });
    this.state.pipes.forEach((p) => {
      const pts = p.points || [];
      if (!pts.length) return;
      const pick = { kind: 'pipe', id: p.id };
      pts.forEach((q) => test(pick, q.x, q.y, q.z));
      for (let i = 1; i < pts.length; i += 1) {
        const a = pts[i - 1], b = pts[i];
        test(pick, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
      }
    });
    return best ? best.pick : null;
  }

  // ── 패널 렌더 ────────────────────────────────────────────
  renderLists() {
    const eqList = $('#eqList');
    eqList.innerHTML = '';
    if (!this.state.equipment.length) {
      eqList.innerHTML = '<li class="empty">장비가 없습니다. 위 버튼으로 추가하세요.</li>';
    }
    this.state.equipment.forEach((e) => {
      const li = document.createElement('li');
      if (this.selection && this.selection.kind === 'equipment' && this.selection.id === e.id) li.classList.add('active');
      li.innerHTML = `<span class="dot" style="background:${esc(e.color)}"></span>
        <span class="nm">${esc(e.name)}</span>
        <span class="meta">${EQUIP_TYPES[e.type].short}</span>`;
      li.addEventListener('click', () => this.select('equipment', e.id));
      eqList.appendChild(li);
    });
    $('#eqCount').textContent = String(this.state.equipment.length);

    const pipeList = $('#pipeList');
    pipeList.innerHTML = '';
    if (!this.state.pipes.length) {
      pipeList.innerHTML = '<li class="empty">배관이 없습니다. 3D에서 그려보세요.</li>';
    }
    this.state.pipes.forEach((p) => {
      const li = document.createElement('li');
      if (this.selection && this.selection.kind === 'pipe' && this.selection.id === p.id) li.classList.add('active');
      const col = (MATERIALS[p.material] || MATERIALS.carbon).color;
      li.innerHTML = `<span class="dot" style="background:${col}"></span>
        <span class="nm">${esc(p.name)}</span>
        <span class="meta">${p.bore}</span>`;
      li.addEventListener('click', () => this.select('pipe', p.id));
      pipeList.appendChild(li);
    });
    $('#pipeCount').textContent = String(this.state.pipes.length);
  }

  renderProps() {
    const panel = $('#props');
    const spec = this.getSelectedSpec();
    if (!spec) {
      panel.hidden = true;
      this.focusKey = null;
      this.hideEndPick();
      this.releaseOverlayEntry();
      return;
    }
    const wasHidden = panel.hidden;
    panel.hidden = false;
    // 속성 창을 열 때 다른 곳(명령창 등)에 잡혀 있던 초점은 놓아 준다.
    // 창 안의 입력칸에는 자동 초점을 주지 않는다 — 사용자가 그 칸을 직접 눌렀을 때만 키보드가 뜬다.
    this.blurForeignInput();
    this.syncOverlayEntry();
    // 창이 막 열렸으면 3D 탭의 후속 click(고스트 클릭)이 입력칸을 건드리지 못하게 잠근다.
    if (wasHidden) this.guardPropsFromGhostTap();
    const body = $('#propBody');

    // ☑️ 여러 개를 골랐으면 — 고른 것 목록 + 한 번에 이동·복사·삭제 (v73)
    if (this.selectionList().length > 1) {
      const n = this.selectionList().length;
      $('#propBadge').textContent = `함께 선택 ${n}`;
      body.innerHTML = this.multiPropsHtml();
      this.fitPanelsToView();
      this.focusSelectedInView();
      return;
    }

    if (spec.kind === 'equipment' || this.state.equipment.includes(spec)) {
      $('#propBadge').textContent = EQUIP_TYPES[spec.type].label;
      body.innerHTML = `
        ${this.selToolsRow()}
        ${this.rot3Field(spec)}
        <label class="field">이름<input type="text" data-f="name" value="${esc(spec.name)}"></label>
        ${this.boreFields(spec)}
        ${this.connField(spec)}
        ${this.axisField(spec)}
        ${this.handleFields(spec)}
        ${spec.type === 'hx' ? `
        <div class="prop-section">헤드 타입</div>
        <div class="field-row">
          <label class="field">타입<select data-f="hxType">
            ${HX_TYPES.map((k) => `<option value="${k}"${hxTypeOf(spec) === k ? ' selected' : ''}>${HX_TYPE_LABELS[k]}</option>`).join('')}
          </select></label>
          <label class="field">지금<span class="readonly">${HX_TYPE_DESC[hxTypeOf(spec)]}</span></label>
        </div>` : ''}
        ${this.nozzleFields(spec)}
        ${this.teeFields(spec)}
        ${this.portFields(spec)}
        ${this.copyPasteRow(spec)}
        <div class="prop-section">위치 (m)</div>
        <div class="prop-grid3">
          <label class="field">X<input type="number" step="0.1" data-f="x" value="${fmt(spec.x)}"></label>
          <label class="field">높이<input type="number" step="0.1" data-f="y" value="${fmt(spec.y)}"></label>
          <label class="field">Z<input type="number" step="0.1" data-f="z" value="${fmt(spec.z)}"></label>
        </div>
        ${(spec.type === 'elbow' || spec.type === 'elbow45') ? `
        <div class="prop-section">방향 (배관에 맞춤)</div>
        <p class="hint">${Array.isArray(spec.inDir)
    ? `진입 ${spec.inDir.join(', ')} → 진출 ${(spec.outDir || []).join(', ')} — 회전값을 바꾸면 도면 축 기준으로 다시 놓입니다.`
    : '회전값(도)으로만 놓인 엘보입니다. 배관을 이어 그리면 방향이 자동으로 맞춰집니다.'}</p>` : ''}
        <div class="prop-section">크기 (m)</div>
        <div class="prop-grid3">
          <label class="field">가로<input type="number" step="${sizeStep(spec)}" min="${sizeMin(spec)}" data-f="w" value="${fmtSize(spec.w)}"></label>
          <label class="field">높이<input type="number" step="${sizeStep(spec)}" min="${sizeMin(spec)}" data-f="h" value="${fmtSize(spec.h)}"></label>
          <label class="field">폭<input type="number" step="${sizeStep(spec)}" min="${sizeMin(spec)}" data-f="d" value="${fmtSize(spec.d)}"></label>
        </div>
        ${this.movePanelHtml()}
        <div class="prop-section">회전 · 색상</div>
        <div class="field-row">
          <label class="field">회전(°)<input type="number" step="15" data-f="rot" value="${fmt(spec.rot)}"></label>
          <label class="field">색상<input type="color" data-f="color" value="${esc(spec.color)}"></label>
        </div>
        ${Array.isArray(spec.dir) ? `
        <p class="hint">배관 축 정렬 — 진행 방향 (${spec.dir.join(', ')})에 맞춰 원판·바디가 배관에 수직으로 서 있습니다. 회전값을 바꾸면 도면 축 기준(수평)으로 다시 놓입니다.</p>` : ''}
        ${this.portActionsRow(spec)}
        <div class="prop-actions">
          <button class="btn small ghost" data-act="ground">바닥에</button>
          <button class="btn small ghost" data-act="dup">복제</button>
          <button class="btn small danger" data-act="del">삭제</button>
        </div>`;
    } else {
      $('#propBadge').textContent = '배관 ' + spec.bore;
      // 어느 끝에서 이어 그릴지 — 열린 끝을 먼저 잡고, 🔁로 반대쪽도 고를 수 있다 (v76).
      const endSide = this.pipePrefEnd(spec);
      const sOpen = !this.pipeEndAttached(spec, 'start');
      const eOpen = !this.pipeEndAttached(spec, 'end');
      const rows = spec.points.map((p, i) => `
        <div class="pt-row">
          <span class="idx">${i + 1}</span>
          <input type="number" step="0.1" data-pt="${i}" data-ptf="x" value="${fmt(p.x)}">
          <input type="number" step="0.1" data-pt="${i}" data-ptf="y" value="${fmt(p.y)}">
          <input type="number" step="0.1" data-pt="${i}" data-ptf="z" value="${fmt(p.z)}">
          <button class="del" data-act="rmpt" data-i="${i}" title="점 삭제">✕</button>
        </div>`).join('');
      body.innerHTML = `
        ${this.selToolsRow()}
        <label class="field">이름<input type="text" data-f="name" value="${esc(spec.name)}"></label>
        <div class="field-row">
          <label class="field">구경<select data-f="bore">
            ${Object.keys(BORES).map((b) => `<option value="${b}"${b === spec.bore ? ' selected' : ''}>${b} (${BORES[b].mm}mm)</option>`).join('')}
          </select></label>
          <label class="field">재질<select data-f="material">
            ${Object.keys(MATERIALS).map((m) => `<option value="${m}"${m === spec.material ? ' selected' : ''}>${MATERIALS[m].label}</option>`).join('')}
          </select></label>
        </div>
        ${this.connField(spec)}
        <div class="pipe-summary">길이 ${fmt(pipeLength(spec.points))} m · 점 ${spec.points.length}개</div>
        ${this.cutListHtml(spec)}
        ${this.movePanelHtml()}
        <div class="prop-section">포인트 (X / 높이 Y / Z)</div>
        <div class="pt-head"><span>#</span><span>X</span><span>Y</span><span>Z</span><span></span></div>
        <div class="pt-list">${rows}</div>
        <div class="prop-actions">
          <button class="btn small accent" data-act="from">📍 ${endSide === 'start' ? '시작점' : '끝점'}에서 이어 그리기</button>
          <button class="btn small ghost" data-act="fromend"
            title="이어 그릴 끝을 반대쪽(시작점↔끝점)으로 바꿉니다">🔁 반대쪽 끝</button>
          <button class="btn small accent" data-act="insert"
            title="이 배관을 가운데에서 둘로 나누고 티·밸브·부속을 같은 관경으로 끼워 넣습니다">✂️ 중간에 끼워넣기</button>
        </div>
        <p class="hint">시작점 ${sOpen ? '열림' : '연결됨'} · 끝점 ${eOpen ? '열림' : '연결됨'} — 열린 끝을 먼저 잡고, 🔁로 반대쪽 끝을 고릅니다.</p>
        ${this.copyPasteRow(spec)}
        <div class="prop-actions">
          <button class="btn small ghost" data-act="addpt">점 추가</button>
          <button class="btn small danger" data-act="del">배관 삭제</button>
        </div>`;
    }
    // 지금 이어 그릴 끝에 미리보기 링을 띄운다 — 양쪽 다 열렸거나 반대쪽을 골랐을 때 눈에 보이게 (v76).
    if (Array.isArray(spec.points)) this.showEndPick(spec, this.pipePrefEnd(spec));
    else this.hideEndPick();
    // 화면이 확대된 상태에서 창을 열어도 잘리지 않게 보이는 영역에 맞춘다.
    this.fitPanelsToView();
    // 시트에 가리지 않게 고른 것을 남은 3D 영역 한가운데로 (v67 `31583`).
    this.focusSelectedInView();
  }

  // ☑️ 여러 개 선택 · 🔗 연결된 것 모두 — 속성 창 맨 위 한 줄 (v73)
  selToolsRow() {
    const n = this.selectionList().length;
    return `
        <div class="noz-presets sel-tools">
          <button class="noz-chip${this.multiMode ? ' on' : ''}" data-act="multitoggle"
            aria-pressed="${this.multiMode ? 'true' : 'false'}"
            title="켜면 3D에서 다른 장비·부속·배관을 톡톡 눌러 함께 고릅니다">☑️ 여러 개 선택</button>
          <button class="noz-chip" data-act="linkall"
            title="고른 것에 이어져 있는 밸브·배관·엘보를 줄줄이 함께 고릅니다">🔗 연결된 것 모두</button>
          ${n === 2 ? `<button class="noz-chip accent" data-act="join2"
            title="고른 두 개의 가장 가까운 접속구(배관 끝·엘보 면·티 포트·밸브 면·노즐 끝)를 0.000m로 딱 붙입니다">🔗 이어붙이기</button>` : ''}
        </div>
        ${this.multiMode ? `<p class="hint">켜짐 — 3D에서 다른 장비·부속·배관을 톡톡 누르면 함께 골라집니다(지금 ${n}개).</p>` : ''}`;
  }

  // ↔️ 위치 이동 — 장비·부속·배관이 모두 같은 패널을 쓴다.
  // v73: 배관도 통째로 이동 + 보폭에 50mm 추가(10·50·100·500·1000mm).
  movePanelHtml() {
    const steps = [10, 50, 100, 500, 1000];
    const cur = steps.includes(this.moveStep) ? this.moveStep : 500;
    const n = this.selectionList().length;
    const spec = this.getSelectedSpec();
    const isPipe = !!(spec && Array.isArray(spec.points));
    const lead = n > 1
      ? `고른 ${n}개가 같은 거리만큼 함께 움직입니다`
      : (isPipe ? '배관의 모든 점이 통째로 움직입니다' : '방향 버튼 한 번에 보폭만큼 움직입니다');
    return `
        <div class="prop-section">${n > 1 ? `↔️ 같이 이동 (${n}개)` : '↔️ 위치 이동'}</div>
        <div class="noz-presets move-pad">
          <button class="noz-chip" data-act="mv" data-axis="x" data-sign="-1" title="왼쪽으로">←</button>
          <button class="noz-chip" data-act="mv" data-axis="x" data-sign="1" title="오른쪽으로">→</button>
          <button class="noz-chip" data-act="mv" data-axis="z" data-sign="1" title="앞으로">앞</button>
          <button class="noz-chip" data-act="mv" data-axis="z" data-sign="-1" title="뒤로">뒤</button>
          <button class="noz-chip" data-act="mv" data-axis="y" data-sign="1" title="위로">↑</button>
          <button class="noz-chip" data-act="mv" data-axis="y" data-sign="-1" title="아래로">↓</button>
        </div>
        <div class="noz-presets move-steps">
          ${steps.map((mm) => `<button class="noz-chip${cur === mm ? ' on' : ''}"
            data-act="mvstep" data-mm="${mm}">${mm}mm</button>`).join('')}
          <button class="noz-chip${this.moveDrag ? ' on' : ''}" data-act="mvdrag"
            title="켜면 3D 바닥을 손가락으로 끌어 옮깁니다">✋ 드래그 이동</button>
          <button class="noz-chip${this.magnetSnap ? ' on' : ''}" data-act="magnet"
            aria-pressed="${this.magnetSnap ? 'true' : 'false'}"
            title="옮긴 배관 끝이 엘보·밸브·티·노즐 면 15cm 안에 오면 0.000m로 딱 붙입니다">🧲 자석</button>
        </div>
        <p class="hint mv-readout">${lead} · 보폭 <b>${cur}mm</b>${this.lastMove ? ` · 지난 이동 ${this.lastMove}` : ''}</p>`;
  }

  // ☑️ 여러 개를 골랐을 때의 속성 창 — 고른 것 목록과 한 번에 이동·복사·삭제.
  multiPropsHtml() {
    const items = this.selectedSpecs();
    const n = items.length;
    const rows = items.map(({ sel, spec }, i) => {
      const isPipe = Array.isArray(spec.points);
      const type = isPipe
        ? `배관 ${spec.bore}`
        : (EQUIP_TYPES[spec.type] ? EQUIP_TYPES[spec.type].label : String(spec.type));
      const col = isPipe
        ? (MATERIALS[spec.material] || MATERIALS.carbon).color
        : (spec.color || '#8a939c');
      return `
        <div class="sel-row">
          <span class="idx">${i + 1}</span>
          <span class="dot" style="background:${esc(col)}"></span>
          <span class="nm">${esc(spec.name)}</span>
          <span class="meta">${esc(type)}</span>
          <button class="del only" data-act="selonly" data-kind="${sel.kind}" data-id="${esc(spec.id)}"
            title="이것만 따로 고치기">고치기</button>
          <button class="del" data-act="selremove" data-kind="${sel.kind}" data-id="${esc(spec.id)}"
            title="선택에서 빼기">✕</button>
        </div>`;
    }).join('');
    return `
        ${this.selToolsRow()}
        ${this.movePanelHtml()}
        <div class="prop-section">고른 것 ${n}개</div>
        <div class="sel-list">${rows}</div>
        <div class="prop-actions">
          <button class="btn small ghost" data-act="copyall">📋 ${n}개 복사</button>
          <button class="btn small ghost" data-act="paste">📌 붙여넣기</button>
        </div>
        <div class="prop-actions">
          <button class="btn small ghost" data-act="selclear">선택 비우기</button>
          <button class="btn small danger" data-act="delall">🗑️ ${n}개 삭제</button>
        </div>`;
  }

  // 선택 목록에서 하나 빼기 — 주 선택이 빠지면 나머지 첫째가 주 선택이 된다.
  removeFromSelection(kind, id) {
    const key = `${kind}:${id}`;
    if (this.selection && `${this.selection.kind}:${this.selection.id}` === key) {
      if (!this.multiSel.length) { this.clearSelection(); return; }
      this.selection = this.multiSel.shift();
    } else {
      this.multiSel = this.multiSel.filter((s) => `${s.kind}:${s.id}` !== key);
    }
    this.multiMode = this.selectionList().length > 1;
    this.refreshHighlight();
    this.renderProps();
    this.renderLists();
  }

  // 목록의 한 줄을 '이것만' 고치기 — 다중 선택을 풀고 그 하나만 연다.
  selectOnly(kind, id) {
    this.multiSel = [];
    this.multiMode = false;
    this.select(kind, id);
  }

  // 📋 여러 개 한꺼번에 복사 — 붙여넣으면 한 벌이 옆으로 그대로 선다.
  copyAllSelected() {
    const items = this.selectedSpecs();
    if (!items.length) return;
    this.clipboard = {
      kind: 'group',
      id: items[0].sel.id,
      specs: items.map(({ sel, spec }) => ({ kind: sel.kind, spec: JSON.parse(JSON.stringify(spec)) })),
    };
    this.renderProps();
    this.toast(`📋 ${items.length}개 복사됨 — [📌 붙여넣기]로 한 벌 더 놓으세요.`);
  }

  // 레듀샤·티는 1차/2차 관경을 속성 패널에서 바꿀 수 있다 (바꾸면 길이도 실제 관경에 맞춰 다시 잡는다).
  boreFields(spec) {
    const isElbow = spec.type === 'elbow' || spec.type === 'elbow45';
    if (spec.type !== 'reducer' && spec.type !== 'tee' && !isElbow && !isBoreSized(spec.type)) return '';
    const opts = (cur) => Object.keys(BORES).map((b) =>
      `<option value="${b}"${b === cur ? ' selected' : ''}>${b} (${BORES[b].mm}mm)</option>`).join('');
    // 밸브·피팅 — 관경을 바꾸면 몸체·플랜지·핸들 크기가 그 외경 비율로 다시 잡힌다.
    if (isBoreSized(spec.type)) {
      const bore = BORES[spec.bore] ? spec.bore : SIZE_REF_BORE;
      return `
        <div class="prop-section">달린 배관 관경</div>
        <div class="field-row">
          <label class="field">관경<select data-f="bore">${opts(bore)}</select></label>
          <label class="field">배관 외경<span class="readonly" title="이 관경에 비례해 밸브 몸체·핸들 크기가 정해집니다">${BORES[bore].mm}mm</span></label>
        </div>`;
    }
    if (isElbow) {
      const d = elbowDims(spec.type, spec.bore || '100A');
      return `
        <div class="prop-section">관경 · 곡률</div>
        <div class="field-row">
          <label class="field">관경<select data-f="bore">${opts(spec.bore || '100A')}</select></label>
          <label class="field">곡률 반경<span class="readonly" title="긴 반경 엘보(1.5D)">${fmt(d.R)} m</span></label>
        </div>`;
    }
    const tee = spec.type === 'tee';
    return `
        <div class="prop-section">${tee ? '주배관 · 분기 관경 (이경 티)' : '1차 · 2차 관경'}</div>
        <div class="field-row">
          <label class="field">${tee ? '주배관' : '1차'}<select data-f="bore1">${opts(spec.bore1 || '100A')}</select></label>
          <label class="field">${tee ? '분기' : '2차'}<select data-f="bore2">${opts(spec.bore2 || '50A')}</select></label>
        </div>`;
  }

  // ── 회전해도 연결면 유지 ────────────────────────────────────────────────
  // 회전 버튼은 부속을 제 중심으로 돌리므로, 아래에 딱 붙어 있던 면이 공중으로 떠 버린다.
  // (2026-11-25 `31585` 캡처 — 수직 게이트밸브 위 티가 20cm 떠 버렸다)
  //  · 회전 전: 지금 닿아 있는 접속면(플랜지 면·티 접속구·엘보 다리 끝)과 그 상대 점을 기억
  //  · 회전 뒤: 같은 면이 그 점에 0mm로 다시 앉도록 중심(x·y·z)만 옮긴다(자세는 그대로)
  connectionAnchor(spec) {
    const faces = equipConnectFaces(spec);
    if (!faces.length) return null;
    const pts = [];
    this.state.equipment.forEach((e) => {
      if (!e || e.id === spec.id) return;
      equipPorts(e).forEach((n) => pts.push({ x: n.tip.x, y: n.tip.y, z: n.tip.z, ax: n.axis || null }));
    });
    // 배관 점 — 끝·꼭짓점. 이웃 점에서 이 점으로 향하는 방향이 그 면의 바깥 법선이 된다.
    this.state.pipes.forEach((pl) => {
      const q = pl.points || [];
      q.forEach((pt, i) => {
        const nb = i === 0 ? q[1] : q[i - 1];
        let ax = null;
        if (nb) {
          const dx = pt.x - nb.x, dy = pt.y - nb.y, dz = pt.z - nb.z;
          const l = Math.hypot(dx, dy, dz);
          if (l > 1e-6) ax = { x: dx / l, y: dy / l, z: dz / l };
        }
        pts.push({ x: pt.x, y: pt.y, z: pt.z, ax });
      });
    });
    let best = null;
    faces.forEach((f) => {
      pts.forEach((q) => {
        const d = Math.hypot(f.tip.x - q.x, f.tip.y - q.y, f.tip.z - q.z);
        if (d > 0.16) return;                       // 닿아 있다고 볼 거리
        if (!best || d < best.d) best = { d, nid: f.nid, point: { x: q.x, y: q.y, z: q.z }, ax: q.ax };
      });
    });
    return best;
  }

  // 회전한 부속을 기억해 둔 접합면에 다시 앉힌다 — 옮겼으면 true.
  //  · 상대 면의 바깥 법선을 알고 있으면 **마주 보는 포트**(법선이 반대)를 고른다.
  //    티는 직진 A·B·분기 3개 포트를 모두 대칭으로 본다 — 세우든 눕히든 붙는 쪽이 이긴다.
  //  · 법선이 없으면(꼭짓점) 그 점에 가장 가까운 포트.
  reseatFitting(spec, anchor) {
    if (!anchor) return false;
    const faces = equipConnectFaces(spec);
    if (!faces.length) return false;
    let pick = null;
    if (anchor.ax) {
      faces.forEach((f) => {
        const facing = -(f.axis.x * anchor.ax.x + f.axis.y * anchor.ax.y + f.axis.z * anchor.ax.z);
        const d = Math.hypot(f.tip.x - anchor.point.x, f.tip.y - anchor.point.y, f.tip.z - anchor.point.z);
        const score = facing - d * 0.35;
        if (facing > 0.5 && (!pick || score > pick.score)) pick = { f, score, d };
      });
    }
    if (!pick) {
      faces.forEach((f) => {
        const d = Math.hypot(f.tip.x - anchor.point.x, f.tip.y - anchor.point.y, f.tip.z - anchor.point.z);
        if (!pick || d < pick.d) pick = { f, d };
      });
    }
    const f = pick && pick.f;
    if (!f) return false;
    const dx = anchor.point.x - f.tip.x;
    const dy = anchor.point.y - f.tip.y;
    const dz = anchor.point.z - f.tip.z;
    if (Math.hypot(dx, dy, dz) < 1e-4) return false;
    spec.x = r3((spec.x || 0) + dx);
    spec.y = r3((spec.y || 0) + dy);
    spec.z = r3((spec.z || 0) + dz);
    return true;
  }

  // ── 관경·길이를 바꿀 때 '물려 있는 접합면'을 그 자리에 고정 ─────────────────
  // 사용자 제보(2026-11-25 `31603`): "50a여서 80a로 변경하니까 배관을 잡아먹었어
  // 길이나 크기가 늘어나더라도 연결부를 넘기면 안돼지"
  //  · 바꾸기 전: 지금 0mm로 닿아 있는 접합면과 그 상대 점을 기억한다(상류 면 우선).
  //  · 바꾼 뒤 : 그 면이 같은 점에 0mm로 다시 앉도록 중심만 옮기고(reseatFitting),
  //              반대쪽 자유단이 밀린 만큼 그 뒤에 이어진 배관·부속을 함께 민다.
  //              그래서 중심을 기준으로 양쪽으로 커져 상류 배관을 파고드는 일이 없다.
  attachPoints() {
    const pts = [];
    this.state.equipment.forEach((e) => {
      if (!e) return;
      equipPorts(e).forEach((n) => pts.push({ id: e.id, x: n.tip.x, y: n.tip.y, z: n.tip.z, ax: n.axis || null }));
    });
    this.state.pipes.forEach((pl) => {
      const q = pl.points || [];
      q.forEach((pt, i) => {
        const nb = i === 0 ? q[1] : q[i - 1];
        let ax = null;
        if (nb) {
          const dx = pt.x - nb.x, dy = pt.y - nb.y, dz = pt.z - nb.z;
          const l = Math.hypot(dx, dy, dz);
          if (l > 1e-6) ax = { x: dx / l, y: dy / l, z: dz / l };
        }
        pts.push({ id: pl.id, x: pt.x, y: pt.y, z: pt.z, ax });
      });
    });
    return pts;
  }

  // 지금 0mm로 물려 있는 접합면 — 유로 반대(상류) 면을 먼저 고른다.
  matePoint(spec, tol) {
    const faces = equipConnectFaces(spec);
    if (!faces.length) return null;
    const limit = tol == null ? 0.02 : tol;
    const flow = equipFlowAxis(spec);
    const pts = this.attachPoints().filter((q) => q.id !== spec.id);
    let best = null;
    faces.forEach((f) => {
      const up = (f.axis.x * flow.x + f.axis.y * flow.y + f.axis.z * flow.z) < -0.5;
      pts.forEach((q) => {
        const d = Math.hypot(f.tip.x - q.x, f.tip.y - q.y, f.tip.z - q.z);
        if (d > limit) return;
        const score = d - (up ? limit : 0);   // 상류 면이면 거리보다 우선
        if (!best || score < best.score) best = { score, face: f, point: { x: q.x, y: q.y, z: q.z }, ax: q.ax };
      });
    });
    return best;
  }

  // 기준점에서 가장 먼 접합면 = 자유단.
  farFaceTip(spec, from) {
    const faces = equipConnectFaces(spec);
    let far = null;
    let best = -1;
    faces.forEach((f) => {
      const d = Math.hypot(f.tip.x - from.x, f.tip.y - from.y, f.tip.z - from.z);
      if (d > best) { best = d; far = { x: f.tip.x, y: f.tip.y, z: f.tip.z }; }
    });
    return best > 0.01 ? far : null;
  }

  // 자유단이 밀린 만큼, 그 자리에 이어진 배관·부속을 같은 방향으로 통째로 민다.
  // (밀린 것들은 서로의 상대 위치가 그대로라 이어진 자리는 유지되고, 부품이 겹쳐
  //  파고드는 일만 없어진다. 연결된 쪽(keep)에 닿은 것은 건드리지 않는다)
  pushDownstream(spec, from, delta, keep) {
    const tol = 0.012;
    const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) <= tol;
    const seen = new Set([spec.id]);
    const queue = [{ x: from.x, y: from.y, z: from.z }];
    let pushed = 0;
    for (let i = 0; i < queue.length && i < 80; i += 1) {
      const q = queue[i];
      this.state.pipes.forEach((pl) => {
        if (!pl || seen.has(pl.id) || !pl.points) return;
        if (!pl.points.some((pt) => near(pt, q))) return;
        if (keep && pl.points.some((pt) => near(pt, keep))) return;   // 연결된 쪽 배관은 그대로
        seen.add(pl.id);
        pl.points.forEach((pt) => {
          pt.x = r3(pt.x + delta.x);
          pt.y = r3(Math.max(0, pt.y + delta.y));
          pt.z = r3(pt.z + delta.z);
          queue.push({ x: pt.x, y: pt.y, z: pt.z });
        });
        pushed += 1;
      });
      this.state.equipment.forEach((e) => {
        if (!e || seen.has(e.id)) return;
        const ports = equipPorts(e);
        if (!ports.some((n) => near(n.tip, q))) return;
        if (keep && ports.some((n) => near(n.tip, keep))) return;
        seen.add(e.id);
        e.x = r3((e.x || 0) + delta.x);
        e.y = r3(Math.max(0, (e.y || 0) + delta.y));
        e.z = r3((e.z || 0) + delta.z);
        equipPorts(e).forEach((n) => queue.push({ x: n.tip.x, y: n.tip.y, z: n.tip.z }));
        pushed += 1;
      });
    }
    return pushed;
  }

  // 관경·길이 변경을 '물린 면 고정 + 자유단 방향 성장'으로 감싼다.
  resizeKeepingMate(spec, apply) {
    const anchor = this.matePoint(spec);
    const freeBefore = anchor ? this.farFaceTip(spec, anchor.point) : null;
    apply();
    const kept = anchor ? this.reseatFitting(spec, anchor) : false;
    let pushed = 0;
    if (anchor && freeBefore) {
      const freeAfter = this.farFaceTip(spec, anchor.point);
      if (freeAfter) {
        const delta = {
          x: freeAfter.x - freeBefore.x, y: freeAfter.y - freeBefore.y, z: freeAfter.z - freeBefore.z,
        };
        if (Math.hypot(delta.x, delta.y, delta.z) > 0.002) {
          pushed = this.pushDownstream(spec, freeBefore, delta, anchor.point);
        }
      }
    }
    if (spec.y < 0) spec.y = 0;
    return { kept, pushed };
  }

  // ── 3축 회전 — 모든 장비·부속 공통(좌·우 / 위·아래 / 축) ───────────────
  // 키보드가 올라오지 않는 버튼만 쓴다. 속성 창 맨 위에 둔다.
  // (2026-11-25 `31577` — "모든걸 회전할 수 있게 … 좌 우 위 아래 회전 기능을 넣는거야")
  rot3Field(spec) {
    const yaw = norm180(spec.yaw);
    const pitch = norm180(spec.pitch);
    const roll = handleRotOf(spec);
    const btn = (k, d, label, title) => `<button type="button" class="noz-chip"
            data-act="rot3" data-k="${k}" data-d="${d}" title="${title}">${label}</button>`;
    return `
        <div class="prop-section">3축 회전 <span class="rot3-now">좌우 ${yaw}° · 위아래 ${pitch}° · 축 ${roll}°</span></div>
        <div class="noz-presets">
          ${btn('yaw', -45, '↺ 좌 45°', '수평으로 왼쪽 45°')}
          ${btn('yaw', 45, '↻ 우 45°', '수평으로 오른쪽 45°')}
          ${btn('pitch', 45, '⤴ 위 45°', '앞머리를 위로 45°')}
          ${btn('pitch', -45, '⤵ 아래 45°', '앞머리를 아래로 45°')}
          ${btn('roll', -45, '⟲ -45°', '제 축 둘레로 -45°')}
          ${btn('roll', 45, '⟳ +45°', '제 축 둘레로 +45°')}
          ${(yaw || pitch || roll) ? '<button type="button" class="noz-chip" data-act="rot3" data-k="reset" title="세 회전을 모두 처음(0°)으로">0° 초기화</button>' : ''}
        </div>
        <p class="hint">좌·우는 세로축, 위·아래는 지금 배관 축에 수직인 수평축 둘레로 돕니다. 밸브·스트레이너는 축 회전이 손잡이만 돌립니다.</p>`;
  }

  // ── 핸들(손잡이) 방향 — 유로는 그대로, 손잡이만 관 축 둘레로 45°·90° ───────────
  // 사용자가 수직관 위 게이트밸브에서 조이스틱 45°를 눌렀다가 밸브 전체가 돌아간 뒤
  // (2026-11-25 `31544` 캡처) 따로 만든 버튼이다. 키보드가 뜨지 않는 단순 버튼만 쓴다.
  handleFields(spec) {
    if (!HANDLE_TYPES.has(spec.type)) return '';
    const deg = handleRotOf(spec);
    const btn = (d, label, title) => `<button type="button" class="noz-chip${d === deg ? ' on' : ''}"
            data-act="hrot" data-deg="${d}" title="${title}">${label}</button>`;
    return `
        <div class="prop-section">핸들 방향 (관 축 둘레)</div>
        <div class="field-row">
          <label class="field">지금<span class="readonly">${deg}° · ${deg === 0 ? '기본' : '돌림'}</span></label>
        </div>
        <div class="noz-presets">
          ${btn((deg - 45 + 360) % 360, '↺ -45°', '핸들을 관 축 둘레로 -45°')}
          ${btn((deg + 45) % 360, '↻ +45°', '핸들을 관 축 둘레로 +45°')}
          ${btn((deg + 90) % 360, '↻ +90°', '핸들을 관 축 둘레로 +90°')}
          ${deg ? btn(0, '0° 초기화', '핸들 방향을 처음 자리로') : ''}
        </div>
        <p class="hint">배관(유로) 방향과 플랜지·몸체는 그대로 — 스템·핸드휠·레버·Y자 넷만 관 축 둘레로 돌립니다. 아래 회전(°)을 바꾸면 배관 축 정렬이 풀리니, 손잡이만 돌릴 때는 이 버튼을 쓰세요.</p>`;
  }

  // ── 티 — 분기 방향(위·아래·앞·뒤)과 세 접속구 이어그리기 ──────────────────
  // 티는 본관 축 둘레로 분기를 돌릴 수 있고, 직진 A·직진 B·분기 세 끝 모두에서
  // 커서·방향·관경을 그 접속구로 넘겨 배관을 이어 그린다(3D에서 직접 눌러도 같다).
  // ── 2포트 부속의 접합면 — 앞·뒤 어느 쪽에서든 '이어 그리기' ─────────────────
  // 사용자 지시(2026-11-26): "엘보 이어그리기 양쪽 다 되야하는데 한쪽만 되고" →
  // "엘보 뿐만 아니라 모두 다". 티는 3포트 UI(teeFields), 노즐 장비는 노즐 칸이 맡는다.
  portList(spec) {
    if (!spec || Array.isArray(spec.points) || spec.kind === 'pipe') return [];
    if (spec.type === 'tee' || spec.type === 'hx') return [];
    if (nozzleDirsOf(spec.type).length) return [];
    const faces = equipConnectFaces(spec);
    if (faces.length < 2) return [];
    const pts = this.attachPoints().filter((q) => q.id !== spec.id);
    const b1 = BORES[spec.bore] ? spec.bore : (BORES[spec.bore1] ? spec.bore1 : null);
    const b2 = BORES[spec.bore2] ? spec.bore2 : b1;
    return faces.map((f, i) => {
      const a = f.axis;
      const ax = Math.abs(a.x), ay = Math.abs(a.y), az = Math.abs(a.z);
      const dirName = (ay >= ax && ay >= az) ? (a.y >= 0 ? '위' : '아래')
        : (ax >= az ? (a.x >= 0 ? '오른쪽' : '왼쪽') : (a.z >= 0 ? '앞' : '뒤'));
      const used = pts.some((q) => Math.hypot(q.x - f.tip.x, q.y - f.tip.y, q.z - f.tip.z) < 0.02);
      return {
        nid: f.nid, tip: f.tip, axis: f.axis, bore: i === 0 ? b1 : b2, dirName, used,
      };
    });
  }

  portFields(spec) {
    const list = this.portList(spec);
    if (list.length < 2) return '';
    const btns = list.map((p) => `<button type="button" class="btn small${p.used ? ' ghost' : ' accent'}"
            data-act="port" data-port="${esc(p.nid)}"
            title="${p.dirName} 접합면 (${fmt(p.tip.x)}, ${fmt(p.tip.y)}, ${fmt(p.tip.z)})m 에서 ${p.bore || ''} 배관을 이어 그립니다">📍 ${p.dirName}${p.bore ? ` ${p.bore}` : ''}${p.used ? ' · 물림' : ''}</button>`).join('');
    return `
        <div class="prop-section">접합면 · 이어 그리기 (양쪽)</div>
        <div class="prop-actions noz-actions">${btns}</div>
        <p class="hint">앞·뒤 두 접합면 어디서든 그 자리·방향·관경 그대로 배관을 이어 그립니다. 3D에서 그 면을 손가락으로 톡 눌러도 같은 자리로 커서가 갑니다.</p>`;
  }

  // 양쪽 접합면 버튼이 있으면 아래의 기본 한 개짜리 버튼은 숨긴다.
  portActionsRow(spec) {
    if (this.portList(spec).length >= 2) return '';
    return `<div class="prop-actions">
          <button class="btn small accent" data-act="from">📍 여기서 이어 그리기</button>
        </div>`;
  }

  teeFields(spec) {
    if (spec.type !== 'tee') return '';
    const ports = teePorts(spec);
    const branchPort = ports.find((p) => p.nid === 'branch');
    const dirName = (a) => {
      if (!a) return '-';
      const ax = Math.abs(a.x), ay = Math.abs(a.y), az = Math.abs(a.z);
      if (ay >= ax && ay >= az) return a.y >= 0 ? '위' : '아래';
      if (ax >= az) return a.x >= 0 ? '오른쪽' : '왼쪽';
      return a.z >= 0 ? '앞' : '뒤';
    };
    const opts = TEE_BRANCHES.map((b) =>
      `<option value="${b}"${b === (spec.branch || 'up') ? ' selected' : ''}>${TEE_BRANCH_LABELS[b]}</option>`).join('');
    const btns = ports.map((p) => `<button class="btn small ghost" data-act="port" data-port="${p.nid}"
            title="${TEE_PORT_LABELS[p.nid]} 끝 (${fmt(p.tip.x)}, ${fmt(p.tip.y)}, ${fmt(p.tip.z)})m 에서 ${p.bore} 배관을 이어 그립니다">📍 ${TEE_PORT_LABELS[p.nid]} ${p.bore}</button>`).join('');
    return `
        <div class="prop-section">분기 방향 · 접속구</div>
        <div class="field-row">
          <label class="field">분기 방향<select data-f="branch">${opts}</select></label>
          <label class="field">지금 분기<span class="readonly">${dirName(branchPort && branchPort.axis)}</span></label>
        </div>
        <div class="prop-actions noz-actions">${btns}</div>
        <p class="hint">분기를 위·아래·앞·뒤로 돌릴 수 있고, 직진 A·직진 B·분기 세 끝 어디서든 이어 그릴 수 있습니다. 3D에서 그 끝을 손가락으로 톡 눌러도 같은 자리로 커서가 갑니다.</p>`;
  }

  // 연결 방식 선택 — 배관은 선택안함(기본)·플랜지·단조 3단계, 부속은 플랜지 ↔ 단조.
  // 몸통이 플랜지로 그려지는 부속과 배관에서만 보여 준다 (플랜지 부속 자체는 항상 플랜지).
  connField(spec) {
    if (!spec) return '';
    const isPipe = spec.kind === 'pipe' || Array.isArray(spec.points);
    if (!isPipe && (!CONN_TYPES.has(spec.type) || spec.type === 'flange')) return '';
    const cur = isPipe ? connOf(spec) : (spec.conn === 'forged' ? 'forged' : 'flange');
    // 부속은 붙는 방식이 꼭 있어야 하므로 '선택안함'을 빼고 보여 준다.
    const keys = isPipe ? ['none', 'flange', 'forged'] : ['flange', 'forged'];
    const opts = keys.map((m) =>
      `<option value="${m}"${m === cur ? ' selected' : ''}>${CONN_MODES[m].label}</option>`).join('');
    const mark = cur === 'none' ? '매끈 · 플랜지 없음'
      : (cur === 'forged' ? '단조 · 플랜지 없음' : '플랜지 원판');
    return `
        <div class="prop-section">연결 방식 (${isPipe ? '배관 끝단' : '접합'})</div>
        <div class="field-row">
          <label class="field">연결<select data-f="conn">${opts}</select></label>
          <label class="field">도면 표시<span class="readonly">${mark}</span></label>
        </div>`;
  }

  // 방향 선택 — 밸브·피팅을 수평 배관에 눕힐지, 수직 배관에 세울지.
  // (수직으로 세우면 유로가 Y축, 핸들은 옆으로 나온다)
  axisField(spec) {
    if (!isVerticalCapable(spec.type)) return '';
    // 진행 방향(dir)으로 놓인 부속은 그 방향을 그대로 보여 준다 — 선반은 눕혀 놓은 것이 아니다.
    const dv = Array.isArray(spec.dir) && spec.dir.length === 3 ? spec.dir : null;
    const dirAxis = dv ? (Math.abs(dv[1]) > 0.9 ? 'y' : (Math.abs(dv[2]) >= Math.abs(dv[0]) ? 'z' : 'x')) : null;
    const cur = dirAxis || (spec.axis === 'y' || spec.axis === 'x' || spec.axis === 'z' ? spec.axis : 'x');
    const opts = ['x', 'z', 'y'].map((a) =>
      `<option value="${a}"${a === cur ? ' selected' : ''}>${AXIS_LABELS[a]}</option>`).join('');
    const now = (dirAxis || spec.axis) === 'y' ? '세움 · 핸들 옆' : '눕힘 · 흐름 방향';
    return `
        <div class="prop-section">방향</div>
        <div class="field-row">
          <label class="field">배관 축<select data-f="axis">${opts}</select></label>
          <label class="field">지금<span class="readonly">${now}${dv ? ' · 배관에 맞춤' : ''}</span></label>
        </div>`;
  }

  // ── 장비 노즐 — 위·아래·왼쪽·오른쪽(펌프는 IN·OUT) 관경 선택 ─────────────
  // 고른 방향만 3D 외벽에 노즐·플랜지가 돌출되고, 그 끝점이 손 그리기 스냅 자리가 된다.
  // 모바일 390px에서도 두 열로 깔끔하게 들어가도록 2열 그리드를 쓴다.
  // 열교환기는 노즐이 정해져 있지 않으므로 자유 배치(hxNozzleFields)로 넘긴다.
  nozzleFields(spec) {
    if (spec.type === 'hx') return this.hxNozzleFields(spec);
    // 탱크 3종(사각·원통·대형)은 노즐 위치가 자유롭다 — wall·높이·가로를 직접 고른다 (v72).
    if (TANK_NOZ_TYPES.has(spec.type)) return this.tankNozzleFields(spec);
    const dirs = nozzleDirsOf(spec.type);
    if (!dirs.length) return '';
    const cur = nozzlesOf(spec);
    const opts = (v) => [`<option value="${NOZZLE_NONE}"${v === NOZZLE_NONE ? ' selected' : ''}>없음</option>`]
      .concat(NOZZLE_SIZES.map((b) => `<option value="${b}"${b === v ? ' selected' : ''}>${b} (${BORES[b].mm}mm)</option>`))
      .join('');
    const pump = spec.type === 'pump';
    const cells = dirs.map((d) => `<label class="field">${NOZZLE_LABELS[d]}
            <select data-noz="${d}" title="${NOZZLE_LABELS[d]} 노즐 관경 — 없음이면 노즐을 그리지 않습니다">${opts(cur[d] || NOZZLE_NONE)}</select>
          </label>`).join('');
    const live = equipNozzles(spec);
    // 노즐 끝 좌표를 한 줄로 보여 준다 — 어느 높이에 물리는지 바로 확인할 수 있게.
    const coords = live.length
      ? live.map((n) => `${NOZZLE_LABELS[n.dir]} ${fmt(n.tip.y)}m`).join(' · ')
      : '지금은 켜진 노즐이 없습니다.';
    const btns = live.map((n) => `<button class="btn small ghost" data-act="noz" data-dir="${n.dir}"
            title="${NOZZLE_LABELS[n.dir]} 노즐 끝(${fmt(n.tip.x)}, ${fmt(n.tip.y)}, ${fmt(n.tip.z)})m 에서 ${n.bore} 배관을 이어 그립니다">📍 ${pump ? (n.dir === 'in' ? 'IN' : 'OUT') : NOZZLE_LABELS[n.dir]}</button>`).join('');
    return `
        <div class="prop-section">노즐 (관경)</div>
        <div class="noz-grid">${cells}</div>
        <p class="noz-tip">노즐 끝 높이 · ${coords}</p>
        ${btns ? `<div class="prop-actions noz-actions">${btns}</div>` : ''}
        <p class="hint">✏️ 손 그리기로 노즐 끝을 누르면 그 높이·관경 그대로 배관이 이어집니다. 3D에서 노즐 끝을 손가락으로 톡 눌러도 그 노즐로 커서·관경이 바로 바뀝니다. 📍는 명령·조이스틱으로 이어 그릴 자리를 잡아 줍니다.</p>`;
  }

  // ── 열교환기 노즐 — 자유 배치 ────────────────────────────────────────────
  // 열교환기는 현장마다 노즐 위치·개수·방향·관경이 다르다. 노즐마다 [위치][방향][관경]을
  // 그대로 고르고, [+ 노즐]로 필요한 만큼 더 뽑고 [✕]로 지운다. 프리셋은 한 번에 고르는 지름길.
  hxNozzleFields(spec) {
    const list = hxNozzlesOf(spec);
    const live = equipNozzles(spec);
    const atOpts = (cur) => HX_AT.map((a) => `<option value="${a}"${a === cur ? ' selected' : ''}>${HX_AT_LABELS[a]}</option>`).join('');
    const dirOpts = (cur) => HX_NOZ_DIRS.map((d) => `<option value="${d}"${d === cur ? ' selected' : ''}>${HX_NOZ_DIR_LABELS[d]}</option>`).join('');
    const boreOpts = (cur) => NOZZLE_SIZES.map((b) => `<option value="${b}"${b === cur ? ' selected' : ''}>${b}</option>`).join('');
    // 같은 자리(위치+방향)에 두 개가 겹쳤는지 — 겹치면 카드에 표시만 해 둔다(지우거나 옮길 수 있게).
    const seen = new Set();
    const dup = new Set();
    list.forEach((n) => {
      const k = `${n.at}|${n.dir}`;
      if (seen.has(k)) dup.add(k);
      seen.add(k);
    });
    const cards = list.map((n, i) => {
      const axial = n.dir === 'left' || n.dir === 'right';
      const liveN = live.find((x) => x.nid === n.nid);
      const where = liveN ? `(${fmt(liveN.tip.x)}, ${fmt(liveN.tip.y)}, ${fmt(liveN.tip.z)})m` : '';
      return `
        <div class="noz-card${dup.has(`${n.at}|${n.dir}`) ? ' warn' : ''}" data-nid="${esc(n.nid)}">
          <div class="noz-card-head">
            <b>N${i + 1}</b>
            <span class="noz-card-at">${HX_AT_LABELS[n.at]} · ${HX_NOZ_DIR_LABELS[n.dir]} · ${n.bore}</span>
            <button type="button" class="noz-mini" data-act="nozgo" data-nid="${esc(n.nid)}"
              title="이 노즐 끝 ${where}에서 이어 그리기">📍</button>
            <button type="button" class="noz-mini del" data-act="nozdel" data-nid="${esc(n.nid)}"
              title="이 노즐 삭제">✕</button>
          </div>
          <div class="noz-grid3">
            <label class="field">위치<select data-noz-at="${esc(n.nid)}"${axial
    ? ' disabled title="좌·우 끝 노즐은 경판(헤드) 자리에 고정됩니다"'
    : ''}>${atOpts(n.at)}</select></label>
            <label class="field">방향<select data-noz-dir="${esc(n.nid)}">${dirOpts(n.dir)}</select></label>
            <label class="field">관경<select data-noz-bore="${esc(n.nid)}">${boreOpts(n.bore)}</select></label>
          </div>
          ${dup.has(`${n.at}|${n.dir}`) ? '<p class="noz-warn">⚠ 같은 자리에 노즐이 겹칩니다 — 위치나 방향을 바꿔 주세요.</p>' : ''}
        </div>`;
    }).join('');
    const presetBtns = HX_PRESETS.map((p) => `<button type="button" class="noz-chip${p.key === 'clear' ? ' ghost' : ''}"
            data-act="nozpreset" data-preset="${p.key}">${p.label}</button>`).join('');
    const heights = live.length ? `노즐 ${live.length}개 · 끝 높이 ${live.map((n) => `${fmt(n.tip.y)}m`).join(' · ')}` : '지금은 노즐이 없습니다.';
    return `
        <div class="prop-section">노즐 (열교환기 · 자유 배치)</div>
        <div class="noz-presets">${presetBtns}</div>
        <div class="noz-cards">${cards || '<p class="noz-tip">노즐이 없습니다. [+ 노즐 추가]로 원하는 자리에 뽑으세요.</p>'}</div>
        <div class="prop-actions">
          <button class="btn small accent" data-act="nozadd">＋ 노즐 추가</button>
        </div>
        <p class="noz-tip">${heights}</p>
        <p class="hint">열교환기는 노즐이 정해져 있지 않습니다 — 쉘 좌측·중앙·우측, 좌·우 헤드 중 원하는 자리에서 위·아래·앞·뒤, 또는 좌·우 끝(경판 축방향)으로 뽑습니다. 3D에서 노즐 끝을 톡 눌러도 그 노즐로 커서·관경이 바뀌고, ✏️ 손 그리기 스냅도 같은 자리입니다.</p>`;
  }

  // ── 탱크 3종(사각 · 원통 · 대형) 노즐 — 자유 배치 ───────────────────────
  // 노즐마다 [벽면][높이][가로 위치][관경]을 그대로 고르고, [+ 노즐]로 더 뽑고 [✕]로 지운다.
  // 예전에 끄던 방향별 관경(nozzles: {left:'50A'})과 기본 노즐은 같은 자리·같은 관경의
  // 노즐 카드로 보인다(하위 호환). 모바일 390px에서도 두 줄씩 접혀 들어간다.
  tankNozzleFields(spec) {
    const list = tankNozzlesOf(spec);
    const live = equipNozzles(spec);
    const G = tankDims(spec);
    const hyd = TANK_TYPE_LABELS[spec.type] || '탱크';
    const span = tankHeightSpan(spec);
    const topDepth = tankDepthScale(spec);
    // 면 안 가로 위치 1.0이 몇 m인가 — 사각 옆면은 반폭, 원통은 원주 45° 호 길이
    const latOf = (face) => tankLatScale(spec, face);
    void G;
    const faceOpts = (cur) => TANK_NOZ_FACES.map((f) =>
      `<option value="${f}"${f === cur ? ' selected' : ''}>${TANK_NOZ_FACE_LABELS[f]}</option>`).join('');
    const boreOpts = (cur) => NOZZLE_SIZES.map((b) =>
      `<option value="${b}"${b === cur ? ' selected' : ''}>${b}</option>`).join('');
    // 위치 빠른 선택 — 왼쪽/가운데/오른쪽 + 직접(mm 입력으로 미세 조정)
    const spotOpts = (v, labels) => {
      const keys = [['-1', labels[0]], ['-0.5', `${labels[0]}¼`], ['0', '가운데'], ['0.5', `${labels[1]}¼`], ['1', labels[1]]];
      const hit = keys.find(([k]) => Math.abs(Number(k) - v) < 0.04);
      return keys.map(([k, label]) => `<option value="${k}"${hit && hit[0] === k ? ' selected' : ''}>${label}</option>`)
        .concat(`<option value="custom"${hit ? '' : ' selected'}>직접</option>`).join('');
    };
    const hOpts = (h) => {
      const hit = TANK_HPOS.find(([, v]) => Math.abs(v - h) < 0.06);
      return TANK_HPOS.map(([k, v, label]) =>
        `<option value="${v}"${hit && hit[0] === k ? ' selected' : ''}>${label}</option>`)
        .concat(`<option value="custom"${hit ? '' : ' selected'}>직접</option>`).join('');
    };
    const cards = list.map((n, i) => {
      const liveN = live.find((x) => x.nid === n.nid);
      const where = liveN ? `(${fmt(liveN.tip.x)}, ${fmt(liveN.tip.y)}, ${fmt(liveN.tip.z)})m` : '';
      const cap = n.face === 'top' || n.face === 'bottom';
      const hmm = Math.round(n.h * span * 1000);
      const lat = Math.round(n.u * latOf(n.face) * 1000);
      const dep = Math.round(n.v * topDepth * 1000);
      const nid = esc(n.nid);
      return `
        <div class="noz-card" data-nid="${nid}">
          <div class="noz-card-head">
            <b>N${i + 1}</b>
            <span class="noz-card-at">${tankNozzleLabel(n)} · ${n.bore}</span>
            <button type="button" class="noz-mini" data-act="nozgo" data-nid="${nid}"
              title="이 노즐 끝 ${where}에서 이어 그리기">📍</button>
            <button type="button" class="noz-mini del" data-act="nozdel" data-nid="${nid}"
              title="이 노즐 삭제">✕</button>
          </div>
          <div class="noz-grid">
            <label class="field">벽면<select data-tnz-face="${nid}">${faceOpts(n.face)}</select></label>
            <label class="field">관경<select data-tnz-bore="${nid}">${boreOpts(n.bore)}</select></label>
          </div>
          ${cap ? `
          <div class="noz-grid">
            <label class="field">좌우<select data-tnz-u="${nid}">${spotOpts(n.u, ['왼쪽', '오른쪽'])}</select></label>
            <label class="field">좌우 (mm)<input type="number" inputmode="numeric" step="10" data-tnz-umm="${nid}" value="${lat}"></label>
          </div>
          <div class="noz-grid">
            <label class="field">앞뒤<select data-tnz-v="${nid}">${spotOpts(n.v, ['앞', '뒤'])}</select></label>
            <label class="field">앞뒤 (mm)<input type="number" inputmode="numeric" step="10" data-tnz-vmm="${nid}" value="${dep}"></label>
          </div>` : `
          <div class="noz-grid">
            <label class="field">높이<select data-tnz-h="${nid}">${hOpts(n.h)}</select></label>
            <label class="field">바닥에서 (mm)<input type="number" inputmode="numeric" step="10" data-tnz-hmm="${nid}" value="${hmm}"></label>
          </div>
          <div class="noz-grid">
            <label class="field">가로<select data-tnz-u="${nid}">${spotOpts(n.u, ['왼쪽', '오른쪽'])}</select></label>
            <label class="field">가로 (mm)<input type="number" inputmode="numeric" step="10" data-tnz-umm="${nid}" value="${lat}"></label>
          </div>`}
        </div>`;
    }).join('');
    const presetBtns = TANK_PRESETS.map((p) => `<button type="button" class="noz-chip${p.key === 'clear' ? ' ghost' : ''}"
            data-act="nozpreset" data-preset="${p.key}">${p.label}</button>`).join('');
    const heights = live.length
      ? `노즐 ${live.length}개 · ${live.map((n) => `${n.label} ${fmt(n.tip.y)}m`).join(' · ')}`
      : '지금은 노즐이 없습니다.';
    return `
        <div class="prop-section">노즐 (${hyd} · 자유 배치)</div>
        <div class="noz-presets">${presetBtns}</div>
        <div class="noz-cards">${cards || '<p class="noz-tip">노즐이 없습니다. [+ 노즐 추가]로 원하는 벽면·높이에 뽑으세요.</p>'}</div>
        <div class="prop-actions">
          <button class="btn small accent" data-act="nozadd">＋ 노즐 추가</button>
        </div>
        <p class="noz-tip">${heights}</p>
        <p class="hint">벽면은 탱크 기준 왼쪽·오른쪽·앞쪽·뒤쪽·위·아래입니다. 높이는 바닥에서 mm로, 가로는 그 면의 가운데에서 mm로 맞춥니다(원통은 둘레 45°까지). 3D에서 노즐 끝을 톡 누르면 그 노즐로 커서·관경이 바뀌고, ✏️ 손 그림기 스냅도 같은 자리입니다. 배관 끝을 탱크 벽면 가까이 가져가면 그 높이·자리에 노즐이 저절로 맞춰집니다.</p>`;
  }

  // 복사 · 붙여넣기 줄 — 장비·배관 속성 창의 액션 버튼 줄에 들어간다 (v72).
  // 펌프·탱크를 나란히 여러 대 놓을 때 한 번씩만 누르면 된다.
  copyPasteRow(spec) {
    const has = !!(this.clipboard && this.clipboard.spec);
    const nm = has ? this.clipboard.spec.name : '';
    return `
        <div class="prop-actions copy-actions">
          <button class="btn small ghost" data-act="copy"
            title="이 장비의 사양(관경·노즐 배치·회전·색)을 통째로 복사합니다">📋 복사</button>
          <button class="btn small ghost" data-act="paste"
            title="${has ? `복사한 ${esc(nm)}을(를) 바로 옆에 나란히 붙입니다` : '붙여넣을 것이 없습니다 — 먼저 [📋 복사]를 누르세요'}">📌 붙여넣기</button>
        </div>`;
  }

  updatePipeSummary() {
    const spec = this.getSelectedSpec();
    const el = $('.pipe-summary');
    if (spec && el && spec.points) el.textContent = `길이 ${fmt(pipeLength(spec.points))} m · 점 ${spec.points.length}개`;
  }

  updateStats() {
    const eq = this.state.equipment.length;
    const pp = this.state.pipes.length;
    const total = this.state.pipes.reduce((a, p) => a + pipeLength(p.points), 0);
    $('#sceneCount').textContent = `장비 ${eq} / 배관 ${pp}`;
    $('#sceneName').textContent = this.state.name || '내 배관 도면';
    $('#stats').innerHTML =
      `장비 <b>${eq}</b>개 · 배관 <b>${pp}</b>개 · 총 배관 길이 <b>${fmt(total)}</b>m<br>` +
      `단위: 미터(m) · 1m 격자 · 내보내기: Fusion 360(.py) / .obj / .json`;
  }

  // ── 장비·배관 편집 ───────────────────────────────────────
  pushUndo(label) {
    // 커서·관경·재질까지 같이 기억해 두어야 실행취소할 때 그리던 자리로 정확히 돌아간다.
    this.undoStack.push({
      snap: JSON.stringify(this.state),
      label,
      cur: {
        p: { ...this.cmdCursor },
        bore: this.cmdBore,
        material: this.cmdMaterial,
        conn: this.cmdConn,
        axis: this.cmdAxis,
        sign: this.cmdSign,
        rot: this.cmdRot,
        marked: this.cmdMarked,
        dir: this.lastDirV ? { ...this.lastDirV } : null,
      },
    });
    if (this.undoStack.length > 30) this.undoStack.shift();
  }

  undo() {
    const u = this.undoStack.pop();
    if (!u) { this.toast('되돌릴 작업이 없습니다.'); return; }
    this.closeHandDim();   // 치수 창이 가리키던 구간이 사라질 수 있다
    this.state = normalizeState(JSON.parse(u.snap));
    this.selection = null;
    this.multiSel = [];
    this.multiMode = false;
    if (u.cur) {
      this.cmdBore = u.cur.bore;
      this.updatePadInfo();
      this.cmdMaterial = u.cur.material;
      this.cmdConn = connOf({ conn: u.cur.conn });
      this.cmdAxis = u.cur.axis;
      this.cmdSign = u.cur.sign;
      this.cmdRot = u.cur.rot;
      this.cmdMarked = u.cur.marked;
      this.cmdCursor = { ...u.cur.p };
      this.lastDirV = u.cur.dir ? { ...u.cur.dir } : null;
      this.updateCmdMarker();
      this.updatePadInfo();
    }
    this.rebuild();
    this.toast(`되돌렸습니다 · ${u.label}`);
  }

  addEquipment(type, opts) {
    const t = EQUIP_TYPES[type];
    if (!t) return;
    const extra = opts || {};
    // 커서가 배관 끝에 찍혀 있으면 그 끝에 접합면을 정확히 맞춰 놓는다 —
    // 예전에는 화면 가운데(카메라 중심)에 놓여 배관과 떨어져 '엘보가 안 이어진다'고 보였다.
    if (this.cmdMarked && (type === 'elbow' || type === 'elbow45' || INLINE_TYPES.has(type))) {
      this.addFittingAtCursor(type);
      return;
    }
    const target = this.controls.target;
    // 지금 넣는 부속은 **지금 작업 중인 관경**을 그대로 물려받는다 (v76).
    // (예전에는 팔레트로 넣은 티가 늘 표 기본값 100A로 들어가, 고른 80A 배관에 100A 티가 박혔다)
    const boreIn = isBoreSized(type) || type === 'tee' || type === 'reducer' || type === 'elbow' || type === 'elbow45'
      ? this.inheritedBore() : this.cmdBore;
    const spec = makeEquipment(type, {
      x: Math.round(target.x * 2) / 2,
      y: 0,
      z: Math.round(target.z * 2) / 2,
      bore: boreIn,
      bore1: boreIn,
      conn: this.cmdConn,
      ...(extra.hxType ? { hxType: extra.hxType } : {}),
    });
    if (boreIn !== this.cmdBore && (isBoreSized(type) || type === 'tee' || type === 'reducer')) this.setCmdBore(boreIn, true);
    this.pushUndo(t.label + ' 추가');
    if (spec.type === 'gauge') attachGaugeToPipe(this.state.pipes, spec);
    this.state.equipment.push(spec);
    this.lastAdded = { kind: 'equipment', id: spec.id };
    this.selection = { kind: 'equipment', id: spec.id };
    this.rebuild();
    this.toast(`${t.label}${extra.hxType ? ` (${HX_TYPE_LABELS[extra.hxType]})` : ''}을(를) 추가했습니다. 속성 패널에서 위치·크기를 조정하세요.`);
  }

  // 열교환기는 타입이 여러 가지 — 배치 전에 무엇을 쓸지 먼저 고른다.
  chooseAndAdd(type) {
    if (type !== 'hx') { this.addEquipment(type); return; }
    const btns = HX_TYPES.map((k) => ({
      label: HX_TYPE_LABELS[k],
      keep: true,
      onClick: () => { this.closeModal(); this.addEquipment('hx', { hxType: k }); },
    }));
    btns.push({ label: '취소', cls: 'ghost' });
    this.openModal({
      title: '열교환기 타입 선택',
      body: `<p class="hint">쉘앤튜브 열교환기의 양 끝 모양을 고르세요. 배치한 뒤 속성 패널에서 언제든 바꿀 수 있습니다.</p>
        <div class="hx-type-list">
          ${HX_TYPES.map((k) => `<button class="hx-type" data-hx="${k}">
            <b>${HX_TYPE_LABELS[k]}</b><span>${HX_TYPE_DESC[k]}</span></button>`).join('')}
        </div>`,
      actions: [{ label: '취소', cls: 'ghost' }],
    });
    const root = $('#modalBody');
    if (root) {
      root.querySelectorAll('[data-hx]').forEach((b) => b.addEventListener('click', () => {
        const k = b.dataset.hx;
        this.closeModal();
        this.addEquipment('hx', { hxType: k });
      }));
    }
  }

  // 커서(배관 끝)에 인라인 부속을 놓을 때의 진행 방향 — 마지막으로 그은 방향.
  inlineDirAtCursor() {
    const v = this.lastDirV;
    const l = v ? Math.hypot(v.x, v.y, v.z) : 0;
    if (l > 1e-6) return { x: r3(v.x / l), y: r3(v.y / l), z: r3(v.z / l) };
    const h = this.headingFromRot(this.cmdRot);
    return h.axis === 'x' ? { x: h.sign, y: 0, z: 0 }
      : h.axis === 'z' ? { x: 0, y: 0, z: h.sign } : { x: 0, y: h.sign, z: 0 };
  }

  // 엘보가 꺾이는 방향 — 수평 배관이면 위(+Y), 수직 배관이면 +X.
  turnDirFor(d) {
    if (Math.abs(d.y) < 0.9) return { x: 0, y: 1, z: 0 };
    return { x: 1, y: 0, z: 0 };
  }

  // 조이스틱에서 골라 둔 90° 방향 → 월드 단위벡터 (「내 시점 기준」·「도면 축 기준」 반영).
  // 부속을 놓을 때 이 방향을 **출구 방향**으로 쓴다.
  padDirV() {
    // 엘보·부속을 놓을 때 쓰는 방향 — 직각(seg)을 골랐을 때만 넘긴다.
    // 45° 경사(diag)는 엘보 방향 계산이 축 하나를 전제하므로 넘기지 않는다 (v85 점검).
    const sel = this.pending;
    if (!sel || sel.op !== 'seg' || !sel.axis) return null;
    const w = this.dirToWorld(sel.axis, sel.sign);
    return {
      x: w.axis === 'x' ? w.sign : 0,
      y: w.axis === 'y' ? w.sign : 0,
      z: w.axis === 'z' ? w.sign : 0,
    };
  }

  // 라이브러리에서 고른 인라인 부속을 배관 끝(커서)에 붙인다.
  //  · 엘보 — 들어오는 쪽 접합면을 커서에 딱 맞추고(꺾임점은 face만큼 앞),
  //           나가는 방향으로 커서를 옮겨 바로 이어 그릴 수 있게 한다.
  //  · 그 밖(밸브·티·레듀샤 등) — 들어오는 접합면이 커서에 닿게 중심을 w/2 앞에 두고
  //           출구 끝으로 커서를 옮긴다. 부속은 배관 축(dir)에 맞춰 돌려 놓는다.
  // 커서 근처의 접합면 — 장비·티 노즐 끝, 플랜지 양면, 배관 끝.
  //  · p = 접합면 중심, axis = 그 면에서 배관이 나가는 방향, bore = 그 면의 관경
  //  플랜지에 배관 없이 바로 엘보·티·레듀샤를 용접하는 경우에도 이 면에 정확히 맞춘다.
  portNearCursor(radius) {
    const r = radius || 0.3;
    const cur = this.cmdCursor;
    let best = null;
    const take = (p, axis, bore, label) => {
      if (!p || !axis) return;
      const d = Math.hypot(p.x - cur.x, p.y - cur.y, p.z - cur.z);
      if (d > r || (best && d >= best.d)) return;
      best = { p: { x: p.x, y: p.y, z: p.z }, axis: { ...axis }, bore: bore || null, d, label };
    };
    this.state.equipment.forEach((e) => {
      equipPorts(e).forEach((n) => take(n.tip, n.axis, n.bore, `${e.name} ${n.label || ''}`.trim()));
      if (e.type === 'flange') {
        // 플랜지 부속은 두 면이 모두 접합면 — 가까운 쪽을 고른다
        let ux = 1;
        let uy = 0;
        let uz = 0;
        if (Array.isArray(e.dir) && e.dir.length === 3) {
          const l = Math.hypot(e.dir[0], e.dir[1], e.dir[2]) || 1;
          ux = e.dir[0] / l; uy = e.dir[1] / l; uz = e.dir[2] / l;
        } else if (e.axis === 'y') { ux = 0; uy = 1; uz = 0; }
        const half = (e.w || 0) / 2;
        [1, -1].forEach((sgn) => {
          take({ x: e.x + ux * half * sgn, y: e.y + uy * half * sgn, z: e.z + uz * half * sgn },
            { x: ux * sgn, y: uy * sgn, z: uz * sgn }, e.bore, `${e.name} ${sgn > 0 ? '출구' : '입구'}`);
        });
      }
    });
    this.state.pipes.forEach((pipe) => {
      const pts = pipe.points || [];
      if (pts.length < 2) return;
      const a = pts[0];
      const b = pts[1];
      const z = pts[pts.length - 2];
      const y = pts[pts.length - 1];
      const u1 = { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
      const l1 = Math.hypot(u1.x, u1.y, u1.z) || 1;
      take(a, { x: u1.x / l1, y: u1.y / l1, z: u1.z / l1 }, pipe.bore, `${pipe.name} 시작`);
      const u2 = { x: y.x - z.x, y: y.y - z.y, z: y.z - z.z };
      const l2 = Math.hypot(u2.x, u2.y, u2.z) || 1;
      take(y, { x: u2.x / l2, y: u2.y / l2, z: u2.z / l2 }, pipe.bore, `${pipe.name} 끝`);
    });
    return best;
  }

  // ── ✂️ 직관 절단 길이 (v84) ──────────────────────────────────────────
  // 배관의 점 두 개 사이(pts[i-1]~pts[i])가 곧 **실제 직관**이다. 양 끝에 부속이 물려 있으면
  // 중심선은 그 부속의 중심~면 값만큼 더 길어진다. 절단 길이는 저장된 직관 길이 그대로다.
  //
  // fittingAt(p, dir, tol) — 그 점에 0mm로 물린 부속의 중심~접합면 값(m)과 이름.
  //  · 티 : 직진 C · 분기 M (store.js TEE_C / TEE_M — 이경 티는 분기가 짧다)
  //  · 레듀샤 : 전체 길이 H의 절반 · 엘보 : face(B) · 플랜지·밸브 : 면간의 절반
  //  (spec.w가 표와 달라도 메시·포트와 정확히 맞도록 중심→접합면 거리를 그대로 쓴다)
  fittingAt(p, dirV, opts) {
    if (!p) return null;
    const o = opts || {};
    const lim = o.tol == null ? 0.012 : o.tol;
    const extra = o.extra;
    const types = o.types || null;   // null = 모든 부속
    const list = extra && extra.length ? this.state.equipment.concat(extra) : this.state.equipment;
    let best = null;
    list.forEach((e) => {
      if (!e || !e.type || !EQUIP_TYPES[e.type]) return;
      if (types && !types.has(e.type)) return;
      // 장비(펌프·탱크·헤더·열교환기)는 배관을 이어 그리는 상대지 직관을 먹는 부속이 아니다.
      if (EQUIP_TYPES[e.type].cat === 'equip') return;
      equipConnectFaces(e).forEach((n) => {
        if (!n || !n.tip) return;
        const d = Math.hypot(n.tip.x - p.x, n.tip.y - p.y, n.tip.z - p.z);
        if (d > lim) return;
        // 배관 방향과 면의 바깥 방향이 나란해야 그 면에 물린 배관이다.
        if (dirV && n.axis) {
          const dot = n.axis.x * dirV.x + n.axis.y * dirV.y + n.axis.z * dirV.z;
          if (Math.abs(dot) < 0.9) return;
        }
        const value = Math.hypot(n.tip.x - e.x, n.tip.y - e.y, n.tip.z - e.z);
        if (!(value > 0.001)) return;
        if (best && d >= best.d) return;
        // 표시용 표준값 — 좌표가 mm로 반올림돼도 63.5mm처럼 표 값을 그대로 보여 준다.
        let std = value;
        if (e.type === 'tee') {
          const td = teeDims(e.bore1, e.bore2);
          std = n.nid === 'branch' ? td.M : td.C;
        } else if (e.type === 'reducer') {
          std = reducerDims(e.bore1, e.bore2).H / 2;
        } else if (e.type === 'elbow' || e.type === 'elbow45') {
          std = elbowDims(e.type, e.bore || '100A').face;
        }
        best = {
          d, value, std, spec: e, port: n, type: e.type,
          label: e.type === 'tee'
            ? (n.nid === 'branch' ? '티 분기' : '티 직진')
            : (EQUIP_TYPES[e.type].label || '부속'),
        };
      });
    });
    return best;
  }

  // 이어 그릴 때 **입력한 길이에서 빼는** 부속값 — 티·레듀샤만.
  //  (플랜지·밸브·90° 엘보는 접합면 기준으로 그려 왔다 — v78 사용자 확정:
  //   플랜지 끝에서 100mm라고 하면 직관 100mm다)
  fitAllowanceAt(p, dirV, extra, tol) {
    return this.fittingAt(p, dirV, { extra, tol, types: FIT_DEDUCT_TYPES });
  }

  // 한 구간의 절단 길이·중심선 길이와 양 끝에 물린 부속 값.
  segCutInfo(pipe, i) {
    const pts = (pipe && pipe.points) || [];
    const a = pts[i - 1];
    const b = pts[i];
    if (!a || !b) return null;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const cut = Math.hypot(dx, dy, dz);
    const dir = cut > 1e-6 ? { x: dx / cut, y: dy / cut, z: dz / cut } : null;
    const fa = this.fittingAt(a, dir);
    const fb = this.fittingAt(b, dir);
    const center = cut + (fa ? fa.std : 0) + (fb ? fb.std : 0);
    return { index: i, cut, center, fa, fb, bore: (pipe && pipe.bore) || '100A' };
  }

  // 배관 한 개의 절단 길이 합계 — 직관 합계와 중심선 합계.
  pipeCutTotals(pipe) {
    const pts = (pipe && pipe.points) || [];
    let cut = 0;
    let center = 0;
    for (let i = 1; i < pts.length; i += 1) {
      const s = this.segCutInfo(pipe, i);
      if (!s) continue;
      cut += s.cut;
      center += s.center;
    }
    return { cut, center };
  }

  // 속성 패널 — 구간별 `✂ 절단 길이` 목록 (양 끝 부속값 포함 중심선 길이도 함께)
  cutListHtml(pipe) {
    const pts = (pipe && pipe.points) || [];
    if (pts.length < 2) return '';
    const mm = (v) => Math.round(v * 1000);
    // 0.1mm까지 — 45° 엘보 63.5mm처럼 표 값이 정수가 아니면 소수 한 자리를 보여 준다.
    const mmx = (v) => {
      const n = Math.round(v * 1000 * 10) / 10;
      return Number.isInteger(n)
        ? n.toLocaleString()
        : n.toLocaleString(undefined, { minimumFractionDigits: 1 });
    };
    const rows = [];
    let cutSum = 0;
    let ctrSum = 0;
    for (let i = 1; i < pts.length; i += 1) {
      const s = this.segCutInfo(pipe, i);
      if (!s || s.cut < 0.001) continue;
      cutSum += s.cut;
      ctrSum += s.center;
      // 양 끝이 같은 부속이면 한 번만 "45° 엘보 63.5×2"로 적는다 — 좁은 칸에서 잘리지 않게.
      const fits = (s.fa && s.fb && s.fa.label === s.fb.label && Math.abs(s.fa.std - s.fb.std) < 0.0005)
        ? `${s.fa.label} ${mmx(s.fa.std)}×2`
        : [s.fa, s.fb].filter(Boolean).map((f) => `${f.label} ${mmx(f.std)}`).join(' + ');
      rows.push(`        <div class="cut-row">
          <span class="cut-idx">${i}</span>
          <b class="cut-val">✂ ${mm(s.cut).toLocaleString()}mm</b>
          <span class="cut-sub">중심선 ${mm(s.center).toLocaleString()}mm${fits ? ` · ${fits}` : ''}</span>
        </div>`);
    }
    if (!rows.length) return '';
    return `
        <div class="prop-section">✂️ 직관 절단 길이 (Cut)</div>
        <div class="cut-list">${rows.join('')}</div>
        <div class="cut-sum">직관 합계 <b>${mm(cutSum).toLocaleString()}mm</b>
          ${Math.abs(ctrSum - cutSum) > 0.0005 ? `· 중심선 합계 ${mm(ctrSum).toLocaleString()}mm` : ''}</div>`;
  }

  addFittingAtCursor(type) {
    const t = EQUIP_TYPES[type];
    const cur = { ...this.cmdCursor };
    // 커서가 접합면(플랜지 면·노즐 끝·배관 끝) 위에 있으면 그 면에 정확히 앉히고,
    // 진행 방향도 그 면의 축을 따른다 — 용접으로 바로 붙는 경우까지 빈틈없이.
    const port = this.portNearCursor(0.3);
    if (port) {
      cur.x = port.p.x;
      cur.y = port.p.y;
      cur.z = port.p.z;
    }
    const d = port ? { x: port.axis.x, y: port.axis.y, z: port.axis.z } : this.inlineDirAtCursor();
    // 관경 — 붙는 접합면(배관 끝·플랜지 면·노즐 끝)의 관경을 그대로 물려받는다.
    // (예전에는 명령창 관경을 썼기 때문에, 80A 배관 끝에 100A 플랜지가 붙는 일이 있었다 — 2026-11-25 `31563` 캡처)
    const portBore = port && port.bore && BORES[port.bore] ? port.bore : null;
    const bore = portBore || this.inheritedBore();
    const elbow = type === 'elbow' || type === 'elbow45';
    const same = this.state.equipment.filter((e) => e.type === type).length;
    const spec = makeEquipment(type, {
      name: `${t.short}-${100 + same + 1} ${t.label}`,
      x: cur.x, y: cur.y, z: cur.z,
      bore, bore1: bore,
      conn: this.cmdConn,
      ...(elbow ? {} : { dir: [d.x, d.y, d.z] }),
    });
    let out = d;
    let face = 0;
    if (elbow) {
      face = elbowDims(type, spec.bore || bore).face;
      // 진입 방향(d)은 접합면의 진행 축 — 조이스틱으로 고른 방향은 **출구**로 쓴다.
      // (예전에는 조이스틱 ←을 무시하고 수직관이면 언제나 +X로 꺾어, 플랜지 위 엘보가
      //  엉뚱한 쪽으로 나갔다 — 2026-11-25 `31552` 캡처)
      const pick = this.padDirV();
      const dot = pick ? pick.x * d.x + pick.y * d.y + pick.z * d.z : 0;
      // 고른 방향이 진입 축과 나란하면(같거나 반대) 꺾임이 없으므로 예전처럼 자동으로 꺾는다.
      const pick90 = pick && Math.abs(dot) < 0.7 ? pick : null;
      if (type === 'elbow45') {
        // 45° — 고른 방향이 있으면 접합면 진행 방향(d)과 그 방향 사이의 45° 대각선이 출구.
        const base = pick90 || this.turnDirFor(d);
        const diag = pick90
          ? { x: d.x + base.x, y: d.y + base.y, z: d.z + base.z }
          : base;
        const dl = Math.hypot(diag.x, diag.y, diag.z) || 1;
        out = { x: r3(diag.x / dl), y: r3(diag.y / dl), z: r3(diag.z / dl) };
      } else {
        out = pick90 || this.turnDirFor(d);
      }
      spec.inDir = [-d.x, -d.y, -d.z];
      spec.outDir = [out.x, out.y, out.z];
      spec.x = r3(cur.x + d.x * face);
      spec.y = Math.max(0, r3(cur.y + d.y * face));
      spec.z = r3(cur.z + d.z * face);
    } else {
      // 티는 본관 절반 길이(중심~직진 끝 C)가 곧 접합면 — 중심을 그만큼 앞에 둬야 들어오는 면이 커서에 딱 닿는다.
      // (v84 — 예전에는 2.6×외경/2라는 어림값이라 100A 티가 44mm 더 앞에 섰다)
      face = type === 'tee'
        ? teeDims(spec.bore1, spec.bore2).C
        : Math.max(0, (spec.w || 0) / 2);
      spec.x = r3(cur.x + d.x * face);
      spec.y = Math.max(0, r3(cur.y + d.y * face));
      spec.z = r3(cur.z + d.z * face);
    }
    this.pushUndo(t.label + ' 이어 붙이기');
    this.state.equipment.push(spec);
    this.lastAdded = { kind: 'equipment', id: spec.id };
    this.selection = { kind: 'equipment', id: spec.id };
    this.rebuild();
    // 커서를 부속 출구 끝으로 — 바로 다음 배관을 이어 그린다.
    const tip = {
      x: r3(spec.x + out.x * face),
      y: Math.max(0, r3(spec.y + out.y * face)),
      z: r3(spec.z + out.z * face),
    };
    this.cmdAxis = Math.abs(out.x) >= Math.abs(out.y) && Math.abs(out.x) >= Math.abs(out.z) ? 'x'
      : (Math.abs(out.z) >= Math.abs(out.y) ? 'z' : 'y');
    this.cmdSign = (this.cmdAxis === 'x' ? out.x : this.cmdAxis === 'z' ? out.z : out.y) < 0 ? -1 : 1;
    this.cmdRot = this.cmdRotFor(this.cmdAxis, this.cmdSign);
    this.lastDirV = { x: out.x, y: out.y, z: out.z };
    // 붙은 부속의 관경을 그대로 다음 배관에 잇는다 (v74 — 예전에는 직접 대입해 표시가 어꿋났다).
    this.setCmdBore(this.aimBoreOf(spec), true);
    this.setCmdCursor(tip, true);
    this.toast(`${t.label}을(를) 배관 끝에 이어 붙였습니다 · 커서 (${fmt(tip.x)}, ${fmt(tip.y)}, ${fmt(tip.z)})m`);
  }

  deleteSelected() {
    const items = this.selectedSpecs();
    if (!items.length) return;
    const n = items.length;
    this.pushUndo(n > 1 ? `${n}개 삭제` : '삭제: ' + items[0].spec.name);
    const pipeIds = new Set();
    const eqIds = new Set();
    items.forEach(({ sel, spec }) => {
      if (sel.kind === 'pipe' || Array.isArray(spec.points)) pipeIds.add(spec.id);
      else eqIds.add(spec.id);
    });
    this.state.pipes = this.state.pipes.filter((p) => !pipeIds.has(p.id));
    this.state.equipment = this.state.equipment.filter((e) => !eqIds.has(e.id));
    this.selection = null;
    this.multiSel = [];
    this.multiMode = false;
    this.rebuild();
    this.toast(n > 1 ? `${n}개를 삭제했습니다` : `삭제했습니다 · ${items[0].spec.name}`,
      { action: '되돌리기', onAction: () => this.undo() });
  }

  duplicateSelected() {
    const spec = this.getSelectedSpec();
    if (!spec || this.selection.kind !== 'equipment') return;
    this.pushUndo('복제: ' + spec.name);
    const copy = makeEquipment(spec.type, {
      ...spec, x: spec.x + 0.8, name: spec.name + ' (복제)',
    });
    // 복제한 계기도 배관 외벽에 다시 붙인다(니쁠이 허공을 향하지 않게).
    if (copy.type === 'gauge') attachGaugeToPipe(this.state.pipes, copy);
    this.state.equipment.push(copy);
    this.selection = { kind: 'equipment', id: copy.id };
    this.rebuild();
    this.toast('장비를 복제했습니다.');
  }

  // ── 복사 · 붙여넣기 (v72) ────────────────────────────────────────────────
  // 펌프·탱크는 나란히 여러 대 놓는 일이 많다. 고른 장비의 사양(관경·노즐 배치·회전·
  // 색·헤드 타입…)을 통째로 기억해 두고, [📌 붙여넣기]로 바로 옆에 같은 것을 세운다.
  // 이름은 같은 꼬리표의 마지막 번호 +1 (PUMP-101 → PUMP-102).
  copySelected() {
    const spec = this.getSelectedSpec();
    if (!spec) { this.toast('복사할 장비·배관을 먼저 고르세요.', { type: 'err' }); return; }
    const isPipe = Array.isArray(spec.points);
    this.clipboard = {
      kind: isPipe ? 'pipe' : 'equipment',
      id: spec.id,
      spec: JSON.parse(JSON.stringify(spec)),
    };
    this.renderProps();
    this.toast(`📋 ${spec.name} 복사됨 — [📌 붙여넣기]로 바로 옆에 붙이세요.`);
  }

  // 이름의 마지막 번호를 하나 올린다 — 같은 앞뒤 글자를 쓰는 이름 중 가장 큰 번호 +1.
  nextCopyName(name) {
    const s = String(name || '');
    const m = s.match(/^(.*?)(\d+)(\D*)$/);
    if (!m) return s ? `${s} (2)` : s;
    const prefix = m[1];
    const digits = m[2];
    const suffix = m[3];
    let max = Number(digits);
    const lists = [this.state.equipment, this.state.pipes];
    lists.forEach((ls) => (ls || []).forEach((x) => {
      const mm = String(x.name || '').match(/^(.*?)(\d+)(\D*)$/);
      if (!mm || mm[1] !== prefix || mm[3] !== suffix) return;
      max = Math.max(max, Number(mm[2]));
    }));
    return `${prefix}${String(max + 1).padStart(digits.length, '0')}${suffix}`;
  }

  // 붙일 자리 — 원본이 아직 있으면 그 옆, 없으면 지금 고른 것 옆, 그것도 없으면 커서.
  // 긴 축을 따라 나란히 세우고(펌프·헤더), 이미 다른 장비가 있으면 한 칸씩 더 밀어 놓는다.
  pasteSpot(src) {
    const live = this.state.equipment.find((e) => e.id === (this.clipboard && this.clipboard.id));
    const sel = this.getSelectedSpec();
    const anchor = live || (sel && !Array.isArray(sel.points) ? sel : null);
    const w = Math.max(0.2, Number(src.w) || 0.6);
    const d = Math.max(0.2, Number(src.d) || 0.6);
    // 짧은 쪽(보통 깊이)을 따라 나란히 — 펌프는 옆으로, 탱크는 앞뒤로 줄을 선다.
    const alongZ = d <= w;
    const step = (alongZ ? d : w) + 0.4;
    const base = anchor ? { x: anchor.x, z: anchor.z } : { x: this.cmdCursor.x, z: this.cmdCursor.z };
    const hit = (x, z) => this.state.equipment.some((e) => Math.abs(e.x - x) < (w + Number(e.w || 0)) / 2 + 0.15
      && Math.abs(e.z - z) < (d + Number(e.d || 0)) / 2 + 0.15);
    let x = base.x;
    let z = base.z;
    for (let i = 0; i < 8; i += 1) {
      if (alongZ) z = base.z + step * (i + 1); else x = base.x + step * (i + 1);
      if (!hit(x, z)) break;
    }
    return { x, z, alongZ };
  }

  pasteClipboard() {
    const cb = this.clipboard;
    if (!cb || !cb.spec) {
      this.toast('복사한 것이 없습니다 — 먼저 [📋 복사]를 누르세요.', { type: 'err' });
      return;
    }
    const src = cb.spec;
    // ☑️ 여러 개 한꺼번에 붙여넣기 — 고른 것 전부를 x로 1m 옆에 그대로 한 벌 더.
    if (cb.kind === 'group' && Array.isArray(cb.specs)) {
      this.pushUndo(`${cb.specs.length}개 붙여넣기`);
      const dx = 1.0;
      const made = [];
      cb.specs.forEach((it) => {
        const s = it.spec;
        if (it.kind === 'pipe' || Array.isArray(s.points)) {
          const pipe = makePipe({
            name: this.nextCopyName(s.name),
            bore: s.bore,
            material: s.material,
            conn: s.conn,
            points: s.points.map((p) => ({ x: r3(p.x + dx), y: Math.max(0, p.y), z: p.z })),
          });
          this.state.pipes.push(pipe);
          made.push({ kind: 'pipe', id: pipe.id });
          return;
        }
        const copy = makeEquipment(s.type, {
          ...s, id: undefined, x: r3((s.x || 0) + dx), name: this.nextCopyName(s.name),
        });
        if (copy.type === 'gauge') attachGaugeToPipe(this.state.pipes, copy);
        this.state.equipment.push(copy);
        made.push({ kind: 'equipment', id: copy.id });
      });
      this.selection = made[0] || null;
      this.multiSel = made.slice(1);
      this.multiMode = made.length > 1;
      this.rebuild();
      this.toast(`📌 ${made.length}개 붙여넣음 · 옆으로 1m`);
      return;
    }
    const spot = this.pasteSpot(src);
    this.pushUndo('붙여넣기');
    if (cb.kind === 'pipe' || Array.isArray(src.points)) {
      // 배관 — 점 전체를 1m 옆으로 옮긴 채 같은 관경·재질·연결로 붙인다.
      const dx = 1.0;
      const pipe = makePipe({
        name: this.nextCopyName(src.name),
        bore: src.bore,
        material: src.material,
        conn: src.conn,
        points: src.points.map((p) => ({ x: r3(p.x + dx), y: Math.max(0, p.y), z: p.z })),
      });
      this.state.pipes.push(pipe);
      this.selection = { kind: 'pipe', id: pipe.id };
      this.rebuild();
      this.renderProps();
      this.renderLists();
      this.toast(`📌 ${pipe.name} 붙여넣음 · 옆으로 1m`);
      return;
    }
    const copy = makeEquipment(src.type, {
      ...src,
      id: undefined,
      x: spot.x,
      z: spot.z,
      name: this.nextCopyName(src.name),
    });
    if (copy.type === 'gauge') attachGaugeToPipe(this.state.pipes, copy);
    this.state.equipment.push(copy);
    // 다음 붙여넣기도 이 새 장비 옆으로 이어지게 원본을 새 장비로 바꿔 둔다.
    this.clipboard = { kind: 'equipment', id: copy.id, spec: JSON.parse(JSON.stringify(copy)) };
    this.selection = { kind: 'equipment', id: copy.id };
    this.lastAdded = { kind: 'equipment', id: copy.id };
    this.rebuild();
    this.refreshHighlight();
    this.renderProps();
    this.renderLists();
    this.toast(`📌 ${copy.name} 붙여넣음 · ${spot.alongZ ? '앞뒤' : '좌우'}로 나란히 (${fmt(copy.x)}, ${fmt(copy.z)})m`);
  }

  // "지워/삭제/빼" — 선택한 것, 없으면 방금 추가한 것
  deleteLast(op) {
    const o = op || {};
    if (o.id || o.name) {
      const eq = this.state.equipment.find((e) => e.id === o.id || (o.name && e.name === o.name));
      const pp = this.state.pipes.find((p) => p.id === o.id || (o.name && p.name === o.name));
      const target = eq || pp;
      if (target) {
        this.selection = { kind: eq ? 'equipment' : 'pipe', id: target.id };
        this.deleteSelected();
        return;
      }
    }
    if (this.selection) { this.deleteSelected(); return; }
    const la = this.lastAdded;
    if (la) {
      const list = la.kind === 'pipe' ? this.state.pipes : this.state.equipment;
      if (list.some((x) => x.id === la.id)) {
        this.selection = { kind: la.kind, id: la.id };
        this.deleteSelected();
        return;
      }
    }
    if (this.state.pipes.length) {
      this.selection = { kind: 'pipe', id: this.state.pipes[this.state.pipes.length - 1].id };
      this.deleteSelected();
      return;
    }
    if (this.state.equipment.length) {
      this.selection = { kind: 'equipment', id: this.state.equipment[this.state.equipment.length - 1].id };
      this.deleteSelected();
      return;
    }
    this.toast('지울 것이 없습니다.');
  }

  // 🗑️ 새 도면 — 장비·배관을 모두 비우고 커서를 원점 (0, 0.5, 0)으로. 실행취소 한 번이면 되돌아온다.
  clearAll(opts) {
    const o = opts || {};
    this.closeHandDim();
    this.pushUndo(o.label || '새 도면');
    this.state.equipment = [];
    this.state.pipes = [];
    this.state.name = '내 배관 도면';
    this.selection = null;
    this.lastDirV = null;
    this.cmdBore = '50A';
    this.cmdMaterial = 'carbon';
    this.cmdConn = 'none';
    this.cmdAxis = 'x';
    this.cmdSign = 1;
    this.cmdRot = 0;
    this.setCmdCursor({ x: 0, y: 0.5, z: 0 }, false);
    this.rebuild();
    if (!o.silent) {
      this.toast('새 도면 — 장비·배관을 모두 지웠습니다.', { action: '되돌리기', onAction: () => this.undo() });
    }
  }

  // "옮겨" — 이름/ID로 장비·배관 위치 이동 (AI 명령 폴백용)
  moveTarget(op) {
    const o = op || {};
    const eq = this.state.equipment.find((e) => e.id === o.id || (o.name && e.name === o.name));
    const pp = this.state.pipes.find((p) => p.id === o.id || (o.name && p.name === o.name));
    if (!eq && !pp) { this.toast('옮길 대상을 찾지 못했습니다.', { type: 'err' }); return; }
    this.pushUndo('이동');
    if (eq) {
      if (Number.isFinite(Number(o.x))) eq.x = Number(o.x);
      if (Number.isFinite(Number(o.y))) eq.y = Math.max(0, Number(o.y));
      if (Number.isFinite(Number(o.z))) eq.z = Number(o.z);
    } else {
      const dx = Number.isFinite(Number(o.x)) ? Number(o.x) - pp.points[0].x : 0;
      const dy = Number.isFinite(Number(o.y)) ? Number(o.y) - pp.points[0].y : 0;
      const dz = Number.isFinite(Number(o.z)) ? Number(o.z) - pp.points[0].z : 0;
      pp.points = pp.points.map((p) => ({ x: r3(p.x + dx), y: Math.max(0, r3(p.y + dy)), z: r3(p.z + dz) }));
    }
    this.selection = null;
    this.rebuild();
    this.toast('옮겼습니다.', { action: '되돌리기', onAction: () => this.undo() });
  }

  nextPipeName() {
    const n = this.state.pipes.length + 1;
    return `PL-${String(n).padStart(3, '0')} 새 배관`;
  }

  // ── 배관 그리기 ──────────────────────────────────────────
  setDrawMode(on) {
    this.drawMode = on;
    $('#drawHud').hidden = !on;
    $('#cmdForm').hidden = on; // 그리기 HUD와 자리를 비켜 준다
    if (on) this.setPadOpen(false);
    $('#btnDrawPipe').textContent = on ? '그리기 취소' : '3D에서 배관 그리기';
    if (!on) {
      this.draft = [];
      this.updateDraft();
    } else {
      this.clearSelection();
      $('#draftHeight').value = String(this.draftHeight);
      if (window.innerWidth <= 860) this.setDrawerOpen(false);
      this.toast('배관 그리기: 바닥을 터치해 점을 찍으세요.');
    }
  }

  addDraftPoint(point) {
    this.draftHeight = parseFloat($('#draftHeight').value) || 0;
    this.draft.push({
      x: Math.round(point.x * 20) / 20,
      y: this.draftHeight,
      z: Math.round(point.z * 20) / 20,
    });
    this.updateDraft();
  }

  updateDraft() {
    while (this.draftGroup.children.length) {
      const c = this.draftGroup.children.pop();
      if (c.geometry) c.geometry.dispose();
    }
    $('#draftCount').textContent = String(this.draft.length);
    if (!this.draft.length) return;

    this.draft.forEach((p) => {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), this.draftMat);
      s.position.set(p.x, p.y, p.z);
      this.draftGroup.add(s);
      if (p.y > 0.02) {
        const g = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(p.x, 0, p.z), new THREE.Vector3(p.x, p.y, p.z),
        ]);
        this.draftGroup.add(new THREE.Line(g, this.draftLineMat));
      }
    });

    if (this.draft.length >= 2) {
      const g = new THREE.BufferGeometry().setFromPoints(
        this.draft.map((p) => new THREE.Vector3(p.x, p.y, p.z)),
      );
      this.draftGroup.add(new THREE.Line(g, this.draftLineMat));
    }
  }

  finishDraft() {
    if (this.draft.length < 2) {
      this.toast('점을 2개 이상 찍어야 배관이 만들어집니다.');
      return;
    }
    const spec = makePipe({
      name: this.nextPipeName(),
      bore: $('#newBore').value,
      material: $('#newMaterial').value,
      points: this.draft.slice(),
    });
    this.pushUndo('배관 추가');
    this.state.pipes.push(spec);
    this.draft = [];
    this.setDrawMode(false);
    this.selection = { kind: 'pipe', id: spec.id };
    this.rebuild();
    this.toast(`배관 생성 · ${fmt(pipeLength(spec.points))}m`);
  }

  // ── mm 한 줄 배관 명령 ──────────────────────────────────
  // 노란 커서 — 작은 반투명 점 + 얇은 링 + 정확한 위치를 짚는 작은 심.
  // 예전에는 반지름 70mm(지름 140mm) 공 하나라서 50A(외경 60.5mm) 배관 끝과 플랜지를
  // 통째로 가렸다(2026-11-23 사용자 지적). 크기는 화면에서 늘 비슷하게 보이도록
  // 카메라 거리에 비례해 줄이고(updateCmdMarkerScale), 뒤 형상은 점 사이로 비쳐 보인다.
  setupCmdCursor() {
    const g = new THREE.Group();
    // 뒤 형상이 비치는 반투명 점
    this.cmdDot = new THREE.Mesh(
      new THREE.SphereGeometry(1, 14, 10),
      new THREE.MeshBasicMaterial({ color: 0xf5a623, transparent: true, opacity: 0.34, depthTest: false, depthWrite: false }),
    );
    this.cmdDot.renderOrder = 998;
    g.add(this.cmdDot);
    // 정확한 커서 위치를 짚는 작은 심 (불투명)
    this.cmdPin = new THREE.Mesh(
      new THREE.SphereGeometry(0.34, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xf5a623, depthTest: false, depthWrite: false }),
    );
    this.cmdPin.renderOrder = 999;
    g.add(this.cmdPin);
    // 얇은 링 — 점이 작아도 한눈에 찾아지게 (늘 카메라를 본다)
    this.cmdRing = new THREE.Mesh(
      new THREE.RingGeometry(1.5, 1.9, 32),
      new THREE.MeshBasicMaterial({ color: 0xffb020, transparent: true, opacity: 0.8, depthTest: false, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.cmdRing.renderOrder = 1000;
    g.add(this.cmdRing);
    g.visible = false;
    this.cmdMarker = g;
    this.scene.add(this.cmdMarker);
    this.updateCmdMarker();
  }

  updateCmdMarker() {
    if (!this.cmdMarker) return;
    const c = this.cmdCursor;
    this.cmdMarker.position.set(c.x, c.y, c.z);
    // 손 그리기 중에는 시작점 표시(handAnchorDot)가 그 자리를 보여 주므로 주황 커서는 숨긴다.
    this.cmdMarker.visible = !!this.cmdMarked && !this.handMode;
    this.updateCmdMarkerScale();
  }

  // 커서 크기 — 보는 거리에 맞춰 늘 화면에서 ~14px 지름(링 ~27px)이 되게 한다.
  // 가까이 확대해도 커서가 커지지 않아 소구경 배관 끝·플랜지·밸브를 가리지 않는다.
  updateCmdMarkerScale() {
    if (!this.cmdMarker || !this.cmdMarker.visible) return;
    const d = this.camera.position.distanceTo(this.cmdMarker.position);
    const R = Math.min(0.11, Math.max(0.01, d * 0.0075));
    this.cmdMarker.scale.setScalar(R);
    this.cmdMarker.quaternion.copy(this.camera.quaternion);   // 링이 배관이 아니라 화면을 향한다
    this.cmdMarker.userData.R = R;                               // 검증용
  }

  setCmdCursor(p, mark) {
    this.cmdCursor = {
      x: Math.round(Number(p.x) * 1000) / 1000,
      y: Math.round(Math.max(0, Number(p.y)) * 1000) / 1000,
      z: Math.round(Number(p.z) * 1000) / 1000,
    };
    if (mark) this.cmdMarked = true;
    this.updateCmdMarker();
    this.updatePadInfo();
  }

  // 지금 그리는 수평 방향 (45° 경사·패드 90° 돌리기에 쓴다)
  heading() {
    if (this.cmdAxis !== 'y') return { axis: this.cmdAxis, sign: this.cmdSign };
    if (this.cmdRot === 90) return { axis: 'z', sign: 1 };
    if (this.cmdRot === 180) return { axis: 'x', sign: -1 };
    if (this.cmdRot === 270) return { axis: 'z', sign: -1 };
    return { axis: 'x', sign: 1 };
  }

  // 부속·장비는 커서(마지막 끝점) 위치에, 진행 방향(lastDir)에 맞춰 놓는다.
  cmdRotFor(axis, sign) {
    if (axis === 'x') return sign > 0 ? 0 : 180;
    if (axis === 'z') return sign > 0 ? 90 : 270;
    return this.cmdRot; // 수직 이동 중에는 직전 수평 방향 유지
  }

  // 명령 입력칸 초점 — 모바일 키보드가 내려가지 않게 유지한다(연속 명령).
  focusCmdInput() {
    const input = $('#cmdInput');
    if (!input) return;
    try { input.focus({ preventScroll: true }); } catch (e) { input.focus(); }
  }

  // 3D 그림창을 터치했을 때 — 입력칸이 초점을 잡고 있으면 놓아 키보드를 즉시 내린다.
  blurCmdInput() {
    const input = $('#cmdInput');
    if (input && document.activeElement === input) input.blur();
  }

  // 속성 창 밖(명령창·설정 등)에 초점이 남아 있으면 놓아 준다.
  // (창 안에서 치수를 고치는 중이면 건드리지 않는다)
  blurForeignInput() {
    const ae = document.activeElement;
    if (!ae || !/INPUT|TEXTAREA|SELECT/.test(ae.tagName || '')) return;
    const panel = $('#props');
    if (panel && panel.contains(ae)) return;
    ae.blur();
  }

  // ── 모바일 고스트 클릭 방어 ──────────────────────────────
  // 3D에서 장비를 톡 누르면 그 pointerup 자리에서 속성 창이 열린다. 모바일 브라우저(안드로이드
  // 크롬·삼성 인터넷·iOS 사파리)는 그 터치를 마우스 클릭으로도 한 번 더 보내는데(호환 클릭),
  // 새로 열린 창이 그 자리를 덮고 있어서 그 click이 '이름' 칸에 그대로 꽂혀 키보드가 올라왔다.
  //  ① 창을 연 직후 350ms : 창 안의 터치·클릭·초점을 통째로 막는다.
  //  ② 그 뒤 900ms까지     : 창 안을 직접 누른 적 없는(앞선 pointerdown이 없는) 마우스 클릭과
  //                          그로 인한 초점만 막는다 — 기기·브라우저에 따라 호환 클릭이 500ms쯤
  //                          늦게 도착하기 때문. 직접 누른 탭은 ②에서도 그대로 통과한다.
  guardPropsFromGhostTap(ms = 350, ghostMs = 900) {
    const panel = $('#props');
    if (!panel || panel.hidden) return;
    const now = performance.now();
    this.propsGuardUntil = now + ms;
    this.propsGhostUntil = now + Math.max(ghostMs, ms);
    this.propsRealDownAt = 0;
    const drop = () => {
      const ae = document.activeElement;
      if (!ae || !panel.contains(ae)) return;
      if (!/INPUT|TEXTAREA|SELECT/.test(ae.tagName || '')) return;
      try { ae.blur(); } catch (e) { /* ignore */ }
    };
    // 이미 잡힌 초점이 있으면 즉시, 관통한 click이 다음 틱에 초점을 잡으면 그때 한 번 더 놓는다.
    drop();
    if (this.propsGuardRaf) cancelAnimationFrame(this.propsGuardRaf);
    this.propsGuardRaf = requestAnimationFrame(() => { this.propsGuardRaf = 0; drop(); });
    if (this.propsGuardTimer) clearTimeout(this.propsGuardTimer);
    this.propsGuardTimer = setTimeout(() => {
      this.propsGuardTimer = 0;
      drop();
    }, ms);
  }

  runCommandLine(raw) {
    const text = String(raw || '').trim();
    this.lastRawCommand = text;
    const { ops, unknown } = parseCommand(text);
    // 조이스틱에서 방향을 골라 둔 상태 — 길이(숫자)만 치고 실행하면 그 방향으로 그린다.
    if (this.pending) {
      const onlyLen = ops.length === 1 && ops[0].op === 'seg' && ops[0].loose;
      if (!ops.length || onlyLen) {
        if (unknown.length) { this.toast(`일부만 알아들었습니다 · ${unknown.join(' ')}`, { type: 'err' }); return; }
        const meters = onlyLen ? ops[0].meters : this.padLen / 1000;
        if (!(meters > 0)) { this.toast('길이(mm)를 숫자로 넣어 주세요. 예: 1000', { type: 'err' }); return; }
        this.padDraw(this.pending, meters);
        return;
      }
    }
    if (!text) return;
    if (!ops.length) {
      this.naturalCommand(text, unknown);
      return;
    }
    if (unknown.length) this.toast(`일부만 알아들었습니다 · ${unknown.join(' ')}`, { type: 'err' });
    this.execOps(ops, { source: 'cmd' });
  }

  // ── 자유로운 말 → 명령 (로컬 파서가 못 알아들었을 때만 Gemini 사용) ──
  sceneSummary() {
    return {
      cursor: { ...this.cmdCursor },
      bore: this.cmdBore,
      material: this.cmdMaterial,
      equipment: this.state.equipment.slice(0, 40).map((e) => ({
        id: e.id, type: e.type, name: e.name, x: e.x, y: e.y, z: e.z, rot: e.rot, w: e.w,
        bore1: e.bore1 || null, bore2: e.bore2 || null, conn: connOf(e),
      })),
      pipes: this.state.pipes.slice(0, 40).map((p) => ({
        id: p.id, name: p.name, bore: p.bore, material: p.material, points: p.points, conn: connOf(p),
      })),
    };
  }

  // Gemini가 돌려준 동작 JSON을 앱 내부 op로 바꾼다.
  toOps(list) {
    const OUT = [];
    const DIRS = { '오른쪽': ['x', 1], '우': ['x', 1], '왼쪽': ['x', -1], '좌': ['x', -1], '위': ['y', 1], '아래': ['y', -1], '앞': ['z', 1], '뒤': ['z', -1] };
    (Array.isArray(list) ? list : []).forEach((o) => {
      if (!o || !o.op) return;
      const mm = Number(o.mm);
      if (o.op === 'seg') {
        let axis = ['x', 'y', 'z'].includes(o.axis) ? o.axis : null;
        let sign = Number(o.sign) || 1;
        if (!axis && DIRS[o.dir]) { axis = DIRS[o.dir][0]; sign = DIRS[o.dir][1]; }
        if (axis && Number.isFinite(mm) && mm > 0) OUT.push({ op: 'seg', axis, sign, meters: mm / 1000 });
      } else if (o.op === 'diag') {
        if (Number.isFinite(mm) && mm > 0) {
          OUT.push({
            op: 'diag',
            axis: ['x', 'z'].includes(o.axis) ? o.axis : null,
            sign: Number(o.sign) || 1,
            vert: Number(o.vert) < 0 ? -1 : 1,
            angle: Number(o.angle) || 45,
            meters: mm / 1000,
          });
        }
      } else if (o.op === 'bore') {
        if (BORES[o.bore]) OUT.push({ op: 'bore', bore: o.bore });
      } else if (o.op === 'material') {
        if (MATERIALS[o.material]) OUT.push({ op: 'material', material: o.material });
      } else if (o.op === 'conn') {
        OUT.push({ op: 'conn', conn: connOf({ conn: o.conn }) });
      } else if (o.op === 'equip') {
        if (EQUIP_TYPES[o.type]) {
          OUT.push({
            op: 'equip', type: o.type, size1: o.bore1, size2: o.bore2,
            ...(o.conn === 'forged' ? { conn: 'forged' } : {}),
          });
        }
      } else if (o.op === 'connect') {
        OUT.push({
          op: 'connect',
          target: o.target === 'pipe' ? 'pipe' : 'equip',
          type: EQUIP_TYPES[o.type] ? o.type : null,
          axis: ['x', 'y', 'z'].includes(o.axis) ? o.axis : null,
          sign: Number(o.sign) || 1,
        });
      } else if (o.op === 'delete') {
        OUT.push({ op: 'delete', id: o.id || null, name: o.name || null });
      } else if (o.op === 'move') {
        OUT.push({ op: 'move', id: o.id || null, name: o.name || null, x: o.x, y: o.y, z: o.z });
      } else if (o.op === 'newpipe' || o.op === 'undo' || o.op === 'reset') {
        OUT.push({ op: o.op });
      }
    });
    return OUT;
  }

  async naturalCommand(text, unknown) {
    const key = this.apiKey();
    if (!key) {
      this.toast(
        `명령을 이해하지 못했습니다${unknown && unknown.length ? ' · ' + unknown.join(' ') : ''}. 설정에서 Gemini API 키를 넣으면 "밸브 하나 달아줘" 같은 자유로운 말도 알아듣습니다.`,
        { type: 'err', action: 'API 키 넣기', onAction: () => this.openSettings() },
      );
      return;
    }
    if (this.aiRunning) { this.toast('AI가 아직 처리 중입니다. 끝나면 다시 말해 주세요.'); return; }
    this.aiRunning = true;
    this.acquireWakeLock();
    this.showAiProgress();
    try {
      const planned = await planCommand({ apiKey: key, model: this.model(), text, scene: this.sceneSummary() });
      const ops = this.toOps(planned.ops);
      if (!ops.length) {
        this.toast(planned.say || '문장을 명령으로 바꾸지 못했습니다. 조금 더 구체적으로 말해 주세요.', { type: 'err' });
        return;
      }
      this.execOps(ops, { source: 'ai' });
      if (planned.say) this.toast(`🤖 ${planned.say}`);
    } catch (e) {
      this.openModal({
        title: '자유 명령 해석 실패',
        body: `<p class="err-text">${esc(e.message || e)}</p>
               <p class="hint">API 키와 모델을 확인하거나, 명령 예시처럼 짧게 말해 보세요. (예: <code>밸브 하나 달아줘</code>)</p>`,
        actions: [
          { label: '설정 열기', keep: true, onClick: () => this.openSettings() },
          { label: '닫기', cls: 'accent' },
        ],
      });
    } finally {
      this.aiRunning = false;
      this.releaseWakeLock();
      this.hideAiProgress();
    }
  }

  // ── 방향 기준: 내 시점 / 도면 축 ─────────────────────────
  // 카메라의 수평 전방·우측 벡터를 가장 가까운 90° 축으로 스냅한다.
  viewBasis() {
    const f = new THREE.Vector3();
    this.camera.getWorldDirection(f);
    f.y = 0;
    if (f.lengthSq() < 1e-8) f.set(0, 0, -1);
    f.normalize();
    const fwd = Math.abs(f.x) >= Math.abs(f.z)
      ? { axis: 'x', sign: f.x >= 0 ? 1 : -1 }
      : { axis: 'z', sign: f.z >= 0 ? 1 : -1 };
    // 화면 오른쪽 = 카메라 전방 × 위(0,1,0) = (−fz, 0, fx)
    const right = fwd.axis === 'x'
      ? { axis: 'z', sign: f.x >= 0 ? 1 : -1 }
      : { axis: 'x', sign: -f.z >= 0 ? 1 : -1 };
    return { fwd, right };
  }

  // 명령·패드가 말하는 방향(도면 축 x/z) → 실제 월드 축
  dirToWorld(axis, sign) {
    const s = sign < 0 ? -1 : 1;
    if (this.dirFrame !== 'me' || axis === 'y') return { axis, sign: s };
    const b = this.viewBasis();
    const t = axis === 'z' ? b.fwd : b.right;
    return { axis: t.axis, sign: t.sign * s };
  }

  // 월드 방향 벡터 → 부속 rot(도)
  rotForDir(v, fallback) {
    const ax = Math.abs(v.x) >= Math.abs(v.z) ? 'x' : 'z';
    const s = ax === 'x' ? v.x : v.z;
    if (Math.abs(s) < 0.2) return fallback == null ? this.cmdRot : fallback;
    return this.cmdRotFor(ax, s > 0 ? 1 : -1);
  }

  // 명령 뒤에 오는 첫 이동 op (엘보 명시 여부를 미리 보기)
  nextMoveOp(list, from) {
    for (let j = from + 1; j < list.length; j += 1) {
      const o = list[j];
      if (o.op === 'seg' || o.op === 'diag') return o;
      if (o.op === 'equip' || o.op === 'delete' || o.op === 'reset' || o.op === 'undo' || o.op === 'connect') return null;
    }
    return null;
  }

  // 명령·패드가 함께 쓰는 실행기. 커서·관경·재질·방향을 이어받아 그림을 그리고,
  // 끝나면 커서를 다음 명령이 이어 쓸 수 있게 남겨 둔다.
  execOps(ops, opts) {
    if (!ops || !ops.length) return null;
    let cursor = { ...this.cmdCursor };
    let bore = this.cmdBore;
    let material = this.cmdMaterial;
    let conn = connOf({ conn: this.cmdConn });
    let rot = this.cmdRot;
    let axis = this.cmdAxis;
    let sign = this.cmdSign;
    let pts = null;
    let pipeSeq = this.state.pipes.length;
    const pipes = [];
    const equip = [];
    const edits = [];       // 이미 있던 배관 끝을 엘보 자리만큼 당기는 수정
    const equipSeq = {};
    const notes = [];
    let prevDir = null;     // 이번 명령에서 마지막으로 그린 구간의 진행 방향
    let equipDir = null;    // 명령 첫 부속의 진행 방향(뒤따르는 이동에서 미리 알아낸 것)
    let wantElbow = null;   // "엘보써서 위로 1000" — 다음 꺾임에 쓸 엘보

    const put = (p) => ({ x: r3(p.x), y: Math.max(0, r3(p.y)), z: r3(p.z) });

    const flush = () => {
      if (pts && pts.length >= 2) {
        pipeSeq += 1;
        pipes.push(makePipe({
          name: `PL-${String(pipeSeq).padStart(3, '0')} 새 배관`,
          bore, material, conn, points: pts.slice(),
        }));
      }
      pts = null;
    };

    // 커서에 닿아 있는 **직전 배관 구간**을 찾는다 — 이 명령에서 그린 배관(아직 커밋 전) →
    // 이미 놓인 배관 순서로 본다. 끝점뿐 아니라 시작점(양쪽 끝 이어 그리기)도 본다.
    // 되돌아가는 방향(back)으로 뻗은 구간만 고른다 — 같은 점에 다른 방향 배관이 붙어 있어도 헷갈리지 않게.
    const prevPipeEnd = (p, back) => {
      const tol = 0.03;
      const pick = (points, local, spec) => {
        const n = points ? points.length : 0;
        if (n < 2) return null;
        const cands = [{ at: n - 1, inn: n - 2 }, { at: 0, inn: 1 }];
        for (let k = 0; k < cands.length; k += 1) {
          const c = cands[k];
          const B = points[c.at];
          const A = points[c.inn];
          if (Math.hypot(B.x - p.x, B.y - p.y, B.z - p.z) > tol) continue;
          const len = Math.hypot(B.x - A.x, B.y - A.y, B.z - A.z);
          if (len < 1e-4) continue;
          const ux = (B.x - A.x) / len;
          const uy = (B.y - A.y) / len;
          const uz = (B.z - A.z) / len;
          if (ux * back.x + uy * back.y + uz * back.z < 0.9) continue;
          return { points, at: c.at, inn: c.inn, len, ux, uy, uz, local, spec };
        }
        return null;
      };
      if (pts) {
        const r = pick(pts, true, null);
        if (r) return r;
      }
      for (let i = pipes.length - 1; i >= 0; i -= 1) {
        const r = pick(pipes[i].points, true, pipes[i]);
        if (r) return r;
      }
      for (let i = this.state.pipes.length - 1; i >= 0; i -= 1) {
        const r = pick(this.state.pipes[i].points, false, this.state.pipes[i]);
        if (r) return r;
      }
      return null;
    };

    // 찾은 구간의 끝을 안쪽 점 쪽으로 f만큼 당긴다 — 엘보가 앉을 자리를 비운다.
    // (시작점이면 pts[0]을, 끝점이면 pts[n-1]을 옮긴다)
    const trimPipeEnd = (seg, f) => {
      if (!seg || !(f > 1e-4)) return false;
      const B = seg.points[seg.at];
      const np = put({ x: B.x - seg.ux * f, y: B.y - seg.uy * f, z: B.z - seg.uz * f });
      if (seg.local) seg.points[seg.at] = np;
      else edits.push({ id: seg.spec.id, index: seg.at, point: np });
      return true;
    };

    const nextEqSeq = (type) => {
      equipSeq[type] = (equipSeq[type] || this.state.equipment.filter((e) => e.type === type).length) + 1;
      return equipSeq[type];
    };

    const putEquip = (type, extra) => {
      const t = EQUIP_TYPES[type];
      void t;
      // 지금 커서에 들어오는 배관의 진행 방향 — 인라인 부속은 이 벡터로 3D 회전을 맞춘다.
      const dv = prevDir || equipDir || this.lastDirV;
      const dir = INLINE_TYPES.has(type) && dv
        ? [r3(dv.x), r3(dv.y), r3(dv.z)] : null;
      // bore — 밸브·피팅은 이 관경의 외경에 비례해 몸체·핸들 크기가 정해진다.
      const spec = makeEquipment(type, {
        name: `${t.short}-${100 + nextEqSeq(type)} ${t.label}`,
        x: cursor.x, y: cursor.y, z: cursor.z, rot,
        bore,
        conn,
        ...(dir ? { dir } : {}),
        ...(extra || {}),
      });
      equip.push(spec);
      return spec;
    };

    // 꺾이는 자리 근처의 접합면(플랜지 면·노즐 끝·밸브 면) — 이 위에서 꺾이면 배관을 당겨
    // 자르는 대신 엘보를 **면 바깥에** 세워야 플랜지 구멍 안으로 파고들지 않는다.
    // 커서가 판 속에 살짝 물려 있어도 진행 방향에서 **가장 앞선 접합면**을 기준으로 삼는다
    // (플랜지 안쪽 면·바깥 면이 둘 다 가까울 때 안쪽 면에 세우면 판을 21mm 뚫고 들어갔다).
    const portBase = (p, tol, dirV) => {
      let hit = null;
      this.state.equipment.forEach((e) => {
        equipPorts(e).forEach((n) => {
          const d = Math.hypot(n.tip.x - p.x, n.tip.y - p.y, n.tip.z - p.z);
          if (d > (tol || 0.025)) return;
          const along = (n.tip.x - p.x) * dirV.x + (n.tip.y - p.y) * dirV.y + (n.tip.z - p.z) * dirV.z;
          if (!hit || along > hit.along) hit = { along, tip: { x: n.tip.x, y: n.tip.y, z: n.tip.z }, n, e };
        });
      });
      if (!hit) return null;
      // 면이 커서보다 앞(진행 방향)에 있으면 그 면 기준 — 뒤에 있으면 관 끝(커서) 기준
      return hit.along > 1e-4 ? hit.tip : { x: p.x, y: p.y, z: p.z };
    };

    // 꺾이는 꼭짓점: 각도에 맞는 엘보를 놓고 배관을 접합면에서 끊는다.
    const cornerJoin = (next, prev) => {
      const dot = prev.x * next.x + prev.y * next.y + prev.z * next.z;
      const bend = THREE.MathUtils.radToDeg(Math.acos(Math.max(-1, Math.min(1, dot))));
      const auto = bend > 80 && bend < 100 ? 'elbow' : (bend > 30 && bend < 60 ? 'elbow45' : null);
      const type = auto || wantElbow;
      wantElbow = null;
      if (!type) return { face: 0, fixed: false };
      const dims = elbowDims(type, bore);
      // 엘보는 **플랜지·노즐·배관 시작점을 뚫고 뒤로 넘어가면 안 된다** (2026-11-27 `32270`).
      //  · 접합면 위에서 꺾으면 → 그 면 바깥에 세운다.
      //  · 앞 배관이 짧거나(len <= face+20mm) 피팅값 자동계산 OFF면 → 배관은 그대로 두고
      //    엘보 입구를 배관 끝에 0mm로 붙인다 (사용자: "배관 끝에 엘보가 붙어야지").
      //  · 자동계산 ON + 배관이 충분히 길 때만 → 중심선 기준으로 face만큼 당겨 자르고 꼭짓점에 앉힌다.
      const elbowAt = () => putEquip(type, {
        bore,
        inDir: [-prev.x, -prev.y, -prev.z],
        outDir: [next.x, next.y, next.z],
        rot: this.rotForDir(next, rot),
      });
      const note = (suffix) => notes.push(
        (type === 'elbow45' ? '45° 엘보 ' : '엘보 ') + suffix,
      );
      // ① 꺾임점이 플랜지·노즐 접합면 위 → 엘보를 그 면 바깥(면 + 진행방향×face)에 세운다.
      //    입구 면이 접합면에 0mm로 앉고, 새 구간은 엘보 출구 면에서 시작한다.
      //    커서가 면에 살짝 물려 있어도 **실제 접합면(tip)**을 기준으로 세워 판을 뚫지 않는다.
      //    (2026-11-26 `31611` — 손 그리기·플랜지 위에서 꺾으면 엘보 몸통이 판을 뚫고 들어갔다)
      const atFace = portBase(cursor, 0.025, prev);
      if (atFace) {
        flush();
        cursor = put({
          x: atFace.x + prev.x * dims.face,
          y: atFace.y + prev.y * dims.face,
          z: atFace.z + prev.z * dims.face,
        });
        elbowAt();
        note('(접합면 밖)');
        return { face: dims.face, fixed: true };   // 접합면 밖 배치는 고정 — 짧은 구간이라도 줄이지 않는다
      }
      // ② 배관 끝에서 꺾임 — 앞 배관을 당겨 자를 수 있을 때만 자른다.
      const seg = prevPipeEnd(cursor, prev);
      if (seg && this.fitAuto && seg.len > dims.face + 0.02) {
        trimPipeEnd(seg, dims.face);
        flush();
        elbowAt();
        note('자동');
        return { face: dims.face, fixed: false };
      }
      flush();
      if (!seg) {
        // 앞 배관을 찾지 못했다 — 예전처럼 꼭짓점에 앉힌다.
        elbowAt();
        note('자동');
        return { face: dims.face, fixed: false };
      }
      // 앞 배관은 그대로 두고, 엘보 입구 면을 배관 끝에 0mm로 맞춰 붙인다.
      cursor = put({
        x: cursor.x + prev.x * dims.face,
        y: cursor.y + prev.y * dims.face,
        z: cursor.z + prev.z * dims.face,
      });
      elbowAt();
      note('(배관 끝)');
      return { face: dims.face, fixed: true };
    };

    // 한 구간을 그린다. 방향이 바뀌는 꼭짓점이면 엘보를 자동으로 앉힌다.
    const drawSegment = (v, meters) => {
      const prevV = prevDir || this.lastDirV;
      let face = 0;
      let fixed = false;
      if (prevV) {
        const dot = prevV.x * v.x + prevV.y * v.y + prevV.z * v.z;
        if (dot < 0.999) {
          const r = cornerJoin(v, prevV) || { face: 0, fixed: false };
          face = r.face || 0;
          fixed = !!r.fixed;
        } else if (wantElbow) wantElbow = null; // 일직선에는 꺾임이 없다
      }
      // 접합면 밖에 세운 엘보는 그 출구 면에서 시작해야 하므로 짧은 구간이라도 줄이지 않는다.
      if (this.fitAuto && !fixed) face = meters > face + 1e-6 ? face : Math.min(face, meters * 0.45);
      const from = face > 0
        ? put({ x: cursor.x + v.x * face, y: cursor.y + v.y * face, z: cursor.z + v.z * face })
        : { ...cursor };
      // 피팅값 자동계산(ON) — 입력한 길이는 **중심선 기준**이라 엘보가 차지한 face만큼 빼고
      //   실제 직관을 그린다 (200A 엘보 304.8mm + `500` → 직관 195.2mm).
      //   꺾임 없이 티·레듀샤의 접합면에서 바로 이어 그리는 경우에도 그 부속의
      //   중심~면 값(C·M·H/2)을 뺀다 — 입력한 길이가 부속 중심에서 잰 값이 된다 (v84).
      // OFF — 엘보 출구 면에서부터 입력한 길이를 그대로 직관으로 그린다 (`500` → 직관 500mm).
      // fixed(엘보를 접합면·배관 끝 바깥에 세운 경우)는 face가 입력 길이보다 클 수 있으므로
      //   뒤로 넘어가지 않게 최소 20mm만 남긴다.
      let fitOff = 0;
      let fitHit = null;
      if (this.fitAuto && !(face > 0)) {
        const hit = this.fitAllowanceAt(from, v, equip);
        // 입력한 길이가 부속 값보다 짧으면(직관 50mm도 남지 않으면) 그대로 그린다.
        if (hit && meters > hit.value + 0.05) {
          fitOff = hit.value;
          fitHit = hit;
        }
      }
      const run = this.fitAuto
        ? (fixed ? Math.max(0.02, meters - face) : meters - face - fitOff)
        : meters;
      if (fitHit) notes.push(`${fitHit.label} ${Math.round(fitHit.value * 1000)}mm 빼고 직관 ${Math.round(run * 1000)}mm`);
      const to = put({ x: from.x + v.x * run, y: from.y + v.y * run, z: from.z + v.z * run });
      if (!pts) pts = [from];
      pts.push(to);
      cursor = to;
      prevDir = { x: v.x, y: v.y, z: v.z };
      this.lastDirV = { ...prevDir };
    };

    for (let i = 0; i < ops.length; i += 1) {
      const op = ops[i];
      if (op.op === 'bore') { bore = op.bore; continue; }
      if (op.op === 'material') { material = op.material; continue; }
      if (op.op === 'conn') { conn = connOf({ conn: op.conn }); continue; }
      if (op.op === 'newpipe') { flush(); this.lastDirV = null; prevDir = null; continue; }
      if (op.op === 'seg') {
        // world: 손 그리기가 고른 축은 화면 기준이 아니라 실제 3D 축이다.
        // dir: 45° 대각선처럼 축 하나로 말할 수 없는 방향은 3D 단위 벡터로 그대로 받는다.
        let v;
        if (op.world && op.dir) {
          const l = Math.hypot(op.dir.x || 0, op.dir.y || 0, op.dir.z || 0) || 1;
          v = { x: (op.dir.x || 0) / l, y: (op.dir.y || 0) / l, z: (op.dir.z || 0) / l };
          // 다음 명령·커서가 이어 쓸 대표 축은 가장 큰 성분으로 남긴다.
          axis = Math.abs(v.y) > Math.max(Math.abs(v.x), Math.abs(v.z)) ? 'y'
            : (Math.abs(v.x) >= Math.abs(v.z) ? 'x' : 'z');
          sign = v[axis] < 0 ? -1 : 1;
          rot = this.cmdRotFor(axis, sign);
        } else {
          const m = op.world
            ? { axis: op.axis || axis, sign: (op.sign || 1) < 0 ? -1 : 1 }
            : (op.axis ? this.dirToWorld(op.axis, op.sign) : { axis, sign });
          axis = m.axis;
          sign = m.sign < 0 ? -1 : 1;
          rot = this.cmdRotFor(axis, sign);
          v = { x: axis === 'x' ? sign : 0, y: axis === 'y' ? sign : 0, z: axis === 'z' ? sign : 0 };
        }
        drawSegment(v, op.meters);
        continue;
      }
      if (op.op === 'offset45') {
        // 45° 오프셋 — 수평 방향 h로 나가면서 위로 45° 오르는 대각선. 길이는 빗변(중심선).
        // 양 끝 꺾임에 45° 엘보가 자동으로 앉고, 두 번째 엘보는 이어지는 직관이 생길 때 앉는다.
        const ang = THREE.MathUtils.degToRad(op.angle || 45);
        const h = op.axis
          ? { axis: op.axis, sign: op.sign < 0 ? -1 : 1 }
          : this.heading();
        const c = Math.cos(ang);
        const v = {
          x: (h.axis === 'x' ? (h.sign < 0 ? -1 : 1) : 0) * c,
          y: Math.sin(ang),
          z: (h.axis === 'z' ? (h.sign < 0 ? -1 : 1) : 0) * c,
        };
        axis = h.axis;
        sign = h.sign < 0 ? -1 : 1;
        rot = this.cmdRotFor(axis, sign);
        drawSegment(v, op.meters);
        // 계산 근거를 남긴다 — 빗변·엘보값·직관 절단 길이
        const info = this.offset45Info((op.offset || op.meters * Math.SQRT1_2) * 1000);
        notes.push(`45° 오프셋 ${Math.round(info.H * 1000)}mm · 빗변 ${Math.round(info.hyp * 1000)}mm`
          + ` · 직관 절단 ${Math.round(info.cut * 1000)}mm`);
        this.lastOffset45 = info;
        continue;
      }
      if (op.op === 'diag') {
        // 45° 경사 — 길이는 경사관 실제 길이, 수평·수직 성분으로 나뉜다.
        const ang = THREE.MathUtils.degToRad(op.angle || 45);
        const h = op.axis
          ? this.dirToWorld(op.axis, op.sign)
          : (axis !== 'y' ? { axis, sign } : this.heading());
        const vert = op.vert < 0 ? -1 : 1;
        const c = Math.cos(ang);
        const v = {
          x: (h.axis === 'x' ? (h.sign < 0 ? -1 : 1) : 0) * c,
          y: vert * Math.sin(ang),
          z: (h.axis === 'z' ? (h.sign < 0 ? -1 : 1) : 0) * c,
        };
        axis = h.axis;
        sign = h.sign < 0 ? -1 : 1;
        rot = this.cmdRotFor(axis, sign);
        drawSegment(v, op.meters);
        notes.push(`${op.angle}° 경사 ${fmt(op.meters * Math.cos(ang))}·${fmt(op.meters * Math.sin(ang))}m`);
        continue;
      }
      if (op.op === 'turn') {
        const m = this.dirToWorld(op.axis, op.sign);
        axis = m.axis;
        sign = m.sign < 0 ? -1 : 1;
        rot = this.cmdRotFor(axis, sign);
        notes.push('방향 전환');
        continue;
      }
      if (op.op === 'delete') {
        flush();
        this.commitCmd(pipes, equip, edits);
        this.deleteLast(op);
        return null;
      }
      if (op.op === 'move') {
        flush();
        this.commitCmd(pipes, equip, edits);
        this.moveTarget(op);
        return null;
      }
      if (op.op === 'connect') {
        flush();
        const hit = this.resolveConnect(op, cursor);
        if (!hit) {
          this.toast(op.target === 'pipe' ? '연결할 다른 배관을 찾지 못했습니다.' : '연결할 부속·장비를 찾지 못했습니다.', { type: 'err' });
          continue;
        }
        // 45° 모드 — 90° 직교 대신 정확한 45° 경사 경로로 잇는다 (v85)
        if (this.diag45) {
          const dp = this.diag45Path(cursor, hit.p, {
            bore: hit.bore && BORES[hit.bore] ? hit.bore : bore,
            portAxis: hit.seat === 'flange' ? hit.portAxis : null,
          });
          if (hit.bore && BORES[hit.bore]) {
            bore = hit.bore;
            notes.push(`노즐 관경 ${bore}`);
          }
          dp.runs.forEach((r) => {
            pipeSeq += 1;
            pipes.push(makePipe({
              name: `PL-${String(pipeSeq).padStart(3, '0')} 연결`,
              bore, material, conn, points: [{ ...r[0] }, { ...r[1] }],
            }));
          });
          dp.elbows.forEach((eb) => {
            equip.push(makeEquipment(eb.type, {
              name: `${EQUIP_TYPES[eb.type].short}-${100 + nextEqSeq(eb.type)} ${EQUIP_TYPES[eb.type].label}`,
              x: eb.at.x, y: eb.at.y, z: eb.at.z, bore: eb.bore,
              inDir: eb.inDir, outDir: eb.outDir,
              rot: this.rotForDir({ x: eb.outDir[0], y: eb.outDir[1], z: eb.outDir[2] }, rot),
            }));
          });
          const P = dp.points;
          const prev = P[P.length - 2] || cursor;
          const last = P[P.length - 1] || hit.p;
          const lx = last.x - prev.x, ly = last.y - prev.y, lz = last.z - prev.z;
          const ln = Math.hypot(lx, ly, lz) || 1;
          prevDir = { x: lx / ln, y: ly / ln, z: lz / ln };
          this.lastDirV = { ...prevDir };
          axis = Math.abs(lx) >= Math.abs(ly) && Math.abs(lx) >= Math.abs(lz) ? 'x'
            : (Math.abs(lz) >= Math.abs(ly) ? 'z' : 'y');
          sign = (axis === 'x' ? lx : axis === 'z' ? lz : ly) < 0 ? -1 : 1;
          rot = this.cmdRotFor(axis, sign);
          cursor = { x: hit.p.x, y: Math.max(0, hit.p.y), z: hit.p.z };
          const n45 = dp.elbows.filter((e) => e.type === 'elbow45').length;
          notes.push(`${hit.label}에 연결 ${fmt(hit.d)}m`);
          if (dp.elbows.length) notes.push(`45° 엘보 ${n45} · 엘보 ${dp.elbows.length - n45}`);
          continue;
        }
        // 플랜지 접합면이면 축 방향으로 꺾어 앉힌다 — 엘보 + 맞물림 플랜지 (v67).
        const seated = hit.seat === 'flange'
          ? this.seatAtFlangePort(cursor, { p: hit.p, portAxis: hit.portAxis, bore: hit.bore || bore })
          : null;
        const path = seated ? seated.path : this.orthoPath(cursor, hit.p);
        // 노즐 끝에 붙었으면 그 노즐 관경으로 배관을 뽑는다(이후 명령도 그 관경으로 이어진다).
        if (hit.bore && BORES[hit.bore]) {
          bore = hit.bore;
          notes.push(`노즐 관경 ${bore}`);
        }
        pipeSeq += 1;
        pipes.push(makePipe({
          name: `PL-${String(pipeSeq).padStart(3, '0')} 연결`,
          bore, material, conn, points: path,
        }));
        if (seated && seated.elbow) {
          const eb = seated.elbow;
          equip.push(makeEquipment(eb.type, {
            name: `${EQUIP_TYPES[eb.type].short}-${100 + this.state.equipment.filter((q) => q.type === eb.type).length + equip.filter((q) => q.type === eb.type).length + 1} ${EQUIP_TYPES[eb.type].label}`,
            x: eb.at.x, y: eb.at.y, z: eb.at.z, bore: eb.bore,
            inDir: eb.inDir, outDir: eb.outDir,
            rot: this.rotForDir({ x: eb.outDir[0], y: eb.outDir[1], z: eb.outDir[2] }, rot),
          }));
          notes.push('엘보 자동');
        }
        // 마지막 구간 방향으로 다음 명령을 이어갈 수 있게 방향을 맞춘다.
        const prev = path[path.length - 2] || cursor;
        const last = path[path.length - 1];
        const dx = last.x - prev.x, dy = last.y - prev.y, dz = last.z - prev.z;
        axis = Math.abs(dx) >= Math.abs(dy) && Math.abs(dx) >= Math.abs(dz) ? 'x'
          : (Math.abs(dz) >= Math.abs(dy) ? 'z' : 'y');
        const dv = axis === 'x' ? dx : axis === 'z' ? dz : dy;
        sign = dv < 0 ? -1 : 1;
        rot = this.cmdRotFor(axis, sign);
        const len = Math.hypot(dx, dy, dz) || 1;
        prevDir = { x: dx / len, y: dy / len, z: dz / len };
        this.lastDirV = { ...prevDir };
        cursor = { x: hit.p.x, y: Math.max(0, hit.p.y), z: hit.p.z };
        notes.push(`${hit.label}에 연결 ${fmt(hit.d)}m`);
        continue;
      }
      if (op.op === 'equip') {
        const t = EQUIP_TYPES[op.type];
        if (!t) continue;
        // 열교환기는 타입(양쪽·한쪽 둥근 / 양쪽 평판)을 먼저 고른다.
        // 명령에 타입까지 말했으면(열교환기 양쪽) 바로 놓고, 아니면 선택 창을 띄운다.
        let hxType = op.hxType && HX_TYPES.includes(op.hxType) ? op.hxType : null;
        if (op.type === 'hx' && !hxType) {
          const rawTxt = String(this.lastRawCommand || '');
          if (/양쪽|양면/.test(rawTxt)) hxType = 'both';
          else if (/한쪽|단면/.test(rawTxt)) hxType = 'one';
          else if (/평판|플랫/.test(rawTxt)) hxType = 'flat';
        }
        if (op.type === 'hx' && !hxType) {
          if (opts.source !== 'ai' && opts.source !== 'hand') {
            this.commitCmd(pipes, equip, edits);
            this.chooseAndAdd('hx');
            return null;
          }
          hxType = 'both';
        }
        const isElbow = op.type === 'elbow' || op.type === 'elbow45';
        // "엘보써서 위로 1000" — 다음 구간이 꺾이면 그 꼭짓점에 엘보를 앉힌다 (중복 방지)
        if (isElbow && this.nextMoveOp(ops, i) && (prevDir || this.lastDirV)) {
          wantElbow = op.type;
          continue;
        }
        const inline = INLINE_TYPES.has(op.type);
        if (inline) flush(); // 부속이 들어가는 자리에서 배관을 끊고, 부속 뒤에서 다시 이어 그린다.
        // 이 명령에서 아직 움직이지 않았으면 바로 뒤에 오는 이동 방향으로 부속을 앉힌다.
        // (`25a 볼벨브 위로 600` — 예전에는 직전 명령의 방향으로 놓여 배관에서 옆으로 비껴났다)
        if (inline && !prevDir) {
          const nx = this.nextMoveOp(ops, i);
          if (nx && nx.axis) {
            axis = nx.axis;
            sign = nx.sign === -1 ? -1 : 1;
            equipDir = { x: axis === 'x' ? sign : 0, y: axis === 'y' ? sign : 0, z: axis === 'z' ? sign : 0 };
          }
        }
        // "단조 볼밸브"처럼 부속 앞에 단조/소켓/나사가 붙어 온 부속은 그것만 단조형으로 놓는다.
        const pieceConn = op.conn === 'forged' ? 'forged' : conn;
        const extra = isElbow
          ? { bore, conn: pieceConn }
          : (op.size1 && op.size2 ? { bore1: op.size1, bore2: op.size2, conn: pieceConn } : { conn: pieceConn });
        if (op.type === 'hx' && hxType) extra.hxType = hxType;
        const spec = putEquip(op.type, extra);
        if (isElbow) {
          // 엘보 — 커서(직전 배관 끝)에 **입구 면**을 맞추고 꺾임점을 face만큼 앞에 둔다.
          // 예전에는 커서에 꺾임점을 두고 로컬 +X를 진행 방향으로 돌려 세워, 입구가 위를 향해
          // 뒤집힌 채 등이 밸브 위에 얹혔다(2026-11-25 `31597` 캡처).
          const dv = prevDir || equipDir || this.lastDirV
            || { x: axis === 'x' ? sign : 0, y: axis === 'y' ? sign : 0, z: axis === 'z' ? sign : 0 };
          const dims = elbowDims(op.type, spec.bore || bore);
          const pick = this.padDirV();
          const dot = pick ? pick.x * dv.x + pick.y * dv.y + pick.z * dv.z : 0;
          let outV = pick && Math.abs(dot) < 0.7 ? pick : this.turnDirFor(dv);
          if (op.type === 'elbow45') {
            const dg = { x: dv.x + outV.x, y: dv.y + outV.y, z: dv.z + outV.z };
            const dl = Math.hypot(dg.x, dg.y, dg.z) || 1;
            outV = { x: dg.x / dl, y: dg.y / dl, z: dg.z / dl };
          }
          spec.inDir = [r3(-dv.x), r3(-dv.y), r3(-dv.z)];
          spec.outDir = [r3(outV.x), r3(outV.y), r3(outV.z)];
          delete spec.dir;
          spec.x = r3(cursor.x + dv.x * dims.face);
          spec.y = Math.max(0, r3(cursor.y + dv.y * dims.face));
          spec.z = r3(cursor.z + dv.z * dims.face);
          cursor = put({
            x: r3(spec.x + outV.x * dims.face),
            y: Math.max(0, r3(spec.y + outV.y * dims.face)),
            z: r3(spec.z + outV.z * dims.face),
          });
          axis = Math.abs(outV.x) >= Math.abs(outV.y) && Math.abs(outV.x) >= Math.abs(outV.z) ? 'x'
            : (Math.abs(outV.z) >= Math.abs(outV.y) ? 'z' : 'y');
          sign = (axis === 'x' ? outV.x : axis === 'z' ? outV.z : outV.y) < 0 ? -1 : 1;
          rot = this.cmdRotFor(axis, sign);
          prevDir = { x: outV.x, y: outV.y, z: outV.z };
          this.lastDirV = { ...prevDir };
          notes.push(op.type === 'elbow45' ? '45° 엘보' : '엘보');
          continue;
        }
        // spec.w = builders.js 메시의 실제 좌우 접합면 폭. 그래서 이 값만큼만 전진시키면 틈이 생기지 않는다.
        const len = inline ? (spec.w || 0) : 0;
        // 양쪽 4mm씩 살짝 물리게 놓아 접합면에 실금 같은 틈이 보이지 않게 한다.
        const ov = len > 0 ? Math.min(0.004, len * 0.15) : 0;
        const half = len > 0 ? len / 2 - ov : 0;
        spec.x = r3(cursor.x + (axis === 'x' ? sign * half : 0));
        spec.y = ON_FLOOR_TYPES.has(op.type) ? 0 : Math.max(0, r3(cursor.y + (axis === 'y' ? sign * half : 0)));
        spec.z = r3(cursor.z + (axis === 'z' ? sign * half : 0));
        if (inline) {
          cursor = put({
            x: cursor.x + (axis === 'x' ? sign * (len - ov * 2) : 0),
            y: cursor.y + (axis === 'y' ? sign * (len - ov * 2) : 0),
            z: cursor.z + (axis === 'z' ? sign * (len - ov * 2) : 0),
          });
        }
        // 레듀샤는 2차 관경으로 커서 관경을 바꿔, 이어지는 배관이 작은 관경으로 나가게 한다.
        if (op.type === 'reducer' && op.size2 && BORES[op.size2]) {
          bore = op.size2;
          notes.push(`레듀샤 ${op.size1}→${op.size2} · 이후 ${op.size2}`);
        }
        continue;
      }
      if (op.op === 'undo') {
        flush();
        this.commitCmd(pipes, equip, edits);
        this.undo();
        return null;
      }
      if (op.op === 'reset') {
        flush();
        this.commitCmd(pipes, equip, edits);
        this.clearAll({ silent: true });
        this.toast('새 도면 — 장비·배관을 모두 지웠습니다.', { action: '되돌리기', onAction: () => this.undo() });
        return null;
      }
      if (op.op === 'help') { this.openCmdHelp(); return null; }
    }
    flush();

    this.cmdBore = bore;
    this.cmdMaterial = material;
    this.cmdConn = conn;
    this.cmdAxis = axis;
    this.cmdSign = sign;
    this.cmdRot = rot;
    this.updatePadInfo();

    if (!pipes.length && !equip.length) {
      const tail = `커서 (${fmt(cursor.x)}, ${fmt(cursor.y)}, ${fmt(cursor.z)})m`;
      this.toast(notes.length
        ? `${notes.join(' · ')} · ${tail}`
        : `다음 배관: ${bore} ${MATERIALS[material].label} · ${tail}`);
      return { cursor };
    }

    this.commitCmd(pipes, equip, edits);
    // v72 — 방금 그린 배관 끝이 탱크 외벽 가까이오면 그 높이·자리에 노즐을 맞춘다.
    let fitNote = null;
    if (pipes.length) {
      const lastPipe = pipes[pipes.length - 1];
      const fi = this.autoFitTankNozzle(lastPipe, lastPipe.points.length - 1);
      if (fi) {
        fitNote = fi.text;
        cursor = { ...lastPipe.points[lastPipe.points.length - 1] };
        this.rebuild();
      }
    }
    // 다음 명령이 같은 자리에서 이어지도록 커서를 남긴다 (선택은 비어 있어도 커서는 유지).
    this.setCmdCursor(cursor, true);

    const bits = [];
    if (pipes.length) bits.push(`배관 ${pipes.length}개 ${fmt(pipes.reduce((s, p) => s + pipeLength(p.points), 0))}m`);
    if (equip.length) {
      const last = EQUIP_TYPES[equip[equip.length - 1].type].label;
      bits.push(equip.length > 1 ? `부속 ${equip.length}개 (${last} 등)` : last);
    }
    if (notes.length) bits.push(notes.join(' · '));
    if (fitNote) bits.push(fitNote);
    this.toast(`${bits.join(' · ')} · ${bore} · 커서 (${fmt(cursor.x)}, ${fmt(cursor.y)}, ${fmt(cursor.z)})m`);
    return { cursor };
  }

  commitCmd(pipes, equip, edits) {
    const hasEdits = Array.isArray(edits) && edits.length;
    if (!pipes.length && !equip.length && !hasEdits) return;
    this.pushUndo('명령 실행');
    if (hasEdits) {
      edits.forEach((ed) => {
        const target = this.state.pipes.find((p) => p.id === ed.id);
        if (target && target.points[ed.index]) target.points[ed.index] = ed.point;
      });
    }
    if (pipes.length) this.state.pipes.push(...pipes);
    if (equip.length) this.state.equipment.push(...equip);
    // 계기는 방금 그린 배관 외벽에 바로 붙인다(니쁠이 배관 중심을 향해 직각으로 꽂힘).
    equip.forEach((e) => {
      if (e.type === 'gauge') attachGaugeToPipe(this.state.pipes, e);
    });
    if (equip.length) this.lastAdded = { kind: 'equipment', id: equip[equip.length - 1].id };
    else if (pipes.length) this.lastAdded = { kind: 'pipe', id: pipes[pipes.length - 1].id };
    // 연속으로 명령을 칠 수 있게 선택은 비워 둔다 (모바일에서 속성 패널이 명령창을 가리는 것 방지)
    this.selection = null;
    this.rebuild();
  }

  // ── 모바일 보기 바: '등각 ▲' 1개로 접혀 있다가, 누르면 위로 펼쳐진다 ────────
  // 넓은 화면(>860px)은 기존 상단 가로 보기 바 그대로 — 접힘 규칙은 모바일 CSS에만 있다.
  isMobileLayout() {
    return window.innerWidth <= 860;
  }

  setViewbar(open) {
    const bar = $('#viewbar');
    this.viewbarOpen = !!open;
    if (!bar) return;
    bar.classList.toggle('open', this.viewbarOpen);
    const iso = bar.querySelector('[data-view="iso"]');
    if (iso) {
      if (this.isMobileLayout()) iso.setAttribute('aria-expanded', this.viewbarOpen ? 'true' : 'false');
      else iso.removeAttribute('aria-expanded');
    }
    // 펼친 보기 바는 작은 창처럼 다룬다 — 휴대폰 뒤로가기로 페이지를 나가지 않고 먼저 접힌다.
    if (this.viewbarOpen) this.syncOverlayEntry();
    else this.releaseOverlayEntry();
  }

  // 접힌 보기 바의 [등각]을 누르면 뷰 전환 대신 펼치기만 한다. true를 돌려주면 클릭을 소비한 것.
  viewbarTap(btn) {
    const bar = $('#viewbar');
    if (!bar || !btn || !this.isMobileLayout()) return false;
    if (bar.classList.contains('open')) return false;   // 펼쳐진 상태의 등각 = 등각 뷰 + 접힘
    if (btn.dataset.view !== 'iso') return false;
    this.setViewbar(true);
    return true;
  }

  // ── 콤팩트 방향 조이스틱 (3×2 D패드) ─────────────────────────
  // 방향을 고르면 그 방향이 강조되고, 명령창에 길이(mm)만 치고 [실행]하면 그 방향으로 그려진다.
  setPadOpen(on) {
    this.padOpen = !!on;
    const el = $('#dirPad');
    if (el) el.hidden = !this.padOpen;
    const btn = $('#cmdPad');
    if (btn) {
      btn.classList.toggle('active', this.padOpen);
      btn.setAttribute('aria-expanded', this.padOpen ? 'true' : 'false');
    }
  }

  updatePadInfo() {
    const el = $('#padInfo');
    if (el) {
      const c = this.cmdCursor;
      const mat = (MATERIALS[this.cmdMaterial] || MATERIALS.carbon).label;
      const conn = (CONN_MODES[this.cmdConn] || CONN_MODES.none).label;
      el.textContent = `${this.cmdBore} · ${conn} · ${mat} · ${fmt(c.x)}, ${fmt(c.y)}, ${fmt(c.z)}m`;
    }
    this.highlightPad();
  }

  // 관경 바꾸기 — 노즐에서 이어 그릴 때·관경 이어받기에서 쓴다.
  // (조이스틱 정보 줄과 배관 탭 관경 선택란을 같이 맞춘다)
  setCmdBore(bore, quiet) {
    if (!BORES[bore]) return;
    this.cmdBore = bore;
    const sel = $('#newBore');
    if (sel) sel.value = bore;
    this.updatePadInfo();
    this.updateKbDirBar();
    if (!quiet) this.toast(`관경 ${bore} (${BORES[bore].mm}mm)`);
  }

  // 연결 방식 순환 — 선택안함(기본) → 플랜지 → 단조 → 선택안함.
  setCmdConn(mode, quiet) {
    this.cmdConn = connOf({ conn: mode });
    this.updatePadInfo();
    if (!quiet) {
      const msg = {
        none: '선택안함 — 배관 끝에 플랜지를 그리지 않습니다. 플랜지가 필요하면 `플랜지` 부속을 직접 놓으세요.',
        forged: '단조형 — 이후 배관·부속을 플랜지 없이 소켓 보스로 그립니다. (단조 볼밸브 · 소켓 엘보)',
        flange: '플랜지형 — 이후 배관 끝에 플랜지 원판을 그립니다.',
      };
      this.toast(msg[this.cmdConn] || msg.none);
    }
  }

  // 📐 피팅값 자동계산 — ON이면 입력한 길이에서 엘보·티·레듀샤 값(face)을 빼고
  // 실제 직관을 그린다(중심선 기준). OFF면 엘보 출구에서부터 입력 길이 그대로.
  setFitAuto(on, quiet) {
    this.fitAuto = !!on;
    try { localStorage.setItem('smilePiping3D.fitAuto', this.fitAuto ? 'on' : 'off'); } catch (e) { /* ignore */ }
    this.applyFitAuto();
    if (!quiet) {
      this.toast(this.fitAuto
        ? '📐 피팅값 자동계산 켜짐 — 500을 넣으면 엘보값을 빼고 직관을 그립니다(중심선 기준)'
        : '📐 피팅값 자동계산 꺼짐 — 500을 넣으면 직관 500mm를 그대로 그립니다');
    }
  }

  applyFitAuto() {
    const on = !!this.fitAuto;
    const btn = $('#btnFitAuto');
    if (btn) {
      btn.dataset.fit = on ? 'on' : 'off';
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.textContent = `📐 피팅값 자동계산 · ${on ? 'ON' : 'OFF'}`;
    }
    const sw = $('#fitAutoSwitch');
    if (sw && sw.checked !== on) sw.checked = on;
  }

  // ── 📐 45° 오프셋 계산 (v84) ─────────────────────────────────
  // 배관을 수직으로 H만큼 올리거나 내릴 때, 두 45° 엘보 사이의 대각선 길이와 직관 절단 길이.
  //  · 빗변(중심선) = H × √2  — 꼭짓점과 꼭짓점 사이
  //  · 직관 절단 = 빗변 − 2 × 45° 엘보값(B)  — 양 끝 엘보가 먹는 몫
  //  · 100A·오프셋 500mm → 빗변 707.1mm · 엘보 63.5×2 = 127mm → 절단 580.1mm
  offset45Info(offsetMm) {
    const bore = BORES[this.cmdBore] ? this.cmdBore : '100A';
    const H = Math.max(1, Number(offsetMm) || 0) / 1000;
    const hyp = H * Math.SQRT2;
    const B = elbowDims('elbow45', bore).face;
    return { bore, H, hyp, B, cut: hyp - 2 * B };
  }

  // 계산 결과 문구 — 패널(또는 토스트)에 그대로 쓴다
  offset45Text(offsetMm) {
    const i = this.offset45Info(offsetMm);
    const mm = (v) => (Math.round(v * 1000 * 10) / 10).toLocaleString();
    return `빗변(중심선) ${mm(i.hyp)}mm · 45° 엘보 ${mm(i.B)}×2 = ${mm(i.B * 2)}mm`
      + ` → 직관 절단 ${mm(i.cut)}mm (${i.bore})`;
  }

  // 45° 오프셋을 그린다 — 대각선은 빗변 길이(중심선)로 그리고, 이어지는 직관 L이 있으면
  // 두 번째 45° 엘보까지 함께 세운다(두 번째 엘보가 대각선 끝을 B만큼 당겨 자른다).
  drawOffset45(offsetMm, runMm) {
    const i = this.offset45Info(offsetMm);
    const h = this.heading();
    const ops = [{ op: 'offset45', axis: h.axis, sign: h.sign, meters: i.hyp, offset: i.H }];
    const run = Number(runMm) || 0;
    if (run > 0) ops.push({ op: 'seg', axis: h.axis, sign: h.sign, meters: run / 1000 });
    const res = this.execOps(ops, { source: 'cmd' });
    this.toast(`📐 45° 오프셋 ${Math.round(i.H * 1000)}mm — ${this.offset45Text(offsetMm)}`
      + (run > 0 ? '' : ' · 이어서 직관을 그리면 두 번째 45° 엘보가 붙습니다'));
    return res;
  }

  // 45° 오프셋 계산기 — 배관 탭에서 오프셋(mm)을 넣으면 빗변·절단 길이를 바로 보여 준다.
  setupOffset45() {
    const H = $('#off45H');
    const L = $('#off45L');
    const out = $('#off45Out');
    const btn = $('#off45Draw');
    if (!btn) return;
    const refresh = () => {
      const mm = Number(H && H.value) || 0;
      if (out) out.textContent = mm > 0 ? this.offset45Text(mm) : '오프셋(mm)을 넣으면 빗변·절단 길이를 계산합니다';
    };
    if (H) H.addEventListener('input', refresh);
    btn.addEventListener('click', () => {
      const mm = Number(H && H.value) || 0;
      if (!(mm > 0)) { this.toast('오프셋(mm)을 먼저 넣어 주세요.', { type: 'err' }); return; }
      const i = this.offset45Info(mm);
      if (i.cut < 0.005) {
        this.toast(`오프셋 ${mm}mm는 ${i.bore} 45° 엘보 2개(${Math.round(i.B * 2000)}mm)보다 짧아 그릴 수 없습니다.`, { type: 'err' });
        return;
      }
      const run = Number(L && L.value) || 0;
      this.drawOffset45(mm, run);
    });
    refresh();
  }

  // [내 시점 기준] ↔ [도면 축 기준]
  setDirFrame(mode, quiet) {
    this.dirFrame = mode === 'plan' ? 'plan' : 'me';
    try { localStorage.setItem('smilePiping3D.dirFrame', this.dirFrame); } catch (e) { /* ignore */ }
    this.highlightPad();
    if (!quiet) {
      this.toast(this.dirFrame === 'me'
        ? '내 시점 기준 — 지금 보는 화면의 좌·우·앞·뒤로 나갑니다.'
        : '도면 축 기준 — 도면의 X·Z 축(고정)으로 나갑니다.');
    }
  }

  highlightPad() {
    const sel = this.pending;
    const on = (axis, sign) => {
      if (!sel) return false;
      const ax = sel.axis;
      // 45° 경사에서 위/아래만 고른 경우(수평 방향은 지금 그리는 방향)는 ↑·↓ 를 켠다.
      if (sel.op === 'diag' && sel.axis == null) return axis === 'y' && sign === (sel.vert < 0 ? -1 : 1);
      return ax === axis && (sel.sign < 0 ? -1 : 1) === sign;
    };
    // 수평 45°(바닥면 대각선)에서는 좌·우·앞·뒤 버튼이 각각 대각선 한 방향이 된다 —
    //  45° 껐을 때는 원래 글자(←·→·앞·뒤)로 되돌린다. (글자와 실제 방향이 어긋나면 안 된다)
    const xz = !!this.diag45 && this.diagMode === 'xz';
    const GLYPH = { 'x:-1': ['←', '↙'], 'x:1': ['→', '↗'], 'z:1': ['앞', '↖'], 'z:-1': ['뒤', '↘'] };
    $$('#dirPad [data-dir]').forEach((b) => {
      const [axis, s] = b.dataset.dir.split(':');
      const g = GLYPH[b.dataset.dir];
      if (g) {
        b.textContent = xz ? g[1] : g[0];
        b.title = xz
          ? ({ 'x:-1': '왼쪽+뒤 45°', 'x:1': '오른쪽+앞 45°', 'z:1': '앞+왼쪽 45°', 'z:-1': '뒤+오른쪽 45°' })[b.dataset.dir]
          : ({ 'x:-1': '왼쪽', 'x:1': '오른쪽', 'z:1': '앞', 'z:-1': '뒤' })[b.dataset.dir];
      }
      b.classList.toggle('active', on(axis, Number(s)));
    });
    const d45 = $('#pad45');
    if (d45) d45.classList.toggle('active', !!this.diag45);
    const drow = $('#padDiagRow');
    if (drow) {
      drow.hidden = !this.diag45;
      $$('[data-diag]', drow).forEach((b) => {
        const act = !!this.diag45 && b.dataset.diag === this.diagMode;
        b.classList.toggle('active', act);
        b.setAttribute('aria-pressed', act ? 'true' : 'false');
      });
    }
    this.updateKbDirBar();
    const fr = $('#btnFrame');
    if (fr) {
      fr.textContent = this.dirFrame === 'me' ? '내 시점 기준' : '도면 축 기준';
      fr.dataset.frame = this.dirFrame;
      fr.setAttribute('aria-pressed', this.dirFrame === 'me' ? 'true' : 'false');
    }
    const cn = $('#btnConn');
    if (cn) {
      const c = connOf({ conn: this.cmdConn });
      cn.textContent = `연결 · ${(CONN_MODES[c] || CONN_MODES.none).label}`;
      cn.dataset.conn = c;
      cn.setAttribute('aria-pressed', c !== 'none' ? 'true' : 'false');
    }
  }

  // 방향 버튼 하나 — 처음 누르면 선택(강조), 같은 방향을 한 번 더 누르면 바로 그린다.
  tapDir(axis, sign) {
    const sel = this.dirPending(axis, sign);
    const same = this.pending && JSON.stringify(this.pending) === JSON.stringify(sel);
    if (same) { this.padDraw(sel, this.padLen / 1000); return; }
    this.pending = sel;
    this.highlightPad();
    this.toast(this.pendingToast(sel, axis, sign));
  }

  // 지금 모드(90° / 45° 위·아래·수평)에 맞는 pending을 만든다 (v85).
  //  · 45° OFF            → 90° 직각 {op:'seg'}
  //  · 45° ON · 위/아래   → {op:'diag', vert:±1}  (수평 방향으로 오르내리는 경사관)
  //  · 45° ON · 수평     → {op:'diagxz'}           (높이 그대로 바닥면 45° 대각선)
  //  · ↑·↓ 는 45° 모드에서 지금 그리는 수평 방향으로 오르내리는 경사가 된다.
  dirPending(axis, sign) {
    const s = sign < 0 ? -1 : 1;
    if (!this.diag45) return { op: 'seg', axis, sign: s };
    if (axis === 'y') return { op: 'diag', axis: null, sign: 1, vert: s, angle: 45 };
    if (this.diagMode === 'xz') return { op: 'diagxz', axis, sign: s };
    return { op: 'diag', axis, sign: s, vert: this.diagMode === 'down' ? -1 : 1, angle: 45 };
  }

  // pending → 누른 버튼(패드 좌표의 축·부호). 모드를 바꿀 때 방향을 잃지 않게 되돌린다.
  pendingKey(p) {
    if (!p) return null;
    if (p.op === 'diag' && p.axis == null) return { axis: 'y', sign: p.vert < 0 ? -1 : 1 };
    if (!p.axis) return { axis: 'x', sign: 1 };
    return { axis: p.axis, sign: p.sign < 0 ? -1 : 1 };
  }

  pendingToast(sel, axis, sign) {
    const s = sign < 0 ? -1 : 1;
    const name = { x: s > 0 ? '우' : '좌', y: s > 0 ? '위' : '아래', z: s > 0 ? '앞' : '뒤' }[axis];
    if (sel.op === 'diagxz') {
      const tag = { 'x:1': '오른쪽+앞', 'x:-1': '왼쪽+뒤', 'z:1': '앞+왼쪽', 'z:-1': '뒤+오른쪽' }[`${axis}:${s}`] || name;
      return `45° 수평 ${tag} 선택 — 높이 그대로 바닥면 대각선으로 그립니다.`;
    }
    if (sel.op === 'diag') {
      const up = (sel.vert < 0) ? '아래' : '위';
      return sel.axis == null
        ? `45° ${up} 선택 — 지금 그리는 수평 방향으로 45° ${up === '위' ? '오르' : '내려'}갑니다.`
        : `45° ${name} · ${up} 선택 — 길이(mm)는 경사관 길이입니다.`;
    }
    return `${name} 선택 — 명령창에 1000처럼 길이만 넣고 실행하세요.`;
  }

  // 45° 모드 켜기/끄기 — 골라 둔 방향을 **즉시** 새 모드로 바꾼다 (v85).
  //  예전에는 45°를 끄어도 pending이 'diag'로 남아, 일반 → 버튼이 켜져 보이는데
  //  실제로는 대각선이 그려졌다 — "45도 껐는데 지 맘대로 그려 버리네"(2026-11-28).
  setDiag45(on, quiet) {
    const next = !!on;
    if (next === this.diag45) { this.highlightPad(); return; }
    this.diag45 = next;
    const k = this.pendingKey(this.pending);
    if (k) this.pending = this.dirPending(k.axis, k.sign);
    this.highlightPad();
    this.updateHandBadge();
    if (quiet) return;
    this.toast(next
      ? (this.handMode
        ? '45° 모드 — 손으로 끌면 45° 대각선으로도 그려집니다.'
        : '45° 경사 모드 — 위·아래·수평 중 하나를 고르고 방향을 누르세요.')
      : '90° 직각 모드로 돌아왔습니다 — 이제 대각선으로 그리지 않습니다.');
  }

  // 45° 경사 종류 — 위 45° / 아래 45° / 수평 45° (v85)
  setDiagMode(mode) {
    const m = (mode === 'down' || mode === 'xz') ? mode : 'up';
    const changed = m !== this.diagMode || !this.diag45;
    this.diagMode = m;
    this.diag45 = true;                        // 경사를 고르면 45° 모드도 같이 켜진다
    const k = this.pendingKey(this.pending);
    if (k) this.pending = this.dirPending(k.axis, k.sign);
    this.highlightPad();
    this.updateHandBadge();
    if (!changed) return;
    this.toast(m === 'up' ? '45° 위 — 고른 방향으로 45° 오릅니다.'
      : m === 'down' ? '45° 아래 — 고른 방향으로 45° 내려갑니다.'
        : '45° 수평 — 높이 그대로 바닥면 대각선으로 그립니다.');
  }

  // 수평 45° — 누른 방향에서 '앞'(화면 안쪽)으로 45° 꺾인 바닥면 대각선 (v85).
  //  → = 오른쪽+앞 · ← = 왼쪽+뒤 · 앞 = 앞+왼쪽 · 뒤 = 뒤+오른쪽 — 네 방향이 서로 겹치지 않는다.
  horizDiagVec(axis, sign) {
    const s = sign < 0 ? -1 : 1;
    const c = Math.SQRT1_2;
    let R = { x: 1, y: 0, z: 0 };
    let F = { x: 0, y: 0, z: 1 };
    if (this.dirFrame === 'me') {
      const b = this.viewBasis();
      const vec = (t) => (t.axis === 'x' ? { x: t.sign, y: 0, z: 0 } : { x: 0, y: 0, z: t.sign });
      R = vec(b.right);
      F = vec(b.fwd);
    }
    const ux = axis === 'x' ? 1 : -1;          // x축은 오른쪽+앞 · z축은 앞+왼쪽
    const v = { x: (R.x * ux + F.x) * c * s, y: 0, z: (R.z * ux + F.z) * c * s };
    return { x: r3(v.x), y: 0, z: r3(v.z) };
  }

  padDraw(sel, meters) {
    if (!sel) return null;
    const m = Math.max(0.005, Number(meters) || (this.padLen / 1000));
    this.padLen = Math.round(m * 1000);
    // 45° 껏는데 diag·diagxz가 남아 있으면 90° 직각으로 꺾는다 — 어떤 경우에도 대각선을 그리지 않는다.
    const kind = (sel.op === 'diag' || sel.op === 'diagxz') && !this.diag45 ? 'seg' : sel.op;
    let op;
    if (kind === 'diag') {
      op = { op: 'diag', axis: sel.axis, sign: sel.sign, vert: sel.vert || 1, angle: sel.angle || 45, meters: m };
    } else if (kind === 'diagxz') {
      op = { op: 'seg', world: true, dir: this.horizDiagVec(sel.axis, sel.sign), meters: m };
    } else {
      op = { op: 'seg', axis: sel.axis, sign: sel.sign, meters: m };
    }
    const res = this.execOps([op], { source: 'pad' });
    this.updatePadInfo();
    return res;
  }

  // ── 조이스틱 위치 이동(드래그) ──────────────────────────────
  // 상단 헤더(내 시점 · 연결)나 정보 줄을 끌면 화면 안 원하는 곳으로 옮겨진다.
  // 화면 밖으로는 나가지 않고, 그냥 톡 누르면(4px 미만) 원래 버튼 클릭으로 동작한다.
  padPosClamp(left, top) {
    const pad = $('#dirPad');
    if (!pad) return { left: 0, top: 0 };
    const host = pad.parentElement;
    const hr = host.getBoundingClientRect();
    const pr = pad.getBoundingClientRect();
    const m = 4;
    const maxL = Math.max(m, hr.width - pr.width - m);
    let maxT = Math.max(m, hr.height - pr.height - m);
    const l = Math.min(Math.max(left, m), maxL);
    // 명령창·보기 바가 있는 아래 띠 위로만 놓는다 — 조이스틱을 끌어도 이들은 가릴 수 없다.
    // 띠와의 여유는 기본 자리(조이스틱 bottom 58px · 명령창 윗변 790px = 4px)와 같은 4px로 맞춘다.
    // 보기 바는 모바일에서 오른쪽 '등각' 1개로 줄어 있어 왼쪽 아래(기본 자리)와는 겹치지 않는다.
    const barGap = 4;
    ['#cmdForm', '#viewbar'].forEach((sel) => {
      const b = $(sel);
      if (!b || b.hidden) return;
      const br = b.getBoundingClientRect();
      if (!br.width || !br.height) return;
      const bx = br.left - hr.left;
      const by = br.top - hr.top;
      if (by < hr.height / 2) return;   // 위쪽(상단 바)에 있는 것은 아래 띠 장애물이 아니다
      const hOverlap = l < bx + br.width && l + pr.width > bx;
      if (hOverlap) maxT = Math.min(maxT, by - pr.height - barGap);
    });
    const t = Math.min(Math.max(top, m), Math.max(m, maxT));
    return { left: l, top: t };
  }

  // 모바일(≤860px)과 넓은 화면은 하단 기본 자리가 달라서 위치를 따로 기억한다
  padPosKeys() {
    return ['smilePiping3D.padPos', 'smilePiping3D.padPos.wide'];
  }
  padPosKey() {
    return window.innerWidth <= 860 ? 'smilePiping3D.padPos' : 'smilePiping3D.padPos.wide';
  }

  // left/top 은 #viewport 기준 px. save=true 면 다음에 열 때도 같은 자리에 둔다.
  setPadPos(left, top, save) {
    const pad = $('#dirPad');
    if (!pad) return;
    const p = this.padPosClamp(left, top);
    pad.style.left = Math.round(p.left) + 'px';
    pad.style.top = Math.round(p.top) + 'px';
    pad.style.right = 'auto';
    pad.style.bottom = 'auto';
    if (save) {
      try {
        localStorage.setItem(this.padPosKey(), JSON.stringify({ left: Math.round(p.left), top: Math.round(p.top) }));
      } catch (e) { /* ignore */ }
    }
  }

  restorePadPos() {
    let pos = null;
    try { pos = JSON.parse(localStorage.getItem(this.padPosKey()) || 'null'); } catch (e) { pos = null; }
    if (!pos || !isFinite(pos.left) || !isFinite(pos.top)) return;
    // 레이아웃(모바일/데스크톱)이 잡힌 뒤에 적용하고, 화면 밖 좌표는 clamp 한다
    requestAnimationFrame(() => this.setPadPos(Number(pos.left), Number(pos.top), false));
  }

  resetPadPos(quiet) {
    const pad = $('#dirPad');
    if (pad) {
      pad.style.left = '';
      pad.style.top = '';
      pad.style.right = '';
      pad.style.bottom = '';
    }
    try { this.padPosKeys().forEach((k) => localStorage.removeItem(k)); } catch (e) { /* ignore */ }
    if (!quiet) this.toast('조이스틱을 기본 위치(왼쪽 아래)로 되돌렸습니다.');
  }

  bindPadDrag() {
    const pad = $('#dirPad');
    if (!pad) return;
    const head = $('#padHead');
    const infoRow = $('#padInfoRow');
    const handles = [head, infoRow].filter(Boolean);
    if (!handles.length) return;
    let drag = null;
    let suppressClick = false;

    const start = (e, handle) => {
      if (e.button != null && e.button !== 0) return;
      if (e.target && e.target.closest && e.target.closest('#padReset')) return; // 리셋 버튼은 그냥 클릭
      // 머리 줄의 '내 시점 기준'·'연결' 버튼은 끌기가 아니라 클릭으로 동작해야 한다.
      // (포인터 캡처가 걸리면 mouseup·click이 머리로 바뀌어 버튼이 먹통이 됨)
      if (e.target && e.target.closest && e.target.closest('#btnFrame, #btnConn, #btnFitAuto')) return;
      const r = pad.getBoundingClientRect();
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, left: r.left, top: r.top, moved: false, handle };
      try { handle.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    };

    const move = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (!drag.moved) {
        if (Math.hypot(dx, dy) < 4) return;      // 손가락이 살짝 흔들린 것은 클릭으로 본다
        drag.moved = true;
        pad.classList.add('dragging');
      }
      e.preventDefault();
      const host = pad.parentElement.getBoundingClientRect();
      this.setPadPos(drag.left + dx - host.left, drag.top + dy - host.top, false);
    };

    const end = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const moved = drag.moved;
      const handle = drag.handle;
      drag = null;
      try { handle.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      pad.classList.remove('dragging');
      if (!moved) return;
      // 드래그가 끝난 뒤 따라오는 click 은 버튼 동작으로 넘기지 않는다
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 400);
      const p = this.padPosClamp(parseFloat(pad.style.left) || 0, parseFloat(pad.style.top) || 0);
      this.setPadPos(p.left, p.top, true);
      if (!this.padHintShown) {
        this.padHintShown = true;
        this.toast('조이스틱 위치를 옮겼습니다 · ⟲ 을 누르면 기본 위치로 돌아갑니다.');
      }
    };

    handles.forEach((h) => {
      h.addEventListener('pointerdown', (e) => start(e, h));
      h.addEventListener('pointermove', move);
      h.addEventListener('pointerup', end);
      h.addEventListener('pointercancel', end);
    });

    // 드래그 직후의 click 한 번만 막는다 (버튼이 눌린 것으로 처리되지 않게)
    pad.addEventListener('click', (e) => {
      if (!suppressClick) return;
      e.stopPropagation();
      e.preventDefault();
    }, true);

    const reset = $('#padReset');
    if (reset) reset.addEventListener('click', (e) => { e.stopPropagation(); this.resetPadPos(); });

    // 화면을 돌리거나 창 크기가 바뀌어도 조이스틱이 화면 밖에 남지 않게
    window.addEventListener('resize', () => {
      if (!pad.style.left) return;
      const p = this.padPosClamp(parseFloat(pad.style.left) || 0, parseFloat(pad.style.top) || 0);
      this.setPadPos(p.left, p.top, false);
    });

    this.restorePadPos();
  }

  bindPad() {
    const pad = $('#dirPad');
    if (!pad) return;
    $('#cmdPad').addEventListener('click', () => this.setPadOpen(!this.padOpen));
    $('#btnFrame').addEventListener('click', () => this.setDirFrame(this.dirFrame === 'me' ? 'plan' : 'me'));
    $('#btnConn').addEventListener('click', () => {
      const next = { none: 'flange', flange: 'forged', forged: 'none' };
      this.setCmdConn(next[connOf({ conn: this.cmdConn })] || 'none');
    });
    const fitBtn = $('#btnFitAuto');
    if (fitBtn) fitBtn.addEventListener('click', () => this.setFitAuto(!this.fitAuto));
    $('#pad45').addEventListener('click', () => this.setDiag45(!this.diag45));
    $$('#padDiagRow [data-diag]').forEach((b) => {
      b.addEventListener('click', () => this.setDiagMode(b.dataset.diag));
    });
    $('#padUndo').addEventListener('click', () => this.undo());
    $$('#dirPad [data-dir]').forEach((b) => {
      const [axis, s] = b.dataset.dir.split(':');
      b.addEventListener('click', () => this.tapDir(axis, Number(s)));
    });
    this.bindPadDrag();
  }

  // ── 🎤 음성 명령 (Web Speech API) ─────────────────────────
  setupVoice() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.speechSupported = !!SR;
    if (!SR) return;
    try {
      const rec = new SR();
      rec.lang = 'ko-KR';
      rec.interimResults = true;
      rec.continuous = false;
      rec.maxAlternatives = 1;
      rec.onstart = () => { this.listening = true; this.updateMicUi(); };
      rec.onend = () => { this.listening = false; this.updateMicUi(); };
      rec.onerror = (ev) => {
        this.listening = false;
        this.updateMicUi();
        const code = (ev && ev.error) || '';
        if (code === 'not-allowed' || code === 'service-not-allowed') {
          this.toast('마이크 권한이 필요합니다. 주소창 자물쇠 → 마이크를 허용한 뒤 다시 눌러 주세요.', { type: 'err' });
        } else if (code === 'no-speech') {
          this.toast('소리가 들리지 않았습니다. 버튼을 누르고 다시 말해 주세요.');
        } else if (code === 'audio-capture') {
          this.toast('마이크를 찾지 못했습니다. 마이크가 연결돼 있는지 확인해 주세요.', { type: 'err' });
        } else if (code === 'network') {
          this.toast('음성 인식 서버에 연결하지 못했습니다. 잠시 뒤 다시 시도해 주세요.', { type: 'err' });
        } else if (code !== 'aborted') {
          this.toast(`음성 인식이 중단되었습니다 (${code}).`, { type: 'err' });
        }
      };
      rec.onresult = (ev) => {
        let text = '';
        for (let i = ev.resultIndex; i < ev.results.length; i += 1) {
          text += ev.results[i][0].transcript || '';
        }
        const t = String(text).trim();
        if (!t) return;
        const input = $('#cmdInput');
        if (input) input.value = t;
        const last = ev.results[ev.results.length - 1];
        if (last && last.isFinal) {
          try { rec.stop(); } catch (e) { /* ignore */ }
          this.listening = false;
          this.updateMicUi();
          if (input) input.value = '';
          this.runCommandLine(t);
        }
      };
      this.recognition = rec;
    } catch (e) {
      this.speechSupported = false;
      this.recognition = null;
    }
  }

  updateMicUi() {
    const btn = $('#cmdMic');
    if (!btn) return;
    btn.classList.toggle('listening', !!this.listening);
    btn.setAttribute('aria-pressed', this.listening ? 'true' : 'false');
    btn.title = this.listening ? '듣는 중… 다시 누르면 멈춥니다' : '말로 명령 (예: 50에이 오른쪽 1000)';
  }

  toggleVoice() {
    if (!this.speechSupported || !this.recognition) {
      this.toast('이 브라우저는 음성 인식을 지원하지 않습니다. Chrome 최신 버전에서 사용해 주세요.', { type: 'err' });
      return;
    }
    if (this.listening) {
      try { this.recognition.stop(); } catch (e) { /* ignore */ }
      return;
    }
    if (this.drawMode) this.setDrawMode(false);
    try {
      $('#cmdInput').value = '';
      this.recognition.start();
    } catch (e) {
      this.listening = false;
      this.updateMicUi();
      this.toast('음성 인식을 시작하지 못했습니다. 잠시 뒤 다시 눌러 주세요.', { type: 'err' });
    }
  }

  openCmdHelp() {
    this.openModal({
      title: '한 줄 배관 명령 · mm 단위',
      body: CMD_HELP,
      actions: [{ label: '확인', cls: 'accent' }],
    });
  }

  // ── 카메라 ─────────────────────────────────────────────
  frameFor(name) {
    const box = new THREE.Box3();
    if (this.root) {
      try { box.setFromObject(this.root); } catch (e) { /* ignore */ }
    }
    if (box.isEmpty()) box.set(new THREE.Vector3(-7, 0, -6), new THREE.Vector3(7, 4, 4));
    const center = box.getCenter(new THREE.Vector3());
    const dir = name === 'top'
      ? new THREE.Vector3(0, 1, 0.0016).normalize()
      : name === 'front'
        ? new THREE.Vector3(0, 0.18, 1).normalize()
        : new THREE.Vector3(0.92, 0.62, 0.95).normalize();
    const target = name === 'top'
      ? new THREE.Vector3(center.x, 0, center.z)
      : new THREE.Vector3(center.x, Math.max(0.6, center.y * 0.7), center.z);

    const corners = [];
    for (let i = 0; i < 8; i += 1) {
      corners.push(new THREE.Vector3(
        (i & 1) ? box.max.x : box.min.x,
        (i & 2) ? box.max.y : box.min.y,
        (i & 4) ? box.max.z : box.min.z,
      ));
    }

    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * Math.max(0.5, this.camera.aspect));
    const fov = Math.min(vFov, hFov);
    const fillRatio = name === 'top' ? 0.74 : 0.84;
    const radius = Math.max(2, box.getSize(new THREE.Vector3()).length() / 2);
    let dist = radius / Math.sin(fov / 2);

    // 화면을 꽉 채우도록 거리 반복 보정
    const probe = new THREE.PerspectiveCamera(this.camera.fov, this.camera.aspect, 0.1, 3000);
    for (let i = 0; i < 9; i += 1) {
      probe.position.copy(target).addScaledVector(dir, dist);
      probe.lookAt(target);
      probe.updateMatrixWorld(true);
      let m = 0.0001;
      corners.forEach((c) => {
        const p = c.clone().project(probe);
        m = Math.max(m, Math.abs(p.x), Math.abs(p.y));
      });
      if (Math.abs(m - fillRatio) < 0.02) break;
      dist = Math.max(2, dist * (m / fillRatio));
    }
    return { pos: target.clone().addScaledVector(dir, dist), target };
  }

  setView(name, immediate) {
    const activeName = name === 'reset' ? 'iso' : name;
    $$('.vbtn[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === activeName));
    const f = this.frameFor(activeName);
    if (immediate) {
      this.camera.position.copy(f.pos);
      this.controls.target.copy(f.target);
      this.controls.update();
      return;
    }
    this.camAnim = {
      p0: this.camera.position.clone(), p1: f.pos,
      t0: this.controls.target.clone(), t1: f.target,
      start: performance.now(), dur: 560,
    };
  }

  updateCamAnim() {
    if (!this.camAnim) return;
    const a = this.camAnim;
    let k = Math.min(1, (performance.now() - a.start) / a.dur);
    k = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    this.camera.position.lerpVectors(a.p0, a.p1, k);
    this.controls.target.lerpVectors(a.t0, a.t1, k);
    if (k >= 1) this.camAnim = null;
  }

  // ── 입력 ────────────────────────────────────────────────
  bindSceneEvents() {
    const canvas = this.renderer.domElement;
    let down = null;
    canvas.addEventListener('pointerdown', (e) => {
      // 3D 그림창을 만지면 명령 입력칸 초점을 풀어 모바일 키보드를 내린다 —
      // 그림을 넓게 보며 손 그리기·조이스틱으로 계속 그릴 수 있게(2026-11-25 사용자 요청).
      this.blurCmdInput();
      if (down) return;
      down = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
    }, { passive: true });
    canvas.addEventListener('pointerup', (e) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const dt = performance.now() - down.t;
      if (down.id != null && e.pointerId !== down.id) return; // 다른 손가락의 이동
      down = null;
      // 모바일 손가락은 미세하게 흔들리므로 탭으로 볼 여유를 둔다.
      if (moved > 14 || dt > 1600) return;
      this.onCanvasClick(e);
    });
    canvas.addEventListener('pointercancel', () => { down = null; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // ✋ 드래그 이동 — 켜 두면 3D 바닥을 끌어 선택한 장비·부속을 옮긴다.
    // (capture 단계에서 잡아 OrbitControls 회전보다 먼저 가져간다)
    canvas.addEventListener('pointerdown', (e) => {
      if (!this.moveDrag || this.moveDragState) return;
      if (this.moveDragStart(e)) {
        e.stopPropagation();
        e.preventDefault();
        if (canvas.setPointerCapture) { try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ } }
      }
    }, true);
    canvas.addEventListener('pointermove', (e) => {
      if (!this.moveDragState) return;
      this.moveDragMove(e);
      e.stopPropagation();
    }, true);
    ['pointerup', 'pointercancel'].forEach((type) => {
      canvas.addEventListener(type, () => this.moveDragEnd(), true);
    });
  }

  raycastAt(ev) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const p = new THREE.Vector2(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(p, this.camera);
    return this.raycaster;
  }

  // 3D 캔버스의 탭 한 번 — 이 안에서 속성 창이 열리면 이어지는 고스트 클릭으로부터 창을 잠근다.
  onCanvasClick(ev) {
    this.fromCanvasTap = true;
    try { this.handleCanvasTap(ev); } finally { this.fromCanvasTap = false; }
  }

  handleCanvasTap(ev) {
    // 손 그리기 중에는 한 손가락 탭이 그리기 시작점이 된다 — 선택으로 새지 않게 한다.
    if (this.handMode) return;
    // 🔗 잇기 모드 — 탭한 접속구(티·노즐·배관 끝)까지 커서에서 바로 배관을 연결한다.
    // (속성 창이 열려 있어도 잇기 탭은 그대로 동작해야 한다)
    if (this.linkMode) { this.tryLinkAt(ev); return; }
    // ☑️ 여러 개 선택 — 3D에서 톡톡 누를 때마다 선택에 더하고 빼며(속성 창은 닫지 않는다).
    if (this.multiMode) { this.tapMulti(ev); return; }
    // 열려 있는 창(도구 서랍·속성 창)은 3D 도면을 톡 누르면 먼저 닫는다 — 도면이 가려지지 않게.
    if (this.closeCoveringPanel()) return;
    const ray = this.raycastAt(ev);

    if (this.drawMode) {
      const hits = ray.intersectObject(this.ground, false);
      if (hits.length) this.addDraftPoint(hits[0].point);
      return;
    }

    // 장비 노즐 끝을 직접 눌렀으면 그 노즐에서 이어 그린다 — 본체를 눌러 기본 노즐로
    // 잡히던 자리(노즐 목이 본체 픽에 걸리는 자리)도 노즐 터치가 먼저 가져간다.
    // v80 — 다만 손가락이 실제로 맞은 앞쪽 물체를 먼저 구해 두고, 그보다 뒤에 있는(가려진)
    // 노즐은 탭을 가져가지 못하게 한다. 눈앞의 엘보를 눌렀는데 뒤쪽 장비의 접합면이
    // 선택되던 문제(2026-11-27 제보). 가려진 노즐이면 아래 firstHit 로 넘어간다.
    const firstHit = this.firstPickHit(ray);
    const noz = this.nozzlePickAt(ev, 32, firstHit);
    if (noz) { this.selectNozzle(noz.id, noz.nozzle); return; }
    if (firstHit) { this.select(firstHit.kind, firstHit.id); return; }
    // 작은 밸브·피팅은 정확한 광선이 빗나가기 쉬우므로 화면 32px 안에서 가장 가까운 것을 고른다.
    const near = this.nearestPick(ev, 32);
    if (near) { this.select(near.kind, near.id); return; }
    // 아무것도 없는 바닥을 톡 누르면 — 선택을 풀고 커서를 그 자리로 옮겨 새 그림을 시작한다.
    // (2026-11-25 사용자 요청: "그리던 중 다른 곳에서 다른 그림을 시작하려면")
    const floor = ray.intersectObject(this.ground, false);
    if (floor.length) {
      this.clearSelection();
      const p = floor[0].point;
      const nx = Math.round(p.x * 10) / 10;   // 0.1m 격자에 맞춘다
      const nz = Math.round(p.z * 10) / 10;
      this.lastDirV = null;                    // 새 시작 — 앞 배관 방향으로 엘보가 붙지 않게
      this.setCmdCursor({ x: nx, y: this.cmdCursor.y, z: nz }, true);
      this.toast(`새 시작점으로 커서를 옮겼습니다 · (${fmt(nx)}, ${fmt(this.cmdCursor.y)}, ${fmt(nz)})m`);
      return;
    }
    this.clearSelection();
  }

  // ☑️ 여러 개 선택 중의 3D 탭 — 누른 것을 선택에 더하거나 빼고, 빈 바닥을 누르면 그만 고른다.
  // 속성 창은 닫지 않는다(닫히면 개수를 확인하며 고를 수 없다).
  tapMulti(ev) {
    if (!this.root) return;
    const ray = this.raycastAt(ev);
    const hits = ray.intersectObjects(this.root.children, true);
    for (const h of hits) {
      let o = h.object;
      while (o && o !== this.root) {
        if (o.userData && o.userData.pick) {
          this.toggleMulti(o.userData.pick.kind, o.userData.pick.id);
          return;
        }
        o = o.parent;
      }
    }
    // 작은 밸브·피팅은 정확한 광선이 빗나가기 쉬우므로 화면 32px 안 가장 가까운 것을 고른다.
    const near = this.nearestPick(ev, 32);
    if (near) { this.toggleMulti(near.kind, near.id); return; }
    // 빈 바닥 — 다중 선택을 그만두고 속성 창을 닫는다.
    this.clearSelection();
  }

  onKey(e) {
    const tag = (e.target && e.target.tagName) || '';
    const typing = /INPUT|SELECT|TEXTAREA/.test(tag);
    if (e.key === 'Escape') {
      if (!$('#modalRoot').hidden) { this.closeModal(); return; }
      if (this.handMode) { this.setHandMode(false); return; }
      if (this.drawMode) { this.setDrawMode(false); return; }
      if (this.selection) { this.clearSelection(); return; }
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) {
      e.preventDefault();
      this.undo();
    }
  }

  resize() {
    const el = $('#viewport');
    const w = el.clientWidth || 1;
    const h = el.clientHeight || 1;
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  loop() {
    this.renderer.setAnimationLoop(() => {
      this.updateCamAnim();
      this.controls.update();
      this.updateCmdMarker();   // 커서 위치·크기·링 방향·표시 규칙을 매 프레임 화면 기준으로 유지
      this.updateDims();
      // 정렬 배지는 카메라를 돌려도 그 3D 자리를 따라간다(v76).
      if (this.alignBadgeAt) this.placeAlignBadge();
      // 방금 그은 구간의 치수 창은 배관을 따라간다 — 화면을 돌려도 자리를 잃지 않는다.
      if (this.handDimItem) this.positionHandDim();
      this.renderer.render(this.scene, this.camera);
    });
  }

  // ── 🖨️ 도면 인쇄 · 컷 담기 (v81 · A4 가로 v82) ──────
  // 3D 화면을 HTML UI(버튼·조이스틱·명령창) 없이 그대로 담는다 — 캔버스만 그리므로 UI는
  // 애초에 섞이지 않는다. 흰 배경(인쇄 기본)은 **투명 배경으로 렌더 → 흰 종이에 합성**이라
  // 배경이 톤매핑에 눌려 회색으로 뜨지 않고 #ffffff 그대로 나온다. 화면의 어두운 테마는
  // 담는 순간에만 바꿨다가 finally에서 곧바로 되돌리므로 작업 화면은 그대로다.
  setupPrint() {
    this.cuts = [];            // 담은 컷 — 메모리에만 둔다(localStorage에 이미지를 쌓지 않는다)
    this.cutSeq = 0;
    this.ppOpen = false;
    this.ppMin = false;
    try { this.ppBg = localStorage.getItem('smilePiping3D.printBg') === 'dark' ? 'dark' : 'white'; } catch (e) { this.ppBg = 'white'; }
    try { this.ppDims = localStorage.getItem('smilePiping3D.printDims') !== 'off'; } catch (e) { this.ppDims = true; }
    // 한 장에 1·2·4컷(v83) · 용지 방향 가로/세로(v83)
    try { this.ppPerPage = [1, 2, 4].includes(Number(localStorage.getItem('smilePiping3D.printPerPage'))) ? Number(localStorage.getItem('smilePiping3D.printPerPage')) : 1; } catch (e) { this.ppPerPage = 1; }
    try { this.ppOrient = localStorage.getItem('smilePiping3D.printOrient') === 'portrait' ? 'portrait' : 'landscape'; } catch (e) { this.ppOrient = 'landscape'; }
    this.ppPerPage = [1, 2, 4].includes(this.ppPerPage) ? this.ppPerPage : 1;
    // 자재·배관 수량표는 기본 해제(v82) — 저장해 두지 않고 매번 꺼진 상태로 시작한다.
    this.ppBom = false;
    // 인쇄 업체명(v84) — localStorage에 저장, 기본값 '스마일산업'. 비우면 업체명 없이 인쇄.
    try {
      const co = localStorage.getItem('smilePiping3D.printCompany');
      this.ppCompany = co == null ? '스마일산업' : String(co);
    } catch (e) { this.ppCompany = '스마일산업'; }

    const on = (sel, ev, fn) => { const el = $(sel); if (el) el.addEventListener(ev, fn); };
    on('#ppClose', 'click', () => this.closePrintPanel());
    on('#ppMin', 'click', () => this.setPrintMin(!this.ppMin));
    on('#ppBgWhite', 'click', () => this.setPrintBg('white'));
    on('#ppBgDark', 'click', () => this.setPrintBg('dark'));
    on('#ppDims', 'change', (e) => { this.ppDims = !!e.target.checked; this.persistPrintOptions(); });
    on('#ppCompany', 'input', (e) => {
      this.ppCompany = String(e.target.value || '');
      try { localStorage.setItem('smilePiping3D.printCompany', this.ppCompany); } catch (err) { /* ignore */ }
      // 입력하는 대로 시트를 다시 맞춘다 — 인쇄 버튼을 누르는 순간 이미 반영돼 있게.
      if (this.ppCompanyTimer) clearTimeout(this.ppCompanyTimer);
      this.ppCompanyTimer = setTimeout(() => { this.refreshPrintSheet(); }, 200);
    });
    on('#ppBom', 'change', (e) => {
      this.ppBom = !!e.target.checked;
      this.toast(this.ppBom ? '🧾 자재·배관 수량표를 마지막 장에 함께 인쇄합니다' : '🧾 수량표 없이 도면만 인쇄합니다');
      this.refreshPrintSheet();
    });
    on('#ppAdd', 'click', () => this.addCut());
    on('#ppQuickPng', 'click', () => this.saveCutPng());
    on('#ppQuickPrint', 'click', () => this.printOneCut());
    on('#ppPrint', 'click', () => this.printAllCuts());
    on('#ppClear', 'click', () => this.clearCuts());
    on('#ppPerPage', 'change', (e) => {
      const n = Number(e.target.value);
      this.ppPerPage = [1, 2, 4].includes(n) ? n : 1;
      this.persistPrintOptions();
      this.renderCutList();
      this.refreshPrintSheet();
      const paper = this.ppOrient === 'portrait' ? 'A4 세로' : 'A4 가로';
      const how = this.ppPerPage === 1 ? '1컷씩 크게' : `${this.ppPerPage}컷씩`;
      this.toast(`한 장에 ${how} 인쇄합니다 (${paper})`);
    });
    on('#ppOrient', 'change', (e) => {
      this.ppOrient = e.target.value === 'portrait' ? 'portrait' : 'landscape';
      this.applyPrintPageStyle();
      this.persistPrintOptions();
      this.syncPrintOptions();
      this.refreshPrintSheet();
      this.toast(this.ppOrient === 'portrait' ? '📄 A4 세로로 인쇄합니다' : '📄 A4 가로로 인쇄합니다 (기본)');
    });
    on('#btnPrintSheet', 'click', () => { this.setDrawerOpen(false); this.openPrintPanel(); });
    const list = $('#ppList');
    if (list) {
      list.addEventListener('click', (e) => this.onCutListClick(e));
      list.addEventListener('input', (e) => this.onCutListInput(e));
    }
    // 인쇄 창을 닫으면 시트를 지금 컷 목록으로 다시 맞춘다(다음 인쇄가 바로 되게).
    window.addEventListener('afterprint', () => {
      if (this.ppPrinted) { this.ppPrinted = false; this.buildPrintSheet(this.cuts); }
    });
    this.syncPrintOptions();
    this.applyPrintPageStyle();
    this.renderCutList();
  }

  // 인쇄 용지 방향(v83) — @page는 클래스로 못 바꾸므로 인쇄 직전에 규칙 한 줄을 갈아 끼운다.
  // 여백은 실제 프린터의 인쇄 불가 영역(기종에 따라 5~10mm)보다 넉넉한 사방 12mm/13mm.
  // 프린터가 알려 주는 자체 여백에 맡기지 않고 종이-본문 사이를 이만큼 띄워야 테두리 글자가 잘리지 않는다.
  printPageRule(orient) {
    const size = orient === 'portrait' ? 'A4 portrait' : 'A4 landscape';
    return `@media print { @page { size: ${size}; margin: 12mm 13mm; } }`;
  }

  applyPrintPageStyle() {
    const st = $('#printPageStyle');
    if (st) st.textContent = this.printPageRule(this.ppOrient);
    const sheet = $('#printSheet');
    if (sheet) sheet.classList.toggle('ps-port', this.ppOrient === 'portrait');
    const hint = $('#ppHint');
    if (hint) {
      const paper = this.ppOrient === 'portrait' ? 'A4 세로' : 'A4 가로';
      hint.textContent = `${paper} · 사방 여백 12mm · 인쇄 창에서 ‘PDF로 저장’을 고르면 PDF가 됩니다`;
    }
    return this.printPageRule(this.ppOrient);
  }

  persistPrintOptions() {
    try {
      localStorage.setItem('smilePiping3D.printBg', this.ppBg);
      localStorage.setItem('smilePiping3D.printDims', this.ppDims ? 'on' : 'off');
      localStorage.setItem('smilePiping3D.printPerPage', String(this.ppPerPage));
      localStorage.setItem('smilePiping3D.printOrient', this.ppOrient);
    } catch (e) { /* ignore */ }
  }

  syncPrintOptions() {
    const w = $('#ppBgWhite');
    const d = $('#ppBgDark');
    if (w) w.classList.toggle('active', this.ppBg === 'white');
    if (d) d.classList.toggle('active', this.ppBg === 'dark');
    const dims = $('#ppDims');
    if (dims) dims.checked = !!this.ppDims;
    const per = $('#ppPerPage');
    if (per) per.value = String(this.ppPerPage);
    const orient = $('#ppOrient');
    if (orient) orient.value = this.ppOrient === 'portrait' ? 'portrait' : 'landscape';
    const bom = $('#ppBom');
    if (bom) bom.checked = !!this.ppBom;      // 기본은 꺼짐
    const co = $('#ppCompany');
    if (co && document.activeElement !== co) co.value = this.ppCompany == null ? '' : this.ppCompany;
  }

  // 인쇄 옵션(컷 수량표·모아찍기)이 바뀌면 시트를 다시 맞춰 둔다 — 누르는 순간 바로 인쇄되게.
  refreshPrintSheet() {
    if (!this.cuts.length) return Promise.resolve(null);
    return this.buildPrintSheet(this.cuts);
  }

  setPrintBg(bg) {
    this.ppBg = bg === 'dark' ? 'dark' : 'white';
    this.syncPrintOptions();
    this.persistPrintOptions();
    this.toast(this.ppBg === 'white' ? '⬜ 흰 배경으로 담습니다 — 인쇄에 잉크가 덜 듭니다' : '⬛ 화면과 같은 어두운 배경으로 담습니다');
  }

  openPrintPanel() {
    const el = $('#printPanel');
    if (!el) return;
    el.hidden = false;
    this.ppOpen = true;
    this.setPrintMin(false);
    this.renderCutList();
    this.syncOverlayEntry();
  }

  closePrintPanel() {
    const el = $('#printPanel');
    if (!el) return;
    el.hidden = true;
    this.ppOpen = false;
    this.releaseOverlayEntry();
  }

  setPrintMin(on) {
    this.ppMin = !!on;
    const el = $('#printPanel');
    if (el) el.classList.toggle('min', this.ppMin);
    const b = $('#ppMin');
    if (b) {
      b.textContent = this.ppMin ? '▴' : '▾';
      b.title = this.ppMin ? '펼치기' : '접기 (3D 화면을 넓게)';
      b.setAttribute('aria-label', this.ppMin ? '펼치기' : '접기');
    }
  }

  // 현재 화면을 컷으로 담는다 — 흰 배경이면 그리는 동안만 장면 테마를 바꿨다가 되돌린다.
  captureView(opts) {
    const o = Object.assign({ white: this.ppBg === 'white', dims: !!this.ppDims }, opts || {});
    const renderer = this.renderer;
    const scene = this.scene;
    const gl = renderer.domElement;
    const prev = {
      bg: scene.background,
      fog: scene.fog,
      ground: this.ground ? this.ground.visible : null,
      alpha: renderer.getClearAlpha(),
      helpers: (this.helpers || []).map((h) => h.visible),
      marker: this.cmdMarker ? this.cmdMarker.visible : null,
      hand: this.handPreviewGroup ? this.handPreviewGroup.visible : null,
      anchor: this.handAnchorDot ? this.handAnchorDot.visible : null,
    };
    // 고른 것의 주황 상자·커서·손그리기 미리보기는 종이에 넣지 않는다.
    (this.helpers || []).forEach((h) => { h.visible = false; });
    if (this.cmdMarker) this.cmdMarker.visible = false;
    if (this.handPreviewGroup) this.handPreviewGroup.visible = false;
    if (this.handAnchorDot) this.handAnchorDot.visible = false;
    let out = null;
    let labels = 0;
    try {
      if (o.white) {
        scene.background = null;                        // 배경을 비우고
        renderer.setClearAlpha(0);                      // 투명하게 지운 뒤
        scene.fog = new THREE.Fog(0xffffff, 90, 220);   // 먼 곳은 흰 종이로 옅게
        // 바닥 판은 끈다 — 어두운 격자 텍스처가 종이에 잉크로 깔리지 않게.
        // 종이의 1m 격자는 아래 2D 합성(paintFloorGrid)이 가는 회색 선으로 그린다.
        if (this.ground) this.ground.visible = false;
      }
      // 댐핑이 남긴 미세한 카메라 이동을 반영하고, 애니메이션 루프와 같은 한 프레임을 그린다.
      this.controls.update();
      renderer.render(scene, this.camera);
      // 그린 직후 **곧바로** 캔버스를 읽어 둔다(합성·격자 그리기보다 먼저).
      // 흰 배경은 배경이 투명하므로, 아무것도 안 남았으면(드로잉 버퍼가 비워진 경우) 한 번 더 그려 읽는다.
      const shot = document.createElement('canvas');
      shot.width = gl.width;
      shot.height = gl.height;
      const sg = shot.getContext('2d');
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (attempt) { renderer.render(scene, this.camera); }
        sg.clearRect(0, 0, shot.width, shot.height);
        sg.drawImage(gl, 0, 0);
        if (!o.white || this.canvasHasInk(sg, shot)) break;
      }
      out = document.createElement('canvas');
      out.width = shot.width;
      out.height = shot.height;
      const g = out.getContext('2d');
      const k = gl.width / (gl.clientWidth || 1);
      if (o.white) {
        g.fillStyle = '#ffffff';
        g.fillRect(0, 0, out.width, out.height);
        this.paintFloorGrid(g, k);      // 종이 위 1m 격자(가는 회색 선) — 3D보다 아래에 깔린다
      }
      g.imageSmoothingEnabled = true;
      g.drawImage(shot, 0, 0);
      labels = o.dims ? this.paintDimLabels(g, k, !!o.white) : 0;
    } finally {
      scene.background = prev.bg;
      scene.fog = prev.fog;
      if (this.ground) this.ground.visible = prev.ground;
      renderer.setClearAlpha(prev.alpha);
      (this.helpers || []).forEach((h, i) => { h.visible = prev.helpers[i]; });
      if (this.cmdMarker) this.cmdMarker.visible = prev.marker;
      if (this.handPreviewGroup) this.handPreviewGroup.visible = prev.hand;
      if (this.handAnchorDot) this.handAnchorDot.visible = prev.anchor;
      renderer.render(scene, this.camera);   // 화면을 원래 테마로 곧바로 되돌린다
    }
    const url = out.toDataURL('image/png');
    this.lastCapture = { url, w: out.width, h: out.height, white: !!o.white, dims: labels };
    return this.lastCapture;
  }

  // 담은 화면에 실제로 무언가 그려졌는지 — 투명 배경(흰 종이)에서 빈 캔버스를 걸러 낸다.
  canvasHasInk(ctx, canvas) {
    try {
      const step = Math.max(1, Math.floor(Math.min(canvas.width, canvas.height) / 24));
      const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let y = 0; y < canvas.height; y += step) {
        for (let x = 0; x < canvas.width; x += step) {
          if (d[(y * canvas.width + x) * 4 + 3] > 8) return true;
        }
      }
      return false;
    } catch (e) {
      return true;   // 못 재면 그냥 쓴다
    }
  }

  // 흰 종이 위 1m 격자 — 3D 바닥 판(어두운 텍스처) 대신 담은 그림 위에 가는 회색 선으로 긋는다.
  // 5m마다 조금 진하게, 먼 쪽은 옅게. 선은 화면(캔버스) 좌표로 직접 그려 인쇄에서 또렷하다.
  paintFloorGrid(ctx, k) {
    const cam = this.camera;
    if (!cam) return;
    const W = ctx.canvas.width;
    const H = ctx.canvas.height;
    const scale = k || 1;
    const inv = cam.matrixWorldInverse;
    const proj = cam.projectionMatrix;
    const near = cam.near * 1.2;
    const a3 = this._gridA || (this._gridA = new THREE.Vector3());
    const b3 = this._gridB || (this._gridB = new THREE.Vector3());
    const half = 45;
    const st = ctx.strokeStyle;
    const lw = ctx.lineWidth;
    const ga = ctx.globalAlpha;
    ctx.lineCap = 'butt';

    const seg = (x0, z0, x1, z1, color, width, fadeFrom) => {
      a3.set(x0, 0, z0).applyMatrix4(inv);
      b3.set(x1, 0, z1).applyMatrix4(inv);
      if (a3.z > -near && b3.z > -near) return;
      if (a3.z > -near) { const t = (-near - a3.z) / (b3.z - a3.z); a3.lerpVectors(a3, b3, t); }
      else if (b3.z > -near) { const t = (-near - b3.z) / (a3.z - b3.z); b3.lerpVectors(b3, a3, t); }
      const d = Math.min(-a3.z, -b3.z);
      const alpha = Math.max(0.18, Math.min(1, 1 - (d - fadeFrom) / 40));
      a3.applyMatrix4(proj);
      b3.applyMatrix4(proj);
      const ax = (a3.x * 0.5 + 0.5) * W;
      const ay = (-a3.y * 0.5 + 0.5) * H;
      const bx = (b3.x * 0.5 + 0.5) * W;
      const by = (-b3.y * 0.5 + 0.5) * H;
      if ((ax < 0 && bx < 0) || (ax > W && bx > W) || (ay < 0 && by < 0) || (ay > H && by > H)) return;
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = width * scale;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    };

    for (let i = -half; i <= half; i += 1) {
      if (i % 5 === 0) continue;                       // 5m 선은 따로 (조금 진하게)
      seg(i, -half, i, half, '#dfe6ee', 0.9, 22);
      seg(-half, i, half, i, '#dfe6ee', 0.9, 22);
    }
    for (let i = -half; i <= half; i += 5) {
      seg(i, -half, i, half, '#c9d4e1', 1.35, 22);
      seg(-half, i, half, i, '#c9d4e1', 1.35, 22);
    }
    // 원점 축 (X 빨강 · Z 파랑) — 화면의 X·Y·Z 글자와 같은 색으로 옅게
    seg(0, 0, 2.4, 0, '#e08a86', 1.4, 0);
    seg(0, 0, 0, 2.4, '#7fa8ea', 1.4, 0);

    ctx.globalAlpha = ga;
    ctx.strokeStyle = st;
    ctx.lineWidth = lw;
  }

  // 치수 라벨(`1000mm (50A)`)은 HTML이라 캔버스에 없다 — 담은 그림 위에 같은 자리·같은 글로
  // 다시 그려 넣는다(흰 종이에는 진한 글씨, 어두운 화면에는 원래 색).
  paintDimLabels(ctx, k, white) {
    const layer = this.dimLayer;
    const nodes = this.dimNodes || [];
    if (!layer || !nodes.length) return 0;
    const base = layer.getBoundingClientRect();
    if (!base.width || !base.height) return 0;
    const scale = k || 1;
    let n = 0;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    nodes.forEach((el) => {
      if (!el || el.hidden || el.style.display === 'none' || !el.textContent) return;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      const x = (r.left - base.left) * scale;
      const y = (r.top - base.top) * scale;
      const w = r.width * scale;
      const h = r.height * scale;
      if (x + w < 0 || y + h < 0 || x > ctx.canvas.width || y > ctx.canvas.height) return;
      const rad = Math.max(2, 4 * scale);
      ctx.beginPath();
      ctx.moveTo(x + rad, y);
      ctx.lineTo(x + w - rad, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
      ctx.lineTo(x + w, y + h - rad);
      ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
      ctx.lineTo(x + rad, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
      ctx.lineTo(x, y + rad);
      ctx.quadraticCurveTo(x, y, x + rad, y);
      ctx.closePath();
      ctx.fillStyle = white ? 'rgba(255, 255, 255, 0.94)' : 'rgba(13, 17, 22, 0.78)';
      ctx.fill();
      ctx.lineWidth = Math.max(1, 1 * scale);
      ctx.strokeStyle = white ? 'rgba(70, 84, 102, 0.55)' : 'rgba(245, 166, 35, 0.38)';
      ctx.stroke();
      let fs = 10.5;
      try { fs = parseFloat(getComputedStyle(el).fontSize) || 10.5; } catch (e) { /* ignore */ }
      ctx.font = `600 ${Math.max(9 * scale, fs * scale)}px "Pretendard", -apple-system, "Malgun Gothic", system-ui, sans-serif`;
      ctx.fillStyle = white ? '#1b2430' : '#ffd28a';
      ctx.fillText(el.textContent, x + w / 2, y + h / 2 + 0.5 * scale);
      n += 1;
    });
    ctx.restore();
    return n;
  }

  // ── 컷 목록 ──────────────────────────────────────────────
  // 목록용 작은 그림(JPEG). 원본 PNG는 그대로 두고 목록에만 작은 사본을 쓴다 —
  // <img>를 만든 직후 drawImage하면 아직 안 풀렸을 때 검은 칸이 되므로 onload 뒤에 줄인다.
  makeThumb(url) {
    return new Promise((resolve) => {
      const img = new Image();
      const fallback = () => resolve(url);
      img.onload = () => {
        try {
          const w = 168;
          const h = Math.max(1, Math.round(w * ((img.naturalHeight || img.height) / (img.naturalWidth || img.width || 1))));
          const c = document.createElement('canvas');
          c.width = w;
          c.height = Math.min(h, w * 2);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          const t = c.toDataURL('image/jpeg', 0.72);
          resolve(t.length > 64 ? t : url);
        } catch (e) { fallback(); }
      };
      img.onerror = fallback;
      img.src = url;
    });
  }

  addCut() {
    const MAX = 12;
    if (this.cuts.length >= MAX) {
      this.toast(`컷은 ${MAX}장까지 담을 수 있습니다 — 하나 지우고 다시 담아 주세요.`);
      return null;
    }
    const cap = this.captureView();
    const cut = {
      id: `cut${++this.cutSeq}`,
      title: `컷 ${this.cuts.length + 1}`,
      memo: '',
      url: cap.url,
      thumb: cap.url,       // 목록에는 먼저 원본을 쓰고, 작은 사본이 준비되면 바꿔 끼운다
      w: cap.w,
      h: cap.h,
      bg: cap.white ? 'white' : 'dark',
      at: Date.now(),
    };
    this.cuts.push(cut);
    this.renderCutList();
    // 방금 담은 컷이 목록 아래에 가려지지 않게 그쪽으로 굴려 준다.
    const list = $('#ppList');
    const box = list && list.closest ? list.closest('.pp-body') : null;
    if (box) box.scrollTop = box.scrollHeight;
    this.makeThumb(cap.url).then((t) => {
      cut.thumb = t;
      // 다시 그리지 않고 그 칸의 그림만 바꾼다(제목을 치는 중이면 초점을 잃지 않게).
      const el = document.querySelector(`#ppList img[data-id="${cut.id}"]`);
      if (el && el.src !== t) el.src = t;
    });
    this.toast(`📷 ${cut.title} 담았습니다 — 3D를 다음 구역으로 옮겨 또 담으세요.`);
    return cut;
  }

  renderCutList() {
    const host = $('#ppList');
    const cnt = $('#ppCount');
    if (cnt) cnt.textContent = `컷 ${this.cuts.length}장`;
    const b = $('#ppPrint');
    if (b) b.textContent = this.cuts.length > 1 ? `🖨️ A4 도면 인쇄 / PDF 저장 (${this.cuts.length}컷)` : '🖨️ A4 도면 인쇄 / PDF 저장';
    if (!host) return;
    if (!this.cuts.length) {
      host.innerHTML = '<li class="pp-empty">아직 담은 컷이 없습니다.<br>3D를 원하는 구역으로 옮긴 뒤 <b>📷 현재 화면 컷 담기</b>를 누르면 차례로 쌓입니다.</li>';
      return;
    }
    host.innerHTML = this.cuts.map((c, i) => `
      <li class="pp-cut" data-id="${c.id}">
        <img class="pp-thumb" data-id="${c.id}" alt="" src="${c.thumb || c.url}">
        <div class="pp-cut-body">
          <input class="pp-title-in" data-id="${c.id}" value="${esc(c.title)}" maxlength="40" placeholder="제목 (예: 펌프 구역)" aria-label="컷 ${i + 1} 제목">
          <input class="pp-memo-in" data-id="${c.id}" value="${esc(c.memo)}" maxlength="70" placeholder="메모 (선택 · 예: P-101 토출 정면)" aria-label="컷 ${i + 1} 메모">
          <div class="pp-cut-acts">
            <button type="button" class="pp-mini" data-act="png" data-id="${c.id}">PNG 저장</button>
            <button type="button" class="pp-mini del" data-act="del" data-id="${c.id}">삭제</button>
            <span class="pp-dim">${c.bg === 'dark' ? '⬛ ' : ''}${c.w}×${c.h}</span>
          </div>
        </div>
      </li>`).join('');
  }

  onCutListInput(e) {
    const t = e.target;
    if (!t || !t.dataset || !t.dataset.id) return;
    const cut = this.cuts.find((c) => c.id === t.dataset.id);
    if (!cut) return;
    if (t.classList.contains('pp-title-in')) cut.title = t.value;
    else if (t.classList.contains('pp-memo-in')) cut.memo = t.value;
  }

  onCutListClick(e) {
    const b = e.target && e.target.closest ? e.target.closest('button[data-act]') : null;
    if (!b) return;
    const cut = this.cuts.find((c) => c.id === b.dataset.id);
    if (!cut) return;
    const i = this.cuts.indexOf(cut);
    if (b.dataset.act === 'png') {
      this.downloadDataUrl(this.cutFileName(i), cut.url);
      this.toast(`📷 ${cut.title} PNG로 저장했습니다`);
    } else if (b.dataset.act === 'del') {
      this.cuts.splice(i, 1);
      this.renderCutList();
      this.toast(`${cut.title}을(를) 뺐습니다 — 남은 컷 ${this.cuts.length}장`);
    }
  }

  clearCuts() {
    if (!this.cuts.length) { this.toast('지울 컷이 없습니다.'); return; }
    const n = this.cuts.length;
    this.cuts = [];
    this.renderCutList();
    this.toast(`담은 컷 ${n}장을 모두 지웠습니다`);
  }

  cutFileName(i) {
    const d = new Date();
    const p2 = (n) => String(n).padStart(2, '0');
    return `smile-piping-cut${i + 1}-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}.png`;
  }

  downloadDataUrl(filename, dataUrl) {
    try {
      // data: URL을 그대로 a[download]에 넣으면 iOS Safari가 새 탭으로 열어 버린다 —
      // Blob URL로 바꿔 내려받게 한다(못 만들면 data: URL 그대로).
      let href = dataUrl;
      let blobUrl = null;
      const m = /^data:([^;,]*)(;base64)?,([\s\S]*)$/.exec(String(dataUrl || ''));
      if (m && m[2] && window.Blob && window.URL && URL.createObjectURL) {
        const bin = atob(m[3]);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i += 1) arr[i] = bin.charCodeAt(i);
        blobUrl = URL.createObjectURL(new Blob([arr], { type: m[1] || 'image/png' }));
        href = blobUrl;
      }
      const a = document.createElement('a');
      a.href = href;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      if (blobUrl) setTimeout(() => URL.revokeObjectURL(blobUrl), 4000);
      return true;
    } catch (e) {
      console.warn('PNG 저장 실패', e);
      this.toast('PNG를 저장하지 못했습니다 — 브라우저 다운로드 설정을 확인해 주세요.', { type: 'err' });
      return false;
    }
  }

  // 지금 화면 한 장만 PNG로 바로 저장
  saveCutPng() {
    const cap = this.captureView();
    if (this.downloadDataUrl(this.cutFileName(0).replace('cut1', 'view'), cap.url)) {
      this.toast('📷 지금 화면을 PNG로 저장했습니다');
    }
    return cap;
  }

  // ── A4 인쇄 시트 ─────────────────────────────────────────
  buildPrintSheet(list, opts) {
    const host = $('#printSheet');
    if (!host) return Promise.resolve({ pages: 0, cuts: 0 });
    const src = (list || this.cuts || []).filter((c) => c && c.url);
    const wantPer = Number((opts && opts.perPage) || this.ppPerPage) || 1;
    const per = [1, 2, 4].includes(wantPer) ? wantPer : (wantPer >= 4 ? 4 : wantPer >= 2 ? 2 : 1);
    const portrait = this.ppOrient === 'portrait';
    this.applyPrintPageStyle();       // @page 규칙과 시트 클래스를 지금 방향으로 맞춘다
    // 자재·배관 수량표는 기본으로 넣지 않는다 — 인쇄 창에서 체크했을 때만 마지막 장에 붙는다(v82).
    const withBom = opts && typeof opts.bom === 'boolean' ? opts.bom : !!this.ppBom;
    const d = new Date();
    const p2 = (n) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
    const scene = this.state.name || '내 배관 도면';
    const groups = [];
    for (let i = 0; i < src.length; i += per) groups.push(src.slice(i, i + per));
    // 수량표를 켰을 때만 수량표 1장 + 직관 절단표(24줄마다 1장)
    const bom = withBom ? this.buildBom() : null;
    const cutPages = bom && bom.cuts.length ? Math.ceil(bom.cuts.length / 24) : 0;
    const total = groups.length + (withBom ? 1 + cutPages : 0);
    const brand = this.printBrand();

    const head = (right) => `
      <header class="ps-head">
        <div class="ps-brand"><b>${brand.title}</b><span>${esc(scene)}</span></div>
        <div class="ps-meta">${stamp} · 컷 ${src.length}장 · ${right}</div>
      </header>`;

    let html = '';
    groups.forEach((group, gi) => {
      const figs = `<div class="ps-figs">${group.map((c) => `
        <figure class="ps-fig">
          <div class="ps-img"><img data-cut="${esc(c.id)}" alt="${esc(c.title || '도면 컷')}"></div>
          <figcaption><b>${esc(c.title || '')}</b>${c.memo ? `<span>${esc(c.memo)}</span>` : ''}</figcaption>
        </figure>`).join('')}</div>`;
      html += `
      <section class="ps-page ps-per-${per}">
        ${head(`${gi + 1}/${total}`)}
        ${figs}
        <footer class="ps-foot">${brand.foot} · 단위 m · A4 ${portrait ? '세로' : '가로'} · 컷 ${gi * per + 1}~${gi * per + group.length}</footer>
      </section>`;
    });

    if (withBom) html += this.bomPageHtml(stamp, src.length, `${groups.length + 1}/${total}`);
    if (withBom) html += this.cutListPagesHtml(stamp, src.length, groups.length + 2, total);
    host.innerHTML = html;

    // 이미지는 innerHTML에 넣지 않고 프로퍼티로 — base64가 길어 마크업이 무거워진다.
    const byId = {};
    src.forEach((c) => { byId[c.id] = c; });
    const imgs = Array.from(host.querySelectorAll('img[data-cut]'));
    imgs.forEach((img) => {
      const c = byId[img.dataset.cut];
      if (c) img.src = c.url;
    });
    const done = Promise.all(imgs.map((img) => (img.decode ? img.decode().catch(() => {}) : Promise.resolve())));
    this.ppPrinted = true;
    this.printSheetInfo = { pages: total, cuts: imgs.length, per, bom: withBom, cutPages, landscape: !portrait, orientation: portrait ? 'portrait' : 'landscape' };
    return done.then(() => this.printSheetInfo);
  }

  // 자재 · 배관 수량표 — 지금 도면의 배관 길이(관경·재질별)와 부속·장비 개수를 센다.
  // v84 — 길이는 **직관 절단 길이**로 센다. 양 끝에 티·레듀샤가 물린 구간은 중심선 길이도 함께 센다.
  buildBom() {
    const matLabel = (m) => (MATERIALS[m] && MATERIALS[m].label) || '흑관·카본스틸';
    const pipeMap = new Map();
    const cuts = [];
    let totalLen = 0;
    let totalCenter = 0;
    (this.state.pipes || []).forEach((p) => {
      const mat = matLabel(p.material);
      const key = `${p.bore}|${mat}`;
      const row = pipeMap.get(key) || { bore: p.bore, material: mat, len: 0, center: 0, segs: 0, count: 0 };
      const pts = p.points || [];
      for (let i = 1; i < pts.length; i += 1) {
        const s = this.segCutInfo(p, i);
        if (!s || s.cut < 0.001) continue;
        row.len += s.cut;
        row.center += s.center;
        row.segs += 1;
        totalLen += s.cut;
        totalCenter += s.center;
        cuts.push({
          pipe: p.name, index: i, bore: p.bore, cut: s.cut, center: s.center,
          fits: [s.fa, s.fb].filter(Boolean)
            .map((f) => `${f.label} ${Math.round(f.std * 1000 * 10) / 10}`).join(' + '),
        });
      }
      row.count += 1;
      pipeMap.set(key, row);
    });
    cuts.sort((a, b) => (b.cut - a.cut) || String(a.pipe).localeCompare(String(b.pipe)) || (a.index - b.index));
    const catLabel = { equip: '장비', valve: '밸브', fitting: '부속', instr: '계기' };
    const partMap = new Map();
    let eqCount = 0;
    (this.state.equipment || []).forEach((e) => {
      const t = EQUIP_TYPES[e.type];
      if (!t) return;
      let spec = e.bore || t.bore || '';
      if (e.type === 'tee') spec = `${e.bore1 || t.bore1 || ''} × ${e.bore2 || t.bore2 || e.bore1 || t.bore1 || ''}`;
      else if (e.type === 'reducer') spec = `${e.bore1 || t.bore1 || ''} → ${e.bore2 || t.bore2 || ''}`;
      const key = `${t.cat}|${t.label}|${spec}`;
      const row = partMap.get(key) || { type: catLabel[t.cat] || '부속', name: t.label, spec, qty: 0 };
      row.qty += 1;
      partMap.set(key, row);
      if (t.cat === 'equip') eqCount += 1;
    });
    const order = { 장비: 0, 밸브: 1, 부속: 2, 계기: 3 };
    const parts = Array.from(partMap.values()).sort((a, b) => (order[a.type] - order[b.type]) || a.name.localeCompare(b.name));
    return {
      pipes: Array.from(pipeMap.values()).sort((a, b) => b.len - a.len),
      parts,
      cuts,
      totalLen,
      totalCenter,
      pipeCount: (this.state.pipes || []).length,
      equipCount: eqCount,
      partCount: (this.state.equipment || []).length - eqCount,
    };
  }

  // 인쇄 시트 머리글·바닥글의 업체명 — 비우면 업체명 없이 깔끔하게 (v84).
  printBrand() {
    const co = String(this.ppCompany == null ? '' : this.ppCompany).trim();
    return {
      title: co ? `${esc(co)} 3D 배관 도면` : '3D 배관 도면',
      foot: co ? `${esc(co)} · 3D 배관 레이아웃` : '3D 배관 레이아웃',
    };
  }

  bomPageHtml(stamp, cutCount, pageLabel) {
    const b = this.buildBom();
    const m2 = (v) => Number(v || 0).toFixed(2);
    const mm = (v) => Math.round(v * 1000).toLocaleString();
    // 배관 표 — 길이는 **직관 절단 길이(mm)** 합계, 중심선은 티·레듀샤 값까지 더한 길이
    const pipeRows = b.pipes.length
      ? b.pipes.map((r) => `<tr><td>${esc(r.bore)}</td><td>${esc(r.material)}</td><td class="num">${r.segs}</td><td class="num">${mm(r.len)}</td><td class="num">${mm(r.center)}</td></tr>`).join('')
      : '<tr><td colspan="5" class="none">배관 없음</td></tr>';
    const partRows = b.parts.length
      ? b.parts.map((r) => `<tr><td>${esc(r.type)}</td><td>${esc(r.name)}</td><td>${esc(r.spec || '—')}</td><td class="num">${r.qty}</td></tr>`).join('')
      : '<tr><td colspan="4" class="none">부속 없음</td></tr>';
    const brand = this.printBrand();
    return `
      <section class="ps-page ps-bom">
        <header class="ps-head">
          <div class="ps-brand"><b>${brand.title}</b><span>자재 · 배관 수량표</span></div>
          <div class="ps-meta">${stamp} · 컷 ${cutCount}장 · ${pageLabel}</div>
        </header>
        <p class="ps-sum">장비 <b>${b.equipCount}</b> · 배관 <b>${b.pipeCount}</b>개 직관 <b>${m2(b.totalLen)}</b>m · 부속·계기 <b>${b.partCount}</b></p>
        <h4 class="ps-sub">배관 (관경 · 재질별)</h4>
        <table class="ps-table ps-pipe">
          <thead><tr><th>관경</th><th>재질</th><th class="num">구간</th><th class="num">직관 절단 (mm)</th><th class="num">중심선 (mm)</th></tr></thead>
          <tbody>${pipeRows}</tbody>
          <tfoot><tr><th colspan="2">합계</th><td class="num">${b.pipes.reduce((a, r) => a + r.segs, 0)}</td><td class="num">${mm(b.totalLen)}</td><td class="num">${mm(b.totalCenter)}</td></tr></tfoot>
        </table>
        <h4 class="ps-sub">부속 · 장비 수량</h4>
        <table class="ps-table ps-parts">
          <thead><tr><th>구분</th><th>품명</th><th>규격</th><th class="num">수량</th></tr></thead>
          <tbody>${partRows}</tbody>
        </table>
        <p class="ps-note">직관 절단은 도면에 그린 배관 점 사이 길이 그대로입니다(양 끝 부속값 제외). 중심선은 티·레듀샤의 중심~접합면 값까지 더한 길이입니다. 현장 실측·여유율은 반영되지 않았습니다.</p>
        <footer class="ps-foot">${brand.foot}</footer>
      </section>`;
  }

  // ✂️ 직관 절단표 — 자재 수량표를 켜면 한 장 더 붙는다. 긴 직관부터 관경·배관별로 늘어놓아
  // 현장에서 그대로 자를 수 있게 한다(길이 내림차순). 한 장에 24줄까지, 넘으면 다음 장.
  cutListPagesHtml(stamp, cutCount, startPage, totalPages) {
    const b = this.buildBom();
    if (!b.cuts.length) return '';
    const per = 24;
    const mm = (v) => Math.round(v * 1000).toLocaleString();
    const brand = this.printBrand();
    let html = '';
    for (let p = 0; p * per < b.cuts.length; p += 1) {
      const rows = b.cuts.slice(p * per, (p + 1) * per);
      html += `
      <section class="ps-page ps-cut">
        <header class="ps-head">
          <div class="ps-brand"><b>${brand.title}</b><span>직관 절단표</span></div>
          <div class="ps-meta">${stamp} · 컷 ${cutCount}장 · ${startPage + p}/${totalPages}</div>
        </header>
        <table class="ps-table ps-cut-table">
          <thead><tr><th class="num">#</th><th>배관</th><th class="num">구간</th><th>관경</th>
            <th class="num">절단 (mm)</th><th class="num">중심선 (mm)</th><th>양 끝 부속</th></tr></thead>
          <tbody>${rows.map((c, i) => `<tr><td class="num">${p * per + i + 1}</td><td>${esc(c.pipe)}</td>
            <td class="num">${c.index}</td><td>${esc(c.bore)}</td><td class="num"><b>${mm(c.cut)}</b></td>
            <td class="num">${mm(c.center)}</td><td>${esc(c.fits || '—')}</td></tr>`).join('')}</tbody>
        </table>
        <p class="ps-note">긴 직관부터 차례대로 적었습니다. 절단 길이는 배관 점 사이 그대로이고, 중심선은 양 끝 티·레듀샤 값까지 더한 길이입니다. 절단 여유(톱날·면취)는 넣지 않았습니다.</p>
        <footer class="ps-foot">${brand.foot} · 직관 ${b.cuts.length}구간</footer>
      </section>`;
    }
    return html;
  }

  // 🖨️ A4 도면 인쇄 / PDF 저장 — 담은 컷 전부(없으면 지금 화면)를 A4 시트로 인쇄한다.
  printAllCuts() {
    if (!this.cuts.length) {
      const cut = this.addCut();
      if (!cut) return Promise.resolve(null);
    }
    return this.buildPrintSheet(this.cuts).then((info) => {
      this.toast('🖨️ 인쇄 창에서 프린터를 고르거나 “PDF로 저장”을 선택하세요.');
      setTimeout(() => this.doPrint(), 80);
      return info;
    });
  }

  // 🖨️ 바로 인쇄 — 지금 화면 한 장만 A4로 인쇄(컷 목록은 건드리지 않는다)
  printOneCut() {
    const cap = this.captureView();
    const one = { id: `one${Date.now()}`, title: '지금 화면', memo: '', url: cap.url, bg: cap.white ? 'white' : 'dark' };
    return this.buildPrintSheet([one], { perPage: 1 }).then((info) => {
      this.toast('🖨️ 지금 화면 한 장을 인쇄합니다 — “PDF로 저장”도 같은 창에서 고를 수 있습니다.');
      setTimeout(() => this.doPrint(), 80);
      return info;
    });
  }

  doPrint() {
    try {
      window.print();
    } catch (e) {
      console.warn('인쇄 창을 열지 못했습니다', e);
      this.toast('인쇄 창을 열지 못했습니다 — 브라우저의 인쇄를 이용해 주세요.', { type: 'err' });
    }
  }

  // ── 저장 / 불러오기 / 내보내기 ───────────────────────────
  scheduleSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    // 600ms → 150ms (v81). 폰에서 배관을 옮기자마자 앱을 전환·종료해도 마지막 이동이 남게
    // 대기 시간을 줄이고, 화면이 가려지거나 탭이 닫힐 때는 아래 flushPendingSave()가 바로 기록한다.
    this.saveTimer = setTimeout(() => this.flushSave(), 150);
  }

  // 대기 중인 저장이 있으면 곧바로 기록한다 — pagehide · beforeunload · 화면 숨김에서 부른다.
  flushPendingSave() {
    if (!this.saveTimer) return false;
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    return this.flushSave();
  }

  // 저장 공간이 모자라면 도면 이미지(src)만 빼고 장비·배관은 반드시 남긴다.
  flushSave() {
    this.saveTimer = null;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
      this.saveWarned = false;
      return true;
    } catch (e) {
      if (!isQuotaError(e)) {
        console.warn('자동 저장 실패', e);
        return false;
      }
      try {
        const slim = Object.assign({}, this.state, {
          floorPlan: Object.assign({}, this.state.floorPlan, { src: null }),
        });
        localStorage.setItem(STORAGE_KEY, JSON.stringify(slim));
        if (!this.saveWarned) {
          this.saveWarned = true;
          this.toast('장비·배관은 저장했습니다. 도면 사진은 저장 공간이 모자라 함께 저장하지 못했어요.');
        }
        return true;
      } catch (e2) {
        console.warn('자동 저장 실패(도면 제외 저장도 실패)', e2);
        if (!this.saveWarned) {
          this.saveWarned = true;
          this.toast('자동 저장에 실패했습니다. [파일] 탭에서 JSON으로 저장해 두세요.', { type: 'err' });
        }
        return false;
      }
    }
  }

  saveJson() {
    downloadText(timestampName('json'), JSON.stringify(this.state, null, 2), 'application/json');
    this.toast('JSON 파일을 저장했습니다.');
  }

  loadJson(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const next = normalizeState(parsed);
        if (!next.equipment.length && !next.pipes.length && !next.floorPlan.src) {
          this.toast('불러온 파일에서 장비·배관을 찾지 못했습니다.', { type: 'err' });
          return;
        }
        this.pushUndo('JSON 불러오기');
        this.state = next;
        this.selection = null;
        this.planSrc = null;
        this.rebuild();
        this.syncPlanInputs();
        this.toast(`불러왔습니다 · 장비 ${next.equipment.length} / 배관 ${next.pipes.length}`);
      } catch (e) {
        this.toast('JSON 파일을 읽지 못했습니다.', { type: 'err' });
      }
    };
    reader.readAsText(file);
  }

  exportFusion() {
    const text = buildFusionScript(this.state);
    downloadText(timestampName('py'), text, 'text/x-python;charset=utf-8');
    this.openModal({
      title: 'Fusion 360 스크립트 저장됨',
      body: `
        <p><b>${esc(this.state.name)}</b> 기준으로 Fusion 360용 Python 스크립트를 만들었습니다.<br>
        장비 <b>${this.state.equipment.length}</b>개 · 배관 <b>${this.state.pipes.length}</b>개가 실제 3D 바디로 생성됩니다.</p>
        <ol>
          <li>Fusion 360 → <b>도구(Tools) → 스크립트 및 추가기능</b>을 엽니다.</li>
          <li><b>스크립트</b> 탭 → <b>생성(Create)</b> → <b>스크립트</b> → 언어 <code>Python</code>, 이름 <code>SmilePiping3D</code>.</li>
          <li>생성된 폴더의 <code>SmilePiping3D.py</code>를 방금 받은 파일로 덮어씁니다.</li>
          <li>목록에서 선택하고 <b>실행(Run)</b>을 누르면 새 문서에 배관 모델이 만들어집니다.</li>
        </ol>
        <p class="hint">단위: 웹앱 1m = Fusion 100cm(내부 단위). Fusion 화면 단위를 mm로 두면 치수가 그대로 보입니다.</p>`,
      actions: [{ label: '확인', cls: 'accent' }],
    });
  }

  exportObj() {
    const res = buildOBJ(this.root, this.state.name);
    downloadText(timestampName('obj'), res.text, 'text/plain;charset=utf-8');
    this.toast(`OBJ 저장 완료 · 메쉬 ${res.meshCount}개 / 삼각형 ${res.triCount}개`);
  }

  // ── 도면 이미지 ─────────────────────────────────────────
  applyPlanImage(dataUrl) {
    const img = new Image();
    img.onload = () => {
      this.state.floorPlan.src = dataUrl;
      this.state.floorPlan.aspect = img.naturalWidth / Math.max(1, img.naturalHeight);
      if (this.state.floorPlan.width < 4) this.state.floorPlan.width = 12;
      this.planSrc = null;
      this.applyPlan();
      this.syncPlanInputs();
      this.scheduleSave();
      this.toast('도면을 바닥에 깔았습니다. 투명도·크기를 조절해 보세요.');
    };
    img.onerror = () => this.toast('이미지를 읽지 못했습니다. JPG/PNG 파일을 사용해 주세요.', { type: 'err' });
    img.src = dataUrl;
  }

  syncPlanInputs() {
    const p = this.state.floorPlan;
    const has = !!p.src;
    $('#planControls').hidden = !has;
    $('#planEmpty').hidden = has;
    $('#planVisible').checked = !!p.visible;
    this.syncPlanOptions(!!p.visible);
    $('#planOpacity').value = String(p.opacity);
    $('#planOpacityVal').textContent = Math.round(p.opacity * 100) + '%';
    $('#planWidth').value = String(p.width);
    $('#planWidthVal').textContent = fmt(p.width) + ' m';
    $('#planRot').value = String(p.rot);
    $('#planRotVal').textContent = Math.round(p.rot) + '°';
    $('#planX').value = fmt(p.x);
    $('#planZ').value = fmt(p.z);
    $('#btnPlanUpload').textContent = has ? '다른 도면 올리기' : '도면·현장 사진 올리기';
  }

  // '바닥에 표시'가 꺼져 있으면 그 아래 투명도·크기·회전·위치·도면 지우기를 접는다.
  // (체크하면 다시 펼침 — 페이지 초기 로드·씬 복원 때도 syncPlanInputs가 상태에 맞춰 준다)
  syncPlanOptions(visible) {
    const box = $('#planOptions');
    const cb = $('#planVisible');
    if (box) box.hidden = !visible;
    if (cb) cb.setAttribute('aria-expanded', visible ? 'true' : 'false');
  }

  // 휴대폰 고해상도 사진은 긴 변 2048px · JPEG 0.86로 줄여서 넘긴다.
  // (예전 1600px · 0.82는 멀리 있는 밸브·배관 굵기 차이가 뭉개져 AI가 라인을 놓쳤다 —
  //  사용자 요청 "사진을 확대해서 더 디테일하게 보고 그려줄수없어?")
  readImageFile(file, cb) {
    if (!file) return;
    if (!/^image\//.test(file.type)) { this.toast('이미지 파일만 올릴 수 있습니다.', { type: 'err' }); return; }
    const MAX_SIDE = 2048;
    const QUALITY = 0.86;

    const viaFileReader = () => {
      const reader = new FileReader();
      reader.onload = () => cb(String(reader.result));
      reader.onerror = () => this.toast('이미지를 읽지 못했습니다. JPG/PNG 파일을 사용해 주세요.', { type: 'err' });
      reader.readAsDataURL(file);
    };

    let url = '';
    try { url = URL.createObjectURL(file); } catch (e) { viaFileReader(); return; }

    const img = new Image();
    img.onload = () => {
      let out = null;
      try {
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        if (!w || !h) throw new Error('이미지 크기를 읽지 못했습니다.');
        const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
        const tw = Math.max(1, Math.round(w * scale));
        const th = Math.max(1, Math.round(h * scale));
        const canvas = document.createElement('canvas');
        canvas.width = tw;
        canvas.height = th;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('캔버스를 만들지 못했습니다.');
        ctx.fillStyle = '#ffffff'; // 투명 PNG도 JPEG에서 까맣게 나오지 않도록
        ctx.fillRect(0, 0, tw, th);
        ctx.imageSmoothingEnabled = true;
        if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, tw, th);
        const dataUrl = canvas.toDataURL('image/jpeg', QUALITY);
        if (!dataUrl || dataUrl.indexOf('data:image/jpeg') !== 0 || dataUrl.length < 128) {
          throw new Error('압축 결과가 올바르지 않습니다.');
        }
        canvas.width = 0;
        canvas.height = 0;
        out = dataUrl;
      } catch (e) {
        console.warn('이미지 자동 압축 실패, 원본으로 대체', e);
      } finally {
        if (url) URL.revokeObjectURL(url);
      }
      if (out) cb(out); else viaFileReader();
    };
    img.onerror = () => {
      if (url) URL.revokeObjectURL(url);
      console.warn('이미지 디코드 실패, 원본으로 대체');
      viaFileReader();
    };
    img.src = url;
  }

  // ── AI ─────────────────────────────────────────────────
  // 분석하는 동안 폰 화면이 자동으로 꺼지지 않게 잡아 둔다.
  // Wake Lock은 부가 기능이라, 지원하지 않거나 막힌 브라우저에서는 조용히 넘어간다.
  async acquireWakeLock() {
    try {
      const wl = navigator.wakeLock;
      if (!wl || typeof wl.request !== 'function') return;
      if (this.wakeLock && !this.wakeLock.released) return;
      const sentinel = await wl.request('screen');
      if (!this.aiRunning) {
        // 요청이 늦게 끝났는데 이미 분석이 끝난 경우 — 잡은 화면을 바로 풀어둔다.
        try { if (sentinel && !sentinel.released && typeof sentinel.release === 'function') sentinel.release(); } catch (e) { /* ignore */ }
        return;
      }
      this.wakeLock = sentinel;
      if (sentinel && typeof sentinel.addEventListener === 'function') {
        sentinel.addEventListener('release', () => {
          if (this.wakeLock === sentinel) this.wakeLock = null;
        });
      }
    } catch (e) {
      this.wakeLock = null;
    }
  }

  releaseWakeLock() {
    const sentinel = this.wakeLock;
    this.wakeLock = null;
    try {
      if (sentinel && !sentinel.released && typeof sentinel.release === 'function') {
        const p = sentinel.release();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      }
    } catch (e) { /* 이미 풀렸거나 지원하지 않는 경우 */ }
  }

  showAiProgress() {
    const el = $('#aiProgress');
    if (el) el.hidden = false;
  }

  hideAiProgress() {
    const el = $('#aiProgress');
    if (el) el.hidden = true;
  }

  apiKey() { return localStorage.getItem(KEY_API) || ''; }

  // 예전 기본값(gemini-2.5-flash 등)이 남아 있으면 신규 키에서 거절되므로 한 번만 새 기본값으로 옮긴다.
  // 옮긴 뒤 사용자가 직접 구형 모델을 고르면 그 선택은 존중한다.
  model() {
    let saved = (localStorage.getItem(KEY_MODEL) || '').trim().replace(/^models\//, '');
    const migrated = localStorage.getItem(KEY_MODEL_MIGRATED) === '1';
    if (!migrated) {
      if (saved && LEGACY_MODELS.includes(saved)) {
        saved = DEFAULT_MODEL;
        try { localStorage.setItem(KEY_MODEL, saved); } catch (e) { /* 저장 불가 시 메모리 값 사용 */ }
      }
      try { localStorage.setItem(KEY_MODEL_MIGRATED, '1'); } catch (e) { /* ignore */ }
    }
    return saved || DEFAULT_MODEL;
  }

  // 사진은 최대 6장 · 원본 20MB까지 — 넘으면 안내하고 건너뛴다.
  aiPhotoLimit() { return 6; }
  aiPhotoMaxBytes() { return 20 * 1024 * 1024; }

  async startAI() {
    if (this.aiRunning) {
      this.toast('AI 분석이 아직 진행 중입니다. 끝나면 결과를 알려 드립니다.');
      return;
    }
    const key = this.apiKey();
    if (!key) {
      this.openSettings('AI 자동 분석을 쓰려면 Google Gemini API 키를 먼저 입력하세요. 키가 없어도 수동 편집과 도면 깔기는 그대로 쓸 수 있습니다.');
      return;
    }
    this.openAiPhotos();
  }

  // ── AI 사진 첨부 창 (여러 장) ─────────────────────────────
  // 바닥에 깔린 도면이 있으면 첫 사진으로 넣어 두고, 사진을 더 붙일 수 있게 한다.
  openAiPhotos() {
    if (!Array.isArray(this.aiPhotos)) this.aiPhotos = [];
    const plan = this.state.floorPlan && this.state.floorPlan.src;
    if (plan && !this.aiPhotos.length) {
      this.aiPhotos.push({ src: plan, name: '바닥에 깔린 도면', size: 0 });
    }
    this.openModal({
      title: 'AI 자동 분석 · 사진 첨부',
      body: `
        <div class="ai-photo-box">
          <div class="ai-photo-grid" id="aiPhotoGrid"></div>
          <p class="hint" id="aiPhotoHint"></p>
          <div class="ai-photo-btns">
            <button class="btn accent shoot" id="aiPhotoShoot" type="button">📷 바로 촬영</button>
            <button class="btn" id="aiPhotoAdd" type="button">🖼 사진첩에서 추가</button>
            <button class="btn ghost small" id="aiPhotoClear" type="button">전체 비우기</button>
          </div>
          <input type="file" id="aiPhotos" accept="image/*" multiple hidden>
          <!-- 바로 촬영 — 휴대폰에서는 카메라가 바로 열리고, 촬영한 사진이 목록에 들어간다. -->
          <input type="file" id="aiPhotosCam" accept="image/*" capture="environment" hidden>
        </div>
        <p class="hint">현장 사진·도면·손그림을 최대 6장까지 올릴 수 있습니다. <b>📷 바로 촬영</b>으로 지금 현장을 찍어 바로 분석할 수 있습니다.</p>
        <p class="hint">정면 사진과 함께 <b>다른 각도(측면·위쪽) 추가 사진</b>을 올리면 3D 깊이와 배관 연결을 훨씬 정확하게 잡습니다.</p>`,
      actions: [
        { label: 'AI 분석 시작', cls: 'accent', keep: true, onClick: () => this.runAiFromPhotos() },
        { label: '닫기' },
      ],
    });
    const add = $('#aiPhotoAdd', $('#modalRoot'));
    const shoot = $('#aiPhotoShoot', $('#modalRoot'));
    const clear = $('#aiPhotoClear', $('#modalRoot'));
    const input = $('#aiPhotos', $('#modalRoot'));
    const camInput = $('#aiPhotosCam', $('#modalRoot'));
    const grid = $('#aiPhotoGrid', $('#modalRoot'));
    if (add && input) add.addEventListener('click', () => input.click());
    if (shoot && camInput) shoot.addEventListener('click', () => camInput.click());
    if (clear) clear.addEventListener('click', () => { this.aiPhotos = []; this.renderAiPhotos(); });
    if (input) input.addEventListener('change', async (e) => {
      const files = e.target.files ? Array.from(e.target.files) : [];
      e.target.value = ''; // 같은 사진을 다시 골라도 change가 오도록
      await this.addAiPhotos(files);
    });
    if (camInput) camInput.addEventListener('change', async (e) => {
      const files = e.target.files ? Array.from(e.target.files) : [];
      e.target.value = ''; // 다시 찍어도 change가 오도록
      if (!files.length) return;
      await this.addAiPhotos(files);
      // "바로 분석"이 되도록 분석 시작 버튼 위치를 알려 준다(여러 각도로 더 찍을 수 있게 자동 시작은 하지 않는다).
      if (this.aiPhotos.length) this.toast('촬영한 사진을 넣었습니다. 더 찍거나 [AI 분석 시작]을 누르세요.');
    });
    // 썸네일의 × — 누른 사진만 지운다.
    if (grid) grid.addEventListener('click', (e) => {
      const x = e.target && e.target.closest ? e.target.closest('.ai-photo-x') : null;
      if (x) {
        const i = Number(x.dataset.i);
        if (Number.isInteger(i) && i >= 0) { this.aiPhotos.splice(i, 1); this.renderAiPhotos(); }
        return;
      }
    });
    this.renderAiPhotos();
  }

  async addAiPhotos(files) {
    if (!Array.isArray(this.aiPhotos)) this.aiPhotos = [];
    const max = this.aiPhotoLimit();
    const maxBytes = this.aiPhotoMaxBytes();
    let added = 0;
    for (let i = 0; i < files.length; i += 1) {
      const f = files[i];
      if (this.aiPhotos.length >= max) {
        this.toast(`사진은 최대 ${max}장까지만 올릴 수 있습니다.`, { type: 'err' });
        break;
      }
      if (!f || !/^image\//.test(f.type)) {
        this.toast(`${f && f.name ? f.name : '선택한 파일'}: 이미지(JPG/PNG)만 올릴 수 있습니다.`, { type: 'err' });
        continue;
      }
      if (f.size > maxBytes) {
        this.toast(`${f.name}: 사진 용량이 너무 큽니다. 20MB 이하 사진을 써 주세요.`, { type: 'err' });
        continue;
      }
      if (this.aiPhotos.some((p) => p.name === f.name && p.size === f.size)) {
        this.toast(`${f.name}은(는) 이미 올린 사진입니다.`, { type: 'err' });
        continue;
      }
      const src = await this.readImageFileAsync(f);
      if (!src) continue;
      this.aiPhotos.push({ src, name: f.name || `사진 ${this.aiPhotos.length + 1}`, size: f.size });
      added += 1;
      this.renderAiPhotos();
    }
    if (added > 0) this.toast(`사진 ${added}장을 추가했습니다. (${this.aiPhotos.length}/${max})`);
  }

  // readImageFile은 콜백식인데 오류 때 콜백이 오지 않을 수 있어, 기다림에 한도를 둔다.
  readImageFileAsync(file) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (!done) { done = true; resolve(v || null); } };
      const timer = setTimeout(() => finish(null), 8000);
      try {
        this.readImageFile(file, (src) => { clearTimeout(timer); finish(src); });
      } catch (e) {
        clearTimeout(timer);
        finish(null);
      }
    });
  }

  renderAiPhotos() {
    const grid = $('#aiPhotoGrid', $('#modalRoot'));
    if (!grid) return;
    const photos = Array.isArray(this.aiPhotos) ? this.aiPhotos : [];
    const max = this.aiPhotoLimit();
    grid.innerHTML = photos.length
      ? photos.map((p, i) => `
          <div class="ai-photo" title="${esc(p.name || '')}">
            <img src="${p.src}" alt="${esc(p.name || `사진 ${i + 1}`)}">
            <span class="ai-photo-no">${i + 1}</span>
            <button class="ai-photo-x" type="button" data-i="${i}" title="이 사진 빼기" aria-label="${i + 1}번 사진 빼기">×</button>
          </div>`).join('')
      : `<div class="ai-photo-empty">아직 사진이 없습니다.<br><b>📷 바로 촬영</b>으로 지금 현장을 찍거나 <b>🖼 사진첩에서 추가</b>로 올려 주세요.</div>`;
    const hint = $('#aiPhotoHint', $('#modalRoot'));
    if (hint) {
      hint.textContent = photos.length
        ? `사진 ${photos.length}장 / 최대 ${max}장 — 정면과 함께 측면·위쪽 사진을 더 올리면 3D 깊이와 연결이 더 정확해집니다.`
        : `사진을 한 장만 올려도 되고, 현장을 여러 각도에서 찍어 함께 올리면 더 정확합니다. (최대 ${max}장)`;
    }
  }

  // 첨부한 사진들을 한 번에 Gemini로 보낸다.
  async runAiFromPhotos() {
    const photos = (Array.isArray(this.aiPhotos) ? this.aiPhotos : []).map((p) => p.src).filter(Boolean);
    if (!photos.length) {
      this.toast('분석할 사진을 먼저 올려 주세요.', { type: 'err' });
      return;
    }
    // 사진을 처음 올렸고 바닥에 깔 도면이 없다면 첫 사진을 도면으로도 쓴다(예전과 같은 동작).
    if (!this.state.floorPlan.src && photos[0]) this.applyPlanImage(photos[0]);
    // 창은 닫지 않고 그대로 둔 채 내용만 ‘분석 중’으로 바뀐다 — 닫았다 열면
    // 히스토리 항목(뒤로가기)이 어긋나 앞 페이지로 넘어갈 수 있다.
    await this.runAI(photos);
  }

  async runAI(dataUrl) {
    if (this.aiRunning) return; // 한 번에 하나만 — 진행 중인 분석을 다른 창으로 덮어쓰지 않는다.
    const photos = (Array.isArray(dataUrl) ? dataUrl : [dataUrl]).filter(Boolean);
    if (!photos.length) return;
    this.aiRunning = true;
    this.acquireWakeLock(); // 분석하는 동안 폰 화면이 꺼지지 않게 (지원하지 않으면 조용히 무시)
    this.showAiProgress();
    this.openModal({
      title: 'AI 자동 분석',
      body: `<p><span class="loader"></span>사진 ${photos.length}장에서 장비와 배관을 읽는 중입니다. 잠시만 기다려 주세요.</p>
             <p class="hint" id="aiZoomHint">고해상도(2048px) 원본 사진 그대로 읽습니다.</p>
             <p class="hint">분석은 화면을 닫아도 계속됩니다. 결과가 나오면 다시 알려 드립니다.</p>`,
      actions: [],
    });
    try {
      // 사진을 자르지 않고 고해상도 원본 그대로 보낸다 — 4분할 크롭은 AI가 사진마다 다른 시점으로
      // 착각해 방향을 잃는 문제가 있어 뺐다. 깊이·연결은 다른 각도 추가 사진으로 잡는다.
      const parts = await buildAiImageParts(photos);
      const zoomHint = $('#aiZoomHint', $('#modalRoot'));
      if (zoomHint) {
        zoomHint.textContent = `사진 ${photos.length}장(2048px 원본)을 한 번에 분석합니다.`;
      }
      const asked = this.model();
      const { data: res, model: usedModel } = await analyzeImages({ apiKey: this.apiKey(), model: asked, dataUrls: parts });
      if (usedModel && usedModel !== asked) {
        // 구형 모델이 막혀 다른 모델로 성공한 경우 — 다음에도 같은 문제를 겪지 않게 저장해 둔다.
        try { localStorage.setItem(KEY_MODEL, usedModel); localStorage.setItem(KEY_MODEL_MIGRATED, '1'); } catch (e) { /* ignore */ }
        this.toast(`${asked} 모델을 쓸 수 없어 ${usedModel}(으)로 자동 전환했습니다.`);
      }
      const eq = Array.isArray(res.equipment) ? res.equipment : [];
      const pp = Array.isArray(res.pipes) ? res.pipes : [];
      if (!eq.length && !pp.length) throw new Error('이미지에서 장비·배관을 찾지 못했습니다. 다른 사진으로 시도해 보세요.');
      const plan = typeof res.layoutPlan === 'string' ? res.layoutPlan.trim() : '';
      this.openModal({
        title: 'AI 분석 결과',
        body: `
          <div class="ai-result">
            장비 <b>${eq.length}</b>개 · 배관 <b>${pp.length}</b>개를 찾았습니다.<br>
            <span>사진 ${photos.length}장(고해상도 원본)으로 읽었습니다.</span><br>
            ${res.inputKind === 'drawing' ? '<span>도면으로 인식 — 도면에 그려진 것만 배치합니다(자동 연결 없음).</span><br>' : ''}
            ${res.notes ? `<span>${esc(res.notes)}</span>` : ''}
          </div>
          ${plan ? `<div class="ai-plan"><b>구조 정리</b><br>${esc(plan)}</div>` : ''}
          <p class="hint">“씬 교체”를 누르면 지금 씬을 지우고 AI 배치로 바꿉니다. “추가”는 기존 씬에 덧붙입니다.</p>`,
        actions: [
          // keep: true — 열린 창을 먼저 정리한 뒤(closeOverlaysForResult) 배치를 적용한다.
          { label: '씬 교체', cls: 'accent', keep: true, onClick: () => this.applyAiAndClose(res, 'replace') },
          { label: '추가', keep: true, onClick: () => this.applyAiAndClose(res, 'append') },
          { label: '취소' },
        ],
      });
    } catch (e) {
      this.openModal({
        title: 'AI 분석 실패',
        body: `<p class="err-text">${esc(e.message || e)}</p>
               <p class="hint">API 키와 모델을 확인하거나, 사진을 바닥에 깔고 직접 배치해 보세요.</p>`,
        actions: [
          // keep: true — 설정 모달을 연 뒤 이 핸들러의 closeModal()이 새 모달까지 닫지 않게 한다.
          { label: '설정 열기', keep: true, onClick: () => this.openSettings() },
          { label: '닫기', cls: 'accent' },
        ],
      });
    } finally {
      this.aiRunning = false;
      this.releaseWakeLock();
      this.hideAiProgress();
    }
  }

  // AI 결과를 적용하기 전에 열린 창(분석 결과 모달·모바일 도구 서랍·속성 창·보기 바)을
  // 모두 닫고, 적용한 뒤에는 새 배치에 맞춰 등각으로 화면을 맞춘다.
  // — 창이 3D 화면을 가리고 있어 결과 그림이 안 보이는 문제를 막는 부분.
  applyAiAndClose(result, mode) {
    try { this.closeOverlaysForResult(); } catch (e) { /* 이미 닫힌 경우 */ }
    let ok = true;
    try {
      this.applyAIResult(result, mode);
    } catch (e) {
      ok = false;
      this.toast(`AI 배치를 적용하지 못했습니다: ${e && e.message ? e.message : e}`, { type: 'err' });
    }
    if (ok) this.setView('iso'); // 새로 들어온 장비가 화면 안에 꽉 차게
    return ok;
  }

  // 히스토리 항목은 한 번만 되돌린다(창마다 되돌리면 페이지가 뒤로 갈 수 있다).
  closeOverlaysForResult() {
    const modal = $('#modalRoot');
    if (modal) modal.hidden = true;
    const body = $('#modalBody');
    if (body) body.innerHTML = '';
    const actions = $('#modalActions');
    if (actions) actions.innerHTML = '';
    const props = $('#props');
    if (props && !props.hidden) {
      props.hidden = true;
      this.selection = null;
    }
    const drawer = $('#drawer');
    if (drawer) drawer.classList.remove('open');
    if (this.viewbarOpen) this.setViewbar(false);
    this.hideAiProgress();
    this.releaseOverlayEntry();
  }

  applyAIResult(result, mode) {
    // 1차 정리(layoutPlan) → 기하 보정(Sanitize) → 장비·배관 생성 → 후처리 보정.
    // 이 경로는 store.js aiResultToScene() 하나만 타므로, 검증 페이지도 같은 코드를 검증한다.
    const { equipment: eq, pipes, report } = aiResultToScene(result);
    if (!eq.length && !pipes.length) throw new Error('채울 장비·배관이 없습니다.');

    this.pushUndo('AI 배치');
    if (mode === 'replace') {
      this.state.equipment = eq;
      this.state.pipes = pipes;
    } else {
      this.state.equipment.push(...eq);
      this.state.pipes.push(...pipes);
    }
    this.selection = null;
    this.rebuild();
    // 보정한 내용을 짧게 알려 준다 — 무엇이 자동으로 바로잡혔는지 보이게.
    const notes = [];
    if (report.straightened) notes.push(`기운 수직관 ${report.straightened}곳 바로 세움`);
    if (report.stood) notes.push(`수직 배관 밸브 ${report.stood}개 세움`);
    if (report.seated) notes.push(`배관 끝 ${report.seated}곳 헤더 윗면에 맞춤`);
    if (report.lifted) notes.push(`묻힌 부속 ${report.lifted}개 올림`);
    if (report.gauged) notes.push(`계기 ${report.gauged}개 관 밖으로`);
    if (report.welded) notes.push(`배관 이음 ${report.welded}곳 붙임`);
    if (report.snapped) notes.push(`끊긴 배관 끝 ${report.snapped}곳 이어 붙임`);
    if (report.branched) notes.push(`허공에 뜬 배관 끝 ${report.branched}곳 연결`);
    if (report.inputKind === 'drawing') notes.push(`도면 그대로 · 열린 끝 ${report.drawHeld || 0}곳 유지`);
    if (report.spread) notes.push(`겹친 장비 ${report.spread}대 띄움`);
    const extra = notes.length ? ` · ${notes.join(' · ')}` : '';
    this.toast(`AI 배치 완료 · 장비 ${eq.length} / 배관 ${pipes.length}${extra}`,
      { action: '되돌리기', onAction: () => this.undo() });
  }

  // ── UI 바인딩 ───────────────────────────────────────────
  bindUI() {
    // 뷰 — 모바일은 접힌 보기 바의 [등각]을 먼저 펼치고, 뷰를 고르면 다시 접는다.
    $$('.vbtn[data-view]').forEach((b) => b.addEventListener('click', () => {
      if (this.viewbarTap(b)) return;
      this.setView(b.dataset.view);
      const bar = $('#viewbar');
      if (bar && bar.classList.contains('open')) this.setViewbar(false);
    }));
    // 펼친 보기 바 바깥(3D 화면·명령창 등)을 누르면 접힌다.
    document.addEventListener('pointerdown', (e) => {
      const bar = $('#viewbar');
      if (!bar || !bar.classList.contains('open')) return;
      if (e.target && e.target.closest && e.target.closest('#viewbar')) return;
      this.setViewbar(false);
    }, true);
    window.addEventListener('resize', () => {
      if (!this.isMobileLayout() && this.viewbarOpen) this.setViewbar(false);
    });
    // 치수 표시 토글 (기본 켜짐 · localStorage에 기억)
    const btnDims = $('#btnDims');
    if (btnDims) btnDims.addEventListener("click", () => this.setDims(!this.dimsAll));
    // 피팅값 자동계산 — 배관 탭 스위치(조이스틱 버튼과 같은 상태)
    const fitSw = $('#fitAutoSwitch');
    if (fitSw) fitSw.addEventListener('change', () => this.setFitAuto(!!fitSw.checked, true));
    // ✏️ 손 그리기 토글 — 모바일에서는 접힌 보기 바에도 항상 보인다.
    const btnHand = $('#btnHand');
    if (btnHand) btnHand.addEventListener('click', () => this.setHandMode(!this.handMode));

    // 탭
    $$('#tabs .tab').forEach((t) => t.addEventListener('click', () => {
      $$('#tabs .tab').forEach((x) => x.classList.toggle('active', x === t));
      $$('.tabpane').forEach((p) => p.classList.toggle('active', p.dataset.pane === t.dataset.tab));
    }));

    // 장비 버튼 (카테고리별)
    const grid = $('#equipGrid');
    const icons = {
      header: '▬', hx: '▭', pump: '◉', vpump: '⊕', tank: '▮', stank: '▯', rtank: '▣', panel: '▤',
      valve: '✳', bfly: '⊗', yvalve: '⊘', ball: '⊙', check: '◑', safety_valve: '⌂',
      bellows: '≡', elbow: '⌐', tee: '┳', reducer: '◁', flange: '◎', support: '⊥', gauge: '◐',
      nipple: '⬡', elbow45: '◜', cap: '◕', union: '⋈', flow: '⏲',
    };
    EQUIP_CATEGORIES.forEach((cat) => {
      const types = typesByCategory(cat.id);
      if (!types.length) return;
      const head = document.createElement('div');
      head.className = 'equip-cat';
      head.textContent = cat.label;
      grid.appendChild(head);
      types.forEach((type) => {
        const t = EQUIP_TYPES[type];
        const b = document.createElement('button');
        b.className = 'equip-btn';
        b.title = `${t.label} · ${t.defaults.w}×${t.defaults.h}×${t.defaults.d} m`;
        b.innerHTML = `<span class="ico">${icons[type] || '■'}</span><span class="lbl">${t.label}</span>
          <span class="sub">${t.defaults.w}×${t.defaults.h}×${t.defaults.d} m</span>`;
        b.addEventListener('click', () => this.chooseAndAdd(type));
        grid.appendChild(b);
      });
    });

    // 배관 옵션
    const boreSel = $('#newBore');
    Object.keys(BORES).forEach((b) => {
      const o = document.createElement('option');
      o.value = b;
      o.textContent = `${b} (${BORES[b].mm}mm)`;
      boreSel.appendChild(o);
    });
    boreSel.value = '100A';

    const matSel = $('#newMaterial');
    Object.keys(MATERIALS).forEach((m) => {
      const o = document.createElement('option');
      o.value = m;
      o.textContent = MATERIALS[m].label;
      matSel.appendChild(o);
    });
    matSel.value = 'carbon';

    $('#btnDrawPipe').addEventListener('click', () => this.setDrawMode(!this.drawMode));
    $('#draftUndo').addEventListener('click', () => { this.draft.pop(); this.updateDraft(); });
    $('#draftFinish').addEventListener('click', () => this.finishDraft());
    $('#draftCancel').addEventListener('click', () => this.setDrawMode(false));

    // 속성 패널 이벤트 (위임)
    const body = $('#propBody');
    // 고스트 클릭 차단 — 창을 연 직후 350ms 동안 창 안으로 들어오는 터치·마우스·클릭·초점을
    // 캡처 단계에서 먼저 잡아 막는다. 그래야 3D 탭의 후속 click이 '이름' 입력칸에 닿지 않고,
    // 같은 좌표에 있던 [삭제]·[위치 이동] 버튼이 잘못 눌리지도 않는다.
    const propsPanel = $('#props');
    const swallow = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
    };
    const blockGhost = (ev) => {
      const now = performance.now();
      const isStart = ev.type === 'pointerdown' || ev.type === 'touchstart';
      if (isStart) {
        // 창 안을 손·마우스로 직접 누른 것 — 하드 창(350ms) 안이면 이 누름도 버퍼고,
        // 그 뒤라면 이제부터 오는 클릭·초점은 모두 정상이다.
        if (now < this.propsGuardUntil) { swallow(ev); return; }
        this.propsRealDownAt = now;
        this.propsGhostUntil = 0;
        return;
      }
      const hard = now < this.propsGuardUntil;
      // 앞선 '창 안 누름'도, 키 입력도 없이 오는 마우스·클릭·초점 = 3D 탭의 후속(고스트)
      const compat = /^(mousedown|mouseup|click|focusin)$/.test(ev.type);
      const ghostLike = compat && now < this.propsGhostUntil
        && (now - this.propsRealDownAt) > 400 && (now - this.propsLastKeyAt) > 400;
      if (!hard && !ghostLike) return;
      if (ev.type === 'focusin') {
        const t = ev.target;
        if (t && /INPUT|TEXTAREA|SELECT/.test(t.tagName || '') && typeof t.blur === 'function') t.blur();
        return;
      }
      swallow(ev);
    };
    ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'mousedown', 'mouseup', 'click', 'focusin']
      .forEach((type) => propsPanel.addEventListener(type, blockGhost, { capture: true, passive: false }));
    // 키보드로 옮겨 다니는 초점은 막지 않는다.
    document.addEventListener('keydown', () => { this.propsLastKeyAt = performance.now(); }, true);

    body.addEventListener('input', (ev) => {
      const spec = this.getSelectedSpec();
      if (!spec) return;
      const t = ev.target;
      if (t.dataset.f === 'bore1' || t.dataset.f === 'bore2') {
        // 레듀샤·티 — 관경이 바뀌면 길이도 바뀐다. 물린 면을 그 자리에 두고 자유단으로만 자란다.
        this.resizeKeepingMate(spec, () => {
          spec[t.dataset.f] = t.value;
          spec.w = fittingNaturalWidth(spec.type, spec.bore1, spec.bore2);
        });
        this.refreshScene();
        // 티는 접속구 관경 표시(📍 직진 A 100A 등)도 같이 바뀌어야 한다.
        if (spec.type === 'tee') this.renderProps();
        return;
      }
      // 열교환기 헤드 타입 — 양쪽 둥근 ↔ 한쪽 둥근 ↔ 양쪽 평판
      if (t.dataset.f === 'hxType') {
        this.pushUndo('헤드 타입');
        spec.hxType = HX_TYPES.includes(t.value) ? t.value : 'both';
        this.refreshScene();
        this.renderProps();
        return;
      }
      // 티 분기 방향 — 위·아래·앞·뒤로 90°씩 돌리고 분기 접속구 좌표를 다시 계산한다.
      if (t.dataset.f === 'branch') {
        this.pushUndo('분기 방향');
        spec.branch = TEE_BRANCHES.includes(t.value) ? t.value : 'up';
        this.refreshScene();
        this.renderProps();
        return;
      }
      // 밸브·피팅 관경을 바꾸면 몸체·플랜지·핸들 크기를 그 외경 비율로 다시 잡는다.
      //  · 50A→80A처럼 키울 때 중심을 기준으로 양쪽으로 커지면 상류 배관·레듀샤를 파고든다.
      //    물려 있던 면을 0mm로 고정하고 자유단 방향으로만 자라게 한다(`31603`).
      if (t.dataset.f === 'bore' && isBoreSized(spec.type)) {
        const r = this.resizeKeepingMate(spec, () => {
          spec.bore = BORES[t.value] ? t.value : SIZE_REF_BORE;
          applyBoreSize(spec);
        });
        this.refreshScene();
        this.renderProps();
        if (r.kept) this.toast(`관경 ${spec.bore} — 연결부 그대로, 자유단 쪽으로만 커졌습니다`);
        return;
      }
      // 엘보 관경을 바꾸면 외경·곡률·접합면 폭을 다시 뽑는다.
      if (t.dataset.f === 'bore' && (spec.type === 'elbow' || spec.type === 'elbow45')) {
        this.resizeKeepingMate(spec, () => {
          spec.bore = BORES[t.value] ? t.value : '100A';
          const d = elbowDims(spec.type, spec.bore);
          spec.w = d.face;
          spec.h = d.r * 2;
          spec.d = d.r * 2;
        });
        this.refreshScene();
        this.renderProps();
        return;
      }
      // 방향(수평·수직)을 바꾸면 배관 축 벡터보다 이 선택을 우선한다.
      if (t.dataset.f === 'axis') {
        spec.axis = t.value === 'y' ? 'y' : (t.value === 'z' ? 'z' : 'x');
        delete spec.dir;
        this.refreshScene();
        this.renderProps();
        return;
      }
      // 노즐 관경 — 그 방향 노즐을 바로 다시 그린다(없음이면 없앤다).
      if (t.dataset.noz) {
        setNozzle(spec, t.dataset.noz, t.value);
        this.refreshScene();
        this.renderProps();
        return;
      }
      // 열교환기 자유 노즐 — 위치·방향·관경을 바꾸면 3D와 노즐 카드를 바로 다시 그린다.
      if (t.dataset.nozAt || t.dataset.nozDir || t.dataset.nozBore) {
        const nid = t.dataset.nozAt || t.dataset.nozDir || t.dataset.nozBore;
        const patch = t.dataset.nozAt ? { at: t.value }
          : (t.dataset.nozDir ? { dir: t.value } : { bore: t.value });
        this.pushUndo('노즐 수정');
        setHxNozzle(spec, nid, patch);
        this.refreshScene();
        this.renderProps();
        return;
      }
      // 탱크 자유 노즐 — 벽면·높이·가로·관경을 바꾸면 3D와 노즐 카드를 바로 다시 그린다.
      if (t.dataset.tnzFace || t.dataset.tnzBore || t.dataset.tnzH || t.dataset.tnzHmm
        || t.dataset.tnzU || t.dataset.tnzUmm || t.dataset.tnzV || t.dataset.tnzVmm) {
        const d = t.dataset;
        const nid = d.tnzFace || d.tnzBore || d.tnzH || d.tnzHmm || d.tnzU || d.tnzUmm || d.tnzV || d.tnzVmm;
        const cur = tankNozzlesOf(spec).find((n) => n.nid === nid);
        if (!cur) return;
        const patch = {};
        const span = tankHeightSpan(spec);
        if (d.tnzFace) patch.face = t.value;
        else if (d.tnzBore) patch.bore = t.value;
        else if (d.tnzH) { if (t.value !== 'custom') patch.h = Number(t.value); else return; }
        else if (d.tnzHmm) {
          const mm = parseFloat(t.value);
          if (!Number.isFinite(mm)) return;
          patch.h = Math.max(0, Math.min(1, mm / 1000 / span));
        } else if (d.tnzU) { if (t.value !== 'custom') patch.u = Number(t.value); else return; }
        else if (d.tnzUmm) {
          const mm = parseFloat(t.value);
          if (!Number.isFinite(mm)) return;
          patch.u = Math.max(-1, Math.min(1, mm / 1000 / tankLatScale(spec, cur.face)));
        } else if (d.tnzV) { if (t.value !== 'custom') patch.v = Number(t.value); else return; }
        else if (d.tnzVmm) {
          const mm = parseFloat(t.value);
          if (!Number.isFinite(mm)) return;
          patch.v = Math.max(-1, Math.min(1, mm / 1000 / tankDepthScale(spec)));
        }
        if (!Object.keys(patch).length) return;
        this.pushUndo('노즐 수정');
        setTankNozzle(spec, nid, patch);
        this.refreshScene();
        this.renderProps();
        return;
      }
      if (t.dataset.f) {
        let v = t.type === 'number' ? parseFloat(t.value) : t.value;
        if (t.type === 'number' && !Number.isFinite(v)) return;
        if (t.dataset.f === 'name') v = String(v);
        // 엘보 회전값을 직접 바꾸면 자동 방향(inDir/outDir)을 풀고 도면 축 기준으로 놓는다.
        if (t.dataset.f === 'rot' && (spec.type === 'elbow' || spec.type === 'elbow45')) {
          delete spec.inDir;
          delete spec.outDir;
        }
        // 배관 축에 맞춰 놓인 부속도 회전값을 직접 바꾸면 진행 방향을 풀고 축 기준(수평)으로 돌린다.
        if (t.dataset.f === 'rot') delete spec.dir;
        // 길이(가로)를 바꾸면 몸체가 양쪽으로 커져 연결부를 파고들 수 있다 — 물린 면 고정.
        if (t.dataset.f === 'w' && spec.kind !== 'pipe') {
          this.resizeKeepingMate(spec, () => { spec.w = v; });
          this.refreshScene();
          return;
        }
        spec[t.dataset.f] = v;
        this.refreshScene();
        if (t.dataset.f === 'conn') this.renderProps();
      } else if (t.dataset.ptf) {
        const i = Number(t.dataset.pt);
        const v = parseFloat(t.value);
        if (!Number.isFinite(v) || !spec.points[i]) return;
        spec.points[i][t.dataset.ptf] = v;
        this.refreshScene();
        this.updatePipeSummary();
        // 점을 직접 옮겨 탱크 벽면 가까이 대면 그 자리에 노즐이 맞춰진다 (v72).
        const fi = this.autoFitTankNozzle(spec, i);
        if (fi) {
          this.rebuild();
          this.renderProps();
          this.toast(fi.text);
        }
      }
    });
    body.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      const spec = this.getSelectedSpec();
      if (!spec) return;
      if (act === 'multitoggle') {
        this.multiMode = !this.multiMode;
        if (!this.multiMode) this.multiSel = [];
        // 고르는 동안에는 ✋ 드래그 이동을 잠시 꺼 둔다 — 켜 두면 3D 탭이 선택이 아니라
        // 드래그 시작으로 잡혀 다른 것을 고를 수 없다(다 고른 뒤 다시 켜면 같이 끌 수 있다).
        const draggedOff = this.multiMode && this.moveDrag;
        if (draggedOff) {
          this.moveDrag = false;
          if (this.renderer) {
            this.renderer.domElement.classList.remove('move-drag');
            const vp = $('#viewport');
            if (vp) vp.classList.remove('move-drag');
          }
        }
        this.renderProps();
        this.refreshHighlight();
        this.toast(this.multiMode
          ? `☑️ 여러 개 선택 켜짐${draggedOff ? ' (드래그 이동은 잠시 꺼 둠)' : ''} — 3D에서 다른 장비·부속·배관을 톡톡 누르면 함께 골라집니다.`
          : '여러 개 선택을 껐습니다 — 하나씩 고릅니다.');
        return;
      }
      if (act === 'linkall') { this.linkAllConnected(); return; }
      if (act === 'join2') { this.joinSelectedPair(); return; }
      if (act === 'selremove') { this.removeFromSelection(btn.dataset.kind, btn.dataset.id); return; }
      if (act === 'selonly') { this.selectOnly(btn.dataset.kind, btn.dataset.id); return; }
      if (act === 'selclear') { this.clearSelection(); return; }
      if (act === 'copyall') { this.copyAllSelected(); return; }
      if (act === 'delall') { this.deleteSelected(); return; }
      if (act === 'del') this.deleteSelected();
      else if (act === 'from') this.fromHere();
      else if (act === 'fromend') this.togglePipeEnd();
      else if (act === 'insert') this.openInsertPicker();
      else if (act === 'noz') this.nozContinue(btn.dataset.dir);
      else if (act === 'nozgo') this.nozContinue(btn.dataset.nid);
      else if (act === 'port') this.portContinue(btn.dataset.port);
      else if (act === 'mv') this.moveSelectedStep(btn.dataset.axis, Number(btn.dataset.sign), (this.moveStep || 500) / 1000);
      else if (act === 'mvstep') {
        // 보폭 — 10·50·100·500·1000mm (v73에서 50mm 추가)
        const mm = Number(btn.dataset.mm);
        if (!mm) return;
        this.moveStep = mm;
        this.renderProps();
        this.toast(`이동 보폭 ${mm}mm`);
      }
      else if (act === 'magnet') { this.setMagnetSnap(!this.magnetSnap); }
      else if (act === 'mvdrag') {
        this.moveDrag = !this.moveDrag;
        this.renderProps();
        if (this.renderer) {
          this.renderer.domElement.classList.toggle('move-drag', !!this.moveDrag);
          const vp = $('#viewport');
          if (vp) vp.classList.toggle('move-drag', !!this.moveDrag);
        }
        this.toast(this.moveDrag
          ? '✋ 드래그 이동 — 3D 바닥을 끌어 선택한 것을 옮기세요. 다시 누르면 꺼집니다.'
          : '드래그 이동을 껐습니다 — 화면은 다시 회전·확대입니다.');
      }
      else if (act === 'nozadd') {
        this.pushUndo('노즐 추가');
        if (TANK_NOZ_TYPES.has(spec.type)) addTankNozzle(spec); else addHxNozzle(spec);
        this.refreshScene();
        this.renderProps();
      } else if (act === 'nozdel') {
        this.pushUndo('노즐 삭제');
        if (TANK_NOZ_TYPES.has(spec.type)) removeTankNozzle(spec, btn.dataset.nid);
        else removeHxNozzle(spec, btn.dataset.nid);
        this.refreshScene();
        this.renderProps();
      } else if (act === 'nozpreset') {
        this.pushUndo('노즐 프리셋');
        if (TANK_NOZ_TYPES.has(spec.type)) applyTankPreset(spec, btn.dataset.preset);
        else applyHxPreset(spec, btn.dataset.preset);
        this.refreshScene();
        this.renderProps();
      }
      else if (act === 'copy') this.copySelected();
      else if (act === 'paste') this.pasteClipboard();
      else if (act === 'dup') this.duplicateSelected();
      else if (act === 'rot3') {
        // 3축 회전 — 어떤 장비·부속이든 좌·우(yaw)·위·아래(pitch)·축(roll)으로 45°씩.
        const k = btn.dataset.k;
        this.pushUndo('3축 회전');
        // 회전 전에 '지금 닿아 있는 접속면'을 기억해 둔다 — 회전 뒤 그 자리에 다시 앉힌다.
        const anchor = this.connectionAnchor(spec);
        if (k === 'reset') {
          delete spec.yaw; delete spec.pitch; delete spec.roll;
        } else if (k === 'roll') {
          const next = ((handleRotOf(spec) + Number(btn.dataset.d)) % 360 + 360) % 360;
          if (next) spec.roll = next; else delete spec.roll;
        } else if (k === 'yaw' || k === 'pitch') {
          const next = norm180(norm180(spec[k]) + Number(btn.dataset.d));
          if (next) spec[k] = next; else delete spec[k];
        }
        const kept = this.reseatFitting(spec, anchor);
        this.refreshScene();
        this.renderProps();
        this.toast(`회전 — 좌우 ${norm180(spec.yaw)}° · 위아래 ${norm180(spec.pitch)}° · 축 ${handleRotOf(spec)}°`
          + (kept ? ' · 연결면 유지' : ''));
      }
      else if (act === 'hrot') {
        // 핸들 방향 — 유로·플랜지·몸체는 그대로 두고 손잡이만 관 축 둘레로 돈다.
        const cur0 = handleRotOf(spec);
        const want = Number(btn.dataset.deg);
        const next = Number.isFinite(want) ? ((want % 360) + 360) % 360 : cur0;
        if (next === cur0) return;
        this.pushUndo('핸들 방향');
        const anchor = this.connectionAnchor(spec);
        if (next) spec.roll = next; else delete spec.roll;
        this.reseatFitting(spec, anchor);
        this.refreshScene();
        this.renderProps();
        this.toast(`핸들 ${next}° — 배관 축은 그대로입니다`);
      }
      else if (act === 'ground') { this.pushUndo('바닥에 붙이기'); spec.y = 0; this.refreshScene(); this.renderProps(); }
      else if (act === 'addpt') {
        this.pushUndo('점 추가');
        const last = spec.points[spec.points.length - 1] || { x: 0, y: 0, z: 0 };
        spec.points.push({ x: last.x + 1, y: last.y, z: last.z });
        this.refreshScene();
        this.renderProps();
      } else if (act === 'rmpt') {
        if (spec.points.length <= 2) { this.toast('배관은 점이 2개 이상 필요합니다.', { type: 'err' }); return; }
        this.pushUndo('점 삭제');
        spec.points.splice(Number(btn.dataset.i), 1);
        this.refreshScene();
        this.renderProps();
      }
    });
    $('#btnPropClose').addEventListener('click', () => this.clearSelection());

    // 장비/배관 개수 HUD — 기본은 맨 위 구석의 작은 `▾` 칩, 누를 때만 펼친다.
    // (3D 캔버스 왼쪽 위를 가린다는 지적 — 2026-11-25 `31557` 캡처)
    const hud = $('#viewHud');
    if (hud) {
      const toggleHud = () => {
        const open = hud.classList.toggle('open');
        hud.setAttribute('aria-expanded', open ? 'true' : 'false');
      };
      hud.addEventListener('click', (ev) => { ev.stopPropagation(); toggleHud(); });
      hud.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggleHud(); }
      });
    }

    // 도면
    $('#btnPlanUpload').addEventListener('click', () => $('#planFile').click());
    $('#planFile').addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      this.readImageFile(f, (src) => this.applyPlanImage(src));
      e.target.value = '';
    });
    $('#planVisible').addEventListener('change', (e) => {
      this.state.floorPlan.visible = e.target.checked;
      this.syncPlanOptions(!!e.target.checked);
      this.applyPlan();
      this.scheduleSave();
    });
    $('#planOpacity').addEventListener('input', (e) => {
      this.state.floorPlan.opacity = parseFloat(e.target.value);
      $('#planOpacityVal').textContent = Math.round(this.state.floorPlan.opacity * 100) + '%';
      this.applyPlan();
      this.scheduleSave();
    });
    $('#planWidth').addEventListener('input', (e) => {
      this.state.floorPlan.width = parseFloat(e.target.value);
      $('#planWidthVal').textContent = fmt(this.state.floorPlan.width) + ' m';
      this.applyPlan();
      this.scheduleSave();
    });
    $('#planRot').addEventListener('input', (e) => {
      this.state.floorPlan.rot = parseFloat(e.target.value);
      $('#planRotVal').textContent = Math.round(this.state.floorPlan.rot) + '°';
      this.applyPlan();
      this.scheduleSave();
    });
    $('#planX').addEventListener('input', (e) => {
      const v = parseFloat(e.target.value);
      if (!Number.isFinite(v)) return;
      this.state.floorPlan.x = v;
      this.applyPlan();
      this.scheduleSave();
    });
    $('#planZ').addEventListener('input', (e) => {
      const v = parseFloat(e.target.value);
      if (!Number.isFinite(v)) return;
      this.state.floorPlan.z = v;
      this.applyPlan();
      this.scheduleSave();
    });
    $('#btnPlanClear').addEventListener('click', () => {
      this.state.floorPlan.src = null;
      this.planSrc = null;
      this.applyPlan();
      this.syncPlanInputs();
      this.scheduleSave();
      this.toast('도면을 지웠습니다.');
    });

    // 파일
    $('#btnSave').addEventListener('click', () => this.saveJson());
    $('#btnLoad').addEventListener('click', () => $('#loadFile').click());
    $('#loadFile').addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) this.loadJson(f);
      e.target.value = '';
    });
    $('#btnFusion').addEventListener('click', () => this.exportFusion());
    $('#btnObj').addEventListener('click', () => this.exportObj());
    $('#btnSample').addEventListener('click', () => {
      this.pushUndo('샘플 씬');
      this.state = sampleScene();
      this.selection = null;
      this.planSrc = null;
      this.rebuild();
      this.syncPlanInputs();
      this.toast('샘플 현장을 불러왔습니다.');
    });
    $('#btnClear').addEventListener('click', () => this.clearAll());
    $('#btnHelp').addEventListener('click', () => this.openHelp());
    // [파일] 탭에서도 설정을 바로 열 수 있게 (모바일에서 상단 ⚙를 못 찾는 경우 대비)
    $('#btnSettings2').addEventListener('click', () => this.openSettings());
    // 내보내기 = 🖨️ 도면 인쇄 · 컷 담기 (v81). JSON·Fusion·OBJ는 ☰ → 파일 탭에 그대로 있다.
    $('#btnExport').addEventListener('click', () => this.openPrintPanel());

    // AI
    $('#btnAi').addEventListener('click', () => this.startAI());
    $('#btnAi2').addEventListener('click', () => this.startAI());

    // 한 줄 배관 명령 (mm)
    const cmdForm = $('#cmdForm');
    cmdForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = $('#cmdInput');
      this.runCommandLine(input.value);
      input.value = '';
      // 명령을 연달아 칠 수 있게 입력칸 초점(모바일 키보드)을 그대로 둔다.
      // 예전에는 모바일에서 초점을 빼서, 명령 한 번마다 채팅창을 다시 눌러야 했다.
      this.focusCmdInput();
      // 키보드가 떠 있는 채로 연속 입력할 때도 커서가 화면 한가운데 오게 따라간다.
      if (this.isKeyboardOpen && this.isKeyboardOpen()) this.centerCursor(240);
    });
    // [실행]을 손가락으로 눌러도 입력칸이 초점을 잃지 않게 한다 —
    // mousedown 기본 동작(초점 이동)만 막고 click은 그대로 두어 submit이 정상으로 일어난다.
    // (pointerdown = 마우스·터치 공통) 기본 동작(초점 이동)만 막고 click은 그대로 둔다 —
    // mousedown·touchstart를 막으면 모바일에서 click(=submit) 자체가 사라진다.
    $('#cmdRun').addEventListener('pointerdown', (e) => {
      if (document.activeElement === $('#cmdInput')) e.preventDefault();
    });
    $('#cmdHelp').addEventListener('click', () => this.openCmdHelp());
    // 화면에서 한 번에 누르는 실행취소 — 직전 명령·패드 입력과 커서까지 되돌린다.
    $('#cmdUndo').addEventListener('click', () => this.undo());
    // 🎤 말로 명령
    $('#cmdMic').addEventListener('click', () => this.toggleVoice());
    // 🔗 잇기 — 커서에서 탭한 접속구까지 바로 연결
    $('#cmdLink').addEventListener('click', () => this.setLinkMode(!this.linkMode));
    // 🗑️ 새 도면 (전체 삭제 — 실행취소 한 번이면 되돌아온다)
    $('#cmdClear').addEventListener('click', () => this.clearAll());

    // 설정 · 모달
    $('#btnSettings').addEventListener('click', () => this.openSettings());
    $('#modalClose').addEventListener('click', () => this.closeModal());
    $('#modalRoot').addEventListener('click', (e) => {
      if (!e.target || !e.target.dataset || !e.target.dataset.close) return;
      // AI 분석 중에는 바깥(배경)을 터치해도 창이 닫히지 않게 막는다.
      if (this.aiRunning) return;
      this.closeModal();
    });

    // 모바일 도구함
    $('#btnDrawer').addEventListener('click', () => this.setDrawerOpen(!$('#drawer').classList.contains('open')));

    this.syncPlanInputs();
  }

  // ── 휴대폰 뒤로가기: 페이지는 그대로, 열린 창만 닫기 ─────
  anyOverlayOpen() {
    const modal = $('#modalRoot');
    const props = $('#props');
    const drawer = $('#drawer');
    const bar = $('#viewbar');
    // 조이스틱은 상시 도구라 뒤로가기로 닫지 않는다.
    const pp = $('#printPanel');
    return !!((modal && !modal.hidden) || (props && !props.hidden)
      || (pp && !pp.hidden)
      || (bar && bar.classList.contains('open'))
      || (drawer && drawer.classList.contains('open')));
  }

  // 창이 열려 있는 동안 히스토리 항목 하나만 깔아 둔다 (중복 push 없음).
  // 돌려놓은 항목의 popstate가 아직 오지 않았으면(suppressPop>0) 새로 깔지 않는다 —
  // back()과 pushState가 엇갈리면 우리 항목 대신 앞 페이지가 밀려 나갈 수 있다.
  syncOverlayEntry() {
    if (!this.anyOverlayOpen() || this.overlayEntry || this.suppressPop > 0) return;
    try {
      history.pushState({ smileOverlay: 1 }, '');
      this.overlayEntry = true;
    } catch (e) { /* pushState를 못 쓰는 환경이면 그냥 동작 */ }
  }

  // 모든 창을 닫았으면 빌려온 히스토리 항목을 거둔다.
  releaseOverlayEntry() {
    if (!this.overlayEntry || this.anyOverlayOpen()) return;
    this.overlayEntry = false;
    // 이미 back()을 건네고 그 popstate를 기다리는 중이면 또 back()하지 않는다.
    if (this.suppressPop > 0) return;
    this.suppressPop += 1;
    try { history.back(); } catch (e) { this.suppressPop -= 1; }
  }

  onPopState() {
    // 우리가 방금 건 history.back()이 만든 이벤트는 무시
    if (this.suppressPop > 0) { this.suppressPop -= 1; return; }
    this.overlayEntry = false; // 뒤로가기가 우리 항목을 소비했다
    // 지금 열려 있는 창을 하나씩 닫는다 — 모달 → 속성 창 → 펼친 보기 바 → 도구 서랍.
    // 방향 조이스틱은 화면에 늘 떠 있는 도구라 창으로 치지 않는다( 여기서 먼저 닫으면
    // 서랍이 열려 있어도 뒤로가기가 조이스틱만 꺼 버려 창이 안 닫히던 원인).
    if (!$('#modalRoot').hidden) this.closeModal();
    else if (!$('#props').hidden) this.clearSelection();
    else if (this.ppOpen) this.closePrintPanel();
    else if (this.viewbarOpen) this.setViewbar(false);
    else if ($('#drawer').classList.contains('open')) this.setDrawerOpen(false);
    // 다른 창이 아직 열려 있으면 항목을 다시 깔아, 다음 뒤로가기도 페이지를 지키게 한다.
    this.syncOverlayEntry();
    // AI 분석 중이면 창만 접히고 분석은 계속된다.
    if (this.aiRunning) this.showAiProgress();
  }

  setDrawerOpen(on) {
    const el = $('#drawer');
    if (!el) return;
    el.classList.toggle('open', !!on);
    // 화면이 확대된 상태에서도 서랍이 화면 밖으로 잘리지 않게 보이는 영역에 맞춘다.
    this.fitPanelsToView();
    if (on) this.syncOverlayEntry();
    else this.releaseOverlayEntry();
  }

  // ── 모달 ────────────────────────────────────────────────
  openModal({ title, body, actions }) {
    $('#modalTitle').textContent = title || '';
    $('#modalBody').innerHTML = body || '';
    const host = $('#modalActions');
    host.innerHTML = '';
    (actions || []).forEach((a) => {
      const b = document.createElement('button');
      b.className = 'btn ' + (a.cls || 'ghost');
      b.textContent = a.label;
      b.addEventListener('click', () => {
        if (a.onClick) a.onClick();
        if (!a.keep) this.closeModal();
      });
      host.appendChild(b);
    });
    $('#modalRoot').hidden = false;
    this.syncOverlayEntry();
  }

  closeModal() {
    $('#modalRoot').hidden = true;
    $('#modalBody').innerHTML = '';
    this.releaseOverlayEntry();
  }

  openSettings(notice) {
    const key = this.apiKey();
    const model = this.model();
    this.openModal({
      title: '설정 · Gemini API 키',
      body: `
        ${notice ? `<p class="err-text">${esc(notice)}</p>` : ''}
        <label class="field">Gemini API 키
          <input type="password" id="keyInput" value="${esc(key)}" placeholder="AIza..." autocomplete="off">
        </label>
        <label class="field">모델
          <select id="modelInput">
            ${(() => {
              const list = MODEL_OPTIONS.slice();
              if (model && !list.some((o) => o.id === model)) list.unshift({ id: model, label: `${model} (저장된 모델)` });
              return list.map((o) => `<option value="${esc(o.id)}"${o.id === model ? ' selected' : ''}>${esc(o.label)}</option>`).join('');
            })()}
          </select>
        </label>
        <p class="hint">모델을 못 쓰면 최신 flash 모델로 자동 전환해 시도합니다(구형 모델은 신규 키에서 거절됨).</p>
        <p class="hint">키는 이 브라우저(localStorage)에만 저장되며 서버로 보내지 않습니다.
        <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Google AI Studio에서 무료 발급</a></p>
        <p class="hint">키가 없어도 장비·배관 수동 편집, 도면 바닥 깔기, 샘플 씬, Fusion 360·OBJ 내보내기는 모두 동작합니다.</p>`,
      actions: [
        {
          label: '저장', cls: 'accent', keep: true,
          onClick: () => {
            const v = ($('#keyInput').value || '').trim();
            const m = $('#modelInput').value;
            if (v) localStorage.setItem(KEY_API, v); else localStorage.removeItem(KEY_API);
            localStorage.setItem(KEY_MODEL, m);
            localStorage.setItem(KEY_MODEL_MIGRATED, '1');
            this.toast(v ? 'API 키를 저장했습니다.' : 'API 키를 지웠습니다.');
            this.closeModal();
          },
        },
        { label: '닫기' },
      ],
    });
  }

  openHelp() {
    this.openModal({
      title: '사용 방법',
      body: `
        <ol>
          <li><b>현장 사진·도면 올리기</b> — [AI] 탭에서 이미지를 올리면 3D 바닥에 반투명으로 깔립니다. 크기·회전·투명도를 맞춰 스케일을 잡으세요.</li>
          <li><b>장비 배치</b> — [장비] 탭에서 열교환기·펌프·탱크·제어반·게이트밸브를 추가하고, 속성 패널에서 위치·크기·회전을 숫자로 다듬습니다.</li>
          <li><b>배관 긋기</b> — [배관] 탭에서 구경·재질을 고르고 <b>3D에서 배관 그리기</b> → 바닥을 터치해 점을 찍습니다. 높이는 HUD의 숫자로 바꿀 수 있어 수직 상승·엘보가 그대로 표현됩니다.</li>
          <li><b>보기</b> — 한 손가락(마우스 왼쪽) 회전, 두 손가락(휠) 확대, 두 손가락 이동. 상단·하단의 등각/위에서/정면/리셋 버튼.</li>
          <li><b>한 줄 명령</b> — 화면 아래 입력창에 <code>50a 오른쪽으로 1000 위로 1500</code>처럼 쓰고 <b>실행</b>을 누르면 mm 단위로 배관이 이어집니다. 부속·장비 이름(<code>플렌지</code>, <code>버터</code>, <code>엘보</code> 등)을 함께 쓰면 그 자리에 배치됩니다.</li>
          <li><b>✏️ 손 그리기</b> — 보기 바의 <b>✏️ 손 그리기</b>를 켜고 화면을 끌면, 끄는 방향에 가장 가까운 3D 축(+X/−X/+Y/−Y/+Z/−Z)으로 배관이 그려집니다. 길이는 100mm 단위로 반올림되고 미리보기에 표시됩니다. 방향이 꺾이면 엘보가 자동으로 들어가고, 손을 떼면 그 자리에서 다음 구간을 이어 그립니다(두 점을 톡톡 눌러도 됨). 두 손가락은 그대로 확대·이동입니다.</li>
          <li><b>치수 고치기</b> — 화면의 치수 라벨(<code>1000mm (50A)</code>)을 누르면 그 구간 길이를 mm 숫자로 정확히 고칠 수 있습니다. 뒤로 이어진 배관·장비도 함께 움직입니다.</li>
          <li><b>↔️ 위치 이동</b> — 장비·부속·배관을 고르면 속성 패널에 방향 버툰(←/→/앞/뒤/↑/↓)과 보폭 <code>10 · 50 · 100 · 500 · 1000mm</code>가 있습니다. <b>배관도 모든 점이 통째로</b> 옮겨지고, <b>✋ 드래그 이동</b>을 켜면 3D 바닥을 끌어 옮깁니다(실행취소 한 번이면 되돌림).</li>
          <li><b>✂️ 중간에 끼워넣기</b> — 배관을 고르면 속성 패널에 <b>✂️ 중간에 끼워넣기</b>가 있습니다. 티·밸브·플랜지·레듀샤·벨로우즈 신축관을 고르면 그 배관이 가운데(또는 지정한 mm 지점)에서 둘로 나뉘고, 부속이 같은 관경·같은 축으로 양쪽 0mm 밀착해 앉습니다. 끼워넣은 부속을 <b>↔️ 위치 이동</b>이나 <b>✋ 드래그 이동</b>으로 배관 축 방향으로 옮기면 한쪽 배관은 길어지고 반대쪽은 짧아져 틈이 생기지 않습니다(양쪽 최소 50mm).</li>
          <li><b>☑️ 여러 개 선택</b> — 속성 패널 맨 위의 <b>☑️ 여러 개 선택</b>을 켜면 3D에서 다른 장비·부속·배관을 톡톡 누를 때마다 선택에 더하고 뻐며, <b>🔗 연결된 것 모두</b>로 이어진 밸브·배관 한 줄을 한 번에 잡습니다. 그러면 <b>↔️ 같이 이동</b> — 방향 버툰·보폭·드래그 어느 쪽이든 고른 것 전부가 같은 거리만큼 함께 움직입니다.</li>
          <li><b>내보내기</b> — [파일] 탭에서 JSON 저장·불러오기, <b>Fusion 360 .py</b>, <b>.obj</b>.</li>
          <li><b>🖨️ 도면 인쇄 · 컷 담기</b> — 상단 <b>내보내기</b> 또는 ☰ → 파일 → <b>🖨️ 도면 인쇄 · 컷 담기</b>. 3D를 원하는 구역으로 옮겨 <b>📷 현재 화면 컷 담기</b>를 누를 때마다 컷이 쌓입니다(컷마다 제목·메모, PNG 저장, 삭제). 기본은 <b>흰 배경</b>이라 인쇄에 잉크가 덜 들고, 버튼·조이스틱·명령창은 그림에 들어가지 않습니다. <b>🖨️ A4 도면 인쇄 / PDF 저장</b>을 누르면 컷마다 <b>A4 가로</b> 한 장을 가득 채워 크게 인쇄되고(또는 한 장에 2컷), <b>자재 수량표</b>는 체크했을 때만 마지막 장에 붙습니다. 인쇄 창에서 “PDF로 저장”을 고르면 PDF가 됩니다.</li>
        </ol>
        <p class="hint">작업은 이 브라우저에 자동 저장됩니다. 되돌리기는 오른쪽 위 알림의 “되돌리기” 또는 <code>Ctrl+Z</code>.</p>`,
      actions: [{ label: '확인', cls: 'accent' }],
    });
  }

  // ── 토스트 ──────────────────────────────────────────────
  // 알림은 **최대 1개**만 띄운다(v76). 위치 이동·방향 버튼처럼 연달아 누르는 조작에서
  // 알림이 세로로 5개씩 쌓여 3D 화면을 덮던 문제(`32251` 캡처)를 없앴다 —
  // 새 알림이 오면 같은 한 줄의 글자만 바꾸고 시간을 다시 센다.
  toast(message, opts) {
    const o = opts || {};
    const host = $('#toastHost');
    if (!host) return;
    let el = host.querySelector('.toast');
    if (!el) {
      el = document.createElement('div');
      host.appendChild(el);
    }
    el.className = 'toast' + (o.type === 'err' ? ' err' : '');
    el.textContent = '';
    el.title = message;
    el.style.transition = '';
    el.style.opacity = '1';
    const span = document.createElement('span');
    span.textContent = message;
    el.appendChild(span);
    if (o.action) {
      const b = document.createElement('button');
      b.className = 'act';
      b.textContent = o.action;
      b.addEventListener('click', () => {
        this.dismissToast();
        if (o.onAction) o.onAction();
      });
      el.appendChild(b);
    }
    // 한 요소를 계속 쓰므로 예전 타이머가 새 알림을 지우지 않게 모두 정리한다.
    if (this.toastTimer) clearTimeout(this.toastTimer);
    if (this.toastFadeTimer) clearTimeout(this.toastFadeTimer);
    this.toastTimer = setTimeout(() => {
      el.style.transition = 'opacity .3s';
      el.style.opacity = '0';
      this.toastFadeTimer = setTimeout(() => this.dismissToast(), 320);
    }, o.action ? 6000 : 3200);
  }

  dismissToast() {
    const host = $('#toastHost');
    if (!host) return;
    const el = host.querySelector('.toast');
    if (el) el.remove();
  }
}

const app = new App();
app.init();
window.__app = app;
