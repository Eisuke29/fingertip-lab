// Silhouette + 2-link model fit. Pure functions (no DOM) so the same code runs in tests.
//
// Image geometry (side camera):
//   glass line  a -> b  (the screen surface seen edge-on)
//   g   = unit vector along the glass, pointing from PIP toward DIP
//   nrm = unit normal of the glass, pointing to the side where the finger is
//   PIP / DIP joint centres sit T/2 above the glass (T = middle-phalanx thickness in px)
//   theta_p : proximal phalanx, direction  -g*cos + nrm*sin   (0 = lying flat on the glass, 90 = upright)
//   theta_d : distal phalanx,   direction   g*cos + nrm*sin   (0 = straight, + = flexed toward the palm)

export const RATIO = { prox: 1.75, dist: 0.95 }; // segment length / middle length (anthropometric average)
export const SAMPLE = { prox: [0.3, 0.8], dist: [0.3, 0.8] }; // fraction of the segment used for fitting

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a, s) => ({ x: a.x * s, y: a.y * s });
const dot = (a, b) => a.x * b.x + a.y * b.y;
const len = (a) => Math.hypot(a.x, a.y);
const unit = (a) => { const l = len(a) || 1; return { x: a.x / l, y: a.y / l }; };
export const vec = { sub, add, mul, dot, len, unit };

// ---------- background model ----------
export class Background {
  constructor() { this.sum = null; this.n = 0; this.w = 0; this.h = 0; this.mean = null; this.luma = null; }
  reset() { this.sum = null; this.n = 0; this.mean = null; this.c2 = null; }
  add(img) {
    if (!this.sum || this.w !== img.width || this.h !== img.height) {
      this.w = img.width; this.h = img.height; this.sum = new Float32Array(img.width * img.height * 3); this.n = 0;
      this.c2 = new Float32Array(img.width * img.height * 4); // sums of rc, gc, rc^2, gc^2
    }
    const d = img.data, s = this.sum, c2 = this.c2;
    for (let i = 0, j = 0, k = 0; i < d.length; i += 4, j += 3, k += 4) {
      s[j] += d[i]; s[j + 1] += d[i + 1]; s[j + 2] += d[i + 2];
      const t = d[i] + d[i + 1] + d[i + 2] + 1, rc = d[i] / t, gc = d[i + 1] / t;
      c2[k] += rc; c2[k + 1] += gc; c2[k + 2] += rc * rc; c2[k + 3] += gc * gc;
    }
    this.n++;
  }
  finish() {
    const m = new Float32Array(this.sum.length), L = new Float32Array(this.w * this.h);
    for (let j = 0, k = 0; j < m.length; j += 3, k++) {
      m[j] = this.sum[j] / this.n; m[j + 1] = this.sum[j + 1] / this.n; m[j + 2] = this.sum[j + 2] / this.n;
      L[k] = 0.299 * m[j] + 0.587 * m[j + 1] + 0.114 * m[j + 2];
    }
    // colour ratio of the background and how much it flickers from frame to frame (floor: camera noise)
    const N = this.w * this.h, rc = new Float32Array(N), gc = new Float32Array(N), sd = new Float32Array(N), c2 = this.c2, n = this.n;
    for (let k = 0; k < N; k++) {
      const a = c2[4 * k] / n, b = c2[4 * k + 1] / n;
      rc[k] = a; gc[k] = b; sd[k] = Math.max(0.012, Math.sqrt(Math.max(0, c2[4 * k + 2] / n - a * a) + Math.max(0, c2[4 * k + 3] / n - b * b)));
    }
    this.mean = m; this.luma = L; this.sum = null; this.c2 = null; this.rc = rc; this.gc = gc; this.csd = sd;
  }
  get ready() { return !!this.mean; }
}

