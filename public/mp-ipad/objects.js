// Things to touch behind the glass, after what earlier pseudo-haptics studies let people touch. Each thing pulls back on the fingertip; the
// fingertip (not the knuckle) stays behind. Pure functions, no DOM, no three.js. mm; z out of the screen; forces in mm of finger bending.
import { RF, clamp } from './finger.js?v=11';
import { makeWorld, TipOver } from './world.js?v=11';

// id, name, what to do, the study it follows (the property; not always the same object)
export const THINGS = [
  ['cube', '立方体', '縁をこえる', '摩擦：Lécuyer 2000（立方体が遅くなる）'], ['bumps', '山と穴', 'なでて形を探る', '凹凸：Lécuyer 2004（山と穴）'], ['push', '重い箱', '横から押す', '重さ・静止摩擦：宇治土公 2019'], ['harp', '張った糸', '横切って、はじく', '紐：伴・宇治土公 2018'],
  ['slime', '糸を引く', '横へひっぱる', '粘り：Kawabe 2026（伸びて切れる糸）'], ['soft', 'やわらかい球', '上をなでる', '柔らかさ：Li 2016'], ['posts', 'ばねの棒', '横からはじく', 'ばねの硬さ：Lécuyer 2000'], ['grass', '草むら', 'かき分ける', '先行研究は見つからず（新しい例）'],
];
let seed = 1; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647, H = 1 / 360, Q = 1 - Math.exp(-45 * H);

