// iPad (landscape, PWA): the screen is the experience. Setup = 5 stages advanced with buttons (also from the PC).
//  1 iPhone  2 iPadの位置 (camera pose from dots on this screen)  3 背景  4 指  5 描画
import { Display } from './display.js';
import { EyeTracker } from './eye.js';
import { connect } from './wslink.js';

const $ = (s) => document.querySelector(s);
const STORE = 'syncIpad.v3';
const DEF = { mmPerPx: 0.1924, mmCal: false, Lm: 25, Ld: 22, dia: 15, eyeX: 180, eyeY: 120, eyeZ: 450, hfov: 90, pipX: 83, pipY: 24, addr: '' };
const st = { ...DEF };
try { Object.assign(st, JSON.parse(localStorage.getItem(STORE) || '{}')); } catch {}
const save = () => { try { localStorage.setItem(STORE, JSON.stringify(st)); } catch {} };
const params = new URLSearchParams(location.search); if (params.get('pc')) { st.addr = params.get('pc'); save(); }

const P = { status: null, pose: null, poseAt: 0, rtt: null, offset: null, pings: [], results: [],
  stage: 0, done: [false, false, false, false, false], ack: {}, busy: false, screenKind: 'scene', nPose: 0 };
const display = new Display($('#display'));
const eye = new EyeTracker();
let link = null, eyeOn = false;
const phoneOn = () => !!link?.presence.phone && performance.now() - (P.phoneAt || 0) < 4000; // only if the iPhone is actually talking
const monitorOn = () => (link?.presence.monitors || 0) > 0;

// ---------------- geometry of this screen ----------------
const Wmm = () => innerWidth * st.mmPerPx, Hmm = () => innerHeight * st.mmPerPx;
const pipMm = () => ({ x: (st.pipX / 100 - 0.5) * Wmm(), y: (st.pipY / 100 - 0.5) * Hmm() });

// ---------------- link (through the PC relay) ----------------
function startLink() {
  link?.close(); link = null; P.status = null;
  if (!st.addr) { render(); return; }
  link = connect(st.addr, 'ipad', {
    onOpen: () => { link.send({ type: 'finger', Lm: st.Lm, dia: st.dia, to: 'phone' }); render(); },
    onPresence: (p) => { if (p.phone && !P.prevPhone) link.send({ type: 'finger', Lm: st.Lm, dia: st.dia, to: 'phone' }); P.prevPhone = p.phone; if (!p.phone) P.status = null; sendUI(); render(); },
    onData: (m) => (m.from === 'monitor' ? onMonitor(m) : onPhone(m)),
    onBinary: (b) => showFrame(b),
    onState: (t) => { P.linkState = t; render(); },
  });
}
// preview frames (JPEG) from the iPhone
const pv = $('#pv'), pvx = pv.getContext('2d');
let drawing = false;
async function showFrame(b) {
  if (drawing || pv.hidden) return; drawing = true;
  try { const bm = await createImageBitmap(b); if (pv.width !== bm.width) { pv.width = bm.width; pv.height = bm.height; } pvx.drawImage(bm, 0, 0); bm.close?.(); P.frameAt = performance.now(); } catch {}
  drawing = false;
}
function onPhone(m) {
  P.phoneAt = performance.now();
  if (m.type === 'pose') { P.pose = m; P.poseAt = performance.now(); return; }
  if (m.type === 'show') return showOnScreen(m);
  if (m.type === 'pong') {
    const t2 = performance.now(); P.pings.push({ rtt: t2 - m.t0, off: m.t1 - (m.t0 + t2) / 2 }); if (P.pings.length > 12) P.pings.shift();
    const b = P.pings.reduce((a, x) => (x.rtt < a.rtt ? x : a)); P.rtt = b.rtt; P.offset = b.off; return;
  }
  if (m.type === 'status') { P.status = m; render(); }
  else if (m.type === 'ack') { P.ack[m.what] = m; P.busy = false; render(); }
  else if (m.type === 'lat-edge') latEdge(m);
  else if (m.type === 'result') onResult(m);
}
function onMonitor(m) {
  if (m.type === 'press') { const v = stageView(); const b = v?.btns.filter(Boolean)[m.i]; if (b && !b.disabled) b.fn(); }
  else if (m.type === 'goto') tryGoto(m.i);
}
setInterval(() => { if (link?.connected) link.send({ type: 'ping', t0: performance.now(), to: 'phone' }); render(); }, 1000);
const cmd = (name, extra = {}) => link?.send({ type: 'cmd', name, ...extra, to: 'phone' });

