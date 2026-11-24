// MP stroking on the iPad itself. The hand is a fist with the back of the index finger's proximal phalanx on the glass; only the hand slides.
// touch -> where the knuckle is, motion sensor -> how the iPad stands, front camera -> where the eyes are. No server, no PC.
import { OneEuro } from '../sync/tracker.js';
import { Contact, Tilt, Eye, makeEyes, eyeFrom, eyeToWorld, upOf } from './sensors.js';
import { MATS, RF, Tip, solve, restTip, grain, seenAt, add, toHand, sideOf } from './finger.js';
import { Scene } from './scene.js';

const $ = (s) => document.querySelector(s), now = () => performance.now(), rad = (d) => d * Math.PI / 180, val = (id) => +$(id).value;
const MM = 0.1924, MP_H = 11, LEN = [42, 25, 22], STORE = 'mpIpad.v1'; // mm per CSS px (264 ppi iPads); height of the MP joint above the glass; phalanges
const O = { mat: 'catchy', kind: 'finger', bend: 'whole', hand: 'right', eye: 'track', cam: 'top' };
const saved = (() => { try { return JSON.parse(localStorage.getItem(STORE) || '{}'); } catch { return {}; } })();
const S = { started: false, ready: false, raw: [], cancels: 0, root: null, contact: new Contact(), tilt: new Tilt(), eye: new Eye(), eyes: null, zScale: saved.zScale || 1, tip: new Tip(), bob: 0, f: null, fps: 0, rec: null, err: '' };
const fx = new OneEuro(3, 0.15), fy = new OneEuro(3, 0.15);
const landscape = () => innerWidth > innerHeight;

// ---------- touch ----------
const onUi = (t) => !!t.target?.closest?.('.btn, .ui');
const mm = (t) => ({ id: t.identifier ?? -1, x: (t.clientX - innerWidth / 2) * MM, y: (innerHeight / 2 - t.clientY) * MM, rx: (t.radiusX || 0) * MM, ry: (t.radiusY || 0) * MM });
function read(e) { if (e.type === 'touchcancel') S.cancels++; S.raw = [...e.touches].filter((t) => !onUi(t)).map(mm); if (e.cancelable && !onUi(e)) e.preventDefault(); }
for (const n of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) addEventListener(n, read, { passive: false });
for (const n of ['gesturestart', 'contextmenu', 'dblclick']) addEventListener(n, (e) => e.preventDefault());
addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse' && !onUi(e)) S.raw = [mm(e)]; }); // to try it on a PC
addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' && e.buttons && S.raw.length) S.raw = [mm(e)]; });
addEventListener('pointerup', (e) => { if (e.pointerType === 'mouse') S.raw = []; });

