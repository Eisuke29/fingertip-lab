// How the things of objects.js look. view(thing, scene) puts the meshes into a group and returns { group, update(spheres, dt) }.
import * as THREE from 'three';
import { RF } from './finger.js?v=19';
import { fieldZ } from './world.js?v=19';
import { surface, copyOf, roundBox, TILE } from './tex.js?v=19';

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
// Nothing is drawn inside the finger. pt: [x, y, z, r] is moved out of the balls of the finger: ax 0 / 1: sideways along x / y to the side sg, 2: down under it, 3: away from it, level
function clear(pt, balls, ax, sg = 1) {
  for (let pass = 0; pass < (ax === 3 ? 2 : 1); pass++) for (const [c, R] of balls) {
    const D = R + pt[3] + 0.15, dx = pt[0] - c[0], dy = pt[1] - c[1], dz = pt[2] - c[2]; if (dx * dx + dy * dy + dz * dz >= D * D) continue;
    if (ax === 2) pt[2] = Math.min(pt[2], c[2] - Math.sqrt(D * D - dx * dx - dy * dy));
    else if (ax === 3) { const h = Math.sqrt(D * D - dz * dz), l = Math.hypot(dx, dy); if (l > 1e-3) { pt[0] = c[0] + dx / l * h; pt[1] = c[1] + dy / l * h; } else pt[0] = c[0] + h; }
    else { const o = ax ? dx : dy, w = Math.sqrt(Math.max(0, D * D - o * o - dz * dz)); pt[ax] = sg > 0 ? Math.max(pt[ax], c[ax] + w) : Math.min(pt[ax], c[ax] - w); }
  }
  return pt;
}
export function view(t) {
  const G = new THREE.Group(), put = (g, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(g, mat); m.castShadow = m.receiveShadow = true; m.frustumCulled = false; m.position.set(x, y, z); G.add(m); return m; };
  const slab = (z, key, c, thick = 9) => { const w = t.W, h = t.H, g = new THREE.BoxGeometry(w, h, thick), u = g.attributes.uv, p = g.attributes.position; for (let i = 0; i < u.count; i++) u.setXY(i, p.getX(i) / TILE[key], (p.getY(i) + p.getZ(i)) / TILE[key]); G.add(terraces(w / 2, h / 2, z - 0.2, t.depth, 'wood')); return put(g, c ? tinted(key, c) : surface(key), 0, 0, z - thick / 2); };
  let update = () => {};
  if (t.kind === 'cube') {
    const C = [0xf3d9b0, 0xe9a08a, 0x9fc3d8, 0xc9d79a], M = C.map((c) => tinted('block', c)); const B = t.w.objs.map((o, i) => put(roundBox(o.a, o.top - o.base, o.r, TILE.block), M[(i + (i >> 2)) % 4], o.x, o.y, o.base)); update = () => t.w.objs.forEach((o, i) => B[i].position.set(o.x + o.ox, o.y + o.oy, o.base - o.sink)); const D = t.w.deco.map((d, i) => put(roundBox(d.a, d.top - d.base, 1.4, TILE.block), M[(i * 7 + 1) % 4], d.x, d.y, d.base)), up = update; update = () => { up(); t.w.deco.forEach((d, i) => { if (d.of) D[i].position.z = d.base - d.of.sink; }); };
  } else if (t.kind === 'bumps') {
    const o = t.w.objs[0], nx = 150, ny = 104, g = new THREE.PlaneGeometry(t.W, t.H, nx, ny), p = g.attributes.position, u = g.attributes.uv, c = new Float32Array(p.count * 3), step = 1.2;
    // light and dark that make the relief: deep is dark, a slope that looks away from the light too, what stands between hills a little
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = fieldZ(o, x, y), sx = (fieldZ(o, x + step, y) - z) / step, sy = (fieldZ(o, x, y + step) - z) / step; p.setZ(i, z); u.setXY(i, x / TILE.check, y / TILE.check); let wide = 0; for (let k = 0; k < 8; k++) wide += fieldZ(o, x + 9 * Math.cos(k * 0.785), y + 9 * Math.sin(k * 0.785)) / 8; const deep = clamp((z - o.base) / 34, -1, 0.8), hollow = clamp((wide - z) / 8, -0.4, 1), k = clamp(0.92 + 0.6 * deep - 0.5 * hollow - 0.34 * (sx * 0.5 - sy * 0.6) - 0.1 * Math.hypot(sx, sy), 0.07, 1.6); c.set([k * 1.02, k, k * 0.97], i * 3); }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3)); g.computeVertexNormals(); const m = put(g, Object.assign(copyOf('check'), { vertexColors: true })); G.add(terraces(t.W / 2, t.H / 2, o.base - 0.6, t.depth, 'wood'));
    // contour lines: rings at equal heights
    const seg = [], L = (z0) => { const nx2 = 110, ny2 = 78, at = (i, j) => { const x = -t.W / 2 + t.W * i / nx2, y = -t.H / 2 + t.H * j / ny2; return [x, y, fieldZ(o, x, y)]; }; for (let j = 0; j < ny2; j++) for (let i = 0; i < nx2; i++) { const q = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)], e = []; for (let k = 0; k < 4; k++) { const a = q[k], b = q[(k + 1) % 4]; if ((a[2] < z0) !== (b[2] < z0)) { const f = (z0 - a[2]) / (b[2] - a[2]); e.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, z0 + 0.25]); } } if (e.length >= 2) seg.push(...e[0], ...e[1]); } };
    for (let z = o.base - 30; z < o.base + 28; z += 4) if (Math.abs(z - o.base) > 1) L(z); const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3)); const ln = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x1d2a30, transparent: true, opacity: 0.35 })); ln.frustumCulled = false; G.add(ln);
    update = () => { m.position.set(o.ox, o.oy, 0); ln.position.copy(m.position); };
  } else if (t.kind === 'soft') {
    t.floor = t.low - 24; slab(t.floor, 'wood');
    const balls = t.w.objs.map((o, i) => { const g = new THREE.SphereGeometry(o.r, 56, 36).rotateX(Math.PI / 2), m = put(g, [surface('smooth'), surface('rubber'), surface('jelly')][i]); m.userData.rest = g.attributes.position.array.slice(); return m; });
    update = (spheres) => t.w.objs.forEach((o, i) => {
      const m = balls[i], g = m.geometry, p = g.attributes.position.array, r = m.userData.rest, near = t.f.some((q) => q.on === o) ? spheres : []; m.position.set(o.x + o.ox * 0.3, o.y + o.oy * 0.3, o.z); if (!near.length && !m.userData.was && Math.abs(o.ox) + Math.abs(o.oy) < 0.02) return;
      for (let k = 0; k < p.length; k += 3) {
        const h = (r[k + 2] + o.r) / (2 * o.r); let x = r[k] + o.ox * 0.7 * h, y = r[k + 1] + o.oy * 0.7 * h, z = r[k + 2]; // swings above, stands below
        for (const [s, R0] of near) { const dx = x + m.position.x - s[0], dy = y + m.position.y - s[1], dz = z + m.position.z - s[2], R = R0 + 0.25, d = Math.hypot(dx, dy, dz), W2 = R + 7; if (d < W2) { const tz = Math.min(dz, -Math.sqrt(Math.max(0, R * R - dx * dx - dy * dy))), e = d < R ? 1 : 0; if (e && dx * dx + dy * dy < R * R) z += tz - dz; else if (o.soft > 1) z -= o.soft * 0.35 * (1 - (d - Math.min(d, R)) / 7) * 0.3; } }
        p[k] = x; p[k + 1] = y; p[k + 2] = z;
      }
      g.attributes.position.needsUpdate = true; g.computeVertexNormals(); m.userData.was = near.length > 0 || Math.abs(o.ox) + Math.abs(o.oy) > 0.02;
    });
  } else if (t.kind === 'push') {
    slab(t.floor, 'wood'); const M = [tinted('foam', 0xf6f1e4), tinted('block', 0xe0a36a), surface('iron')], m = t.boxes.map((b, i) => put(roundBox(b.a, t.top - t.floor, 1.2, TILE[['foam', 'block', 'iron'][i]]), M[i])); update = () => t.boxes.forEach((b, i) => { const q = m[i], tl = b.tilt; q.position.set(b.x, b.y, t.floor); q.rotation.set(-tl[1] * 0.012, tl[0] * 0.012, 0); });
  } else if (t.strings) {
    const V = t.vert, L = (V ? t.H : t.W) / 2 - 5, S = 72, n = t.strings.length, T = new Tubes(n, S, 8, new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 0.75, vertexColors: true, envMapIntensity: 1.6 }), true); G.add(T.mesh);
    // the guitar: body with a sound hole to the right, the neck with frets to the left
    const zb = t.board, box = (w, h, d, x, y, z, mat) => put(new THREE.BoxGeometry(w, h, d), mat, x, y, z - d / 2), hx = t.W * 0.22, dark = tinted('block', 0x4a2c1c), gold = new THREE.MeshStandardMaterial({ color: 0xd8c48a, metalness: 0.85, roughness: 0.28 }), flat = new THREE.MeshStandardMaterial({ color: 0x0a0605, roughness: 1 }), pearl = new THREE.MeshStandardMaterial({ color: 0xf1ece0, roughness: 0.25 });
    if (V) { // the harp: a dark sounding board, a bar far and a bar near, a golden pin where every string ends
      const bg = new THREE.BoxGeometry(t.W + 14, t.H, 10), uv = bg.attributes.uv, bp = bg.attributes.position; for (let i = 0; i < uv.count; i++) uv.setXY(i, bp.getX(i) / 150, bp.getY(i) / 60); put(bg, tinted('block', 0x7a4a2a), 0, 0, zb - 5); G.add(terraces(t.W / 2 + 7, t.H / 2, zb - 10, t.depth, 'wood'));
      for (const y of [-1, 1]) { box(t.W + 4, 7, 8, 0, y * (t.H / 2 - 3.5), t.zs - 1, tinted('block', 0xd9a25a)); for (const q of t.strings) put(new THREE.SphereGeometry(1.5, 14, 10), gold, q.y, y * (t.H / 2 - 5), t.zs - 0.4); }
    } else {
    const bg = new THREE.BoxGeometry(t.W, t.H + 14, 10), uv = bg.attributes.uv, bp = bg.attributes.position; for (let i = 0; i < uv.count; i++) uv.setXY(i, bp.getX(i) / 150, bp.getY(i) / 60); const body = put(bg, tinted('block', 0xd9934e), 0, 0, zb - 5); body.receiveShadow = true; G.add(terraces(t.W / 2, t.H / 2 + 7, zb - 10, t.depth, 'wood'));
    const hole = put(new THREE.CircleGeometry(t.H * 0.36, 56), flat, hx, 0, zb + 0.06); hole.castShadow = false; for (const [r, w, c] of [[0.375, 1.4, 0x2b1a10], [0.405, 1.2, 0xefe0bd], [0.43, 1.6, 0x6a3b20]]) { const q = put(new THREE.RingGeometry(t.H * r, t.H * r + w, 64), new THREE.MeshStandardMaterial({ color: c, roughness: 0.4 }), hx, 0, zb + 0.08); q.castShadow = false; }
    const nx = -t.W / 2, nw = t.W * 0.5; box(nw, t.H + 2, 1.6, nx + nw / 2, 0, zb + 1.2, dark); let fx = nx + 4; const frets = []; for (let i = 0, w = nw * 0.24; fx < nx + nw - 2; i++, w *= 0.86) { frets.push(fx); const c = put(new THREE.CylinderGeometry(0.7, 0.7, t.H + 2, 10), gold, fx, 0, zb + 1.2); c.castShadow = true; fx += w; if (fx < nx + nw - 4 && i % 2 === 0) { const d = put(new THREE.CircleGeometry(2.3, 24), pearl, fx - w / 2, 0, zb + 1.26); d.castShadow = false; } }
    box(4, t.H + 4, 7, nx + 2, 0, t.zs - 1, pearl); box(5, t.H * 0.96, 8, t.W / 2 - 6, 0, t.zs - 1, dark);
    }
    const C = [[0.95, 0.95, 0.98], [0.92, 0.92, 0.95], [0.9, 0.82, 0.62], [0.86, 0.68, 0.42], [0.8, 0.58, 0.34], [0.72, 0.5, 0.3]]; t.strings.forEach((s, i) => T.paint(i, () => (V ? (i % 7 === 0 ? [0.86, 0.2, 0.16] : i % 7 === 3 ? [0.16, 0.2, 0.42] : [0.94, 0.9, 0.8]) : C[i % 6]))); // a harp marks every C red and every F dark
    // a taut string does not follow a place of the finger that does not reach it
    // a string that is held lies against the side of the finger, one that slips through goes under it
    let tick = 0; update = (sp, dt, sz, go, balls = []) => { tick++; const B = balls.filter(([c, r]) => c[2] - r < t.zs + 2); t.strings.forEach((s, c) => { const near = B.filter(([q, r]) => Math.abs(q[t.b] - s.y) < r + 22), now = near.length ? tick : s.held.map((q) => `${q.u.toFixed(2)},${q.x.toFixed(1)}`).join(';') || s.u.toFixed(2); if (s.shown === now) return; s.shown = now; const ax = s.held.length ? t.b : 2, sg = s.held.reduce((a, q) => (Math.abs(q.u) > Math.abs(a) ? q.u : a), 0); const P = [[-L, 0], ...s.held.map((q) => [clamp(q.x, -L + 8, L - 8), q.u]).sort((a, b) => a[0] - b[0]), [L, 0]]; for (let k = 1; k < P.length - 1; k++) { const a = P[k - 1], e = P[k + 1], lin = a[1] + (e[1] - a[1]) * (P[k][0] - a[0]) / Math.max(1e-3, e[0] - a[0]), sg = Math.sign(P[k][1]) || 1; if (P[k][1] * sg < lin * sg - 1e-6) { P.splice(k, 1); k = 0; } } T.set(c, (i) => { const x = -L + 2 * L * i / S; let u; if (s.held.length) { let k = 0; while (k < P.length - 2 && x > P[k + 1][0]) k++; const f = (x - P[k][0]) / Math.max(1e-3, P[k + 1][0] - P[k][0]); u = P[k][1] + (P[k + 1][1] - P[k][1]) * f; } else u = s.u * Math.sin(Math.PI * i / S); return clear(V ? [s.y + u, x, t.zs, s.r] : [x, s.y + u, t.zs, s.r], near, ax, sg); }, V ? [1, 0, 0] : [0, 1, 0]); }); T.done(); };
  } else if (t.pool) {
    // a clear, thick jelly in a white tray: what is inside is seen through it, greener the deeper it lies
    const { nx, ny, dye, h } = t, g = new THREE.PlaneGeometry(t.W, t.H, nx, ny), p = g.attributes.position, nm = g.attributes.normal, c = new THREE.BufferAttribute(new Float32Array(p.count * 3), 3), z = t.surf, w = nx + 1, sx = t.W / nx, sy = t.H / ny; g.setAttribute('color', c);
    const mat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.3, specularIntensity: 0.35, clearcoat: 0.3, clearcoatRoughness: 0.12, envMapIntensity: 0.16, transparent: true, side: THREE.FrontSide }); mat.onBeforeCompile = (s) => { s.fragmentShader = s.fragmentShader.replace('#include <opaque_fragment>', `{ float nv = clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), fr = pow(1.0 - nv, 3.0), sp = max(max(totalSpecular.r, totalSpecular.g), totalSpecular.b); diffuseColor.a = clamp(0.2 + 0.55 * fr + 0.3 * vColor.r + min(0.6, sp * 0.7), 0.0, 0.97); outgoingLight = outgoingLight * 1.05; }\n#include <opaque_fragment>`); };
    const m = new THREE.Mesh(g, mat); m.receiveShadow = true; m.renderOrder = 6; m.frustumCulled = false; G.add(m); const bed = t.bed, deep = z - bed, T = [0.034, 0.0085, 0.044].map((k) => Math.exp(-k * deep * 1.15)), tint = new THREE.Color(T[0] * 0.95 + 0.04, T[1] * 0.95 + 0.06, T[2] * 0.95 + 0.02), white = new THREE.MeshPhysicalMaterial({ color: 0xeeebe4, roughness: 0.3, clearcoat: 0.4 });
    // the tray: rim white, inside the same colour as seen through the slime
    const rim = 6, hi = 5; for (const [bw, d, x, y] of [[t.W + 2 * rim, rim, 0, t.H / 2 + rim / 2], [t.W + 2 * rim, rim, 0, -t.H / 2 - rim / 2], [rim, t.H, -t.W / 2 - rim / 2, 0], [rim, t.H, t.W / 2 + rim / 2, 0]]) put(new THREE.BoxGeometry(bw, d, deep + hi + 4), white, x, y, z + hi - (deep + hi + 4) / 2); G.add(terraces(t.W / 2 + rim, t.H / 2 + rim, bed - 4, t.depth, 'wood'));
    { const f = copyOf('plaster'); f.color = tint; f.roughness = 0.9; f.normalMap = null; const b = put(new THREE.PlaneGeometry(t.W, t.H), f, 0, 0, bed); b.castShadow = false; const quad = (x0, y0, x1, y1) => { const q = new THREE.BufferGeometry(); q.setAttribute('position', new THREE.Float32BufferAttribute([x0, y0, z, x1, y1, z, x0, y0, bed, x1, y1, bed], 3)); q.setAttribute('color', new THREE.Float32BufferAttribute([0.93, 0.95, 0.9, 0.93, 0.95, 0.9, tint.r, tint.g, tint.b, tint.r, tint.g, tint.b], 3)); q.setIndex([0, 2, 1, 1, 2, 3]); q.computeVertexNormals(); const k = put(q, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide })); k.castShadow = false; }; const a = t.W / 2 - 0.1, o = t.H / 2 - 0.1; quad(-a, o, a, o); quad(a, -o, -a, -o); quad(-a, -o, -a, o); quad(a, o, a, -o); }
    const bub = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 14, 10), new THREE.MeshPhysicalMaterial({ color: 0xd8f5b8, roughness: 0.05, clearcoat: 1, transparent: true, opacity: 0.34, depthWrite: false, envMapIntensity: 1.1 }), t.bubbles.length); bub.frustumCulled = false; bub.renderOrder = 5; G.add(bub); const M4 = new THREE.Matrix4();
    const thr = t.deep ? null : new Tubes(30, 10, 8, new THREE.MeshPhysicalMaterial({ color: 0xbdf07c, emissive: 0x2c5a10, roughness: 0.2, clearcoat: 1, transparent: true, opacity: 0.55, envMapIntensity: 0.6 })); if (thr) { thr.mesh.renderOrder = 7; G.add(thr.mesh); }
    // the resting surface is never quite flat
    const lump = new Float32Array(w * (ny + 1)); for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) { const x = i * sx, y = j * sy; lump[j * w + i] = 0.55 * Math.sin(x * 0.11 + 1.3 * Math.sin(y * 0.08)) + 0.45 * Math.sin(y * 0.14 + 1.1 * Math.sin(x * 0.09 + 2)); }
    const draw = () => {
      const H = (i, j) => h[j * w + i] + lump[j * w + i];
      for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
        const k = j * w + i, q = ((ny - j) * w + i) * 3, d = dye[k], v = H(i, j), dx = (H(Math.min(nx, i + 1), j) - H(Math.max(0, i - 1), j)) / (2 * sx), dy = (H(i, Math.min(ny, j + 1)) - H(i, Math.max(0, j - 1))) / (2 * sy), l = Math.sqrt(dx * dx + dy * dy + 1), thin = clamp(1 - v * 0.04, 0.7, 1.25);
        p.array[q + 2] = z + v; nm.array[q] = -dx / l; nm.array[q + 1] = -dy / l; nm.array[q + 2] = 1 / l; c.array[q] = (0.16 + 0.2 * d) * thin; c.array[q + 1] = (0.5 + 0.2 * d) * thin; c.array[q + 2] = (0.04 + 0.1 * d) * thin;
      } p.needsUpdate = nm.needsUpdate = c.needsUpdate = true; t.bubbles.forEach((b, i) => { M4.makeScale(b.r, b.r, b.r * 0.85).setPosition(b.x, b.y, z + b.z); bub.setMatrixAt(i, M4); }); bub.instanceMatrix.needsUpdate = true;
    };
    draw(); let n = 0; update = (spheres, dt, surfZ) => { if (t.busy || n++ < 2) draw(); if (!thr) return; for (let k = 0; k < 30; k++) { const q = t.threads[k]; if (!q || q.tx == null) { thr.set(k, () => [0, 0, -500, 0]); continue; } const ex = q.cut ? q.ex : q.tx, ey = q.cut ? q.ey : q.ty, ez = q.cut ? z + 6 : (t.tipZ ?? q.tz) - RF * 0.35, f1 = q.cut ? Math.max(0, 1 - q.age / 0.3) : 1, thn = q.w * clamp(1 - 0.75 * (q.len || 0) / q.max, 0.18, 1); thr.set(k, (i) => { const f = i / 10 * (q.cut ? 0.5 * f1 : 1), sag = Math.sin(Math.PI * f) * (1.5 + 0.12 * (q.len || 0)) * 0.6, wd = thn + (q.w + 0.9) * Math.pow(Math.abs(f - 0.5) * 2, 4); return [q.x + (ex - q.x) * f, q.y + (ey - q.y) * f, z - 0.5 + (ez - z) * f - sag * (f > 0 && f < 1 ? 1 : 0) + 0.4, wd * (q.cut ? f1 : 1)]; }, [0.3, 0.9, 0.3]); } thr.done(); };
  } else { // posts, grass
    const g = t.kind === 'grass', S = g ? 4 : 10, T = new Tubes(t.posts.length, S, g ? 3 : 12, new THREE.MeshStandardMaterial({ roughness: g ? 0.8 : 0.45, vertexColors: true, side: g ? THREE.DoubleSide : THREE.FrontSide }), true), C = [[0.55, 0.8, 0.92], [0.95, 0.78, 0.42], [0.86, 0.4, 0.36]]; G.add(T.mesh); slab(t.floor, g ? 'soil' : 'wood');
    t.posts.forEach((b, c) => T.paint(c, (f) => (g ? [0.1 + 0.35 * f + 0.1 * b.c, 0.28 + 0.45 * f + 0.1 * b.c, 0.1 + 0.08 * f] : C[b.c])));
    const draw = (b, c, balls = []) => { const bend = Math.hypot(b.u, b.w), z1 = b.h * Math.sqrt(Math.max(0.3, 1 - (bend / b.h) ** 2)); T.set(c, (i) => { const f = i / S, q = f * f, coil = g ? 0 : 0.22 * b.r * Math.sin(f * 40); return clear([b.x + (b.lx + b.u) * q, b.y + (b.ly + b.w) * q, t.floor + z1 * f, g ? b.r * (1 - 0.85 * f) : b.r * (f > 0.99 ? 0.4 : 1) + coil], balls, 3); }, [0, 1, 0]); };
    t.posts.forEach((b, c) => draw(b, c)); T.done(); let was = new Set(); update = (sp, dt, sz, go, balls = []) => { const now = new Set(), top = t.floor + (g ? 34 : 70), B = balls.filter(([q, r]) => q[2] - r < top); t.posts.forEach((b, c) => { const near = B.filter(([q, r]) => Math.abs(q[0] - b.x) < r + 24 && Math.abs(q[1] - b.y) < r + 24); if (b.live || near.length || was.has(c)) draw(b, c, near); if (b.live || near.length) now.add(c); }); was = now; T.done(); };
  }
  return { group: G, update };
}
