// The iPhone's side of "the fist comes closer, the finger goes in": it stands on a stand and looks down at the iPad and the hand.
// It finds the bright dots the iPad shows (where the screen is), then the hand, and sends a few numbers per picture. No picture leaves the phone.
import { Link } from './link.js?v=4';
import { homography, apply, poseFrom, riseOf, findDot, palmOf } from './geom.js?v=4';
const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3', $ = (s) => document.querySelector(s), q = new URLSearchParams(location.search), room = q.get('room'), SIM = q.has('sim');
const S = { od: null, at: null, link: null, lm: null, gpu: null, pad: null, padAt: -1e9, cal: null, pose: null, seen: null, fps: 0, ms: 0, err: '', still: undefined, gv: null, gh: [], tS: 0, last: 0, n: 0, bad: 0 };
const video = $('#v'), view = $('#view'), ctx = view.getContext('2d'), small = document.createElement('canvas'), sctx = small.getContext('2d', { willReadFrequently: true });
if (!room) { $('#say').textContent = 'iPadに出るQRコードを、カメラで読み取ってください。'; $('#go').hidden = true; }

$('#go').onclick = async () => {
  $('#go').disabled = true; $('#go').textContent = '許可を待っています';
  const full = () => { try { const e = document.documentElement, f = e.requestFullscreen || e.webkitRequestFullscreen; if (f && !(document.fullscreenElement || document.webkitFullscreenElement)) Promise.resolve(f.call(e)).catch(() => {}); } catch {} };
  try { const M = window.DeviceMotionEvent; if (M?.requestPermission) await M.requestPermission(); } catch {} // only to notice when the phone is moved
  try { if (!SIM) { video.srcObject = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 60 } }, audio: false }); await video.play(); } }
  catch (e) { $('#go').disabled = false; $('#go').textContent = 'もう一度'; $('#say').textContent = `カメラを許可してください（${e.name}）`; return; }
  try { navigator.wakeLock?.request('screen').catch(() => {}); } catch {}
  addEventListener('devicemotion', moved);
  S.link = new Link(room, 'b', (k, d) => { if (k === 'data' && d.k === 'pad') { S.pad = d; S.padAt = performance.now(); } else if (k === 'taken') S.err = '別の画面で開かれました'; }); S.link.allowed(); window.phone = S;
  full(); addEventListener('click', full); // where the browser allows it (not Safari on the iPhone: there the page is added to the home screen)
  $('#start').hidden = true; $('#live').hidden = false; run(); if (SIM) S.lm = 'sim'; else load().catch((e) => { S.err = `手の認識が使えません（${e.message || e}）`; });
};
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') try { navigator.wakeLock?.request('screen').catch(() => {}); } catch {} });

