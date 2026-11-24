// The virtual finger for stroking with the MP joint (same rules as the 3D page public/mp-stroke) or with the PIP joint (public/stroke). Pure functions, no DOM, no three.js.
// Screen frame (mm): x right, y away from the person along the glass, z out of the screen. Vectors are [x, y, z].
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const norm = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const DIPK = 0.67, REST = 2 * Math.PI / 180, REST_PIP = 6 * Math.PI / 180, RF = 8; // DIP follows PIP; the resting finger is (almost) straight; finger radius
// h: height of the joint above the glass (mm), theta: usual angle of the segment above the joint, off: from the middle of the contact to the joint
export const JOINTS = { mp: { h: 11, theta: 90, off: 12 }, pip: { h: 8.2, theta: 78, off: 12.5 } };

// k: how fast the fingertip follows (1/s), hold: how far it sticks before slipping (mm), bump: grain height, drag: pull on the surface, dent: how deep it gives way
export const MATS = {
  smooth: { name: 'つるつる', k: 45, hold: 0, bump: 0, drag: 0, dent: 0.6, color: 0x8fb6ca, rough: 0.5 },
  rough: { name: 'ざらざら', k: 20, hold: 3.5, bump: 1.3, drag: 0, dent: 0.4, color: 0xb5a17f, rough: 0.95 },
  catchy: { name: '引っかかる', k: 15, hold: 16, bump: 0, drag: 0.35, dent: 1.8, color: 0x65a085, rough: 0.8 },
  sticky: { name: 'ねばねば', k: 3, hold: 0, bump: 0, drag: 0.6, dent: 3.0, color: 0xa982ba, rough: 0.4 },
};
export const grain = (x, y) => Math.max(0, Math.sin(x * 1.45) * Math.sin(y * 1.45));

