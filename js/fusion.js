// 스마일산업 3D 배관 — Fusion 360 스크립트(.py) 생성기
// 씬 상태(미터)를 Fusion 360 API(내부 단위 cm)로 변환하는 자립형 스크립트를 만든다.
import { elbowBasis, dirBasis } from './store.js?v=24';

function pyString(text) {
  // JSON을 파이썬 raw 삼중 문자열로 안전하게 담기
  const safe = String(text).replace(/'''/g, '\\u0027\\u0027\\u0027');
  return "r'''" + safe + "'''";
}

export function buildFusionScript(state) {
  const scene = {
    name: state.name || '스마일산업 배관 도면',
    equipment: state.equipment.map((e) => {
      const item = {
        type: e.type, name: e.name, x: e.x, y: e.y, z: e.z,
        w: e.w, h: e.h, d: e.d, rot: e.rot,
        bore1: e.bore1 || null, bore2: e.bore2 || null,
      };
      // 엘보는 관경과 두 다리 방향을 함께 넘겨야 Fusion에서도 배관과 같은 방향으로 앉는다.
      if (e.type === 'elbow' || e.type === 'elbow45') {
        item.bore = e.bore || e.bore1 || '100A';
        if (Array.isArray(e.inDir) && Array.isArray(e.outDir)) {
          item.inDir = e.inDir;
          item.outDir = e.outDir;
          item.rmat = elbowBasis(e.inDir, e.outDir).map((v) => Math.round(v * 1e6) / 1e6);
        } else {
          const th = (Number(e.rot) || 0) * Math.PI / 180;
          const c = Math.cos(th);
          const s = Math.sin(th);
          item.rmat = [c, 0, s, 0, 1, 0, -s, 0, c];
        }
      }
      // 배관 끝 부속(플랜지·밸브·피팅)은 진행 방향 벡터를 함께 넘긴다 —
      // 웹앱과 같은 축 정렬(수직·좌우·45° 경사)로 Fusion에 놓인다.
      if (!item.rmat && Array.isArray(e.dir) && e.dir.length === 3) {
        item.dir = e.dir;
        item.rmat = dirBasis(e.dir).map((v) => Math.round(v * 1e6) / 1e6);
      }
      return item;
    }),
    pipes: state.pipes.map((p) => ({
      name: p.name, bore: p.bore, material: p.material,
      points: p.points.map((pt) => ({ x: pt.x, y: pt.y, z: pt.z })),
    })),
  };
  const jsonText = JSON.stringify(scene, null, 1);
  const counts = `장비 ${state.equipment.length}개 · 배관 ${state.pipes.length}개`;

  return `# -*- coding: utf-8 -*-
# =============================================================================
#  스마일산업 3D 배관 → Autodesk Fusion 360 자동 생성 스크립트
#  생성: 스마일산업 3D 배관 웹앱 · ${counts}
#
#  사용법
#   1) Fusion 360 실행 → 도구(Tools) → 스크립트 및 추가기능(Scripts and Add-Ins)
#   2) 스크립트 탭 → 생성(Create) → 스크립트(Script)
#   3) 언어: Python, 이름: SmilePiping3D 로 만든 뒤,
#      생성된 폴더의 SmilePiping3D.py 를 이 파일로 덮어쓰기
#   4) 스크립트 목록에서 선택 → 실행(Run)
#
#  좌표: 웹앱의 1m = Fusion 100cm(내부 단위). Fusion 화면 단위는 mm로 맞춰 두면
#        편합니다. 장비는 박스/원통, 배관은 원통(파이프)+짧은 원통(엘보)으로 생성됩니다.
# =============================================================================
import adsk.core
import adsk.fusion
import traceback
import math
import json

SCENE_JSON = ${pyString(jsonText)}

# 웹앱 단위(m) → Fusion 내부 단위(cm)
S = 100.0


def _to_fusion(p):
    """웹앱 (x, y=높이, z) → Fusion (x, y, z=높이), m → cm"""
    return (p[0] * S, p[2] * S, p[1] * S)


def _norm(v):
    l = math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
    if l < 1e-9:
        return (0.0, 0.0, 1.0)
    return (v[0] / l, v[1] / l, v[2] / l)


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0])


def add_cylinder(comp, a, b, radius, name):
    """a, b: 웹앱 좌표(m). 두 점을 잇는 원통 바디를 만든다."""
    fa = _to_fusion(a)
    fb = _to_fusion(b)
    dx = fb[0] - fa[0]
    dy = fb[1] - fa[1]
    dz = fb[2] - fa[2]
    length = math.sqrt(dx * dx + dy * dy + dz * dz)
    if length < 1e-2 or radius * S < 1e-2:
        return None
    sk = comp.sketches.add(comp.xYConstructionPlane)
    sk.name = ('SK_' + name)[:30]
    sk.sketchCurves.sketchCircles.addByCenterRadius(
        adsk.core.Point3D.create(0, 0, 0), radius * S)
    prof = sk.profiles.item(0)
    if prof is None:
        return None
    ext_in = comp.features.extrudeFeatures.createInput(
        prof, adsk.fusion.FeatureOperations.NewBodyFeatureOperation)
    ext_in.setDistanceExtent(False, adsk.core.ValueInput.createByReal(length))
    body = comp.features.extrudeFeatures.add(ext_in).bodies.item(0)
    body.name = name
    z = _norm((dx, dy, dz))
    up = (0.0, 0.0, 1.0) if abs(z[2]) < 0.9 else (1.0, 0.0, 0.0)
    x = _norm(_cross(up, z))
    y = _cross(z, x)
    m = adsk.core.Matrix3D.create()
    m.setWithCoordinateSystem(
        adsk.core.Point3D.create(fa[0], fa[1], fa[2]),
        adsk.core.Vector3D.create(x[0], x[1], x[2]),
        adsk.core.Vector3D.create(y[0], y[1], y[2]),
        adsk.core.Vector3D.create(z[0], z[1], z[2]))
    body.transform(m)
    return body


def add_box(comp, cx, cy, cz, w, h, d, rot, name, rmat=None):
    """바닥 중심 (cx, cy, cz), 크기 w(가로) x h(높이) x d(깊이), rot 도(deg).
    rmat: 배관 축 정렬 행렬(행 우선 3x3). 주어지면 rot 대신 이 축으로 돌린다."""
    if w * S < 1e-2 or h * S < 1e-2 or d * S < 1e-2:
        return None
    sk = comp.sketches.add(comp.xYConstructionPlane)
    sk.name = ('SK_' + name)[:30]
    lines = sk.sketchCurves.sketchLines
    lines.addTwoPointRectangle(
        adsk.core.Point3D.create(-w * S / 2.0, -d * S / 2.0, 0),
        adsk.core.Point3D.create(w * S / 2.0, d * S / 2.0, 0))
    prof = sk.profiles.item(0)
    if prof is None:
        return None
    ext_in = comp.features.extrudeFeatures.createInput(
        prof, adsk.fusion.FeatureOperations.NewBodyFeatureOperation)
    ext_in.setDistanceExtent(False, adsk.core.ValueInput.createByReal(h * S))
    body = comp.features.extrudeFeatures.add(ext_in).bodies.item(0)
    body.name = name
    if rmat:
        # 로컬 X·Y·Z 축을 웹앱 (x, y=높이, z) → Fusion (x, 높이, z) 로 옮긴다.
        xaxis = (rmat[0], rmat[6], rmat[3])
        yaxis = (rmat[1], rmat[7], rmat[4])
        zaxis = (rmat[2], rmat[8], rmat[5])
    else:
        th = math.radians(rot or 0)
        xaxis = (math.cos(th), -math.sin(th), 0.0)
        zaxis = (0.0, 0.0, 1.0)
        yaxis = _cross(zaxis, xaxis)
    m = adsk.core.Matrix3D.create()
    m.setWithCoordinateSystem(
        adsk.core.Point3D.create(cx * S, cz * S, cy * S),
        adsk.core.Vector3D.create(xaxis[0], xaxis[1], xaxis[2]),
        adsk.core.Vector3D.create(yaxis[0], yaxis[1], yaxis[2]),
        adsk.core.Vector3D.create(zaxis[0], zaxis[1], zaxis[2]))
    body.transform(m)
    return body


def local_to_world(e, local):
    """장비 회전(엘보는 rmat, 나머지는 rot)까지 반영한 로컬 좌표 → 웹앱 좌표"""
    lx, ly, lz = local
    m = e.get('rmat')
    if m:
        return (e['x'] + m[0] * lx + m[1] * ly + m[2] * lz,
                e['y'] + m[3] * lx + m[4] * ly + m[5] * lz,
                e['z'] + m[6] * lx + m[7] * ly + m[8] * lz)
    th = math.radians(e.get('rot', 0) or 0)
    c = math.cos(th)
    s = math.sin(th)
    return (e['x'] + lx * c + lz * s,
            e['y'] + ly,
            e['z'] - lx * s + lz * c)


BORES = {
    '50A': 0.0605, '80A': 0.0891, '100A': 0.1143,
    '150A': 0.1652, '200A': 0.2163,
}
JACKET = {'insulated': 0.035}


def build_heat_exchanger(comp, e, tag):
    made = 0
    L = max(0.6, e.get('w', 3.0))
    dia = max(0.2, e.get('h', 0.75))
    R = dia / 2.0
    leg = max(0.22, min(0.55, dia * 0.62))
    body_len = L * 0.74
    cy = leg + R
    # 쉘
    if add_cylinder(comp, local_to_world(e, (-body_len / 2, cy, 0)),
                    local_to_world(e, (body_len / 2, cy, 0)), R, tag + '_Shell'):
        made += 1
    # 채널 헤드 2개
    for sx in (-1, 1):
        a = local_to_world(e, (sx * (body_len / 2 + 0.04), cy, 0))
        b = local_to_world(e, (sx * (body_len / 2 + 0.24), cy, 0))
        if add_cylinder(comp, a, b, R * 0.85, tag + '_Channel'):
            made += 1
    # 새들 지지대 2개
    for sx in (-1, 1):
        w = local_to_world(e, (sx * L * 0.27, 0, 0))
        if add_box(comp, w[0], w[1], w[2], 0.14, leg, dia * 1.04, e.get('rot', 0), tag + '_Saddle'):
            made += 1
    # 상부 노즐 2개
    for sx in (-1, 1):
        a = local_to_world(e, (sx * L * 0.24, leg + dia - 0.02, 0))
        b = local_to_world(e, (sx * L * 0.24, leg + dia + 0.3, 0))
        if add_cylinder(comp, a, b, R * 0.3, tag + '_Nozzle'):
            made += 1
    return made


def build_pump(comp, e, tag):
    made = 0
    sx = e.get('w', 1.15) / 1.15
    sy = e.get('h', 0.85) / 0.85
    sz = e.get('d', 0.6) / 0.6
    rs = (sx + sy + sz) / 3.0
    rot = e.get('rot', 0)

    def L(lx, ly, lz):
        return local_to_world(e, (lx * sx, ly * sy, lz * sz))

    # 베이스
    base = L(0.02, 0, 0)
    if add_box(comp, base[0], base[1], base[2], 1.08 * sx, 0.12 * sy, 0.5 * sz, rot, tag + '_Base'):
        made += 1
    # 볼류트 케이싱 (축 Z)
    if add_cylinder(comp, L(0.12, 0.42, -0.15), L(0.12, 0.42, 0.2), 0.24 * rs, tag + '_Casing'):
        made += 1
    # 모터
    if add_cylinder(comp, L(0.6, 0.42, 0), L(1.02, 0.42, 0), 0.165 * rs, tag + '_Motor'):
        made += 1
    # 토출 노즐
    if add_cylinder(comp, L(0.12, 0.42, 0), L(0.12, 0.74, 0), 0.085 * rs, tag + '_Discharge'):
        made += 1
    # 흡입 노즐
    if add_cylinder(comp, L(0.12, 0.42, 0.15), L(0.12, 0.42, 0.4), 0.11 * rs, tag + '_Suction'):
        made += 1
    return made


def build_tank(comp, e, tag):
    r = max(0.15, e.get('w', 0.6) / 2.0)
    h = max(0.2, e.get('h', 0.9))
    if add_cylinder(comp, local_to_world(e, (0, 0, 0)), local_to_world(e, (0, h, 0)), r, tag + '_Shell'):
        return 1
    return 0


def build_panel(comp, e, tag):
    p = local_to_world(e, (0, 0, 0))
    if add_box(comp, p[0], p[1], p[2], e.get('w', 1.2), e.get('h', 2.0), e.get('d', 0.7),
               e.get('rot', 0), tag + '_Cabinet'):
        return 1
    return 0


def build_valve(comp, e, tag):
    made = 0
    sw = e.get('w', 0.34) / 0.34
    sh = e.get('h', 0.55) / 0.58
    rs = (sw + sh) / 2.0
    def P(lx, ly, lz):
        # local_to_world 가 장비 회전(rot)을 적용하므로 로컬 좌표로 전달한다
        return local_to_world(e, (lx, ly, lz))

    def on_axis(dist, ly):
        return P(dist, ly, 0)

    # 몸체
    if add_cylinder(comp, on_axis(-0.08, 0), on_axis(0.08, 0), 0.085 * rs, tag + '_Body'):
        made += 1
    # 플랜지 2개
    for sx in (-1, 1):
        if add_cylinder(comp, on_axis(sx * 0.085, 0), on_axis(sx * 0.125, 0), 0.13 * rs, tag + '_Flange'):
            made += 1
    # 보닛 + 스템
    if add_cylinder(comp, P(0, 0.04, 0), P(0, 0.32, 0), 0.045 * rs, tag + '_Stem'):
        made += 1
    # 핸드휠 (원판)
    if add_cylinder(comp, P(0, 0.38, 0), P(0, 0.41, 0), 0.17 * rs, tag + '_Handwheel'):
        made += 1
    return made


def _scaled(e, w0, h0, d0):
    """기본 치수 대비 배율 (웹앱에서 사용자가 바꿀 수 있음)"""
    return (max(0.05, e.get('w', w0)) / w0,
            max(0.05, e.get('h', h0)) / h0,
            max(0.05, e.get('d', d0)) / d0)


def build_vpump(comp, e, tag):
    """입형 인라인 펌프 — 하부 흡입 플랜지 · 볼류트 · 세로 모터 · 단자함"""
    made = 0
    sx, sy, sz = _scaled(e, 0.42, 0.85, 0.42)
    rot = e.get('rot', 0)

    def P(lx, ly, lz):
        return local_to_world(e, (lx * sx, ly * sy, lz * sz))

    p = P(0, 0, 0)
    if add_box(comp, p[0], p[1], p[2], 0.5 * sx, 0.06 * sy, 0.5 * sz, rot, tag + '_Base'):
        made += 1
    if add_cylinder(comp, P(0, 0.1, 0), P(0, 0.14, 0), 0.155 * sx, tag + '_SuctionFlange'):
        made += 1
    if add_cylinder(comp, P(0, 0.18, 0), P(0, 0.38, 0), 0.15 * sx, tag + '_Volute'):
        made += 1
    if add_cylinder(comp, P(0, 0.4, 0), P(0, 0.44, 0), 0.155 * sx, tag + '_DischargeFlange'):
        made += 1
    if add_cylinder(comp, P(0, 0.5, 0), P(0, 0.76, 0), 0.115 * sx, tag + '_Motor'):
        made += 1
    tb = P(-0.01, 0.6, 0.125)
    if add_box(comp, tb[0], tb[1], tb[2], 0.12 * sx, 0.1 * sy, 0.08 * sz, rot, tag + '_TerminalBox'):
        made += 1
    return made


def build_butterfly(comp, e, tag):
    """기어식 버터플라이 밸브 — 웨이퍼 바디 · 볼트 플랜지 · 기어박스 · 핸드휠"""
    made = 0
    sx, sy, sz = _scaled(e, 0.34, 0.46, 0.32)
    rot = e.get('rot', 0)

    def P(lx, ly, lz):
        return local_to_world(e, (lx * sx, ly * sy, lz * sz))

    if add_cylinder(comp, P(-0.05, 0, 0), P(0.05, 0, 0), 0.115 * sx, tag + '_Body'):
        made += 1
    for d in (-1, 1):
        if add_cylinder(comp, P(d * 0.05, 0, 0), P(d * 0.078, 0, 0), 0.165 * sx, tag + '_Flange'):
            made += 1
    if add_cylinder(comp, P(0, 0.1, 0), P(0, 0.22, 0), 0.036 * sx, tag + '_Neck'):
        made += 1
    gb = P(0, 0.235, 0)
    if add_box(comp, gb[0], gb[1], gb[2], 0.15 * sx, 0.11 * sy, 0.12 * sz, rot, tag + '_GearBox', e.get('rmat')):
        made += 1
    if add_cylinder(comp, P(0, 0.42, 0), P(0, 0.45, 0), 0.095 * sx, tag + '_Handwheel'):
        made += 1
    return made


def build_yvalve(comp, e, tag):
    """경사형(Y자) 체크·스트레이너 — Y 분기 바디 + 상하 플랜지 + 핸드휠"""
    made = 0
    sx, sy, sz = _scaled(e, 0.36, 0.5, 0.34)
    rot = e.get('rot', 0)

    def P(lx, ly, lz):
        return local_to_world(e, (lx * sx, ly * sy, lz * sz))

    if add_cylinder(comp, P(-0.11, 0, 0), P(0.11, 0, 0), 0.085 * sx, tag + '_Body'):
        made += 1
    for d in (-1, 1):
        if add_cylinder(comp, P(d * 0.105, 0, 0), P(d * 0.135, 0, 0), 0.135 * sx, tag + '_Flange'):
            made += 1
    # Y자 경사 분기 (아래·뒤 45도)
    if add_cylinder(comp, P(0, 0, 0), P(-0.02, -0.19, -0.15), 0.062 * sx, tag + '_YBranch'):
        made += 1
    if add_cylinder(comp, P(-0.018, -0.175, -0.138), P(-0.024, -0.225, -0.178), 0.082 * sx, tag + '_YCap'):
        made += 1
    if add_cylinder(comp, P(0, 0.05, 0), P(0, 0.25, 0), 0.014 * sx, tag + '_Stem'):
        made += 1
    if add_cylinder(comp, P(0, 0.26, 0), P(0, 0.29, 0), 0.11 * sx, tag + '_Handwheel'):
        made += 1
    return made


def build_ball(comp, e, tag):
    """볼밸브 — 바디 + 레버 핸들"""
    made = 0
    sx, sy, sz = _scaled(e, 0.26, 0.34, 0.24)
    rot = e.get('rot', 0)

    def P(lx, ly, lz):
        return local_to_world(e, (lx * sx, ly * sy, lz * sz))

    if add_cylinder(comp, P(-0.1, 0, 0), P(0.1, 0, 0), 0.055 * sx, tag + '_Body'):
        made += 1
    if add_cylinder(comp, P(-0.075, 0, 0), P(0.075, 0, 0), 0.078 * sx, tag + '_Housing'):
        made += 1
    for d in (-1, 1):
        if add_cylinder(comp, P(d * 0.09, 0, 0), P(d * 0.115, 0, 0), 0.085 * sx, tag + '_Flange'):
            made += 1
    if add_cylinder(comp, P(0, 0.06, 0), P(0, 0.13, 0), 0.022 * sx, tag + '_Stem'):
        made += 1
    lv = P(0.03, 0.13, 0)
    if add_box(comp, lv[0], lv[1], lv[2], 0.19 * sx, 0.02 * sy, 0.025 * sz, rot, tag + '_Lever', e.get('rmat')):
        made += 1
    return made


def build_check(comp, e, tag):
    """체크밸브 — 웨이퍼 · 스윙 바디"""
    made = 0
    sx, sy, sz = _scaled(e, 0.24, 0.26, 0.22)
    rot = e.get('rot', 0)

    def P(lx, ly, lz):
        return local_to_world(e, (lx * sx, ly * sy, lz * sz))

    if add_cylinder(comp, P(-0.03, 0, 0), P(0.03, 0, 0), 0.1 * sx, tag + '_Body'):
        made += 1
    for d in (-1, 1):
        if add_cylinder(comp, P(d * 0.03, 0, 0), P(d * 0.05, 0, 0), 0.115 * sx, tag + '_Flange'):
            made += 1
    bs = P(0, 0.09, 0)
    if add_box(comp, bs[0], bs[1], bs[2], 0.1 * sx, 0.05 * sy, 0.06 * sz, rot, tag + '_Boss', e.get('rmat')):
        made += 1
    return made


def build_bellows(comp, e, tag):
    """벨로우즈 신축관 — 주름 원통 + 양단 플랜지 + 타이로드"""
    made = 0
    sx, sy, sz = _scaled(e, 0.38, 0.34, 0.34)

    def P(lx, ly, lz):
        return local_to_world(e, (lx * sx, ly * sy, lz * sz))

    L = 0.24
    if add_cylinder(comp, P(-L / 2, 0, 0), P(L / 2, 0, 0), 0.098 * sx, tag + '_Sleeve'):
        made += 1
    for i in range(5):
        x = -L / 2 + 0.035 + i * ((L - 0.07) / 4)
        if add_cylinder(comp, P(x - 0.008, 0, 0), P(x + 0.008, 0, 0), 0.118 * sx, tag + '_Convolution'):
            made += 1
    for d in (-1, 1):
        if add_cylinder(comp, P(d * L / 2, 0, 0), P(d * (L / 2 + 0.032), 0, 0), 0.15 * sx, tag + '_Flange'):
            made += 1
    for dy, dz in ((0.135, 0), (-0.135, 0), (0, 0.135), (0, -0.135)):
        if add_cylinder(comp, P(-L / 2 - 0.02, dy, dz), P(L / 2 + 0.02, dy, dz), 0.011 * sx, tag + '_TieRod'):
            made += 1
    return made


def build_elbow(comp, e, tag):
    """90도 엘보 — 꼭짓점에서 +X·+Y 두 다리, 안쪽 곡관(중심 (R,R)) + 양단 직관 스텁
       (예전엔 곡관이 바깥으로 불룩해 배관을 뚫었다)"""
    made = 0
    bore = e.get('bore') or e.get('bore1') or '100A'
    od = BORES.get(bore, 0.1143)
    r = od / 2.0
    R = 1.5 * od
    Ls = 0.18 * R

    def P(lx, ly, lz):
        return local_to_world(e, (lx, ly, lz))

    # 곡관 — 중심 (R,R) 원호를 8분할 원통으로 (phi 180° → 270°)
    steps = 8
    prev = None
    for i in range(steps + 1):
        phi = (180.0 + 90.0 * i / float(steps)) * math.pi / 180.0
        cur = (R + R * math.cos(phi), R + R * math.sin(phi), 0.0)
        if prev is not None:
            if add_cylinder(comp, P(prev[0], prev[1], prev[2]), P(cur[0], cur[1], cur[2]), r, '%s_Bend%d' % (tag, i)):
                made += 1
        prev = cur
    # 양단 직관 스텁 (배관 접합면)
    if add_cylinder(comp, P(R, 0, 0), P(R + Ls, 0, 0), r, tag + '_StubX'):
        made += 1
    if add_cylinder(comp, P(0, R, 0), P(0, R + Ls, 0), r, tag + '_StubY'):
        made += 1
    return made


def _bore(b, default):
    """관경 이름 → 외경(m). 모르는 값이면 default."""
    return BORES.get(b, default)


def build_tee(comp, e, tag):
    """티 분기관 — 주배관 1차 관경 + 분기 2차 관경 (분기 노즐 지름 반영)"""
    made = 0
    b1 = e.get('bore1') or '100A'
    b2 = e.get('bore2') or b1
    r1 = _bore(b1, 0.1143) / 2.0
    r2 = _bore(b2, _bore(b1, 0.1143)) / 2.0
    L = max(0.22, 2.6 * r1 * 2.0)
    branch = max(0.1, L * 0.5)
    # 웹앱은 메시 폭(spec.w)에 맞춰 균일 배율을 준다 — 퓨전에서도 같은 배율을 쓴다.
    s = max(0.05, e.get('w') or (L + 0.03)) / (L + 0.03)
    L *= s
    branch *= s
    r1 *= s
    r2 *= s

    def P(lx, ly, lz):
        return local_to_world(e, (lx, ly, lz))

    if add_cylinder(comp, P(-L / 2, 0, 0), P(L / 2, 0, 0), r1, tag + '_Run'):
        made += 1
    if add_cylinder(comp, P(0, 0, 0), P(0, branch, 0), r2, tag + '_Branch'):
        made += 1
    if add_cylinder(comp, P(0, branch, 0), P(0, branch + 0.03, 0), r2 * 1.4, tag + '_BranchFlange'):
        made += 1
    return made


def build_reducer(comp, e, tag):
    """레듀샤 — 1차 관경에서 2차 관경으로 줄어드는 이경 원통 + 양단 플랜지"""
    made = 0
    b1 = e.get('bore1') or '100A'
    b2 = e.get('bore2') or '50A'
    r1 = _bore(b1, 0.1143) / 2.0
    r2 = _bore(b2, 0.0605) / 2.0
    L = max(0.1, 0.12 + 0.6 * abs(r1 - r2) * 2.0)
    FT = 0.024
    s = max(0.05, e.get('w') or (L + FT * 2)) / (L + FT * 2)
    L *= s
    r1 *= s
    r2 *= s
    FT *= s

    def P(lx, ly, lz):
        return local_to_world(e, (lx, ly, lz))

    # 원뿔을 3단 원통으로 근사 — 1차 관경에서 2차 관경으로 줄어드는 모양
    steps = 3
    for i in range(steps):
        xa = -L / 2 + (L / steps) * i
        xb = -L / 2 + (L / steps) * (i + 1)
        ra = r1 + (r2 - r1) * (float(i) / steps)
        if add_cylinder(comp, P(xa, 0, 0), P(xb, 0, 0), ra, '%s_Cone%d' % (tag, i + 1)):
            made += 1
    if add_cylinder(comp, P(-L / 2 - FT, 0, 0), P(-L / 2, 0, 0), r1 * 1.22, tag + '_FlangeBig'):
        made += 1
    if add_cylinder(comp, P(L / 2, 0, 0), P(L / 2 + FT, 0, 0), r2 * 1.35, tag + '_FlangeSmall'):
        made += 1
    return made


def build_nipple(comp, e, tag):
    """니쁠(단니쁠) — 육각 너트부 + 양단 수나사"""
    made = 0
    sx, sy, sz = _scaled(e, 0.146, 0.1, 0.1)
    rs = (sx + sy + sz) / 3.0

    def P(lx, ly, lz):
        return local_to_world(e, (lx * sx, ly * sy, lz * sz))

    if add_cylinder(comp, P(-0.025, 0, 0), P(0.025, 0, 0), 0.05 * rs, tag + '_HexNut'):
        made += 1
    if add_cylinder(comp, P(-0.07, 0, 0), P(-0.026, 0, 0), 0.03 * rs, tag + '_ThreadA'):
        made += 1
    if add_cylinder(comp, P(0.026, 0, 0), P(0.07, 0, 0), 0.03 * rs, tag + '_ThreadB'):
        made += 1
    return made


def build_elbow45(comp, e, tag):
    """45° 엘보 — 두 다리가 135° 벌어진 곡관 (배관은 45°만 꺾인다)"""
    made = 0
    bore = e.get('bore') or e.get('bore1') or '100A'
    od = BORES.get(bore, 0.1143)
    r = od / 2.0
    R = 1.5 * od
    T = R * math.tan(math.pi / 8.0)
    Ls = 0.18 * R
    cx, cy = T, R

    def P(lx, ly, lz):
        return local_to_world(e, (lx, ly, lz))

    # 곡관 — 중심 (T,R) 원호, phi -135° → -90°
    steps = 6
    prev = None
    for i in range(steps + 1):
        phi = (-135.0 + 45.0 * i / float(steps)) * math.pi / 180.0
        cur = (cx + R * math.cos(phi), cy + R * math.sin(phi), 0.0)
        if prev is not None:
            if add_cylinder(comp, P(prev[0], prev[1], prev[2]), P(cur[0], cur[1], cur[2]), r, '%s_Bend%d' % (tag, i)):
                made += 1
        prev = cur
    ux = -math.sqrt(0.5)
    uy = math.sqrt(0.5)
    if add_cylinder(comp, P(T, 0, 0), P(T + Ls, 0, 0), r, tag + '_StubX'):
        made += 1
    if add_cylinder(comp, P(T * ux, T * uy, 0), P((T + Ls) * ux, (T + Ls) * uy, 0), r, tag + '_Stub45'):
        made += 1
    return made


def build_cap(comp, e, tag):
    """엔드캡 — 원통 몸체 + 돔 마감"""
    made = 0
    sx, sy, sz = _scaled(e, 0.148, 0.11, 0.11)
    rs = (sy + sz) / 2.0

    def P(lx, ly, lz):
        return local_to_world(e, (lx * sx, ly * sy, lz * sz))

    if add_cylinder(comp, P(-0.058, 0, 0), P(0.018, 0, 0), 0.055 * rs, tag + '_Body'):
        made += 1
    if add_cylinder(comp, P(0.018, 0, 0), P(0.05, 0, 0), 0.04 * rs, tag + '_Dome'):
        made += 1
    return made


def build_union(comp, e, tag):
    """유니온 — 육각 조임 너트 3단 + 양단 소켓"""
    made = 0
    sx, sy, sz = _scaled(e, 0.206, 0.1, 0.1)
    rs = (sy + sz) / 2.0

    def P(lx, ly, lz):
        return local_to_world(e, (lx * sx, ly * sy, lz * sz))

    if add_cylinder(comp, P(-0.03, 0, 0), P(0.03, 0, 0), 0.05 * rs, tag + '_NutCenter'):
        made += 1
    if add_cylinder(comp, P(-0.068, 0, 0), P(-0.026, 0, 0), 0.043 * rs, tag + '_NutA'):
        made += 1
    if add_cylinder(comp, P(0.026, 0, 0), P(0.068, 0, 0), 0.043 * rs, tag + '_NutB'):
        made += 1
    if add_cylinder(comp, P(-0.103, 0, 0), P(-0.068, 0, 0), 0.033 * rs, tag + '_SocketA'):
        made += 1
    if add_cylinder(comp, P(0.068, 0, 0), P(0.103, 0, 0), 0.033 * rs, tag + '_SocketB'):
        made += 1
    return made


def build_flow(comp, e, tag):
    """유량계 — 플랜지 바디 + 상부 트랜스미터 헤드"""
    made = 0
    sx, sy, sz = _scaled(e, 0.24, 0.42, 0.24)
    rs = (sx + sy + sz) / 3.0

    def P(lx, ly, lz):
        return local_to_world(e, (lx * sx, ly * sy, lz * sz))

    if add_cylinder(comp, P(-0.09, 0, 0), P(0.09, 0, 0), 0.06 * rs, tag + '_Body'):
        made += 1
    for d in (-1, 1):
        if add_cylinder(comp, P(d * 0.088, 0, 0), P(d * 0.12, 0, 0), 0.1 * rs, tag + '_Flange'):
            made += 1
    if add_cylinder(comp, P(0, 0.04, 0), P(0, 0.16, 0), 0.035 * rs, tag + '_Stem'):
        made += 1
    if add_cylinder(comp, P(0, 0.19, 0), P(0, 0.35, 0), 0.082 * rs, tag + '_Head'):
        made += 1
    if add_cylinder(comp, P(0, 0.35, 0), P(0, 0.38, 0), 0.086 * rs, tag + '_HeadCap'):
        made += 1
    return made


def build_flange(comp, e, tag):
    """플랜지 — 볼트링 원판 + 볼트 8개"""
    made = 0
    sx, sy, sz = _scaled(e, 0.14, 0.26, 0.26)

    def P(lx, ly, lz):
        return local_to_world(e, (lx * sx, ly * sy, lz * sz))

    if add_cylinder(comp, P(-0.022, 0, 0), P(0.022, 0, 0), 0.12 * sx, tag + '_Disc'):
        made += 1
    for i in range(8):
        a = math.pi * 2 * i / 8
        dy, dz = math.cos(a) * 0.093, math.sin(a) * 0.093
        if add_cylinder(comp, P(-0.03, dy, dz), P(0.03, dy, dz), 0.014 * sx, '%s_Bolt%d' % (tag, i + 1)):
            made += 1
    return made


def build_support(comp, e, tag):
    """파이프 서포트 — 베이스 플레이트 + 지주 + 새들 + U볼트"""
    made = 0
    sx, sy, sz = _scaled(e, 0.5, 0.85, 0.4)
    rot = e.get('rot', 0)

    def P(lx, ly, lz):
        return local_to_world(e, (lx * sx, ly * sy, lz * sz))

    H = 0.7
    b = P(0, 0, 0)
    if add_box(comp, b[0], b[1], b[2], 0.34 * sx, 0.03 * sy, 0.26 * sz, rot, tag + '_BasePlate'):
        made += 1
    post = P(0, 0.028, 0)
    if add_box(comp, post[0], post[1], post[2], 0.075 * sx, H * sy, 0.075 * sz, rot, tag + '_Post'):
        made += 1
    sad = P(0, 0.028 + H, 0)
    if add_box(comp, sad[0], sad[1], sad[2], 0.17 * sx, 0.03 * sy, 0.18 * sz, rot, tag + '_Saddle'):
        made += 1
    for dx in (-0.06, 0.06):
        for dz in (-0.075, 0.075):
            a = P(dx, 0.028 + H, dz)
            c = P(dx, 0.028 + H + 0.12, dz)
            if add_cylinder(comp, a, c, 0.009 * sx, tag + '_UBolt'):
                made += 1
    return made


def build_gauge(comp, e, tag):
    """압력계·온도계 — 원형 다이얼 + 스템"""
    made = 0
    sx, sy, sz = _scaled(e, 0.2, 0.34, 0.16)

    def P(lx, ly, lz):
        return local_to_world(e, (lx * sx, ly * sy, lz * sz))

    if add_cylinder(comp, P(0, 0, 0), P(0, 0.1, 0), 0.012 * sx, tag + '_Stem'):
        made += 1
    if add_cylinder(comp, P(0, 0.1, 0), P(0, 0.13, 0), 0.024 * sx, tag + '_Socket'):
        made += 1
    if add_cylinder(comp, P(0, 0.2, 0), P(0, 0.2, 0.04), 0.085 * sx, tag + '_Case'):
        made += 1
    if add_cylinder(comp, P(0, 0.2, 0.04), P(0, 0.2, 0.05), 0.076 * sx, tag + '_Dial'):
        made += 1
    return made


def build_storage_tank(comp, e, tag):
    """대형 원통 저장탱크 — 지지다리 + 원통 쉘 + 콘 헤드 + 맨홀 + 노즐"""
    made = 0
    sx, sy, sz = _scaled(e, 2.0, 3.0, 2.0)
    rot = e.get('rot', 0)

    def P(lx, ly, lz):
        return local_to_world(e, (lx * sx, ly * sy, lz * sz))

    R = 0.9
    legH = 0.55
    shellTop = 2.42
    for dx in (-0.62, 0.62):
        for dz in (-0.62, 0.62):
            p = P(dx, 0, dz)
            if add_box(comp, p[0], p[1], p[2], 0.1 * sx, legH * sy, 0.1 * sz, rot, tag + '_Leg'):
                made += 1
    if add_cylinder(comp, P(0, legH, 0), P(0, legH + 0.24, 0), R * 0.75 * sx, tag + '_BottomHead'):
        made += 1
    if add_cylinder(comp, P(0, legH + 0.24, 0), P(0, shellTop, 0), R * sx, tag + '_Shell'):
        made += 1
    if add_cylinder(comp, P(0, shellTop, 0), P(0, shellTop + 0.3, 0), R * 0.6 * sx, tag + '_TopHead'):
        made += 1
    if add_cylinder(comp, P(0, shellTop + 0.3, 0), P(0, shellTop + 0.42, 0), 0.2 * sx, tag + '_Manhole'):
        made += 1
    for y in (0.95, 2.15):
        if add_cylinder(comp, P(R, y, 0), P(R + 0.24, y, 0), 0.07 * sx, tag + '_Nozzle'):
            made += 1
    return made


def build_rect_tank(comp, e, tag):
    """사각 탱크·수조 — 박스 본체 + 보강 리브 + 맨홀 + 측면 노즐"""
    made = 0
    sx, sy, sz = _scaled(e, 2.4, 1.8, 1.8)
    rot = e.get('rot', 0)

    def P(lx, ly, lz):
        return local_to_world(e, (lx * sx, ly * sy, lz * sz))

    W, H, D = 2.2, 1.62, 1.62
    b = P(0, 0, 0)
    if add_box(comp, b[0], b[1], b[2], (W + 0.16) * sx, 0.1 * sy, (D + 0.16) * sz, rot, tag + '_Base'):
        made += 1
    body = P(0, 0.1, 0)
    if add_box(comp, body[0], body[1], body[2], W * sx, H * sy, D * sz, rot, tag + '_Body'):
        made += 1
    for f in (-0.333, 0, 0.333):
        for sd in (-1, 1):
            r = P(W * f, 0.1, sd * (D / 2 + 0.018))
            if add_box(comp, r[0], r[1], r[2], 0.07 * sx, H * sy, 0.035 * sz, rot, tag + '_Rib'):
                made += 1
    mh = P(0.5, H + 0.1, 0.35)
    if add_cylinder(comp, mh, P(0.5, H + 0.16, 0.35), 0.26 * sx, tag + '_Manhole'):
        made += 1
    if add_cylinder(comp, P(-W / 2, 0.95, 0), P(-W / 2 - 0.24, 0.95, 0), 0.075 * sx, tag + '_NozzleIn'):
        made += 1
    if add_cylinder(comp, P(W / 2, 1.35, 0), P(W / 2 + 0.2, 1.35, 0), 0.06 * sx, tag + '_NozzleOut'):
        made += 1
    return made


def build_pipe(comp, p, tag):
    made = 0
    pts = p.get('points') or []
    if len(pts) < 2:
        return 0
    radius = BORES.get(p.get('bore'), 0.1143) / 2.0 + JACKET.get(p.get('material'), 0.0)
    for i in range(1, len(pts)):
        a = (pts[i - 1]['x'], pts[i - 1]['y'], pts[i - 1]['z'])
        b = (pts[i]['x'], pts[i]['y'], pts[i]['z'])
        if add_cylinder(comp, a, b, radius, '%s_Seg%d' % (tag, i)):
            made += 1
    # 엘보: 꺾이는 지점에 짧은 원통(비스듬한 방향)
    for i in range(1, len(pts) - 1):
        pa = pts[i - 1]
        pb = pts[i]
        pc = pts[i + 1]
        d1 = (pb['x'] - pa['x'], pb['y'] - pa['y'], pb['z'] - pa['z'])
        d2 = (pc['x'] - pb['x'], pc['y'] - pb['y'], pc['z'] - pb['z'])
        n1 = _norm(d1)
        n2 = _norm(d2)
        bis = _norm((-n1[0] + n2[0], -n1[1] + n2[1], -n1[2] + n2[2]))
        half = radius * 1.15
        a = (pb['x'] - bis[0] * half, pb['y'] - bis[1] * half, pb['z'] - bis[2] * half)
        b = (pb['x'] + bis[0] * half, pb['y'] + bis[1] * half, pb['z'] + bis[2] * half)
        if add_cylinder(comp, a, b, radius * 0.98, '%s_Elbow%d' % (tag, i)):
            made += 1
    return made


def build(comp, scene, report):
    builders = {
        'hx': build_heat_exchanger,
        'pump': build_pump,
        'vpump': build_vpump,
        'tank': build_tank,
        'stank': build_storage_tank,
        'rtank': build_rect_tank,
        'panel': build_panel,
        'valve': build_valve,
        'bfly': build_butterfly,
        'yvalve': build_yvalve,
        'ball': build_ball,
        'check': build_check,
        'bellows': build_bellows,
        'elbow': build_elbow,
        'tee': build_tee,
        'reducer': build_reducer,
        'nipple': build_nipple,
        'elbow45': build_elbow45,
        'cap': build_cap,
        'union': build_union,
        'flow': build_flow,
        'flange': build_flange,
        'support': build_support,
        'gauge': build_gauge,
    }
    for idx, e in enumerate(scene.get('equipment', [])):
        tag = '%02d_%s' % (idx + 1, (e.get('name') or e.get('type') or 'EQ'))
        fn = builders.get(e.get('type'), build_tank)
        try:
            n = fn(comp, e, tag)
            report['bodies'] += n
            report['equipment'] += 1
            if n == 0:
                report['failed'].append(tag)
        except Exception as ex:
            report['failed'].append('%s: %s' % (tag, ex))
    for idx, p in enumerate(scene.get('pipes', [])):
        tag = 'P%02d_%s' % (idx + 1, (p.get('name') or 'PIPE'))
        try:
            n = build_pipe(comp, p, tag)
            report['bodies'] += n
            report['pipes'] += 1
            if n == 0:
                report['failed'].append(tag)
        except Exception as ex:
            report['failed'].append('%s: %s' % (tag, ex))
    return report


def run(context):
    ui = None
    try:
        app = adsk.core.Application.get()
        ui = app.userInterface
        scene = json.loads(SCENE_JSON)

        # 새 문서 생성 (기존 문서를 건드리지 않음)
        app.documents.add(adsk.core.DocumentTypes.FusionDesignDocumentType)
        design = adsk.fusion.Design.cast(app.activeProduct)
        if not design:
            ui.messageBox('Fusion 360 디자인 문서를 열 수 없습니다. 디자인 워크스페이스에서 다시 실행해 주세요.')
            return
        try:
            design.unitsManager.defaultLengthUnits = 'mm'
        except Exception:
            pass

        root = design.rootComponent
        comp = root.occurrences.addNewComponent(adsk.core.Matrix3D.create()).component
        comp.name = 'SmilePiping3D'

        report = {'bodies': 0, 'equipment': 0, 'pipes': 0, 'failed': []}
        build(comp, scene, report)

        try:
            cam = app.activeViewport.camera
            cam.isFitView = True
            app.activeViewport.camera = cam
        except Exception:
            pass

        msg = ('스마일산업 3D 배관\\n\\n'
               '문서: %s\\n'
               '장비: %d개\\n'
               '배관: %d개\\n'
               '생성된 바디: %d개' % (scene.get('name', ''), report['equipment'],
                                     report['pipes'], report['bodies']))
        if report['failed']:
            msg += '\\n\\n생성 실패 %d건:\\n%s' % (len(report['failed']),
                                                '\\n'.join(report['failed'][:12]))
        ui.messageBox(msg)
    except Exception:
        if ui:
            ui.messageBox('스마일산업 3D 배관 스크립트 오류:\\n{}'.format(traceback.format_exc()))


if __name__ == '__main__':
    run(None)
`;
}

export function downloadText(filename, text, mime) {
  const blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function timestampName(ext) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `smile-piping-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.${ext}`;
}
