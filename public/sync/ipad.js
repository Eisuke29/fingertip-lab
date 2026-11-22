// iPad: the screen is the experience. Receives theta_p / theta_d from the iPhone and draws the virtual finger.
import { Display } from './display.js';
import { EyeTracker } from './eye.js';
import { host, newId } from './link.js';

const $ = (s) => document.querySelector(s);
const STORE = 'syncIpad.v1';
const DEF = { mmPerPx: 0.1924, mmCal: false, Lm: 25, Ld: 22, dia: 15, eyeX: 120, eyeY: 120, eyeZ: 450, camPos: 'top', hfov: 90, pipY: 24, peerId: '' };
const st = { ...DEF };
try { Object.assign(st, JSON.parse(localStorage.getItem(STORE) || '{}')); } catch {}
const save = () => { try { localStorage.setItem(STORE, JSON.stringify(st)); } catch {} };

const P = { connected: false, status: null, pose: null, poseAt: 0, rtt: null, offset: null, pings: [], results: [], everDone: false, lastStage: null };
const display = new Display($('#display'));
const eye = new EyeTracker();
let link = null, eyeOn = false;

// ---------------- link ----------------
async function startLink() {
  if (!st.peerId) { st.peerId = newId(); save(); }
  try {
    link = await host(st.peerId, {
      onReady: () => showQR(),
      onOpen: () => { P.connected = true; link.send({ type: 'cmd', name: 'preview', on: sheetOpen() }); render(); },
      onClose: () => { P.connected = false; P.status = null; $('#pvVideo').hidden = true; $('#qr').hidden = false; render(); },
      onData,
      onStream: (s) => { const v = $('#pvVideo'); v.srcObject = s; v.hidden = false; $('#qr').hidden = true; v.play().catch(() => {}); },
      onError: (e) => {
        if (e.type === 'unavailable-id') { st.peerId = newId(); save(); location.reload(); return; }
        $('#qr').innerHTML = `<p class="note">通信の準備に失敗しました（${e.type || e.message}）。インターネット接続を確認して再読み込みしてください。</p>`;
      },
    });
  } catch (e) { $('#qr').innerHTML = `<p class="note">${e.message}</p>`; }
}
function phoneURL() { const u = new URL('phone.html', location.href); u.search = `?peer=${st.peerId}`; return u.href; }
async function showQR() {
  const url = phoneURL();
  try {
    if (!window.qrcode) await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
    const q = window.qrcode(0, 'M'); q.addData(url); q.make();
    $('#qr').innerHTML = `<div style="font-weight:700">iPhoneのカメラでこのQRを読む</div><img alt="QR" src="${q.createDataURL(6, 2)}"><div class="url">${url}</div>`;
  } catch { $('#qr').innerHTML = `<div style="font-weight:700">iPhoneでこのアドレスを開く</div><div class="url">${url}</div>`; }
}
function onData(m) {
  if (m.type === 'pose') { P.pose = m; P.poseAt = performance.now(); return; }
  if (m.type === 'status') {
    const was = P.status?.stage; P.status = m;
    if (m.stage === 'done' && was && was !== 'done' && sheetOpen() && !P.verifying) finishSetup();
    render(); return;
  }
  if (m.type === 'pong') {
    const t2 = performance.now(), rtt = t2 - m.t0;
    P.pings.push({ rtt, off: m.t1 - (m.t0 + t2) / 2 }); if (P.pings.length > 12) P.pings.shift();
    const best = P.pings.reduce((a, b) => (b.rtt < a.rtt ? b : a)); P.rtt = best.rtt; P.offset = best.off; return;
  }
  if (m.type === 'lat-edge') return latEdge(m);
  if (m.type === 'result') return onResult(m);
}
setInterval(() => { if (link?.connected) link.send({ type: 'ping', t0: performance.now() }); }, 1000);