// ---------- start: tilt, then eyes, then the hand ----------
const item = (id, ok, v, ng) => { const e = $(id); e.classList.toggle('ok', !!ok); e.classList.toggle('ng', !!ng); e.querySelector('.v').textContent = v; };
$('#go').onclick = async () => {
  if (S.ready) { $('#start').hidden = true; S.started = true; return; }
  $('#go').disabled = true; $('#go').textContent = '測っています'; $('#noeye').hidden = false;
  try { // must be asked inside the tap
    if (typeof DeviceMotionEvent === 'undefined') throw new Error('この端末に傾きセンサーがありません');
    if (DeviceMotionEvent.requestPermission && await DeviceMotionEvent.requestPermission() !== 'granted') throw new Error('傾きセンサーが許可されていません。ページを開き直して［許可］を押してください');
    addEventListener('devicemotion', (e) => { const g = e.accelerationIncludingGravity; if (g && g.z != null) S.tilt.add(g, landscape(), now()); });
  } catch (e) { S.tiltErr = e.message; }
  try { if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen(); } catch {}
  try { navigator.wakeLock?.request('screen').catch(() => {}); } catch {}
  if (O.eye === 'track') startEyes();
  S.asked = now();
};
$('#noeye').onclick = () => { O.eye = 'fixed'; S.eyes?.stop(); syncSeg('#eyes', 'eye'); $('#noeye').hidden = true; };
$('#again').onclick = () => location.reload();
async function startEyes() {
  S.eyeErr = '';
  try { S.eyes ||= await makeEyes(); cameraPlace(); await S.eyes.start('user'); if (O.eye !== 'track') S.eyes.stop(); } catch (e) { S.eyeErr = e.message || String(e); }
}
// held sideways the camera is in the middle of the long upper edge (newer iPads) or of a short edge (older ones), outside the page (toolbar and bezel)
function cameraPlace() {
  const full = Math.min(screen.width, screen.height), gap = landscape() ? Math.max(0, Math.min(120, full - innerHeight)) : 0;
  const s = { left: -1, right: 1 }[O.cam]; S.eyes?.configure({ hfov: 70, camPos: s ? { x: s * (innerWidth * MM / 2 + 9), y: gap * MM / 2, z: 0 } : { x: 0, y: innerHeight * MM / 2 + gap * MM + 9, z: 0 } });
}
function startScreen() {
  const tl = S.tilt, deg = tl.deg == null ? null : `${tl.deg.toFixed(1)}°`;
  item('#cTilt', tl.deg != null && tl.still, deg ? (tl.still ? deg : tl.moving ? `${deg} 動いています` : `${deg} 測っています`) : S.tiltErr || (S.asked ? '値を待っています' : '—'), S.tiltErr || (deg && tl.moving));
  const m = measured(); if (O.eye === 'track') item('#cEye', !!m, m ? `${Math.round(Math.hypot(...m) / 10)} cm` : S.eyeErr || (S.asked ? S.eyes?.status || '準備しています' : '—'), !!S.eyeErr); else item('#cEye', true, '追従しない');
  item('#cHand', !!S.contact.p, S.contact.p ? '触れています' : 'このあと');
  const ok = (tl.still || S.tiltErr || (S.asked && now() - S.asked > 6000)) && (O.eye !== 'track' || m);
  if (S.asked && ok && !S.ready) { S.ready = true; $('#go').textContent = 'はじめる'; }
  if (S.ready) { $('#go').disabled = !(O.eye !== 'track' || m); $('#noeye').hidden = O.eye !== 'track'; }
  if (S.asked && S.tiltErr) $('#sMsg').textContent = `${S.tiltErr}。傾きは26°として進みます。`; else if (S.eyeErr && O.eye === 'track') $('#sMsg').textContent = `前面カメラを使えません（${S.eyeErr}）。［視線追従なしで進む］を押せます。`;
}
// ---------- eye ----------
const tiltDeg = () => S.tilt.deg ?? 26; // only when the sensor cannot be used
function measured() { const e = S.eyes; return O.eye === 'track' && e?.fresh ? [e.eye.x, e.eye.y, e.eye.z * S.zScale] : null; }
const fallback = () => eyeFrom(tiltDeg(), val('#eb'), val('#eh'), O.eye === 'fixed' ? val('#ex') : 0);
$('#cal').onclick = () => {
  const m = measured(); if (!m) { flash('顔が見えていません'); return; }
  const rest = Math.hypot(m[0], m[1]), z = Math.sqrt(Math.max(100, 400 * 400 - rest * rest)); S.zScale = Math.max(0.4, Math.min(2.5, S.zScale * z / m[2]));
  try { localStorage.setItem(STORE, JSON.stringify({ zScale: S.zScale, cam: O.cam })); } catch {} flash('40cmに合わせました');
};
let flashT = 0, flashM = ''; function flash(t) { flashM = t; flashT = now() + 2500; }

