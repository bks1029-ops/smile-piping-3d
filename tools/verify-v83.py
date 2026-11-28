#!/usr/bin/env python3
"""v83 검증 — 인쇄 여백 사방 12mm · A4 가로/세로 · 한 장에 1·2·4컷.

사용자 요청(2026-11-28):
  · "실제 프린터로 뽑으니까 왼쪽 위 스마일산업의 '스' 자가 잘려"
  · "A4 가로로도 세로로도 고를 수 있게"
  · "한 장에 2컷 4컷도"

검사 항목
 A. 진입 — 모바일 ☰ → 파일 `🖨️ 도면 인쇄 · 컷 담기`, 데스크톱 상단 `내보내기`
 B. @page — `margin: 12mm 13mm` · 방향은 `#printPageStyle`이 인쇄 시점에 갈아 끼운다
 C. 인쇄 시트 레이아웃 — 한 장 높이 184mm(가로)/270mm(세로) · 넘침 0px
 D. 용지 방향 — 가로 PDF 297×210mm · 세로 PDF 210×297mm
 E. 페이지 수 = ceil(컷/한장에) · 빈 장 없음
 F. 수량표 기본 해제 (그대로) · 세로에서도 표가 본문 폭 안
 G. 한 장에 1·2·4컷 — 가로 2컷 좌우 2열 · 4컷 2×2, 세로 2컷 위아래 2행 · 4컷 2×2
 H. 여백 — 실제 종이에서 잉크가 사방 12mm 밖으로 나가지 않는다(첫 글자 잘림 없음)
 I. 방향·컷 수 선택이 localStorage에 남는다
 K. 콘솔 오류 0건

로컬 실행:  python3 tools/verify-v83.py            (127.0.0.1:8783)
라이브:     python3 tools/verify-v83.py --live
필요:       playwright(chromium) · PyMuPDF
"""
import functools
import http.server
import json
import os
import socketserver
import sys
import threading

import fitz  # PyMuPDF
from playwright.sync_api import sync_playwright

PORT = 8783
ROOT = '/workspace/projects/smile-piping-3d'
LIVE = 'https://bks1029-ops.github.io/smile-piping-3d/'
BASE = LIVE if '--live' in sys.argv else f'http://127.0.0.1:{PORT}/'
MM = 72 / 25.4
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


def pdf_pages_mm(path):
    doc = fitz.open(path)
    out = [[round(p.rect.width / MM, 1), round(p.rect.height / MM, 1)] for p in doc]
    doc.close()
    return out


def ink_bbox_mm(path, index):
    """한 장에서 진한 잉크의 사각 범위(mm)와 비율 — 여백 침범을 잰다."""
    doc = fitz.open(path)
    page = doc[index]
    w_pt, h_pt = page.rect.width, page.rect.height
    pix = page.get_pixmap(dpi=100, colorspace=fitz.csGRAY)
    w, h, data = pix.width, pix.height, pix.samples
    x0, y0, x1, y1, n = w, h, -1, -1, 0
    for y in range(h):
        row = y * w
        for x in range(w):
            if data[row + x] < 200:
                n += 1
                x0 = min(x0, x); x1 = max(x1, x)
                y0 = min(y0, y); y1 = max(y1, y)
    doc.close()
    if x1 < 0:
        return {'box': None, 'ratio': 0.0, 'w_mm': w_pt / MM, 'h_mm': h_pt / MM}
    return {
        'box': [round(x0 / w * w_pt / MM, 1), round(y0 / h * h_pt / MM, 1),
                round((x1 + 1) / w * w_pt / MM, 1), round((y1 + 1) / h * h_pt / MM, 1)],
        'ratio': round(n / (w * h), 4),
        'w_mm': round(w_pt / MM, 1), 'h_mm': round(h_pt / MM, 1),
    }


