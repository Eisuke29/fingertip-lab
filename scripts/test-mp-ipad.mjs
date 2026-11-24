// node scripts/test-mp-ipad.mjs : checks of the pure parts of public/mp-ipad
import test from 'node:test';
import assert from 'node:assert/strict';
import * as F from '../public/mp-ipad/finger.js';
import { Contact, tiltOf, Tilt, eyeFrom, eyeToWorld, upOf, Eye } from '../public/mp-ipad/sensors.js';

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
test('index knuckle: the leftmost contact of a right hand, also when it lands later; no jump when contacts are split or swapped', () => {
  const c = new Contact('right'); let t = 0; const u = (l) => c.update(l, (t += 16));
  u([{ id: 2, x: 20, y: 0 }]); assert.deepEqual(u([{ id: 2, x: 20, y: 0 }, { id: 1, x: 0, y: 2 }]), [0, 2]);
  for (let i = 0; i < 40; i++) u([{ id: 2, x: 20, y: 0 }, { id: 1, x: 0, y: 2 }]);
  const p = u([{ id: 9, x: 9, y: 1 }]); assert.ok(Math.hypot(p[0] - 0, p[1] - 2) < 0.6, String(p)); // merged into one blob
  let q; for (let i = 0; i < 250; i++) q = u([{ id: 9, x: 9, y: 1 }]); near(q[0], 9, 0.1);
  for (let i = 0; i < 10; i++) u([]); assert.ok(c.p); for (let i = 0; i < 10; i++) u([]); assert.equal(c.p, null);
  const l = new Contact('left'); assert.equal(l.update([{ id: 1, x: 0, y: 0 }, { id: 2, x: 20, y: 0 }], 0)[0], 20);
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
