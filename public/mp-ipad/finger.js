// The virtual finger: a chain of segments that starts at the contact on the glass and reaches into the screen. Pure functions, no DOM, no three.js.
// Screen frame (mm): x right, y away from the person along the glass, z out of the screen. Vectors are [x, y, z].
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const RAD = Math.PI / 180;
export const RF = 8, PRESS = 2.5; // finger radius; how far the resting fingertip is pressed into a surface (mm)

// What touches the glass. joint: the PIP knuckle, the virtual finger is the middle and the distal phalanx. tip: the fingertip, a whole finger grows from it.
// h: height of the start of the chain above the glass, rest: how the finger is bent at rest (degrees: at the glass, then at each joint)
export const CONTACTS = { joint: { h: 8.2, rest: [0, 7] }, tip: { h: 7, rest: [0, 13, 9] } };
// name, length of the phalanges and width, relative to the index finger (lengths: from bones, Buryanov & Kotiuk 2010; only the proportions are used)
export const FINGERS = { index: { name: '人差し指', len: [1, 1, 1], w: 1 }, middle: { name: '中指', len: [1.12, 1.18, 1.1], w: 1.03 }, ring: { name: '薬指', len: [1.04, 1.15, 1.09], w: 0.96 }, little: { name: '小指', len: [0.82, 0.81, 1.01], w: 0.86 } };
export const ORDER = ['index', 'middle', 'ring', 'little'];
// base: the three phalanges of the index finger (mm, the last one to the end of the finger); who: one finger or two (then both get the mean, so that they reach equally deep); far: exaggeration
export function lengths(base, who, contact, far = 1) {
  const m = [0, 1, 2].map((i) => who.reduce((s, k) => s + FINGERS[k].len[i], 0) / who.length * base[i] * far); m[2] -= RF; return contact === 'tip' ? m : m.slice(1);
}

// Surfaces to stroke. k: how fast the fingertip follows (1/s), hold: how far it sticks before slipping (mm), bump: grain height (f: how fine), drag: pull on the surface, dent: how deep it gives way
export const MATS = {
  smooth: { name: 'つるつる', k: 45, hold: 0, bump: 0, drag: 0, dent: 0.6 },
  sand: { name: '細かいざらざら', k: 24, hold: 1.6, bump: 0.8, f: 2.0, drag: 0, dent: 0.4 },
  stone: { name: '粗いごつごつ', k: 20, hold: 3.5, bump: 4.6, f: 0.36, drag: 0, dent: 0.4 },
  knit: { name: '引っかかる', k: 15, hold: 16, bump: 0, drag: 0.35, dent: 1.8 },
  tape: { name: 'べたべた', k: 9, hold: 11, bump: 0, drag: 0.5, dent: 1.0 },
  honey: { name: 'ねっとり', k: 3, hold: 0, bump: 0, drag: 0.6, dent: 3.0 },
  rubber: { name: 'ぷにぷに', k: 26, hold: 8, bump: 0, drag: 0.95, dent: 5.5 },
  fur: { name: 'ふわふわ', k: 8, hold: 0, bump: 0, drag: 0.4, dent: 4.0 },
  water: { name: 'みず', k: 38, hold: 0, bump: 0, drag: 0, dent: 1.2 },
  slime: { name: '', k: 20, hold: 0, bump: 0, drag: 0.5, dent: 2.2 },
};
export const grain = (x, y, f = 1.45) => Math.max(0, Math.sin(x * f) * Math.sin(y * f));

