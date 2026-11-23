// 横カメラ（iPhone）. The PC control page drives the steps; this page measures and draws the guidance
// (targets + current state) onto the preview that the PC shows.
//  cal    : the iPad shows Gray-code stripes -> camera pose relative to the iPad screen
//  bg     : background of the bending plane (rectified view)
//  joints : PIP is on the ring; refine PIP/DIP and confirm
// Every frame afterwards: rectify the bending plane, fit the 2-link model, send theta_p / theta_d.
import * as T from './tracker.js';
import * as G from './geom.js';
import { connect } from './wslink.js';
import { boot } from './boot.js';

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
  skin: null, gain: 1, settleMs: [], screenMask: null, touch: null, rec: null, place: null,
};
let link = null, sim = null;
const work = document.createElement('canvas'), wctx = work.getContext('2d', { willReadFrequently: true });
const small = document.createElement('canvas'); small.width = 160; small.height = 90; const sctx = small.getContext('2d', { willReadFrequently: true });
const view = $('#view'), vctx = view.getContext('2d');
const prev = document.createElement('canvas'); prev.width = 960; prev.height = 540; const pctx = prev.getContext('2d');
let rectBuf = null, rectCtx = null;
const toMon = (m) => link?.send({ ...m, to: 'monitor' });

// ---------------- start ----------------
$('#addr').hidden = true; document.querySelector('.lbl').hidden = true; // pages are always served by the PC
$('#go').onclick = start;
try { if (sessionStorage.getItem('autostart')) { sessionStorage.removeItem('autostart'); setTimeout(start, 100); } } catch {}
if (SIM) setTimeout(start, 50);
let started = false;
async function start() {
  if (started) return; // a second tap must not open a second connection
  started = true;
  try {
    S.version = await boot();
    // motion sensor (for the tilt cross-check on the PC); iOS asks for permission on this tap
    try { if (typeof DeviceMotionEvent?.requestPermission === 'function') await DeviceMotionEvent.requestPermission(); } catch {}
    addEventListener('devicemotion', (e) => { const g = e.accelerationIncludingGravity; if (g && g.x != null) S.gravity = S.gravity ? S.gravity.map((v, i) => v * 0.9 + [g.x, g.y, g.z][i] * 0.1) : [g.x, g.y, g.z]; });
    let stream;
    if (SIM) { const { createSim3D } = await import('./sim3d.js'); sim = await createSim3D(); stream = sim.stream; sim.setScreen({ kind: 'scene' }); }
    else stream = await openCamera(null);
    const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.setAttribute('playsinline', ''); v.srcObject = stream; await v.play();
    S.video = v; S.stream = stream; resize();
    $('#start').style.display = 'none';
    if (!SIM) await chooseDefaultCamera();
    try { await navigator.wakeLock?.request('screen'); } catch {}
    link = connect('phone', S.version, { onOpen: () => sendStatus(), onData, onState: (t) => { S.linkState = t; }, onPresence: (p) => { S.presence = p; },
      onOld: reloadWhenIdle });
    watchTrack();
    S.lastFrameAt = performance.now(); S.frameCb = v.requestVideoFrameCallback(onFrame);
    setInterval(sendStatus, 250);
  } catch (e) { started = false; $('#startErr').textContent = `開始できません：${e.message || e}`; }
}
// ---------------- camera choice and focus (controlled from the PC) ----------------
function openCamera(id) {
  const c = { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 60 } };
  if (id) c.deviceId = { exact: id }; else c.facingMode = { ideal: 'environment' };
  return navigator.mediaDevices.getUserMedia({ video: c, audio: false }).catch(() => navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false }));
}
// only the plain wide back camera: the dual / triple cameras switch lenses by themselves, which would make
// the measured iPad position invalid in the middle of use (Fable review P0-6)
const isWide = (label) => /^(背面カメラ|back camera)$/i.test(label.trim());
async function listCameras() { try { return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput' && isWide(d.label)); } catch { return []; } }
async function chooseDefaultCamera() {
  delete saved.camId; try { localStorage.setItem(STORE, JSON.stringify(saved)); } catch {}
  const devs = await listCameras(), cur = S.stream.getVideoTracks()[0];
  if (devs.length && !isWide(cur.label)) { await switchCamera(devs[0].deviceId, false); return; }
  sendCamInfo();
}
async function switchCamera(id, remember = true) {
  try {
    const s2 = await openCamera(id); S.stream?.getTracks().forEach((t) => t.stop()); S.stream = s2; S.video.srcObject = s2; await S.video.play();
    if (remember) { saved.camId = id; try { localStorage.setItem(STORE, JSON.stringify(saved)); } catch {} }
    S.pose = null; S.rect = null; S.bg.reset(); S.cal = null; S.raw = null; S.ok = false; S.W = 0; resize();
  } catch (e) { S.camErr = e.message; }
  sendCamInfo();
}
async function sendCamInfo() {
  const t = S.stream?.getVideoTracks()[0]; if (!t) return;
  const caps = t.getCapabilities ? t.getCapabilities() : {}, set = t.getSettings();
  toMon({ type: 'caminfo', devices: (await listCameras()).map((d) => ({ id: d.deviceId, label: d.label })), current: set.deviceId, label: t.label,
    w: set.width, h: set.height, fps: set.frameRate, focusModes: caps.focusMode || [], focusDistance: caps.focusDistance || null, focusNow: set.focusDistance ?? null, focusMode: set.focusMode ?? null, err: S.camErr || null,
    caps: JSON.parse(JSON.stringify(caps)), settings: JSON.parse(JSON.stringify(set)), locks: S.locks || null });
}
// what can Safari fix? try to lock focus / exposure / white balance (auto first, then manual) and report it
async function lockCamera() {
  const t = S.stream?.getVideoTracks()[0];
  if (!t || !t.getCapabilities) { S.locks = { focusMode: 'この端末では調べられない', exposureMode: 'この端末では調べられない', whiteBalanceMode: 'この端末では調べられない' }; sendCamInfo(); return; }
  const caps = t.getCapabilities(), out = {};
  for (const k of ['focusMode', 'exposureMode', 'whiteBalanceMode']) {
    const modes = caps[k] || [];
    if (modes.includes('manual')) { try { await t.applyConstraints({ advanced: [{ [k]: 'manual' }] }); out[k] = '固定した'; } catch (e) { out[k] = `固定できず（${e.message}）`; } }
    else out[k] = modes.length ? `自動のまま（選べる方式：${modes.join(' / ')}）` : '固定できない（この端末のブラウザに機能がない）';
  }
  S.locks = out; sendCamInfo();
}
function watchTrack() {
  const t = S.stream?.getVideoTracks()[0]; if (!t) return;
  t.onended = () => { S.camState = 'カメラが切れました'; reopenCamera(); };
  t.onmute = () => { S.camState = 'カメラが一時停止しました'; };
  t.onunmute = () => { S.camState = null; };
}
async function reopenCamera() {
  if (sim || !S.video) return;
  try {
    const id = S.stream?.getVideoTracks()[0]?.getSettings().deviceId, s2 = await openCamera(id);
    S.stream?.getTracks().forEach((x) => x.stop()); S.stream = s2; S.video.srcObject = s2; await S.video.play(); watchTrack();
    if (S.frameCb != null) try { S.video.cancelVideoFrameCallback(S.frameCb); } catch {}
    S.lastFrameAt = performance.now(); S.frameCb = S.video.requestVideoFrameCallback(onFrame);
    S.camState = 'カメラを開き直しました'; report('カメラを開き直しました');
  } catch (e) { S.camState = `カメラを開き直せません：${e.message}`; report(S.camState); }
}
// no frame for 1 s -> play() again; for 3 s -> open the camera again
setInterval(async () => {
  if (!S.video || !started) return;
  const gap = performance.now() - (S.lastFrameAt || 0);
  if (gap > 1000 && gap < 3000) { S.camState = 'カメラが止まりました（再開しています）'; try { await S.video.play(); } catch {} }
  else if (gap >= 3000 && performance.now() - (S.reopenAt || 0) > 5000) { S.reopenAt = performance.now(); S.camState = 'カメラが止まりました（開き直しています）'; reopenCamera(); }
}, 500);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') S.video?.play().catch(() => {}); });
// errors go to the PC (red there), never silently stop anything
let lastErr = '', lastErrAt = 0;
function report(msg) { if (msg === lastErr && performance.now() - lastErrAt < 2000) return; lastErr = msg; lastErrAt = performance.now(); toMon({ type: 'error', msg: String(msg).slice(0, 300) }); }
addEventListener('error', (e) => report(`エラー：${e.message}`));
addEventListener('unhandledrejection', (e) => report(`エラー：${e.reason?.message || e.reason}`));
// an old page reloads itself once, but never in the middle of a job
function reloadWhenIdle() { const t = setInterval(() => { if (!job) { clearInterval(t); try { sessionStorage.setItem('autostart', '1'); } catch {} location.reload(); } }, 500); }
async function setFocus(m) {
  const t = S.stream?.getVideoTracks()[0]; if (!t) return;
  try { await t.applyConstraints({ advanced: [m.mode === 'manual' ? { focusMode: 'manual', focusDistance: m.d } : { focusMode: m.mode }] }); S.camErr = null; } catch (e) { S.camErr = `ピントを変えられません：${e.message}`; }
  sendCamInfo();
}
function resize() {
  const v = S.video;
  if (v.videoWidth !== S.W || v.videoHeight !== S.H) { S.W = v.videoWidth; S.H = v.videoHeight; work.width = view.width = S.W; work.height = view.height = S.H; S.pose = null; S.rect = null; S.bg.reset(); S.cal = null; }
}

// ---------------- frame loop ----------------
let n = 0;
function onFrame(now) {
  S.frameCb = S.video.requestVideoFrameCallback(onFrame); // schedule first: an error below must not stop the camera loop
  S.lastFrameAt = performance.now(); if (S.camState && /止まりました/.test(S.camState)) S.camState = null;
  try { frameBody(now); } catch (e) { report(`処理エラー：${e.message}`); }
}
let lastSent = 0;
function frameBody(now) {
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
  // preview: 5 per second, 2 per second during a job (Fable P0-9)
  if (S.previewOn && performance.now() - lastSent > (job ? 500 : 200)) { lastSent = performance.now(); sendFrame(); }
  if (n % 15 === 0) sharpness();
}
// sharpness of the picture (variance of the Laplacian in the middle of the frame); small = blurred
function sharpness() {
  const W = 160, H = 90, L = S.prevSmall; if (!L) return;
  let sum = 0, sum2 = 0, c = 0;
  for (let y = 20; y < H - 20; y++) for (let x = 40; x < W - 40; x++) { const k = y * W + x, v = 4 * L[k] - L[k - 1] - L[k + 1] - L[k - W] - L[k + W]; sum += v; sum2 += v * v; c++; }
  S.sharp = sum2 / c - (sum / c) ** 2;
}
const nextFrames = (k) => new Promise((res, rej) => { let c = 0; const f = () => { if (job?.abort) { rej(new Error('中止されました')); return; } if (++c >= k) res(); else S.waiters.push(f); }; S.waiters.push(f); });
function stats() {
  sctx.drawImage(S.video, 0, 0, 160, 90);
  const d = sctx.getImageData(0, 0, 160, 90).data, L = new Float32Array(160 * 90);
  let diff = 0, c = 0, cn = 0;
  for (let i = 0, k = 0; k < L.length; i += 4, k++) { L[k] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; if (S.prevSmall) diff += Math.abs(L[k] - S.prevSmall[k]); }
  for (let y = 30; y < 60; y++) for (let x = 50; x < 110; x++) { c += L[y * 160 + x]; cn++; }
  S.center = c / cn; S.diff = S.prevSmall ? diff / L.length : 99; S.prevSmall = L;
  S.stillN = S.diff < 2 ? S.stillN + 1 : 0;
}
let placing = false;
// A job = one command from the PC. The PC gets: "got" at once, the job/phase in every status (4 per second),
// and the result, which is repeated in the status until the PC confirms it. Nothing waits forever.
let job = null, result = null;
function phase(p, progress) { if (job) { job.phase = p; if (progress != null) job.progress = progress; } S.busy = p; }
const ack = (what, ok, msg, info) => { result = { jobId: job?.jobId ?? null, what, ok, msg, info }; toMon({ type: 'ack', ...result }); };
let frameJobDone = null;
const finishFrameJob = () => { const f = frameJobDone; frameJobDone = null; f?.(); };
async function runJob(m, fn) {
  if (job) { toMon({ type: 'ack', jobId: m.jobId, what: m.name, ok: false, msg: `実行中です（先の「${job.name}」が終わっていません）` }); return; }
  job = { name: m.name, jobId: m.jobId, phase: '開始', progress: 0, t0: performance.now() };
  try { await fn(); }
  catch (e) { ack(m.name, false, e.message || String(e)); }
  finally {
    job = null; S.busy = null; placing = false; frameJobDone = null;
    if (S.bgBusy) { S.bgBusy = false; S.bg.reset(); }
    if (S.jt) S.jt = null;
    sendStatus();
  }
}
// frame-driven jobs (background, joints) finish inside the frame loop
const frameJob = (start) => new Promise((res) => { frameJobDone = res; start(); });

// ---------------- 1. calibration: camera pose from dots on the iPad ----------------
let showSeq = 0;
const showPend = new Map(), showStats = { lat: [], timeouts: 0 };
function show(state) { // ask the iPad to show something; resolves when the iPad says it is on screen, fails after 1.5 s
  if (job?.abort) return Promise.reject(new Error('中止されました'));
  const id = ++showSeq; if (sim) sim.setScreen(state);
  return new Promise((res, rej) => {
    const t0 = performance.now();
    const to = setTimeout(() => { showPend.delete(id); showStats.timeouts++; rej(new Error('iPadの返事がありません（表示の依頼が時間切れ）')); }, 1500);
    showPend.set(id, () => { clearTimeout(to); showPend.delete(id); showStats.lat.push(performance.now() - t0); if (showStats.lat.length > 60) showStats.lat.shift(); res(); });
    if (!link.send({ type: 'show', to: 'ipad', id, ...state })) { clearTimeout(to); showPend.delete(id); rej(new Error('PCとの接続が切れています')); }
  });
}
// luma of the camera frame at 1/2 resolution (for decoding the patterns)
const half = document.createElement('canvas'), hctx = half.getContext('2d', { willReadFrequently: true });
function lumaHalf() {
  half.width = S.W >> 1; half.height = S.H >> 1; hctx.drawImage(S.video, 0, 0, half.width, half.height);
  const d = hctx.getImageData(0, 0, half.width, half.height).data, L = new Float32Array(half.width * half.height);
  for (let i = 0, k = 0; k < L.length; i += 4, k++) L[k] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  return L;
}
async function grab(k = 1) { let acc = null; for (let i = 0; i < k; i++) { await nextFrames(1); const L = lumaHalf(); if (!acc) acc = L; else for (let j = 0; j < L.length; j++) acc[j] += L[j]; } if (k > 1) for (let j = 0; j < acc.length; j++) acc[j] /= k; return acc; }
// after the iPad says "shown": wait at least 150 ms, then until two frames in a row differ by < 1.0 (max 1.2 s)
async function settle() {
  const t0 = performance.now(); await wait(150);
  let still = 0;
  while (still < 2 && performance.now() - t0 < 1350) { await nextFrames(1); still = S.diff < 1.0 ? still + 1 : 0; }
  S.settleMs.push(performance.now() - t0); if (S.settleMs.length > 60) S.settleMs.shift();
}
async function showGrab(state, k = 1) { await show(state); await settle(); return grab(k); }

// The iPad shows Gray-code stripes (each with its inverse). Every camera pixel that sees the screen decodes
// which screen column and row it looks at -> thousands of correspondences (screen mm <-> image px).
async function captureScreen(m, tag = 'cal') {
  const plan = G.grayPlan(m, MIN_STRIPE), total = plan.length;
  const HW = S.W >> 1, HH = S.H >> 1;
  const frames = { white: await showGrab({ kind: 'white' }, 2), black: await showGrab({ kind: 'black' }, 2), gray: {} };
  recLuma(`${tag}_white.png`, frames.white, HW, HH); recLuma(`${tag}_black.png`, frames.black, HW, HH);
  sendDiffImage(frames.white, frames.black, HW, HH);
  const screenFrac = (() => { let c = 0; for (let k = 0; k < frames.white.length; k++) if (frames.white[k] - frames.black[k] >= 40) c++; return c / frames.white.length; })();
  if (screenFrac < 0.15) throw new Error(`iPadが映っていません（画面が映像の ${(screenFrac * 100).toFixed(0)}%。15%以上必要）→ iPhoneを ○ の方へ向ける`);
  let done = 0;
  for (const { axis, bit } of plan) {
    phase(`しま模様 ${++done}/${total}`, done / total);
    const P = await showGrab({ kind: 'gray', axis, bit }), I = await showGrab({ kind: 'gray', axis, bit, inv: true });
    frames.gray[`${axis}:${bit}`] = [P, I];
    recLuma(`${tag}_${axis}${bit}_p.png`, P, HW, HH); recLuma(`${tag}_${axis}${bit}_i.png`, I, HW, HH);
  }
  const out = G.decodeGray(frames, m, HW, HH, MIN_STRIPE);
  return { src: out.src, dst: out.dst, screenFrac: out.screenFrac };
}
const MIN_STRIPE = 3; // finest stripe 8 px = 1.5 mm (Fable P1-2)
// white minus black, small, for the PC: the iPad screen must look clearly white (Fable P0-4 check)
function sendDiffImage(W1, B1, HW, HH) {
  const c = document.createElement('canvas'), w = 320, h = Math.round(320 * HH / HW); c.width = w; c.height = h;
  const x = c.getContext('2d'), id = x.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let i = 0; i < w; i++) { const k = Math.floor(y * HH / h) * HW + Math.floor(i * HW / w), v = Math.max(0, Math.min(255, W1[k] - B1[k])), o = (y * w + i) * 4; id.data[o] = id.data[o + 1] = id.data[o + 2] = v; id.data[o + 3] = 255; }
  x.putImageData(id, 0, 0); toMon({ type: 'diffimg', url: c.toDataURL('image/jpeg', 0.7) });
}
// screen position (mm) that an image point maps to under a pose: intersect the viewing ray with the screen (z = 0)
function toScreen(pose, p) {
  const { R, t, f, cx, cy } = pose, ray = [(p.x - cx) / f, (p.y - cy) / f, 1];
  const Rt = (v) => [0, 1, 2].map((j) => R[0][j] * v[0] + R[1][j] * v[1] + R[2][j] * v[2]);
  const C = Rt(t).map((v) => -v), d = Rt(ray), s = -C[2] / d[2];
  return { x: C[0] + d[0] * s, y: C[1] + d[1] * s };
}
const sampleIdx = (arr, n) => { const out = []; for (let i = 0; i < n; i++) out.push(arr[(Math.random() * arr.length) | 0]); return out; };
// spread (NOT accuracy: Fable P1-3) from the iPad itself:
//  (1) 30% of the points are kept out of the fit; where the fit says they are vs where they really are (screen mm)
//  (2) the reference directions (screen normal, finger direction) re-estimated from random subsets -> spread in degrees
function accuracy(pose, isrc, idst, m, fixF = false) {
  const idx = isrc.map((_, i) => i).sort(() => Math.random() - 0.5), cut = Math.floor(idx.length * 0.7);
  const fitI = sampleIdx(idx.slice(0, cut), Math.min(4000, cut)), chkI = idx.slice(cut);
  const pf = G.refinePose(pose, fitI.map((i) => isrc[i]), fitI.map((i) => idst[i]), fixF); // refit on 70 % only
  const errs = chkI.map((i) => { const q = toScreen(pf, idst[i]); return Math.hypot(q.x - isrc[i].x, q.y - isrc[i].y); }).sort((a, b) => a - b);
  const med = errs[errs.length >> 1] || 0, p95 = errs[Math.floor(errs.length * 0.95)] || 0;
  const axes = (p) => [[p.R[0][2], p.R[1][2], p.R[2][2]], [p.R[0][1], p.R[1][1], p.R[2][1]]];
  const ang = (a, b) => Math.acos(Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * 180 / Math.PI;
  const [n0, y0] = axes(pose), dev = [], pipDev = [];
  // two halves of the points, each solved from scratch (same focal-length rule as the measurement)
  for (let r = 0; r < 4; r++) {
    const ii = idx.filter(() => Math.random() < 0.5), p = G.estimatePose(ii.map((i) => isrc[i]), ii.map((i) => idst[i]), S.W, S.H, fixF ? { f: pose.f } : {}); if (!p) continue;
    const [n1] = axes(p); dev.push(ang(n0, n1)); // tilt of the screen normal (the reference of the angles)
    const q = toScreen(pose, G.project(p, [m.pip.x, m.pip.y, 0])); pipDev.push(Math.hypot(q.x - m.pip.x, q.y - m.pip.y));
  }
  const rmsOf = (a) => Math.sqrt(a.reduce((x, y) => x + y * y, 0) / Math.max(1, a.length));
  return { checkMm: med, checkMm95: p95, angleDeg: rmsOf(dev), pipMm: rmsOf(pipDev) };
}
// has the iPhone or the iPad moved since the measurement? re-read the screen and compare with the saved pose
async function verifyPose() {
  if (!S.pose || !S.screen) { ack('verify', false, '先に②でiPadの位置を測ってください'); return; }
  phase('ずれを確認しています');
  const { src, dst } = await captureScreen(S.screen);
  await show({ kind: 'scene' });
  if (src.length < 30) { ack('verify', false, `iPadの画面が読み取れません（${src.length}）`); return; }
  const e = []; for (let i = 0; i < src.length; i += Math.max(1, (src.length / 3000) | 0)) { const q = toScreen(S.pose, dst[i]); e.push(Math.hypot(q.x - src[i].x, q.y - src[i].y)); }
  e.sort((a, b) => a - b);
  ack('verify', true, '', { driftMm: e[e.length >> 1], n: e.length });
}
async function calibrate(m) {
  phase('ピント・露出を合わせています');
  S.screen = m; S.pose = null; S.rect = null; S.bg.reset(); S.cal = null; S.raw = null; S.ok = false; S.showGrid = false; S.calPts = null;
  if (sim) sim.state.handIn = false;
  if (!S.locks) { await nextFrames(30); await lockCamera(); } // auto first, then lock what can be locked
  const { src, dst } = await captureScreen(m);
  await show({ kind: 'grid' });
  if (src.length < 30) { ack('cal', false, `iPadの画面が読み取れません（使えた点 ${src.length}）`, { n: src.length }); return; }
  const rs = G.ransacHomography(src, dst, 3);
  const isrc = rs ? rs.inliers.map((i) => src[i]) : [], idst = rs ? rs.inliers.map((i) => dst[i]) : [];
  if (isrc.length < 30) { ack('cal', false, `読み取れた点が合いません（${isrc.length}/${src.length}）`, { n: isrc.length }); return; }
  phase('計算しています');
  await nextFrames(1);
  // focal length: free this time (for the check), fixed from the saved value once there is one (Fable P1-2)
  const fkey = `${S.stream?.getVideoTracks()[0]?.label || 'sim'}|${S.W}x${S.H}`, fsaved = await focalGet(fkey);
  // the pose from the points within 70 mm of the ring (where the finger is), if there are enough
  const near = isrc.map((q, i) => i).filter((i) => Math.abs(isrc[i].x - m.pip.x) <= 70 && Math.abs(isrc[i].y - m.pip.y) <= 70);
  const ps = near.length >= 200 ? near.map((i) => isrc[i]) : isrc, pd = near.length >= 200 ? near.map((i) => idst[i]) : idst;
  const free = G.estimatePose(ps, pd, S.W, S.H); // focal length from this measurement alone (for the check / saving)
  if (!free || free.rms > 3) { ack('cal', false, `計算が合いません（ずれ ${free ? free.rms.toFixed(1) : '?'} 画素）`, { n: isrc.length }); return; }
  const pose = fsaved ? G.estimatePose(ps, pd, S.W, S.H, { f: fsaved * S.W }) : free;
  if (!pose || pose.rms > 3) { ack('cal', false, `計算が合いません（ずれ ${pose ? pose.rms.toFixed(1) : '?'} 画素）`, { n: isrc.length }); return; }
  const focal = { now: free.f / S.W, saved: fsaved, used: pose.f / S.W, off: fsaved ? Math.abs(free.f / S.W - fsaved) / fsaved : 0 };
  if (!fsaved || focal.off < 0.03) focalPut(fkey, free.f / S.W);
  S.lastCorr = { isrc, idst }; // kept for checking
  const acc = accuracy(pose, ps, pd, m, !!fsaved);
  S.pose = pose; S.showGrid = true;
  const step = Math.max(1, Math.floor(isrc.length / 80));
  S.calPts = []; for (let i = 0; i < isrc.length; i += step) S.calPts.push({ seen: idst[i], pred: G.project(pose, [isrc[i].x, isrc[i].y, 0]) });
  S.rect = G.makeRect(pose, m.pip.x, m.pip.y); S.rectBox = null; S.roiKey = '';
  rectBuf = new ImageData(S.rect.W, S.rect.H);
  const C = pose.C, dx = C[0] - m.pip.x, dy = C[1] - m.pip.y, dist = Math.hypot(dx, dy, C[2]);
  const corners = [[S.rect.y0, S.rect.z0], [S.rect.y1, S.rect.z0], [S.rect.y1, S.rect.z1], [S.rect.y0, S.rect.z1]].map(([y, z]) => G.project(pose, [m.pip.x, y, z]));
  const inside = corners.every((p) => p && p.x >= 0 && p.y >= 0 && p.x <= S.W && p.y <= S.H);
  const elev = Math.atan2(C[2], Math.hypot(dx, dy)) * 180 / Math.PI, side = Math.atan2(Math.abs(dy), Math.abs(dx)) * 180 / Math.PI;
  S.place = placement(C, m);
  S.calInfo = { rms: pose.rms, n: isrc.length, near: near.length, of: src.length, fW: pose.f / S.W, focal, dist, C, inside, ...acc,
    elev, side, scale: S.rect.s, place: S.place, tiltCam: tiltFromCamera(pose) };
  // what the iPad must keep still: the part of the screen seen behind the measuring box (Fable P1-5)
  const zone = G.behindZone(C, S.rect, m.Wmm, m.Hmm, S.dia / 2 + 3);
  link.send({ type: 'still', to: 'ipad', poly: zone });
  S.screenMask = screenMaskFor(pose, S.rect, m);
  recJSON('cal.json', { screen: m, W: S.W, H: S.H, MIN: MIN_STRIPE, pose: { R: pose.R, t: pose.t, f: pose.f, cx: pose.cx, cy: pose.cy, C: pose.C }, info: S.calInfo });
  ack('cal', true, '', S.calInfo);
}
// Placement verdict in numbers (Fable P1-1): side <= 10 deg, looking down 10-20 deg, 20-30 cm.
// The hints say how far to move the iPhone, in the user's terms (toward the fingertip / wrist, up / down, closer / away).
function placement(C, m) {
  const dx = C[0] - m.pip.x, dy = C[1] - m.pip.y, hor = Math.hypot(dx, dy), dist = Math.hypot(dx, dy, C[2]);
  const side = Math.atan2(Math.abs(dy), Math.abs(dx)) * 180 / Math.PI, elev = Math.atan2(C[2], hor) * 180 / Math.PI;
  const ok = { side: side <= 10, elev: elev >= 10 && elev <= 20, dist: dist >= 200 && dist <= 300 };
  const hints = [];
  if (!ok.side) { const mv = Math.abs(dy) - Math.abs(dx) * Math.tan(8 * Math.PI / 180); hints.push({ k: 'side', text: `iPhoneを${dy > 0 ? '手首側' : '指先側'}へ ${(mv / 10).toFixed(1)} cm 動かす（真横からのずれ ${side.toFixed(0)}° → 10°以内）`, dir: dy > 0 ? -1 : 1 }); }
  if (!ok.elev) { const want = hor * Math.tan(15 * Math.PI / 180), mv = C[2] - want; hints.push({ k: 'elev', text: `iPhoneを ${(Math.abs(mv) / 10).toFixed(1)} cm ${mv > 0 ? '下げる' : '上げる'}（見下ろし ${elev.toFixed(0)}° → 10〜20°）`, dir: mv > 0 ? 1 : -1 }); }
  if (!ok.dist) { const mv = dist < 200 ? 220 - dist : dist - 280; hints.push({ k: 'dist', text: `iPhoneを ${(mv / 10).toFixed(1)} cm ${dist < 200 ? '離す' : '近づける'}（距離 ${(dist / 10).toFixed(0)} cm → 20〜30 cm）`, dir: dist < 200 ? 1 : -1 }); }
  return { side, elev, dist, ok, pass: ok.side && ok.elev && ok.dist, hints };
}
// rectified pixels where the iPad screen is seen behind (the ray from the camera through the point meets the screen)
function screenMaskFor(pose, R, m) {
  const C = pose.C, out = new Uint8Array(R.W * R.H);
  for (let v = 0; v < R.H; v++) { const z = R.z1 - v / R.s; if (z >= C[2]) continue;
    for (let u = 0; u < R.W; u++) { const y = R.y0 + u / R.s, sc = C[2] / (C[2] - z), X = C[0] + (R.x0 - C[0]) * sc, Y = C[1] + (y - C[1]) * sc;
      if (Math.abs(X) <= m.Wmm / 2 && Math.abs(Y) <= m.Hmm / 2) out[v * R.W + u] = 1; } }
  return out;
}
// saved focal length of this camera (kept on the PC)
async function focalGet(key) { try { const j = await (await fetch(`/api/focal?key=${encodeURIComponent(key)}`, { cache: 'no-store' })).json(); return j.fixed || null; } catch { return null; } }
function focalPut(key, fW) { fetch('/api/focal', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key, fW }) }).catch(() => {}); }
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
function rectFull() { const bx = S.rectBox || (S.rectBox = G.srcBox(S.rect, 0, 0, S.rect.W, S.rect.H, S.W, S.H)); const fr = wctx.getImageData(bx.x, bx.y, bx.w, bx.h); return G.warp(S.rect, fr, 0, 0, S.rect.W, S.rect.H, rectBuf, bx.x, bx.y); }
function captureBackground() {
  if (!S.rect) { ack('bg', false, '先にiPadの位置を測ってください'); return; }
  S.showGrid = false; S.bgBusy = true; S.bg.reset(); S.bgFrames = -6; S.bgRef = null; S.cal = null; S.model = null; S.raw = null; S.ok = false;
  if (sim) { sim.state.handIn = false; sim.setScreen({ kind: 'scene' }); }
}
function bgFrame() {
  if (job?.abort) { S.bgBusy = false; S.bg.reset(); ack('bg', false, '中止されました'); finishFrameJob(); return; }
  if (S.bgFrames < 0) { S.bgFrames++; return; }
  if (!S.bgRef) S.bgRef = S.prevSmall.slice();
  else { let d = 0; for (let k = 0; k < S.bgRef.length; k++) d += Math.abs(S.prevSmall[k] - S.bgRef[k]); if (d / S.bgRef.length > 6) { S.bgBusy = false; S.bg.reset(); ack('bg', false, '撮っている間に映像が動きました'); finishFrameJob(); return; } }
  S.bg.add(rectFull()); if (S.bgFrames % 3 === 0) recFrame(`bg_${String(S.bgFrames).padStart(2, '0')}.jpg`); S.bgFrames++;
  if (S.bgFrames >= 30) {
    S.bg.finish(); S.bgBusy = false; S.skin = null; S.gain = 1; ack('bg', true, ''); finishFrameJob();
    if (sim) setTimeout(() => { sim.state.handIn = true; sim.state.manual = { thp: 70, thd: 45 }; }, 300);
  }
}

