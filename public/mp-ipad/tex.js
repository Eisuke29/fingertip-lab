// Surfaces made here (no downloaded pictures): ceramic, sandpaper, rock, wool, tape, honey, rubber, fur, water, slime; wood blocks, foam, iron; planks and bricks for the room. Colour + normal map, tileable.
import * as THREE from 'three';

function noise(seed, n) { // tileable value noise with period n
  let x = seed; const g = new Float32Array(n * n); for (let i = 0; i < n * n; i++) g[i] = (x = (x * 16807) % 2147483647) / 2147483647;
  return (u, v) => { const i = Math.floor(u), j = Math.floor(v), a = u - i, b = v - j, p = a * a * (3 - 2 * a), q = b * b * (3 - 2 * b), w = (k) => ((k % n) + n) % n, i0 = w(i), i1 = w(i + 1), j0 = w(j) * n, j1 = w(j + 1) * n; return (g[j0 + i0] * (1 - p) + g[j0 + i1] * p) * (1 - q) + (g[j1 + i0] * (1 - p) + g[j1 + i1] * p) * q; };
}
const clamp01 = (x) => Math.max(0, Math.min(1, x)), mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t), smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const N4 = noise(3, 4), N8 = noise(5, 8), N16 = noise(7, 16), N32 = noise(11, 32), N64 = noise(13, 64), N128 = noise(17, 128);
const fbm = (u, v) => N8(u * 8, v * 8) * 0.5 + N16(u * 16, v * 16) * 0.25 + N32(u * 32, v * 32) * 0.15 + N64(u * 64, v * 64) * 0.1;
// each: (u, v in 0..1) -> [height (any unit), [r, g, b] 0..255]
const DRAW = {
  smooth: (u, v) => { const l = N4(u * 4, v * 4) * 0.6 + N8(u * 8, v * 8) * 0.4, sp = smooth(0.86, 0.95, N64(u * 64, v * 64)); return [l * 1.2 - sp * 0.15, mix(mix([84, 150, 182], [132, 186, 204], l), [58, 104, 138], sp * 0.75)]; },
  stone: (u, v) => { const f = fbm(u, v), g = N128(u * 128, v * 128), h = N64(u * 64 + 9, v * 64 + 4), pit = smooth(0.78, 0.9, N32(u * 32 + 5, v * 32 + 2)); return [f * 1.6 + g * 0.9 + h * 0.8 - pit * 1.4, mix(mix([186, 160, 120], [222, 202, 164], f), [124, 98, 70], clamp01(pit * 0.8 + smooth(0.75, 0.95, g) * 0.4 + (0.5 - h) * 0.25))]; },
  knit: (u, v) => { // stitches: each a V of two fat strands
    const C = 8, R = 9, x = u * C - Math.floor(u * C), s = Math.abs(x - 0.5) * 2, y = v * R + (1 - s) * 0.62, f = y - Math.floor(y), a = 1 - Math.abs(f - 0.5) * 2, strand = Math.sqrt(clamp01(a)) * Math.sqrt(clamp01(1 - Math.abs(s - 0.5) * 1.9)), fib = N128(u * 128, v * 128 + s * 20) * 0.5 + N64(u * 64, v * 64) * 0.5; return [strand * 5 + fib * 0.7, mix([20, 66, 52], mix([62, 150, 112], [112, 190, 146], fib), smooth(0.05, 0.85, strand))]; },
  honey: (u, v) => { const l = N4(u * 4 + 1, v * 4), m = N16(u * 16, v * 16); let h = l * 1.5 + m * 0.5 + N32(u * 32, v * 32) * 0.12, b = 0; for (const [x, y, r] of [[0.2, 0.3, 0.05], [0.65, 0.2, 0.035], [0.8, 0.7, 0.06], [0.35, 0.75, 0.03], [0.5, 0.5, 0.045], [0.1, 0.85, 0.035], [0.9, 0.4, 0.028]]) { const d = Math.hypot(u - x, v - y) / r; if (d < 1) { h += Math.sqrt(1 - d * d) * 1.6; b = Math.max(b, smooth(1, 0.7, d) * smooth(0.5, 0.85, d)); } } return [h, mix(mix([176, 92, 12], [222, 146, 34], clamp01(l * 0.8 + m * 0.2)), [255, 228, 150], b * 0.7)]; },
  sand: (u, v) => { const g = N128(u * 128, v * 128), h = N128(u * 128 + 31.5, v * 128 + 17.5), l = N8(u * 8, v * 8); return [g * 1.6 + h * 0.8, mix(mix([150, 112, 78], [186, 148, 108], l * 0.4 + g * 0.6), [92, 62, 40], smooth(0.8, 0.95, h))]; },
  tape: (u, v) => { const f = N64(u * 64, v * 6), b = N32(u * 32 + 3, v * 4), w = N4(u * 4, v * 4), e = Math.abs(v * 2 - Math.floor(v * 2) - 0.5) * 2, edge = smooth(0.985, 1, e); return [f * 0.5 + w * 1.2 - edge * 2.5, mix(mix([176, 138, 88], [204, 168, 114], f * 0.6 + b * 0.4), [112, 82, 48], edge * 0.8)]; },
  rubber: (u, v) => { const f = N64(u * 64, v * 64), x = u * 4 % 1 - 0.5, y = v * 4 % 1 - 0.5, d = Math.hypot(x, y), b = smooth(0.2, 0.15, d); return [f * 0.12 + b * 1.6, mix(mix([214, 98, 112], [224, 112, 124], f), [250, 196, 196], b * 0.75)]; },
  jelly: (u, v) => { const l = N4(u * 4 + 2, v * 4); return [l * 1.2, mix([122, 196, 92], [166, 224, 120], l)]; },
  fur: (u, v) => { const n = N64(u * 64, v * 64) * 0.5 + N128(u * 128, v * 128) * 0.5, l = N8(u * 8, v * 8); return [n, mix([150, 116, 84], [206, 176, 140], n * 0.5 + l * 0.5)]; },
  water: (u, v) => { const e = Math.min(u * 4 % 1, 1 - u * 4 % 1, v * 4 % 1, 1 - v * 4 % 1), t = N4(Math.floor(u * 4), Math.floor(v * 4)), w = smooth(0.06, 0.03, e); return [0, mix(mix([22, 92, 128], [40, 122, 152], t), [112, 176, 190], w)]; },
  slime: (u, v) => { const l = N4(u * 4, v * 4), m = N16(u * 16, v * 16); return [l * 1.6 + m * 0.5, mix([64, 112, 34], [98, 146, 52], l * 0.8 + m * 0.2)]; },
  block: (u, v) => { const g = N8(u * 2, v * 8 * 3) * 0.5 + N32(u * 4, v * 32) * 0.5, r = 0.5 + 0.5 * Math.sin((g * 2.4 + N4(u * 2, v * 4)) * 10); return [g * 0.5, mix([206, 190, 164], [240, 228, 206], r * 0.5 + g * 0.5)]; },
  foam: (u, v) => { const g = N32(u * 32, v * 32), h = N64(u * 64, v * 64); return [g * 1.4 + h * 0.4, mix([222, 220, 212], [248, 247, 242], g)]; },
  iron: (u, v) => { const g = N128(u * 128, v * 16) * 0.6 + N64(u * 64, v * 4) * 0.4, l = N8(u * 8, v * 8); return [g * 0.4, mix([62, 66, 72], [98, 102, 108], g * 0.6 + l * 0.4)]; },
  soil: (u, v) => { const f = fbm(u, v), g = N64(u * 64, v * 64); return [f * 2 + g * 1.4, mix([44, 34, 22], [86, 66, 42], f * 0.6 + g * 0.4)]; },
  check: (u, v) => { const c = (Math.floor(u * 2) + Math.floor(v * 2)) % 2, f = fbm(u, v); return [f * 0.5, c ? mix([214, 206, 190], [228, 220, 206], f) : mix([120, 146, 160], [138, 162, 174], f)]; },
  leather: (u, v) => { const f = N64(u * 64, v * 64), g = N32(u * 32, v * 32); return [f * 0.8 + g * 0.5, mix([214, 198, 172], [232, 218, 194], f)]; },
  plaster: (u, v) => { const f = N128(u * 128, v * 128), g = N16(u * 16, v * 16); return [f * 0.5 + g * 0.6, mix([226, 222, 214], [242, 239, 232], f)]; },
  wood: (u, v) => { const P = 4, p = Math.floor(v * P), e = Math.min(v * P - p, 1 - (v * P - p)), gap = smooth(0.045, 0.0, e), g = N8(u * 2 + p * 3.3, v * 8 * 4) * 0.5 + N32(u * 4 + p * 7, v * 32 * 2) * 0.5, ring = 0.5 + 0.5 * Math.sin((g * 3 + N4(u * 4, p) * 2) * 9), t = (p * 0.37) % 1; return [-gap * 4 + g * 0.4, mix(mix(mix([122, 84, 56], [168, 122, 84], ring * 0.5 + g * 0.4), [96, 64, 44], t * 0.35), [26, 16, 10], gap)]; },
  wall: (u, v) => { const R = 4, r = Math.floor(v * R), x = u * 2 + (r % 2) * 0.5, c = Math.floor(x), ex = Math.min(x - c, 1 - (x - c)) / 2, ey = Math.min(v * R - r, 1 - (v * R - r)) / R, e = Math.min(ex, ey), joint = smooth(0.016, 0.006, e), f = fbm(u, v), t = N8(((c % 2) + 2) % 2 * 3.1 + r * 1.7, r * 2.3); return [(1 - joint) * 3 + f * 0.8, mix(mix(mix([142, 92, 74], [178, 124, 98], t), [116, 78, 66], f * 0.5), [186, 178, 166], joint)]; },
};
const STRENGTH = { smooth: 0.5, sand: 2.2, stone: 1.5, knit: 1.3, tape: 0.7, honey: 0.25, rubber: 0.4, jelly: 0.4, fur: 0.8, water: 0, slime: 0.4, block: 0.6, foam: 0.9, iron: 0.8, soil: 1.4, check: 0.4, wood: 0.9, wall: 1.2, leather: 0.8, plaster: 0.6 }, SURF = { smooth: 0.3, sand: 0.95, stone: 0.95, knit: 0.9, tape: 0.4, honey: 0.36, rubber: 0.5, jelly: 0.2, fur: 0.95, water: 0.06, slime: 0.34, block: 0.6, foam: 0.95, iron: 0.38, soil: 1, check: 0.7, wood: 0.55, wall: 0.9, leather: 0.8, plaster: 0.95 }, made = {};
export const TILE = { smooth: 34, sand: 46, stone: 56, knit: 46, tape: 70, honey: 60, rubber: 40, jelly: 40, fur: 26, water: 70, slime: 40, block: 46, foam: 22, iron: 40, soil: 30, check: 22, wood: 70, wall: 62, leather: 30, plaster: 40 }; // mm per repeat
export function surface(key) {
  if (made[key]) return made[key];
  const S = 256, h = new Float32Array(S * S), col = new Uint8ClampedArray(S * S * 4), nor = new Uint8ClampedArray(S * S * 4), f = DRAW[key], k = STRENGTH[key];
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) { const [z, c] = f((i + 0.5) / S, (j + 0.5) / S), q = j * S + i; h[q] = z; col.set([c[0], c[1], c[2], 255], q * 4); }
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) { const dx = (h[j * S + (i + 1) % S] - h[j * S + (i + S - 1) % S]) * k, dy = (h[((j + 1) % S) * S + i] - h[((j + S - 1) % S) * S + i]) * k, l = Math.hypot(dx, dy, 1); nor.set([(-dx / l * 0.5 + 0.5) * 255, (-dy / l * 0.5 + 0.5) * 255, (1 / l * 0.5 + 0.5) * 255, 255], (j * S + i) * 4); }
  const tx = (data, srgb) => { const c = document.createElement('canvas'); c.width = c.height = S; c.getContext('2d').putImageData(new ImageData(data, S, S), 0, 0); const t = new THREE.CanvasTexture(c); t.flipY = false; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; };
  const m = new THREE.MeshStandardMaterial({ map: tx(col, true), normalMap: tx(nor, false), roughness: SURF[key] }); m.userData.kids = []; if (key === 'knit') m.color.setScalar(1.9); if (key === 'rubber' || key === 'slime') m.color.setScalar(0.62); if (key === 'block') m.color.setScalar(0.85);
  if (SOL[key]) { const ld = new THREE.TextureLoader(), get = (f, srgb, set) => ld.load(new URL(`./tex/${f}.jpg?v=18`, import.meta.url).href, (t) => { t.flipY = false; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace; for (const q of [m, ...m.userData.kids]) { q[set] = t; q.needsUpdate = true; } }); get(SOL[key], true, 'map'); get(SOL[key] + '-n', false, 'normalMap'); } if (key === 'iron') m.metalness = 0.7; if (key === 'water') { m.envMapIntensity = 1.6; } if (key === 'jelly' || key === 'slime') { m.emissive = new THREE.Color(0x1c3a06); m.emissiveIntensity = 0.35; }
  if (key === 'honey') { m.color.setScalar(0.8); m.emissive = new THREE.Color(0x5a2a00); m.emissiveIntensity = 0.35; m.envMapIntensity = 0.35; } return (made[key] = m);
}
// a copy that also gets the picture when it arrives
export function copyOf(key) { const m = surface(key), c = m.clone(); c.userData = {}; m.userData.kids.push(c); return c; }
const SOL = { smooth: 'smooth', rubber: 'rubber', slime: 'slime', block: 'block', iron: 'iron', soil: 'soil', sand: 'sand', stone: 'stone', knit: 'knit', tape: 'tape', honey: 'honey', fur: 'fur', wall: 'brick', wood: 'wood', leather: 'leather', plaster: 'plaster' };
// a box with rounded edges, standing on z = 0, texture in mm
export function roundBox(a, h, r, tile) {
  const n = 5, g = new THREE.BoxGeometry(2 * a, 2 * a, h, 2 * n, 2 * n, 2 * n), p = g.attributes.position, q = g.attributes.normal, u = g.attributes.uv, V = new THREE.Vector3(), C = new THREE.Vector3(), L = [a - r, a - r, h / 2 - r];
  const snap = (v, half, lim) => { const s = Math.abs(v) / half, e = s * n; return Math.sign(v) * (e <= 1 ? lim * e * 1 : lim + (half - lim) * (e - 1) / (n - 1)); }; // most of the vertices at the edge
  for (let i = 0; i < p.count; i++) {
    const nx = q.getX(i), ny = q.getY(i), nz = q.getZ(i);
    V.set(snap(p.getX(i), a, L[0]), snap(p.getY(i), a, L[1]), snap(p.getZ(i), h / 2, L[2])); C.set(...[V.x, V.y, V.z].map((v, k) => Math.max(-L[k], Math.min(L[k], v)))); const d = V.clone().sub(C);
    if (d.lengthSq() > 1e-9) { d.normalize(); V.copy(C).addScaledVector(d, r); q.setXYZ(i, d.x, d.y, d.z); }
    p.setXYZ(i, V.x, V.y, V.z + h / 2); const k = Math.abs(nz) > 0.5 ? [V.x, V.y] : Math.abs(nx) > 0.5 ? [V.y, V.z] : [V.x, V.z]; u.setXY(i, k[0] / tile, k[1] / tile);
  }
  return g;
}
