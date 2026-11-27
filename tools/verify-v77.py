#!/usr/bin/env python3
"""v77 검증 — 390×844 모바일 뷰포트 실브라우저.

검사 항목
 ① 연속 이동 토스트가 쌓이지 않고 1줄만 유지되는지
 ② 80A 배관에 티를 끼워넣으면 주배관·분기 모두 80A로 들어가는지
 ③ 손그리기·길이조절·이동에서 X/Y/Z 정렬 스냅과 점선·`정렬` 배지가 뜨는지
 ④ 키보드 열림 시 명령창 위 1줄 방향 바가 보이고, 방향 전환 후에도 초점·관경이 유지되는지
 ⑤ 배관 양쪽 끝 이어그리기 — 열린 끝 우선, 🔁로 반대쪽 전환
"""
import json
import subprocess
import sys
import time
from playwright.sync_api import sync_playwright

PORT = 8765
ROOT = '/workspace/projects/smile-piping-3d'
BASE = f'http://127.0.0.1:{PORT}/'
results = []

# 월드 좌표 → 화면 좌표 — page.mouse로 실제 드래그를 하기 위해 앱의 카메라로 그대로 투영한다.
# (THREE가 전역이 아니라서 앱이 이미 가진 Vector3(alignBadgeV)를 빌려 쓴다)
W2S = '''(p) => {
  const a = window.__app;
  if (!a.alignBadgeV) {
    const el = document.querySelector('#alignBadge');
    const wasHidden = el.hidden;
    el.hidden = false;
    a.alignBadgeAt = { x: 0, y: 0, z: 0 };
    a.placeAlignBadge();
    el.hidden = wasHidden;
    a.alignBadgeAt = null;
    el.style.left = '';
    el.style.top = '';
  }
  const v = a.alignBadgeV.set(p.x, p.y, p.z).project(a.camera);
  const r = a.renderer.domElement.getBoundingClientRect();
  return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height };
}'''

# 드래그 중 상태 읽기 — 배지·점선·이동한 배관 좌표
DRAG_STATE = '''() => {
  const a = window.__app;
  const b = a.state.pipes[1];
  const badge = document.querySelector('#alignBadge');
  return {
    st: !!a.moveDragState,
    moved: !!(a.moveDragState && a.moveDragState.moved),
    s0: b ? b.points[0].x : null,
    s1: b ? b.points[0].z : null,
    e0: b ? b.points[b.points.length - 1].x : null,
    e1: b ? b.points[b.points.length - 1].z : null,
    shown: bannerShow(badge),
    txt: badge ? badge.textContent : '',
    lines: (a.align3DLines || []).filter((l) => l.visible).length,
  };
  function bannerShow(el) { return !!el && !el.hidden; }
}'''


