// Solid things with a height: cubes, hills, soft balls. Which heights the fingertip can have there, and how it catches at the edges.
// Pure functions, no DOM, no three.js. mm; z out of the screen.
import { RF, clamp, solve } from './finger.js?v=14';

export const REACH = 4.5; // the things stand this much higher than the lowest point of the resting fingertip
let seed = 1; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const K = 34; // how fast the fingertip follows on them (1/s)

// W, H: size of the window, low: lowest point of the resting fingertip
export function makeWorld(kind, W, H, low, depth) {
  seed = 42; const objs = [], deco = [], top = low + REACH;
  if (kind === 'cube') { // towers of cubes; the uppermost ones can be touched
    const n = Math.max(2, Math.round(W / 50)), m = Math.max(1, Math.round(H / 50)), dx = W / n, dy = H / m, a = Math.min(dx, dy) * 0.33;
    for (let j = 0; j < m; j++) for (let i = 0; i < n; i++) {
      const x = -W / 2 + dx * (i + 0.5), y = -H / 2 + dy * (j + 0.5), k = Math.max(1, Math.round((depth + top) / (2 * a))), e = (depth + top) / k;
      objs.push({ type: 'box', x, y, a, r: 2, top, base: top - e }); for (let q = 1; q < k; q++) deco.push({ x: x + (rnd() - 0.5) * 2, y: y + (rnd() - 0.5) * 2, a: a * 1.02, top: top - q * e - 0.3, base: top - (q + 1) * e });
    }
    for (let j = 0; j <= m; j++) for (let i = 0; i <= n; i++) deco.push({ x: -W / 2 + dx * i, y: -H / 2 + dy * j, a: 8 + 4 * rnd(), top: top - 30 - rnd() * (depth + top - 55), base: -depth });
  } else if (kind === 'bumps') { // hills on one plate: a height field, steep and high
    const f = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({ x: ((i % 4) - 1.5) * W * 0.242 + (i < 4 ? -1 : 1) * W * 0.012, y: (i < 4 ? 1 : -1) * H * 0.245, s: [1, 0.72, 1.12, 0.86, 0.8, 1.15, 0.92, 1.05][i], R: Math.min(20, W * 0.125) })); // eight hills, high and low
    objs.push({ type: 'field', x: 0, y: 0, f, base: low - 5, amp: 23 });
  } else if (kind === 'soft') { // from hard to soft
    const u = W / 4; [[-u - 4, 14, 0.6], [0, 17, 3], [u + 4, 20, 6]].forEach(([x, r, soft], i) => objs.push({ type: 'ball', i, x, y: 0, r, z: low + 5.5 + soft - r, soft, k: 260 + 500 / soft }));
  }
  for (const o of objs) Object.assign(o, { ox: 0, oy: 0, vx: 0, vy: 0, sink: 0, k: o.k || 240, move: o.type === 'box' ? 0.55 : o.type === 'field' ? 0.22 : 0.1 * o.soft });
  return { kind, objs, deco, top, W, H, low };
}
export function fieldZ(o, x, y) { let z = o.base; for (const b of o.f) { const d = ((x - b.x) ** 2 + (y - b.y) ** 2) / (b.R * b.R); if (d < 4) z += b.s * o.amp * Math.exp(-d * 2.2); } return z; }
const OFF = (() => { const q = [[0, 0]]; for (const r of [0.4, 0.75]) for (let i = 0; i < 8; i++) q.push([r * Math.cos(i * Math.PI / 4), r * Math.sin(i * Math.PI / 4)]); return q.map(([x, y]) => [x * RF, y * RF, Math.sqrt(1 - x * x - y * y) * RF]); })();
// lowest height the centre of a ball of radius RF can have at (x, y) over one thing (-Infinity: not above it)
function over(o, x, y) {
  x -= o.x + o.ox; y -= o.y + o.oy;
  if (o.type === 'field') { let z = -Infinity; for (const [a, b, c] of OFF) z = Math.max(z, fieldZ(o, x + a, y + b) + c); return z; }
  if (o.type === 'ball') { const R = o.r + RF - o.soft, e2 = x * x + y * y; return e2 < R * R ? o.z - o.sink + Math.sqrt(R * R - e2) : -Infinity; }
  const i = o.a - o.r, dx = Math.max(0, Math.abs(x) - i), dy = Math.max(0, Math.abs(y) - i), R = RF + o.r, e2 = dx * dx + dy * dy; // rounded edges
  return e2 < R * R ? o.top - o.sink - o.r + Math.sqrt(R * R - e2) : -Infinity;
}
export function ground(w, x, y) { let z = -1e4, obj = null; for (const o of w.objs) { const q = over(o, x, y); if (q > z) { z = q; obj = o; } } return { z, obj }; }

