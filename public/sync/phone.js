// 横カメラ（iPhone, PWA）. Steps are driven by the iPad:
//  cal    : the iPad lights dots one by one -> camera pose relative to the iPad screen
//  bg     : background of the bending plane (rectified view)
//  joints : PIP is on the ring; refine PIP/DIP and confirm
// Then every frame: rectify the bending plane, fit the 2-link model, send theta_p / theta_d.
// Camera frames stay on the devices; the preview video goes only to the iPad / the PC monitor.
import * as T from './tracker.js';
import * as G from './geom.js';
import { client, peerIdOf } from './link.js';

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
const SIM = params.has('sim');
const STORE = 'syncPhone.v1';
let saved = {}; try { saved = JSON.parse(localStorage.getItem(STORE) || '{}'); } catch {}

const S = {
  stage: 'idle', W: 0, H: 0, video: null, fps: 0, frameTimes: [], procMs: 0, stillN: 0, prevSmall: null,
  screen: null, pose: null, rect: null, calInfo: null, showGrid: false,
  bg: new T.Background(), bgBusy: false, bgFrames: 0, bgRef: null,
  cal: null, model: null, jt: null, raw: null, filt: null, ok: false, prev: {},
  fP: new T.OneEuro(1.2, 0.25), fD: new T.OneEuro(1.2, 0.25), Lm: 25, dia: 15,
  collect: null, lat: false, latLo: 255, latHi: 0, latWhite: null, waiters: [],
};
let link = null, sim = null;
const work = document.createElement('canvas'), wctx = work.getContext('2d', { willReadFrequently: true });
const small = document.createElement('canvas'); small.width = 160; small.height = 90; const sctx = small.getContext('2d', { willReadFrequently: true });
const view = $('#view'), vctx = view.getContext('2d');
const prev = document.createElement('canvas'); prev.width = 960; prev.height = 540; const pctx = prev.getContext('2d');
let rectBuf = null, rectCtx = null;

// ---------------- start ----------------
const codeIn = $('#code');
codeIn.value = (params.get('room') || saved.room || '').toUpperCase();
$('#go').onclick = start;
if (SIM && codeIn.value) setTimeout(start, 50);
async function start() {
  const room = codeIn.value.trim().toUpperCase();
  if (room.length !== 4) { $('#startErr').textContent = 'iPadに出ている4文字を入れてください'; return; }
  saved.room = room; try { localStorage.setItem(STORE, JSON.stringify(saved)); } catch {}
  try {
    let stream;
    if (SIM) { const { createSim3D } = await import('./sim3d.js'); sim = await createSim3D(); stream = sim.stream; }
    else stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 } }, audio: false });
    const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.setAttribute('playsinline', ''); v.srcObject = stream; await v.play();
    S.video = v; resize();
    $('#start').style.display = 'none';
    try { await navigator.wakeLock?.request('screen'); } catch {}
    link = await client(room, { onOpen: () => { link.call(peerIdOf(room)); sendStatus(); }, onData, onClose: () => {}, onError: () => {}, onState: (t) => { S.linkState = t; } }, 'phone');
    link.setStream(prev.captureStream(15));
    v.requestVideoFrameCallback(onFrame);
  } catch (e) { $('#startErr').textContent = `開始できません：${e.message || e}`; }
}
function resize() {
  const v = S.video;
  if (v.videoWidth !== S.W || v.videoHeight !== S.H) { S.W = v.videoWidth; S.H = v.videoHeight; work.width = view.width = S.W; work.height = view.height = S.H; S.pose = null; S.rect = null; S.bg.reset(); S.cal = null; }
}

