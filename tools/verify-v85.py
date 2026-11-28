#!/usr/bin/env python3
"""v85 검증 — 45° 방향·해제·자동 잇기 수정.

사용자 제보(2026-11-28, 캡처 32511):
  · "45도 껐는데 지 맘데로 그려 버리네"   — 45°를 끄면 골라 둔 방향이 90°로 돌아와야 한다
  · "그리고 방향대로 안그려져"            — 위 45°만 되던 것을 위·아래·수평 45°로 고른다
  · "배관 자동으로 이을 때도 45도 켜면 알아서 45도로 이어줘야" — 🔗 잇기·연결 명령이 45° 경로

검사 항목
 A. 45° 해제 — 45° ON → → 선택 → 45° OFF → 길이 실행 시 대각선(y 변화) 없이 90° 직선
 B. 45° 방향 — 위 45° / 아래 45° / 수평 45°(좌우·앞뒤 네 방향) 각각 그 방향대로 그려진다
 C. 조이스틱 UI — 45° 경사 줄 표시·선택, 수평 45°에서 버튼 글자가 대각선으로 바뀐다
 D. 🔗 잇기 — 45° ON이면 45° 대각선 경로 + elbow45 + 절단 길이, OFF면 기존 90° 경로
 E. 연결 명령·포트(플랜지) — 포트 축 스텁 + 45° 엘보, 90° 대체 경로도 엘보가 선다
 F. 명령 파서 — 45도 오른쪽 / 45도 아래 왼쪽 / 오프셋 500 오른쪽, 일반 직각 명령은 대각선 금지
 G. 회귀 — v84: 45° 엘보 face 63.5 · 오프셋 707.1/580.1 · 플랜지 끝 100mm
 H. 모바일 390×844 — 조이스틱·45° 줄이 화면 밖으로 넘치지 않는다
 K. 콘솔 오류 0건

로컬 실행:  python3 tools/verify-v85.py            (127.0.0.1:8785)
라이브:     python3 tools/verify-v85.py --live
필요:       playwright(chromium)
"""
import functools
import http.server
import json
import os
import socketserver
import sys
import threading

from playwright.sync_api import sync_playwright

PORT = 8785
ROOT = '/workspace/projects/smile-piping-3d'
LIVE = 'https://bks1029-ops.github.io/smile-piping-3d/'
BASE = LIVE if '--live' in sys.argv else f'http://127.0.0.1:{PORT}/'
TMP = '/workspace/tmp'
results = []


def check(name, ok, detail=''):
    results.append((name, bool(ok), detail))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''))


