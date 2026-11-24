// Learning DIP and PIP from the touch contacts, in the browser, from one person's calibration. Pure functions, no DOM.
// A browser gives no capacitance image: only, per contact, a position, radii, an angle and a force.
export const OUT = ['dip', 'pip'], NAMES = ['n', 'size', 'len', 'rx', 'ry', 'cx', 'cy', 'force', 'dsize', 'dlen', 'dcx', 'dcy'];
const FLOOR = [0.3, 0.2, 0.2, 0.2, 0.2, 0.5, 0.5, 0.05, 0.2, 0.2, 0.2, 0.2]; // changes smaller than this are not blown up (mm)

// list: contacts {x, y, rx, ry, a, f} in mm
export function features(list) {
  if (!list?.length) return null;
  let A = 0, X = 0, Y = 0, F = 0, len = 0, big = list[0];
  for (const t of list) {
    const a = Math.PI * Math.max(t.rx, 0.1) * Math.max(t.ry, 0.1);
    A += a; X += a * t.x; Y += a * t.y; F += t.f || 0; if (t.rx * t.ry > big.rx * big.ry) big = t;
  }
  for (const p of list) for (const q of list) len = Math.max(len, Math.hypot(p.x - q.x, p.y - q.y) + Math.max(p.rx, p.ry) + Math.max(q.rx, q.ry));
  return [list.length, Math.sqrt(A), len, big.rx, big.ry, X / A, Y / A, F];
}
// add the change since a moment ago (about 0.2 s)
export const withMotion = (f, old) => [...f, ...[1, 2, 5, 6].map((i) => (old ? f[i] - old[i] : 0))];

function scaler(rows) {
  const n = rows[0].x.length, m = Array(n).fill(0), s = Array(n).fill(0);
  for (const r of rows) for (let i = 0; i < n; i++) m[i] += r.x[i] / rows.length;
  for (const r of rows) for (let i = 0; i < n; i++) s[i] += (r.x[i] - m[i]) ** 2 / rows.length;
  const sd = s.map((v, i) => Math.max(Math.sqrt(v), FLOOR[i]));
  return (x) => x.map((v, i) => Math.max(-4, Math.min(4, (v - m[i]) / sd[i])));
}
const targets = (rows) => OUT.map((k) => {
  const m = rows.reduce((s, r) => s + r[k], 0) / rows.length;
  return { k, m, s: Math.max(1, Math.sqrt(rows.reduce((s, r) => s + (r[k] - m) ** 2, 0) / rows.length)) };
});

function solve(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const k = M[r][c] / M[c][c]; for (let j = c; j <= n; j++) M[r][j] -= k * M[c][j]; }
  }
  return M.map((r, i) => r[n] / r[i]);
}
// straight-line model: what the neural network has to beat
export function fitLinear(rows) {
  const Z = scaler(rows), T = targets(rows), X = rows.map((r) => Z(r.x)), n = X[0].length, lam = 0.02 * rows.length;
  const A = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => X.reduce((s, x) => s + x[i] * x[j], 0) + (i === j ? lam : 0)));
  const W = T.map((t) => solve(A, Array.from({ length: n }, (_, i) => X.reduce((s, x, r) => s + x[i] * (rows[r][t.k] - t.m) / t.s, 0))));
  return (x) => { const z = Z(x); return T.map((t, o) => t.m + t.s * z.reduce((s, v, i) => s + v * W[o][i], 0)); };
}
export function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
// small neural network (12 -> 16 -> 8 -> 2), Adam, a little noise on the inputs against overfitting
export async function fitNet(rows, { epochs = 60, tick = null, seed = 1 } = {}) {
  const rnd = mulberry(seed), gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  const Z = scaler(rows), T = targets(rows), X = rows.map((r) => Z(r.x)), Y = rows.map((r) => T.map((t) => (r[t.k] - t.m) / t.s));
  const size = [X[0].length, 16, 8, T.length], L = [];
  for (let l = 0; l < 3; l++) {
    const a = size[l], b = size[l + 1], N = (a + 1) * b, w = new Float64Array(N);
    for (let i = 0; i < N; i++) w[i] = gauss() * Math.sqrt(1 / a) * (l === 2 ? 0.3 : 1);
    L.push({ a, b, w, g: new Float64Array(N), m: new Float64Array(N), v: new Float64Array(N) });
  }
  const forward = (x) => {
    const acts = [x];
    L.forEach(({ a, b, w }, l) => {
      const inp = acts[l], o = new Array(b);
      for (let j = 0; j < b; j++) { let s = w[j * (a + 1) + a]; for (let i = 0; i < a; i++) s += w[j * (a + 1) + i] * inp[i]; o[j] = l < 2 ? Math.tanh(s) : s; }
      acts.push(o);
    });
    return acts;
  };
  const idx = X.map((_, i) => i), B = 32; let step = 0;
  for (let e = 0; e < epochs; e++) {
    for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    const lr = 0.005 * (1 - 0.9 * e / epochs);
    for (let s = 0; s < idx.length; s += B) {
      const part = idx.slice(s, s + B); for (const l of L) l.g.fill(0);
      for (const q of part) {
        const acts = forward(X[q].map((v) => v + 0.1 * gauss())); let d = acts[3].map((v, o) => v - Y[q][o]);
        for (let l = 2; l >= 0; l--) {
          const { a, b, w, g } = L[l], inp = acts[l], back = new Array(a).fill(0);
          for (let j = 0; j < b; j++) { const k = j * (a + 1); for (let i = 0; i < a; i++) { g[k + i] += d[j] * inp[i]; back[i] += d[j] * w[k + i]; } g[k + a] += d[j]; }
          d = l ? back.map((v, i) => v * (1 - inp[i] * inp[i])) : back;
        }
      }
      step++; const c1 = 1 - 0.9 ** step, c2 = 1 - 0.999 ** step;
      for (const { w, g, m, v } of L) for (let i = 0; i < w.length; i++) {
        const gr = g[i] / part.length + 1e-3 * w[i];
        m[i] = 0.9 * m[i] + 0.1 * gr; v[i] = 0.999 * v[i] + 0.001 * gr * gr; w[i] -= lr * (m[i] / c1) / (Math.sqrt(v[i] / c2) + 1e-8);
      }
    }
    if (tick && e % 4 === 3) await tick();
  }
  return (x) => { const o = forward(Z(x))[3]; return T.map((t, i) => t.m + t.s * o[i]); };
}

