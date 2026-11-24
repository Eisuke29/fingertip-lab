// node scripts/test-mp-ipad.mjs : checks of the pure parts of public/mp-ipad
import test from 'node:test';
import assert from 'node:assert/strict';
import * as F from '../public/mp-ipad/finger.js';
import * as W from '../public/mp-ipad/world.js';
import { THINGS, makeThing } from '../public/mp-ipad/objects.js';
import { Contact, Point, Lead, Ahead, tiltOf, Tilt, eyeFrom, eyeToWorld, upOf, Eye } from '../public/mp-ipad/sensors.js';

const len = [43, 25, 17], near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) <= e, `${a} vs ${b}`);
test('virtual proximal is the straight continuation of the back of the hand', () => {
  for (const th of [75, 90, 105]) for (const y of [-20, 0, 16]) { const f = F.frame(th * Math.PI / 180, y * Math.PI / 180, 0.4); near(F.dot(f.u, f.up), -1); near(F.dot(f.n, f.u), 0); near(Math.hypot(...f.m), 1); }
});
const surfOf = (root, th, j) => F.restTip(root, th, 0, len, j)[2] - F.RF + F.PRESS;
test('resting finger is straight, pressed a little into the material, starting at the contact', () => {
  const root = [10, 5, 11], s = F.solve({ root, theta: Math.PI / 2, yaw: 0, lag: [0, 0, 0], len, surf: surfOf(root, Math.PI / 2, 'mp') });
  near(s.k, 1, 1e-9); near(s.bendDeg, 0, 1e-4); assert.ok(Math.hypot(s.tip[0] - 10, s.tip[1] - 5) < 3);
});
test('the fingertip stays behind: leans to the side it lags, curls toward the person when pushed away', () => {
  const root = [0, 0, 11], o = { root, theta: Math.PI / 2, yaw: 0, len, surf: surfOf(root, Math.PI / 2, 'mp') };
  assert.ok(F.solve({ ...o, lag: [-12, 0, 0] }).tip[0] < -5); assert.ok(F.solve({ ...o, lag: [12, 0, 0] }).tip[0] > 5); assert.ok(F.solve({ ...o, lag: [0, -12, 0] }).tip[1] < -5);
  near(F.solve({ ...o, lag: [-12, 0, 0], gain: 0 }).bendDeg, 0, 1e-4);
});
test('the segments keep their length (6 % at most) and the fingertip always touches and never goes through', () => {
  let worst = 1; for (const joint of ['mp', 'pip']) for (const th0 of [60, 78, 90, 105]) for (const yaw of [-0.6, 0, 0.3]) for (const bend of ['whole', 'distal']) for (const gain of [0, 1, 2.5]) for (let i = 0; i < 24; i++) for (const R of [5, 16, 30]) {
    const J = F.JOINTS[joint], root = [0, 0, J.h], lag = [R * Math.cos(i / 24 * 6.283), R * Math.sin(i / 24 * 6.283), 0], surf = surfOf(root, J.theta * Math.PI / 180, joint), s = F.solve({ joint, root, theta: th0 * Math.PI / 180, yaw, lag, gain, bend, len, surf, dent: 1.8 });
    const D = (a, b) => Math.hypot(...a.map((v, j) => v - b[j])); near(D(s.dip, s.tip) / len[2], s.k, 1e-9); near(D(s.pip, s.dip) / len[1], s.k, 1e-9); if (Math.abs(th0 - J.theta) < 1) { worst = Math.max(worst, s.k, 1 / s.k); const depth = surf - (s.tip[2] - F.RF); assert.ok(depth > 0.25 && depth < F.PRESS + 1.8 + 0.1, `${joint} ${depth}`); }
  }
  assert.ok(worst <= 1.0601, String(worst));
});
test('stick and slip; same at 60 and 120 Hz; never more than 30 mm behind', () => {
  const run = (hz) => { const t = new F.Tip(); let max = 0; t.step([0, 0], F.MATS.knit, 0.02); for (let i = 0; i < hz; i++) { t.step([i / hz * 60, 0], F.MATS.knit, 1 / hz); max = Math.max(max, Math.hypot(...t.lag)); } return [max, t.lag[0]]; };
  const a = run(60), b = run(120); assert.ok(a[0] > 14 && a[0] <= 18, String(a)); near(a[0], b[0], 1.5); near(a[1], b[1], 1.5);
  const t = new F.Tip(); t.step([0, 0], F.MATS.honey, 0.02); t.step([200, 0], F.MATS.honey, 0.02); assert.ok(Math.hypot(...t.lag) <= 30.0001);
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
test('the root goes ahead in the direction of the movement, within the limit, and comes back at rest', () => {
  const A = new Ahead(); let b; for (let i = 0; i < 30; i++) b = A.step([300, 0], 8, 0.016); near(b[0], 8, 0.05); near(b[1], 0);
  for (let i = 0; i < 30; i++) b = A.step([0, -60], 8, 0.016); near(b[1], -4, 0.1); for (let i = 0; i < 60; i++) b = A.step([0, 0], 8, 0.016); assert.ok(Math.hypot(...b) < 0.1);
});
test('PIP: the middle phalanx keeps its line, only the distal one bends', () => {
  const j = F.JOINTS.pip, th = j.theta * Math.PI / 180, root = [0, 0, j.h], o = { joint: 'pip', root, theta: th, yaw: 0, len, surf: surfOf(root, th, 'pip') }, r = F.solve({ ...o, lag: [0, 0, 0] });
  near(r.k, 1, 1e-9); near(r.bendDeg, 0, 1e-4); near(F.dot(r.u, F.frame(th, 0, 0).up), -1);
  for (const lag of [[-30, 0, 0], [30, 0, 0], [0, -30, 0], [0, 30, 0], [20, -20, 0]]) for (const gain of [1, 2.5]) { const s = F.solve({ ...o, lag, gain }); near(F.dot(s.u, r.u), 1); assert.ok(s.bendDeg > 10, String(s.bendDeg)); }
  assert.ok(F.solve({ ...o, lag: [-15, 0, 0] }).tip[0] < -6); assert.ok(F.solve({ ...o, lag: [0, -15, 0] }).tip[1] < r.tip[1] - 4);
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

// ---------- only the PIP knuckle ----------
const J = F.JOINTS.point, TH = J.theta * Math.PI / 180, lowOf = (yaw, ext) => F.restTip([0, 0, J.h], TH, yaw, len, 'point', ext)[2] - F.RF;
test('point: the root is the contact itself, the middle phalanx never moves, the tip carries the lag; resting finger is as given', () => {
  const root = [4, 7, J.h], yaw = 0.5, ext = 0.5, surf = lowOf(yaw, ext) + F.PRESS, o = { joint: 'point', root, theta: TH, yaw, ext, len, surf }, r = F.solve({ ...o, lag: [0, 0, 0] }), rest = F.restTip(root, TH, yaw, len, 'point', ext);
  assert.equal(J.off, 0); for (let i = 0; i < 3; i++) near(r.tip[i], rest[i], 1e-9); near(r.bendDeg, 0, 1e-3);
  for (let a = 0; a < 6.28; a += 0.3) for (const R of [3, 9, 16, 30]) { const lag = [R * Math.cos(a), R * Math.sin(a), 0], s = F.solve({ ...o, lag, dent: 1.8 }); near(F.dot(s.u, r.u), 1); near(s.k, 1, 1e-6); assert.ok(s.tip[2] - F.RF < surf, 'touches'); assert.ok(s.tip[2] - F.RF > surf - F.PRESS - 1.8 - 1e-6, 'not through'); }
  assert.ok(F.solve({ ...o, lag: [-8, 0, 0] }).tip[0] < rest[0] - 2);
});
const stroke = (kind, gain, secs, at) => { const yaw = 0.5, ext = 0.45, T = makeThing(kind, 222, 152, lowOf(yaw, ext), 165), out = []; for (let i = 0; i < secs * 60; i++) { const root = [...at(i / 60), J.h], dip = F.add(root, F.frame(TH, yaw, 0).u, len[1]), rest = F.restTip(root, TH, yaw, len, 'point', ext), lag = [...T.step(rest, 1 / 60, { dip, reach: 0.95 * len[2], gain })], o = { joint: 'point', root, theta: TH, yaw, ext, lag, len }; const f = T.w ? W.settle(T.w, o) : F.solve({ ...o, gain: 1, ...(kind === 'slime' ? { surf: lowOf(yaw, ext) + F.PRESS, dent: 2.2 } : { surf: -1e4, floor: -1e4 }) }); out.push({ lag: Math.hypot(...lag), tip: f.tip, f }); } return [T, out]; };
const wander = (t) => [80 * Math.sin(t * 1.3), 45 * Math.sin(t * 0.83)];
test('solid things: the finger is never inside anything; slopes hold it back', () => {
  for (const kind of ['cube', 'bumps', 'soft']) for (const gain of [0, 1, 1.6]) { const [T, q] = stroke(kind, gain, 15, wander); let worst = 0; for (const o of q) worst = Math.max(worst, W.ground(T.w, o.tip[0], o.tip[1]).z - o.tip[2]); assert.ok(worst < 1.2, `${kind} ${gain} inside ${worst}`); if (gain === 1) assert.ok(Math.max(...q.map((o) => o.lag)) > 3, kind); }
});
test('every thing: finite, holds the fingertip back, the knuckle never, and lets go again', () => {
  for (const [kind] of THINGS) { const [T, q] = stroke(kind, 1, 12, wander); let jump = 0; q.forEach((o, i) => { assert.ok(o.tip.every(Number.isFinite), kind); if (i) jump = Math.max(jump, Math.hypot(...o.tip.map((v, j) => v - q[i - 1].tip[j]))); }); const most = Math.max(...q.map((o) => o.lag)); assert.ok(most > 2, `${kind} ${most}`); assert.ok(jump < 26, `${kind} jump ${jump}`); T.reset(); for (let i = 0; i < 400; i++) T.rest(1 / 60);
    const [, z] = stroke(kind, 0, 6, wander); if (!['push'].includes(kind)) assert.ok(Math.max(...z.map((o) => o.lag)) < 16.5, `${kind} without effect`); }
});
test('boxes: the heavy one needs a stronger bend before it moves, and moves less', () => {
  const go = (i) => { const T = makeThing('push', 222, 152, lowOf(0, 0.45), 165), b = T.boxes[i], x0 = b.x; let first = null, lag = 0; for (let k = 0; k < 240; k++) { const tx = x0 - b.a - 14 + k * 0.12; T.step([tx, b.y, -30], 1 / 60, {}); if (first == null && Math.abs(b.x - x0) > 0.2) first = lag; lag = Math.hypot(...T.lag); } return [first ?? 99, b.x - x0]; };
  const r = [0, 1, 2].map(go); assert.ok(r[0][0] < r[1][0] && r[1][0] < r[2][0], JSON.stringify(r)); assert.ok(r[0][1] > r[2][1], JSON.stringify(r));
});
test('boxes: the fingertip is never inside one, however the hand moves', () => {
  for (const gain of [0, 1, 1.6]) { const T = makeThing('push', 222, 152, lowOf(0.5, 0.45), 165); let worst = 0; for (let i = 0; i < 1500; i++) { const t = i / 60, root = [90 * Math.sin(t * 1.9), 50 * Math.sin(t * 1.21), J.h], dip = F.add(root, F.frame(TH, 0.5, 0).u, len[1]), rest = F.restTip(root, TH, 0.5, len, 'point', 0.45); T.step(rest, 1 / 60, { dip, reach: 0.95 * len[2], gain }); for (const b of T.boxes) { const dx = Math.max(0, Math.abs(T.p[0] - b.x) - b.a), dy = Math.max(0, Math.abs(T.p[1] - b.y) - b.a); worst = Math.max(worst, F.RF * 0.92 - Math.hypot(dx, dy)); } } assert.ok(worst < 1.0, `gain ${gain} inside ${worst}`); }
});
test('a lost face keeps the last view', () => { const E = new Eye(); for (let i = 0; i < 60; i++) E.update([-150, -175, 553], [0, -175, 553], i * 16); for (let i = 60; i < 600; i++) E.update(null, [0, -175, 553], i * 16); near(E.e[0], -150, 1); for (let i = 600; i < 1200; i++) E.update(null, [0, -175, 553], i * 16, false); near(E.e[0], 0, 1); });
test('strings: caught, let go, tremble, come to rest', () => {
  const T = makeThing('harp', 222, 152, lowOf(0, 0.45), 165), s = T.strings[2]; let held = 0, u = 0; for (let k = 0; k < 120; k++) { T.step([s.x - 20 + k * 0.5, 0, -30], 1 / 60, {}); if (s.held) held++; u = Math.max(u, Math.abs(s.u)); } assert.ok(held > 5 && u > 4, `${held} ${u}`); T.reset(); for (let i = 0; i < 600; i++) T.rest(1 / 60); assert.ok(Math.abs(s.u) < 0.1);
});
test('point contact: follows without any delay; a change of area hardly moves it; renumbered contact goes on', () => {
  const P = new Point('right', 0); let t = 0, p; for (let i = 0; i < 60; i++) p = P.update([{ id: 1, x: i * 4, y: 0, rx: 5, ry: 5 }], (t += 16)); near(p[0], 236, 1e-6);
  const q = P.update([{ id: 1, x: 240 + 2.5, y: 0, rx: 7.5, ry: 6 }], (t += 16)); assert.ok(Math.abs(q[0] - 240) < 0.6, String(q[0]));
  const z = P.update([{ id: 9, x: 244 + 6, y: 1, rx: 7, ry: 6 }], (t += 16)); assert.ok(Math.abs(z[0] - 244) < 4, String(z[0])); for (let i = 0; i < 25; i++) P.update([], (t += 16)); assert.equal(P.p, null);
});
test('prediction at 2 Hz rubbing: a few mm (without: 15 mm), no prediction at rest', () => {
  const at = (t) => [35 * Math.sin(t / 1000 * 12.566), 6 * Math.sin(t / 1000 * 6.283)], L = new Lead(), E = []; let seed = 5; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5;
  for (let t = 0; t < 6000; t += 1000 / 60) { const p = at(t); L.add([p[0] + rnd() * 0.2, p[1] + rnd() * 0.2], t); if (t > 1000) { const a = L.at(t, 50), b = at(t + 50); E.push(Math.hypot(a[0] - b[0], a[1] - b[1])); } } E.sort((a, b) => a - b); assert.ok(E[E.length >> 1] < 4.5, String(E[E.length >> 1])); assert.ok(L.miss < 8 && L.miss > 0.5, String(L.miss));
});
