// The blade that falls from above and cuts the virtual finger in the middle between the contact and the fingertip. Only when the person has switched it on.
import * as THREE from 'three';
import { copyOf } from './tex.js?v=12';

const V = (x, y, z) => new THREE.Vector3(x, y, z), W = 78, HIGH = 66;
export class Blade {
  constructor(scene) {
    this.scene = scene; this.t = null; this.g = new THREE.Group(); this.g.visible = false; scene.add(this.g);
    // steel: a thick plate with a ground edge (the edge is the origin, the plate goes up along +y, the cut plane is z = 0)
    const pr = [[0, 0], [0.9, 7], [1.5, 11], [1.5, HIGH], [-1.5, HIGH], [-1.5, 11], [-0.9, 7]], pos = [], idx = [], slope = 0.14, steel = Object.assign(copyOf('iron'), { color: new THREE.Color(3.1, 3.2, 3.35), metalness: 0.3, roughness: 0.36, envMapIntensity: 0.9, normalScale: new THREE.Vector2(0.12, 0.12), side: THREE.DoubleSide, flatShading: true });
    for (const x of [-W / 2, W / 2]) for (const [z, y] of pr) pos.push(x, y + (y < 12 ? slope * (x + W / 2) * 0.5 : 0), z); // the edge is a little slanted
    const n = pr.length; for (let i = 0; i < n; i++) { const a = i, b = (i + 1) % n; idx.push(a, b, n + a, b, n + b, n + a); } for (let i = 1; i < n - 1; i++) idx.push(0, i, i + 1, n, n + i + 1, n + i);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(pos.flatMap((v, i) => (i % 3 === 0 ? [v / 40, pos[i + 1] / 40] : [])), 2)); g.setIndex(idx); g.computeVertexNormals(); const m = new THREE.Mesh(g, steel); m.castShadow = m.receiveShadow = true; this.g.add(m);
    const iron = copyOf('iron'), w = new THREE.Mesh(new THREE.BoxGeometry(W + 8, 16, 11), iron); w.position.y = HIGH + 6; w.castShadow = true; this.g.add(w); for (const x of [-28, 0, 28]) { const b = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 12.6, 16).rotateX(Math.PI / 2), steel); b.position.set(x, HIGH + 6, 0); this.g.add(b); }
    // the blood on the edge and the drops
    this.red = new THREE.MeshStandardMaterial({ color: 0x6a070b, roughness: 0.5, envMapIntensity: 0.35 }); this.drops = Array.from({ length: 26 }, () => { const d = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), this.red); d.visible = false; d.castShadow = true; scene.add(d); return { m: d, v: V(0, 0, 0), rest: true }; });
    this.pieces = [];
  }
  get busy() { return this.t != null; }
  // fingers: the skins to cut; top: how far up the picture goes
  start(skins, top) {
    this.skins = skins; const q = skins.map((s) => s.middle()), p = q.reduce((a, m) => a.add(m.p), V(0, 0, 0)).multiplyScalar(1 / q.length), t = q.reduce((a, m) => a.add(m.t), V(0, 0, 0)).normalize(), down = V(0, -1, 0).addScaledVector(t, t.y).normalize();
    this.p = p; this.dir = down; const x = down.clone().negate().cross(t).normalize(); this.g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, down.clone().negate(), x.clone().cross(down.clone().negate()))); this.r = q[0].r; this.y = Math.max(60, top - p.y + 25); this.v = 0; this.t = 0; this.cut = false; this.g.visible = true; this.place();
  }
  place() { this.g.position.copy(this.p).addScaledVector(this.dir, -this.y); }
  // gravity: direction of "down" of the real world; floor(x, y): height of what lies below. Returns true at the moment of the cut
  step(dt, gravity, floor) {
    let now = false; const h = Math.min(0.033, dt), G = V(...gravity);
    if (this.t != null) {
      this.t += h;
      if (this.stop == null) {
        // the finger is followed until the blade reaches it
        if (!this.cut) { const q = this.skins.map((s) => s.middle()), p = q.reduce((a, m) => a.add(m.p), V(0, 0, 0)).multiplyScalar(1 / q.length); this.p.copy(p); }
        this.v += 1700 * h; this.y -= this.v * h; if (!this.cut && this.y < 1) { this.cut = now = true; for (const s of this.skins) this.off(s); } if (this.y < -this.r - 14) { this.y = -this.r - 14; this.stop = this.t; }
      } else { const s = this.t - this.stop; this.g.position.copy(this.p); if (s < 0.25) this.y = -this.r - 14 + 2.2 * Math.exp(-s * 16) * Math.abs(Math.sin(s * 45)); else if (s > 1.1) { this.y += (s - 1.1) * 260 * h * 3; if (this.y > 260) { this.t = null; this.stop = null; this.g.visible = false; } } }
      this.place();
    }
    for (const o of this.pieces) if (!o.rest) {
      if (o.hit) o.v.z += G.z * 2600 * h; else o.v.addScaledVector(G, 2600 * h); o.p.addScaledVector(o.v, h); const z = floor(o.p.x, o.p.y) + 7.2; if (o.p.z < z) { o.p.z = z; if (o.v.z < 0) { o.v.z *= -0.24; o.v.x *= 0.6; o.v.y *= 0.6; o.w.multiplyScalar(0.55); } o.hit = true; }
      const a = o.w.length() * h; if (a > 1e-5) o.g.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(o.w.clone().normalize(), a));
      if (o.hit) { const d = o.t0.clone().applyQuaternion(o.g.quaternion), flat = V(d.x, d.y, 0); if (flat.lengthSq() < 0.01) flat.set(0.3, -1, 0); const q = new THREE.Quaternion().setFromUnitVectors(d, flat.normalize()); o.g.quaternion.premultiply(new THREE.Quaternion().slerp(q, Math.min(1, h * 11))); o.w.multiplyScalar(Math.exp(-h * 7)); o.v.x *= Math.exp(-h * 5); o.v.y *= Math.exp(-h * 5); if (o.v.length() < 6 && Math.abs(d.z) < 0.03) o.rest = true; }
      o.g.position.copy(o.p).addScaledVector(o.t0.clone().applyQuaternion(o.g.quaternion), -o.half);
    }
    for (const d of this.drops) if (!d.rest) { d.v.addScaledVector(G, 2600 * h); d.m.position.addScaledVector(d.v, h); const z = floor(d.m.position.x, d.m.position.y) + 0.4; if (d.m.position.z < z) { d.m.position.z = z; d.m.scale.set(d.s * 1.9, d.s * 1.9, d.s * 0.25); d.rest = true; } }
    return now;
  }
  off(s) {
    const q = s.sever(s.middle().i), half = q.len / 2, p = q.group.position.clone().addScaledVector(q.t, half); this.pieces.push({ g: q.group, p, half, t0: q.t, v: V((Math.random() - 0.5) * 30, -50, -30), w: V(5 + Math.random() * 2, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4), rest: false, hit: false });
    if (q.flesh) { let n = 0; for (const d of this.drops) { if (!d.rest || n++ > 12) continue; d.rest = false; d.s = 0.4 + Math.random() * 0.8; d.m.scale.setScalar(d.s); d.m.visible = true; d.m.position.copy(q.group.position); d.v.set((Math.random() - 0.5) * 150, (Math.random() - 0.4) * 130, (Math.random() - 0.5) * 120); } }
  }
  // everything as before
  mend() { for (const s of this.skins || []) s.mend(); this.pieces = []; for (const d of this.drops) { d.m.visible = false; d.rest = true; } this.t = null; this.stop = null; this.g.visible = false; this.cut = false; }
}