// ---------------- 3. joints: the PIP is on the ring; refine both joints (up to ~10 s) ----------------
const finishFrameJobAfter = () => setTimeout(finishFrameJob, 0);
function rectCalInit() {
  const R = S.rect, vg = R.vGlass;
  return { glass: { a: { x: 0, y: vg }, b: { x: R.W, y: vg } }, side: -1,
    pipC: { x: R.uPip, y: vg }, dipC: { x: R.uPip + S.Lm * R.s, y: vg }, T: S.dia * R.s };
}
const fgOpt = () => ({ screen: S.screenMask, skin: S.skin, gain: S.gain });
function fgFull() { const img = rectFull(); S.gain = T.cornerGain(img, S.bg); return T.foregroundC(img, { x0: 0, y0: 0, w: S.rect.W, h: S.rect.H }, S.bg, fgOpt()); }
function startJoints() { S.jt = { n: 0, last: null, good: 0 }; S.why = ''; S.cal = rectCalInit(); S.model = null; S.prev = {}; S.raw = null; S.ok = false; }
function jointTry() {
  if (job?.abort) { S.jt = null; ack('joints', false, '中止されました'); finishFrameJob(); return; }
  const J = S.jt; J.n++;
  const f = fgFull();
  const ref = T.refineJoints(f, rectCalInit()); // always start from the ring, so repeated tries cannot drift
  const Tm = T.measureThickness(f, ref.glass, ref.pipC, ref.dipC, ref.side, S.dia * S.rect.s); if (Tm > 0.6 * S.dia * S.rect.s && Tm < 1.5 * S.dia * S.rect.s) ref.T = Tm;
  const moved = J.last ? Math.max(T.vec.len(T.vec.sub(ref.pipC, J.last.pipC)), T.vec.len(T.vec.sub(ref.dipC, J.last.dipC))) : 99;
  J.last = ref; S.cal = ref; S.model = null;
  const bent = S.raw && S.raw.thd >= 12 && S.raw.thp > 25 && S.raw.thp < 160;
  S.why = !S.raw || Math.max(S.raw.scoreP, S.raw.scoreD) < 0.4 ? '指が見えません' : !bent ? '第1関節の曲げが足りません' : !S.ok ? '指の形が合いません' : moved >= 3 ? '指が動いています' : '';
  J.good = !S.why ? J.good + 1 : 0;
  if (J.good >= 3) {
    S.jt = null; S.fP.reset(); S.fD.reset();
    // learn this person's finger colour now (nothing about skin is fixed in advance)
    const skin = T.learnSkin(rectFull(), T.buildModel(ref), S.raw.thp, S.raw.thd), sep = skin ? T.skinVsBackground(skin, S.bg) : null;
    S.skin = skin && sep >= 3 ? skin : null; S.model = null;
    finishFrameJobAfter();
    ack('joints', true, '', { pipOffsetMm: (ref.pipC.x - S.rect.uPip) / S.rect.s, LmMm: (ref.dipC.x - ref.pipC.x) / S.rect.s, diaMm: ref.T / S.rect.s,
      skinSep: sep, skinUsed: !!S.skin, touch: S.touch && performance.now() - S.touch.at < 1000 ? S.touch : null });
    return;
  }
  if (J.n >= 100) { S.jt = null; if (!S.ok) S.cal = null; ack('joints', false, S.why); finishFrameJob(); }
}

