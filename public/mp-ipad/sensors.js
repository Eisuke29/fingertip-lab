// What the iPad measures: which contact is the index knuckle, how the iPad is tilted, where the eyes are.
// Nothing here is fixed to a person or a place: tilt and eyes are measured all the time.

// ---------- where the hand is ----------
// In the fist the backs of several fingers touch, and the iPad keeps splitting and merging them. So no single contact is trusted:
// the place is taken once, when the hand lands (index finger), and from then on only the common movement of all contacts is added.
export class Contact {
  constructor(hand = 'right', yaw = 0.28) { this.hand = hand; this.yaw = yaw; this.jumps = 0; this.reset(); }
  reset() { this.p = null; this.id = null; this.prev = new Map(); this.v = [0, 0]; this.tSeen = -1e9; this.down = false; this.n = 0; this.rej = null; }
  // the index finger: first along the row of knuckles, among the contacts that are not much nearer to the person (thumb, palm)
  index(list) {
    const m = this.hand === 'right' ? 1 : -1, y = Math.abs(this.yaw) * m, c = Math.cos(y), s = Math.sin(y), q = list.map((k) => ({ k, along: (k.x * c + k.y * s) * m, far: -k.x * s + k.y * c })), top = Math.max(...q.map((o) => o.far));
    const first = q.filter((o) => o.far > top - 25).reduce((a, b) => (b.along < a.along ? b : a)).k, near = list.filter((k) => Math.hypot(k.x - first.x, k.y - first.y) < 12); // one finger may give several contacts: their middle
    let A = 0, x = 0, y2 = 0; for (const k of near) { const w = Math.max(0.5, (k.rx || 1) * (k.ry || 1)); A += w; x += w * k.x; y2 += w * k.y; }
    return { ...first, x: x / A, y: y2 / A };
  }
  land(list, t) { const f = this.index(list); this.p = [f.x, f.y]; this.id = f.id; this.size = Math.max(1, (f.rx || 0) + (f.ry || 0)); this.t0 = this.tN = t; this.v = [0, 0]; this.rej = null; this.keep(list, t, new Map()); return this.p; }
  keep(list, t, old) { this.prev = new Map(list.map((k) => [k.id, { x: k.x, y: k.y, r: (k.rx || 0) + (k.ry || 0), t0: old.get(k.id)?.t0 ?? t }])); if (list.length !== this.n) this.tN = t; this.n = list.length; this.tSeen = this.tLast = t; this.down = true; }
  // list: [{id, x, y, rx, ry}] in mm, t in ms. Returns the place of the index contact, or null when nothing has touched for `hold` ms
  update(list, t, hold = 300) {
    if (!list.length) { this.down = false; this.n = 0; this.prev = new Map(); if (this.p && t - this.tSeen > hold) this.reset(); return this.p; }
    if (!this.p) return this.land(list, t);
    const old = this.prev;
    if (!this.down) { // back after a short loss: go on from the same place, unless it is somewhere else
      if (t - this.tSeen > 150 || Math.min(...list.map((k) => Math.hypot(k.x - this.p[0], k.y - this.p[1]))) > 30) return this.land(list, t);
      const g = (t - this.tSeen) / 1000; this.p = this.p.map((x, i) => x + this.v[i] * g); this.jumps++; this.keep(list, t, old); return this.p;
    }
    if (t - this.t0 < 350) { // the index may land a moment after its neighbours
      const f = this.index(list), c = list.find((k) => k.id === this.id); if (c && f.id !== this.id && Math.hypot(f.x - c.x, f.y - c.y) > 6 && !old.has(f.id)) { const t0 = this.t0; this.land(list, t); this.t0 = t0; return this.p; }
    }
    const dt = Math.max(0.001, Math.min(0.1, (t - this.tLast) / 1000)), pr = [this.v[0] * dt, this.v[1] * dt], gate = 5 + 0.6 * Math.hypot(...pr);
    const ds = []; for (const k of list) { const o = old.get(k.id); if (o) { const g = (k.rx || 0) + (k.ry || 0) - o.r; ds.push({ d: [k.x - o.x, k.y - o.y], w: (t - o.t0 < 60 ? 0.3 : 1) / (1 + g * g / 4) }); } }
    let step = pr; const off = (q, r) => Math.hypot(q[0] - r[0], q[1] - r[1]);
    if (ds.length) {
      let good = ds.filter((q) => off(q.d, pr) <= gate);
      if (!good.length) { // all far from what was expected: a real fast start when they agree or when it goes on, otherwise a shape change
        const m = mean(ds), same = ds.length > 1 && ds.length === list.length && list.length === this.n && ds.every((q) => off(q.d, m) < 3 && q.w > 0.5), goes = this.rej && off(m, this.rej) < gate; this.rej = m;
        if (same || goes) good = ds; else this.jumps++; // the hand is taken to go on as before
      } else this.rej = null;
      if (good.length >= 3) step = [median(good, 0), median(good, 1)];
      else if (good.length === 2 && off(good[0].d, good[1].d) > 2.5) step = good.reduce((x, y) => (off(y.d, pr) / y.w < off(x.d, pr) / x.w ? y : x)).d;
      else if (good.length) step = mean(good);
    } else this.jumps++;
    this.p = [this.p[0] + step[0], this.p[1] + step[1]];
    const f = 1 - Math.exp(-dt / 0.03); this.v = this.v.map((v, i) => v + (step[i] / dt - v) * f);
    // what is lost by this is won back little by little, hidden in the movement, while the index is clearly separate
    const ix = this.index(list), o = old.get(ix.id);
    if (o && t - o.t0 > 300 && t - this.tN > 300 && (ix.rx || 0) + (ix.ry || 0) <= this.size * 1.35) { const e = [ix.x - this.p[0], ix.y - this.p[1]], L = Math.hypot(...e), c = Math.min(L, 0.1 * Math.hypot(...step)); if (L > 0.01 && L < 15) this.p = [this.p[0] + e[0] / L * c, this.p[1] + e[1] / L * c]; }
    this.keep(list, t, old); return this.p;
  }
}
const mean = (q) => { const w = q.reduce((s, k) => s + k.w, 0); return [0, 1].map((i) => q.reduce((s, k) => s + k.d[i] * k.w, 0) / w); };
const median = (q, i) => { const a = [...q].sort((x, y) => x.d[i] - y.d[i]), h = a.reduce((s, k) => s + k.w, 0) / 2; let c = 0; for (const k of a) { c += k.w; if (c >= h) return k.d[i]; } return a[a.length - 1].d[i]; };