class Quiet(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True


class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


# ── JS 조각 ────────────────────────────────────────────────────────────
RESET = '''(opts) => {
  const o = opts || {};
  const a = window.__app;
  a.closeModal && a.closeModal();
  a.clearAll({ silent: true });
  a.pending = null;
  a.setDiagMode('up');
  a.setDiag45(false, true);
  a.pending = null;
  a.setFitAuto(o.fit === undefined ? true : !!o.fit, true);
  a.setCmdBore(o.bore || '100A', true);
  a.setDirFrame(o.frame || 'plan', true);
  a.setCmdCursor({ x: 0, y: 0, z: 0 }, true);
  return { diag45: a.diag45, diagMode: a.diagMode, pending: a.pending };
}'''

STATE = '''() => {
  const a = window.__app;
  const seg = (p) => {
    let s = 0;
    for (let i = 1; i < (p.points || []).length; i += 1) {
      const q = p.points[i - 1];
      const r = p.points[i];
      s += Math.hypot(r.x - q.x, r.y - q.y, r.z - q.z);
    }
    return Math.round(s * 1000 * 10) / 10;
  };
  const cuts = [];
  a.state.pipes.forEach((p, pi) => {
    for (let i = 1; i < (p.points || []).length; i += 1) {
      const s = a.segCutInfo(p, i);
      if (!s) continue;
      cuts.push({ pipe: pi, cut: Math.round(s.cut * 1000 * 10) / 10,
        fa: s.fa ? s.fa.label : null, fb: s.fb ? s.fb.label : null });
    }
  });
  return {
    pipes: a.state.pipes.map((p) => ({ points: p.points, mm: seg(p), bore: p.bore })),
    cuts,
    elbows: a.state.equipment.filter((e) => e.type === 'elbow45' || e.type === 'elbow')
      .map((e) => ({ type: e.type, x: e.x, y: e.y, z: e.z, w: e.w })),
    cursor: { ...a.cmdCursor },
    diag45: a.diag45,
    pending: a.pending,
  };
}'''

LINK = '''(args) => {
  const [diagOn, targetIdx] = args;
  const a = window.__app;
  a.clearAll({ silent: true });
  a.pending = null;
  a.setFitAuto(true, true);
  a.setCmdBore('100A', true);
  a.setDirFrame('plan', true);
  a.setCmdCursor({ x: 0, y: 0, z: 0 }, true);
  a.execOps([{ op: 'seg', world: true, axis: 'x', sign: 1, meters: 3 }], { source: 'cmd' });
  a.setCmdCursor({ x: 0, y: 0, z: 1.5 }, true);
  a.setDiag45(!!diagOn, true);
  const basePipes = a.state.pipes.length;
  const p0 = a.state.pipes[0];
  const tp = targetIdx === 'start' ? p0.points[0] : p0.points[p0.points.length - 1];
  const V = a.camera.position.constructor;
  const v = new V(tp.x, tp.y, tp.z).project(a.camera);
  const r = a.renderer.domElement.getBoundingClientRect();
  const ev = {
    clientX: r.left + (v.x * 0.5 + 0.5) * r.width,
    clientY: r.top + (-v.y * 0.5 + 0.5) * r.height,
  };
  a.setLinkMode(true);
  a.tryLinkAt(ev);
  const seg = (p) => {
    let s = 0;
    for (let i = 1; i < p.points.length; i += 1) {
      s += Math.hypot(p.points[i].x - p.points[i - 1].x, p.points[i].y - p.points[i - 1].y,
        p.points[i].z - p.points[i - 1].z);
    }
    return Math.round(s * 1000 * 10) / 10;
  };
  // 45° 대각선 구간이 있는지 — 수평 성분과 수직 성분이 같은 길이인 구간
  let diag = 0;
  const angles = [];
  a.state.pipes.slice(basePipes).forEach((p) => {
    for (let i = 1; i < p.points.length; i += 1) {
      const q = p.points[i - 1];
      const r2 = p.points[i];
      const dy = Math.abs(r2.y - q.y);
      const dh = Math.hypot(r2.x - q.x, r2.z - q.z);
      const dx = Math.abs(r2.x - q.x);
      const dz = Math.abs(r2.z - q.z);
      const horiz45 = dy < 0.002 && dh > 0.02 && Math.abs(dx - dz) < 0.01;
      if ((dy > 0.02 && Math.abs(dy - dh) < 0.01) || horiz45) {
        diag += 1;
        angles.push(horiz45 ? 45 : Math.round(Math.atan2(dy, dh) * 180 / Math.PI));
      }
    }
  });
  const cuts = [];
  a.state.pipes.forEach((p, pi) => {
    for (let i = 1; i < p.points.length; i += 1) {
      const s = a.segCutInfo(p, i);
      if (s) cuts.push({ pipe: pi, cut: Math.round(s.cut * 1000 * 10) / 10,
        fa: s.fa ? s.fa.label : null, fb: s.fb ? s.fb.label : null });
    }
  });
  return {
    basePipes,
    pipes: a.state.pipes.map((p) => ({ points: p.points, mm: seg(p) })),
    elbows: a.state.equipment.filter((e) => e.type === 'elbow45' || e.type === 'elbow')
      .map((e) => ({ type: e.type, x: e.x, y: e.y, z: e.z })),
    diagSegs: diag, angles, cuts,
    cursor: { ...a.cmdCursor },
    toast: (document.querySelector('#toast') || {}).text === undefined ? '' : '',
  };
}'''

PORT_LINK = '''(diagOn) => {
  const a = window.__app;
  a.clearAll({ silent: true });
  a.pending = null;
  a.setFitAuto(true, true);
  a.setCmdBore('100A', true);
  a.setDirFrame('plan', true);
  a.setCmdCursor({ x: 0, y: 0, z: 0 }, true);
  a.execOps([{ op: 'seg', world: true, axis: 'x', sign: 1, meters: 3 }], { source: 'cmd' });
  a.setCmdCursor({ x: 3, y: 0, z: 0 }, true);
  a.addFittingAtCursor('flange');
  const fl = a.state.equipment.find((e) => e.type === 'flange');
  const faces = a.state.pipes.length ? null : null;
  a.setCmdCursor({ x: 0, y: 0, z: 1.5 }, true);
  a.setDiag45(!!diagOn, true);
  // 플랜지를 향해 잇기 — 커서 쪽(−X)을 보는 접합면
  const face = { x: fl.x - fl.w / 2, y: fl.y, z: fl.z };
  const V = a.camera.position.constructor;
  const v = new V(face.x, face.y, face.z).project(a.camera);
  const r = a.renderer.domElement.getBoundingClientRect();
  const ev = {
    clientX: r.left + (v.x * 0.5 + 0.5) * r.width,
    clientY: r.top + (-v.y * 0.5 + 0.5) * r.height,
  };
  a.setLinkMode(true);
  a.tryLinkAt(ev);
  const cuts = [];
  a.state.pipes.forEach((p, pi) => {
    for (let i = 1; i < p.points.length; i += 1) {
      const s = a.segCutInfo(p, i);
      if (s) cuts.push({ pipe: pi, cut: Math.round(s.cut * 1000 * 10) / 10,
        fa: s.fa ? s.fa.label : null, fb: s.fb ? s.fb.label : null });
    }
  });
  return {
    fl: { x: fl.x, y: fl.y, z: fl.z, w: fl.w },
    pipes: a.state.pipes.map((p) => p.points),
    elbows: a.state.equipment.filter((e) => e.type === 'elbow45' || e.type === 'elbow')
      .map((e) => ({ type: e.type, x: e.x, y: e.y, z: e.z })),
    cuts,
    cursor: { ...a.cmdCursor },
  };
}'''

PARSE = '''async () => {
  const C = await import('./js/cmd.js?v=85');
  const out = {};
  ['45도 오른쪽 1000', '45도 아래 왼쪽 800', '오프셋 500 오른쪽', '오른쪽 1000', '45도 위 1000']
    .forEach((t) => {
      const p = C.parseCommand(t);
      out[t] = { ops: p.ops, unknown: p.unknown };
    });
  return out;
}'''

CMD_RUN = '''(args) => {
  const [text, diagOn] = args;
  const a = window.__app;
  a.clearAll({ silent: true });
  a.pending = null;
  a.setFitAuto(false, true);
  a.setCmdBore('100A', true);
  a.setDirFrame('plan', true);
  a.setCmdCursor({ x: 0, y: 0, z: 0 }, true);
  a.setDiag45(!!diagOn, true);
  a.pending = null;
  a.runCommandLine(text);
  const p = a.state.pipes[a.state.pipes.length - 1];
  const s0 = p && p.points.length ? p.points[0] : null;
  const s1 = p && p.points.length ? p.points[p.points.length - 1] : null;
  return {
    pipes: a.state.pipes.length,
    d: s0 && s1 ? { x: +(s1.x - s0.x).toFixed(3), y: +(s1.y - s0.y).toFixed(3), z: +(s1.z - s0.z).toFixed(3) } : null,
    points: p ? p.points : null,
    pending: a.pending,
  };
}'''

OFF_DEF = '''() => {
  const a = window.__app;
  a.clearAll({ silent: true });
  a.setFitAuto(false, true);
  a.setCmdBore('100A', true);
  a.setDirFrame('plan', true);
  a.setCmdCursor({ x: 0, y: 0, z: 0 }, true);
  a.setDiag45(false, true);
  // 45° 상태에서 남아 있던 대각선 pending을 강제로 넣고 45°를 끈다
  a.pending = { op: 'diag', axis: 'x', sign: 1, vert: 1, angle: 45 };
  a.setDiag45(false, true);
  a.padDraw(a.pending, 1);
  const p = a.state.pipes[a.state.pipes.length - 1];
  // 수평 45° pending도 45°가 꺼져 있으면 대각선을 그리지 않는다
  a.clearAll({ silent: true });
  a.setCmdCursor({ x: 0, y: 0, z: 0 }, true);
  a.padDraw({ op: 'diagxz', axis: 'x', sign: 1 }, 1);
  const p2 = a.state.pipes[a.state.pipes.length - 1];
  const dy = (q) => {
    if (!q) return null;
    let m = 0;
    for (let i = 1; i < q.points.length; i += 1) m = Math.max(m, Math.abs(q.points[i].y - q.points[i - 1].y));
    return m;
  };
  const dxy = (q) => {
    if (!q) return null;
    const a0 = q.points[0];
    const a1 = q.points[q.points.length - 1];
    return { x: +(a1.x - a0.x).toFixed(3), y: +(a1.y - a0.y).toFixed(3), z: +(a1.z - a0.z).toFixed(3) };
  };
  return { p1: { dy: dy(p), d: dxy(p) }, p2: { d: dxy(p2), dz: dxy(p2) ? Math.abs(dxy(p2).z) : null } };
}'''

PAD_UI = '''() => {
  const row = document.querySelector('#padDiagRow');
  const pad = document.querySelector('#dirPad');
  const labels = Array.from(document.querySelectorAll('#dirPad [data-dir]')).map((b) => b.textContent.trim());
  const btns = Array.from(row.querySelectorAll('[data-diag]')).map((b) => ({
    k: b.dataset.diag, t: b.textContent.trim(), on: b.classList.contains('active'),
    w: Math.round(b.getBoundingClientRect().width),
  }));
  const pr = pad.getBoundingClientRect();
  const over = Array.from(pad.querySelectorAll('*')).reduce((worst, el) => {
    const r = el.getBoundingClientRect();
    return Math.max(worst, r.right - pr.right, pr.left - r.left, r.bottom - pr.bottom, pr.top - r.top);
  }, -1e9);
  return {
    hidden: row.hidden, labels, btns, pad45: document.querySelector('#pad45').classList.contains('active'),
    pad: { l: Math.round(pr.left), r: Math.round(pr.right), t: Math.round(pr.top), b: Math.round(pr.bottom), w: Math.round(pr.width) },
    overflow: Math.round(over * 10) / 10,
    vw: window.innerWidth, vh: window.innerHeight,
    scrollW: document.documentElement.scrollWidth,
  };
}'''

REGRESSION = '''async () => {
  const S = await import('./js/store.js?v=85');
  const a = window.__app;
  a.clearAll({ silent: true });
  a.setFitAuto(true, true);
  a.setCmdBore('100A', true);
  a.setDirFrame('plan', true);
  a.setCmdCursor({ x: 0, y: 0, z: 0 }, true);
  a.execOps([{ op: 'seg', world: true, axis: 'x', sign: 1, meters: 2 }], { source: 'cmd' });
  const off = a.offset45Info(500);
  // 플랜지 끝 100mm 회귀 (v78)
  a.clearAll({ silent: true });
  a.setCmdBore('150A', true);
  a.setCmdCursor({ x: 0, y: 0, z: 0 }, true);
  a.execOps([{ op: 'seg', world: true, axis: 'x', sign: 1, meters: 3 }], { source: 'cmd' });
  a.setCmdCursor({ x: 3, y: 0, z: 0 }, true);
  a.addFittingAtCursor('flange');
  a.execOps([{ op: 'seg', world: true, axis: 'x', sign: 1, meters: 0.1 }], { source: 'cmd' });
  a.execOps([{ op: 'seg', world: true, axis: 'z', sign: -1, meters: 1.0 }], { source: 'cmd' });
  const seg = (p) => {
    let s = 0;
    for (let i = 1; i < p.points.length; i += 1) {
      s += Math.hypot(p.points[i].x - p.points[i - 1].x, p.points[i].y - p.points[i - 1].y,
        p.points[i].z - p.points[i - 1].z);
    }
    return Math.round(s * 1000 * 10) / 10;
  };
  const lens = a.state.pipes.map(seg);
  const e90 = a.state.equipment.find((e) => e.type === 'elbow');
  // 샘플 씬
  a.state = S.sampleScene();
  a.selection = null;
  a.setFitAuto(true, true);
  a.rebuild();
  return {
    off: { hyp: Math.round(off.hyp * 1000 * 10) / 10, cut: Math.round(off.cut * 1000 * 10) / 10,
      B: Math.round(off.B * 1000 * 10) / 10 },
    face45: S.elbowDims('elbow45', '100A').face, face45_200: S.elbowDims('elbow45', '200A').face,
    lens, shortOk: lens.some((l) => Math.abs(l - 100) < 3),
    e90: e90 ? e90.w : null,
    sample: { pipes: a.state.pipes.length, equips: a.state.equipment.length, meshes: a.root.children.length },
  };
}'''


def new_page(browser, viewport, mobile, errs):
    kw = dict(viewport=viewport)
    if mobile:
        kw.update(device_scale_factor=2, is_mobile=True, has_touch=True)
    page = browser.new_page(**kw)
    page.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    page.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)))
    page.goto(BASE + '?v=85', wait_until='networkidle')
    page.wait_for_function('window.__app && window.__app.state', timeout=30000)
    page.wait_for_timeout(700)
    return page