// Foreground probability over a rectangle. img = ImageData of exactly that rectangle (x0,y0,w,h in full-frame px).
export function foreground(img, rect, bg, opt = {}) {
  const t0 = opt.t0 ?? 22, t1 = opt.t1 ?? 55;
  const { x0, y0, w, h } = rect, out = new Float32Array(w * h), d = img.data, m = bg.mean, BW = bg.w;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, j = ((y + y0) * BW + (x + x0)) * 3;
      const r = d[i], g = d[i + 1], b = d[i + 2], R = m[j], G = m[j + 1], B = m[j + 2];
      const dr = r - R, dg = g - G, db = b - B;
      const dist = Math.sqrt(dr * dr + dg * dg + db * db);
      let p = (dist - t0) / (t1 - t0); p = p < 0 ? 0 : p > 1 ? 1 : p;
      if (p > 0) { // shadow: darker but same chromaticity -> not the finger
        const L = 0.299 * r + 0.587 * g + 0.114 * b, Lb = 0.299 * R + 0.587 * G + 0.114 * B;
        if (Lb > 30 && L < Lb * 0.92 && L > Lb * 0.35) {
          const s = r + g + b + 1, S = R + G + B + 1;
          if (Math.abs(r / s - R / S) + Math.abs(g / s - G / S) < 0.05) p = 0;
        }
      }
      out[y * w + x] = p;
    }
  }
  return { data: out, x0, y0, w, h };
}

// Finger probability from colour ratio, not brightness (Fable P1-4): shadows and light changes keep the colour
// ratio, the finger changes it. Nothing about skin is fixed in advance: the finger's own colour is learned
// each time at the joint step (learnSkin) and only then used as a second hint.
//  opt.screen : Uint8Array over the rectified image, 1 where the iPad screen is seen behind (stricter there)
//  opt.skin   : { rc, gc, s } learned colour of this person's finger
//  opt.gain   : overall brightness change since the background (from the corners)
// Very dark background pixels have no reliable colour: there the brightness difference is used instead.
export function foregroundC(img, rect, bg, opt = {}) {
  const { x0, y0, w, h } = rect, out = new Float32Array(w * h), d = img.data, BW = bg.w, gain = opt.gain || 1, sk = opt.skin, scr = opt.screen;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, k = (y + y0) * BW + (x + x0);
    const r = d[i], g = d[i + 1], b = d[i + 2], Lb = bg.luma[k] * gain, L = 0.299 * r + 0.587 * g + 0.114 * b;
    let p;
    if (Lb < 35 || L < 25) { // too dark for colour
      const dl = Math.abs(L - Lb); p = (dl - 25) / 30;
    } else {
      const t = r + g + b + 1, rc = r / t, gc = g / t;
      const z = Math.hypot(rc - bg.rc[k], gc - bg.gc[k]) / bg.csd[k], lo = scr && scr[k] ? 4.5 : 3;
      p = (z - lo) / lo;
      if (sk && p > 0) { const q = Math.hypot(rc - sk.rc, gc - sk.gc) / sk.s; p *= 0.35 + 0.65 * Math.exp(-0.5 * Math.max(0, q - 2) ** 2); }
    }
    out[y * w + x] = p < 0 ? 0 : p > 1 ? 1 : p;
  }
  return { data: out, x0, y0, w, h };
}
// overall brightness change: the four corners of the rectified image never contain the finger
export function cornerGain(img, bg) {
  const W = img.width, H = img.height, d = img.data, c = Math.max(4, Math.round(Math.min(W, H) * 0.06));
  let a = 0, b = 0;
  for (const [cx, cy] of [[0, 0], [W - c, 0], [0, H - c], [W - c, H - c]]) for (let y = cy; y < cy + c; y++) for (let x = cx; x < cx + c; x++) {
    const i = (y * W + x) * 4; a += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; b += bg.luma[y * W + x];
  }
  const g = b > 1 ? a / b : 1; return g < 0.5 ? 0.5 : g > 2 ? 2 : g;
}
// learn this person's finger colour from the pixels inside the fitted bars (called when the joints are confirmed)
export function learnSkin(img, model, thp, thd) {
  const W = img.width, d = img.data, pts = [];
  for (const [which, deg] of [['prox', thp], ['dist', thd]]) {
    const c = which === 'prox' ? model.pip : model.dip, L = which === 'prox' ? model.Lp : model.Ld, r = which === 'prox' ? model.rp : model.rd;
    const dir = segDir(model, which, deg), n = { x: -dir.y, y: dir.x };
    for (let s = 0.3 * L; s <= 0.8 * L; s += 2) for (let t = -0.4 * r; t <= 0.4 * r; t += 2) {
      const x = Math.round(c.x + dir.x * s + n.x * t), y = Math.round(c.y + dir.y * s + n.y * t);
      if (x < 0 || y < 0 || x >= W || y >= img.height) continue;
      const i = (y * W + x) * 4, tt = d[i] + d[i + 1] + d[i + 2] + 1; if (tt < 90) continue;
      pts.push([d[i] / tt, d[i + 1] / tt]);
    }
  }
  if (pts.length < 30) return null;
  const med = (k) => pts.map((p) => p[k]).sort((a, b) => a - b)[pts.length >> 1];
  const rc = med(0), gc = med(1), dev = pts.map((p) => Math.hypot(p[0] - rc, p[1] - gc)).sort((a, b) => a - b);
  return { rc, gc, s: Math.max(0.01, dev[Math.floor(dev.length * 0.68)]), n: pts.length };
}
// how far the finger colour is from the background colour, in units of the finger's own spread (small = hard)
export function skinVsBackground(skin, bg) {
  const N = bg.rc.length, z = [];
  for (let k = 0; k < N; k += 7) if (bg.luma[k] >= 35) z.push(Math.hypot(bg.rc[k] - skin.rc, bg.gc[k] - skin.gc) / skin.s);
  z.sort((a, b) => a - b); return z.length ? z[Math.floor(z.length * 0.1)] : 99; // the closest 10 % of the background
}

