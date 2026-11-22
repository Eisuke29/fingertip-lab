// PC control page (served by sync-server at http://localhost:8080/). All instructions and buttons live here;
// the iPad only shows, the iPhone only measures.
import { connect } from './wslink.js';

const $ = (s) => document.querySelector(s);
const C = { step: 1, done: {}, ack: {}, busy: '', status: null, statusAt: 0, ipad: null, ipadAt: 0, pose: null, poseAt: 0, frameAt: 0, results: [], rtt: null, eyeOn: false };
const link = connect('local', 'monitor', {
  onData, onBinary: showFrame, onPresence: () => render(),
  onState: (t) => { C.linkState = t; render(); },
});
const toPhone = (name, extra = {}) => link.send({ type: 'cmd', name, ...extra, to: 'phone' });
const toIpad = (m) => link.send({ type: 'ipad', ...m, to: 'ipad' });

function onData(m) {
  if (m.type === 'status') { C.status = m; C.statusAt = performance.now(); }
  else if (m.type === 'ipadinfo') { const first = !C.ipad; C.ipad = m; C.ipadAt = performance.now(); if (first) enterStep(C.step); }
  else if (m.type === 'pose') { C.pose = m; C.poseAt = performance.now(); }
  else if (m.type === 'ack') { C.ack[m.what] = m; C.busy = ''; }
  else if (m.type === 'pong') C.rtt = performance.now() - m.t0;
  else if (m.type === 'result') { C.results.push(m); renderTools(); }
  else if (m.type === 'lat-edge') latEdge(m);
  render();
}
setInterval(() => { if (link.presence.phone) link.send({ type: 'ping', t0: performance.now(), to: 'phone' }); }, 1000);
setInterval(render, 400);

// ---------------- camera preview ----------------
const pv = $('#pv'), pvx = pv.getContext('2d');
let drawing = false;
async function showFrame(b) {
  if (drawing) return; drawing = true;
  try { const bm = await createImageBitmap(b); if (pv.width !== bm.width) { pv.width = bm.width; pv.height = bm.height; } pvx.drawImage(bm, 0, 0); bm.close?.(); C.frameAt = performance.now(); $('#noVideo').hidden = true; } catch {}
  drawing = false;
}

// ---------------- connection (QR until each device is connected) ----------------
let info = null;
fetch('/api/info').then((r) => r.json()).then((j) => { info = j; render(); }).catch(() => {});
const live = { ipad: () => !!C.ipad && link.presence.ipad && performance.now() - C.ipadAt < 3000, phone: () => !!C.status && link.presence.phone && performance.now() - C.statusAt < 3000 };
let qrKey = '';
function renderLinks() {
  const dot = (ok, t) => `<span><span style="color:${ok ? 'var(--ok)' : 'var(--ng)'}">●</span> ${t}</span>`;
  const fps = C.status?.fps;
  $('#links').innerHTML = dot(link.connected, 'PC') + dot(live.ipad(), 'iPad') + dot(live.phone(), `iPhone${live.phone() ? `（${fps} fps）` : ''}`) + dot(performance.now() - C.frameAt < 1500, '映像');
  const ip = info?.ips?.[0], need = [];
  if (ip && !live.ipad()) need.push(['iPad', `https://${ip}:${info.https}/sync/ipad.html`]);
  if (ip && !live.phone()) need.push(['iPhone', `https://${ip}:${info.https}/sync/phone.html`]);
  const key = need.map((n) => n[1]).join();
  if (key !== qrKey) {
    qrKey = key;
    $('#qrs').innerHTML = need.map(([name, u]) => { let img = ''; try { const q = qrcode(0, 'M'); q.addData(u); q.make(); img = `<img src="${q.createDataURL(5, 1)}">`; } catch {} return `<div><b>${name}で読む</b>${img}<div class="u">${u}</div></div>`; }).join('');
    $('#certHelp').innerHTML = need.length && ip ? `QRで開けないときは初回だけ証明書を入れる：Safariで <b>http://${ip}:${info.http}/ca</b> → 設定「プロファイルがダウンロード済み」→ インストール → 一般 → 情報 → 証明書信頼設定 でオン` : '';
  }
}

