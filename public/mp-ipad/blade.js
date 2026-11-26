// A small kitchen knife that falls through the virtual finger in the middle between the contact and the fingertip; the fingertip flies off and it bleeds.
// Only when the person has switched it on.
import * as THREE from 'three';
import { copyOf } from './tex.js?v=19';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z), rnd = (a, b) => a + Math.random() * (b - a), DROPS = 620, SPLATS = 260, Z = V(0, 0, 1);
function knife() {
  const g = new THREE.Group(), n = 26, pos = [], idx = [], edge = (t) => (t > 0.62 ? 8.6 * ((t - 0.62) / 0.38) ** 2 : 0.5 * (1 - t / 0.62) * 0), spine = (t) => 15.5 - (t > 0.5 ? 6.4 * ((t - 0.5) / 0.5) ** 2 : 0); // t: heel 0 .. point 1
  for (let i = 0; i <= n; i++) { const t = i / n, x = 24 - 50 * t, e = edge(t), s = Math.max(e + 0.05, spine(t)), m = e + Math.min(4.5, (s - e) * 0.5), k = 1 - 0.6 * t; pos.push(x, e, 0, x, m, 0.55 * k, x, s, 0.95 * k, x, s, -0.95 * k, x, m, -0.55 * k); }
  for (let i = 0; i < n; i++) for (let j = 0; j < 5; j++) { const a = i * 5 + j, b = i * 5 + (j + 1) % 5; idx.push(a, a + 5, b, b, a + 5, b + 5); } idx.push(0, 1, 2, 0, 2, 3, 0, 3, 4);
  const b = new THREE.BufferGeometry(); b.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); b.setIndex(idx); const f = b.toNonIndexed(); f.computeVertexNormals();
  const steel = new THREE.MeshStandardMaterial({ color: 0x9aa2aa, metalness: 0.5, roughness: 0.42, envMapIntensity: 0.5, side: THREE.DoubleSide }), wood = copyOf('block'); wood.color = new THREE.Color(0x3a2116); const put = (q, m, x, y) => { const k = new THREE.Mesh(q, m); k.position.set(x, y, 0); k.castShadow = k.receiveShadow = true; g.add(k); return k; };
  put(f, steel, 0, 0); put(new THREE.BoxGeometry(4, 9.5, 5), steel, 26, 10.8); const h = put(new THREE.CapsuleGeometry(4.3, 24, 6, 16).rotateZ(Math.PI / 2), wood, 43, 10.6); h.scale.set(1, 1, 0.78); for (const x of [34, 43, 52]) { const r = put(new THREE.CylinderGeometry(1.1, 1.1, 7.2, 12).rotateX(Math.PI / 2), steel, x, 10.6); r.castShadow = false; }
  return g;
}
function fade() { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'), v = g.createLinearGradient(0, 64, 0, 0); v.addColorStop(0, '#fff'); v.addColorStop(1, '#000'); g.fillStyle = v; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); }
// an irregular blot with smaller ones around it
function blot() {
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d'); let q = 11; const r = () => (q = (q * 16807) % 2147483647) / 2147483647; g.fillStyle = '#fff'; g.beginPath(); for (let i = 0; i <= 40; i++) { const a = i / 40 * 6.283, d = 27 + 5 * Math.sin(a * 3 + 1) + 4 * Math.sin(a * 7) + r() * 4; g[i ? 'lineTo' : 'moveTo'](64 + d * Math.cos(a), 64 + d * Math.sin(a)); } g.fill();
  for (let i = 0; i < 16; i++) { const a = r() * 6.283, d = 34 + r() * 24; g.beginPath(); g.ellipse(64 + d * Math.cos(a), 64 + d * Math.sin(a), 1.5 + r() * 4.5, 1 + r() * 2, a, 0, 7); g.fill(); } const t = new THREE.CanvasTexture(c); return t;
}
export class Blade {
  constructor(scene) {
    this.scene = scene; this.t = null; this.pieces = []; this.wounds = []; this.g = new THREE.Group(); this.g.visible = false; this.k = knife(); this.g.add(this.k); scene.add(this.g);
    this.trail = new THREE.Mesh(new THREE.PlaneGeometry(50, 70), new THREE.MeshBasicMaterial({ color: 0xe8eef2, alphaMap: fade(), transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide })); this.trail.position.set(-1, 50, 0); this.g.add(this.trail);
    const red = new THREE.MeshPhysicalMaterial({ color: 0x8c0408, roughness: 0.4, clearcoat: 0.3, clearcoatRoughness: 0.3, envMapIntensity: 0.15 }), inst = (g, m, n) => { const k = new THREE.InstancedMesh(g, m, n); k.frustumCulled = false; k.visible = false; scene.add(k); return k; };
    this.dm = inst(new THREE.SphereGeometry(1, 8, 6), red, DROPS); this.dm.castShadow = true; this.sm = inst(new THREE.PlaneGeometry(2, 2), new THREE.MeshStandardMaterial({ color: 0x7d0306, emissive: 0x1c0001, map: blot(), alphaTest: 0.5, roughness: 0.6, envMapIntensity: 0.08, polygonOffset: true, polygonOffsetFactor: -3 }), SPLATS); this.sm.material.map.colorSpace = THREE.SRGBColorSpace;
    this.drops = Array.from({ length: DROPS }, () => ({ on: false, p: V(), v: V(), r: 1 })); this.splats = Array.from({ length: SPLATS }, () => null); this.nd = this.ns = 0; this.mat = new THREE.Matrix4(); this.q = new THREE.Quaternion();
  }
  get busy() { return this.t != null; }
  // skins: the fingers to cut; box: [half width, half height] of the picture
  start(skins, box) {
    this.skins = skins; this.box = box; const { p, t, r } = this.mid(), down = V(0, -1, 0).addScaledVector(t, t.y).normalize(), up = down.clone().negate(), x = up.clone().cross(t).normalize(); this.r = r; this.dir = down; this.p = p; this.x = x;
    this.g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, up, t)); this.k.rotation.z = 0.12; this.k.scale.setScalar(0.82); this.y = box[1] - p.y + 45; this.end = -(box[1] + p.y + 70); this.v = 420; this.t = 0; this.cut = false; this.g.visible = true; this.g.position.copy(p).addScaledVector(down, -this.y);
  }
  mid() { const q = this.skins.map((s) => s.middle()), sum = (k) => q.reduce((a, m) => a.add(m[k]), V()); return { p: sum('p').multiplyScalar(1 / q.length), t: sum('t').normalize(), r: q[0].r }; }
  // gravity: direction of "down" of the real world; floor(x, y): height of what lies below, wet: it is liquid. Returns true at the moment of the cut
  step(dt, gravity, floor, wet = false) {
    let now = false; const h = Math.min(0.033, dt), G = V(...gravity);
    if (this.t != null) { // it goes straight through, without stopping
      this.t += h; if (!this.cut) this.p.copy(this.mid().p); this.v += 3200 * h; this.y -= this.v * h; this.trail.material.opacity = Math.min(0.2, this.v / 7000);
      if (!this.cut && this.y < 2) { this.cut = now = true; for (const s of this.skins) this.off(s); } if (this.y < this.end) { this.t = null; this.g.visible = false; } else this.g.position.copy(this.p).addScaledVector(this.dir, -this.y);
    }
    for (const o of this.pieces) if (!o.rest) this.fly(o, h, G, floor);
    for (const w of this.wounds) this.bleed(w, h, floor, wet);
    this.blood(h, G, floor, wet); return now;
  }
  off(s) {
    const q = s.sever(s.middle().i), half = q.len / 2, side = Math.random() < 0.5 ? -1 : 1, p = q.group.position.clone().addScaledVector(q.t, half), o = { g: q.group, p, half, t0: q.t, v: V(side * rnd(80, 125), rnd(70, 130), rnd(190, 250)), w: V(rnd(-9, 9), side * rnd(9, 15), rnd(-9, 9)), rest: false, hit: 0 }; this.pieces.push(o);
    if (!q.flesh) return; this.wounds.push({ t: 0, skin: s, from: () => s.R[s.slice], power: 1, pool: null }, { t: 0, piece: o, power: 0.45, pool: null }); for (let i = 0; i < 170; i++) this.drop(q.group.position, V(rnd(-1, 1), rnd(-1, 1), rnd(-0.6, 1)).normalize().multiplyScalar(rnd(60, 420)), rnd(0.25, 1.15)); // the first splash
  }
  fly(o, h, G, floor) {
    o.v.addScaledVector(G, 1500 * h); if (o.hit) { o.v.x *= Math.exp(-h * 4); o.v.y *= Math.exp(-h * 4); if (o.hit > 1) o.v.addScaledVector(V(G.x, G.y, 0), -1500 * h); } o.p.addScaledVector(o.v, h);
    for (const [k, i] of [['x', 0], ['y', 1]]) { const L = this.box[i] - 16; if (Math.abs(o.p[k]) > L) { o.p[k] = Math.sign(o.p[k]) * L; o.v[k] *= -0.45; } } if (o.p.z > -9) { o.p.z = -9; o.v.z = -Math.abs(o.v.z) * 0.3; }
    const z = floor(o.p.x, o.p.y) + 7.2; if (o.p.z < z) { o.p.z = z; if (o.v.z < 0) { if (o.v.z < -60) { for (let i = 0; i < 14; i++) this.drop(o.p, V(rnd(-1, 1), rnd(-1, 1), rnd(0.2, 0.9)).multiplyScalar(rnd(40, 130)), rnd(0.25, 0.7)); o.v.z *= -0.36; } else { o.v.z = 0; o.hit = 2; } o.v.x *= 0.66; o.v.y *= 0.66; o.w.multiplyScalar(0.6); } o.hit ||= 1; }
    const a = o.w.length() * h; if (a > 1e-5) o.g.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(o.w.clone().normalize(), a)); const d = o.t0.clone().applyQuaternion(o.g.quaternion);
    if (o.hit) { const flat = V(d.x, d.y, 0); if (flat.lengthSq() < 0.01) flat.set(0.3, -1, 0); o.g.quaternion.premultiply(new THREE.Quaternion().slerp(new THREE.Quaternion().setFromUnitVectors(d, flat.normalize()), Math.min(1, h * 10))); o.w.multiplyScalar(Math.exp(-h * 5)); if (o.hit > 1 && Math.hypot(o.v.x, o.v.y) < 4 && Math.abs(d.z) < 0.03) o.rest = true; }
    o.g.position.copy(o.p).addScaledVector(o.t0.clone().applyQuaternion(o.g.quaternion), -o.half);
  }
  // a jet that beats like a pulse and gets weaker, and a pool that grows
  bleed(w, h, floor, wet) {
    w.t += h; const a = w.piece ? null : w.from(); if (!w.piece && (w.skin.slice == null || !w.skin.vis)) return; const p = w.piece ? w.piece.g.position : a.c, t = w.piece ? w.piece.t0.clone().applyQuaternion(w.piece.g.quaternion).negate() : a.t, beat = Math.max(0, Math.sin(w.t * 9.5)) ** 2, rate = w.power * (w.t < 0.25 ? 1100 : 620 * beat * Math.exp(-w.t / 2) + (w.t < 7 ? 25 : 0)); w.sum = (w.sum || 0) + rate * h;
    const u = V(0, 0, 1).cross(t); if (u.lengthSq() < 0.01) u.set(1, 0, 0); u.normalize(); const v = t.clone().cross(u); // around the axis of the jet
    for (; w.sum > 1; w.sum--) { const ang = rnd(0, 6.283), c = rnd(0, 0.75) ** 1.4, sp = (rnd(70, 250) * (0.35 + 0.65 * Math.exp(-w.t / 1.2)) + 20) * (0.5 + 0.5 * beat + (w.t < 0.2 ? 0.6 : 0)), d = t.clone().multiplyScalar(1 - c * 0.5).addScaledVector(u, Math.cos(ang) * c * 1.5).addScaledVector(v, Math.sin(ang) * c * 1.5); if (!w.piece) d.z += 0.35; this.drop(V().copy(p).addScaledVector(u, rnd(-3.5, 3.5)).addScaledVector(v, rnd(-3.5, 3.5)), d.multiplyScalar(sp), rnd(0.22, 0.95) * (Math.random() < 0.12 ? 1.6 : 1)); }
    if (wet || (w.piece && !w.piece.rest) || w.t > 5) return; const z = floor(p.x, p.y); if (!w.pool) w.pool = this.splat(p.x, p.y, z + 0.35, 1, 1); if (w.pool) { w.pool.s = Math.min(w.piece ? 15 : 12, w.pool.s + h * 5); w.pool.dirty = true; }
  }
  drop(p, v, r) { const d = this.drops[this.nd++ % DROPS]; d.on = true; d.p.copy(p); d.v.copy(v); d.r = r; this.dm.visible = true; }
  splat(x, y, z, s, stretch, a = rnd(0, 6.283)) { const q = this.splats[this.ns % SPLATS] = { x, y, z, s, stretch, a, dirty: true }; this.ns++; this.sm.visible = true; return q; }
  blood(h, G, floor, wet) {
    let any = false; const M = this.mat, hide = M.clone().makeScale(0, 0, 0); if (!this.dm.visible && !this.sm.visible) return;
    this.drops.forEach((d, i) => {
      if (!d.on) { this.dm.setMatrixAt(i, hide); return; } any = true; d.v.addScaledVector(G, 1500 * h); d.p.addScaledVector(d.v, h); const z = floor(d.p.x, d.p.y), sp = d.v.length();
      if (d.p.z < z + 0.3 || d.p.z > -0.6 || Math.abs(d.p.x) > this.box[0] - 2 || Math.abs(d.p.y) > this.box[1] - 2) { d.on = false; this.dm.setMatrixAt(i, hide); const glass = d.p.z > -0.6; if (!(wet && !glass) && (glass || d.p.z < z + 0.3)) this.splat(d.p.x, d.p.y, glass ? -0.5 : z + 0.3 + (i % 9) * 0.02, d.r * rnd(1.3, 3.1), 1 + Math.min(1.2, Math.hypot(d.v.x, d.v.y) / 260), Math.atan2(d.v.y, d.v.x)); return; }
      const l = 1 + Math.min(2.6, sp / 130); this.q.setFromUnitVectors(Z, d.v.clone().normalize()); M.compose(d.p, this.q, V(d.r / Math.sqrt(l), d.r / Math.sqrt(l), d.r * l)); this.dm.setMatrixAt(i, M);
    });
    this.dm.visible = any; this.dm.instanceMatrix.needsUpdate = true; let ch = false; this.splats.forEach((s, i) => { if (s && !s.dirty) return; ch = true; if (!s) { this.sm.setMatrixAt(i, hide); return; } s.dirty = false; M.compose(V(s.x, s.y, s.z), this.q.setFromAxisAngle(Z, s.a), V(s.s * s.stretch, s.s, 1)); this.sm.setMatrixAt(i, M); }); if (ch) this.sm.instanceMatrix.needsUpdate = true;
  }
  // everything as before
  mend() { for (const s of this.skins || []) s.mend(); this.pieces = []; this.wounds = []; for (const d of this.drops) d.on = false; this.splats.fill(null); this.dm.visible = this.sm.visible = false; this.t = null; this.g.visible = false; this.cut = false; }
}
