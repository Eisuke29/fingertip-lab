// node scripts/test-mp-ipad.mjs : checks of the pure parts of public/mp-ipad
import test from 'node:test';
import assert from 'node:assert/strict';
import * as F from '../public/mp-ipad/finger.js';
import * as W from '../public/mp-ipad/world.js';
import { THINGS, makeThing } from '../public/mp-ipad/objects.js';
import { pick, Point, Pair, Lead, Ahead, tiltOf, Tilt, eyeFrom, eyeToWorld, upOf, Eye } from '../public/mp-ipad/sensors.js';

const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) <= e, `${a} vs ${b}`), R = Math.PI / 180, BASE = [43, 25, 25], D = (a, b) => Math.hypot(...a.map((v, j) => v - b[j]));
// every way of touching: joint / fingertip, flat / thumb up, four fingers
const WAYS = []; for (const contact of ['joint', 'tip']) for (const pose of ['flat', 'side']) for (const k of F.ORDER) WAYS.push({ contact, pose, who: [k] });
const way = (w, soft = 0.5, root = [0, 0]) => ({ contact: w.contact, len: F.lengths(BASE, w.who, w.contact, w.contact === 'tip' ? 1 : 1.5), dir: w.contact === 'tip' ? [0, -48 * R] : [0, 0], yaw: -(w.pose === 'side' ? 90 : 8) * R, soft, root: [...root, F.CONTACTS[w.contact].h] }), lowOf = (o) => F.restTip(o)[2] - F.RF;
test('16 ways of touching: the finger starts at the contact, keeps its lengths, reaches into the screen; the palm looks to the person, with the thumb up to the left', () => {
  assert.equal(WAYS.length, 16); for (const w of WAYS) { const o = way(w, 0.5, [4, 7]), f = F.solve(o), A = F.aim(o.dir, o.yaw); assert.deepEqual(f.P[0], o.root); o.len.forEach((l, i) => near(D(f.P[i], f.P[i + 1]), l, 1e-9)); assert.ok(f.tip[2] < -30); near(F.dot(A.u, A.n), 0); if (w.pose === 'side') assert.ok(A.n[0] < -0.9); else assert.ok(A.n[1] < -0.5); assert.equal(f.P.length, w.contact === 'tip' ? 4 : 3); }
});
test('the four fingers differ in length; two fingers reach equally deep', () => {
  const L = (who) => F.lengths(BASE, who, 'tip').reduce((a, b) => a + b, 0); assert.ok(L(['middle']) > L(['ring']) && L(['ring']) > L(['index']) && L(['index']) > L(['little'])); near(L(['index', 'middle']), (L(['index']) + L(['middle'])) / 2, 1e-9);
});
test('joints: to the palm side more than back, sideways almost not, limp much more than stiff', () => {
  for (const w of WAYS) { const q = [0, 0.5, 1].map((s) => F.reach(way(w, s))); for (const r of q.slice(0, 2)) { assert.ok(r.palm > r.back * 1.2, `${w.contact} ${w.pose} ${r.palm} ${r.back}`); assert.ok(r.side < r.palm * 0.5); } assert.ok(q[0].side < 0.01 && q[1].side < 19 && q[2].side > 7, `${w.contact} ${w.pose} ${w.who} ${q.map((r) => r.side)}`); assert.ok(q[0].palm < q[1].palm && q[1].palm < q[2].palm); }
});
test('the finger goes where it can: what within() allows is what solve() draws; 0 = it does not give way at all', () => {
  for (const w of WAYS) for (const soft of [0, 0.5, 1]) { const o = way(w, soft), r = F.reach(o); for (let a = 0; a < 6.28; a += 0.4) { const l = F.within(r, [25 * Math.cos(a), 25 * Math.sin(a), 0]), s = F.solve({ ...o, lag: l }); s.P.slice(1).forEach((p, i) => near(D(p, s.P[i]), o.len[i], 1e-9)); if (soft < 1) assert.ok(Math.hypot(s.lag[0] - l[0], s.lag[1] - l[1]) < 4, `${JSON.stringify(w)} ${soft} ${l} ${s.lag}`); } assert.deepEqual(F.within(r, [9, 9, 0], 0), [0, 0, 0]); }
});
test('something in the way: the fingertip comes up to the wanted height, continuously', () => {
  for (const w of WAYS) for (const soft of [0, 0.5, 1]) { const o = way(w, soft), z0 = F.restTip(o)[2]; let last = null; for (let h = 0; h < 14; h += 0.5) { const s = F.solve({ ...o, lo: z0 + h }); assert.ok(s.tip[2] > z0 + h - 0.05, `${w.contact} ${w.pose} ${soft} ${h}`); if (last) assert.ok(D(s.tip, last) < 6, `jump ${D(s.tip, last)}`); last = s.tip; } }
});
test('a surface: the fingertip touches it and does not go through', () => {
  for (const w of WAYS) for (const soft of [0, 0.5, 1]) { const o = way(w, soft), surf = lowOf(o) + F.PRESS, r = F.reach(o); for (let a = 0; a < 6.28; a += 0.5) { const s = F.solve({ ...o, lag: F.within(r, [20 * Math.cos(a), 20 * Math.sin(a), 0]), lo: surf + F.RF - F.PRESS - 1.8, hi: surf + F.RF - 0.3 }); assert.ok(s.tip[2] - F.RF > surf - F.PRESS - 1.9, 'through'); if (w.contact === 'joint' && soft < 1 && a < 0.1) assert.ok(s.tip[2] - F.RF < surf + 2.5); } }
});
test('stick and slip; same at 60 and 120 Hz; never more than 30 mm behind; what the finger does not do is left for the material', () => {
  const run = (hz) => { const t = new F.Tip(); let max = 0; t.step([0, 0], F.MATS.knit, 0.02); for (let i = 0; i < hz; i++) { t.step([i / hz * 60, 0], F.MATS.knit, 1 / hz); max = Math.max(max, Math.hypot(...t.lag)); } return [max, t.lag[0]]; };
  const a = run(60), b = run(120); assert.ok(a[0] > 20 && a[0] <= 25, String(a)); near(a[0], b[0], 1.5); near(a[1], b[1], 2.5);
  const t = new F.Tip(); t.step([0, 0], F.MATS.honey, 0.02); t.step([200, 0], F.MATS.honey, 0.02, () => [0, 0, 0]); assert.ok(Math.hypot(...t.raw) <= 30.0001 && Math.hypot(...t.raw) > 20); assert.deepEqual(t.lag, [0, 0, 0]);
});
test('which contact: the chosen finger in the row, not thumb or palm; left hand mirrored; thumb up: the row runs downward', () => {
  const row = [0, 1, 2, 3].map((i) => ({ id: i, x: i * 20, y: [0, 4, 2, -6][i] })), q = [...row, { id: 9, x: -15, y: -60 }]; for (let f = 0; f < 4; f++) assert.equal(pick(q, f).id, f); for (let f = 0; f < 4; f++) assert.equal(pick(q.map((k) => ({ ...k, x: -k.x })), f, 'left').id, f);
  const col = [0, 1, 2, 3].map((i) => ({ id: i, x: [0, -3, 0, 6][i], y: -i * 20 })); for (let f = 0; f < 4; f++) assert.equal(pick([...col, { id: 8, x: 60, y: -30 }], f, 'right', 'side').id, f); assert.equal(pick([row[1]], 3).id, 1);
});
test('prediction: the remaining delay is small at stroking speed, still hand does not tremble, stopping does not shoot far', () => {
  const L = new Lead(), at = (t) => [45 * Math.sin(t / 1000 * 3), 0]; let e = 0; for (let t = 0; t < 4000; t += 8) { L.add(at(t), t); if (t > 100) e = Math.max(e, Math.abs(L.at(t + 5, 45)[0] - at(t + 50)[0])); } assert.ok(e < 3, String(e)); // without prediction 6.7 mm
  const S = new Lead(); let seed = 3, lo = 9, hi = -9; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647; for (let t = 0; t < 2000; t += 8) { S.add([(rnd() - 0.5) * 0.3, 0], t); if (t > 100) { const x = S.at(t, 45)[0]; lo = Math.min(lo, x); hi = Math.max(hi, x); } } assert.ok(hi - lo < 0.7, String(hi - lo));
});
test('the root goes ahead in the direction of the movement, within the limit, and comes back at rest', () => {
  const A = new Ahead(); let b; for (let i = 0; i < 30; i++) b = A.step([300, 0], 8, 0.016); near(b[0], 8, 0.05); near(b[1], 0);
  for (let i = 0; i < 30; i++) b = A.step([0, -60], 8, 0.016); near(b[1], -4, 0.1); for (let i = 0; i < 60; i++) b = A.step([0, 0], 8, 0.016); assert.ok(Math.hypot(...b) < 0.1);
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
test('eye never jumps when the face is lost or found', () => {
  const E = new Eye(); let t = 0, prev = null, maxStep = 0; const go = (m, n) => { for (let i = 0; i < n; i++) { const e = [...E.update(m, [0, -175, 553], (t += 16))]; if (prev) maxStep = Math.max(maxStep, Math.hypot(...e.map((v, j) => v - prev[j]))); prev = e; } };
  go([-200, -175, 553], 30); go(null, 150); go([-200, -150, 500], 60); assert.ok(maxStep < 30, String(maxStep)); assert.equal(E.src, 'measured');
});

test('a lost face keeps the last view', () => { const E = new Eye(); for (let i = 0; i < 60; i++) E.update([-150, -175, 553], [0, -175, 553], i * 16); for (let i = 60; i < 600; i++) E.update(null, [0, -175, 553], i * 16); near(E.e[0], -150, 1); for (let i = 600; i < 1200; i++) E.update(null, [0, -175, 553], i * 16, false); near(E.e[0], 0, 1); });
test('point contact: follows without any delay; a change of area hardly moves it; renumbered contact goes on', () => {
  const P = new Point('right', 0); let t = 0, p; for (let i = 0; i < 60; i++) p = P.update([{ id: 1, x: i * 4, y: 0, rx: 5, ry: 5 }], (t += 16)); near(p[0], 236, 1e-6);
  const q = P.update([{ id: 1, x: 240 + 2.5, y: 0, rx: 7.5, ry: 6 }], (t += 16)); assert.ok(Math.abs(q[0] - 240) < 0.6, String(q[0]));
  const z = P.update([{ id: 9, x: 244 + 6, y: 1, rx: 7, ry: 6 }], (t += 16)); assert.ok(Math.abs(z[0] - 244) < 4, String(z[0])); for (let i = 0; i < 25; i++) P.update([], (t += 16)); assert.equal(P.p, null);
});
test('prediction at 2 Hz rubbing: a few mm (without: 15 mm), no prediction at rest', () => {
  const at = (t) => [35 * Math.sin(t / 1000 * 12.566), 6 * Math.sin(t / 1000 * 6.283)], L = new Lead(), E = []; let seed = 5; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5;
  for (let t = 0; t < 6000; t += 1000 / 60) { const p = at(t); L.add([p[0] + rnd() * 0.2, p[1] + rnd() * 0.2], t); if (t > 1000) { const a = L.at(t, 50), b = at(t + 50); E.push(Math.hypot(a[0] - b[0], a[1] - b[1])); } } E.sort((a, b) => a - b); assert.ok(E[E.length >> 1] < 4.5, String(E[E.length >> 1])); assert.ok(L.miss < 8 && L.miss > 0.5, String(L.miss));
});

// ---------- things ----------
const EFFECTS = [[1, 1], [1, 0], [0, 1.3], [0, 0], [1.6, 1.6]]; // how much the finger is held back, how much the thing gives way
const wander = (t) => [62 * Math.sin(t * 1.3), 40 * Math.sin(t * 0.83)];
function stroke(kind, w, [gain, go], secs, at, soft = 0.5) {
  const low = lowOf(way(w, soft)), T = makeThing(kind, 146, 100, low, 165), r = F.reach(way(w, soft)), fit = (l) => F.within(r, l, gain > 0 ? 1 : 0), out = [];
  for (let i = 0; i < secs * 60; i++) { const o = { ...way(w, soft, at(i / 60)), reach: r }, rest = F.restTip(o), lag = T.step(0, rest, 1 / 60, { fit, gain, go }), f = T.w ? W.settle(T.w, { ...o, lag }) : F.solve({ ...o, lag }); T.world(1 / 60); out.push({ lag: Math.hypot(...lag), tip: f.tip, p: [...T.f[0].p], rest }); } return [T, out];
}
const FEW = [WAYS[0], WAYS[5], WAYS[9], WAYS[15]];
test('every thing, every way to feel it: finite, no jumps, the finger is held back only when it should be', () => {
  for (const [kind] of THINGS) for (const w of FEW) for (const e of EFFECTS) { const [, q] = stroke(kind, w, e, 6, wander); let jump = 0; q.forEach((o, i) => { assert.ok(o.tip.every(Number.isFinite), `${kind} ${e}`); if (i) jump = Math.max(jump, D(o.tip, q[i - 1].tip)); }); assert.ok(jump < 27, `${kind} ${w.contact} ${w.pose} ${e} jump ${jump}`); const most = Math.max(...q.map((o) => o.lag)); if (e[0] === 0) assert.ok(most < 1e-6, `${kind} ${most}`); else if (w === WAYS[0]) assert.ok(most > 1.5, `${kind} ${e} ${most}`); }
});
test('every thing gives way when it should', () => {
  const size = (T) => (T.strings ? Math.max(...T.strings.map((s) => Math.abs(s.u))) : T.posts ? Math.max(...T.posts.map((b) => Math.hypot(b.u, b.w))) : T.pool ? Math.max(...T.vx.map(Math.abs)) / 5 : T.w ? Math.max(...T.w.objs.map((o) => Math.hypot(o.ox, o.oy))) : T.threads ? T.threads.length : null);
  for (const kind of ['harp', 'lyre', 'grass', 'slime', 'slimetop', 'cube', 'bumps', 'soft', 'posts']) { const most = (e) => { let m = 0; const low = lowOf(way(WAYS[0])), T = makeThing(kind, 146, 100, low, 165), r = F.reach(way(WAYS[0])); for (let i = 0; i < 400; i++) { T.step(0, F.restTip(way(WAYS[0], 0.5, wander(i / 60))), 1 / 60, { fit: (l) => F.within(r, l, e[0] > 0 ? 1 : 0), gain: e[0], go: e[1] }); T.world(1 / 60); m = Math.max(m, size(T)); } return m; }; const thing = most([0, 1.3]); assert.ok(thing > 0.8, `${kind} ${thing}`); if (kind !== 'grass') assert.ok(most([1, 0]) < thing * 0.75, `${kind} finger only ${most([1, 0])} thing ${thing}`); }
});
test('solid things: the finger is never inside anything', () => {
  for (const kind of ['cube', 'bumps', 'soft']) for (const w of FEW) for (const e of EFFECTS) { const [T, q] = stroke(kind, w, e, 8, wander); let worst = 0; void T; const low = lowOf(way(w)), T2 = makeThing(kind, 146, 100, low, 165), r = F.reach(way(w)); for (let i = 0; i < 480; i++) { const o = { ...way(w, 0.5, wander(i / 60)), reach: r }, lag = T2.step(0, F.restTip(o), 1 / 60, { fit: (l) => F.within(r, l, e[0] > 0 ? 1 : 0), gain: e[0], go: e[1] }), f = W.settle(T2.w, { ...o, lag }); worst = Math.max(worst, W.ground(T2.w, f.tip[0], f.tip[1]).z - f.tip[2]); T2.world(1 / 60); } assert.ok(worst < (kind === 'soft' ? 2.2 : 1.6), `${kind} ${w.contact} ${w.pose} ${e} inside ${worst}`); assert.ok(q.length); }
});
test('boxes: the heavy one needs a stronger bend before it moves, and moves less; never inside', () => {
  const go = (i) => { const T = makeThing('push', 146, 100, -67, 165), b = T.boxes[i], x0 = b.x; let first = null, lag = 0; for (let k = 0; k < 150; k++) { T.step(0, [x0 - b.a - 14 + k * 0.16, b.y, -59], 1 / 60, {}); if (first == null && Math.abs(b.x - x0) > 0.2) first = lag; lag = Math.hypot(...T.f[0].lag); } return [first ?? 99, b.x - x0]; }, r = [0, 1, 2].map(go); assert.ok(r[0][0] < r[1][0] && r[1][0] < r[2][0], JSON.stringify(r)); assert.ok(r[0][1] > r[2][1], JSON.stringify(r));
  for (const e of EFFECTS) { const [T, q] = stroke('push', WAYS[0], e, 20, (t) => [90 * Math.sin(t * 1.9), 50 * Math.sin(t * 1.21)]); void T; assert.ok(q.every((o) => o.p.every(Number.isFinite))); }
});
test('guitar: strings run from left to right, are caught, let go, tremble, come to rest; only with a finger across them', () => {
  const T = makeThing('harp', 146, 100, -67, 165), s = T.strings[2]; let held = 0, u = 0; for (let k = 0; k < 120; k++) { T.step(0, [0, s.y - 20 + k * 0.5, -30], 1 / 60, {}); T.world(1 / 60); if (s.held.length) held++; u = Math.max(u, Math.abs(s.u)); } assert.ok(held > 5 && u > 3, `${held} ${u}`); T.reset(); for (let i = 0; i < 600; i++) T.world(1 / 60); assert.ok(Math.abs(s.u) < 0.1 && !s.held.length);
  { const V = makeThing('lyre', 146, 100, -67, 165), v = V.strings[4]; let held = 0, u = 0, lag = 0; assert.equal(V.strings.length, 7); for (let k = 0; k < 120; k++) { const l = V.step(0, [v.y - 20 + k * 0.5, 0, -30], 1 / 60, {}); V.world(1 / 60); if (v.held.length) { held++; lag = Math.max(lag, -l[0]); assert.ok(Math.abs(l[1]) < 1e-9); } u = Math.max(u, Math.abs(v.u)); } assert.ok(held > 5 && u > 3 && lag > 2, `lyre ${held} ${u} ${lag}`); let m = 0; const W2 = makeThing('lyre', 146, 100, -67, 165), x = (W2.strings[3].y + W2.strings[4].y) / 2; for (let k = 0; k < 90; k++) { W2.step(0, [x, -45 + k, -30], 1 / 60, {}); W2.world(1 / 60); m = Math.max(m, ...W2.strings.map((q) => Math.abs(q.u))); } assert.ok(m < 1.5, String(m)); } // the harp: from far to near, plucked sideways; along them nothing happens
  { const V = makeThing('lyre', 146, 100, -67, 165), v = V.strings[3]; let two = 0, first = null; for (let k = 0; k < 60; k++) { const x = v.y - 17 + k * 0.4; V.step(0, [x, 0, -30], 1 / 60, { back: [6, 20, 2] }); V.world(1 / 60); if (v.held.length === 2) two++; if (v.held.length && first == null) first = x; } assert.ok(two > 5 && first < v.y - 12, `side of the finger ${two} ${first - v.y}`); } // a finger that lies aslant catches the string with its side, before the fingertip gets there
  { const w = W.makeWorld('cube', 146, 100, -67, 165); for (const o of w.objs) for (const d of w.deco) if (!d.of) assert.ok(d.top < o.base, 'a pillar reaches into a cube'); assert.ok(w.deco.some((d) => d.of)); } // the cubes slide over what stands between the towers
  const Q = makeThing('harp', 146, 100, -67, 165), y = (Q.strings[1].y + Q.strings[2].y) / 2; let m = 0; for (let k = 0; k < 120; k++) { Q.step(0, [-50 + k, y, -30], 1 / 60, {}); Q.world(1 / 60); m = Math.max(m, ...Q.strings.map((q) => Math.abs(q.u))); } assert.ok(m < 1.5, String(m));
});
test('slime: a third of the finger is in it; stirring makes it flow and mixes it; it comes to rest; faster = held back more', () => {
  const low = lowOf(way(WAYS[0])), T = makeThing('slime', 146, 100, low, 165); near(T.surf - low, (8.2 - low) / 3, 1e-9); const was = T.dye.slice(), lagAt = (v) => { const P = makeThing('slime', 146, 100, low, 165); for (let i = 0; i < 40; i++) { P.step(0, [-40 + v * i / 60, 0, low], 1 / 60, {}); P.world(1 / 60); } return Math.hypot(...P.f[0].lag); };
  for (let i = 0; i < 180; i++) { T.step(0, [25 * Math.cos(i / 12), 25 * Math.sin(i / 12), low], 1 / 60, {}); T.world(1 / 60); } let d = 0; T.dye.forEach((v, i) => { d = Math.max(d, Math.abs(v - was[i])); assert.ok(v >= 0 && v <= 1); }); assert.ok(d > 0.4, String(d)); assert.ok(Math.max(...T.vx) > 10); T.reset(); for (let i = 0; i < 400; i++) T.world(1 / 60); assert.ok(Math.max(...T.vx.map(Math.abs)) < 1 && Math.max(...T.h.map(Math.abs)) < 0.2); assert.ok(lagAt(90) > lagAt(30) * 1.5, `${lagAt(30)} ${lagAt(90)}`); assert.ok(T.h.every(Number.isFinite));
});
test('two fingers: each has its own place, both act on the thing, one can leave', () => {
  for (const [kind] of THINGS) { const T = makeThing(kind, 146, 100, -67, 165); for (let i = 0; i < 300; i++) { const [x, y] = wander(i / 60), a = T.step(0, [x, y, -59], 1 / 60, {}), b = T.step(1, [x + 20, y, -59], 1 / 60, {}); assert.ok([...a, ...b].every(Number.isFinite), kind); if (i === 200) T.reset(1); T.world(1 / 60); } assert.ok(T.f[0].p && T.f[1].p); T.reset(0); assert.equal(T.f[0].p, null); }
});
test('two fingers on the glass: found in order, followed, one lifted and back, taken for one and split again, renumbered', () => {
  for (const pose of ['flat', 'side']) { const P = new Pair('right', 0, pose), at = (i, x, y) => (pose === 'flat' ? [x + i * 20, y + i * 3] : [x, y - i * 20]); let t = 0, worst = 0, jump = 0, prev = null, ids = [1, 2], state = 0, seed = 5; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let k = 0; k < 900; k++) { t += 16; const x = 35 * Math.sin(t / 700), y = 12 * Math.sin(t / 1100), p = [0, 1].map((i) => at(i, x, y)); if (k > 60 && k % 90 === 0) { state = (state + 1) % 3; if (state === 0) ids = ids.map((v) => v + 10); }
      const c = (i) => ({ id: ids[i], x: p[i][0] + (rnd() - 0.5) * 0.2, y: p[i][1] + (rnd() - 0.5) * 0.2, rx: 5, ry: 5 }), list = state === 1 ? [{ id: ids[0], x: (p[0][0] + p[1][0]) / 2, y: (p[0][1] + p[1][1]) / 2, rx: 12, ry: 6 }] : [c(1), c(0)]; P.update(list, t); const q = P.t.map((z) => z.p); assert.ok(q[0] && q[1], `${pose} ${k}`); const e = q.map((v, i) => [v[0] - p[i][0], v[1] - p[i][1]]); worst = Math.max(worst, ...e.map((v) => Math.hypot(...v))); if (prev) jump = Math.max(jump, ...e.map((v, i) => Math.hypot(v[0] - prev[i][0], v[1] - prev[i][1]))); prev = e; }
    assert.ok(worst < 7, `${pose} worst ${worst}`); assert.ok(jump < 5, `${pose} jump ${jump}`); for (let k = 0; k < 30; k++) P.update([], (t += 16)); assert.ok(!P.t[0].p && !P.t[1].p); }
  const Q = new Pair('right', 0); Q.update([{ id: 5, x: 20, y: 0, rx: 5, ry: 5 }], 0); Q.update([{ id: 5, x: 20, y: 0, rx: 5, ry: 5 }, { id: 6, x: 0, y: 0, rx: 5, ry: 5 }], 60); assert.ok(Q.swapped); assert.equal(Q.t[0].p[0], 0); assert.equal(Q.t[1].p[0], 20);
});