// ---------- settings ----------
function seg(id, list, key, f) { $(id).innerHTML = list.map(([k, t]) => `<button class="btn ui" data-k="${k}">${t}</button>`).join(''); for (const b of $(id).children) b.onclick = () => { O[key] = b.dataset.k; syncSeg(id, key); f?.(); }; syncSeg(id, key); }
function syncSeg(id, key) { for (const b of $(id).children) b.setAttribute('aria-pressed', b.dataset.k === O[key]); }
seg('#mats', Object.entries(MATS).map(([k, m]) => [k, m.name]), 'mat', () => S.tip.reset()); seg('#kinds', [['finger', '指'], ['stick', '棒'], ['cursor', 'カーソル']], 'kind'); seg('#bends', [['whole', '全体がしなる'], ['distal', '末節だけ']], 'bend');
seg('#hands', [['right', '右手'], ['left', '左手']], 'hand', () => { S.contact = new Contact(O.hand); $('#yaw').value = O.hand === 'right' ? 16 : -16; labels(); });
seg('#eyes', [['track', '視線追従'], ['fixed', '追従しない']], 'eye', () => { if (O.eye === 'track') startEyes(); else S.eyes?.stop(); });
if (saved.cam) O.cam = saved.cam;
seg('#cams', [['top', '上'], ['left', '左'], ['right', '右']], 'cam', () => { cameraPlace(); try { localStorage.setItem(STORE, JSON.stringify({ zScale: S.zScale, cam: O.cam })); } catch {} });
$('#set').onclick = () => { $('#panel').hidden = !$('#panel').hidden; };
const labels = () => { for (const i of document.querySelectorAll('#panel input')) i.previousElementSibling.textContent = `${i.value}${i.dataset.u}`; };
for (const i of document.querySelectorAll('#panel input')) i.oninput = labels; labels();
// a recording to look at afterwards: contacts, tilt, eyes, finger (no video, no pictures)
$('#rec').onclick = () => { S.rec = { t0: now(), rows: [] }; $('#rec').disabled = true; $('#panel').hidden = true; };
async function sendRec() {
  const R = S.rec; S.rec = null; $('#rec').disabled = false;
  const file = new File([JSON.stringify({ at: new Date().toISOString(), page: [innerWidth, innerHeight], mmPerPx: MM, zScale: S.zScale, options: O, settings: Object.fromEntries([...document.querySelectorAll('#panel input')].map((i) => [i.id, +i.value])), cancels: S.cancels, jumps: S.contact.jumps, rows: R.rows })], `mp-ipad-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`, { type: 'application/json' });
  S.file = file; $('#panel').hidden = false; $('#rec').textContent = '記録を送る'; $('#rec').onclick = async () => {
    try { if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file] }); return; } } catch (e) { if (e.name === 'AbortError') return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; a.click();
  };
}

