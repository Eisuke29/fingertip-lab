// What the iPad measures: which contact is the index knuckle, how the iPad is tilted, where the eyes are.
// Nothing here is fixed to a person or a place: tilt and eyes are measured all the time.

// ---------- which contact ----------
// The iPad cannot tell the fingers apart: the person says which finger it is, and it is looked for where that finger is in the row.
// finger: 0 index .. 3 little; pose: 'flat' (the row runs from left to right) or 'side' (thumb up: from far to near). Thumb, palm and wrist lie much nearer to the person (side: to the hand's side).
export function pick(list, finger = 0, hand = 'right', pose = 'flat') {
  const m = hand === 'right' ? 1 : -1, c = Math.cos(0.3), s = Math.sin(0.3), q = list.map((k) => (pose === 'side' ? { k, along: -k.y, out: -k.x * m } : { k, along: (k.x * c + k.y * s * m) * m, out: -k.x * s * m + k.y * c })), top = Math.max(...q.map((o) => o.out)), row = q.filter((o) => o.out > top - 25).sort((x, y) => x.along - y.along), n = row.length;
  const far = row.reduce((x, y) => (y.out > x.out ? y : x)), o = n === 1 ? row[0] : finger === 0 ? row[0] : finger === 3 ? row[n - 1] : n === 2 ? far : finger === 1 ? row[1] : row[n - 2];
  return { ...o.k, row: row.map((x) => x.k) };
}

// ---------- one knuckle ----------
// Only the PIP knuckle touches. The contact itself is followed (no expectation in between, so nothing is late). When its area changes, its
// middle wanders although the hand does not: that part is kept out, and let in again slowly while the hand moves.
export class Point {
  constructor(hand = 'right', finger = 0, pose = 'flat') { Object.assign(this, { hand, finger, pose }); this.jumps = 0; this.reset(); }
  reset() { this.p = null; this.id = null; this.off = [0, 0]; this.v = [0, 0]; this.down = false; this.tSeen = -1e9; }
  update(list, t, hold = 250) {
    if (!list.length) { this.down = false; if (this.p && t - this.tSeen > hold) this.reset(); return this.p; }
    let c = list.find((k) => k.id === this.id);
    if (!c || !this.p || !this.down) {
      const D = (k) => Math.hypot(k.x - this.p[0], k.y - this.p[1]), near = this.p && t - this.tSeen < 120 ? list.reduce((q, k) => (D(k) < D(q) ? k : q)) : null;
      if (near && D(near) < 25) { const g = Math.min(0.05, (t - this.tSeen) / 1000); c = near; this.off = [this.p[0] + this.v[0] * g - c.x, this.p[1] + this.v[1] * g - c.y]; this.jumps++; } // the same knuckle, renumbered
      else { const q = pick(list, this.finger, this.hand, this.pose); c = list.find((k) => k.id === q.id) || list[0]; this.reset(); }
      this.id = c.id; this.last = c; this.t = this.tSeen = t; this.down = true; this.p = [c.x + this.off[0], c.y + this.off[1]]; return this.p;
    }
    const dt = Math.max(0.001, Math.min(0.1, (t - this.t) / 1000)), size = (k) => (k.rx || 0) + (k.ry || 0), dr = Math.abs(size(c) - size(this.last)), d = [c.x - this.last.x, c.y - this.last.y], e = [d[0] - this.v[0] * dt, d[1] - this.v[1] * dt], E = Math.hypot(...e);
    if (dr > 0.15 && E > 0.2) { const keep = Math.min(E, dr * 0.6) / E; this.off = [this.off[0] - e[0] * keep, this.off[1] - e[1] * keep]; } // unexpected, and the area changed: at most as much as the area can explain
    const L = Math.hypot(...this.off), back = dr > 0.15 || L < 0.01 ? 0 : Math.min(1, 0.15 * Math.hypot(...d) / L); this.off = this.off.map((v) => v * (1 - back) * (L > 4 ? 4 / L : 1)); // nothing moves while the hand rests
    const p = [c.x + this.off[0], c.y + this.off[1]], f = 1 - Math.exp(-dt / 0.02); this.v = this.v.map((v, i) => v + ((p[i] - this.p[i]) / dt - v) * f);
    this.p = p; this.last = c; this.t = this.tSeen = t; return p;
  }
}