// low: lowest point of the resting fingertip. Returns { kind, floor, table, step(target, dt, o) -> lag, ... }
export function makeThing(kind, W, Hh, low, depth) {
  seed = 42; const t = { cube: Solid, bumps: Solid, soft: Solid, push: Push, harp: Harp, slime: Slime, posts: Posts, grass: Posts }[kind]; return new t(kind, W, Hh, low, depth);
}
// what all have in common: the fingertip is drawn to its resting place and held back by force()
class Thing {
  constructor(kind, W, Hh, low, depth) { Object.assign(this, { kind, W, H: Hh, low, depth }); this.reset(); }
  reset() { this.p = null; this.lag = [0, 0, 0]; this.on = null; }
  step(target, dt, { dip = null, reach = 1e9, gain = 1 } = {}) {
    if (!this.p) { this.p = [target[0], target[1]]; this.land?.(this.p); }
    const p = this.p, n = Math.max(1, Math.round(dt / H)); this.z = target[2]; this.on = null;
    for (let s = 0; s < n; s++) {
      const f = this.force(p, target, H, gain), L = Math.hypot(f[0] + target[0] - p[0], f[1] + target[1] - p[1]) * Q, c = Math.min(1, 1.5 / Math.max(1e-6, L)); p[0] += (f[0] + target[0] - p[0]) * Q * c; p[1] += (f[1] + target[1] - p[1]) * Q * c;
      this.hard?.(p, target, H, gain);
      if (dip) { const x = p[0] - dip[0], y = p[1] - dip[1], m = Math.hypot(x, y); if (m > reach) { p[0] = dip[0] + x / m * reach; p[1] = dip[1] + y / m * reach; this.yield?.(p); } }
    }
    this.after?.(p, target, dt, gain); this.lag = [p[0] - target[0], p[1] - target[1], 0]; return this.lag;
  }
  rest(dt) { this.idle?.(dt); } // the hand is away: what swings goes on swinging
  force() { return [0, 0]; }
}
// ---------- cubes, bumps and holes, soft balls: heights (world.js) ----------
class Solid extends Thing {
  constructor(kind, W, Hh, low, depth) { super(kind, W, Hh, low, depth); this.w = makeWorld(kind, W, Hh, low, depth); this.over = new TipOver(); }
  reset() { super.reset(); this.over?.reset(); }
  step(target, dt, o) { this.lag = this.over.step(target, this.w, dt, o); this.p = this.over.p; this.on = this.over.obj; this.z = this.over.z; return this.lag; }
  idle(dt) { this.over.obj = null; this.over.soft(this.w, dt); }
}
// ---------- boxes to push: nothing moves until the push is strong enough (static friction), then it goes with a jerk; heavy ones later and slower ----------
class Push extends Thing {
  constructor(kind, W, Hh, low, depth) {
    super(kind, W, Hh, low, depth); this.floor = low - 0.6; this.table = 0; this.top = low + 9;
    const u = W / 4; this.boxes = [[-u, 0, 9, 3, 24], [0, 4, 11.5, 8, 12], [u, 0, 14, 14, 6]].map(([x, y, a, hold, v], i) => ({ x, y, a, hold, v, i, moving: false, sp: 0 }));
  }
  hard(p, target, h, gain) {
    const r = RF * 0.92; for (const b of this.boxes) {
      const cx = clamp(p[0], b.x - b.a, b.x + b.a), cy = clamp(p[1], b.y - b.a, b.y + b.a); let nx = p[0] - cx, ny = p[1] - cy, d = Math.hypot(nx, ny), pen;
      if (d > 1e-6) { if (d >= r) { b.sp *= 0.97; if (d > r + 1) b.moving = false; continue; } nx /= d; ny /= d; pen = r - d; } else { // inside (landed on it): out by the nearest side
        const e = [b.x + b.a - p[0], p[0] - b.x + b.a, b.y + b.a - p[1], p[1] - b.y + b.a], i = e.indexOf(Math.min(...e)); nx = [1, -1, 0, 0][i]; ny = [0, 0, 1, -1][i]; pen = e[i] + r; }
      p[0] += nx * pen; p[1] += ny * pen; this.on = b;
      const push = (p[0] - target[0]) * nx + (p[1] - target[1]) * ny, hold = b.hold * gain; // how far the finger is bent against it
      if (!b.moving && push > hold) b.moving = true; if (b.moving && push < hold * 0.35) b.moving = false; // starting needs more than keeping it going
      if (b.moving) { const s = Math.min(1.2, Math.max(0, push - hold * 0.3) * b.v * h), lim = [this.W / 2 - this.table - b.a, this.H / 2 - this.table - b.a], ox = b.x, oy = b.y; b.x = clamp(b.x - nx * s, -lim[0], lim[0]); b.y = clamp(b.y - ny * s, -lim[1], lim[1]);
        for (const q of this.boxes) if (q !== b) { const ex = b.a + q.a - Math.abs(b.x - q.x), ey = b.a + q.a - Math.abs(b.y - q.y); if (ex > 0 && ey > 0) { b.x = ox; b.y = oy; } } }
    }
  }
}
// (Push) the finger can bend no farther: the box gives way
Push.prototype.yield = function (p) {
  const r = RF * 0.92; for (const b of this.boxes) {
    const cx = clamp(p[0], b.x - b.a, b.x + b.a), cy = clamp(p[1], b.y - b.a, b.y + b.a), dx = p[0] - cx, dy = p[1] - cy, d = Math.hypot(dx, dy); if (d >= r) continue;
    if (d > 1e-6) { b.x -= dx / d * (r - d); b.y -= dy / d * (r - d); } else { const e = [b.x + b.a - p[0], p[0] - b.x + b.a, b.y + b.a - p[1], p[1] - b.y + b.a], i = e.indexOf(Math.min(...e)), s = e[i] + r; b.x -= [1, -1, 0, 0][i] * s; b.y -= [0, 0, 1, -1][i] * s; }
  }
};
// ---------- strings under tension: caught, drawn along, let go, trembling. From thin and soft to thick and stiff ----------
class Harp extends Thing {
  constructor(kind, W, Hh, low, depth) {
    super(kind, W, Hh, low, depth); this.zs = low + RF * 0.75; const n = 5, d = (W - 14) / n;
    this.strings = Array.from({ length: n }, (_, i) => ({ x: -W / 2 + 7 + d * (i + 0.5), r: 0.6 + 0.3 * i, k: 0.25 + 0.2 * i, max: 11 + i * 1.3, u: 0, v: 0, y: 0, side: 0, free: false, hz: 11 - i }));
  }
  land(p) { for (const s of this.strings) { s.side = p[0] < s.x ? -1 : 1; s.free = Math.abs(p[0] - s.x) < RF; } }
  force(p, target, h, gain) {
    let f = 0; for (const s of this.strings) {
      const R = RF * 0.6 + s.r, d = p[0] - s.x; if (s.free) { if (Math.abs(d) > R + 0.5) { s.free = false; s.side = d < 0 ? -1 : 1; } } else if (!s.side) s.side = d < 0 ? -1 : 1;
      const u = s.side < 0 ? d + R : d - R, caught = !s.free && (s.side < 0 ? u > 0 : u < 0) && gain > 0.02;
      if (caught) { f -= s.k * u * 1.4 * gain; s.u = u; s.v = 0; s.y = p[1]; s.held = true; this.on = s; if (Math.abs(u) > s.max || Math.abs(target[0] - p[0]) > 13) { s.free = true; s.held = false; } } else { s.held = false; swing(s, h); }
    }
    return [f, 0];
  }
  idle(dt) { for (const s of this.strings) { s.held = false; for (let t = 0; t < dt; t += H) swing(s, H); } }
}
function swing(s, h) { const w = 6.283 * s.hz; s.v += (-w * w * s.u - 3.2 * s.v) * h; s.u += s.v * h; if (Math.abs(s.u) < 0.01 && Math.abs(s.v) < 0.5) s.u = s.v = 0; }
// ---------- slime: threads stretch between the fingertip and the surface, get thin and break one after the other ----------
class Slime extends Thing {
  constructor(kind, W, Hh, low, depth) { super(kind, W, Hh, low, depth); this.floor = null; this.table = 0; this.threads = []; }
  reset() { super.reset(); this.threads = []; this.far = 0; }
  force(p, target, h, gain) { let x = 0, y = 0; for (const t of this.threads) if (!t.cut) { x += (t.x - p[0]) * 0.09; y += (t.y - p[1]) * 0.09; } const L = Math.hypot(x, y), m = 13 * gain; if (L > m) { x *= m / L; y *= m / L; } return gain > 0.02 ? [x, y] : [0, 0]; }
  after(p, target, dt) {
    const q = this.old || p; this.far += Math.hypot(p[0] - q[0], p[1] - q[1]); this.old = [...p]; this.on = this;
    if (this.threads.filter((t) => !t.cut).length < 3 || this.far > 4.5) { this.far = 0; const a = rnd() * 6.283, r = 3 + rnd() * 4; this.threads.push({ x: p[0] + Math.cos(a) * r, y: p[1] + Math.sin(a) * r, ax: Math.cos(a) * r * 0.6, ay: Math.sin(a) * r * 0.6, max: 16 + rnd() * 20, cut: false, age: 0, w: 1.1 + rnd() * 0.9 }); }
    for (const t of this.threads) { t.len = Math.hypot(p[0] + t.ax - t.x, p[1] + t.ay - t.y); if (!t.cut && t.len > t.max) { t.cut = true; t.ex = p[0] + t.ax; t.ey = p[1] + t.ay; } if (t.cut) t.age += dt; } this.threads = this.threads.filter((t) => t.age < 0.35).slice(-16);
  }
  idle(dt) { for (const t of this.threads) { if (!t.cut && this.old) { t.cut = true; t.ex = this.old[0]; t.ey = this.old[1]; } t.age += dt; } this.threads = this.threads.filter((t) => t.age < 0.35); this.old = null; }
}
// ---------- springs standing on the floor (three stiffnesses), or grass ----------
class Posts extends Thing {
  constructor(kind, W, Hh, low, depth) {
    super(kind, W, Hh, low, depth); const g = kind === 'grass'; this.table = 0; this.floor = low - (g ? 18 : 62); this.posts = [];
    if (g) for (let i = 0; i < 620; i++) this.posts.push({ x: (rnd() - 0.5) * (W - 8), y: (rnd() - 0.5) * (Hh - 8), r: 0.7 + 0.35 * rnd(), h: 20 + rnd() * 12, k: 0.04, max: 14, lx: (rnd() - 0.5) * 5, ly: (rnd() - 0.5) * 5, hz: 3 + rnd() * 2, dmp: 5, c: rnd() });
    else { const n = 6, m = 3, dx = (W - 10) / n, dy = (Hh - 10) / m; for (let j = 0; j < m; j++) for (let i = 0; i < n; i++) { const s = Math.floor(i / 2); this.posts.push({ x: -W / 2 + 5 + dx * (i + 0.5), y: -Hh / 2 + 5 + dy * (j + 0.5), r: [1.7, 2.3, 3][s], h: 69, k: [0.22, 0.6, 1.5][s], max: [17, 14, 11][s], lx: 0, ly: 0, hz: [4, 6, 9][s], dmp: 4, c: s }); } }
    for (const b of this.posts) Object.assign(b, { u: 0, w: 0, vu: 0, vw: 0, free: false, live: false });
  }
  land(p) { for (const b of this.posts) b.free = Math.hypot(p[0] - b.x, p[1] - b.y) < RF * 0.75 + b.r; }
  force(p, target, h, gain) {
    let fx = 0, fy = 0; for (const b of this.posts) {
      const dx = b.x - p[0], dy = b.y - p[1]; if (!b.live && (Math.abs(dx) > 30 || Math.abs(dy) > 30)) continue;
      const R = RF * 0.75 + b.r, d0 = Math.hypot(dx, dy); if (b.free && d0 > R + 1) b.free = false;
      const tx = dx + b.u, ty = dy + b.w, d = Math.hypot(tx, ty);
      if (!b.free && d < R) { const n = d > 0.01 ? [tx / d, ty / d] : [1, 0]; b.u = p[0] + n[0] * R - b.x; b.w = p[1] + n[1] * R - b.y; b.vu = b.vw = 0; b.held = true; b.live = true; if (gain > 0.02) { fx -= b.k * b.u * gain; fy -= b.k * b.w * gain; } if (Math.hypot(b.u, b.w) > b.max) { b.free = true; b.held = false; } if (b.k > 0.1) this.on = b; } else { b.held = false; if (b.live) sway(b, h); }
    }
    const L = Math.hypot(fx, fy); if (L > 18) { fx *= 18 / L; fy *= 18 / L; } return [fx, fy];
  }
  idle(dt) { for (const b of this.posts) if (b.live) { b.held = false; for (let t = 0; t < dt; t += H) sway(b, H); } }
}
function sway(b, h) { const w = 6.283 * b.hz, c = w * w; b.vu += (-c * b.u - b.dmp * b.vu) * h; b.vw += (-c * b.w - b.dmp * b.vw) * h; b.u += b.vu * h; b.w += b.vw * h; if (Math.abs(b.u) + Math.abs(b.w) < 0.02 && Math.abs(b.vu) + Math.abs(b.vw) < 0.5) { b.u = b.w = b.vu = b.vw = 0; b.live = false; } }
