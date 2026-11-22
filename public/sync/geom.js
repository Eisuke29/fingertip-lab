// Camera pose from the iPad screen, and rectification of the finger's bending plane.
// Screen frame (mm): origin = screen centre, x = right, y = up (toward the far edge), z = out of the screen.

// ---------- small linear algebra ----------
function solve(A, b) { // Gaussian elimination with partial pivoting, A: n x n (array of arrays)
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const k = M[r][c] / M[c][c]; for (let j = c; j <= n; j++) M[r][j] -= k * M[c][j]; }
  }
  return M.map((r, i) => r[n] / r[i]);
}
const mat3mul = (A, B) => A.map((r) => [0, 1, 2].map((j) => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
const inv3 = (m) => {
  const [a, b, c] = m[0], [d, e, f] = m[1], [g, h, i] = m[2];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C;
  return [[A / det, -(b * i - c * h) / det, (b * f - c * e) / det], [B / det, (a * i - c * g) / det, -(a * f - c * d) / det], [C / det, -(a * h - b * g) / det, (a * e - b * d) / det]];
};
const norm3 = (v) => Math.hypot(v[0], v[1], v[2]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scale3 = (v, s) => v.map((x) => x * s);
const add3 = (a, b) => a.map((x, i) => x + b[i]);
const unit3 = (v) => scale3(v, 1 / norm3(v));
export const applyH = (H, x, y) => { const w = H[2][0] * x + H[2][1] * y + H[2][2]; return { x: (H[0][0] * x + H[0][1] * y + H[0][2]) / w, y: (H[1][0] * x + H[1][1] * y + H[1][2]) / w }; };

// ---------- homography (normalised DLT, h33 = 1) ----------
function normT(pts) {
  const m = pts.reduce((a, p) => ({ x: a.x + p.x / pts.length, y: a.y + p.y / pts.length }), { x: 0, y: 0 });
  const d = pts.reduce((a, p) => a + Math.hypot(p.x - m.x, p.y - m.y), 0) / pts.length || 1, s = Math.SQRT2 / d;
  return [[s, 0, -s * m.x], [0, s, -s * m.y], [0, 0, 1]];
}
export function homography(src, dst) {
  if (src.length < 4) return null;
  const Ts = normT(src), Td = normT(dst);
  const S = src.map((p) => applyH(Ts, p.x, p.y)), D = dst.map((p) => applyH(Td, p.x, p.y));
  const AtA = Array.from({ length: 8 }, () => new Array(8).fill(0)), Atb = new Array(8).fill(0);
  const addRow = (r, b) => { for (let i = 0; i < 8; i++) { Atb[i] += r[i] * b; for (let j = 0; j < 8; j++) AtA[i][j] += r[i] * r[j]; } };
  S.forEach((s, i) => { const d = D[i];
    addRow([s.x, s.y, 1, 0, 0, 0, -d.x * s.x, -d.x * s.y], d.x);
    addRow([0, 0, 0, s.x, s.y, 1, -d.y * s.x, -d.y * s.y], d.y); });
  const h = solve(AtA, Atb); if (!h) return null;
  const Hn = [[h[0], h[1], h[2]], [h[3], h[4], h[5]], [h[6], h[7], 1]];
  const H = mat3mul(mat3mul(inv3(Td), Hn), Ts);
  return H.map((r) => r.map((v) => v / H[2][2]));
}

// ---------- pose from the screen homography ----------
// K = [[f,0,cx],[0,f,cy],[0,0,1]]. Returns {f,cx,cy,R (rows = camera axes in screen coords? no: R maps screen->camera),t}
function poseForF(H, f, cx, cy) {
  const Ki = [[1 / f, 0, -cx / f], [0, 1 / f, -cy / f], [0, 0, 1]];
  const M = mat3mul(Ki, H), m1 = [M[0][0], M[1][0], M[2][0]], m2 = [M[0][1], M[1][1], M[2][1]], m3 = [M[0][2], M[1][2], M[2][2]];
  let lam = 2 / (norm3(m1) + norm3(m2)); if (m3[2] * lam < 0) lam = -lam; // screen in front of the camera
  const r1 = scale3(m1, lam), r2 = scale3(m2, lam), t = scale3(m3, lam);
  // closest orthonormal pair
  const a = unit3(add3(r1, r2)), b = unit3(add3(r1, scale3(r2, -1)));
  const q1 = scale3(add3(a, b), Math.SQRT1_2), q2 = scale3(add3(a, scale3(b, -1)), Math.SQRT1_2), q3 = cross(q1, q2);
  const R = [[q1[0], q2[0], q3[0]], [q1[1], q2[1], q3[1]], [q1[2], q2[2], q3[2]]]; // columns = screen axes in camera frame
  return { f, cx, cy, R, t };
}
export function project(pose, X) { // X in screen mm -> image px (null if behind)
  const { R, t, f, cx, cy } = pose;
  const c = [0, 1, 2].map((i) => R[i][0] * X[0] + R[i][1] * X[1] + R[i][2] * X[2] + t[i]);
  if (c[2] <= 1) return null;
  return { x: cx + f * c[0] / c[2], y: cy + f * c[1] / c[2] };
}
const rms = (pose, src, dst) => Math.sqrt(src.reduce((a, s, i) => { const p = project(pose, [s.x, s.y, 0]); return a + (p ? (p.x - dst[i].x) ** 2 + (p.y - dst[i].y) ** 2 : 1e6); }, 0) / src.length);

// src: screen points (mm), dst: image points (px). W,H image size. f is searched (weak prior around 0.78 W).
export function estimatePose(src, dst, W, Hh) {
  const Hm = homography(src, dst); if (!Hm) return null;
  const cx = W / 2, cy = Hh / 2, f0 = 0.78 * W;
  const cost = (f) => { const p = poseForF(Hm, f, cx, cy); return rms(p, src, dst) + 0.6 * ((f - f0) / f0) ** 2; };
  let lo = 0.45 * W, hi = 1.6 * W;
  for (let it = 0; it < 60; it++) { const m1 = lo + (hi - lo) * 0.382, m2 = lo + (hi - lo) * 0.618; if (cost(m1) < cost(m2)) hi = m2; else lo = m1; }
  const f = (lo + hi) / 2, pose = poseForF(Hm, f, cx, cy);
  pose.H = Hm; pose.rms = rms(pose, src, dst);
  // camera centre in screen coords: C = -R^T t
  const Rt = [0, 1, 2].map((j) => [0, 1, 2].map((i) => pose.R[i][j]));
  pose.C = Rt.map((r) => -(r[0] * pose.t[0] + r[1] * pose.t[1] + r[2] * pose.t[2]));
  return pose;
}

// ---------- the bending plane (x = x0 in screen coords) and its rectified image ----------
// rect: { s (px per mm), y0, y1, z1 } -> rectified image u = (y - y0) * s, v = (z1 - z) * s
export function makeRect(pose, x0, yPip, opt = {}) {
  const y0 = yPip - (opt.back ?? 70), y1 = yPip + (opt.front ?? 70), z0 = -(opt.below ?? 10), z1 = opt.above ?? 95;
  // scale: match the camera's own resolution around the PIP (clamped)
  const a = project(pose, [x0, yPip, 10]), b = project(pose, [x0, yPip + 10, 10]);
  const s = Math.max(3, Math.min(8, a && b ? Math.hypot(b.x - a.x, b.y - a.y) / 10 : 5));
  const W = Math.round((y1 - y0) * s), H = Math.round((z1 - z0) * s);
  const mapX = new Float32Array(W * H), mapY = new Float32Array(W * H);
  // homography (y, z, 1) -> image
  const { R, t, f, cx, cy } = pose;
  const col = (v) => [f * v[0] + cx * v[2], f * v[1] + cy * v[2], v[2]];
  const r2 = [R[0][1], R[1][1], R[2][1]], r3 = [R[0][2], R[1][2], R[2][2]], r1 = [R[0][0], R[1][0], R[2][0]];
  const c3 = add3(scale3(r1, x0), t);
  const A = col(r2), B = col(r3), C = col(c3);
  const Hf = [[A[0], B[0], C[0]], [A[1], B[1], C[1]], [A[2], B[2], C[2]]];
  for (let v = 0; v < H; v++) for (let u = 0; u < W; u++) {
    const p = applyH(Hf, y0 + u / s, z1 - v / s), k = v * W + u; mapX[k] = p.x; mapY[k] = p.y;
  }
  const toImage = (u, v) => applyH(Hf, y0 + u / s, z1 - v / s);
  return { s, y0, y1, z0, z1, W, H, mapX, mapY, Hf, toImage, x0, yPip,
    uPip: (yPip - y0) * s, vGlass: z1 * s };
}
// warp a region of the rectified image from the camera frame (ImageData). out: ImageData of size w x h.
export function warp(rect, frame, x0, y0, w, h, out) {
  const src = frame.data, FW = frame.width, FH = frame.height, d = out.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = (y + y0) * rect.W + (x + x0), o = (y * w + x) * 4;
    const sx = rect.mapX[k], sy = rect.mapY[k];
    const ix = Math.floor(sx), iy = Math.floor(sy);
    if (ix < 0 || iy < 0 || ix >= FW - 1 || iy >= FH - 1) { d[o] = d[o + 1] = d[o + 2] = 0; d[o + 3] = 255; continue; }
    const ax = sx - ix, ay = sy - iy, i = (iy * FW + ix) * 4, j = i + FW * 4;
    for (let c = 0; c < 3; c++) d[o + c] = (src[i + c] * (1 - ax) + src[i + 4 + c] * ax) * (1 - ay) + (src[j + c] * (1 - ax) + src[j + 4 + c] * ax) * ay;
    d[o + 3] = 255;
  }
  return out;
}

// ---------- calibration dots on the iPad ----------
export function dotLayout(Wmm, Hmm, pip) {
  // a 3 x 3 grid around the PIP ring (where the side camera is looking), kept on the screen
  const cx = (v, lim) => Math.max(-lim, Math.min(lim, v));
  const xs = [-60, -20, 25].map((d) => cx(pip.x + d, Wmm / 2 - 10)), ys = [-30, 15, 60].map((d) => cx(pip.y + d, Hmm / 2 - 10)), pts = [];
  for (const y of ys) for (const x of xs) pts.push({ x, y });
  return pts;
}
// centroid of the brightest change between two luma frames (Float32Array), or null
export function findDot(on, off, W, H) {
  let best = 0, bi = -1;
  for (let k = 0; k < on.length; k++) { const d = on[k] - off[k]; if (d > best) { best = d; bi = k; } }
  if (best < 25) return null;
  const thr = Math.max(18, best * 0.45), seen = new Uint8Array(on.length), stack = [bi];
  let sw = 0, sx = 0, sy = 0, n = 0; seen[bi] = 1;
  while (stack.length && n < 40000) {
    const k = stack.pop(), x = k % W, y = (k / W) | 0, wgt = on[k] - off[k] - thr * 0.5;
    sw += wgt; sx += wgt * x; sy += wgt * y; n++;
    for (const q of [k - 1, k + 1, k - W, k + W]) {
      if (q < 0 || q >= on.length || seen[q]) continue;
      const qx = q % W; if (Math.abs(qx - x) > 1) continue;
      seen[q] = 1; if (on[q] - off[q] > thr) stack.push(q);
    }
  }
  if (n < 4 || sw <= 0) return null;
  return { x: sx / sw, y: sy / sw, n, peak: best };
}