// bilinear sample of the probability field; returns -1 outside
export function sampleP(f, x, y) {
  const fx = x - f.x0, fy = y - f.y0;
  if (fx < 0 || fy < 0 || fx >= f.w - 1 || fy >= f.h - 1) return -1;
  const ix = fx | 0, iy = fy | 0, ax = fx - ix, ay = fy - iy, i = iy * f.w + ix, d = f.data;
  return (d[i] * (1 - ax) + d[i + 1] * ax) * (1 - ay) + (d[i + f.w] * (1 - ax) + d[i + f.w + 1] * ax) * ay;
}

// ---------- calibration geometry ----------
export function glassFrame(glass, sideSign = 1, pipToDip = null) {
  let g = unit(sub(glass.b, glass.a));
  if (pipToDip && dot(g, pipToDip) < 0) g = mul(g, -1);
  let nrm = { x: -g.y, y: g.x };
  if (sideSign < 0) nrm = mul(nrm, -1);
  return { g, nrm };
}
export const projectOnLine = (p, glass) => {
  const g = unit(sub(glass.b, glass.a)); const t = dot(sub(p, glass.a), g);
  return add(glass.a, mul(g, t));
};
// signed distance of p from the glass line toward nrm
export const heightAbove = (p, glass, nrm) => dot(sub(p, glass.a), nrm);

// Build the model from calibration: {glass, pipC, dipC (contact points on the glass), T, side}
export function buildModel(cal) {
  const { g, nrm } = glassFrame(cal.glass, cal.side, sub(cal.dipC, cal.pipC));
  const Lm = len(sub(cal.dipC, cal.pipC));
  const r = cal.T / 2;
  return {
    g, nrm, Lm, r, glass: cal.glass,
    pip: add(cal.pipC, mul(nrm, r)), dip: add(cal.dipC, mul(nrm, r)),
    Lp: Lm * RATIO.prox, Ld: Lm * RATIO.dist, rp: r * 1.05, rd: r * 0.9,
  };
}

// Rectangle (full-frame px) that the tracker needs each frame.
export function roiFor(model, W, H) {
  const pts = [];
  const R1 = model.Lp * 0.9 + model.rp * 2, R2 = model.Ld * 0.9 + model.rd * 2;
  for (const [c, R] of [[model.pip, R1], [model.dip, R2]]) pts.push({ x: c.x - R, y: c.y - R }, { x: c.x + R, y: c.y + R });
  let x0 = Math.min(...pts.map(p => p.x)), y0 = Math.min(...pts.map(p => p.y));
  let x1 = Math.max(...pts.map(p => p.x)), y1 = Math.max(...pts.map(p => p.y));
  x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0));
  x1 = Math.min(W, Math.ceil(x1)); y1 = Math.min(H, Math.ceil(y1));
  return { x0, y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
}

