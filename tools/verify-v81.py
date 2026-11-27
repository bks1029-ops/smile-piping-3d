#!/usr/bin/env python3
"""v81 검증 — 🖨️ 도면 인쇄 · 컷 담기 (390×844 모바일 · 1280×800 데스크톱 실브라우저).

사용자 요청(2026-11-27): 폰에서 그린 전체 배관 도면을 PC로 옮겨 **전체 모습 + 구역별 확대 컷**을
UI 버튼·조이스틱·명령창 없이 깨끗하게, 어두운 배경 대신 **흰 종이**로 여러 장 인쇄하고 싶다.

검사 항목
 A. 진입 — 모바일 ☰ → 파일 탭 `🖨️ 도면 인쇄 · 컷 담기`, 데스크톱 상단 `내보내기` 버튼
 B. 흰 배경 컷 — 빈 장면: 모서리 (255,255,255)·흰 픽셀 90% 이상 / 샘플 장면: 진한 형상 픽셀 2%↑
 C. UI 안 섞임 — 패널을 닫은 채 담은 그림 == 패널을 연 채 담은 그림 (같은 카메라)
 D. 3D 보조물리 안 섞임 — 장비를 골라 주황 상자·커서가 떠 있어도 담은 그림은 같은 화면
 E. 치수 라벨 — 켜면 `1000mm (80A)` 라벨이 그림 위에 다시 그려지고, 끄면 빠진다
 F. 화면 복원 — 담은 뒤 scene.background·fog·바닥 재질·clearAlpha 가 원래대로(어두운 화면)
 G. 여러 컷 — 카메라를 옮겨 가며 담기(컷 1·2·3), 제목·메모 고치기, 삭제, 전체 지우기
 H. 빠른 출력 — `📷 1장 PNG 저장` 다운로드(PNG 서명·크기), `🖨️ 바로 인쇄`(window.print 1회)
 I. A4 시트 — 페이지 수(컷+자재표), 머리글(스마일산업 3D 배관 도면·날짜·컷 수), 컷 그림 data:image/png
 J. 1장에 2컷 — 페이지 묶음이 2컷씩
 K. 자재·배관 수량표 — 관경별 길이 합·부속 수량이 실제 도면 값과 일치
 L. 인쇄 미디어 — @media print 에서 #app 은 none, #printSheet 만 block (미리보기 캡처)
 M. 컷은 메모리에만 — localStorage 에 이미지가 쌓이지 않는다
 N. 저장 타이밍 — scheduleSave() 대기 중 pagehide / visibilitychange(hidden) 에서 즉시 기록
 O. 콘솔 오류 0건 (window.__errors 포함)
"""
import functools
import http.server
import json
import os
import socketserver
import sys
import threading
from playwright.sync_api import sync_playwright

PORT = 8781
ROOT = '/workspace/projects/smile-piping-3d'
LIVE = 'https://bks1029-ops.github.io/smile-piping-3d/'
BASE = LIVE if '--live' in sys.argv else f'http://127.0.0.1:{PORT}/'
results = []


def check(name, ok, detail=''):
    results.append((name, bool(ok), detail))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''))