HELPERS = '''() => {
  const a = window.__app;
  const mm = (v) => Math.round(v / (96 / 25.4) * 10) / 10;
  window.__P = {
    sheet() {
      const s = document.querySelector('#printSheet');
      const pages = Array.from(s.querySelectorAll('.ps-page'));
      return {
        pages: pages.length,
        figs: s.querySelectorAll('.ps-fig').length,
        bom: s.querySelectorAll('.ps-bom').length,
        perClasses: pages.map((p) => (p.className.match(/ps-per-\\d/) || [''])[0]),
        sheetClass: s.className,
        heads: Array.from(s.querySelectorAll('.ps-brand b')).map((b) => b.textContent),
        metas: Array.from(s.querySelectorAll('.ps-meta')).map((b) => b.textContent.trim()),
        foots: Array.from(s.querySelectorAll('.ps-foot')).map((f) => f.textContent.trim()),
        pages_mm: pages.map((p) => { const r = p.getBoundingClientRect(); return [mm(r.width), mm(r.height)]; }),
        overflow: pages.map((p) => {
          const pr = p.getBoundingClientRect();
          let worst = -1e9;
          p.querySelectorAll('*').forEach((k) => {
            const r = k.getBoundingClientRect();
            worst = Math.max(worst, r.bottom - pr.bottom, r.right - pr.right, pr.top - r.top, pr.left - r.left);
          });
          return Math.round(worst * 10) / 10;
        }),
        grids: pages.map((p) => {
          const f = p.querySelector('.ps-figs');
          if (!f) return null;
          const cs = getComputedStyle(f);
          return { display: cs.display, cols: cs.gridTemplateColumns.split(' ').length,
                   rows: (cs.gridTemplateRows || 'none').split(' ').length };
        }),
        figsPerPage: pages.map((p) => p.querySelectorAll('.ps-fig').length),
        imgs: Array.from(s.querySelectorAll('.ps-img')).map((b) => {
          const i = b.querySelector('img');
          const r = b.getBoundingClientRect(), ir = i.getBoundingClientRect();
          return { box: [mm(r.width), mm(r.height)], img: [mm(ir.width), mm(ir.height)], fit: getComputedStyle(i).objectFit };
        }),
        brandX: pages.map((p) => {
          const pr = p.getBoundingClientRect();
          return mm(p.querySelector('.ps-brand b').getBoundingClientRect().left - pr.left);
        }),
      };
    },
    opts() {
      const bom = document.querySelector('#ppBom');
      const per = document.querySelector('#ppPerPage');
      const ori = document.querySelector('#ppOrient');
      return {
        bomChecked: bom ? bom.checked : null,
        perValue: per ? per.value : null,
        perLabels: per ? Array.from(per.options).map((o) => o.textContent.trim()) : [],
        orientValue: ori ? ori.value : null,
        orientLabels: ori ? Array.from(ori.options).map((o) => o.textContent.trim()) : [],
        rule: (document.querySelector('#printPageStyle') || {}).textContent || '',
        hint: (document.querySelector('#ppHint') || {}).textContent || '',
        info: __app.printSheetInfo || null,
      };
    },
  };
  return true;
}'''


def new_page(browser, viewport, mobile, errs):
    page = browser.new_page(viewport=viewport, device_scale_factor=2 if mobile else 1,
                            is_mobile=mobile, has_touch=mobile)
    page.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.goto(BASE + '?v=83', wait_until='networkidle')
    page.wait_for_function('window.__app && window.__app.state', timeout=30000)
    page.wait_for_timeout(800)
    page.evaluate(HELPERS)
    page.evaluate('() => { window.print = () => { window.__printed = (window.__printed || 0) + 1; }; }')
    return page