// ---------- fitting ----------
const rad = (d) => d * Math.PI / 180;
export function segDir(model, which, deg) {
  const c = Math.cos(rad(deg)), s = Math.sin(rad(deg));
  return which === 'prox'
    ? { x: -model.g.x * c + model.nrm.x * s, y: -model.g.y * c + model.nrm.y * s }
    : { x: model.g.x * c + model.nrm.x * s, y: model.g.y * c + model.nrm.y * s };
}

// how well a bar of radius r along direction dir fits the silhouette (0..1)
export function barScore(f, model, which, deg) {
  const c = which === 'prox' ? model.pip : model.dip;
  const L = which === 'prox' ? model.Lp : model.Ld, r = which === 'prox' ? model.rp : model.rd;
  const [f0, f1] = SAMPLE[which];
  const d = segDir(model, which, deg), n = { x: -d.y, y: d.x };
  const step = Math.max(1.5, r / 12);
  let inS = 0, inN = 0, outS = 0, outN = 0;
  for (let s = f0 * L; s <= f1 * L; s += step) {
    const bx = c.x + d.x * s, by = c.y + d.y * s;
    for (let t = -0.6 * r; t <= 0.6 * r; t += step) {
      const x = bx + n.x * t, y = by + n.y * t;
      if (heightAbove({ x, y }, model.glass, model.nrm) < 2) continue; // below the glass: reflections
      const p = sampleP(f, x, y); if (p < 0) continue; inS += p; inN++;
    }
    for (const sg of [-1, 1]) for (let t = 1.25 * r; t <= 1.9 * r; t += step) {
      const x = bx + n.x * t * sg, y = by + n.y * t * sg;
      if (heightAbove({ x, y }, model.glass, model.nrm) < 2) continue;
      const p = sampleP(f, x, y); if (p < 0) continue; outS += 1 - p; outN++;
    }
  }
  if (inN < 8) return 0;
  const inside = inS / inN, outside = outN ? outS / outN : 0.5;
  return 0.6 * inside + 0.4 * outside;
}

export const RANGE = { prox: [5, 170], dist: [-25, 115] };

// Edge refinement: for each sample along the bar, find both silhouette edges (p = 0.5 crossings, sub-pixel),
// take their midpoint as an axis point, then fit the axis direction through the fixed joint centre.
export function refineEdges(f, model, which, deg) {
  const c = which === 'prox' ? model.pip : model.dip;
  const L = which === 'prox' ? model.Lp : model.Ld, r = which === 'prox' ? model.rp : model.rd;
  const [f0, f1] = SAMPLE[which];
  let cur = deg, used = 0;
  for (let it = 0; it < 3; it++) {
    const d = segDir(model, which, cur), n = { x: -d.y, y: d.x };
    let sx = 0, sy = 0; used = 0;
    for (let s = f0 * L; s <= f1 * L; s += 2) {
      const bx = c.x + d.x * s, by = c.y + d.y * s, edge = [];
      for (const sg of [-1, 1]) {
        let prev = null, found = null;
        for (let t = 0.2 * r; t <= 1.8 * r; t += 0.5) {
          const x = bx + n.x * t * sg, y = by + n.y * t * sg;
          if (heightAbove({ x, y }, model.glass, model.nrm) < 2) break;
          const p = sampleP(f, x, y); if (p < 0) break;
          if (prev && prev.p >= 0.5 && p < 0.5) { const k = (prev.p - 0.5) / (prev.p - p); found = prev.t + (t - prev.t) * k; break; }
          prev = { t, p };
        }
        edge.push(found);
      }
      if (edge[0] == null || edge[1] == null) continue;
      const w = edge[0] + edge[1];
      if (Math.abs(w - 2 * r) > 0.4 * 2 * r) continue; // something else touches the finger here
      const off = (edge[1] - edge[0]) / 2; // lateral offset of the true axis toward +n
      const qx = bx + n.x * off - c.x, qy = by + n.y * off - c.y;
      sx += qx * s; sy += qy * s; used++; // weight far points more
    }
    if (used < 6) return { deg: cur, used };
    const dir = unit({ x: sx, y: sy });
    // convert direction back to the angle convention
    const along = which === 'prox' ? -dot(dir, model.g) : dot(dir, model.g);
    const up = dot(dir, model.nrm);
    cur = Math.atan2(up, along) * 180 / Math.PI;
  }
  return { deg: cur, used };
}

