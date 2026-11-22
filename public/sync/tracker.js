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
  reset() { this.sum = null; this.n = 0; this.mean = null; }
  add(img) {
    if (!this.sum || this.w !== img.width || this.h !== img.height) {
      this.w = img.width; this.h = img.height; this.sum = new Float32Array(img.width * img.height * 3); this.n = 0;
    }
    const d = img.data, s = this.sum;
    for (let i = 0, j = 0; i < d.length; i += 4, j += 3) { s[j] += d[i]; s[j + 1] += d[i + 1]; s[j + 2] += d[i + 2]; }
    this.n++;
  }
  finish() {
    const m = new Float32Array(this.sum.length), L = new Float32Array(this.w * this.h);
    for (let j = 0, k = 0; j < m.length; j += 3, k++) {
      m[j] = this.sum[j] / this.n; m[j + 1] = this.sum[j + 1] / this.n; m[j + 2] = this.sum[j + 2] / this.n;
      L[k] = 0.299 * m[j] + 0.587 * m[j + 1] + 0.114 * m[j + 2];
    }
    this.mean = m; this.luma = L; this.sum = null;
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

// ---------- auto proposal of PIP / DIP contact points ----------
// The middle phalanx lies on the glass, so the strip of silhouette just above the glass line spans PIP..DIP
// (the rounded joints lift off within ~0.7 r beyond each joint centre). Hand side = end with more silhouette beyond it.
// Returns {pipC, dipC, T, side} or null. Only a starting point: refineJoints() corrects it.
export function proposeJoints(f, glass) {
  const g = unit(sub(glass.b, glass.a)), L = len(sub(glass.b, glass.a));
  const tryside = (side) => {
    let nrm = { x: -g.y, y: g.x }; if (side < 0) nrm = mul(nrm, -1);
    const at = (s, h) => sampleP(f, glass.a.x + g.x * s + nrm.x * h, glass.a.y + g.y * s + nrm.y * h);
    const col = (s, hmax = 600) => { let h = 0, started = false;
      for (let k = 1; k < hmax; k++) { const p = at(s, k); if (p < 0) break;
        if (p > 0.5) { if (!started && k > 12) break; started = true; h = k; } else if (started && k > h + 3) break; }
      return h; };
    const runAt = (h, around = null) => {
      let best = null, cur = null;
      for (let s = 0; s <= L; s += 1) {
        if (at(s, h) > 0.5) { if (!cur) cur = { s0: s, s1: s }; else cur.s1 = s; }
        else if (cur) { if (around == null ? (!best || cur.s1 - cur.s0 > best.s1 - best.s0) : (cur.s0 <= around && cur.s1 >= around)) best = cur; cur = null; }
      }
      if (cur && (around == null ? (!best || cur.s1 - cur.s0 > best.s1 - best.s0) : (cur.s0 <= around && cur.s1 >= around))) best = cur;
      return best;
    };
    const r0 = runAt(4); if (!r0 || r0.s1 - r0.s0 < 20) return null;
    const hs = []; for (let s = r0.s0; s <= r0.s1; s += 2) hs.push(col(s));
    hs.sort((x, y) => x - y);
    const T = hs[Math.floor(hs.length * 0.2)]; if (T < 8) return null;
    const r = T / 2, mid = (r0.s0 + r0.s1) / 2;
    const r1 = runAt(Math.max(3, 0.3 * T), mid) || r0;
    const mass = (e, dir) => { let m = 0; for (let k = 2; k <= 1.5 * T; k += 2) m += col(e + dir * k, 4 * T); return m; };
    const handAtStart = mass(r1.s0, -1) >= mass(r1.s1, 1);
    const inset = 0.4 * r;
    // the strip can run past the DIP when the distal is only slightly bent: cap the middle length at ~1.7 T
    const Lm = Math.min(r1.s1 - r1.s0 - 2 * inset, 1.7 * T);
    const pS = handAtStart ? r1.s0 + inset : r1.s1 - inset, dS = handAtStart ? pS + Lm : pS - Lm;
    let area = 0; for (let s = r1.s0; s <= r1.s1; s += 2) area += col(s, 4 * T);
    return { pipC: add(glass.a, mul(g, pS)), dipC: add(glass.a, mul(g, dS)), T, side, area };
  };
  const A = tryside(1), B = tryside(-1);
  if (!A) return B; if (!B) return A;
  return A.area >= B.area ? A : B;
}

// Middle-phalanx thickness measured at the midpoint between the contact points
export function measureThickness(f, glass, pipC, dipC, side) {
  const { nrm } = glassFrame(glass, side, sub(dipC, pipC));
  const hs = [];
  for (const q of [0.35, 0.5, 0.65]) {
    const base = add(pipC, mul(sub(dipC, pipC), q)); let h = 0, started = false;
    for (let k = 1; k < 400; k++) {
      const p = sampleP(f, base.x + nrm.x * k, base.y + nrm.y * k); if (p < 0) break;
      if (p > 0.5) { if (!started && k > 12) break; started = true; h = k; } else if (started && k > h + 3) break;
    }
    if (h) hs.push(h);
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
  const [f0, f1] = which === 'prox' ? SAMPLE.prox : [0.1 + 0.25 * Math.min(1, Math.max(0, deg / 60)), 0.7];
  const d = segDir(model, which, deg), n = { x: -d.y, y: d.x }, pts = [];
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
    const off = (edge[1] - edge[0]) / 2; pts.push({ x: bx + n.x * off, y: by + n.y * off });
  }
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

// ---------- automatic glass-line detection ----------
// The lens sits in the glass plane, so the glass appears as a straight edge passing near the image centre.
// Coarse Hough transform on a 1/4 image, then sub-pixel refinement on the full image.
export function lumaOf(img) {
  const { width: W, height: H, data: d } = img, L = new Float32Array(W * H);
  for (let i = 0, k = 0; k < L.length; i += 4, k++) L[k] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  return { L, W, H };
}
export function detectGlass(img, opt = {}) {
  const full = lumaOf(img), S = 4, w = Math.floor(full.W / S), h = Math.floor(full.H / S);
  const s = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let a = 0; for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) a += full.L[(y * S + j) * full.W + x * S + i];
    s[y * w + x] = a / (S * S);
  }
  const mags = [], gxA = new Float32Array(w * h), gyA = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const k = y * w + x;
    const gx = s[k - w + 1] + 2 * s[k + 1] + s[k + w + 1] - s[k - w - 1] - 2 * s[k - 1] - s[k + w - 1];
    const gy = s[k + w - 1] + 2 * s[k + w] + s[k + w + 1] - s[k - w - 1] - 2 * s[k - w] - s[k - w + 1];
    gxA[k] = gx; gyA[k] = gy; mags.push(Math.hypot(gx, gy));
  }
  const sorted = mags.slice().sort((a, b) => a - b), thr = Math.max(40, sorted[Math.floor(sorted.length * 0.9)]);
  // accumulator: theta = normal angle 30..150 deg (line within +-60 deg of horizontal), rho in px
  const T0 = 30, T1 = 150, R = Math.ceil(Math.hypot(w, h)), acc = new Float32Array((T1 - T0 + 1) * (2 * R + 1));
  const cosT = [], sinT = []; for (let t = T0; t <= T1; t++) { cosT.push(Math.cos(t * Math.PI / 180)); sinT.push(Math.sin(t * Math.PI / 180)); }
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const k = y * w + x, gx = gxA[k], gy = gyA[k], m = Math.hypot(gx, gy); if (m < thr) continue;
    let th = Math.atan2(gy, gx) * 180 / Math.PI; if (th < 0) th += 180;
    for (let t = Math.round(th) - 2; t <= Math.round(th) + 2; t++) {
      if (t < T0 || t > T1) continue; const ti = t - T0;
      const rho = Math.round(x * cosT[ti] + y * sinT[ti]); acc[ti * (2 * R + 1) + rho + R] += m;
    }
  }
  // peaks with non-maximum suppression
  const peaks = [];
  for (let n = 0; n < 8; n++) {
    let best = 0, bi = -1; for (let i = 0; i < acc.length; i++) if (acc[i] > best) { best = acc[i]; bi = i; }
    if (bi < 0 || best <= 0) break;
    const ti = Math.floor(bi / (2 * R + 1)), rho = bi % (2 * R + 1) - R;
    peaks.push({ t: ti + T0, rho, v: best });
    for (let a = -4; a <= 4; a++) for (let b = -6; b <= 6; b++) { const t2 = ti + a, r2 = rho + b + R; if (t2 >= 0 && t2 <= T1 - T0 && r2 >= 0 && r2 <= 2 * R) acc[t2 * (2 * R + 1) + r2] = 0; }
  }
  if (!peaks.length) return null;
  const cx = w / 2, cy = h / 2, vmax = peaks[0].v;
  const cands = peaks.filter(p => p.v > 0.35 * vmax).map(p => {
    const c = Math.cos(p.t * Math.PI / 180), sn = Math.sin(p.t * Math.PI / 180);
    const dist = (cx * c + cy * sn - p.rho); // signed distance of the image centre from the line (1/4 px)
    return { ...p, c, sn, dist, score: p.v / vmax - Math.abs(dist) / (0.25 * h) };
  }).sort((a, b) => b.score - a.score);
  const best = cands[0];
  // line in full-res px: x*c + y*s = rho*S ; build two endpoints across the image
  const c = best.c, sn = best.sn, rho = best.rho * S + (S - 1) / 2 * (c + sn);
  const dir = { x: -sn, y: c }, p0 = { x: c * rho, y: sn * rho };
  const ext = Math.hypot(full.W, full.H);
  let a = add(p0, mul(dir, -ext)), b = add(p0, mul(dir, ext));
  const clipped = clipLine(a, b, full.W, full.H); if (!clipped) return null;
  const refined = refineLine(full, clipped) || clipped;
  // signed offset of the image centre from the line, in px (+ = line below the centre in the image)
  const A = refined.a, B = refined.b, yAt = Math.abs(B.x - A.x) > 1e-6 ? A.y + (full.W / 2 - A.x) * (B.y - A.y) / (B.x - A.x) : full.H / 2;
  return { a: A, b: B, below: yAt - full.H / 2, candidates: cands.length };
}
function clipLine(a, b, W, H) {
  const pts = [], d = sub(b, a);
  const tryT = (t) => { if (t >= 0 && t <= 1) { const p = add(a, mul(d, t)); if (p.x >= -0.5 && p.x <= W + 0.5 && p.y >= -0.5 && p.y <= H + 0.5) pts.push(p); } };
  if (d.x) { tryT((0 - a.x) / d.x); tryT((W - 1 - a.x) / d.x); }
  if (d.y) { tryT((0 - a.y) / d.y); tryT((H - 1 - a.y) / d.y); }
  if (pts.length < 2) return null;
  pts.sort((p, q) => p.x - q.x || p.y - q.y);
  const inset = (p, q) => add(p, mul(unit(sub(q, p)), 8));
  return { a: inset(pts[0], pts[pts.length - 1]), b: inset(pts[pts.length - 1], pts[0]) };
}
// sub-pixel: along the coarse line, find the strongest luminance step across it, then least-squares fit
function refineLine(full, line) {
  const { L, W, H } = full, g = unit(sub(line.b, line.a)), n = { x: -g.y, y: g.x }, len0 = len(sub(line.b, line.a));
  const at = (x, y) => { const ix = Math.floor(x), iy = Math.floor(y); if (ix < 0 || iy < 0 || ix >= W - 1 || iy >= H - 1) return null;
    const ax = x - ix, ay = y - iy, k = iy * W + ix; return (L[k] * (1 - ax) + L[k + 1] * ax) * (1 - ay) + (L[k + W] * (1 - ax) + L[k + W + 1] * ax) * ay; };
  let pts = [];
  for (let s = 0; s <= len0; s += 3) {
    const base = add(line.a, mul(g, s)), prof = [];
    for (let t = -8; t <= 8; t += 0.5) { const v = at(base.x + n.x * t, base.y + n.y * t); if (v == null) { prof.length = 0; break; } prof.push(v); }
    if (prof.length < 5) continue;
    let bi = -1, bv = 0; for (let i = 1; i < prof.length - 1; i++) { const d = Math.abs(prof[i + 1] - prof[i - 1]); if (d > bv) { bv = d; bi = i; } }
    if (bi < 2 || bi > prof.length - 3 || bv < 12) continue;
    const dm = Math.abs(prof[bi] - prof[bi - 2]), dp = Math.abs(prof[bi + 2] - prof[bi]);
    const den = dm - 2 * bv + dp, off = den < 0 ? 0.5 * (dm - dp) / den : 0;
    const t = -8 + (bi + Math.max(-1, Math.min(1, off))) * 0.5;
    pts.push(add(base, mul(n, t)));
  }
  if (pts.length < 10) return null;
  const fit = (P) => { const m = P.reduce((a, p) => ({ x: a.x + p.x / P.length, y: a.y + p.y / P.length }), { x: 0, y: 0 });
    let sxx = 0, sxy = 0, syy = 0; for (const p of P) { const dx = p.x - m.x, dy = p.y - m.y; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; }
    const th = 0.5 * Math.atan2(2 * sxy, sxx - syy); return { m, d: { x: Math.cos(th), y: Math.sin(th) } }; };
  let F = fit(pts);
  for (let it = 0; it < 2; it++) {
    const nn = { x: -F.d.y, y: F.d.x };
    const keep = pts.filter(p => Math.abs(dot(sub(p, F.m), nn)) < 1.5); if (keep.length < 10) break; pts = keep; F = fit(pts);
  }
  let d = F.d; if (dot(d, g) < 0) d = mul(d, -1);
  const ta = dot(sub(line.a, F.m), d), tb = dot(sub(line.b, F.m), d);
  return { a: add(F.m, mul(d, ta)), b: add(F.m, mul(d, tb)), support: pts.length };
}