class Quiet(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True


class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


# ── 페이지 안 도우미 ────────────────────────────────────────────────────
HELPERS = '''() => {
  const a = window.__app;
  window.__P = {
    // 담은 PNG의 픽셀 통계 — 흰 종이인지, 형상이 그려졌는지, UI 색이 섞였는지
    async pixels(url) {
      const img = new Image();
      img.src = url;
      await img.decode();
      const cv = document.createElement('canvas');
      cv.width = img.naturalWidth;
      cv.height = img.naturalHeight;
      const g = cv.getContext('2d');
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, cv.width, cv.height).data;
      const W = cv.width, H = cv.height;
      const lum = (i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      let n = 0, sum = 0, pure = 0, dark = 0, mid = 0, noir = 0;
      for (let i = 0; i < d.length; i += 4 * 5) {
        const L = lum(i);
        n += 1; sum += L;
        if (L > 252) pure += 1;
        if (L < 110) dark += 1;
        if (L >= 110 && L < 235) mid += 1;
        if (d[i + 3] < 250) noir += 1;
      }
      const at = (x, y) => { const i = (y * W + x) * 4; return [d[i], d[i + 1], d[i + 2]]; };
      return {
        size: [W, H], mean: +(sum / n).toFixed(1),
        pure: +(pure / n).toFixed(3), dark: +(dark / n).toFixed(3), mid: +(mid / n).toFixed(3),
        alphaLt250: +(noir / n).toFixed(3),
        corners: [at(3, 3), at(cv.width - 4, 3), at(3, cv.height - 4), at(cv.width - 4, cv.height - 4)],
      };
    },
    // 지금 그려지고 있는(GL) 화면의 한 점 색 — 화면 테마가 어두운지 확인
    livePixel(x, y) {
      const gl = a.renderer.domElement;
      const cv = document.createElement('canvas');
      cv.width = gl.width; cv.height = gl.height;
      const g = cv.getContext('2d');
      g.drawImage(gl, 0, 0);
      const d = g.getImageData(Math.round(x), Math.round(y), 1, 1).data;
      return [d[0], d[1], d[2]];
    },
    sceneState() {
      const s = a.scene;
      return {
        bg: s.background ? s.background.getHexString() : null,
        fog: s.fog ? [s.fog.near, s.fog.far, s.fog.color.getHexString()] : null,
        groundIsDark: a.ground.visible && a.ground.material === a.groundMat,
        alpha: a.renderer.getClearAlpha(),
      };
    },
    paneHtml() {
      return {
        pages: document.querySelectorAll('#printSheet .ps-page').length,
        figs: document.querySelectorAll('#printSheet .ps-fig').length,
        twoUp: document.querySelectorAll('#printSheet .ps-2up').length,
        heads: Array.from(document.querySelectorAll('#printSheet .ps-brand b')).map((b) => b.textContent),
        metas: Array.from(document.querySelectorAll('#printSheet .ps-meta')).map((b) => b.textContent.trim()),
        srcs: Array.from(document.querySelectorAll('#printSheet img')).map((i) => (i.src || '').slice(0, 15)),
        tables: Array.from(document.querySelectorAll('#printSheet table')).map((t) => t.innerText),
        captions: Array.from(document.querySelectorAll('#printSheet figcaption')).map((f) => f.innerText),
        sheetDisplay: getComputedStyle(document.querySelector('#printSheet')).display,
        appDisplay: getComputedStyle(document.querySelector('#app')).display,
        sheetW: Math.round(document.querySelector('#printSheet').getBoundingClientRect().width),
        docW: document.documentElement.scrollWidth,
      };
    },
    // 화면에 보이는 컷 목록의 글자/그림 상태
    list() {
      return Array.from(document.querySelectorAll('#ppList .pp-cut')).map((li) => ({
        id: li.dataset.id,
        title: li.querySelector('.pp-title-in').value,
        memo: li.querySelector('.pp-memo-in').value,
        thumbOk: (li.querySelector('.pp-thumb').src || '').indexOf('data:image/') === 0,
      }));
    },
    // 저장 타이밍 — 대기 중 저장이 남아 있는지
    saveState() {
      let raw = null;
      try { raw = localStorage.getItem('smilePiping3D.v1'); } catch (e) { /* ignore */ }
      let saved = null;
      try { saved = raw ? JSON.parse(raw) : null; } catch (e) { /* ignore */ }
      return {
        timer: !!a.saveTimer,
        savedPipes: saved && saved.pipes ? saved.pipes.length : 0,
        savedX: saved && saved.pipes && saved.pipes[0] ? saved.pipes[0].points[0].x : null,
        stateX: a.state.pipes[0] ? a.state.pipes[0].points[0].x : null,
      };
    },
  };
  return true;
}'''


def collect(page):
    return page.evaluate('() => ({ errs: window.__errors.slice(), cuts: __app.cuts.length })')


def run(browser, viewport, mobile, shots):
    """한 뷰포트에서 A~O 를 차례로 검사한다."""
    tag = '모바일' if mobile else '데스크톱'
    page = browser.new_page(viewport=viewport, device_scale_factor=2 if mobile else 1,
                            is_mobile=mobile, has_touch=mobile)
    errs = []
    page.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.goto(BASE + '?v=81', wait_until='networkidle')
    page.wait_for_function('window.__app && window.__app.state', timeout=30000)
    page.wait_for_timeout(800)
    page.evaluate(HELPERS)
    page.evaluate('() => { window.print = () => { window.__printed = (window.__printed || 0) + 1; }; }')

    # ── A. 진입 경로 ────────────────────────────────────────────────
    if mobile:
        page.click('#btnDrawer')
        page.wait_for_timeout(300)
        page.click('#tabs .tab[data-tab="file"]')
        page.wait_for_timeout(200)
        page.click('#btnPrintSheet')
    else:
        page.click('#btnExport')
    page.wait_for_timeout(350)
    st = page.evaluate('''() => ({
      open: !document.querySelector('#printPanel').hidden,
      drawer: document.querySelector('#drawer').classList.contains('open'),
      add: !!document.querySelector('#ppAdd'),
      label: (document.querySelector('#btnPrintSheet') || {}).textContent,
    })''')
    check(f'[{tag}] A. {"☰ → 파일" if mobile else "내보내기"} 버튼으로 인쇄 패널이 열린다',
          st['open'] and st['add'], json.dumps(st, ensure_ascii=False))
    if mobile:
        check(f'[{tag}] A. 파일 탭 버튼 이름이 「🖨️ 도면 인쇄 · 컷 담기」',
              '도면 인쇄 · 컷 담기' in (st['label'] or ''), st['label'])
        check(f'[{tag}] A. 패널을 열면 도구 서랍은 닫힌다', not st['drawer'], str(st['drawer']))

    # ── B. 흰 배경 컷 — 빈 장면 ─────────────────────────────────────
    page.evaluate('() => { const a = __app; a.clearAll({ silent: true }); a.camAnim = null; }')
    page.wait_for_timeout(200)
    empty = page.evaluate('''async () => {
      const cap = __app.captureView({ white: true, dims: false });
      const px = await window.__P.pixels(cap.url);
      return { px, white: cap.white, size: [cap.w, cap.h], canvas: [__app.renderer.domElement.width, __app.renderer.domElement.height] };
    }''')
    px = empty['px']
    corners_ok = all(all(c >= 250 for c in c) for c in px['corners'])
    check(f'[{tag}] B. 빈 장면 흰 배경 — 모서리 4곳 모두 (255,255,255) 근처', corners_ok,
          json.dumps(px['corners']))
    check(f'[{tag}] B. 빈 장면 흰 배경 — 평균 250 이상·진한 픽셀 1% 미만 (가는 회색 격자선만)',
          px['mean'] >= 250 and px['dark'] < 0.01 and px['pure'] >= 0.6,
          f"흰 {px['pure']*100:.1f}% · 평균 {px['mean']} · 진한 {px['dark']*100:.2f}%")
    check(f'[{tag}] B. 담은 그림 크기 = GL 캔버스 크기', empty['size'] == empty['canvas'],
          f"{empty['size']} vs {empty['canvas']}")

    # ── B2. 샘플 장면 — 형상 픽셀 ───────────────────────────────────
    page.evaluate('''() => {
      const a = __app;
      a.state = { ...a.state, equipment: [], pipes: [] };
      a.rebuild();
    }''')
    page.wait_for_timeout(150)
    page.evaluate('''() => {
      const a = __app;
      a.state = window.__sample ? window.__sample : a.state;
    }''')
    # 샘플 씬은 모듈에서 직접 만든다(저장본에 기대지 않게)
    page.evaluate('''async () => {
      const S = await import('./js/store.js?v=81');
      const a = __app;
      a.state = S.sampleScene();
      a.selection = null;
      a.camAnim = null;
      a.camera.position.set(12, 9.5, 13);
      a.controls.target.set(0, 1.2, -1.6);
      a.controls.update();
      a.rebuild();
    }''')
    page.wait_for_timeout(400)
    sample = page.evaluate('''async () => {
      const cap = __app.captureView({ white: true, dims: false });
      return await window.__P.pixels(cap.url);
    }''')
    check(f'[{tag}] B. 샘플 장면 흰 배경 — 진한 형상 픽셀 2% 이상 (빈 종이가 아님)',
          sample['dark'] >= 0.02, f"진한 {sample['dark']*100:.1f}% · 중간 {sample['mid']*100:.1f}% · 평균 {sample['mean']}")
    check(f'[{tag}] B. 샘플 장면 흰 배경 — 여전히 종이가 밝다 (평균 200 이상)',
          sample['mean'] >= 200, f"평균 {sample['mean']}")
    check(f'[{tag}] B. 담은 PNG에 투명 픽셀이 없다 (종이가 실제 흰색)', sample['alphaLt250'] < 0.02,
          f"투명 {sample['alphaLt250']*100:.1f}%")

    # ── C. UI 안 섞임 — 패널 열림/닫힘 두 번 담아 비교 ───────────────
    ui = page.evaluate('''() => {
      const a = __app;
      const open = a.captureView({ white: true, dims: false }).url;
      a.setDrawerOpen(false);
      a.closePrintPanel();
      const closed = a.captureView({ white: true, dims: false }).url;
      a.openPrintPanel();
      return { same: open === closed, len: open.length };
    }''')
    check(f'[{tag}] C. 패널·서랍을 닫은 채 담은 그림과 연 채 담은 그림이 같다 (UI 미포함)',
          ui['same'], f"같음 {ui['same']} · PNG {ui['len']}자")

    # ── D. 선택 상자·커서가 그림에 안 들어간다 ──────────────────────
    sel = page.evaluate('''() => {
      const a = __app;
      const e = a.state.equipment.find((q) => q.type === 'pump') || a.state.equipment[0];
      a.select('equipment', e.id);
      const helpers = (a.helpers || []).map((h) => h.visible);
      const withSel = a.captureView({ white: true, dims: false }).url;
      a.clearSelection();
      const noSel = a.captureView({ white: true, dims: false }).url;
      return { helpers, same: withSel === noSel, cursor: !!(a.cmdMarker && a.cmdMarker.visible) };
    }''')
    check(f'[{tag}] D. 장비를 골라 주황 상자가 떠 있어도 담은 그림은 그대로', sel['same'],
          f"보조물리 {sel['helpers']} · 같음 {sel['same']}")
    check(f'[{tag}] D. 담은 뒤 선택 상자는 원래대로 보인다', any(sel['helpers']), json.dumps(sel))

    # ── E. 치수 라벨 ────────────────────────────────────────────────
    dims = page.evaluate('''async () => {
      const a = __app;
      a.setDims(true);                  // 모든 배관 치수 표시
      a.rebuild();
      a.camera.updateMatrixWorld(true);
      a.updateDims();
      await new Promise((r) => setTimeout(r, 120));
      const label = Array.from(document.querySelectorAll('#dimLayer .dim-label'))
        .find((el) => el.style.display !== 'none' && /mm/.test(el.textContent));
      const on = a.captureView({ white: true, dims: true });
      const off = a.captureView({ white: true, dims: false });
      const onPx = await window.__P.pixels(on.url);
      const offPx = await window.__P.pixels(off.url);
      return { label: label ? label.textContent : null, onDims: on.dims, offDims: off.dims,
               differ: on.url !== off.url, onMid: onPx.mid, offMid: offPx.mid };
    }''')
    check(f'[{tag}] E. 「치수 라벨 함께 담기」를 켜면 라벨을 그림 위에 다시 그린다',
          dims['onDims'] >= 1 and dims['label'] and 'mm' in (dims['label'] or ''),
          f"라벨 {dims['label']} · 그린 개수 {dims['onDims']}")
    check(f'[{tag}] E. 라벨을 끄면 빠진다 (두 그림이 다르고, 끈 쪽 라벨 0개)',
          dims['offDims'] == 0 and dims['differ'], f"켬 {dims['onDims']} · 끔 {dims['offDims']}")

    # ── F. 화면 테마 복원 ───────────────────────────────────────────
    restored = page.evaluate('''() => {
      const a = __app;
      a.captureView({ white: true, dims: true });
      const s = window.__P.sceneState();
      const px = window.__P.livePixel(4, 4);
      return { scene: s, corner: px, tone: a.renderer.toneMapping };
    }''')
    sc = restored['scene']
    check(f'[{tag}] F. 담은 뒤 배경·안개·바닥 재질·clearAlpha 모두 원래(어두운 화면)',
          sc['bg'] == '0d1014' and sc['fog'] and sc['fog'][:2] == [70, 140]
          and sc['groundIsDark'] and sc['alpha'] == 1,
          json.dumps(sc))
    check(f'[{tag}] F. 담은 직후 화면 모서리가 어둡다 (테마 즉시 복원)',
          all(c <= 40 for c in restored['corner']), json.dumps(restored['corner']))

    # ── G. 여러 컷 담기 · 제목/메모 · 삭제 · 전체 지우기 ────────────
    page.evaluate('() => { const a = __app; a.setDims(false); a.clearCuts(); }')
    page.wait_for_timeout(150)
    page.click('#ppAdd')
    page.wait_for_timeout(400)
    page.evaluate('''() => { const a = __app; a.camAnim = null;
      a.camera.position.set(2.4, 2.6, 6.2); a.controls.target.set(-1.2, 1.0, -1.6); a.controls.update(); }''')
    page.wait_for_timeout(150)
    page.click('#ppAdd')
    page.wait_for_timeout(400)
    page.evaluate('''() => { const a = __app; a.camAnim = null;
      a.camera.position.set(-5.2, 1.6, 3.4); a.controls.target.set(-4.2, 1.0, -3.0); a.controls.update(); }''')
    page.wait_for_timeout(150)
    page.click('#ppAdd')
    page.wait_for_timeout(500)
    lst = page.evaluate('() => window.__P.list()')
    check(f'[{tag}] G. 화면을 옮겨 가며 담으면 컷 1·2·3 이 쌓인다',
          [x['title'] for x in lst] == ['컷 1', '컷 2', '컷 3'], json.dumps([x['title'] for x in lst], ensure_ascii=False))
    check(f'[{tag}] G. 컷마다 작은 그림이 보인다 (검은 칸 아님)', all(x['thumbOk'] for x in lst),
          json.dumps([x['thumbOk'] for x in lst]))
    page.fill('#ppList .pp-cut:nth-child(2) .pp-title-in', '펌프 구역')
    page.fill('#ppList .pp-cut:nth-child(2) .pp-memo-in', 'P-101 토출 정면')
    page.wait_for_timeout(150)
    page.click('#ppList .pp-cut:nth-child(3) button[data-act="del"]')
    page.wait_for_timeout(250)
    lst = page.evaluate('() => window.__P.list()')
    check(f'[{tag}] G. 제목·메모를 고치고 컷 하나를 지울 수 있다',
          len(lst) == 2 and lst[1]['title'] == '펌프 구역' and lst[1]['memo'] == 'P-101 토출 정면',
          json.dumps(lst, ensure_ascii=False))
    check(f'[{tag}] G. 남은 컷 그림은 지워진 컷의 것이 아니다', len(lst) == 2, str(len(lst)))
    with page.expect_download() as dl2:
        page.click('#ppList .pp-cut:nth-child(1) button[data-act="png"]')
    d2 = dl2.value
    p2 = os.path.join('/workspace/tmp', 'v81-cut1.png')
    d2.save_as(p2)
    with open(p2, 'rb') as fh:
        head2 = fh.read(8)
    check(f'[{tag}] G. 컷마다 「PNG 저장」 — PNG 파일이 내려온다',
          head2[:4] == b'\x89PNG' and os.path.getsize(p2) > 20000,
          f"{d2.suggested_filename} · {os.path.getsize(p2)}바이트")

    # ── H. 빠른 출력 — PNG 1장 / 바로 인쇄 ──────────────────────────
    with page.expect_download() as dl:
        page.click('#ppQuickPng')
    d = dl.value
    path = os.path.join('/workspace/tmp', 'v81-quick.png')
    d.save_as(path)
    with open(path, 'rb') as fh:
        head = fh.read(8)
    check(f'[{tag}] H. 「📷 1장 PNG 저장」이 PNG 파일을 내려준다',
          head[:4] == b'\x89PNG' and os.path.getsize(path) > 20000,
          f"{d.suggested_filename} · {os.path.getsize(path)}바이트")
    printed = page.evaluate('''() => { window.__printed = 0; return true; }''')
    page.click('#ppQuickPrint')
    page.wait_for_timeout(600)
    pr = page.evaluate('() => ({ printed: window.__printed, info: __app.printSheetInfo })')
    check(f'[{tag}] H. 「🖨️ 바로 인쇄」가 지금 화면 1장짜리 시트로 인쇄를 부른다',
          pr['printed'] == 1 and pr['info'] and pr['info']['cuts'] == 1,
          json.dumps(pr, ensure_ascii=False))

    # ── I. A4 시트 — 컷 + 자재표 ────────────────────────────────────
    page.evaluate('() => { window.__printed = 0; }')
    page.click('#ppPrint')
    page.wait_for_timeout(800)
    sheet = page.evaluate('() => window.__P.paneHtml()')
    pr2 = page.evaluate('() => ({ printed: window.__printed, info: __app.printSheetInfo })')
    check(f'[{tag}] I. 「A4 도면 인쇄 / PDF 저장」이 인쇄를 부른다 (window.print 1회)',
          pr2['printed'] == 1, json.dumps(pr2, ensure_ascii=False))
    check(f'[{tag}] I. 페이지 = 컷 2장 + 자재 수량표 1장', sheet['pages'] == 3 and sheet['figs'] == 2,
          f"페이지 {sheet['pages']} · 그림 {sheet['figs']} · 2컷배치 {sheet['twoUp']}")
    check(f'[{tag}] I. 머리글이 「스마일산업 3D 배관 도면」 + 날짜·컷 2장',
          all(h == '스마일산업 3D 배관 도면' for h in sheet['heads'])
          and all(('컷 2장' in m and '-' in m) for m in sheet['metas']),
          json.dumps(sheet['metas'][:2], ensure_ascii=False))
    check(f'[{tag}] I. 컷 그림이 data:image/png 로 들어간다', all(s.startswith('data:image/png') for s in sheet['srcs']),
          json.dumps(sheet['srcs'], ensure_ascii=False))
    check(f'[{tag}] I. 컷 제목·메모가 그림 설명으로 들어간다',
          any('펌프 구역' in c and 'P-101 토출 정면' in c for c in sheet['captions']),
          json.dumps(sheet['captions'], ensure_ascii=False))

    # ── K. 자재·배관 수량표 값 ──────────────────────────────────────
    bom = page.evaluate('''() => {
      const a = __app, b = a.buildBom();
      return { pipes: b.pipes.map((r) => [r.bore, r.material, +r.len.toFixed(2), r.segs]),
               totalLen: +b.totalLen.toFixed(2), pipeCount: b.pipeCount, equip: b.equipCount,
               parts: b.parts.reduce((s, r) => s + r.qty, 0),
               table: document.querySelectorAll('#printSheet table')[0].innerText };
    }''')
    pipes = page.evaluate('''async () => {
      const S = await import('./js/store.js?v=81');
      const a = __app;
      return a.state.pipes.reduce((s, p) => s + S.pipeLength(p.points), 0);
    }''')
    check(f'[{tag}] K. 수량표 합계 길이가 실제 배관 길이와 같다',
          abs(bom['totalLen'] - pipes) < 0.02, f"표 {bom['totalLen']}m · 실측 {pipes:.2f}m")
    check(f'[{tag}] K. 관경별 줄과 개수가 표에 그대로 들어간다',
          all(r[0] in bom['table'] for r in bom['pipes']) and '합계' in bom['table'],
          json.dumps(bom['pipes'][:3], ensure_ascii=False))
    eq = page.evaluate('''() => ({
      total: __app.state.equipment.length,
      equipCat: __app.state.equipment.filter((e) => e.type === 'hx' || e.type === 'pump'
        || e.type === 'vpump' || e.type === 'tank' || e.type === 'stank' || e.type === 'rtank'
        || e.type === 'panel' || e.type === 'header').length,
    })''')
    check(f'[{tag}] K. 수량표가 장비·부속을 하나도 빠짐없이 센다 (장비 10 + 나머지 = 전체)',
          bom['equip'] == eq['equipCat'] and bom['parts'] == eq['total'] and eq['equipCat'] + (eq['total'] - eq['equipCat']) == eq['total'],
          f"장비 {bom['equip']}/{eq['equipCat']} · 표 전체 {bom['parts']} vs 도면 {eq['total']}")

    # ── J. 한 장에 2컷 ─────────────────────────────────────────────
    page.evaluate('''() => { const a = __app; a.addCut(); a.ppPerPage = 2; a.syncPrintOptions(); }''')
    page.wait_for_timeout(300)
    two = page.evaluate('''async () => {
      const a = __app;
      const info = await a.buildPrintSheet(a.cuts, { perPage: 2 });
      return { info, pages: document.querySelectorAll('#printSheet .ps-page').length,
               twoUp: document.querySelectorAll('#printSheet .ps-2up').length,
               figs: document.querySelectorAll('#printSheet .ps-fig').length };
    }''')
    check(f'[{tag}] J. 「한 장에 2컷」 — 컷 3장이 2페이지(2+1)로 묶인다',
          two['twoUp'] == 2 and two['figs'] == 3 and two['pages'] == 3,
          json.dumps(two, ensure_ascii=False))

    # ── L. 인쇄 미디어 ─────────────────────────────────────────────
    page.emulate_media(media='print')
    page.wait_for_timeout(400)
    pm = page.evaluate('''() => {
      const st = window.__P.paneHtml();
      const page1 = document.querySelector('#printSheet .ps-page');
      const cs = getComputedStyle(page1);
      const fig = getComputedStyle(document.querySelector('#printSheet .ps-fig'));
      const top = page1.getBoundingClientRect();
      return { sheet: st.sheetDisplay, app: st.appDisplay, pageBreak: cs.breakAfter,
               figInside: fig.breakInside, pageBox: [Math.round(top.left), Math.round(top.top), Math.round(top.width)],
               bodyBg: getComputedStyle(document.body).backgroundColor };
    }''')
    check(f'[{tag}] L. @media print — 앱 화면은 숨고 시트만 보인다',
          pm['app'] == 'none' and pm['sheet'] == 'block', json.dumps(pm))
    check(f'[{tag}] L. 시트는 한 컷마다 페이지를 넘긴다 (break-after: page)',
          pm['pageBreak'] == 'page' and pm['figInside'] == 'avoid', json.dumps(pm))
    page.emulate_media(media='screen')
    page.wait_for_timeout(200)

    # ── P. 뒤로가기 — 열린 인쇄 패널이 페이지를 벗어나지 않고 닫힌다 ──
    back = page.evaluate('''async () => {
      const a = __app;
      a.openPrintPanel();
      const opened = !document.querySelector('#printPanel').hidden;
      history.back();
      await new Promise((r) => setTimeout(r, 350));
      return { opened, closed: document.querySelector('#printPanel').hidden,
               url: location.pathname };
    }''')
    check(f'[{tag}] P. 뒤로가기는 인쇄 패널만 닫고 페이지는 그대로 둔다',
          back['opened'] and back['closed'], json.dumps(back, ensure_ascii=False))

    # ── 미리보기 — 전체 + 구역별 확대 3컷을 1컷/페이지 A4 시트로 ──────
    if shots:
        page.evaluate('''async () => {
          const S = await import('./js/store.js?v=81');
          const a = __app;
          a.state = S.sampleScene();
          a.selection = null;
          a.clearCuts();
          a.ppPerPage = 1; a.syncPrintOptions();
          a.setDims(false); a.setPrintBg('white');
          a.rebuild();
          a.closePrintPanel();
          const shot = (title, memo, cam, look) => {
            a.camAnim = null;
            a.camera.position.set(cam[0], cam[1], cam[2]);
            a.controls.target.set(look[0], look[1], look[2]);
            a.controls.update();
            a.camera.updateMatrixWorld(true);
            const c = a.addCut();
            if (c) { c.title = title; c.memo = memo; }
          };
          shot('컷 1 · 전체', '등각 — 설비 전체 배치', [12, 9.5, 13], [0, 1.2, -1.6]);
          shot('컷 2 · 펌프 구역', 'P-101·P-102 토출 배관과 매니폴드', [1.2, 2.6, 4.6], [-0.6, 1.0, 0.6]);
          shot('컷 3 · 열교환기 구역', 'E-101·E-102와 연결 노즐', [1.6, 3.2, 2.4], [-1.5, 1.2, -4.2]);
          a.renderCutList();
          await a.buildPrintSheet(a.cuts);
        }''')
        page.wait_for_timeout(500)
        url = page.evaluate('() => __app.cuts[0].url')
        import base64
        with open(ROOT + '/preview-v81-cut-white.png', 'wb') as fh:
            fh.write(base64.b64decode(url.split(',', 1)[1]))
        print('  흰 배경 컷 저장:', ROOT + '/preview-v81-cut-white.png')
        page.emulate_media(media='print')
        page.set_viewport_size({'width': 794, 'height': 1123})
        page.evaluate('''() => { const s = document.querySelector('#printSheet');
          s.dataset.prevPad = s.style.padding; s.style.padding = '0 9mm'; }''')
        page.wait_for_timeout(400)
        page.screenshot(path=ROOT + '/preview-v81-sheet.png', full_page=True)
        page.evaluate('''() => { const s = document.querySelector('#printSheet');
          s.style.padding = s.dataset.prevPad || ''; }''')
        page.set_viewport_size(viewport)
        page.emulate_media(media='screen')
        print('  A4 시트 미리보기 저장:', ROOT + '/preview-v81-sheet.png')

    # ── M. 컷은 메모리에만 ─────────────────────────────────────────
    mem = page.evaluate('''() => {
      const keys = Object.keys(localStorage);
      const big = keys.filter((k) => (localStorage.getItem(k) || '').length > 200000);
      return { keys, big, cuts: __app.cuts.length, inMemory: __app.cuts.every((c) => c.url.indexOf('data:image/png') === 0) };
    }''')
    check(f'[{tag}] M. 컷 그림은 localStorage에 쌓이지 않는다 (메모리에만)', not mem['big'] and mem['inMemory'],
          f"키 {mem['keys']} · 큰 값 {mem['big']}")

    # ── N. 저장 타이밍 — pagehide / visibilitychange ────────────────
    saved = page.evaluate('''() => {
      const a = __app;
      localStorage.removeItem('smilePiping3D.v1');
      // 배관 하나를 옮긴 셈 치고 좌표를 바꾼 뒤 저장을 예약한다
      const p = a.state.pipes[0];
      p.points.forEach((pt) => { pt.x = +(pt.x - 0.4).toFixed(4); });
      a.scheduleSave();
      const before = window.__P.saveState();
      window.dispatchEvent(new PageTransitionEvent('pagehide'));
      const after = window.__P.saveState();
      return { before, after };
    }''')
    check(f'[{tag}] N. scheduleSave() 직후에는 아직 저장 전이다 (대기 중)',
          saved['before']['timer'] is True, json.dumps(saved['before']))
    check(f'[{tag}] N. pagehide 가 오면 대기 중인 저장이 즉시 기록된다 (마지막 이동 보존)',
          saved['after']['timer'] is False and saved['after']['savedPipes'] > 0
          and abs((saved['after']['savedX'] or 0) - (saved['after']['stateX'] or 0)) < 1e-9,
          json.dumps(saved['after']))
    saved2 = page.evaluate('''() => {
      const a = __app;
      localStorage.removeItem('smilePiping3D.v1');
      const p = a.state.pipes[0];
      p.points.forEach((pt) => { pt.x = +(pt.x + 0.4).toFixed(4); });
      a.scheduleSave();
      const before = window.__P.saveState();
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
      const after = window.__P.saveState();
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      return { before, after };
    }''')
    check(f'[{tag}] N. 화면이 가려지면(visibilitychange hidden) 대기 중 저장이 즉시 기록된다',
          saved2['before']['timer'] is True and saved2['after']['timer'] is False
          and abs((saved2['after']['savedX'] or 0) - (saved2['after']['stateX'] or 0)) < 1e-9,
          json.dumps(saved2['after']))
    deb = page.evaluate('''async () => {
      const a = __app;
      localStorage.removeItem('smilePiping3D.v1');
      a.scheduleSave();
      const t0 = performance.now();
      await new Promise((r) => setTimeout(r, 320));
      const fast = localStorage.getItem('smilePiping3D.v1') !== null;
      return { fast, ms: Math.round(performance.now() - t0) };
    }''')
    check(f'[{tag}] N. 저장 대기는 600ms가 아니라 150ms (0.3초 안에 기록)', deb['fast'],
          json.dumps(deb))

    # ── O. 콘솔 오류 ───────────────────────────────────────────────
    js = page.evaluate('() => window.__errors.slice()')
    check(f'[{tag}] O. 콘솔 오류 · window.__errors 0건', not errs and not js,
          '; '.join((errs + js)[:4]))
    page.close()


def main():
    live = '--live' in sys.argv
    srv = None
    if not live:
        srv = Quiet(('127.0.0.1', PORT), functools.partial(Handler, directory=ROOT))
        threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            run(b, {'width': 390, 'height': 844}, True, True)
            run(b, {'width': 1280, 'height': 800}, False, False)
            b.close()
    finally:
        if srv:
            srv.shutdown()

    bad = [r for r in results if not r[1]]
    print(f'\n{len(results) - len(bad)}/{len(results)} 통과')
    if bad:
        for nm, _, dt in bad:
            print('  실패:', nm, dt)
        sys.exit(1)
    print('모두 통과')


if __name__ == '__main__':
    main()
