// node --test scripts/test-hover.mjs : pure parts of public/hover
import test from 'node:test'; import assert from 'node:assert/strict';
import { Meter, choose } from '../public/hover/link.js';
const run = (d, loss = 0, off = 1000) => { const m = new Meter(); let now = 0; for (let i = 0; i < 60; i++) { now += 200; const id = m.ping(now); if ((i % 10) / 10 < loss) continue; m.pong(id, now + d, now + d / 2 + off); } return [m, now]; };
test('meter: round trip, loss, clock difference', () => { const [m] = run(40, 0.2); assert.equal(m.rtt, 40); assert.ok(Math.abs(m.loss - 0.2) < 0.06, String(m.loss)); assert.ok(Math.abs(m.off - 1000) < 1); });
test('the way: whichever works, direct preferred, stays unless clearly worse', () => { const [d, t] = run(20), [r] = run(60), e = new Meter(); assert.equal(choose(d, r, t), 'direct'); assert.equal(choose(e, r, t), 'relay'); assert.equal(choose(d, e, t), 'direct'); assert.equal(choose(e, e, t), null); const [s] = run(70); assert.equal(choose(s, r, t, 'direct'), 'direct'); const [x] = run(200); assert.equal(choose(x, r, t, 'direct'), 'relay'); assert.equal(choose(d, r, t + 5000), null); });