// ---------------- setup sheet ----------------
const sheetOpen = () => $('#sheet').classList.contains('open');
function openSheet(on) {
  $('#sheet').classList.toggle('open', on); document.body.classList.toggle('setup', on);
  link?.send({ type: 'cmd', name: 'preview', on });
  if (!on && P.status?.adjust) link?.send({ type: 'cmd', name: 'adjust', on: false });
  render();
}
function finishSetup() {
  P.everDone = true; const d = $('#done'); d.style.display = 'block';
  setTimeout(() => { d.style.display = 'none'; openSheet(false); }, 1400);
}
$('#setupBtn').onclick = () => openSheet(!sheetOpen());
$('#closeBtn').onclick = () => openSheet(false);
$('#bgBtn').onclick = () => link?.send({ type: 'cmd', name: 'redo' });
$('#jBtn').onclick = () => link?.send({ type: 'cmd', name: 'rejoint' });
$('#adjBtn').onclick = () => { const on = !(P.status?.adjust); link?.send({ type: 'cmd', name: 'adjust', on }); };
document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => {
  document.querySelectorAll('.tabs button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  $('#tabSteps').hidden = b.dataset.tab !== 'steps'; $('#tabVerify').hidden = b.dataset.tab !== 'verify'; $('#tabSettings').hidden = b.dataset.tab !== 'settings';
  if (b.dataset.tab === 'verify') renderVerify();
});

// drag on the preview -> handles on the iPhone (normalised coordinates of the video picture)
const pv = $('#pvVideo');
function pvNorm(e) { const r = pv.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }; }
pv.addEventListener('pointerdown', (e) => { if (!P.status?.adjust) return; pv.setPointerCapture(e.pointerId); link?.send({ type: 'drag', phase: 'down', ...pvNorm(e) }); });
pv.addEventListener('pointermove', (e) => { if (P.status?.adjust && e.buttons) link?.send({ type: 'drag', phase: 'move', ...pvNorm(e) }); });
pv.addEventListener('pointerup', () => link?.send({ type: 'drag', phase: 'up' }));

