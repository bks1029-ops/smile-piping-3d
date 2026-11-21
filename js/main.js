// 스마일산업 3D 배관 — 메인 앱
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  BORES, MATERIALS, EQUIP_TYPES, EQUIP_CATEGORIES, typesByCategory, makeEquipment, makePipe,
  sampleScene, normalizeState, pipeLength, fittingNaturalWidth, elbowDims, dirBasis,
  CONN_MODES, CONN_TYPES, connOf,
} from './store.js?v=34';
import { buildScene } from './builders.js?v=34';
import { buildFusionScript, downloadText, timestampName } from './fusion.js?v=34';
import { buildOBJ } from './obj.js?v=34';
import { analyzeImage, planCommand, DEFAULT_MODEL, MODEL_OPTIONS, LEGACY_MODELS } from './ai.js?v=34';
import { parseCommand, CMD_HELP } from './cmd.js?v=34';
import { buildDimItems } from './dims.js?v=34';

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
const r3 = (n) => Math.round(Number(n) * 1000) / 1000;
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const VIEW_NAMES = ['iso', 'top', 'front', 'reset'];

// 배관을 끊고 그 자리에 앉는 부속(인라인) — 실제 길이(spec.w)만큼 커서가 전진한다.
const INLINE_TYPES = new Set([
  'valve', 'bfly', 'yvalve', 'ball', 'check', 'bellows', 'tee', 'reducer', 'flange',
  'nipple', 'elbow45', 'cap', 'union', 'flow',
]);
const ON_FLOOR_TYPES = new Set(['hx', 'pump', 'vpump', 'tank', 'stank', 'rtank', 'panel', 'support']);

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
    this.aiRunning = false;
    this.wakeLock = null;
    // 한 줄 명령 상태 — 커서(마지막 끝점)와 직전 관경·재질을 이어 쓴다.
    this.cmdCursor = { x: 0, y: 0.5, z: 0 };
    this.cmdBore = '50A';
    this.cmdMaterial = 'carbon';
    // 연결 방식 — 플랜지(기본) / 단조형(소켓웰드·나사식). 이후 배관·부속에 적용된다.
    this.cmdConn = 'flange';
    this.cmdRot = 0;
    this.cmdAxis = 'x';
    this.cmdSign = 1;
    this.cmdMarked = false;
    this.padOpen = false;
    // 방향 기준: 'me' = 지금 보는 화면 기준(기본), 'plan' = 도면 축 기준
    this.dirFrame = 'me';
    this.lastDirV = null;   // 직전에 그린 구간의 진행 방향(단위 벡터) — 명령을 건너 이어서 꺾임을 본다
    this.pending = null;    // 콤팩트 조이스틱에서 고른 방향(길이만 치면 그 방향으로 그린다)
    this.diag45 = false;    // 조이스틱 45° 경사 모드
    this.padLen = 1000;     // 조이스틱에서 마지막으로 쓴 길이(mm)
    this.listening = false;
    this.recognition = null;
    // 휴대폰 뒤로가기로 페이지가 나가지 않고 열린 창만 닫히게 하는 상태
    this.overlayEntry = false;
    this.suppressPop = 0;
    this.inPopState = false;
  }

  // ── 초기화 ───────────────────────────────────────────────
  init() {
    this.setupRenderer();
    this.setupScene();
    this.setupFloorPlan();
    this.setupDraft();
    this.setupCmdCursor();
    this.setupDims();
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
      if (this.aiRunning && document.visibilityState === 'visible') this.acquireWakeLock();
    });
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
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.raycaster = new THREE.Raycaster();
  }

  setupScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0d1014);
    this.scene.fog = new THREE.Fog(0x0d1014, 30, 62);

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
    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(150, 150),
      new THREE.MeshStandardMaterial({ map: this.makeGridTexture(), roughness: 0.95, metalness: 0.02 }),
    );
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

  makeGridTexture() {
    const S = 512;
    const c = document.createElement('canvas');
    c.width = S; c.height = S;
    const g = c.getContext('2d');
    g.fillStyle = '#151b21';
    g.fillRect(0, 0, S, S);
    const step = S / 5;
    g.strokeStyle = '#232d37';
    g.lineWidth = 2;
    for (let i = 1; i < 5; i += 1) {
      const p = Math.round(i * step) + 0.5;
      g.beginPath(); g.moveTo(p, 0); g.lineTo(p, S); g.stroke();
      g.beginPath(); g.moveTo(0, p); g.lineTo(S, p); g.stroke();
    }
    g.strokeStyle = '#36434f';
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

  // ── 씬 갱신 ──────────────────────────────────────────────
  rebuild() {
    this.refreshScene();
    this.renderProps();
  }

  // ── 배관 치수 라벨 ───────────────────────────────────────
  // 각 배관 구간 중점 옆에 "1000mm (50A)"를 3D 좌표 → 화면 투영으로 얹는다.
  setupDims() {
    this.dimLayer = $('#dimLayer');
    this.dimNodes = [];
    this.dimItems = [];
    this.dimV = new THREE.Vector3();
    let saved = null;
    try { saved = localStorage.getItem('smilePiping3D.dims'); } catch (e) { /* ignore */ }
    this.dimsOn = saved !== 'off'; // 기본값 켜짐
    this.applyDimToggle();
  }

  setDims(on) {
    this.dimsOn = !!on;
    try { localStorage.setItem('smilePiping3D.dims', this.dimsOn ? 'on' : 'off'); } catch (e) { /* ignore */ }
    this.applyDimToggle();
    this.refreshDims();
  }

  applyDimToggle() {
    const btn = $('#btnDims');
    if (btn) {
      btn.classList.toggle('active', this.dimsOn);
      btn.setAttribute('aria-pressed', this.dimsOn ? 'true' : 'false');
    }
    if (this.dimLayer) this.dimLayer.hidden = !this.dimsOn;
  }

  refreshDims() {
    this.dimItems = buildDimItems(this.state);
    this.dimOrder = null; // 라벨 배치 순서(긴 구간 우선)를 다시 계산한다.
    if (!this.dimsOn) {
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
    this.dimItems.forEach((it, i) => { this.dimNodes[i].textContent = it.text; });
    this.updateDims();
  }

  clearDimNodes() {
    this.dimNodes.forEach((n) => n.remove());
    this.dimNodes = [];
  }

  updateDims() {
    if (!this.dimsOn || !this.dimNodes.length || !this.dimLayer) return;
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
    if (this.helper) {
      this.scene.remove(this.helper);
      this.helper.geometry.dispose();
      this.helper.material.dispose();
      this.helper = null;
    }
    if (!this.selection) return;
    const obj = this.findObject(this.selection);
    if (!obj) { this.selection = null; return; }
    this.helper = new THREE.BoxHelper(obj, 0xf5a623);
    this.helper.material.depthTest = false;
    this.helper.material.transparent = true;
    this.helper.material.opacity = 0.95;
    this.helper.renderOrder = 999;
    this.scene.add(this.helper);
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

  select(kind, id) {
    this.selection = { kind, id };
    this.refreshHighlight();
    this.renderProps();
    this.renderLists();
    // 선택한 부속·배관의 출구로 주황색 커서를 옆기고 그 방향으로 다음 명령을 이어 쓴다.
    const spec = this.getSelectedSpec();
    if (spec) this.aimAt(spec);
    if (window.innerWidth <= 860) this.setDrawerOpen(false);
  }

  clearSelection() {
    this.selection = null;
    this.refreshHighlight();
    this.renderProps();
    this.renderLists();
  }

  // rot(도) → 그리기 방향. cmdRotFor()와 같은 규칙을 쓴다.
  headingFromRot(rot) {
    const r = ((Math.round(Number(rot) || 0) % 360) + 360) % 360;
    if (r === 90) return { axis: 'z', sign: 1 };
    if (r === 180) return { axis: 'x', sign: -1 };
    if (r === 270) return { axis: 'z', sign: -1 };
    return { axis: 'x', sign: 1 };
  }

  // 부속의 출구(길이 방향 끝면) — 인라인 부속은 배관이 이어지는 자리, 설비는 윗면 중심.
  equipExit(spec) {
    const len = INLINE_TYPES.has(spec.type) ? (spec.w || 0) : 0;
    if (!len) return { x: spec.x, y: r3((spec.y || 0) + (spec.h || 0)), z: spec.z };
    const d = Array.isArray(spec.dir) ? spec.dir : null;
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
  aimAt(spec) {
    if (!spec) return;
    if (Array.isArray(spec.points) && spec.points.length) {
      const pts = spec.points;
      const p = pts[pts.length - 1];
      const q = pts.length > 1 ? pts[pts.length - 2] : { x: p.x + 1, y: p.y, z: p.z };
      const dx = p.x - q.x, dy = p.y - q.y, dz = p.z - q.z;
      const ax = Math.abs(dx) >= Math.abs(dy) && Math.abs(dx) >= Math.abs(dz) ? 'x'
        : (Math.abs(dz) >= Math.abs(dy) ? 'z' : 'y');
      const delta = ax === 'x' ? dx : ax === 'z' ? dz : dy;
      this.cmdAxis = ax;
      this.cmdSign = delta < 0 ? -1 : 1;
      this.cmdRot = this.cmdRotFor(this.cmdAxis, this.cmdSign);
      const dlen = Math.hypot(dx, dy, dz) || 1;
      this.lastDirV = { x: dx / dlen, y: dy / dlen, z: dz / dlen };
      if (BORES[spec.bore]) this.cmdBore = spec.bore;
      if (MATERIALS[spec.material]) this.cmdMaterial = spec.material;
      this.setCmdCursor({ x: p.x, y: p.y, z: p.z }, true);
      return;
    }
    const h = this.headingFromRot(spec.rot);
    const dv = Array.isArray(spec.dir) ? spec.dir : null;
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
    if (spec.type === 'reducer' && spec.bore2) this.cmdBore = spec.bore2;
    else if (spec.bore1) this.cmdBore = spec.bore1;
    this.setCmdCursor(this.equipExit(spec), true);
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
    const consider = (p, label) => {
      const dx = p.x - cursor.x, dy = p.y - cursor.y, dz = p.z - cursor.z;
      const d = Math.hypot(dx, dy, dz);
      if (d < 0.02) return;
      if (!dirOk(dx, dy, dz)) return;
      if (!best || d < best.d) best = { d, p: { x: p.x, y: p.y, z: p.z }, label };
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
        consider(this.equipExit(e), e.name);
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

  fromHere() {
    const spec = this.getSelectedSpec();
    if (!spec) return;
    this.aimAt(spec);
    this.clearSelection();
    const c = this.cmdCursor;
    this.toast(`📍 여기서 이어 그립니다 · ${this.cmdBore} · 커서 (${fmt(c.x)}, ${fmt(c.y)}, ${fmt(c.z)})m`);
  }

  // 손가락 터치가 작은 부속을 빗나가도 화면 기준 32px 안의 가장 가까운 것을 고른다.
  nearestPick(ev, radiusPx) {
    if (!this.root) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const px = ev.clientX - rect.left;
    const py = ev.clientY - rect.top;
    const v = new THREE.Vector3();
    let best = null;
    let bestD = radiusPx;
    const test = (pick, x, y, z) => {
      v.set(x, y, z).project(this.camera);
      if (v.z > 1 || v.z < -1) return;
      const sx = (v.x * 0.5 + 0.5) * rect.width;
      const sy = (-v.y * 0.5 + 0.5) * rect.height;
      const d = Math.hypot(sx - px, sy - py);
      if (d < bestD) { bestD = d; best = pick; }
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
    return best;
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
    if (!spec) { panel.hidden = true; this.releaseOverlayEntry(); return; }
    panel.hidden = false;
    this.syncOverlayEntry();
    const body = $('#propBody');

    if (spec.kind === 'equipment' || this.state.equipment.includes(spec)) {
      $('#propBadge').textContent = EQUIP_TYPES[spec.type].label;
      body.innerHTML = `
        <label class="field">이름<input type="text" data-f="name" value="${esc(spec.name)}"></label>
        ${this.boreFields(spec)}
        ${this.connField(spec)}
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
          <label class="field">가로<input type="number" step="0.1" min="0.1" data-f="w" value="${fmt(spec.w)}"></label>
          <label class="field">높이<input type="number" step="0.1" min="0.1" data-f="h" value="${fmt(spec.h)}"></label>
          <label class="field">폭<input type="number" step="0.1" min="0.1" data-f="d" value="${fmt(spec.d)}"></label>
        </div>
        <div class="prop-section">회전 · 색상</div>
        <div class="field-row">
          <label class="field">회전(°)<input type="number" step="15" data-f="rot" value="${fmt(spec.rot)}"></label>
          <label class="field">색상<input type="color" data-f="color" value="${esc(spec.color)}"></label>
        </div>
        ${Array.isArray(spec.dir) ? `
        <p class="hint">배관 축 정렬 — 진행 방향 (${spec.dir.join(', ')})에 맞춰 원판·바디가 배관에 수직으로 서 있습니다. 회전값을 바꾸면 도면 축 기준(수평)으로 다시 놓입니다.</p>` : ''}
        <div class="prop-actions">
          <button class="btn small accent" data-act="from">📍 여기서 이어 그리기</button>
        </div>
        <div class="prop-actions">
          <button class="btn small ghost" data-act="ground">바닥에</button>
          <button class="btn small ghost" data-act="dup">복제</button>
          <button class="btn small danger" data-act="del">삭제</button>
        </div>`;
    } else {
      $('#propBadge').textContent = '배관 ' + spec.bore;
      const rows = spec.points.map((p, i) => `
        <div class="pt-row">
          <span class="idx">${i + 1}</span>
          <input type="number" step="0.1" data-pt="${i}" data-ptf="x" value="${fmt(p.x)}">
          <input type="number" step="0.1" data-pt="${i}" data-ptf="y" value="${fmt(p.y)}">
          <input type="number" step="0.1" data-pt="${i}" data-ptf="z" value="${fmt(p.z)}">
          <button class="del" data-act="rmpt" data-i="${i}" title="점 삭제">✕</button>
        </div>`).join('');
      body.innerHTML = `
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
        <div class="prop-section">포인트 (X / 높이 Y / Z)</div>
        <div class="pt-head"><span>#</span><span>X</span><span>Y</span><span>Z</span><span></span></div>
        <div class="pt-list">${rows}</div>
        <div class="prop-actions">
          <button class="btn small accent" data-act="from">📍 여기서 이어 그리기</button>
        </div>
        <div class="prop-actions">
          <button class="btn small ghost" data-act="addpt">점 추가</button>
          <button class="btn small danger" data-act="del">배관 삭제</button>
        </div>`;
    }
  }

  // 레듀샤·티는 1차/2차 관경을 속성 패널에서 바꿀 수 있다 (바꾸면 길이도 실제 관경에 맞춰 다시 잡는다).
  boreFields(spec) {
    const isElbow = spec.type === 'elbow' || spec.type === 'elbow45';
    if (spec.type !== 'reducer' && spec.type !== 'tee' && !isElbow) return '';
    const opts = (cur) => Object.keys(BORES).map((b) =>
      `<option value="${b}"${b === cur ? ' selected' : ''}>${b} (${BORES[b].mm}mm)</option>`).join('');
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
        <div class="prop-section">${tee ? '주배관 · 분기 관경' : '1차 · 2차 관경'}</div>
        <div class="field-row">
          <label class="field">${tee ? '주배관' : '1차'}<select data-f="bore1">${opts(spec.bore1 || '100A')}</select></label>
          <label class="field">${tee ? '분기' : '2차'}<select data-f="bore2">${opts(spec.bore2 || '50A')}</select></label>
        </div>`;
  }

  // 연결 방식 선택 — 플랜지(기본) ↔ 단조(소켓웰드·나사식).
  // 몸통이 플랜지로 그려지는 부속과 배관에서만 보여 준다 (플랜지 부속 자체는 항상 플랜지).
  connField(spec) {
    if (!spec) return '';
    const isPipe = spec.kind === 'pipe' || Array.isArray(spec.points);
    if (!isPipe && (!CONN_TYPES.has(spec.type) || spec.type === 'flange')) return '';
    const cur = connOf(spec);
    const opts = Object.keys(CONN_MODES).map((m) =>
      `<option value="${m}"${m === cur ? ' selected' : ''}>${CONN_MODES[m].label}</option>`).join('');
    return `
        <div class="prop-section">연결 방식 (${isPipe ? '배관 끝단' : '접합'})</div>
        <div class="field-row">
          <label class="field">연결<select data-f="conn">${opts}</select></label>
          <label class="field">도면 표시<span class="readonly">${cur === 'forged' ? '단조 · 플랜지 없음' : '플랜지 원판'}</span></label>
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
    this.state = normalizeState(JSON.parse(u.snap));
    this.selection = null;
    if (u.cur) {
      this.cmdBore = u.cur.bore;
      this.cmdMaterial = u.cur.material;
      this.cmdConn = u.cur.conn === 'forged' ? 'forged' : 'flange';
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

  addEquipment(type) {
    const t = EQUIP_TYPES[type];
    if (!t) return;
    const target = this.controls.target;
    const spec = makeEquipment(type, {
      x: Math.round(target.x * 2) / 2,
      y: 0,
      z: Math.round(target.z * 2) / 2,
      conn: this.cmdConn,
    });
    this.pushUndo(t.label + ' 추가');
    this.state.equipment.push(spec);
    this.lastAdded = { kind: 'equipment', id: spec.id };
    this.selection = { kind: 'equipment', id: spec.id };
    this.rebuild();
    this.toast(`${t.label}을(를) 추가했습니다. 속성 패널에서 위치·크기를 조정하세요.`);
  }

  deleteSelected() {
    const spec = this.getSelectedSpec();
    if (!spec) return;
    this.pushUndo('삭제: ' + spec.name);
    if (this.selection.kind === 'pipe') {
      this.state.pipes = this.state.pipes.filter((p) => p.id !== spec.id);
    } else {
      this.state.equipment = this.state.equipment.filter((e) => e.id !== spec.id);
    }
    this.selection = null;
    this.rebuild();
    this.toast(`삭제했습니다 · ${spec.name}`, { action: '되돌리기', onAction: () => this.undo() });
  }

  duplicateSelected() {
    const spec = this.getSelectedSpec();
    if (!spec || this.selection.kind !== 'equipment') return;
    this.pushUndo('복제: ' + spec.name);
    const copy = makeEquipment(spec.type, {
      ...spec, x: spec.x + 0.8, name: spec.name + ' (복제)',
    });
    this.state.equipment.push(copy);
    this.selection = { kind: 'equipment', id: copy.id };
    this.rebuild();
    this.toast('장비를 복제했습니다.');
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
    this.pushUndo(o.label || '새 도면');
    this.state.equipment = [];
    this.state.pipes = [];
    this.state.name = '내 배관 도면';
    this.selection = null;
    this.lastDirV = null;
    this.cmdBore = '50A';
    this.cmdMaterial = 'carbon';
    this.cmdConn = 'flange';
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
  setupCmdCursor() {
    this.cmdMarker = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 14, 10),
      new THREE.MeshBasicMaterial({ color: 0xf5a623, transparent: true, opacity: 0.95, depthTest: false }),
    );
    this.cmdMarker.renderOrder = 998;
    this.cmdMarker.visible = false;
    this.scene.add(this.cmdMarker);
    this.updateCmdMarker();
  }

  updateCmdMarker() {
    if (!this.cmdMarker) return;
    const c = this.cmdCursor;
    this.cmdMarker.position.set(c.x, c.y, c.z);
    this.cmdMarker.visible = !!this.cmdMarked;
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

  runCommandLine(raw) {
    const text = String(raw || '').trim();
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
        OUT.push({ op: 'conn', conn: o.conn === 'forged' ? 'forged' : 'flange' });
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
    let conn = this.cmdConn === 'forged' ? 'forged' : 'flange';
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

    // 이미 놓인 배관 끝을 커서(꼭짓점)에서 접합면만큼 뒤로 당긴다 — 배관이 엘보를 뚫지 않게.
    const trimPrevEnd = (face) => {
      if (face <= 0) return;
      if (pts && pts.length >= 2) {
        const n = pts.length;
        const a = pts[n - 2];
        const b = pts[n - 1];
        const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
        const f = Math.min(face, len * 0.45);
        if (f > 1e-4) {
          pts[n - 1] = put({
            x: b.x - ((b.x - a.x) / len) * f,
            y: b.y - ((b.y - a.y) / len) * f,
            z: b.z - ((b.z - a.z) / len) * f,
          });
        }
        return;
      }
      const local = pipes.length ? pipes[pipes.length - 1] : null;
      const target = local || this.state.pipes[this.state.pipes.length - 1];
      if (!target || !target.points || target.points.length < 2) return;
      const n = target.points.length;
      const a = target.points[n - 2];
      const b = target.points[n - 1];
      if (Math.hypot(b.x - cursor.x, b.y - cursor.y, b.z - cursor.z) > 0.03) return;
      const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      const f = Math.min(face, len * 0.45);
      if (f <= 1e-4) return;
      const np = put({
        x: b.x - ((b.x - a.x) / len) * f,
        y: b.y - ((b.y - a.y) / len) * f,
        z: b.z - ((b.z - a.z) / len) * f,
      });
      if (local) local.points[n - 1] = np;
      else edits.push({ id: target.id, index: n - 1, point: np });
    };

    const nextEqSeq = (type) => {
      equipSeq[type] = (equipSeq[type] || this.state.equipment.filter((e) => e.type === type).length) + 1;
      return equipSeq[type];
    };

    const putEquip = (type, extra) => {
      const t = EQUIP_TYPES[type];
      // 지금 커서에 들어오는 배관의 진행 방향 — 인라인 부속은 이 벡터로 3D 회전을 맞춘다.
      const dv = prevDir || this.lastDirV;
      const dir = INLINE_TYPES.has(type) && dv
        ? [r3(dv.x), r3(dv.y), r3(dv.z)] : null;
      const spec = makeEquipment(type, {
        name: `${t.short}-${100 + nextEqSeq(type)} ${t.label}`,
        x: cursor.x, y: cursor.y, z: cursor.z, rot,
        conn,
        ...(dir ? { dir } : {}),
        ...(extra || {}),
      });
      equip.push(spec);
      return spec;
    };

    // 꺾이는 꼭짓점: 각도에 맞는 엘보를 놓고 배관을 접합면에서 끊는다.
    const cornerJoin = (next, prev) => {
      const dot = prev.x * next.x + prev.y * next.y + prev.z * next.z;
      const bend = THREE.MathUtils.radToDeg(Math.acos(Math.max(-1, Math.min(1, dot))));
      const auto = bend > 80 && bend < 100 ? 'elbow' : (bend > 30 && bend < 60 ? 'elbow45' : null);
      const type = auto || wantElbow;
      wantElbow = null;
      if (!type) return 0;
      const dims = elbowDims(type, bore);
      trimPrevEnd(dims.face);
      flush();
      putEquip(type, {
        bore,
        inDir: [-prev.x, -prev.y, -prev.z],
        outDir: [next.x, next.y, next.z],
        rot: this.rotForDir(next, rot),
      });
      notes.push(type === 'elbow45' ? '45° 엘보 자동' : '엘보 자동');
      return dims.face;
    };

    // 한 구간을 그린다. 방향이 바뀌는 꼭짓점이면 엘보를 자동으로 앉힌다.
    const drawSegment = (v, meters) => {
      const prevV = prevDir || this.lastDirV;
      let face = 0;
      if (prevV) {
        const dot = prevV.x * v.x + prevV.y * v.y + prevV.z * v.z;
        if (dot < 0.999) face = cornerJoin(v, prevV);
        else if (wantElbow) wantElbow = null; // 일직선에는 꺾임이 없다
      }
      face = Math.min(face, meters * 0.45);
      const from = face > 0
        ? put({ x: cursor.x + v.x * face, y: cursor.y + v.y * face, z: cursor.z + v.z * face })
        : { ...cursor };
      const to = put({ x: cursor.x + v.x * meters, y: cursor.y + v.y * meters, z: cursor.z + v.z * meters });
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
      if (op.op === 'conn') { conn = op.conn === 'forged' ? 'forged' : 'flange'; continue; }
      if (op.op === 'newpipe') { flush(); this.lastDirV = null; prevDir = null; continue; }
      if (op.op === 'seg') {
        const m = op.axis ? this.dirToWorld(op.axis, op.sign) : { axis, sign };
        axis = m.axis;
        sign = m.sign < 0 ? -1 : 1;
        rot = this.cmdRotFor(axis, sign);
        drawSegment({ x: axis === 'x' ? sign : 0, y: axis === 'y' ? sign : 0, z: axis === 'z' ? sign : 0 }, op.meters);
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
        const path = this.orthoPath(cursor, hit.p);
        pipeSeq += 1;
        pipes.push(makePipe({
          name: `PL-${String(pipeSeq).padStart(3, '0')} 연결`,
          bore, material, conn, points: path,
        }));
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
        const isElbow = op.type === 'elbow' || op.type === 'elbow45';
        // "엘보써서 위로 1000" — 다음 구간이 꺾이면 그 꼭짓점에 엘보를 앉힌다 (중복 방지)
        if (isElbow && this.nextMoveOp(ops, i) && (prevDir || this.lastDirV)) {
          wantElbow = op.type;
          continue;
        }
        const inline = INLINE_TYPES.has(op.type);
        if (inline) flush(); // 부속이 들어가는 자리에서 배관을 끊고, 부속 뒤에서 다시 이어 그린다.
        // "단조 볼밸브"처럼 부속 앞에 단조/소켓/나사가 붙어 온 부속은 그것만 단조형으로 놓는다.
        const pieceConn = op.conn === 'forged' ? 'forged' : conn;
        const extra = isElbow
          ? { bore, conn: pieceConn }
          : (op.size1 && op.size2 ? { bore1: op.size1, bore2: op.size2, conn: pieceConn } : { conn: pieceConn });
        const spec = putEquip(op.type, extra);
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
    // 다음 명령이 같은 자리에서 이어지도록 커서를 남긴다 (선택은 비어 있어도 커서는 유지).
    this.setCmdCursor(cursor, true);

    const bits = [];
    if (pipes.length) bits.push(`배관 ${pipes.length}개 ${fmt(pipes.reduce((s, p) => s + pipeLength(p.points), 0))}m`);
    if (equip.length) {
      const last = EQUIP_TYPES[equip[equip.length - 1].type].label;
      bits.push(equip.length > 1 ? `부속 ${equip.length}개 (${last} 등)` : last);
    }
    if (notes.length) bits.push(notes.join(' · '));
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
    if (equip.length) this.lastAdded = { kind: 'equipment', id: equip[equip.length - 1].id };
    else if (pipes.length) this.lastAdded = { kind: 'pipe', id: pipes[pipes.length - 1].id };
    // 연속으로 명령을 칠 수 있게 선택은 비워 둔다 (모바일에서 속성 패널이 명령창을 가리는 것 방지)
    this.selection = null;
    this.rebuild();
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
      const conn = (CONN_MODES[this.cmdConn] || CONN_MODES.flange).label;
      el.textContent = `${this.cmdBore} · ${conn} · ${mat} · ${fmt(c.x)}, ${fmt(c.y)}, ${fmt(c.z)}m`;
    }
    this.highlightPad();
  }

  // 연결 방식 전환 — 플랜지(기본) ↔ 단조(소켓웰드·나사식)
  setCmdConn(mode, quiet) {
    this.cmdConn = mode === 'forged' ? 'forged' : 'flange';
    this.updatePadInfo();
    if (!quiet) {
      this.toast(this.cmdConn === 'forged'
        ? '단조형 — 이후 배관·부속을 플랜지 없이 소켓 보스로 그립니다. (단조 볼밸브 · 소켓 엘보)'
        : '플랜지형 — 이후 배관·부속에 플랜지 원판을 그립니다.');
    }
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
      if (sel.op === 'diag' && sel.axis == null) return axis === 'y' && sign === (sel.vert < 0 ? -1 : 1);
      return ax === axis && (sel.sign < 0 ? -1 : 1) === sign;
    };
    $$('#dirPad [data-dir]').forEach((b) => {
      const [axis, s] = b.dataset.dir.split(':');
      b.classList.toggle('active', on(axis, Number(s)));
    });
    const d45 = $('#pad45');
    if (d45) d45.classList.toggle('active', !!this.diag45);
    const fr = $('#btnFrame');
    if (fr) {
      fr.textContent = this.dirFrame === 'me' ? '내 시점 기준' : '도면 축 기준';
      fr.dataset.frame = this.dirFrame;
      fr.setAttribute('aria-pressed', this.dirFrame === 'me' ? 'true' : 'false');
    }
    const cn = $('#btnConn');
    if (cn) {
      const forged = this.cmdConn === 'forged';
      cn.textContent = `연결 · ${forged ? '단조' : '플랜지'}`;
      cn.dataset.conn = forged ? 'forged' : 'flange';
      cn.setAttribute('aria-pressed', forged ? 'true' : 'false');
    }
  }

  // 방향 버튼 하나 — 처음 누르면 선택(강조), 같은 방향을 한 번 더 누르면 바로 그린다.
  tapDir(axis, sign) {
    const s = sign < 0 ? -1 : 1;
    const sel = this.diag45
      ? (axis === 'y' ? { op: 'diag', axis: null, sign: 1, vert: s, angle: 45 }
        : { op: 'diag', axis, sign: s, vert: 1, angle: 45 })
      : { op: 'seg', axis, sign: s };
    const same = this.pending && JSON.stringify(this.pending) === JSON.stringify(sel);
    if (same) { this.padDraw(sel, this.padLen / 1000); return; }
    this.pending = sel;
    this.highlightPad();
    const name = { x: s > 0 ? '우' : '좌', y: s > 0 ? '위' : '아래', z: s > 0 ? '앞' : '뒤' }[axis];
    this.toast(this.diag45
      ? `45° ${name} 선택 — 길이(mm)만 넣고 실행하면 그 방향으로 오르내립니다.`
      : `${name} 선택 — 명령창에 1000처럼 길이만 넣고 실행하세요.`);
  }

  padDraw(sel, meters) {
    if (!sel) return null;
    const m = Math.max(0.005, Number(meters) || (this.padLen / 1000));
    this.padLen = Math.round(m * 1000);
    const op = sel.op === 'diag'
      ? { op: 'diag', axis: sel.axis, sign: sel.sign, vert: sel.vert || 1, angle: sel.angle || 45, meters: m }
      : { op: 'seg', axis: sel.axis, sign: sel.sign, meters: m };
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
    ['#cmdForm', '#viewbar'].forEach((sel) => {
      const b = $(sel);
      if (!b || b.hidden) return;
      const br = b.getBoundingClientRect();
      if (!br.width || !br.height) return;
      const bx = br.left - hr.left;
      const by = br.top - hr.top;
      if (by < hr.height / 2) return;   // 위쪽(상단 바)에 있는 것은 아래 띠 장애물이 아니다
      const hOverlap = l < bx + br.width && l + pr.width > bx;
      if (hOverlap) maxT = Math.min(maxT, by - pr.height - m);
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
    $('#btnConn').addEventListener('click', () => this.setCmdConn(this.cmdConn === 'flange' ? 'forged' : 'flange'));
    $('#pad45').addEventListener('click', () => {
      this.diag45 = !this.diag45;
      this.highlightPad();
      this.toast(this.diag45 ? '45° 경사 모드 — 방향을 고르면 45°로 오르내립니다.' : '90° 방향 모드로 돌아왔습니다.');
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
      if (down) return;
      down = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
    });
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

  onCanvasClick(ev) {
    const ray = this.raycastAt(ev);

    if (this.drawMode) {
      const hits = ray.intersectObject(this.ground, false);
      if (hits.length) this.addDraftPoint(hits[0].point);
      return;
    }

    const hits = ray.intersectObjects(this.root.children, true);
    for (const h of hits) {
      let o = h.object;
      while (o && o !== this.root) {
        if (o.userData && o.userData.pick) {
          this.select(o.userData.pick.kind, o.userData.pick.id);
          return;
        }
        o = o.parent;
      }
    }
    // 작은 밸브·피팅은 정확한 광선이 빗나가기 쉬우므로 화면 32px 안에서 가장 가까운 것을 고른다.
    const near = this.nearestPick(ev, 32);
    if (near) { this.select(near.kind, near.id); return; }
    this.clearSelection();
  }

  onKey(e) {
    const tag = (e.target && e.target.tagName) || '';
    const typing = /INPUT|SELECT|TEXTAREA/.test(tag);
    if (e.key === 'Escape') {
      if (!$('#modalRoot').hidden) { this.closeModal(); return; }
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
      this.updateDims();
      this.renderer.render(this.scene, this.camera);
    });
  }

  // ── 저장 / 불러오기 / 내보내기 ───────────────────────────
  scheduleSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flushSave(), 600);
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

  // 휴대폰 고해상도 사진은 긴 변 1600px · JPEG 0.82로 줄여서 넘긴다.
  readImageFile(file, cb) {
    if (!file) return;
    if (!/^image\//.test(file.type)) { this.toast('이미지 파일만 올릴 수 있습니다.', { type: 'err' }); return; }
    const MAX_SIDE = 1600;
    const QUALITY = 0.82;

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
    if (!this.state.floorPlan.src) {
      this.pendingAi = true;
      $('#aiFile').click();
      return;
    }
    await this.runAI(this.state.floorPlan.src);
  }

  async runAI(dataUrl) {
    if (this.aiRunning) return; // 한 번에 하나만 — 진행 중인 분석을 다른 창으로 덮어쓰지 않는다.
    this.aiRunning = true;
    this.acquireWakeLock(); // 분석하는 동안 폰 화면이 꺼지지 않게 (지원하지 않으면 조용히 무시)
    this.showAiProgress();
    this.openModal({
      title: 'AI 자동 분석',
      body: `<p><span class="loader"></span>사진에서 장비와 배관을 읽는 중입니다. 잠시만 기다려 주세요.</p>
             <p class="hint">분석은 화면을 닫아도 계속됩니다. 결과가 나오면 다시 알려 드립니다.</p>`,
      actions: [],
    });
    try {
      const asked = this.model();
      const { data: res, model: usedModel } = await analyzeImage({ apiKey: this.apiKey(), model: asked, dataUrl });
      if (usedModel && usedModel !== asked) {
        // 구형 모델이 막혀 다른 모델로 성공한 경우 — 다음에도 같은 문제를 겪지 않게 저장해 둔다.
        try { localStorage.setItem(KEY_MODEL, usedModel); localStorage.setItem(KEY_MODEL_MIGRATED, '1'); } catch (e) { /* ignore */ }
        this.toast(`${asked} 모델을 쓸 수 없어 ${usedModel}(으)로 자동 전환했습니다.`);
      }
      const eq = Array.isArray(res.equipment) ? res.equipment : [];
      const pp = Array.isArray(res.pipes) ? res.pipes : [];
      if (!eq.length && !pp.length) throw new Error('이미지에서 장비·배관을 찾지 못했습니다. 다른 사진으로 시도해 보세요.');
      this.openModal({
        title: 'AI 분석 결과',
        body: `
          <div class="ai-result">
            장비 <b>${eq.length}</b>개 · 배관 <b>${pp.length}</b>개를 찾았습니다.<br>
            ${res.notes ? `<span>${esc(res.notes)}</span>` : ''}
          </div>
          <p class="hint">“씬 교체”를 누르면 지금 씬을 지우고 AI 배치로 바꿉니다. “추가”는 기존 씬에 덧붙입니다.</p>`,
        actions: [
          { label: '씬 교체', cls: 'accent', onClick: () => { this.closeModal(); this.applyAIResult(res, 'replace'); } },
          { label: '추가', onClick: () => { this.closeModal(); this.applyAIResult(res, 'append'); } },
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

  applyAIResult(result, mode) {
    // Gemini는 자유 텍스트 타입을 돌려주기도 해서, 긴 이름부터 구체적으로 매칭한다.
    const typeMap = (t) => {
      const s = String(t || '').toLowerCase();
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
    };
    const eq = (result.equipment || []).map((e) => makeEquipment(typeMap(e.type), {
      name: e.name, x: e.x, y: Math.max(0, Number(e.y) || 0), z: e.z,
      w: e.w, h: e.h, d: e.d, rot: e.rot, color: e.color,
      bore1: e.bore1, bore2: e.bore2,
    })).filter((e) => Number.isFinite(e.x) && Number.isFinite(e.z));
    const pipes = (result.pipes || [])
      .filter((p) => p && Array.isArray(p.points) && p.points.length >= 2)
      .map((p) => makePipe({ name: p.name, bore: p.bore, material: p.material, points: p.points }));

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
    this.toast(`AI 배치 완료 · 장비 ${eq.length} / 배관 ${pipes.length}`, { action: '되돌리기', onAction: () => this.undo() });
  }

  // ── UI 바인딩 ───────────────────────────────────────────
  bindUI() {
    // 뷰
    $$('.vbtn[data-view]').forEach((b) => b.addEventListener('click', () => this.setView(b.dataset.view)));
    // 치수 표시 토글 (기본 켜짐 · localStorage에 기억)
    const btnDims = $('#btnDims');
    if (btnDims) btnDims.addEventListener('click', () => this.setDims(!this.dimsOn));

    // 탭
    $$('#tabs .tab').forEach((t) => t.addEventListener('click', () => {
      $$('#tabs .tab').forEach((x) => x.classList.toggle('active', x === t));
      $$('.tabpane').forEach((p) => p.classList.toggle('active', p.dataset.pane === t.dataset.tab));
    }));

    // 장비 버튼 (카테고리별)
    const grid = $('#equipGrid');
    const icons = {
      hx: '▭', pump: '◉', vpump: '⊕', tank: '▮', stank: '▯', rtank: '▣', panel: '▤',
      valve: '✳', bfly: '⊗', yvalve: '⊘', ball: '⊙', check: '◑',
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
        b.addEventListener('click', () => this.addEquipment(type));
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
    body.addEventListener('input', (ev) => {
      const spec = this.getSelectedSpec();
      if (!spec) return;
      const t = ev.target;
      if (t.dataset.f === 'bore1' || t.dataset.f === 'bore2') {
        spec[t.dataset.f] = t.value;
        spec.w = fittingNaturalWidth(spec.type, spec.bore1, spec.bore2);
        this.refreshScene();
        return;
      }
      // 엘보 관경을 바꾸면 외경·곡률·접합면 폭을 다시 뽑는다.
      if (t.dataset.f === 'bore' && (spec.type === 'elbow' || spec.type === 'elbow45')) {
        spec.bore = BORES[t.value] ? t.value : '100A';
        const d = elbowDims(spec.type, spec.bore);
        spec.w = d.face;
        spec.h = d.r * 2;
        spec.d = d.r * 2;
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
        spec[t.dataset.f] = v;
        this.refreshScene();
      } else if (t.dataset.ptf) {
        const i = Number(t.dataset.pt);
        const v = parseFloat(t.value);
        if (!Number.isFinite(v) || !spec.points[i]) return;
        spec.points[i][t.dataset.ptf] = v;
        this.refreshScene();
        this.updatePipeSummary();
      }
    });
    body.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      const spec = this.getSelectedSpec();
      if (!spec) return;
      if (act === 'del') this.deleteSelected();
      else if (act === 'from') this.fromHere();
      else if (act === 'dup') this.duplicateSelected();
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

    // 도면
    $('#btnPlanUpload').addEventListener('click', () => $('#planFile').click());
    $('#planFile').addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      this.readImageFile(f, (src) => this.applyPlanImage(src));
      e.target.value = '';
    });
    $('#planVisible').addEventListener('change', (e) => {
      this.state.floorPlan.visible = e.target.checked;
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
    $('#btnExport').addEventListener('click', () => {
      $$('#tabs .tab').forEach((x) => x.classList.toggle('active', x.dataset.tab === 'file'));
      $$('.tabpane').forEach((p) => p.classList.toggle('active', p.dataset.pane === 'file'));
      this.setDrawerOpen(true);
    });

    // AI
    $('#btnAi').addEventListener('click', () => this.startAI());
    $('#btnAi2').addEventListener('click', () => this.startAI());
    $('#aiFile').addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!f) { this.pendingAi = false; return; }
      this.readImageFile(f, (src) => {
        this.applyPlanImage(src);
        this.pendingAi = false;
        this.runAI(src);
      });
    });

    // 한 줄 배관 명령 (mm)
    const cmdForm = $('#cmdForm');
    cmdForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = $('#cmdInput');
      this.runCommandLine(input.value);
      input.value = '';
      if (window.innerWidth > 860) input.focus(); // 모바일은 키보드를 남기지 않는다
    });
    $('#cmdHelp').addEventListener('click', () => this.openCmdHelp());
    // 화면에서 한 번에 누르는 실행취소 — 직전 명령·패드 입력과 커서까지 되돌린다.
    $('#cmdUndo').addEventListener('click', () => this.undo());
    // 🎤 말로 명령
    $('#cmdMic').addEventListener('click', () => this.toggleVoice());
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
    // 조이스틱은 상시 도구라 뒤로가기로 닫지 않는다.
    return !!((modal && !modal.hidden) || (props && !props.hidden)
      || (drawer && drawer.classList.contains('open')));
  }

  // 창이 열려 있는 동안 히스토리 항목 하나만 깔아 둔다 (중복 push 없음).
  syncOverlayEntry() {
    if (!this.anyOverlayOpen() || this.overlayEntry) return;
    try {
      history.pushState({ smileOverlay: 1 }, '');
      this.overlayEntry = true;
    } catch (e) { /* pushState를 못 쓰는 환경이면 그냥 동작 */ }
  }

  // 모든 창을 닫았으면 빌려온 히스토리 항목을 거둔다.
  releaseOverlayEntry() {
    if (!this.overlayEntry || this.anyOverlayOpen()) return;
    this.overlayEntry = false;
    this.suppressPop += 1;
    try { history.back(); } catch (e) { this.suppressPop -= 1; }
  }

  onPopState() {
    // 우리가 방금 건 history.back()이 만든 이벤트는 무시
    if (this.suppressPop > 0) { this.suppressPop -= 1; return; }
    this.overlayEntry = false; // 뒤로가기가 우리 항목을 소비했다
    if (!$('#modalRoot').hidden) this.closeModal();
    else if (!$('#props').hidden) this.clearSelection();
    else if (this.padOpen) this.setPadOpen(false);
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
          <li><b>현장 사진·도면 올리기</b> — [도면] 탭에서 이미지를 올리면 3D 바닥에 반투명으로 깔립니다. 크기·회전·투명도를 맞춰 스케일을 잡으세요.</li>
          <li><b>장비 배치</b> — [장비] 탭에서 열교환기·펌프·탱크·제어반·게이트밸브를 추가하고, 속성 패널에서 위치·크기·회전을 숫자로 다듬습니다.</li>
          <li><b>배관 긋기</b> — [배관] 탭에서 구경·재질을 고르고 <b>3D에서 배관 그리기</b> → 바닥을 터치해 점을 찍습니다. 높이는 HUD의 숫자로 바꿀 수 있어 수직 상승·엘보가 그대로 표현됩니다.</li>
          <li><b>보기</b> — 한 손가락(마우스 왼쪽) 회전, 두 손가락(휠) 확대, 두 손가락 이동. 상단·하단의 등각/위에서/정면/리셋 버튼.</li>
          <li><b>한 줄 명령</b> — 화면 아래 입력창에 <code>50a 오른쪽으로 1000 위로 1500</code>처럼 쓰고 <b>실행</b>을 누르면 mm 단위로 배관이 이어집니다. 부속·장비 이름(<code>플렌지</code>, <code>버터</code>, <code>엘보</code> 등)을 함께 쓰면 그 자리에 배치됩니다.</li>
          <li><b>내보내기</b> — [파일] 탭에서 JSON 저장·불러오기, <b>Fusion 360 .py</b>, <b>.obj</b>.</li>
        </ol>
        <p class="hint">작업은 이 브라우저에 자동 저장됩니다. 되돌리기는 오른쪽 위 알림의 “되돌리기” 또는 <code>Ctrl+Z</code>.</p>`,
      actions: [{ label: '확인', cls: 'accent' }],
    });
  }

  // ── 토스트 ──────────────────────────────────────────────
  toast(message, opts) {
    const o = opts || {};
    const host = $('#toastHost');
    const el = document.createElement('div');
    el.className = 'toast' + (o.type === 'err' ? ' err' : '');
    const span = document.createElement('span');
    span.textContent = message;
    el.appendChild(span);
    if (o.action) {
      const b = document.createElement('button');
      b.className = 'act';
      b.textContent = o.action;
      b.addEventListener('click', () => {
        el.remove();
        if (o.onAction) o.onAction();
      });
      el.appendChild(b);
    }
    host.appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity .3s';
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 320);
    }, o.action ? 6000 : 3400);
  }
}

const app = new App();
app.init();
window.__app = app;