// ---------- step 2: where the hand is ----------
import { homography, apply, inv3, poseFrom, riseOf, lifted, findDot, scaleOf, palmOf, Mid, Fit, Track, Slow } from '../public/hover/geom.js';
// a camera at C that looks at the middle of the screen: a point of the screen frame -> px
export function cam(C, f = 1000, w = 1280, h = 720, roll = 0) {
  const n = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); }, cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const z = n(C.map((v) => -v)); let x = n(cross(z, [0, 0, 1])), y = cross(z, x); if (roll) { const c = Math.cos(roll), s = Math.sin(roll); [x, y] = [x.map((v, i) => v * c + y[i] * s), y.map((v, i) => y[i] * c - x[i] * s)]; }
  const px = (P) => { const d = P.map((v, i) => v - C[i]), Z = dot(d, z); return [w / 2 + f * dot(d, x) / Z, h / 2 + f * dot(d, y) / Z, Z]; }; return { px, f, w, h, C };
}
const GRID = [-90, 0, 90].flatMap((x) => [-60, 0, 60].map((y) => [x, y]));
test('the screen in the picture: camera place and focal length come out of nine dots', () => {
  for (const [C, f, roll] of [[[-200, -250, 300], 1000, 0], [[-250, -200, 320], 900, 0.4], [[150, -300, 250], 1150, -1.2], [[-40, -120, 420], 1000, 1.57]]) {
    const c = cam(C, f, 1280, 720, roll), img = GRID.map((p) => c.px([...p, 0]).slice(0, 2).map((v, i) => v + 0.3 * Math.sin(7 * p[0] + 3 * p[1] + i))), Hs = homography(GRID, img), Hi = homography(img, GRID), P = poseFrom(Hs, 1280, 720);
    assert.ok(P.ok && !P.guessed, JSON.stringify(P)); assert.ok(Math.abs(P.f - f) / f < 0.06, `f ${P.f}`); assert.ok(Math.hypot(...P.C.map((v, i) => v - C[i])) < 25, `C ${P.C}`);
    // a point 50 mm above the glass: seen through the screen it lies elsewhere, with the camera it is found again
    const X = [30, -20, 50], [u, v, Z] = c.px(X), g = apply(Hi, [u, v]), back = lifted(g, P.C, 50); assert.ok(Math.hypot(g[0] - 30, g[1] + 20) > 15); assert.ok(Math.hypot(back[0] - 30, back[1] + 20) < 2.5, `back ${back}`);
    const hgt = P.C[2] + riseOf(P, u, v) * Z; assert.ok(Math.abs(hgt - 50) < 15, `height ${hgt}`); // rough before the first touch; touching makes it right (next test)
  }
});
test('the dot: found to a fraction of a pixel, not found when something else moves', () => {
  const w = 480, h = 270, ref = new Uint8Array(w * h), cur = new Uint8Array(w * h); let s = 7; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < ref.length; i++) { ref[i] = 30 + rnd() * 6; cur[i] = 30 + rnd() * 6; } const put = (a, x0, y0, r, v) => { for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const d = Math.hypot(x + 0.5 - x0, y + 0.5 - y0); if (d < r + 1) a[y * w + x] = Math.min(255, a[y * w + x] + v * Math.max(0, Math.min(1, r + 0.5 - d))); } };
  put(cur, 201.3, 99.6, 5, 150); const d = findDot(cur, ref, w, h); assert.ok(d && Math.hypot(d.x - 201.3, d.y - 99.6) < 0.4, JSON.stringify(d));
  assert.equal(findDot(ref, ref, w, h), null); const hand = Uint8Array.from(cur); put(hand, 350, 200, 60, 90); assert.equal(findDot(hand, ref, w, h), null);
});
test('touching teaches the size of the hand and where its point is', () => {
  const c = cam([-200, -250, 300]), Hi = homography(GRID.map((p) => c.px([...p, 0]).slice(0, 2)), GRID), P = poseFrom(homography(GRID, GRID.map((p) => c.px([...p, 0]).slice(0, 2))), 1280, 720), fit = new Fit(12);
  // this hand is 15 % larger than the model's, and the model's point lies 9 mm beside the real contact
  const see = (X) => { const Q = [X[0] + 9, X[1] - 4, X[2] + 12], [u, v, Z] = c.px(Q); return { g: apply(Hi, [u, v]), dz: riseOf(P, u, v), Z: Z / 1.15 }; };
  const before = fit.height(see([20, 10, 40]), P.C); assert.ok(Math.abs(before - 40) > 25, `before ${before}`);
  for (let i = 0; i < 12; i++) { const X = [10 + i * 3, -20 + i, 0]; fit.learn(see(X), P.C, X); }
  assert.ok(Math.abs(fit.c - 1.15) < 0.03, `c ${fit.c}`);
  for (const X of [[20, 10, 0], [20, 10, 40], [-60, 30, 70]]) { const m = see(X), z = fit.height(m, P.C), p = fit.place(m, P.C, z); assert.ok(Math.abs(z - X[2]) < 5, `height ${z} for ${X}`); assert.ok(Math.hypot(p[0] - X[0], p[1] - X[1]) < 4, `place ${p} for ${X}`); }
});
test('late and trembling places are carried on to now', () => {
  let s = 3; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647, at = (t) => [60 * Math.sin(t / 1000 * 2 * Math.PI * 0.8), 20 * Math.cos(t / 1000 * 2 * Math.PI * 0.5)], T = new Track(); let a = 0, b = 0, n = 0, still = 0;
  for (let t = 0; t < 6000; t += 33) { const p = at(t).map((v) => v + (rnd() - 0.5) * 2.4); T.add(p, t); if (t > 500) { const now = t + 90, q = T.at(now), e = at(now); a += Math.hypot(q[0] - e[0], q[1] - e[1]); b += Math.hypot(p[0] - e[0], p[1] - e[1]); n++; } }
  assert.ok(a / n < 0.6 * b / n, `with ${a / n} without ${b / n}`); const R = new Track(); let last = null;
  for (let t = 0; t < 3000; t += 33) { R.add([5 + (rnd() - 0.5) * 2.4, (rnd() - 0.5) * 2.4], t); const q = R.at(t + 90); if (last && t > 500) still = Math.max(still, Math.hypot(q[0] - last[0], q[1] - last[1])); last = q; } assert.ok(still < 0.6, `a resting hand trembles ${still}`);
  const S = new Slow(0.12); let v = 0; for (let t = 0; t < 1000; t += 33) v = S.add(50, t + 0); assert.ok(Math.abs(v - 50) < 1);
});
test('the size of the hand in the picture', () => { const Wd = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17].map((i) => ({ x: 0.01 * (i % 5), y: 0.008 * (i % 7), z: 0 })), L = Wd.map((p) => ({ x: 0.4 + p.x * 5000 / 1280, y: 0.5 + p.y * 5000 / 720 })); assert.ok(Math.abs(scaleOf(L, Wd, 1280, 720) - 5000) < 1); });

test('the size of the palm from the picture alone: twice as near, twice as large; one wild number is passed over', () => {
  const at = (k) => Array.from({ length: 21 }, (_, i) => ({ x: 0.5 + 0.03 * k * Math.cos(i), y: 0.5 + 0.05 * k * Math.sin(i * 1.7) })), a = palmOf(at(1), 1920, 1080), b = palmOf(at(2), 1920, 1080);
  assert.ok(a > 0 && Math.abs(b / a - 2) < 1e-9, `${a} ${b}`); assert.equal(palmOf(null, 1920, 1080), null);
  const m = new Mid(); assert.deepEqual([10, 11, 90, 12, 13].map((v) => m.add(v)), [10, 11, 11, 12, 13]);
});
