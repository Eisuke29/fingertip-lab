// Where is the ring in the picture? The iPad blinks a white disc at the ring position; the blob that changes
// between "off" and "on" frames is the disc. Independent of table colours and lighting.
// on / off: luma (Float32Array) of the same small frame size W x H. Returns { x, y, w } in 0..1 units, or null.
export function blinkBlob(on, off, W, H) {
  let best = 0, bi = -1;
  for (let k = 0; k < on.length; k++) { const d = on[k] - off[k]; if (d > best) { best = d; bi = k; } }
  if (best < 30) return null;
  const thr = best * 0.4, seen = new Uint8Array(on.length), stack = [bi];
  let n = 0, sx = 0, sy = 0, x0 = W, x1 = 0; seen[bi] = 1;
  while (stack.length) {
    const k = stack.pop(), x = k % W, y = (k / W) | 0; n++; sx += x; sy += y; if (x < x0) x0 = x; if (x > x1) x1 = x;
    for (const q of [k - 1, k + 1, k - W, k + W]) {
      if (q < 0 || q >= on.length || seen[q] || Math.abs((q % W) - x) > 1) continue;
      seen[q] = 1; if (on[q] - off[q] > thr) stack.push(q);
    }
  }
  if (n < 3 || x1 - x0 > 0.4 * W) return null;
  return { x: (sx / n + 0.5) / W, y: (sy / n + 0.5) / H, w: (x1 - x0 + 1) / W };
}
