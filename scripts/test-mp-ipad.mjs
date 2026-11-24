// node scripts/test-mp-ipad.mjs : checks of the pure parts of public/mp-ipad
import test from 'node:test';
import assert from 'node:assert/strict';
import * as F from '../public/mp-ipad/finger.js';
import { Contact, Lead, tiltOf, Tilt, eyeFrom, eyeToWorld, upOf, Eye } from '../public/mp-ipad/sensors.js';

const len = [42, 25, 22], near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) <= e, `${a} vs ${b}`);
test('virtual proximal is the straight continuation of the back of the hand', () => {
  for (const th of [75, 90, 105]) for (const y of [-20, 0, 16]) { const f = F.frame(th * Math.PI / 180, y * Math.PI / 180, 0.4); near(F.dot(f.u, f.up), -1); near(F.dot(f.n, f.u), 0); near(Math.hypot(...f.m), 1); }
});
test('resting finger is straight, on the material, starting at the contact', () => {
  const root = [10, 5, 11], z = F.restTip(root, Math.PI / 2, 0, len)[2], s = F.solve({ root, theta: Math.PI / 2, yaw: 0, lag: [0, 0, 0], len, tipZ: z });
  near(s.k, 1, 1e-9); near(s.bendDeg, 0, 1e-4); assert.ok(Math.hypot(s.tip[0] - 10, s.tip[1] - 5) < 3);
});
test('the fingertip stays behind: leans to the side it lags, curls toward the person when pushed away', () => {
  const o = { root: [0, 0, 11], theta: Math.PI / 2, yaw: 0, len, tipZ: -70 };
  assert.ok(F.solve({ ...o, lag: [-12, 0, 0] }).tip[0] < -5); assert.ok(F.solve({ ...o, lag: [12, 0, 0] }).tip[0] > 5); assert.ok(F.solve({ ...o, lag: [0, -12, 0] }).tip[1] < -5);
  near(F.solve({ ...o, lag: [-12, 0, 0], gain: 0 }).bendDeg, 0, 1e-4); assert.ok(F.solve({ ...o, lag: [-12, 0, 0], gain: 2 }).bendDeg > F.solve({ ...o, lag: [-12, 0, 0] }).bendDeg);
});
test('stick and slip; same at 60 and 120 Hz; never more than 30 mm behind', () => {
  const run = (hz) => { const t = new F.Tip(); let max = 0; t.step([0, 0], F.MATS.catchy, 0.02); for (let i = 0; i < hz; i++) { t.step([i / hz * 60, 0], F.MATS.catchy, 1 / hz); max = Math.max(max, Math.hypot(...t.lag)); } return [max, t.lag[0]]; };
  const a = run(60), b = run(120); assert.ok(a[0] > 14 && a[0] <= 18, String(a)); near(a[0], b[0], 1.5); near(a[1], b[1], 1.5);
  const t = new F.Tip(); t.step([0, 0], F.MATS.sticky, 0.02); t.step([200, 0], F.MATS.sticky, 0.02); assert.ok(Math.hypot(...t.lag) <= 30.0001);
});
test('landing: the index knuckle, also when it lands a moment later; not the thumb; left hand mirrored', () => {
  const c = new Contact('right', 0); let t = 0; const u = (l) => c.update(l, (t += 16));
  u([{ id: 2, x: 20, y: 0 }]); assert.deepEqual(u([{ id: 2, x: 20, y: 0 }, { id: 1, x: 0, y: 2 }]), [0, 2]);
  assert.equal(new Contact('right', 0).update([{ id: 1, x: 0, y: 0 }, { id: 7, x: -15, y: -40 }], 0)[0], 0);
  assert.equal(new Contact('left', 0).update([{ id: 1, x: 0, y: 0 }, { id: 2, x: 20, y: 0 }], 0)[0], 20);
  for (let i = 0; i < 25; i++) u([]); assert.equal(c.p, null);
});
// a fist stroking left and right, 4 knuckles 20 mm apart; the iPad merges, splits, renumbers, loses and cancels contacts, and centroids tremble
test('contacts split, merged, renumbered, lost: the place follows the hand without jumps', () => {
  let seed = 1; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647, c = new Contact('right', 0.28); let id = 1, k = [0, 1, 2, 3].map((i) => ({ i, id: id++ })), worst = 0, jump = 0, prev = null, lastT = null, state = 0;
  for (let t = 0; t < 8000; t += 8) {
    const x = 45 * Math.sin(t / 1000 * 3), y = -5 + 10 * Math.sin(t / 1000 * 1.1);
    if (t > 600 && rnd() < 0.02) { state = Math.floor(rnd() * 5); if (rnd() < 0.5) for (const q of k) if (rnd() < 0.5) q.id = id++; }
    const all = k.map((q) => ({ id: q.id, x: x + q.i * 19 + (rnd() - 0.5) * 0.4, y: y + q.i * 4 + (rnd() - 0.5) * 0.4, rx: 8, ry: 8 })), mg = (a, b) => ({ id: a.id, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, rx: 17, ry: 10 });
    const list = [all, [mg(all[0], all[1]), all[2], all[3]], [all[1], all[2]], [mg(all[0], all[1]), mg(all[2], all[3])], rnd() < 0.05 ? [] : [all[0]]][state], p = c.update(list, t); if (!p) continue;
    worst = Math.max(worst, Math.hypot(p[0] - x, p[1] - y)); if (prev) jump = Math.max(jump, Math.hypot(p[0] - prev[0] - (x - lastT[0]), p[1] - prev[1] - (y - lastT[1]))); prev = [...p]; lastT = [x, y];
  }
  assert.ok(jump < 4, `jump ${jump}`); assert.ok(worst < 22, `worst ${worst}`);
});
test('prediction: the remaining delay is small at stroking speed, still hand does not tremble, stopping does not shoot far', () => {
  const L = new Lead(), at = (t) => [45 * Math.sin(t / 1000 * 3), 0]; let e = 0; for (let t = 0; t < 4000; t += 8) { L.add(at(t), t); if (t > 100) e = Math.max(e, Math.abs(L.at(t + 5, 45)[0] - at(t + 50)[0])); } assert.ok(e < 3, String(e)); // without prediction 6.7 mm
  const S = new Lead(); let seed = 3, lo = 9, hi = -9; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647; for (let t = 0; t < 2000; t += 8) { S.add([(rnd() - 0.5) * 0.3, 0], t); if (t > 100) { const x = S.at(t, 45)[0]; lo = Math.min(lo, x); hi = Math.max(hi, x); } } assert.ok(hi - lo < 0.7, String(hi - lo));
});
test('PIP: the middle phalanx keeps its line and length, only the distal one bends, the tip stays on the material', () => {
  const j = F.JOINTS.pip, th = j.theta * Math.PI / 180, root = [0, 0, j.h], z = F.restTip(root, th, 0, len, 'pip')[2], o = { joint: 'pip', root, theta: th, yaw: 0, len, tipZ: z };
  const r = F.solve({ ...o, lag: [0, 0, 0] }); near(r.k, 1, 1e-9); near(r.bendDeg, 0, 1e-4); near(F.dot(r.u, F.frame(th, 0, 0).up), -1);
  for (const lag of [[-30, 0, 0], [30, 0, 0], [0, -30, 0], [0, 30, 0], [20, -20, 0]]) for (const gain of [0, 1, 2.5]) { const s = F.solve({ ...o, lag, gain }); for (let i = 0; i < 3; i++) { near(s.dip[i], r.dip[i]); } near(s.tip[2], z, 1e-6); assert.ok(gain === 0 || s.bendDeg > 10); }
  assert.ok(F.solve({ ...o, lag: [-15, 0, 0] }).tip[0] < -8); assert.ok(F.solve({ ...o, lag: [0, -15, 0] }).tip[1] < r.tip[1] - 5);
});
test('tilt: 26 degrees from any sign and way round', () => {
  const s = 9.81 * Math.sin(26 * Math.PI / 180), k = 9.81 * Math.cos(26 * Math.PI / 180);
  for (const a of [1, -1]) for (const b of [1, -1]) { near(tiltOf({ x: a * s, y: 0, z: b * k }, true).tilt, 26, 1e-6); near(tiltOf({ x: 0, y: a * s, z: b * k }, false).tilt, 26, 1e-6); }
  const T = new Tilt(); for (let i = 0; i < 70; i++) T.add({ x: s, y: 0.1, z: -k }, true, i * 16); near(T.deg, 26, 0.2); assert.ok(T.still);
  for (let i = 0; i < 20; i++) T.add({ x: s + i * 0.2, y: 0, z: -k }, true, 1200 + i * 16); assert.ok(!T.still);
});
test('eye from world to screen and back; up is up', () => {
  for (const d of [0, 26, 75]) { const w = eyeToWorld(d, eyeFrom(d, 400, 420, -200)); near(w.back, 400, 1e-9); near(w.height, 420, 1e-9); near(w.side, -200); }
  const e = eyeFrom(26, 400, 420); near(e[1], -175.4, 0.5); near(e[2], 552.8, 0.5); near(Math.hypot(...upOf(26)), 1);
});
test('visibility: hidden from the front at 26 degrees, to the left when peeking from the left', () => {
  const tip = F.restTip([0, 0, 11], Math.PI / 2, 0, len), front = F.seenAt(tip, eyeFrom(26, 400, 420)), left = F.seenAt(tip, eyeFrom(26, 400, 420, -200));
  assert.ok(Math.abs(front[0]) < 1 && front[1] < -15); assert.ok(left[0] < -20);
});
test('eye never jumps when the face is lost or found', () => {
  const E = new Eye(); let t = 0, prev = null, maxStep = 0; const go = (m, n) => { for (let i = 0; i < n; i++) { const e = [...E.update(m, [0, -175, 553], (t += 16))]; if (prev) maxStep = Math.max(maxStep, Math.hypot(...e.map((v, j) => v - prev[j]))); prev = e; } };
  go([-200, -175, 553], 30); go(null, 150); go([-200, -150, 500], 60); assert.ok(maxStep < 30, String(maxStep)); assert.equal(E.src, 'measured');
});
