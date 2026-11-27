#!/usr/bin/env python3
"""v79 검증 — 390×844 모바일 뷰포트 실브라우저.

사용자 제보(2026-11-27 `32286` 캡처, TE-121 티 분기관 · 좌우 135° · 위아래 90° · 축 315°):
  "티를 회전하려고 하니까 좌,우 회전이 45도 회전이랑 방향이 같네.
   좌우는 제자리에서 왼쪽 오른쪽으로 돌아야 되는데 45도로 돌아"

원인 — store.js 의 3축 회전이 yaw(월드 Y)를 pitch 보다 **먼저** 걸었다(R = Rpitch·Ryaw·B).
세로 배관에 붙은 티(pitch 90°)에서는 yaw 가 먼저 세로축 둘레를 돌아 버려 수평 좌·우 대신
비스듬한 45° 회전이 됐다. v79 는 pitch 를 먼저, yaw 를 나중에(바깥) 건다(R = Ryaw·Rpitch·B).

검사 항목
 ① 준비 — 세로 배관 위 티(pitch 90 · roll 315)의 세 접속구 자세
 ② ↻ 우 45° 세 번(0→45→90→135) — 모든 접속구 축의 Y 성분 불변(수평 유지)
 ③ 같은 세 번 — 수평 방위각이 매 단계 정확히 +45° (좌·우가 제자리 수평 회전)
 ④ 접속구 끝점도 제자리 — Y 불변 + 중심에서의 수평거리 불변
 ⑤ 좌우(↺·↻ 45°)와 축(⟲·⟳ 45°)이 서로 다른 자세 (45° 회전과 겹치지 않음)
 ⑥ 위·아래(pitch)는 예전처럼 유로를 들어 올린다 (회귀)
 ⑦ equipBasis == 직접 계산한 Ryaw·Rpitch·B (순서 고정, 1e-6)
 ⑧ 엘보·밸브도 좌우는 월드 Y 둘레 (다른 기본 자세 2종)
 ⑨ 웹·퓨전360 일관성 — 자세 계산이 equipBasis/extraBasis/extraRotVec 한 곳뿐인지 소스 검사
 ⑩ 콘솔 오류 0건
"""
import json
import math
import os
import re
import subprocess
import sys
import time
from playwright.sync_api import sync_playwright

PORT = 8779
ROOT = '/workspace/projects/smile-piping-3d'
BASE = f'http://127.0.0.1:{PORT}/'
results = []


def check(name, ok, detail=''):
    results.append((name, bool(ok), detail))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''))


# ── 행 우선 3×3 수학 (store.js 와 같은 규칙, 검증용 독립 구현) ──────────────
def mm(a, b):
    return [sum(a[r * 3 + k] * b[k * 3 + c] for k in range(3)) for r in range(3) for c in range(3)]


def axis_rot(ax, deg):
    t = math.radians(deg)
    c, s, k = math.cos(t), math.sin(t), 1 - math.cos(t)
    l = math.hypot(ax[0], ax[1], ax[2]) or 1
    x, y, z = ax[0] / l, ax[1] / l, ax[2] / l
    return [c + x * x * k, x * y * k - z * s, x * z * k + y * s,
            y * x * k + z * s, c + y * y * k, y * z * k - x * s,
            z * x * k - y * s, z * y * k + x * s, c + z * z * k]


def rot_ym(deg):
    t = math.radians(deg)
    c, s = math.cos(t), math.sin(t)
    return [c, 0, s, 0, 1, 0, -s, 0, c]


def col(b, i):
    return (b[i], b[3 + i], b[6 + i])


def pitch_axis_of(h):
    ax = (-h[2], 0.0, h[0])
    return (1.0, 0.0, 0.0) if math.hypot(ax[0], ax[2]) < 1e-6 else ax


def expect_basis(b, yaw, pitch):
    """원하는 순서 — 위·아래(pitch) 먼저, 좌·우(yaw) 나중: R = Ryaw · Rpitch · B."""
    m = mm(axis_rot(pitch_axis_of(col(b, 0)), pitch), list(b)) if pitch else list(b)
    if yaw:
        m = mm(rot_ym(yaw), m)
    return m