// ---------- the hand model ----------
let make = null;
async function load() {
  const { HandLandmarker, FilesetResolver } = await import(`${MP}/vision_bundle.mjs`), fs = await FilesetResolver.forVisionTasks(`${MP}/wasm`);
  // a fist seen from above is hard for it: it may be less sure than usual, and follows from picture to picture
  make = (delegate) => HandLandmarker.createFromOptions(fs, { baseOptions: { modelAssetPath: new URL('../models/hand_landmarker.task', location.href).href, delegate }, runningMode: 'VIDEO', numHands: 1, minHandDetectionConfidence: 0.2, minHandPresenceConfidence: 0.2, minTrackingConfidence: 0.2 });
  try { if (q.get('cpu')) throw 0; S.lm = await make('GPU'); S.gpu = true; } catch { S.lm = await make('CPU'); S.gpu = false; }
}
// ---------- is the phone standing still ----------
function moved(e) {
  const g = e.accelerationIncludingGravity, n = g && Math.hypot(g.x, g.y, g.z); if (!n || n < 5) return; const t = performance.now(), v = [g.x / n, g.y / n, g.z / n], ang = (a, b) => Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * 180 / Math.PI;
  S.gv = S.gv ? S.gv.map((x, i) => x + (v[i] - x) * 0.2) : v; S.gh.push({ t, v: [...S.gv] }); while (t - S.gh[0].t > 1000) S.gh.shift();
  S.still = S.gh.length > 10 && t - S.gh[0].t > 700 && S.gh.every((h) => ang(h.v, S.gv) < 1.2); if (S.pose?.g && ang(S.pose.g, S.gv) > 3) S.pose = null; // moved: the place of the screen must be found again
}
// ---------- pictures ----------
const size = () => (SIM ? [1280, 720] : [video.videoWidth, video.videoHeight]);
function grey() {
  const [vw, vh] = size(), w = 480, h = Math.max(2, Math.round(480 * vh / vw)); if (SIM) return sim.grey(w, h, vw, vh);
  if (small.width !== w || small.height !== h) { small.width = w; small.height = h; } sctx.drawImage(video, 0, 0, w, h); const p = sctx.getImageData(0, 0, w, h).data, d = new Uint8Array(w * h); for (let i = 0, j = 0; i < d.length; i++, j += 4) d[i] = (p[j] * 77 + p[j + 1] * 150 + p[j + 2] * 29) >> 8; return { d, w, h, sx: vw / w, sy: vh / h };
}
// ---------- where the screen is: the iPad shows a dark screen, then one bright dot after the other ----------
function calib(c, t) {
  let k = S.cal; if (!k || k.id !== c.id) { k = S.cal = { id: c.id, i: null, found: [], ref: null, t, done: false, res: null, tP: 0 }; S.pose = null; }
  if (c.i >= c.pts.length) { if (!k.res) k.res = solve(k, c); if (t - k.tP > 200) { k.tP = t; S.link.data({ k: 'p', id: c.id, ...k.res }); } return; }
  if (k.i !== c.i) { k.i = c.i; k.t = t; k.done = false; k.cand = null; }
  if (!k.done && t - k.t > (c.i < 0 ? 450 : 230)) { // the screen and the camera need a moment; a dot counts when two pictures show it at the same place (something moving does not)
    const g = grey(); if (c.i < 0) { k.ref = g; k.done = true; } else if (k.ref && k.ref.w === g.w && k.ref.h === g.h) { const d = findDot(g.d, k.ref.d, g.w, g.h), was = k.cand; k.cand = d; if (d && was && Math.hypot(d.x - was.x, d.y - was.y) < 1.5) { k.found[c.i] = [(d.x + was.x) / 2 * g.sx, (d.y + was.y) / 2 * g.sy]; k.done = true; } }
  }
  if (k.done) S.link.data({ k: 'a', id: c.id, i: c.i });
}
function solve(k, c) {
  const img = k.found, [vw, vh] = size(); if (img.filter(Boolean).length < c.pts.length) return { ok: false, why: '点が全部は見えませんでした' };
  const Hs = homography(c.pts, img), Hi = homography(img, c.pts); if (!Hs || !Hi) return { ok: false, why: '点の並びが読めませんでした' };
  const err = Math.sqrt(c.pts.reduce((s, p, j) => { const a = apply(Hi, img[j]); return s + (a[0] - p[0]) ** 2 + (a[1] - p[1]) ** 2; }, 0) / c.pts.length), P = poseFrom(Hs, vw, vh), ok = P.ok && err < 3;
  if (ok) S.pose = { id: c.id, Hs, Hi, P, half: c.half, g: S.gv && [...S.gv], vw, vh, err };
  return { ok, why: err >= 3 ? '点の並びが合いません（画面に光が映っていませんか）' : 'iPhoneの位置が出せません', C: P.C.map((v) => +v.toFixed(1)), err: +err.toFixed(2), f: Math.round(P.f), guessed: P.guessed };
}
// ---------- one picture ----------
function frame(t) {
  const dt = t - S.last; S.last = t; if (dt > 0 && dt < 1000) S.fps += (1000 / dt - S.fps) * 0.1; S.n++;
  const pad = t - S.padAt < 3000 ? S.pad : null, [vw, vh] = size(); if (S.pose && (S.pose.vw !== vw || S.pose.vh !== vh)) S.pose = null; // turned: another picture
  if (pad?.cal) { calib(pad.cal, t); S.seen = null; }
  else if (S.lm && vw) {
    S.cal = null; let L = null, Wd = null; const t0 = performance.now();
    if (SIM) [L, Wd] = sim.hand(vw, vh); else try { const r = S.lm.detectForVideo(video, t); L = r.landmarks?.[0] || null; Wd = r.worldLandmarks?.[0] || null; S.bad = 0; } catch (e) { if (++S.bad > 3 && S.gpu && make) { S.gpu = false; S.lm = null; make('CPU').then((m) => { S.lm = m; }).catch((x) => { S.err = `手の認識が使えません（${x.message || x}）`; }); } }
    S.ms += (performance.now() - t0 - S.ms) * 0.1; S.seen = L; const P = S.pose;
    if (P && S.link.way) {
      const id = pad?.lm ?? 6, s = L && palmOf(L, vw, vh);
      if (!L) S.od = null;
      if (L && s) { const [u, v] = steady(L, id, vw, vh), g = apply(P.Hi, [u, v]); S.link.data({ k: 'h', t, pid: P.id, g: [+g[0].toFixed(2), +g[1].toFixed(2)], dz: +riseOf(P.P, u, v).toFixed(5), Z: +(1000 * P.P.f / s).toFixed(1) }); } else S.link.data({ k: 'h', t, pid: P.id, none: 1 });
    }
  }
  if (t - S.tS > 300 && S.link.way) { S.tS = t; S.link.data({ k: 's', ready: !!S.lm, still: S.still, err: S.err, fps: Math.round(S.fps), ms: Math.round(S.ms), gpu: S.gpu, pose: S.pose?.id || 0 }); }
  if (S.n % 2 === 0) draw(pad, vw, vh);
}
// The joint that touches is under the hand: the model guesses it, and the guess jumps. The four knuckles on the back of the hand are seen well.
// So the place moves with the middle of the knuckles; where the joint lies from there is followed slowly (about half a second).
function steady(L, id, vw, vh) {
  const K = [5, 9, 13, 17], mx = K.reduce((a, j) => a + L[j].x, 0) / 4 * vw, my = K.reduce((a, j) => a + L[j].y, 0) / 4 * vh, d = [L[id].x * vw - mx, L[id].y * vh - my];
  S.od = S.od ? [S.od[0] + (d[0] - S.od[0]) * 0.07, S.od[1] + (d[1] - S.od[1]) * 0.07] : d; return (S.at = [mx + S.od[0], my + S.od[1]]);
}
function run() {
  const safe = (t) => { try { frame(t); } catch (e) { S.err = e.message; } };
  if (SIM) setInterval(() => safe(performance.now()), 33); else if (video.requestVideoFrameCallback) { const f = (t) => { safe(t); video.requestVideoFrameCallback(f); }; video.requestVideoFrameCallback(f); } else { const f = (t) => { safe(t); requestAnimationFrame(f); }; requestAnimationFrame(f); }
}
// ---------- what the person sees on the phone: the picture, the screen found in it, the hand, one line ----------
function draw(pad, vw, vh) {
  const L = S.link, way = L.way, P = S.pose, msg = S.err ? S.err : !way ? (L.peer ? 'iPadとつないでいます' : 'iPadを探しています') : !S.lm ? '手の認識を読み込んでいます' : pad?.cal ? '合わせています（手をどける）' : !P ? 'iPadの画面全体が写るように置く（横向き）' : !S.seen ? 'OK（手はまだ見えません）' : 'OK（手が見えています）';
  if ($('#state').textContent !== msg) { $('#state').textContent = msg; document.body.classList.toggle('ok', msg.startsWith('OK')); }
  $('#sub').textContent = `${way === 'direct' ? '直接' : way === 'relay' ? '中継' : '—'}・${S.fps.toFixed(0)} コマ/秒・手 ${S.ms.toFixed(0)} ms${S.gpu === false ? '（CPU）' : ''}・${vw}×${vh}${P ? `・ずれ ${solveErr(P)} mm` : ''}`;
  if (!vw) return; const w = Math.min(vw, 1280), h = Math.round(w * vh / vw), k = w / vw, u = w / 480; if (view.width !== w || view.height !== h) { view.width = w; view.height = h; }
  if (SIM) { ctx.fillStyle = '#123'; ctx.fillRect(0, 0, w, h); } else ctx.drawImage(video, 0, 0, w, h);
  if (P) { const c = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => apply(P.Hs, [a * P.half[0], b * P.half[1]])); ctx.strokeStyle = '#4fd58a'; ctx.lineWidth = 3 * u; ctx.beginPath(); c.forEach((p, i) => ctx[i ? 'lineTo' : 'moveTo'](p[0] * k, p[1] * k)); ctx.closePath(); ctx.stroke(); }
  if (S.cal) { ctx.fillStyle = '#ffd24a'; for (const p of S.cal.found) if (p) { ctx.beginPath(); ctx.arc(p[0] * k, p[1] * k, 5 * u, 0, 7); ctx.fill(); } }
  if (S.seen) { const id = pad?.lm ?? 6; if (S.at && S.pose) { ctx.strokeStyle = '#ff4a3d'; ctx.lineWidth = 2 * u; ctx.beginPath(); ctx.arc(S.at[0] * k, S.at[1] * k, 13 * u, 0, 7); ctx.stroke(); } S.seen.forEach((p, i) => { ctx.fillStyle = i === id ? '#ff4a3d' : '#ffffff'; ctx.beginPath(); ctx.arc(p.x * w, p.y * h, (i === id ? 8 : 3) * u, 0, 7); ctx.fill(); }); }
}
const solveErr = (P) => (P.err ?? 0).toFixed(1);