def run_pad_ui(page):
    """C. 조이스틱 UI — 45° 줄 표시·글자 전환"""
    page.evaluate(RESET, {})
    page.wait_for_timeout(150)
    off = page.evaluate(PAD_UI)
    check('C. 45°가 꺼져 있으면 경사 줄이 숨겨진다', off['hidden'] is True, json.dumps(off['btns'], ensure_ascii=False))
    page.click('#pad45')
    page.wait_for_timeout(200)
    on = page.evaluate(PAD_UI)
    check('C. 45°를 켜면 [↗ 위45° · ↘ 아래45° · ⤢ 수평45°] 줄이 나온다 (기본 위45° 선택)',
          on['hidden'] is False and len(on['btns']) == 3 and on['btns'][0]['on']
          and '위45' in on['btns'][0]['t'] and '아래45' in on['btns'][1]['t'] and '수평45' in on['btns'][2]['t'],
          json.dumps(on['btns'], ensure_ascii=False))
    check('C. 세 버튼이 조이스틱 폭 안에서 잘리지 않는다 (버튼 폭 30px 이상)',
          all(b['w'] >= 30 for b in on['btns']), json.dumps([b['w'] for b in on['btns']]))
    page.click('#padDiagRow [data-diag="xz"]')
    page.wait_for_timeout(200)
    xz = page.evaluate(PAD_UI)
    check('C. 수평 45°를 고르면 좌·우·앞·뒤 버튼이 대각선 글자(↙ ↗ ↖ ↘)로 바뀐다',
          xz['labels'] == ['↙', '↑', '↗', '↖', '↓', '↘'], json.dumps(xz['labels'], ensure_ascii=False))
    check('C. 수평 45° 버튼이 선택 표시로 남는다',
          [b['on'] for b in xz['btns']] == [False, False, True] and xz['pad45'],
          json.dumps(xz['btns'], ensure_ascii=False))
    page.click('#pad45')
    page.wait_for_timeout(200)
    back = page.evaluate(PAD_UI)
    check('C. 45°를 다시 끄면 글자가 ← ↑ → 앞 ↓ 뒤로 돌아오고 줄이 숨는다',
          back['labels'] == ['←', '↑', '→', '앞', '↓', '뒤'] and back['hidden'] is True,
          json.dumps(back['labels'], ensure_ascii=False))
    return on


