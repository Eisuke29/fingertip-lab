// 横カメラ（iPhone）: measures theta_p / theta_d from the raw camera frames and sends only the numbers
// (plus a small preview video for setup) to the iPad. Camera frames never leave the two devices.
import * as T from './tracker.js';
import { client } from './link.js';

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
const SIM = params.has('sim');
const HOST = params.get('peer');

const S = {
  stage: 'idle', msg: '', jt: null, progress: 0, W: 0, H: 0, video: null, stream: null,
  fps: 0, frameTimes: [], procMs: 0, stillN: 0, prevSmall: null,
  glassCand: null, glassStable: 0, glass: null, below: 0,
  bg: new T.Background(), bgBusy: false, bgFrames: 0, bgRef: null,
  cal: null, model: null, calStable: 0, lastCand: null,
  raw: null, filt: null, ok: false, prev: {},
  fP: new T.OneEuro(1.2, 0.25), fD: new T.OneEuro(1.2, 0.25),
  adjust: false, drag: null, preview: true, collect: null, lat: false, latLo: 255, latHi: 0, latWhite: null,
};
let link = null, sim = null;
const work = document.createElement('canvas'), wctx = work.getContext('2d', { willReadFrequently: true });
const small = document.createElement('canvas'); small.width = 160; small.height = 90; const sctx = small.getContext('2d', { willReadFrequently: true });
const view = $('#view'), vctx = view.getContext('2d');
const prev = document.createElement('canvas'), pctx = prev.getContext('2d');

// ---------------- start ----------------
$('#go').onclick = start;
if (SIM) setTimeout(start, 50);
async function start() {
  $('#startErr').textContent = '';
  if (!HOST) { $('#startErr').textContent = 'iPad の画面に出ている QR コードから開いてください。'; return; }
  try {
    let stream;
    if (SIM) { const { createSimCamera } = await import('./sim.js'); sim = createSimCamera(); sim.state.handIn = false; stream = sim.stream; }
    else stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 } }, audio: false });
    const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.setAttribute('playsinline', ''); v.srcObject = stream; await v.play();
    S.video = v; S.stream = stream; resize();
    $('#start').style.display = 'none';
    try { await navigator.wakeLock?.request('screen'); } catch {}
    link = await client(HOST, { onOpen: () => sendStatus(true), onData, onClose: () => {}, onError: () => {} });
    link.setStream(prev.captureStream(15));
    v.requestVideoFrameCallback(onFrame);
  } catch (e) { $('#startErr').textContent = `カメラを開けませんでした：${e.message || e}`; }
}
function resize() {
  const v = S.video; if (!v) return;
  if (v.videoWidth !== S.W || v.videoHeight !== S.H) {
    S.W = v.videoWidth; S.H = v.videoHeight; work.width = view.width = S.W; work.height = view.height = S.H;
    prev.width = 640; prev.height = Math.round(640 * S.H / S.W);
    S.bg.reset(); S.cal = null; S.model = null; S.glass = null; S.stage = 'place';
  }
}

// ---------------- frame loop ----------------
let n = 0;
function onFrame(now) {
  const v = S.video; resize();
  S.frameTimes.push(now); while (now - S.frameTimes[0] > 1000) S.frameTimes.shift(); S.fps = S.frameTimes.length;
  const t0 = performance.now();
  wctx.drawImage(v, 0, 0, S.W, S.H); n++;
  stats();
  if (S.bgBusy) bgFrame();
  else if (!S.bg.ready && n % 10 === 0) liveGlass();
  if (S.bg.ready && S.cal) trackFrame(now);
  if (S.jt && n % 3 === 0) jointTry();
  S.procMs = performance.now() - t0;
  if (S.raw && link?.connected) link.send({ type: 'pose', t: now, thp: S.raw.thp, thd: S.raw.thd, fthp: S.filt?.thp ?? null, fthd: S.filt?.thd ?? null, ok: S.ok, sp: +S.raw.scoreP.toFixed(3), sd: +S.raw.scoreD.toFixed(3), proc: +S.procMs.toFixed(1) });
  if (S.collect && S.raw) S.collect.push({ thp: S.raw.thp, thd: S.raw.thd, ok: S.ok });
  if (S.lat) latencyFrame();
  if (n % 2 === 0) { drawOverlay(vctx, view, 1.4); if (S.preview) { pctx.drawImage(view, 0, 0, prev.width, prev.height); } }
  if (n % 8 === 0) sendStatus();
  v.requestVideoFrameCallback(onFrame);
}

