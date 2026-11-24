// node scripts/bake-skin.mjs : makes public/mp-ipad/skin.jpg, skin-normal.jpg, nail.jpg (skin of the virtual finger, no photographs)
import { chromium } from 'playwright';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const END = 97, TAU = Math.PI * 2;
// ---------- skin ----------
function noise(seed, n = 256) { // tileable value noise
  let x = seed; const rnd = () => (x = (x * 16807) % 2147483647) / 2147483647, g = new Float32Array(n * n).map(rnd);
  return (u, v) => { u = ((u % n) + n) % n; v = ((v % n) + n) % n; const i = u | 0, j = v | 0, a = u - i, b = v - j, p = a * a * (3 - 2 * a), q = b * b * (3 - 2 * b), i1 = (i + 1) % n, j1 = (j + 1) % n; return (g[j * n + i] * (1 - p) + g[j * n + i1] * p) * (1 - q) + (g[j1 * n + i] * (1 - p) + g[j1 * n + i1] * p) * q; };
}
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }, bell = (x, w) => Math.exp(-(x * x) / (w * w));
function skinMaps(W, H) {
  const N = noise(11), N2 = noise(77), col = new Uint8ClampedArray(W * H * 4), h = new Float32Array(W * H), C = 50; // circumference (mm)
  const creases = [[67.2, 0.4, 0.34], [66.3, 0.12, 0.22], [64.9, 0.1, 0.25], [43.6, 0.36, 0.36], [42.7, 0.12, 0.22], [41.2, 0.32, 0.32], [40.3, 0.1, 0.25], [13.6, 0.34, 0.4], [12.4, 0.12, 0.25], [10.9, 0.28, 0.36], [53, 0.05, 0.3], [47.5, 0.05, 0.3], [30, 0.05, 0.4], [72, 0.04, 0.25]]; // s, depth, width on the palm side
  const back = []; { let x = 5; const rnd = () => (x = (x * 16807) % 2147483647) / 2147483647; for (let i = 0; i < 13; i++) back.push([42 + (i - 6) * 1.15 + rnd() * 0.5, 0.16 + 0.22 * rnd() * bell(i - 6, 5), 0.28 + 0.2 * rnd(), 1]); for (let i = 0; i < 8; i++) back.push([67.2 + (i - 3.5) * 0.95 + rnd() * 0.4, 0.1 + 0.16 * rnd(), 0.25 + 0.15 * rnd(), 1]); }
  for (let j = 0; j < H; j++) {
    const s = -20 + (j + 0.5) / H * (END + 20);
    for (let i = 0; i < W; i++) {
      const a = (i + 0.5) / W * TAU, q = Math.sin(a), palm = smooth(-0.25, 0.45, q), dors = smooth(0.1, -0.5, q), x = i / W * C; // x: mm around
      const low = N(x * 0.28, s * 0.28) * 0.6 + N(x * 0.7 + 40, s * 0.7) * 0.4, mid = N2(x * 2.2, s * 1.6), fine = N2(x * 6 + 9, s * 5), pore = N(x * 13, s * 13 + 3);
      let d = 0, red = 0, dark = 0;
      const wav = (N(x * 0.16 + 7, 3) - 0.5) * 2.4 + (N(x * 0.7 + 90, s * 0.15) - 0.5) * 0.7, bow = 1.3 * Math.cos(a) ** 2, fadeP = smooth(-0.35, 0.5, q);
      for (const [c, dep, w] of creases) { const e = s - c - wav * 0.5 + bow, k = bell(e, w) * fadeP * (0.55 + 0.7 * N(x * 0.45 + c, 9)); d -= dep * k * (0.75 + 0.5 * mid); dark += 0.3 * dep * k; red += (0.5 * dep * k + 0.32 * dep * bell(e, w * 3.2) * fadeP); }
      for (const [c, dep, w] of back) { const e = s - c - wav * 0.7 - 0.9 * Math.cos(a) * (c > 60 ? 0.5 : 1), k = bell(e, w) * dors * (0.35 + 0.9 * N(x * 0.9 + c * 3, s * 0.4)); d -= dep * k; dark += 0.22 * dep * k; red += 0.2 * dep * k; }
      d += dors * (Math.abs(Math.sin(x * 2.6 + 1.5 * mid + s * 2.1)) + Math.abs(Math.sin(x * 2.6 - s * 2.3 + 1.8 * fine))) * 0.022; // fine net of the skin on the back
      d += (fine - 0.5) * 0.05 + (pore - 0.5) * 0.035;
      { const px = (a - Math.PI / 2) * C / TAU, ps = s - 85.5, rr = Math.hypot(px * 1.05, ps * 0.8 + 0.02 * px * px), m = palm * smooth(71, 77, s) * smooth(96.5, 93, s); d += m * 0.036 * Math.sin((rr + 2.4 * (N(px * 0.5 + 60, ps * 0.5 + 60) - 0.5) + (ps < -3 ? 0.12 * ps : 0)) * TAU / 0.56); // fingerprint
        const g2 = palm * (smooth(45, 48, s) * smooth(65, 62, s) + smooth(16, 20, s) * smooth(40, 37, s)); d += g2 * 0.022 * Math.sin((s + 0.25 * x + 0.8 * low) * TAU / 0.6); }
      red += 0.16 * bell(s - 42, 6) * dors + 0.13 * bell(s - 67, 5) * dors + 0.24 * smooth(72, 92, s) * palm + 0.12 * palm * (bell(s - 54, 6) + bell(s - 28, 8)) + 0.1 * smooth(84, 95, s);
      red += 0.16 * (low - 0.5); dark += 0.05 * (0.5 - low) + 0.05 * (mid - 0.5) + 0.025 * (pore - 0.5) + 0.06 * dors;
      const vein = dors * smooth(3, 9, s) * smooth(40, 30, s) * bell(a - 4.55 - 0.15 * Math.sin(s * 0.22), 0.09); // faint
      const L = 0.965 - dark - 0.03 * vein, k = j * W + i;
      col[k * 4] = 255 * Math.min(1, L + 0.02 * red) * (1 - 0.04 * vein); col[k * 4 + 1] = 255 * L * (1 - 0.42 * red); col[k * 4 + 2] = 255 * L * (1 - 0.46 * red + 0.02 * vein); col[k * 4 + 3] = 255; h[k] = d;
    }
  }
  const nor = new Uint8ClampedArray(W * H * 4), mx = C / W, my = (END + 20) / H; // normal map
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const k = j * W + i, dx = (h[j * W + (i + 1) % W] - h[j * W + (i + W - 1) % W]) / (2 * mx), dy = (h[Math.min(H - 1, j + 1) * W + i] - h[Math.max(0, j - 1) * W + i]) / (2 * my), l = Math.hypot(dx, dy, 1); nor[k * 4] = 127.5 - 127.5 * dx / l; nor[k * 4 + 1] = 127.5 - 127.5 * dy / l; nor[k * 4 + 2] = 127.5 + 127.5 / l; nor[k * 4 + 3] = 255; }
  return [col, nor];
}
function nailMap() {
  const W = 256, H = 256, d = new Uint8ClampedArray(W * H * 4), N = noise(5);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const u = i / W * 2 - 1, v = j / H, k = (j * W + i) * 4, lun = smooth(0.03, -0.03, v - 0.17 + 0.16 * u * u), free = smooth(-0.015, 0.02, v - 0.9 + 0.06 * u * u), ridge = (N(i * 0.35, 3 + j * 0.004) - 0.5) * 0.04, edge = 0.1 * smooth(0.8, 1, Math.abs(u));
    const mix = (p, l, f) => p * (1 - lun) * (1 - free) + l * lun + f * free; d[k] = 255 * (mix(0.95, 0.965, 0.97) + ridge - edge); d[k + 1] = 255 * (mix(0.80, 0.87, 0.94) + ridge - edge); d[k + 2] = 255 * (mix(0.76, 0.83, 0.89) + ridge - edge); d[k + 3] = 255;
  }
  return d;
}

const OUT = fileURLToPath(new URL('../public/mp-ipad/', import.meta.url)), W = 1024, H = 2048, [col, nor] = skinMaps(W, H), b = await chromium.launch({ channel: 'chrome' }), p = await b.newPage();
for (const [name, d, w, h, q] of [['skin.jpg', col, W, H, 0.86], ['skin-normal.jpg', nor, W, H, 0.9], ['nail.jpg', nailMap(), 256, 256, 0.9]]) {
  const u = await p.evaluate(([b64, w, h, q]) => { const s = atob(b64), a = new Uint8ClampedArray(s.length); for (let i = 0; i < a.length; i++) a[i] = s.charCodeAt(i); const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').putImageData(new ImageData(a, w, h), 0, 0); return c.toDataURL('image/jpeg', q); }, [Buffer.from(d.buffer).toString('base64'), w, h, q]);
  fs.writeFileSync(OUT + name, Buffer.from(u.split(',')[1], 'base64')); console.log(name, fs.statSync(OUT + name).size);
}
await b.close();
