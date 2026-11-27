#!/usr/bin/env python3
"""v78 검증 — 390×844 모바일 뷰포트 실브라우저.

사용자 제보(2026-11-27 `32270`): 플랜지 끝에서 배관 100mm를 그리고 `왼쪽으로 1000`(150A,
피팅값 자동계산 OFF)을 그리면 자동 엘보(face 228.6mm)가 100mm 배관 뒤로 넘어가 플랜지
안에 파묻혔다.

검사 항목
 ① fitAuto OFF — 100mm 배관 그대로 + 엘보 입구가 배관 끝에 0mm + 플랜지 안 파묻힘 0mm
 ② fitAuto ON  — 100mm 배관 그대로 + 엘보 입구 0mm + 새 구간은 중심선 1000mm
 ③ 회귀 — fitAuto ON + 긴 배관(2000mm)은 예전처럼 face만큼 당겨 자르고 엘보를 꼭짓점에
 ④ fitAuto OFF + 긴 배관 — 배관은 그대로, 엘보는 끝 바깥(새 규칙)
 ⑤ 양쪽 끝(시작점) 이어그리기 — 시작점 배관도 face만큼 당겨 엘보가 0mm
 ⑥ 플랜지 접합면 위(커서가 면에 20mm 물린 자리)에서 꺾기 — tip 기준으로 세워 파묻힘 0mm
 ⑦ 콘솔 오류 0건
"""
import json
import math
import subprocess
import sys
import time
from playwright.sync_api import sync_playwright

PORT = 8778
ROOT = '/workspace/projects/smile-piping-3d'
BASE = f'http://127.0.0.1:{PORT}/'
FACE150 = 0.2286          # KS B 1522 / ASME B16.9 150A 90° LR 엘보 중심~끝
results = []


def check(name, ok, detail=''):
    results.append((name, bool(ok), detail))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''))


# 장면 요약 — 사용자가 그린 순서 그대로: 150A 배관 → 플랜지 → 앞 100 → 왼 1000
SCENE = '''(off) => {
  const a = window.__app;
  a.clearAll({ silent: true });
  a.setFitAuto(!off, true);
  a.setCmdBore('150A', true);
  a.setCmdCursor({x:0,y:0,z:0}, true);
  a.execOps([{op:'seg', world:true, axis:'x', sign:1, meters:3}], {source:'cmd'});   // 150A 배관 3m
  a.setCmdCursor({x:3,y:0,z:0}, true);
  a.addFittingAtCursor('flange');                                                     // 배관 끝에 플랜지
  a.execOps([{op:'seg', world:true, axis:'x', sign:1, meters:0.1}], {source:'cmd'});  // 플랜지 끝에서 앞 100
  a.execOps([{op:'seg', world:true, axis:'z', sign:-1, meters:1.0}], {source:'cmd'}); // 왼쪽으로 1000
}'''

# 결과 기하 — 파이프·플랜지·엘보 좌표를 그대로 뽑는다
GEOM = '''() => {
  const a = window.__app;
  const len = (p) => {
    let s = 0;
    for (let i = 1; i < p.points.length; i += 1) {
      const u = p.points[i-1], v = p.points[i];
      s += Math.hypot(v.x-u.x, v.y-u.y, v.z-u.z);
    }
    return s;
  };
  const fl = a.state.equipment.find((e) => e.type === 'flange') || null;
  let flTip = fl ? null : null;
  if (fl) {
    const d = Array.isArray(fl.dir) ? fl.dir : [1,0,0];
    const l = Math.hypot(d[0], d[1], d[2]) || 1;
    const u = { x: d[0]/l, y: d[1]/l, z: d[2]/l };
    const half = Math.abs(fl.w) / 2;
    flTip = { x: fl.x + u.x*half, y: fl.y + u.y*half, z: fl.z + u.z*half };
  }
  const eb = a.state.equipment.find((e) => e.type === 'elbow' || e.type === 'elbow45') || null;
  let elbow = null;
  if (eb) {
    const face = eb.type === 'elbow' ? 0.2286 : 0.0953;
    const inD = eb.inDir || [1,0,0];
    const outD = eb.outDir || [0,1,0];
    elbow = {
      type: eb.type, x: eb.x, y: eb.y, z: eb.z, bore: eb.bore,
      inDir: inD, outDir: outD, face,
      inlet: { x: eb.x + inD[0]*face, y: eb.y + inD[1]*face, z: eb.z + inD[2]*face },
      outlet: { x: eb.x + outD[0]*face, y: eb.y + outD[1]*face, z: eb.z + outD[2]*face },
      // 플랜지 쪽(진행축)으로 가장 뒤로 뻗은 면 — 이 값이 플랜지 면보다 뒤면 파묻힌 것
      back: Math.min(eb.x + inD[0]*face, eb.x - inD[0]*face),
    };
  }
  return {
    fitAuto: a.fitAuto,
    cursor: { ...a.cmdCursor },
    pipes: a.state.pipes.map((p) => ({ id:p.id, bore:p.bore, len:len(p),
      pts:p.points.map((q) => ({ x:q.x, y:q.y, z:q.z })) })),
    fl: fl ? { x:fl.x, y:fl.y, z:fl.z, w:fl.w, dir:fl.dir, tip:flTip } : null,
    elbow,
    notes: (a.state.equipment || []).map((e) => e.type),
  };
}'''

