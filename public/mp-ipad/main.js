// Stroking on the iPad itself. The hand is a fist; MP: the back of the index finger's proximal phalanx is on the glass, PIP: the back of its middle phalanx. Only the hand slides.
// touch -> where the knuckle is, motion sensor -> how the iPad stands, front camera -> where the eyes are. No server, no PC.
import { Contact, Point, Lead, Ahead, Tilt, Eye, TOP, live, camera, cameraOff, makeEyes, eyeFrom, eyeToWorld, upOf } from './sensors.js?v=11';
import { MATS, JOINTS, RF, PRESS, Tip, solve, restTip, grain, seenAt, add, aim } from './finger.js?v=11';
import { ground, settle } from './world.js?v=11';
import { THINGS, makeThing } from './objects.js?v=11';
import { Scene, DEPTH } from './scene.js?v=11';
import { tone, LOOKS } from './skin.js?v=11';
import { fingerFromPhoto, keepPhoto, lastPhoto } from './photo.js?v=11';
import { Color, SRGBColorSpace } from 'three';

const $ = (s) => document.querySelector(s), now = () => performance.now(), rad = (d) => d * Math.PI / 180, val = (id) => +$(id).value;
const MM = 0.1924, STORE = 'mpIpad.v5'; // mm per CSS px (264 ppi iPads); phalanges
const O = { group: 'thing', thing: 'cube', mat: 'sand', kind: 'finger', bend: 'whole', hand: 'right', eye: 'track', cam: 'top', joint: 'point', look: 'real', skin: 'auto' };
const saved = (() => { try { const o = JSON.parse(localStorage.getItem('mpIpad.v4') || '{}'); return JSON.parse(localStorage.getItem(STORE) || 'null') || { zScale: o.zScale, cam: o.cam, hand: o.hand, joint: o.joint, look: o.look, skin: o.skin, group: o.group, thing: o.thing, mat: o.mat, own: o.own, set: o.set && { ...o.set, lr: 0, dn: 0, ext: 0, cshade: 0, blob: 8 } }; } catch { return {}; } })();
const S = { started: false, ready: false, raw: [], cancels: 0, root: null, contact: new Contact(), tilt: new Tilt(), eye: new Eye(), eyes: null, xShift: saved.xShift || 0, zScale: saved.zScale || 1, tip: new Tip(), thing: null, skin: null, bob: 0, f: null, fps: 0, rec: null, err: '' };
const lead = new Lead(), ahead = new Ahead(), tracker = () => (O.joint === 'point' ? new Point(O.hand, rad(val('#yaw'))) : new Contact(O.hand, rad(val('#yaw'))));
const GHOST = new URLSearchParams(location.search).has('ghost'); // draws the real finger too (to check on a PC how the two join)
const landscape = () => innerWidth > innerHeight;

// ---------- touch ----------
// One layer over the picture takes the hand, so what lands on a button is never counted. The browser reports a finger twice, as touch and as pointer:
// touch is used (it has every contact and its size); if none comes, the pointers are, so that the hand is never without an answer.
const pad = $('#touch'), mm = (t, id) => ({ id, x: (t.clientX - innerWidth / 2) * MM, y: (innerHeight / 2 - t.clientY) * MM, rx: (t.radiusX ?? (t.width || 0) / 2) * MM || 0, ry: (t.radiusY ?? (t.height || 0) / 2) * MM || 0 });
const IN = S.in = { touch: 0, pointer: 0, tTouch: -1e9, tDown: -1e9, by: '', pts: new Map() };
const safe = (f) => (e) => { try { f(e); } catch (x) { failed(x); } };
function read(e) {
  if (e.type === 'touchcancel') { S.cancels++; S.cancelAt = now(); } if (e.type === 'touchstart') { S.cancelAt = 0; IN.touch++; }
  IN.tTouch = now(); IN.by = 'touch'; S.raw = [...e.targetTouches].map((t) => mm(t, t.identifier)); sense(e); if (e.cancelable) e.preventDefault();
}
// every event counts (there may be more of them than pictures), at the time it happened
function sense(e) {
  const n = now(), t = e && Math.abs(n - e.timeStamp) < 150 ? Math.max(e.timeStamp, S.tEvent || 0) : n, had = S.contact.p, p = S.contact.update(S.raw, t); S.tEvent = t;
  if (!p || !had || Math.hypot(p[0] - had[0], p[1] - had[1]) > 25) lead.reset(); if (p && S.contact.down) lead.add(p, t);
}
for (const n of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) pad.addEventListener(n, safe(read), { passive: false });
function point(e) {
  const p = IN.pts, up = e.type === 'pointerup' || e.type === 'pointercancel';
  if (e.type === 'pointerdown') { IN.pointer++; IN.tDown = now(); p.set(e.pointerId, mm(e, e.pointerId)); try { pad.setPointerCapture(e.pointerId); } catch {} } else if (!p.has(e.pointerId)) return; else if (up) p.delete(e.pointerId); else p.set(e.pointerId, mm(e, e.pointerId));
  if (e.pointerType === 'mouse' || IN.by === 'pointer') { IN.by = 'pointer'; S.raw = [...p.values()]; sense(e); }
}
for (const n of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) pad.addEventListener(n, safe(point));
const noTouch = () => { if (IN.pts.size && IN.by !== 'pointer' && now() - IN.tDown > 70 && IN.tTouch < IN.tDown - 70) { IN.by = 'pointer'; S.raw = [...IN.pts.values()]; sense(); } };
for (const n of ['gesturestart', 'contextmenu', 'dblclick']) addEventListener(n, (e) => e.preventDefault());

