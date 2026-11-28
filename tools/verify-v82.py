#!/usr/bin/env python3
"""v82 검증 — A4 **가로** 크게 인쇄 + 자재 수량표 **선택** 인쇄.

사용자 요청(2026-11-28):
  · "도면 출력 a4용지에 세로로 나오는데 가로로 크게 뽑고 싶어"
  · "배관 수량 표는 기본으로 선택 안되있고 출력하고 싶을 때 선택해서 출력하게 해줘"

검사 항목
 A. 진입 — 모바일 ☰ → 파일 `🖨️ 도면 인쇄 · 컷 담기`, 데스크톱 상단 `내보내기`
 B. @page — `size: A4 landscape; margin: 7mm 8mm;` (스타일시트 원문 + 실제 PDF 용지 297×210mm)
 C. 인쇄 시트 레이아웃 — 한 장 높이 195mm 이내, 머리글·그림·설명·바닥글이 한 장 안(넘침 0)
 D. 도면 크기 — A4 가로 1컷 1페이지에서 그림이 가로 폭을 거의 다 채운다(실제 PDF 잉크 범위로 측정)
 E. 페이지 수 = 컷 수 (넘치면 늘어난다) · 빈 장 없음
 F. 수량표 기본 해제 — 체크박스 unchecked, 그냥 인쇄하면 수량표 장이 없다
 G. 수량표 체크 — 마지막 장에 수량표가 붙고 값이 실제 도면과 같다
 H. 2컷 모아찍기 — 가로 용지에 2열 나란히(같은 높이·좌우 분리), 페이지 수 = ceil(컷/2)
 I. 컷 그림·머리글·쪽번호가 시트에 들어간다
 J. 한 장에 1컷이 기본 (ppPerPage 기본 1 · 선택지 「1컷 (크게)」)
 K. 콘솔 오류 0건
"""
import functools
import http.server
import json
import os
import socketserver
import sys
import threading

import fitz  # PyMuPDF — 실제로 찍힌 종이를 재려고
from playwright.sync_api import sync_playwright

PORT = 8782
ROOT = '/workspace/projects/smile-piping-3d'
LIVE = 'https://bks1029-ops.github.io/smile-piping-3d/'
BASE = LIVE if '--live' in sys.argv else f'http://127.0.0.1:{PORT}/'
MM = 72 / 25.4          # 1mm = 2.8346pt (PDF 좌표)
results = []


def check(name, ok, detail=''):
    results.append((name, bool(ok), detail))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''))