// ---------------- tracking ----------------
function trackFrame(now) {
  if (!S.model) S.model = T.buildModel(S.cal);
  const m = S.model, roi = T.roiFor(m, S.rect.W, S.rect.H);
  if (!S.roiBuf || S.roiBuf.width !== roi.w || S.roiBuf.height !== roi.h) S.roiBuf = new ImageData(roi.w, roi.h);
  const key = `${roi.x0},${roi.y0},${roi.w},${roi.h}`;
  if (S.roiKey !== key) { S.roiKey = key; S.roiBox = G.srcBox(S.rect, roi.x0, roi.y0, roi.w, roi.h, S.W, S.H); }
  const bx = S.roiBox, fr = wctx.getImageData(bx.x, bx.y, bx.w, bx.h);
  G.warp(S.rect, fr, roi.x0, roi.y0, roi.w, roi.h, S.roiBuf, bx.x, bx.y);
  if (n % 30 === 0) S.gain = T.cornerGain(rectFull(), S.bg); // overall light change
  const f = T.foregroundC(S.roiBuf, roi, S.bg, fgOpt());
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
  // ---- before the iPad position is known: a light frame where the screen and the ring should appear
  if (!S.pose) {
    c.setLineDash([10, 8]); c.strokeStyle = 'rgba(255,216,74,.55)'; c.lineWidth = 2; c.strokeRect(PW * 0.12, PH * 0.42, PW * 0.76, PH * 0.5); c.setLineDash([]);
    label(c, PW * 0.12, PH * 0.42 - 30, 'iPadの画面と ○ がこのあたりに映るように', TGT, 18);
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
      const pl = ci.place;
      lines.push([`真横から ${pl.side.toFixed(0)}°（10°以内）・見下ろし ${pl.elev.toFixed(0)}°（10〜20°）・距離 ${(pl.dist / 10).toFixed(0)} cm（20〜30）`, pl.pass ? OK : NG]);
      for (const h of pl.hints) lines.push([h.text, NG]);
      if (!ci.inside) lines.push(['黄色の枠（指を測る範囲）が映像からはみ出しています → iPhoneを離すか向きを直す', NG]);
      // arrows: side = along the finger (left/right in the picture), elev = up/down, dist = toward/away
      const ctr = { x: PW / 2, y: PH * 0.3 };
      for (const h of pl.hints) {
        if (h.k === 'side') { const a = pr(S.screen.pip.x, S.screen.pip.y, 30), b = pr(S.screen.pip.x, S.screen.pip.y + 30 * h.dir, 30); if (a && b) arrow(c, a, { x: a.x + (b.x - a.x) * 2, y: a.y + (b.y - a.y) * 2 }, NG); }
        if (h.k === 'elev') arrow(c, ctr, { x: ctr.x, y: ctr.y + 60 * h.dir }, NG);
        if (h.k === 'dist') { c.strokeStyle = NG; c.lineWidth = 4; c.beginPath(); c.arc(ctr.x + 120, ctr.y, h.dir > 0 ? 18 : 34, 0, 7); c.stroke(); }
      }
    }
  }
  // ---- background
  if (S.step === 3) {
    if (S.countdown != null) label(c, PW / 2, PH / 2 - 40, `${S.countdown}`, TGT, 64, 'center');
    if (S.bgBusy) lines.push(['撮影中…手を映さない', TGT]);
    lines.push([S.diff < 2 ? '今：映像は止まっています ✓' : '今：映像が動いています（手・iPhoneを動かさない）', S.diff < 2 ? OK : NG]);
  }
  // ---- finger: model on the finger, PIP vs ring, what is missing
  if (S.touch && performance.now() - S.touch.at < 500 && pr) { const q = pr(S.touch.x, S.touch.y); if (q) { c.fillStyle = 'rgba(62,207,142,.8)'; c.beginPath(); c.arc(q.x, q.y, 8, 0, 7); c.fill(); } }
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
  $('#msg').textContent = !link?.connected ? (S.linkState || 'PCに接続中…') : `つながっています（操作はPCで）・${job ? `測定中：${job.phase}` : S.camState ? S.camState : '待機'}`;
  $('#meta').textContent = `版 ${S.version || '—'}・${S.fps} fps・処理 ${S.procMs.toFixed(1)} ms${S.rec ? '・記録中' : ''}`;
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
  prev.toBlob((b) => { if (b) link.sendBinary(b); sending = false; }, 'image/jpeg', 0.6);
}
function sendStatus() {
  if (!link?.connected) return;
  const lat = showStats.lat.slice().sort((a, b) => a - b);
  toMon({ type: 'status', version: S.version, job: job && { name: job.name, jobId: job.jobId, phase: job.phase, progress: job.progress, sec: (performance.now() - job.t0) / 1000 }, result,
    camState: S.camState || null, sharp: S.sharp ?? null, locks: S.locks || null, showMs: lat.length ? lat[lat.length >> 1] : null, showTimeouts: showStats.timeouts, fps: S.fps, proc: +S.procMs.toFixed(1), W: S.W, H: S.H, busy: !!S.busy || S.bgBusy || !!S.jt,
    calibrated: !!S.pose, bg: S.bg.ready, cal: !!S.cal, calInfo: S.calInfo, sim: SIM, still: S.diff < 2, why: S.why, rec: S.rec?.id || null, skin: !!S.skin,
    settleMs: S.settleMs.length ? S.settleMs.slice().sort((a, b) => a - b)[S.settleMs.length >> 1] : null, touch: S.touch && performance.now() - S.touch.at < 1000 ? S.touch : null,
    gravity: S.gravity, res: S.cal && S.rect ? Math.atan(1 / (0.55 * (S.model || T.buildModel(S.cal)).Lp)) * 180 / Math.PI : null });
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function onData(m) {
  if (m.type === 'ping') { toMon({ type: 'pong', t0: m.t0, t1: performance.now() }); return; }
  if (m.type === 'shown') { showPend.get(m.id)?.(); return; }
  if (m.type === 'resultAck') { if (result && result.jobId === m.jobId) result = null; return; }
  if (m.type === 'cmd' && m.jobId) {
    toMon({ type: 'got', jobId: m.jobId });
    if (job && job.jobId === m.jobId) return;                                   // the PC sent it twice
    if (result && result.jobId === m.jobId) { toMon({ type: 'ack', ...result }); return; } // it missed the result
  }
  if (m.type === 'finger') { S.Lm = m.Lm; S.dia = m.dia; return; }
  if (m.type === 'touch') { S.touch = { ...m, at: performance.now() }; return; }
  if (m.type !== 'cmd') return;
  switch (m.name) {
    case 'step': S.step = m.step; break;
    case 'abort': if (job) { job.abort = true; phase('中止しています'); } break;
    case 'camera': switchCamera(m.id); break;
    case 'focus': setFocus(m); break;
    case 'caminfo': sendCamInfo(); break;
    case 'countdown': S.countdown = m.n; break;
    case 'cal': runJob(m, () => calibrate(m)); break;
    case 'verify': runJob(m, verifyPose); break;
    case 'bg': S.countdown = null; runJob(m, async () => { if (!S.rect) throw new Error('先にiPadの位置を測ってください'); phase('背景を撮っています'); await frameJob(captureBackground); }); break;
    case 'joints': runJob(m, async () => { if (!S.bg.ready) throw new Error('背景がありません'); phase('指を合わせています'); await frameJob(startJoints); }); break;
    case 'go': if (sim) sim.state.manual = null; break;
    case 'preview': S.previewOn = !!m.on; break;
    case 'rec': S.rec = m.on ? { id: m.id, n: 0 } : null; break;
    case 'recFinger': runJob(m, recordFinger); break;
    case 'ruler': runJob(m, () => rulerCheck(m)); break;
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
}
// ---------------- recordings: raw pictures sent to the PC (recordings/<date>/) (Fable P0-10) ----------------
const upq = [], uploaded = new Set(); let uploading = 0;
function upload(name, blob) {
  if (!S.rec || !blob) return;
  upq.push([S.rec.id, name, blob, 0]); pump();
}
function pump() {
  while (uploading < 2 && upq.length) {
    const it = upq.shift(), [id, name, blob] = it; uploading++;
    fetch(`/api/rec/${encodeURIComponent(id)}/${encodeURIComponent(name)}`, { method: 'POST', body: blob })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); uploaded.add(name); })
      .catch((e) => { if (++it[3] < 3) upq.push(it); else report(`記録を送れません（${name}）：${e.message}`); })
      .finally(() => { uploading--; pump(); });
  }
}
const drained = async () => { const t0 = performance.now(); while ((upq.length || uploading) && performance.now() - t0 < 15000) await wait(100); };
function recLuma(name, L, W, H) {
  if (!S.rec) return;
  const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d'), id = x.createImageData(W, H);
  for (let k = 0; k < L.length; k++) { const v = Math.max(0, Math.min(255, Math.round(L[k]))); id.data[4 * k] = id.data[4 * k + 1] = id.data[4 * k + 2] = v; id.data[4 * k + 3] = 255; }
  x.putImageData(id, 0, 0); c.toBlob((b) => upload(name, b), 'image/png');
}
function recFrame(name) { if (S.rec) work.toBlob((b) => upload(name, b), 'image/jpeg', 0.92); }
// the frame is encoded before the next camera frame overwrites the work canvas
const recFrameNow = (name) => new Promise((res) => work.toBlob((b) => { upload(name, b); res(); }, 'image/jpeg', 0.92));
function recJSON(name, obj) { if (S.rec) upload(name, new Blob([JSON.stringify(obj)], { type: 'application/json' })); }
// 10 s of the finger moving: full frames (up to ~8 per second) with what the tracker said for each
async function recordFinger() {
  if (!S.rec) throw new Error('先に［記録］を入れてください');
  if (!S.bg.ready) throw new Error('背景がありません（③）');
  const rows = [], t0 = performance.now(); let i = 0, last = 0;
  recJSON('finger_setup.json', { cal: S.cal, Lm: S.Lm, dia: S.dia, skin: S.skin, gain: S.gain });
  while (performance.now() - t0 < 10000) {
    await nextFrames(1);
    phase(`指を記録しています ${((performance.now() - t0) / 1000).toFixed(0)}/10 秒（曲げ伸ばしする）`, (performance.now() - t0) / 10000);
    if (performance.now() - last < 120 || upq.length > 6) continue;
    last = performance.now(); const name = `finger_${String(i++).padStart(3, '0')}.jpg`;
    // what the tracker said for THIS frame, read before waiting for the picture to be encoded
    rows.push({ name, t: last - t0, thp: S.raw?.thp ?? null, thd: S.raw?.thd ?? null, ok: S.ok, truth: sim ? sim.angles() : null, touch: S.touch && performance.now() - S.touch.at < 300 ? { x: S.touch.x, y: S.touch.y } : null });
    await recFrameNow(name);
  }
  phase('記録をPCに送っています'); await drained();
  const kept = rows.filter((r) => uploaded.has(r.name));
  recJSON('finger.json', kept); await drained();
  ack('recFinger', true, '', { n: kept.length, lost: rows.length - kept.length });
}