def run_off(page):
    """A. 45° 해제 — 대각선이 남지 않는다"""
    page.evaluate(RESET, {'fit': False})
    page.wait_for_timeout(120)
    page.click('#pad45')                      # 45° ON
    page.wait_for_timeout(150)
    page.click('#dirPad [data-dir="x:1"]')    # → 선택 (45° 경사 pending)
    page.wait_for_timeout(150)
    mid = page.evaluate("() => ({ p: __app.pending, on: __app.diag45 })")
    page.click('#pad45')                      # 45° OFF
    page.wait_for_timeout(150)
    after = page.evaluate("() => ({ p: __app.pending, on: __app.diag45 })")
    page.fill('#cmdInput', '1000')
    page.click('#cmdRun')
    page.wait_for_timeout(350)
    st = page.evaluate(STATE)
    check('A. 45° ON에서 → 를 고르면 pending이 45° 경사(diag)다',
          mid['p'] and mid['p']['op'] == 'diag' and mid['on'] is True, json.dumps(mid, ensure_ascii=False))
    check('A. 45°를 끄면 pending이 곧바로 90° 직각(seg)으로 바뀐다',
          after['p'] and after['p']['op'] == 'seg' and after['on'] is False, json.dumps(after, ensure_ascii=False))
    pts = st['pipes'][0]['points'] if st['pipes'] else []
    dy = max([abs(pts[i]['y'] - pts[i - 1]['y']) for i in range(1, len(pts))] or [0])
    check('A. 45°를 끈 뒤 1000을 실행하면 대각선 없이 y 변화 0인 90° 직선이 그려진다',
          len(st['pipes']) == 1 and dy < 1e-6 and abs(pts[-1]['x'] - 1.0) < 0.002
          and abs(pts[-1]['z']) < 0.002,
          json.dumps(pts, ensure_ascii=False))
    # 45° OFF 상태에서 → 를 다시 눌러도 직각
    page.click('#dirPad [data-dir="x:1"]')
    page.wait_for_timeout(120)
    page.fill('#cmdInput', '1000')
    page.click('#cmdRun')
    page.wait_for_timeout(300)
    st2 = page.evaluate(STATE)
    p2 = st2['pipes'][-1]['points']
    dy2 = max([abs(p2[i]['y'] - p2[i - 1]['y']) for i in range(1, len(p2))] or [0])
    check('A. 45°가 꺼진 채 방향 버튼을 다시 눌러도 직각으로만 그린다 (y 변화 0)',
          dy2 < 1e-6 and st2['diag45'] is False, json.dumps(p2, ensure_ascii=False))