export function fitSegment(f, model, which, prev = null) {
  const [lo, hi] = RANGE[which];
  let a = lo, b = hi, stepC = 2;
  if (prev != null) { a = Math.max(lo, prev - 24); b = Math.min(hi, prev + 24); stepC = 1; }
  const sc = [];
  let best = -1;
  for (let t = a; t <= b + 1e-9; t += stepC) { const s = barScore(f, model, which, t); sc.push({ t, s }); if (s > best) best = s; }
  // centre of the plateau of near-best scores (the band score is flat over a few degrees)
  let bi = sc.findIndex(e => e.s === best), i0 = bi, i1 = bi;
  while (i0 > 0 && sc[i0 - 1].s >= best - 0.01) i0--;
  while (i1 < sc.length - 1 && sc[i1 + 1].s >= best - 0.01) i1++;
  const coarse = (sc[i0].t + sc[i1].t) / 2;
  const ref = refineEdges(f, model, which, coarse);
  const deg = Math.abs(ref.deg - coarse) < 8 ? ref.deg : coarse;
  return { deg, score: best, edges: ref.used };
}

export function track(f, model, prev = {}) {
  const p = fitSegment(f, model, 'prox', prev.okP ? prev.thp : null);
  const d = fitSegment(f, model, 'dist', prev.okD ? prev.thd : null);
  return { thp: p.deg, thd: d.deg, scoreP: p.score, scoreD: d.score };
}
export const SCORE_OK = 0.72;

// The underside can have low contrast against the screen, so only the top edge is used.
export function measureThickness(f, glass, pipC, dipC, side, Texp = 0) {
  const { nrm } = glassFrame(glass, side, sub(dipC, pipC));
  const kmax = Texp ? 2.2 * Texp : 400, hs = [];
  for (const q of [0.35, 0.5, 0.65]) {
    const base = add(pipC, mul(sub(dipC, pipC), q)); let top = 0, inside = 0, out = 0;
    for (let k = 1; k < kmax; k++) {
      const p = sampleP(f, base.x + nrm.x * k, base.y + nrm.y * k); if (p < 0) break;
      if (p > 0.5) { inside++; out = 0; top = k; } else if (p < 0.3) { out++; if (inside > 6 && out > 8) break; }
    }
    if (inside > 6) hs.push(top);
  }
  if (!hs.length) return 0;
  hs.sort((a, b) => a - b); return hs[(hs.length / 2) | 0];
}

// ---------- One Euro filter ----------
export class OneEuro {
  constructor(minCutoff = 1.2, beta = 0.03, dCutoff = 1.0) { Object.assign(this, { minCutoff, beta, dCutoff }); this.x = null; this.dx = 0; this.t = null; }
  reset() { this.x = null; this.t = null; this.dx = 0; }
  static alpha(cut, dt) { const tau = 1 / (2 * Math.PI * cut); return 1 / (1 + tau / dt); }
  filter(v, t) {
    if (this.x == null) { this.x = v; this.t = t; return v; }
    const dt = Math.max(1e-3, (t - this.t) / 1000); this.t = t;
    const dv = (v - this.x) / dt; this.dx += OneEuro.alpha(this.dCutoff, dt) * (dv - this.dx);
    const cut = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += OneEuro.alpha(cut, dt) * (v - this.x); return this.x;
  }
}

// virtual finger in the image (for the overlay): point-symmetric through PIP
export function virtualInImage(model, thp, thd, LmVirt = model.Lm, LdVirt = model.Ld) {
  const c = Math.cos(rad(thp)), s = Math.sin(rad(thp));
  const u = { x: model.g.x * c - model.nrm.x * s, y: model.g.y * c - model.nrm.y * s };
  const e = rad(thp - thd), dd = { x: model.g.x * Math.cos(e) - model.nrm.x * Math.sin(e), y: model.g.y * Math.cos(e) - model.nrm.y * Math.sin(e) };
  const vdip = add(model.pip, mul(u, LmVirt));
  return { pip: model.pip, vdip, vtip: add(vdip, mul(dd, LdVirt)) };
}

