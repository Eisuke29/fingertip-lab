/** `estimated`: no mark was found, so this is the hand model's own estimate of the joint. */
export type ImagePoint = { x: number; y: number; area?: number; estimated?: boolean };
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
/** How far (fraction of image width) a mark may lie from the hand model's rough joint position. */
const HINT_RADIUS = 0.09;

/**
 * Look for one mark only around the hand model's estimate of its joint. Because the search area is small,
 * the colour test can be looser than a whole-frame search (lighting shifts no longer lose the mark).
 */
function findNear(pixels: Uint8ClampedArray, width: number, height: number, t: Target, center: ImagePoint, radius: number): ImagePoint | null {
  const x0 = Math.max(0, Math.floor(center.x - radius)), x1 = Math.min(width - 1, Math.ceil(center.x + radius));
  const y0 = Math.max(0, Math.floor(center.y - radius)), y1 = Math.min(height - 1, Math.ceil(center.y + radius));
  const w = x1 - x0 + 1, h = y1 - y0 + 1; if (w <= 0 || h <= 0) return null;
  const mask = new Uint8Array(w * h), queue = new Uint32Array(w * h);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if ((x - center.x) ** 2 + (y - center.y) ** 2 > radius * radius) continue;
    const p = (y * width + x) * 4, c = hsv(pixels[p], pixels[p + 1], pixels[p + 2]);
    const ok = t.dark ? c.v <= Math.min(0.38, t.v + 0.12) && c.s < 0.6
      : t.light ? c.v >= Math.max(0.6, t.v - 0.2) && c.s < 0.28
      : c.s >= 0.15 && c.v >= 0.15 && !isSkinLike(c) && hueDistance(c.h, t.h) <= 28 && Math.abs(c.s - t.s) <= 0.4;
    if (ok) mask[(y - y0) * w + (x - x0)] = 1;
  }
  let best: ImagePoint | null = null, bestScore = 0;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    mask[i] = 0; queue[0] = i; let head = 0, tail = 1, xs = 0, ys = 0;
    while (head < tail) {
      const q = queue[head++], x = q % w, y = Math.floor(q / w); xs += x; ys += y;
      for (const n of [x ? q - 1 : -1, x < w - 1 ? q + 1 : -1, y ? q - w : -1, y < h - 1 ? q + w : -1]) if (n >= 0 && mask[n]) { mask[n] = 0; queue[tail++] = n; }
    }
    if (tail < 4) continue;
    const pt = { x: x0 + xs / tail, y: y0 + ys / tail, area: tail };
    // Prefer larger blobs close to the estimate.
    const score = tail * Math.exp(-Math.hypot(pt.x - center.x, pt.y - center.y) / radius);
    if (score > bestScore) { bestScore = score; best = pt; }
  }
  return best;
}
/** Dark but clearly coloured ink (deep green, purple) stays a colour marker; only near-neutral dark counts as black. */
const DARK_MAX_SATURATION = 0.55;
/** White paint/tape: bright and almost colourless. Skin is clearly more saturated, mid-grey walls are darker. */
const LIGHT_TARGET = 0.7, LIGHT_MAX_SATURATION = 0.2;

/** A mark is either a colour (matched by hue) or one neutral mark, black or white (matched by brightness). */
type Target = { h: number; s: number; v: number; dark: boolean; light: boolean; neutral: boolean; darkMax: number; lightMin: number };
const parseHex = (hex: string) => hsv(parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16));
function toTarget(hex: string): Target {
  const c = parseHex(hex), dark = c.v < DARK_TARGET && c.s < DARK_MAX_SATURATION, light = !dark && c.v >= LIGHT_TARGET && c.s < LIGHT_MAX_SATURATION;
  return { ...c, dark, light, neutral: dark || light, darkMax: Math.min(0.3, c.v + 0.06), lightMin: Math.max(0.72, c.v - 0.12) };
}

/** Skin tones: orange-ish hue with only moderate saturation. Pen and sticker colours are far more saturated. */
const isSkinLike = (c: { h: number; s: number; v: number }) => c.h >= 10 && c.h <= 40 && c.s < 0.6;

