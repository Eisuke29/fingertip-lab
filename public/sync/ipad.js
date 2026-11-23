// iPad: the place for the finger only. No text, no buttons. Everything is controlled from the PC.
// It shows the experience, or (when the iPhone asks) the calibration dots / grid, and reports its own geometry
// and tilt (accelerometer) to the PC.
import { Display } from './display.js';
import { EyeTracker } from './eye.js';
import { connect } from './wslink.js';
import { drawPattern } from './pattern.js';
import { boot } from './boot.js';

const $ = (s) => document.querySelector(s);
const STORE = 'syncIpad.v5';
// iPad (A16) landscape: 0.1924 mm per CSS px. The ring is at the centre of the screen.
const st = { mmPerPx: 0.1924, Lm: 25, Ld: 22, dia: 15, eye: { x: 0, y: -100, z: 460 }, hfov: 90 };
try { Object.assign(st, JSON.parse(localStorage.getItem(STORE) || '{}')); } catch {}
const save = () => { try { localStorage.setItem(STORE, JSON.stringify(st)); } catch {} };

const P = { pose: null, poseAt: 0, finger: false, eyeOn: false, tilt: null, tapped: false, screenKind: 'scene' };
const display = new Display($('#display'));
const eye = new EyeTracker();
const Wmm = () => innerWidth * st.mmPerPx, Hmm = () => innerHeight * st.mmPerPx;
const toMon = (m) => link?.send({ ...m, to: 'monitor' });
const VERSION = await boot();

const link = connect('ipad', VERSION, {
  onOpen: () => report(),
  onOld: () => location.reload(), // the iPad never runs a job itself, so reloading is always safe
  onData: (m) => {
    if (m.type === 'pose') { P.pose = m; P.poseAt = performance.now(); return; }
    if (m.type === 'show') return show(m);
    if (m.type === 'ipad') return control(m);
    if (m.type === 'still') { P.zone = m.poly; freeze(); return; }
  },
});

// ---------------- report geometry + tilt to the PC ----------------
function report() {
  toMon({ type: 'ipadinfo', version: VERSION, Wmm: Wmm(), Hmm: Hmm(), pip: { x: 0, y: 0 }, mmPerPx: st.mmPerPx, tilt: P.tilt, tapped: P.tapped, eyeOn: P.eyeOn, eyeStatus: P.eyeOn ? eye.status : '', finger: P.finger, w: innerWidth, h: innerHeight });
}
setInterval(report, 1000);
$('#tap').addEventListener('pointerdown', async () => {
  $('#tap').remove(); P.tapped = true;
  try { const d = document.documentElement; await (d.requestFullscreen || d.webkitRequestFullscreen)?.call(d); } catch {}
  try { if (typeof DeviceMotionEvent?.requestPermission === 'function') await DeviceMotionEvent.requestPermission(); } catch {}
  addEventListener('devicemotion', (e) => {
    const g = e.accelerationIncludingGravity; if (!g || g.z == null) return;
    const n = Math.hypot(g.x, g.y, g.z); if (n < 5) return;
    const t = Math.acos(Math.min(1, Math.abs(g.z) / n)) * 180 / Math.PI; // 0 = flat on the table, 90 = upright
    P.tilt = P.tilt == null ? t : P.tilt * 0.9 + t * 0.1;
  });
  try { await navigator.wakeLock?.request('screen'); } catch {}
  report();
}, { once: true });

// ---------------- commands from the PC ----------------
async function control(m) {
  if (m.finger != null) P.finger = !!m.finger;
  if (m.mode) show({ kind: m.mode }, false);
  if (m.mmPerPx) { st.mmPerPx = m.mmPerPx; save(); layout(); }
  if (m.card != null) { const c = $('#card'); if (m.card) { const w = 85.6 / st.mmPerPx; c.style.width = w + 'px'; c.style.height = (w * 54 / 85.6) + 'px'; c.style.display = 'block'; } else c.style.display = 'none'; }
  if (m.eye != null && m.eye !== P.eyeOn) {
    P.eyeOn = m.eye;
    if (P.eyeOn) { try { await eye.start('user'); } catch (e) { P.eyeOn = false; eye.status = `前面カメラを使えません：${e.message}`; } } else eye.stop();
  }
  if (m.sweep) P.sweepUntil = performance.now() + 4500;
  if (m.flash != null) { const f = $('#flash'); f.style.display = m.flash === 'off' ? 'none' : 'block'; f.style.background = m.flash === 'white' ? '#fff' : '#000'; requestAnimationFrame((t) => toMon({ type: 'flashed', t, white: m.flash === 'white' })); }
  report();
}