// yaw: which way the palm faces (0 = to the person, -90 degrees = to the left: right hand with the thumb up)
export const toHand = (yaw) => [Math.sin(yaw), -Math.cos(yaw), 0];
// dir: [left, down] (rad): how far the finger points to the left and down on the screen instead of straight into the depth. u: along the finger, n: palm side, r: sideways
export function aim(dir, yaw) {
  const u = norm([-Math.tan(dir[0]), -Math.tan(dir[1]), -1]), H = toHand(yaw), n = norm(add(H, u, -dot(H, u))); return { u, n, r: cross(u, n) };
}
// How far the finger gives way: 0 stiff .. 1 as limp as rubber (degrees). A real finger bends to the palm side, hardly backward and not sideways.
const STEP = [{ flex: 15, ext: 3, side: 0, base: 0, lean: 0 }, { flex: 36, ext: 9, side: 3, base: 6, lean: 3 }, { flex: 72, ext: 30, side: 30, base: 10, lean: 6 }];
export function limits(soft) { const x = clamp(soft, 0, 1) * 2, i = Math.min(1, Math.floor(x)), t = x - i, o = {}; for (const k of Object.keys(STEP[0])) o[k] = STEP[i][k] + (STEP[i + 1][k] - STEP[i][k]) * t; return o; }
// The chain for how much it is bent (f: -1 fully back .. 1 fully to the palm), how much sideways (s: -1..1) and how much it is lifted at the glass (lift, rad)
function chain(q, f, s, lift = 0) {
  const { A, rest, L, len } = q, P = [q.root], D = []; let a = -lift, b = 0;
  for (let i = 0; i < len.length; i++) {
    a += (rest[i] + (f > 0 ? f * (i ? (len.length > 2 ? 0.7 : 1) * L.flex : L.base) : i ? f * L.ext : 0)) * RAD; b += s * (i ? L.side : L.lean) * RAD;
    const c = Math.cos(b), d = [0, 1, 2].map((k) => (A.u[k] * Math.cos(a) + A.n[k] * Math.sin(a)) * c + A.r[k] * Math.sin(b)); D.push(d); P.push(add(P[i], d, len[i]));
  }
  return { P, D, tip: P[P.length - 1] };
}
// bent farther than it would give way by itself (f > 1): up to what a finger can do at all
const HARD = { flex: 84, base: 22 };
function over(q, f, s, lift = 0) { if (f <= 1) return chain(q, f, s, lift); const t = clamp((f - 1) / 3, 0, 1), L = { ...q.L }; for (const k of ['flex', 'base']) L[k] += Math.max(0, HARD[k] - L[k]) * t; return chain({ ...q, L }, 1, s, lift); }
// o: { root, contact, len, dir: [left, down], yaw, soft }
const setup = (o) => ({ root: o.root, A: aim(o.dir, o.yaw), rest: CONTACTS[o.contact].rest, L: limits(o.soft ?? 0.5), len: o.len });
export const restTip = (o) => chain(setup(o), 0, 0).tip;
const d2 = (v, w) => v[0] * w[0] + v[1] * w[1];
// the directions in the glass in which the fingertip goes when the finger bends (n) and when it leans (r), and how far it goes by itself: back, palm, side (mm)
export function reach(o) {
  const q = setup(o), t0 = chain(q, 0, 0).tip, go = (f, s) => { const t = chain(q, f, s).tip; return [t[0] - t0[0], t[1] - t0[1]]; }, c = go(0.4, 0), v = Math.hypot(...c) > 0.3 ? c : q.A.n, l = Math.hypot(v[0], v[1]) || 1, n = [v[0] / l, v[1] / l], g = Math.sign(-n[1] * q.A.r[0] + n[0] * q.A.r[1]) || 1, r = [-n[1] * g, n[0] * g];
  return { n, r, back: Math.max(0, -d2(go(-1, 0), n)), palm: Math.max(0, d2(go(1, 0), n)), side: Math.abs(d2(go(0, 1), r)) };
}
// the part of a wanted displacement that this finger does (k: share, 0 = the finger does not give way at all)
export function within(R, lag, k = 1) {
  if (k <= 0) return [0, 0, 0]; const c = Math.min(1, k), a = d2(lag, R.n) * c, b = d2(lag, R.r) * c, A = a < 0 ? R.back : R.palm, x = A < 0.05 ? 0 : a, y = R.side < 0.05 ? 0 : b, m = Math.hypot(x ? x / A : 0, y ? y / R.side : 0), t = m > 1 ? 1 / m : 1;
  return [(R.n[0] * x + R.r[0] * y) * t, (R.n[1] * x + R.r[1] * y) * t, 0];
}
function half(lo, hi, up) { for (let i = 0; i < 18; i++) { const m = (lo + hi) / 2; if (up(m)) lo = m; else hi = m; } return (lo + hi) / 2; }
// The finger for this displacement of the fingertip (lag, mm in the plane of the glass). The segments keep their length.
// lo: lowest height of the fingertip's centre, hi: highest (a surface it must go on touching); without them the finger hangs in the air.
export function solve(o) {
  const q = setup(o), R = o.reach || reach(o), base = chain(q, 0, 0), lag = o.lag || [0, 0, 0], lo = o.lo ?? -1e4, hi = o.hi ?? 1e4;
  if (o.kind === 'stick' || o.kind === 'cursor') { const t = add(base.tip, lag), tip = [t[0], t[1], Math.max(lo, t[2])], u = norm(add(tip, o.root, -1)), n = q.len.reduce((a, b) => a + b, 0), P = [o.root]; let s = 0; for (const l of q.len) { s += l; P.push(o.root.map((v, i) => v + (tip[i] - v) * s / n)); } return { P, u, d: u, dip: P[P.length - 2], tip, base: q.A.u, bendDeg: 0, lag }; }
  const a = d2(lag, R.n), b = d2(lag, R.r), at = (f, s, w, l = 0) => { const t = over(q, f, s, l).tip; return d2([t[0] - base.tip[0], t[1] - base.tip[1]], w); }, z = (f, s) => over(q, f, s).tip[2];
  let f = 0, s = 0, c;
  if (a > 0.01 && R.palm > 0.05) f = half(0, 1, (m) => at(m, 0, R.n) < a); else if (a < -0.01 && R.back > 0.05) f = half(-1, 0, (m) => at(m, 0, R.n) < a);
  if (Math.abs(b) > 0.01 && R.side > 0.05) s = half(-1, 1, (m) => at(f, m, R.r) < b);
  if (f > 0 && z(f, s) > hi) f = half(0, f, (m) => z(m, s) < hi); // it bends only as far as it still touches
  if (z(f, s) >= lo) c = chain(q, f, s); else if (Math.hypot(q.A.u[0], q.A.u[1]) > 0.3 && Math.abs(d2(q.A.u, R.n)) < 0.5 * Math.hypot(q.A.u[0], q.A.u[1])) { // it lies on its side (thumb up, fingertip on the glass): it is raised that way and a little foreshortened
    const u = q.A.u, w = norm([-u[0] * u[2], -u[1] * u[2], 1 - u[2] * u[2]]), h = Math.hypot(u[0], u[1]), up = (g) => { const v = [0, 1, 2].map((i) => u[i] * Math.cos(g) + w[i] * Math.sin(g)), k = Math.max(0.78, Math.min(1, h / Math.hypot(v[0], v[1]))); return chain({ ...q, A: { u: v, n: q.A.n, r: cross(v, q.A.n) }, len: q.len.map((l) => l * k) }, f, s); }; c = up(half(0, 0.7, (g) => up(g).tip[2] < lo));
  } else { // something is under it: the finger arches, the fingertip stays where it is and comes up
    const f0 = f, to = at(f0, s, R.n), arch = (l) => over(q, (f = half(f0, 5, (m) => at(m, s, R.n, l) < to)), s, l); c = arch(half(0, 1.25, (l) => arch(l).tip[2] < lo));
  }
  const n = c.P.length; return { P: c.P, u: c.D[0], d: c.D[n - 2], dip: c.P[n - 2], tip: c.tip, base: q.A.u, f, s, lag: [c.tip[0] - base.tip[0], c.tip[1] - base.tip[1], 0], bendDeg: Math.acos(clamp(dot(c.D[n - 2], base.D[n - 2]), -1, 1)) / RAD };
}