def roll_basis(b, deg):
    """축 회전 — 1열(유로 축)은 두고 2·3열을 유로 축 둘레로 섞는다 (store.js rollBasis)."""
    if not deg:
        return list(b)
    t = math.radians(deg)
    c, s = math.cos(t), math.sin(t)
    out = list(b)
    for r in range(3):
        y, z = b[r * 3 + 1], b[r * 3 + 2]
        out[r * 3 + 1] = c * y + s * z
        out[r * 3 + 2] = -s * y + c * z
    return out


def bearing(v):
    """수평 방위각(도) — x축에서 +z 쪽을 +로."""
    return math.degrees(math.atan2(v[2], v[0]))


def dangle(a, b):
    d = (b - a) % 360
    return d - 360 if d > 180 else d


def dist3(a, b):
    return math.sqrt(sum((a[i] - b[i]) ** 2 for i in range(3)))


# ── 페이지 안 도우미 ────────────────────────────────────────────────────
LOAD_STORE = '''async () => {
  window.__S = await import('/js/store.js?v=79');
  return true;
}'''

# 세로 배관 위에 티 — 사용자 캡처와 같은 상태로 맞춘다 (dir [0,-1,0] · pitch 90 · roll 315)
# pipe=false 면 배관을 지워 '닿은 것 없음' 상태로 만든다 — reseat 이 끼어들지 않아
# 제자리 회전(중심 불변)을 그대로 잴 수 있다.
SETUP_TEE = '''([keepPipe]) => {
  const a = window.__app;
  a.clearAll({ silent: true });
  a.setFitAuto(true, true);
  a.setCmdBore('150A', true);
  a.setCmdCursor({ x: 0, y: 0, z: 0 }, true);
  a.execOps([{ op: 'seg', world: true, axis: 'y', sign: 1, meters: 2 }], { source: 'cmd' });
  a.setCmdCursor({ x: 0, y: 2, z: 0 }, true);
  a.addFittingAtCursor('tee');
  const t = a.state.equipment.find((e) => e.type === 'tee');
  if (!t) return null;
  t.x = 0; t.y = 2; t.z = 0;
  t.dir = [0, -1, 0];
  t.rot = 0;
  t.pitch = 90;
  t.roll = 315;
  delete t.yaw;
  if (!keepPipe) a.state.pipes = [];
  a.rebuild();
  a.select('equipment', t.id);
  return t.id;
}'''

READ_TEE = '''() => {
  const a = window.__app, S = window.__S;
  const t = a.state.equipment.find((e) => e.type === 'tee');
  const ports = S.teePorts(t);
  const faces = S.equipConnectFaces(t);
  const b = S.equipBasis(t);
  const f = S.equipFlowAxis(t);
  return {
    spec: { x: t.x, y: t.y, z: t.z, dir: t.dir, yaw: t.yaw || 0, pitch: t.pitch || 0, roll: t.roll || 0 },
    ports: ports.map((p) => ({ nid: p.nid, axis: [p.axis.x, p.axis.y, p.axis.z], tip: [p.tip.x, p.tip.y, p.tip.z] })),
    faces: faces.map((q) => ({ nid: q.nid, axis: [q.axis.x, q.axis.y, q.axis.z], tip: [q.tip.x, q.tip.y, q.tip.z] })),
    basis: b.slice(),
    base: S.dirBasis([0, -1, 0]).slice(),
    flow: [f.x, f.y, f.z],
  };
}'''

# 실제 속성 창의 버튼을 누른다 — data-act="rot3" data-k / data-d
CLICK_ROT3 = '''([k, d]) => {
  const btn = document.querySelector(`#props [data-act="rot3"][data-k="${k}"][data-d="${d}"]`);
  if (!btn) return { err: 'no-button', k, d };
  btn.click();
  const t = window.__app.state.equipment.find((e) => e.type === 'tee');
  return { yaw: t.yaw || 0, pitch: t.pitch || 0, roll: t.roll || 0 };
}'''

SET_SPEC = '''([patch]) => {
  const a = window.__app;
  const t = a.state.equipment.find((e) => e.type === 'tee');
  Object.keys(patch).forEach((k) => {
    if (patch[k] === null) delete t[k]; else t[k] = patch[k];
  });
  a.rebuild();
  return { yaw: t.yaw || 0, pitch: t.pitch || 0, roll: t.roll || 0 };
}'''