// Two fingers next to each other. Each keeps its contact. When the iPad takes both for one, both go on with the common movement.
export class Pair {
  constructor(hand = 'right', finger = 0, pose = 'flat') { this.t = [0, 1].map((i) => new Point(hand, finger + i, pose)); Object.assign(this, { hand, pose }); this.merged = null; }
  reset() { for (const q of this.t) q.reset(); this.merged = null; }
  get down() { return this.t.some((q) => q.down); } get p() { return this.t[0].p; } get jumps() { return this.t[0].jumps + this.t[1].jumps; }
  update(list, t) {
    const [A, B] = this.t, size = (k) => (k.rx || 0) + (k.ry || 0), D = (k, q) => Math.hypot(k.x - q.p[0], k.y - q.p[1]); let a = A.down && list.find((k) => k.id === A.id), b = B.down && B.id !== A.id && list.find((k) => k.id === B.id), rest = list.filter((k) => k !== a && k !== b);
    if (this.merged) { // one contact stands for both
      const m = this.merged, c = list.find((k) => k.id === m.id); if (!c || list.length > 1) { this.merged = null; if (!list.length) { A.update([], t); B.update([], t); return; } for (const q of this.t) q.down = false; a = b = null; rest = [...list]; } else { const d = [c.x - m.x, c.y - m.y]; m.x = c.x; m.y = c.y; for (const q of this.t) q.update([{ ...q.last, x: q.last.x + d[0], y: q.last.y + d[1] }], t); return; }
    }
    const lost = [a ? null : A, b ? null : B].filter((q) => q?.down && q.p), kept = a ? A : b ? B : null, kc = a || b;
    if (lost.length === 1 && kept && !rest.length && kept.down && size(kc) > size(kept.last) * 1.2 + 0.8) { // one gone and the other suddenly larger: taken for one
      this.merged = { id: kc.id, x: kc.x, y: kc.y }; for (const q of this.t) q.update([{ ...q.last }], t); return;
    }
    const free = [a ? null : A, b ? null : B].filter(Boolean), give = new Map([[A, a], [B, b]]);
    for (const q of free) if (q.p && t - q.tSeen < 160 && rest.length) { const k = rest.reduce((x, y) => (D(y, q) < D(x, q) ? y : x)); if (D(k, q) < 25) { give.set(q, k); rest.splice(rest.indexOf(k), 1); } }
    const open = free.filter((q) => !give.get(q));
    if (open.length === 2 && rest.length > 1) { const row = pick(rest, A.finger, this.hand, this.pose).row; let i = 0; if (row.length > 2 && A.finger === 2) i = row.length - 2; else if (row.length > 2 && A.finger === 1) i = 1; give.set(A, row[i]); give.set(B, row[i + 1] || rest.find((k) => k !== row[i])); this.t0 = t; } else if (open.length === 2 && rest.length === 1) { give.set(A, rest[0]); this.t0 = t; } else if (open.length === 1 && rest.length) {
      const o = open[0] === A ? B : A, c = give.get(o), k = c ? rest.reduce((x, y) => (Math.hypot(y.x - c.x, y.y - c.y) < Math.hypot(x.x - c.x, x.y - c.y) ? y : x)) : rest[0]; if (!c || Math.hypot(k.x - c.x, k.y - c.y) < 75) { give.set(open[0], k); if (c && t - (this.t0 ?? -1e9) < 400) { const first = pick([c, k], 0, this.hand, this.pose).id; if ((open[0] === A) !== (first === k.id)) { this.t.reverse(); const x = this.t[0].finger; this.t[0].finger = this.t[1].finger; this.t[1].finger = x; this.swapped = true; } } }
    }
    for (const q of [A, B]) { const k = give.get(q); q.update(k ? [k] : [], t); }
  }
}