class Quiet(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True


class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


# ── PDF 쪽 읽기 도우미 ──────────────────────────────────────────────────
def pdf_pages_mm(path):
    """PDF 각 장의 [가로, 세로]mm."""
    doc = fitz.open(path)
    out = [[round(p.rect.width / MM, 1), round(p.rect.height / MM, 1)] for p in doc]
    doc.close()
    return out


def ink_bbox_mm(path, page_index, thresh=190, band=(0.0, 210.0)):
    """한 장에서 진한(도면) 잉크의 사각 범위(mm)와 잉크 비율.

    band = (위, 아래)mm — 머리글·바닥글 글자를 빼고 그림만 재고 싶을 때 좁힌다.
    """
    doc = fitz.open(path)
    page = doc[page_index]
    pix = page.get_pixmap(dpi=100, colorspace=fitz.csGRAY)
    w, h = pix.width, pix.height
    data = pix.samples
    top = int(band[0] / 210.0 * h)
    bot = int(band[1] / 210.0 * h)
    x0, y0, x1, y1, n = w, h, -1, -1, 0
    for y in range(top, min(bot, h)):
        row = y * w
        for x in range(w):
            if data[row + x] < thresh:
                n += 1
                if x < x0:
                    x0 = x
                if x > x1:
                    x1 = x
                if y < y0:
                    y0 = y
                if y > y1:
                    y1 = y
    doc.close()
    if x1 < 0:
        return {'w': 0, 'h': 0, 'ratio': 0.0}
    return {
        'w': round((x1 - x0 + 1) / w * 297.0, 1),
        'h': round((y1 - y0 + 1) / h * 210.0, 1),
        'ratio': round(n / (w * h), 4),
        'box': [round(x0 / w * 297, 1), round(y0 / h * 210, 1),
                round(x1 / w * 297, 1), round(y1 / h * 210, 1)],
    }


HELPERS = '''() => {
  const a = window.__app;
  const mm = (v) => Math.round(v / (96 / 25.4) * 10) / 10;   // px → mm
  window.__P = {
    sheet() {
      const s = document.querySelector('#printSheet');
      const pages = Array.from(s.querySelectorAll('.ps-page'));
      return {
        pages: pages.length,
        figs: s.querySelectorAll('.ps-fig').length,
        bom: s.querySelectorAll('.ps-bom').length,
        twoUp: s.querySelectorAll('.ps-2up').length,
        heads: Array.from(s.querySelectorAll('.ps-brand b')).map((b) => b.textContent),
        metas: Array.from(s.querySelectorAll('.ps-meta')).map((b) => b.textContent.trim()),
        captions: Array.from(s.querySelectorAll('figcaption')).map((f) => f.innerText),
        srcs: Array.from(s.querySelectorAll('img')).map((i) => (i.src || '').slice(0, 15)),
        pages_mm: pages.map((p) => {
          const r = p.getBoundingClientRect();
          return [mm(r.width), mm(r.height)];
        }),
        // 한 장 안에서 그림·설명·바닥글이 다 들어갔는지 (px 기준 비교)
        overflow: pages.map((p) => {
          const pr = p.getBoundingClientRect();
          const kids = Array.from(p.querySelectorAll('.ps-fig, .ps-foot, .ps-head, .ps-table'));
          const worst = kids.reduce((m, k) => {
            const r = k.getBoundingClientRect();
            return Math.max(m, r.bottom - pr.bottom, pr.top - r.top, r.right - pr.right);
          }, -1e9);
          return Math.round(worst);
        }),
        // 그림 상자와 실제 그림 크기(mm)
        imgs: Array.from(s.querySelectorAll('.ps-img')).map((b) => {
          const r = b.getBoundingClientRect();
          const i = b.querySelector('img');
          const ir = i.getBoundingClientRect();
          return { box: [mm(r.width), mm(r.height)], img: [mm(ir.width), mm(ir.height)],
                   fit: getComputedStyle(i).objectFit, top: mm(r.top - b.closest('.ps-page').getBoundingClientRect().top) };
        }),
        twoUpCols: (() => {
          const w = s.querySelector('.ps-2up .ps-figs');
          return w ? getComputedStyle(w).gridTemplateColumns : null;
        })(),
        twoUpRects: (() => {
          const w = s.querySelector('.ps-2up .ps-figs');
          if (!w) return [];
          const fr = w.getBoundingClientRect();
          return Array.from(w.querySelectorAll('.ps-fig')).map((f) => {
            const r = f.getBoundingClientRect();
            return { left: Math.round(r.left - fr.left), top: Math.round(r.top - fr.top),
                     w: Math.round(r.width), h: Math.round(r.height) };
          });
        })(),
        // 한 장이 종이 본문 높이를 넘는지 (시트 전체 스크롤 높이 / 페이지 수)
        sheetH: mm(s.scrollHeight),
        appDisplay: getComputedStyle(document.querySelector('#app')).display,
        sheetDisplay: getComputedStyle(s).display,
      };
    },
    opts() {
      const bom = document.querySelector('#ppBom');
      const per = document.querySelector('#ppPerPage');
      return {
        bomExists: !!bom,
        bomChecked: bom ? bom.checked : null,
        perValue: per ? per.value : null,
        perLabels: per ? Array.from(per.options).map((o) => o.textContent.trim()) : [],
        hint: (document.querySelector('.pp-hint') || {}).textContent || '',
        info: __app.printSheetInfo || null,
      };
    },
    cuts() { return __app.cuts.length; },
  };
  return true;
}'''


def new_page(browser, viewport, mobile, tag, errs):
    page = browser.new_page(viewport=viewport, device_scale_factor=2 if mobile else 1,
                            is_mobile=mobile, has_touch=mobile)
    page.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.goto(BASE + '?v=82', wait_until='networkidle')
    page.wait_for_function('window.__app && window.__app.state', timeout=30000)
    page.wait_for_timeout(800)
    page.evaluate(HELPERS)
    page.evaluate('() => { window.print = () => { window.__printed = (window.__printed || 0) + 1; }; }')
    return page


def sample_with_cuts(page, titles):
    """샘플 씬 + 구역별 컷 담기 — 흰 배경, 치수 라벨 없이."""
    page.evaluate('''async (titles) => {
      const S = await import('./js/store.js?v=82');
      const a = __app;
      a.state = S.sampleScene();
      a.selection = null;
      a.clearCuts();
      a.setDims(false); a.setPrintBg('white');
      a.ppPerPage = 1; a.syncPrintOptions();
      a.rebuild();
      const cams = [
        [[12, 9.5, 13], [0, 1.2, -1.6]],
        [[4.6, 3.4, 7.4], [-0.4, 0.9, 0.9]],
        [[4.4, 3.2, 3.4], [-3.2, 0.9, -4.4]],
      ];
      cams.forEach((c, i) => {
        a.camAnim = null;
        a.camera.position.set(c[0][0], c[0][1], c[0][2]);
        a.controls.target.set(c[1][0], c[1][1], c[1][2]);
        a.controls.update();
        a.camera.updateMatrixWorld(true);
        const cut = a.addCut();
        if (cut) { cut.title = titles[i] || cut.title; cut.memo = '검증용 컷'; }
      });
      a.closePrintPanel();
      await a.buildPrintSheet(a.cuts);
    }''', titles)
    page.wait_for_timeout(500)


def run_ui(browser):
    """A·F·J — 모바일/데스크톱 화면에서 인쇄 패널과 수량표 체크박스."""
    for mobile, viewport in ((True, {'width': 390, 'height': 844}), (False, {'width': 1280, 'height': 800})):
        tag = '모바일' if mobile else '데스크톱'
        errs = []
        page = new_page(browser, viewport, mobile, tag, errs)
        if mobile:
            page.click('#btnDrawer')
            page.wait_for_timeout(250)
            page.click('#tabs .tab[data-tab="file"]')
            page.wait_for_timeout(200)
            page.click('#btnPrintSheet')
        else:
            page.click('#btnExport')
        page.wait_for_timeout(350)
        st = page.evaluate('''() => ({ open: !document.querySelector('#printPanel').hidden,
                                       add: !!document.querySelector('#ppAdd') })''')
        check(f'[{tag}] A. 인쇄 패널이 열린다', st['open'] and st['add'], json.dumps(st))

        o = page.evaluate('() => window.__P.opts()')
        check(f'[{tag}] F. 「자재 수량표」 체크박스가 있고 **기본 해제**',
              o['bomExists'] and o['bomChecked'] is False, json.dumps(o, ensure_ascii=False))
        check(f'[{tag}] J. 기본은 「한 장에 1컷」이고 선택지가 「1컷 (크게)」',
              o['perValue'] == '1' and o['perLabels'][0].startswith('1컷 (크게)'),
              json.dumps(o['perLabels'], ensure_ascii=False))
        check(f'[{tag}] B. 안내 문구가 A4 가로 기준', 'A4 가로' in o['hint'], o['hint'])

        # 컷을 담고 그냥 인쇄 → 수량표 없이
        sample_with_cuts(page, ['컷 1 · 전체', '컷 2 · 펌프', '컷 3 · 열교환기'])
        page.click('#ppPrint')
        try:
            page.wait_for_function('() => window.__printed >= 1', timeout=8000)
        except Exception:
            pass
        sh = page.evaluate('() => window.__P.sheet()')
        o = page.evaluate('() => window.__P.opts()')
        check(f'[{tag}] F. 체크하지 않고 인쇄하면 수량표 장이 없다 (컷 3장 → 3페이지)',
              sh['pages'] == 3 and sh['bom'] == 0 and o['info']['pages'] == 3,
              f"페이지 {sh['pages']} · 수량표 {sh['bom']} · info {o['info']}")

        # 체크 → 수량표가 마지막 장에 붙는다
        page.click('#ppBom')
        page.wait_for_timeout(500)
        sh2 = page.evaluate('() => window.__P.sheet()')
        o2 = page.evaluate('() => window.__P.opts()')
        check(f'[{tag}] G. 수량표를 체크하면 마지막 장에 수량표가 붙는다 (컷 3 + 표 1 = 4페이지)',
              o2['bomChecked'] is True and sh2['bom'] == 1 and sh2['pages'] == 4,
              f"체크 {o2['bomChecked']} · 페이지 {sh2['pages']} · 표 {sh2['bom']}")
        bom_txt = page.evaluate('''() => (document.querySelector('#printSheet .ps-bom .ps-table') || {}).innerText || '' ''')
        bom = page.evaluate('''() => {
          const b = __app.buildBom();
          return { total: +b.totalLen.toFixed(2), pipes: b.pipes.length, parts: b.parts.length };
        }''')
        check(f'[{tag}] G. 수량표 값이 실제 도면 그대로 (배관 합계·관경·부속)',
              f"{bom['total']:.2f}" in bom_txt and '합계' in bom_txt and bom['pipes'] >= 1,
              f"{bom} · 표 앞부분 {bom_txt[:40]!r}")
        page.click('#ppBom')
        page.wait_for_timeout(300)
        off = page.evaluate('() => window.__P.opts()')
        check(f'[{tag}] G. 다시 체크를 풀면 수량표가 빠진다',
              off['bomChecked'] is False and page.evaluate('() => window.__P.sheet()["bom"]') == 0,
              json.dumps(off, ensure_ascii=False))

        # 새로 열어도 기본은 꺼짐 (저장된 값으로 켜지지 않는다)
        page.reload(wait_until='networkidle')
        page.wait_for_function('window.__app && window.__app.state', timeout=30000)
        page.wait_for_timeout(500)
        fresh = page.evaluate('() => { const b = document.querySelector("#ppBom"); return b ? b.checked : null; }')
        check(f'[{tag}] F. 앱을 새로 열어도 수량표는 꺼진 채로 시작한다', fresh is False, str(fresh))

        js = page.evaluate('() => window.__errors.slice()')
        check(f'[{tag}] K. 콘솔 오류 · window.__errors 0건', not errs and not js,
              '; '.join((errs + js)[:4]))
        page.close()


def run_print(browser):
    """B~E·H·I — 실제 인쇄(PDF)로 용지·페이지·도면 크기를 잰다."""
    errs = []
    page = new_page(browser, {'width': 1280, 'height': 800}, False, '인쇄', errs)
    sample_with_cuts(page, ['컷 1 · 전체', '컷 2 · 펌프 구역', '컷 3 · 열교환기 구역'])

    # ── B. @page 원문 ────────────────────────────────────────────
    css = page.evaluate('''() => fetch('./css/style.css?v=82').then((r) => r.text()).then((t) => {
      const i = t.indexOf('@media print');
      return t.slice(i, i + 400);
    })''')
    check('B. 스타일시트 @page 가 A4 가로 · 여백 7mm 8mm',
          'size: A4 landscape' in css and 'margin: 7mm 8mm' in css, css.split('\n')[1][:60])

    # ── H. 2컷 모아찍기 — 가로 2열 ───────────────────────────────
    page.evaluate('''async () => {
      const a = __app;
      a.ppPerPage = 2; a.syncPrintOptions();
      await a.buildPrintSheet(a.cuts, { perPage: 2 });
    }''')
    page.wait_for_timeout(400)
    sh = page.evaluate('() => window.__P.sheet()')
    rects = sh['twoUpRects']
    side_by_side = (len(rects) >= 2 and rects[0]['top'] == rects[1]['top']
                    and abs(rects[0]['left'] - rects[1]['left']) > rects[0]['w'] * 0.8)
    check('H. 「2컷」은 가로 용지에 두 컷을 나란히 놓는다 (같은 높이·좌우로 갈라짐)',
          sh['twoUp'] == 2 and side_by_side and sh['twoUpCols'] and len(sh['twoUpCols'].split()) == 2,
          f"컬럼 {sh['twoUpCols']} · 사각형 {json.dumps(rects)}")
    check('H. 2컷 묶음 페이지 수 = ceil(3/2) = 2 (+수량표 없음)',
          sh['pages'] == 2 and sh['figs'] == 3 and sh['bom'] == 0,
          f"페이지 {sh['pages']} · 그림 {sh['figs']} · 표 {sh['bom']}")
    check('C. 2컷도 한 장 높이(195mm) 안에 들어간다',
          all(p[1] <= 196 for p in sh['pages_mm']) and all(o <= 1 for o in sh['overflow']),
          f"장 높이 {sh['pages_mm']} · 넘침 {sh['overflow']}")
    two_pdf = '/workspace/tmp/v82-2up.pdf'
    page.pdf(path=two_pdf, prefer_css_page_size=True, print_background=True)
    two_pages = pdf_pages_mm(two_pdf)
    check('H. 2컷 PDF도 A4 가로 2장',
          len(two_pages) == 2 and all(abs(w - 297) < 2 and abs(h - 210) < 2 for w, h in two_pages),
          json.dumps(two_pages))

    # ── 1컷 1페이지로 되돌려 본 검사 ─────────────────────────────
    page.evaluate('''async () => {
      const a = __app;
      a.ppPerPage = 1; a.syncPrintOptions();
      a.setPrintBg('white');
      await a.buildPrintSheet(a.cuts, { perPage: 1, bom: false });
    }''')
    page.wait_for_timeout(400)
    sh = page.evaluate('() => window.__P.sheet()')
    page.emulate_media(media='print')
    page.wait_for_timeout(300)
    pr = page.evaluate('''() => {
      const p = document.querySelector('#printSheet .ps-page');
      const b = p.getBoundingClientRect();
      return { app: getComputedStyle(document.querySelector('#app')).display,
               sheet: getComputedStyle(document.querySelector('#printSheet')).display,
               pageMM: [Math.round(b.width / (96/25.4) * 10) / 10, Math.round(b.height / (96/25.4) * 10) / 10],
               breakAfter: getComputedStyle(p).breakAfter };
    }''')
    page.emulate_media(media='screen')
    check('C. 인쇄에는 인쇄 시트만 나온다 (앱 화면 숨김)', pr['app'] == 'none' and pr['sheet'] == 'block',
          json.dumps(pr))
    check('C. 한 장 = 높이 195mm · 다음 장으로 넘김',
          pr['pageMM'][1] <= 196 and pr['breakAfter'] == 'page', json.dumps(pr['pageMM']))
    check('C. 머리글·그림·설명·바닥글이 한 장을 넘지 않는다 (넘침 0mm)',
          all(o <= 1 for o in sh['overflow']), f"{sh['overflow']} (px)")
    check('I. 컷 3장 = 3페이지, 머리글·쪽번호·설명이 들어간다',
          sh['pages'] == 3 and sh['figs'] == 3
          and all(h == '스마일산업 3D 배관 도면' for h in sh['heads'])
          and all('컷 3장' in m for m in sh['metas'])
          and any('펌프 구역' in c for c in sh['captions'])
          and all(s.startswith('data:image/png') for s in sh['srcs']),
          f"페이지 {sh['pages']} · 메타 {sh['metas'][:1]}")

    imgs = sh['imgs']
    check('D. 그림이 A4 가로 폭을 거의 다 쓴다 (상자 100% · 잘리지 않는 contain)',
          all(i['fit'] == 'contain' and i['box'][0] >= 270 for i in imgs),
          f"그림 상자 {[i['box'] for i in imgs]}")

    # ── 실제 PDF — 용지 방향·페이지 수·도면 크기 ─────────────────
    pdf = '/workspace/tmp/v82-landscape.pdf'
    page.pdf(path=pdf, prefer_css_page_size=True, print_background=True)
    pages = pdf_pages_mm(pdf)
    check('B. 실제 PDF 용지가 A4 가로(297×210mm) — 세로 아님',
          pages and all(abs(w - 297) < 2 and abs(h - 210) < 2 for w, h in pages), json.dumps(pages))
    check('E. PDF 장 수 = 컷 3장 (한 장도 넘치거나 비지 않는다)', len(pages) == 3, f'{len(pages)}장')

    bands = [ink_bbox_mm(pdf, i, band=(14.0, 196.0)) for i in range(len(pages))]
    check('D. 실제 종이에서 도면이 크게 찍힌다 (폭 240mm 이상 · 높이 120mm 이상)',
          all(b['w'] >= 240 and b['h'] >= 120 and b['ratio'] >= 0.01 for b in bands),
          json.dumps(bands))
    check('E. 빈 장이 없다 (모든 장에 도면 잉크가 있다)', all(b['ratio'] > 0.005 for b in bands),
          json.dumps([b['ratio'] for b in bands]))
    check('C. 그림이 종이 여백을 넘지 않는다 (잉크가 7mm/8mm 여백 안)',
          all(b['box'][0] >= 6 and b['box'][2] <= 291 and b['box'][1] >= 12 and b['box'][3] <= 199
              for b in bands if b['box']),
          json.dumps([b.get('box') for b in bands]))

    js = page.evaluate('() => window.__errors.slice()')
    check('K. 콘솔 오류 · window.__errors 0건', not errs and not js, '; '.join((errs + js)[:4]))
    return page


def main():
    live = '--live' in sys.argv
    os.makedirs('/workspace/tmp', exist_ok=True)
    srv = None
    if not live:
        srv = Quiet(('127.0.0.1', PORT), functools.partial(Handler, directory=ROOT))
        threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            run_ui(b)
            page = run_print(b)
            # ── 미리보기 — A4 가로 인쇄 시트 (인쇄 미디어 화면 캡처) ──
            page.evaluate('''async () => {
              const a = __app;
              a.ppPerPage = 1; a.ppBom = false; a.syncPrintOptions();
              a.rebuild();
              await a.buildPrintSheet(a.cuts, { perPage: 1, bom: false });
                a.closePrintPanel();
            }''')
            page.wait_for_timeout(400)
            page.emulate_media(media='print')
            page.set_viewport_size({'width': 1123, 'height': 794})   # A4 가로 한 장(96dpi)
            page.evaluate('''() => { const s = document.querySelector('#printSheet');
              s.dataset.prevPad = s.style.padding; s.style.padding = '0 8mm'; }''')
            page.wait_for_timeout(400)
            page.screenshot(path=ROOT + '/preview-v82-landscape.png', full_page=True)
            page.evaluate('''() => { const s = document.querySelector('#printSheet');
              s.style.padding = s.dataset.prevPad || ''; }''')
            page.emulate_media(media='screen')
            print('  A4 가로 시트 미리보기 저장:', ROOT + '/preview-v82-landscape.png')
            # 수량표를 켠 모습도 한 장 더
            page.set_viewport_size({'width': 1123, 'height': 794})
            page.evaluate('''async () => {
              const a = __app;
              a.ppBom = true; a.syncPrintOptions();
              await a.buildPrintSheet(a.cuts, { perPage: 1, bom: true });
            }''')
            page.wait_for_timeout(400)
            page.emulate_media(media='print')
            page.evaluate('''() => { const s = document.querySelector('#printSheet');
              s.dataset.p2 = s.style.padding; s.style.padding = '0 8mm'; }''')
            page.wait_for_timeout(300)
            page.screenshot(path=ROOT + '/preview-v82-bom.png', full_page=True)
            page.evaluate('''() => { const s = document.querySelector('#printSheet');
              s.style.padding = s.dataset.p2 || ''; }''')
            page.emulate_media(media='screen')
            print('  수량표 포함 시트 저장:', ROOT + '/preview-v82-bom.png')
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