// ---------------- what this screen shows for the camera (black / dot / grid) ----------------
const cc = $('#calCanvas'), cx = cc.getContext('2d');
function showOnScreen(m) {
  P.screenKind = m.kind;
  if (m.kind === 'scene') { cc.hidden = true; document.body.classList.remove('dots'); }
  else {
    cc.hidden = false; cc.width = innerWidth; cc.height = innerHeight;
    const k = 1 / st.mmPerPx, X = (x) => (x + Wmm() / 2) * k, Y = (y) => (Hmm() / 2 - y) * k;
    cx.fillStyle = '#000'; cx.fillRect(0, 0, cc.width, cc.height);
    if (m.kind === 'dot') { cx.fillStyle = '#fff'; cx.beginPath(); cx.arc(X(m.x), Y(m.y), 7 * k, 0, 7); cx.fill(); }
    if (m.kind === 'grid') {
      cx.strokeStyle = '#e8f6ff'; cx.lineWidth = 2;
      for (let x = -100; x <= 100; x += 20) { cx.beginPath(); cx.moveTo(X(x), 0); cx.lineTo(X(x), cc.height); cx.stroke(); }
      for (let y = -60; y <= 60; y += 20) { cx.beginPath(); cx.moveTo(0, Y(y)); cx.lineTo(cc.width, Y(y)); cx.stroke(); }
      const p = pipMm(); cx.strokeStyle = '#ff4d4d'; cx.lineWidth = 4; cx.beginPath(); cx.arc(X(p.x), Y(p.y), 10 * k, 0, 7); cx.stroke();
    }
    document.body.classList.toggle('dots', m.kind !== 'grid');
  }
  requestAnimationFrame(() => requestAnimationFrame(() => link.send({ type: 'shown', kind: m.kind, to: 'phone' })));
}

