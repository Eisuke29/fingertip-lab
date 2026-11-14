import { clamp01 } from './types';

export type Point = { x: number; y: number; area: number };
export type Detection = {
  points: (Point | null)[];
  valid: boolean;
  angle: number;
  confidence: number;
  reason: string;
};

export function rgbToHsv(r: number, g: number, b: number) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = d === 0 ? 0 : max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  return { h, s: max === 0 ? 0 : d / max, v: max };
}
export function hexToRgb(hex: string) {
  return { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) };
}
const hueDistance = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

/** A relative, image-plane bend, invariant to a rigid 2D translation/rotation. */
export function jointBend(a: Point, b: Point, c: Point): number | null {
  const u = { x: b.x - a.x, y: b.y - a.y }, v = { x: c.x - b.x, y: c.y - b.y };
  if (Math.hypot(u.x, u.y) < 10 || Math.hypot(v.x, v.y) < 10 || Math.hypot(c.x - a.x, c.y - a.y) < 12) return null;
  return Math.abs(Math.atan2(u.x * v.y - u.y * v.x, u.x * v.x + u.y * v.y));
}

export class MarkerTracker {
  previous: (Point | null)[] = [null, null, null];
  tolerance = 20;
  reset() { this.previous = [null, null, null]; }
  seed(index: number, x: number, y: number) { this.previous[index] = { x, y, area: 0 }; }

  detect(pixels: Uint8ClampedArray, width: number, height: number, colors: string[]): Detection {
    const targets = colors.map(color => { const { r, g, b } = hexToRgb(color); return rgbToHsv(r, g, b); });
    const fail = (reason: string, points: (Point | null)[] = [null, null, null]): Detection => ({ points, valid: false, angle: 0, confidence: 0, reason });
    if (targets.some(t => t.s < 0.25 || t.v < 0.2)) return fail('明るく鮮やかな目印の色を選んでください');
    if (targets.some((t, i) => targets.some((u, j) => i !== j && hueDistance(t.h, u.h) < this.tolerance * 1.5))) return fail('3色は色相が十分に異なる色を選んでください');
    const size = width * height;
    const labels = new Uint8Array(size);
    for (let p = 0; p < size; p++) {
      const hsv = rgbToHsv(pixels[p * 4], pixels[p * 4 + 1], pixels[p * 4 + 2]);
      if (hsv.s < 0.27 || hsv.v < 0.17) continue;
      let nearest = -1, best = this.tolerance;
      for (let k = 0; k < 3; k++) {
        const d = hueDistance(hsv.h, targets[k].h);
        if (d < best && Math.abs(hsv.s - targets[k].s) < 0.65) { best = d; nearest = k; }
      }
      if (nearest >= 0) labels[p] = nearest + 1;
    }
    const queue = new Uint32Array(size);
    const candidates: Point[][] = [[], [], []];
    const minArea = Math.max(6, size * 0.000055), maxArea = size * 0.035;
    for (let p = 0; p < size; p++) {
      const label = labels[p];
      if (!label) continue;
      labels[p] = 0;
      let head = 0, tail = 1, sumX = 0, sumY = 0;
      queue[0] = p;
      while (head < tail) {
        const q = queue[head++], x = q % width, y = Math.floor(q / width);
        sumX += x; sumY += y;
        const neighbors = [x > 0 ? q - 1 : -1, x < width - 1 ? q + 1 : -1, y > 0 ? q - width : -1, y < height - 1 ? q + width : -1];
        for (const n of neighbors) if (n >= 0 && labels[n] === label) { labels[n] = 0; queue[tail++] = n; }
      }
      if (tail >= minArea && tail <= maxArea) candidates[label - 1].push({ x: sumX / tail, y: sumY / tail, area: tail });
    }
    const points = candidates.map((group, k) => {
      const previous = this.previous[k];
      if (!previous) return group.sort((a, b) => b.area - a.area)[0] ?? null;
      const allowed = group.filter(p => Math.hypot(p.x - previous.x, p.y - previous.y) <= width * 0.13 &&
        (!previous.area || (p.area / previous.area > 0.25 && p.area / previous.area < 4)));
      return allowed.sort((a, b) =>
        Math.hypot(a.x - previous.x, a.y - previous.y) - Math.hypot(b.x - previous.x, b.y - previous.y))[0] ?? null;
    });
    // Keep previous seeds through loss: a distant background blob cannot take over.
    points.forEach((p, k) => { if (p) this.previous[k] = p; });
    if (points.some(p => !p)) return fail('目印が見つかりません。隠れ・照明・色を確認', points);
    const angle = jointBend(points[0]!, points[1]!, points[2]!);
    if (angle === null) return fail('目印の間隔が小さいか、点が重なっています', points);
    return { points, angle, valid: true, confidence: Math.min(1, Math.min(...points.map(p => p!.area)) / 25), reason: '3点を追跡中' };
  }
}

export class BendCalibration {
  neutral: number | null = null;
  bent: number | null = null;
  capturing: 'neutral' | 'bent' | null = null;
  progress = 0;
  message = '伸ばした姿勢、次に楽に曲げた姿勢を記録します';
  private samples: number[] = [];
  private startedAt = 0;
  private filtered = 0;
  get ready() { return this.neutral !== null && this.bent !== null; }
  reset() {
    this.neutral = this.bent = this.capturing = null; this.filtered = 0; this.progress = 0;
    this.message = '伸ばした姿勢、次に楽に曲げた姿勢を記録します';
  }
  start(which: 'neutral' | 'bent', now: number) {
    if (which === 'bent' && this.neutral === null) { this.message = '先に伸ばした姿勢を記録してください'; return; }
    this.capturing = which; this.startedAt = now; this.samples = []; this.progress = 0;
    this.message = '姿勢を保ってください…';
  }
  feed(angle: number | null, now: number, dt: number) {
    if (this.capturing) {
      if (angle !== null) this.samples.push(angle);
      else { this.samples = []; this.startedAt = now; }
      this.progress = Math.min(1, this.samples.length / 24);
      if (this.samples.length >= 24 && now - this.startedAt >= 700) {
        const sorted = [...this.samples].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];
        const spread = Math.sqrt(this.samples.reduce((sum, v) => sum + (v - median) ** 2, 0) / this.samples.length);
        if (spread > 0.12) this.message = '動きが大きいため再記録してください。姿勢を止めて測ります';
        else if (this.capturing === 'bent' && Math.abs(median - this.neutral!) < 0.26) this.message = '曲げ量の差が小さすぎます。15°以上の差が見える配置で再記録してください';
        else if (this.capturing === 'neutral') { this.neutral = median; this.bent = null; this.message = '伸ばした姿勢を記録しました。次に楽に曲げて記録'; }
        else { this.bent = median; this.message = '調整完了。いったん伸ばすとスマホで操作できます'; }
        this.capturing = null;
      }
    }
    if (!this.ready || angle === null) return this.filtered;
    const raw = clamp01((angle - this.neutral!) / (this.bent! - this.neutral!));
    this.filtered += (raw - this.filtered) * (1 - Math.exp(-Math.min(0.1, dt) / 0.075));
    return this.filtered;
  }
}
