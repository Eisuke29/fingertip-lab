export type ImagePoint = { x: number; y: number; area?: number };
export function hsv(r: number, g: number, b: number) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const sector = d === 0 ? 0 : max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (sector * 60 + 360) % 360, s: max === 0 ? 0 : d / max, v: max };
}
const hueDistance = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
export class MarkerTracker {
  previous: (ImagePoint | null)[] = [null, null, null, null];
  tolerance = 18;
  reset() { this.previous = [null, null, null, null]; }
  seed(i: number, x: number, y: number) { this.previous[i] = { x, y }; }
  detect(pixels: Uint8ClampedArray, width: number, height: number, colors: string[]) {
    const targets = colors.map(hex => hsv(parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)));
    const result = (points: (ImagePoint | null)[], reason: string) => ({ points, valid: points.every(Boolean), reason });
    if (targets.some(t => t.s < 0.25 || t.v < 0.2) || targets.some((t, i) => targets.some((u, j) => i !== j && hueDistance(t.h, u.h) < this.tolerance * 1.7)))
      return result([null, null, null, null], '互いに異なる鮮やかな4色を選んでください');
    const size = width * height, labels = new Uint8Array(size), queue = new Uint32Array(size);
    for (let p = 0; p < size; p++) {
      const color = hsv(pixels[p * 4], pixels[p * 4 + 1], pixels[p * 4 + 2]);
      if (color.s < 0.25 || color.v < 0.17) continue;
      let best = this.tolerance, id = 0;
      for (let k = 0; k < targets.length; k++) { const d = hueDistance(color.h, targets[k].h); if (d < best) { best = d; id = k + 1; } }
      labels[p] = id;
    }
    const groups: ImagePoint[][] = [[], [], [], []];
    for (let p = 0; p < size; p++) {
      const label = labels[p]; if (!label) continue;
      labels[p] = 0; queue[0] = p;
      let head = 0, tail = 1, xSum = 0, ySum = 0;
      while (head < tail) {
        const q = queue[head++], x = q % width, y = Math.floor(q / width); xSum += x; ySum += y;
        for (const n of [x ? q - 1 : -1, x < width - 1 ? q + 1 : -1, y ? q - width : -1, y < height - 1 ? q + width : -1])
          if (n >= 0 && labels[n] === label) { labels[n] = 0; queue[tail++] = n; }
      }
      if (tail >= 7 && tail < size * 0.025) groups[label - 1].push({ x: xSum / tail, y: ySum / tail, area: tail });
    }
    const points = groups.map((group, i) => {
      const old = this.previous[i];
      if (!old) return group.sort((a, b) => b.area! - a.area!)[0] ?? null;
      return group.filter(p => Math.hypot(p.x - old.x, p.y - old.y) < width * 0.12 && (!old.area || (p.area! / old.area > 0.25 && p.area! / old.area < 4)))
        .sort((a, b) => Math.hypot(a.x - old.x, a.y - old.y) - Math.hypot(b.x - old.x, b.y - old.y))[0] ?? null;
    });
    points.forEach((p, i) => { if (p) this.previous[i] = p; });
    return result(points, points.every(Boolean) ? '4点を読み取り中' : '点の隠れ・色・位置を確認してください');
  }
}
