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

type Hsv = { h: number; s: number; v: number };
type Blob = ImagePoint & { rgb: [number, number, number] };
/**
 * Connected blobs of pixels passing `test` inside a circle; returns the best one (large and close to the centre)
 * with its mean colour. Searching a small area lets the colour test be loose without picking up the rest of the frame.
 */
function findBlob(pixels: Uint8ClampedArray, width: number, height: number, center: ImagePoint, radius: number, test: (c: Hsv) => boolean, exclude: ImagePoint[] = []): Blob | null {
  const x0 = Math.max(0, Math.floor(center.x - radius)), x1 = Math.min(width - 1, Math.ceil(center.x + radius));
  const y0 = Math.max(0, Math.floor(center.y - radius)), y1 = Math.min(height - 1, Math.ceil(center.y + radius));
  const w = x1 - x0 + 1, h = y1 - y0 + 1; if (w <= 0 || h <= 0) return null;
  const mask = new Uint8Array(w * h), queue = new Uint32Array(w * h);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if ((x - center.x) ** 2 + (y - center.y) ** 2 > radius * radius) continue;
    const p = (y * width + x) * 4;
    if (test(hsv(pixels[p], pixels[p + 1], pixels[p + 2]))) mask[(y - y0) * w + (x - x0)] = 1;
  }
  let best: Blob | null = null, bestScore = 0;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    mask[i] = 0; queue[0] = i; let head = 0, tail = 1, xs = 0, ys = 0, r = 0, g = 0, b = 0;
    while (head < tail) {
      const q = queue[head++], x = q % w, y = Math.floor(q / w); xs += x; ys += y;
      const p = ((y + y0) * width + x + x0) * 4; r += pixels[p]; g += pixels[p + 1]; b += pixels[p + 2];
      for (const n of [x ? q - 1 : -1, x < w - 1 ? q + 1 : -1, y ? q - w : -1, y < h - 1 ? q + w : -1]) if (n >= 0 && mask[n]) { mask[n] = 0; queue[tail++] = n; }
    }
    if (tail < 4) continue;
    const pt: Blob = { x: x0 + xs / tail, y: y0 + ys / tail, area: tail, rgb: [r / tail, g / tail, b / tail] };
    if (exclude.some(e => Math.hypot(e.x - pt.x, e.y - pt.y) < 6)) continue;
    const score = tail * Math.exp(-Math.hypot(pt.x - center.x, pt.y - center.y) / radius);
    if (score > bestScore) { bestScore = score; best = pt; }
  }
  return best;
}
/** Loose colour test for a known mark, used only inside a small search circle. */
function matches(t: Target) {
  return (c: Hsv) => t.dark ? c.v <= Math.min(0.38, t.v + 0.12) && c.s < 0.6
    : t.light ? c.v >= Math.max(0.6, t.v - 0.2) && c.s < 0.28
    : c.s >= 0.15 && c.v >= 0.15 && !isSkinLike(c) && hueDistance(c.h, t.h) <= 28 && Math.abs(c.s - t.s) <= 0.4;
}
/** Strict colour test for searching the whole frame (no location to narrow it down). */
function strict(t: Target) {
  return (c: Hsv) => t.dark ? c.v <= t.darkMax && c.s < DARK_MAX_SATURATION
    : t.light ? c.v >= t.lightMin && c.s < LIGHT_MAX_SATURATION
    : c.s >= MIN_SATURATION && c.v >= 0.17 && !isSkinLike(c) && hueDistance(c.h, t.h) < TOLERANCE && Math.abs(c.s - t.s) <= 0.25;
}
/** "Looks like a mark" without knowing its colour: clearly coloured and not skin, or white. */
const distinct = (c: Hsv) => (c.s >= 0.35 && c.v >= 0.2 && !isSkinLike(c)) || (c.v >= 0.82 && c.s < 0.15);
const hexOf = (rgb: [number, number, number]) => '#' + rgb.map(n => Math.round(n).toString(16).padStart(2, '0')).join('');
const rgbOf = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
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

export type Proposal = { x: number; y: number; hex: string } | null;

export class MarkerTracker {
  previous: (ImagePoint | null)[] = [null, null, null, null];
  private velocity: { x: number; y: number }[] = [0, 1, 2, 3].map(() => ({ x: 0, y: 0 }));
  private misses = [0, 0, 0, 0];
  /** Mark colour followed slowly as lighting changes; starts from the registered colour. */
  private adapted: ([number, number, number] | null)[] = [null, null, null, null];
  private colorsKey = '';
  tolerance = TOLERANCE;
  reset() { this.previous = [null, null, null, null]; this.velocity.forEach(v => { v.x = 0; v.y = 0; }); this.misses = [0, 0, 0, 0]; this.adapted = [null, null, null, null]; }
  seed(i: number, x: number, y: number) { this.previous[i] = { x, y }; this.velocity[i] = { x: 0, y: 0 }; this.misses[i] = 0; this.adapted[i] = null; }
  /** All four marks are being followed (none estimated) - the hand model can then run less often. */
  get locked() { return this.previous.every(Boolean) && this.misses.every(m => m === 0); }