// ---------------- ruler check: the real angle of a straight edge standing on the ring (Fable P1-6) ----------------
// Edges of whatever stands on the glass (triangle ruler, card) in the side view; angle to the glass for the longest lines.
async function rulerCheck(m) {
  if (!S.rect || !S.bg.ready) throw new Error('先に②③（位置・背景）を済ませてください');
  phase('定規の辺を探しています'); await nextFrames(2);
  const R = S.rect, img = rectFull(), f = T.foreground(img, { x0: 0, y0: 0, w: R.W, h: R.H }, S.bg), d = f.data, W = R.W, H = R.H;
  const pts = [];
  for (let v = 2; v < Math.min(H - 2, R.vGlass - 4); v++) for (let u = 2; u < W - 2; u++) {
    const k = v * W + u; if (d[k] < 0.5) continue;
    if (d[k - 1] < 0.5 || d[k + 1] < 0.5 || d[k - W] < 0.5 || d[k + W] < 0.5) pts.push([u, v]);
  }
  if (pts.length < 40) throw new Error('定規が見えません（○ に立てて、曲がる面に沿わせる）');
  const NA = 360, diag = Math.hypot(W, H), NR = Math.ceil(2 * diag), acc = new Uint32Array(NA * NR);
  const cs = [], sn = []; for (let a = 0; a < NA; a++) { cs.push(Math.cos(a * Math.PI / NA)); sn.push(Math.sin(a * Math.PI / NA)); }
  for (const [u, v] of pts) for (let a = 0; a < NA; a++) acc[a * NR + Math.round(u * cs[a] + v * sn[a] + diag)]++;
  const lines = [], used = new Uint8Array(acc.length);
  for (let tries = 0; tries < 6; tries++) {
    let best = -1, bi = 0; for (let i = 0; i < acc.length; i++) if (!used[i] && acc[i] > best) { best = acc[i]; bi = i; }
    if (best < 15 * R.s) break; // shorter than 15 mm
    const a = Math.floor(bi / NR), r = (bi % NR) - diag;
    for (let da = -10; da <= 10; da++) for (let dr = -6; dr <= 6; dr++) { const aa = (a + da + NA) % NA, rr = bi % NR + dr; if (rr >= 0 && rr < NR) used[aa * NR + rr] = 1; }
    // least squares on the points near this line
    const near = pts.filter(([u, v]) => Math.abs(u * cs[a] + v * sn[a] - r) < 2); if (near.length < 15) continue;
    const mu = near.reduce((s, p) => [s[0] + p[0] / near.length, s[1] + p[1] / near.length], [0, 0]);
    let sxx = 0, sxy = 0, syy = 0; for (const [u, v] of near) { sxx += (u - mu[0]) ** 2; sxy += (u - mu[0]) * (v - mu[1]); syy += (v - mu[1]) ** 2; }
    const th = 0.5 * Math.atan2(2 * sxy, sxx - syy); // direction of the line in the side view (u along the glass, v down)
    let deg = Math.abs(th * 180 / Math.PI); if (deg > 90) deg = 180 - deg; // angle to the glass, 0..90
    if (deg < 5) continue; // the glass itself / the finger lying on it
    lines.push({ deg, lenMm: near.length / R.s });
  }
  if (!lines.length) throw new Error('まっすぐな辺が見つかりません');
  const truth = m.truth, best = truth ? lines.reduce((a, b) => (Math.abs(b.deg - truth) < Math.abs(a.deg - truth) ? b : a)) : lines[0];
  ack('ruler', true, '', { truth, read: best.deg, lines });
}
function latencyFrame() {
  const c = S.center; S.latLo = Math.min(S.latLo * 0.99 + c * 0.01, c); S.latHi = Math.max(S.latHi * 0.99 + c * 0.01, c);
  if (S.latHi - S.latLo < 25) return;
  const white = c > (S.latLo + S.latHi) / 2;
  if (S.latWhite !== null && white !== S.latWhite) toMon({ type: 'lat-edge', t: performance.now(), white });
  S.latWhite = white;
}
window.phone = { S, get sim() { return sim; } };