function stats() {
  sctx.drawImage(S.video, 0, 0, 160, 90);
  const d = sctx.getImageData(0, 0, 160, 90).data, L = new Float32Array(160 * 90);
  let diff = 0, c = 0, cn = 0;
  for (let i = 0, k = 0; k < L.length; i += 4, k++) { L[k] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; if (S.prevSmall) diff += Math.abs(L[k] - S.prevSmall[k]); }
  for (let y = 30; y < 60; y++) for (let x = 50; x < 110; x++) { c += L[y * 160 + x]; cn++; }
  S.center = c / cn;
  S.diff = S.prevSmall ? diff / L.length : 99; S.prevSmall = L;
  S.stillN = S.diff < 2 ? S.stillN + 1 : 0;
  let mean = 0; for (const l of L) mean += l; S.mean = mean / L.length;
}

// The iPad drives the steps; the phone only reports and acts on commands.
const ack = (what, ok, msg) => link?.send({ type: 'ack', what, ok, msg });

// before the background is taken: keep looking for the glass line so the iPad can show it
function liveGlass() {
  const g = T.detectGlass(wctx.getImageData(0, 0, S.W, S.H));
  S.glassCand = g; S.below = g ? g.below : 0;
}
function captureBackground() {
  const g = S.glassCand || S.glass;
  if (!g) { ack('bg', false, '画面の線が見つかりません'); return; }
  S.glass = { a: g.a, b: g.b };
  S.bgBusy = true; S.bg.reset(); S.bgFrames = -4; S.bgRef = null; S.cal = null; S.model = null; S.raw = null; S.ok = false;
  if (sim) sim.state.handIn = false;
}
function bgFrame() {
  if (S.bgFrames < 0) { S.bgFrames++; return; }
  if (!S.bgRef) S.bgRef = S.prevSmall.slice();
  else { let d = 0; for (let k = 0; k < S.bgRef.length; k++) d += Math.abs(S.prevSmall[k] - S.bgRef[k]); if (d / S.bgRef.length > 6) { S.bgBusy = false; S.bg.reset(); S.glass = null; ack('bg', false, '動きがありました'); return; } }
  S.bg.add(wctx.getImageData(0, 0, S.W, S.H)); S.bgFrames++;
  if (S.bgFrames >= 30) {
    S.bg.finish(); S.bgBusy = false; S.stage = 'bg';
    ack('bg', true, '');
    if (sim) setTimeout(() => { sim.state.handIn = true; sim.state.manual = { thp: 70, thd: 45 }; }, 300);
  }
}

