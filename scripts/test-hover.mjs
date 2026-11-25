// node --test scripts/test-hover.mjs : pure parts of public/hover
import test from 'node:test'; import assert from 'node:assert/strict';
import { Meter, choose } from '../public/hover/link.js';
const run = (d, loss = 0, off = 1000) => { const m = new Meter(); let now = 0; for (let i = 0; i < 60; i++) { now += 200; const id = m.ping(now); if ((i % 10) / 10 < loss) continue; m.pong(id, now + d, now + d / 2 + off); } return [m, now]; };
test('meter: round trip, loss, clock difference', () => { const [m] = run(40, 0.2); assert.equal(m.rtt, 40); assert.ok(Math.abs(m.loss - 0.2) < 0.06, String(m.loss)); assert.ok(Math.abs(m.off - 1000) < 1); });
test('the way: whichever works, direct preferred, stays unless clearly worse', () => { const [d, t] = run(20), [r] = run(60), e = new Meter(); assert.equal(choose(d, r, t), 'direct'); assert.equal(choose(e, r, t), 'relay'); assert.equal(choose(d, e, t), 'direct'); assert.equal(choose(e, e, t), null); const [s] = run(70); assert.equal(choose(s, r, t, 'direct'), 'direct'); const [x] = run(200); assert.equal(choose(x, r, t, 'direct'), 'relay'); assert.equal(choose(d, r, t + 5000), null); });