// ---------- start: tilt, then eyes, then the hand ----------
const item = (id, ok, v, ng) => { const e = $(id); e.classList.toggle('ok', !!ok); e.classList.toggle('ng', !!ng); e.querySelector('.v').textContent = v; };
// permissions first (in the normal window, where they can be answered), the full screen after them with a second tap
const doc = TOP.document, full = () => !!(doc.fullscreenElement || doc.webkitFullscreenElement), standalone = () => !!(navigator.standalone || matchMedia('(display-mode: standalone)').matches), canFull = () => !standalone() && !!(doc.documentElement.requestFullscreen || doc.documentElement.webkitRequestFullscreen);
const goFull = async () => { try { const e = doc.documentElement; await (e.requestFullscreen || e.webkitRequestFullscreen).call(e); } catch {} };
const listen = () => TOP.addEventListener('devicemotion', (S.motion = (e) => { const g = e.accelerationIncludingGravity; if (g && g.z != null) S.tilt.add(g, landscape(), now()); }));
addEventListener('pagehide', () => { try { TOP.removeEventListener('devicemotion', S.motion); } catch {} });
function begin() { $('#start').hidden = true; S.started = true; TOP.shell ||= {}; TOP.shell.started = true; try { TOP.navigator.wakeLock?.request('screen').catch(() => {}); } catch {} }
$('#go').onclick = async () => {
  if (S.ready) { if (canFull() && !full()) goFull(); begin(); return; }
  $('#go').disabled = true; TOP.shell ||= {};
  try { // must be asked inside the tap
    const M = TOP.DeviceMotionEvent; if (typeof M === 'undefined') throw new Error('この端末に傾きセンサーがありません');
    if (!TOP.shell.motion && M.requestPermission && await M.requestPermission() !== 'granted') throw new Error('傾きセンサーが許可されていません。ページを開き直して［許可］を押してください');
    TOP.shell.motion = true; listen();
  } catch (e) { S.tiltErr = e.message; }
  if (O.eye === 'track') startEyes();
  S.asked = now();
};
const renew = () => { const q = new URLSearchParams(location.search); q.set('t', Date.now()); location.replace(`${location.pathname}?${q}`); };
$('#fs').onclick = goFull; $('#renew').onclick = renew;
$('#noeye').onclick = () => { O.eye = 'fixed'; S.eyes?.stop(); cameraOff(); syncSeg('#eyes', 'eye'); };
$('#again').onclick = renew;
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
  if (!((tOk || S.tiltErr || wait > 6000) && eOk)) return; S.ready = true; $('#noeye').hidden = true;
  if (!canFull() || full()) begin(); else { $('#go').disabled = false; $('#go').textContent = '全画面ではじめる'; }
}
// ---------- eye ----------
const tiltDeg = () => S.tilt.deg ?? 26; // only when the sensor cannot be used
function measured() { const e = S.eyes; return O.eye === 'track' && e?.fresh ? [e.eye.x - S.xShift, e.eye.y, e.eye.z * S.zScale] : null; }
const fallback = () => eyeFrom(tiltDeg(), val('#eb'), val('#eh'), O.eye === 'fixed' ? val('#ex') : 0);
$('#cal').onclick = () => {
  const m = measured(); if (!m) { flash('顔が見えていません'); return; }
  const rest = Math.hypot(m[0], m[1]), z = Math.sqrt(Math.max(100, 400 * 400 - rest * rest)); S.zScale = Math.max(0.4, Math.min(2.5, S.zScale * z / m[2]));
  store(); flash('40cmに合わせました');
};
const KEEP = ['roll', 'exag', 'long', 'thick', 'peek', 'vx', 'vy', 'lr', 'dn', 'taper', 'over', 'deep', 'cshade', 'blob', 'fade', 'shade', 'gain', 'l0', 'l1', 'l2', 'tone', 'bright', 'ext', 'lead', 'ahead', 'smear', 'yaw'];
const store = () => { try { localStorage.setItem(STORE, JSON.stringify({ xShift: S.xShift, zScale: S.zScale, cam: O.cam, joint: O.joint, look: O.look, hand: O.hand, skin: O.skin, group: O.group, thing: O.thing, mat: O.mat, own, set: Object.fromEntries(KEEP.map((id) => [id, val(`#${id}`)])) })); } catch {} };
let flashT = 0, flashM = ''; function flash(t, ms = 2500) { flashM = t; flashT = now() + ms; }