// rows at a given reaction delay: the person follows the picture a little late
export const label = (samples, traj, lag) => samples.map((s) => ({ ...s, ...traj(s.round, s.seg, Math.max(0, s.t - lag)) }));
function score(pairs, k) { // error, error without touch (the mean of the other rounds), correlation
  const n = pairs.length, mean = (f) => pairs.reduce((s, q) => s + f(q), 0) / n;
  const my = mean((q) => q.y[k]), mp = mean((q) => q.p[k]);
  const cov = mean((q) => (q.y[k] - my) * (q.p[k] - mp)), sy = Math.sqrt(mean((q) => (q.y[k] - my) ** 2)), sp = Math.sqrt(mean((q) => (q.p[k] - mp) ** 2));
  return { err: mean((q) => Math.abs(q.p[k] - q.y[k])), base: mean((q) => Math.abs(q.b[k] - q.y[k])), r: sy * sp > 1e-9 ? cov / (sy * sp) : 0 };
}
// every round (finger lifted and put back) is predicted by a model that has never seen it
async function heldOut(rows, fit) {
  const pairs = [];
  for (const R of [...new Set(rows.map((r) => r.round))]) {
    const tr = rows.filter((r) => r.round !== R), te = rows.filter((r) => r.round === R), f = await fit(tr), T = targets(tr);
    for (const r of te) pairs.push({ seg: r.seg, y: OUT.map((k) => r[k]), p: f(r.x), b: T.map((t) => t.m) });
  }
  return { pairs, s: OUT.map((_, k) => score(pairs, k)) };
}
const rel = (h) => h.s.reduce((a, s) => a + s.err / s.base, 0);
// Is there anything to read? An input that is worse than, or as good as, the mean says no.
export const verdictOf = (s) => (s.r > 0.8 && s.err < 0.55 * s.base ? 'yes' : s.r > 0.5 && s.err < 0.85 * s.base ? 'some' : 'no');
// samples: [{round, seg, t (s in the segment), x}]   traj(round, seg, t) -> {dip, pip}
export async function train(samples, traj, { tick = null, epochs = 60 } = {}) {
  const rounds = [...new Set(samples.map((s) => s.round))].filter((R) => samples.filter((s) => s.round === R).length >= 100);
  const use = samples.filter((s) => rounds.includes(s.round));
  if (rounds.length < 3) return { few: true, rounds: rounds.length };
  let best = null; // reaction delay with the fast model
  for (let lag = 0; lag <= 0.81; lag += 0.1) { const h = await heldOut(label(use, traj, lag), async (r) => fitLinear(r)); if (!best || rel(h) < rel(best.h)) best = { lag, h }; if (tick) await tick(); }
  const rows = label(use, traj, best.lag), net = await heldOut(rows, (r) => fitNet(r, { epochs, tick }));
  // the better model for each joint, judged on rounds it has not seen
  const fl = fitLinear(rows), fn = await fitNet(rows, { epochs, tick });
  const kind = OUT.map((_, k) => (net.s[k].err < best.h.s[k].err ? 'net' : 'linear')), s = OUT.map((_, k) => (kind[k] === 'net' ? net : best.h).s[k]);
  const src = (k) => (kind[k] === 'net' ? net : best.h).pairs;
  const wrong = (seg, k) => { const v = src(k).filter((q) => q.seg === seg); return v.length ? v.reduce((a, q) => a + Math.abs(q.p[k] - q.y[k]), 0) / v.length : null; };
  return {
    lag: best.lag, kind, rows: rows.length, rounds: rounds.length, score: s.map((v) => ({ ...v, verdict: verdictOf(v) })),
    cross: { dipWhenPip: wrong('pip', 0), pipWhenDip: wrong('dip', 1) },
    predict: (x) => { const a = fl(x), b = fn(x); return kind.map((q, k) => (q === 'net' ? b[k] : a[k])); },
  };
}
