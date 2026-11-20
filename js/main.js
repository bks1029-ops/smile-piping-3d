// 스마일산업 3D 배관 — 메인 앱
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  BORES, MATERIALS, EQUIP_TYPES, makeEquipment, makePipe,
  sampleScene, normalizeState, pipeLength,
} from './store.js';
import { buildScene } from './builders.js';
import { buildFusionScript, downloadText, timestampName } from './fusion.js';
import { buildOBJ } from './obj.js';
import { analyzeImage } from './ai.js';

// 콘솔 오류 감시 (검증용)
window.__errors = window.__errors || [];
window.addEventListener('error', (e) => window.__errors.push('error: ' + (e.message || e.error)));
window.addEventListener('unhandledrejection', (e) => {
  window.__errors.push('promise: ' + ((e.reason && e.reason.message) || e.reason));
});

const STORAGE_KEY = 'smilePiping3D.v1';
const KEY_API = 'smilePiping3D.geminiKey';
const KEY_MODEL = 'smilePiping3D.geminiModel';

const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const fmt = (n) => String(Math.round(Number(n) * 100) / 100);
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const VIEW_NAMES = ['iso', 'top', 'front', 'reset'];

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
  }

  // ── 초기화 ───────────────────────────────────────────────
  init() {
    this.setupRenderer();
    this.setupScene();
    this.setupFloorPlan();
    this.setupDraft();
    this.bindUI();
    this.bindSceneEvents();
    this.rebuild();
    this.resize();
    this.loop();

    const v = new URLSearchParams(location.search).get('view');
    if (v && VIEW_NAMES.includes(v)) this.setView(v, true);
    else this.setView('iso', true);

    window.addEventListener('resize', () => this.resize());
    if (window.ResizeObserver) {
      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe($('#viewport'));
    }
    window.addEventListener('keydown', (e) => this.onKey(e));
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

    // 바닥
    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(150, 150),
      new THREE.MeshStandardMaterial({ color: 0x1b2229, roughness: 0.96, metalness: 0.02 }),
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -0.012;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    // 1m 그리드
    const grid = new THREE.GridHelper(120, 120, 0x5d6f80, 0x2e3944);
    grid.position.y = 0.001;
    grid.material.transparent = true;
    grid.material.opacity = 0.5;
    this.scene.add(grid);

    const grid5 = new THREE.GridHelper(120, 24, 0x7f93a6, 0x3b4a59);
    grid5.position.y = 0.0015;
    grid5.material.transparent = true;
    grid5.material.opacity = 0.3;
    this.scene.add(grid5);

    // 축
    const axisLine = (a, b, color) => {
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...a), new THREE.Vector3(...b)]);
      const m = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85 });
      return new THREE.Line(g, m);
    };
    this.scene.add(axisLine([0, 0.004, 0], [3.4, 0.004, 0], 0xd9534f));
    this.scene.add(axisLine([0, 0.004, 0], [0, 2.6, 0], 0x3fb950));
    this.scene.add(axisLine([0, 0.004, 0], [0, 0.004, 3.4], 0x3b82f6));
    const lx = this.makeLabel('X', '#ff8f8a'); lx.position.set(3.7, 0.25, 0); this.scene.add(lx);
    const ly = this.makeLabel('Y', '#8ff0a4'); ly.position.set(0, 2.95, 0); this.scene.add(ly);
    const lz = this.makeLabel('Z', '#8fb6ff'); lz.position.set(0, 0.25, 3.7); this.scene.add(lz);
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

  refreshScene() {
    if (this.root) this.scene.remove(this.root);
    this.root = buildScene(this.state);
    this.scene.add(this.root);
    this.applyPlan();
    this.refreshHighlight();
    this.renderLists();
    this.updateStats();
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
    if (window.innerWidth <= 860) {
      $('#drawer').classList.remove('open');
    }
  }

  clearSelection() {
    this.selection = null;
    this.refreshHighlight();
    this.renderProps();
    this.renderLists();
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
    if (!spec) { panel.hidden = true; return; }
    panel.hidden = false;
    const body = $('#propBody');

    if (spec.kind === 'equipment' || this.state.equipment.includes(spec)) {
      $('#propBadge').textContent = EQUIP_TYPES[spec.type].label;
      body.innerHTML = `
        <label class="field">이름<input type="text" data-f="name" value="${esc(spec.name)}"></label>
        <div class="prop-section">위치 (m)</div>
        <div class="prop-grid3">
          <label class="field">X<input type="number" step="0.1" data-f="x" value="${fmt(spec.x)}"></label>
          <label class="field">높이<input type="number" step="0.1" data-f="y" value="${fmt(spec.y)}"></label>
          <label class="field">Z<input type="number" step="0.1" data-f="z" value="${fmt(spec.z)}"></label>
        </div>
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
        <div class="pipe-summary">길이 ${fmt(pipeLength(spec.points))} m · 점 ${spec.points.length}개</div>
        <div class="prop-section">포인트 (X / 높이 Y / Z)</div>
        <div class="pt-head"><span>#</span><span>X</span><span>Y</span><span>Z</span><span></span></div>
        <div class="pt-list">${rows}</div>
        <div class="prop-actions">
          <button class="btn small ghost" data-act="addpt">점 추가</button>
          <button class="btn small danger" data-act="del">배관 삭제</button>
        </div>`;
    }
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
    this.undoStack.push({ snap: JSON.stringify(this.state), label });
    if (this.undoStack.length > 30) this.undoStack.shift();
  }

  undo() {
    const u = this.undoStack.pop();
    if (!u) { this.toast('되돌릴 작업이 없습니다.'); return; }
    this.state = normalizeState(JSON.parse(u.snap));
    this.selection = null;
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
    });
    this.pushUndo(t.label + ' 추가');
    this.state.equipment.push(spec);
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

  nextPipeName() {
    const n = this.state.pipes.length + 1;
    return `PL-${String(n).padStart(3, '0')} 새 배관`;
  }

  // ── 배관 그리기 ──────────────────────────────────────────
  setDrawMode(on) {
    this.drawMode = on;
    $('#drawHud').hidden = !on;
    $('#btnDrawPipe').textContent = on ? '그리기 취소' : '3D에서 배관 그리기';
    if (!on) {
      this.draft = [];
      this.updateDraft();
    } else {
      this.clearSelection();
      $('#draftHeight').value = String(this.draftHeight);
      if (window.innerWidth <= 860) $('#drawer').classList.remove('open');
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
      if (Math.abs(m - 0.85) < 0.02) break;
      dist = Math.max(2, dist * (m / 0.85));
    }
    return { pos: target.clone().addScaledVector(dir, dist), target };
  }

  setView(name, immediate) {
    const activeName = name === 'reset' ? 'iso' : name;
    $$('.vbtn').forEach((b) => b.classList.toggle('active', b.dataset.view === activeName));
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
      down = { x: e.clientX, y: e.clientY, t: performance.now() };
    });
    canvas.addEventListener('pointerup', (e) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const dt = performance.now() - down.t;
      down = null;
      if (moved > 9 || dt > 900) return;
      this.onCanvasClick(e);
    });
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
      this.renderer.render(this.scene, this.camera);
    });
  }

  // ── 저장 / 불러오기 / 내보내기 ───────────────────────────
  scheduleSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
      } catch (e) {
        if (String(e).includes('quota')) this.toast('저장 공간이 부족합니다. 도면 이미지를 줄여보세요.', { type: 'err' });
      }
    }, 600);
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

  readImageFile(file, cb) {
    if (!file) return;
    if (!/^image\//.test(file.type)) { this.toast('이미지 파일만 올릴 수 있습니다.', { type: 'err' }); return; }
    const reader = new FileReader();
    reader.onload = () => cb(String(reader.result));
    reader.readAsDataURL(file);
  }

  // ── AI ─────────────────────────────────────────────────
  apiKey() { return localStorage.getItem(KEY_API) || ''; }
  model() { return localStorage.getItem(KEY_MODEL) || 'gemini-2.5-flash'; }

  async startAI() {
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
    this.openModal({
      title: 'AI 자동 분석',
      body: `<p><span class="loader"></span>사진에서 장비와 배관을 읽는 중입니다. 잠시만 기다려 주세요.</p>`,
      actions: [],
    });
    try {
      const res = await analyzeImage({ apiKey: this.apiKey(), model: this.model(), dataUrl });
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
          { label: '설정 열기', onClick: () => this.openSettings() },
          { label: '닫기', cls: 'accent' },
        ],
      });
    }
  }

  applyAIResult(result, mode) {
    const typeMap = (t) => {
      const s = String(t || '').toLowerCase();
      if (/hx|heat|exchang|열교환/.test(s)) return 'hx';
      if (/pump|펌프/.test(s)) return 'pump';
      if (/tank|drum|vessel|탱크|드럼/.test(s)) return 'tank';
      if (/panel|mcc|control|전기|제어/.test(s)) return 'panel';
      if (/valve|flange|gate|밸브|플랜지/.test(s)) return 'valve';
      return 'tank';
    };
    const eq = (result.equipment || []).map((e) => makeEquipment(typeMap(e.type), {
      name: e.name, x: e.x, y: Math.max(0, Number(e.y) || 0), z: e.z,
      w: e.w, h: e.h, d: e.d, rot: e.rot, color: e.color,
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
    $$('.vbtn').forEach((b) => b.addEventListener('click', () => this.setView(b.dataset.view)));

    // 탭
    $$('#tabs .tab').forEach((t) => t.addEventListener('click', () => {
      $$('#tabs .tab').forEach((x) => x.classList.toggle('active', x === t));
      $$('.tabpane').forEach((p) => p.classList.toggle('active', p.dataset.pane === t.dataset.tab));
    }));

    // 장비 버튼
    const grid = $('#equipGrid');
    const icons = { hx: '▭', pump: '◉', tank: '▮', panel: '▤', valve: '✳' };
    Object.keys(EQUIP_TYPES).forEach((type) => {
      const t = EQUIP_TYPES[type];
      const b = document.createElement('button');
      b.className = 'equip-btn';
      b.innerHTML = `<span class="ico">${icons[type] || '■'}</span><span class="lbl">${t.label}</span>
        <span class="sub">${t.defaults.w}×${t.defaults.h}×${t.defaults.d} m</span>`;
      b.addEventListener('click', () => this.addEquipment(type));
      grid.appendChild(b);
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
      if (t.dataset.f) {
        let v = t.type === 'number' ? parseFloat(t.value) : t.value;
        if (t.type === 'number' && !Number.isFinite(v)) return;
        if (t.dataset.f === 'name') v = String(v);
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
    $('#btnClear').addEventListener('click', () => {
      this.pushUndo('씬 비우기');
      const fp = this.state.floorPlan;
      this.state.equipment = [];
      this.state.pipes = [];
      this.state.floorPlan = fp;
      this.selection = null;
      this.rebuild();
      this.toast('씬을 비웠습니다.', { action: '되돌리기', onAction: () => this.undo() });
    });
    $('#btnHelp').addEventListener('click', () => this.openHelp());
    $('#btnExport').addEventListener('click', () => {
      $$('#tabs .tab').forEach((x) => x.classList.toggle('active', x.dataset.tab === 'file'));
      $$('.tabpane').forEach((p) => p.classList.toggle('active', p.dataset.pane === 'file'));
      $('#drawer').classList.add('open');
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

    // 설정 · 모달
    $('#btnSettings').addEventListener('click', () => this.openSettings());
    $('#modalClose').addEventListener('click', () => this.closeModal());
    $('#modalRoot').addEventListener('click', (e) => {
      if (e.target.dataset.close) this.closeModal();
    });

    // 모바일 도구함
    $('#btnDrawer').addEventListener('click', () => $('#drawer').classList.toggle('open'));

    this.syncPlanInputs();
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
  }

  closeModal() {
    $('#modalRoot').hidden = true;
    $('#modalBody').innerHTML = '';
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
            ${['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.5-pro'].map((m) => `<option${m === model ? ' selected' : ''}>${m}</option>`).join('')}
          </select>
        </label>
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
