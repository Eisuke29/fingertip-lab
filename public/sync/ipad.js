// iPad (landscape): the screen is the experience. Setup is 5 explicit stages advanced with buttons.
import { Display } from './display.js';
import { EyeTracker } from './eye.js';
import { host, newId } from './link.js';

const $ = (s) => document.querySelector(s);
const STORE = 'syncIpad.v2';
// iPad (A16) landscape: 1180 x 820 CSS px, 0.1924 mm/px. The PIP ring sits 76 mm right of centre so that an
// iPhone lens at the iPad's left edge is 200 mm away from it (see 仕様書 15章).
const DEF = { mmPerPx: 0.1924, mmCal: false, Lm: 25, Ld: 22, dia: 15, eyeX: 180, eyeY: 120, eyeZ: 450, camPos: 'top', hfov: 90,
  pipX: 83, pipY: 24, tilt: 35, peerId: '' };
const st = { ...DEF };
try { Object.assign(st, JSON.parse(localStorage.getItem(STORE) || '{}')); } catch {}
const save = () => { try { localStorage.setItem(STORE, JSON.stringify(st)); } catch {} };

const P = { connected: false, status: null, pose: null, poseAt: 0, rtt: null, offset: null, pings: [], results: [],
  stage: 0, done: [false, false, false, false, false], ack: {}, busy: false, tiltNow: null, adjust: false };
const display = new Display($('#display'));
const eye = new EyeTracker();
let link = null, eyeOn = false;

// ---------------- link ----------------
async function startLink() {
  if (!st.peerId) { st.peerId = newId(); save(); }
  try {
    link = await host(st.peerId, {
      onReady: showQR,
      onOpen: () => { P.connected = true; sendPreview(); render(); },
      onClose: () => { P.connected = false; P.status = null; render(); },
      onData,
      onStream: (s) => { const v = $('#pv'); v.srcObject = s; v.play().catch(() => {}); render(); },
      onError: (e) => { if (e.type === 'unavailable-id') { st.peerId = newId(); save(); location.reload(); } else { P.linkErr = e.type || e.message; render(); } },
    });
  } catch (e) { P.linkErr = e.message; render(); }
}
async function showQR() {
  const u = new URL('phone.html', location.href); u.search = `?peer=${st.peerId}`;
  try {
    if (!window.qrcode) await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
    const q = window.qrcode(0, 'M'); q.addData(u.href); q.make(); $('#qr').innerHTML = `<img alt="" src="${q.createDataURL(6, 1)}">`;
  } catch { $('#qr').textContent = u.href; }
  render();
}
function onData(m) {
  if (m.type === 'pose') { P.pose = m; P.poseAt = performance.now(); return; }
  if (m.type === 'status') { P.status = m; P.adjust = !!m.adjust; render(); return; }
  if (m.type === 'ack') { P.ack[m.what] = m; P.busy = false; render(); return; }
  if (m.type === 'pong') {
    const t2 = performance.now(); P.pings.push({ rtt: t2 - m.t0, off: m.t1 - (m.t0 + t2) / 2 }); if (P.pings.length > 12) P.pings.shift();
    const b = P.pings.reduce((a, x) => (x.rtt < a.rtt ? x : a)); P.rtt = b.rtt; P.offset = b.off; return;
  }
  if (m.type === 'lat-edge') return latEdge(m);
  if (m.type === 'result') return onResult(m);
}
setInterval(() => { if (link?.connected) link.send({ type: 'ping', t0: performance.now() }); }, 1000);
const cmd = (name, extra = {}) => link?.send({ type: 'cmd', name, ...extra });
const sendPreview = () => cmd('preview', { on: P.stage === 2 || P.stage === 3 });