// joints: try for up to ~2 s; succeed when the joints stay put, both joints are bent and the fit is good
function fullField() { return T.foreground(wctx.getImageData(0, 0, S.W, S.H), { x0: 0, y0: 0, w: S.W, h: S.H }, S.bg); }
function startJoints() { S.jt = { n: 0, last: null, good: 0, why: '指が見えません' }; S.cal = null; S.model = null; S.raw = null; S.ok = false; }
function jointTry() {
  const J = S.jt; J.n++;
  const f = fullField(), prop = T.proposeJoints(f, S.glass);
  if (prop) {
    const ref = T.refineJoints(f, { glass: S.glass, pipC: prop.pipC, dipC: prop.dipC, T: prop.T, side: prop.side });
    ref.T = T.measureThickness(f, ref.glass, ref.pipC, ref.dipC, ref.side) || prop.T;
    const moved = J.last ? Math.max(T.vec.len(T.vec.sub(ref.pipC, J.last.pipC)), T.vec.len(T.vec.sub(ref.dipC, J.last.dipC))) : 99;
    J.last = ref;
    if (!S.cal || moved > 1.5) { S.cal = ref; S.model = null; S.prev = {}; }
    const bent = S.raw && S.raw.thd >= 12 && S.raw.thp > 25 && S.raw.thp < 160;
    J.why = !S.raw ? '指が見えません' : !bent ? '関節の曲げが足りません' : !S.ok ? '指の形が合いません' : moved >= 3 ? '指が動いています' : '';
    J.good = !J.why ? J.good + 1 : 0;
  } else J.why = '指が見えません';
  if (J.good >= 3) { S.jt = null; S.stage = 'cal'; S.fP.reset(); S.fD.reset(); ack('joints', true, ''); return; }
  if (J.n >= 24) { S.jt = null; if (!S.ok) { S.cal = null; S.model = null; } ack('joints', false, J.why); }
}

function trackFrame(now) {
  if (!S.model) S.model = T.buildModel(S.cal);
  const m = S.model, roi = T.roiFor(m, S.W, S.H);
  const f = T.foreground(wctx.getImageData(roi.x0, roi.y0, roi.w, roi.h), roi, S.bg);
  const r = T.track(f, m, S.prev);
  const okP = r.scoreP > T.SCORE_OK, okD = r.scoreD > T.SCORE_OK;
  S.prev = { thp: r.thp, thd: r.thd, okP, okD }; S.raw = r; S.ok = okP && okD;
  if (S.ok) S.filt = { thp: S.fP.filter(r.thp, now), thd: S.fD.filter(r.thd, now) };
}