// ---------- settings ----------
const svg = (d) => `<svg viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="${d}"/></svg>`, SHAPE = { cube: 'M18 4l13 7v14l-13 7-13-7V11z M5 11l13 7 13-7 M18 18v14', bumps: 'M2 24c5 0 5-12 10-12s5 12 8 12 4 7 7 7 3-7 7-7', push: 'M14 12h16v16H14z M2 20h10 M8 16l4 4-4 4', harp: 'M6 4h24 M6 32h24 M10 4v28 M18 4c5 10 5 18 0 28 M26 4v28', slime: 'M4 30h28 M18 6v8 M18 14c-1 8-6 10-8 16 M18 14c1 8 6 10 8 16 M18 14v16', soft: 'M6 20a12 12 0 0124 0c0 8-5 11-12 11S6 28 6 20z M12 11c4 4 8 4 12 0', posts: 'M8 32V10 M18 32c0-12 2-18 8-22 M30 32V10 M4 32h28', grass: 'M4 32c2-10 0-14-2-18 M12 32c0-12 2-18 5-22 M20 32c-1-10 2-16 6-18 M28 32c0-8 2-12 5-14' }, ICON = (k) => svg(SHAPE[k]), DOT = { smooth: '#8fc3d6', sand: '#b08a62', stone: '#d9c499', knit: '#4f9a78', tape: '#c4a06a', honey: '#e09a35', rubber: '#ea8d98', fur: '#b8926a', water: '#1f6f93' };
function seg(id, list, key, f) { $(id).innerHTML = list.map(([k, t]) => `<button class="btn ui" data-k="${k}">${t}</button>`).join(''); for (const b of $(id).children) b.onclick = () => { O[key] = b.dataset.k; syncSeg(id, key); f?.(); }; syncSeg(id, key); }
function syncSeg(id, key) { for (const b of $(id).children) b.setAttribute('aria-pressed', b.dataset.k === O[key]); }
const shown2 = () => { $('#things').hidden = O.group !== 'thing'; $('#mats').hidden = O.group !== 'tex'; }, card = (pic, name) => `${pic}<b>${name}</b>`, changed = () => { S.tip.reset(); S.thing?.reset(); shown2(); store(); label(); }, label = () => { const th = O.joint !== 'mp' && O.group === 'thing', x = th ? THINGS.find((q) => q[0] === O.thing) : [0, MATS[O.mat].name, 'なでる', MATS[O.mat].from]; $('#now').textContent = x[1]; };
seg('#looks', LOOKS.map(([k, n]) => [k, card(`<i class="l-${k}"></i>`, n)]), 'look', () => { store(); if (O.look === 'photo' && !S.photo) $('#photo').click(); });
seg('#group', [['thing', '物を触る'], ['tex', '質感を触る']], 'group', changed); const TEX = Object.entries(MATS).filter(([, m]) => m.name);
seg('#things', THINGS.map(([k, n, f]) => [k, card(ICON(k), n)]), 'thing', changed); seg('#mats', TEX.map(([k, m]) => [k, card(`<i style="background:${DOT[k]}"></i>`, m.name)]), 'mat', changed);
// to the next one without opening the tray
function turn(d) { const pt = O.joint !== 'mp', all = pt && O.group === 'thing' ? THINGS.map((x) => ['thing', x[0], x[1]]) : TEX.map(([k, m]) => ['tex', k, m.name]), i = all.findIndex((x) => x[1] === (x[0] === 'thing' ? O.thing : O.mat)), n = all[(i + d + all.length) % all.length]; O.group = n[0]; O[n[0] === 'thing' ? 'thing' : 'mat'] = n[1]; for (const [a, b] of [['#group', 'group'], ['#things', 'thing'], ['#mats', 'mat']]) syncSeg(a, b); changed(); }
$('#cmp').onclick = () => { O.off = !O.off; $('#cmp').textContent = O.off ? '感触 なし' : '感触 あり'; $('#cmp').setAttribute('aria-pressed', O.off); };
$('#prev').onclick = () => turn(-1); $('#next').onclick = () => turn(1); seg('#skins', [['auto', '顔から自動'], ['hand', '手で選ぶ']], 'skin', () => store()); seg('#kinds', [['finger', '指'], ['stick', '棒'], ['cursor', 'カーソル']], 'kind');  seg('#bends', [['whole', '全体がしなる'], ['distal', '末節だけ']], 'bend');
seg('#hands', [['right', '右手'], ['left', '左手']], 'hand', () => { $('#yaw').value = O.hand === 'right' ? 45 : -45; document.body.classList.toggle('left', O.hand === 'left'); S.contact = tracker(); labels(); });
seg('#eyes', [['track', '視線追従'], ['fixed', '追従しない']], 'eye', () => { if (O.eye === 'track') startEyes(); else { S.eyes?.stop(); cameraOff(); } });
// PIP / MP: each has its own place of the joint and angle of the hand
{ const q = new URLSearchParams(location.search).get('joint') || saved.joint; if (JOINTS[q]) O.joint = q; }
const WHERE = { point: '人差し指の第2関節だけ', mp: '人差し指の付け根から先（基節の背）', pip: '人差し指のまん中の節（中節の背）' }, ADJ = ['off', 'offx', 'theta'], own = Object.fromEntries(Object.entries(JOINTS).map(([k, j]) => [k, { off: j.off, offx: 0, theta: j.theta }])); let shown = null;
for (const k of ['look', 'skin', 'group']) if (saved[k]) O[k] = saved[k]; if (MATS[saved.mat]?.name) O.mat = saved.mat; if (THINGS.some((x) => x[0] === saved.thing)) O.thing = saved.thing; for (const [a, b] of [['#skins', 'skin'], ['#group', 'group'], ['#things', 'thing'], ['#mats', 'mat']]) syncSeg(a, b); shown2(); if (saved.hand) O.hand = saved.hand; for (const k of Object.keys(own)) Object.assign(own[k], saved.own?.[k]); for (const [id, v] of Object.entries(saved.set || {})) if (KEEP.includes(id) && Number.isFinite(v)) $(`#${id}`).value = v;
syncSeg('#looks', 'look'); syncSeg('#hands', 'hand'); document.body.classList.toggle('left', O.hand === 'left'); S.contact = tracker();
function setJoint() {
  if (shown) for (const id of ADJ) own[shown][id] = val(`#${id}`);
  shown = O.joint; for (const id of ADJ) $(`#${id}`).value = own[shown][id];
  const mp = shown === 'mp', pt = shown !== 'mp'; $('#bendBox').hidden = !mp; $('#theta').parentElement.hidden = $('#yaw').parentElement.hidden = !mp; $('#group').hidden = !pt; if (!pt) { $('#things').hidden = true; $('#mats').hidden = false; } else shown2(); $('#extBox').hidden = !pt; S.contact = tracker(); S.thing?.reset(); $('#thetaN').textContent = mp ? '手の甲の傾き（画面から）' : '基節の傾き（画面から）';
  $('#how').textContent = `${WHERE[shown]}を画面に付けて、すべらせます`;
  S.root = null; S.f = null; S.tip.reset(); S.bob = 0; labels(); store();
}
if (saved.cam) O.cam = saved.cam;
seg('#cams', [['top', '上'], ['left', '左'], ['right', '右']], 'cam', () => { cameraPlace(); store(); });
const tray = (on) => { $('#tray').hidden = !on; }, page = (more) => { $('#quick').hidden = more; $('#panel').hidden = !more; };
$('#open').onclick = () => { page(false); tray($('#tray').hidden); }; $('#more').onclick = () => { page(true); tab('hand'); }; $('#back').onclick = () => page(false);
function tab(t) { for (const b of $('#tabs').children) if (b.dataset.t) b.setAttribute('aria-pressed', b.dataset.t === t); for (const q of document.querySelectorAll('#panel section')) q.hidden = q.dataset.t !== t; }
for (const b of $('#tabs').children) if (b.dataset.t) b.onclick = () => tab(b.dataset.t);
$('#reset').onclick = () => { try { localStorage.removeItem(STORE); localStorage.removeItem('mpIpad.v4'); } catch {} renew(); };
O.power = ['0', '0.6', '1', '1.6'].reduce((a, b) => (Math.abs(b - val('#gain')) < Math.abs(a - val('#gain')) ? b : a)); seg('#power', [['0', 'なし'], ['0.6', '弱'], ['1', '中'], ['1.6', '強']], 'power', () => { $('#gain').value = O.power; labels(); store(); }); $('#gain').addEventListener('input', () => { O.power = ['0', '0.6', '1', '1.6'].find((q) => +q === val('#gain')) || ''; syncSeg('#power', 'power'); });
const labels = () => { for (const i of document.querySelectorAll('#tray input[type=range]')) i.previousElementSibling.textContent = `${i.value}${i.dataset.u}`; };
for (const i of document.querySelectorAll('#tray input[type=range]')) i.oninput = () => { labels(); if (shown) for (const id of ADJ) own[shown][id] = val(`#${id}`); store(); };
seg('#mode', [['point', '第2関節だけ'], ['pip', '中節の背']], 'joint', () => { setJoint(); syncSeg('#mode2', 'joint'); label(); }); seg('#mode2', [['mp', 'MP（付け根の関節）']], 'joint', () => { setJoint(); syncSeg('#mode', 'joint'); label(); }); setJoint(); label();
// the delay is set by eye: two long lines through the predicted contact; the other hand moves the slider until they stay with the knuckle
const FIT = [['', '1. 正面', '画面の正面に座って、まっすぐ見る'], ['lead', '2. 遅れ', '手をすべらせながら、赤い線が関節についてくる所へ'], ['bright', '3. 肌の明るさ', '画面の中の指が、自分の指と同じ明るさになる所へ'], ['exag', '4. 誇張', '指がちょうどよく見える所へ'], ['roll', '5. ひねり', '爪の向きが自分の指と合う所へ'], ['lr', '6. 向き（左右）', '自分の指の続きに見える向きへ'], ['dn', '7. 向き（上下）', '自分の指の続きに見える向きへ'], ['taper', '8. 断面', '断面が見えなくなる所へ']];
function fit(i) {
  const f = FIT[i]; S.align = f?.[0] === 'lead'; S.fit = f ? i : null; $('#fit').hidden = !f; $('#bar').hidden = !!f; if (!f) return;
  const e = f[0] && $(`#${f[0]}`), r = $('#fitR'); $('#fitT').textContent = f[1]; $('#fitP').textContent = f[2]; $('#fitN').textContent = i < FIT.length - 1 ? 'つぎへ' : 'できた'; r.hidden = !e; if (!e) return; for (const k of ['min', 'max', 'step']) r[k] = e[k]; r.value = e.value; r.oninput = () => { e.value = r.value; e.oninput(); };
}
$('#exag').oninput = () => { const k = val('#exag') / 100; $('#long').value = 100 + 50 * k; $('#thick').value = 100 + 20 * k; $('#peek').value = 100 + 80 * k; labels(); store(); };
for (const b of $('#qt').children) b.onclick = () => qt(b.dataset.q); function qt(k) { for (const b of $('#qt').children) b.setAttribute('aria-pressed', b.dataset.q === k); for (const q of document.querySelectorAll('#quick section')) q.hidden = q.dataset.q !== k; } qt('touch');
$('#photo').onclick = () => $('#photoIn').click(); $('#photoIn').onchange = async (e) => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; $('#photo').textContent = '作っています'; try { S.photo = await fingerFromPhoto(f); keepPhoto(S.photo); scene.skin.setPhoto(S.photo.texture, S.photo.mean); O.look = 'photo'; scene.skin.look = ''; syncSeg('#looks', 'look'); flash('できました'); } catch (x) { flash(x.message || '作れませんでした', 4000); } $('#photo').textContent = '自分の指を撮る'; };
$('#fitGo').onclick = () => { tray(false); fit(0); }; $('#fitN').onclick = () => { if (S.fit === 0) { const m = measured(); if (m) { S.xShift += m[0]; store(); } } fit(S.fit + 1); }; $('#fitX').onclick = () => fit(-1);
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
  const file = new File([JSON.stringify({ at: new Date().toISOString(), page: [innerWidth, innerHeight], mmPerPx: MM, zScale: S.zScale, options: O, settings: Object.fromEntries([...document.querySelectorAll('#tray input[type=range]')].map((i) => [i.id, +i.value])), cancels: S.cancels, faceMs: S.eyes?.cost, jumps: S.contact.jumps, rows: R.rows })], `mp-ipad-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`, { type: 'application/json' });
  S.file = file; tray(true); page(true); tab('data'); $('#rec').textContent = '記録を送る'; $('#rec').onclick = async () => {
    try { if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file] }); return; } } catch (e) { if (e.name === 'AbortError') return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; a.click();
  };
}

