// Stroking on the iPad itself. The hand is a fist; MP: the back of the index finger's proximal phalanx is on the glass, PIP: the back of its middle phalanx. Only the hand slides.
// touch -> where the knuckle is, motion sensor -> how the iPad stands, front camera -> where the eyes are. No server, no PC.
import { Contact, Point, Lead, Ahead, Tilt, Eye, makeEyes, eyeFrom, eyeToWorld, upOf } from './sensors.js?v=6';
import { MATS, JOINTS, RF, PRESS, Tip, solve, restTip, grain, seenAt, add, frame, visible } from './finger.js?v=6';
import { makeWorld, ground, settle, TipOver, REACH } from './world.js?v=6';
import { Scene, DEPTH } from './scene.js?v=6';
import { tone } from './skin.js?v=6';
import { Color, SRGBColorSpace } from 'three';

const $ = (s) => document.querySelector(s), now = () => performance.now(), rad = (d) => d * Math.PI / 180, val = (id) => +$(id).value;
const MM = 0.1924, STORE = 'mpIpad.v2'; // mm per CSS px (264 ppi iPads); phalanges
const O = { mat: 'mix', place: 'cube', kind: 'finger', bend: 'whole', hand: 'right', eye: 'track', cam: 'top', joint: 'point', look: 'real', skin: 'auto' };
const saved = (() => { try { const o = JSON.parse(localStorage.getItem('mpIpad.v1') || '{}'); return JSON.parse(localStorage.getItem(STORE) || 'null') || { zScale: o.zScale, cam: o.cam, hand: o.hand }; } catch { return {}; } })();
const S = { started: false, ready: false, raw: [], cancels: 0, root: null, contact: new Contact(), tilt: new Tilt(), eye: new Eye(), eyes: null, zScale: saved.zScale || 1, tip: new Tip(), over: new TipOver(), world: null, skin: null, bob: 0, f: null, fps: 0, rec: null, err: '' };
const lead = new Lead(), ahead = new Ahead(), tracker = () => (O.joint === 'point' ? new Point(O.hand, rad(val('#yaw'))) : new Contact(O.hand, rad(val('#yaw'))));
const GHOST = new URLSearchParams(location.search).has('ghost'); // draws the real finger too (to check on a PC how the two join)
const landscape = () => innerWidth > innerHeight;

// ---------- touch ----------
const onUi = (t) => !!t.target?.closest?.('.btn, .ui');
const mm = (t) => ({ id: t.identifier ?? -1, x: (t.clientX - innerWidth / 2) * MM, y: (innerHeight / 2 - t.clientY) * MM, rx: (t.radiusX || 0) * MM, ry: (t.radiusY || 0) * MM });
function read(e) { if (e.type === 'touchcancel') { S.cancels++; S.cancelAt = now(); } if (e.type === 'touchstart') S.cancelAt = 0; S.raw = [...e.touches].filter((t) => !onUi(t)).map(mm); sense(e); if (e.cancelable && !onUi(e)) e.preventDefault(); }
// every event counts (there may be more of them than pictures), at the time it happened
function sense(e) {
  const n = now(), t = e && Math.abs(n - e.timeStamp) < 150 ? Math.max(e.timeStamp, S.tEvent || 0) : n, had = S.contact.p, p = S.contact.update(S.raw, t); S.tEvent = t;
  if (!p || !had || Math.hypot(p[0] - had[0], p[1] - had[1]) > 25) lead.reset(); if (p && S.contact.down) lead.add(p, t);
}
for (const n of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) addEventListener(n, read, { passive: false });
for (const n of ['gesturestart', 'contextmenu', 'dblclick']) addEventListener(n, (e) => e.preventDefault());
addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse' && !onUi(e)) { S.raw = [mm(e)]; sense(e); } }); // to try it on a PC
addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' && e.buttons && S.raw.length) { S.raw = [mm(e)]; sense(e); } });
addEventListener('pointerup', (e) => { if (e.pointerType === 'mouse') { S.raw = []; sense(e); } });

