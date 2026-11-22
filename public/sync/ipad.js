// iPad: the place for the finger only. No text, no buttons. Everything is controlled from the PC.
// It shows the experience, or (when the iPhone asks) the calibration dots / grid, and reports its own geometry
// and tilt (accelerometer) to the PC.
import { Display } from './display.js';
import { EyeTracker } from './eye.js';
import { connect } from './wslink.js';

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
const toMon = (m) => link.send({ ...m, to: 'monitor' });

const link = connect('local', 'ipad', {
  onOpen: () => report(),
  onData: (m) => {
    if (m.type === 'pose') { P.pose = m; P.poseAt = performance.now(); return; }
    if (m.type === 'show') return show(m);
    if (m.type === 'ipad') return control(m);
  },
});

// ---------------- report geometry + tilt to the PC ----------------
function report() {
  toMon({ type: 'ipadinfo', Wmm: Wmm(), Hmm: Hmm(), pip: { x: 0, y: 0 }, mmPerPx: st.mmPerPx, tilt: P.tilt, tapped: P.tapped, eyeOn: P.eyeOn, eyeStatus: P.eyeOn ? eye.status : '', finger: P.finger, w: innerWidth, h: innerHeight });
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
  if (m.flash != null) { const f = $('#flash'); f.style.display = m.flash === 'off' ? 'none' : 'block'; f.style.background = m.flash === 'white' ? '#fff' : '#000'; requestAnimationFrame((t) => toMon({ type: 'flashed', t, white: m.flash === 'white' })); }
  report();
}

// ---------------- what the screen shows for the camera (black / dot / grid) or the experience ----------------
const cc = $('#cal'), cx = cc.getContext('2d');
function show(m, reply = true) {
  P.screenKind = m.kind;
  if (m.kind === 'scene') cc.hidden = true;
  else {
    cc.hidden = false; cc.width = innerWidth; cc.height = innerHeight;
    const k = 1 / st.mmPerPx, X = (x) => (x + Wmm() / 2) * k, Y = (y) => (Hmm() / 2 - y) * k;
    cx.fillStyle = '#000'; cx.fillRect(0, 0, cc.width, cc.height);
    if (m.kind === 'dot') { cx.fillStyle = '#fff'; cx.beginPath(); cx.arc(X(m.x), Y(m.y), 7 * k, 0, 7); cx.fill(); }
    if (m.kind === 'grid') {
      cx.strokeStyle = '#ffffff'; cx.lineWidth = 2;
      for (let x = -100; x <= 100; x += 20) { cx.beginPath(); cx.moveTo(X(x), 0); cx.lineTo(X(x), cc.height); cx.stroke(); }
      for (let y = -60; y <= 60; y += 20) { cx.beginPath(); cx.moveTo(0, Y(y)); cx.lineTo(cc.width, Y(y)); cx.stroke(); }
      cx.strokeStyle = '#ff4d4d'; cx.lineWidth = 4; cx.beginPath(); cx.arc(X(0), Y(0), 10 * k, 0, 7); cx.stroke();
    }
  }
  if (reply) requestAnimationFrame(() => requestAnimationFrame(() => link.send({ type: 'shown', kind: m.kind, to: 'phone' })));
}

// ---------------- the experience ----------------
function layout() {
  display.layout({ mmPerPx: st.mmPerPx, pipFrac: { x: 0.5, y: 0.5 }, Lm: st.Lm, Ld: st.Ld, dia: st.dia, fullBox: true, sideLight: true });
  eye.configure({ hfov: st.hfov, camPos: { x: 0, y: display.Hm / 2 + 10, z: 0 } });
}
addEventListener('resize', () => { layout(); if (P.screenKind !== 'scene') show({ kind: P.screenKind }, false); report(); });
function loop() {
  const p = P.pose, fresh = p && performance.now() - P.poseAt < 500;
  display.setFingerVisible(P.finger);
  if (p) display.setPose(p.fthp ?? p.thp, p.fthd ?? p.thd, !!(fresh && p.ok)); else display.setPose(70, 25, false);
  // the eye position decides how the recess looks; by default straight in front of the screen
  display.render(P.eyeOn && eye.eye ? eye.eye : st.eye);
  requestAnimationFrame(loop);
}
layout(); requestAnimationFrame(loop);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') try { navigator.wakeLock?.request('screen').catch(() => {}); } catch {} });
window.ipad = { P, st, display };