// ---------- loop ----------
let scene = null, last = now();
function finger(dt, t) {
  if (t - (S.tEvent || 0) > 40) sense(); // no news: the hand rests (or has gone)
  const sgn = O.hand === 'right' ? 1 : -1, p = S.contact.p, yaw = O.joint === 'mp' ? rad(val('#yaw')) : -rad(val('#roll')) * sgn, theta = rad(val('#theta')), ext = rad(val('#ext')), dir = [rad(val('#lr')) * sgn, rad(val('#dn'))], far = O.joint === 'mp' ? 0 : val('#long') / 100 - 1, len = [val('#l0'), val('#l1') * (1 + 1.5 * far), val('#l2') * (1 + 0.5 * far) - RF], J = JOINTS[O.joint], pt = O.joint !== 'mp', how = pt ? 'point' : 'mp', low = restTip([0, 0, J.h], theta, yaw, len, how, ext, dir)[2] - RF; S.yaw = yaw; scene.shade(val('#shade') / 100); scene.skin.setThick(pt ? val('#thick') / 100 : 1); scene.skin.setCut({ taper: val('#taper') / 100, over: val('#over'), depth: val('#deep'), shade: val('#cshade') / 100, fade: val('#fade'), blob: val('#blob') / 100 }); S.axis = aim(dir, yaw).u; thing(pt && O.group === 'thing' ? low : null); // the things stand where this finger can touch them
  const T = S.thing, key = T ? 'slime' : O.mat, M = MATS[key]; scene.setDepth(low + PRESS); scene.setMaterial(key);
  if (!p) { S.root = null; S.f = null; S.tip.reset(); T?.reset(); T?.rest(dt); lead.reset(); ahead.reset(); return; }
  const at = S.contact.down && lead.at(t, val('#lead')) || p, [x, y] = S.contact.down || !S.root ? at : S.at; S.at = [x, y]; const A = ahead.step(S.contact.down ? lead.vel : [0, 0], val('#ahead'), dt);
  // from the middle of the contact to the joint: away from the hand, along the phalanx on the glass (nothing when only the knuckle touches)
  S.root = [x + A[0] + val('#offx'), y + A[1] + val('#off'), J.h]; // straight away from the person: which way the hand comes from is not known well enough to go sideways
  { const v = lead.vel, sp = Math.hypot(...v), n = S.contact.down && sp > 5 ? Math.min(val('#smear'), 1.2 * lead.miss + sp * 0.004) / sp : 0; S.smear = [0, 1].map((i) => (S.smear?.[i] || 0) + (v[i] * n - (S.smear?.[i] || 0)) * Math.min(1, dt * 20)); }
  const rest = restTip(S.root, theta, yaw, len, how, ext, dir), g = O.off ? 0 : val('#gain'), o = { joint: how, root: S.root, theta, yaw, dir, gain: g, ext, bend: O.bend, kind: O.kind, len, dent: M.dent };
  if (T) {
    const lag = T.step(rest, dt, O.kind === 'finger' ? { dip: add(S.root, S.axis, len[1]), reach: 0.95 * len[2], gain: g } : { gain: g }); S.tip.lag = lag;
    S.f = T.w ? settle(T.w, { ...o, lag }) : solve({ ...o, gain: 1, lag, ...(T.kind === 'slime' ? { surf: scene.surfZ } : { surf: -1e4, floor: -1e4 }) }); S.f.cursor = add(rest, lag); if (T.w) S.f.cursor[2] = Math.max(rest[2], ground(T.w, S.f.cursor[0], S.f.cursor[1]).z);
  } else {
    // over the edge of the island there is nothing to touch
    const p0 = S.tip.p || rest, off = pt && (Math.abs(p0[0]) > scene.IW / 2 || Math.abs(p0[1]) > scene.IH / 2), lag = S.tip.step(rest, off ? { k: 45, hold: 0 } : M, dt), h = M.bump && !off ? M.bump * grain(S.tip.p[0], S.tip.p[1], M.f) : 0; S.bob += (h - S.bob) * Math.min(1, dt * 40); S.air = Math.max(0, Math.min(1, (S.air || 0) + (off ? dt : -dt) * 12));
    const u = O.off ? [0, 0, 0] : lag, f = solve({ ...o, lag: u, surf: scene.surfZ + S.bob * (0.4 + 0.6 * Math.min(2, g)) }); if (pt && S.air > 0 && O.kind === 'finger') { const q = solve({ ...o, lag: u, surf: -1e4, floor: -1e4 }), m = (a, b) => a.map((v, i) => v + (b[i] - v) * S.air); f.tip = m(f.tip, q.tip); } S.f = f; S.f.cursor = add(rest, lag, g);
  }
  S.f.rest = rest;
}
function thing(low) { // made again only when something about it has changed
  const k = low == null ? '' : [O.thing, low.toFixed(1), scene.W, scene.H].join(); if (k === S.thingKey) return; S.thingKey = k; S.thing = low == null ? null : makeThing(O.thing, scene.IW * 1.06, scene.IH * 1.06, low, DEPTH); scene.setThing(S.thing);
}
function failed(x) { S.fails = (S.fails || 0) + 1; S.err = `${x?.message || x}`; console.error(x); }
function loop() { requestAnimationFrame(loop); try { frame(); } catch (x) { failed(x); $('#msg').textContent = `エラー：${S.err}`; S.root = null; S.f = null; } }
function frame() {
  const began = now(), t = began, dt = Math.min(0.05, (t - last) / 1000); last = t; S.fps += ((1 / Math.max(dt, 1e-3)) - S.fps) * 0.05;
  noTouch(); const m = measured(), eye = S.eye.update(m, fallback(), t, O.eye === 'track');
  if (!S.started) startScreen(); { const h = !canFull() || full(); if ($('#fs').hidden !== h) $('#fs').hidden = h; }
  { const on = S.started && S.contact.down && S.fit == null; if (on !== S.was) { S.was = on; document.body.classList.toggle('touching', on); if (on) tray(false); } }
  scene.light(upOf(tiltDeg()));
  if (S.eyes) S.eyes.busy = S.started && S.contact.down && (lead.speed || 0) > 10;
  if (S.started) finger(dt, t); else { if (t - (S.tEvent || 0) > 40) sense(); S.f = null; } lines();
  if (S.started && dt < 0.05 && t - (S.tSlow ||= t) > 3000) { S.tSlow = t; if (S.fps < 50) scene.lighter(); }
  scene.finger(S.f, O.kind, S.root, S.contact.down ? 1 : 0.5, S.tip.lag, O.joint, O.look, S.yaw || 0, S.smear); scene.skin.photoGain = 2 ** (val('#bright') / 50); scene.skin.setColor(skinColor(dt)); scene.ghost(GHOST && S.f ? [S.root, S.f.u, S.yaw || 0, [val('#l0'), val('#l1'), val('#l2')]] : null); scene.render([eye[0] * val('#peek') / 100 + val('#vx'), eye[1] + val('#vy'), eye[2]]);
  const msg = scene.lost ? '絵が止まりました。［最新にする］を押してください' : t < flashT ? flashM : !S.started ? '' : S.rec ? `記録中 あと ${Math.max(0, Math.ceil(20 - (t - S.rec.t0) / 1000))} 秒` : t - (S.cancelAt || -1e9) < 4000 ? 'iPadが接触を打ち切りました。いちど手を離してください' : !S.root ? `${WHERE[O.joint]}を画面に付けて、すべらせる` : O.eye === 'track' && S.eye.src !== 'measured' && t - (S.eye.tLast || 0) > 1500 ? '顔が見えません' : '';
  if ($('#msg').textContent !== msg) $('#msg').textContent = msg;
  if (S.rec) { const f = S.f; S.rec.rows.push({ t: +(t - S.rec.t0).toFixed(1), c: S.raw.map((c) => [c.id, +c.x.toFixed(2), +c.y.toFixed(2), +c.rx.toFixed(2), +c.ry.toFixed(2)]), p: S.contact.p?.map((v) => +v.toFixed(2)), root: S.root?.map((v) => +v.toFixed(2)), lag: S.tip.lag.map((v) => +v.toFixed(2)), bend: f && +f.bendDeg.toFixed(1), miss: +lead.miss.toFixed(2), tilt: S.tilt.deg && +S.tilt.deg.toFixed(2), eye: eye.map((v) => +v.toFixed(1)), src: S.eye.src, fps: +S.fps.toFixed(0) }); if (t - S.rec.t0 > 20000) sendRec(); }
  if (!$('#tray').hidden && !$('#panel').hidden && (S.tickV = (S.tickV || 0) + 1) % 6 === 0) values(m, eye);
  S.ms = (S.ms || 0) + (now() - began - (S.ms || 0)) * 0.05;
}
function values(m, eye) {
  const w = eyeToWorld(tiltDeg(), eye), s = S.f && S.root ? seenAt(S.f.tip, eye) : null, cm = (v) => `${(v / 10).toFixed(0)} cm`, row = (a, b) => `<tr><td>${a}</td><td>${b}</td></tr>`;
  const dx = s && s[0] - S.root[0], dy = s && s[1] - S.root[1];
  $('#vals').innerHTML = row('iPadの傾き', S.tilt.deg == null ? '測れない（26°）' : `${S.tilt.deg.toFixed(1)}°`) + row(O.joint === 'mp' ? '手の甲の傾き（水平から）' : '基節の傾き（水平から）', `${(val('#theta') - tiltDeg()).toFixed(0)}°`)
    + row('目', { measured: '測っている', held: '見失った（保持）', default: '既定の位置' }[S.eye.src]) + row('目までの距離', cm(Math.hypot(...eye))) + row('目の左右／手前／高さ', `${cm(w.side)}／${cm(w.back)}／${cm(w.height)}`)
    + row('仮想の指先が見える所', s ? `${Math.abs(dx).toFixed(0)} mm ${dx < 0 ? '左' : '右'}・${Math.abs(dy).toFixed(0)} mm ${dy < 0 ? '手前' : '奥'}` : '—') + row('遅れ／しなり', S.f ? `${Math.hypot(...S.tip.lag).toFixed(0)} mm／${S.f.bendDeg.toFixed(0)}°` : '—')
    + row('予測のはずれ', `${lead.miss.toFixed(1)} mm`) + row('肌の色', O.skin === 'auto' ? (S.skin ? '顔から測っている' : '顔を待っています（手で選んだ色）') : '手で選んだ色') + row('接触の数／つなぎ直し', `${S.raw.length}／${S.contact.jumps}`) + row('打ち切られた接触', S.cancels) + row('指の受け取り', `タッチ ${IN.touch}・ポインタ ${IN.pointer}（${IN.by || 'まだ'}）`) + row('エラー', S.err ? `${S.err}（${S.fails}回）` : 'なし') + row('版', '11') + row('顔の認識', S.eyes?.cost ? `${S.eyes.cost.toFixed(0)} ms（${S.eyes.mode === 'worker' ? '別スレッド' : '同じスレッド'}）` : '—') + row('速さ／1コマの計算', `${S.fps.toFixed(0)} fps／${(S.ms || 0).toFixed(1)} ms`);
}
try { scene = new Scene($('#scene')); $('#scene').addEventListener('webglcontextlost', () => { scene.lost = true; }); $('#scene').addEventListener('webglcontextrestored', () => { scene.lost = false; }); const lay = () => { scene.layout(MM); cameraPlace(); }; lay(); addEventListener('resize', lay); scene.setMaterial(O.mat); scene.warm(); requestAnimationFrame(loop); lastPhoto().then((p) => { if (p) { S.photo = p; scene.skin.setPhoto(p.texture, p.mean); scene.skin.look = ''; } }); } catch (e) { $('#sMsg').textContent = `描画できません（${e.message}）。再読み込みしてください`; }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { try { TOP.navigator.wakeLock?.request('screen').catch(() => {}); } catch {} if (S.asked && O.eye === 'track') startEyes(); } });
window.mpIpad = { S, O, get scene() { return scene; } };
