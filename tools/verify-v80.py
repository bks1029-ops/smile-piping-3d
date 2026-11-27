#!/usr/bin/env python3
"""v80 검증 — 390×844 모바일 뷰포트 실브라우저.

사용자 제보(2026-11-27 캡처 `32288`):
  "엘보를 선택하려는데 가까이 있는건 선택안되고 보이지도 않는 멀리있는게 선택되"
  (토스트: 📍 접합면 노즐 80A에서 이어 그립니다 …)

원인 — handleCanvasTap 이 ray.intersectObjects(...) **보다 먼저** nozzlePickAt(ev, 32) 을 돌렸고,
nozzlePickAt 은 장비 접속구(노즐 끝·플랜지 접합면)를 화면 2D 로만 투영해 32px 안에서 가장 가까운
것을 골랐다. 카메라 거리·가림을 보지 않아, 눈앞의 엘보를 눌러도 그 뒤(더 먼) 장비의 접합면이
화면에서 몇 픽셀 가깝다는 이유로 탭을 가져갔다.

v80 — ① 손가락이 실제로 맞은 앞쪽 물체(firstHit)를 먼저 구하고 ② 그보다 뒤에 있는 노즐은 제외
    ③ 그 노즐 끝이 다른 장비·배관에 가려져 있으면 제외 ④ 남은 후보가 여럿이면 화면 거리가
    비슷할 때(8px) 카메라에 가까운 쪽을 고른다. nearestPick(작은 부속 32px 보정)도 같은 규칙.

검사 항목
 ① 앞쪽 엘보 + 뒤쪽 밸브 접합면 — 예전 방식(oldPick)은 밸브를 골랐다(버그 재현 확인)
 ② 같은 탭 — 실제 탭은 앞쪽 엘보를 고른다(노즐 토스트 없음)
 ③ 뒤쪽 탱크 노즐 — 예전 방식은 노즐을 골랐고, 실제 탭은 앞쪽 엘보를 고른다
 ④ 앞쪽 배관 + 뒤쪽 밸브 접합면 — 실제 탭은 배관을 고른다
 ⑤ 가리지 않은 밸브 접합면을 직접 탭 — 그대로 그 접합면에서 이어 그리기(selectNozzle)
 ⑥ 가리지 않은 탱크 노즐 목을 직접 탭 — 그대로 노즐에서 이어 그리기(selectNozzle)
 ⑦ nearestPick — 화면 거리가 비슷하면 카메라에 가까운 쪽, 차이가 크면 화면이 가까운 쪽
 ⑧ 콘솔 오류 0건
"""
import json
import math
import os
import subprocess
import sys
import time
from playwright.sync_api import sync_playwright

PORT = 8780
ROOT = '/workspace/projects/smile-piping-3d'
LIVE = 'https://bks1029-ops.github.io/smile-piping-3d/'
BASE = LIVE if '--live' in sys.argv else f'http://127.0.0.1:{PORT}/'
results = []


def check(name, ok, detail=''):
    results.append((name, bool(ok), detail))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''))


# ── 페이지 안 도우미 ────────────────────────────────────────────────────
LOAD = '''async () => {
  window.__S = await import('./js/store.js?v=80');
  return true;
}'''

# 공통 도우미 — 화면 투영 · 실제 첫 픽 · 예전(v79) 방식 재현 · 탭 전 준비
HELPERS = '''() => {
  const a = window.__app, S = window.__S;
  const V = a.camera.position.constructor;
  const rect = () => a.renderer.domElement.getBoundingClientRect();
  // 토스트 기록 — 노즐 터치가 탭을 가져갔는지(📍 … 이어 그립니다) 확인용
  if (!a.__toasts) {
    a.__toasts = [];
    a.__toastOrig = a.toast.bind(a);
    a.toast = (msg, opts) => { a.__toasts.push(String(msg)); return a.__toastOrig(msg, opts); };
  }
  window.__T = {
    proj(p) {
      const r = rect();
      const v = new V(p.x, p.y, p.z).project(a.camera);
      return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height, z: v.z };
    },
    firstPick(px, py) {
      const ray = a.raycastAt({ clientX: px, clientY: py });
      const hits = ray.intersectObjects(a.root.children, true);
      for (const h of hits) {
        let o = h.object;
        while (o && o !== a.root) {
          if (o.userData && o.userData.pick) {
            return { kind: o.userData.pick.kind, id: o.userData.pick.id, distance: h.distance };
          }
          o = o.parent;
        }
      }
      return null;
    },
    // 예전 v79 방식 — 화면 32px + 본체 중심 비교만 (거리·가림 없음). 버그 재현 확인용.
    oldPick(px, py, radius) {
      const r = rect();
      const qx = px - r.left, qy = py - r.top;
      let best = null;
      a.state.equipment.forEach((e) => {
        const list = S.equipPorts(e);
        if (!list.length) return;
        const body = this.proj({ x: e.x, y: (e.y || 0) + Math.min(0.4, (e.h || 0.3) * 0.5), z: e.z });
        if (body.z > 1 || body.z < -1) return;
        const bodyD = Math.hypot(body.x - r.left - qx, body.y - r.top - qy);
        list.forEach((n) => {
          const s = this.proj(n.tip);
          if (s.z > 1 || s.z < -1) return;
          const d = Math.hypot(s.x - r.left - qx, s.y - r.top - qy);
          if (d > radius || d >= bodyD) return;
          if (!best || d < best.d) {
            best = { kind: 'equipment', id: e.id, d, label: n.label || n.dir || null,
                     tip: [n.tip.x, n.tip.y, n.tip.z] };
          }
        });
      });
      return best;
    },
    // 탭 직전 정리 — 열려 있는 속성 창·서랍은 첫 탭을 먹으므로 닫아 둔다.
    prepTap() {
      a.clearSelection();
      const props = document.querySelector('#props');
      if (props) props.hidden = true;
      a.setDrawerOpen(false);
      a.__toasts.length = 0;
      return true;
    },
    state() {
      const c = a.cmdCursor;
      return { sel: a.selection, toasts: a.__toasts.slice(), cursor: { x: c.x, y: c.y, z: c.z } };
    },
  };
  return true;
}'''

