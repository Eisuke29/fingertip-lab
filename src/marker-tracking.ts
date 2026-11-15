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
/** Once a mark is known, only candidates this close to its predicted position count (fraction of image width). */
const TRACK_RADIUS = 0.045;

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
  private velocity: { x: number; y: number }[] = [0, 1, 2, 3].map(() => ({ x: 0, y: 0 }));
  private misses = [0, 0, 0, 0];
  tolerance = TOLERANCE;
  reset() { this.previous = [null, null, null, null]; this.velocity.forEach(v => { v.x = 0; v.y = 0; }); this.misses = [0, 0, 0, 0]; }
  seed(i: number, x: number, y: number) { this.previous[i] = { x, y }; this.velocity[i] = { x: 0, y: 0 }; this.misses[i] = 0; }
  /** Joints whose mark position is not known yet (the hand model is only needed for these). */
  get unknown() { return this.previous.some(p => !p); }

  /**
   * Strict colour detection over the frame (as before), then a position gate:
   * - a known mark only accepts candidates near its predicted position (last position + motion). Screen
   *   reflections and other same-coloured things outside that window are ignored;
   * - a briefly lost mark returns nothing (the frame is skipped, the pose holds) instead of jumping elsewhere;
   *   after a while the window widens, and only after a long loss the mark is searched for again;
   * - an unknown mark takes the candidate nearest the hand model's estimate (`hints`), else the largest one.
   */
  /** `skip`: joints that are not searched by colour (their position comes from elsewhere, e.g. the hand model). */
  detect(pixels: Uint8ClampedArray, width: number, height: number, colors: string[], hints?: (ImagePoint | null)[], skip: boolean[] = [false, false, false, false]) {
    const result = (points: (ImagePoint | null)[], reason: string) => ({ points, valid: points.every(Boolean), reason });
    const used = colors.map((_, i) => i).filter(i => !skip[i]);
    const problem = markerColorProblem(used.map(i => colors[i]), used.map(i => MARKER_NAMES[i]));
    if (problem) return result([null, null, null, null], problem);
    const targets = colors.map(toTarget);
    const darkId = targets.findIndex((t, i) => t.dark && !skip[i]), lightId = targets.findIndex((t, i) => t.light && !skip[i]);
    const size = width * height, labels = new Uint8Array(size), queue = new Uint32Array(size);
    for (let p = 0; p < size; p++) {
      const color = hsv(pixels[p * 4], pixels[p * 4 + 1], pixels[p * 4 + 2]);
      if (darkId >= 0 && color.v <= targets[darkId].darkMax && color.s < DARK_MAX_SATURATION) { labels[p] = darkId + 1; continue; }
      if (lightId >= 0 && color.v >= targets[lightId].lightMin && color.s < LIGHT_MAX_SATURATION) { labels[p] = lightId + 1; continue; }
      if (color.s < MIN_SATURATION || color.v < 0.17 || isSkinLike(color)) continue;
      let best = this.tolerance, id = 0;
      for (let k = 0; k < targets.length; k++) { if (skip[k] || targets[k].neutral || Math.abs(color.s - targets[k].s) > 0.25) continue; const d = hueDistance(color.h, targets[k].h); if (d < best) { best = d; id = k + 1; } }
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
    const track = Math.max(18, width * TRACK_RADIUS);
    const points = groups.map((group, i) => {
      if (skip[i]) return null;
      const old = this.previous[i], v = this.velocity[i], hint = hints?.[i] ?? null;
      const sizeOk = (p: ImagePoint) => !old?.area || (p.area! / old.area > 0.25 && p.area! / old.area < 4);
      if (old) {
        const pred = { x: old.x + v.x, y: old.y + v.y };
        // Lost for a few frames: allow a wider window around the last position; lost for long: forget it.
        const radius = this.misses[i] < 4 ? track + Math.hypot(v.x, v.y) : Math.max(track * 3, width * 0.15);
        const found = group.filter(p => dist(p, pred) < radius && sizeOk(p)).sort((a, b) => dist(a, pred) - dist(b, pred))[0];
        if (found) {
          v.x = 0.5 * v.x + 0.5 * (found.x - old.x); v.y = 0.5 * v.y + 0.5 * (found.y - old.y);
          const len = Math.hypot(v.x, v.y); if (len > track) { v.x *= track / len; v.y *= track / len; }
          this.misses[i] = 0; this.previous[i] = found; return found;
        }
        this.misses[i]++; v.x = 0; v.y = 0;
        if (this.misses[i] > 10) this.previous[i] = null;
        return null;
      }
      // Not known yet: nearest to the hand model's estimate of this joint, else the largest candidate.
      const others = this.previous.filter((q, k): q is ImagePoint => k !== i && !!q);
      const free = group.filter(p => !others.some(o => dist(o, p) < track));
      const pick = hint ? free.filter(p => dist(p, hint) < width * HINT_RADIUS).sort((a, b) => dist(a, hint) - dist(b, hint))[0]
        : free.sort((a, b) => b.area! - a.area!)[0];
      if (pick) { this.previous[i] = pick; this.misses[i] = 0; v.x = 0; v.y = 0; }
      return pick ?? null;
    });
    const missing = points.map((p, i) => (p || skip[i] ? '' : MARKER_NAMES[i])).filter(Boolean);
    return result(points, missing.length ? `${missing.join('・')}の目印が見つかりません（隠れ・色・位置を確認）` : '4点を読み取り中');
  }
}