def sample_with_cuts(page, titles):
    page.evaluate('''async (titles) => {
      const S = await import('./js/store.js?v=83');
      const a = __app;
      a.state = S.sampleScene();
      a.selection = null;
      a.clearCuts();
      a.setDims(false); a.setPrintBg('white');
      a.ppPerPage = 1; a.ppOrient = 'landscape'; a.ppBom = false; a.syncPrintOptions(); a.applyPrintPageStyle();
      a.rebuild();
      const cams = [
        [[12, 9.5, 13], [0, 1.2, -1.6]],
        [[4.6, 3.4, 7.4], [-0.4, 0.9, 0.9]],
        [[4.4, 3.2, 3.4], [-3.2, 0.9, -4.4]],
        [[-6.5, 5.2, 6.2], [-1.2, 1.0, -2.2]],
      ];
      for (let i = 0; i < cams.length; i++) {
        const c = cams[i];
        a.camAnim = null;
        a.camera.position.set(c[0][0], c[0][1], c[0][2]);
        a.controls.target.set(c[1][0], c[1][1], c[1][2]);
        a.controls.update();
        a.camera.updateMatrixWorld(true);
        const cut = a.addCut();
        if (cut) { cut.title = titles[i] || cut.title; cut.memo = '검증용'; }
      }
    }''', titles)
    page.wait_for_timeout(400)


def run_ui(browser):
    """A·F·I — 패널 진입, 기본값, 방향·컷 수 선택."""
    for mobile, viewport in ((True, {'width': 390, 'height': 844}), (False, {'width': 1280, 'height': 800})):
        tag = '모바일' if mobile else '데스크톱'
        errs = []
        page = new_page(browser, viewport, mobile, errs)
        if mobile:
            page.click('#btnDrawer')
            page.wait_for_timeout(250)
            page.click('#tabs .tab[data-tab="file"]')
            page.wait_for_timeout(200)
            page.click('#btnPrintSheet')
        else:
            page.click('#btnExport')
        page.wait_for_timeout(350)
        o = page.evaluate('() => window.__P.opts()')
        check(f'[{tag}] A. 인쇄 패널이 열리고 방향·컷 수 선택이 있다',
              page.evaluate('() => !document.querySelector("#printPanel").hidden')
              and o['orientValue'] == 'landscape' and o['perValue'] == '1', json.dumps(o, ensure_ascii=False))
        check(f'[{tag}] G. 「한 장에」 선택지가 1컷 · 2컷 · 4컷',
              [l.split(' ')[0] for l in o['perLabels']] == ['1컷', '2컷', '4컷'],
              json.dumps(o['perLabels'], ensure_ascii=False))
        check(f'[{tag}] D. 「용지 방향」 기본은 가로',
              o['orientLabels'] and o['orientValue'] == 'landscape', json.dumps(o['orientLabels'], ensure_ascii=False))
        check(f'[{tag}] B. @page 규칙이 여백 12mm 13mm', 'margin: 12mm 13mm' in o['rule'], o['rule'])
        check(f'[{tag}] F. 「자재 수량표」 기본 해제', o['bomChecked'] is False, str(o['bomChecked']))

        # 방향을 세로로 바꾸면 @page·힌트가 따라온다
        page.select_option('#ppOrient', 'portrait')
        page.wait_for_timeout(250)
        o2 = page.evaluate('() => window.__P.opts()')
        check(f'[{tag}] D. 세로를 고르면 @page size가 portrait로 바뀐다',
              'A4 portrait' in o2['rule'] and '세로' in o2['hint'], o2['rule'])
        stored = page.evaluate('() => localStorage.getItem("smilePiping3D.printOrient")')
        check(f'[{tag}] I. 고른 방향이 저장된다', stored == 'portrait', str(stored))
        page.select_option('#ppPerPage', '4')
        page.wait_for_timeout(200)
        stored = page.evaluate('() => localStorage.getItem("smilePiping3D.printPerPage")')
        check(f'[{tag}] I. 고른 컷 수가 저장된다', stored == '4', str(stored))

        js = page.evaluate('() => window.__errors.slice()')
        check(f'[{tag}] K. 콘솔 오류 · window.__errors 0건', not errs and not js, '; '.join((errs + js)[:4]))
        page.close()


