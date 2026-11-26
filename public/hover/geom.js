// The arithmetic of "the fist comes closer, the finger goes in". Pure functions, no DOM.
// Screen frame: mm, x to the right, y up, z out of the glass, the middle of the screen is 0. Picture frame: px of the camera, y down.

// ---------- small matrices ----------
export function solve(A, b) { // A x = b, Gauss with pivoting; null when it cannot be solved
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r; if (Math.abs(M[p][c]) < 1e-12) return null; [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r, i) => r[n] / r[i]);
}
export const mul3 = (A, B) => A.map((r) => [0, 1, 2].map((j) => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
export function inv3(m) {
  const [[a, b, c], [d, e, f], [g, h, i]] = m, A = e * i - f * h, B = f * g - d * i, C = d * h - e * g, det = a * A + b * B + c * C; if (Math.abs(det) < 1e-18) return null;
  return [[A, c * h - b * i, b * f - c * e], [B, a * i - c * g, c * d - a * f], [C, b * g - a * h, a * e - b * d]].map((r) => r.map((v) => v / det));
}
export const apply = (H, p) => { const w = H[2][0] * p[0] + H[2][1] * p[1] + H[2][2]; return [(H[0][0] * p[0] + H[0][1] * p[1] + H[0][2]) / w, (H[1][0] * p[0] + H[1][1] * p[1] + H[1][2]) / w]; };

// ---------- where the screen is in the picture ----------
// the map of a plane onto a plane from four or more pairs: dst ~ H src (least squares, both sides brought to the same size first)
export function homography(src, dst) {
  if (src.length < 4 || src.length !== dst.length) return null;
  const norm = (P) => { const n = P.length, cx = P.reduce((s, p) => s + p[0], 0) / n, cy = P.reduce((s, p) => s + p[1], 0) / n, d = P.reduce((s, p) => s + Math.hypot(p[0] - cx, p[1] - cy), 0) / n || 1, k = Math.SQRT2 / d; return [[[k, 0, -k * cx], [0, k, -k * cy], [0, 0, 1]], P.map((p) => [(p[0] - cx) * k, (p[1] - cy) * k])]; };
  const [Ts, s] = norm(src), [Td, d] = norm(dst), A = Array.from({ length: 8 }, () => new Array(8).fill(0)), b = new Array(8).fill(0);
  const add = (r, v) => { for (let i = 0; i < 8; i++) { b[i] += r[i] * v; for (let j = 0; j < 8; j++) A[i][j] += r[i] * r[j]; } };
  s.forEach(([x, y], i) => { const [u, v] = d[i]; add([x, y, 1, 0, 0, 0, -u * x, -u * y], u); add([0, 0, 0, x, y, 1, -v * x, -v * y], v); });
  const h = solve(A, b), Ti = inv3(Td); if (!h || !Ti) return null; const H = mul3(mul3(Ti, [[h[0], h[1], h[2]], [h[3], h[4], h[5]], [h[6], h[7], 1]]), Ts), k = H[2][2]; return Math.abs(k) < 1e-12 ? null : H.map((r) => r.map((v) => v / k));
}
// From the map screen (mm) -> picture (px): where the camera is, how it looks, how long its focal length is (px). w, h: size of the picture.
// The focal length is not asked from the phone: a flat thing seen aslant tells it. When it does not (seen straight from above), a usual one is taken.
export function poseFrom(H, w, h) {
  const cx = w / 2, cy = h / 2, col = (j) => [H[0][j] - cx * H[2][j], H[1][j] - cy * H[2][j], H[2][j]], h1 = col(0), h2 = col(1), h3 = col(2);
  const a1 = h1[0] * h2[0] + h1[1] * h2[1], b1 = -h1[2] * h2[2], a2 = h1[0] ** 2 + h1[1] ** 2 - h2[0] ** 2 - h2[1] ** 2, b2 = h2[2] ** 2 - h1[2] ** 2, x = (a1 * b1 + a2 * b2) / (a1 * a1 + a2 * a2 || 1), M = Math.max(w, h);
  let f = x > 0 ? 1 / Math.sqrt(x) : NaN, guessed = false; if (!(f > 0.4 * M && f < 3 * M)) { f = 0.78 * M; guessed = true; }
  const k = (c) => [c[0] / f, c[1] / f, c[2]], len = (v) => Math.hypot(...v), dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  let r1 = k(h1), r2 = k(h2), t = k(h3), lam = 1 / Math.sqrt(len(r1) * len(r2)); if (t[2] * lam < 0) lam = -lam; r1 = r1.map((v) => v * lam); r2 = r2.map((v) => v * lam); t = t.map((v) => v * lam);
  const skew = Math.abs(dot(r1, r2)) / (len(r1) * len(r2)), ratio = len(r1) / len(r2); // how well it fits a real camera: 0 and 1
  r1 = r1.map((v) => v / len(r1)); const d = dot(r2, r1); r2 = r2.map((v, i) => v - d * r1[i]); r2 = r2.map((v) => v / len(r2));
  let r3 = [r1[1] * r2[2] - r1[2] * r2[1], r1[2] * r2[0] - r1[0] * r2[2], r1[0] * r2[1] - r1[1] * r2[0]], C = [-dot(r1, t), -dot(r2, t), -dot(r3, t)];
  if (C[2] < 0) { r3 = r3.map((v) => -v); C[2] = -C[2]; }
  return { f, guessed, C, r1, r2, r3, cx, cy, skew, ratio, ok: C.every(Number.isFinite) && C[2] > 60 && C[2] < 3000 };
}
// how fast a point seen at (u, v) rises above the glass per mm of distance from the camera (along its looking direction)
export const riseOf = (P, u, v) => P.r3[0] * (u - P.cx) / P.f + P.r3[1] * (v - P.cy) / P.f + P.r3[2];
// a point seen at the place g of the glass, but h mm above it: what is under it (the line from the camera C through g)
export const lifted = (g, C, h) => { const k = h / C[2]; return [g[0] + (C[0] - g[0]) * k, g[1] + (C[1] - g[1]) * k]; };

// ---------- the bright dot the iPad shows ----------
// cur, ref: grey pictures (0..255) with and without the dot. Returns its middle, or null when there is no single clear dot.
export function findDot(cur, ref, w, h) {
  let best = 0, bx = 0, by = 0; const D = new Int16Array(w * h); for (let i = 0; i < D.length; i++) D[i] = cur[i] - ref[i];
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x, s = D[i] + D[i - 1] + D[i + 1] + D[i - w] + D[i + w]; if (s > best) { best = s; bx = x; by = y; } }
  const peak = best / 5; if (peak < 14) return null;
  const R = Math.max(6, Math.round(w / 30)), half = peak / 2; let sw = 0, sx = 0, sy = 0, area = 0, out = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = D[y * w + x]; if (v <= half) continue; if (Math.abs(x - bx) <= R && Math.abs(y - by) <= R) { const q = v - half; sw += q; sx += q * x; sy += q * y; area++; } else out++; }
  if (!sw || out > Math.max(40, area * 3) || area > w * h * 0.03) return null; // something else changed too (a hand, the light)
  return { x: sx / sw + 0.5, y: sy / sw + 0.5, peak, area };
}

