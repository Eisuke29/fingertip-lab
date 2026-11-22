// What the iPad screen shows for the camera. Shared by the iPad page and the synthetic camera.
// Coordinates: CSS px of the iPad (w x h); mm = px * mmPerPx, origin at the screen centre, y up.
export function drawPattern(c, CW, CH, m, w, h, mmPerPx) {
  const sx = CW / w, sy = CH / h, k = 1 / mmPerPx;
  const X = (xmm) => (xmm * k + w / 2) * sx, Y = (ymm) => (h / 2 - ymm * k) * sy;
  c.fillStyle = m.kind === 'white' ? '#fff' : '#000'; c.fillRect(0, 0, CW, CH);
  if (m.kind === 'dot') { c.fillStyle = '#fff'; c.beginPath(); c.ellipse(X(m.x), Y(m.y), (m.r || 7) * k * sx, (m.r || 7) * k * sy, 0, 0, 7); c.fill(); }
  if (m.kind === 'gray') { // stripe = bit `bit` of the Gray code of the px column (axis x) or row (axis y)
    c.fillStyle = '#fff';
    const N = m.axis === 'x' ? w : h;
    let run = -1;
    for (let i = 0; i <= N; i++) {
      const on = i < N && (((i ^ (i >> 1)) >> m.bit) & 1) !== (m.inv ? 1 : 0);
      if (on && run < 0) run = i;
      if (!on && run >= 0) { if (m.axis === 'x') c.fillRect(run * sx, 0, (i - run) * sx, CH); else c.fillRect(0, run * sy, CW, (i - run) * sy); run = -1; }
    }
  }
  if (m.kind === 'grid') {
    c.strokeStyle = '#ffffff'; c.lineWidth = 2;
    for (let x = -100; x <= 100; x += 20) { c.beginPath(); c.moveTo(X(x), 0); c.lineTo(X(x), CH); c.stroke(); }
    for (let y = -60; y <= 60; y += 20) { c.beginPath(); c.moveTo(0, Y(y)); c.lineTo(CW, Y(y)); c.stroke(); }
    c.strokeStyle = '#ff4d4d'; c.lineWidth = 4; c.beginPath(); c.ellipse(X(0), Y(0), 10 * k * sx, 10 * k * sy, 0, 0, 7); c.stroke();
  }
}