// The fingertip sticks to the material and slips. raw: where the material would keep it; the finger follows as far as it gives way (fit), the rest is done by the material.
export class Tip {
  constructor() { this.reset(); }
  reset() { this.p = null; this.slip = true; this.lag = [0, 0, 0]; this.raw = [0, 0, 0]; }
  step(target, M, dt, fit = (v) => v) {
    if (!this.p) { this.p = [target[0], target[1]]; this.slip = true; }
    const n = Math.max(1, Math.ceil(dt * 240)), h = dt / n; // the same behaviour at 60 and 120 Hz
    for (let i = 0; i < n; i++) {
      const dx = target[0] - this.p[0], dy = target[1] - this.p[1], L = Math.hypot(dx, dy);
      if (M.hold) { if (L > M.hold) this.slip = true; if (L < 1.5) this.slip = false; } else this.slip = true;
      const q = this.slip ? 1 - Math.exp(-M.k * h) : 0; this.p[0] += dx * q; this.p[1] += dy * q;
    }
    const ex = this.p[0] - target[0], ey = this.p[1] - target[1], L = Math.hypot(ex, ey), s = L > 30 ? 30 / L : 1; // never left behind more than 30 mm
    this.p[0] = target[0] + ex * s; this.p[1] = target[1] + ey * s; this.raw = [ex * s, ey * s, 0]; this.lag = fit(this.raw); return this.lag;
  }
}
// where on the glass a point inside the screen is seen from the eye
export const seenAt = (p, e) => { const q = e[2] / (e[2] - p[2]); return [e[0] + (p[0] - e[0]) * q, e[1] + (p[1] - e[1]) * q]; };