// ---------------- what the screen shows for the camera (black / dot / grid) or the experience ----------------
const cc = $('#cal'), cx = cc.getContext('2d');
let lastShow = { kind: 'scene' };
function show(m, reply = true) {
  P.screenKind = m.kind; lastShow = m;
  if (m.kind === 'scene') cc.hidden = true;
  else {
    cc.hidden = false; const dpr = devicePixelRatio || 1;
    cc.width = Math.round(innerWidth * dpr); cc.height = Math.round(innerHeight * dpr);
    drawPattern(cx, cc.width, cc.height, m, innerWidth, innerHeight, st.mmPerPx);
  }
  if (reply) requestAnimationFrame(() => requestAnimationFrame(() => link.send({ type: 'shown', id: m.id, kind: m.kind, to: 'phone' })));
}

// ---------------- the experience ----------------
function layout() {
  display.layout({ mmPerPx: st.mmPerPx, pipFrac: { x: 0.5, y: 0.5 }, Lm: st.Lm, Ld: st.Ld, dia: st.dia, fullBox: true, sideLight: true });
  eye.configure({ hfov: st.hfov, camPos: { x: 0, y: display.Hm / 2 + 10, z: 0 } });
}
addEventListener('resize', () => { layout(); freeze(); if (lastShow.kind !== 'scene') show(lastShow, false); report(); });
function loop() {
  const p = P.pose, fresh = p && performance.now() - P.poseAt < 500;
  if (performance.now() < (P.sweepUntil || 0)) { // check from the PC: only the picture moves, the real finger stays still
    const s = performance.now() / 1000; display.setFingerVisible(true); display.setPose(75 + 30 * Math.sin(s * 2.1), 35 + 30 * Math.sin(s * 3.3), true);
  } else {
    display.setFingerVisible(P.finger);
    if (p) display.setPose(p.fthp ?? p.thp, p.fthd ?? p.thd, !!(fresh && p.ok)); else display.setPose(70, 25, false);
  }
  // the eye position decides how the recess looks; by default straight in front of the screen
  display.render(P.eyeOn && eye.eye ? eye.eye : st.eye);
  requestAnimationFrame(loop);
}
layout(); requestAnimationFrame(loop);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') try { navigator.wakeLock?.request('screen').catch(() => {}); } catch {} });
// ---------------- the part of the screen behind the finger (seen by the camera) is kept still (Fable P1-5) ----------------
const sc = $('#still'), sx = sc.getContext('2d');
function freeze() {
  const dpr = devicePixelRatio || 1; sc.width = Math.round(innerWidth * dpr); sc.height = Math.round(innerHeight * dpr);
  sx.clearRect(0, 0, sc.width, sc.height); if (!P.zone?.length) return;
  // render once without the virtual finger and copy that area over the live picture
  display.setFingerVisible(false); display.render(P.eyeOn && eye.eye ? eye.eye : st.eye);
  const X = (x) => (innerWidth / 2 + x / st.mmPerPx) * dpr, Y = (y) => (innerHeight / 2 - y / st.mmPerPx) * dpr;
  sx.save(); sx.beginPath(); P.zone.forEach((q, i) => (i ? sx.lineTo(X(q.x), Y(q.y)) : sx.moveTo(X(q.x), Y(q.y)))); sx.closePath(); sx.clip();
  sx.drawImage($('#display'), 0, 0, sc.width, sc.height); sx.restore();
}
// ---------------- touch: is something on the glass, and where (mm from the ring) ----------------
let touchSent = 0;
function sendTouch(e, on) {
  const now = performance.now(); if (on && now - touchSent < 50) return; touchSent = now;
  const x = (e.clientX - innerWidth / 2) * st.mmPerPx, y = (innerHeight / 2 - e.clientY) * st.mmPerPx;
  link.send({ type: 'touch', to: ['phone', 'monitor'], on, x, y, w: (e.width || 0) * st.mmPerPx, h: (e.height || 0) * st.mmPerPx });
}
addEventListener('pointerdown', (e) => sendTouch(e, true));
addEventListener('pointermove', (e) => { if (e.buttons || e.pointerType === 'touch') sendTouch(e, true); });
addEventListener('pointerup', (e) => sendTouch(e, false));
addEventListener('pointercancel', (e) => sendTouch(e, false));
window.ipad = { P, st, display };