// ---------- loop ----------
let scene = null, last = now();
function finger(dt, t) {
  const p = S.contact.update(S.raw, t), yaw = rad(val('#yaw')), theta = rad(val('#theta')), len = LEN.map((l) => l * val('#len') / 100), M = MATS[O.mat];
  if (!p) { S.root = null; S.f = null; S.tip.reset(); fx.reset(); fy.reset(); return; }
  if (!S.root) { fx.reset(); fy.reset(); }
  const x = S.contact.down ? fx.filter(p[0], t) : fx.x, y = S.contact.down ? fy.filter(p[1], t) : fy.x;
  // from the middle of the contact to the MP joint: away from the hand, along the proximal phalanx
  const H = toHand(yaw), side = sideOf(yaw); S.root = add(add([x, y, MP_H], H, -val('#off')), side, val('#offx'));
  const rest = restTip(S.root, theta, yaw, len); scene.setDepth(restTip([0, 0, MP_H], Math.PI / 2, yaw, len)[2] - RF);
  const lag = S.tip.step(rest, M, dt), h = M.bump ? M.bump * grain(S.tip.p[0], S.tip.p[1]) : 0; S.bob += (h - S.bob) * Math.min(1, dt * 40);
  const g = val('#gain'), tipZ = scene.surfZ + RF - M.dent + S.bob * (0.4 + 0.6 * Math.min(2, g));
  S.f = solve({ root: S.root, theta, yaw, lag, gain: g, bend: O.bend, kind: O.kind, len, tipZ }); S.f.cursor = add(rest, lag, g); S.f.rest = rest;
}
function loop(t0) {
  const t = now(), dt = Math.min(0.05, (t - last) / 1000); last = t; S.fps += ((1 / Math.max(dt, 1e-3)) - S.fps) * 0.05;
  const m = measured(), eye = S.eye.update(m, fallback(), t);
  if (!S.started) startScreen();
  scene.light(upOf(tiltDeg())); scene.setMaterial(O.mat);
  if (S.started) finger(dt, t); else { S.contact.update(S.raw, t); S.f = null; }
  scene.finger(S.f, O.kind, S.root, S.contact.down ? 1 : 0.5, S.tip.lag); scene.render(eye);
  const msg = t < flashT ? flashM : !S.started ? '' : S.rec ? `記録中 あと ${Math.max(0, Math.ceil(20 - (t - S.rec.t0) / 1000))} 秒` : !S.root ? '握った手の、人差し指の付け根から先の背を画面に付けて、すべらせる' : O.eye === 'track' && S.eye.src === 'default' ? '顔が見えません（いつもの位置の絵にしています）' : '';
  if ($('#msg').textContent !== msg) $('#msg').textContent = msg;
  if (S.rec) { const f = S.f; S.rec.rows.push({ t: +(t - S.rec.t0).toFixed(1), c: S.raw.map((c) => [c.id, +c.x.toFixed(2), +c.y.toFixed(2), +c.rx.toFixed(2), +c.ry.toFixed(2)]), root: S.root?.map((v) => +v.toFixed(2)), lag: S.tip.lag.map((v) => +v.toFixed(2)), bend: f && +f.bendDeg.toFixed(1), tilt: S.tilt.deg && +S.tilt.deg.toFixed(2), eye: eye.map((v) => +v.toFixed(1)), src: S.eye.src, fps: +S.fps.toFixed(0) }); if (t - S.rec.t0 > 20000) sendRec(); }
  if (!$('#panel').hidden && (S.tickV = (S.tickV || 0) + 1) % 6 === 0) values(m, eye);
  requestAnimationFrame(loop);
}
function values(m, eye) {
  const w = eyeToWorld(tiltDeg(), eye), s = S.f && S.root ? seenAt(S.f.tip, eye) : null, cm = (v) => `${(v / 10).toFixed(0)} cm`, row = (a, b) => `<tr><td>${a}</td><td>${b}</td></tr>`;
  const dx = s && s[0] - S.root[0], dy = s && s[1] - S.root[1];
  $('#vals').innerHTML = row('iPadの傾き', S.tilt.deg == null ? '測れない（26°）' : `${S.tilt.deg.toFixed(1)}°`) + row('手の甲の傾き（水平から）', `${(val('#theta') - tiltDeg()).toFixed(0)}°`)
    + row('目', { measured: '測っている', held: '見失った（保持）', default: '既定の位置' }[S.eye.src]) + row('目までの距離', cm(Math.hypot(...eye))) + row('目の左右／手前／高さ', `${cm(w.side)}／${cm(w.back)}／${cm(w.height)}`)
    + row('仮想の指先が見える所', s ? `${Math.abs(dx).toFixed(0)} mm ${dx < 0 ? '左' : '右'}・${Math.abs(dy).toFixed(0)} mm ${dy < 0 ? '手前' : '奥'}` : '—') + row('遅れ／しなり', S.f ? `${Math.hypot(...S.tip.lag).toFixed(0)} mm／${S.f.bendDeg.toFixed(0)}°` : '—')
    + row('接触の数／つなぎ直し', `${S.raw.length}／${S.contact.jumps}`) + row('打ち切られた接触', S.cancels) + row('速さ', `${S.fps.toFixed(0)} fps`);
}
try { scene = new Scene($('#scene')); const lay = () => { scene.layout(MM); cameraPlace(); }; lay(); addEventListener('resize', lay); requestAnimationFrame(loop); } catch (e) { $('#sMsg').textContent = `描画できません（${e.message}）。再読み込みしてください`; }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { try { navigator.wakeLock?.request('screen').catch(() => {}); } catch {} if (S.asked && O.eye === 'track') startEyes(); } });
window.mpIpad = { S, O, get scene() { return scene; } };