// ---------------- frame loop ----------------
let n = 0;
function onFrame(now) {
  resize();
  S.frameTimes.push(now); while (now - S.frameTimes[0] > 1000) S.frameTimes.shift(); S.fps = S.frameTimes.length;
  const t0 = performance.now();
  wctx.drawImage(S.video, 0, 0, S.W, S.H); n++;
  stats();
  for (const w of S.waiters.splice(0)) w(); // calibration steps wait on frames
  if (S.bgBusy) bgFrame();
  if (S.rect && S.bg.ready && S.cal) trackFrame(now);
  if (S.jt && n % 3 === 0) jointTry();
  S.procMs = performance.now() - t0;
  if (S.raw && link?.connected) link.send({ type: 'pose', t: now, thp: S.raw.thp, thd: S.raw.thd, fthp: S.filt?.thp ?? null, fthd: S.filt?.thd ?? null, ok: S.ok, sp: +S.raw.scoreP.toFixed(3), sd: +S.raw.scoreD.toFixed(3), proc: +S.procMs.toFixed(1) });
  if (S.collect && S.raw) S.collect.push({ thp: S.raw.thp, thd: S.raw.thd, ok: S.ok });
  if (S.lat) latencyFrame();
  if (n % 2 === 0) drawPreview();
  if (n % 8 === 0) sendStatus();
  S.video.requestVideoFrameCallback(onFrame);
}
const nextFrames = (k) => new Promise((res) => { let c = 0; const f = () => { if (++c >= k) res(); else S.waiters.push(f); }; S.waiters.push(f); });
function stats() {
  sctx.drawImage(S.video, 0, 0, 160, 90);
  const d = sctx.getImageData(0, 0, 160, 90).data, L = new Float32Array(160 * 90);
  let diff = 0, c = 0, cn = 0;
  for (let i = 0, k = 0; k < L.length; i += 4, k++) { L[k] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; if (S.prevSmall) diff += Math.abs(L[k] - S.prevSmall[k]); }
  for (let y = 30; y < 60; y++) for (let x = 50; x < 110; x++) { c += L[y * 160 + x]; cn++; }
  S.center = c / cn; S.diff = S.prevSmall ? diff / L.length : 99; S.prevSmall = L;
  S.stillN = S.diff < 2 ? S.stillN + 1 : 0;
}
const ack = (what, ok, msg, info) => link?.send({ type: 'ack', what, ok, msg, info });

// ---------------- 1. calibration: camera pose from dots on the iPad ----------------
let showWait = null;
function show(state) { // ask the iPad to show something; resolves when it says it is on screen
  if (sim) sim.setScreen(state);
  return new Promise((res) => { showWait = res; link.send({ type: 'show', ...state }); setTimeout(() => { if (showWait === res) { showWait = null; res(); } }, 1500); });
}
function lumaFull() { const d = wctx.getImageData(0, 0, S.W, S.H).data, L = new Float32Array(S.W * S.H); for (let i = 0, k = 0; k < L.length; i += 4, k++) L[k] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; return L; }
async function avgLuma(k) { let acc = null; for (let i = 0; i < k; i++) { await nextFrames(1); const L = lumaFull(); if (!acc) acc = L; else for (let j = 0; j < L.length; j++) acc[j] += L[j]; } for (let j = 0; j < acc.length; j++) acc[j] /= k; return acc; }
async function calibrate(m) {
  S.screen = m; S.stage = 'cal'; S.pose = null; S.rect = null; S.bg.reset(); S.cal = null; S.raw = null; S.ok = false; S.showGrid = false;
  if (sim) { sim.state.handIn = false; }
  const dots = G.dotLayout(m.Wmm, m.Hmm, m.pip);
  await show({ kind: 'black' }); await nextFrames(6);
  const off = await avgLuma(3), src = [], dst = [];
  for (let i = 0; i < dots.length; i++) {
    await show({ kind: 'dot', i, x: dots[i].x, y: dots[i].y }); await nextFrames(4);
    const on = await avgLuma(2), p = G.findDot(on, off, S.W, S.H);
    if (p) { src.push(dots[i]); dst.push(p); }
  }
  await show({ kind: 'grid' });
  if (src.length < 6) { S.stage = 'idle'; ack('cal', false, `点が ${src.length}/${dots.length} 個しか見えません。iPhoneを ○ の方へ向けてください`); return; }
  const pose = G.estimatePose(src, dst, S.W, S.H);
  if (!pose || pose.rms > 4) { S.stage = 'idle'; ack('cal', false, `計算が合いません（ずれ ${pose ? pose.rms.toFixed(1) : '?'} px）`); return; }
  S.pose = pose; S.showGrid = true;
  S.rect = G.makeRect(pose, m.pip.x, m.pip.y);
  rectBuf = new ImageData(S.rect.W, S.rect.H);
  const C = pose.C, dx = C[0] - m.pip.x, dy = C[1] - m.pip.y, dist = Math.hypot(dx, dy, C[2]);
  S.calInfo = { rms: pose.rms, n: src.length, of: dots.length, fW: pose.f / S.W, dist, C, elev: Math.atan2(C[2], Math.hypot(dx, dy)) * 180 / Math.PI, side: Math.atan2(Math.abs(dy), Math.abs(dx)) * 180 / Math.PI, scale: S.rect.s };
  S.stage = 'calibrated';
  ack('cal', true, '', S.calInfo);
}