// ---------------- steps ----------------
const NAMES = ['つなぐ', 'iPadの位置', '背景', '指', '描画'];
const chk = (state, text, value = '') => ({ state, text, value }); // state: ok / ng / na / warn
function stepView() {
  const s = C.status, a = C.ack, ip = C.ipad, ci = a.cal?.ok ? a.cal.info : null;
  switch (C.step) {
    case 1: return {
      why: 'iPad・iPhoneをPCにつなぐ', todo: 'QRをiPadとiPhoneで読む → iPadは画面を1回タップ、iPhoneは［開始］',
      checks: [chk(live.ipad() ? 'ok' : 'ng', 'iPadがつながっている'), chk(live.ipad() && ip?.tapped ? 'ok' : 'ng', 'iPadをタップした（全画面・傾きセンサー）'),
        chk(live.phone() ? 'ok' : 'ng', 'iPhoneがつながっている'), chk(!live.phone() ? 'na' : s.fps >= 20 ? 'ok' : 'warn', 'iPhoneのカメラ 20 fps 以上', live.phone() ? `${s.fps} fps` : '')],
      fixes: [!live.ipad() || !live.phone() ? 'QRで開けない → 右上の「証明書」の手順を初回だけ行う' : '', live.phone() && s.fps < 20 ? 'fps が低い → iPhoneの低電力モードを切る・他のアプリを閉じる' : ''],
      btns: [next(live.ipad() && ip?.tapped && live.phone())] };
    case 2: return {
      why: 'iPhoneから見たiPadの位置と傾きを測る（指の角度の基準になる）',
      todo: '映像の黄色い枠に ○ が入るようにiPhoneを置いて固定 → 手を離して［測る］（iPadに点が順に光る・約10秒）',
      checks: [chk(ci ? 'ok' : s?.ring ? 'ok' : 'ng', '○ が映っている'),
        chk(!ci ? 'na' : ci.rms <= 1.5 ? 'ok' : 'ng', '点のずれ 1.5 画素以下', ci ? `${ci.rms.toFixed(2)} 画素` : ''),
        chk(!ci ? 'na' : ci.n >= 7 ? 'ok' : 'ng', '9点中7点以上見えた', ci ? `${ci.n}/${ci.of}` : ''),
        chk(!ci ? 'na' : ci.inside ? 'ok' : 'ng', '指を測る範囲（黄色の点線）が映像に入っている'),
        chk(!ci ? 'na' : 'warn', '映像のピンクの線がiPadの白い格子に重なる（目で確認）'),
        chk(!ci || ci.tiltCam == null || ip?.tilt == null ? 'na' : Math.abs(ci.tiltCam - ip.tilt) <= 3 ? 'ok' : 'warn', '傾きの照合（カメラから／iPadのセンサー）', ci && ci.tiltCam != null && ip?.tilt != null ? `${ci.tiltCam.toFixed(1)}° / ${ip.tilt.toFixed(1)}°` : '')],
      fixes: a.cal && !a.cal.ok ? [a.cal.msg, '点が足りない → iPhoneを ○ の方へ向ける・近づける（15〜30cm）', 'ずれが大きい → 測っている間にiPhoneやiPadが動いた。固定してもう一回'] :
        ci && !ci.inside ? ['黄色の点線が映像からはみ出している → iPhoneを少し離す、または ○ が映像の中央下に来るよう向きを直す'] :
        ci && ci.rms > 1.5 ? ['ずれが大きい → iPhone・iPadを固定してもう一回'] : [],
      btns: [btn(ci ? 'もう一回' : '測る', () => run('cal', { Wmm: ip.Wmm, Hmm: ip.Hmm, pip: ip.pip }), !ci, !ip), next(!!ci && ci.rms <= 1.5 && ci.n >= 7 && ci.inside)] };
    case 3: return {
      why: '指がないときの映像を覚える（指だけを取り出すため）', todo: '手を映像から出して［撮る］ → 3秒後に撮影',
      checks: [chk(s?.still ? 'ok' : 'ng', '映像が止まっている'), chk(!a.bg ? 'na' : a.bg.ok ? 'ok' : 'ng', '背景が撮れた')],
      fixes: a.bg && !a.bg.ok ? [a.bg.msg, '撮っている3秒間は、手・人の影・iPhoneを動かさない'] : [],
      btns: [btn(a.bg?.ok ? 'もう一回' : '撮る', countdownBg, !a.bg?.ok), next(!!a.bg?.ok)] };
    case 4: {
      const p = C.pose, fresh = p && performance.now() - C.poseAt < 600, j = a.joints?.ok ? a.joints.info : null;
      return {
        why: '指の関節の位置を合わせる（ここから角度を測る）', todo: '右手人差し指の中節の背を ○ に当て、第1・第2関節を曲げて止める → ［合わせる］（最長10秒）',
        checks: [chk(fresh ? 'ok' : 'ng', '指が見えている'), chk(!j ? 'na' : Math.abs(j.pipOffsetMm) <= 3 ? 'ok' : 'ng', '第2関節が ○ から3mm以内', j ? `${j.pipOffsetMm.toFixed(1)} mm` : ''),
          chk(!fresh ? 'na' : p.thd >= 12 ? 'ok' : 'ng', '第1関節を12°以上曲げている', fresh ? `θd ${p.thd.toFixed(0)}°` : ''),
          chk(!fresh ? 'na' : p.ok ? 'ok' : 'ng', '指の形が合っている（一致度 0.72 以上）', fresh ? `${p.sp.toFixed(2)} / ${p.sd.toFixed(2)}` : '')],
        fixes: a.joints && !a.joints.ok ? [a.joints.msg, '指が見えない → 中節の背を ○ に当て、映像の黄色の点線の中に指が入っているか見る', '形が合わない → 背景を撮り直す（③）'] : [],
        btns: [btn(j ? 'もう一回' : '合わせる', () => run('joints'), !j), next(!!j)] };
    }
    case 5: {
      const p = C.pose, fresh = p && performance.now() - C.poseAt < 600;
      return {
        why: '仮想指が指に合わせて動くか確かめる', todo: '指を曲げ伸ばしして、iPadの仮想指と映像の青・オレンジの棒を見る',
        checks: [chk(fresh && p.ok ? 'ok' : 'ng', '指を追えている', fresh ? `${p.sp.toFixed(2)} / ${p.sd.toFixed(2)}` : ''), chk(C.ipad?.eyeOn ? 'ok' : 'na', '視線追従', C.ipad?.eyeStatus || 'オフ（正面から見た絵）')],
        fixes: fresh && !p.ok ? ['見失う → 指が黄色の点線の中にあるか、背景を撮り直す（③）'] : [],
        btns: [btn(C.ipad?.eyeOn ? '視線追従を切る' : '視線追従を入れる', () => toIpad({ eye: !C.ipad?.eyeOn }), false), btn('指合わせからやり直す', () => goStep(4), false)] };
    }
  }
}
const btn = (label, fn, primary, disabled = false) => ({ label, fn, primary, disabled });
const next = (enabled) => ({ label: '次へ ▶', fn: () => { C.done[C.step] = true; goStep(C.step + 1); }, next: true, disabled: !enabled, primary: enabled });
function run(name, extra = {}) { C.ack[name] = null; C.busy = name === 'cal' ? 'iPadに点を順に光らせて測っています（約10秒）…' : name === 'joints' ? '指を合わせています（最長10秒）…' : '実行中…'; toPhone(name, extra); render(); }
function countdownBg() {
  C.ack.bg = null; let n = 3;
  const tick = () => { if (n > 0) { C.busy = `${n} 秒後に撮ります（手を出して、動かさない）`; toPhone('countdown', { n }); n--; render(); setTimeout(tick, 1000); } else { C.busy = '撮影中…'; toPhone('bg'); render(); } };
  tick();
}
function goStep(i) { C.step = i; C.busy = ''; enterStep(i); render(); }
function enterStep(i) {
  toPhone('step', { step: i });
  // what the iPad shows in each step (the iPhone switches it to dots / grid during the measurement itself)
  if (i === 1) toIpad({ mode: 'scene', finger: false });
  else if (i === 2) toIpad({ mode: C.ack.cal?.ok ? 'grid' : 'scene', finger: false });
  else if (i === 3 || i === 4) toIpad({ mode: 'scene', finger: false });
  else if (i === 5) { toIpad({ mode: 'scene', finger: true }); toPhone('go'); }
}
function render() {
  renderLinks();
  $('#stages').innerHTML = NAMES.map((n, i) => `<span class="sg ${i + 1 === C.step ? 'cur' : C.done[i + 1] ? 'done' : ''}" data-i="${i + 1}"><i>${C.done[i + 1] && i + 1 !== C.step ? '✓' : i + 1}</i>${n}</span>`).join('');
  $('#stages').querySelectorAll('.sg').forEach((e) => (e.onclick = () => { const i = +e.dataset.i; if (i <= C.step || C.done[i - 1]) goStep(i); }));
  const v = stepView();
  $('#title').textContent = `${C.step}. ${NAMES[C.step - 1]}`;
  $('#why').textContent = v.why; $('#todo').textContent = v.todo;
  $('#checks').innerHTML = v.checks.map((c) => `<li class="c-${c.state}"><b>${{ ok: '○', ng: '×', na: '−', warn: '△' }[c.state]}</b><span>${c.text}</span><span class="v">${c.value}</span></li>`).join('');
  $('#busy').textContent = C.busy;
  const fixes = (v.fixes || []).filter(Boolean);
  $('#fix').hidden = !fixes.length; $('#fix').innerHTML = `<b>直し方</b><ul>${fixes.map((f) => `<li>${f}</li>`).join('')}</ul>`;
  const box = $('#btns'); box.innerHTML = '';
  for (const b of v.btns) {
    const e = document.createElement('button'); e.className = 'btn' + (b.primary ? ' primary' : '') + (b.next ? ' next' : '');
    e.textContent = b.label; e.disabled = !!b.disabled || (!!C.busy && !b.next); e.onclick = b.fn; box.appendChild(e);
  }
  const p = C.pose, fresh = p && performance.now() - C.poseAt < 600;
  $('#p').textContent = fresh ? (p.fthp ?? p.thp).toFixed(1) + '°' : '—'; $('#d').textContent = fresh ? (p.fthd ?? p.thd).toFixed(1) + '°' : '—';
  $('#trk').textContent = fresh ? (p.ok ? `一致度 ${p.sp.toFixed(2)} / ${p.sd.toFixed(2)}・処理 ${p.proc} ms` : '指を見失っています') : '';
  renderNums();
}
const row = (k, v) => `<tr><td>${k}</td><td>${v}</td></tr>`;
function renderNums() {
  const s = C.status, ci = C.ack.cal?.info, j = C.ack.joints?.info, ip = C.ipad;
  $('#nums').innerHTML = (s ? row('カメラ', `${s.fps} fps・${s.W}×${s.H}`) + row('1フレームの処理', `${s.proc} ms`) + row('PC↔iPhone 往復', C.rtt != null ? `${C.rtt.toFixed(0)} ms` : '—') : '')
    + (ip ? row('iPadの画面', `${ip.Wmm.toFixed(0)} × ${ip.Hmm.toFixed(0)} mm`) + row('iPadの傾き（センサー）', ip.tilt != null ? `${ip.tilt.toFixed(1)}°` : '—') : '')
    + (ci ? row('点のずれ', `${ci.rms.toFixed(2)} 画素（${ci.n}/${ci.of}）`) + row('カメラまでの距離', `${(ci.dist / 10).toFixed(1)} cm`) + row('見下ろす角度', `${ci.elev.toFixed(1)}°`) + row('焦点距離（画像幅比）', ci.fW.toFixed(3)) + row('指の面の解像度', `${ci.scale.toFixed(1)} px/mm`) : '')
    + (j ? row('第2関節の ○ からのずれ', `${j.pipOffsetMm.toFixed(1)} mm`) + row('中節の長さ / 太さ', `${j.LmMm.toFixed(1)} / ${j.diaMm.toFixed(1)} mm`) : '');
}