// ---------- against the delay ----------
// The touch panel, the browser and the display together show everything some 50 ms late. Where the hand will be then is predicted:
// place, speed and acceleration are estimated (Kalman filter; the acceleration dies out) and carried on. Slow: smoothed and not predicted (no trembling).
// The straight-line prediction before this was 12 mm wrong when rubbing at 2 Hz, this one about 5 mm (see the test). What is left is hidden by the shape of the root (miss).
const SJ = 1500, RN = 0.15, TA = 0.16;
export class Lead {
  constructor() { this.reset(); }
  reset() { this.s = null; this.vel = [0, 0]; this.speed = 0; this.miss = 0; this.past = []; }
  add(p, t) {
    if (this.s && t - this.t > 150) this.reset();
    if (!this.s) { this.s = [0, 1].map((k) => ({ x: [p[k], 0, 0], P: [[0.02, 0, 0], [0, 4e4, 0], [0, 0, 4e6]] })); this.t = this.t0 = t; return; }
    const h = (t - this.t) / 1000; if (h < 0.001) return; this.t = t;
    const e = Math.exp(-h / TA), a2 = TA * (1 - e), a1 = TA * (h - a2), q = SJ * SJ * (1 - e * e), F = [[1, h, a1], [0, 1, a2], [0, 0, e]], Q = [[h ** 4 / 20 * q, h ** 3 / 8 * q, h * h / 6 * q], [h ** 3 / 8 * q, h * h / 3 * q, h / 2 * q], [h * h / 6 * q, h / 2 * q, q]]; // must stay positive definite, otherwise it runs away when the hand rests
    for (const k of [0, 1]) {
      const s = this.s[k], x = F.map((r) => r[0] * s.x[0] + r[1] * s.x[1] + r[2] * s.x[2]), G = F.map((r) => [0, 1, 2].map((j) => r[0] * s.P[0][j] + r[1] * s.P[1][j] + r[2] * s.P[2][j])), P = G.map((r, i) => [0, 1, 2].map((j) => r[0] * F[j][0] + r[1] * F[j][1] + r[2] * F[j][2] + Q[i][j])), c = P[0][0] + RN * RN, K = [P[0][0] / c, P[1][0] / c, P[2][0] / c], d = p[k] - x[0];
      s.x = x.map((v, i) => v + K[i] * d); s.x[1] = Math.max(-1500, Math.min(1500, s.x[1])); s.x[2] = Math.max(-9000, Math.min(9000, s.x[2]));
      const U = P.map((r, i) => r.map((v, j) => v - K[i] * P[0][j])); s.P = U.map((r, i) => r.map((v, j) => (v + U[j][i]) / 2));
    }
    // how wrong the predictions made for this moment were
    const w = this.past.find((o) => Math.abs(o.t - t) < 9); if (w) { const m = Math.min(12, Math.hypot(w.x - p[0], w.y - p[1])); this.miss += (m - this.miss) * (m > this.miss ? 0.3 : 0.06); }
  }
  at(now, lead) {
    if (!this.s) return null; const h = (Math.max(0, Math.min(40, now - this.t)) + lead) / 1000, e = Math.exp(-h / TA), a2 = TA * (1 - e), a1 = TA * (h - a2), S = this.s, v = [S[0].x[1], S[1].x[1]], sp = Math.hypot(...v), g = Math.max(0, Math.min(1, (sp - 14) / 40)) * Math.min(1, (this.t - this.t0) / 50), f = g * g * (3 - 2 * g);
    this.speed = sp; this.vel = [v[0] * f, v[1] * f]; const M = Math.max(4, sp * h * 1.35), A = Math.min(1, sp / 160), d = [0, 1].map((k) => (v[k] * h + S[k].x[2] * a1 * A) * f), L = Math.hypot(...d), c = L > M ? M / L : 1, r = [S[0].x[0] + d[0] * c, S[1].x[0] + d[1] * c];
    this.past.push({ t: now + lead, x: r[0], y: r[1] }); if (this.past.length > 24) this.past.shift(); return r;
  }
}

