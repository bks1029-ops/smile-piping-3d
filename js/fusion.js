// 스마일산업 3D 배관 — Fusion 360 스크립트(.py) 생성기
// 씬 상태(미터)를 Fusion 360 API(내부 단위 cm)로 변환하는 자립형 스크립트를 만든다.

function pyString(text) {
  // JSON을 파이썬 raw 삼중 문자열로 안전하게 담기
  const safe = String(text).replace(/'''/g, '\\u0027\\u0027\\u0027');
  return "r'''" + safe + "'''";
}

export function buildFusionScript(state) {
  const scene = {
    name: state.name || '스마일산업 배관 도면',
    equipment: state.equipment.map((e) => ({
      type: e.type, name: e.name, x: e.x, y: e.y, z: e.z,
      w: e.w, h: e.h, d: e.d, rot: e.rot,
    })),
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


def add_box(comp, cx, cy, cz, w, h, d, rot, name):
    """바닥 중심 (cx, cy, cz), 크기 w(가로) x h(높이) x d(깊이), rot 도(deg)."""
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
    """장비 회전(rot)까지 반영한 로컬 좌표 → 웹앱 좌표"""
    th = math.radians(e.get('rot', 0) or 0)
    c = math.cos(th)
    s = math.sin(th)
    lx, ly, lz = local
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
        'tank': build_tank,
        'panel': build_panel,
        'valve': build_valve,
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
        app.documents.add(adsk.fusion.DocumentTypes.FusionDesignDocumentType)
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
