// The places behind the glass: cubes, a stone floor. Which heights the fingertip can have there, and how it catches at the edges.
// Pure functions, no DOM, no three.js. mm; z out of the screen.
import { RF, MATS, clamp, grain, solve } from './finger.js?v=6';

export const REACH = 4.5; // the objects stand this much higher than the lowest point of the resting fingertip
export const KINDS = ['smooth', 'rough', 'catchy', 'sticky'];
let seed = 1; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

// W, H: size of the window, top: height of the tops, mat: one material or 'mix' (each object its own)
export function makeWorld(kind, W, H, top, mat, depth) {
  seed = 42; const objs = [], deco = [], pick = (i) => (mat === 'mix' ? KINDS[i % 4] : mat);
  if (kind === 'cube') {
    const n = Math.max(2, Math.round((W - 20) / 54)), m = Math.max(1, Math.round((H - 20) / 54)), dx = W / n, dy = H / m, a = Math.min(dx, dy) * 0.33;
    for (let j = 0; j < m; j++) for (let i = 0; i < n; i++) { // towers of cubes; the uppermost one can be touched
      const x = -W / 2 + dx * (i + 0.5), y = -H / 2 + dy * (j + 0.5), k = Math.max(1, Math.round((depth + top) / (2 * a))), e = (depth + top) / k;
      objs.push({ type: 'box', x, y, a, r: 2, top, base: top - e, mat: pick(i + 2 * j) }); for (let q = 1; q < k; q++) deco.push({ x: x + (rnd() - 0.5) * 2, y: y + (rnd() - 0.5) * 2, a: a * 1.02, top: top - q * e - 0.3, base: top - (q + 1) * e, mat: KINDS[(i + 2 * j + q) % 4] });
    }
    // lower blocks in between: something to look down at
    for (let j = 0; j <= m; j++) for (let i = 0; i <= n; i++) deco.push({ x: -W / 2 + dx * i, y: -H / 2 + dy * j, a: 8 + 4 * rnd(), top: top - 30 - rnd() * (depth + top - 55), base: -depth, mat: 'wall' });
  } else if (kind === 'stone') {
    const R = 19, d = 33, rows = Math.ceil(H / (d * 0.87)) + 1, cols = Math.ceil(W / d) + 1;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const x = -W / 2 + (i + (j % 2) / 2) * d + (rnd() - 0.5) * 3, y = -H / 2 + j * d * 0.87 + (rnd() - 0.5) * 3, r = R * (0.93 + 0.1 * rnd());
      if (Math.abs(x) < W / 2 + r && Math.abs(y) < H / 2 + r) objs.push({ type: 'ball', x, y, r, z: top - r - rnd() * 1.5, mat: mat === 'mix' ? KINDS[Math.floor(clamp((x + W / 2) / W, 0, 0.999) * 4)] : mat });
    }
  }
  for (const o of objs) Object.assign(o, { ox: 0, oy: 0, vx: 0, vy: 0, sink: 0 });
  return { kind, objs, deco, top, W, H };
}
// lowest height the centre of a ball of radius RF can have at (x, y) over one object (-Infinity: not above it)
function over(o, x, y) {
  x -= o.x + o.ox; y -= o.y + o.oy;
  if (o.type === 'ball') { const R = o.r + RF, d2 = x * x + y * y; return d2 < R * R ? o.z - o.sink + Math.sqrt(R * R - d2) : -Infinity; }
  const i = o.a - o.r, dx = Math.max(0, Math.abs(x) - i), dy = Math.max(0, Math.abs(y) - i), R = RF + o.r, d2 = dx * dx + dy * dy; // rounded edges
  return d2 < R * R ? o.top - o.sink - o.r + Math.sqrt(R * R - d2) : -Infinity;
}
export function ground(w, x, y) { let z = -1e4, obj = null; for (const o of w.objs) { const q = over(o, x, y); if (q > z) { z = q; obj = o; } } return { z, obj }; }

