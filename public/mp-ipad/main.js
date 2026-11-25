// Stroking on the iPad itself: the PIP knuckle or the fingertip of one or two fingers is on the glass, a virtual finger goes on from there into the screen. Only the hand slides.
// touch -> where the contact is, motion sensor -> how the iPad stands, front camera -> where the eyes are. No server, no PC.
import { Point, Pair, Lead, Ahead, Tilt, Eye, TOP, live, camera, cameraOff, makeEyes, eyeFrom, eyeToWorld, upOf } from './sensors.js?v=15';
import { MATS, CONTACTS, FINGERS, ORDER, RF, PRESS, Tip, solve, restTip, reach, within, lengths, grain, seenAt, add } from './finger.js?v=15';
import { settle } from './world.js?v=15';
import { THINGS, makeThing } from './objects.js?v=15';
import { Scene, DEPTH } from './scene.js?v=15';
import { tone, LOOKS } from './skin.js?v=15';
import { fingerFromPhoto, keepPhoto, lastPhoto } from './photo.js?v=15';
import { Color, SRGBColorSpace } from 'three';
let scene = null;

const $ = (s) => document.querySelector(s), now = () => performance.now(), rad = (d) => d * Math.PI / 180, val = (id) => +$(id).value;
const MINI = typeof screen !== 'undefined' && Math.min(screen.width, screen.height) === 744, MM = MINI ? 0.1558 : 0.1924, STORE = 'mpIpad.v7', VERSION = 15; // mm per CSS px: iPads have 264 ppi, the iPad mini (744 points wide) 326; the finger must have its real size
// contact: joint / tip, pose: flat / side (thumb up), n: one or two fingers, pair: first finger of the two; effect: where the feeling comes from
const O = { contact: 'joint', pose: 'flat', n: '1', finger: 'index', pair: '0', effect: 'both', group: 'thing', thing: 'harp', mat: 'sand', kind: 'finger', hand: 'right', eye: 'track', cam: 'top', look: 'real', skin: 'auto', cut: '0' };
const REMEMBER = ['contact', 'pose', 'n', 'finger', 'pair', 'effect', 'group', 'thing', 'mat', 'hand', 'cam', 'look', 'skin'];
const saved = (() => { try { const o = JSON.parse(localStorage.getItem('mpIpad.v5') || '{}'), k = o.set || {}; { const n = JSON.parse(localStorage.getItem('mpIpad.v6') || 'null'); if (n && !localStorage.getItem(STORE)) { const was = { joint: { exag: 100, long: 150, thick: 120, peek: 180 }, tip: { exag: 0, long: 100, thick: 100, peek: 120 } }; for (const [k, v] of Object.entries(n.own || {})) for (const [a, x] of Object.entries(was[k.split('.')[0]] || {})) if (v[a] === x) delete v[a]; return n; } } return JSON.parse(localStorage.getItem(STORE) || 'null') || { xShift: o.xShift, zScale: o.zScale, o: { cam: o.cam, hand: o.hand, look: o.look, skin: o.skin }, set: { lead: k.lead, bright: k.bright, tone: k.tone, l0: k.l0, l1: k.l1, l2: k.l2, shade: k.shade } }; } catch { return {}; } })();
const newFinger = () => ({ lead: new Lead(), ahead: new Ahead(), tip: new Tip(), root: null, f: null, at: null, smear: [0, 0], bob: 0, air: 0 });
const S = { started: false, ready: false, raw: [], cancels: 0, contact: new Point(), fg: [newFinger(), newFinger()], tilt: new Tilt(), eye: new Eye(), eyes: null, xShift: saved.xShift || 0, zScale: saved.zScale || 1, thing: null, skin: null, fps: 0, rec: null, err: '', get root() { return this.fg[0].root; }, get f() { return this.fg[0].f; }, get tip() { return this.fg[0].tip; } };
const two = () => O.n === '2', who = () => (two() ? [ORDER[+O.pair], ORDER[+O.pair + 1]] : [O.finger]), tracker = () => (two() ? new Pair(O.hand, +O.pair, O.pose) : new Point(O.hand, ORDER.indexOf(O.finger), O.pose)), tracks = () => (two() ? S.contact.t : [S.contact]);
const clean = () => { for (const q of S.fg) { q.x = q.dx = null; q.root = q.f = null; q.tip.reset(); q.lead.reset(); q.ahead.reset(); q.bob = 0; } S.thing?.reset(); };
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
  const n = now(), t = e && Math.abs(n - e.timeStamp) < 150 ? Math.max(e.timeStamp, S.tEvent || 0) : n, T = tracks(), had = T.map((q) => q.p); S.contact.update(S.raw, t); S.tEvent = t;
  if (S.contact.swapped) { S.contact.swapped = false; S.fg.reverse(); had.reverse(); S.thing?.f.reverse(); S.thing?.over?.reverse(); }
  tracks().forEach((q, i) => { const p = q.p, h = had[i], L = S.fg[i].lead; if (!p || !h || Math.hypot(p[0] - h[0], p[1] - h[1]) > 25) L.reset(); if (p && q.down) L.add(p, t); });
}
for (const n of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) pad.addEventListener(n, safe(read), { passive: false });
function point(e) {
  const p = IN.pts, up = e.type === 'pointerup' || e.type === 'pointercancel';
  if (e.type === 'pointerdown') { IN.pointer++; IN.tDown = now(); p.set(e.pointerId, mm(e, e.pointerId)); try { pad.setPointerCapture(e.pointerId); } catch {} } else if (!p.has(e.pointerId)) return; else if (up) p.delete(e.pointerId); else p.set(e.pointerId, mm(e, e.pointerId));
  if (e.pointerType === 'mouse' || IN.by === 'pointer') { IN.by = 'pointer'; S.raw = [...p.values()]; if (e.pointerType === 'mouse' && e.shiftKey && S.raw.length === 1) S.raw.push({ ...S.raw[0], id: 'm2', x: S.raw[0].x + (O.pose === 'side' ? 0 : 20), y: S.raw[0].y - (O.pose === 'side' ? 20 : 0) }); sense(e); }
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
const KEEP = ['near', 'soft', 'vx', 'vy', 'taper', 'over', 'deep', 'cshade', 'blob', 'fade', 'shade', 'gain', 'l0', 'l1', 'l2', 'tone', 'bright', 'lead', 'ahead', 'smear'];
// each way of touching has its own place, direction and exaggeration
const ADJ = ['off', 'offx', 'exag', 'long', 'thick', 'peek', 'roll', 'rt', 'dn'], START = { joint: { off: 0, offx: 0, exag: 110, long: 155, thick: 126, peek: 190, roll: 0, rt: 0, dn: 0 }, tip: { off: 0, offx: 0, exag: 20, long: 110, thick: 106, peek: 130, roll: 0, rt: 0, dn: -48 } }, own = {};
for (const c of ['joint', 'tip']) for (const p of ['flat', 'side']) own[`${c}.${p}`] = { ...START[c], ...(c === 'joint' && p === 'flat' ? { roll: 8 } : {}) };
const store = () => { try { localStorage.setItem(STORE, JSON.stringify({ xShift: S.xShift, zScale: S.zScale, o: Object.fromEntries(REMEMBER.map((k) => [k, O[k]])), own, set: Object.fromEntries(KEEP.map((id) => [id, val(`#${id}`)])) })); } catch {} };
let flashT = 0, flashM = ''; function flash(t, ms = 2500) { flashM = t; flashT = now() + ms; }

// ---------- settings ----------
const svg = (d) => `<svg viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"><path d="${d}"/></svg>`, SHAPE = { cube: 'M18 4l13 7v14l-13 7-13-7V11z M5 11l13 7 13-7 M18 18v14', bumps: 'M2 24c5 0 5-12 10-12s5 12 8 12 4 7 7 7 3-7 7-7', push: 'M14 12h16v16H14z M2 20h10 M8 16l4 4-4 4', harp: 'M3 8h30 M3 14h9l5 4 5-4h11 M3 22h30 M3 28h30 M6 4v28', slime: 'M4 18c4 0 5-4 9-4 M23 14c4 0 5 4 9 4 M4 18v9c0 4 28 4 28 0v-9 M15 3v17c0 4 6 4 6 0V3', slimetop: 'M4 30h28 M18 6v8 M18 14c-1 8-6 10-8 16 M18 14c1 8 6 10 8 16 M18 14v16', soft: 'M6 20a12 12 0 0124 0c0 8-5 11-12 11S6 28 6 20z M12 11c4 4 8 4 12 0', posts: 'M8 32V10 M18 32c0-12 2-18 8-22 M30 32V10 M4 32h28', grass: 'M4 32c2-10 0-14-2-18 M12 32c0-12 2-18 5-22 M20 32c-1-10 2-16 6-18 M28 32c0-8 2-12 5-14' }, ICON = (k) => svg(SHAPE[k]), DOT = { smooth: '#8fc3d6', sand: '#b08a62', stone: '#d9c499', knit: '#4f9a78', tape: '#c4a06a', honey: '#e09a35', rubber: '#ea8d98', fur: '#b8926a', water: '#1f6f93' };
// the hand, as small pictures
const PIC = { joint: 'M6 26h24 M11 5v13c0 5 7 5 7 0V10 M18 18v-7c4-3 8 0 8 4v5', tip: 'M6 28h24 M28 5L17 24c-2 3-6 1-4-3L23 3', flat: 'M9 30V15 M14 30V9 M19 30V8 M24 30V11 M9 20L5 15', side: 'M30 9H15 M30 14H9 M30 19H8 M30 24H11 M20 9l-4-5' };
const pic = (k, n) => `${svg(PIC[k])}<b>${n}</b>`, card = (p, name) => `${p}<b>${name}</b>`;
function seg(id, list, key, f) { $(id).innerHTML = list.map(([k, t]) => `<button class="btn ui" data-k="${k}">${t}</button>`).join(''); for (const b of $(id).children) b.onclick = () => { O[key] = b.dataset.k; syncSeg(id, key); f?.(); }; syncSeg(id, key); }
function syncSeg(id, key) { for (const b of $(id).children) b.setAttribute('aria-pressed', b.dataset.k === O[key]); }
for (const k of REMEMBER) if (saved.o?.[k] != null) O[k] = saved.o[k]; if (!MATS[O.mat]?.name) O.mat = 'sand'; if (!THINGS.some((x) => x[0] === O.thing)) O.thing = 'harp'; if (!FINGERS[O.finger]) O.finger = 'index'; if (!CONTACTS[O.contact]) O.contact = 'joint';
for (const o of Object.values(saved.own || {})) if (o.rt == null && o.lr) o.rt = -o.lr * (O.hand === 'right' ? 1 : -1); // before version 14 the other way round
for (const k of Object.keys(own)) for (const a of ADJ) if (Number.isFinite(saved.own?.[k]?.[a])) own[k][a] = saved.own[k][a]; for (const [id, v] of Object.entries(saved.set || {})) if (KEEP.includes(id) && Number.isFinite(v)) $(`#${id}`).value = v;
const EFFECT = [['both', '指と物'], ['finger', '指だけ'], ['thing', '物だけ'], ['none', 'なし']], SOFT = [['0', '固い'], ['50', 'ふつう'], ['100', 'ふにゃ']], POWER = [['0.6', '弱'], ['1', '中'], ['1.6', '強']], TEX = Object.entries(MATS).filter(([, m]) => m.name);
const name = () => (O.group === 'thing' ? THINGS.find((q) => q[0] === O.thing)[1] : MATS[O.mat].name), label = () => { $('#now').textContent = name(); $('#eff').textContent = EFFECT.find((e) => e[0] === O.effect)[1]; $('#eff').dataset.e = O.effect; $('#way').textContent = `${two() ? who().map((k) => FINGERS[k].name).join('と') : FINGERS[O.finger].name}の${O.contact === 'tip' ? '指先' : '第2関節'}${O.pose === 'side' ? '・横向き' : ''}`; };
const shownGroup = () => { $('#things').hidden = O.group !== 'thing'; $('#mats').hidden = O.group !== 'tex'; }, changed = () => { clean(); shownGroup(); store(); label(); };
seg('#group', [['thing', '物'], ['tex', '質感']], 'group', changed); seg('#things', THINGS.map(([k, n]) => [k, card(ICON(k), n)]), 'thing', changed); seg('#mats', TEX.map(([k, m]) => [k, card(`<i style="background:${DOT[k]}"></i>`, m.name)]), 'mat', changed); shownGroup();
// to the next one without opening the settings
function turn(d) { const all = O.group === 'thing' ? THINGS.map((x) => x[0]) : TEX.map((x) => x[0]), key = O.group === 'thing' ? 'thing' : 'mat', i = all.indexOf(O[key]); O[key] = all[(i + d + all.length) % all.length]; syncSeg('#things', 'thing'); syncSeg('#mats', 'mat'); changed(); }
$('#prev').onclick = () => turn(-1); $('#next').onclick = () => turn(1);
const effect = () => { for (const q of S.fg) q.tip.reset(); S.thing?.reset(); syncSeg('#effects', 'effect'); store(); label(); }; $('#eff').onclick = () => { O.effect = EFFECT[(EFFECT.findIndex((e) => e[0] === O.effect) + 1) % 4][0]; effect(); }; seg('#effects', EFFECT, 'effect', effect);
// the way of touching
let shown = null; const key = () => `${O.contact}.${O.pose}`;
// seen from the side: the own finger on the glass, the finger in the screen going on from it (words alone did not tell a newcomer how to put the hand)
const HOW = (tip) => `<svg viewBox="0 0 280 150" fill="none" stroke-linecap="round" stroke-linejoin="round" font-size="12" font-weight="600"><path d="${tip ? 'M117 88L78 132' : 'M120 88v46'}" stroke="#ffb56b" stroke-width="20"/><path d="M10 80h260" stroke="#9fb4c4" stroke-width="3"/><path d="${tip ? 'M186 6L126 67' : 'M184 12L120 66L160 59'}" stroke="#e9bc9c" stroke-width="20"/><path d="M34 30h52M42 22l-8 8 8 8M78 22l8 8-8 8" stroke="#f4f2ef" stroke-width="2.5"/><g stroke="none"><text x="60" y="56" text-anchor="middle" fill="#f4f2ef">すべらせる</text><text x="206" y="46" fill="#e9bc9c">自分の指</text><text x="268" y="98" text-anchor="end" fill="#9fb4c4">画面</text><text x="140" y="126" fill="#ffb56b">画面の中の指</text></g></svg>`;
$('#label').onclick = (e) => { tray(true); tab(e.target.id === 'way' ? 'hand' : 'touch'); };
function way() {
  shown = key(); for (const id of ADJ) $(`#${id}`).value = own[shown][id]; $('#fingers').hidden = two(); $('#pairs').hidden = !two(); S.contact = tracker(); clean(); mend(); labels(); label(); store(); $('#how').textContent = `${$('#way').textContent}を画面に付けて、すべらせます`; $('#pose').innerHTML = HOW(O.contact === 'tip');
}
const labels = () => { for (const i of document.querySelectorAll('#tray input[type=range]')) i.previousElementSibling.textContent = `${i.value}${i.dataset.u}`; };
const moved = () => { labels(); if (shown) for (const id of ADJ) own[shown][id] = val(`#${id}`); store(); }; for (const i of document.querySelectorAll('#tray input[type=range]')) i.oninput = moved;
$('#exag').oninput = () => { const k = val('#exag') / 100; $('#long').value = 100 + 50 * k; $('#thick').value = 100 + 20 * k; $('#peek').value = Math.max(100, (O.contact === 'tip' ? 120 : 100) + 80 * k); moved(); };
const near = (list, id) => list.map((q) => q[0]).reduce((a, b) => (Math.abs(b - val(id)) < Math.abs(a - val(id)) ? b : a)); const choice = (id, list, k, slider) => { const same = () => { O[k] = list.find((q) => +q[0] === val(slider))?.[0] || ''; syncSeg(id, k); }; seg(id, list, k, () => { $(slider).value = O[k]; moved(); }); same(); $(slider).oninput = () => { moved(); same(); }; };
choice('#softs', SOFT, 'softK', '#soft'); choice('#power', POWER, 'powerK', '#gain');
seg('#contacts', [['joint', pic('joint', '第2関節')], ['tip', pic('tip', '指先')]], 'contact', way); seg('#poses', [['flat', pic('flat', 'ふつう')], ['side', pic('side', '横向き（親指が上）')]], 'pose', way); seg('#count', [['1', '1本'], ['2', '2本']], 'n', way);
seg('#fingers', ORDER.map((k) => [k, FINGERS[k].name]), 'finger', way); seg('#pairs', [0, 1, 2].map((i) => [`${i}`, `${FINGERS[ORDER[i]].name}＋${FINGERS[ORDER[i + 1]].name}`]), 'pair', way);
seg('#hands', [['left', '左手'], ['right', '右手']], 'hand', () => { document.body.classList.toggle('left', O.hand === 'left'); way(); }); document.body.classList.toggle('left', O.hand === 'left');
seg('#looks', LOOKS.map(([k, n]) => [k, card(`<i class="l-${k}"></i>`, n)]), 'look', () => { mend(); store(); if (O.look === 'photo' && !S.photo) $('#photo').click(); }); seg('#skins', [['auto', '顔から自動'], ['hand', '手で選ぶ']], 'skin', () => store()); seg('#kinds', [['finger', '指'], ['stick', '棒'], ['cursor', 'カーソル']], 'kind', mend);
seg('#eyes', [['track', '視線追従'], ['fixed', '追従しない']], 'eye', () => { if (O.eye === 'track') startEyes(); else { S.eyes?.stop(); cameraOff(); } }); seg('#cams', [['top', '上'], ['left', '左'], ['right', '右']], 'cam', () => { cameraPlace(); store(); });
// the blade: falls once, so many seconds after it was switched on
function mend() { if (!scene) return; scene.blade.mend(); $('#mend').hidden = true; }
seg('#cuts', [['0', 'なし'], ['10', '10秒後'], ['30', '30秒後']], 'cut', () => { mend(); S.cutAt = +O.cut ? now() + 1000 * O.cut : null; }); $('#mend').onclick = mend;
function bomb(t, dt) {
  const B = scene.blade, on = tracks().map((q, i) => S.fg[i].f && q.down), any = on.some(Boolean);
  if (S.cutAt && t >= S.cutAt && any && O.kind === 'finger' && !B.busy && !B.pieces.length) { S.cutOn = [0, 1].filter((i) => on[i]); B.start(S.cutOn.map((i) => scene.skins[i]), [scene.W / 2, scene.H / 2]); }
  if (B.busy && !B.cut && !any) B.mend(); // the hand has gone: it waits
  if (B.step(dt, upOf(tiltDeg()).map((v) => -v), (x, y) => scene.below(x, y), !!S.thing?.pool)) { S.cutAt = null; S.cutT = t; O.cut = '0'; syncSeg('#cuts', 'cut'); S.thing?.reset(); for (const q of S.fg) q.tip.reset(); try { navigator.vibrate?.(40); } catch {} }
  { const h = !(B.pieces.length && !B.busy && t - (S.cutT || 0) > 1500); if ($('#mend').hidden !== h) $('#mend').hidden = h; }
  const left = S.cutAt ? Math.ceil((S.cutAt - t) / 1000) : 0, text = S.cutAt ? (left > 0 ? `${left}` : any ? '' : '指を置く') : ''; if ($('#bomb').textContent !== text) $('#bomb').textContent = text;
}
const tray = (on) => { $('#tray').hidden = !on; $('#open').setAttribute('aria-pressed', on); }; $('#open').onclick = () => tray($('#tray').hidden);
function tab(t) { for (const b of $('#tabs').children) b.setAttribute('aria-pressed', b.dataset.t === t); for (const q of document.querySelectorAll('#tray section')) q.hidden = q.dataset.t !== t; $('#tray').scrollTop = 0; } for (const b of $('#tabs').children) b.onclick = () => tab(b.dataset.t); tab('touch');
$('#reset').onclick = () => { try { localStorage.removeItem(STORE); localStorage.removeItem('mpIpad.v5'); } catch {} renew(); };
way();
// the delay is set by eye: two long lines through the predicted contact; the other hand moves the slider until they stay with the knuckle
const FIT = [['', '1. 正面', '画面の正面に座って、まっすぐ見る'], ['lead', '2. 遅れ', '手をすべらせながら、赤い線が関節についてくる所へ'], ['bright', '3. 肌の明るさ', '画面の中の指が、自分の指と同じ明るさになる所へ'], ['exag', '4. 誇張', '指がちょうどよく見える所へ'], ['roll', '5. ひねり', '爪の向きが自分の指と合う所へ'], ['rt', '6. 向き（左右）', '自分の指の続きに見える向きへ'], ['dn', '7. 向き（上下）', '自分の指の続きに見える向きへ'], ['taper', '8. 断面', '断面が見えなくなる所へ']];
function fit(i) {
  const f = FIT[i]; S.align = f?.[0] === 'lead'; S.fit = f ? i : null; $('#fit').hidden = !f; $('#bar').hidden = !!f; if (!f) return;
  const e = f[0] && $(`#${f[0]}`), r = $('#fitR'); $('#fitT').textContent = f[1]; $('#fitP').textContent = f[2]; $('#fitN').textContent = i < FIT.length - 1 ? 'つぎへ' : 'できた'; r.hidden = !e; if (!e) return; for (const k of ['min', 'max', 'step']) r[k] = e[k]; r.value = e.value; r.oninput = () => { e.value = r.value; e.oninput(); };
}
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
  S.file = file; tray(true); tab('adj'); $('#rec').textContent = '記録を送る'; $('#rec').onclick = async () => {
    try { if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file] }); return; } } catch (e) { if (e.name === 'AbortError') return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; a.click();
  };
}