// ---------- against the delay ----------
// The touch panel, the browser and the display together show everything some 50 ms late. Where the hand will be then is
// predicted from its speed over the last moments. Slow: smoothed and not predicted (no trembling). Fast: predicted and not smoothed.
export class Lead {
  constructor() { this.q = []; this.vel = [0, 0]; this.speed = 0; }
  reset() { this.q = []; this.vel = [0, 0]; this.speed = 0; this.sv = null; }
  add(p, t) { const l = this.q[this.q.length - 1]; if (l && t - l.t < 1) { l.x = p[0]; l.y = p[1]; return; } this.q.push({ x: p[0], y: p[1], t }); while (this.q.length > 2 && t - this.q[0].t > 55) this.q.shift(); }
  at(now, lead) {
    const q = this.q, n = q.length; if (!n) return null; const l = q[n - 1]; if (n < 3 || l.t - q[0].t < 12) { this.vel = [0, 0]; return [l.x, l.y]; }
    let mt = 0, mx = 0, my = 0; for (const k of q) { mt += k.t / n; mx += k.x / n; my += k.y / n; }
    let a = 0, bx = 0, by = 0; for (const k of q) { const d = k.t - mt; a += d * d; bx += d * (k.x - mx); by += d * (k.y - my); }
    const k0 = this.sv && now - this.svT < 120 ? Math.exp(-(now - this.svT) / 30) : 0; this.sv = [bx / a + ((this.sv?.[0] || 0) - bx / a) * k0, by / a + ((this.sv?.[1] || 0) - by / a) * k0]; this.svT = now; // the speed is smoothed a little: no jerks
    const [vx, vy] = this.sv, sp = Math.hypot(vx, vy) * 1000, g = Math.max(0, Math.min(1, (sp - 8) / 30)), f = g * g * (3 - 2 * g), fx = mx + vx * (l.t - mt), fy = my + vy * (l.t - mt);
    const T = (Math.max(0, Math.min(40, now - l.t)) + lead) * f; this.speed = sp; this.vel = [vx * 1000 * f, vy * 1000 * f];
    return [fx + (l.x - fx) * f + vx * T, fy + (l.y - fy) * f + vy * T];
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
export async function makeEyes() {
  const { EyeTracker } = await import('../sync/eye.js');
  return new (class extends EyeTracker {
    async start(id) {
      if (this.mode !== 'page') {
        try { await this.startWorker(id); return; } catch (e) { if (/Permission|NotAllowed|NotFound|NotReadable/i.test(e.name + e.message)) throw e; this.mode = 'page'; this.worker?.terminate(); this.worker = null; this.workerErr = e.message; }
      }
      await super.start(id); if (this.lm.slow) return; const lm = this.lm, run = lm.detectForVideo.bind(lm); lm.slow = true; let last = -1e9, res = null;
      lm.detectForVideo = (v, now) => { this.skip = res && (this.busy || now - last < 100); if (this.skip) return res; last = now; res = run(v, now); const c = performance.now() - now; this.cost = this.cost == null ? c : this.cost + (c - this.cost) * 0.1; return res; };
    }
    async startWorker(id) {
      this.stop(); this.status = '前面カメラを起動中…';
      const stream = await navigator.mediaDevices.getUserMedia({ video: { ...(id === 'user' ? { facingMode: 'user' } : { deviceId: id }), width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      this.video = document.createElement('video'); this.video.muted = true; this.video.playsInline = true; this.video.srcObject = stream; await this.video.play();
      if (!this.worker) {
        this.status = '顔の認識モデルを読み込み中…'; const w = new Worker(new URL('./eye-worker.js?v=5', import.meta.url));
        await new Promise((res, rej) => { const to = setTimeout(() => rej(new Error('顔の認識の準備が時間切れ')), 25000); w.onmessage = (e) => { if (e.data.type === 'ready') { clearTimeout(to); res(); } else if (e.data.type === 'error') { clearTimeout(to); rej(new Error(e.data.msg)); } }; w.onerror = (e) => { clearTimeout(to); rej(new Error(e.message || 'worker')); }; w.postMessage({ type: 'init' }); });
        this.worker = w; this.mode = 'worker';
      }
      this.running = true; this.status = '顔を探しています'; this.f.forEach((f) => f.reset()); let waiting = false, last = -1e9, sent = 0;
      this.worker.onmessage = (e) => {
        waiting = false; const m = e.data; if (!this.running || !this.video) return;
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
  update(measured, fallback, t) {
    if (measured) { this.last = measured; this.tLast = t; }
    const held = this.last && t - this.tLast < 1500, target = measured || (held ? this.last : fallback);
    this.src = measured ? 'measured' : held ? 'held' : 'default';
    if (!this.e) { this.e = [...target]; this.t = t; return this.e; }
    const dt = Math.min(0.1, (t - this.t) / 1000); this.t = t;
    if (this.src !== this.srcBefore) this.blend = this.srcBefore === undefined ? 0 : 0.5; // half a second to change over
    this.srcBefore = this.src; this.blend = Math.max(0, (this.blend || 0) - dt);
    const tau = this.src === 'default' || this.blend > 0 ? 0.18 : 0.04, f = tau ? 1 - Math.exp(-dt / tau) : 1;
    this.e = this.e.map((v, i) => v + (target[i] - v) * f); return this.e;
  }
}
