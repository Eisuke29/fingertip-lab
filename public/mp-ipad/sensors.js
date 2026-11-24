// What the iPad measures: which contact is the index knuckle, how the iPad is tilted, where the eyes are.
// Nothing here is fixed to a person or a place: tilt and eyes are measured all the time.

// ---------- contact of the index finger's proximal phalanx ----------
// In the fist the backs of several fingers may touch. For a right hand the index is the leftmost one.
export class Contact {
  constructor(hand = 'right') { this.hand = hand; this.reset(); }
  reset() { this.id = null; this.p = null; this.bias = [0, 0]; this.t0 = 0; this.tSeen = -1e9; this.jumps = 0; }
  // list: [{id, x, y, ...}] in mm, t in ms. Returns the position, or null when nothing has touched for `hold` ms
  update(list, t, hold = 250) {
    const side = this.hand === 'right' ? 1 : -1;
    if (!list.length) { if (this.p && t - this.tSeen > hold) this.reset(); this.down = false; return this.p; }
    let c = this.id == null ? null : list.find((q) => q.id === this.id);
    const first = list.reduce((a, b) => (b.x * side < a.x * side ? b : a));
    if (!this.p) { this.id = first.id; c = first; this.t0 = t; this.bias = [0, 0]; }
    else if (c && first.id !== c.id && t - this.t0 < 350 && (c.x - first.x) * side > 6) { this.id = first.id; c = first; this.bias = [0, 0]; } // the index landed a moment later than its neighbour
    else if (!c) { // the iPad split or merged the contacts: stay where we are and go on from there
      c = list.reduce((a, b) => (Math.hypot(b.x - this.p[0], b.y - this.p[1]) < Math.hypot(a.x - this.p[0], a.y - this.p[1]) ? b : a));
      this.id = c.id; const d = [this.p[0] - c.x, this.p[1] - c.y]; this.jumps++;
      this.bias = Math.hypot(...d) < 35 ? d : [0, 0];
    }
    const dt = Math.max(0, Math.min(100, t - (this.tLast ?? t))) / 1000; this.tLast = t;
    const f = Math.exp(-dt / 0.8); this.bias = [this.bias[0] * f, this.bias[1] * f];
    this.p = [c.x + this.bias[0], c.y + this.bias[1]]; this.tSeen = t; this.down = true; this.n = list.length; return this.p;
  }
}

// ---------- tilt ----------
// g: accelerationIncludingGravity (device axes: x right, y up in portrait, z out of the screen). iOS and Android have opposite signs,
// and landscape may be either way round: the screen faces up and its upper edge is the higher one, so only the sizes are used.
export function tiltOf(g, landscape) {
  const n = Math.hypot(g.x, g.y, g.z); if (!(n > 5)) return null;
  const along = Math.abs(landscape ? g.x : g.y), across = Math.abs(landscape ? g.y : g.x);
  return { tilt: Math.atan2(along, Math.abs(g.z)) * 180 / Math.PI, roll: Math.asin(Math.min(1, across / n)) * 180 / Math.PI };
}
export class Tilt {
  constructor() { this.v = []; this.deg = null; this.roll = 0; this.still = false; }
  add(g, landscape, t) {
    this.v.push({ t, x: g.x, y: g.y, z: g.z }); while (t - this.v[0].t > 1000) this.v.shift();
    const m = (k) => this.v.reduce((s, q) => s + q[k], 0) / this.v.length, r = tiltOf({ x: m('x'), y: m('y'), z: m('z') }, landscape);
    if (!r) return; this.roll = r.roll;
    const a = this.v.map((q) => tiltOf(q, landscape)?.tilt ?? r.tilt);
    this.moving = Math.max(...a) - Math.min(...a) >= 2; this.still = this.v.length >= 15 && t - this.v[0].t > 700 && !this.moving;
    this.deg = r.tilt;
  }
}
// the direction "up" of the real world, in the screen frame
export const upOf = (deg) => [0, Math.sin(deg * Math.PI / 180), Math.cos(deg * Math.PI / 180)];
// an eye `back` mm toward the person, `height` mm above and `side` mm to the right of the screen centre (real world) -> screen frame
export function eyeFrom(deg, back, height, side = 0) {
  const p = deg * Math.PI / 180;
  return [side, -back * Math.cos(p) + height * Math.sin(p), back * Math.sin(p) + height * Math.cos(p)];
}
export function eyeToWorld(deg, e) { const p = deg * Math.PI / 180; return { back: -e[1] * Math.cos(p) + e[2] * Math.sin(p), height: e[1] * Math.sin(p) + e[2] * Math.cos(p), side: e[0] }; }

// ---------- eyes (front camera) ----------
// sideways and up-down do not depend on the camera's field of view, the distance does: `zScale` is found once per iPad (40 cm button)
export async function makeEyes() {
  const { EyeTracker } = await import('../sync/eye.js');
  return new (class extends EyeTracker {
    solve(L, now) { super.solve(L, now); this.at = performance.now(); this.n = (this.n || 0) + 1; }
    get fresh() { return !!this.eye && performance.now() - this.at < 500; }
  })();
}
// The eye used for drawing: the measured one, held for a moment when the face is lost, then the default. Never jumps.
export class Eye {
  constructor() { this.e = null; this.src = 'default'; }
  update(measured, fallback, t) {
    if (measured) { this.last = measured; this.tLast = t; }
    const held = this.last && t - this.tLast < 1500, target = measured || (held ? this.last : fallback);
    this.src = measured ? 'measured' : held ? 'held' : 'default';
    if (!this.e) { this.e = [...target]; this.t = t; return this.e; }
    const dt = Math.min(0.1, (t - this.t) / 1000); this.t = t;
    if (this.src !== this.srcBefore) this.blend = this.srcBefore === undefined ? 0 : 0.5; // half a second to change over
    this.srcBefore = this.src; this.blend = Math.max(0, (this.blend || 0) - dt);
    const tau = this.src === 'default' || this.blend > 0 ? 0.18 : 0, f = tau ? 1 - Math.exp(-dt / tau) : 1;
    this.e = this.e.map((v, i) => v + (target[i] - v) * f); return this.e;
  }
}