SETUP = '''([cfg]) => {
  const a = window.__app, S = window.__S;
  a.clearAll({ silent: true });
  a.camAnim = null;
  document.querySelector('#props').hidden = true;
  a.camera.position.set(cfg.cam[0], cfg.cam[1], cfg.cam[2]);
  a.controls.target.set(cfg.look[0], cfg.look[1], cfg.look[2]);
  a.controls.update();
  a.camera.updateMatrixWorld(true);
  const out = {};
  (cfg.equip || []).forEach((spec) => {
    const e = S.makeEquipment(spec.type, spec);
    a.state.equipment.push(e);
    out[spec.key] = e.id;
  });
  (cfg.pipes || []).forEach((spec) => {
    const p = S.makePipe(spec);
    a.state.pipes.push(p);
    out[spec.key] = p.id;
  });
  a.rebuild();
  return out;
}'''

# 그 물체가 실제로 앞에서 맞는 픽셀 — 중심에 가까운 것부터 훑는다.
FIND_PIXEL = '''([kind, id, maxR]) => {
  const a = window.__app, T = window.__T;
  const list = kind === 'pipe' ? a.state.pipes : a.state.equipment;
  const e = list.find((q) => q.id === id);
  const mid = kind === 'pipe'
    ? { x: (e.points[0].x + e.points[e.points.length - 1].x) / 2,
        y: (e.points[0].y + e.points[e.points.length - 1].y) / 2,
        z: (e.points[0].z + e.points[e.points.length - 1].z) / 2 }
    : { x: e.x, y: (e.y || 0) + (e.h || 0.3) * 0.35, z: e.z };
  const c = T.proj(mid);
  const r = a.renderer.domElement.getBoundingClientRect();
  for (let rad = 0; rad <= maxR; rad += 1) {
    const n = Math.max(1, Math.round(2 * Math.PI * rad / 4));
    for (let k = 0; k < n; k += 1) {
      const ang = (k / n) * Math.PI * 2;
      const px = c.x + rad * Math.cos(ang), py = c.y + rad * Math.sin(ang);
      if (px < r.left + 3 || px > r.right - 3 || py < r.top + 3 || py > r.bottom - 3) continue;
      const hit = T.firstPick(px, py);
      if (hit && hit.kind === kind && hit.id === id) return { x: px, y: py, r: rad, hit };
    }
  }
  return null;
}'''

# 기준 픽셀(뒤쪽 접속구 끝)에서 maxR px 안에서 그 물체가 실제로 맞는 픽셀을 찾는다.
FIND_NEAR = '''([kind, id, rx, ry, maxR]) => {
  const a = window.__app, T = window.__T;
  const r = a.renderer.domElement.getBoundingClientRect();
  for (let rad = 0; rad <= maxR; rad += 1) {
    const n = Math.max(1, Math.round(2 * Math.PI * rad / 2));
    for (let k = 0; k < n; k += 1) {
      const ang = (k / n) * Math.PI * 2;
      const px = rx + rad * Math.cos(ang), py = ry + rad * Math.sin(ang);
      if (px < r.left + 3 || px > r.right - 3 || py < r.top + 3 || py > r.bottom - 3) continue;
      const hit = T.firstPick(px, py);
      if (hit && hit.kind === kind && hit.id === id) return { x: px, y: py, r: rad, hit };
    }
  }
  return null;
}'''