def run_print(browser):
    """B~H — 실제 인쇄(PDF)와 DOM으로 여백·방향·컷 수를 잰다."""
    errs = []
    page = new_page(browser, {'width': 1920, 'height': 993}, False, errs)
    sample_with_cuts(page, ['컷 1 · 전체', '컷 2 · 펌프 구역', '컷 3 · 열교환기 구역', '컷 4 · 드럼 구역'])

    for orient in ('landscape', 'portrait'):
        for per in (1, 2, 4):
            info = page.evaluate('''async ([orient, per]) => {
              const a = __app;
              a.ppOrient = orient; a.ppPerPage = per; a.syncPrintOptions(); a.applyPrintPageStyle();
              await a.buildPrintSheet(a.cuts);
              const s = document.querySelector('#printSheet');
              const prev = s.getAttribute('style');
              s.style.cssText = 'display:block;position:absolute;left:0;top:0;width:' + (orient === 'portrait' ? '184mm' : '271mm') + ';';
              const out = window.__P.sheet();
              s.style.cssText = prev || '';
              return out;
            }''', [orient, per])
            tag = f"{'가로' if orient == 'landscape' else '세로'} {per}컷"
            want_page = [271, 184] if orient == 'landscape' else [184, 270]
            want_pages = -(-4 // per)
            check(f'C. [{tag}] 페이지 수 = ceil(4/{per}) = {want_pages}',
                  len(info['pages_mm']) == want_pages, f"{len(info['pages_mm'])}장")
            check(f'C. [{tag}] 한 장 크기 {want_page[0]}×{want_page[1]}mm',
                  all(abs(p[0] - want_page[0]) < 1 and abs(p[1] - want_page[1]) < 1 for p in info['pages_mm']),
                  json.dumps(info['pages_mm']))
            check(f'C. [{tag}] 머리글·그림·설명·바닥글 넘침 0px',
                  all(o <= 0.5 for o in info['overflow']), json.dumps(info['overflow']))
            check(f'C. [{tag}] 머리글 「스마일산업」이 페이지 왼쪽 끝(0mm)에서 시작',
                  all(abs(x) < 0.5 for x in info['brandX']), json.dumps(info['brandX']))
            check(f'G. [{tag}] 한 장에 {per}컷씩 담긴다',
                  all(n == per for n in info['figsPerPage']) if per > 1 else all(n == 1 for n in info['figsPerPage']),
                  json.dumps(info['figsPerPage']))
            if per == 2:
                g = info['grids'][0]
                cols, rows = (2, 1) if orient == 'landscape' else (1, 2)
                check(f'G. [{tag}] 2컷 배치 = {cols}열 × {rows}행',
                      g and g['display'] == 'grid' and g['cols'] == cols and g['rows'] == rows, json.dumps(g))
            if per == 4:
                g = info['grids'][0]
                check(f'G. [{tag}] 4컷 배치 = 2×2', g and g['cols'] == 2 and g['rows'] == 2, json.dumps(g))
            check(f'C. [{tag}] 그림은 상자 안에서 잘리지 않는다 (contain · 상자 이하)',
                  all(i['fit'] == 'contain' and i['img'][0] <= i['box'][0] + 0.5 and i['img'][1] <= i['box'][1] + 0.5
                      for i in info['imgs']), json.dumps(info['imgs'][:2]))

            # 실제 인쇄 PDF
            pdf = os.path.join(TMP, f'v83-{orient}-{per}.pdf')
            page.emulate_media(media='print')
            page.pdf(path=pdf, prefer_css_page_size=True, print_background=True)
            page.emulate_media(media='screen')
            sizes = pdf_pages_mm(pdf)
            want = [297, 210] if orient == 'landscape' else [210, 297]
            check(f'D. [{tag}] PDF 용지 {want[0]}×{want[1]}mm',
                  sizes and all(abs(w - want[0]) < 2 and abs(h - want[1]) < 2 for w, h in sizes), json.dumps(sizes))
            check(f'E. [{tag}] PDF 장 수 = {want_pages}', len(sizes) == want_pages, f'{len(sizes)}장')
            inks = [ink_bbox_mm(pdf, i) for i in range(len(sizes))]
            check(f'E. [{tag}] 빈 장이 없다', all(b['ratio'] > 0.004 for b in inks),
                  json.dumps([b['ratio'] for b in inks]))
            # 사방 12mm — 잉크가 12mm 안쪽(가로는 13mm 여백이라 12.5mm 이상)
            margin_ok = all(b['box'] and b['box'][0] >= 12.4 and b['box'][1] >= 12.4
                            and b['box'][2] <= want[0] - 12.4 and b['box'][3] <= want[1] - 12.4 for b in inks)
            check(f'H. [{tag}] 잉크가 사방 12mm 밖으로 나가지 않는다 (첫 글자 잘림 없음)', margin_ok,
                  json.dumps([b['box'] for b in inks]))

    # 수량표 — 기본 해제 유지 · 세로에서도 표가 본문 폭 안
    page.evaluate('''async () => {
      const a = __app;
      a.ppBom = true; document.querySelector('#ppBom').checked = true;
      a.ppOrient = 'portrait'; a.ppPerPage = 1; a.syncPrintOptions(); a.applyPrintPageStyle();
      await a.buildPrintSheet(a.cuts);
    }''')
    page.wait_for_timeout(300)
    info = page.evaluate('() => window.__P.sheet()')
    check('F. 수량표를 켜면 세로에서도 마지막 장에 붙는다 (4+1장)', len(info['pages_mm']) == 5 and info['bom'] == 1,
          f"{len(info['pages_mm'])}장 · 표 {info['bom']}")
    pdf = os.path.join(TMP, 'v83-portrait-bom.pdf')
    page.emulate_media(media='print')
    page.pdf(path=pdf, prefer_css_page_size=True, print_background=True)
    page.emulate_media(media='screen')
    sizes = pdf_pages_mm(pdf)
    ink = ink_bbox_mm(pdf, len(sizes) - 1)
    check('F. 세로 수량표 장도 A4 세로 · 잉크가 12mm 안',
          sizes and abs(sizes[-1][0] - 210) < 2 and ink['box'] and ink['box'][0] >= 12.4 and ink['box'][2] <= 197.6,
          json.dumps({'pages': sizes[-1:], 'ink': ink['box']}))

    js = page.evaluate('() => window.__errors.slice()')
    check('K. 콘솔 오류 · window.__errors 0건', not errs and not js, '; '.join((errs + js)[:4]))
    return page


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
            run_ui(b)
            page = run_print(b)
            # 미리보기 — 실제 인쇄 PDF를 그림으로
            page.emulate_media(media='print')
            page.evaluate('''async () => {
              const a = __app;
              a.ppBom = false; document.querySelector('#ppBom').checked = false;
              a.ppOrient = 'landscape'; a.ppPerPage = 4; a.syncPrintOptions(); a.applyPrintPageStyle();
              await a.buildPrintSheet(a.cuts);
            }''')
            page.pdf(path=os.path.join(TMP, 'v83-preview-4up.pdf'), prefer_css_page_size=True, print_background=True)
            page.emulate_media(media='screen')
            page.evaluate('''async () => {
              const a = __app;
              a.ppOrient = 'portrait'; a.ppPerPage = 1; a.syncPrintOptions(); a.applyPrintPageStyle();
              await a.buildPrintSheet(a.cuts);
              a.closePrintPanel();
            }''')
            page.emulate_media(media='print')
            page.pdf(path=os.path.join(TMP, 'v83-preview-portrait.pdf'), prefer_css_page_size=True, print_background=True)
            page.emulate_media(media='screen')
            for name, src in (('preview-v83-4up.png', 'v83-preview-4up.pdf'),
                              ('preview-v83-portrait.png', 'v83-preview-portrait.pdf')):
                doc = fitz.open(os.path.join(TMP, src))
                doc[0].get_pixmap(dpi=110).save(os.path.join(ROOT, name))
                doc.close()
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