// The fingertip follows its resting place. An edge it runs into holds it back until the finger has bent enough to slide up;
// on top it sticks and slips as the material says.
export class TipOver {
  constructor() { this.reset(); }
  reset() { this.p = null; this.slip = true; this.lag = [0, 0, 0]; this.obj = null; this.z = 0; }
  // dip, reach: the fingertip is never farther sideways from the joint than the finger is long, so what is computed is what is drawn. gain: how strong it all is
  step(target, w, dt, { dip = null, reach = 1e9, gain = 1 } = {}) {
    const free = target[2], R = 3.2 * gain; if (!this.p) { this.p = [target[0], target[1]]; this.slip = true; }
    const n = Math.max(1, Math.ceil(dt * 360)), h = dt / n, p = this.p, z = (a, b) => Math.max(free, ground(w, a, b).z);
    for (let s = 0; s < n; s++) {
      const g = ground(w, p[0], p[1]), pen = Math.max(0, g.z - free), M = pen > 0 ? MATS[g.obj.mat] : null;
      let fx = target[0] - p[0], fy = target[1] - p[1], sx = 0, sy = 0;
      if (pen > 0) { const e = 0.15; sx = clamp((z(p[0] + e, p[1]) - z(p[0] - e, p[1])) / (2 * e), -4, 4); sy = clamp((z(p[0], p[1] + e) - z(p[0], p[1] - e)) / (2 * e), -4, 4); fx -= R * pen * sx; fy -= R * pen * sy; }
      const L = Math.hypot(fx, fy), hold = M ? M.hold * gain * 0.6 : 0; if (!hold || L > hold) this.slip = true; else if (L < 1.5) this.slip = false;
      if (!this.slip) continue;
      const q = (1 - Math.exp(-(M ? M.k / Math.max(0.2, gain) : 60) * h)) / (1 + R * (sx * sx + sy * sy)), c = Math.min(1, 1.2 / Math.max(1e-6, L * q)); p[0] += fx * q * c; p[1] += fy * q * c;
    }
    const ex = p[0] - target[0], ey = p[1] - target[1], L = Math.hypot(ex, ey), k = L > 30 ? 30 / L : 1; p[0] = target[0] + ex * k; p[1] = target[1] + ey * k;
    if (gain < 0.05) { p[0] = target[0]; p[1] = target[1]; }
    if (dip) { const x = p[0] - dip[0], y = p[1] - dip[1], m = Math.hypot(x, y); if (m > reach) { p[0] = dip[0] + x / m * reach; p[1] = dip[1] + y / m * reach; this.slip = true; } }
    this.lag = [p[0] - target[0], p[1] - target[1], 0]; const g = ground(w, p[0], p[1]); this.obj = g.z > free ? g.obj : null; this.z = Math.max(free, g.z);
    this.soft(w, dt); return this.lag;
  }
  // soft objects are dragged along a little, sink a little and swing back
  soft(w, dt) {
    const h = Math.min(0.033, dt);
    for (const o of w.objs) {
      const M = MATS[o.mat], on = o === this.obj; if (!M.drag) continue;
      for (const [k, v, i] of [['ox', 'vx', 0], ['oy', 'vy', 1]]) { const t = on ? clamp(-this.lag[i] * M.drag * 0.22, -4, 4) : 0; o[v] += ((t - o[k]) * 500 - o[v] * 13) * h; o[k] += o[v] * h; }
      o.sink += ((on ? M.dent * 0.5 : 0) - o.sink) * Math.min(1, h * 25);
    }
  }
}

// The finger for this lag, raised until neither the fingertip nor the part behind it is inside anything. o: what solve() needs
export function settle(w, o, obj) {
  let f = null, floor = -1e4; const bump = obj ? (MATS[obj.mat].bump || 0) * 0.7 : 0;
  for (let i = 0; i < 12; i++) {
    f = solve({ ...o, gain: 1, surf: -1e4, floor }); let up = ground(w, f.tip[0], f.tip[1]).z + bump * grain(f.tip[0], f.tip[1]) - f.tip[2];
    if (o.kind !== 'stick' && o.kind !== 'cursor') for (const q of [0.25, 0.5, 0.75]) { const z = f.tip.map((v, j) => v + (f.dip[j] - v) * q); up = Math.max(up, (ground(w, z[0], z[1]).z - z[2]) / (1 - q)); }
    if (up < 0.03) break; floor = Math.min(f.dip[2] - 1, f.tip[2] + up * 1.1);
  }
  return f;
}
