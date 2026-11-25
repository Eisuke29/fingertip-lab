// The person's own finger: a photo of the back of the hand -> the skin of the virtual finger (with the own nail). Everything stays on this device.
import * as THREE from 'three';
const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3', S0 = -20, S1 = 97, W = 512, H = 768;
let lm = null;
export async function fingerFromPhoto(file) {
  const url = URL.createObjectURL(file), im = new Image(); await new Promise((ok, ng) => { im.onload = ok; im.onerror = () => ng(new Error('写真を開けません')); im.src = url; });
  const k = Math.min(1, 1600 / Math.max(im.naturalWidth, im.naturalHeight)), c = document.createElement('canvas'); c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k); const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
  if (!lm) { const { HandLandmarker, FilesetResolver } = await import(`${MP}/vision_bundle.mjs`), fs = await FilesetResolver.forVisionTasks(`${MP}/wasm`); lm = await HandLandmarker.createFromOptions(fs, { baseOptions: { modelAssetPath: new URL('../models/hand_landmarker.task', import.meta.url).href, delegate: 'CPU' }, runningMode: 'IMAGE', numHands: 1 }); }
  const L = lm.detect(c).landmarks?.[0]; if (!L) throw new Error('手が見つかりません。手の甲を、明るい所で大きく撮ってください');
  const P = [5, 6, 7, 8].map((i) => [L[i].x * c.width, L[i].y * c.height]), d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]); if (d(P[1], P[2]) < 25) throw new Error('指が小さすぎます。もう少し近くで撮ってください');
  return wrap(g.getImageData(0, 0, c.width, c.height), P);
}
// P: MCP, PIP, DIP, TIP in the picture. The tip point lies a little before the end of the finger.
export function wrap(img, P) {
  const { data, width: w, height: h } = img, at = (x, y) => { x = Math.max(0, Math.min(w - 1, Math.round(x))); y = Math.max(0, Math.min(h - 1, Math.round(y))); const i = (y * w + x) * 4; return [data[i], data[i + 1], data[i + 2]]; };
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1]], len = (a) => Math.hypot(...a), un = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; }, D = [0, 1, 2].map((i) => sub(P[i + 1], P[i])), mm = (len(D[1]) / 25 + len(D[2]) / 24) / 2; // pixels per mm
  const N = [[0, P[0]], [42, P[1]], [67, P[2]], [91, P[3]], [98, [P[3][0] + un(D[2])[0] * 7 * mm, P[3][1] + un(D[2])[1] * 7 * mm]]], mid = (s) => { let i = 0; while (i < N.length - 2 && s > N[i + 1][0]) i++; const t = (s - N[i][0]) / (N[i + 1][0] - N[i][0]); return [0, 1].map((k) => N[i][1][k] + (N[i + 1][1][k] - N[i][1][k]) * t); }, dirAt = (s) => un(sub(mid(Math.min(97, s + 4)), mid(s - 4)));
  // the skin's colour along the middle, then how far it goes to both sides (the edge of the finger)
  const skin = []; for (let s = 46; s < 64; s += 2) { const m = mid(s); skin.push(at(m[0], m[1])); } const base = [0, 1, 2].map((k) => skin.map((q) => q[k]).sort((a, b) => a - b)[skin.length >> 1]);
  const far = (c) => { const a = c[0] + c[1] + c[2] + 1, b = base[0] + base[1] + base[2] + 1; return Math.hypot(c[0] / a - base[0] / b, c[1] / a - base[1] / b) * 5 + Math.abs(Math.log(a / b)) * 0.55; };
  const half = (s) => { const m = mid(s), v = dirAt(s), n = [-v[1], v[0]], r = [1, -1].map((sg) => { let x = 4.5; for (; x < 11; x += 0.25) if (far(at(m[0] + n[0] * sg * x * mm, m[1] + n[1] * sg * x * mm)) > 0.55) break; return x; }); return Math.min(10, Math.max(6, (r[0] + r[1]) / 2)); };
  const hw = [44, 50, 56, 62, 70].map(half).sort((a, b) => a - b)[2] * 0.94, prof = (s) => hw * (s < 70 ? 1 : 1 - 0.1 * (s - 70) / 20) * (s > 86 ? Math.sqrt(Math.max(0.05, 1 - ((s - 86) / 12) ** 2)) : 1);
  const out = new Uint8ClampedArray(W * H * 4), line = new Float32Array(3); let sum = [0, 0, 0], n = 0;
  for (let j = 0; j < H; j++) {
    const s = Math.max(20, S0 + (j + 0.5) / H * (S1 - S0)), m = mid(s), v = dirAt(s), nn = [-v[1], v[0]], p = prof(s); line.fill(0); for (let q = -6; q <= 6; q++) { const c = at(m[0] + nn[0] * q / 8 * p * mm, m[1] + nn[1] * q / 8 * p * mm); for (let k = 0; k < 3; k++) line[k] += c[k] / 13; }
    for (let i = 0; i < W; i++) { const a = (i + 0.5) / W * Math.PI * 2, x = -Math.cos(a) * 0.9, q = Math.sin(a), b = Math.max(0, Math.min(1, (0.35 - q) / 0.5)), c = at(m[0] + nn[0] * x * p * mm, m[1] + nn[1] * x * p * mm), o = (j * W + i) * 4, t = s > 80 ? (1 - b) : 1 - b; for (let k = 0; k < 3; k++) out[o + k] = c[k] * (1 - t) + (s > 80 ? base[k] : line[k]) * t; out[o + 3] = 255; if (q < -0.3 && s > 44 && s < 76) { for (let k = 0; k < 3; k++) sum[k] += c[k]; n++; } }
  }
  const c = document.createElement('canvas'); c.width = W; c.height = H; c.getContext('2d').putImageData(new ImageData(out, W, H), 0, 0); return made(c, sum.map((q) => q / n / 255));
}
const KEY = 'mpIpad.photo';
function made(c, mean) { const t = new THREE.CanvasTexture(c); t.flipY = false; t.wrapS = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return { texture: t, mean: new THREE.Color().setRGB(...mean, THREE.SRGBColorSpace), rgb: mean, canvas: c };
}
// kept on this device only
export function keepPhoto(p) { try { localStorage.setItem(KEY, JSON.stringify({ rgb: p.rgb, jpg: p.canvas.toDataURL('image/jpeg', 0.9) })); } catch {} }
export async function lastPhoto() { try { const o = JSON.parse(localStorage.getItem(KEY)); if (!o) return null; const im = new Image(); im.src = o.jpg; await im.decode(); const c = document.createElement('canvas'); c.width = W; c.height = H; c.getContext('2d').drawImage(im, 0, 0, W, H); return made(c, o.rgb); } catch { return null; } }
