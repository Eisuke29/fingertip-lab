// The virtual finger: one shape, drawn in several ways (the ways earlier studies on virtual hands drew them). The skin was made by Sol and
// wrapped around by scripts/bake-finger.py. Rest coordinate s (mm): MP 0, PIP 42, DIP 67, fingertip centre 89, end 97.
import * as THREE from 'three';
import { surface } from './tex.js?v=20';

export const NODES = { tip: [0, 42, 67, 89], joint: [42, 67, 89] };
// id, name
export const LOOKS = [['real', '本物'], ['photo', '自分の写真'], ['glove', '手袋'], ['toon', 'アニメ'], ['plaster', '石こう'], ['robot', 'ロボット'], ['bone', '骨'], ['glass', '半透明'], ['shadow', '影だけ']];
// slime: how fast it swallows light (per mm) and what it gives back
export const GEL = { sigma: 'vec3(0.034, 0.0085, 0.044)', glow: 'vec3(0.10, 0.30, 0.04)' };
const MEAN = 0.72; // the linear value of finger-color.jpg that stands for the skin colour itself
const S0 = -20, END = 97, ROUND = 84.5, RINGS = 112, SEG = 48, TAU = Math.PI * 2;
//                s    half width, back, palm side (mm)
const PROFILE = [[-20, 10.4, 9.6, 10.0], [0, 9.6, 8.9, 9.6], [10, 8.9, 7.9, 9.3], [21, 8.4, 7.4, 9.0], [32, 8.4, 7.4, 8.4], [38, 8.8, 8.1, 7.6], [42, 9.05, 8.5, 7.3], [46, 8.7, 7.9, 7.6], [51, 8.05, 6.95, 8.5], [57, 7.75, 6.55, 8.4], [63, 7.95, 6.8, 7.5], [67, 8.15, 7.15, 7.0], [71, 7.9, 6.6, 7.6], [76, 7.7, 6.2, 8.2], [81, 7.6, 5.75, 8.5], [84.5, 7.45, 5.45, 8.3], [97, 7.0, 4.6, 7.2]]; // thicker at the joints, pads between them
function profile(s) { // smooth (Catmull-Rom) through the table
  let i = 1; while (i < PROFILE.length - 2 && PROFILE[i + 1][0] < s) i++;
  const a = PROFILE[i - 1], b = PROFILE[i], c = PROFILE[i + 1], d = PROFILE[Math.min(PROFILE.length - 1, i + 2)], t = Math.max(0, Math.min(1, (s - b[0]) / (c[0] - b[0])));
  return [1, 2, 3].map((k) => { const m0 = (c[k] - a[k]) / (c[0] - a[0]) * (c[0] - b[0]), m1 = (d[k] - b[k]) / Math.max(1e-6, d[0] - b[0]) * (c[0] - b[0]), t2 = t * t, t3 = t2 * t; return (2 * t3 - 3 * t2 + 1) * b[k] + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * c[k] + (t3 - t2) * m1; });
}
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const bell = (x, w) => Math.exp(-(x * x) / (w * w));
// distance to the border of the nail (a rounded plate; < 0: on it). The same numbers as in bake-finger.py
function nail(x, s) { const rx = 5.15, rs = 8.3, r = 3.6, dx = Math.abs(x) - (rx - r), ds = Math.abs(s - 88.2) - (rs - r); return Math.hypot(Math.max(dx, 0), Math.max(ds, 0)) + Math.min(Math.max(dx, ds), 0) - r; }
// point of the cross-section at angle a (0 = right, PI/2 = palm side, -PI/2 = back); plate: with a nail
function section(s, a, plate) {
  const [w, b, p] = profile(s), q = s > ROUND ? (s - ROUND) / (END - ROUND) : 0, r = Math.sqrt(Math.max(0, 1 - q ** 2.3)), c = Math.cos(a), si = Math.sin(a), e = 0.92, x = Math.sign(c) * Math.abs(c) ** e * w * r;
  let y = Math.sign(si) * Math.abs(si) ** e * (si > 0 ? p : b) * r;
  if (si < 0 && plate && s > 74) {
    const d = nail(x, s), side = smooth(76, 82, s), on = smooth(0.3, -0.5, d), flat = -(5.35 - 0.035 * Math.max(0, s - 84) ** 1.5 - 0.085 * x * x + 0.0); // the plate: flatter across than the finger, nearly straight along
    y = y * (1 - on) + Math.min(y * 0.6 + flat * 0.4, flat) * on; y -= 0.34 * side * bell(d - 0.85, 0.75) * smooth(94, 87, s); y += 0.2 * bell(d - 0.12, 0.28) * smooth(95, 90, s); // the folds of skin around it and the groove between
  }
  return [x, y];
}
// skin tones, light to dark (a choice of the person, nothing is measured)
const TONES = [[0xf6, 0xd9, 0xc6], [0xee, 0xc4, 0xa6], [0xdd, 0xa8, 0x82], [0xb9, 0x80, 0x5a], [0x8a, 0x58, 0x3c], [0x56, 0x36, 0x27]];
export function tone(x) { const p = Math.max(0, Math.min(1, x)) * (TONES.length - 1), i = Math.min(TONES.length - 2, p | 0), f = p - i; return new THREE.Color().setRGB(...[0, 1, 2].map((k) => (TONES[i][k] + (TONES[i + 1][k] - TONES[i][k]) * f) / 255), THREE.SRGBColorSpace); }