# 엘보·밸브 — 다른 기본 자세에서도 좌우가 월드 Y 둘레인지
READ_OTHER = '''([type, patch]) => {
  const a = window.__app, S = window.__S;
  const e = a.state.equipment.find((q) => q.type === type);
  if (!e) return null;
  Object.keys(patch).forEach((k) => { if (patch[k] === null) delete e[k]; else e[k] = patch[k]; });
  a.rebuild();
  const b = S.equipBasis(e);
  const faces = S.equipConnectFaces(e);
  const baseB = S.equipBasis(Object.assign({}, e, patch.zero ? { yaw: 0, pitch: 0, roll: 0 } : {}));
  return {
    basis: b.slice(),
    zeroBasis: baseB.slice(),
    faces: faces.map((q) => ({ nid: q.nid, axis: [q.axis.x, q.axis.y, q.axis.z], tip: [q.tip.x, q.tip.y, q.tip.z] })),
  };
}'''

CAM = '''([px, py, pz, dist, nx, ny]) => {
  const a = window.__app;
  const V = a.camera.position.constructor;
  a.camAnim = null;
  const P = new V(px, py, pz);
  const dir = new V(0.62, 0.34, 0.70).normalize();
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
  a.scene.traverse((o) => { if (o.isSprite) o.visible = false; });
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
            page.goto(BASE + '?v=79', wait_until='networkidle')
            page.wait_for_function('window.__app && window.__app.state', timeout=20000)
            page.wait_for_timeout(700)
            page.evaluate(LOAD_STORE)

            # ── ① 세로 배관 위 티(사용자 캡처 그대로) — 붙은 면이 유지되는가 ──
            tid = page.evaluate(SETUP_TEE, [True])
            page.wait_for_timeout(900)          # 속성 창 고스트 방지 시간이 지나게
            g0 = page.evaluate(READ_TEE)
            print('기준:', json.dumps(g0, ensure_ascii=False))
            check('① 준비 — 세로 배관 위 티(150A · pitch 90 · roll 315)',
                  bool(tid) and g0['spec']['pitch'] == 90 and g0['spec']['roll'] == 315
                  and len(g0['ports']) == 3,
                  json.dumps(g0['spec'], ensure_ascii=False))

            # 배관에 붙은 채로 좌우 회전 — 회전 뒤에도 접합면이 배관 끝에 남는지
            keep = []
            for i in range(1, 4):
                r = page.evaluate(CLICK_ROT3, ['yaw', 45])
                page.wait_for_timeout(220)
                if r.get('err') or round(r['yaw']) != 45 * i:
                    break
                s = page.evaluate(READ_TEE)
                top = [0, 2, 0]                 # 세로 배관 끝
                keep.append(min(dist3(q['tip'], top) for q in s['faces']))
            check('① 좌우 회전해도 접합면이 세로 배관 끝에 붙어 있음(<=1mm)',
                  len(keep) == 3 and max(keep) <= 0.001,
                  '단계별 최소 거리 ' + json.dumps([round(v * 1000, 2) for v in keep]) + ' mm')

            # ── ②③④⑦ 닿은 것 없는 티 — 순수 제자리 회전 측정 ────────────────
            page.evaluate(SETUP_TEE, [False])
            page.wait_for_timeout(600)
            g0 = page.evaluate(READ_TEE)
            steps = [g0]
            labels = ['0°', '45°', '90°', '135°']
            for i in range(1, 4):
                r = page.evaluate(CLICK_ROT3, ['yaw', 45])
                page.wait_for_timeout(220)
                if r.get('err'):
                    check(f'② {labels[i]} — ↻ 우 45° 버튼', False, json.dumps(r, ensure_ascii=False))
                    break
                if round(r['yaw']) != 45 * i:
                    check(f'② {labels[i]} — 버튼을 눌렀는데 yaw 값이 {r["yaw"]}°', False, json.dumps(r))
                    break
                steps.append(page.evaluate(READ_TEE))

            check('② 버튼 3번 → 좌우 0→45→90→135°',
                  len(steps) == 4,
                  json.dumps([s['spec']['yaw'] for s in steps], ensure_ascii=False))

            if len(steps) == 4:
                # ② 모든 접속구 축의 Y 성분 불변 — 수평이 유지되는가
                worst_y = 0.0
                for s in steps:
                    for a0, a1 in zip(g0['ports'], s['ports']):
                        worst_y = max(worst_y, abs(a1['axis'][1] - a0['axis'][1]))
                check('② 모든 접속구 축의 Y 성분 불변(수평 유지, <=2mm)', worst_y <= 0.002,
                      f'최대 {worst_y*1000:.2f}mm')

                # ③ 수평 방위각이 매 단계 +45° — 좌·우가 제자리 수평 회전
                deltas = []
                bad = []
                for i in range(1, 4):
                    prev, cur = steps[i - 1], steps[i]
                    for a0, a1 in zip(prev['ports'], cur['ports']):
                        v0, v1 = a0['axis'], a1['axis']
                        h0 = math.hypot(v0[0], v0[2])
                        h1 = math.hypot(v1[0], v1[2])
                        if h0 < 0.1 or h1 < 0.1:
                            continue            # 세로로 선 축은 좌우 회전에 그대로
                        d = dangle(bearing(v0), bearing(v1))
                        deltas.append((a0['nid'], i, round(d, 3)))
                        if abs(abs(d) - 45.0) > 0.6:
                            bad.append((a0['nid'], i, round(d, 3)))
                signs = {1 if d > 0 else -1 for _, _, d in deltas if abs(abs(d) - 45) <= 0.6}
                check('③ 수평 방위각이 매 단계 정확히 45°', deltas and not bad,
                      f'{len(deltas)}개 축 · 어긋남 {bad}')
                check('③ 세 단계 모두 같은 방향(한쪽으로 계속)', len(signs) == 1,
                      f'방향 부호 {sorted(signs)} · {[d for _, _, d in deltas]}')

                # ④ 제자리 회전 — 중심 좌표까지 그대로여야 한다(닿은 것 없음)
                worst_dy = 0.0
                worst_r = 0.0
                worst_c = 0.0
                for s in steps:
                    worst_c = max(worst_c, dist3([s['spec'][k] for k in ('x', 'y', 'z')],
                                                 [g0['spec'][k] for k in ('x', 'y', 'z')]))
                    for a0, a1 in zip(g0['ports'], s['ports']):
                        o0 = [a0['tip'][i] - g0['spec'][k] for i, k in enumerate(('x', 'y', 'z'))]
                        o1 = [a1['tip'][i] - s['spec'][k] for i, k in enumerate(('x', 'y', 'z'))]
                        worst_dy = max(worst_dy, abs(o1[1] - o0[1]))
                        worst_r = max(worst_r, abs(math.hypot(o1[0], o1[2]) - math.hypot(o0[0], o0[2])))
                check('④ 티 중심 좌표 불변 — 제자리 회전(중심 이동 0)', worst_c <= 1e-3,
                      f'중심 이동 {worst_c*1000:.2f}mm')
                check('④ 중심 기준 접속구 높이 불변(<=2mm)', worst_dy <= 0.002, f'최대 {worst_dy*1000:.2f}mm')
                check('④ 중심 기준 수평거리 불변 — 제자리 회전(<=3mm)', worst_r <= 0.003,
                      f'최대 {worst_r*1000:.2f}mm')
                face_gap = max(dist3(f['tip'], q['tip']) for s in steps
                               for f, q in zip(s['faces'], s['ports']))
                check('④ 연결면(equipConnectFaces) = 티 접속구 끝점', face_gap <= 1e-3,
                      f'최대 {face_gap*1000:.2f}mm')

                # ⑦ equipBasis == Rroll·Ryaw·Rpitch·B (순서 고정)
                worst_m = 0.0
                for s in steps:
                    exp = roll_basis(expect_basis(g0['base'], s['spec']['yaw'], s['spec']['pitch']),
                                     s['spec']['roll'])
                    worst_m = max(worst_m, max(abs(a - b2) for a, b2 in zip(s['basis'], exp)))
                check('⑦ equipBasis = Ryaw·Rpitch·B (pitch 먼저 · yaw 나중)', worst_m <= 1e-6,
                      f'최대 차 {worst_m:.2e}')

            # ── ⑤ 좌우(45°) vs 축(45°) 가 서로 다른 자세 ────────────────────
            page.evaluate(SET_SPEC, [{'yaw': None, 'roll': 0, 'pitch': 90}])
            page.wait_for_timeout(150)
            b_base = page.evaluate(READ_TEE)['basis']
            page.evaluate(SET_SPEC, [{'yaw': 45, 'roll': 0, 'pitch': 90}])
            page.wait_for_timeout(150)
            b_yaw = page.evaluate(READ_TEE)['basis']
            page.evaluate(SET_SPEC, [{'yaw': None, 'roll': 45, 'pitch': 90}])
            page.wait_for_timeout(150)
            b_roll = page.evaluate(READ_TEE)['basis']
            diff = max(abs(a - c) for a, c in zip(b_yaw, b_roll))
            same = max(abs(a - c) for a, c in zip(b_base, b_roll))
            run_base = col(b_base, 0)
            run_yaw = col(b_yaw, 0)
            run_roll = col(b_roll, 0)
            check('⑤ 좌우 45° 와 축 45° 가 다른 자세 (겹치지 않음)', diff > 0.3,
                  f'자세 차 {diff:.3f}')
            check('⑤ 좌우 45° — 유로 축이 수평으로 45° 돈다',
                  abs(dangle(bearing(run_base), bearing(run_yaw))) - 45 <= 0.6
                  and abs(run_yaw[1] - run_base[1]) <= 2e-3,
                  f'방위 {bearing(run_base):.1f}→{bearing(run_yaw):.1f}° · Y {run_base[1]:.3f}→{run_yaw[1]:.3f}')
            check('⑤ 축 45° — 유로 축은 그대로(제 축 둘레)',
                  dist3(run_base, run_roll) <= 2e-3 and same > 0.2,
                  f'유로축 변화 {dist3(run_base, run_roll):.4f} · 자세 변화 {same:.3f}')

            # ── ⑥ 위·아래(pitch) 회귀 — 유로가 실제로 기운다 ─────────────────
            page.evaluate(SET_SPEC, [{'yaw': None, 'roll': None, 'pitch': None}])
            page.wait_for_timeout(150)
            f0 = page.evaluate(READ_TEE)['flow']
            page.evaluate(SET_SPEC, [{'pitch': 45}])
            page.wait_for_timeout(150)
            f1 = page.evaluate(READ_TEE)['flow']
            page.evaluate(SET_SPEC, [{'pitch': 90}])
            page.wait_for_timeout(150)
            f2 = page.evaluate(READ_TEE)['flow']
            check('⑥ 위·아래 45° — 유로 Y 가 -0.707 로 기운다',
                  abs(f1[1] + math.sqrt(0.5)) <= 3e-3, f'유로 {[round(v,3) for v in f1]}')
            check('⑥ 위·아래 90° — 유로가 완전히 수평', abs(f2[1]) <= 3e-3,
                  f'유로 {[round(v,3) for v in f2]}')
            check('⑥ pitch 만 걸면 v78 과 같다 (yaw 없음)', abs(f0[1] + 1) <= 3e-3,
                  f'기본 유로 {[round(v,3) for v in f0]}')

            # ── ⑧ 다른 기본 자세 — 엘보(두 다리) · 밸브(수직 axis) ────────────
            other = page.evaluate('''() => {
              const a = window.__app, S = window.__S;
              a.clearAll({ silent: true });
              const mk = (type, opts) => {
                const t = S.makeEquipment(type, Object.assign({ x: 0, y: 1, z: 0, bore: '100A' }, opts));
                a.state.equipment.push(t);
                return t;
              };
              const el = mk('elbow', { inDir: [1, 0, 0], outDir: [0, 1, 0], rot: 0 });
              const vv = mk('valve', { axis: 'y', rot: 0 });
              a.rebuild();
              const grab = (e) => {
                const faces = S.equipConnectFaces(e).map((q) => ({
                  nid: q.nid, axis: [q.axis.x, q.axis.y, q.axis.z], tip: [q.tip.x, q.tip.y, q.tip.z],
                }));
                return { id: e.id, basis: S.equipBasis(e).slice(), faces, flow: S.equipFlowAxis(e) };
              };
              const out = { zero: {}, yaw45: {}, pitch60yaw45: {} };
              [[el, 'elbow'], [vv, 'valve']].forEach(([e, k]) => {
                delete e.yaw; delete e.pitch;
                out.zero[k] = grab(e);
                e.yaw = 45;
                out.yaw45[k] = grab(e);
                e.pitch = 60;
                out.pitch60yaw45[k] = grab(e);
                delete e.yaw; delete e.pitch;
              });
              return out;
            }''')
            worst_oy = 0.0
            worst_od = []
            for k in ('elbow', 'valve'):
                z = other['zero'][k]
                y = other['yaw45'][k]
                for f0_, f1_ in zip(z['faces'], y['faces']):
                    worst_oy = max(worst_oy, abs(f1_['axis'][1] - f0_['axis'][1]))
                    h0 = math.hypot(f0_['axis'][0], f0_['axis'][2])
                    if h0 >= 0.1:
                        d = abs(dangle(bearing(f0_['axis']), bearing(f1_['axis'])))
                        worst_od.append((k, f0_['nid'], round(d, 2)))
                # pitch 60 + yaw 45 조합도 직접 계산과 같은가
                zz = other['zero'][k]
                py = other['pitch60yaw45'][k]
                exp = expect_basis(zz['basis'], 45, 60)
                worst_oy = max(worst_oy, max(abs(a - c) for a, c in zip(py['basis'], exp)))
            check('⑧ 엘보·밸브 — 좌우 45° 도 수평 유지(Y 불변)', worst_oy <= 2e-3,
                  f'최대 {worst_oy*1000:.2f}mm')
            check('⑧ 엘보·밸브 — 수평 방위각 45°', all(abs(d - 45) <= 0.6 for _, _, d in worst_od),
                  json.dumps(worst_od, ensure_ascii=False))

            # ── ⑨ 웹·퓨전360 일관성 (소스) ───────────────────────────────────
            def read(pth):
                with open(os.path.join(ROOT, pth), encoding='utf-8') as fh:
                    return fh.read()

            store = read('js/store.js')
            builders = read('js/builders.js')
            fusion = read('js/fusion.js')
            mainj = read('js/main.js')
            bodies = {'builders.js': builders, 'fusion.js': fusion, 'main.js': mainj}
            own_math = {k: [ln for ln in v.splitlines()
                            if re.search(r'\b(rotYM|axisRot)\s*\(', ln) and 'store' not in ln]
                        for k, v in bodies.items()}
            check('⑨ 자세 계산은 store.js 한 곳 (builders·fusion·main 에 자체 rotYM/axisRot 없음)',
                  all(not v for v in own_math.values()),
                  json.dumps({k: len(v) for k, v in own_math.items()}, ensure_ascii=False))
            check('⑨ 빌더·퓨전 모두 equipBasis 를 그대로 쓴다',
                  'equipBasis(spec)' in builders and 'equipBasis(e)' in fusion
                  and 'extraBasis(b, spec.yaw, spec.pitch)' in store
                  and 'extraBasis(M, spec.yaw, spec.pitch)' in store,
                  'builders: equipBasis(spec) · fusion: equipBasis(e) · 티: extraBasis(M,…)')

            # ── 미리보기 — 사용자 캡처 상태 그대로(좌우 135 · 위아래 90 · 축 315) ──
            page.evaluate(SETUP_TEE, [True])
            page.wait_for_timeout(300)
            page.evaluate(SET_SPEC, [{'yaw': 90, 'pitch': 90, 'roll': 315}])
            page.wait_for_timeout(400)
            page.evaluate(PREP)
            page.evaluate(CAM, [0, 1.95, 0, 1.7, 0, -0.02])
            page.wait_for_timeout(400)
            print('미리보기 상태:', page.evaluate('''() => { const a = window.__app; const t = a.state.equipment.find((e) => e.type === 'tee'); return {
              yaw: t.yaw, pitch: t.pitch, roll: t.roll, cam: +a.camera.position.distanceTo(a.controls.target).toFixed(2) }; }'''))
            page.screenshot(path=ROOT + '/preview-v79-tee-yaw.png')
            print('미리보기 저장:', ROOT + '/preview-v79-tee-yaw.png')

            check('⑩ 콘솔 오류 0건', not errs, '; '.join(errs[:3]))
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