// ---------------- tilt of the iPad (accelerometer) ----------------
async function startTilt() {
  try { if (typeof DeviceMotionEvent?.requestPermission === 'function' && (await DeviceMotionEvent.requestPermission()) !== 'granted') throw new Error('許可されませんでした'); }
  catch (e) { P.tiltErr = e.message; render(); return; }
  P.tiltOn = true; P.tiltErr = null;
  addEventListener('devicemotion', (e) => {
    const g = e.accelerationIncludingGravity; if (!g || g.z == null) return;
    const n = Math.hypot(g.x, g.y, g.z); if (n < 5) return;
    const t = Math.acos(Math.min(1, Math.abs(g.z) / n)) * 180 / Math.PI; // 0 = flat on the table, 90 = upright
    P.tiltNow = P.tiltNow == null ? t : P.tiltNow * 0.85 + t * 0.15;
  });
  setTimeout(() => { if (P.tiltNow == null) { P.tiltErr = 'この端末では角度を測れません'; render(); } }, 1500);
  render();
}
setInterval(() => { if (P.stage === 1) render(); }, 250);

// ---------------- stages ----------------
const NAMES = ['iPhone', '角度', 'カメラ', '指', '描画'];
function stageView() {
  const s = P.status, a = P.ack;
  switch (P.stage) {
    case 0: return {
      inst: 'iPhoneでQRを読む',
      res: P.linkErr ? ng(`通信の準備に失敗（${P.linkErr}）`) : P.connected && s ? ok(`つながりました（${s.fps} fps）`) : dim('待っています'),
      btns: [next(P.connected && !!s)] };
    case 1: {
      const t = P.tiltNow, d = t == null ? null : t - st.tilt;
      const res = P.tiltErr ? warn(P.tiltErr) : t == null ? dim(P.tiltOn ? '測っています' : '［測る］を押す')
        : Math.abs(d) <= 3 ? ok(`いま ${t.toFixed(0)}°（目標 ${st.tilt}°）`)
        : warn(`いま ${t.toFixed(0)}° → あと ${Math.abs(d).toFixed(0)}° ${d > 0 ? '寝かせる' : '起こす'}`);
      return { inst: `iPadを ${st.tilt}° に傾ける`, res, btns: [P.tiltOn ? null : btn('測る', startTilt, true), next(true)] };
    }
    case 2: {
      // lens height from where the glass line crosses the image centre: h = below * d / f (d = 200 mm, f ~ 0.75 * width)
      const hmm = s && s.glassFound ? s.below * 200 / 0.75 / (s.W / s.H) : null;
      const res = a.bg ? (a.bg.ok ? ok('撮れました') : ng(a.bg.msg)) : !s ? dim('—')
        : !s.glassFound ? ng('画面の線が見えません')
        : Math.abs(hmm) <= 3 ? ok(`レンズの高さ OK（${hmm >= 0 ? '+' : ''}${hmm.toFixed(1)} mm）`)
        : warn(`レンズを ${Math.abs(hmm).toFixed(0)} mm ${hmm > 0 ? '下げる' : '上げる'}`);
      return { inst: '手を画面から離して［撮る］', res,
        btns: [btn(a.bg?.ok ? 'もう一回' : '撮る', () => { P.ack.bg = null; P.busy = true; cmd('bg'); render(); }, !a.bg?.ok), next(!!a.bg?.ok)] };
    }
    case 3: {
      const p = P.pose, fresh = p && performance.now() - P.poseAt < 500;
      const res = a.joints ? (a.joints.ok ? (fresh && p.ok ? ok(`合いました θp ${(p.fthp ?? p.thp).toFixed(0)}° θd ${(p.fthd ?? p.thd).toFixed(0)}°`) : warn('合いましたが、いまは見失っています')) : ng(a.joints.msg)) : dim('—');
      return { inst: '指を ○ に当て、両方の関節を曲げて［合わせる］', res,
        btns: [btn(a.joints?.ok ? 'もう一回' : '合わせる', () => { P.ack.joints = null; P.busy = true; cmd('joints'); render(); }, !a.joints?.ok),
          a.joints?.ok ? btn('手で直す', () => cmd('adjust', { on: !P.adjust }), false, P.adjust) : null, next(!!a.joints?.ok)] };
    }
  }
  return null;
}
const ok = (t) => `<span class="ok">○</span> ${t}`, ng = (t) => `<span class="ng">×</span> ${t}`, warn = (t) => `<span class="warn">△</span> ${t}`, dim = (t) => t;
function btn(label, fn, primary, pressed) { return { label, fn, primary, pressed }; }
function next(enabled) { return { label: '次へ ▶', fn: goNext, next: true, disabled: !enabled }; }
function goNext() { P.done[P.stage] = true; goStage(P.stage + 1); }
function goStage(i) {
  if (P.adjust) cmd('adjust', { on: false });
  P.stage = i; P.busy = false; sendPreview();
  if (i === 4) cmd('go');
  render();
}