D = lambda a, b: math.dist((a['x'], a['y'], a['z']), (b['x'], b['y'], b['z']))

# 원하는 점을 화면의 지정 위치에 두는 카메라 — 앱이 아래 조작줄을 피해 시야를 치우기 때문에
# 투영값을 보고 3~4번 보정한다.
CAM = '''([px, py, pz, dist, nx, ny]) => {
  const a = window.__app;
  const V = a.camera.position.constructor;
  a.camAnim = null;
  const P = new V(px, py, pz);
  const dir = new V(0.65, 0.38, 0.66).normalize();
  a.camera.position.copy(P).addScaledVector(dir, dist);
  a.controls.target.copy(P);
  a.controls.update();
  for (let i = 0; i < 6; i += 1) {
    a.camera.updateMatrixWorld(true);
    const q = P.clone().project(a.camera);
    const hh = dist * Math.tan(a.camera.fov * Math.PI / 360);
    const hw = hh * a.camera.aspect;
    const right = new V().setFromMatrixColumn(a.camera.matrixWorld, 0);
    const up = new V().setFromMatrixColumn(a.camera.matrixWorld, 1);
    const shift = right.multiplyScalar((q.x - nx) * hw).add(up.multiplyScalar((q.y - ny) * hh));
    a.camera.position.add(shift);
    a.controls.target.add(shift);
    a.controls.update();
  }
}'''

PREP = '''() => {
  const a = window.__app;
  a.clearSelection();
  a.setDims(true);
  a.scene.traverse((o) => { if (o.isSprite) o.visible = false; });   // X·Y·Z 축 글자
  document.querySelectorAll('#props').forEach((el) => { el.hidden = true; });
  const el = document.querySelector('#toastHost');
  if (el) el.style.display = 'none';
}'''


