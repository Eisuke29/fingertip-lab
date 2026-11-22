// 横カメラ（iPhone）. The PC control page drives the steps; this page measures and draws the guidance
// (targets + current state) onto the preview that the PC shows.
//  cal    : the iPad lights dots one by one -> camera pose relative to the iPad screen
//  bg     : background of the bending plane (rectified view)
//  joints : PIP is on the ring; refine PIP/DIP and confirm
// Every frame afterwards: rectify the bending plane, fit the 2-link model, send theta_p / theta_d.
import * as T from './tracker.js';
import * as G from './geom.js';
import { connect } from './wslink.js';
import { blinkBlob } from './ring.js';

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
const SIM = params.has('sim');
const STORE = 'syncPhone.v1';
let saved = {}; try { saved = JSON.parse(localStorage.getItem(STORE) || '{}'); } catch {}

const S = {
  step: 1, W: 0, H: 0, video: null, fps: 0, frameTimes: [], procMs: 0, stillN: 0, prevSmall: null, diff: 0,
  screen: null, pose: null, rect: null, calInfo: null, calPts: null, showGrid: false, ring: null,
  bg: new T.Background(), bgBusy: false, bgFrames: 0, bgRef: null, countdown: null,
  cal: null, model: null, jt: null, why: '', raw: null, filt: null, ok: false, prev: {},
  fP: new T.OneEuro(1.2, 0.25), fD: new T.OneEuro(1.2, 0.25), Lm: 25, dia: 15,
  collect: null, previewOn: true, presence: null, lat: false, latLo: 255, latHi: 0, latWhite: null, waiters: [], gravity: null,
};
let link = null, sim = null;
const work = document.createElement('canvas'), wctx = work.getContext('2d', { willReadFrequently: true });
const small = document.createElement('canvas'); small.width = 160; small.height = 90; const sctx = small.getContext('2d', { willReadFrequently: true });
const view = $('#view'), vctx = view.getContext('2d');
const prev = document.createElement('canvas'); prev.width = 960; prev.height = 540; const pctx = prev.getContext('2d');
let rectBuf = null, rectCtx = null;
const toMon = (m) => link?.send({ ...m, to: 'monitor' });

// ---------------- start ----------------
const addrIn = $('#addr');
addrIn.value = params.get('pc') || saved.addr || '';
const LOCAL = !/github\.io$/.test(location.hostname); // served by the PC's sync-server
if (LOCAL) { addrIn.value = 'local'; addrIn.hidden = true; document.querySelector('.lbl').hidden = true; }
$('#go').onclick = start;
if (SIM && addrIn.value) setTimeout(start, 50);
let started = false;
async function start() {
  if (started) return; // a second tap must not open a second connection
  started = true;
  const addr = addrIn.value.trim();
  if (!addr) { started = false; $('#startErr').textContent = 'PCのアドレスを入れてください'; return; }
  if (!LOCAL) saved.addr = addr; try { localStorage.setItem(STORE, JSON.stringify(saved)); } catch {}
  try {
    // motion sensor (for the tilt cross-check on the PC); iOS asks for permission on this tap
    try { if (typeof DeviceMotionEvent?.requestPermission === 'function') await DeviceMotionEvent.requestPermission(); } catch {}
    addEventListener('devicemotion', (e) => { const g = e.accelerationIncludingGravity; if (g && g.x != null) S.gravity = S.gravity ? S.gravity.map((v, i) => v * 0.9 + [g.x, g.y, g.z][i] * 0.1) : [g.x, g.y, g.z]; });
    let stream;
    if (SIM) { const { createSim3D } = await import('./sim3d.js'); sim = await createSim3D(); stream = sim.stream; sim.setScreen({ kind: 'scene' }); }
    else stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 } }, audio: false });
    const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.setAttribute('playsinline', ''); v.srcObject = stream; await v.play();
    S.video = v; resize();
    $('#start').style.display = 'none';
    try { await navigator.wakeLock?.request('screen'); } catch {}
    link = connect(addr, 'phone', { onOpen: () => sendStatus(), onData, onState: (t) => { S.linkState = t; }, onPresence: (p) => { S.presence = p; } });
    v.requestVideoFrameCallback(onFrame);
  } catch (e) { started = false; $('#startErr').textContent = `開始できません：${e.message || e}`; }
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
  if (S.raw && link?.connected) link.send({ type: 'pose', to: ['ipad', 'monitor'], t: now, thp: S.raw.thp, thd: S.raw.thd, fthp: S.filt?.thp ?? null, fthd: S.filt?.thd ?? null, ok: S.ok, sp: +S.raw.scoreP.toFixed(3), sd: +S.raw.scoreD.toFixed(3), proc: +S.procMs.toFixed(1) });
  if (S.collect && S.raw) S.collect.push({ thp: S.raw.thp, thd: S.raw.thd, ok: S.ok });
  if (S.lat) latencyFrame();
  if (n % 2 === 0) drawPreview();
  if (S.previewOn && n % 4 === 0) sendFrame();
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
// before the iPad position is measured: the iPad blinks a white disc at the ring; find it in the picture
let placing = false;
function lumaSmall() { const W = 320, H = Math.round(320 * S.H / S.W); sctx.canvas.width = W; sctx.canvas.height = H; sctx.drawImage(S.video, 0, 0, W, H); const d = sctx.getImageData(0, 0, W, H).data, L = new Float32Array(W * H); for (let i = 0, k = 0; k < L.length; i += 4, k++) L[k] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; sctx.canvas.width = 160; sctx.canvas.height = 90; return { L, W, H }; }
async function placementLoop() {
  if (placing) return; placing = true;
  while (S.step === 2 && !S.pose && !S.busy && link?.connected && S.presence?.ipad) {
    await show({ kind: 'black' }); await nextFrames(2); const off = lumaSmall();
    if (S.step !== 2 || S.busy) break;
    await show({ kind: 'dot', x: 0, y: 0, r: 10 }); await nextFrames(2); const on = lumaSmall();
    S.ring = blinkBlob(on.L, off.L, on.W, on.H); S.ringAt = performance.now();
  }
  if (S.step === 2 && !S.pose && !S.busy) await show({ kind: 'black' });
  placing = false;
}
const ack = (what, ok, msg, info) => toMon({ type: 'ack', what, ok, msg, info });