function render() {
  const draw = P.stage === 4;
  document.body.classList.toggle('draw', draw);
  $('#stages').innerHTML = NAMES.map((n, i) => `<button class="sg ${i === P.stage ? 'cur' : P.done[i] ? 'done' : ''}" data-i="${i}"><i>${P.done[i] && i !== P.stage ? '✓' : i + 1}</i>${n}</button>`).join('');
  $('#stages').querySelectorAll('.sg').forEach(b => b.onclick = () => { const i = +b.dataset.i; if (i <= P.stage || P.done[i - 1]) goStage(i); });
  $('#eyeBtn').hidden = !draw; $('#backBtn').hidden = !draw;
  $('#qr').hidden = P.stage !== 0 || P.connected;
  $('#pv').hidden = !(P.stage === 2 || P.stage === 3) || !$('#pv').srcObject;
  document.body.classList.toggle('adjusting', P.adjust);
  $('#pipLabel').hidden = P.stage !== 3;
  if (draw) return;
  const v = stageView();
  $('#inst').textContent = v.inst;
  $('#res').innerHTML = P.busy ? '…' : v.res;
  const box = $('#btns'); box.innerHTML = '';
  for (const b of v.btns.filter(Boolean)) {
    const e = document.createElement('button'); e.className = 'btn' + (b.primary ? ' primary' : '') + (b.next ? ' next' : '');
    if (b.next && !b.disabled) e.classList.add('primary');
    e.textContent = b.label; e.disabled = !!b.disabled || (P.busy && !b.next); if (b.pressed) e.setAttribute('aria-pressed', 'true');
    e.onclick = b.fn; box.appendChild(e);
  }
}
setInterval(() => { if (P.stage === 3 || P.stage === 2) render(); updateChip(); }, 300);
function updateChip() {
  const p = P.pose, fresh = p && performance.now() - P.poseAt < 500;
  $('#chip').innerHTML = !P.connected ? 'iPhone 未接続' : !fresh || !p.ok ? '指を見失っています' : `θp <b>${(p.fthp ?? p.thp).toFixed(0)}°</b>　θd <b>${(p.fthd ?? p.thd).toFixed(0)}°</b>`;
}
$('#backBtn').onclick = () => goStage(3);

// drag on the preview -> handles on the iPhone
const pv = $('#pv');
const norm = (e) => { const r = pv.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }; };
pv.addEventListener('pointerdown', (e) => { if (!P.adjust) return; pv.setPointerCapture(e.pointerId); link?.send({ type: 'drag', phase: 'down', ...norm(e) }); });
pv.addEventListener('pointermove', (e) => { if (P.adjust && e.buttons) link?.send({ type: 'drag', phase: 'move', ...norm(e) }); });
pv.addEventListener('pointerup', () => link?.send({ type: 'drag', phase: 'up' }));