# 뒤쪽 장비를 움직여, 그 접속구 끝(portKey)이 목표 픽셀에 오도록 맞춘다.
PLACE_TIP = '''([id, portKey, tx, ty]) => {
  const a = window.__app, S = window.__S;
  const V = a.camera.position.constructor;
  const e = a.state.equipment.find((q) => q.id === id);
  const port = () => S.equipPorts(e).find((n) => (n.nid || n.dir) === portKey);
  const r = a.renderer.domElement.getBoundingClientRect();
  let err = null;
  for (let i = 0; i < 16; i += 1) {
    a.camera.updateMatrixWorld(true);
    const n = port();
    const v = new V(n.tip.x, n.tip.y, n.tip.z).project(a.camera);
    const sx = r.left + (v.x * 0.5 + 0.5) * r.width;
    const sy = r.top + (-v.y * 0.5 + 0.5) * r.height;
    err = { x: tx - sx, y: ty - sy };
    if (Math.abs(err.x) < 0.6 && Math.abs(err.y) < 0.6) break;
    const dist = a.camera.position.distanceTo(new V(n.tip.x, n.tip.y, n.tip.z));
    const hh = dist * Math.tan(a.camera.fov * Math.PI / 360);
    const hw = hh * a.camera.aspect;
    const right = new V().setFromMatrixColumn(a.camera.matrixWorld, 0);
    const up = new V().setFromMatrixColumn(a.camera.matrixWorld, 1);
    const shift = right.multiplyScalar((err.x / r.width) * 2 * hw)
      .add(up.multiplyScalar(-(err.y / r.height) * 2 * hh));
    e.x += shift.x; e.y = Math.max(0, e.y + shift.y); e.z += shift.z;
    a.rebuild();
    a.camera.updateMatrixWorld(true);
  }
  const n = port();
  return { err, pos: { x: e.x, y: e.y, z: e.z }, tip: { x: n.tip.x, y: n.tip.y, z: n.tip.z } };
}'''

# 탭 한 자리의 판정 요약 — 실제 첫 픽 · 예전 방식 · 새 방식(nozzlePickAt 직접 호출)
PROBE = '''([px, py, radius]) => {
  const a = window.__app, T = window.__T;
  const hit = T.firstPick(px, py);
  const old = T.oldPick(px, py, radius);
  const noz = a.nozzlePickAt({ clientX: px, clientY: py }, radius, hit);
  return {
    hit: hit ? { kind: hit.kind, id: hit.id, distance: +hit.distance.toFixed(3) } : null,
    old: old ? { id: old.id, d: +old.d.toFixed(1), label: old.label, tip: old.tip } : null,
    newNoz: noz ? { id: noz.id, d: +noz.d.toFixed(1), camDist: +noz.camDist.toFixed(2) } : null,
  };
}'''

PREP = '''() => {
  const a = window.__app;
  const el = document.querySelector('#toastHost');
  if (el) el.style.display = 'none';
  const props = document.querySelector('#props');
  if (props) props.hidden = true;
  a.setDrawerOpen(false);
  a.setDims(false);
}'''


def tap(page, px, py):
    page.evaluate('() => window.__T.prepTap()')
    page.mouse.click(px, py)
    page.wait_for_timeout(260)
    return page.evaluate('() => window.__T.state()')


def is_nozzle_toast(toasts):
    return any(('이어 그립니다' in t and '📍' in t) for t in toasts)