// ---------------- 1. calibration: camera pose from dots on the iPad ----------------
let showWait = null;
function show(state) { // ask the iPad to show something; resolves when it says it is on screen
  if (sim) sim.setScreen(state);
  return new Promise((res) => { showWait = res; link.send({ type: 'show', to: 'ipad', ...state }); setTimeout(() => { if (showWait === res) { showWait = null; res(); } }, 1500); });
}
function lumaFull() { const d = wctx.getImageData(0, 0, S.W, S.H).data, L = new Float32Array(S.W * S.H); for (let i = 0, k = 0; k < L.length; i += 4, k++) L[k] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; return L; }
async function avgLuma(k) { let acc = null; for (let i = 0; i < k; i++) { await nextFrames(1); const L = lumaFull(); if (!acc) acc = L; else for (let j = 0; j < L.length; j++) acc[j] += L[j]; } for (let j = 0; j < acc.length; j++) acc[j] /= k; return acc; }
async function calibrate(m) {
  S.busy = '点を測っています';
  while (placing) await nextFrames(1); // let the placement blinking stop first
  S.screen = m; S.pose = null; S.rect = null; S.bg.reset(); S.cal = null; S.raw = null; S.ok = false; S.showGrid = false; S.calPts = null;
  if (sim) sim.state.handIn = false;
  const dots = G.dotLayout(m.Wmm, m.Hmm, m.pip);
  await show({ kind: 'black' }); await nextFrames(6);
  const off = await avgLuma(3), src = [], dst = [];
  for (let i = 0; i < dots.length; i++) {
    S.busy = `点 ${i + 1}/${dots.length} を測っています`;
    await show({ kind: 'dot', i, x: dots[i].x, y: dots[i].y }); await nextFrames(4);
    const on = await avgLuma(2), p = G.findDot(on, off, S.W, S.H);
    if (p) { src.push(dots[i]); dst.push(p); }
  }
  await show({ kind: 'grid' }); S.busy = null;
  if (src.length < 6) { ack('cal', false, `点が ${src.length}/${dots.length} 個しか見えません`, { n: src.length, of: dots.length }); return; }
  const pose = G.estimatePose(src, dst, S.W, S.H);
  if (!pose || pose.rms > 4) { ack('cal', false, `点の位置が計算と合いません（ずれ ${pose ? pose.rms.toFixed(1) : '?'} 画素）`, { n: src.length, of: dots.length }); return; }
  S.pose = pose; S.showGrid = true;
  S.calPts = src.map((s, i) => ({ seen: dst[i], pred: G.project(pose, [s.x, s.y, 0]) }));
  S.rect = G.makeRect(pose, m.pip.x, m.pip.y);
  rectBuf = new ImageData(S.rect.W, S.rect.H);
  const C = pose.C, dx = C[0] - m.pip.x, dy = C[1] - m.pip.y, dist = Math.hypot(dx, dy, C[2]);
  // the bending-plane box must be inside the picture
  const corners = [[S.rect.y0, S.rect.z0], [S.rect.y1, S.rect.z0], [S.rect.y1, S.rect.z1], [S.rect.y0, S.rect.z1]].map(([y, z]) => G.project(pose, [m.pip.x, y, z]));
  const inside = corners.every((p) => p && p.x >= 0 && p.y >= 0 && p.x <= S.W && p.y <= S.H);
  S.calInfo = { rms: pose.rms, n: src.length, of: dots.length, fW: pose.f / S.W, dist, C, inside,
    elev: Math.atan2(C[2], Math.hypot(dx, dy)) * 180 / Math.PI, side: Math.atan2(Math.abs(dy), Math.abs(dx)) * 180 / Math.PI, scale: S.rect.s,
    tiltCam: tiltFromCamera(pose) };
  ack('cal', true, '', S.calInfo);
}
// tilt of the iPad screen from the table, using the iPhone's gravity in camera coordinates (reference only)
function tiltFromCamera(pose) {
  const g = S.gravity; if (!g) return null;
  const a = ((screen.orientation?.angle ?? window.orientation ?? 0) + 360) % 360;
  // device axes -> camera axes (x right, y down, z forward) for the back camera, by interface orientation
  const [x, y, z] = g, cam = a === 90 ? [-y, -x, -z] : a === 270 ? [y, x, -z] : a === 180 ? [-x, y, -z] : [x, -y, -z];
  const nrm = [pose.R[0][2], pose.R[1][2], pose.R[2][2]], gl = Math.hypot(...cam);
  const c = Math.abs(nrm[0] * cam[0] + nrm[1] * cam[1] + nrm[2] * cam[2]) / gl;
  return Math.acos(Math.min(1, c)) * 180 / Math.PI;
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
  else { let d = 0; for (let k = 0; k < S.bgRef.length; k++) d += Math.abs(S.prevSmall[k] - S.bgRef[k]); if (d / S.bgRef.length > 6) { S.bgBusy = false; S.bg.reset(); ack('bg', false, '撮っている間に映像が動きました'); return; } }
  S.bg.add(rectFull()); S.bgFrames++;
  if (S.bgFrames >= 30) {
    S.bg.finish(); S.bgBusy = false; ack('bg', true, '');
    if (sim) setTimeout(() => { sim.state.handIn = true; sim.state.manual = { thp: 70, thd: 45 }; }, 300);
  }
}

