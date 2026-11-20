// 스마일산업 3D 배관 — 배관 치수 라벨 데이터
// 배관 구간(점 2개 사이)마다 중점 옆에 붙일 "1000mm (50A)" 라벨의 3D 위치를 계산한다.
// 실제 글자는 화면 위 오버레이(main.js의 #dimLayer)가 카메라 투영으로 그리므로,
// 여기서는 라벨을 붙일 월드 좌표와 문구만 만든다.

export function dimText(length, bore) {
  return `${Math.round(length * 1000)}mm (${bore})`;
}

export function buildDimItems(state) {
  const items = [];
  const pipes = (state && state.pipes) || [];
  pipes.forEach((p) => {
    const pts = p.points || [];
    for (let i = 1; i < pts.length; i += 1) {
      const a = pts[i - 1];
      const b = pts[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dy, dz);
      if (len < 0.02) continue; // 20mm 미만 자투리는 표시하지 않는다
      const ux = dx / len;
      const uz = dz / len;
      // 구간에 수직인 수평 방향 (u × 위쪽) — 배관을 가리지 않고 옆으로 비켜 붙는다.
      let px = uz;
      let pz = -ux;
      const pl = Math.hypot(px, pz);
      if (pl < 0.2) {
        // 수직 배관 — 수평 수직 방향이 없으니 X·Z 대각선으로 띄운다.
        px = Math.SQRT1_2;
        pz = Math.SQRT1_2;
      } else {
        px /= pl;
        pz /= pl;
      }
      const off = 0.26;
      items.push({
        key: `${p.id}:${i}`,
        x: (a.x + b.x) / 2 + px * off,
        y: (a.y + b.y) / 2 + 0.06,
        z: (a.z + b.z) / 2 + pz * off,
        text: dimText(len, p.bore),
      });
    }
  });
  return items;
}