// ---------- loop ----------
let last = now();
const gains = () => { const g = val('#gain'), e = O.effect; return { gf: e === 'both' || e === 'finger' ? g : 0, go: e === 'both' ? g : e === 'thing' ? g * 1.3 : 0 }; }; // gf: how much the finger is held back, go: how much the things give way
function finger(dt, t) {
  if (t - (S.tEvent || 0) > 40) sense(); // no news: the hand rests (or has gone)
  const sgn = O.hand === 'right' ? 1 : -1, yaw = -rad(val('#roll') + (O.pose === 'side' ? 90 : 0)) * sgn, names = who(), soft = val('#soft') / 100, { gf, go } = gains(), C = CONTACTS[O.contact];
  const base = { contact: O.contact, len: lengths([val('#l0'), val('#l1'), val('#l2')], names, O.contact, val('#long') / 100), dir: [-rad(val('#rt')), rad(val('#dn'))], yaw, soft }, home = { ...base, root: [0, 0, C.h] }, low = restTip(home)[2] - RF, R = reach(home); S.yaw = yaw; S.low = low; S.names = names;
  scene.shade(val('#shade') / 100); for (const q of scene.skins) { q.setThick(val('#thick') / 100); q.setCut({ taper: val('#taper') / 100, over: val('#over'), depth: val('#deep'), shade: val('#cshade') / 100, fade: val('#fade'), blob: val('#blob') / 100 }); }
  thing(O.group === 'thing' ? low : null); for (const q of scene.skins) q.setGel(S.thing?.deep ? -S.thing.surf : null); const T = S.thing, mkey = T ? 'slime' : O.mat, M = MATS[mkey], fit = (l) => within(R, l, gf > 0 ? 1 : 0); scene.setDepth(low + PRESS + (T ? 0 : val('#near') * 0.4)); scene.setMaterial(mkey);
  tracks().forEach((c, i) => {
    const q = S.fg[i], p = c.p; if (!p) { if (q.root) { q.x = q.dx = null; q.root = q.f = null; q.tip.reset(); T?.reset(i); q.lead.reset(); q.ahead.reset(); } return; }
    const at = c.down && q.lead.at(t, val('#lead')) || p, [x, y] = c.down || !q.root ? at : q.at; q.at = [x, y]; const A = q.ahead.step(c.down ? q.lead.vel : [0, 0], val('#ahead'), dt);
    q.root = [x + A[0] + val('#offx'), y + A[1] + val('#off'), C.h];
    { const v = q.lead.vel, sp = Math.hypot(...v), n = c.down && sp > 5 ? Math.min(val('#smear'), 1.2 * q.lead.miss + sp * 0.004) / sp : 0; q.smear = [0, 1].map((k) => q.smear[k] + (v[k] * n - q.smear[k]) * Math.min(1, dt * 20)); }
    const o = { ...base, root: q.root, reach: R, kind: O.kind }, rest = restTip(o);
    if (scene.skins[i].slice != null) { q.tip.lag = [0, 0, 0]; q.f = solve(o); q.pull = q.lean = [0, 0]; } // what is left of it feels nothing
    else if (T) {
      const lag0 = T.step(i, rest, dt, { fit, gain: gf, go }), lag = spring(q, lag0, R, dt); q.tip.lag = lag; q.f = T.w ? settle(T.w, { ...o, lag }) : solve({ ...o, lag, ...(T.touch != null ? { lo: T.touch + RF - PRESS - 2.5 } : {}) }); T.tipZ = q.f.tip[2]; q.pull = [0, 1].map((k) => -lag[k] * M.drag * Math.min(1.4, go)); q.lean = q.pull;
    } else {
      // over the edge of the island there is nothing to touch
      const p0 = q.tip.p || rest, off = Math.abs(p0[0]) > scene.IW / 2 || Math.abs(p0[1]) > scene.IH / 2, lag = spring(q, q.tip.step(rest, off ? { k: 45, hold: 0 } : M, dt, (l) => fit(l.map((v) => v * gf))), R, dt), h = M.bump && !off ? M.bump * grain(q.tip.p[0], q.tip.p[1], M.f) : 0; q.bob += (h - q.bob) * Math.min(1, dt * 40); q.air = Math.max(0, Math.min(1, q.air + (off ? dt : -dt) * 12));
      const z = scene.surfZ + q.bob * (0.4 + 0.6 * Math.min(2, gf)) - 40 * q.air; q.f = solve({ ...o, lag, lo: z + RF - PRESS - M.dent * Math.min(1, go), ...(q.air ? {} : { hi: z + RF - 0.3 }) }); const d = Math.max(M.drag, O.effect === 'thing' ? 0.65 : 0) * Math.min(1.4, go); q.pull = off ? [0, 0] : [0, 1].map((k) => -q.tip.raw[k] * d); q.lean = go > 0 ? [-q.tip.raw[0], -q.tip.raw[1]] : [0, 0];
    }
    q.f.rest = rest;
  });
  T?.world(dt);
}
// when the fingertip gets free it snaps past its place and back, as after plucking
function spring(q, lag, R, dt) {
  q.x ||= [0, 0]; q.dx ||= [0, 0]; if (!Number.isFinite(q.x[0] + q.x[1])) q.x = [0, 0]; const n = Math.max(1, Math.ceil(dt * 480)), h = dt / n, w = 75, z = 0.42; for (let k = 0; k < n; k++) for (const i of [0, 1]) { q.dx[i] += (w * w * (lag[i] - q.x[i]) - 2 * z * w * q.dx[i]) * h; q.x[i] += q.dx[i] * h; }
  if (Math.hypot(...lag) < 1e-6 && Math.hypot(...q.x) < 1e-3) { q.x = [0, 0]; q.dx = [0, 0]; } return O.effect === 'both' || O.effect === 'finger' ? within(R, [q.x[0], q.x[1], 0]) : lag;
}
function thing(low) { // made again only when something about it has changed
  const k = low == null ? '' : [O.thing, low.toFixed(1), scene.W, scene.H, val('#near')].join(); if (k === S.thingKey) return; S.thingKey = k; S.thing = low == null ? null : makeThing(O.thing, scene.IW * 1.06, scene.IH * 1.06, low, DEPTH, val('#near')); scene.setThing(S.thing);
}
function failed(x) { S.fails = (S.fails || 0) + 1; S.err = `${x?.message || x}`; console.error(x); }
function loop() { requestAnimationFrame(loop); try { frame(); } catch (x) { failed(x); $('#msg').textContent = `エラー：${S.err}`; for (const q of S.fg) q.root = q.f = null; } }
function frame() {
  const began = now(), t = began, dt = Math.min(0.05, (t - last) / 1000); last = t; S.fps += ((1 / Math.max(dt, 1e-3)) - S.fps) * 0.05;
  noTouch(); const m = measured(), eye = S.eye.update(m, fallback(), t, O.eye === 'track');
  if (!S.started) startScreen(); { const h = !canFull() || full(); if ($('#fs').hidden !== h) $('#fs').hidden = h; }
  { const on = S.started && S.contact.down && S.fit == null; if (on !== S.was) { S.was = on; document.body.classList.toggle('touching', on); if (on) tray(false); } }
  scene.light(upOf(tiltDeg()));
  const down = S.contact.down; if (S.eyes) S.eyes.busy = S.started && down && S.fg.some((q) => (q.lead.speed || 0) > 10);
  if (S.started) finger(dt, t); else { if (t - (S.tEvent || 0) > 40) sense(); for (const q of S.fg) q.f = null; } lines();
  if (S.started && dt < 0.05 && t - (S.tSlow ||= t) > 3000) { S.tSlow = t; if (S.fps < 50) scene.lighter(); }
  scene.finger(tracks().map((c, i) => ({ ...S.fg[i], alpha: c.down ? 1 : 0.5, width: FINGERS[who()[i]].w * 1.07 })), O.kind, O.contact, O.look, S.yaw || 0, gains().go); if (S.started) bomb(t, dt); const col = skinColor(dt); for (const q of scene.skins) { q.photoGain = 2 ** (val('#bright') / 50); q.setColor(col); } scene.ghost(GHOST && S.f && O.contact === 'joint' ? [S.root, S.f.base, S.yaw || 0, [val('#l0'), val('#l1'), val('#l2')]] : null); scene.render([eye[0] * val('#peek') / 100 + val('#vx'), eye[1] + val('#vy'), eye[2]]);
  const missing = two() && down && !S.contact.t.every((q) => q.down), msg = scene.lost ? '絵が止まりました。［最新にする］を押してください' : t < flashT ? flashM : !S.started ? '' : S.rec ? `記録中 あと ${Math.max(0, Math.ceil(20 - (t - S.rec.t0) / 1000))} 秒` : t - (S.cancelAt || -1e9) < (S.cancels > 2 ? 8000 : 4000) ? (S.cancels > 2 ? 'iPadの設定で「4本指・5本指のジェスチャ」をオフにしてください' : 'iPadが接触を打ち切りました。いちど手を離してください') : !S.fg.some((q) => q.root) ? `${$('#way').textContent}を画面に付けて、すべらせる` : missing ? 'もう1本も画面に付ける' : O.eye === 'track' && S.eye.src !== 'measured' && t - (S.eye.tLast || 0) > 1500 ? '顔が見えません' : '';
  if ($('#msg').textContent !== msg) $('#msg').textContent = msg;
  if (S.rec) { const f = S.f; S.rec.rows.push({ t: +(t - S.rec.t0).toFixed(1), c: S.raw.map((c) => [c.id, +c.x.toFixed(2), +c.y.toFixed(2), +c.rx.toFixed(2), +c.ry.toFixed(2)]), p: tracks().map((q) => q.p?.map((v) => +v.toFixed(2))), root: S.fg.map((q) => q.root?.map((v) => +v.toFixed(2))), lag: S.fg.map((q) => q.tip.lag.map((v) => +v.toFixed(2))), bend: f && +f.bendDeg.toFixed(1), miss: +S.fg[0].lead.miss.toFixed(2), tilt: S.tilt.deg && +S.tilt.deg.toFixed(2), eye: eye.map((v) => +v.toFixed(1)), src: S.eye.src, fps: +S.fps.toFixed(0) }); if (t - S.rec.t0 > 20000) sendRec(); }
  if (!$('#tray').hidden && $('#valBox').open && (S.tickV = (S.tickV || 0) + 1) % 6 === 0) values(m, eye);
  S.ms = (S.ms || 0) + (now() - began - (S.ms || 0)) * 0.05;
}
function values(m, eye) {
  const w = eyeToWorld(tiltDeg(), eye), s = S.f && S.root ? seenAt(S.f.tip, eye) : null, cm = (v) => `${(v / 10).toFixed(0)} cm`, row = (a, b) => `<tr><td>${a}</td><td>${b}</td></tr>`;
  const dx = s && s[0] - S.root[0], dy = s && s[1] - S.root[1];
  $('#vals').innerHTML = row('iPadの傾き', S.tilt.deg == null ? '測れない（26°）' : `${S.tilt.deg.toFixed(1)}°`)
    + row('目', { measured: '測っている', held: '見失った（保持）', default: '既定の位置' }[S.eye.src]) + row('目までの距離', cm(Math.hypot(...eye))) + row('目の左右／手前／高さ', `${cm(w.side)}／${cm(w.back)}／${cm(w.height)}`)
    + row('仮想の指先が見える所', s ? `${Math.abs(dx).toFixed(0)} mm ${dx < 0 ? '左' : '右'}・${Math.abs(dy).toFixed(0)} mm ${dy < 0 ? '手前' : '奥'}` : '—') + row('遅れ／しなり', S.f ? `${Math.hypot(...S.tip.lag).toFixed(0)} mm／${S.f.bendDeg.toFixed(0)}°` : '—')
    + row('予測のはずれ', `${S.fg[0].lead.miss.toFixed(1)} mm`) + row('肌の色', O.skin === 'auto' ? (S.skin ? '顔から測っている' : '顔を待っています（手で選んだ色）') : '手で選んだ色') + row('接触の数／つなぎ直し', `${S.raw.length}／${S.contact.jumps}`) + row('打ち切られた接触', S.cancels) + row('指の受け取り', `タッチ ${IN.touch}・ポインタ ${IN.pointer}（${IN.by || 'まだ'}）`) + row('エラー', S.err ? `${S.err}（${S.fails}回）` : 'なし') + row('版／画面', `${VERSION}／${MINI ? 'mini（326）' : '264'}`) + row('顔の認識', S.eyes?.cost ? `${S.eyes.cost.toFixed(0)} ms（${S.eyes.mode === 'worker' ? '別スレッド' : '同じスレッド'}）` : '—') + row('速さ／1コマの計算', `${S.fps.toFixed(0)} fps／${(S.ms || 0).toFixed(1)} ms`);
}
try { scene = new Scene($('#scene')); $('#scene').addEventListener('webglcontextlost', () => { scene.lost = true; }); $('#scene').addEventListener('webglcontextrestored', () => { scene.lost = false; }); const lay = () => { scene.layout(MM); cameraPlace(); }; lay(); addEventListener('resize', lay); scene.setMaterial(O.mat); scene.warm(); requestAnimationFrame(loop); lastPhoto().then((p) => { if (p) { S.photo = p; scene.skin.setPhoto(p.texture, p.mean); scene.skin.look = ''; } }); } catch (e) { $('#sMsg').textContent = `描画できません（${e.message}）。再読み込みしてください`; }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { try { TOP.navigator.wakeLock?.request('screen').catch(() => {}); } catch {} if (S.asked && O.eye === 'track') startEyes(); } });
window.mpIpad = { S, O, get scene() { return scene; } };
