#!/usr/bin/env python3
"""v76 검증 — 390×844 모바일 뷰포트 실브라우저.

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
            page.goto(BASE + '?v=76', wait_until='networkidle')
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
            page.screenshot(path=ROOT + '/preview-v76-toast.png')
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
            page.screenshot(path=ROOT + '/preview-v76-bore.png')

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
              a.moveSelectedStep('x', 1, 0.09);     // 끝점 2.900 → 2.990 → 3.000으로 딸깍
              const after = b.points[b.points.length-1].x;
              const badge = document.querySelector('#alignBadge');
              const txt = badge ? badge.textContent : '';
              const shown = badge && !badge.hidden;
              const lines = (a.align3DLines || []).filter((l) => l.visible).length;
              return {after, shown, txt, lines};
            }""")
            check('③ 이동 시 X 정렬 스냅(3.000m)', abs(res3['after'] - 3.0) < 1e-6,
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
            page.screenshot(path=ROOT + '/preview-v76-align.png')

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
            page.screenshot(path=ROOT + '/preview-v76-kbd.png')

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
            page.screenshot(path=ROOT + '/preview-v76-both-ends.png')

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