// The fingertip follows its resting place. A slope holds it back until the finger has bent enough to slide up, and lets it run down.
export class TipOver {
  constructor() { this.reset(); }
  reset() { this.p = null; this.lag = [0, 0, 0]; this.obj = null; this.z = 0; this.push = [0, 0]; }
  // fit: the part of a displacement that the finger can do; gain: how strong
  step(target, w, dt, { fit = (v) => v, gain = 1 } = {}) {
    const free = target[2], R = 4.6 * gain; if (!this.p) this.p = [target[0], target[1]];
    const n = Math.max(1, Math.ceil(dt * 360)), h = dt / n, p = this.p, z = (a, b) => Math.max(free, ground(w, a, b).z); let px = 0, py = 0;
    for (let s = 0; s < n; s++) {
      const g = ground(w, p[0], p[1]), pen = Math.max(0, g.z - free); let fx = target[0] - p[0], fy = target[1] - p[1], sx = 0, sy = 0;
      if (pen > 0) { const e = 0.15; sx = clamp((z(p[0] + e, p[1]) - z(p[0] - e, p[1])) / (2 * e), -4, 4); sy = clamp((z(p[0], p[1] + e) - z(p[0], p[1] - e)) / (2 * e), -4, 4); fx -= R * pen * sx; fy -= R * pen * sy; px += 3.2 * pen * sx / n; py += 3.2 * pen * sy / n; }
      const L = Math.hypot(fx, fy), q = (1 - Math.exp(-(pen > 0 ? K / Math.max(0.4, gain) : 60) * h)) / (1 + R * (sx * sx + sy * sy)), c = Math.min(1, 1.2 / Math.max(1e-6, L * q)); p[0] += fx * q * c; p[1] += fy * q * c;
    }
    const l = fit([p[0] - target[0], p[1] - target[1], 0]); p[0] = target[0] + l[0]; p[1] = target[1] + l[1]; const pl = Math.hypot(px, py), pc = pl > 40 ? 40 / pl : 1; this.push = [px * pc, py * pc]; // push: what the slope would have done to the finger, now done to the thing
    this.lag = [l[0], l[1], 0]; const g = ground(w, p[0], p[1]); this.obj = g.z > free ? g.obj : null; this.z = Math.max(free, g.z); return this.lag;
  }
}
// the things are dragged along a little and swing back. tips: the fingers on them, go: how much the things give way
export function swing(w, tips, dt, go) {
  const h = Math.min(0.033, dt); for (const o of w.objs) { const on = tips.filter((t) => t.obj === o), m = o.type === 'ball' && o.soft < 1 ? 0 : o.move * go, lim = o.type === 'box' ? 5 : 6;
    for (const [k, v, i] of [['ox', 'vx', 0], ['oy', 'vy', 1]]) { let t = 0; for (const q of on) t += clamp((q.push[i] * 0.5 - q.lag[i]) * m, -lim, lim); o[v] += ((t - o[k]) * o.k - o[v] * 11) * h; o[k] = clamp(o[k] + o[v] * h, -9, 9); }
    if (o.type === 'box') o.sink += ((on.length ? 1.6 * go : 0) - o.sink) * Math.min(1, dt * 14); }
}
// The finger for this lag, raised until neither the fingertip nor the part behind it is inside anything. o: what solve() needs
export function settle(w, o) {
  let f = null, lo = -1e4;
  for (let i = 0; i < 12; i++) {
    f = solve({ ...o, lo }); let up = ground(w, f.tip[0], f.tip[1]).z - f.tip[2];
    if (o.kind !== 'stick' && o.kind !== 'cursor') for (const q of [0.25, 0.5, 0.75]) { const z = f.tip.map((v, j) => v + (f.dip[j] - v) * q); up = Math.max(up, (ground(w, z[0], z[1]).z - z[2]) / (1 - q)); }
    if (up < 0.03) break; lo = Math.min(o.root[2] - 12, f.tip[2] + up * 1.1);
  }
  return f;
}