// ---------------- 3. joints: the PIP is on the ring; refine both joints (up to ~10 s) ----------------
function rectCalInit() {
  const R = S.rect, vg = R.vGlass;
  return { glass: { a: { x: 0, y: vg }, b: { x: R.W, y: vg } }, side: -1,
    pipC: { x: R.uPip, y: vg }, dipC: { x: R.uPip + S.Lm * R.s, y: vg }, T: S.dia * R.s };
}
function fgFull() { return T.foreground(rectFull(), { x0: 0, y0: 0, w: S.rect.W, h: S.rect.H }, S.bg); }
function startJoints() { S.jt = { n: 0, last: null, good: 0 }; S.why = ''; S.cal = rectCalInit(); S.model = null; S.prev = {}; S.raw = null; S.ok = false; }
function jointTry() {
  const J = S.jt; J.n++;
  const f = fgFull();
  const ref = T.refineJoints(f, rectCalInit()); // always start from the ring, so repeated tries cannot drift
  const Tm = T.measureThickness(f, ref.glass, ref.pipC, ref.dipC, ref.side, S.dia * S.rect.s); if (Tm > 0.6 * S.dia * S.rect.s && Tm < 1.5 * S.dia * S.rect.s) ref.T = Tm;
  const moved = J.last ? Math.max(T.vec.len(T.vec.sub(ref.pipC, J.last.pipC)), T.vec.len(T.vec.sub(ref.dipC, J.last.dipC))) : 99;
  J.last = ref; S.cal = ref; S.model = null;
  const bent = S.raw && S.raw.thd >= 12 && S.raw.thp > 25 && S.raw.thp < 160;
  S.why = !S.raw || Math.max(S.raw.scoreP, S.raw.scoreD) < 0.4 ? '指が見えません' : !bent ? '第1関節の曲げが足りません' : !S.ok ? '指の形が合いません' : moved >= 3 ? '指が動いています' : '';
  J.good = !S.why ? J.good + 1 : 0;
  if (J.good >= 3) { S.jt = null; S.fP.reset(); S.fD.reset(); ack('joints', true, '', { pipOffsetMm: (ref.pipC.x - S.rect.uPip) / S.rect.s, LmMm: (ref.dipC.x - ref.pipC.x) / S.rect.s, diaMm: ref.T / S.rect.s }); return; }
  if (J.n >= 100) { S.jt = null; if (!S.ok) S.cal = null; ack('joints', false, S.why); }
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

// ---------------- preview: camera + targets + current state, per step ----------------
const OK = '#3ecf8e', NG = '#ff6b6b', WARN = '#f5b84b', TGT = '#ffd84a';
function label(c, x, y, text, col = '#fff', size = 20, align = 'left') {
  c.font = `bold ${size}px system-ui, "Hiragino Sans", sans-serif`; c.textAlign = align; c.textBaseline = 'top';
  const w = c.measureText(text).width, bx = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  c.fillStyle = 'rgba(0,0,0,.72)'; c.fillRect(bx - 8, y - 5, w + 16, size + 10); c.fillStyle = col; c.fillText(text, x, y);
}
function arrow(c, a, b, col) {
  c.strokeStyle = col; c.fillStyle = col; c.lineWidth = 4; c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
  const an = Math.atan2(b.y - a.y, b.x - a.x); c.beginPath(); c.moveTo(b.x, b.y); c.lineTo(b.x - 16 * Math.cos(an - 0.45), b.y - 16 * Math.sin(an - 0.45)); c.lineTo(b.x - 16 * Math.cos(an + 0.45), b.y - 16 * Math.sin(an + 0.45)); c.closePath(); c.fill();
}
function drawPreview() {
  const k = prev.width / S.W, c = pctx, PW = prev.width, PH = prev.height;
  c.drawImage(work, 0, 0, PW, PH); c.lineCap = 'round';
  const P = (q) => q && { x: q.x * k, y: q.y * k };
  const line = (a, b, col, w = 2) => { if (!a || !b) return; c.strokeStyle = col; c.lineWidth = w; c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke(); };
  const pr = S.pose && S.screen ? (x, y, z = 0) => P(G.project(S.pose, [x, y, z])) : null;
  const lines = []; // status lines (text, colour) drawn bottom-left
  // ---- before the iPad position is known: guide the placement with the red ring
  if (!S.pose) {
    // target zone for the ring: centre horizontally, lower half (the finger rises above it)
    const zx0 = 0.3 * PW, zx1 = 0.7 * PW, zy0 = 0.5 * PH, zy1 = 0.82 * PH;
    c.setLineDash([10, 8]); c.strokeStyle = TGT; c.lineWidth = 2; c.strokeRect(zx0, zy0, zx1 - zx0, zy1 - zy0); c.setLineDash([]);
    label(c, zx0, zy0 - 30, '目標：○ がこの枠に入る', TGT, 18);
    if (S.ring && performance.now() - (S.ringAt || 0) < 1500) {
      const rx = S.ring.x * PW, ry = S.ring.y * PH, inside = rx > zx0 && rx < zx1 && ry > zy0 && ry < zy1;
      c.strokeStyle = inside ? OK : NG; c.lineWidth = 3; c.beginPath(); c.arc(rx, ry, Math.max(14, S.ring.w * PW / 2 + 6), 0, 7); c.stroke();
      if (!inside) {
        const tx = Math.min(Math.max(rx, zx0 + 20), zx1 - 20), ty = Math.min(Math.max(ry, zy0 + 20), zy1 - 20);
        const hx = rx < zx0 ? 'iPhoneを少し左に向ける' : rx > zx1 ? 'iPhoneを少し右に向ける' : '', hy = ry < zy0 ? 'iPhoneを少し上に向ける' : ry > zy1 ? 'iPhoneを少し下に向ける' : '';
        arrow(c, { x: rx, y: ry }, { x: tx, y: ty }, NG); lines.push([`今：○ が枠の外 → ${[hx, hy].filter(Boolean).join('・')}`, NG]);
      } else lines.push(['今：○ は枠の中 ✓（PCで［測る］へ）', OK]);
      // distance from the blinking disc (diameter 20 mm)
      const fpx = 0.78 * PW, dist = 20 * fpx / Math.max(1, S.ring.w * PW) / 10;
      lines.push([`○までの距離 約 ${dist.toFixed(0)} cm（目標 15〜30 cm）`, dist < 15 ? NG : dist > 30 ? WARN : OK]);
    } else lines.push([S.step === 2 ? '今：○ が見えません → iPadで点滅している ○ が映るように置く' : '②で ○ の位置を確かめます', S.step === 2 ? NG : TGT]);
  }
  // ---- after calibration: predicted iPad outline / grid / ring / measuring box
  if (pr) {
    const Wm = S.screen.Wmm / 2, Hm = S.screen.Hmm / 2;
    if (S.showGrid) {
      for (let x = -100; x <= 100; x += 20) line(pr(x, -Hm), pr(x, Hm), 'rgba(255,0,200,.9)', 2);
      for (let y = -60; y <= 60; y += 20) line(pr(-Wm, y), pr(Wm, y), 'rgba(255,0,200,.9)', 2);
      for (const p of S.calPts || []) { const a = P(p.seen), b = P(p.pred); if (!a || !b) continue; c.strokeStyle = OK; c.lineWidth = 2; c.beginPath(); c.moveTo(a.x - 7, a.y); c.lineTo(a.x + 7, a.y); c.moveTo(a.x, a.y - 7); c.lineTo(a.x, a.y + 7); c.stroke(); c.strokeStyle = '#ff00c8'; c.beginPath(); c.arc(b.x, b.y, 6, 0, 7); c.stroke(); }
    }
    [[-Wm, -Hm, Wm, -Hm], [Wm, -Hm, Wm, Hm], [Wm, Hm, -Wm, Hm], [-Wm, Hm, -Wm, -Hm]].forEach(([a, b, d, e]) => line(pr(a, b), pr(d, e), '#3ee', 3));
    const ring = []; for (let i = 0; i <= 32; i++) { const t = i / 32 * Math.PI * 2; ring.push(pr(S.screen.pip.x + 10 * Math.cos(t), S.screen.pip.y + 10 * Math.sin(t))); }
    c.strokeStyle = '#ff4d4d'; c.lineWidth = 3; c.beginPath(); ring.forEach((p, i) => p && (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y))); c.stroke();
    // measuring box = where the finger is measured (in the bending plane through the ring)
    if (S.rect) { const R = S.rect, X = S.screen.pip.x, q = [[R.y0, 0], [R.y1, 0], [R.y1, R.z1], [R.y0, R.z1], [R.y0, 0]].map(([y, z]) => pr(X, y, z));
      c.setLineDash([8, 6]); for (let i = 0; i < 4; i++) line(q[i], q[i + 1], TGT, 2); c.setLineDash([]); }
    const ci = S.calInfo;
    if (S.step === 2 && ci) {
      lines.push([`点のずれ ${ci.rms.toFixed(2)} 画素（目標 1.5 以下）・${ci.n}/${ci.of} 点`, ci.rms <= 1.5 && ci.n >= 7 ? OK : NG]);
      lines.push(['確認：ピンクの線が iPad の白い格子に重なっているか', TGT]);
      lines.push([`距離 ${(ci.dist / 10).toFixed(0)} cm（15〜30）・見下ろし ${ci.elev.toFixed(0)}°（0〜35）`, ci.dist >= 150 && ci.dist <= 300 && ci.elev <= 35 ? OK : WARN]);
      if (!ci.inside) lines.push(['黄色の枠（指を測る範囲）が映像からはみ出しています → iPhoneを離すか向きを直す', NG]);
    }
  }
  // ---- background
  if (S.step === 3) {
    if (S.countdown != null) label(c, PW / 2, PH / 2 - 40, `${S.countdown}`, TGT, 64, 'center');
    if (S.bgBusy) lines.push(['撮影中…手を映さない', TGT]);
    lines.push([S.diff < 2 ? '今：映像は止まっています ✓' : '今：映像が動いています（手・iPhoneを動かさない）', S.diff < 2 ? OK : NG]);
  }
  // ---- finger: model on the finger, PIP vs ring, what is missing
  if (S.rect && S.cal && S.bg.ready && S.raw) {
    const m = S.model || T.buildModel(S.cal), I = (q) => P(S.rect.toImage(q.x, q.y)), a = S.ok ? 1 : 0.45;
    const seg = (p, d, L, col) => { c.globalAlpha = a; line(I(p), I({ x: p.x + d.x * L, y: p.y + d.y * L }), col, 5); c.globalAlpha = 1; };
    seg(m.pip, m.g, m.Lm, '#c9ced6'); seg(m.pip, T.segDir(m, 'prox', S.raw.thp), m.Lp, '#4a86e8'); seg(m.dip, T.segDir(m, 'dist', S.raw.thd), m.Ld, '#f0953a');
    const pip = I(m.pip), ringC = I({ x: S.rect.uPip, y: m.pip.y });
    const offMm = (m.pip.x - S.rect.uPip) / S.rect.s;
    if (Math.abs(offMm) > 3) { arrow(c, pip, ringC, NG); lines.push([`PIP が ○ から ${Math.abs(offMm).toFixed(0)} mm ずれ → 中節の背を ○ に合わせる`, NG]); }
    if (S.step >= 4) {
      lines.push([`θp ${S.raw.thp.toFixed(0)}°　θd ${S.raw.thd.toFixed(0)}°（第1関節は 12° 以上曲げる）`, S.raw.thd >= 12 ? OK : WARN]);
      lines.push([`一致度 基節 ${S.raw.scoreP.toFixed(2)}・末節 ${S.raw.scoreD.toFixed(2)}（目標 ${T.SCORE_OK} 以上）`, S.ok ? OK : NG]);
      if (S.jt) lines.push([`合わせています… ${S.why || 'そのまま止める'}`, S.why ? WARN : OK]);
    }
  } else if (S.step === 4 && S.bg.ready) lines.push(['指が見えません → 中節の背を ○ に当てる', NG]);
  if (S.busy) label(c, PW / 2, 16, S.busy, TGT, 22, 'center');
  // status lines, bottom-left
  lines.slice(-5).forEach(([t, col], i, arr) => label(c, 14, PH - 40 - (arr.length - 1 - i) * 34, t, col, 19));
  // inset: the rectified bending plane (what the fit actually sees)
  if (S.rect && rectBuf && n % 4 === 0 && !S.bgBusy) {
    if (!rectCtx) { const cv = document.createElement('canvas'); rectCtx = cv.getContext('2d'); }
    const cv = rectCtx.canvas; if (cv.width !== S.rect.W) { cv.width = S.rect.W; cv.height = S.rect.H; }
    rectCtx.putImageData(rectFull(), 0, 0); drawRectOverlay(rectCtx);
  }
  if (rectCtx && S.rect && S.step >= 3) { const w = 280, h = w * S.rect.H / S.rect.W; c.drawImage(rectCtx.canvas, PW - w - 8, 8, w, h); c.strokeStyle = '#fff'; c.lineWidth = 1; c.strokeRect(PW - w - 8, 8, w, h); label(c, PW - w - 4, 8 + h + 6, '真横から見た図（指を測っている面）', '#fff', 14); }
  vctx.drawImage(prev, 0, 0, view.width, view.height);
  $('#msg').textContent = !link?.connected ? (S.linkState || 'PCに接続中…') : 'つながっています（操作はPCで）';
  $('#meta').textContent = `${S.fps} fps・処理 ${S.procMs.toFixed(1)} ms`;
  $('#linkDot').className = 'dot ' + (link?.connected ? 'ok' : 'warn');
}
function drawRectOverlay(c) {
  const R = S.rect; c.strokeStyle = 'rgba(255,255,255,.9)'; c.setLineDash([8, 6]); c.lineWidth = 2;
  c.beginPath(); c.moveTo(0, R.vGlass); c.lineTo(R.W, R.vGlass); c.stroke(); c.setLineDash([]);
  if (S.cal && S.raw) {
    const m = S.model || T.buildModel(S.cal), a = S.ok ? 1 : 0.4;
    const bar = (p, d, L, r, col) => { c.globalAlpha = 0.3 * a; c.strokeStyle = col; c.lineCap = 'round'; c.lineWidth = 2 * r; c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x + d.x * L, p.y + d.y * L); c.stroke(); c.globalAlpha = a; c.lineWidth = 3; c.stroke(); c.globalAlpha = 1; };
    bar(m.pip, m.g, m.Lm, m.r, '#c9ced6'); bar(m.pip, T.segDir(m, 'prox', S.raw.thp), m.Lp, m.rp, '#4a86e8'); bar(m.dip, T.segDir(m, 'dist', S.raw.thd), m.Ld, m.rd, '#f0953a');
    const V = T.virtualInImage(m, S.filt?.thp ?? S.raw.thp, S.filt?.thd ?? S.raw.thd);
    c.setLineDash([8, 6]); c.lineWidth = 3; c.strokeStyle = '#4a86e8'; c.beginPath(); c.moveTo(V.pip.x, V.pip.y); c.lineTo(V.vdip.x, V.vdip.y); c.stroke();
    c.strokeStyle = '#f0953a'; c.beginPath(); c.moveTo(V.vdip.x, V.vdip.y); c.lineTo(V.vtip.x, V.vtip.y); c.stroke(); c.setLineDash([]);
  }
  c.fillStyle = '#ff4d4d'; c.beginPath(); c.arc(R.uPip, R.vGlass, 6, 0, 7); c.fill();
}