// ---------------- verification (in the drawer) ----------------
const TEMPLATES = [{ id: 'A', thp: 45, thd: 20 }, { id: 'B', thp: 70, thd: 40 }, { id: 'C', thp: 90, thd: 60 }, { id: 'D', thp: 110, thd: 80 }];
function renderVerify() {
  const R = P.results, last = (k) => R.filter(r => r.kind === k).slice(-1)[0], j = last('jitter'), l = last('latency');
  $('#verify').innerHTML = `
    <div class="field"><span>揺れ（指を止める）</span><button class="ib" data-v="jitter">測る</button></div>
    ${j ? `<div>${j.error || `θp ${j.p.toFixed(2)}° / θd ${j.d.toFixed(2)}° <span class="${j.p <= 0.5 && j.d <= 0.5 ? 'pass">合格' : 'fail">不合格'}</span>`}</div>` : ''}
    <div class="field"><span>精度（<a href="./template.html" target="_blank" style="color:var(--accent)">型紙</a>）<select id="tpl">${TEMPLATES.map(t => `<option value="${t.id}">${t.id}: ${t.thp}°/${t.thd}°</option>`).join('')}</select></span><button class="ib" data-v="template">測る</button></div>
    ${R.filter(r => r.kind === 'template').map(r => `<div>${r.id}: ${r.error || `誤差 ${r.ep.toFixed(1)}° / ${r.ed.toFixed(1)}° <span class="${r.pass ? 'pass">合格' : 'fail">不合格'}</span>`}</div>`).join('')}
    <div class="field"><span>遅れ（iPhoneを画面に向ける）</span><button class="ib" data-v="latency">測る</button></div>
    ${l ? `<div>${l.error || `中央値 ${l.median.toFixed(0)} ms <span class="${l.median <= 100 ? 'pass">合格' : 'fail">不合格'}</span>`}</div>` : ''}
    <div id="vmsg" style="color:var(--mut)">${P.vmsg || ''}</div>`;
  $('#verify').querySelectorAll('[data-v]').forEach(b => b.onclick = () => runVerify(b.dataset.v));
}
function vmsg(t) { P.vmsg = t; const e = $('#vmsg'); if (e) e.textContent = t; }
function runVerify(k) {
  if (!P.connected) { vmsg('iPhoneがつながっていません'); return; }
  if (k === 'jitter') { vmsg('測っています（3秒）'); cmd('jitter'); }
  else if (k === 'template') { cmd('template', TEMPLATES.find(x => x.id === $('#tpl').value)); vmsg('測っています'); }
  else if (k === 'latency') measureLatency();
}
function onResult(m) {
  if (m.kind === 'template' && !m.error) { const t = TEMPLATES.find(x => x.id === m.id); m.ep = m.mp - t.thp; m.ed = m.md - t.thd; m.pass = Math.abs(m.ep) <= 2 && Math.abs(m.ed) <= 2; }
  P.results.push(m); P.vmsg = ''; renderVerify();
}
function measureLatency() {
  const fl = $('#flash'); fl.style.display = 'block'; fl.style.background = '#000';
  P.lat = { flips: [], samples: [] }; cmd('lat', { on: true });
  let white = false, n = 0, last = 0;
  return new Promise((resolve) => {
    const tick = (now) => {
      if (now - last > 700) {
        last = now; white = !white; n++; fl.style.background = white ? '#fff' : '#000';
        const w = white; requestAnimationFrame((t) => { P.lat.flips.push({ t, white: w }); if (P.status?.sim) cmd('simflash', { white: w }); });
      }
      if (n > 17) {
        fl.style.display = 'none'; cmd('lat', { on: false });
        const s = P.lat.samples.slice(2).sort((a, b) => a - b);
        const r = s.length >= 4 ? { kind: 'latency', median: s[s.length >> 1], p90: s[Math.floor(s.length * 0.9)], n: s.length } : { kind: 'latency', error: '点滅が映りませんでした' };
        onResult(r); resolve(r); return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
function latEdge(m) {
  if (!P.lat || P.offset == null) return;
  const t = m.t - P.offset, flip = P.lat.flips.filter(f => f.white === m.white && f.t <= t + 30).slice(-1)[0];
  if (flip) { const d = t - flip.t; if (d > -30 && d < 600) P.lat.samples.push(Math.max(0, d)); }
}

// ---------------- settings ----------------
function bindSettings() {
  const num = (id, key) => { const e = $(id); e.value = st[key]; e.onchange = () => { const v = parseFloat(e.value); if (isFinite(v)) { st[key] = v; save(); layout(); render(); } }; };
  num('#sTilt', 'tilt'); num('#sLm', 'Lm'); num('#sLd', 'Ld'); num('#sDia', 'dia'); num('#sEyeX', 'eyeX'); num('#sEyeY', 'eyeY'); num('#sEyeZ', 'eyeZ'); num('#sFov', 'hfov'); num('#sPipY', 'pipY');
  const cp = $('#sCamPos'); cp.value = st.camPos; cp.onchange = () => { st.camPos = cp.value; save(); layout(); };
  const cw = $('#cardW'), card = $('#card');
  const show = () => { const w = 85.6 / st.mmPerPx; cw.value = Math.round(w); card.style.width = w + 'px'; card.style.height = (w * 54 / 85.6) + 'px'; };
  cw.oninput = () => { st.mmPerPx = 85.6 / parseFloat(cw.value); st.mmCal = true; save(); show(); layout(); };
  show();
  $('#gear').onclick = () => { $('#drawer').classList.toggle('open'); renderVerify(); };
  $('#closeDrawer').onclick = () => $('#drawer').classList.remove('open');
}

// ---------------- display ----------------
function layout() {
  display.layout({ mmPerPx: st.mmPerPx, pipFrac: { x: st.pipX / 100, y: 1 - st.pipY / 100 }, Lm: st.Lm, Ld: st.Ld, dia: st.dia, fullBox: true, sideLight: true });
  const p = display.pipScreenPx(), lab = $('#pipLabel'); lab.style.left = (p.x + 13 / st.mmPerPx) + 'px'; lab.style.top = p.y + 'px';
  const W = display.Wm, H = display.Hm;
  eye.configure({ hfov: st.hfov, camPos: st.camPos === 'left' ? { x: -W / 2 - 8, y: 0, z: 0 } : st.camPos === 'right' ? { x: W / 2 + 8, y: 0, z: 0 } : { x: 0, y: H / 2 + 10, z: 0 } });
}
addEventListener('resize', layout);
const fixedEye = () => ({ x: display.pip.x - st.eyeX, y: display.pip.y - st.eyeY, z: st.eyeZ });
function loop() {
  const p = P.pose, fresh = p && performance.now() - P.poseAt < 500;
  if (p) display.setPose(p.fthp ?? p.thp, p.fthd ?? p.thd, !!(fresh && p.ok)); else display.setPose(70, 25, false);
  display.render(eyeOn && eye.eye ? eye.eye : fixedEye());
  requestAnimationFrame(loop);
}
$('#eyeBtn').onclick = async () => {
  eyeOn = !eyeOn; $('#eyeBtn').setAttribute('aria-pressed', String(eyeOn));
  if (eyeOn) { try { await eye.start('user'); } catch { eyeOn = false; $('#eyeBtn').setAttribute('aria-pressed', 'false'); } } else eye.stop();
};
// first touch: go full screen where supported
addEventListener('pointerdown', () => { const d = document.documentElement; try { (d.requestFullscreen || d.webkitRequestFullscreen)?.call(d)?.catch?.(() => {}); } catch {} }, { once: true });

bindSettings(); layout(); render(); requestAnimationFrame(loop); startLink();
try { navigator.wakeLock?.request('screen').catch(() => {}); } catch {}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') try { navigator.wakeLock?.request('screen').catch(() => {}); } catch {} });
window.ipad = { P, st, get peerId() { return st.peerId; }, display, goStage, goNext, cmd, measureLatency, runVerify };