def main():
    srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'],
                           cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.2)
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            page = b.new_page(viewport={'width': 390, 'height': 844}, device_scale_factor=2,
                              is_mobile=True, has_touch=True)
            errs = []
            page.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
            page.on('pageerror', lambda e: errs.append(str(e)))
            page.goto(BASE + '?v=78', wait_until='networkidle')
            page.wait_for_function('window.__app && window.__app.state', timeout=20000)
            page.wait_for_timeout(700)
            page.evaluate('document.querySelectorAll("#props").forEach((el) => { el.hidden = true; })')

            # ── ① fitAuto OFF — 사용자가 제보한 그 상태 ──────────────────────
            page.evaluate(SCENE, True)
            page.wait_for_timeout(500)
            g1 = page.evaluate(GEOM)
            print('OFF 기하:', json.dumps(g1, ensure_ascii=False))
            short = [q for q in g1['pipes'] if abs(q['len'] - 0.1) < 0.02]
            check('① 준비 — 배관 3개(3m·100mm·1000mm)',
                  len(g1['pipes']) == 3 and abs(g1['pipes'][0]['len'] - 3) <= 0.002
                  and abs(g1['pipes'][-1]['len'] - 1.0) <= 0.002,
                  json.dumps([round(q['len'], 4) for q in g1['pipes']], ensure_ascii=False))
            check('① 100mm 배관 그대로 유지', bool(short) and abs(short[0]['len'] - 0.1) <= 0.001,
                  json.dumps([round(q['len'], 4) for q in g1['pipes']], ensure_ascii=False))
            eb1 = g1['elbow']
            check('① 엘보 자동 배치(150A)', eb1 is not None and eb1['bore'] == '150A',
                  json.dumps(eb1 and {k: eb1[k] for k in ('type', 'bore')}, ensure_ascii=False))
            if eb1 and short:
                end1 = short[0]['pts'][-1]
                d_in = D(eb1['inlet'], end1)
                check('① 엘보 입구 = 100mm 배관 끝 (0mm)', d_in <= 0.001, f'{d_in*1000:.2f}mm')
                # 플랜지 면 → 엘보 입구 간격: 100mm 여야 파묻힘 0
                gap = eb1['inlet']['x'] - g1['fl']['tip']['x']
                check('① 엘보가 플랜지 안으로 파묻히지 않음', gap >= -0.0005, f'플랜지 면에서 {gap*1000:.1f}mm')
                check('① 플랜지~엘보 간격 100mm(배관 길이 그대로)', abs(gap - 0.1) <= 0.001, f'{gap*1000:.1f}mm')
                check('① 엘보 중심 = 배관 끝 + 228.6mm',
                      abs(D(eb1['inlet'], end1)) <= 0.001 and
                      abs(D({'x': eb1['x'], 'y': eb1['y'], 'z': eb1['z']}, end1) - FACE150) <= 0.001,
                      f"중심거리 {D({'x': eb1['x'], 'y': eb1['y'], 'z': eb1['z']}, end1)*1000:.1f}mm")
                newp = g1['pipes'][-1]
                check('① 새 구간 = 직관 1000mm (OFF)', newp is not None and abs(newp['len'] - 1.0) <= 0.002,
                      f"{newp['len']*1000:.1f}mm" if newp else '없음')
            else:
                check('① 엘보 입구 = 100mm 배관 끝 (0mm)', False, '엘보 또는 100mm 배관 없음')
                check('① 엘보가 플랜지 안으로 파묻히지 않음', False, '엘보 또는 플랜지 없음')
                check('① 플랜지~엘보 간격 100mm(배관 길이 그대로)', False, '엘보 또는 플랜지 없음')
                check('① 엘보 중심 = 배관 끝 + 228.6mm', False, '엘보 없음')
                check('① 새 구간 = 직관 1000mm (OFF)', False, '엘보 없음')

            # 미리보기 — 플랜지·100mm 배관·엘보가 만나는 자리를 가까이
            page.evaluate(PREP)
            page.evaluate(CAM, [3.15, 0.14, -0.15, 2.4, 0, 0.10])
            page.wait_for_timeout(500)
            page.screenshot(path=ROOT + '/preview-v78-flange-pipe-elbow.png')

            # ── ② fitAuto ON — 같은 장면 ─────────────────────────────────────
            page.evaluate(SCENE, False)
            page.wait_for_timeout(500)
            g2 = page.evaluate(GEOM)
            print('ON 기하:', json.dumps(g2, ensure_ascii=False))
            short2 = [q for q in g2['pipes'] if abs(q['len'] - 0.1) < 0.02]
            eb2 = g2['elbow']
            check('② 100mm 배관 그대로 유지(ON)', bool(short2) and abs(short2[0]['len'] - 0.1) <= 0.001,
                  json.dumps([round(q['len'], 4) for q in g2['pipes']], ensure_ascii=False))
            if eb2 and short2:
                end2 = short2[0]['pts'][-1]
                check('② 엘보 입구 = 배관 끝 (0mm)', D(eb2['inlet'], end2) <= 0.001,
                      f"{D(eb2['inlet'], end2)*1000:.2f}mm")
                gap2 = eb2['inlet']['x'] - g2['fl']['tip']['x']
                check('② 플랜지 안 파묻힘', gap2 >= -0.0005, f'{gap2*1000:.1f}mm')
                newp2 = g2['pipes'][-1]
                check('② 새 구간 = 중심선 1000mm (직관 771.4mm)',
                      abs(newp2['len'] - (1.0 - FACE150)) <= 0.002, f"{newp2['len']*1000:.1f}mm")
                # 꼭짓점에서 새 배관 끝까지가 1000mm 인지
                corner = {'x': end2['x'], 'y': end2['y'], 'z': end2['z']}
                span = abs(newp2['pts'][-1]['z'] - corner['z'])
                check('② 꼭짓점 → 새 끝 1000mm', abs(span - 1.0) <= 0.002, f'{span*1000:.1f}mm')
            else:
                for nm in ('② 엘보 입구 = 배관 끝 (0mm)', '② 플랜지 안 파묻힘',
                           '② 새 구간 = 중심선 1000mm (직관 771.4mm)', '② 꼭짓점 → 새 끝 1000mm'):
                    check(nm, False, '엘보 또는 100mm 배관 없음')
            page.evaluate(PREP)
            page.evaluate(CAM, [3.15, 0.14, -0.15, 2.4, 0, 0.10])
            page.wait_for_timeout(400)
            page.screenshot(path=ROOT + '/preview-v78-fit-on.png')

            # ── ③ 회귀 — fitAuto ON + 긴 배관은 예전대로 당겨 자른다 ──────────
            g3 = page.evaluate('''() => {
              const a = window.__app;
              a.clearAll({ silent: true });
              a.setFitAuto(true, true);
              a.setCmdBore('150A', true);
              a.setCmdCursor({x:0,y:0,z:0}, true);
              a.execOps([{op:'seg', world:true, axis:'x', sign:1, meters:2}], {source:'cmd'});
              a.execOps([{op:'seg', world:true, axis:'z', sign:-1, meters:1}], {source:'cmd'});
              const p = a.state.pipes[0];
              const e = a.state.equipment.find((q) => q.type === 'elbow');
              const L = Math.hypot(p.points[1].x-p.points[0].x, p.points[1].z-p.points[0].z);
              return {L, end: p.points[1], e: e && {x:e.x, y:e.y, z:e.z, inDir:e.inDir}};
            }''')
            check('③ 긴 배관(2000mm)은 face만큼 당겨짐 (1771.4mm)', abs(g3['L'] - (2 - FACE150)) <= 0.002,
                  f"{g3['L']*1000:.1f}mm")
            check('③ 엘보 중심 = 원래 꼭짓점(2000mm)',
                  g3['e'] is not None and abs(g3['e']['x'] - 2.0) <= 0.002,
                  json.dumps(g3['e'], ensure_ascii=False))

            # ── ④ fitAuto OFF + 긴 배관 — 자르지 않고 엘보가 끝 바깥 ───────────
            g4 = page.evaluate('''() => {
              const a = window.__app;
              a.clearAll({ silent: true });
              a.setFitAuto(false, true);
              a.setCmdBore('150A', true);
              a.setCmdCursor({x:0,y:0,z:0}, true);
              a.execOps([{op:'seg', world:true, axis:'x', sign:1, meters:2}], {source:'cmd'});
              a.execOps([{op:'seg', world:true, axis:'z', sign:-1, meters:1}], {source:'cmd'});
              const p = a.state.pipes[0];
              const e = a.state.equipment.find((q) => q.type === 'elbow');
              return {L: Math.hypot(p.points[1].x-p.points[0].x, p.points[1].z-p.points[0].z),
                      e: e && {x:e.x, inDir:e.inDir}};
            }''')
            check('④ OFF — 2000mm 배관 그대로', abs(g4['L'] - 2.0) <= 0.002, f"{g4['L']*1000:.1f}mm")
            check('④ OFF — 엘보가 배관 끝 바깥(2000+228.6mm)',
                  g4['e'] is not None and abs(g4['e']['x'] - (2 + FACE150)) <= 0.002,
                  json.dumps(g4['e'], ensure_ascii=False))

            # ── ⑤ 양쪽 끝(시작점) 이어그리기 — 시작점 배관도 당겨진다 ─────────
            g5 = page.evaluate('''() => {
              const a = window.__app;
              a.clearAll({ silent: true });
              a.setFitAuto(true, true);
              a.setCmdBore('150A', true);
              a.setCmdCursor({x:0,y:0,z:0}, true);
              a.execOps([{op:'seg', world:true, axis:'x', sign:1, meters:3}], {source:'cmd'});
              const p = a.state.pipes[0];
              a.select('pipe', p.id);
              a.fromHere('start');
              const c = { ...a.cmdCursor };
              a.execOps([{op:'seg', world:true, axis:'z', sign:-1, meters:1}], {source:'cmd'});
              const e = a.state.equipment.find((q) => q.type === 'elbow');
              return {c, start: p.points[0], end: p.points[p.points.length-1],
                      e: e && {x:e.x, y:e.y, z:e.z, inDir:e.inDir}};
            }''')
            check('⑤ 시작점에서 이어그리기 커서 = (0,0,0)',
                  abs(g5['c']['x']) < 1e-6 and abs(g5['c']['z']) < 1e-6, json.dumps(g5['c']))
            check('⑤ 시작점 배관도 face만큼 당겨짐(228.6mm)',
                  abs(g5['start']['x'] - FACE150) <= 0.002 and abs(g5['end']['x'] - 3) <= 1e-6,
                  f"start.x={g5['start']['x']}")
            check('⑤ 시작점 엘보 중심 = 원래 시작점',
                  g5['e'] is not None and abs(g5['e']['x']) <= 0.002, json.dumps(g5['e'], ensure_ascii=False))

            # ── ⑥ 접합면 위(커서가 20mm 물린 자리)에서 꺾기 ─────────────────
            g6 = page.evaluate('''() => {
              const a = window.__app;
              a.clearAll({ silent: true });
              a.setFitAuto(true, true);
              a.setCmdBore('150A', true);
              a.setCmdCursor({x:0,y:0,z:0}, true);
              a.execOps([{op:'seg', world:true, axis:'x', sign:1, meters:3}], {source:'cmd'});
              a.setCmdCursor({x:3,y:0,z:0}, true);
              a.addFittingAtCursor('flange');
              const fl = a.state.equipment.find((e) => e.type === 'flange');
              const d = fl.dir || [1,0,0];
              const half = Math.abs(fl.w) / 2;
              const tip = { x: fl.x + d[0]*half, y: fl.y + d[1]*half, z: fl.z + d[2]*half };
              // 커서를 접합면에서 20mm 뒤(플랜지 속)로 물려 놓고 꺾는다
              a.setCmdCursor({x: tip.x - 0.02, y: tip.y, z: tip.z}, true);
              a.execOps([{op:'seg', world:true, axis:'z', sign:-1, meters:1}], {source:'cmd'});
              const e = a.state.equipment.find((q) => q.type === 'elbow');
              return {tip, e: e && {x:e.x, inDir:e.inDir}};
            }''')
            if g6['e']:
                inlet_x = g6['e']['x'] + g6['e']['inDir'][0] * FACE150
                check('⑥ 접합면 위 꺾기 — 엘보 입구가 tip에 0mm',
                      abs(inlet_x - g6['tip']['x']) <= 0.001,
                      f"입구 {inlet_x:.4f} vs tip {g6['tip']['x']:.4f} ({(inlet_x-g6['tip']['x'])*1000:.1f}mm)")
            else:
                check('⑥ 접합면 위 꺾기 — 엘보 입구가 tip에 0mm', False, '엘보 없음')

            # ── ⑨ 실제 UI 흐름 — 명령창에 "오른쪽 100" → "앞으로 1000" ──────────
            ui = page.evaluate('''() => {
              const a = window.__app;
              a.clearAll({ silent: true });
              a.setFitAuto(false, true);
              a.dirFrame = 'plan';                 // 도면 축 기준 — 테스트가 방향을 고정
              a.setCmdBore('150A', true);
              a.setCmdCursor({x:0,y:0,z:0}, true);
              a.execOps([{op:'seg', world:true, axis:'x', sign:1, meters:3}], {source:'cmd'});
              a.setCmdCursor({x:3,y:0,z:0}, true);
              a.addFittingAtCursor('flange');
              const send = (txt) => {
                const inp = document.querySelector('#cmdInput');
                inp.value = txt;
                document.querySelector('#cmdForm').requestSubmit();
              };
              send('오른쪽 100');
              send('앞으로 1000');
              const fl = a.state.equipment.find((e) => e.type === 'flange');
              const eb = a.state.equipment.find((e) => e.type === 'elbow');
              const ends = a.state.pipes.map((p) => p.points[p.points.length-1]);
              const tipX = fl.x + Math.abs(fl.w) / 2;
              const inletX = eb ? eb.x + eb.inDir[0] * 0.2286 : null;
              return { pipes: a.state.pipes.length, tipX, inletX,
                       gap: inletX - tipX,
                       short: a.state.pipes.map((p) => {
                         let s = 0;
                         for (let i = 1; i < p.points.length; i += 1) {
                           const u = p.points[i-1], v = p.points[i];
                           s += Math.hypot(v.x-u.x, v.y-u.y, v.z-u.z);
                         }
                         return +s.toFixed(3);
                       }),
                       toast: (document.querySelector('#toastHost .toast') || {}).textContent || '' };
            }''')
            print('UI 흐름:', json.dumps(ui, ensure_ascii=False))
            check('⑨ 명령창 "오른쪽 100"→"앞으로 1000" — 배관 3개',
                  ui['pipes'] == 3 and 0.1 in ui['short'] and 1.0 in ui['short'],
                  json.dumps(ui['short'], ensure_ascii=False))
            check('⑨ 엘보가 플랜지 면에서 100mm 앞(파묻힘 0)',
                  ui['gap'] is not None and abs(ui['gap'] - 0.1) <= 0.002, f"{ui['gap']*1000:.1f}mm")

            check('⑦ 콘솔 오류 0건', not errs, '; '.join(errs[:3]))

            # ── ⑧ 연결성 — 꺾임이 이어지는 경로에서 모든 엘보 입·출구가 배관 끝과 물린다 ──
            conn = page.evaluate('''() => {
              const a = window.__app;
              const out = {};
              const run = (on) => {
                a.clearAll({ silent: true });
                a.setFitAuto(on, true);
                a.setCmdBore('150A', true);
                a.setCmdCursor({x:0,y:0,z:0}, true);
                a.execOps([
                  {op:'seg', world:true, axis:'x', sign:1, meters:3},
                  {op:'seg', world:true, axis:'z', sign:-1, meters:1},
                  {op:'seg', world:true, axis:'y', sign:1, meters:0.5},
                  {op:'seg', world:true, axis:'x', sign:-1, meters:0.5},
                ], {source:'cmd'});
                // 짧은 구간(100mm) 경로 — 엘보가 배관 끝 바깥에 서는 경우
                a.setCmdBore('80A', true);
                a.setCmdCursor({x:0, y:0, z:3}, true);
                a.execOps([
                  {op:'seg', world:true, axis:'x', sign:1, meters:0.1},
                  {op:'seg', world:true, axis:'z', sign:-1, meters:0.1},
                  {op:'seg', world:true, axis:'y', sign:1, meters:0.1},
                ], {source:'cmd'});
                const ends = [];
                a.state.pipes.forEach((p) => {
                  ends.push(p.points[0]);
                  ends.push(p.points[p.points.length - 1]);
                });
                const elbows = a.state.equipment.filter((e) => e.type === 'elbow' || e.type === 'elbow45');
                const near = (q) => Math.min(...ends.map((e) => Math.hypot(e.x-q.x, e.y-q.y, e.z-q.z)));
                const worst = Math.max(...elbows.map((e) => {
                  const f = e.type === 'elbow' ? 0.2286 : 0.0953;
                  const b = e.bore === '80A' ? (e.type === 'elbow' ? 0.1143 : 0.0508) : f;
                  const inP = { x: e.x + e.inDir[0]*b, y: e.y + e.inDir[1]*b, z: e.z + e.inDir[2]*b };
                  const outP = { x: e.x + e.outDir[0]*b, y: e.y + e.outDir[1]*b, z: e.z + e.outDir[2]*b };
                  return Math.max(near(inP), near(outP));
                }));
                return { elbows: elbows.length,
                         shortest: Math.min(...a.state.pipes.map((p) => {
                           let s = 0;
                           for (let i = 1; i < p.points.length; i += 1) {
                             const u = p.points[i-1], v = p.points[i];
                             s += Math.hypot(v.x-u.x, v.y-u.y, v.z-u.z);
                           }
                           return s;
                         })),
                         worst };
              };
              out.on = run(true);
              out.off = run(false);
              return out;
            }''')
            print('연결성:', json.dumps(conn, ensure_ascii=False))
            for mode in ('on', 'off'):
                m = conn[mode]
                check(f'⑧ {mode.upper()} — 엘보 5개(긴 경로 3 + 짧은 경로 2)', m['elbows'] == 5, str(m['elbows']))
                check(f'⑧ {mode.upper()} — 엘보 입·출구가 배관 끝에 물림(<=5mm)', m['worst'] <= 0.005,
                      f"{m['worst']*1000:.1f}mm")
                check(f'⑧ {mode.upper()} — 0길이 배관 없음', m['shortest'] > 0.015,
                      f"{m['shortest']*1000:.1f}mm")

            b.close()
    finally:
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
