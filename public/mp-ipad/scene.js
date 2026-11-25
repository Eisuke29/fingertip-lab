// The picture: a box behind the glass, the material, the virtual finger. Drawn for one eye position (off-axis projection).
import * as THREE from 'three';
import { MATS, RF, grain, toHand, add } from './finger.js?v=14';
import { ground } from './world.js?v=14';
import { Blade } from './blade.js?v=14';
import { SkinFinger } from './skin.js?v=14';
import { surface, copyOf, TILE } from './tex.js?v=14';
import { view, terraces } from './objview.js?v=14';

const V = (a) => new THREE.Vector3(a[0], a[1], a[2]), UP = new THREE.Vector3(0, 1, 0);
export const DEPTH = 165; // mm, the room behind the glass

export class Scene {
  constructor(canvas) {
    this.r = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }); this.r.setPixelRatio(Math.min(1.5, devicePixelRatio)); this.r.localClippingEnabled = true;
    this.r.shadowMap.enabled = true; this.r.shadowMap.type = THREE.PCFShadowMap; this.r.setClearColor(0x0a0c0c);
    this.scene = new THREE.Scene(); this.cam = new THREE.PerspectiveCamera();
    this.sky = new THREE.HemisphereLight(0xffffff, 0x6a6660, 1); this.scene.add(this.sky); this.scene.fog = new THREE.Fog(0x0b0d12, 600, 900); this.environment();
    this.sun = new THREE.DirectionalLight(0xfff6ea, 1.75); this.sun.castShadow = true; this.sun.shadow.mapSize.set(1024, 1024); this.sun.shadow.radius = 4; this.sun.shadow.bias = -0.0008; this.sun.shadow.normalBias = 0.7;
    this.scene.add(this.sun, this.sun.target);
    const clip = [new THREE.Plane(new THREE.Vector3(0, 0, -1), 0)], mat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.55, clippingPlanes: clip, transparent: true, side: THREE.DoubleSide });
    const add = (g, m) => { const x = new THREE.Mesh(g, m); x.castShadow = true; x.visible = false; x.frustumCulled = false; this.scene.add(x); return x; };
    this.skins = [new SkinFinger(this.scene, clip, (t) => this.r.initTexture(t))]; this.skins.push(new SkinFinger(this.scene, clip, null, this.skins[0])); this.skin = this.skins[0]; this.blade = new Blade(this.scene); this.groups = []; // to the graphics chip as soon as it is here, not when the finger first appears
    this.sticks = [0, 1].map(() => add(new THREE.CylinderGeometry(2.6, 2.6, 1, 20), mat(0xe6e9ec))); this.cursors = [0, 1].map(() => add(new THREE.SphereGeometry(5, 28, 18), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 })));
    this.surfMat = surface('knit'); { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'), q = g.createRadialGradient(32, 32, 2, 32, 32, 32); q.addColorStop(0, 'rgba(0,0,0,.8)'); q.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = q; g.fillRect(0, 0, 64, 64); this.under = [0, 1].map(() => { const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 })); m.visible = false; this.scene.add(m); return m; }); }
    this.box = new THREE.Group(); this.scene.add(this.box); this.surfZ = -78; this.mat = null; this.thing = null; this.fur = []; this.wave = null;
  }
  // soft light from all sides with two bright windows: what shines (ceramic, honey, nail) has something to reflect
  environment() {
    const s = new THREE.Scene(), pm = new THREE.PMREMGenerator(this.r), add = (c, i, w, h, p) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(i), side: THREE.DoubleSide })); m.position.set(...p); m.lookAt(0, 0, 0); s.add(m); };
    s.background = new THREE.Color(0.42, 0.42, 0.44); add(0xffffff, 4, 4, 3, [4, 3, 4]); add(0xdfeaff, 4, 2, 4, [-6, 1, 2]); add(0x40352c, 0.6, 12, 12, [0, -6, 0]);
    this.scene.environment = pm.fromScene(s, 0.03).texture; this.scene.environmentIntensity = 0.5; pm.dispose();
  }
  // the thing to touch (objects.js), or none: then the plain surface. flat: the surface is there too
  setThing(t) {
    if (this.thing === t) return; this.thing = t; if (this.vw) { this.scene.remove(this.vw.group); this.vw.group.traverse((m) => m.geometry?.dispose()); this.vw = null; } this.surf.visible = !t || !!t.flat; this.stand();
    if (t) { this.vw = view(t); this.scene.add(this.vw.group); this.vw.update([], 0, this.surfZ, 1); } this.dirty = true;
  }
  layout(mmPerPx) {
    const w = innerWidth, h = innerHeight; this.r.setSize(w, h, false); this.W = w * mmPerPx; this.H = h * mmPerPx;
    this.box.traverse((m) => m.geometry?.dispose()); this.box.clear(); const W = this.W - 8, H = this.H - 8;
    // the room gets narrower in steps toward the back: every step is an edge, light on its face and dark behind it
    const D = DEPTH, Z = [0, 16, 36, 60, 90, 125, D], inset = (i) => i * 3.4, band = (key, pts, uv, col) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts.flat(), 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv.flat().map((v) => v / TILE[key]), 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(col.flatMap((c) => [c, c, c]), 3)); g.setIndex([0, 1, 2, 2, 1, 3]); g.computeVertexNormals(); const m = (this.wallMat ||= {})[key] ||= Object.assign(copyOf(key), { vertexColors: true, side: THREE.DoubleSide }), p = new THREE.Mesh(g, m); p.receiveShadow = p.castShadow = true; this.box.add(p); };
    const line = new THREE.LineBasicMaterial({ color: 0xf2cda6, transparent: true, opacity: 0.55 }), ring = (i, z) => { const a = W / 2 - inset(i), b = H / 2 - inset(i), g = new THREE.BufferGeometry().setFromPoints([[-a, -b], [a, -b], [a, b], [-a, b], [-a, -b]].map(([x, y]) => new THREE.Vector3(x, y, z))), l = new THREE.Line(g, line.clone()); l.material.opacity = 0.75 * (1 - i / 8); this.box.add(l); };
    for (let i = 0; i < Z.length - 1; i++) {
      const z0 = -Z[i], z1 = -Z[i + 1], a = W / 2 - inset(i), b = H / 2 - inset(i), a1 = W / 2 - inset(i + 1), b1 = H / 2 - inset(i + 1), f = 1 - i / 7.5, hi = 1.15 * f + 0.1, lo = hi * 0.36, d = Z[i + 1] - Z[i];
      for (const s of [-1, 1]) { // walls: dark in the corner behind the step, then the face of the next step, light
        band('wall', [[s * a, -b, z0], [s * a, b, z0], [s * a, -b, z1], [s * a, b, z1]], [[-b, 0], [b, 0], [-b, d], [b, d]], [hi * 0.75, hi * 0.75, lo, lo]); band('wall', [[-a, s * b, z0], [a, s * b, z0], [-a, s * b, z1], [a, s * b, z1]], [[-a, 0], [a, 0], [-a, d], [a, d]], s > 0 ? [hi * 0.6, hi * 0.6, lo * 0.8, lo * 0.8] : [hi * 0.85, hi * 0.85, lo, lo]);
        band('wall', [[s * a, -b, z1], [s * a, b, z1], [s * a1, -b1, z1], [s * a1, b1, z1]], [[-b, 0], [b, 0], [-b, 4], [b, 4]], [lo, lo, hi * 1.1, hi * 1.1]); band('wall', [[-a, s * b, z1], [a, s * b, z1], [-a1, s * b1, z1], [a1, s * b1, z1]], [[-a, 0], [a, 0], [-a, 4], [a, 4]], [lo, lo, hi * 1.1, hi * 1.1]);
      }
      ring(i + 1, z1 + 0.2);
    }
    { const a = W / 2 - inset(6), b = H / 2 - inset(6); band('wood', [[-a, -b, -D], [a, -b, -D], [-a, b, -D], [a, b, -D]], [[-a, -b], [a, -b], [-a, b], [a, b]], [0.3, 0.3, 0.3, 0.3]); }
    const frame = new THREE.MeshBasicMaterial({ color: 0x050606 }), rect = (x0, y0, x1, y1) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, y1 - y0), frame); m.position.set((x0 + x1) / 2, (y0 + y1) / 2, 0); this.box.add(m); };
    rect(-W, -H, W, -H / 2); rect(-W, H / 2, W, H); rect(-W, -H / 2, -W / 2, H / 2); rect(W / 2, -H / 2, W, H / 2);
    const IW = this.IW = W * 0.62, IH = this.IH = H * 0.62, nx = 120, ny = Math.round(120 * IH / IW); this.n = [nx, ny]; this.size = [IW, IH]; this.ped = null; // the part that can be touched is an island in the middle
    for (const f of this.fur) this.scene.remove(f); if (this.surf) { this.scene.remove(this.surf); this.surf.geometry.dispose(); }
    this.surf = new THREE.Mesh(new THREE.PlaneGeometry(IW, IH, nx, ny), this.surfMat); this.surf.receiveShadow = true; this.surf.frustumCulled = false; this.scene.add(this.surf);
    this.surf.visible = !this.thing || !!this.thing.flat; this.tile(); this.wave = null; this.fur = []; this.rest = this.surf.geometry.attributes.position.array.slice(); this.dirty = true; this.box0 = null;
    const e = Math.hypot(W, H) / 2 + 60, c = this.sun.shadow.camera; Object.assign(c, { left: -e, right: e, top: e, bottom: -e, near: 10, far: 900 }); c.updateProjectionMatrix();
  }
  // what the island stands on: steps that get wider downward
  stand() { const on = this.surf.visible, k = on ? this.surfZ.toFixed(1) + this.mat + this.IW : ''; if (k === this.pedKey && this.ped) return; this.pedKey = k; if (this.ped) { this.scene.remove(this.ped); this.ped.traverse((m) => m.geometry?.dispose()); this.ped = null; } if (on) { this.ped = terraces(this.IW / 2, this.IH / 2, this.surfZ - 0.4, DEPTH, 'wood'); this.scene.add(this.ped); } }
  // how strong light and dark are (0..1.5)
  shade(k) { if (this.sh === k) return; this.sh = k; this.sky.intensity = Math.max(0.12, 1.15 - 0.62 * k); this.sun.intensity = 1.3 + 1.1 * k; this.scene.environmentIntensity = Math.max(0.12, 0.55 - 0.2 * k); }
  // everything is prepared before the first touch (otherwise the first picture of the finger takes half a second)
  warm() { this.skins.forEach((q) => q.update([[0, 0, 8.2], [0, 0, -30], [0, 0, -59]], 'joint', [0, -1, 0], 1)); const on = [...this.sticks, ...this.cursors, this.skin.mesh, this.skin.cap, this.skin.blob, this.blade.g], was = on.map((m) => m.visible); for (const m of on) m.visible = true; this.r.compile(this.scene, this.cam); this.render([0, -175, 553]); on.forEach((m, i) => { m.visible = was[i]; }); }
  // the light comes from above in the real world (measured tilt), a little from the right so that the shadow falls sideways
  light(up) { const t = [0, 0, -DEPTH]; this.sun.target.position.set(...t); this.sun.position.set(up[0] * 300 + 190, up[1] * 300 + 20, Math.max(120, up[2] * 300)); }
  setMaterial(key) { if (this.mat === key) return; this.mat = key; this.surfMat = this.surf.material = surface(key); this.tile(); this.dirty = true; this.wave = null; this.stand(); }
  // the texture keeps its size in mm
  tile() { const g = this.surf?.geometry, T = TILE[this.mat]; if (!g || !T) return; const u = g.attributes.uv, p = this.rest; for (let i = 0; i < u.count; i++) u.setXY(i, p[i * 3] / T, p[i * 3 + 1] / T); u.needsUpdate = true; }
  // drawing cannot keep up: fewer pixels (less delay)
  lighter() { const p = this.r.getPixelRatio(); if (p <= 1) return; this.r.setPixelRatio(p - 0.25); this.r.setSize(innerWidth, innerHeight, false); }
  setDepth(z) { if (Math.abs(z - this.surfZ) < 0.01) return; this.surfZ = z; this.dirty = true; this.stand(); }
  // the finger never goes into the material: the material gives way. spheres: [[x, y, z], r]. Only the part around the finger is computed.
  // groups: one per finger: { spheres: [[[x, y, z], r], ...], pull }. go: how much the material gives way
  deform(groups, go = 1) {
    if (this.mat === 'water') { this.ripple(groups); return; }
    if (!groups.length && !this.dirty && !this.was) return;
    const g = this.surf.geometry, p = g.attributes.position.array, r0 = this.rest, M = MATS[this.mat], [nx, ny] = this.n, [W, H] = this.size, sx = W / nx, sy = H / ny, w = nx + 1, REACH = 46;
    const flat = (i) => { p[i] = r0[i]; p[i + 1] = r0[i + 1]; p[i + 2] = this.surfZ + (M.bump ? M.bump * grain(r0[i], r0[i + 1], M.f) : 0); };
    if (this.dirty) { for (let i = 0; i < p.length; i += 3) flat(i); this.normals(0, nx, 0, ny); }
    const old = this.box0 || [], now = []; for (const o of old) for (let j = o[2]; j <= o[3]; j++) for (let i = o[0]; i <= o[1]; i++) flat((j * w + i) * 3);
    for (const { spheres, pull } of groups) {
      const c = spheres[0][0], box = [Math.max(0, Math.floor((c[0] - REACH + W / 2) / sx)), Math.min(nx, Math.ceil((c[0] + REACH + W / 2) / sx)), Math.max(0, Math.floor((H / 2 - c[1] - REACH) / sy)), Math.min(ny, Math.ceil((H / 2 - c[1] + REACH) / sy))]; now.push(box);
      const deep = Math.min(M.dent * go, Math.max(0, this.surfZ - (c[2] - spheres[0][1])));
      for (let j = box[2]; j <= box[3]; j++) for (let i = box[0]; i <= box[1]; i++) {
        const k = (j * w + i) * 3, x0 = r0[k], y0 = r0[k + 1], dx = x0 - c[0], dy = y0 - c[1], d2 = dx * dx + dy * dy; if (d2 > REACH * REACH) continue;
        const e = Math.exp(-d2 / 242), x = p[k] + pull[0] * e, y = p[k + 1] + pull[1] * e; let z = p[k + 2] - deep * e;
        if (d2 < 1600) for (const [s, r] of spheres) { const ex = x - s[0], ey = y - s[1], e2 = ex * ex + ey * ey; if (e2 < r * r) z = Math.min(z, s[2] - Math.sqrt(r * r - e2) - 0.1); }
        p[k] = x; p[k + 1] = y; p[k + 2] = z;
      }
    }
    for (const b of [...old, ...now]) this.normals(Math.max(0, b[0] - 1), Math.min(nx, b[1] + 1), Math.max(0, b[2] - 1), Math.min(ny, b[3] + 1));
    this.box0 = now; g.attributes.position.needsUpdate = g.attributes.normal.needsUpdate = true; this.dirty = false; this.was = groups.length > 0;
  }
  // water: waves run out from the moving fingertip
  ripple(groups) {
    const [nx, ny] = this.n, w = nx + 1, N = w * (ny + 1), [W, H] = this.size, o = this.wave ||= { a: new Float32Array(N), v: new Float32Array(N) }, p = this.surf.geometry.attributes.position.array, r0 = this.rest; this.wls ||= [];
    [0, 1].forEach((q) => { const c = groups[q]?.spheres[0][0]; this.wl = this.wls[q]; if (c) { const sp = this.wl ? Math.min(6, Math.hypot(c[0] - this.wl[0], c[1] - this.wl[1])) : 0, ci = (c[0] + W / 2) / W * nx, cj = (H / 2 - c[1]) / H * ny; this.wl = [c[0], c[1]]; for (let j = Math.max(1, Math.floor(cj - 5)); j <= Math.min(ny - 1, cj + 5); j++) for (let i = Math.max(1, Math.floor(ci - 5)); i <= Math.min(nx - 1, ci + 5); i++) { const d = ((i - ci) ** 2 + (j - cj) ** 2) / 8; o.a[j * w + i] += (-(0.5 + sp * 0.5) * Math.exp(-d) - o.a[j * w + i]) * 0.3 * Math.exp(-d); } } else this.wl = null; this.wls[q] = this.wl; });
    const tw = performance.now() / 600; for (let s = 0; s < 2; s++) { for (let j = 1; j < ny; j++) for (let i = 1; i < nx; i++) { const k = j * w + i; o.v[k] = (o.v[k] + (o.a[k - 1] + o.a[k + 1] + o.a[k - w] + o.a[k + w] - 4 * o.a[k]) * 0.16) * 0.985; } for (let k = 0; k < N; k++) o.a[k] += o.v[k]; }
    for (let k = 0; k < N; k++) { p[k * 3] = r0[k * 3]; p[k * 3 + 1] = r0[k * 3 + 1]; p[k * 3 + 2] = this.surfZ - 1.2 + o.a[k] * 0.9 + 0.16 * Math.sin(r0[k * 3] * 0.21 + tw) + 0.14 * Math.sin(r0[k * 3 + 1] * 0.27 + r0[k * 3] * 0.09 - tw * 1.3); } this.normals(0, nx, 0, ny); this.surf.geometry.attributes.position.needsUpdate = this.surf.geometry.attributes.normal.needsUpdate = true;
  }
  // fur: thin layers of hair tips above the surface, lying down where a finger passes
  hair(on, groups) {
    if (on && !this.fur.length) {
      const S = 128, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d'), im = g.createImageData(S, S); let q = 9; for (let i = 0; i < S * S; i++) { q = (q * 16807) % 2147483647; const v = q / 2147483647 * 255; im.data.set([v, v, v, 255], i * 4); } g.putImageData(im, 0, 0); const tx = new THREE.CanvasTexture(c); tx.wrapS = tx.wrapT = THREE.RepeatWrapping; tx.magFilter = THREE.LinearFilter;
      const V2 = (v) => ({ value: new THREE.Vector2(v, v) }); this.furU = { tip0: V2(999), tip1: V2(999), lean0: V2(0), lean1: V2(0), hairs: { value: tx } };
      for (let i = 1; i <= 7; i++) { const m = copyOf('fur'), L = i / 7; m.onBeforeCompile = (s) => { Object.assign(s.uniforms, this.furU); s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nuniform vec2 tip0, tip1, lean0, lean1; varying vec2 vP;').replace('#include <begin_vertex>', `vec3 transformed = position; vP = position.xy; float da = dot(position.xy - tip0, position.xy - tip0), db = dot(position.xy - tip1, position.xy - tip1); transformed.xy += (vec2(0.4, -0.9) * 1.4 + lean0 * exp(-da / 260.0) + lean1 * exp(-db / 260.0)) * ${(L * L).toFixed(3)}; transformed.z += ${(L * 5).toFixed(2)} * (1.0 - 0.85 * exp(-da / 110.0)) * (1.0 - 0.85 * exp(-db / 110.0));`); s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D hairs; varying vec2 vP;').replace('#include <map_fragment>', `#include <map_fragment>\n if (texture2D(hairs, vP / 26.0).r < ${(0.25 + 0.68 * L).toFixed(3)}) discard; diffuseColor.rgb *= ${(0.55 + 0.6 * L).toFixed(3)};`); }; m.customProgramCacheKey = () => 'fur' + i; const f = new THREE.Mesh(this.surf.geometry, m); f.frustumCulled = false; f.receiveShadow = true; this.scene.add(f); this.fur.push(f); }
    }
    for (const f of this.fur) { f.visible = on; f.geometry = this.surf.geometry; } if (on && this.furU) for (const i of [0, 1]) { const g = groups[i], T = this.furU[`tip${i}`].value, L = this.furU[`lean${i}`].value; if (g) { T.set(g.spheres[0][0][0], g.spheres[0][0][1]); L.lerp(new THREE.Vector2(...g.lean).multiplyScalar(0.7), 0.3); } else { L.multiplyScalar(0.9); if (L.length() < 0.05) T.set(999, 999); } }
  }
  normals(i0, i1, j0, j1) {
    const p = this.surf.geometry.attributes.position.array, q = this.surf.geometry.attributes.normal.array, [nx, ny] = this.n, w = nx + 1;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = (j * w + i) * 3, a = (j * w + Math.max(0, i - 1)) * 3, b = (j * w + Math.min(nx, i + 1)) * 3, c = (Math.min(ny, j + 1) * w + i) * 3, d = (Math.max(0, j - 1) * w + i) * 3;
      const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], vx = p[d] - p[c], vy = p[d + 1] - p[c + 1], vz = p[d + 2] - p[c + 2], x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx, l = Math.sqrt(x * x + y * y + z * z) || 1;
      q[k] = x / l; q[k + 1] = y / l; q[k + 2] = z / l;
    }
  }
  capsule(m, a, b, r) {
    const A = V(a), d = V(b).sub(A), L = d.length(); m.position.copy(A).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(UP, d.normalize());
    if (Math.abs((m.userData.L || 0) - L) > 0.1) { m.geometry.dispose(); m.geometry = new THREE.CapsuleGeometry(r, L, 8, 24); m.userData.L = L; }
  }
  // list: one entry per finger { f: the solved finger (or null), root, alpha, smear, pull: what the material is drawn along (mm), lean, width }; kind: finger / stick / cursor
  finger(list, kind, contact, look = 'real', yaw = 0, go = 1) {
    this.groups = []; for (const i of [0, 1]) {
      const q = list[i], on = !!q?.f, S = this.skins[i]; S.setLook(look); if (q) S.setWidth(q.width); S.visible = on && kind === 'finger'; this.sticks[i].visible = on && kind === 'stick'; this.cursors[i].visible = on && kind === 'cursor'; if (!on) continue;
      const { f, root } = q; let sp;
      if (kind === 'finger') {
        S.update(f.P, contact, toHand(yaw), q.alpha, q.smear); sp = [[f.tip, RF]]; for (let k = 1; k <= 5; k++) sp.push([[0, 1, 2].map((j) => f.tip[j] + (f.dip[j] - f.tip[j]) * k / 5), RF]);
      } else if (kind === 'stick') {
        const e = [f.tip[0], f.tip[1], f.tip[2] - RF + 2.6], a = V(e).sub(V(root)), m = this.sticks[i]; m.scale.y = a.length(); m.position.copy(V(root)).addScaledVector(a, 0.5); m.quaternion.setFromUnitVectors(UP, a.normalize()); sp = [[e, 2.6]];
      } else { const e = [f.tip[0], f.tip[1], f.tip[2] - RF + 5]; this.cursors[i].position.set(...e); sp = [[e, 5]]; }
      if (S.slice == null) this.groups.push({ spheres: sp, pull: q.pull, lean: q.lean });
    }
    this.after(go);
  }
  after(go) {
    const t = this.thing; [0, 1].forEach((i) => { const tip = this.groups[i]?.spheres[0][0], z = tip && (t ? (t.pool ? null : t.floor ?? this.surfZ) : Math.abs(tip[0]) < this.IW / 2 && Math.abs(tip[1]) < this.IH / 2 ? this.surfZ : null), up = z == null ? 99 : tip[2] - RF - z, u = this.under[i]; u.visible = up < 30; if (up < 30) { const r = 22 + Math.max(0, up) * 1.4; u.position.set(tip[0], tip[1], z + 0.3); u.scale.set(r, r, 1); u.material.opacity = 0.75 * (1 - Math.max(0, up) / 30); } });
    if (this.surf.visible) this.deform(this.groups, go); this.hair(!t && this.mat === 'fur', this.groups); if (t) this.vw.update(this.groups.flatMap((g) => g.spheres), 0, this.surfZ, go);
  }
  // what lies below a point, for things that fall
  below(x, y) { const t = this.thing; if (Math.abs(x) > this.IW / 2 || Math.abs(y) > this.IH / 2) return -DEPTH; if (!t) return this.surfZ; if (t.w) return Math.max(ground(t.w, x, y).z - RF, t.floor ?? t.low - 24); return t.pool ? (t.deep ? t.surf - 4 : t.surf - 1) : t.floor ?? (t.kind === 'harp' ? t.board : t.low - 6); }
  // the real finger in front of the glass: proximal phalanx up from the knuckle, the rest folded into the fist
  ghost(g) {
    if (!g) { for (const m of this.gm || []) m.visible = false; return; }
    const [root, u, yaw, len] = g; this.gm ||= [0, 1, 2].map(() => { const m = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ roughness: 0.6 })); m.frustumCulled = false; this.scene.add(m); return m; });
    const r = [root[0], root[1], 9.6], f = { up: u.map((v) => -v) }, H = toHand(yaw), mcp = add(r, f.up, len[0]), dip = add(add(r, H, len[1]), [0, 0, 1], 5), end = add(add(dip, f.up, 14), H, -6);
    for (const [m, a, b, w] of [[this.gm[0], r, mcp, 9.6], [this.gm[1], r, dip, 8.6], [this.gm[2], dip, end, 8]]) { this.capsule(m, a, b, w); m.visible = true; m.material.color.copy(this.skin.skin); }
  }
  render(eye) {
    { const k = this.sh ?? 1; this.scene.fog.near = eye[2] + 45; this.scene.fog.far = eye[2] + DEPTH * (2.6 - 1.1 * k); }
    const n = 5, [x, y] = eye, z = Math.max(80, eye[2]), w = this.W / 2, h = this.H / 2, c = this.cam;
    c.position.set(x, y, z); c.quaternion.identity(); c.updateMatrixWorld();
    c.projectionMatrix.makePerspective((-w - x) * n / z, (w - x) * n / z, (h - y) * n / z, (-h - y) * n / z, n, 4000); c.projectionMatrixInverse.copy(c.projectionMatrix).invert();
    this.r.render(this.scene, c);
  }
}