def run_dirs(page):
    """B. 위·아래·수평 45° 방향"""
    cases = [
        ('up', 'x:1', {'x': 0.707, 'y': 0.707, 'z': 0}, 'B. 45° 위 + → — 오른쪽으로 오르는 45° (dx 707 · dy 707)'),
        ('down', 'x:1', {'x': 0.707, 'y': -0.707, 'z': 0}, 'B. 45° 아래 + → — 오른쪽으로 내려가는 45° (dx 707 · dy −707)'),
        ('down', 'z:1', {'x': 0, 'y': -0.707, 'z': 0.707}, 'B. 45° 아래 + 앞 — 앞으로 내려가는 45°'),
        ('xz', 'x:1', {'x': 0.707, 'y': 0, 'z': 0.707}, 'B. 수평 45° + → — 오른쪽+앞 (높이 그대로)'),
        ('xz', 'z:1', {'x': -0.707, 'y': 0, 'z': 0.707}, 'B. 수평 45° + 앞 — 앞+왼쪽'),
        ('xz', 'x:-1', {'x': -0.707, 'y': 0, 'z': -0.707}, 'B. 수평 45° + ← — 왼쪽+뒤'),
        ('xz', 'z:-1', {'x': 0.707, 'y': 0, 'z': -0.707}, 'B. 수평 45° + 뒤 — 뒤+오른쪽'),
    ]
    for mode, btn, want, label in cases:
        page.evaluate(RESET, {'fit': False})
        page.evaluate('''(m) => {
          const a = window.__app;
          a.setCmdCursor({x:0,y:1,z:0}, true);      // 아래 45°가 바닥에 막히지 않게 1m 위에서
          a.setDiagMode(m);
          a.pending = null;
        }''', mode)
        page.wait_for_timeout(120)
        page.click(f'#dirPad [data-dir="{btn}"]')
        page.wait_for_timeout(120)
        page.fill('#cmdInput', '1000')
        page.click('#cmdRun')
        page.wait_for_timeout(300)
        st = page.evaluate(STATE)
        pts = st['pipes'][-1]['points'] if st['pipes'] else []
        s0, s1 = (pts[0], pts[-1]) if pts else ({'x': 0, 'y': 0, 'z': 0}, {'x': 0, 'y': 0, 'z': 0})
        d = {k: round(s1[k] - s0[k], 3) for k in 'xyz'}
        ok = all(abs(d[k] - want[k]) < 0.006 for k in 'xyz')
        check(label, ok, json.dumps(d, ensure_ascii=False))
    # 내 시점 기준 — 화면 기준 방향이 실제 월드 방향으로 바뀐다
    page.evaluate(RESET, {'fit': False, 'frame': 'me'})
    page.evaluate('''() => {
      const a = window.__app;
      a.setCmdCursor({x:0,y:1,z:0}, true);
      a.setDiagMode('up');
      a.pending = null;
    }''')
    page.wait_for_timeout(120)
    page.click('#dirPad [data-dir="x:1"]')
    page.wait_for_timeout(120)
    page.fill('#cmdInput', '1000')
    page.click('#cmdRun')
    page.wait_for_timeout(300)
    st = page.evaluate(STATE)
    pts = st['pipes'][-1]['points'] if st['pipes'] else []
    d = {k: round(pts[-1][k] - pts[0][k], 3) for k in 'xyz'} if pts else {}
    expect = page.evaluate('''() => {
      const a = window.__app;
      const w = a.dirToWorld('x', 1);
      const c = Math.SQRT1_2;
      return { x: w.axis === 'x' ? w.sign * c : 0, y: c, z: w.axis === 'z' ? w.sign * c : 0 };
    }''')
    ok = all(abs(d.get(k, 0) - expect[k]) < 0.006 for k in 'xyz')
    check('B. 내 시점 기준 — → 가 화면 오른쪽 45°(위)로 그려진다 (dirToWorld와 일치)',
          ok, json.dumps({'d': d, 'want': expect}, ensure_ascii=False))