const STEPS = [
  { id: 'place', t: 'iPhoneをつなぐ・置く', d: 'QRを読み、○ の真左に横向きで立てる。画面の線と背景は自動でとります' },
  { id: 'joints', t: '指を当てる', d: '中節の背を ○ に当て、両方の関節を曲げて止める。自動で合わせます' },
  { id: 'done', t: '完了', d: '仮想指があなたの指に合わせて動きます' },
];
function render() {
  const s = P.status, stage = !P.connected ? 'connect' : s?.stage || 'place';
  const idx = stage === 'connect' ? 0 : STEPS.findIndex(x => x.id === stage);
  $('#steps').innerHTML = STEPS.map((x, i) => {
    const cls = i < idx || (stage === 'done' && i === 2) ? 'done' : i === idx ? 'cur' : 'todo';
    return `<div class="st ${cls}"><span class="num">${cls === 'done' ? '✓' : i + 1}</span><div><div class="t">${x.t}</div><div class="d">${x.d}</div></div></div>`;
  }).join('');
  const g = $('#guide');
  g.textContent = !P.connected ? 'iPhoneで左のQRを読んで、横カメラのページを開いてください' : s?.msg || (stage === 'done' ? (P.pose?.ok ? '合っています。閉じると体験画面になります' : '指を見失っています') : '');
  g.classList.toggle('warn', /下げ|上げ|見つかりません|見失|動き/.test(g.textContent));
  $('#prog').style.width = `${Math.round(100 * (stage === 'done' ? 1 : s?.progress || 0))}%`;
  $('#adjBtn').setAttribute('aria-pressed', String(!!s?.adjust)); $('#adjNote').hidden = !s?.adjust;
  for (const id of ['#adjBtn', '#bgBtn', '#jBtn']) $(id).disabled = !P.connected;
  renderChecks();
}
const MK = { ok: '○', warn: '△', ng: '×', na: '−' };
function renderChecks() {
  const s = P.status, items = [];
  items.push({ s: P.connected ? (P.rtt != null && P.rtt > 60 ? 'warn' : 'ok') : 'na', t: '接続', v: P.connected ? (P.rtt != null ? `往復 ${P.rtt.toFixed(0)} ms` : 'OK') : '未接続' });
  if (s) {
    items.push({ s: s.fps >= 25 ? 'ok' : s.fps >= 15 ? 'warn' : 'ng', t: 'カメラ', v: `${s.fps} fps` });
    items.push({ s: s.proc < 25 ? 'ok' : s.proc < 33 ? 'warn' : 'ng', t: '処理', v: `${s.proc} ms` });
    items.push({ s: s.glass ? 'ok' : s.stage === 'place' ? 'warn' : 'na', t: '画面の線', v: s.glass ? '決定' : '探しています' });
    items.push({ s: s.bg ? 'ok' : 'na', t: '背景', v: s.bg ? '撮影済み' : '未撮影' });
    if (s.res != null) items.push({ s: s.res <= 0.5 ? 'ok' : s.res <= 1 ? 'warn' : 'ng', t: '指の大きさ', v: `1画素 ≒ ${s.res.toFixed(2)}°` });
    items.push({ s: !s.cal ? 'na' : P.pose?.ok ? 'ok' : 'ng', t: '追跡', v: !s.cal ? '—' : P.pose?.ok ? 'OK' : '見失い' });
  }
  if (!st.mmCal) items.push({ s: 'warn', t: '画面の大きさ', v: '未調整（設定）' });
  $('#checks').innerHTML = items.map(i => `<span class="check ${i.s}"><span class="mk">${MK[i.s]}</span>${i.t} <b>${i.v}</b></span>`).join('');
}
setInterval(() => { renderChecks(); updateChip(); }, 250);
function updateChip() {
  const p = P.pose, fresh = p && performance.now() - P.poseAt < 500, c = $('#chip');
  c.className = 'chip ' + (!P.connected ? '' : fresh && p.ok ? 'ok' : 'ng');
  $('#chipT').innerHTML = !P.connected ? 'iPhone 未接続' : !fresh ? 'iPhone 接続中' : p.ok ? `θp <b>${(p.fthp ?? p.thp).toFixed(1)}°</b> θd <b>${(p.fthd ?? p.thd).toFixed(1)}°</b>` : '指を見失っています';
}