// Free (un-pivoted) axis of a segment from its silhouette edges: returns {p, d} (a point and unit direction) or null.
export function freeAxis(f, model, which, deg) {
  const c = which === 'prox' ? model.pip : model.dip;
  const L = which === 'prox' ? model.Lp : model.Ld, r = which === 'prox' ? model.rp : model.rd;
  // near the joint the distal's inner edge merges with the middle phalanx when strongly bent: start further out
  const [f0, f1] = which === 'prox' ? SAMPLE.prox : [0.15 + 0.25 * Math.min(1, Math.max(0, deg / 60)), 0.85];
  const d = segDir(model, which, deg), n = { x: -d.y, y: d.x }, cand = [];
  for (let s = f0 * L; s <= f1 * L; s += 2) {
    const bx = c.x + d.x * s, by = c.y + d.y * s, edge = [];
    for (const sg of [-1, 1]) {
      let prev = null, found = null;
      for (let t = 0.2 * r; t <= 1.8 * r; t += 0.5) {
        const x = bx + n.x * t * sg, y = by + n.y * t * sg;
        if (heightAbove({ x, y }, model.glass, model.nrm) < 2) break;
        const p = sampleP(f, x, y); if (p < 0) break;
        if (prev && prev.p >= 0.5 && p < 0.5) { found = prev.t + (t - prev.t) * (prev.p - 0.5) / (prev.p - p); break; }
        prev = { t, p };
      }
      edge.push(found);
    }
    if (edge[0] == null || edge[1] == null || Math.abs(edge[0] + edge[1] - 2 * r) > 0.8 * r) continue;
    const off = (edge[1] - edge[0]) / 2; cand.push({ x: bx + n.x * off, y: by + n.y * off, w: edge[0] + edge[1] });
  }
  // near the joint the silhouette merges with the neighbouring phalanx: keep only samples with the typical width
  const ws = cand.map((c) => c.w).sort((a, b) => a - b), med = ws[ws.length >> 1];
  const pts = cand.filter((c) => Math.abs(c.w - med) < 0.1 * med);
  if (pts.length < 8) return null;
  const m = pts.reduce((a, p) => ({ x: a.x + p.x / pts.length, y: a.y + p.y / pts.length }), { x: 0, y: 0 });
  let sxx = 0, sxy = 0, syy = 0;
  for (const p of pts) { const dx = p.x - m.x, dy = p.y - m.y; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; }
  const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  let dir = { x: Math.cos(th), y: Math.sin(th) }; if (dot(dir, d) < 0) dir = mul(dir, -1);
  return { p: m, d: dir };
}

// Joint centre = where the proximal (or distal) axis meets the middle-phalanx axis (height T/2 above the glass).
// Moves the contact points along the glass; needs the finger with PIP and DIP clearly bent.
export function refineJoints(f, cal) {
  let out = { ...cal };
  for (let it = 0; it < 5; it++) {
    const model = buildModel(out);
    for (const which of ['prox', 'dist']) {
      if (which === 'dist') { // only when the distal is clearly flexed
        const fd = fitSegment(f, model, 'dist');
        if (fd.deg < 10) continue;
      }
      const fit = fitSegment(f, model, which);
      const ax = freeAxis(f, model, which, fit.deg); if (!ax) continue;
      // intersect ax with the middle axis: point model.pip, direction g
      const m0 = model.pip, g = model.g;
      const den = ax.d.x * g.y - ax.d.y * g.x; if (Math.abs(den) < 0.15) continue;
      const w = sub(m0, ax.p);
      const tAx = (w.x * g.y - w.y * g.x) / den;
      const hit = add(ax.p, mul(ax.d, tAx));
      const contact = projectOnLine(hit, out.glass);
      if (which === 'prox') out.pipC = contact; else out.dipC = contact;
    }
  }
  return out;
}