// ---------------- overlay (drawn on the phone; the iPad receives it as video) ----------------
function drawOverlay(c, canvas, k) {
  c.drawImage(work, 0, 0);
  c.lineCap = 'round';
  const lw = (x) => x * k * (S.W / 960);
  const glass = S.glass || S.glassCand;
  if (glass) {
    const g = T.vec.unit(T.vec.sub(glass.b, glass.a));
    c.strokeStyle = S.glass ? 'rgba(255,255,255,.85)' : 'rgba(90,169,255,.9)'; c.lineWidth = lw(2.5); c.setLineDash([lw(10), lw(7)]);
    c.beginPath(); c.moveTo(glass.a.x - g.x * 3000, glass.a.y - g.y * 3000); c.lineTo(glass.a.x + g.x * 3000, glass.a.y + g.y * 3000); c.stroke(); c.setLineDash([]);
  }
  // centre cross: the glass line should pass through it
  if (!S.bg.ready) { c.strokeStyle = 'rgba(255,255,255,.5)'; c.lineWidth = lw(2); const cx = S.W / 2, cy = S.H / 2, r = lw(18);
    c.beginPath(); c.moveTo(cx - r, cy); c.lineTo(cx + r, cy); c.moveTo(cx, cy - r); c.lineTo(cx, cy + r); c.stroke(); }
  const m = S.cal ? (S.model || (S.model = T.buildModel(S.cal))) : null;
  if (m && S.raw && S.bg.ready) {
    const a = S.ok ? 1 : 0.4;
    const bar = (p, dir, L, r, col) => {
      c.globalAlpha = 0.28 * a; c.strokeStyle = col; c.lineWidth = 2 * r; c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x + dir.x * L, p.y + dir.y * L); c.stroke();
      c.globalAlpha = a; c.lineWidth = lw(3); c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x + dir.x * L, p.y + dir.y * L); c.stroke(); c.globalAlpha = 1;
    };
    bar(m.pip, m.g, m.Lm, m.r, '#c9ced6');
    bar(m.pip, T.segDir(m, 'prox', S.raw.thp), m.Lp, m.rp, '#4a86e8');
    bar(m.dip, T.segDir(m, 'dist', S.raw.thd), m.Ld, m.rd, '#f0953a');
    const V = T.virtualInImage(m, S.filt?.thp ?? S.raw.thp, S.filt?.thd ?? S.raw.thd);
    c.globalAlpha = a; c.setLineDash([lw(10), lw(7)]); c.lineWidth = lw(4);
    c.strokeStyle = '#4a86e8'; c.beginPath(); c.moveTo(V.pip.x, V.pip.y); c.lineTo(V.vdip.x, V.vdip.y); c.stroke();
    c.strokeStyle = '#f0953a'; c.beginPath(); c.moveTo(V.vdip.x, V.vdip.y); c.lineTo(V.vtip.x, V.vtip.y); c.stroke();
    c.setLineDash([]); c.globalAlpha = 1;
    c.fillStyle = '#ff4d4d'; c.beginPath(); c.arc(m.pip.x, m.pip.y, lw(6), 0, 7); c.fill();
    c.fillStyle = '#f0953a'; c.beginPath(); c.arc(m.dip.x, m.dip.y, lw(5), 0, 7); c.fill();
  }
  if (S.adjust) for (const h of handles()) {
    c.strokeStyle = h.col; c.lineWidth = lw(3); c.beginPath(); c.arc(h.p.x, h.p.y, lw(16), 0, 7); c.stroke();
    c.fillStyle = h.col; c.beginPath(); c.arc(h.p.x, h.p.y, lw(5), 0, 7); c.fill();
  }
  $('#msg').textContent = !link?.connected ? 'iPadに接続中…' : S.bgBusy ? '背景を撮影中' : S.jt ? '指を合わせ中' : S.cal ? (S.ok ? '計測中' : '指を見失っています') : 'iPadの指示に従ってください';
  $('#meta').textContent = `${S.fps} fps・処理 ${S.procMs.toFixed(1)} ms`;
  $('#linkDot').className = 'dot ' + (link?.connected ? 'ok' : 'warn');
}
function handles() {
  const h = [];
  if (S.glass) h.push({ k: 'ga', p: S.glass.a, col: '#ffffff' }, { k: 'gb', p: S.glass.b, col: '#ffffff' });
  if (S.cal) h.push({ k: 'pip', p: S.cal.pipC, col: '#ff4d4d' }, { k: 'dip', p: S.cal.dipC, col: '#f0953a' });
  return h;
}