// ---------------- 2. background of the rectified bending plane ----------------
function rectFull() { const fr = wctx.getImageData(0, 0, S.W, S.H); return G.warp(S.rect, fr, 0, 0, S.rect.W, S.rect.H, rectBuf); }
function captureBackground() {
  if (!S.rect) { ack('bg', false, '先にiPadの位置を測ってください'); return; }
  S.showGrid = false; S.bgBusy = true; S.bg.reset(); S.bgFrames = -6; S.bgRef = null; S.cal = null; S.model = null; S.raw = null; S.ok = false;
  if (sim) { sim.state.handIn = false; sim.setScreen({ kind: 'scene' }); }
}
function bgFrame() {
  if (S.bgFrames < 0) { S.bgFrames++; return; }
  if (!S.bgRef) S.bgRef = S.prevSmall.slice();
  else { let d = 0; for (let k = 0; k < S.bgRef.length; k++) d += Math.abs(S.prevSmall[k] - S.bgRef[k]); if (d / S.bgRef.length > 6) { S.bgBusy = false; S.bg.reset(); ack('bg', false, '動きがありました'); return; } }
  S.bg.add(rectFull()); S.bgFrames++;
  if (S.bgFrames >= 30) {
    S.bg.finish(); S.bgBusy = false; S.stage = 'bg'; ack('bg', true, '');
    if (sim) setTimeout(() => { sim.state.handIn = true; sim.state.manual = { thp: 70, thd: 45 }; }, 300);
  }
}

// ---------------- 3. joints: the PIP is on the ring; refine both joints ----------------
function rectCalInit() {
  const R = S.rect, vg = R.vGlass;
  return { glass: { a: { x: 0, y: vg }, b: { x: R.W, y: vg } }, side: -1,
    pipC: { x: R.uPip, y: vg }, dipC: { x: R.uPip + S.Lm * R.s, y: vg }, T: S.dia * R.s };
}
function fgFull() { return T.foreground(rectFull(), { x0: 0, y0: 0, w: S.rect.W, h: S.rect.H }, S.bg); }
function startJoints() { S.jt = { n: 0, last: null, good: 0, why: '指が見えません' }; S.cal = rectCalInit(); S.model = null; S.prev = {}; S.raw = null; S.ok = false; }
function jointTry() {
  const J = S.jt; J.n++;
  const f = fgFull();
  const ref = T.refineJoints(f, rectCalInit()); // always start from the ring, so repeated tries cannot drift
  const Tm = T.measureThickness(f, ref.glass, ref.pipC, ref.dipC, ref.side, S.dia * S.rect.s); if (Tm > 0.6 * S.dia * S.rect.s && Tm < 1.5 * S.dia * S.rect.s) ref.T = Tm;
  const moved = J.last ? Math.max(T.vec.len(T.vec.sub(ref.pipC, J.last.pipC)), T.vec.len(T.vec.sub(ref.dipC, J.last.dipC))) : 99;
  J.last = ref; S.cal = ref; S.model = null;
  const bent = S.raw && S.raw.thd >= 12 && S.raw.thp > 25 && S.raw.thp < 160;
  J.why = !S.raw ? '指が見えません' : !bent ? '関節の曲げが足りません' : !S.ok ? '指の形が合いません' : moved >= 3 ? '指が動いています' : '';
  J.good = !J.why ? J.good + 1 : 0;
  if (J.good >= 3) { S.jt = null; S.stage = 'ready'; S.fP.reset(); S.fD.reset(); ack('joints', true, '', { pipOffsetMm: (ref.pipC.x - S.rect.uPip) / S.rect.s, LmMm: (ref.dipC.x - ref.pipC.x) / S.rect.s, diaMm: ref.T / S.rect.s }); return; }
  if (J.n >= 30) { S.jt = null; if (!S.ok) S.cal = null; ack('joints', false, J.why); }
}

// ---------------- tracking ----------------
function trackFrame(now) {
  if (!S.model) S.model = T.buildModel(S.cal);
  const m = S.model, roi = T.roiFor(m, S.rect.W, S.rect.H);
  if (!S.roiBuf || S.roiBuf.width !== roi.w || S.roiBuf.height !== roi.h) S.roiBuf = new ImageData(roi.w, roi.h);
  const fr = wctx.getImageData(0, 0, S.W, S.H);
  G.warp(S.rect, fr, roi.x0, roi.y0, roi.w, roi.h, S.roiBuf);
  const f = T.foreground(S.roiBuf, roi, S.bg);
  const r = T.track(f, m, S.prev);
  const okP = r.scoreP > T.SCORE_OK, okD = r.scoreD > T.SCORE_OK;
  S.prev = { thp: r.thp, thd: r.thd, okP, okD }; S.raw = r; S.ok = okP && okD;
  if (S.ok) S.filt = { thp: S.fP.filter(r.thp, now), thd: S.fD.filter(r.thd, now) };
}

