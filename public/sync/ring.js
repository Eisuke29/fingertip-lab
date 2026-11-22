// Find the blinking disc INSIDE the target box only. diff = average of (on - off) over several blinks.
// The overall brightness change inside the box (auto exposure) is removed by subtracting the median.
// box: {x0,y0,x1,y1} in 0..1 units. Returns { x, y, w, h, peak } in 0..1 units, or null.
export function discInBox(diff, W, H, box) {
  const X0 = Math.floor(box.x0 * W), X1 = Math.ceil(box.x1 * W), Y0 = Math.floor(box.y0 * H), Y1 = Math.ceil(box.y1 * H);
  const vals = [];
  for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) vals.push(diff[y * W + x]);
  if (!vals.length) return null;
  const sorted = vals.slice().sort((a, b) => a - b), med = sorted[sorted.length >> 1], p90 = sorted[Math.floor(sorted.length * 0.9)];
  let best = -Infinity, bi = -1;
  for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) { const d = diff[y * W + x] - med; if (d > best) { best = d; bi = y * W + x; } }
  if (best < 25 || best < 3 * Math.max(1, p90 - med)) return null; // must clearly stand out from the rest of the box
  const thr = med + best * 0.45, seen = new Uint8Array(W * H), stack = [bi];
  let n = 0, sx = 0, sy = 0, x0 = W, x1 = 0, y0 = H, y1 = 0; seen[bi] = 1;
  while (stack.length) {
    const k = stack.pop(), x = k % W, y = (k / W) | 0; n++; sx += x; sy += y;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    for (const q of [k - 1, k + 1, k - W, k + W]) {
      if (q < 0 || q >= W * H || seen[q]) continue;
      const qx = q % W, qy = (q / W) | 0; if (Math.abs(qx - x) > 1 || qx < X0 || qx >= X1 || qy < Y0 || qy >= Y1) continue;
      seen[q] = 1; if (diff[q] > thr) stack.push(q);
    }
  }
  if (n < 4 || x1 - x0 > 0.8 * (X1 - X0)) return null;
  return { x: (sx / n + 0.5) / W, y: (sy / n + 0.5) / H, w: (x1 - x0 + 1) / W, h: (y1 - y0 + 1) / H, peak: best };
}