// ---------------- stages ----------------
const NAMES = ['iPhone', 'iPadの位置', '背景', '指', '描画'];
const ok = (t) => `<span class="ok">○</span> ${t}`, ng = (t) => `<span class="ng">×</span> ${t}`, warn = (t) => `<span class="warn">△</span> ${t}`;
const btn = (label, fn, primary) => ({ label, fn, primary });
const next = (enabled, label = '次へ ▶') => ({ label, fn: goNext, next: true, disabled: !enabled });
const run = (what, extra) => () => { P.ack[what] = null; P.busy = true; cmd(what, extra?.()); render(); };
function stageView() {
  const s = P.status, a = P.ack;
  switch (P.stage) {
    case 0: return { inst: !link?.connected ? 'PCのアドレスを入れる' : phoneOn() && s ? 'iPhoneとつながりました' : 'iPhoneの「横カメラ」を開いて［開始］',
      res: !st.addr ? '' : !link?.connected ? ng(P.linkState || 'PCにつないでいます') : phoneOn() && s ? ok(`カメラ ${s.fps} fps`) : 'PCにはつながりました。iPhoneを待っています',
      btns: [next(phoneOn() && !!s)] };
    case 1: {
      const i = a.cal?.info;
      const res = !a.cal ? '画面に点が順に出ます。手を離して［測る］'
        : a.cal.ok ? ok(`測れました（ずれ ${i.rms.toFixed(1)} px・距離 ${(i.dist / 10).toFixed(0)} cm・見下ろし ${i.elev.toFixed(0)}°）<br>映像のピンクの線が画面の白い線と重なればOK`)
        : ng(a.cal.msg);
      return { inst: 'iPadの位置を測る', res,
        btns: [btn(a.cal?.ok ? 'もう一回' : '測る', run('cal', () => ({ Wmm: Wmm(), Hmm: Hmm(), pip: pipMm() })), !a.cal?.ok), next(!!a.cal?.ok, 'OK ▶')] };
    }
    case 2: return { inst: '手を画面から離して［撮る］',
      res: !a.bg ? '' : a.bg.ok ? ok('撮れました') : ng(a.bg.msg),
      btns: [btn(a.bg?.ok ? 'もう一回' : '撮る', run('bg'), !a.bg?.ok), next(!!a.bg?.ok)] };
    case 3: {
      const p = P.pose, fresh = p && performance.now() - P.poseAt < 500;
      const res = !a.joints ? '' : a.joints.ok ? (fresh && p.ok ? ok(`合いました　θp ${(p.fthp ?? p.thp).toFixed(0)}°　θd ${(p.fthd ?? p.thd).toFixed(0)}°`) : warn('合いましたが、いまは見失っています')) : ng(a.joints.msg);
      return { inst: '指を ○ に当て、両方の関節を曲げて［合わせる］', res,
        btns: [btn(a.joints?.ok ? 'もう一回' : '合わせる', run('joints'), !a.joints?.ok), next(!!a.joints?.ok)] };
    }
  }
  return null;
}
function goNext() { P.done[P.stage] = true; goStage(P.stage + 1); }
function tryGoto(i) { if (i <= P.stage || P.done[i - 1]) goStage(i); }
function goStage(i) {
  P.stage = i; P.busy = false;
  if (i === 1 && P.ack.cal?.ok) showOnScreen({ kind: 'grid' }); else if (i !== 1) showOnScreen({ kind: 'scene' });
  cmd('preview', { on: i < 4 });
  if (i === 4) cmd('go');
  render();
}
function render() {
  const draw = P.stage === 4;
  document.body.classList.toggle('draw', draw);
  $('#stages').innerHTML = NAMES.map((n, i) => `<button class="sg ${i === P.stage ? 'cur' : P.done[i] ? 'done' : ''}" data-i="${i}"><i>${P.done[i] && i !== P.stage ? '✓' : i + 1}</i>${n}</button>`).join('');
  $('#stages').querySelectorAll('.sg').forEach((b) => (b.onclick = () => tryGoto(+b.dataset.i)));
  $('#eyeBtn').hidden = !draw; $('#backBtn').hidden = !draw;
  $('#room').innerHTML = `PC <b>${st.addr || '—'}</b> <span style="color:${link?.connected ? 'var(--ok)' : 'var(--ng)'}">●</span>${monitorOn() ? '　確認画面 ●' : ''}`;
  $('#addrBox').hidden = P.stage !== 0 || !!link?.connected;
  pv.hidden = P.stage < 1 || P.stage > 3 || !P.frameAt;
  $('#pipLabel').hidden = P.stage !== 3;
  display.setFingerVisible(draw || !!P.ack.joints?.ok);
  if (!draw) {
    const v = stageView();
    $('#inst').textContent = v.inst;
    $('#res').innerHTML = P.busy ? '…' : v.res;
    const box = $('#btns'); box.innerHTML = '';
    for (const b of v.btns.filter(Boolean)) {
      const e = document.createElement('button'); e.className = 'btn' + (b.primary || (b.next && !b.disabled) ? ' primary' : '') + (b.next ? ' next' : '');
      e.textContent = b.label; e.disabled = !!b.disabled || (P.busy && !b.next); e.onclick = b.fn; box.appendChild(e);
    }
  }
  sendUI();
}
function sendUI() {
  if (!monitorOn()) return;
  const v = P.stage < 4 ? stageView() : null;
  link.send({ type: 'ui', to: 'monitor', addr: st.addr, stage: P.stage, names: NAMES, done: P.done, busy: P.busy, phone: phoneOn(),
    inst: v?.inst || '体験中', res: P.busy ? '…' : v?.res || '', btns: (v?.btns || []).filter(Boolean).map((b) => ({ label: b.label, disabled: !!b.disabled || (P.busy && !b.next), primary: !!(b.primary || (b.next && !b.disabled)) })),
    calInfo: P.ack.cal?.info || null, joints: P.ack.joints?.info || null, rtt: P.rtt }, 'monitor');
}
setInterval(() => { if (P.stage === 3 || P.stage === 0) render(); updateChip(); }, 400);
function updateChip() {
  const p = P.pose, fresh = p && performance.now() - P.poseAt < 500;
  $('#chip').innerHTML = !phoneOn() ? 'iPhone 未接続' : !fresh || !p.ok ? '指を見失っています' : `θp <b>${(p.fthp ?? p.thp).toFixed(0)}°</b>　θd <b>${(p.fthd ?? p.thd).toFixed(0)}°</b>`;
}
$('#backBtn').onclick = () => goStage(3);