def run_link(page):
    """D. 🔗 잇기 — 45° 경로 + elbow45 + 절단 길이"""
    g = page.evaluate(LINK, [True, 'end'])
    check('D. 45° ON 🔗 잇기 — 45° 대각선 구간으로 이어진다 (수평=수직 성분)',
          g['diagSegs'] >= 1 and g['angles'] and all(a == 45 for a in g['angles']),
          json.dumps({'diag': g['diagSegs'], 'angles': g['angles']}, ensure_ascii=False))
    check('D. 45° ON 🔗 잇기 — 꺾임에 45° 엘보가 선다',
          len(g['elbows']) >= 1 and all(e['type'] == 'elbow45' for e in g['elbows']),
          json.dumps(g['elbows'], ensure_ascii=False))
    new = g['pipes'][g['basePipes']:]
    newCuts = [c for c in g['cuts'] if c['pipe'] >= g['basePipes']]
    check('D. 45° ON 🔗 잇기 — 엘보 자리를 비운 직관 2개로 나뉜다 (1,437 + 2,058mm)',
          len(new) == 2 and abs(new[0]['mm'] - 1436.5) < 2 and abs(new[1]['mm'] - 2057.7) < 2,
          json.dumps([round(p['mm'], 1) for p in new], ensure_ascii=False))
    check('D. 45° ON 🔗 잇기 — 두 직관 모두 한쪽 끝에 45° 엘보가 물린다',
          len(newCuts) == 2 and all(c['fa'] == '45° 엘보' or c['fb'] == '45° 엘보' for c in newCuts),
          json.dumps(newCuts, ensure_ascii=False))
    check('D. 45° ON 🔗 잇기 — 절단 합 + 엘보값(63.5×2) = 꺾인 중심선 3.621m',
          abs(sum(c['cut'] for c in newCuts) / 1000 + 0.0635 * 2 - 3.621) < 0.02,
          f"절단합 {round(sum(c['cut'] for c in newCuts))}mm")
    check('D. 45° ON 🔗 잇기 — 커서가 대상 배관 끝(3,0,0)에 정확히 선다',
          abs(g['cursor']['x'] - 3) < 0.002 and abs(g['cursor']['z']) < 0.002,
          json.dumps(g['cursor'], ensure_ascii=False))
    g2 = page.evaluate(LINK, [False, 'end'])
    new2 = g2['pipes'][g2['basePipes']:]
    check('D. 45° OFF 🔗 잇기 — 예전처럼 90° 직교 경로 한 배관 (엘보 없음)',
          len(new2) == 1 and not g2['elbows'] and g2['diagSegs'] == 0
          and len(new2[0]['points']) == 3 and abs(new2[0]['mm'] - 4500) < 2,
          json.dumps([p['mm'] for p in g2['pipes']], ensure_ascii=False))


def run_port(page):
    """E. 연결 명령·포트 — 플랜지 접합면에 45°로 꺾어 들어간다"""
    g = page.evaluate(PORT_LINK, True)
    face = {'x': round(g['fl']['x'] - g['fl']['w'] / 2, 3), 'y': g['fl']['y'], 'z': g['fl']['z']}
    e45 = [e for e in g['elbows'] if e['type'] == 'elbow45']
    near = min(e45, key=lambda e: abs(e['x'] - face['x']) + abs(e['z'] - face['z'])) if e45 else None
    gap = None
    if near:
        gap = round(((near['x'] - face['x']) ** 2 + (near['y'] - face['y']) ** 2
                     + (near['z'] - face['z']) ** 2) ** 0.5 * 1000, 1)
    check('E. 45° ON 플랜지 잇기 — 포트 축 스텁 + 45° 엘보로 물린다',
          any(e['type'] == 'elbow45' for e in g['elbows']) and len(g['pipes']) >= 2,
          json.dumps({'elbows': g['elbows'], 'pipes': len(g['pipes'])}, ensure_ascii=False))
    check('E. 45° ON 플랜지 잇기 — 포트 엘보 다리 끝면이 플랜지 면에 정확히 앉는다 (63.5mm)',
          gap is not None and abs(gap - 63.5) <= 0.5,
          json.dumps({'elbow45': near, 'face': face, 'gap': gap}, ensure_ascii=False))
    check('E. 45° ON 플랜지 잇기 — 절단 길이에 45° 엘보·플랜지가 잡힌다',
          any((c['fa'] or c['fb']) for c in g['cuts']), json.dumps(g['cuts'], ensure_ascii=False))
    # 포트가 반대쪽을 보는 경우 — 90° 대체 경로에도 엘보가 선다
    g2 = page.evaluate('''() => {
      const a = window.__app;
      a.clearAll({silent:true});
      a.setFitAuto(true, true);
      a.setCmdBore('100A', true);
      a.setDirFrame('plan', true);
      a.setCmdCursor({x:0,y:0,z:1.2}, true);
      a.setDiag45(true, true);
      const out = a.diag45Path({x:0,y:0,z:1.2}, {x:3,y:0.8,z:0}, {bore:'100A', portAxis:{x:1,y:0,z:0}});
      return { runs: out.runs.length, elbows: out.elbows.map((e) => e.type) };
    }''')
    check('E. 포트가 반대쪽을 봐도 엘보 없이 꺾이지 않는다 (90° 대체 경로 + 엘보)',
          g2['elbows'] and all(t == 'elbow' for t in g2['elbows']),
          json.dumps(g2, ensure_ascii=False))