// ---------- start: tilt, then eyes, then the hand ----------
const item = (id, ok, v, ng) => { const e = $(id); e.classList.toggle('ok', !!ok); e.classList.toggle('ng', !!ng); e.querySelector('.v').textContent = v; };
$('#go').onclick = async () => {
  $('#go').disabled = true;
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
$('#noeye').onclick = () => { if (S.tPlace) { S.skip = true; S.tPlace = 0; return; } O.eye = 'fixed'; S.eyes?.stop(); syncSeg('#eyes', 'eye'); };
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
function startScreen() { // one tap; it goes on by itself when tilt and eyes are measured
  const tl = S.tilt, m = measured(), tOk = tl.deg != null && tl.still, eOk = O.eye !== 'track' || !!m, wait = S.asked ? now() - S.asked : 0;
  item('#cTilt', tOk, '', S.tiltErr); item('#cEye', eOk, '', S.eyeErr); if (!S.asked) return;
  $('#go').textContent = !(tOk || S.tiltErr) && tl.moving ? 'iPadを動かさないで' : eOk ? '測っています' : S.eyeErr ? 'カメラが使えません' : '画面を見てください';
  $('#sMsg').textContent = S.tiltErr ? `${S.tiltErr}（26°として進みます）` : S.eyeErr && !eOk ? S.eyeErr : ''; $('#noeye').hidden = eOk || wait < 2500;
  if (!((tOk || S.tiltErr || wait > 6000) && eOk)) return;
  // from straight in front the own finger hides its continuation: the iPad must stand a little to the side of the hand that strokes
  const far = O.joint === 'point' && O.eye === 'track' && !S.skip && m ? aside(m) : 0; item('#cPlace', !far, '', !!far);
  if (far > 1) { $('#go').textContent = `iPadを${O.hand === 'right' ? '右' : '左'}へ ${far} cm`; $('#sMsg').textContent = '正面だと、自分の指で隠れてしまいます'; $('#noeye').textContent = 'このまま始める'; $('#noeye').hidden = false; S.tPlace = now(); return; }
  if (now() - (S.tPlace || 0) < 700) { $('#go').textContent = 'ここでOK'; return; }
  $('#start').hidden = true; S.started = true;
}
function aside(eye) { // how many cm to move it until 45 % of the finger can be seen
  const len = [val('#l0'), val('#l1'), val('#l2') - RF], s = O.hand === 'right' ? -1 : 1; for (let d = 0; d <= 25; d++) if (visible(rad(val('#theta')), rad(val('#yaw')), rad(val('#ext')), len, [eye[0] + s * d * 10, eye[1], eye[2]]) >= 0.45) return d; return 0;
}
// ---------- eye ----------
const tiltDeg = () => S.tilt.deg ?? 26; // only when the sensor cannot be used
function measured() { const e = S.eyes; return O.eye === 'track' && e?.fresh ? [e.eye.x, e.eye.y, e.eye.z * S.zScale] : null; }
const fallback = () => eyeFrom(tiltDeg(), val('#eb'), val('#eh'), O.eye === 'fixed' ? val('#ex') : 0);
$('#cal').onclick = () => {
  const m = measured(); if (!m) { flash('顔が見えていません'); return; }
  const rest = Math.hypot(m[0], m[1]), z = Math.sqrt(Math.max(100, 400 * 400 - rest * rest)); S.zScale = Math.max(0.4, Math.min(2.5, S.zScale * z / m[2]));
  store(); flash('40cmに合わせました');
};
const KEEP = ['gain', 'l0', 'l1', 'l2', 'tone', 'bright', 'ext', 'lead', 'ahead', 'yaw'];
const store = () => { try { localStorage.setItem(STORE, JSON.stringify({ zScale: S.zScale, cam: O.cam, joint: O.joint, look: O.look, hand: O.hand, skin: O.skin, place: O.place, mat: O.mat, own, set: Object.fromEntries(KEEP.map((id) => [id, val(`#${id}`)])) })); } catch {} };
let flashT = 0, flashM = ''; function flash(t) { flashM = t; flashT = now() + 2500; }

// ---------- settings ----------
const svg = (d) => `<svg viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="${d}"/></svg>`, ICON = { cube: svg('M18 4l13 7v14l-13 7-13-7V11z M5 11l13 7 13-7 M18 18v14'), stone: svg('M2 28a7 7 0 0114 0 M14 28a8 8 0 0116 0 M8 16a6 6 0 0112 0 M20 16a6 6 0 0112 0 M2 28h32'), flat: svg('M9 10h18l7 16H2z M12 10L7 26 M18 10v16 M24 10l5 16') };
function seg(id, list, key, f) { $(id).innerHTML = list.map(([k, t]) => `<button class="btn ui" data-k="${k}">${t}</button>`).join(''); for (const b of $(id).children) b.onclick = () => { O[key] = b.dataset.k; syncSeg(id, key); f?.(); }; syncSeg(id, key); }
function syncSeg(id, key) { for (const b of $(id).children) b.setAttribute('aria-pressed', b.dataset.k === O[key]); }
seg('#mats', [['mix', '<i style="background:conic-gradient(#8fc3d6 25%,#d9c499 0 50%,#4f9a78 0 75%,#e09a35 0)"></i>ぜんぶ'], ...Object.entries(MATS).map(([k, m]) => [k, `<i style="background:${{ smooth: '#8fc3d6', rough: '#d9c499', catchy: '#4f9a78', sticky: '#e09a35' }[k]}"></i>${m.name}`])], 'mat', () => { S.tip.reset(); store(); }); seg('#place', [['cube', `${ICON.cube}立方体`], ['stone', `${ICON.stone}でこぼこ`], ['flat', `${ICON.flat}平ら`]], 'place', () => { S.tip.reset(); S.over.reset(); store(); }); seg('#skins', [['auto', '顔から自動'], ['hand', '手で選ぶ']], 'skin', () => store()); seg('#kinds', [['finger', '指'], ['stick', '棒'], ['cursor', 'カーソル']], 'kind'); seg('#looks', [['real', '本物'], ['color', '3色']], 'look', () => store()); seg('#bends', [['whole', '全体がしなる'], ['distal', '末節だけ']], 'bend');
seg('#hands', [['right', '右手'], ['left', '左手']], 'hand', () => { $('#yaw').value = O.hand === 'right' ? 45 : -45; document.body.classList.toggle('left', O.hand === 'left'); S.contact = tracker(); labels(); });
seg('#eyes', [['track', '視線追従'], ['fixed', '追従しない']], 'eye', () => { if (O.eye === 'track') startEyes(); else S.eyes?.stop(); });
// PIP / MP: each has its own place of the joint and angle of the hand
{ const q = new URLSearchParams(location.search).get('joint') || saved.joint; if (JOINTS[q]) O.joint = q; }
const WHERE = { point: '人差し指の第2関節だけ', mp: '人差し指の付け根から先（基節の背）', pip: '人差し指のまん中の節（中節の背）' }, ADJ = ['off', 'offx', 'theta'], own = Object.fromEntries(Object.entries(JOINTS).map(([k, j]) => [k, { off: j.off, offx: 0, theta: j.theta }])); let shown = null;
for (const k of ['look', 'skin', 'place', 'mat']) if (saved[k]) O[k] = saved[k]; syncSeg('#skins', 'skin'); syncSeg('#place', 'place'); syncSeg('#mats', 'mat'); if (saved.hand) O.hand = saved.hand; for (const k of Object.keys(own)) Object.assign(own[k], saved.own?.[k]); for (const [id, v] of Object.entries(saved.set || {})) if (KEEP.includes(id) && Number.isFinite(v)) $(`#${id}`).value = v;
syncSeg('#looks', 'look'); syncSeg('#hands', 'hand'); document.body.classList.toggle('left', O.hand === 'left'); S.contact = tracker();
function setJoint() {
  if (shown) for (const id of ADJ) own[shown][id] = val(`#${id}`);
  shown = O.joint; for (const id of ADJ) $(`#${id}`).value = own[shown][id];
  const mp = shown === 'mp', pt = shown === 'point'; $('#bendBox').hidden = !mp; $('#place').previousElementSibling.hidden = $('#place').hidden = !pt; $('#extBox').hidden = !pt; S.contact = tracker(); S.over.reset(); $('#thetaN').textContent = mp ? '手の甲の傾き（画面から）' : '基節の傾き（画面から）';
  $('#how').textContent = `${WHERE[shown]}を画面に付けて、すべらせます`;
  S.root = null; S.f = null; S.tip.reset(); S.bob = 0; labels(); store();
}
if (saved.cam) O.cam = saved.cam;
seg('#cams', [['top', '上'], ['left', '左'], ['right', '右']], 'cam', () => { cameraPlace(); store(); });
const tray = (on) => { $('#tray').hidden = !on; }, page = (more) => { $('#quick').hidden = more; $('#panel').hidden = !more; };
$('#open').onclick = () => { page(false); tray($('#tray').hidden); }; $('#more').onclick = () => { page(true); tab('hand'); }; $('#back').onclick = () => page(false);
function tab(t) { for (const b of $('#tabs').children) if (b.dataset.t) b.setAttribute('aria-pressed', b.dataset.t === t); for (const q of document.querySelectorAll('#panel section')) q.hidden = q.dataset.t !== t; }
for (const b of $('#tabs').children) if (b.dataset.t) b.onclick = () => tab(b.dataset.t);
$('#reset').onclick = () => { try { localStorage.removeItem(STORE); localStorage.removeItem('mpIpad.v1'); } catch {} location.reload(); };
O.power = '1'; seg('#power', [['0', 'なし'], ['0.6', '弱'], ['1', '中'], ['1.6', '強']], 'power', () => { $('#gain').value = O.power; labels(); store(); });
const labels = () => { for (const i of document.querySelectorAll('#panel input')) i.previousElementSibling.textContent = `${i.value}${i.dataset.u}`; };
for (const i of document.querySelectorAll('#panel input')) i.oninput = () => { labels(); if (shown) for (const id of ADJ) own[shown][id] = val(`#${id}`); store(); };
seg('#mode', [['point', '第2関節だけ'], ['pip', '中節の背'], ['mp', 'MP']], 'joint', setJoint); setJoint();
// the delay is set by eye: two long lines through the predicted contact; the other hand moves the slider until they stay with the knuckle
const FIT = [['lead', '1. 遅れ', '手をすべらせながら、赤い線が関節についてくる所へ'], ['bright', '2. 肌の明るさ', '画面の中の指が、自分の指と同じ明るさになる所へ'], ['yaw', '3. 向き', '画面の中の指が、自分の指の続きに見える向きへ']];
function fit(i) {
  const f = FIT[i]; S.align = i === 0; S.fit = f ? i : null; $('#fit').hidden = !f; $('#open').hidden = !!f; if (!f) return;
  const e = $(`#${f[0]}`), r = $('#fitR'); $('#fitT').textContent = f[1]; $('#fitP').textContent = f[2]; $('#fitN').textContent = i < FIT.length - 1 ? 'つぎへ' : 'できた'; for (const k of ['min', 'max', 'step']) r[k] = e[k]; r.value = e.value; r.oninput = () => { e.value = r.value; e.oninput(); };
}
$('#fitGo').onclick = () => { tray(false); fit(0); }; $('#fitN').onclick = () => fit(S.fit + 1); $('#fitX').onclick = () => fit(-1);
function lines() { const on = S.align && S.root; for (const id of ['#lx', '#ly']) $(id).style.display = on ? 'block' : 'none'; if (on) { $('#lx').style.transform = `translateX(${innerWidth / 2 + S.root[0] / MM}px)`; $('#ly').style.transform = `translateY(${innerHeight / 2 - S.root[1] / MM}px)`; } }
// the colour of the skin: hue from the face (measured all the time, slowly), brightness by the slider because a screen shines and a hand does not
function skinColor(dt) {
  const q = S.eyes?.skin, k = 2 ** (val('#bright') / 50); if (q) S.skin = S.skin ? S.skin.map((v, i) => v + (q[i] - v) * (1 - Math.exp(-dt / 1.5))) : [...q];
  const c = new Color(); if (O.skin === 'auto' && S.skin) { c.setRGB(...S.skin.map((v) => v / 255), SRGBColorSpace); const Y = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; c.multiplyScalar(Math.max(0.2, Math.min(0.5, Y)) / Math.max(0.02, Y)); } else c.copy(tone(val('#tone') / 100)); return c.multiplyScalar(k);
}
// a recording to look at afterwards: contacts, tilt, eyes, finger (no video, no pictures)
$('#rec').onclick = () => { S.rec = { t0: now(), rows: [] }; $('#rec').disabled = true; tray(false); };
async function sendRec() {
  const R = S.rec; S.rec = null; $('#rec').disabled = false;
  const file = new File([JSON.stringify({ at: new Date().toISOString(), page: [innerWidth, innerHeight], mmPerPx: MM, zScale: S.zScale, options: O, settings: Object.fromEntries([...document.querySelectorAll('#panel input')].map((i) => [i.id, +i.value])), cancels: S.cancels, faceMs: S.eyes?.cost, jumps: S.contact.jumps, rows: R.rows })], `mp-ipad-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`, { type: 'application/json' });
  S.file = file; tray(true); page(true); tab('data'); $('#rec').textContent = '記録を送る'; $('#rec').onclick = async () => {
    try { if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file] }); return; } } catch (e) { if (e.name === 'AbortError') return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; a.click();
  };
}