// ---------------- preview (camera + estimate) for the iPad and the PC ----------------
function drawPreview() {
  const k = prev.width / S.W, c = pctx;
  c.drawImage(work, 0, 0, prev.width, prev.height);
  const P = (q) => q && { x: q.x * k, y: q.y * k };
  const line = (a, b, col, w = 2) => { if (!a || !b) return; c.strokeStyle = col; c.lineWidth = w; c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke(); };
  if (S.pose && S.screen) {
    const pr = (x, y) => P(G.project(S.pose, [x, y, 0])), Wm = S.screen.Wmm / 2, Hm = S.screen.Hmm / 2;
    if (S.showGrid) {
      for (let x = -100; x <= 100; x += 20) line(pr(x, -Hm), pr(x, Hm), 'rgba(255,0,200,.85)', 1.5);
      for (let y = -60; y <= 60; y += 20) line(pr(-Wm, y), pr(Wm, y), 'rgba(255,0,200,.85)', 1.5);
    }
    [[-Wm, -Hm, Wm, -Hm], [Wm, -Hm, Wm, Hm], [Wm, Hm, -Wm, Hm], [-Wm, Hm, -Wm, -Hm]].forEach(([a, b, d, e]) => line(pr(a, b), pr(d, e), '#3ee', 2.5));
    const ring = []; for (let i = 0; i <= 32; i++) { const t = i / 32 * Math.PI * 2; ring.push(pr(S.screen.pip.x + 10 * Math.cos(t), S.screen.pip.y + 10 * Math.sin(t))); }
    c.strokeStyle = '#ff4d4d'; c.lineWidth = 2.5; c.beginPath(); ring.forEach((p, i) => p && (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y))); c.stroke();
  }
  if (S.rect && S.cal && S.raw && S.bg.ready) { // bars of the fitted model, mapped back from the bending plane
    const m = S.model || T.buildModel(S.cal), I = (q) => P(S.rect.toImage(q.x, q.y)), a = S.ok ? 1 : 0.4;
    const seg = (p, d, L, col) => { c.globalAlpha = a; line(I(p), I({ x: p.x + d.x * L, y: p.y + d.y * L }), col, 4); c.globalAlpha = 1; };
    seg(m.pip, m.g, m.Lm, '#c9ced6'); seg(m.pip, T.segDir(m, 'prox', S.raw.thp), m.Lp, '#4a86e8'); seg(m.dip, T.segDir(m, 'dist', S.raw.thd), m.Ld, '#f0953a');
  }
  // inset: the rectified bending plane (what the fit actually sees)
  if (S.rect && rectBuf && n % 4 === 0 && !S.bgBusy) {
    if (!rectCtx) { const cv = document.createElement('canvas'); rectCtx = cv.getContext('2d'); }
    const cv = rectCtx.canvas; if (cv.width !== S.rect.W) { cv.width = S.rect.W; cv.height = S.rect.H; }
    rectCtx.putImageData(rectFull(), 0, 0); drawRectOverlay(rectCtx);
  }
  if (rectCtx && S.rect) { const w = 300, h = w * S.rect.H / S.rect.W; c.drawImage(rectCtx.canvas, prev.width - w - 8, 8, w, h); c.strokeStyle = '#fff'; c.lineWidth = 1; c.strokeRect(prev.width - w - 8, 8, w, h); }
  vctx.drawImage(prev, 0, 0, view.width, view.height);
  $('#msg').textContent = !link?.connected ? (S.linkState || 'iPadに接続中…') : S.stage === 'cal' ? 'iPadの位置を測っています' : S.bgBusy ? '背景を撮影中' : S.jt ? '指を合わせ中' : S.cal && S.bg.ready ? (S.ok ? '計測中' : '指を見失っています') : 'iPadの指示に従ってください';
  $('#meta').textContent = `${S.fps} fps・処理 ${S.procMs.toFixed(1)} ms`;
  $('#linkDot').className = 'dot ' + (link?.connected ? 'ok' : 'warn');
}
function drawRectOverlay(c) {
  const R = S.rect; c.strokeStyle = 'rgba(255,255,255,.8)'; c.setLineDash([8, 6]); c.lineWidth = 2;
  c.beginPath(); c.moveTo(0, R.vGlass); c.lineTo(R.W, R.vGlass); c.stroke(); c.setLineDash([]);
  if (S.cal && S.raw) {
    const m = S.model || T.buildModel(S.cal), a = S.ok ? 1 : 0.4;
    const bar = (p, d, L, r, col) => { c.globalAlpha = 0.3 * a; c.strokeStyle = col; c.lineCap = 'round'; c.lineWidth = 2 * r; c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x + d.x * L, p.y + d.y * L); c.stroke(); c.globalAlpha = a; c.lineWidth = 3; c.stroke(); c.globalAlpha = 1; };
    bar(m.pip, m.g, m.Lm, m.r, '#c9ced6'); bar(m.pip, T.segDir(m, 'prox', S.raw.thp), m.Lp, m.rp, '#4a86e8'); bar(m.dip, T.segDir(m, 'dist', S.raw.thd), m.Ld, m.rd, '#f0953a');
    const V = T.virtualInImage(m, S.filt?.thp ?? S.raw.thp, S.filt?.thd ?? S.raw.thd);
    c.setLineDash([8, 6]); c.lineWidth = 3; c.strokeStyle = '#4a86e8'; c.beginPath(); c.moveTo(V.pip.x, V.pip.y); c.lineTo(V.vdip.x, V.vdip.y); c.stroke();
    c.strokeStyle = '#f0953a'; c.beginPath(); c.moveTo(V.vdip.x, V.vdip.y); c.lineTo(V.vtip.x, V.vtip.y); c.stroke(); c.setLineDash([]);
  }
  c.fillStyle = '#ff4d4d'; c.beginPath(); c.arc(R.uPip, R.vGlass, 5, 0, 7); c.fill();
}