def check(name, ok, detail=''):
    results.append((name, bool(ok), detail))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''))


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
            page.goto(BASE + '?v=77', wait_until='networkidle')
            page.wait_for_function('window.__app && window.__app.state', timeout=20000)
            page.wait_for_timeout(800)

            # 깨끗한 도면에서 시작
            page.evaluate('window.__app.clearAll && window.__app.clearAll()')
            page.wait_for_timeout(300)

            # ── 준비: 80A 배관 하나 (0,0,0) → (3,0,0) ───────────────────────
            page.evaluate("""() => {
              const a = window.__app;
              a.setCmdBore('80A', true);
              a.setCmdCursor({x:0,y:0,z:0}, true);
              a.execOps([{op:'seg', axis:'x', sign:1, meters:3}], {source:'cmd'});
            }""")
            page.wait_for_timeout(400)
            npipe = page.evaluate('window.__app.state.pipes.length')
            check('준비 — 80A 배관 생성', npipe == 1, f'배관 {npipe}개')
            bore0 = page.evaluate('window.__app.state.pipes[0].bore')
            check('준비 — 관경 80A', bore0 == '80A', str(bore0))

            # ── ① 토스트 1줄 ─────────────────────────────────────────────
            page.evaluate("""() => {
              const a = window.__app;
              // 같은 배관을 고른 뒤 방향 버튼으로 6번 연속 이동
              a.select('pipe', a.state.pipes[0].id);
            }""")
            page.wait_for_timeout(400)
            for i in range(6):
                page.click('[data-act="mv"][data-axis="x"][data-sign="1"]')
                page.wait_for_timeout(120)
            # 미리보기는 토스트가 떠 있는 순간에 — 카메라만 도면 전체로 되돌리고,
            # 캐프처 시간(수 초)에 자동으로 사라지지 않게 타이머만 테스트에서 잠시 멈춘다
            page.click('[data-act="mv"][data-axis="x"][data-sign="1"]')
            page.evaluate("""() => {
              const a = window.__app;
              if (a.toastTimer) clearTimeout(a.toastTimer);
              if (a.toastFadeTimer) clearTimeout(a.toastFadeTimer);
              a.setView('iso', true);
            }""")
            page.wait_for_timeout(120)
            page.screenshot(path=ROOT + '/preview-v77-toast.png')
            page.wait_for_timeout(200)
            tcount = page.evaluate("document.querySelectorAll('#toastHost .toast').length")
            ttext = page.evaluate("(document.querySelector('#toastHost .toast')||{}).textContent || ''")
            toast_h = page.evaluate("""() => {
              const el = document.querySelector('#toastHost .toast');
              return el ? Math.round(el.getBoundingClientRect().height) : 0;
            }""")
            check('① 연속 이동 토스트 1줄 유지', tcount == 1, f'{tcount}개 · 높이 {toast_h}px · "{ttext[:40]}"')
            check('① 토스트가 한 줄 높이(<=32px)', 0 < toast_h <= 32, f'{toast_h}px')

            # ── ② 80A 배관에 티 끼워넣기 → 주배관·분기 모두 80A ─────────────
            page.evaluate("""() => {
              const a = window.__app;
              a.select('pipe', a.state.pipes[0].id);
              a.openInsertPicker();
            }""")
            page.wait_for_timeout(500)
            page.click('[data-ins="tee"]')
            page.wait_for_timeout(700)
            tee = page.evaluate("""() => {
              const a = window.__app;
              const t = a.state.equipment.find((e) => e.type === 'tee');
              return t ? {bore1:t.bore1, bore2:t.bore2, bore:t.bore, cmd:a.cmdBore} : null;
            }""")
            check('② 80A 배관 티 주배관 관경', tee and tee['bore1'] == '80A', json.dumps(tee, ensure_ascii=False))
            check('② 80A 배관 티 분기 관경', tee and tee['bore2'] == '80A', json.dumps(tee, ensure_ascii=False))
            # 관경 없는 팔레트 추가도 현재 관경을 물려받는지 (레듀샤: 입구 80A)
            red = page.evaluate("""() => {
              const a = window.__app;
              a.setCmdBore('80A', true);
              a.addEquipment('reducer');
              const r = a.state.equipment.filter((e) => e.type === 'reducer').pop();
              return r ? {bore1:r.bore1, bore2:r.bore2} : null;
            }""")
            check('② 레듀샤 입구 관경 상속(80A)', red and red['bore1'] == '80A', json.dumps(red, ensure_ascii=False))
            page.wait_for_timeout(300)
            page.evaluate("""() => {
              const a = window.__app;
              const t = a.state.equipment.find((e) => e.type === 'tee');
              if (t) a.select('equipment', t.id);
              a.setView('iso', true);
            }""")
            page.wait_for_timeout(400)
            page.screenshot(path=ROOT + '/preview-v77-bore.png')

            # ── ③ 정렬 스냅 — 이동/길이조절 ────────────────────────────────
            page.evaluate("""() => {
              const a = window.__app;
              a.clearAll();
              a.setCmdBore('80A', true);
              a.setCmdCursor({x:0,y:0,z:0}, true);
              a.execOps([{op:'seg', axis:'x', sign:1, meters:3}], {source:'cmd'});     // A: 0~3, z=0
              a.setCmdCursor({x:0,y:0,z:2}, true);
              a.execOps([{op:'seg', axis:'x', sign:1, meters:2.9}], {source:'cmd'});   // B: 0~2.9, z=2
            }""")
            page.wait_for_timeout(500)
            res3 = page.evaluate("""() => {
              const a = window.__app;
              const b = a.state.pipes[1];
              a.select('pipe', b.id);
              a.moveStep = 10;
              a.moveSelectedStep('x', 1, 0.09);     // 2.900 → 2.990 (누른 보폭 그대로, 좌표 안 당김)
              const after = b.points[b.points.length-1].x;
              const badge = document.querySelector('#alignBadge');
              const txt = badge ? badge.textContent : '';
              const shown = badge && !badge.hidden;
              const lines = (a.align3DLines || []).filter((l) => l.visible).length;
              return {after, shown, txt, lines};
            }""")
            check('③ 버튼 이동은 보폭 그대로(2.990m, 좌표 안 당김)', abs(res3['after'] - 2.99) < 1e-6,
                  f"x={res3['after']}")
            check('③ `정렬` 배지 표시', res3['shown'] and '정렬' in res3['txt'], res3['txt'])
            check('③ 밝은 점선 가이드 표시', res3['lines'] >= 1, f"선 {res3['lines']}개")
            # 미리보기 — 정면으로 돌리고 같은 정렬을 다시 띄워 점선과 배지를 남긴다
            page.evaluate("""() => {
              const a = window.__app;
              a.clearSelection();
              const b = a.state.pipes[1];
              const p = b.points[b.points.length-1];
              const probe = a.align3DProbe({x:p.x+0.02, y:p.y, z:p.z}, {tol:0.03});
              a.setView('iso', true);
              if (probe) a.showAlign3D({x:p.x, y:p.y, z:p.z}, probe);
              if (a.alignHideTimer) { clearTimeout(a.alignHideTimer); a.alignHideTimer = 0; }
            }""")
            page.wait_for_timeout(200)
            page.screenshot(path=ROOT + '/preview-v77-align.png')

            res3b = page.evaluate("""() => {
              const a = window.__app;
              const b = a.state.pipes[1];
              // 끝점을 살짝 어긋난 2.950으로 돌려 놓고, 길이 2980mm를 넣는다
              b.points[0].x = 0;
              b.points[b.points.length-1].x = 2.95;
              a.rebuild();
              const r = a.resizeSegment(b.id, 1, 2980);
              return {ok:r.ok, changed:r.changed, newMm:r.newMm, end:b.points[b.points.length-1].x,
                      badge:!document.querySelector('#alignBadge').hidden};
            }""")
            check('③ 길이조절 정렬 스냅(2980→3000mm)', res3b['changed'] and res3b['newMm'] == 3000
                  and abs(res3b['end'] - 3.0) < 1e-6, json.dumps(res3b, ensure_ascii=False))
            check('③ 길이조절 후 `정렬` 배지', res3b['badge'], json.dumps(res3b, ensure_ascii=False))

            # 손그리기 정렬 — 시작점에서 3.0m 앞까지 끌면 다른 배관 끝(3.0)에 길이가 맞춰진다
            res3c = page.evaluate("""() => {
              const a = window.__app;
              const refs = a.alignRefPoints(new Set());
              const probe = a.align3DProbe({x:2.985, y:0, z:2}, {along:'x', tol:0.03});
              const p = probe ? probe.p.x : null;
              return {refs: refs.length, p, axes: probe ? a.alignAxesText(probe.hits) : ''};
            }""")
            check('③ 손그리기 정렬 탐지(2.985→3.000)', res3c['p'] is not None and abs(res3c['p'] - 3.0) < 1e-6,
                  json.dumps(res3c, ensure_ascii=False))

            # ── ④ 키보드 위 1줄 방향 바 ──────────────────────────────────
            page.evaluate("""() => {
              const a = window.__app;
              a.setCmdBore('50A', true);
              a.kbForced = 320;             // 가상 키보드 인셋(실제 키보드와 같은 경로)
              a.focusCmdInput();
              a.applyKeyboardInset();
            }""")
            page.wait_for_timeout(500)
            bar = page.evaluate("""() => {
              const el = document.querySelector('#kbDirBar');
              const r = el.getBoundingClientRect();
              const cmd = document.querySelector('#cmdForm').getBoundingClientRect();
              return {display: getComputedStyle(el).display, h: Math.round(r.height),
                      gap: Math.round(cmd.top - r.bottom), bore: document.querySelector('#kbDirBore').textContent};
            }""")
            check('④ 키보드 열림 시 방향 바 표시', bar['display'] == 'flex' and bar['h'] > 20, json.dumps(bar, ensure_ascii=False))
            check('④ 방향 바가 명령창 바로 위', 0 <= bar['gap'] <= 12, json.dumps(bar, ensure_ascii=False))
            check('④ 방향 바에 현재 관경 표시', bar['bore'] == '50A', bar['bore'])

            page.click('[data-kbdir="x:1"]')
            page.wait_for_timeout(300)
            kb = page.evaluate("""() => {
              const a = window.__app;
              return {pending: a.pending, bore: a.cmdBore,
                      focus: document.activeElement && document.activeElement.id,
                      active: document.querySelector('[data-kbdir=\\"x:1\\"]').classList.contains('active'),
                      open: document.body.classList.contains('kb-open')};
            }""")
            check('④ 방향 버튼으로 방향 전환', kb['pending'] and kb['pending'].get('axis') == 'x' and kb['pending'].get('sign') == 1,
                  json.dumps(kb['pending'], ensure_ascii=False))
            check('④ 관경 유지(50A)', kb['bore'] == '50A', str(kb['bore']))
            check('④ 키보드·입력칸 초점 유지', kb['focus'] == 'cmdInput' and kb['open'],
                  f"focus={kb['focus']} kb-open={kb['open']}")
            page.screenshot(path=ROOT + '/preview-v77-kbd.png')

            drawn = page.evaluate("""() => {
              const a = window.__app;
              const n0 = a.state.pipes.length;
              const at = {...a.cmdCursor};
              document.querySelector('#cmdInput').value = '1000';
              document.querySelector('#cmdForm').requestSubmit();
              const n1 = a.state.pipes.length;
              const p = a.state.pipes[n1-1];
              return {n0, n1, at, leftX:p.points[p.points.length-1].x - p.points[0].x,
                      focus: document.activeElement && document.activeElement.id,
                      value: document.querySelector('#cmdInput').value};
            }""")
            check('④ 숫자만 넣고 실행 → 배관 생성', drawn['n1'] == drawn['n0'] + 1, json.dumps(drawn, ensure_ascii=False))
            check('④ 실행 뒤에도 입력칸 초점·키보드 유지', drawn['focus'] == 'cmdInput',
                  f"focus={drawn['focus']}")
            page.evaluate("""() => { const a = window.__app; a.kbForced = null; a.applyKeyboardInset(); }""")
            page.wait_for_timeout(300)

            # ── ⑤ 배관 양쪽 끝 이어그리기 ────────────────────────────────
            res5 = page.evaluate("""() => {
              const a = window.__app;
              a.clearAll();
              a.setCmdBore('80A', true);
              a.setCmdCursor({x:0,y:0,z:0}, true);
              a.execOps([{op:'seg', axis:'x', sign:1, meters:3}], {source:'cmd'});        // A: 0~3
              a.setCmdCursor({x:3,y:0,z:0}, true);
              a.execOps([{op:'seg', axis:'x', sign:1, meters:2}], {source:'cmd'});        // B: 3~5 (A 끝점을 닫음)
              const A = a.state.pipes[0];
              const openStart = !a.pipeEndAttached(A, 'start');
              const openEnd = !a.pipeEndAttached(A, 'end');
              const pref = a.pipePrefEnd(A);
              a.select('pipe', A.id);
              const panelTxt = document.querySelector('#propBody').textContent;
              return {openStart, openEnd, pref,
                      fromBtn: panelTxt.includes('시작점에서 이어 그리기'),
                      toggle: panelTxt.includes('반대쪽 끝'),
                      hint: (panelTxt.match(/시작점 (열림|연결됨)[^·]*· 끝점 (열림|연결됨)/) || [''])[0],
                      ring: !!(a.endPickRing && a.endPickRing.visible)};
            }""")
            check('⑤ 닫힌 끝/열린 끝 판별', res5['openStart'] and not res5['openEnd'],
                  json.dumps({k: res5[k] for k in ('openStart', 'openEnd', 'pref')}, ensure_ascii=False))
            check('⑤ 열린 끝(시작점) 우선 선택', res5['pref'] == 'start', str(res5['pref']))
            check('⑤ 패널에 시작점 이어그리기 버튼', res5['fromBtn'], res5['hint'])
            check('⑤ 열린 끝에 미리보기 링', res5['ring'], '')
            page.wait_for_timeout(300)
            page.screenshot(path=ROOT + '/preview-v77-both-ends.png')

            res5b = page.evaluate("""() => {
              const a = window.__app;
              const A = a.state.pipes[0];
              a.fromHere();                    // 열린 끝(시작점)에서 이어 그리기
              const c1 = {...a.cmdCursor};
              const bore1 = a.cmdBore;
              a.select('pipe', A.id);
              a.togglePipeEnd();               // 🔁 반대쪽(끝점)으로 전환
              const c2 = {...a.cmdCursor};
              return {c1, c2, bore1, pref: a.pipeEndPrefs[A.id]};
            }""")
            check('⑤ 시작점에서 이어 그리기(커서 0,0,0)', abs(res5b['c1']['x']) < 1e-6 and abs(res5b['c1']['z']) < 1e-6,
                  json.dumps(res5b['c1']))
            check('⑤ 시작점 이어그리기 관경 80A 유지', res5b['bore1'] == '80A', str(res5b['bore1']))
            check('⑤ 🔁 반대쪽(끝점) 전환', res5b['pref'] == 'end' and abs(res5b['c2']['x'] - 3.0) < 1e-6,
                  json.dumps({k: res5b[k] for k in ('c2', 'pref')}, ensure_ascii=False))

            res5c = page.evaluate("""() => {
              const a = window.__app;
              const A = a.state.pipes[0];
              a.fromHere('start');
              const n0 = a.state.pipes.length;
              // 시작점에서 반대(-X) 방향으로 1m 이어 그리기
              a.execOps([{op:'seg', axis:'x', sign:-1, meters:1}], {source:'cmd'});
              const p = a.state.pipes[a.state.pipes.length-1];
              return {n0, n1:a.state.pipes.length, start:p.points[0], end:p.points[p.points.length-1]};
            }""")
            check('⑤ 시작점에서 실제로 이어 그려짐', res5c['n1'] == res5c['n0'] + 1, json.dumps(res5c, ensure_ascii=False))

            # ── ⑥ ✋ 드래그 이동 중 3축 정렬은 **표시만**(좌표 안 끌기) ────────
            page.evaluate("""() => {
              const a = window.__app;
              a.clearAll();
              a.setCmdBore('100A', true);
              a.setCmdCursor({x:0,y:0,z:0}, true);
              a.execOps([{op:'seg', axis:'x', sign:1, meters:3}], {source:'cmd'});     // A (0,0,0)~(3,0,0)
              a.setCmdCursor({x:0,y:0,z:2}, true);
              a.execOps([{op:'seg', axis:'x', sign:1, meters:2.9}], {source:'cmd'});   // B (0,0,2)~(2.9,0,2)
              a.setCmdCursor({x:4,y:0,z:1}, true);
              a.execOps([{op:'seg', axis:'x', sign:1, meters:1}], {source:'cmd'});     // C (4,0,1)~(5,0,1)
              a.setView('iso', true);
              a.select('pipe', a.state.pipes[1].id);
              a.moveDrag = true;
            }""")
            page.wait_for_timeout(600)

            def drag(p_from, p_to, steps=6):
                # 치수 라벨(배관 가운데 알약)이 캔버스를 가리면 탭이 라벨로 간다 —
                # 실제로는 라벨을 피해 잡으면 되므로, 테스트에서는 라벨을 손가락 통과로 둔다.
                page.evaluate("() => document.querySelectorAll('.dim-label').forEach((el) => { el.style.pointerEvents = 'none'; })")
                s = page.evaluate(W2S, p_from)
                t = page.evaluate(W2S, p_to)
                hit = page.evaluate("([x, y]) => { const e = document.elementFromPoint(x, y); return e ? (e.id || e.className || e.tagName) : null; }", [s['x'], s['y']])
                page.mouse.move(s['x'], s['y'])
                page.mouse.down()
                page.mouse.move(t['x'], t['y'], steps=steps)
                page.wait_for_timeout(150)
                out = page.evaluate(DRAG_STATE)
                out['at'] = hit
                out['grab'] = s
                return out

            mid6 = drag({'x': 1.45, 'y': 0.0, 'z': 2.0}, {'x': 1.57, 'y': 0.0, 'z': 2.0})
            check('⑥ 드래그 시작', mid6['st'] and mid6['moved'],
                  json.dumps({k: mid6[k] for k in ('st', 'moved', 's0', 'e0')}, ensure_ascii=False))
            # 정렬선·배지는 뜨지만 좌표는 손가락 그대로 — 2.900 + 0.120 = 3.020 (3.000으로 안 당김)
            check('⑥ 드래그 중 X 정렬 감지(3.020m, 좌표 안 당김)', abs(mid6['e0'] - 3.02) < 0.006,
                  f"e0={mid6['e0']}")
            check('⑥ 드래그 중 `정렬` 배지', mid6['shown'] and '거리 X' in mid6['txt'], mid6['txt'])
            check('⑥ 드래그 중 밝은 점선 가이드', mid6['lines'] >= 1, f"선 {mid6['lines']}개")
            page.wait_for_timeout(120)
            page.screenshot(path=ROOT + '/preview-v77-drag-align.png')
            page.mouse.up()
            page.wait_for_timeout(200)
            keep = page.evaluate("""() => {
              const b = document.querySelector('#alignBadge');
              return {shown: !!b && !b.hidden, txt: b ? b.textContent : ''};
            }""")
            check('⑥ 손 뗀 직후 배지 유지(1.2초 예약)', keep['shown'] and '정렬' in keep['txt'], keep['txt'])
            page.wait_for_timeout(1500)
            gone = page.evaluate("""() => {
              const a = window.__app;
              const b = document.querySelector('#alignBadge');
              return {shown: !!b && !b.hidden, lines: (a.align3DLines || []).filter((l) => l.visible).length};
            }""")
            check('⑥ 1.2초 뒤 점선·배지 사라짐', (not gone['shown']) and gone['lines'] == 0,
                  json.dumps(gone, ensure_ascii=False))

            # Z(길이) 정렬 — B를 z=1 쪽으로 당기면 C(z=1)와 길이 정렬선
            page.evaluate("""() => { const a = window.__app; a.select('pipe', a.state.pipes[1].id); a.moveDrag = true; }""")
            page.wait_for_timeout(700)
            mid7 = drag({'x': 1.57, 'y': 0.0, 'z': 2.0}, {'x': 1.57, 'y': 0.0, 'z': 1.03})
            check('⑦ 드래그 Z 정렬 감지(1.030m, 좌표 안 당김)',
                  abs(mid7['s1'] - 1.03) < 0.02 and mid7['shown'] and '길이 Z' in mid7['txt'],
                  json.dumps({k: mid7[k] for k in ('s1', 'shown', 'txt')}, ensure_ascii=False))
            page.mouse.up()
            page.wait_for_timeout(300)

            # ── ⑦ 여러 개 같이 드래그 + 장비 단독 드래그 ────────────────────
            page.evaluate("""() => {
              const a = window.__app;
              a.setCmdCursor({x:0,y:0,z:6}, true);
              a.execOps([{op:'seg', axis:'x', sign:1, meters:3}], {source:'cmd'});     // H (0,0,6)~(3,0,6)
              const ids = a.state.pipes.map((q) => q.id);
              window.__multi = { b: ids[1], h: ids[ids.length - 1] };
              a.select('pipe', window.__multi.b);
              a.multiSel = [{ kind: 'pipe', id: window.__multi.h }];
              a.multiMode = true;
              a.refreshHighlight();
              a.renderProps();
              a.moveDrag = true;
            }""")
            page.wait_for_timeout(500)
            sel_before = page.evaluate("""() => {
              const a = window.__app;
              const B = a.specOf({kind:'pipe', id: window.__multi.b});
              const H = a.specOf({kind:'pipe', id: window.__multi.h});
              return {n: a.selectionList().length, b0: B.points[0].x, e0: B.points[B.points.length-1].x,
                      h0: H.points[0].x, he: H.points[H.points.length-1].x,
                      bz: B.points[0].z};
            }""")
            check('⑦ 두 개 선택됨', sel_before['n'] == 2, str(sel_before['n']))
            page.evaluate("() => document.querySelectorAll('.dim-label').forEach((el) => { el.style.pointerEvents = 'none'; })")
            s = page.evaluate(W2S, {'x': 1.5, 'y': 0.0, 'z': sel_before['bz']})
            t = page.evaluate(W2S, {'x': 1.53, 'y': 0.0, 'z': sel_before['bz']})
            page.mouse.move(s['x'], s['y'])
            page.mouse.down()
            page.mouse.move(t['x'], t['y'], steps=5)
            page.wait_for_timeout(150)
            multi = page.evaluate("""() => {
              const a = window.__app;
              const B = a.specOf({kind:'pipe', id: window.__multi.b});
              const H = a.specOf({kind:'pipe', id: window.__multi.h});
              const bd = document.querySelector('#alignBadge');
              return {moved: !!(a.moveDragState && a.moveDragState.moved),
                      b0: B.points[0].x, e0: B.points[B.points.length-1].x,
                      h0: H.points[0].x, he: H.points[H.points.length-1].x,
                      shown: !!bd && !bd.hidden, txt: bd ? bd.textContent : ''};
            }""")
            page.mouse.up()
            page.wait_for_timeout(300)
            db0 = multi['b0'] - sel_before['b0']
            de0 = multi['e0'] - sel_before['e0']
            dh0 = multi['h0'] - sel_before['h0']
            dhe = multi['he'] - sel_before['he']
            check('⑦ 여러 개 같이 드래그 — 같은 Δ로 함께 이동',
                  multi['moved'] and abs(db0 - dh0) < 0.006 and abs(de0 - dhe) < 0.006 and dh0 > 0.01,
                  f'ΔB=({db0:.3f},{de0:.3f}) ΔH=({dh0:.3f},{dhe:.3f})')
            check('⑦ 여러 개 드래그 중 `정렬` 배지', multi['shown'] and '정렬' in multi['txt'], multi['txt'])

            page.evaluate("""() => {
              const a = window.__app;
              a.setCmdBore('100A', true);
              a.addEquipment('pump');
              const v = a.state.equipment[a.state.equipment.length - 1];
              v.x = 1.5; v.y = 0; v.z = 2;
              a.rebuild();
              a.selection = { kind: 'equipment', id: v.id };
              a.multiSel = [];
              a.multiMode = false;
              a.refreshHighlight();
              a.setDims(false);
              a.moveDrag = true;
            }""")
            page.wait_for_timeout(900)
            # focusSelectedInView의 카메라 이동이 끝난 뒤 도면 전체로 맞추고, 시트가 3D를 가리지 않게 한다
            page.evaluate("""() => {
              const a = window.__app;
              a.camAnim = null;
              a.setView('iso', true);
              document.querySelector('#props').hidden = true;
              document.querySelectorAll('.dim-label').forEach((el) => { el.style.pointerEvents = 'none'; });
            }""")
            page.wait_for_timeout(400)
            s = page.evaluate(W2S, {'x': 1.5, 'y': 0.0, 'z': 2.0})
            t = page.evaluate(W2S, {'x': 3.03, 'y': 0.0, 'z': 2.0})
            page.mouse.move(s['x'], s['y'])
            page.mouse.down()
            page.mouse.move(t['x'], t['y'], steps=8)
            page.wait_for_timeout(150)
            eq = page.evaluate("""() => {
              const a = window.__app;
              const v = a.state.equipment[a.state.equipment.length - 1];
              const bd = document.querySelector('#alignBadge');
              return {moved: !!(a.moveDragState && a.moveDragState.moved), x: v.x, z: v.z,
                      shown: !!bd && !bd.hidden, txt: bd ? bd.textContent : ''};
            }""")
            page.mouse.up()
            page.wait_for_timeout(300)
            check('⑦ 장비 단독 드래그 — 좌표는 손가락 그대로',
                  eq['moved'] and abs(eq['x'] - 3.03) < 0.06 and abs(eq['z'] - 2.0) < 0.02,
                  json.dumps(eq, ensure_ascii=False))
            check('⑦ 장비 드래그 중 `정렬` 배지', eq['shown'] and '정렬' in eq['txt'], eq['txt'])

            # ── ⑧ 🧲 자석은 60mm 이내에서만, 꺼 두면 절대 안 붙는다 ──────────
            res8 = page.evaluate("""() => {
              const a = window.__app;
              a.clearAll();
              a.setCmdBore('100A', true);
              a.setCmdCursor({x:0,y:0,z:0}, true);
              a.execOps([{op:'seg', axis:'x', sign:1, meters:3}], {source:'cmd'});   // A: 0~3
              a.setCmdCursor({x:3.05,y:0,z:0}, true);
              a.execOps([{op:'seg', axis:'x', sign:1, meters:1}], {source:'cmd'});   // B: 3.05~4.05 (5cm 틈)
              const B = a.state.pipes[1];
              const setB = (x) => { B.points[0].x = x; B.points[1].x = r3x(x + 1); a.rebuild(); };
              function r3x(v) { return Math.round(v * 1000) / 1000; }
              a.setMagnetSnap(false, true);
              const off = a.moveMagnetSnap([{spec:B}], new Set());
              const offX = B.points[0].x;
              a.setMagnetSnap(true, true);
              setB(3.05);
              const near = a.moveMagnetSnap([{spec:B}], new Set());
              const nearX = B.points[0].x;
              setB(3.10);
              const far = a.moveMagnetSnap([{spec:B}], new Set());
              const farX = B.points[0].x;
              setB(3.04);
              const near2 = a.moveMagnetSnap([{spec:B}], new Set());
              a.setMagnetSnap(true, true);
              return {off: !!off, offX, near: !!near, nearX, far: !!far, farX,
                      near2: !!near2, near2X: B.points[0].x};
            }""")
            check('⑧ 자석 OFF — 5cm 앞에서도 안 붙음', (not res8['off']) and abs(res8['offX'] - 3.05) < 1e-6,
                  json.dumps(res8, ensure_ascii=False))
            check('⑧ 자석 ON — 5cm 이내는 0.000m로 붙음', res8['near'] and abs(res8['nearX'] - 3.0) < 1e-6,
                  json.dumps({k: res8[k] for k in ('near', 'nearX')}, ensure_ascii=False))
            check('⑧ 자석 ON — 10cm 밖은 안 붙음(범위 60mm 축소)', (not res8['far']) and abs(res8['farX'] - 3.10) < 1e-6,
                  json.dumps({k: res8[k] for k in ('far', 'farX')}, ensure_ascii=False))

            # ── 콘솔 오류 ────────────────────────────────────────────────
            jserrs = page.evaluate('(window.__errors||[]).slice(0,8)')
            check('콘솔 오류 0건', len(errs) == 0 and len(jserrs) == 0,
                  f'console={errs[:3]} js={jserrs[:3]}')

            b.close()
    finally:
        srv.terminate()

    bad = [r for r in results if not r[1]]
    print('\n=== 요약 ===')
    print(f'{len(results) - len(bad)}/{len(results)} 통과')
    for name, ok, detail in results:
        if not ok:
            print(f'  FAIL {name} — {detail}')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
