// Things to touch behind the glass, after what earlier pseudo-haptics studies let people touch. Two ways to feel them, each with its own strength:
// the fingertip is held back (o.fit: how far this finger gives way, o.gain), and the thing gives way (o.go). One or two fingers.
// Pure functions, no DOM, no three.js. mm; z out of the screen; forces in mm of finger bending.
import { RF, clamp } from './finger.js?v=12';
import { makeWorld, TipOver, swing as swingWorld } from './world.js?v=12';

// id, name
export const THINGS = [['harp', 'ギターの弦'], ['grass', '草むら'], ['slime', 'スライム（ひたす）'], ['slimetop', 'スライム（表面）'], ['bumps', '山と穴'], ['cube', '立方体'], ['push', '重い箱'], ['soft', 'やわらかい球'], ['posts', 'ばねの棒']];
let seed = 1; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647, H = 1 / 360, Q = 1 - Math.exp(-45 * H), none = [0, 0, 0];

// low: lowest point of the resting fingertip
export function makeThing(kind, W, Hh, low, depth) {
  seed = 42; return new ({ cube: Solid, bumps: Solid, soft: Solid, push: Push, harp: Harp, slime: Pool, slimetop: Slime, posts: Posts, grass: Posts }[kind])(kind, W, Hh, low, depth);
}
const finger = () => ({ p: null, lag: none, on: null, z: 0, d: {} }); // d: what the thing remembers about this finger
// what all have in common: the fingertip is drawn to its resting place and held back by force()
class Thing {
  constructor(kind, W, Hh, low, depth) { Object.assign(this, { kind, W, H: Hh, low, depth }); this.f = [finger(), finger()]; }
  reset(i) { for (const k of i == null ? [0, 1] : [i]) { this.leave?.(this.f[k]); this.f[k] = finger(); } }
  // finger i, its resting place, time. Returns how far the fingertip is displaced
  step(i, target, dt, { fit = (v) => v, gain = 1, go = 1 } = {}) {
    const F = this.f[i]; if (!F.p) { F.p = [target[0], target[1]]; this.land?.(F); }
    const p = F.p, n = Math.max(1, Math.round(dt / H)); F.z = target[2]; F.on = null;
    for (let s = 0; s < n; s++) {
      const f = this.force(F, target, H, gain, go), x = f[0] + target[0] - p[0], y = f[1] + target[1] - p[1], L = Math.hypot(x, y) * Q, c = Math.min(1, 1.5 / Math.max(1e-6, L)); p[0] += x * Q * c; p[1] += y * Q * c;
      this.hard?.(F, target, H, gain, go);
      const l = fit([p[0] - target[0], p[1] - target[1], 0]); if (Math.hypot(target[0] + l[0] - p[0], target[1] + l[1] - p[1]) > 1e-6) { p[0] = target[0] + l[0]; p[1] = target[1] + l[1]; this.yield?.(F); } // the finger gives way no farther: the thing does
    }
    this.after?.(F, target, dt, go); F.lag = [p[0] - target[0], p[1] - target[1], 0]; return F.lag;
  }
  // once per picture, after the fingers: what swings goes on swinging
  world() {}
  force() { return [0, 0]; }
}
// ---------- cubes, hills and holes, soft balls: heights (world.js) ----------
class Solid extends Thing {
  constructor(kind, W, Hh, low, depth) { super(kind, W, Hh, low, depth); this.w = makeWorld(kind, W, Hh, low, depth); this.over = [new TipOver(), new TipOver()]; this.go = 1; }
  reset(i) { super.reset(i); for (const k of i == null ? [0, 1] : [i]) this.over?.[k].reset(); }
  step(i, target, dt, o = {}) { const T = this.over[i], F = this.f[i]; this.go = o.go ?? 1; F.lag = T.step(target, this.w, dt, o); F.p = T.p; F.on = T.obj; F.z = T.z; return F.lag; }
  world(dt) { swingWorld(this.w, this.over.filter((t) => t.p), dt, this.go); }
}
// ---------- boxes to push: nothing moves until the push is strong enough (static friction), then it goes with a jerk; heavy ones later and slower ----------
class Push extends Thing {
  constructor(kind, W, Hh, low, depth) {
    super(kind, W, Hh, low, depth); this.floor = low - 0.6; this.table = 0; this.top = low + 9;
    const u = W / 4; this.boxes = [[-u, 0, 9, 3, 24], [0, 4, 11.5, 8, 12], [u, 0, 14, 14, 6]].map(([x, y, a, hold, v], i) => ({ x, y, a, hold, v, i, moving: false, tilt: [0, 0] }));
  }
  hard(F, target, h, gain, go) {
    const r = RF * 0.92, p = F.p; for (const b of this.boxes) {
      const cx = clamp(p[0], b.x - b.a, b.x + b.a), cy = clamp(p[1], b.y - b.a, b.y + b.a); let nx = p[0] - cx, ny = p[1] - cy, d = Math.hypot(nx, ny), pen;
      if (d > 1e-6) { if (d >= r) { if (d > r + 1) b.moving = false; continue; } nx /= d; ny /= d; pen = r - d; } else { // inside (landed on it): out by the nearest side
        const e = [b.x + b.a - p[0], p[0] - b.x + b.a, b.y + b.a - p[1], p[1] - b.y + b.a], i = e.indexOf(Math.min(...e)); nx = [1, -1, 0, 0][i]; ny = [0, 0, 1, -1][i]; pen = e[i] + r; }
      p[0] += nx * pen; p[1] += ny * pen; F.on = b;
      const push = (p[0] - target[0]) * nx + (p[1] - target[1]) * ny, hold = b.hold * gain; b.lean = [-nx * clamp(push, 0, 12) * go, -ny * clamp(push, 0, 12) * go]; // how far the finger is bent against it; the box tips a little
      if (!b.moving && push > hold) b.moving = true; if (b.moving && push < hold * 0.35) b.moving = false; // starting needs more than keeping it going
      if (b.moving) this.shift(b, -nx * Math.min(1.2, Math.max(0, push - hold * 0.3) * b.v * h), -ny * Math.min(1.2, Math.max(0, push - hold * 0.3) * b.v * h));
    }
  }
  shift(b, dx, dy) { const lim = [this.W / 2 - b.a, this.H / 2 - b.a], ox = b.x, oy = b.y; b.x = clamp(b.x + dx, -lim[0], lim[0]); b.y = clamp(b.y + dy, -lim[1], lim[1]); for (const q of this.boxes) if (q !== b) { const ex = b.a + q.a - Math.abs(b.x - q.x), ey = b.a + q.a - Math.abs(b.y - q.y); if (ex > 0 && ey > 0) { b.x = ox; b.y = oy; } } }
  yield(F) { // the finger bends no farther: the box gives way
    const r = RF * 0.92, p = F.p; for (const b of this.boxes) {
      const cx = clamp(p[0], b.x - b.a, b.x + b.a), cy = clamp(p[1], b.y - b.a, b.y + b.a), dx = p[0] - cx, dy = p[1] - cy, d = Math.hypot(dx, dy); if (d >= r) continue;
      if (d > 1e-6) { b.x -= dx / d * (r - d); b.y -= dy / d * (r - d); } else { const e = [b.x + b.a - p[0], p[0] - b.x + b.a, b.y + b.a - p[1], p[1] - b.y + b.a], i = e.indexOf(Math.min(...e)), s = e[i] + r; b.x -= [1, -1, 0, 0][i] * s; b.y -= [0, 0, 1, -1][i] * s; }
    }
  }
  world(dt) { for (const b of this.boxes) { const t = b.lean || [0, 0]; b.tilt = b.tilt.map((v, i) => v + (t[i] - v) * Math.min(1, dt * 18)); b.lean = null; } }
}
// ---------- guitar: six strings from left to right; caught, drawn along, let go, trembling. From thin to thick ----------
class Harp extends Thing {
  constructor(kind, W, Hh, low, depth) {
    super(kind, W, Hh, low, depth); this.zs = low + RF * 0.72; this.board = low - 1.5; const n = 6, d = (Hh - 12) / n;
    this.strings = Array.from({ length: n }, (_, i) => ({ y: -Hh / 2 + 6 + d * (i + 0.5), r: 0.55 + 0.2 * i, k: 0.26 + 0.13 * i, max: 10 + i, u: 0, v: 0, held: [], hz: 12 - i }));
  }
  land(F) { F.d.s = this.strings.map((s) => ({ side: F.p[1] < s.y ? -1 : 1, free: Math.abs(F.p[1] - s.y) < RF })); }
  leave(F) { for (const s of this.strings) s.held = s.held.filter((h) => h.F !== F); }
  force(F, target, h, gain, go) {
    let f = 0; const p = F.p; this.strings.forEach((s, i) => {
      const m = F.d.s[i], R = RF * 0.6 + s.r, d = p[1] - s.y; if (m.free && Math.abs(d) > R + 0.5) { m.free = false; m.side = d < 0 ? -1 : 1; }
      const u = m.side < 0 ? d + R : d - R, caught = !m.free && (m.side < 0 ? u > 0 : u < 0) && gain + go > 0.04, k = s.held.findIndex((q) => q.F === F);
      if (caught) { // the string gives way by go, the finger by gain
        f -= s.k * (go > 0.05 ? 1.4 / Math.max(0.5, go) : 5) * u * Math.max(gain, 0.02); if (k < 0) s.held.push({ F, u, x: p[0] }); else Object.assign(s.held[k], { u, x: p[0] }); s.u = u; s.v = 0; F.on = s;
        if (Math.abs(u) > s.max * (0.12 + 0.88 * Math.min(1.6, go)) || Math.abs(target[1] - p[1]) > 4 + 11 * Math.min(1.6, gain)) { m.free = true; s.held = s.held.filter((q) => q.F !== F); s.u *= Math.max(0.5, go); }
      } else if (k >= 0) s.held.splice(k, 1);
    });
    return [0, f];
  }
  world(dt) { for (const s of this.strings) if (!s.held.length) for (let t = 0; t < dt; t += H) tremble(s, H); }
}
function tremble(s, h) { const w = 6.283 * s.hz; s.v += (-w * w * s.u - 3.2 * s.v) * h; s.u += s.v * h; if (Math.abs(s.u) < 0.01 && Math.abs(s.v) < 0.5) s.u = s.v = 0; }
// ---------- slime, surface only: threads stretch between the fingertip and the surface, get thin and break one after the other ----------
class Slime extends Thing {
  constructor(kind, W, Hh, low, depth) { super(kind, W, Hh, low, depth); this.floor = null; this.threads = []; this.flat = true; }
  leave(F) { for (const t of this.threads) if (t.F === F && !t.cut && F.p) { t.cut = true; t.ex = F.p[0]; t.ey = F.p[1]; } }
  force(F, target, h, gain) { let x = 0, y = 0; for (const t of this.threads) if (!t.cut && t.F === F) { x += (t.x - F.p[0]) * 0.09; y += (t.y - F.p[1]) * 0.09; } const L = Math.hypot(x, y), m = 13 * gain; if (L > m) { x *= m / L; y *= m / L; } return gain > 0.02 ? [x, y] : [0, 0]; }
  after(F, target, dt, go) {
    const p = F.p, q = F.d.old || p; F.d.far = (F.d.far || 0) + Math.hypot(p[0] - q[0], p[1] - q[1]); F.d.old = [...p]; F.on = this;
    if (this.threads.filter((t) => !t.cut && t.F === F).length < 3 || F.d.far > 4.5) { F.d.far = 0; const a = rnd() * 6.283, r = 3 + rnd() * 4; this.threads.push({ F, x: p[0] + Math.cos(a) * r, y: p[1] + Math.sin(a) * r, ax: Math.cos(a) * r * 0.6, ay: Math.sin(a) * r * 0.6, max: (16 + rnd() * 20) * (0.5 + 0.5 * Math.min(2, go)), cut: false, age: 0, w: (1.1 + rnd() * 0.9) * (go < 0.05 ? 0.35 : 1) }); }
    for (const t of this.threads) if (t.F === F) { t.tx = p[0] + t.ax; t.ty = p[1] + t.ay; t.tz = F.z; t.len = Math.hypot(t.tx - t.x, t.ty - t.y); if (!t.cut && t.len > t.max) { t.cut = true; t.ex = t.tx; t.ey = t.ty; } }
  }
  world(dt) { for (const t of this.threads) if (t.cut) t.age += dt; this.threads = this.threads.filter((t) => t.age < 0.35).slice(-30); }
}
// ---------- slime to dip into: the last third of the finger is inside; it is stirred. v: flow, dye: light and dark streaks that are drawn along, h: height ----------
class Pool extends Thing {
  constructor(kind, W, Hh, low, depth) {
    super(kind, W, Hh, low, depth); this.floor = null; this.surf = low + (8.2 - low) / 3; this.pool = true; // a third of the way from the contact to the fingertip
    const nx = this.nx = 96, ny = this.ny = Math.round(96 * Hh / W), N = (nx + 1) * (ny + 1); Object.assign(this, { vx: new Float32Array(N), vy: new Float32Array(N), dye: new Float32Array(N), old: new Float32Array(N), h: new Float32Array(N), vh: new Float32Array(N) }); this.tips = [];
    for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) this.dye[j * (nx + 1) + i] = this.stripe(i / nx, j / ny);
  }
  stripe(u, v) { return 0.5 + 0.5 * Math.tanh(4 * Math.sin(u * 22 + 1.6 * Math.sin(v * 7))); }
  flow(x, y) { const i = clamp(Math.round((x + this.W / 2) / this.W * this.nx), 0, this.nx), j = clamp(Math.round((y + this.H / 2) / this.H * this.ny), 0, this.ny), k = j * (this.nx + 1) + i; return [this.vx[k], this.vy[k]]; }
  // thick: the fingertip moves through it slowly, and is carried along by what already flows
  force(F, target, h, gain) { const p = F.p, o = F.d.o || (F.d.o = [...p]), w = this.flow(p[0], p[1]), v = [(p[0] - o[0]) / h - w[0], (p[1] - o[1]) / h - w[1]]; F.d.v = (F.d.v || [0, 0]).map((a, i) => a + (v[i] - a) * 0.08); F.d.o = [...p]; const c = 0.16 * gain, L = Math.hypot(...F.d.v) * c, m = L > 34 ? 34 / L : 1; return [-F.d.v[0] * c * m, -F.d.v[1] * c * m]; }
  after(F, target, dt, go) { const p = F.p, q = F.d.last || p; F.d.sp = [(p[0] - q[0]) / Math.max(dt, 1e-3), (p[1] - q[1]) / Math.max(dt, 1e-3)]; F.d.last = [...p]; F.d.go = go; F.on = this; }
  leave(F) { if (F.p) this.pull = { x: F.p[0], y: F.p[1], age: 0 }; }
  world(dt) {
    const { nx, ny, vx, vy, dye, old, h, vh } = this, w = nx + 1, sx = this.W / nx, sy = this.H / ny, keep = Math.exp(-dt / 0.55), n = Math.min(0.033, dt); let any = false;
    for (const F of this.f) if (F.p && F.d.sp) {
      const go = F.d.go ?? 1, [px, py] = F.p, [ax, ay] = F.d.sp, sp = Math.hypot(ax, ay), R = 13; F.d.sp = [ax, ay];
      const i0 = Math.max(0, Math.floor((px - 42 + this.W / 2) / sx)), i1 = Math.min(nx, Math.ceil((px + 42 + this.W / 2) / sx)), j0 = Math.max(0, Math.floor((py - 42 + this.H / 2) / sy)), j1 = Math.min(ny, Math.ceil((py + 42 + this.H / 2) / sy));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const k = j * w + i, x = -this.W / 2 + i * sx - px, y = -this.H / 2 + j * sy - py, r2 = x * x + y * y, e = Math.exp(-r2 / (2 * R * R)), m = Math.min(1, 14 * n) * e, r = Math.sqrt(r2);
        // carried along in the middle, flowing back at the sides
        const b = r2 / (R * R), bx = ax * (1 - 0.55 * b) + 0.55 * x * (ax * x + ay * y) / (R * R), by = ay * (1 - 0.55 * b) + 0.55 * y * (ax * x + ay * y) / (R * R); vx[k] += (bx * 0.85 * go - vx[k]) * m; vy[k] += (by * 0.85 * go - vy[k]) * m;
        const front = sp > 1 ? (x * ax + y * ay) / (sp * Math.max(r, 1)) : 0, ring = Math.exp(-((r - 9) ** 2) / 18), lift = go * (1.6 * ring + Math.min(6, sp * 0.035) * front * Math.exp(-((r - 10) ** 2) / 60)); vh[k] += (lift - h[k]) * 60 * n * Math.min(1, e * 1.5);
      }
      any = true;
    }
    if (this.pull) { this.pull.age += dt; if (this.pull.age > 0.5) this.pull = null; }
    const px = this.W / 2, moving = (this.busy = any || (this.busy && this.sum > 0.02)); if (!moving) return; let sum = 0; old.set(dye);
    for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
      const k = j * w + i; if (vx[k] * vx[k] + vy[k] * vy[k] > 0.05) { const u = clamp(i - vx[k] * n / sx, 0, nx - 1e-3), v = clamp(j - vy[k] * n / sy, 0, ny - 1e-3), a = Math.floor(u), b = Math.floor(v), s = u - a, t = v - b, q = b * w + a; dye[k] = (old[q] * (1 - s) + old[q + 1] * s) * (1 - t) + (old[q + w] * (1 - s) + old[q + w + 1] * s) * t; }
      { const d = dye[k]; dye[k] = clamp(d + Math.min(0.3, 1.6 * n * Math.min(1, (vx[k] * vx[k] + vy[k] * vy[k]) / 400)) * (2 * d - 1) * (1 - (2 * d - 1) ** 2), 0, 1); } vx[k] *= keep; vy[k] *= keep; if (i > 0 && i < nx && j > 0 && j < ny) vh[k] += ((h[k - 1] + h[k + 1] + h[k - w] + h[k + w]) / 4 - h[k]) * 90 * n; vh[k] = (vh[k] - h[k] * 9 * n) * Math.exp(-n * 7); sum = Math.max(sum, Math.abs(h[k]), Math.abs(vx[k]) * 0.05);
    }
    for (let k = 0; k < h.length; k++) h[k] += vh[k] * n; this.sum = sum;
  }
}
// ---------- springs standing on the floor (three stiffnesses), or grass ----------
class Posts extends Thing {
  constructor(kind, W, Hh, low, depth) {
    super(kind, W, Hh, low, depth); const g = kind === 'grass'; this.floor = low - (g ? 18 : 62); this.posts = [];
    if (g) for (let i = 0; i < 620; i++) this.posts.push({ x: (rnd() - 0.5) * (W - 8), y: (rnd() - 0.5) * (Hh - 8), r: 0.7 + 0.35 * rnd(), h: 20 + rnd() * 12, k: 0.04, max: 14, lx: (rnd() - 0.5) * 5, ly: (rnd() - 0.5) * 5, hz: 3 + rnd() * 2, dmp: 5, c: rnd() });
    else { const n = 6, m = 3, dx = (W - 10) / n, dy = (Hh - 10) / m; for (let j = 0; j < m; j++) for (let i = 0; i < n; i++) { const s = Math.floor(i / 2); this.posts.push({ x: -W / 2 + 5 + dx * (i + 0.5), y: -Hh / 2 + 5 + dy * (j + 0.5), r: [1.7, 2.3, 3][s], h: 69, k: [0.22, 0.6, 1.5][s], max: [17, 14, 11][s], lx: 0, ly: 0, hz: [4, 6, 9][s], dmp: 4, c: s }); } }
    for (const b of this.posts) Object.assign(b, { u: 0, w: 0, vu: 0, vw: 0, live: false, by: null });
  }
  land(F) { F.d.free = new Set(this.posts.filter((b) => Math.hypot(F.p[0] - b.x, F.p[1] - b.y) < RF * 0.75 + b.r)); }
  leave(F) { for (const b of this.posts) if (b.by === F) b.by = null; }
  force(F, target, h, gain, go) {
    let fx = 0, fy = 0; const p = F.p, free = F.d.free, grass = this.kind === 'grass', far = grass ? 1 : 0.15 + 0.85 * Math.min(1.5, go), stiff = go > 0.05 ? 1 / Math.max(0.6, go) : 3;
    for (const b of this.posts) {
      const dx = b.x - p[0], dy = b.y - p[1]; if (Math.abs(dx) > 30 || Math.abs(dy) > 30) continue;
      const R = RF * 0.75 + b.r, d0 = Math.hypot(dx, dy); if (d0 > R + 1) free.delete(b); else if (free.has(b)) continue;
      const tx = dx + b.u, ty = dy + b.w, d = Math.hypot(tx, ty); if (d >= R) { if (b.by === F) b.by = null; continue; }
      const n = d > 0.01 ? [tx / d, ty / d] : [1, 0]; b.u = p[0] + n[0] * R - b.x; b.w = p[1] + n[1] * R - b.y; b.vu = b.vw = 0; b.by = F; b.live = true; if (gain > 0.02) { fx -= b.k * stiff * b.u * gain; fy -= b.k * stiff * b.w * gain; }
      if (Math.hypot(b.u, b.w) > b.max * far) { free.add(b); b.by = null; } if (b.k > 0.1) F.on = b;
    }
    const L = Math.hypot(fx, fy); if (L > 18) { fx *= 18 / L; fy *= 18 / L; } return [fx, fy];
  }
  world(dt) { for (const b of this.posts) if (b.live && !b.by) for (let t = 0; t < dt; t += H) sway(b, H); }
}
function sway(b, h) { const w = 6.283 * b.hz, c = w * w; b.vu += (-c * b.u - b.dmp * b.vu) * h; b.vw += (-c * b.w - b.dmp * b.vw) * h; b.u += b.vu * h; b.w += b.vw * h; if (Math.abs(b.u) + Math.abs(b.w) < 0.02 && Math.abs(b.vu) + Math.abs(b.vw) < 0.5) { b.u = b.w = b.vu = b.vw = 0; b.live = false; } }
