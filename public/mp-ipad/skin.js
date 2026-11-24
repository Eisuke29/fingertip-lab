// A finger that looks like a real one: shape, skin (colour, creases, knuckle wrinkles, fingerprint), nail.
// No photographs, no downloaded model: the shape is made here, the skin pictures by scripts/bake-skin.mjs. Rest coordinate s (mm): MP 0, PIP 42, DIP 67, fingertip centre 89, end 97.
import * as THREE from 'three';

export const NODES = { mp: [0, 42, 67, 89], pip: [42, 67, 89], point: [42, 67, 89] };
const MAPS = [0.86, 0.82, 0.81]; // mean of skin.jpg (linear): the drawn skin has the colour that is asked for
const END = 97, ROUND = 85.5, RINGS = 68, SEG = 32, TAU = Math.PI * 2;
//                s    half width, back, palm side (mm)
const PROFILE = [[-20, 10.6, 10.0, 10.2], [0, 9.8, 9.3, 9.8], [10, 9.1, 8.2, 9.5], [21, 8.6, 7.5, 9.1], [32, 8.6, 7.5, 8.4], [42, 9.1, 8.3, 7.7], [49, 8.4, 7.2, 8.4], [55, 8.0, 6.7, 8.6], [62, 7.9, 6.6, 8.0], [67, 8.1, 6.9, 7.2], [73, 7.8, 6.3, 7.9], [80, 7.7, 5.9, 8.3], [85.5, 7.3, 5.7, 8.0], [97, 7.0, 5.6, 7.7]];
function profile(s) { // smooth (Catmull-Rom) through the table
  let i = 1; while (i < PROFILE.length - 2 && PROFILE[i + 1][0] < s) i++;
  const a = PROFILE[i - 1], b = PROFILE[i], c = PROFILE[i + 1], d = PROFILE[Math.min(PROFILE.length - 1, i + 2)], t = Math.max(0, Math.min(1, (s - b[0]) / (c[0] - b[0])));
  return [1, 2, 3].map((k) => { const m0 = (c[k] - a[k]) / (c[0] - a[0]) * (c[0] - b[0]), m1 = (d[k] - b[k]) / Math.max(1e-6, d[0] - b[0]) * (c[0] - b[0]), t2 = t * t, t3 = t2 * t; return (2 * t3 - 3 * t2 + 1) * b[k] + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * c[k] + (t3 - t2) * m1; });
}
// point of the cross-section at angle a (0 = right, PI/2 = palm side, -PI/2 = back)
function section(s, a) {
  const [w, b, p] = profile(s), r = s > ROUND ? Math.sqrt(Math.max(0, 1 - ((s - ROUND) / (END - ROUND)) ** 2)) : 1, c = Math.cos(a), q = Math.sin(a), e = 0.9;
  const fold = q < 0 ? 0.55 * bell(s - 78.6, 1.5) * bell(c, 0.75) + 0.4 * smooth(78.5, 81, s) * smooth(94, 90, s) * (bell(c - 0.8, 0.16) + bell(c + 0.8, 0.16)) : 0; // skin around the nail
  return [Math.sign(c) * Math.abs(c) ** e * w * r, Math.sign(q) * Math.abs(q) ** e * ((q > 0 ? p : b) + fold) * r];
}
// ---------- skin (pictures made by scripts/bake-skin.mjs) ----------
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const bell = (x, w) => Math.exp(-(x * x) / (w * w));
function pic(name, srgb, ready) {
  const t = new THREE.TextureLoader().load(new URL(`./${name}?v=4`, import.meta.url).href, ready); t.flipY = false; t.wrapS = THREE.RepeatWrapping; t.anisotropy = 4; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t;
}
// skin tones, light to dark (a choice of the person, nothing is measured)
const TONES = [[0xf6, 0xd9, 0xc6], [0xee, 0xc4, 0xa6], [0xdd, 0xa8, 0x82], [0xb9, 0x80, 0x5a], [0x8a, 0x58, 0x3c], [0x56, 0x36, 0x27]];
export function tone(x) { const p = Math.max(0, Math.min(1, x)) * (TONES.length - 1), i = Math.min(TONES.length - 2, p | 0), f = p - i; return new THREE.Color().setRGB(...[0, 1, 2].map((k) => (TONES[i][k] + (TONES[i + 1][k] - TONES[i][k]) * f) / 255), THREE.SRGBColorSpace); }

