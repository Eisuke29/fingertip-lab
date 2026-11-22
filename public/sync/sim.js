// Synthetic side camera: draws a finger with known angles so the whole pipeline can be tested without hardware.
import { RATIO } from './tracker.js';

export function createSimCamera({ width = 1280, height = 720, fps = 30 } = {}) {
  const cv = document.createElement('canvas'); cv.width = width; cv.height = height;
  const ctx = cv.getContext('2d');
  // geometry in image px
  const a = { x: 200, y: 650 }, ang = -30 * Math.PI / 180;
  const g = { x: Math.cos(ang), y: Math.sin(ang) }, nrm = { x: g.y, y: -g.x }; // finger side = up-left
  const glass = { a, b: { x: a.x + g.x * 1000, y: a.y + g.y * 1000 } };
  const Lm = 140, T = 84, r = T / 2;
  const pipC = { x: a.x + g.x * 300, y: a.y + g.y * 300 }, dipC = { x: pipC.x + g.x * Lm, y: pipC.y + g.y * Lm };
  const state = { handIn: true, t0: performance.now(), thp: 75, thd: 30, manual: null, flash: null };
  const noise = document.createElement('canvas'); noise.width = 256; noise.height = 256;
  { const n = noise.getContext('2d'), id = n.createImageData(256, 256);
    for (let i = 0; i < id.data.length; i += 4) { const v = Math.random() * 255; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255; }
    n.putImageData(id, 0, 0); }

  const P = (o, d, s) => ({ x: o.x + d.x * s, y: o.y + d.y * s });
  function anglesAt(t) {
    if (state.manual) return state.manual;
    const s = (t - state.t0) / 1000;
    return { thp: 75 + 28 * Math.sin(2 * Math.PI * s / 7), thd: 40 + 38 * Math.sin(2 * Math.PI * s / 4.6 + 1) };
  }
  function finger(c, alpha = 1) {
    const { thp, thd } = state;
    const rp = (x) => x * Math.PI / 180;
    const pip = P(pipC, nrm, r), dip = P(dipC, nrm, r);
    const dp = { x: -g.x * Math.cos(rp(thp)) + nrm.x * Math.sin(rp(thp)), y: -g.y * Math.cos(rp(thp)) + nrm.y * Math.sin(rp(thp)) };
    const dd = { x: g.x * Math.cos(rp(thd)) + nrm.x * Math.sin(rp(thd)), y: g.y * Math.cos(rp(thd)) + nrm.y * Math.sin(rp(thd)) };
    const mcp = P(pip, dp, Lm * RATIO.prox), tip = P(dip, dd, Lm * RATIO.dist - r * 0.9);
    c.save(); c.globalAlpha = alpha; c.lineCap = 'round'; c.lineJoin = 'round';
    // palm + thumb (beyond the MCP, partly behind)
    c.fillStyle = '#b9876b';
    c.beginPath(); c.ellipse(mcp.x + dp.x * 90, mcp.y + dp.y * 90, 150, 105, Math.atan2(dp.y, dp.x), 0, Math.PI * 2); c.fill();
    c.fillStyle = '#c99479';
    c.beginPath(); c.ellipse(mcp.x + dp.x * 40 + g.x * 60, mcp.y + dp.y * 40 + g.y * 60, 70, 36, Math.atan2(dp.y, dp.x) + 0.6, 0, Math.PI * 2); c.fill();
    const seg = (p, q, w, col) => { c.strokeStyle = col; c.lineWidth = w; c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(q.x, q.y); c.stroke(); };
    seg(pip, mcp, 2 * r * 1.05, '#d8a283');
    seg(pip, dip, 2 * r, '#dca88a');
    seg(dip, tip, 2 * r * 0.9, '#e0ad90');
    c.restore();
  }
  function draw(now) {
    const A = anglesAt(now); state.thp = A.thp; state.thd = A.thd;
    if (state.flash != null) { ctx.fillStyle = state.flash ? '#f2f2f2' : '#101010'; ctx.fillRect(0, 0, width, height); return; }
    ctx.fillStyle = '#121212'; ctx.fillRect(0, 0, width, height);
    // screen slab below the glass line
    ctx.save(); ctx.beginPath();
    ctx.moveTo(glass.a.x - g.x * 400, glass.a.y - g.y * 400); ctx.lineTo(glass.b.x, glass.b.y);
    ctx.lineTo(glass.b.x - nrm.x * 300, glass.b.y - nrm.y * 300); ctx.lineTo(glass.a.x - g.x * 400 - nrm.x * 300, glass.a.y - g.y * 400 - nrm.y * 300);
    ctx.closePath(); ctx.fillStyle = '#2a2d33'; ctx.fill(); ctx.clip();
    if (state.handIn) { // reflection on the glass
      ctx.translate(glass.a.x, glass.a.y); const M = [g.x * g.x - nrm.x * nrm.x, g.x * g.y - nrm.x * nrm.y, g.x * g.y - nrm.x * nrm.y, g.y * g.y - nrm.y * nrm.y];
      ctx.transform(M[0], M[1], M[2], M[3], 0, 0); ctx.translate(-glass.a.x, -glass.a.y); finger(ctx, 0.25);
    }
    ctx.restore();
    ctx.strokeStyle = '#6b7280'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(glass.a.x - g.x * 400, glass.a.y - g.y * 400); ctx.lineTo(glass.b.x, glass.b.y); ctx.stroke();
    if (state.handIn) finger(ctx);
    ctx.globalAlpha = 0.06; ctx.drawImage(noise, -Math.random() * 200, -Math.random() * 200, width + 200, height + 200); ctx.globalAlpha = 1;
  }
  let timer = setInterval(() => draw(performance.now()), 1000 / fps);
  draw(performance.now());
  const stream = cv.captureStream(fps);
  return {
    stream, state, canvas: cv,
    truth: { glass, pipC, dipC, T, side: -1, Lm },
    angles: () => ({ thp: state.thp, thd: state.thd }),
    stop() { clearInterval(timer); stream.getTracks().forEach(t => t.stop()); },
  };
}