// ---------- how far the hand is ----------
// The hand model gives the points in the picture (0..1) and the same points in metres (seen from the same side). The ratio of the two sizes
// is px per metre: the smaller the hand looks, the farther it is. Only the palm is used, it does not change its shape.
export const PALM = [0, 5, 9, 13, 17];
export function scaleOf(L, Wd, w, h, ids = PALM) {
  if (!L || !Wd) return null; const m = (a, k) => ids.reduce((s, j) => s + a[j][k], 0) / ids.length, lx = m(L, 'x'), ly = m(L, 'y'), wx = m(Wd, 'x'), wy = m(Wd, 'y'); let n = 0, d = 0;
  for (const j of ids) { n += ((L[j].x - lx) * w) ** 2 + ((L[j].y - ly) * h) ** 2; d += (Wd[j].x - wx) ** 2 + (Wd[j].y - wy) ** 2; }
  const s = Math.sqrt(n / d); return Number.isFinite(s) && s > 0 ? s : null;
}
// which point of the hand touches the glass: the second joint (PIP) or the tip of that finger
export const POINT = { joint: { index: 6, middle: 10, ring: 14, little: 18 }, tip: { index: 8, middle: 12, ring: 16, little: 20 } };

// ---------- from what the phone sends to place and height ----------
// m: { g: the place of the glass the point is seen at, dz: riseOf, Z: distance by the size of the hand (mm) }, C: the camera.
// What nobody can know beforehand is learned whenever the glass is touched (then the place and the height 0 are known):
// c: how much larger or smaller this hand is than the model's, off: where the point of the model is, seen from the real contact.
export class Fit {
  constructor(h0 = 12) { this.h0 = h0; this.c = 1; this.off = [0, 0]; this.n = 0; } // h0: the point of the model lies inside the finger, this much above the glass
  height(m, C) { return C[2] + m.dz * m.Z * this.c - this.h0; }
  place(m, C, lift) { const p = lifted(m.g, C, Math.max(0, lift) + this.h0); return [p[0] + this.off[0], p[1] + this.off[1]]; }
  learn(m, C, touch) {
    const k = this.n < 1 ? 1 : this.n < 8 ? 0.35 : 0.06, c = (this.h0 - C[2]) / (m.dz * m.Z), p = lifted(m.g, C, this.h0);
    if (c > 0.4 && c < 2.5) this.c += (c - this.c) * k; const o = [touch[0] - p[0], touch[1] - p[1]]; if (Math.hypot(...o) < 60) this.off = this.off.map((v, i) => v + (o[i] - v) * k); this.n++;
  }
}

