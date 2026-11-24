// Can the bend of the last joint (DIP) be read from the iPad's touch alone? Pure functions, no DOM.
// A browser gives no capacitance image: only, per contact, a position, radii, an angle and a force.
export const med = (v) => { const s = v.slice().sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0; };
export const KEYS = ['n', 'size', 'len', 'cx', 'cy', 'force'];
export const KEY_JA = { n: '接触の数', size: '接触の大きさ', len: '接触の長さ', cx: '位置 x', cy: '位置 y', force: '押す強さ' };
// list: contacts {x, y, rx, ry, a, f} in mm
export function features(list) {
  if (!list?.length) return null;
  let A = 0, X = 0, Y = 0, F = 0, len = 0;
  for (const t of list) { const a = Math.PI * Math.max(t.rx, 0.1) * Math.max(t.ry, 0.1); A += a; X += a * t.x; Y += a * t.y; F += t.f || 0; }
  for (const p of list) for (const q of list) len = Math.max(len, Math.hypot(p.x - q.x, p.y - q.y) + Math.max(p.rx, p.ry) + Math.max(q.rx, q.ry));
  return { n: list.length, size: Math.sqrt(A), len, cx: X / A, cy: Y / A, force: F };
}
export const medianFeature = (fs) => Object.fromEntries(KEYS.map((k) => [k, med(fs.map((f) => f[k]))]));

function solve(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]]; if (Math.abs(M[c][c]) < 1e-12) return null;
    for (let r = 0; r < n; r++) if (r !== c) { const k = M[r][c] / M[c][c]; for (let j = c; j <= n; j++) M[r][j] -= k * M[c][j]; }
  }
  return M.map((r, i) => r[n] / r[i]);
}
const FLOOR = { n: 0.3, size: 0.2, len: 0.2, cx: 0.5, cy: 0.5, force: 0.05 }; // smaller changes are not blown up
// ridge regression on standardised features; a feature that does not change is left out
export function fit(rows, lambda = 1) {
  const my = rows.reduce((s, r) => s + r.y, 0) / rows.length, use = [];
  for (const k of KEYS) {
    const v = rows.map((r) => r.f[k]), m = v.reduce((a, b) => a + b, 0) / v.length, sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length);
    if (sd > 1e-3) use.push({ k, m, sd: Math.max(sd, FLOOR[k]), w: 0 });
  }
  if (use.length) {
    const X = rows.map((r) => use.map((u) => (r.f[u.k] - u.m) / u.sd));
    const A = use.map((_, i) => use.map((_, j) => X.reduce((s, x) => s + x[i] * x[j], 0) + (i === j ? lambda : 0)));
    const w = solve(A, use.map((_, i) => X.reduce((s, x, r) => s + x[i] * (rows[r].y - my), 0)));
    if (w) use.forEach((u, i) => { u.w = w[i]; });
  }
  return { my, use };
}
export const predict = (M, f) => M.use.reduce((s, u) => s + u.w * (f[u.k] - u.m) / u.sd, M.my);

// Each round (finger lifted and put back) is predicted from the OTHER rounds only.
function outOfRound(rows) {
  return rows.map((r) => { const M = fit(rows.filter((q) => q.round !== r.round)); return { y: r.y, p: predict(M, r.f), b: M.my }; });
}
const mae = (o, k) => o.reduce((s, x) => s + Math.abs(x[k] - x.y), 0) / o.length;
// trials: [{round, post:'s'|'h'|'f'|'p', f, y}]. 'p' (only PIP moved) is never used to fit: it shows whether PIP is mistaken for DIP.
export function evaluate(trials, rnd = Math.random) {
  const rows = trials.filter((t) => t.post !== 'p' && t.f && Number.isFinite(t.y)), rounds = [...new Set(rows.map((r) => r.round))];
  if (rounds.length < 3 || rows.length < 8) return { verdict: 'few', n: rows.length };
  const o = outOfRound(rows), err = mae(o, 'p'), base = mae(o, 'b');
  // same calculation with the postures shuffled inside each round: how often does chance do as well?
  let better = 0; const N = 300;
  for (let i = 0; i < N; i++) {
    const sh = rounds.flatMap((R) => {
      const a = rows.filter((r) => r.round === R), ys = a.map((r) => r.y);
      for (let j = ys.length - 1; j > 0; j--) { const k = Math.floor(rnd() * (j + 1)); [ys[j], ys[k]] = [ys[k], ys[j]]; }
      return a.map((r, j) => ({ ...r, y: ys[j] }));
    });
    if (mae(outOfRound(sh), 'p') <= err) better++;
  }
  const p = (better + 1) / (N + 1), model = fit(rows), ym = (q) => med(rows.filter((r) => r.post === q).map((r) => r.y));
  const range = Math.max(1, Math.abs(ym('f') - ym('s')));
  const pips = trials.filter((t) => t.post === 'p' && t.f).map((t) => {
    const M = fit(rows.filter((r) => r.round !== t.round));
    return Math.abs(predict(M, t.f) - (Number.isFinite(t.y) ? t.y : ym('s')));
  });
  const pipErr = pips.length ? pips.reduce((a, b) => a + b, 0) / pips.length : null, mixed = pipErr != null && pipErr > 0.4 * range;
  const good = p < 0.05 && err < 0.4 * base, some = p < 0.05 && err < 0.75 * base;
  return { verdict: !some ? 'no' : mixed ? 'mixed' : good ? 'yes' : 'some', n: rows.length, err, base, p, range, pipErr, mixed, model, out: o };
}
