export type ImagePoint = { x: number; y: number; area?: number };
export function hsv(r: number, g: number, b: number) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const sector = d === 0 ? 0 : max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (sector * 60 + 360) % 360, s: max === 0 ? 0 : d / max, v: max };
}
const hueDistance = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
export const MARKER_NAMES = ['付け根', '第2関節', '第1関節', '指先'];
const TOLERANCE = 18;
/** Below this brightness a sampled colour is treated as a dark (e.g. black pen) marker, matched by darkness instead of hue. */
const DARK_TARGET = 0.36;
const MIN_SATURATION = 0.25;
/** Dark but clearly coloured ink (deep green, purple) stays a colour marker; only near-neutral dark counts as black. */
const DARK_MAX_SATURATION = 0.55;

type Target = { h: number; s: number; v: number; dark: boolean; darkMax: number };
const parseHex = (hex: string) => hsv(parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16));
function toTarget(hex: string): Target {
  const c = parseHex(hex), dark = c.v < DARK_TARGET && c.s < DARK_MAX_SATURATION;
  return { ...c, dark, darkMax: Math.min(0.3, c.v + 0.06) };
}

/** Skin tones: orange-ish hue with only moderate saturation. Pen and sticker colours are far more saturated. */
const isSkinLike = (c: { h: number; s: number; v: number }) => c.h >= 10 && c.h <= 40 && c.s < 0.6;

/** Returns a Japanese message naming the joint whose colour cannot be tracked, or null when all four are usable. */
export function markerColorProblem(colors: string[], names = MARKER_NAMES): string | null {
  const targets = colors.map(toTarget);
  const pale = targets.findIndex(t => !t.dark && t.s < MIN_SATURATION);
  if (pale >= 0) return `${names[pale]}の色が薄すぎます（背景などを採取しています）。目印の真ん中をクリックし直してください`;
  const skin = targets.findIndex(t => !t.dark && isSkinLike(t));
  if (skin >= 0) return `${names[skin]}で肌の色を採取しています。目印の真ん中をクリックし直してください`;
  const darks = targets.map((t, i) => (t.dark ? i : -1)).filter(i => i >= 0);
  if (darks.length > 1) return `${darks.map(i => names[i]).join('と')}が両方とも黒っぽい色です。黒は1か所だけにして、他は色ペンにしてください`;
  for (let i = 0; i < targets.length; i++) for (let j = i + 1; j < targets.length; j++) {
    if (targets[i].dark || targets[j].dark) continue;
    if (hueDistance(targets[i].h, targets[j].h) < TOLERANCE * 1.7) return `${names[i]}と${names[j]}の色が近すぎて区別できません。どちらかを別の色にしてください`;
  }
  return null;
}

/** Colour to register for a click on the video. Returns the click position and hex colour. */
export function sampleMarkerColor(pixels: Uint8ClampedArray, width: number, height: number, x: number, y: number, radius = 1) {
  // Per-channel median of a small square at the click: robust to a stray pixel, but still the colour that was clicked.
  const channels: number[][] = [[], [], []];
  for (let yy = Math.max(0, y - radius); yy <= Math.min(height - 1, y + radius); yy++) for (let xx = Math.max(0, x - radius); xx <= Math.min(width - 1, x + radius); xx++)
    for (let c = 0; c < 3; c++) channels[c].push(pixels[(yy * width + xx) * 4 + c]);
  const median = (a: number[]) => a.sort((m, n) => m - n)[a.length >> 1];
  const hex = '#' + channels.map(median).map(n => n.toString(16).padStart(2, '0')).join('');
  return { x, y, hex };
}

export class MarkerTracker {
  previous: (ImagePoint | null)[] = [null, null, null, null];
  tolerance = TOLERANCE;
  reset() { this.previous = [null, null, null, null]; }
  seed(i: number, x: number, y: number) { this.previous[i] = { x, y }; }
  detect(pixels: Uint8ClampedArray, width: number, height: number, colors: string[]) {
    const result = (points: (ImagePoint | null)[], reason: string) => ({ points, valid: points.every(Boolean), reason });
    const problem = markerColorProblem(colors);
    if (problem) return result([null, null, null, null], problem);
    const targets = colors.map(toTarget), darkId = targets.findIndex(t => t.dark);
    const size = width * height, labels = new Uint8Array(size), queue = new Uint32Array(size);
    for (let p = 0; p < size; p++) {
      const color = hsv(pixels[p * 4], pixels[p * 4 + 1], pixels[p * 4 + 2]);
      if (darkId >= 0 && color.v <= targets[darkId].darkMax && color.s < DARK_MAX_SATURATION) { labels[p] = darkId + 1; continue; }
      if (color.s < MIN_SATURATION || color.v < 0.17 || isSkinLike(color)) continue;
      let best = this.tolerance, id = 0;
      for (let k = 0; k < targets.length; k++) { if (targets[k].dark || Math.abs(color.s - targets[k].s) > 0.25) continue; const d = hueDistance(color.h, targets[k].h); if (d < best) { best = d; id = k + 1; } }
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
    const missing = points.map((p, i) => (p ? '' : MARKER_NAMES[i])).filter(Boolean);
    return result(points, missing.length ? `${missing.join('・')}の目印が見つかりません（隠れ・色・位置を確認）` : '4点を読み取り中');
  }
}