// ---------------- verification (drawer) ----------------
function renderVerify() {
  const R = P.results, last = (k) => R.filter((r) => r.kind === k).slice(-1)[0], j = last('jitter'), l = last('latency');
  $('#verify').innerHTML = `
    <div class="field"><span>揺れ（指を止める）</span><button class="ib" data-v="jitter">測る</button></div>
    ${j ? `<div>${j.error || `θp ${j.p.toFixed(2)}° / θd ${j.d.toFixed(2)}° <span class="${j.p <= 0.5 && j.d <= 0.5 ? 'pass">合格' : 'fail">不合格'}</span>`}</div>` : ''}
    <div class="field"><span>遅れ（iPhoneを画面に向ける）</span><button class="ib" data-v="latency">測る</button></div>
    ${l ? `<div>${l.error || `中央値 ${l.median.toFixed(0)} ms <span class="${l.median <= 100 ? 'pass">合格' : 'fail">不合格'}</span>`}</div>` : ''}`;
  $('#verify').querySelectorAll('[data-v]').forEach((b) => (b.onclick = () => (b.dataset.v === 'jitter' ? cmd('jitter') : measureLatency())));
}
function onResult(m) { P.results.push(m); renderVerify(); }
function measureLatency() {
  const fl = $('#flash'); fl.style.display = 'block'; fl.style.background = '#000';
  P.lat = { flips: [], samples: [] }; cmd('lat', { on: true });
  let white = false, n = 0, last = 0;
  return new Promise((resolve) => {
    const tick = (now) => {
      if (now - last > 700) { last = now; white = !white; n++; fl.style.background = white ? '#fff' : '#000'; const w = white; requestAnimationFrame((t) => P.lat.flips.push({ t, white: w })); }
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
  const t = m.t - P.offset, flip = P.lat.flips.filter((f) => f.white === m.white && f.t <= t + 30).slice(-1)[0];
  if (flip) { const d = t - flip.t; if (d > -30 && d < 600) P.lat.samples.push(Math.max(0, d)); }
}

// ---------------- settings ----------------
function bindSettings() {
  const num = (id, key) => { const e = $(id); e.value = st[key]; e.onchange = () => { const v = parseFloat(e.value); if (isFinite(v)) { st[key] = v; save(); layout(); render(); if (key === 'Lm' || key === 'dia') link?.send({ type: 'finger', Lm: st.Lm, dia: st.dia, to: 'phone' }); } }; };
  for (const [id, k] of [['#sPipX', 'pipX'], ['#sPipY', 'pipY'], ['#sLm', 'Lm'], ['#sLd', 'Ld'], ['#sDia', 'dia'], ['#sEyeX', 'eyeX'], ['#sEyeY', 'eyeY'], ['#sEyeZ', 'eyeZ'], ['#sFov', 'hfov']]) num(id, k);
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
  const p = display.pipScreenPx(), lab = $('#pipLabel'); lab.style.left = (p.x - 13 / st.mmPerPx) + 'px'; lab.style.top = p.y + 'px'; lab.style.transform = 'translate(-100%,-50%)';
  eye.configure({ hfov: st.hfov, camPos: { x: 0, y: display.Hm / 2 + 10, z: 0 } });
}
addEventListener('resize', () => { layout(); if (P.screenKind !== 'scene') showOnScreen({ kind: P.screenKind }); });
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

$('#addrGo').onclick = () => { st.addr = $('#addrIn').value.trim(); save(); startLink(); };
$('#addrIn').value = st.addr || '';
bindSettings(); layout(); render(); requestAnimationFrame(loop); startLink();
try { navigator.wakeLock?.request('screen').catch(() => {}); } catch {}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') try { navigator.wakeLock?.request('screen').catch(() => {}); } catch {} });
window.ipad = { P, st, display, goStage, goNext, cmd, stageView, render };