/** Returns a Japanese message naming the joint whose colour cannot be tracked, or null when all four are usable. */
export function markerColorProblem(colors: string[], names = MARKER_NAMES): string | null {
  const targets = colors.map(toTarget);
  const pale = targets.findIndex(t => !t.neutral && t.s < MIN_SATURATION);
  if (pale >= 0) return `${names[pale]}の色が薄すぎます（背景などを採取しています）。目印の真ん中をクリックし直してください`;
  const skin = targets.findIndex(t => !t.neutral && isSkinLike(t));
  if (skin >= 0) return `${names[skin]}で肌の色を採取しています。目印の真ん中をクリックし直してください`;
  const neutrals = targets.map((t, i) => (t.neutral ? i : -1)).filter(i => i >= 0);
  if (neutrals.length > 1) return `${neutrals.map(i => names[i]).join('と')}が両方とも白か黒です。白・黒は1か所だけにして、他は色ペンにしてください`;
  for (let i = 0; i < targets.length; i++) for (let j = i + 1; j < targets.length; j++) {
    if (targets[i].neutral || targets[j].neutral) continue;
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
  /** `hints`: optional rough positions of the four joints from the hand-landmark model, in the same pixel space. */
  detect(pixels: Uint8ClampedArray, width: number, height: number, colors: string[], hints?: (ImagePoint | null)[]) {
    // `ambiguous`: some mark had no candidate or several same-coloured candidates, so a hint would help.
    const result = (points: (ImagePoint | null)[], reason: string, ambiguous = true) => ({ points, valid: points.every(Boolean), reason, ambiguous });
    const problem = markerColorProblem(colors);
    if (problem) return result([null, null, null, null], problem);
    const targets = colors.map(toTarget), darkId = targets.findIndex(t => t.dark), lightId = targets.findIndex(t => t.light);
    // With the hand model's joint estimates: search each mark only around its joint, and keep the estimate
    // itself when the mark cannot be seen there, so tracking does not drop out.
    if (hints && hints.some(Boolean)) {
      const radius = Math.max(20, width * HINT_RADIUS);
      const points = targets.map((t, i) => {
        const hint = hints[i], old = this.previous[i];
        if (!hint) return old ? findNear(pixels, width, height, t, old, radius) : null;
        // Around the estimate first; if the model misplaced a hidden joint, around where the mark was last seen.
        return findNear(pixels, width, height, t, hint, radius)
          ?? (old ? findNear(pixels, width, height, t, old, radius) : null)
          ?? { x: hint.x, y: hint.y, estimated: true };
      });
      points.forEach((p, i) => { if (p && !p.estimated) this.previous[i] = p; });
      const estimated = points.map((p, i) => (p?.estimated ? MARKER_NAMES[i] : '')).filter(Boolean);
      const missing = points.map((p, i) => (p ? '' : MARKER_NAMES[i])).filter(Boolean);
      return result(points, missing.length ? `${missing.join('・')}が見つかりません`
        : estimated.length ? `4点を読み取り中（${estimated.join('・')}は目印が見えず推定）` : '4点を読み取り中', false);
    }
    const size = width * height, labels = new Uint8Array(size), queue = new Uint32Array(size);
    for (let p = 0; p < size; p++) {
      const color = hsv(pixels[p * 4], pixels[p * 4 + 1], pixels[p * 4 + 2]);
      if (darkId >= 0 && color.v <= targets[darkId].darkMax && color.s < DARK_MAX_SATURATION) { labels[p] = darkId + 1; continue; }
      if (lightId >= 0 && color.v >= targets[lightId].lightMin && color.s < LIGHT_MAX_SATURATION) { labels[p] = lightId + 1; continue; }
      if (color.s < MIN_SATURATION || color.v < 0.17 || isSkinLike(color)) continue;
      let best = this.tolerance, id = 0;
      for (let k = 0; k < targets.length; k++) { if (targets[k].neutral || Math.abs(color.s - targets[k].s) > 0.25) continue; const d = hueDistance(color.h, targets[k].h); if (d < best) { best = d; id = k + 1; } }
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
    const dist = (a: ImagePoint, b: ImagePoint) => Math.hypot(a.x - b.x, a.y - b.y);
    const points = groups.map((group, i) => {
      // Without the hand model (not loaded, or it lost the hand): follow each mark from its last position.
      const old = this.previous[i];
      const sizeOk = (p: ImagePoint) => !old?.area || (p.area! / old.area > 0.25 && p.area! / old.area < 4);
      if (!old) return group.sort((a, b) => b.area! - a.area!)[0] ?? null;
      return group.filter(p => dist(p, old) < width * 0.12 && sizeOk(p)).sort((a, b) => dist(a, old) - dist(b, old))[0] ?? null;
    });
    points.forEach((p, i) => { if (p) this.previous[i] = p; });
    const missing = points.map((p, i) => (p ? '' : MARKER_NAMES[i])).filter(Boolean);
    const ambiguous = groups.some(g => g.length !== 1);
    return result(points, missing.length ? `${missing.join('・')}の目印が見つかりません（隠れ・色・位置を確認）` : '4点を読み取り中', ambiguous);
  }
}