// ---------- loop ----------
let scene = null, last = now();
function finger(dt, t) {
  if (t - (S.tEvent || 0) > 40) sense(); // no news: the hand rests (or has gone)
  const p = S.contact.p, yaw = rad(val('#yaw')), theta = rad(val('#theta')), ext = rad(val('#ext')), len = [val('#l0'), val('#l1'), val('#l2') - RF], J = JOINTS[O.joint], key = O.mat === 'mix' ? 'catchy' : O.mat, M = MATS[key], pt = O.joint === 'point';
  const low = restTip([0, 0, J.h], rad(J.theta), yaw, len, O.joint, ext)[2] - RF; place(pt && O.place !== 'flat' ? low + REACH : null); if (!S.world) scene.setDepth(low + PRESS); scene.setMaterial(key);
  if (!p) { S.root = null; S.f = null; S.tip.reset(); S.over.reset(); lead.reset(); ahead.reset(); return; }
  const at = S.contact.down && lead.at(t, val('#lead')) || p, [x, y] = S.contact.down || !S.root ? at : S.at; S.at = [x, y]; const A = ahead.step(S.contact.down ? lead.vel : [0, 0], val('#ahead'), dt);
  // from the middle of the contact to the joint: away from the hand, along the phalanx on the glass (nothing when only the knuckle touches)
  S.root = [x + A[0] + val('#offx'), y + A[1] + val('#off'), J.h]; // straight away from the person: which way the hand comes from is not known well enough to go sideways
  { const v = lead.vel, sp = Math.hypot(...v), n = S.contact.down && sp > 5 ? Math.min(7, 1.2 * lead.miss + sp * 0.004) / sp : 0; S.smear = [0, 1].map((i) => (S.smear?.[i] || 0) + (v[i] * n - (S.smear?.[i] || 0)) * Math.min(1, dt * 20)); }
  const rest = restTip(S.root, theta, yaw, len, O.joint, ext), g = val('#gain'), o = { joint: O.joint, root: S.root, theta, yaw, gain: g, ext, bend: O.bend, kind: O.kind, len, dent: M.dent };
  if (S.world) {
    const w = S.world, lag = S.over.step(rest, w, dt, O.kind === 'finger' ? { dip: add(S.root, frame(theta, yaw, 0).u, len[1]), reach: 0.95 * len[2], gain: g } : { gain: g }); S.tip.lag = lag; const f = settle(w, { ...o, lag }, S.over.obj);
    S.f = f; S.f.cursor = add(rest, lag); S.f.cursor[2] = Math.max(rest[2], ground(w, S.f.cursor[0], S.f.cursor[1]).z);
  } else {
    const lag = S.tip.step(rest, M, dt), h = M.bump ? M.bump * grain(S.tip.p[0], S.tip.p[1]) : 0; S.bob += (h - S.bob) * Math.min(1, dt * 40);
    S.f = solve({ ...o, lag, surf: scene.surfZ + S.bob * (0.4 + 0.6 * Math.min(2, g)) }); S.f.cursor = add(rest, lag, g);
  }
  S.f.rest = rest;
}
function place(top) { // the world is made again only when something about it has changed
  const k = top == null ? '' : [O.place, O.mat, top.toFixed(1), scene.W, scene.H].join(); if (k === S.worldKey) return; S.worldKey = k; S.world = top == null ? null : makeWorld(O.place, scene.W - 8, scene.H - 8, top, O.mat, DEPTH); S.over.reset(); scene.setWorld(S.world);
}
function loop(t0) {
  const began = now(), t = began, dt = Math.min(0.05, (t - last) / 1000); last = t; S.fps += ((1 / Math.max(dt, 1e-3)) - S.fps) * 0.05;
  const m = measured(), eye = S.eye.update(m, fallback(), t);
  if (!S.started) startScreen();
  { const on = S.started && S.contact.down && S.fit == null; if (on !== S.was) { S.was = on; document.body.classList.toggle('touching', on); if (on) tray(false); } }
  scene.light(upOf(tiltDeg()));
  if (S.eyes) S.eyes.busy = S.started && S.contact.down && (lead.speed || 0) > 10;
  if (S.started) finger(dt, t); else { if (t - (S.tEvent || 0) > 40) sense(); S.f = null; } lines();
  if (S.started && dt < 0.05 && t - (S.tSlow ||= t) > 3000) { S.tSlow = t; if (S.fps < 50) scene.lighter(); }
  scene.finger(S.f, O.kind, S.root, S.contact.down ? 1 : 0.5, S.tip.lag, O.joint, O.look, rad(val('#yaw')), S.smear); scene.skin.setColor(skinColor(dt)); scene.ghost(GHOST && S.f ? [S.root, rad(val('#theta')), rad(val('#yaw')), [val('#l0'), val('#l1'), val('#l2')]] : null); scene.render(eye);
  const msg = t < flashT ? flashM : !S.started ? '' : S.rec ? `記録中 あと ${Math.max(0, Math.ceil(20 - (t - S.rec.t0) / 1000))} 秒` : t - (S.cancelAt || -1e9) < 4000 ? 'iPadが接触を打ち切りました。いちど手を離してください' : !S.root ? `${WHERE[O.joint]}を画面に付けて、すべらせる` : O.eye === 'track' && S.eye.src === 'default' ? '顔が見えません（いつもの位置の絵にしています）' : '';
  if ($('#msg').textContent !== msg) $('#msg').textContent = msg;
  if (S.rec) { const f = S.f; S.rec.rows.push({ t: +(t - S.rec.t0).toFixed(1), c: S.raw.map((c) => [c.id, +c.x.toFixed(2), +c.y.toFixed(2), +c.rx.toFixed(2), +c.ry.toFixed(2)]), p: S.contact.p?.map((v) => +v.toFixed(2)), root: S.root?.map((v) => +v.toFixed(2)), lag: S.tip.lag.map((v) => +v.toFixed(2)), bend: f && +f.bendDeg.toFixed(1), miss: +lead.miss.toFixed(2), tilt: S.tilt.deg && +S.tilt.deg.toFixed(2), eye: eye.map((v) => +v.toFixed(1)), src: S.eye.src, fps: +S.fps.toFixed(0) }); if (t - S.rec.t0 > 20000) sendRec(); }
  if (!$('#tray').hidden && !$('#panel').hidden && (S.tickV = (S.tickV || 0) + 1) % 6 === 0) values(m, eye);
  S.ms = (S.ms || 0) + (now() - began - (S.ms || 0)) * 0.05;
  requestAnimationFrame(loop);
}
function values(m, eye) {
  const w = eyeToWorld(tiltDeg(), eye), s = S.f && S.root ? seenAt(S.f.tip, eye) : null, cm = (v) => `${(v / 10).toFixed(0)} cm`, row = (a, b) => `<tr><td>${a}</td><td>${b}</td></tr>`;
  const dx = s && s[0] - S.root[0], dy = s && s[1] - S.root[1];
  $('#vals').innerHTML = row('iPadの傾き', S.tilt.deg == null ? '測れない（26°）' : `${S.tilt.deg.toFixed(1)}°`) + row(O.joint === 'mp' ? '手の甲の傾き（水平から）' : '基節の傾き（水平から）', `${(val('#theta') - tiltDeg()).toFixed(0)}°`)
    + row('目', { measured: '測っている', held: '見失った（保持）', default: '既定の位置' }[S.eye.src]) + row('目までの距離', cm(Math.hypot(...eye))) + row('目の左右／手前／高さ', `${cm(w.side)}／${cm(w.back)}／${cm(w.height)}`)
    + row('仮想の指先が見える所', s ? `${Math.abs(dx).toFixed(0)} mm ${dx < 0 ? '左' : '右'}・${Math.abs(dy).toFixed(0)} mm ${dy < 0 ? '手前' : '奥'}` : '—') + row('遅れ／しなり', S.f ? `${Math.hypot(...S.tip.lag).toFixed(0)} mm／${S.f.bendDeg.toFixed(0)}°` : '—')
    + row('予測のはずれ', `${lead.miss.toFixed(1)} mm`) + row('肌の色', O.skin === 'auto' ? (S.skin ? '顔から測っている' : '顔を待っています（手で選んだ色）') : '手で選んだ色') + row('接触の数／つなぎ直し', `${S.raw.length}／${S.contact.jumps}`) + row('打ち切られた接触', S.cancels) + row('顔の認識', S.eyes?.cost ? `${S.eyes.cost.toFixed(0)} ms（${S.eyes.mode === 'worker' ? '別スレッド' : '同じスレッド'}）` : '—') + row('速さ／1コマの計算', `${S.fps.toFixed(0)} fps／${(S.ms || 0).toFixed(1)} ms`);
}
try { scene = new Scene($('#scene')); const lay = () => { scene.layout(MM); cameraPlace(); }; lay(); addEventListener('resize', lay); scene.setMaterial(O.mat === 'mix' ? 'catchy' : O.mat); scene.warm(); requestAnimationFrame(loop); } catch (e) { $('#sMsg').textContent = `描画できません（${e.message}）。再読み込みしてください`; }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { try { navigator.wakeLock?.request('screen').catch(() => {}); } catch {} if (S.asked && O.eye === 'track') startEyes(); } });
window.mpIpad = { S, O, get scene() { return scene; } };