// ---------------- verification ----------------
const TEMPLATES = [{ id: 'A', thp: 45, thd: 20 }, { id: 'B', thp: 70, thd: 40 }, { id: 'C', thp: 90, thd: 60 }, { id: 'D', thp: 110, thd: 80 }];
function renderVerify() {
  const R = P.results, last = (k) => R.filter(r => r.kind === k).slice(-1)[0], j = last('jitter'), l = last('latency'), tp = R.filter(r => r.kind === 'template');
  $('#tabVerify').innerHTML = `
    <div class="st cur" style="display:block"><div class="t">揺れ（指を止めて3秒）</div><div class="row" style="margin:6px 0"><button class="btn primary" data-v="jitter">測る</button></div>
      ${j ? (j.error ? `<div class="note">${j.error}</div>` : `<div>θp ${j.p.toFixed(2)}° / θd ${j.d.toFixed(2)}° … <span class="${j.p <= 0.5 && j.d <= 0.5 ? 'pass' : 'fail'}">${j.p <= 0.5 && j.d <= 0.5 ? '合格' : '不合格'}</span>（目標0.5°以内）</div>`) : ''}</div>
    <div class="st" style="display:block"><div class="t">精度（<a href="./template.html" target="_blank" style="color:var(--accent)">型紙</a>を ○ に立てる）</div>
      <div class="row" style="margin:6px 0"><select id="tpl">${TEMPLATES.map(t => `<option value="${t.id}">型紙${t.id}：θp ${t.thp}° / θd ${t.thd}°</option>`).join('')}</select><button class="btn primary" data-v="template">測る</button></div>
      ${tp.length ? `<table class="res"><tr><th>型紙</th><th>θp</th><th>θd</th><th>誤差</th></tr>${tp.map(r => r.error ? `<tr><td>${r.id}</td><td colspan="3">${r.error}</td></tr>` : `<tr><td>${r.id}</td><td>${r.mp.toFixed(1)}°</td><td>${r.md.toFixed(1)}°</td><td class="${r.pass ? 'pass' : 'fail'}">${r.ep.toFixed(1)}° / ${r.ed.toFixed(1)}°</td></tr>`).join('')}</table>` : ''}</div>
    <div class="st" style="display:block"><div class="t">遅れ（iPhoneを一時的にiPadの画面へ向ける）</div>
      <div class="d">画面が白黒に点滅し、それがiPhoneのカメラに届くまでを測ります（約12秒）。終わったら iPhone を元に戻し「置き直す」。</div>
      <div class="row" style="margin:6px 0"><button class="btn primary" data-v="latency">測る</button></div>
      ${l ? (l.error ? `<div class="note">${l.error}</div>` : `<div>中央値 ${l.median.toFixed(0)} ms（90% ${l.p90.toFixed(0)} ms）… <span class="${l.median <= 100 ? 'pass' : 'fail'}">${l.median <= 100 ? '合格' : '不合格'}</span>（目標100ms以内）</div>`) : ''}</div>
    <div class="row"><button class="btn" data-v="csv" ${R.length ? '' : 'disabled'}>結果をCSVで保存</button></div>
    <div class="note" id="vmsg">${P.vmsg || ''}</div>`;
  $('#tabVerify').querySelectorAll('[data-v]').forEach(b => b.onclick = () => runVerify(b.dataset.v));
}
function vmsg(t) { P.vmsg = t; const e = $('#vmsg'); if (e) e.textContent = t; }
function runVerify(k) {
  if (!P.connected) { vmsg('iPhoneがつながっていません'); return; }
  if (k === 'jitter') { vmsg('測っています…指を止めたまま（3秒）'); link.send({ type: 'cmd', name: 'jitter' }); }
  else if (k === 'template') { const t = TEMPLATES.find(x => x.id === $('#tpl').value); P.pendingTpl = t; vmsg('測っています…'); link.send({ type: 'cmd', name: 'template', ...t }); }
  else if (k === 'latency') measureLatency();
  else if (k === 'csv') {
    const rows = [['種類', '項目', '値1', '値2'], ...P.results.map(r => r.kind === 'jitter' ? ['揺れ', 'SD θp/θd (deg)', r.p?.toFixed(3), r.d?.toFixed(3)] : r.kind === 'latency' ? ['遅れ', '中央値/90% (ms)', r.median?.toFixed(0), r.p90?.toFixed(0)] : ['精度', `型紙${r.id} 誤差 θp/θd (deg)`, r.ep?.toFixed(2), r.ed?.toFixed(2)])];
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + rows.map(r => r.join(',')).join('\n')], { type: 'text/csv' })); a.download = 'sync-ipad-results.csv'; a.click();
  }
}
function onResult(m) {
  if (m.kind === 'template' && !m.error) { const t = TEMPLATES.find(x => x.id === m.id); m.ep = m.mp - t.thp; m.ed = m.md - t.thd; m.pass = Math.abs(m.ep) <= 2 && Math.abs(m.ed) <= 2; }
  P.results.push(m); vmsg(''); if (!$('#tabVerify').hidden) renderVerify();
}
function measureLatency() {
  const fl = $('#flash'); fl.style.display = 'block'; fl.style.background = '#000';
  P.verifying = true; P.lat = { flips: [], samples: [] }; link.send({ type: 'cmd', name: 'lat', on: true });
  let white = false, n = 0, last = 0;
  return new Promise((resolve) => {
    const tick = (now) => {
      if (now - last > 700) {
        last = now; white = !white; n++; fl.style.background = white ? '#fff' : '#000';
        // the new colour is on screen from the next frame; the synthetic camera (?sim) is told at that moment
        const w = white; requestAnimationFrame((t) => { P.lat.flips.push({ t, white: w }); if (P.status?.sim) link.send({ type: 'cmd', name: 'simflash', white: w }); });
      }
      if (n > 17) {
        fl.style.display = 'none'; link.send({ type: 'cmd', name: 'lat', on: false }); P.verifying = false;
        const s = P.lat.samples.slice(2).sort((a, b) => a - b);
        const r = s.length >= 4 ? { kind: 'latency', median: s[s.length >> 1], p90: s[Math.floor(s.length * 0.9)], n: s.length } : { kind: 'latency', error: '点滅がiPhoneのカメラに映りませんでした。iPhoneをiPadの画面に向けて、もう一度' };
        onResult(r); resolve(r); return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
function latEdge(m) {
  if (!P.lat || P.offset == null) return;
  const t = m.t - P.offset; // phone clock -> iPad clock
  const flip = P.lat.flips.filter(f => f.white === m.white && f.t <= t + 30).slice(-1)[0]; // allow for clock-sync error
  if (flip) { const d = t - flip.t; if (d > -30 && d < 600) P.lat.samples.push(Math.max(0, d)); }
}

// ---------------- settings ----------------
function bindSettings() {
  const num = (id, key) => { const e = $(id); e.value = st[key]; e.onchange = () => { const v = parseFloat(e.value); if (isFinite(v)) { st[key] = v; save(); layout(); } }; };
  num('#sLm', 'Lm'); num('#sLd', 'Ld'); num('#sDia', 'dia'); num('#sEyeX', 'eyeX'); num('#sEyeY', 'eyeY'); num('#sEyeZ', 'eyeZ'); num('#sFov', 'hfov'); num('#sPipY', 'pipY');
  const cp = $('#sCamPos'); cp.value = st.camPos; cp.onchange = () => { st.camPos = cp.value; save(); layout(); };
  const cw = $('#cardW'), card = $('#card');
  const show = () => { const w = 85.6 / st.mmPerPx; cw.value = Math.round(w); card.style.width = w + 'px'; card.style.height = (w * 54 / 85.6) + 'px';
    $('#mmInfo').textContent = `画面 ${Math.round(innerWidth * st.mmPerPx)} × ${Math.round(innerHeight * st.mmPerPx)} mm${st.mmCal ? '' : '（未調整：標準的なiPadの値）'}`; };
  cw.oninput = () => { st.mmPerPx = 85.6 / parseFloat(cw.value); st.mmCal = true; save(); show(); layout(); };
  show();
}

// ---------------- display ----------------
function layout() {
  display.layout({ mmPerPx: st.mmPerPx, pipFrac: { x: 0.5, y: 1 - st.pipY / 100 }, Lm: st.Lm, Ld: st.Ld, dia: st.dia, fullBox: true });
  const p = display.pipScreenPx(), lab = $('#pipLabel'); lab.style.left = (p.x + 13 / st.mmPerPx) + 'px'; lab.style.top = p.y + 'px';
  const W = display.Wm, H = display.Hm;
  const cam = st.camPos === 'left' ? { x: -W / 2 - 8, y: 0, z: 0 } : st.camPos === 'right' ? { x: W / 2 + 8, y: 0, z: 0 } : { x: 0, y: H / 2 + 8, z: 0 };
  eye.configure({ hfov: st.hfov, camPos: cam });
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
  if (eyeOn) { try { await eye.start('user'); } catch (e) { eyeOn = false; $('#eyeBtn').setAttribute('aria-pressed', 'false'); alertChip(`前面カメラを開けません：${e.message}`); } }
  else eye.stop();
};
function alertChip(t) { $('#chipT').textContent = t; }

// ---------------- boot ----------------
bindSettings(); layout(); render(); requestAnimationFrame(loop); startLink();
try { navigator.wakeLock?.request('screen').catch(() => {}); } catch {}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') try { navigator.wakeLock?.request('screen').catch(() => {}); } catch {} });
window.ipad = { P, st, get peerId() { return st.peerId; }, display, openSheet, runVerify, measureLatency };
