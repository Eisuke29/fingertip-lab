// The picture: a box behind the glass, the material, the virtual finger. Drawn for one eye position (off-axis projection).
import * as THREE from 'three';
import { MATS, RF, grain, toHand } from './finger.js?v=5';
import { SkinFinger } from './skin.js?v=5';

const V = (a) => new THREE.Vector3(a[0], a[1], a[2]), UP = new THREE.Vector3(0, 1, 0);
const COL = { prox: 0x35a57a, mid: 0x4f8fe6, dist: 0xf09a3e };
export const DEPTH = 100; // mm, the box behind the glass

function gridTexture(line, alpha) {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  g.fillStyle = line ? '#14181a' : '#ffffff'; g.fillRect(0, 0, 256, 256); g.strokeStyle = line || 'rgba(0,0,0,.30)'; g.lineWidth = 6; g.strokeRect(0, 0, 256, 256);
  g.strokeStyle = line || 'rgba(0,0,0,.12)'; g.lineWidth = 3; g.globalAlpha = alpha ?? 1; g.beginPath(); g.moveTo(128, 0); g.lineTo(128, 256); g.moveTo(0, 128); g.lineTo(256, 128); g.stroke();
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
export class Scene {
  constructor(canvas) {
    this.r = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }); this.r.setPixelRatio(Math.min(1.5, devicePixelRatio)); this.r.localClippingEnabled = true;
    this.r.shadowMap.enabled = true; this.r.shadowMap.type = THREE.PCFSoftShadowMap; this.r.setClearColor(0x0a0c0c);
    this.scene = new THREE.Scene(); this.cam = new THREE.PerspectiveCamera();
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x6a7070, 1.5));
    this.sun = new THREE.DirectionalLight(0xffffff, 1.7); this.sun.castShadow = true; this.sun.shadow.mapSize.set(1024, 1024); this.sun.shadow.radius = 4; this.sun.shadow.bias = -0.0008;
    this.scene.add(this.sun, this.sun.target);
    const clip = [new THREE.Plane(new THREE.Vector3(0, 0, -1), 0)], mat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.55, clippingPlanes: clip, transparent: true, side: THREE.DoubleSide });
    const add = (g, m) => { const x = new THREE.Mesh(g, m); x.castShadow = true; x.visible = false; x.frustumCulled = false; this.scene.add(x); return x; };
    this.seg = [COL.prox, COL.mid, COL.dist].map((c) => add(new THREE.BufferGeometry(), mat(c)));
    this.cap = add(new THREE.CircleGeometry(RF, 40), new THREE.MeshStandardMaterial({ color: COL.prox, roughness: 0.55, transparent: true })); this.cap.castShadow = false; // closes the finger where the glass cuts it
    this.skin = new SkinFinger(this.scene, clip, (t) => this.r.initTexture(t)); // to the graphics chip as soon as it is here, not when the finger first appears
    this.stick = add(new THREE.CylinderGeometry(2.6, 2.6, 1, 20), mat(0xe6e9ec)); this.cursor = add(new THREE.SphereGeometry(5, 28, 18), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 }));
    this.surfMat = new THREE.MeshStandardMaterial({ roughness: 0.7, map: gridTexture() });
    this.box = new THREE.Group(); this.scene.add(this.box); this.surfZ = -78; this.mat = null;
  }
  layout(mmPerPx) {
    const w = innerWidth, h = innerHeight; this.r.setSize(w, h, false); this.W = w * mmPerPx; this.H = h * mmPerPx;
    this.box.clear(); const W = this.W - 8, H = this.H - 8, wall = new THREE.MeshStandardMaterial({ map: gridTexture('rgba(160,190,185,.18)'), roughness: 0.95 });
    const plane = (a, b, pos, rot) => { const m = wall.clone(); m.map = wall.map.clone(); m.map.repeat.set(a / 20, b / 20); m.map.needsUpdate = true; const p = new THREE.Mesh(new THREE.PlaneGeometry(a, b), m); p.position.set(...pos); p.rotation.set(...rot); p.receiveShadow = true; this.box.add(p); };
    plane(W, H, [0, 0, -DEPTH], [0, 0, 0]); plane(DEPTH, H, [-W / 2, 0, -DEPTH / 2], [0, Math.PI / 2, 0]); plane(DEPTH, H, [W / 2, 0, -DEPTH / 2], [0, -Math.PI / 2, 0]);
    plane(W, DEPTH, [0, -H / 2, -DEPTH / 2], [-Math.PI / 2, 0, 0]); plane(W, DEPTH, [0, H / 2, -DEPTH / 2], [Math.PI / 2, 0, 0]);
    const frame = new THREE.MeshBasicMaterial({ color: 0x050606 }), rect = (x0, y0, x1, y1) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, y1 - y0), frame); m.position.set((x0 + x1) / 2, (y0 + y1) / 2, 0); this.box.add(m); };
    rect(-W, -H, W, -H / 2); rect(-W, H / 2, W, H); rect(-W, -H / 2, -W / 2, H / 2); rect(W / 2, -H / 2, W, H / 2);
    const nx = 120, ny = Math.round(120 * H / W); this.n = [nx, ny]; this.size = [W, H];
    if (this.surf) { this.scene.remove(this.surf); this.surf.geometry.dispose(); }
    this.surf = new THREE.Mesh(new THREE.PlaneGeometry(W, H, nx, ny), this.surfMat); this.surf.receiveShadow = true; this.surf.frustumCulled = false; this.scene.add(this.surf);
    this.surfMat.map.repeat.set(W / 12, H / 12); this.rest = this.surf.geometry.attributes.position.array.slice(); this.dirty = true; this.box0 = null;
    const e = Math.hypot(W, H) / 2 + 60, c = this.sun.shadow.camera; Object.assign(c, { left: -e, right: e, top: e, bottom: -e, near: 10, far: 900 }); c.updateProjectionMatrix();
  }
  // everything is prepared before the first touch (otherwise the first picture of the finger takes half a second)
  warm() { this.skin.update([[0, 0, 11], [0, 0, -32], [0, 0, -57], [0, 0, -74]], 'mp', [0, -1, 0], 1); const on = [...this.seg, this.cap, this.stick, this.cursor, this.skin.mesh, this.skin.nail, this.skin.cap], was = on.map((m) => m.visible); for (const m of on) m.visible = true; this.r.compile(this.scene, this.cam); this.render([0, -175, 553]); on.forEach((m, i) => { m.visible = was[i]; }); }
  // the light comes from above in the real world (measured tilt), a little from the right so that the shadow falls sideways
  light(up) { const t = [0, 0, -DEPTH]; this.sun.target.position.set(...t); this.sun.position.set(up[0] * 300 + 190, up[1] * 300 + 20, Math.max(120, up[2] * 300)); }
  setMaterial(key) { if (this.mat === key) return; this.mat = key; this.surfMat.color.set(MATS[key].color); this.surfMat.roughness = MATS[key].rough; this.dirty = true; }
  // drawing cannot keep up: fewer pixels (less delay)
  lighter() { const p = this.r.getPixelRatio(); if (p <= 1) return; this.r.setPixelRatio(p - 0.25); this.r.setSize(innerWidth, innerHeight, false); }
  setDepth(z) { if (Math.abs(z - this.surfZ) < 0.01) return; this.surfZ = z; this.dirty = true; }
  // the finger never goes into the material: the material gives way. spheres: [[x, y, z], r]. Only the part around the finger is computed.
  deform(spheres, pull) {
    if (!spheres.length && !this.dirty && !this.was) return;
    const g = this.surf.geometry, p = g.attributes.position.array, q = g.attributes.normal.array, r0 = this.rest, M = MATS[this.mat], c = spheres[0]?.[0], [nx, ny] = this.n, [W, H] = this.size, sx = W / nx, sy = H / ny, w = nx + 1, REACH = 46;
    const flat = (i) => { p[i] = r0[i]; p[i + 1] = r0[i + 1]; p[i + 2] = this.surfZ + (M.bump ? M.bump * grain(r0[i], r0[i + 1]) : 0); };
    if (this.dirty) { for (let i = 0; i < p.length; i += 3) flat(i); this.normals(0, nx, 0, ny); }
    const box = c ? [Math.max(0, Math.floor((c[0] - REACH + W / 2) / sx)), Math.min(nx, Math.ceil((c[0] + REACH + W / 2) / sx)), Math.max(0, Math.floor((H / 2 - c[1] - REACH) / sy)), Math.min(ny, Math.ceil((H / 2 - c[1] + REACH) / sy))] : null, o = this.box0;
    if (o) for (let j = o[2]; j <= o[3]; j++) for (let i = o[0]; i <= o[1]; i++) flat((j * w + i) * 3);
    if (box) {
      const deep = Math.min(M.dent, Math.max(0, this.surfZ - (c[2] - spheres[0][1])));
      for (let j = box[2]; j <= box[3]; j++) for (let i = box[0]; i <= box[1]; i++) {
        const k = (j * w + i) * 3, x0 = r0[k], y0 = r0[k + 1], dx = x0 - c[0], dy = y0 - c[1], d2 = dx * dx + dy * dy; if (d2 > REACH * REACH) continue;
        const e = Math.exp(-d2 / 242); let x = x0 + pull[0] * M.drag * e, y = y0 + pull[1] * M.drag * e, z = p[k + 2] - deep * e;
        if (d2 < 1600) for (const [s, r] of spheres) { const ex = x - s[0], ey = y - s[1], e2 = ex * ex + ey * ey; if (e2 < r * r) z = Math.min(z, s[2] - Math.sqrt(r * r - e2) - 0.1); }
        p[k] = x; p[k + 1] = y; p[k + 2] = z;
      }
    }
    for (const b of [o, box]) if (b) this.normals(Math.max(0, b[0] - 1), Math.min(nx, b[1] + 1), Math.max(0, b[2] - 1), Math.min(ny, b[3] + 1));
    this.box0 = box; g.attributes.position.needsUpdate = g.attributes.normal.needsUpdate = true; this.dirty = false; this.was = spheres.length > 0;
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
  // f: the solved finger (or null), kind: finger / stick / cursor
  finger(f, kind, root, alpha, lag, joint = 'mp', look = 'real', yaw = 0) {
    const on = !!f, real = look === 'real'; this.skin.visible = on && kind === 'finger' && real; this.seg.forEach((m, i) => { m.visible = on && kind === 'finger' && !real && (i > 0 || joint === 'mp'); }); this.cap.visible = on && kind === 'finger' && !real; this.stick.visible = on && kind === 'stick'; this.cursor.visible = on && kind === 'cursor';
    if (!on) { this.spheres = []; this.deform([], [0, 0]); return; }
    for (const m of this.seg) m.material.opacity = alpha; this.cap.material.opacity = alpha;
    let sp;
    if (kind === 'finger') {
      if (real) this.skin.update(joint === 'mp' ? [root, f.pip, f.dip, f.tip] : [root, f.dip, f.tip], joint, toHand(yaw), alpha); else {
      if (joint === 'mp') this.capsule(this.seg[0], root, f.pip, RF); this.cap.material.color.setHex(joint === 'mp' ? COL.prox : COL.mid);
      this.capsule(this.seg[1], f.pip, f.dip, RF * 0.975); this.capsule(this.seg[2], f.dip, f.tip, RF * 0.95); // a little thinner each: the joints do not flicker
      const s = Math.max(0.3, -f.u[2]), cx = root[0] + f.u[0] * root[2] / s, cy = root[1] + f.u[1] * root[2] / s; this.cap.position.set(cx, cy, -0.05); this.cap.rotation.z = Math.atan2(f.u[1], f.u[0]); this.cap.scale.set(Math.min(2, 1 / s), 1, 1); }
      sp = [[f.tip, RF]]; for (let i = 1; i <= 5; i++) sp.push([[0, 1, 2].map((j) => f.tip[j] + (f.dip[j] - f.tip[j]) * i / 5), RF]);
    } else if (kind === 'stick') {
      const e = [f.tip[0], f.tip[1], f.tip[2] - RF + 2.6], a = V(e).sub(V(root)); this.stick.scale.y = a.length(); this.stick.position.copy(V(root)).addScaledVector(a, 0.5); this.stick.quaternion.setFromUnitVectors(UP, a.normalize()); sp = [[e, 2.6]];
    } else { const e = [f.cursor[0], f.cursor[1], f.tip[2] - RF + 5]; this.cursor.position.set(...e); sp = [[e, 5]]; }
    this.spheres = sp; this.deform(sp, [-lag[0], -lag[1]]);
  }
  render(eye) {
    const n = 5, [x, y] = eye, z = Math.max(80, eye[2]), w = this.W / 2, h = this.H / 2, c = this.cam;
    c.position.set(x, y, z); c.quaternion.identity(); c.updateMatrixWorld();
    c.projectionMatrix.makePerspective((-w - x) * n / z, (w - x) * n / z, (h - y) * n / z, (-h - y) * n / z, n, 4000); c.projectionMatrixInverse.copy(c.projectionMatrix).invert();
    this.r.render(this.scene, c);
  }
}
