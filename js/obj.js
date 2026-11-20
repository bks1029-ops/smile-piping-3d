// 스마일산업 3D 배관 — OBJ 메쉬 내보내기
import * as THREE from 'three';

function f(n) {
  return (Math.round(n * 10000) / 10000).toString();
}

function safeName(name) {
  return String(name || 'object').replace(/[^\w가-힣.-]+/g, '_').slice(0, 40) || 'object';
}

export function buildOBJ(root, title) {
  const out = [];
  out.push(`# ${title || '스마일산업 3D 배관'}`);
  out.push('# 단위: 미터(m) / Y축이 위쪽');
  out.push(`# 생성: ${new Date().toISOString()}`);

  root.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const nm = new THREE.Matrix3();
  let offset = 1;
  let meshCount = 0;
  let triCount = 0;

  root.traverse((obj) => {
    if (!obj.isMesh || !obj.geometry) return;
    const geo = obj.geometry;
    const pos = geo.attributes.position;
    if (!pos || pos.count === 0) return;

    const grp = obj.userData.pick || (obj.parent && obj.parent.userData.pick) || {};
    const owner = grp.id || obj.name || 'part';
    const name = safeName(`${grp.kind || 'part'}_${owner}_${obj.geometry.type}`);
    out.push(`o ${name}`);
    out.push(`g ${safeName(grp.kind || 'scene')}`);

    nm.getNormalMatrix(obj.matrixWorld);
    const hasNormal = !!geo.attributes.normal;

    for (let i = 0; i < pos.count; i += 1) {
      v.fromBufferAttribute(pos, i).applyMatrix4(obj.matrixWorld);
      out.push(`v ${f(v.x)} ${f(v.y)} ${f(v.z)}`);
    }
    if (hasNormal) {
      const nor = geo.attributes.normal;
      for (let i = 0; i < nor.count; i += 1) {
        n.fromBufferAttribute(nor, i).applyNormalMatrix(nm).normalize();
        out.push(`vn ${f(n.x)} ${f(n.y)} ${f(n.z)}`);
      }
    }

    const idx = geo.index;
    const tri = [];
    if (idx) {
      for (let i = 0; i < idx.count; i += 3) {
        tri.push(`f ${idx.getX(i) + offset}//${idx.getX(i) + offset} ${idx.getX(i + 1) + offset}//${idx.getX(i + 1) + offset} ${idx.getX(i + 2) + offset}//${idx.getX(i + 2) + offset}`);
      }
    } else {
      for (let i = 0; i < pos.count; i += 3) {
        tri.push(`f ${i + offset}//${i + offset} ${i + 1 + offset}//${i + 1 + offset} ${i + 2 + offset}//${i + 2 + offset}`);
      }
    }
    out.push(...tri);
    triCount += tri.length;
    meshCount += 1;
    offset += pos.count;
  });

  out.push(`# 메쉬 ${meshCount}개 · 삼각형 ${triCount}개`);
  return { text: out.join('\n') + '\n', meshCount, triCount, verts: offset - 1 };
}