// ---------------- messages ----------------
function sendStatus() {
  if (!link?.connected) return;
  link.send({ type: 'status', stage: S.stage, fps: S.fps, proc: +S.procMs.toFixed(1), W: S.W, H: S.H, busy: S.bgBusy || !!S.jt || S.stage === 'cal',
    calibrated: !!S.pose, bg: S.bg.ready, cal: !!S.cal, calInfo: S.calInfo, sim: SIM,
    res: S.cal && S.rect ? Math.atan(1 / (0.55 * (S.model || T.buildModel(S.cal)).Lp)) * 180 / Math.PI : null });
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function onData(m) {
  if (m.type === 'ping') { link.send({ type: 'pong', t0: m.t0, t1: performance.now() }); return; }
  if (m.type === 'shown') { const w = showWait; showWait = null; w?.(); return; }
  if (m.type === 'monitor') { link.call(m.id); return; }
  if (m.type === 'finger') { S.Lm = m.Lm; S.dia = m.dia; return; }
  if (m.type !== 'cmd') return;
  switch (m.name) {
    case 'cal': calibrate(m); break;
    case 'bg': captureBackground(); break;
    case 'joints': if (!S.bg.ready) { ack('joints', false, '背景がありません'); break; } startJoints(); break;
    case 'go': if (sim) sim.state.manual = null; break;
    case 'lat': S.lat = !!m.on; S.latLo = 255; S.latHi = 0; S.latWhite = null; break;
    case 'jitter': {
      if (sim) sim.state.manual = { thp: 80, thd: 30 };
      await wait(300); S.collect = []; await wait(3000); const rows = S.collect.filter((r) => r.ok); S.collect = null;
      if (sim) sim.state.manual = null;
      const sd = (a) => { const mu = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - mu) ** 2, 0) / a.length); };
      link.send(rows.length < 10 ? { type: 'result', kind: 'jitter', error: '指を見失っていて測れませんでした' } : { type: 'result', kind: 'jitter', p: sd(rows.map((r) => r.thp)), d: sd(rows.map((r) => r.thd)), n: rows.length });
      break;
    }
  }
  sendStatus();
}
function latencyFrame() {
  const c = S.center; S.latLo = Math.min(S.latLo * 0.99 + c * 0.01, c); S.latHi = Math.max(S.latHi * 0.99 + c * 0.01, c);
  if (S.latHi - S.latLo < 25) return;
  const white = c > (S.latLo + S.latHi) / 2;
  if (S.latWhite !== null && white !== S.latWhite) link?.send({ type: 'lat-edge', t: performance.now(), white });
  S.latWhite = white;
}
window.phone = { S, get sim() { return sim; } };