// ---------- without a camera (tests on a PC): a made-up camera that sees the dots the iPad says it shows, and a made-up hand ----------
// window.simHand = [x, y, z]: the point of the hand in the screen frame (mm), or null. window.simSize: this hand is so much larger than the model's.
const sim = SIM && (() => {
  const C = [-200, -250, 300], f = 1000, n = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); }, cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], z = n(C.map((v) => -v)), x = n(cross(z, [0, 0, 1])), y = cross(z, x);
  const px = (P, vw, vh) => { const d = P.map((v, i) => v - C[i]), Z = dot(d, z); return [vw / 2 + f * dot(d, x) / Z, vh / 2 + f * dot(d, y) / Z, Z]; };
  window.simHand = null; window.simSize = 1.12; let s = 5; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  return {
    grey(w, h, vw, vh) { const d = new Uint8Array(w * h); for (let i = 0; i < d.length; i++) d[i] = 24 + rnd() * 6; const c = S.pad?.cal, p = c && c.pts[c.i]; if (p) { const [u, v] = px([p[0], p[1], 0], vw, vh), X = u * w / vw, Y = v * h / vh; for (let b = Math.max(0, Math.floor(Y - 8)); b < Math.min(h, Y + 8); b++) for (let a = Math.max(0, Math.floor(X - 8)); a < Math.min(w, X + 8); a++) { const r = Math.hypot(a + 0.5 - X, b + 0.5 - Y); d[b * w + a] = Math.min(255, d[b * w + a] + 170 * Math.max(0, Math.min(1, 4.5 - r))); } } return { d, w, h, sx: vw / w, sy: vh / h }; },
    hand(vw, vh) { const H = window.simPath ? window.simPath(Date.now()) : window.simHand; if (!H) return [null, null]; const [u, v, Z] = px(H, vw, vh), k = f / Z * 1000 * window.simSize, L = [], Wd = []; for (let i = 0; i < 21; i++) { const a = 0.02 * Math.cos(i), b = 0.02 * Math.sin(i * 1.7); Wd.push({ x: a, y: b, z: 0 }); L.push({ x: (u + a * k + (rnd() - 0.5) * 1.5) / vw, y: (v + b * k + (rnd() - 0.5) * 1.5) / vh }); } const id = S.pad?.lm ?? 6; L[id] = { x: (u + (rnd() - 0.5) * 1.5) / vw, y: (v + (rnd() - 0.5) * 1.5) / vh }; return [L, Wd]; },
  };
})();