  /**
   * Registration: around each joint the hand model estimated, find the blob that looks most like a mark
   * (coloured and not skin, or white) and propose it with its colour. The user confirms or corrects.
   */
  propose(pixels: Uint8ClampedArray, width: number, height: number, hints: (ImagePoint | null)[]): Proposal[] {
    const radius = Math.max(20, width * HINT_RADIUS), taken: ImagePoint[] = [];
    return hints.map(hint => {
      if (!hint) return null;
      const blob = findBlob(pixels, width, height, hint, radius, distinct, taken);
      if (!blob) return null;
      taken.push(blob);
      return { x: blob.x, y: blob.y, hex: hexOf(blob.rgb) };
    });
  }

  /**
   * `hints`: rough joint positions from the hand-landmark model (same pixel space), or none when unavailable.
   * Once marks are known, each is followed from its predicted position (last position + motion) in a small circle;
   * the hand model only nudges the search centre (80 % own motion, 20 % model). A lost mark widens the search to the
   * model's estimate and to its last position, then falls back to the estimate itself.
   */
  detect(pixels: Uint8ClampedArray, width: number, height: number, colors: string[], hints?: (ImagePoint | null)[]) {
    const result = (points: (ImagePoint | null)[], reason: string, ambiguous = true) => ({ points, valid: points.every(Boolean), reason, ambiguous });
    const key = colors.join(',');
    if (key !== this.colorsKey) { this.colorsKey = key; this.adapted = [null, null, null, null]; }
    const targets = colors.map(toTarget);
    if (this.previous.some(Boolean) || (hints && hints.some(Boolean))) {
      const small = Math.max(14, width * 0.035), big = Math.max(20, width * HINT_RADIUS);
      const dist = (a: ImagePoint, b: ImagePoint) => Math.hypot(a.x - b.x, a.y - b.y);
      const points = targets.map((base, i) => {
        const adapted = this.adapted[i];
        const test = matches(adapted ? toTarget(hexOf(adapted)) : base);
        const old = this.previous[i], v = this.velocity[i], hint = hints?.[i] ?? null;
        const pred = old ? { x: old.x + v.x, y: old.y + v.y } : null;
        let center = pred ?? hint;
        if (pred && hint && dist(pred, hint) < big) center = { x: pred.x * 0.8 + hint.x * 0.2, y: pred.y * 0.8 + hint.y * 0.2 };
        let found = center ? findBlob(pixels, width, height, center, pred ? small : big, test) : null;
        if (!found && hint) found = findBlob(pixels, width, height, hint, big, test);
        if (!found && old) found = findBlob(pixels, width, height, old, hint ? big : big * 1.6, test);
        // Lost with nothing to go on (no estimate, no recent position): look for it again over the whole frame,
        // with the strict colour test and away from the other marks.
        if (!found && !hint && (!old || this.misses[i] > 3)) {
          const others = this.previous.filter((q, k): q is ImagePoint => k !== i && !!q);
          found = findBlob(pixels, width, height, { x: width / 2, y: height / 2 }, Math.hypot(width, height), strict(base), others);
        }
        if (found) {
          if (old) { v.x = 0.6 * v.x + 0.4 * (found.x - old.x); v.y = 0.6 * v.y + 0.4 * (found.y - old.y); }
          const cap = small * 0.8, len = Math.hypot(v.x, v.y); if (len > cap) { v.x *= cap / len; v.y *= cap / len; }
          const from = adapted ?? rgbOf(colors[i]);
          this.adapted[i] = [0, 1, 2].map(k => from[k] * 0.9 + found!.rgb[k] * 0.1) as [number, number, number];
          this.previous[i] = { x: found.x, y: found.y, area: found.area }; this.misses[i] = 0;
          return this.previous[i];
        }
        this.misses[i]++; v.x *= 0.5; v.y *= 0.5;
        if (this.misses[i] > 20) { this.previous[i] = null; this.adapted[i] = null; }
        return hint ? { x: hint.x, y: hint.y, estimated: true } : null;
      });
      const estimated = points.map((p, i) => (p?.estimated ? MARKER_NAMES[i] : '')).filter(Boolean);
      const missing = points.map((p, i) => (p ? '' : MARKER_NAMES[i])).filter(Boolean);
      return result(points, missing.length ? `${missing.join('・')}の目印が見つかりません`
        : estimated.length ? `4点を読み取り中（${estimated.join('・')}は目印が見えず推定）` : '4点を読み取り中', false);
    }
    // Bootstrap without the hand model and without known positions: whole-frame colour search.
    const problem = markerColorProblem(colors);
    if (problem) return result([null, null, null, null], problem);
    const darkId = targets.findIndex(t => t.dark), lightId = targets.findIndex(t => t.light);
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