// ---------------- messages from the iPad ----------------
function sendStatus(force) {
  if (!link?.connected) return;
  link.send({ type: 'status', stage: S.stage, fps: S.fps, proc: +S.procMs.toFixed(1), W: S.W, H: S.H, busy: S.bgBusy || !!S.jt,
    glassFound: !!(S.glass || S.glassCand), below: S.below / (S.H || 1), bg: S.bg.ready, cal: !!S.cal, still: S.stillN > 20, adjust: S.adjust,
    res: S.cal ? Math.atan(1 / (0.55 * (S.model || T.buildModel(S.cal)).Lp)) * 180 / Math.PI : null, sim: SIM });
}
const wait = (ms) => new Promise(r => setTimeout(r, ms));
async function onData(m) {
  if (m.type === 'ping') { link.send({ type: 'pong', t0: m.t0, t1: performance.now() }); return; }
  if (m.type === 'drag') return onDrag(m);
  if (m.type !== 'cmd') return;
  switch (m.name) {
    case 'bg': captureBackground(); break;
    case 'joints': if (!S.bg.ready) { ack('joints', false, '背景がありません'); break; } startJoints(); break;
    case 'go': if (sim) sim.state.manual = null; break;
    case 'reset': S.stage = 'idle'; S.bg.reset(); S.cal = null; S.model = null; S.glass = null; S.jt = null; S.raw = null; S.filt = null; S.ok = false; if (sim) { sim.state.handIn = false; sim.state.manual = null; } break;
    case 'adjust': S.adjust = !!m.on; break;
    case 'preview': S.preview = !!m.on; break;
    case 'lat': S.lat = !!m.on; S.latLo = 255; S.latHi = 0; S.latWhite = null; if (sim) sim.state.flash = m.on ? false : null; break;
    case 'simflash': if (sim && S.lat) sim.state.flash = !!m.white; break;
    case 'jitter': {
      if (sim) sim.state.manual = { thp: 80, thd: 30 };
      await wait(300); S.collect = []; await wait(3000); const rows = S.collect.filter(r => r.ok); S.collect = null;
      if (sim) sim.state.manual = null;
      const sd = (a) => { const mu = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - mu) ** 2, 0) / a.length); };
      link.send(rows.length < 10 ? { type: 'result', kind: 'jitter', error: '指を見失っていて測れませんでした' } : { type: 'result', kind: 'jitter', p: sd(rows.map(r => r.thp)), d: sd(rows.map(r => r.thd)), n: rows.length });
      break;
    }
    case 'template': {
      if (sim) { sim.state.manual = { thp: m.thp, thd: m.thd }; await wait(300); }
      const keep = S.cal, f = fullField(), prop = T.proposeJoints(f, S.glass);
      if (!prop) { link.send({ type: 'result', kind: 'template', id: m.id, error: '型紙が見つかりません' }); if (sim) sim.state.manual = null; break; }
      const ref = T.refineJoints(f, { glass: S.glass, pipC: prop.pipC, dipC: prop.dipC, T: prop.T, side: prop.side });
      ref.T = T.measureThickness(f, ref.glass, ref.pipC, ref.dipC, ref.side) || prop.T;
      S.cal = ref; S.model = null; S.prev = {}; await wait(200);
      S.collect = []; await wait(1500); const rows = S.collect.filter(r => r.ok); S.collect = null;
      S.cal = keep; S.model = null; S.prev = {}; if (sim) sim.state.manual = null;
      const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
      link.send(rows.length < 5 ? { type: 'result', kind: 'template', id: m.id, error: '型紙の輪郭がとれませんでした' } : { type: 'result', kind: 'template', id: m.id, mp: mean(rows.map(r => r.thp)), md: mean(rows.map(r => r.thd)) });
      break;
    }
  }
  sendStatus();
}
function onDrag(m) {
  if (!S.adjust) return;
  const p = { x: m.x * S.W, y: m.y * S.H };
  if (m.phase === 'down') { const h = handles().find(h => Math.hypot(h.p.x - p.x, h.p.y - p.y) < 0.05 * S.W); S.drag = h?.k || null; return; }
  if (m.phase === 'up') { S.drag = null; return; }
  if (!S.drag) return;
  if (S.drag === 'ga' || S.drag === 'gb') {
    S.glass[S.drag === 'ga' ? 'a' : 'b'] = p;
    if (S.cal) { S.cal.glass = S.glass; S.cal.pipC = T.projectOnLine(S.cal.pipC, S.glass); S.cal.dipC = T.projectOnLine(S.cal.dipC, S.glass); }
  } else if (S.cal) {
    const q = T.projectOnLine(p, S.cal.glass); if (S.drag === 'pip') S.cal.pipC = q; else S.cal.dipC = q;
  }
  S.model = null; S.prev = {};
}
// latency test: report each bright/dark transition of the frame centre (the iPad converts clocks)
function latencyFrame() {
  const c = S.center; S.latLo = Math.min(S.latLo * 0.99 + c * 0.01, c); S.latHi = Math.max(S.latHi * 0.99 + c * 0.01, c);
  if (S.latHi - S.latLo < 25) return;
  const white = c > (S.latLo + S.latHi) / 2;
  if (S.latWhite !== null && white !== S.latWhite) link?.send({ type: 'lat-edge', t: performance.now(), white });
  S.latWhite = white;
}
window.phone = { S, get sim() { return sim; } };