// ---------- against the delay and the trembling ----------
// The place comes late (camera, finding the hand, the way) and trembles by a millimetre or two. Place and speed are estimated
// (Kalman filter, constant speed) and carried on to now. Slow: not carried on (it would only tremble).
export class Track {
  constructor(r = 2, q = 1500) { this.r = r; this.q = q; this.reset(); }
  reset() { this.s = null; this.t = -1e9; this.o = null; }
  add(p, t) {
    if (!this.s || t - this.t > 250 || t < this.t - 250) { this.s = [0, 1].map((k) => ({ x: p[k], v: 0, P: [[this.r * this.r, 0], [0, 1e5]] })); this.t = t; return; }
    const h = (t - this.t) / 1000; if (h < 0.002) return; this.t = t; const q = this.q * this.q, Q = [[h ** 4 / 4 * q, h ** 3 / 2 * q], [h ** 3 / 2 * q, h * h * q]];
    for (const s of this.s) {
      const x = s.x + s.v * h, P = s.P, a = P[0][0] + h * (P[1][0] + P[0][1]) + h * h * P[1][1] + Q[0][0], b = P[0][1] + h * P[1][1] + Q[0][1], d = P[1][1] + Q[1][1], c = a + this.r * this.r, K0 = a / c, K1 = b / c, e = p[this.s.indexOf(s)] - x;
      s.x = x + K0 * e; s.v = Math.max(-1500, Math.min(1500, s.v + K1 * e)); s.P = [[a - K0 * a, b - K0 * b], [b - K0 * b, d - K1 * b]];
    }
  }
  get speed() { return this.s ? Math.hypot(this.s[0].v, this.s[1].v) : 0; }
  // t: the moment that is asked for. A resting hand is smoothed more (o: what was given last)
  at(t, most = 200) {
    if (!this.s) return null; const h = Math.max(0, Math.min(most, t - this.t)) / 1000, g = Math.max(0, Math.min(1, (this.speed - 30) / 60)), f = g * g * (3 - 2 * g), p = this.s.map((s) => s.x + s.v * h * f);
    if (!this.o || Math.hypot(p[0] - this.o[0], p[1] - this.o[1]) > 30 || t < this.to) this.o = p; else { const k = 1 - Math.exp(-(t - this.to) / 1000 / (0.004 + 0.11 * (1 - f))); this.o = this.o.map((v, i) => v + (p[i] - v) * k); } this.to = t; return [...this.o];
  }
}
// a number that follows slowly (the height is rough: it must not tremble)
export class Slow {
  constructor(tau = 0.12) { this.tau = tau; this.v = null; this.t = 0; }
  add(v, t) { if (this.v == null || t - this.t > 400) this.v = v; else this.v += (v - this.v) * (1 - Math.exp(-Math.max(0, t - this.t) / 1000 / this.tau)); this.t = t; return this.v; }
}