export class SkinFinger {
  constructor(scene, clip, ready, share = null) {
    this.scene = scene; this.width = 1; this.slice = null;
    this.clip = clip[0]; this.look = 'real'; this.cut = { taper: 0.7, over: 9, depth: 0, shade: 0.15, fade: 0, blob: 0.5 };
    const pic = (name, srgb) => { const t = new THREE.TextureLoader().load(new URL(`./${name}?v=20`, import.meta.url).href, ready); t.flipY = false; t.wrapS = THREE.RepeatWrapping; t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; };
    const [color, normalMap, roughnessMap] = this.pics = share?.pics || [pic('finger-color.jpg', true), pic('finger-normal.jpg'), pic('finger-rough.jpg')], NS = (k) => new THREE.Vector2(k, k), base = { clippingPlanes: clip, clipShadows: true, transparent: true };
    this.u = { uTop: { value: 0 }, uShade: { value: 0.15 }, uFade: { value: 0 }, uGel: { value: 1e4 }, uBlood: { value: 1e4 } };
    // near the cut: a little darker (the shadow of the knuckle), or dissolving. Skin also gives back some light from inside
    const near = (m, sss = 0) => { m.onBeforeCompile = (s) => { Object.assign(s.uniforms, this.u); s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying float vDeep;').replace('#include <begin_vertex>', '#include <begin_vertex>\n vDeep = -position.z;'); s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vDeep; uniform float uTop, uShade, uFade, uGel, uBlood;').replace('#include <opaque_fragment>', `{ float w = smoothstep(uBlood - 5.5, uBlood - 0.5, vDeep + 0.9 * sin(vViewPosition.x * 0.9 + 1.4 * sin(vViewPosition.y * 0.7)) + 0.5 * sin(vViewPosition.y * 2.3)); outgoingLight = mix(outgoingLight, vec3(0.16, 0.006, 0.008) + outgoingLight * vec3(0.28, 0.02, 0.02), w * 0.92); }\n { float d = max(0.0, vDeep - uGel) * 1.2; vec3 T = exp(-d * ${GEL.sigma}); outgoingLight = outgoingLight * T + ${GEL.glow} * (1.0 - T); }\n#include <opaque_fragment>`).replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n { float t = smoothstep(0.0, 8.0, vDeep - uTop); diffuseColor.rgb *= mix(vec3(1.0) - uShade * vec3(0.85, 1.0, 1.0), vec3(1.0), t); if (uFade > 0.05) diffuseColor.a *= smoothstep(0.0, uFade, vDeep - uTop); }\n totalEmissiveRadiance += diffuseColor.rgb * 0.2;
 ${sss ? `float rim = 1.0 - abs(dot(normalize(normal), normalize(vViewPosition))); totalEmissiveRadiance += diffuseColor.rgb * vec3(0.13, 0.07, 0.055) * ${sss.toFixed(2)} * (0.35 + rim * rim);` : ''}`); }; return m; };
    const std = (o, sss) => near(new THREE.MeshStandardMaterial({ ...base, ...o }), sss);
    const ramp = new THREE.DataTexture(new Uint8Array([150, 205, 255, 255]), 4, 1, THREE.RedFormat); ramp.minFilter = ramp.magFilter = THREE.NearestFilter; ramp.needsUpdate = true;
    const lea = surface('leather'), pla = surface('plaster');
    this.mats = {
      real: std({ map: color, normalMap, normalScale: NS(0.75), roughnessMap, roughness: 1, envMapIntensity: 0.9 }, 1),
      photo: std({ normalMap, normalScale: NS(0.35), roughnessMap, roughness: 1, envMapIntensity: 0.9 }, 0.8),
      glove: std({ map: tile(lea.map, 2, 4), normalMap: tile(lea.normalMap, 2, 4), normalScale: NS(0.8), roughness: 0.8, color: 0xffffff }),
      toon: near(new THREE.MeshToonMaterial({ ...base, gradientMap: ramp })),
      plaster: std({ map: tile(pla.map, 2, 4), normalMap, normalScale: NS(0.35), roughness: 0.95, color: 0xf1eee8 }),
      robot: std({ map: plates(), roughness: 0.34, metalness: 0.75, envMapIntensity: 1.6 }),
      glass: std({ map: color, normalMap, normalScale: NS(0.6), roughness: 0.4, opacity: 0.6, depthWrite: true }, 1),
      shadow: new THREE.MeshBasicMaterial({ ...base, colorWrite: false, depthWrite: false }),
    };
    this.geo = grid(RINGS, SEG); this.mesh = new THREE.Mesh(this.geo, this.mats.real);
    // the outline of the cartoon finger
    this.line = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({ color: 0x2a1a14, side: THREE.BackSide, clippingPlanes: clip })); this.line.material.onBeforeCompile = (s) => { s.vertexShader = s.vertexShader.replace('#include <begin_vertex>', 'vec3 transformed = position + normal * 0.5 * smoothstep(1.0, 5.0, -position.z);'); };
    // the cut, closed with skin; and a soft shadow on the glass that can hide it
    const CR = this.CR = 7, g = this.capGeo = new THREE.BufferGeometry(), cn = CR * (SEG + 1), idx = [], cu = new Float32Array(cn * 2), up = new Float32Array(cn * 3);
    for (let r = 0; r < CR; r++) for (let j = 0; j <= SEG; j++) { const k = r * (SEG + 1) + j, f = r / (CR - 1), a = j / SEG * TAU; cu.set([0.75 + 0.1 * f * Math.cos(a), 0.45 + 0.04 * f * Math.sin(a)], k * 2); up.set([0.9 * f * Math.cos(a), 0.9 * f * Math.sin(a), 0.75], k * 3); if (r < CR - 1 && j < SEG) idx.push(k, k + SEG + 1, k + 1, k + 1, k + SEG + 1, k + SEG + 2); }
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cn * 3), 3)); g.setAttribute('uv', new THREE.BufferAttribute(cu, 2)); g.setAttribute('normal', new THREE.BufferAttribute(up, 3)); g.setIndex(idx);
    this.capMat = new THREE.MeshStandardMaterial({ map: color, roughness: 0.6, transparent: true, side: THREE.DoubleSide }); this.cap = new THREE.Mesh(g, this.capMat);
    { const c = document.createElement('canvas'); c.width = c.height = 128; const q = c.getContext('2d'), rg = q.createRadialGradient(64, 64, 8, 64, 64, 64); rg.addColorStop(0, 'rgba(0,0,0,.95)'); rg.addColorStop(0.45, 'rgba(0,0,0,.7)'); rg.addColorStop(1, 'rgba(0,0,0,0)'); q.fillStyle = rg; q.fillRect(0, 0, 128, 128); this.blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false })); this.blob.renderOrder = 5; }
    // bones
    this.bones = [0, 1, 2].map(() => new THREE.Mesh(boneGeo(), std({ color: 0xe9dfc4, roughness: 0.62 })));
    this.mode = null; this.setColor(tone(0.3));
    for (const m of [this.mesh, this.line, this.cap, this.blob, ...this.bones]) { m.castShadow = m === this.mesh || this.bones.includes(m); m.receiveShadow = m === this.mesh; m.frustumCulled = false; m.visible = false; scene.add(m); }
  }
  setColor(k) {
    const key = k.getHex(); if (this.toneV === key) return; this.toneV = key; const c = new THREE.Color(k.r / MEAN, k.g / MEAN, k.b / MEAN); for (const n of ['real', 'glass']) this.mats[n].color.copy(c); this.skin = k.clone();
    this.mats.toon.color.copy(k).multiplyScalar(1.1); this.mats.photo.color.setScalar(this.photoGain || 1); this.capColor();
  }
  setPhoto(tex, mean) { this.mats.photo.map = tex; this.mats.photo.needsUpdate = true; this.photoMean = mean; this.hasPhoto = true; this.capColor(); }
  capColor() { const m = this.mats[this.look === 'photo' && !this.hasPhoto ? 'real' : this.look] || this.mats.real, s = (this.cut.taper > 0.9 ? 0.85 : 0.62) - this.cut.shade * 0.5; this.capMat.map = this.look === 'real' || this.look === 'glass' ? this.mats.real.map : null; this.capMat.metalness = this.look === 'robot' ? 0.5 : 0; this.capMat.color.copy(this.look === 'photo' && this.photoMean ? this.photoMean : this.look === 'robot' ? new THREE.Color(0x3c4148) : m.color || new THREE.Color(1, 1, 1)).multiplyScalar(s); this.capMat.needsUpdate = true; }
  // thicker toward the root (it shows around the real knuckle); the fingertip keeps its size
  setThick(k) { if (this.thick === k) return; this.thick = k; this.mode = null; }
  // the whole finger wider or narrower (which finger it is)
  // gel: depth of the surface of the slime (mm below the glass), or null
  setGel(d) { this.u.uGel.value = d ?? 1e4; }
  setWidth(k) { if (this.width === k) return; this.width = k; this.mode = null; }
  setLook(l) { if (this.look === l) return; this.look = l; this.mesh.material = this.mats[l === 'photo' && !this.hasPhoto ? 'real' : l] || this.mats.real; this.mode = null; this.capColor(); this.visible = this.vis; }
  setCut(c) { const o = this.cut; if (Object.keys(c).every((k) => o[k] === c[k])) return; Object.assign(o, c); this.clip.constant = -o.depth; this.u.uTop.value = o.depth; this.u.uShade.value = o.shade; this.u.uFade.value = o.fade; this.capColor(); }
  set visible(v) { this.vis = v; const b = this.look === 'bone', s = this.look === 'shadow'; this.mesh.visible = v && (!b || this.slice != null); this.line.visible = v && this.look === 'toon'; this.cap.visible = v && !b && !s && this.cut.fade < 0.1 && this.look !== 'glass'; this.blob.visible = v && this.cut.blob > 0.02; for (const m of this.bones) m.visible = v && b && this.slice == null; if (this.stump) this.stump.visible = v && this.slice != null; }
  get visible() { return this.vis; }
  // smear: [x, y] the root is made longer in the direction of the movement by this much to both sides, only near the glass: what the prediction misses stays under the knuckle
  // pts: the joints [root, (pip), dip, tip]; palm: palm-side direction at the root
  update(pts, joint, palm, alpha, smear = null) {
    const node = NODES[joint], s0 = node[0] - 6, plate = !['glove', 'robot', 'toon'].includes(this.look), key = joint + plate;
    if (this.mode !== key) { // which part of the skin
      this.mode = key; const uv = this.geo.attributes.uv.array; this.S = [];
      for (let i = 0; i < RINGS; i++) { const t = i / (RINGS - 1), s = t < 0.62 ? s0 + (76 - s0) * t / 0.62 : t < 0.8 ? 76 + (ROUND + 4 - 76) * (t - 0.62) / 0.18 : ROUND + 4 + (END - ROUND - 4) * Math.sin((t - 0.8) / 0.2 * Math.PI / 2); this.S.push(s); for (let j = 0; j <= SEG; j++) { uv[(i * (SEG + 1) + j) * 2] = j / SEG; uv[(i * (SEG + 1) + j) * 2 + 1] = (s - S0) / (END - S0); } }
      this.geo.attributes.uv.needsUpdate = true; this.sec = this.S.map((s) => { const k = this.width * (1 + ((this.thick || 1) - 1) * smooth(80, 58, s)); return Array.from({ length: SEG + 1 }, (_, j) => section(s, j / SEG * TAU, plate).map((v) => v * k)); });
    }
    // the bone line, rounded at the joints
    const P = pts.map((p) => new THREE.Vector3(...p)), n = P.length, D = [], L = []; for (let i = 0; i < n - 1; i++) { const d = P[i + 1].clone().sub(P[i]); L.push(d.length()); D.push(d.normalize()); }
    const scale = L.map((l, i) => l / (node[i + 1] - node[i])), w = 4.6;
    const at = (s) => {
      let i = 0; while (i < n - 2 && s > node[i + 1]) i++;
      for (let j = 1; j < n - 1; j++) if (Math.abs(s - node[j]) < w) { const t = (s - node[j] + w) / (2 * w), A = P[j].clone().addScaledVector(D[j - 1], -w * scale[j - 1]), B = P[j].clone().addScaledVector(D[j], w * scale[j]), u = 1 - t; return [A.clone().multiplyScalar(u * u).addScaledVector(P[j], 2 * u * t).addScaledVector(B, t * t), P[j].clone().sub(A).multiplyScalar(u).addScaledVector(B.sub(P[j]), t).normalize()]; }
      const past = i === n - 2 && s > node[n - 1]; return [P[i].clone().addScaledVector(D[i], past ? L[i] + s - node[n - 1] : (s - node[i]) * (s < node[0] ? 1 : scale[i])), D[i]];
    };
    let nrm = null, tp = null; const R = this.S.map((s) => {
      const [c, t] = at(s);
      if (!nrm) nrm = new THREE.Vector3(...palm).addScaledVector(t, -t.dot(new THREE.Vector3(...palm))).normalize(); else { const ax = tp.clone().cross(t), sn = ax.length(); if (sn > 1e-6) nrm.applyAxisAngle(ax.multiplyScalar(1 / sn), Math.atan2(sn, tp.dot(t))); nrm.addScaledVector(t, -t.dot(nrm)).normalize(); }
      tp = t.clone(); return { s, c, t: tp, n: nrm.clone(), r: t.clone().cross(nrm).normalize() };
    });
    const C = this.cut, bends = node.slice(1, -1).map((q, i) => [q, Math.min(1.3, Math.acos(Math.max(-1, Math.min(1, D[i].dot(D[i + 1])))))]); // how much each joint is bent: the knuckle stands out on the back, the skin is pressed together on the palm side
    // narrower toward the cut, so that the cut stays under the real knuckle
    const thin = (z) => { const t = Math.max(0, Math.min(1, (-z - C.depth - 0.7) / Math.max(1, C.over))); return 1 - C.taper * (1 - Math.sqrt(1 - (1 - t) ** 2)); };
    const pos = this.geo.attributes.position.array; let k = 0;
    for (let i = 0; i < RINGS; i++) { const q = R[i], lim = C.taper > 0.01 ? Math.max(0, (-q.c.z - C.depth - 0.3) / (10.5 * (this.thick || 1) * Math.sqrt(Math.max(0, 1 - q.t.z * q.t.z)) + 0.01)) : 1, f = C.taper > 0.01 ? Math.min(thin(q.c.z), 1 + (Math.min(1, lim) - 1) * C.taper) : 1, up = 1 + bends.reduce((v, [j, b]) => v + 0.16 * b * bell(q.s - j, 5), 0), pad = 1 + bends.reduce((v, [j, b]) => v + 0.09 * b * (bell(q.s - j + 8, 4) + bell(q.s - j - 8, 4)) - 0.1 * b * bell(q.s - j, 2.6), 0); for (let j = 0; j <= SEG; j++) { const [x0, y0] = this.sec[i][j], x = x0 * f * (y0 > 0 ? 1 + (pad - 1) * 0.5 : 1), y = y0 * f * (y0 > 0 ? pad : up); pos[k++] = q.c.x + q.r.x * x + q.n.x * y; pos[k++] = q.c.y + q.r.y * x + q.n.y * y; pos[k++] = q.c.z + q.r.z * x + q.n.z * y; } }
    const sm = smear ? Math.hypot(...smear) : 0; if (sm > 0.2) { const ux = smear[0] / sm, uy = smear[1] / sm; for (let i = 0; i < RINGS; i++) { const c = R[i].c; if (c.z < -20) break; for (let j = 0; j <= SEG; j++) { const m = (i * (SEG + 1) + j) * 3, w = smooth(-15, -1, pos[m + 2]), o = ((pos[m] - c.x) * ux + (pos[m + 1] - c.y) * uy) / 9 * sm * w; pos[m] += ux * o; pos[m + 1] += uy * o; } } }
    this.R = R; this.pos = pos; normals(this.geo, RINGS, SEG); if (this.slice != null) this.drawStump(); this.u.uBlood.value = this.slice != null && this.wet ? -R[this.slice].c.z : 1e4;
    // the cut, exactly along the skin
    const zc = -C.depth; { const a = this.capGeo.attributes.position.array, X = [], Y = []; let cx = 0, cy = 0; for (let j = 0; j <= SEG; j++) { X[j] = Y[j] = 0; for (let i = 0; i < RINGS - 1; i++) { const p = (i * (SEG + 1) + j) * 3, q = p + (SEG + 1) * 3, z0 = pos[p + 2], z1 = pos[q + 2]; if (z0 >= zc && z1 < zc) { const f = (z0 - zc) / (z0 - z1); X[j] = pos[p] + (pos[q] - pos[p]) * f; Y[j] = pos[p + 1] + (pos[q + 1] - pos[p + 1]) * f; break; } } if (j < SEG) { cx += X[j] / SEG; cy += Y[j] / SEG; } }
      for (let r = 0; r < this.CR; r++) for (let j = 0; j <= SEG; j++) { const m = (r * (SEG + 1) + j) * 3, f = r / (this.CR - 1); a[m] = cx + (X[j] - cx) * f; a[m + 1] = cy + (Y[j] - cy) * f; a[m + 2] = zc - 0.05; } this.capGeo.attributes.position.needsUpdate = true;
      const B = 30 + 14 * C.blob + sm * 2; this.blob.position.set(cx, cy, -0.02); this.blob.scale.set(B, B, 1); this.blob.material.opacity = C.blob * alpha; }
    if (this.look === 'bone') this.bones.forEach((m, i) => { const j = i - (3 - (n - 1)); m.visible = this.vis && j >= 0 && this.slice == null; if (j < 0) return; const l = L[j] + (j === n - 2 ? 5 : -1.5); m.position.copy(P[j]).addScaledVector(D[j], 0.7); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), D[j]); m.scale.set(j === n - 2 ? 0.85 : 1, l, j === n - 2 ? 0.85 : 1); });
    for (const n of Object.keys(this.mats)) if (n !== 'shadow') this.mats[n].opacity = alpha * (n === 'glass' ? 0.6 : 1); this.capMat.opacity = alpha;
  }
  // the finger as it is drawn, as a row of balls [[x, y, z], r] (only what is behind the glass): nothing may be drawn inside them
  balls() {
    const out = [], R = this.R, p = this.pos; if (!R) return out;
    for (let i = 0; i < RINGS; i = i === RINGS - 1 ? RINGS : Math.min(RINGS - 1, i + 2)) { const c = R[i].c; if (c.z > 2) continue; let m = 0; for (let j = 0; j < SEG; j += 3) { const k = (i * (SEG + 1) + j) * 3; m = Math.max(m, Math.hypot(p[k] - c.x, p[k + 1] - c.y, p[k + 2] - c.z)); } out.push([[c.x, c.y, c.z], m]); }
    return out;
  }
  // ---------- cut through ----------
  // the ring in the middle between the contact and the fingertip
  middle() { const R = this.R, L = [0]; for (let i = 1; i < RINGS; i++) L.push(L[i - 1] + (R[i].c.z < 0 ? R[i].c.distanceTo(R[i - 1].c) : 0)); const t = L[RINGS - 1] / 2; let i = 1; while (L[i] < t) i++; return { i, p: R[i].c.clone(), t: R[i].t.clone(), r: 9.5 * this.width * (this.thick || 1) }; }
  // the part beyond the ring becomes a piece of its own (returned), the finger ends there
  sever(i) {
    if (this.look === 'bone') this.mesh.material = this.mats.plaster; const M = this.mesh.material, plain = ['robot', 'plaster', 'bone', 'shadow'].includes(this.look), from = i * SEG * 6, g = this.geo.clone(), c = this.R[i].c;
    g.translate(-c.x, -c.y, -c.z); g.setDrawRange(from, (RINGS - 1) * SEG * 6 - from); const face = new THREE.MeshStandardMaterial(plain ? { color: this.look === 'robot' ? 0x2b2f36 : 0xcfc8ba, roughness: 0.8, side: THREE.DoubleSide } : { map: flesh(), roughness: 0.32, side: THREE.DoubleSide });
    const piece = new THREE.Group(), m = new THREE.Mesh(g, M.clone()); m.material.onBeforeCompile = (s) => { const u = this.u; this.u = { ...u, uGel: { value: 1e4 }, uBlood: { value: 1e4 }, uShade: { value: 0 }, uFade: { value: 0 } }; M.onBeforeCompile(s); this.u = u; }; m.material.customProgramCacheKey = () => 'piece' + this.look; m.material.opacity = this.look === 'glass' ? 0.6 : 1; m.castShadow = m.receiveShadow = true; m.frustumCulled = false; piece.add(m);
    const cap = () => { const q = new THREE.BufferGeometry(), N = SEG + 2, idx = [], uv = [0.5, 0.5]; for (let j = 0; j <= SEG; j++) { const a = j / SEG * TAU; uv.push(0.5 + 0.49 * Math.cos(a), 0.5 + 0.49 * Math.sin(a)); if (j < SEG) idx.push(0, j + 1, j + 2); } q.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3)); q.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(N * 3), 3)); q.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); q.setIndex(idx); const x = new THREE.Mesh(q, face); x.frustumCulled = false; x.castShadow = true; return x; };
    const end = cap(); this.fill(end, i, c, -0.15); piece.add(end); piece.position.copy(c); this.scene.add(piece); if (!this.stump) { this.stump = cap(); this.scene.add(this.stump); } else this.stump.material = face; this.slice = i; this.wet = !plain; this.geo.setDrawRange(0, from); this.drawStump(); this.visible = this.vis; this.piece = piece;
    return { group: piece, t: this.R[i].t.clone(), n: this.R[i].n.clone(), len: this.R[RINGS - 1].c.distanceTo(c), flesh: !plain };
  }
  fill(cap, i, o, out) { const a = cap.geometry.attributes.position.array, R = this.R[i], z = R.c; a[0] = z.x - o.x + R.t.x * out; a[1] = z.y - o.y + R.t.y * out; a[2] = z.z - o.z + R.t.z * out; for (let j = 0; j <= SEG; j++) { const k = (i * (SEG + 1) + j) * 3, m = (j + 1) * 3; a[m] = this.pos[k] - o.x; a[m + 1] = this.pos[k + 1] - o.y; a[m + 2] = this.pos[k + 2] - o.z; } cap.geometry.attributes.position.needsUpdate = true; cap.geometry.computeVertexNormals(); }
  drawStump() { this.fill(this.stump, this.slice, { x: 0, y: 0, z: 0 }, 0.3); }
  mend() { if (this.slice == null) return; this.slice = null; this.geo.setDrawRange(0, Infinity); if (this.piece) { this.scene.remove(this.piece); this.piece.traverse((m) => m.geometry?.dispose()); this.piece = null; } const l = this.look; this.look = ''; this.setLook(l); if (this.stump) this.stump.visible = false; }
}
let fleshMap = null;
// what is seen where a finger is cut through: skin, fat, muscle and tendons, bone with marrow
function flesh() {
  if (fleshMap) return fleshMap; const S = 256, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d'), disc = (x, y, r, col) => { g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }; let q = 7; const rnd = () => (q = (q * 16807) % 2147483647) / 2147483647;
  disc(128, 128, 128, '#c98e74'); disc(128, 128, 118, '#a83a34'); disc(128, 128, 114, '#d8a06a'); for (let i = 0; i < 260; i++) { const a = rnd() * 7, r = 62 + rnd() * 48; disc(128 + r * Math.cos(a), 128 + r * Math.sin(a), 3 + rnd() * 5, ['#e0ac74', '#cf8f5c', '#b84a3e', '#e6bd88'][i % 4]); }
  disc(128, 128, 74, '#8e1f22'); for (let i = 0; i < 220; i++) { const a = rnd() * 7, r = rnd() * 72; disc(128 + r * Math.cos(a), 128 + r * Math.sin(a), 2 + rnd() * 4, ['#7a171b', '#a52a2a', '#941f24', '#b23a36'][i % 4]); }
  for (const [x, y, r] of [[128, 190, 15], [128, 66, 10], [176, 150, 6], [80, 150, 6]]) { disc(x, y, r + 2, '#7a2320'); disc(x, y, r, '#e9dcc8'); disc(x - r * 0.2, y - r * 0.2, r * 0.6, '#f4ecdf'); }
  disc(128, 124, 40, '#6d1a1a'); disc(128, 124, 37, '#efe2c6'); disc(128, 124, 24, '#c98b78'); for (let i = 0; i < 70; i++) { const a = rnd() * 7, r = rnd() * 22; disc(128 + r * Math.cos(a), 124 + r * Math.sin(a), 1.5 + rnd() * 2.5, ['#a8473f', '#d9a18c', '#8e2f2c'][i % 3]); }
  for (let i = 0; i < 26; i++) { const a = rnd() * 7, r = rnd() * 110; g.fillStyle = 'rgba(140,10,14,.5)'; g.beginPath(); g.arc(128 + r * Math.cos(a), 128 + r * Math.sin(a), 4 + rnd() * 9, 0, 7); g.fill(); }
  fleshMap = new THREE.CanvasTexture(c); fleshMap.colorSpace = THREE.SRGBColorSpace; return fleshMap;
}
function tile(t, x, y) { const c = t.clone(); c.wrapS = c.wrapT = THREE.RepeatWrapping; c.repeat.set(x, y); c.needsUpdate = true; return c; }
// the plates of the robot finger: light metal, dark joints, a few lines
function plates() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 1024; const g = c.getContext('2d'), y = (s) => (s - S0) / (END - S0) * 1024, band = (a, b, col) => { g.fillStyle = col; g.fillRect(0, y(a), 256, y(b) - y(a)); };
  band(S0, END, '#c9ced6'); for (const s of [0, 42, 67]) { band(s - 4.2, s + 4.2, '#2b2f36'); band(s - 5, s - 4.2, '#8d949e'); band(s + 4.2, s + 5, '#8d949e'); band(s - 0.5, s + 0.5, '#59606a'); } band(88, END, '#3a3f47'); band(87.2, 88, '#ffb56b'); g.fillStyle = '#9aa1ab'; for (const x of [64, 192]) g.fillRect(x - 1, 0, 2, y(87)); g.fillStyle = '#59606a'; for (const s of [10, 32, 50, 59, 74, 83]) for (const x of [24, 104, 152, 232]) { g.beginPath(); g.arc(x, y(s), 3, 0, 7); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.flipY = false; t.wrapS = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t;
}
function boneGeo() { const p = []; for (let i = 0; i <= 40; i++) { const t = i / 40, e = Math.min(t, 1 - t); p.push(new THREE.Vector2((2.5 + 2.3 * bell(t, 0.15) + 1.7 * bell(1 - t, 0.14)) * Math.sqrt(Math.min(1, e / 0.04 + 0.0001)), t)); } return new THREE.LatheGeometry(p, 24); }
function grid(n, m) {
  const g = new THREE.BufferGeometry(), N = n * (m + 1); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3)); g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(N * 3), 3)); g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(N * 2), 2));
  const idx = []; for (let i = 0; i < n - 1; i++) for (let j = 0; j < m; j++) { const a = i * (m + 1) + j, b = a + m + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); } g.setIndex(idx); return g;
}
function normals(g, n, m) {
  const p = g.attributes.position.array, q = g.attributes.normal.array, W = m + 1;
  for (let i = 0; i < n; i++) for (let j = 0; j <= m; j++) {
    const k = (i * W + j) * 3, jl = j === 0 ? m - 1 : j - 1, jr = j === m ? 1 : j + 1, a = (i * W + jl) * 3, b = (i * W + jr) * 3, c = (Math.max(0, i - 1) * W + j) * 3, d = (Math.min(n - 1, i + 1) * W + j) * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], vx = p[d] - p[c], vy = p[d + 1] - p[c + 1], vz = p[d + 2] - p[c + 2]; let x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx, l = Math.hypot(x, y, z);
    if (l < 1e-9) { x = vx; y = vy; z = vz; l = Math.hypot(x, y, z) || 1; } q[k] = -x / l; q[k + 1] = -y / l; q[k + 2] = -z / l; // outward
  }
  g.attributes.position.needsUpdate = g.attributes.normal.needsUpdate = true;
}