// yaw: which way the hand comes from (0 = straight from the person, + = from the right)
export const toHand = (yaw) => [Math.sin(yaw), -Math.cos(yaw), 0];
export const sideOf = (yaw) => [Math.cos(yaw), Math.sin(yaw), 0];
// theta: the back of the hand rises from the glass by theta. The virtual proximal phalanx is its straight continuation into the screen.
export function frame(theta, yaw, curl) {
  const H = toHand(yaw), up = add([H[0] * Math.cos(theta), H[1] * Math.cos(theta), 0], [0, 0, Math.sin(theta)]);
  const u = [-up[0], -up[1], -up[2]], n = norm(add(H, u, -dot(H, u))); // n: palm side
  const dir = (a) => add([u[0] * Math.cos(a), u[1] * Math.cos(a), u[2] * Math.cos(a)], n, Math.sin(a));
  return { up, u, n, m: dir(curl), d: dir(curl * (1 + DIPK)) };
}
// The segments keep their length (a real finger does not stretch): at rest the fingertip presses PRESS mm into the material, and when the
// finger bends it comes up by as much. What is still missing is at most STRETCH; beyond that the finger bends less.
export const PRESS = 2.5, STRETCH = 1.06;
// lag: where the fingertip is, minus where it would be without friction (mm, in the plane of the glass). surf: height of the material
// tip height allowed: from just touching to pressed in by PRESS + dent
export function solve(o) {
  const shape = o.joint === 'pip' ? shapePip : shapeMp, { root, len, surf, dent = 0 } = o, L = o.joint === 'pip' ? len.slice(1) : len;
  let s = 1, q, k = 1, low = surf + RF - PRESS - dent - root[2], high = surf + RF - 0.3 - root[2];
  for (let i = 0; i < 24; i++) {
    q = shape(o, s); const z = q.dirs.reduce((t, d, j) => t + d[2] * L[j], 0); k = z > high ? high / z : z < low ? low / z : 1;
    if (k <= STRETCH || s < 0.05) break; s *= 0.86;
  }
  k = clamp(k, 0.85, STRETCH); const P = [root]; q.dirs.forEach((d, j) => P.push(add(P[j], d, L[j] * k)));
  const n = P.length, d = q.dirs[n - 2], F = o.kind !== 'stick' && o.kind !== 'cursor';
  return { base: q.base, u: q.dirs[0], d, pip: o.joint === 'pip' ? root : P[1], dip: P[n - 2], tip: P[n - 1], k, eased: s, bendDeg: Math.acos(clamp(dot(d, F ? q.base.d : q.base.u), -1, 1)) * 180 / Math.PI };
}
const lean = (v, S, a) => norm(add(v, S, Math.tan(a)));
function shapeMp({ theta, yaw, lag, gain = 1, bend = 'whole', kind = 'finger' }, s) {
  const S = sideOf(yaw), H = toHand(yaw), lx = dot(lag, S) * gain * s, lz = dot(lag, H) * gain * s, F = kind === 'finger', whole = bend === 'whole', base = frame(theta, yaw, REST);
  const b1 = F ? (whole ? clamp(lx * 0.016, -0.6, 0.6) : 0) : clamp(lx * 0.022, -0.7, 0.7), b2 = F ? clamp(lx * 0.044, -1.2, 1.2) : b1; // sideways
  const p1 = whole ? clamp(lz * 0.009, -0.3, 0.3) : 0, flex = clamp(REST + lz * 0.022, -0.35, 1.2);                                  // along the finger
  const fr = frame(theta + p1, yaw, F ? flex : 0), u = lean(fr.u, S, b1);
  return { base, dirs: F ? [u, lean(fr.m, S, whole ? (b1 + b2) / 2 : 0), lean(fr.d, S, b2)] : [u, u, u] };
}
// PIP: the virtual middle phalanx is the straight continuation of the real proximal one and stays so; only the distal one bends.
function shapePip({ theta, yaw, lag, gain = 1, kind = 'finger' }, s) {
  const S = sideOf(yaw), H = toHand(yaw), lx = dot(lag, S) * gain * s, lz = dot(lag, H) * gain * s, F = kind === 'finger', b = frame(theta, yaw, REST_PIP);
  const b1 = F ? 0 : clamp(lx * 0.022, -0.7, 0.7), b2 = F ? clamp(lx * 0.044, -0.9, 0.9) : b1, u = lean(b.u, S, b1);
  return { base: { u: b.u, d: b.m }, dirs: [u, F ? lean(frame(theta, yaw, clamp(REST_PIP + lz * 0.03, -0.45, 0.9)).m, S, b2) : u] };
}
export function restTip(root, theta, yaw, len, joint = 'mp') { if (joint === 'pip') { const f = frame(theta, yaw, REST_PIP); return add(add(root, f.u, len[1]), f.m, len[2]); } const f = frame(theta, yaw, REST); return add(add(add(root, f.u, len[0]), f.m, len[1]), f.d, len[2]); }

// The fingertip follows its resting place, sticks to the material and slips.
export class Tip {
  constructor() { this.reset(); }
  reset() { this.p = null; this.slip = true; this.lag = [0, 0, 0]; }
  step(target, M, dt) {
    if (!this.p) { this.p = [target[0], target[1]]; this.slip = true; }
    const n = Math.max(1, Math.ceil(dt * 240)), h = dt / n; // the same behaviour at 60 and 120 Hz
    for (let i = 0; i < n; i++) {
      const dx = target[0] - this.p[0], dy = target[1] - this.p[1], L = Math.hypot(dx, dy);
      if (M.hold) { if (L > M.hold) this.slip = true; if (L < 1.5) this.slip = false; } else this.slip = true;
      const q = this.slip ? 1 - Math.exp(-M.k * h) : 0; this.p[0] += dx * q; this.p[1] += dy * q;
    }
    const ex = this.p[0] - target[0], ey = this.p[1] - target[1], L = Math.hypot(ex, ey), s = L > 30 ? 30 / L : 1; // never left behind more than 30 mm
    this.p[0] = target[0] + ex * s; this.p[1] = target[1] + ey * s;
    this.lag = [this.p[0] - target[0], this.p[1] - target[1], 0]; return this.lag;
  }
}
// where on the glass a point inside the screen is seen from the eye
export const seenAt = (p, e) => { const q = e[2] / (e[2] - p[2]); return [e[0] + (p[0] - e[0]) * q, e[1] + (p[1] - e[1]) * q]; };