def main():
    live = '--live' in sys.argv
    srv = None if live else subprocess.Popen(
        [sys.executable, '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'],
        cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.2 if srv else 0)
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            page = b.new_page(viewport={'width': 390, 'height': 844}, device_scale_factor=2,
                              is_mobile=True, has_touch=True)
            errs = []
            page.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
            page.on('pageerror', lambda e: errs.append(str(e)))
            page.goto(BASE + '?v=80', wait_until='networkidle')
            page.wait_for_function('window.__app && window.__app.state', timeout=20000)
            page.wait_for_timeout(700)
            page.evaluate(LOAD)
            page.evaluate(HELPERS)

            # ── ①② 앞쪽 엘보 + 뒤쪽 밸브 접합면 (사용자 캡처와 같은 구도) ──────────
            ids = page.evaluate(SETUP, [{
                'cam': [2.4, 2.9, 6.6], 'look': [0, 0.95, 0.2],
                'equip': [
                    {'key': 'fg', 'type': 'elbow', 'x': 0, 'y': 1.0, 'z': 2.0,
                     'bore': '80A', 'inDir': [1, 0, 0], 'outDir': [0, 1, 0], 'rot': 0},
                    {'key': 'bg', 'type': 'valve', 'x': -0.4, 'y': 1.0, 'z': -3.2,
                     'bore': '80A', 'axis': 'z', 'rot': 0},
                ],
            }])
            page.wait_for_timeout(300)
            fg_px = page.evaluate(FIND_PIXEL, ['equipment', ids['fg'], 60])
            print('엘보 픽셀:', fg_px)
            check('① 준비 — 앞쪽 엘보가 실제로 맞는 픽셀을 찾음', bool(fg_px),
                  json.dumps(fg_px, ensure_ascii=False) if fg_px else 'none')
            placed = None
            old = None
            if fg_px:
                # 뒤쪽 밸브의 접합면(faceB)이 엘보 탭 픽셀에서 12px 옆에 오게 놓는다.
                placed = page.evaluate(PLACE_TIP, [ids['bg'], 'faceB',
                                                   fg_px['x'] + 12, fg_px['y'] - 4])
                print('뒤쪽 밸브 배치:', placed)
                pr = page.evaluate(PROBE, [fg_px['x'], fg_px['y'], 32])
                print('탭 판정:', json.dumps(pr, ensure_ascii=False))
                old = pr['old']
                check('① 버그 재현 — 예전 방식은 뒤쪽 밸브 접합면을 골랐다',
                      bool(old) and old['id'] == ids['bg'],
                      f'예전 픽 {old} · 뒤쪽 밸브 {ids["bg"]}')
                check('② 실제 첫 픽은 앞쪽 엘보', pr['hit'] and pr['hit']['kind'] == 'equipment'
                      and pr['hit']['id'] == ids['fg'], json.dumps(pr['hit'], ensure_ascii=False))
                check('② 새 nozzlePickAt 은 탭을 가져가지 않음(가려진 접합면)', pr['newNoz'] is None,
                      json.dumps(pr['newNoz'], ensure_ascii=False))
                st = tap(page, fg_px['x'], fg_px['y'])
                check('② 실제 탭 → 앞쪽 엘보 선택', st['sel'] and st['sel']['kind'] == 'equipment'
                      and st['sel']['id'] == ids['fg'],
                      f'선택 {st["sel"]} · 토스트 {st["toasts"]}')
                check('② 노즐 이어그리기 토스트가 뜨지 않음', not is_nozzle_toast(st['toasts']),
                      json.dumps(st['toasts'], ensure_ascii=False))

            # ── ③ 뒤쪽 탱크 노즐 ────────────────────────────────────────────────
            # 탱크 왼쪽 노즐은 바닥에서 0.495m — 카메라를 거의 수평으로 두어 그 높이에
            # 엘보 뒤로 놓을 수 있게 한다(비스듬히 내려보면 그 뒤 높이가 바닥 밑으로 간다).
            ids3 = page.evaluate(SETUP, [{
                'cam': [2.2, 1.35, 6.6], 'look': [0, 1.0, 0.1],
                'equip': [
                    {'key': 'fg', 'type': 'elbow', 'x': 0, 'y': 0.9, 'z': 2.0,
                     'bore': '80A', 'inDir': [1, 0, 0], 'outDir': [0, 1, 0], 'rot': 0},
                    {'key': 'bg', 'type': 'tank', 'x': -0.9, 'y': 0.2, 'z': -3.4},
                ],
            }])
            page.wait_for_timeout(300)
            fg3 = page.evaluate(FIND_PIXEL, ['equipment', ids3['fg'], 60])
            check('③ 준비 — 앞쪽 엘보 픽셀', bool(fg3), json.dumps(fg3, ensure_ascii=False) if fg3 else 'none')
            if fg3:
                # 탱크 노즐 끝을 엘보 픽셀 쪽으로 놓고, 그 끝에서 32px 안에 있는 엘보 픽셀을 탭한다.
                pl3 = page.evaluate(PLACE_TIP, [ids3['bg'], 'n2', fg3['x'], fg3['y']])
                print('뒤쪽 탱크 배치:', pl3)
                tipPx3 = page.evaluate('''([id, key]) => {
                  const a = window.__app, S = window.__S, T = window.__T;
                  const e = a.state.equipment.find((q) => q.id === id);
                  const n = S.equipPorts(e).find((q) => (q.nid || q.dir) === key);
                  const s = T.proj(n.tip);
                  return { x: s.x, y: s.y, tip: { x: n.tip.x, y: n.tip.y, z: n.tip.z } };
                }''', [ids3['bg'], 'n2'])
                tap3 = page.evaluate(FIND_NEAR, ['equipment', ids3['fg'], tipPx3['x'], tipPx3['y'], 31])
                check('③ 준비 — 뒤쪽 탱크 노즐 끝 32px 안에 앞쪽 엘보 픽셀이 있음',
                      bool(tap3) and tap3['r'] <= 31,
                      json.dumps(tap3, ensure_ascii=False) if tap3 else 'none')
                if tap3:
                    pr3 = page.evaluate(PROBE, [tap3['x'], tap3['y'], 32])
                    print('탭 판정:', json.dumps(pr3, ensure_ascii=False))
                    check('③ 버그 재현 — 예전 방식은 뒤쪽 탱크 노즐을 골랐다',
                          bool(pr3['old']) and pr3['old']['id'] == ids3['bg'],
                          f'예전 픽 {pr3["old"]} · 노즐끝까지 {tap3["r"]}px')
                    st3 = tap(page, tap3['x'], tap3['y'])
                    check('③ 실제 탭 → 앞쪽 엘보 선택(뒤쪽 탱크 노즐 아님)',
                          st3['sel'] and st3['sel']['id'] == ids3['fg'] and not is_nozzle_toast(st3['toasts']),
                          f'선택 {st3["sel"]} · 토스트 {st3["toasts"]}')

            # ── ④ 앞쪽 배관 + 뒤쪽 밸브 접합면 ──────────────────────────────────
            ids4 = page.evaluate(SETUP, [{
                'cam': [2.4, 2.2, 6.4], 'look': [0, 0.6, 0.2],
                'pipes': [
                    {'key': 'fg', 'name': 'P-1', 'bore': '80A', 'material': 'carbon', 'conn': 'flange',
                     'points': [{'x': -1.6, 'y': 0.55, 'z': 1.4}, {'x': 1.6, 'y': 0.55, 'z': 1.4}]},
                ],
                'equip': [
                    {'key': 'bg', 'type': 'valve', 'x': 0.2, 'y': 0.55, 'z': -3.0,
                     'bore': '80A', 'axis': 'z', 'rot': 0},
                ],
            }])
            page.wait_for_timeout(300)
            fg4 = page.evaluate(FIND_PIXEL, ['pipe', ids4['fg'], 60])
            check('④ 준비 — 앞쪽 배관이 실제로 맞는 픽셀', bool(fg4),
                  json.dumps(fg4, ensure_ascii=False) if fg4 else 'none')
            if fg4:
                page.evaluate(PLACE_TIP, [ids4['bg'], 'faceB', fg4['x'] + 10, fg4['y'] + 8])
                pr4 = page.evaluate(PROBE, [fg4['x'], fg4['y'], 32])
                print('탭 판정:', json.dumps(pr4, ensure_ascii=False))
                check('④ 버그 재현 — 예전 방식은 뒤쪽 밸브 접합면을 골랐다',
                      bool(pr4['old']) and pr4['old']['id'] == ids4['bg'], f'예전 픽 {pr4["old"]}')
                st4 = tap(page, fg4['x'], fg4['y'])
                check('④ 실제 탭 → 앞쪽 배관 선택(뒤쪽 접합면 아님)',
                      st4['sel'] and st4['sel']['kind'] == 'pipe' and st4['sel']['id'] == ids4['fg']
                      and not is_nozzle_toast(st4['toasts']),
                      f'선택 {st4["sel"]} · 토스트 {st4["toasts"]}')

            # ── ⑤ 가리지 않은 밸브 접합면 — 그대로 이어 그리기 ──────────────────
            ids5 = page.evaluate(SETUP, [{
                'cam': [1.6, 1.8, 4.6], 'look': [0, 0.7, 0],
                'equip': [
                    {'key': 'v', 'type': 'valve', 'x': 0, 'y': 0.7, 'z': 0,
                     'bore': '80A', 'axis': 'z', 'rot': 0},
                ],
            }])
            page.wait_for_timeout(300)
            page.evaluate(PREP)
            tip5 = page.evaluate('''([id]) => {
              const a = window.__app, S = window.__S, T = window.__T;
              const e = a.state.equipment.find((q) => q.id === id);
              const n = S.equipPorts(e).find((q) => q.nid === 'faceB');
              const s = T.proj(n.tip);
              return { tip: n.tip, px: s.x, py: s.y };
            }''', [ids5['v']])
            st5 = tap(page, tip5['px'], tip5['py'])
            cursor5 = st5['cursor']
            gap5 = math.sqrt(sum((cursor5[k] - tip5['tip'][k]) ** 2 for k in ('x', 'y', 'z')))
            check('⑤ 밸브 접합면 직접 탭 → 그 접합면에서 이어 그리기',
                  st5['sel'] and st5['sel']['id'] == ids5['v'] and is_nozzle_toast(st5['toasts'])
                  and gap5 <= 0.001,
                  f'선택 {st5["sel"]} · 커서-접합면 {gap5*1000:.1f}mm · 토스트 {st5["toasts"]}')

            # ── ⑥ 가리지 않은 탱크 노즐 목 — 그대로 이어 그리기 ──────────────────
            ids6 = page.evaluate(SETUP, [{
                'cam': [1.9, 1.7, 3.9], 'look': [0, 0.55, 0],
                'equip': [
                    {'key': 't', 'type': 'tank', 'x': 0, 'y': 0, 'z': 0},
                ],
            }])
            page.wait_for_timeout(300)
            page.evaluate(PREP)
            neck6 = page.evaluate('''([id]) => {
              const a = window.__app, S = window.__S, T = window.__T;
              const e = a.state.equipment.find((q) => q.id === id);
              const n = S.equipPorts(e).find((q) => (q.nid || q.dir) === 'n2');
              // 목 중간(외벽~플랜지 사이)을 손가락으로 누른 셈
              const mid = { x: n.base.x + (n.tip.x - n.base.x) * 0.55,
                            y: n.base.y + (n.tip.y - n.base.y) * 0.55,
                            z: n.base.z + (n.tip.z - n.base.z) * 0.55 };
              const s = T.proj(mid);
              return { tip: n.tip, mid, px: s.x, py: s.y };
            }''', [ids6['t']])
            st6 = tap(page, neck6['px'], neck6['py'])
            c6 = st6['cursor']
            gap6 = math.sqrt(sum((c6[k] - neck6['tip'][k]) ** 2 for k in ('x', 'y', 'z')))
            check('⑥ 탱크 노즐 목 직접 탭 → 그 노즐에서 이어 그리기',
                  st6['sel'] and st6['sel']['id'] == ids6['t'] and is_nozzle_toast(st6['toasts'])
                  and gap6 <= 0.001,
                  f'선택 {st6["sel"]} · 커서-노즐끝 {gap6*1000:.1f}mm · 토스트 {st6["toasts"]}')

            # ── ⑦ nearestPick — 화면 거리가 비슷하면 앞(카메라에 가까운) 쪽 ──────
            tie = page.evaluate('''() => {
              const a = window.__app, S = window.__S, T = window.__T;
              const V = a.camera.position.constructor;
              a.clearAll({ silent: true });
              a.camAnim = null;
              a.camera.position.set(0, 1.7, 7.0);
              a.controls.target.set(0, 0.9, 0);
              a.controls.update();
              a.camera.updateMatrixWorld(true);
              const near = S.makeEquipment('valve', { x: 0, y: 0.9, z: 2.0, bore: '80A', axis: 'x', rot: 0 });
              const far = S.makeEquipment('valve', { x: 0, y: 0.9, z: -3.0, bore: '80A', axis: 'x', rot: 0 });
              a.state.equipment.push(near, far);
              a.rebuild();
              const bodyOf = (e) => ({ x: e.x, y: (e.y || 0) + Math.min(0.4, (e.h || 0.3) * 0.5), z: e.z });
              const r = a.renderer.domElement.getBoundingClientRect();
              // 가까운 밸브를 화면 기준으로 조금씩 옮겨, 본체 중심이 '먼 쪽 + offset px' 에 오게 맞춘다.
              const aimAt = (offPx) => {
                for (let i = 0; i < 14; i += 1) {
                  a.camera.updateMatrixWorld(true);
                  const pf = T.proj(bodyOf(far));
                  const pn = T.proj(bodyOf(near));
                  const ex = (pf.x + offPx) - pn.x, ey = pf.y - pn.y;
                  if (Math.abs(ex) < 0.25 && Math.abs(ey) < 0.25) break;
                  const dist = a.camera.position.distanceTo(new V(near.x, near.y, near.z));
                  const hh = dist * Math.tan(a.camera.fov * Math.PI / 360);
                  const hw = hh * a.camera.aspect;
                  const right = new V().setFromMatrixColumn(a.camera.matrixWorld, 0);
                  const up = new V().setFromMatrixColumn(a.camera.matrixWorld, 1);
                  const shift = right.multiplyScalar((ex / r.width) * 2 * hw)
                    .add(up.multiplyScalar(-(ey / r.height) * 2 * hh));
                  near.x += shift.x; near.y += shift.y; near.z += shift.z;
                  a.rebuild();
                }
                a.camera.updateMatrixWorld(true);
                const pf = T.proj(bodyOf(far));
                const pn = T.proj(bodyOf(near));
                return { pf, pn };
              };
              const out = {};
              // ① 가까운 쪽 본체 중심을 7px 옆에, 탭은 먼 쪽 중심 + 5px — 화면 차이 2px.
              let p = aimAt(7);
              let qx = p.pf.x + 5, qy = p.pf.y;
              out.nearD = Math.hypot(p.pn.x - qx, p.pn.y - qy);
              out.farD = Math.hypot(p.pf.x - qx, p.pf.y - qy);
              const g1 = a.nearestPick({ clientX: qx, clientY: qy }, 32);
              out.tie = g1 ? g1.id : null;
              out.tieWant = near.id;
              // ② 가까운 쪽을 22px 옆에 — 이번엔 먼 쪽을 정확히 짚은 셈이라 먼 쪽이 맞다.
              p = aimAt(22);
              qx = p.pf.x + 5; qy = p.pf.y;
              out.nearD2 = Math.hypot(p.pn.x - qx, p.pn.y - qy);
              out.farD2 = Math.hypot(p.pf.x - qx, p.pf.y - qy);
              const g2 = a.nearestPick({ clientX: qx, clientY: qy }, 32);
              out.clear = g2 ? g2.id : null;
              out.clearWant = (out.farD2 < out.nearD2 - 8) ? far.id : near.id;
              out.ids = { near: near.id, far: far.id };
              return out;
            }''')
            print('nearestPick:', json.dumps(tie, ensure_ascii=False))
            check('⑦ 화면 2px 차이면 카메라에 가까운 밸브가 이긴다',
                  tie['tie'] == tie['tieWant'], f'화면거리 near {tie["nearD"]:.1f}px · '
                  f'far {tie["farD"]:.1f}px → {tie["tie"]}')
            check('⑦ 화면 차이가 확실하면(> 8px) 짚은 쪽(먼 쪽)이 그대로',
                  tie['clear'] == tie['clearWant'],
                  f'화면거리 near {tie["nearD2"]:.1f}px · far {tie["farD2"]:.1f}px → {tie["clear"]}')

            # ── 미리보기 — 앞쪽 엘보를 탭해 선택한 장면(뒤쪽 밸브 접합면이 32px 안에 있는 구도) ──
            # 뒤쪽 밸브는 x·y 만 옮겨 같은 높이에 세운다(바닥에 내려앉지 않게) — 실제 배관대처럼.
            PREVIEW_PLACE = '''([id, portKey, tx, ty]) => {
              const a = window.__app, S = window.__S;
              const V = a.camera.position.constructor;
              const e = a.state.equipment.find((q) => q.id === id);
              const port = () => S.equipPorts(e).find((n) => (n.nid || n.dir) === portKey);
              const r = a.renderer.domElement.getBoundingClientRect();
              let err = null;
              for (let i = 0; i < 20; i += 1) {
                a.camera.updateMatrixWorld(true);
                const n = port();
                const v = new V(n.tip.x, n.tip.y, n.tip.z).project(a.camera);
                const sx = r.left + (v.x * 0.5 + 0.5) * r.width;
                const sy = r.top + (-v.y * 0.5 + 0.5) * r.height;
                err = { x: tx - sx, y: ty - sy };
                if (Math.abs(err.x) < 0.4 && Math.abs(err.y) < 0.4) break;
                const dist = a.camera.position.distanceTo(new V(n.tip.x, n.tip.y, n.tip.z));
                const hh = dist * Math.tan(a.camera.fov * Math.PI / 360);
                const hw = hh * a.camera.aspect;
                const right = new V().setFromMatrixColumn(a.camera.matrixWorld, 0);
                const up = new V().setFromMatrixColumn(a.camera.matrixWorld, 1);
                const shift = right.multiplyScalar((err.x / r.width) * 2 * hw)
                  .add(up.multiplyScalar(-(err.y / r.height) * 2 * hh));
                e.x += shift.x; e.y = Math.max(0.3, e.y + shift.y);
                a.rebuild();
              }
              const n = port();
              return { err, pos: { x: e.x, y: e.y, z: e.z }, tip: { x: n.tip.x, y: n.tip.y, z: n.tip.z } };
            }'''
            ids7 = page.evaluate(SETUP, [{
                'cam': [1.5, 1.5, 5.5], 'look': [-0.3, 1.0, 0.7],
                'equip': [
                    {'key': 'fg', 'type': 'elbow', 'x': 0, 'y': 1.0, 'z': 2.0,
                     'bore': '80A', 'inDir': [1, 0, 0], 'outDir': [0, 1, 0], 'rot': 0},
                    {'key': 'bg', 'type': 'valve', 'x': -0.7, 'y': 1.0, 'z': -3.0,
                     'bore': '80A', 'axis': 'z', 'rot': 0},
                ],
                'pipes': [
                    {'key': 'p1', 'name': 'P-1', 'bore': '80A', 'material': 'carbon', 'conn': 'flange',
                     'points': [{'x': 0.14, 'y': 1.0, 'z': 2.0}, {'x': 3.0, 'y': 1.0, 'z': 2.0}]},
                    {'key': 'p2', 'name': 'P-2', 'bore': '80A', 'material': 'carbon', 'conn': 'flange',
                     'points': [{'x': 0, 'y': 1.14, 'z': 2.0}, {'x': 0, 'y': 1.62, 'z': 2.0}]},
                    {'key': 'p3', 'name': 'P-3', 'bore': '80A', 'material': 'carbon', 'conn': 'flange',
                     'points': [{'x': -0.7, 'y': 1.0, 'z': -3.0}, {'x': -1.9, 'y': 1.0, 'z': -3.0}]},
                ],
            }])
            page.wait_for_timeout(300)
            fg7 = page.evaluate(FIND_PIXEL, ['equipment', ids7['fg'], 60])
            pl7 = page.evaluate(PREVIEW_PLACE, [ids7['bg'], 'faceB', fg7['x'] + 24, fg7['y'] - 6]) if fg7 else None
            print('미리보기 — 뒤쪽 밸브 배치:', pl7)
            near7 = None
            if fg7:
                tip7 = page.evaluate('''([id]) => {
                  const a = window.__app, S = window.__S, T = window.__T;
                  const e = a.state.equipment.find((q) => q.id === id);
                  const n = S.equipPorts(e).find((q) => q.nid === 'faceB');
                  const s = T.proj(n.tip);
                  return { x: s.x, y: s.y };
                }''', [ids7['bg']])
                near7 = page.evaluate(FIND_NEAR, ['equipment', ids7['fg'], tip7['x'], tip7['y'], 30])
                print('미리보기 — 뒤쪽 접합면 30px 안의 엘보 픽셀:',
                      json.dumps(near7, ensure_ascii=False) if near7 else 'none')
                check('미리보기 준비 — 뒤쪽 접합면 30px 안에 앞쪽 엘보 픽셀', bool(near7))
            if near7:
                pr7 = page.evaluate(PROBE, [near7['x'], near7['y'], 32])
                print('미리보기 탭 판정:', json.dumps(pr7, ensure_ascii=False))
                page.evaluate(PREP)
                page.mouse.click(near7['x'], near7['y'])
                page.wait_for_timeout(500)
            page.evaluate(PREP)
            # 탭하면 모바일에서 '고른 것을 속성 창 위로 당겨 오는' 카메라 이동이 걸린다 —
            # 미리보기 구도는 따로 잡는다.
            page.evaluate('''([cam, look]) => {
              const a = window.__app;
              a.camAnim = null;
              a.camera.position.set(cam[0], cam[1], cam[2]);
              a.controls.target.set(look[0], look[1], look[2]);
              a.controls.update();
              a.camera.updateMatrixWorld(true);
            }''', [[0.62, 1.38, 3.35], [0.0, 1.0, 2.0]])
            page.wait_for_timeout(300)
            print('카메라(설정 직후):', page.evaluate('''() => { const a = window.__app;
              return { p: [+a.camera.position.x.toFixed(2), +a.camera.position.y.toFixed(2), +a.camera.position.z.toFixed(2)],
                       t: [+a.controls.target.x.toFixed(2), +a.controls.target.y.toFixed(2), +a.controls.target.z.toFixed(2)],
                       anim: !!a.camAnim, focus: a.focusKey || null }; }'''))
            sel7 = page.evaluate('() => window.__app.selection')
            print('미리보기 선택:', sel7)
            print('뒤쪽 접합면 화면 위치:', page.evaluate('''([id]) => {
              const a = window.__app, S = window.__S, T = window.__T;
              const e = a.state.equipment.find((q) => q.id === id);
              const n = S.equipPorts(e).find((q) => q.nid === 'faceB');
              const s = T.proj(n.tip);
              return [+s.x.toFixed(0), +s.y.toFixed(0)];
            }''', [ids7['bg']]))
            check('미리보기 — 앞쪽 엘보가 선택된 장면', bool(sel7) and sel7['id'] == ids7['fg'],
                  json.dumps(sel7, ensure_ascii=False))
            # 구도 확인 — 선택 상자(주황)가 화면 어디에 얼마 크기로 그려지는가
            print('미리보기 구도:', page.evaluate('''() => {
              const a = window.__app, T = window.__T;
              const h = (a.helpers || [])[0];
              if (!h) return null;
              const g = h.geometry; g.computeBoundingBox();
              const b = g.boundingBox;
              const pts = [];
              [b.min.x, b.max.x].forEach((x) => [b.min.y, b.max.y].forEach((y) => [b.min.z, b.max.z].forEach((z) => {
                pts.push(T.proj({ x, y, z }));
              })));
              const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
              const r = a.renderer.domElement.getBoundingClientRect();
              return { box: [Math.round(Math.min(...xs)), Math.round(Math.min(...ys)),
                             Math.round(Math.max(...xs)), Math.round(Math.max(...ys))],
                       canvas: [Math.round(r.width), Math.round(r.height)],
                       sizePx: [Math.round(Math.max(...xs) - Math.min(...xs)),
                                Math.round(Math.max(...ys) - Math.min(...ys))] };
            }'''))
            page.screenshot(path=ROOT + '/preview-v80-fg-pick.png')
            print('미리보기 저장:', ROOT + '/preview-v80-fg-pick.png')

            check('⑧ 콘솔 오류 0건', not errs, '; '.join(errs[:3]))
            b.close()
    finally:
        if srv:
            srv.terminate()
            try:
                srv.wait(timeout=3)
            except Exception:
                srv.kill()

    bad = [r for r in results if not r[1]]
    print(f'\n{len(results) - len(bad)}/{len(results)} 통과')
    if bad:
        for nm, _, dt in bad:
            print('  실패:', nm, dt)
        sys.exit(1)
    print('모두 통과')


if __name__ == '__main__':
    main()
