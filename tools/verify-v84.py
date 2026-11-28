#!/usr/bin/env python3
"""v84 검증 — 3D 배관 규격 정정(티·레듀샤) · 45° 절단 길이 · 업체명 인쇄.

사용자 요청(2026-11-28):
  · "티 350~600a 값이 규격이랑 달라" — ASME B16.9 / KS B 1522 티 C·분기 M, 레듀샤 H 정정
  · "피팅값 자동계산을 티·레듀샤·45°까지" — 티·레듀샤 접합면에서 이어 그릴 때 부속값을 빼고 직관
  · "직관 절단 길이(Cut)가 바로 보이게" + "45° 오프셋 계산"
  · "도면 인쇄할 때 업체명 바꿀 수 있게"

검사 항목
 A. 표준 규격 — TEE_C 350A~600A · REDUCER_H 500A~600A · 이경 티 M · 45° 엘보 face(63.5mm)
 B. fitAuto ON/OFF — 티 직진·분기에서 이어 그리기
 C. fitAuto ON/OFF — 레듀샤 양쪽 면에서 이어 그리기
 D. 45° 오프셋 — 계산(빗변 707.1 · 절단 580.1)과 실제 그리기(양쪽 45° 엘보·절단 580)
 E. 절단 길이 표시 — 속성 패널 · 치수 라벨 ✂ · 수량표(직관 절단/중심선) · 직관 절단표 인쇄
 F. 인쇄 업체명 — 기본 스마일산업 · 변경 · 빈 칸 · 저장(localStorage)
 G. 회귀 — 플랜지 끝 100mm는 그대로(v78) · 샘플 씬 200A 엘보 304.8mm
 H. 모바일 390×844 — 오프셋 계산기·업체명 칸이 넘치지 않는다
 K. 콘솔 오류 0건

로컬 실행:  python3 tools/verify-v84.py            (127.0.0.1:8784)
라이브:     python3 tools/verify-v84.py --live
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

PORT = 8784
ROOT = '/workspace/projects/smile-piping-3d'
LIVE = 'https://bks1029-ops.github.io/smile-piping-3d/'
BASE = LIVE if '--live' in sys.argv else f'http://127.0.0.1:{PORT}/'
TMP = '/workspace/tmp'
MM = 72 / 25.4
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
    doc = fitz.open(path)
    page = doc[index]
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
    wpt, hpt = page.rect.width, page.rect.height
    doc.close()
    if x1 < 0:
        return {'box': None, 'ratio': 0.0}
    return {
        'box': [round(x0 / w * wpt / MM, 1), round(y0 / h * hpt / MM, 1),
                round((x1 + 1) / w * wpt / MM, 1), round((y1 + 1) / h * hpt / MM, 1)],
        'ratio': round(n / (w * h), 4),
    }


# ── JS 조각 ────────────────────────────────────────────────────────────
STORE = '''async () => {
  const S = await import('./js/store.js?v=84');
  const near = (a, b, t) => Math.abs(a - b) <= (t || 0.0006);
  const teeRows = {};
  ['350A','400A','450A','500A','550A','600A'].forEach((b) => { teeRows[b] = S.TEE_C[b]; });
  const redRows = {};
  ['450A','500A','550A','600A'].forEach((b) => { redRows[b] = S.REDUCER_H[b]; });
  return {
    tee: teeRows,
    teeSmall: { '100A': S.TEE_C['100A'], '200A': S.TEE_C['200A'], '300A': S.TEE_C['300A'] },
    red: redRows,
    d200: S.teeDims('200A'),
    d200x100: S.teeDims('200A', '100A'),
    d100x50: S.teeDims('100A', '50A'),
    d600: S.teeDims('600A'),
    red600: S.reducerDims('600A', '400A').w,
    e45_100: S.elbowDims('elbow45', '100A').face,
    e45_200: S.elbowDims('elbow45', '200A').face,
    e90_200: S.elbowDims('elbow', '200A').face,
    teePorts: (() => {
      const spec = S.makeEquipment('tee', { bore1: '200A', bore2: '100A', x: 0, y: 0, z: 0, dir: [1,0,0], branch: 'up' });
      const P = S.teePorts(spec);
      const d = (p) => Math.round(Math.hypot(p.tip.x, p.tip.y, p.tip.z) * 10000) / 10000;
      return { w: spec.w, runA: d(P[0]), runB: d(P[1]), branch: d(P[2]) };
    })(),
  };
}'''

SCENE_TEE = '''(on) => {
  const a = window.__app;
  a.clearAll({ silent: true });
  a.setFitAuto(!!on, true);
  a.setCmdBore('100A', true);
  a.setCmdCursor({x:0,y:0,z:0}, true);
  a.execOps([{op:'seg', world:true, axis:'x', sign:1, meters:2}], {source:'cmd'});
  a.setCmdCursor({x:2,y:0,z:0}, true);
  a.addFittingAtCursor('tee');
  const tee = a.state.equipment.find((e) => e.type === 'tee');
  a.select('equipment', tee.id, {silent:true});
  a.portContinue(PORT);
  a.execOps([{op:'seg', world:true, axis:AX, sign:1, meters:1.0}], {source:'cmd'});
  const p = a.state.pipes[a.state.pipes.length-1];
  let s = 0;
  for (let i = 1; i < p.points.length; i += 1) {
    s += Math.hypot(p.points[i].x-p.points[i-1].x, p.points[i].y-p.points[i-1].y, p.points[i].z-p.points[i-1].z);
  }
  return {
    teeW: tee.w, teeC: Math.round(tee.w / 2 * 1000 * 10) / 10,
    teeX: tee.x, teeY: tee.y, teeZ: tee.z,
    len: s, mm: Math.round(s * 1000 * 10) / 10,
    bore: p.bore, fitAuto: a.fitAuto,
    cursor: { ...a.cmdCursor },
  };
}'''

SCENE_RED = '''(args) => {
  const on = args[0], side = args[1];
  const a = window.__app;
  a.clearAll({ silent: true });
  a.setFitAuto(!!on, true);
  a.setCmdBore('100A', true);
  a.setCmdCursor({x:0,y:0,z:0}, true);
  a.execOps([{op:'seg', world:true, axis:'x', sign:1, meters:2}], {source:'cmd'});
  a.setCmdCursor({x:2,y:0,z:0}, true);
  a.addFittingAtCursor('reducer');       // 100A → 80A
  const red = a.state.equipment.find((e) => e.type === 'reducer');
  if (side === 'small') {
    a.select('equipment', red.id, {silent:true});
    a.portContinue('faceB');             // 나가는(작은) 쪽 면
  }
  a.execOps([{op:'seg', world:true, axis:'x', sign:1, meters:1.0}], {source:'cmd'});
  const p = a.state.pipes[a.state.pipes.length-1];
  let s = 0;
  for (let i = 1; i < p.points.length; i += 1) {
    s += Math.hypot(p.points[i].x-p.points[i-1].x, p.points[i].y-p.points[i-1].y, p.points[i].z-p.points[i-1].z);
  }
  return { redW: red.w, len: s, mm: Math.round(s * 1000 * 10) / 10, bore: p.bore, fitAuto: a.fitAuto };
}'''

SCENE_OFF45 = '''(on) => {
  const a = window.__app;
  a.clearAll({ silent: true });
  a.setFitAuto(!!on, true);
  a.setCmdBore('100A', true);
  a.setCmdCursor({x:0,y:0,z:0}, true);
  a.execOps([{op:'seg', world:true, axis:'x', sign:1, meters:2}], {source:'cmd'});
  a.drawOffset45(500, 1000);
  const seg = (p) => {
    let s = 0;
    for (let i = 1; i < p.points.length; i += 1) {
      s += Math.hypot(p.points[i].x-p.points[i-1].x, p.points[i].y-p.points[i-1].y, p.points[i].z-p.points[i-1].z);
    }
    return Math.round(s * 1000 * 10) / 10;
  };
  const rows = [];
  a.state.pipes.forEach((p) => {
    for (let i = 1; i < p.points.length; i += 1) {
      const s = a.segCutInfo(p, i);
      rows.push({ cut: s.cut, center: s.center,
        fa: s.fa ? s.fa.label : null, fb: s.fb ? s.fb.label : null });
    }
  });
  const E = a.state.equipment.filter((e) => e.type === 'elbow45');
  return {
    pipes: a.state.pipes.map((p) => seg(p)),
    elbows: E.length,
    elbowY: E.map((e) => Math.round(e.y * 1000)),
    elbowFace: E.map((e) => e.w),
    rows,
    info: a.offset45Info(500),
    text: a.offset45Text(500),
    fitAuto: a.fitAuto,
  };
}'''

CMD_OFFSET = '''async () => {
  const C = await import('./js/cmd.js?v=84');
  const a = window.__app;
  const p1 = C.parseCommand('오프셋 500');
  const p2 = C.parseCommand('45도 오프셋 500 오른쪽');
  a.clearAll({ silent: true });
  a.setFitAuto(true, true);
  a.setCmdBore('100A', true);
  a.setCmdCursor({x:0,y:0,z:0}, true);
  a.execOps([{op:'seg', world:true, axis:'x', sign:1, meters:2}], {source:'cmd'});
  a.execOps(p1.ops, { source: 'cmd' });
  const p = a.state.pipes[a.state.pipes.length-1];
  let s = 0;
  for (let i = 1; i < p.points.length; i += 1) {
    s += Math.hypot(p.points[i].x-p.points[i-1].x, p.points[i].y-p.points[i-1].y, p.points[i].z-p.points[i-1].z);
  }
  const end = p.points[p.points.length-1];
  const first = p.points[0];
  return {
    ops1: p1.ops, unknown1: p1.unknown,
    ops2: p2.ops.map((o) => ({ op: o.op, axis: o.axis, offset: o.offset, meters: o.meters })),
    diagLen: Math.round(s * 1000 * 10) / 10,
    endY: Math.round(end.y * 1000),
    // 대각선 중심선 = 앞 배관 끝(꼭짓점)에서 대각선 끝까지
    center: (() => {
      const eb = a.state.equipment.find((e) => e.type === 'elbow45');
      if (!eb) return 0;
      return Math.round(Math.hypot(end.x - eb.x, end.y - eb.y, end.z - eb.z) * 1000 * 10) / 10;
    })(),
    elbows45: a.state.equipment.filter((e) => e.type === 'elbow45').length,
  };
}'''

REGRESSION = '''() => {
  const a = window.__app;
  a.clearAll({ silent: true });
  a.setFitAuto(true, true);
  a.setCmdBore('150A', true);
  a.setCmdCursor({x:0,y:0,z:0}, true);
  a.execOps([{op:'seg', world:true, axis:'x', sign:1, meters:3}], {source:'cmd'});
  a.setCmdCursor({x:3,y:0,z:0}, true);
  a.addFittingAtCursor('flange');
  a.execOps([{op:'seg', world:true, axis:'x', sign:1, meters:0.1}], {source:'cmd'});
  a.execOps([{op:'seg', world:true, axis:'z', sign:-1, meters:1.0}], {source:'cmd'});
  const seg = (p) => {
    let s = 0;
    for (let i = 1; i < p.points.length; i += 1) {
      s += Math.hypot(p.points[i].x-p.points[i-1].x, p.points[i].y-p.points[i-1].y, p.points[i].z-p.points[i-1].z);
    }
    return Math.round(s * 1000 * 10) / 10;
  };
  const shorty = a.state.pipes.find((p) => Math.abs(seg(p) - 100) < 3);
  const eb = a.state.equipment.find((e) => e.type === 'elbow');
  return {
    lens: a.state.pipes.map(seg),
    shortOk: !!shorty,
    elbowFace: eb ? eb.w : null,
  };
}'''

PANEL = '''() => {
  const a = window.__app;
  const txt = document.querySelector('#propBody').innerText;
  const dims = Array.from(document.querySelectorAll('#dimLayer .dim-label'))
    .filter((el) => el.style.display !== 'none').map((el) => el.textContent);
  const allDims = (a.dimItems || []).map((it) => it.text);
  return { txt, dims, allDims, cutRows: document.querySelectorAll('#propBody .cut-row').length,
           sum: (document.querySelector('#propBody .cut-sum') || {}).innerText || '' };
}'''

SHEET = '''async () => {
  const a = window.__app;
  const s = document.querySelector('#printSheet');
  const prev = s.getAttribute('style');
  s.style.cssText = 'display:block;position:absolute;left:0;top:0;width:271mm;';
  await new Promise((r) => setTimeout(r, 120));
  const out = {
    brands: Array.from(s.querySelectorAll('.ps-brand b')).map((b) => b.textContent),
    subs: Array.from(s.querySelectorAll('.ps-brand span')).map((b) => b.textContent),
    foots: Array.from(s.querySelectorAll('.ps-foot')).map((f) => f.textContent.trim()),
    pipeHead: (() => {
      const t = s.querySelector('.ps-bom .ps-pipe');
      return t ? Array.from(t.querySelectorAll('thead th')).map((th) => th.textContent.trim()) : null;
    })(),
    pipeRows: (() => {
      const t = s.querySelector('.ps-bom .ps-pipe');
      return t ? Array.from(t.querySelectorAll('tbody tr')).map((tr) => Array.from(tr.children).map((td) => td.textContent.trim())) : null;
    })(),
    cutPages: s.querySelectorAll('.ps-cut').length,
    cutRows: s.querySelectorAll('.ps-cut-table tbody tr').length,
    cutFirst: (() => {
      const tr = s.querySelector('.ps-cut-table tbody tr');
      return tr ? Array.from(tr.children).map((td) => td.textContent.trim()) : null;
    })(),
    pages: s.querySelectorAll('.ps-page').length,
    overflow: Array.from(s.querySelectorAll('.ps-page')).map((p) => {
      const pr = p.getBoundingClientRect();
      let worst = -1e9;
      p.querySelectorAll('*').forEach((k) => {
        const r = k.getBoundingClientRect();
        worst = Math.max(worst, r.bottom - pr.bottom, r.right - pr.right, pr.top - r.top, pr.left - r.left);
      });
      return Math.round(worst * 10) / 10;
    }),
    info: a.printSheetInfo,
  };
  s.style.cssText = prev || '';
  return out;
}'''


def new_page(browser, viewport, mobile, errs):
    page = browser.new_page(viewport=viewport, device_scale_factor=2 if mobile else 1,
                            is_mobile=mobile, has_touch=mobile)
    page.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    page.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)))
    page.goto(BASE + '?v=84', wait_until='networkidle')
    page.wait_for_function('window.__app && window.__app.state', timeout=30000)
    page.wait_for_timeout(700)
    return page


def run_store(page):
    s = page.evaluate(STORE)
    want = {'350A': 0.2794, '400A': 0.3048, '450A': 0.3429,
            '500A': 0.3810, '550A': 0.4191, '600A': 0.4318}
    bad = {k: (round(v * 1000, 1), round(want[k] * 1000, 1)) for k, v in s['tee'].items()
           if abs(v - want[k]) > 0.0002}
    check('A. TEE_C 350A~600A가 ASME B16.9 값(279.4·304.8·342.9·381.0·419.1·431.8mm)',
          not bad, json.dumps(bad, ensure_ascii=False) if bad else
          json.dumps({k: round(v * 1000, 1) for k, v in s['tee'].items()}, ensure_ascii=False))
    small = {'100A': 0.1048, '200A': 0.1778, '300A': 0.2540}
    check('A. TEE_C 15A~300A는 그대로 (100A 104.8 · 200A 177.8 · 300A 254.0mm)',
          all(abs(s['teeSmall'][k] - v) < 0.0002 for k, v in small.items()),
          json.dumps(s['teeSmall'], ensure_ascii=False))
    wantr = {'450A': 0.3810, '500A': 0.5080, '550A': 0.5080, '600A': 0.5080}
    badr = {k: round(v * 1000, 1) for k, v in s['red'].items() if abs(v - wantr[k]) > 0.0002}
    check('A. REDUCER_H 500A~600A = 508.0mm (450A는 381.0 그대로)', not badr,
          json.dumps({k: round(v * 1000, 1) for k, v in s['red'].items()}, ensure_ascii=False))
    d = s['d200']
    check('A. 동경 티 200A — C 177.8 · M 177.8 · 본관 355.6mm',
          abs(d['C'] - 0.1778) < 0.0002 and abs(d['M'] - 0.1778) < 0.0002 and abs(d['L'] - 0.3556) < 0.0004,
          json.dumps({k: round(v * 1000, 1) for k, v in d.items()}, ensure_ascii=False))
    check('A. 이경 티 200A×100A — 분기 M 156.0mm (본관 C 177.8)',
          abs(s['d200x100']['M'] - 0.156) < 0.0002 and abs(s['d200x100']['C'] - 0.1778) < 0.0002,
          json.dumps({k: round(v * 1000, 1) for k, v in s['d200x100'].items()}, ensure_ascii=False))
    check('A. 이경 티 100A×50A — 분기 M 89.0mm',
          abs(s['d100x50']['M'] - 0.089) < 0.0002, f"{s['d100x50']['M']*1000:.1f}mm")
    check('A. 티 600A — C 431.8 · 본관 863.6mm',
          abs(s['d600']['C'] - 0.4318) < 0.0002 and abs(s['d600']['L'] - 0.8636) < 0.0004,
          json.dumps({k: round(v * 1000, 1) for k, v in s['d600'].items()}, ensure_ascii=False))
    check('A. 레듀샤 600A — 전체 길이 508.0mm', abs(s['red600'] - 0.508) < 0.0002,
          f"{s['red600']*1000:.1f}mm")
    tp = s['teePorts']
    check('A. 이경 티 접속구 — 직진 ±177.8 · 분기 156.0mm (실제 메시와 일치)',
          abs(tp['runA'] - 0.1778) < 0.0006 and abs(tp['branch'] - 0.156) < 0.0015,
          json.dumps({k: round(v * 1000, 1) for k, v in tp.items()}, ensure_ascii=False))
    check('A. 45° 엘보 face = 표 값 그대로 (100A 63.5 · 200A 127.0 · 90° 200A 304.8mm)',
          abs(s['e45_100'] - 0.0635) < 0.00001 and abs(s['e45_200'] - 0.127) < 0.00001
          and abs(s['e90_200'] - 0.3048) < 0.00001,
          json.dumps({'e45_100A': s['e45_100'], 'e45_200A': s['e45_200'], 'e90_200A': s['e90_200']}))


def run_tee(browser):
    errs = []
    page = new_page(browser, {'width': 1280, 'height': 800}, False, errs)
    cases = [
        ('branch', 'y', True, 895.2, '티 분기(위) · fitAuto ON — 입력 1000 → 직관 895.2mm (C 104.8 제외)'),
        ('branch', 'y', False, 1000.0, '티 분기 · fitAuto OFF — 입력 1000 → 직관 1000mm'),
        ('runB', 'x', True, 895.2, '티 직진 B · fitAuto ON — 입력 1000 → 직관 895.2mm'),
        ('runB', 'x', False, 1000.0, '티 직진 B · fitAuto OFF — 입력 1000 → 직관 1000mm'),
        ('runA', 'x', True, 895.2, '티 직진 A · fitAuto ON — 입력 1000 → 직관 895.2mm'),
    ]
    for port, ax, on, want, label in cases:
        js = SCENE_TEE.replace('PORT', json.dumps(port)).replace("AX", json.dumps(ax))
        g = page.evaluate(js, on)
        check(f'B. {label}', abs(g['mm'] - want) <= 1.2,
              f"직관 {g['mm']}mm · 티 C {g['teeC']}mm · bore {g['bore']}")
    g = page.evaluate(js, True)
    check('B. 티가 배관 끝에 0mm로 앉는다 (중심 = 배관 끝 2.0m + C 104.8mm = 2.105m)',
          abs(g['teeC'] - 104.8) <= 0.3 and abs(g['teeX'] - 2.105) <= 0.002,
          f"중심 x={g['teeX']}m · C={g['teeC']}mm")
    js_err = page.evaluate('() => window.__errors.slice()')
    check('K. 콘솔 오류 0건 (티 이어그리기)', not errs and not js_err, '; '.join((errs + js_err)[:3]))
    page.close()


def run_reducer(browser):
    errs = []
    page = new_page(browser, {'width': 1280, 'height': 800}, False, errs)
    for side, on, want, label in [
        ('faceA', True, 949.2, '레듀샤 큰 쪽 면에서 · fitAuto ON — 1000 → 직관 949.2mm (H/2 50.8 제외)'),
        ('faceA', False, 1000.0, '레듀샤 큰 쪽 면에서 · fitAuto OFF — 1000 → 직관 1000mm'),
        ('small', True, 949.2, '레듀샤 작은 쪽 면에서 · fitAuto ON — 1000 → 직관 949.2mm'),
    ]:
        g = page.evaluate(SCENE_RED, [on, side])
        check(f'C. {label}', abs(g['mm'] - want) <= 1.2,
              f"직관 {g['mm']}mm · 레듀샤 길이 {round(g['redW']*1000, 1)}mm · bore {g['bore']}")
    errs2 = page.evaluate('() => window.__errors.slice()')
    check('K. 콘솔 오류 0건 (레듀샤 이어그리기)', not errs and not errs2, '; '.join((errs + errs2)[:3]))
    page.close()


def run_offset45(browser, page):
    g = page.evaluate(SCENE_OFF45, True)
    check('D. 45° 오프셋 계산 — 빗변 707.1mm · 45° 엘보 63.5×2 · 직관 절단 580.1mm',
          abs(g['info']['hyp'] * 1000 - 707.1) <= 0.1 and abs(g['info']['B'] * 1000 - 63.5) <= 0.01
          and abs(g['info']['cut'] * 1000 - 580.1) <= 0.15, g['text'])
    check('D. 계산 문구에 빗변 707.1 · 절단 580.1이 그대로 보인다',
          '707.1' in g['text'] and '580.1' in g['text'] and '63.5' in g['text'], g['text'])
    check('D. 그리면 45° 엘보 2개가 서고 오프셋 500mm가 된다',
          g['elbows'] == 2 and min(g['elbowY']) == 0 and max(g['elbowY']) == 500,
          json.dumps({'elbows': g['elbows'], 'y': g['elbowY']}, ensure_ascii=False))
    check('D. 45° 엘보 면 = 63.5mm (spec.w가 표 값 그대로)', all(abs(f - 0.0635) < 0.0002 for f in g['elbowFace']),
          json.dumps(g['elbowFace']))
    diag = g['rows'][1]
    check('D. 대각선 직관 절단 580.1mm (양 끝 45° 엘보 63.5×2 제외) — 오차 1.5mm 이내',
          abs(diag['cut'] * 1000 - 580.1) <= 1.5, f"{diag['cut']*1000:.1f}mm")
    check('D. 대각선 중심선 707.1mm (양 끝 엘보값 포함)',
          abs(diag['center'] * 1000 - 707.1) <= 1.5, f"{diag['center']*1000:.1f}mm")
    check('D. 앞·뒤 직관도 엘보 63.5씩 빠진다 (1936.5 · 936.5mm)',
          abs(g['rows'][0]['cut'] * 1000 - 1936.5) <= 1.5 and abs(g['rows'][2]['cut'] * 1000 - 936.5) <= 1.5,
          json.dumps([round(r['cut'] * 1000, 1) for r in g['rows']]))
    g2 = page.evaluate(SCENE_OFF45, False)
    check('D. fitAuto OFF — 대각선은 입력한 빗변 그대로 707.1mm',
          abs(g2['rows'][1]['cut'] * 1000 - 707.1) <= 1.5,
          f"{g2['rows'][1]['cut']*1000:.1f}mm")
    c = page.evaluate(CMD_OFFSET)
    check('D. 명령 「오프셋 500」이 45° 오프셋으로 해석된다 (빗변 707.1mm · 오프셋 500mm)',
          c['ops1'] and c['ops1'][0]['op'] == 'offset45' and abs(c['ops1'][0]['offset'] - 0.5) < 0.001
          and abs(c['endY'] - 500) <= 1.5 and abs(c['center'] - 707.1) <= 2.0 and c['elbows45'] >= 1,
          json.dumps({'ops': c['ops1'], 'endY': c['endY'], 'center': c['center'],
                      'elbows': c['elbows45'], 'unknown': c['unknown1']}, ensure_ascii=False))
    check('D. 명령 「45도 오프셋 500 오른쪽」도 방향까지 읽는다',
          c['ops2'] and c['ops2'][0]['op'] == 'offset45' and c['ops2'][0]['axis'] == 'x',
          json.dumps(c['ops2'], ensure_ascii=False))
    return g


def run_panel(page):
    # 45° 오프셋 장면을 다시 만들고 대각선 배관을 골라 속성 패널의 절단 목록을 본다
    page.evaluate(SCENE_OFF45, True)
    page.evaluate('''() => {
      const a = window.__app;
      a.setDims(true);
      const p = a.state.pipes[1] || a.state.pipes[0];
      a.select('pipe', p.id, {silent: true});
      a.rebuild();
    }''')
    page.wait_for_timeout(400)
    p = page.evaluate(PANEL)
    check('E. 속성 패널에 「✂️ 직관 절단 길이」 구간 목록이 나온다',
          '직관 절단 길이' in p['txt'] and p['cutRows'] >= 1,
          f"행 {p['cutRows']}개 · {p['sum'][:60]}")
    check('E. 패널에 절단 580mm · 중심선 707mm가 함께 보인다',
          '580' in p['sum'] and '707' in p['txt'], p['sum'])
    check('E. 치수 라벨이 ✂(절단 길이)로 표시된다 (대각선 ✂580mm)',
          any(d.startswith('✂') and '580' in d for d in p['allDims'])
          and all(d.startswith('✂') for d in p['allDims']),
          json.dumps(p['allDims'], ensure_ascii=False))
    return p


def run_print(browser, page, errs):
    page.evaluate(SCENE_OFF45, True)
    page.click('#btnExport')
    page.wait_for_timeout(350)
    page.evaluate('''async () => {
      const a = window.__app;
      a.clearCuts();
      a.setPrintBg('white'); a.ppPerPage = 1; a.ppOrient = 'landscape';
      a.ppBom = true;
      document.querySelector('#ppBom').checked = true;
      a.syncPrintOptions(); a.applyPrintPageStyle();
      a.camAnim = null;
      a.camera.position.set(2.6, 1.15, 1.7);
      a.controls.target.set(2.2, 0.25, 0);
      a.controls.update();
      a.addCut();
    }''')
    page.wait_for_timeout(300)
    page.evaluate('''async () => {
      const a = window.__app;
      await a.buildPrintSheet(a.cuts);
    }''')
    page.wait_for_timeout(300)
    s = page.evaluate(SHEET)
    check('E. 수량표 배관 표에 직관 절단(mm) · 중심선(mm) 열이 있다',
          s['pipeHead'] and '직관 절단 (mm)' in s['pipeHead'] and '중심선 (mm)' in s['pipeHead'],
          json.dumps(s['pipeHead'], ensure_ascii=False))
    row = s['pipeRows'][0] if s['pipeRows'] else None
    check('E. 수량표 숫자가 속성 패널과 같다 (직관 3,454mm · 중심선 3,708mm)',
          row and row[3].replace(',', '') in ('3454', '3453') and row[4].replace(',', '') in ('3708', '3709'),
          json.dumps(row, ensure_ascii=False))
    check('E. 「직관 절단표」 장이 따로 붙는다 (3구간)', s['cutPages'] == 1 and s['cutRows'] == 3,
          f"절단표 {s['cutPages']}장 · {s['cutRows']}줄")
    check('E. 절단표 1행이 가장 긴 직관(1,937mm)부터', s['cutFirst'] and s['cutFirst'][4].replace(',', '') in ('1936', '1937'),
          json.dumps(s['cutFirst'], ensure_ascii=False))
    check('E. 인쇄 장 수 = 컷 1 + 수량표 1 + 절단표 1', s['pages'] == 3 and s['info']['cutPages'] == 1,
          json.dumps(s['info'], ensure_ascii=False))
    check('E. 페이지 넘침 0px', all(o <= 0.5 for o in s['overflow']), json.dumps(s['overflow']))

    # ── F. 업체명 ─────────────────────────────────────────────
    check('F. 업체명 기본값 「스마일산업」 — 머리글·바닥글에 그대로',
          s['brands'][0] == '스마일산업 3D 배관 도면' and s['foots'][0].startswith('스마일산업 · 3D 배관 레이아웃'),
          json.dumps({'brand': s['brands'], 'foot': s['foots'][:1]}, ensure_ascii=False))
    check('F. 수량표·절단표 머리글도 같은 업체명',
          all(b == '스마일산업 3D 배관 도면' for b in s['brands']), json.dumps(s['brands'], ensure_ascii=False))
    page.fill('#ppCompany', '대한설비')
    page.wait_for_timeout(450)
    page.evaluate('async () => { await __app.buildPrintSheet(__app.cuts); }')
    s2 = page.evaluate(SHEET)
    check('F. 업체명을 「대한설비」로 바꾸면 머리글이 바뀐다',
          s2['brands'][0] == '대한설비 3D 배관 도면', json.dumps(s2['brands'], ensure_ascii=False))
    check('F. 바닥글도 「대한설비 · 3D 배관 레이아웃」',
          s2['foots'][0].startswith('대한설비 · 3D 배관 레이아웃'), s2['foots'][0])
    saved = page.evaluate("() => localStorage.getItem('smilePiping3D.printCompany')")
    check('F. 업체명이 localStorage에 저장된다', saved == '대한설비', str(saved))

    # 실제 인쇄 PDF — 업체명이 종이에 찍히는지
    pdf = os.path.join(TMP, 'v84-company.pdf')
    page.emulate_media(media='print')
    page.pdf(path=pdf, prefer_css_page_size=True, print_background=True)
    page.emulate_media(media='screen')
    doc = fitz.open(pdf)
    txt = ''.join(p.get_text() for p in doc)
    sizes = pdf_pages_mm(pdf)
    doc.close()
    check('F. 인쇄 PDF에 「대한설비 3D 배관 도면」·「대한설비 · 3D 배관 레이아웃」이 찍힌다',
          '대한설비 3D 배관 도면' in txt and '대한설비 · 3D 배관 레이아웃' in txt,
          txt.split('\n')[0][:60])
    check('F. 인쇄 PDF 3장 모두 A4 가로(297×210mm)',
          len(sizes) == 3 and all(abs(w - 297) < 2 and abs(h - 210) < 2 for w, h in sizes), json.dumps(sizes))
    inks = [ink_bbox_mm(pdf, i) for i in range(len(sizes))]
    check('F. 잉크가 사방 12mm 안 (절단표 장 포함)',
          all(b['box'] and b['box'][0] >= 12.4 and b['box'][2] <= 284.6 for b in inks),
          json.dumps([b['box'] for b in inks]))
    check('F. 빈 장 없음', all(b['ratio'] > 0.004 for b in inks), json.dumps([b['ratio'] for b in inks]))

    page.fill('#ppCompany', '')
    page.wait_for_timeout(450)
    page.evaluate('async () => { await __app.buildPrintSheet(__app.cuts); }')
    s3 = page.evaluate(SHEET)
    check('F. 업체명을 비우면 「3D 배관 도면」·「3D 배관 레이아웃」으로 깔끔하게',
          s3['brands'][0] == '3D 배관 도면' and s3['foots'][0].startswith('3D 배관 레이아웃'),
          json.dumps({'brand': s3['brands'][:1], 'foot': s3['foots'][:1]}, ensure_ascii=False))

    page.reload(wait_until='networkidle')
    page.wait_for_function('window.__app && window.__app.state', timeout=20000)
    page.wait_for_timeout(500)
    val = page.evaluate("() => document.querySelector('#ppCompany').value")
    check('F. 새로 열어도 마지막 업체명(빈 칸)이 그대로', val == '', json.dumps(val))
    page.click('#btnExport')
    page.wait_for_timeout(300)
    page.fill('#ppCompany', '스마일산업')
    page.wait_for_timeout(300)
    return s2


def run_regression(browser):
    errs = []
    page = new_page(browser, {'width': 390, 'height': 844}, True, errs)
    g = page.evaluate(REGRESSION)
    check('G. 회귀(v78) — 플랜지 끝에서 100mm는 fitAuto ON에서도 직관 100mm 그대로',
          g['shortOk'] and any(abs(l - 771.4) < 2 for l in g['lens']),
          json.dumps(g['lens'], ensure_ascii=False))
    check('G. 90° 엘보 150A face 228.6mm 그대로', abs(g['elbowFace'] - 0.2286) < 0.0002, str(g['elbowFace']))
    # 샘플 씬 — 티·밸브·배관이 섞인 기본 도면이 그대로 열린다
    ok = page.evaluate('''async () => {
      const S = await import('./js/store.js?v=84');
      const a = window.__app;
      a.state = S.sampleScene();
      a.selection = null;
      a.setFitAuto(true, true);
      a.rebuild();
      return { pipes: a.state.pipes.length, equips: a.state.equipment.length,
               meshes: a.root.children.length };
    }''')
    check('G. 샘플 씬이 그대로 열린다 (배관·장비·메시)',
          ok['pipes'] > 3 and ok['equips'] > 3 and ok['meshes'] > 5, json.dumps(ok, ensure_ascii=False))

    # 모바일 — 오프셋 계산기·업체명 칸이 화면 폭을 넘지 않는다
    page.click('#btnDrawer')
    page.wait_for_timeout(250)
    page.click('#tabs .tab[data-tab="pipe"]')
    page.wait_for_timeout(250)
    box = page.evaluate('''() => {
      const vw = window.innerWidth;
      const off = document.querySelector('#off45Box');
      const r = off.getBoundingClientRect();
      const btn = document.querySelector('#off45Draw');
      return { inView: r.right <= vw + 0.5 && r.left >= -0.5, w: Math.round(r.width),
               out: document.querySelector('#off45Out').textContent.trim(),
               btn: !!btn, vw };
    }''')
    check('H. 모바일 — 45° 오프셋 계산기가 패널 폭 안에 들어온다', box['inView'] and box['btn'],
          json.dumps(box, ensure_ascii=False))
    page.evaluate("() => { __app.setCmdBore('100A', true); }")
    page.fill('#off45H', '500')
    page.dispatch_event('#off45H', 'input')
    page.wait_for_timeout(200)
    out = page.evaluate("() => document.querySelector('#off45Out').textContent.trim()")
    check('H. 모바일 — 오프셋 500을 넣으면 빗변 707.1 · 절단 580.1이 보인다',
          '707.1' in out and '580.1' in out, out)
    pw = page.evaluate("""() => {
      const c = document.querySelector('#ppCompany').closest('.pp-company');
      const r = c.getBoundingClientRect();
      return { ok: r.right <= window.innerWidth + 0.5, w: Math.round(r.width) };
    }""")
    check('H. 모바일 — 업체명 입력칸이 인쇄 패널 폭 안에 들어온다', pw['ok'], json.dumps(pw, ensure_ascii=False))
    js = page.evaluate('() => window.__errors.slice()')
    check('K. 콘솔 오류 0건 (모바일 회귀)', not errs and not js, '; '.join((errs + js)[:3]))
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
            run_store(page)
            run_tee(b)
            run_reducer(b)
            run_offset45(b, page)
            run_panel(page)
            # 미리보기 ① — 절단 길이 패널 (데스크톱) · 대각선 배관을 골라 ✂580 라벨이 보이게
            page.evaluate('''() => {
              const a = window.__app;
              a.setDims(false);
              const p = a.state.pipes[1] || a.state.pipes[0];
              a.select('pipe', p.id, { silent: true });
              a.rebuild();
            }''')
            page.wait_for_timeout(900)
            page.evaluate('''() => {
              const a = window.__app;
              a.camAnim = null;
              a.camera.position.set(2.6, 1.15, 1.7);
              a.controls.target.set(2.2, 0.25, 0);
              a.controls.update();
            }''')
            page.wait_for_timeout(500)
            page.screenshot(path=os.path.join(ROOT, 'preview-v84-cutlen.png'))
            run_print(b, page, errs)
            # 미리보기 ② — 업체명이 바뀐 인쇄 시트 (PDF 첫 장)
            page.fill('#ppCompany', '대한설비')
            page.wait_for_timeout(350)
            page.evaluate('''async () => {
              const a = window.__app;
              a.ppBom = true; document.querySelector('#ppBom').checked = true;
              a.ppPerPage = 1; a.ppOrient = 'landscape'; a.syncPrintOptions(); a.applyPrintPageStyle();
              a.setDims(true);
              a.clearSelection();
              a.rebuild();
              a.camAnim = null;
              a.camera.position.set(2.6, 1.15, 1.7);
              a.controls.target.set(2.2, 0.25, 0);
              a.controls.update();
              a.clearCuts();
              a.addCut();
              await a.buildPrintSheet(a.cuts);
            }''')
            page.wait_for_timeout(400)
            page.emulate_media(media='print')
            page.pdf(path=os.path.join(TMP, 'v84-preview-company.pdf'),
                     prefer_css_page_size=True, print_background=True)
            page.emulate_media(media='screen')
            doc = fitz.open(os.path.join(TMP, 'v84-preview-company.pdf'))
            doc[0].get_pixmap(dpi=110).save(os.path.join(ROOT, 'preview-v84-print-company.png'))
            doc.close()
            js = page.evaluate('() => window.__errors.slice()')
            check('K. 콘솔 오류 0건 (데스크톱)', not errs and not js, '; '.join((errs + js)[:3]))
            page.close()
            run_regression(b)
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