def run_parser(page):
    """F. 명령 파서"""
    p = page.evaluate(PARSE)
    a = p['45도 오른쪽 1000']['ops']
    check('F. 「45도 오른쪽 1000」 → diag (오른쪽 · 위 45° · 1000mm)',
          len(a) == 1 and a[0]['op'] == 'diag' and a[0]['axis'] == 'x' and a[0]['vert'] == 1
          and abs(a[0]['meters'] - 1) < 1e-6 and not p['45도 오른쪽 1000']['unknown'],
          json.dumps(a, ensure_ascii=False))
    b = p['45도 아래 왼쪽 800']['ops']
    check('F. 「45도 아래 왼쪽 800」 → diag (왼쪽 · 아래 45° · 800mm)',
          len(b) == 1 and b[0]['op'] == 'diag' and b[0]['axis'] == 'x' and b[0]['sign'] == -1
          and b[0]['vert'] == -1 and abs(b[0]['meters'] - 0.8) < 1e-6,
          json.dumps(b, ensure_ascii=False))
    c = p['오프셋 500 오른쪽']['ops']
    check('F. 「오프셋 500 오른쪽」 → offset45 (오른쪽 · 빗변 707.1mm)',
          len(c) == 1 and c[0]['op'] == 'offset45' and c[0]['axis'] == 'x'
          and abs(c[0]['offset'] - 0.5) < 1e-6 and abs(c[0]['meters'] - 0.7071) < 0.002,
          json.dumps(c, ensure_ascii=False))
    d = p['오른쪽 1000']['ops']
    check('F. 「오른쪽 1000」 → seg (45°가 붙지 않은 명령은 직각)',
          len(d) == 1 and d[0]['op'] == 'seg' and d[0]['axis'] == 'x', json.dumps(d, ensure_ascii=False))
    e = p['45도 위 1000']['ops']
    check('F. 「45도 위 1000」 → diag (수평 방향은 지금 방향)',
          len(e) == 1 and e[0]['op'] == 'diag' and e[0]['axis'] is None and e[0]['vert'] == 1,
          json.dumps(e, ensure_ascii=False))
    # 실제 실행 — 45°가 켜져 있어도 일반 직각 명령은 대각선이 아니다
    g = page.evaluate(CMD_RUN, ['오른쪽 1000', True])
    check('F. 45° ON 상태에서 「오른쪽 1000」은 대각선이 아니라 직각 1000mm',
          g['d'] and abs(g['d']['y']) < 1e-6 and abs(g['d']['x'] - 1) < 0.002,
          json.dumps(g['d'], ensure_ascii=False))
    g2 = page.evaluate(CMD_RUN, ['45도 오른쪽 1000', False])
    check('F. 45°를 꺼 둬도 「45도 오른쪽 1000」처럼 각도를 직접 말하면 45°로 그린다',
          g2['d'] and abs(g2['d']['y'] - 0.707) < 0.004 and abs(g2['d']['x'] - 0.707) < 0.004,
          json.dumps(g2['d'], ensure_ascii=False))
    # 45° OFF 방어 — 남아 있던 대각선 pending으로도 대각선을 그리지 않는다
    o = page.evaluate(OFF_DEF)
    check('F. 45° OFF 방어 — 남아 있던 45° 대각선 pending도 직각으로 그린다',
          o['p1']['dy'] is not None and o['p1']['dy'] < 1e-6, json.dumps(o['p1'], ensure_ascii=False))
    check('F. 45° OFF 방어 — 수평 45° pending도 대각선을 그리지 않는다 (z 변화 0)',
          o['p2']['d'] is not None and abs(o['p2']['d']['z']) < 1e-6, json.dumps(o['p2'], ensure_ascii=False))


def run_regression(page):
    """G. v84 회귀"""
    g = page.evaluate(REGRESSION)
    check('G. 회귀 — 45° 엘보 face 100A 63.5 · 200A 127.0mm',
          abs(g['face45'] - 0.0635) < 1e-6 and abs(g['face45_200'] - 0.127) < 1e-6,
          json.dumps({'100A': g['face45'], '200A': g['face45_200']}))
    check('G. 회귀 — 45° 오프셋 500 계산 (빗변 707.1 · 절단 580.1 · 엘보 63.5)',
          abs(g['off']['hyp'] - 707.1) < 0.15 and abs(g['off']['cut'] - 580.1) < 0.2
          and abs(g['off']['B'] - 63.5) < 0.05, json.dumps(g['off']))
    check('G. 회귀(v78) — 플랜지 끝 100mm는 그대로, 90° 엘보 face 228.6mm',
          g['shortOk'] and g['e90'] is not None and abs(g['e90'] - 0.2286) < 0.0003,
          json.dumps({'lens': g['lens'], 'e90': g['e90']}, ensure_ascii=False))
    s = g['sample']
    check('G. 회귀 — 샘플 씬이 그대로 열린다 (배관·장비·메시)',
          s['pipes'] > 3 and s['equips'] > 3 and s['meshes'] > 5, json.dumps(s, ensure_ascii=False))