// ---------------- verification / settings ----------------
function renderTools() {
  const last = (k) => C.results.filter((r) => r.kind === k).slice(-1)[0], j = last('jitter'), l = last('latency');
  $('#tools').innerHTML = `
    <div style="margin-top:8px"><button class="btn" id="tJit">揺れを測る（指を止めて3秒）</button> ${j ? (j.error || `θp ${j.p.toFixed(2)}° / θd ${j.d.toFixed(2)}°（目標 0.5°以下）`) : ''}</div>
    <div style="margin-top:8px"><button class="btn" id="tLat">遅れを測る（iPhoneをiPadの画面に向ける）</button> ${l ? (l.error || `往復 中央値 ${l.median.toFixed(0)} ms`) : ''}</div>
    <div style="margin-top:12px" class="note">iPadの画面の大きさ（カードを iPad に当てて枠と合わせる）</div>
    <div><button class="btn" id="tCard">枠を出す / 消す</button> <input type="range" id="tCardW" min="300" max="600" step="1" style="width:200px"></div>`;
  $('#tJit').onclick = () => toPhone('jitter');
  $('#tLat').onclick = measureLatency;
  let cardOn = false; $('#tCard').onclick = () => { cardOn = !cardOn; toIpad({ card: cardOn }); };
  const w = $('#tCardW'); w.value = C.ipad ? Math.round(85.6 / C.ipad.mmPerPx) : 445;
  w.oninput = () => toIpad({ mmPerPx: 85.6 / +w.value, card: true });
}
renderTools();
// latency (upper bound): PC asks the iPad to flash -> iPhone camera sees it -> PC receives the edge
let lat = null;
function measureLatency() {
  lat = { sent: [], samples: [] }; toPhone('lat', { on: true }); let white = false, k = 0;
  const step = () => {
    if (k++ >= 16) { toPhone('lat', { on: false }); toIpad({ flash: 'off' }); const s = lat.samples.slice(2).sort((a, b) => a - b); C.results.push(s.length >= 4 ? { kind: 'latency', median: s[s.length >> 1] } : { kind: 'latency', error: '点滅が映りませんでした' }); lat = null; renderTools(); return; }
    white = !white; lat.sent.push({ t: performance.now(), white }); toIpad({ flash: white ? 'white' : 'black' }); setTimeout(step, 700);
  };
  step();
}
function latEdge(m) { if (!lat) return; const s = lat.sent.filter((x) => x.white === m.white).slice(-1)[0]; if (s) { const d = performance.now() - s.t; if (d < 650) lat.samples.push(d); } }
window.control = { C, goStep, run, stepView, get link() { return link; } };