// ---------------- messages ----------------
let sending = false;
function sendFrame() { // small JPEG preview for the PC (~7 fps); the measurement uses the full camera frames
  if (sending || !link?.connected) return; sending = true;
  prev.toBlob((b) => { if (b) link.sendBinary(b); sending = false; }, 'image/jpeg', 0.65);
}
function sendStatus() {
  if (!link?.connected) return;
  toMon({ type: 'status', fps: S.fps, proc: +S.procMs.toFixed(1), W: S.W, H: S.H, busy: !!S.busy || S.bgBusy || !!S.jt,
    calibrated: !!S.pose, bg: S.bg.ready, cal: !!S.cal, calInfo: S.calInfo, sim: SIM, still: S.diff < 2, ring: !!S.ring && performance.now() - (S.ringAt || 0) < 1500, why: S.why,
    gravity: S.gravity, res: S.cal && S.rect ? Math.atan(1 / (0.55 * (S.model || T.buildModel(S.cal)).Lp)) * 180 / Math.PI : null });
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function onData(m) {
  if (m.type === 'ping') { toMon({ type: 'pong', t0: m.t0, t1: performance.now() }); return; }
  if (m.type === 'shown') { const w = showWait; showWait = null; w?.(); return; }
  if (m.type === 'finger') { S.Lm = m.Lm; S.dia = m.dia; return; }
  if (m.type !== 'cmd') return;
  switch (m.name) {
    case 'step': S.step = m.step; if (S.step === 2 && !S.pose) placementLoop(); break;
    case 'countdown': S.countdown = m.n; break;
    case 'cal': calibrate(m); break;
    case 'bg': S.countdown = null; captureBackground(); break;
    case 'joints': if (!S.bg.ready) { ack('joints', false, '背景がありません'); break; } startJoints(); break;
    case 'go': if (sim) sim.state.manual = null; break;
    case 'preview': S.previewOn = !!m.on; break;
    case 'lat': S.lat = !!m.on; S.latLo = 255; S.latHi = 0; S.latWhite = null; break;
    case 'jitter': {
      if (sim) sim.state.manual = { thp: 80, thd: 30 };
      await wait(300); S.collect = []; await wait(3000); const rows = S.collect.filter((r) => r.ok); S.collect = null;
      if (sim) sim.state.manual = null;
      const sd = (a) => { const mu = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - mu) ** 2, 0) / a.length); };
      toMon(rows.length < 10 ? { type: 'result', kind: 'jitter', error: '指を見失っていて測れませんでした' } : { type: 'result', kind: 'jitter', p: sd(rows.map((r) => r.thp)), d: sd(rows.map((r) => r.thd)), n: rows.length });
      break;
    }
  }
  sendStatus();
}
function latencyFrame() {
  const c = S.center; S.latLo = Math.min(S.latLo * 0.99 + c * 0.01, c); S.latHi = Math.max(S.latHi * 0.99 + c * 0.01, c);
  if (S.latHi - S.latLo < 25) return;
  const white = c > (S.latLo + S.latHi) / 2;
  if (S.latWhite !== null && white !== S.latWhite) toMon({ type: 'lat-edge', t: performance.now(), white });
  S.latWhite = white;
}
window.phone = { S, get sim() { return sim; } };