def run_mobile(browser):
    """H. 모바일 390×844"""
    errs = []
    page = new_page(browser, {'width': 390, 'height': 844}, True, errs)
    page.evaluate(RESET, {})
    page.wait_for_timeout(150)
    page.click('#pad45')
    page.wait_for_timeout(250)
    m = page.evaluate(PAD_UI)
    check('H. 모바일 390 — 45° 줄이 조이스틱 안에 들어온다 (넘침 0.5px 이내)',
          m['overflow'] <= 0.5, json.dumps({'overflow': m['overflow'], 'pad': m['pad']}, ensure_ascii=False))
    check('H. 모바일 390 — 조이스틱이 화면 안에 있고 가로 스크롤이 없다',
          m['pad']['l'] >= -0.5 and m['pad']['r'] <= m['vw'] + 0.5
          and m['pad']['b'] <= m['vh'] + 0.5 and m['scrollW'] <= m['vw'],
          json.dumps({'pad': m['pad'], 'vw': m['vw'], 'scrollW': m['scrollW']}, ensure_ascii=False))
    page.click('#padDiagRow [data-diag="xz"]')
    page.wait_for_timeout(200)
    m2 = page.evaluate(PAD_UI)
    check('H. 모바일 390 — 수평 45° 글자(↙ ↗ ↖ ↘)도 잘리지 않는다',
          m2['labels'] == ['↙', '↑', '↗', '↖', '↓', '↘'] and m2['overflow'] <= 0.5,
          json.dumps({'labels': m2['labels'], 'overflow': m2['overflow']}, ensure_ascii=False))
    # 미리보기 ① — 모바일 45° 조이스틱 (45° ON · 수평 45° 선택 · → 대각선 글자)
    page.evaluate('''() => {
      const a = window.__app;
      a.setDiagMode('xz');
      a.pending = { op: 'diagxz', axis: 'x', sign: 1 };
      a.highlightPad();
    }''')
    page.wait_for_timeout(400)
    page.screenshot(path=os.path.join(ROOT, 'preview-v85-pad.png'))
    js = page.evaluate('() => window.__errors.slice()')
    check('K. 콘솔 오류 0건 (모바일)', not errs and not js, '; '.join((errs + js)[:3]))
    page.close()


def main():
    live = '--live' in sys.argv
    os.makedirs(TMP, exist_ok=True)
    srv = None
    if not live:
        srv = Quiet(('127.0.0.1', PORT), functools.partial(Handler, directory=ROOT))
        threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            errs = []
            page = new_page(b, {'width': 1440, 'height': 900}, False, errs)
            on = run_pad_ui(page)
            run_off(page)
            run_dirs(page)
            run_link(page)
            run_port(page)
            run_parser(page)
            run_regression(page)
            js = page.evaluate('() => window.__errors.slice()')
            check('K. 콘솔 오류 0건 (데스크톱)', not errs and not js, '; '.join((errs + js)[:3]))

            # 미리보기 ① — 45° 조이스틱 (45° ON · 수평 45° 선택) : 모바일 화면에서 따로 찍는다

            # 미리보기 ② — 45° 자동 잇기 (플랜지 포트로 45° 진입)
            page.evaluate('''() => {
              const a = window.__app;
              a.clearAll({ silent: true });
              a.pending = null;
              a.setFitAuto(true, true);
              a.setCmdBore('100A', true);
              a.setDirFrame('plan', true);
              a.setCmdCursor({ x: 0, y: 0, z: 0 }, true);
              a.setDiag45(true, true);
              a.execOps([{ op: 'seg', world: true, axis: 'x', sign: 1, meters: 3 }], { source: 'cmd' });
              a.setCmdCursor({ x: 3, y: 0, z: 0 }, true);
              a.addFittingAtCursor('flange');
              const fl = a.state.equipment.find((e) => e.type === 'flange');
              a.setCmdCursor({ x: 0, y: 0, z: 1.5 }, true);
              const face = { x: fl.x + fl.w / 2, y: fl.y, z: fl.z };
              const V = a.camera.position.constructor;
              const v = new V(face.x, face.y, face.z).project(a.camera);
              const r = a.renderer.domElement.getBoundingClientRect();
              a.setLinkMode(true);
              a.tryLinkAt({ clientX: r.left + (v.x * 0.5 + 0.5) * r.width,
                            clientY: r.top + (-v.y * 0.5 + 0.5) * r.height });
              a.setDims(true);
              a.clearSelection();
              a.rebuild();
              a.setDrawerOpen(false);
              a.camAnim = null;
              a.camera.position.set(4.3, 2.2, 3.9);
              a.controls.target.set(1.55, 0.15, 0.78);
              a.controls.update();
            }''')
            page.wait_for_timeout(900)
            page.screenshot(path=os.path.join(ROOT, 'preview-v85-45link.png'))
            page.close()
            run_mobile(b)
            b.close()
    finally:
        if srv:
            srv.shutdown()

    ok = sum(1 for _, passed, _ in results if passed)
    print(f'\n{ok}/{len(results)} PASS')
    fails = [n for n, passed, _ in results if not passed]
    if fails:
        print('FAIL: ' + ' · '.join(fails))
    sys.exit(0 if not fails else 1)


if __name__ == '__main__':
    main()
