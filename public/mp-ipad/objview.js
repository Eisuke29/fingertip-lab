// How the things of objects.js look. view(thing, scene) puts the meshes into a group and returns { group, update(spheres, dt) }.
import * as THREE from 'three';
import { RF } from './finger.js?v=11';
import { fieldZ } from './world.js?v=11';
import { surface, copyOf, roundBox, TILE } from './tex.js?v=11';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), tinted = (key, c) => { const m = copyOf(key); m.color = new THREE.Color(c); return m; };
// steps that get wider downward: every step an edge, its top light, its side dark toward the foot
export function terraces(a, b, top, depth, key) {
  const G = new THREE.Group(), m = Object.assign(copyOf(key), { vertexColors: true, side: THREE.DoubleSide }), T = TILE[key], n = 4, h = (depth + top) / n; let x = a, y = b, z = top;
  const quad = (p, uv, c) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p.flat(), 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv.flat().map((v) => v / T), 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(c.flatMap((k) => [k, k, k]), 3)); g.setIndex([0, 1, 2, 2, 1, 3]); g.computeVertexNormals(); const q = new THREE.Mesh(g, m); q.castShadow = q.receiveShadow = true; G.add(q); };
  for (let i = 0; i < n; i++) {
    const f = 1 - i * 0.2, x1 = x + 6.5, y1 = y + 6.5, z1 = z - h, slope = 2.2;
    for (const s of [-1, 1]) { quad([[s * x, -y, z], [s * x, y, z], [s * (x + slope), -y - slope, z1], [s * (x + slope), y + slope, z1]], [[-y, 0], [y, 0], [-y, h], [y, h]], [0.75 * f, 0.75 * f, 0.18 * f, 0.18 * f]); quad([[-x, s * y, z], [x, s * y, z], [-x - slope, s * (y + slope), z1], [x + slope, s * (y + slope), z1]], [[-x, 0], [x, 0], [-x, h], [x, h]], [0.65 * f, 0.65 * f, 0.16 * f, 0.16 * f]);
      quad([[s * (x + slope), -y - slope, z1], [s * (x + slope), y + slope, z1], [s * x1, -y1, z1], [s * x1, y1, z1]], [[-y, 0], [y, 0], [-y, 5], [y, 5]], [0.25 * f, 0.25 * f, f, f]); quad([[-x - slope, s * (y + slope), z1], [x + slope, s * (y + slope), z1], [-x1, s * y1, z1], [x1, s * y1, z1]], [[-x, 0], [x, 0], [-x, 5], [x, 5]], [0.25 * f, 0.25 * f, f, f]); }
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([[-x, -y], [x, -y], [x, y], [-x, y], [-x, -y]].map(([p, q]) => new THREE.Vector3(p, q, z + 0.25))), new THREE.LineBasicMaterial({ color: 0xffe2bd, transparent: true, opacity: 0.8 * f })); G.add(l); x = x1; y = y1; z = z1;
  }
  return G;
}
// many tubes in one mesh; each tube: a line of points with radii, rewritten only when it changes
class Tubes {
  constructor(count, seg, sides, mat, color) {
    this.seg = seg; this.sides = sides; const n = count * (seg + 1) * sides, g = this.geo = new THREE.BufferGeometry(), idx = [];
    for (const k of ['position', 'normal']) g.setAttribute(k, new THREE.BufferAttribute(new Float32Array(n * 3), 3)); if (color) g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    for (let c = 0; c < count; c++) for (let i = 0; i < seg; i++) for (let j = 0; j < sides; j++) { const a = (c * (seg + 1) + i) * sides, b = a + sides, k = (j + 1) % sides; idx.push(a + j, a + k, b + j, b + j, a + k, b + k); }
    g.setIndex(idx); this.mesh = new THREE.Mesh(g, mat); this.mesh.castShadow = this.mesh.receiveShadow = true; this.mesh.frustumCulled = false;
  }
  // pt(i) -> [x, y, z, radius]; ref: any direction not along the tube
  set(c, pt, ref = [0, 1, 0]) {
    const p = this.geo.attributes.position.array, q = this.geo.attributes.normal.array, S = this.seg, N = this.sides, P = Array.from({ length: S + 1 }, (_, i) => pt(i));
    for (let i = 0; i <= S; i++) {
      const a = P[Math.max(0, i - 1)], b = P[Math.min(S, i + 1)]; let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2], l = Math.hypot(tx, ty, tz) || 1; tx /= l; ty /= l; tz /= l;
      let ux = ty * ref[2] - tz * ref[1], uy = tz * ref[0] - tx * ref[2], uz = tx * ref[1] - ty * ref[0]; l = Math.hypot(ux, uy, uz) || 1; ux /= l; uy /= l; uz /= l; const vx = ty * uz - tz * uy, vy = tz * ux - tx * uz, vz = tx * uy - ty * ux;
      for (let j = 0; j < N; j++) { const A = j / N * 6.2832, co = Math.cos(A), si = Math.sin(A), nx = ux * co + vx * si, ny = uy * co + vy * si, nz = uz * co + vz * si, k = ((c * (S + 1) + i) * N + j) * 3, r = P[i][3]; p[k] = P[i][0] + nx * r; p[k + 1] = P[i][1] + ny * r; p[k + 2] = P[i][2] + nz * r; q[k] = nx; q[k + 1] = ny; q[k + 2] = nz; }
    }
    this.dirty = true;
  }
  paint(c, f) { const a = this.geo.attributes.color.array; for (let i = 0; i <= this.seg; i++) { const q = f(i / this.seg); for (let j = 0; j < this.sides; j++) a.set(q, ((c * (this.seg + 1) + i) * this.sides + j) * 3); } this.geo.attributes.color.needsUpdate = true; }
  done() { if (!this.dirty) return; this.dirty = false; this.geo.attributes.position.needsUpdate = this.geo.attributes.normal.needsUpdate = true; }
}
export function view(t) {
  const G = new THREE.Group(), put = (g, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(g, mat); m.castShadow = m.receiveShadow = true; m.frustumCulled = false; m.position.set(x, y, z); G.add(m); return m; };
  const slab = (z, key, c, thick = 9) => { const w = t.W - 2 * t.table, h = t.H - 2 * t.table, g = new THREE.BoxGeometry(w, h, thick), u = g.attributes.uv, p = g.attributes.position; for (let i = 0; i < u.count; i++) u.setXY(i, p.getX(i) / TILE[key], (p.getY(i) + p.getZ(i)) / TILE[key]); G.add(terraces(w / 2, h / 2, z - 0.2, t.depth, 'wood')); return put(g, c ? tinted(key, c) : surface(key), 0, 0, z - thick / 2); };
  let update = () => {};
  if (t.kind === 'cube') {
    const C = [0xf3d9b0, 0xe9a08a, 0x9fc3d8, 0xc9d79a], M = C.map((c) => tinted('block', c)); t.w.objs.forEach((o, i) => put(roundBox(o.a, o.top - o.base, o.r, TILE.block), M[(i + (i >> 2)) % 4], o.x, o.y, o.base)); t.w.deco.forEach((d, i) => put(roundBox(d.a, d.top - d.base, 1.4, TILE.block), M[(i * 7 + 1) % 4], d.x, d.y, d.base));
  } else if (t.kind === 'bumps') {
    const o = t.w.objs[0], nx = 130, ny = 92, g = new THREE.PlaneGeometry(t.W, t.H, nx, ny), p = g.attributes.position, u = g.attributes.uv; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i); p.setZ(i, fieldZ(o, x, y)); u.setXY(i, x / TILE.check, y / TILE.check); } g.computeVertexNormals(); put(g, surface('check')); G.add(terraces(t.W / 2, t.H / 2, o.base - 0.6, t.depth, 'wood'));
  } else if (t.kind === 'soft') {
    t.table = 0; t.floor = t.low - 24; slab(t.floor, 'wood');
    const balls = t.w.objs.map((o, i) => { const g = new THREE.SphereGeometry(o.r, 56, 36).rotateX(Math.PI / 2), m = put(g, [surface('smooth'), surface('rubber'), surface('jelly')][i]); m.userData.rest = g.attributes.position.array.slice(); return m; });
    update = (spheres) => t.w.objs.forEach((o, i) => {
      const m = balls[i], g = m.geometry, p = g.attributes.position.array, r = m.userData.rest, near = t.on === o ? spheres : []; m.position.set(o.x + o.ox * 0.3, o.y + o.oy * 0.3, o.z); if (!near.length && !m.userData.was && Math.abs(o.ox) + Math.abs(o.oy) < 0.02) return;
      for (let k = 0; k < p.length; k += 3) {
        const h = (r[k + 2] + o.r) / (2 * o.r); let x = r[k] + o.ox * 0.7 * h, y = r[k + 1] + o.oy * 0.7 * h, z = r[k + 2]; // swings above, stands below
        for (const [s, R0] of near) { const dx = x + m.position.x - s[0], dy = y + m.position.y - s[1], dz = z + m.position.z - s[2], R = R0 + 0.25, d = Math.hypot(dx, dy, dz), W2 = R + 7; if (d < W2) { const tz = Math.min(dz, -Math.sqrt(Math.max(0, R * R - dx * dx - dy * dy))), e = d < R ? 1 : 0; if (e && dx * dx + dy * dy < R * R) z += tz - dz; else if (o.soft > 1) z -= o.soft * 0.35 * (1 - (d - Math.min(d, R)) / 7) * 0.3; } }
        p[k] = x; p[k + 1] = y; p[k + 2] = z;
      }
      g.attributes.position.needsUpdate = true; g.computeVertexNormals(); m.userData.was = near.length > 0 || Math.abs(o.ox) + Math.abs(o.oy) > 0.02;
    });
  } else if (t.kind === 'push') {
    slab(t.floor, 'wood'); const M = [tinted('foam', 0xf6f1e4), tinted('block', 0xe0a36a), surface('iron')], m = t.boxes.map((b, i) => put(roundBox(b.a, t.top - t.floor, 1.2, TILE[['foam', 'block', 'iron'][i]]), M[i])); update = () => t.boxes.forEach((b, i) => m[i].position.set(b.x, b.y, t.floor));
  } else if (t.kind === 'harp') {
    const L = t.H / 2 - 6, S = 28, T = new Tubes(t.strings.length, S, 8, new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.55, vertexColors: true }), true), bar = (y) => { const g = new THREE.CylinderGeometry(5, 5, t.W - 12, 20).rotateZ(Math.PI / 2); put(g, tinted('block', 0xb9814f), 0, y, t.zs - 2); }; G.add(T.mesh); bar(L); bar(-L);
    const C = [[1, 0.86, 0.5], [1, 0.8, 0.4], [0.95, 0.72, 0.35], [0.85, 0.6, 0.34], [0.75, 0.5, 0.32], [0.62, 0.42, 0.3]]; t.strings.forEach((s, i) => T.paint(i, () => C[i % 6]));
    update = () => { t.strings.forEach((s, c) => { const now = `${s.held}${s.u.toFixed(2)}${s.y.toFixed(1)}`; if (s.shown === now) return; s.shown = now; T.set(c, (i) => { const y = -L + 2 * L * i / S, yc = clamp(s.y, -L + 8, L - 8), f = s.held ? (y < yc ? (y + L) / (yc + L) : (L - y) / (L - yc)) : Math.sin(Math.PI * i / S); return [s.x + s.u * f, y, t.zs, s.r]; }, [0, 0, 1]); }); T.done(); };
  } else if (t.kind === 'slime') {
    const T = new Tubes(20, 10, 7, surface('slime')); G.add(T.mesh);
    update = (spheres, dt, surfZ) => { const tip = spheres[0]?.[0]; for (let c = 0; c < 20; c++) { const h = t.threads[c]; if (!h || (!tip && !h.cut)) { T.set(c, () => [0, 0, -500, 0]); continue; } const ex = h.cut ? h.ex : tip[0] + h.ax, ey = h.cut ? h.ey : tip[1] + h.ay, ez = h.cut ? surfZ + 6 : tip[2] - RF * 0.45, q = h.cut ? Math.max(0, 1 - h.age / 0.3) : 1, thin = h.w * clamp(1 - 0.75 * (h.len || 0) / h.max, 0.18, 1); T.set(c, (i) => { const f = i / 10 * (h.cut ? 0.5 * q : 1), sag = Math.sin(Math.PI * f) * (1.5 + 0.12 * (h.len || 0)) * 0.6, w = thin + (h.w + 0.7) * Math.pow(Math.abs(f - 0.5) * 2, 4); return [h.x + (ex - h.x) * f, h.y + (ey - h.y) * f, surfZ - 0.5 + (ez - surfZ) * f - sag * (f > 0 && f < 1 ? 1 : 0) + 0.4, w * (h.cut ? q : 1)]; }, [0.3, 0.9, 0.3]); } T.done(); };
  } else { // posts, grass
    const g = t.kind === 'grass', S = g ? 4 : 10, T = new Tubes(t.posts.length, S, g ? 3 : 12, new THREE.MeshStandardMaterial({ roughness: g ? 0.8 : 0.45, vertexColors: true, side: g ? THREE.DoubleSide : THREE.FrontSide }), true), C = [[0.55, 0.8, 0.92], [0.95, 0.78, 0.42], [0.86, 0.4, 0.36]]; G.add(T.mesh); slab(t.floor, g ? 'soil' : 'wood');
    t.posts.forEach((b, c) => T.paint(c, (f) => (g ? [0.1 + 0.35 * f + 0.1 * b.c, 0.28 + 0.45 * f + 0.1 * b.c, 0.1 + 0.08 * f] : C[b.c])));
    const draw = (b, c) => { const bend = Math.hypot(b.u, b.w), z1 = b.h * Math.sqrt(Math.max(0.3, 1 - (bend / b.h) ** 2)); T.set(c, (i) => { const f = i / S, q = f * f, coil = g ? 0 : 0.22 * b.r * Math.sin(f * 40); return [b.x + (b.lx + b.u) * q, b.y + (b.ly + b.w) * q, t.floor + z1 * f, g ? b.r * (1 - 0.85 * f) : b.r * (f > 0.99 ? 0.4 : 1) + coil]; }, [0, 1, 0]); };
    t.posts.forEach(draw); T.done(); let was = new Set(); update = () => { const now = new Set(); t.posts.forEach((b, c) => { if (b.live || was.has(c)) draw(b, c); if (b.live) now.add(c); }); was = now; T.done(); };
  }
  return { group: G, update };
}