// The root is drawn a little ahead, in the direction of the movement, so that it stays under the hand. max: mm at 120 mm/s and more.
export class Ahead {
  constructor() { this.b = [0, 0]; }
  reset() { this.b = [0, 0]; }
  step(vel, max, dt) {
    const s = Math.hypot(...vel), k = s > 1 ? max * Math.min(1, s / 120) / s : 0, to = [vel[0] * k, vel[1] * k];
    const f = 1 - Math.exp(-dt / (Math.hypot(...to) > Math.hypot(...this.b) ? 0.04 : 0.1)); this.b = this.b.map((v, i) => v + (to[i] - v) * f); return this.b;
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
// The face is found in a worker. If that does not work, here in the page, and then not while the hand moves (it would hold up drawing).
export const TOP = typeof window === 'undefined' ? {} : window;
export const live = () => !!TOP.shell?.stream?.getVideoTracks().some((t) => t.readyState === 'live');
export async function camera() { TOP.shell ||= {}; if (!live()) TOP.shell.stream = await TOP.navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false }); return TOP.shell.stream; }
export function cameraOff() { TOP.shell?.stream?.getTracks().forEach((t) => t.stop()); if (TOP.shell) TOP.shell.stream = null; }
export async function makeEyes() {
  const { EyeTracker } = await import('../sync/eye.js');
  return new (class extends EyeTracker {
    async start(id) {
      if (this.mode !== 'page') {
        try { await this.startWorker(id); return; } catch (e) { if (/Permission|NotAllowed|NotFound|NotReadable/i.test(e.name + e.message)) throw e; this.mode = 'page'; this.worker?.terminate(); this.worker = null; this.workerErr = e.message; }
      }
      cameraOff(); await super.start(id); if (this.lm.slow) return; const lm = this.lm, run = lm.detectForVideo.bind(lm); lm.slow = true; let last = -1e9, res = null;
      lm.detectForVideo = (v, now) => { this.skip = res && (this.busy || now - last < 100); if (this.skip) return res; last = now; res = run(v, now); const c = performance.now() - now; this.cost = this.cost == null ? c : this.cost + (c - this.cost) * 0.1; return res; };
    }
    stop() { this.running = false; this.eye = null; if (this.video) { this.video.pause(); this.video.srcObject = null; } this.video = null; this.status = '停止中'; } // the camera itself stays on
    async startWorker(id) {
      this.stop(); this.status = '前面カメラを起動中…';
      const stream = await camera();
      this.video = document.createElement('video'); this.video.muted = true; this.video.playsInline = true; this.video.srcObject = stream; await this.video.play();
      if (!this.worker) {
        this.status = '顔の認識モデルを読み込み中…'; const w = new Worker(new URL('./eye-worker.js?v=15', import.meta.url));
        await new Promise((res, rej) => { const to = setTimeout(() => rej(new Error('顔の認識の準備が時間切れ')), 25000); w.onmessage = (e) => { if (e.data.type === 'ready') { clearTimeout(to); res(); } else if (e.data.type === 'error') { clearTimeout(to); rej(new Error(e.data.msg)); } }; w.onerror = (e) => { clearTimeout(to); rej(new Error(e.message || 'worker')); }; w.postMessage({ type: 'init' }); });
        this.worker = w; this.mode = 'worker';
      }
      this.running = true; this.status = '顔を探しています'; this.f.forEach((f) => f.reset()); let waiting = false, last = -1e9, sent = 0;
      this.worker.onmessage = (e) => {
        waiting = false; const m = e.data; if (!this.running || !this.video) return; if (m.skin) this.skin = m.skin;
        if (m.type !== 'eyes') { this.status = `顔を認識できません（${m.msg}）`; return; }
        this.cost = this.cost == null ? m.ms : this.cost + (m.ms - this.cost) * 0.1;
        if (!m.pts) { this.status = '顔が見えません（画面の正面に座ってください）'; return; }
        const L = []; L[468] = m.pts[0]; L[473] = m.pts[1]; super.solve(L, m.t); this.at = performance.now();
      };
      const loop = async () => {
        if (!this.running || !this.video) return; const now = performance.now();
        if ((!waiting || now - sent > 2000) && now - last > 45) { waiting = true; last = sent = now; try { const bitmap = await createImageBitmap(this.video); this.worker.postMessage({ type: 'frame', bitmap, t: now }, [bitmap]); } catch { waiting = false; } }
        this.video?.requestVideoFrameCallback(loop);
      };
      this.video.requestVideoFrameCallback(loop);
    }
    solve(L, now) { if (this.skip) return; super.solve(L, now); this.at = performance.now(); }
    get fresh() { return !!this.eye && performance.now() - this.at < 700; }
  })();
}
// The eye used for drawing: the measured one, held for a moment when the face is lost, then the default. Never jumps.
export class Eye {
  constructor() { this.e = null; this.src = 'default'; }
  // hold: the face was lost: the last place is kept (the person may be looking from the side just then)
  update(measured, fallback, t, hold = true) {
    if (measured) { this.last = measured; this.tLast = t; }
    const held = hold && !!this.last, target = measured || (held ? this.last : fallback);
    this.src = measured ? 'measured' : held ? 'held' : 'default';
    if (!this.e) { this.e = [...target]; this.t = t; return this.e; }
    const dt = Math.min(0.1, (t - this.t) / 1000); this.t = t;
    if (this.src !== this.srcBefore) this.blend = this.srcBefore === undefined ? 0 : 0.5; // half a second to change over
    this.srcBefore = this.src; this.blend = Math.max(0, (this.blend || 0) - dt);
    const tau = this.src === 'default' || this.blend > 0 ? 0.18 : 0.04, f = tau ? 1 - Math.exp(-dt / tau) : 1;
    this.e = this.e.map((v, i) => v + (target[i] - v) * f); return this.e;
  }
}