export class SkinFinger {
  constructor(scene, clip, ready) {
    const map = pic('skin.jpg', true, ready), normalMap = pic('skin-normal.jpg', false, ready);
    const soft = (m) => { m.onBeforeCompile = (s) => { s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying float vDeep;').replace('#include <begin_vertex>', '#include <begin_vertex>\n vDeep = -position.z;'); s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vDeep;').replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n diffuseColor.rgb *= mix(vec3(0.5, 0.42, 0.38), vec3(1.0), smoothstep(0.0, 9.0, vDeep));').replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n float rim = 1.0 - abs(dot(normalize(normal), normalize(vViewPosition)));\n totalEmissiveRadiance += diffuseColor.rgb * vec3(0.22, 0.08, 0.05) * (0.25 + rim * rim);'); }; return m; }; // light that comes back out of the skin
    this.mat = soft(new THREE.MeshStandardMaterial({ map, normalMap, normalScale: new THREE.Vector2(0.9, 0.9), roughness: 0.5, clippingPlanes: clip, transparent: true, side: THREE.DoubleSide }));
    this.geo = grid(RINGS, SEG, true); this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.nailMat = new THREE.MeshStandardMaterial({ map: pic('nail.jpg', true, ready), roughness: 0.14, envMapIntensity: 2.2, clippingPlanes: clip, transparent: true, side: THREE.DoubleSide });
    this.nailGeo = grid(20, 16, false); this.nail = new THREE.Mesh(this.nailGeo, this.nailMat);
    // the cut at the glass is in the shadow of the knuckle that stands on it: dark, not a bright disc (a bright disc looks like a ball between the two fingers)
    const CR = this.CR = 7, g = this.capGeo = new THREE.BufferGeometry(), cn = CR * (SEG + 1), idx = [], cc = new Float32Array(cn * 3), cu = new Float32Array(cn * 2), up = new Float32Array(cn * 3);
    for (let r = 0; r < CR; r++) for (let j = 0; j <= SEG; j++) { const k = r * (SEG + 1) + j, f = r / (CR - 1), w = smooth(0.45, 1, f), a = j / SEG * TAU; cc.set([0.5 - 0.06 * w, 0.4 - 0.08 * w, 0.36 - 0.08 * w], k * 3); cu.set([0.25 + 0.12 * f * Math.cos(a), 0.36 + 0.06 * f * Math.sin(a)], k * 2); up.set([0.55 * w * Math.cos(a), 0.55 * w * Math.sin(a), 1], k * 3); if (r < CR - 1 && j < SEG) idx.push(k, k + SEG + 1, k + 1, k + 1, k + SEG + 1, k + SEG + 2); }
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cn * 3), 3)); g.setAttribute('color', new THREE.BufferAttribute(cc, 3)); g.setAttribute('uv', new THREE.BufferAttribute(cu, 2)); g.setAttribute('normal', new THREE.BufferAttribute(up, 3)); g.setIndex(idx);
    this.capMat = new THREE.MeshStandardMaterial({ map, normalMap, normalScale: new THREE.Vector2(0.7, 0.7), vertexColors: true, roughness: 0.6, transparent: true, side: THREE.DoubleSide }); this.cap = new THREE.Mesh(this.capGeo, this.capMat);
    this.mode = null; this.setTone(0.3);
    for (const m of [this.mesh, this.nail, this.cap]) { m.castShadow = m !== this.cap; m.receiveShadow = m !== this.cap; m.frustumCulled = false; m.visible = false; scene.add(m); }
  }
  setTone(x) { this.setColor(tone(x)); }
  setColor(k) { const key = k.getHex(); if (this.toneV === key) return; this.toneV = key; const c = new THREE.Color(k.r / MAPS[0], k.g / MAPS[1], k.b / MAPS[2]); this.mat.color.copy(c); this.capMat.color.copy(c); this.nailMat.color.copy(c).lerp(new THREE.Color(1, 1, 1), 0.5); }
  set visible(v) { this.mesh.visible = this.nail.visible = this.cap.visible = v; }
  // pts: the joints [root, (pip), dip, tip]; palm: palm-side direction at the root
  // smear: [x, y] the root is made longer in the direction of the movement by this much to both sides, only near the glass: what the prediction misses stays under the knuckle
  update(pts, joint, palm, alpha, smear = null) {
    const node = NODES[joint], s0 = node[0] - 6;
    if (this.mode !== joint) { // which part of the skin
      this.mode = joint; const uv = this.geo.attributes.uv.array, nv = this.nailGeo.attributes.uv.array;
      this.S = []; for (let i = 0; i < RINGS; i++) { const t = i / (RINGS - 1), s = t < 0.8 ? s0 + (ROUND - s0) * t / 0.8 : ROUND + (END - ROUND) * Math.sin((t - 0.8) / 0.2 * Math.PI / 2); this.S.push(s); for (let j = 0; j <= SEG; j++) { uv[(i * (SEG + 1) + j) * 2] = j / SEG; uv[(i * (SEG + 1) + j) * 2 + 1] = (s + 20) / (END + 20); } }
      for (let i = 0; i < 20; i++) for (let j = 0; j <= 16; j++) { nv[(i * 17 + j) * 2] = j / 16; nv[(i * 17 + j) * 2 + 1] = i / 19; }
      this.geo.attributes.uv.needsUpdate = this.nailGeo.attributes.uv.needsUpdate = true; this.sec = this.S.map((s) => Array.from({ length: SEG + 1 }, (_, j) => section(s, j / SEG * TAU)));
    }
    // the bone line, rounded at the joints
    const P = pts.map((p) => new THREE.Vector3(...p)), n = P.length, D = [], L = []; for (let i = 0; i < n - 1; i++) { const d = P[i + 1].clone().sub(P[i]); L.push(d.length()); D.push(d.normalize()); }
    const scale = L.map((l, i) => l / (node[i + 1] - node[i])), w = 8.5;
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
    const pos = this.geo.attributes.position.array; let k = 0;
    for (let i = 0; i < RINGS; i++) { const q = R[i]; for (let j = 0; j <= SEG; j++) { const [x, y] = this.sec[i][j]; pos[k++] = q.c.x + q.r.x * x + q.n.x * y; pos[k++] = q.c.y + q.r.y * x + q.n.y * y; pos[k++] = q.c.z + q.r.z * x + q.n.z * y; } }
    const sm = smear ? Math.hypot(...smear) : 0; if (sm > 0.2) { const ux = smear[0] / sm, uy = smear[1] / sm; for (let i = 0; i < RINGS; i++) { const c = R[i].c; if (c.z < -20) break; for (let j = 0; j <= SEG; j++) { const m = (i * (SEG + 1) + j) * 3, w = smooth(-15, -1, pos[m + 2]), o = ((pos[m] - c.x) * ux + (pos[m + 1] - c.y) * uy) / 9 * sm * w; pos[m] += ux * o; pos[m + 1] += uy * o; } } }
    normals(this.geo, RINGS, SEG, true);
    // the nail: a stiff curved plate on the back of the last segment
    { const a = this.nailGeo.attributes.position.array; let m = 0; const near = (s) => { const [c, t] = at(s); let b = R[0]; for (const q of R) if (Math.abs(q.s - s) < Math.abs(b.s - s)) b = q; return { c, n: b.n, r: b.r, t }; };
      for (let i = 0; i < 20; i++) { const v = i / 19, q0 = near(79 + 16 * v); for (let j = 0; j <= 16; j++) { const u = j / 16 * 2 - 1, s0 = 79.0 + 2.4 * u * u * u * u, s1 = 94.4 - 2.4 * u * u, s = s0 + (s1 - s0) * v, q = Math.abs(s - 79 - 16 * v) > 0.4 ? near(s) : q0, x = u * (5.5 + 0.4 * Math.sin(v * 3)), y = -(6.35 - 0.75 * v * v - 0.35 * bell(v, 0.14) - 2.55 * u * u); a[m++] = q.c.x + q.r.x * x + q.n.x * y; a[m++] = q.c.y + q.r.y * x + q.n.y * y; a[m++] = q.c.z + q.r.z * x + q.n.z * y; } }
      normals(this.nailGeo, 20, 16, false, -1); }
    // the cut at the glass, exactly along the skin
    { const a = this.capGeo.attributes.position.array, X = [], Y = []; let cx = 0, cy = 0; for (let j = 0; j <= SEG; j++) { X[j] = Y[j] = 0; for (let i = 0; i < RINGS - 1; i++) { const p = (i * (SEG + 1) + j) * 3, q = p + (SEG + 1) * 3, z0 = pos[p + 2], z1 = pos[q + 2]; if (z0 >= 0 && z1 < 0) { const f = z0 / (z0 - z1); X[j] = pos[p] + (pos[q] - pos[p]) * f; Y[j] = pos[p + 1] + (pos[q + 1] - pos[p + 1]) * f; break; } } if (j < SEG) { cx += X[j] / SEG; cy += Y[j] / SEG; } }
      for (let r = 0; r < this.CR; r++) for (let j = 0; j <= SEG; j++) { const m = (r * (SEG + 1) + j) * 3, f = r / (this.CR - 1); a[m] = cx + (X[j] - cx) * f; a[m + 1] = cy + (Y[j] - cy) * f; a[m + 2] = -0.05; } this.capGeo.attributes.position.needsUpdate = true; }
    for (const m of [this.mat, this.nailMat, this.capMat]) m.opacity = alpha;
  }
}
function grid(n, m, closed) {
  const g = new THREE.BufferGeometry(), N = n * (m + 1); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3)); g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(N * 3), 3)); g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(N * 2), 2));
  const idx = []; for (let i = 0; i < n - 1; i++) for (let j = 0; j < m; j++) { const a = i * (m + 1) + j, b = a + m + 1; if (closed) idx.push(a, a + 1, b, b, a + 1, b + 1); else idx.push(a, b, a + 1, b, b + 1, a + 1); } g.setIndex(idx); return g;
}
function normals(g, n, m, closed, sg = 1) {
  const p = g.attributes.position.array, q = g.attributes.normal.array, W = m + 1;
  for (let i = 0; i < n; i++) for (let j = 0; j <= m; j++) {
    const k = (i * W + j) * 3, jl = closed ? (j === 0 ? m - 1 : j - 1) : Math.max(0, j - 1), jr = closed ? (j === m ? 1 : j + 1) : Math.min(m, j + 1), a = (i * W + jl) * 3, b = (i * W + jr) * 3, c = (Math.max(0, i - 1) * W + j) * 3, d = (Math.min(n - 1, i + 1) * W + j) * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], vx = p[d] - p[c], vy = p[d + 1] - p[c + 1], vz = p[d + 2] - p[c + 2]; let x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx, l = Math.hypot(x, y, z);
    if (l < 1e-9) { x = vx; y = vy; z = vz; l = Math.hypot(x, y, z) || 1; } q[k] = sg * x / l; q[k + 1] = sg * y / l; q[k + 2] = sg * z / l;
  }
  g.attributes.position.needsUpdate = g.attributes.normal.needsUpdate = true;
}
