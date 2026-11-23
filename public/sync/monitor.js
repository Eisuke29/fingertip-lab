// PC control page (served by sync-server at http://localhost:8080/). All instructions and buttons live here;
// the iPad only shows, the iPhone only measures.
import { connect } from './wslink.js';
import { boot } from './boot.js';
const VERSION = await boot();

const $ = (s) => document.querySelector(s);
const C = { step: 1, done: {}, ack: {}, ruler: {}, rec: null, pending: null, countdown: '', errors: [], secondary: false, status: null, statusAt: 0, ipad: null, ipadAt: 0, pose: null, poseAt: 0, frameAt: 0, results: [], rtt: null, eyeOn: false };
const link = connect('monitor', VERSION, {
  onData, onBinary: showFrame, onPresence: () => render(),
  onState: (t) => { C.linkState = t; render(); },
  onOld: () => { const t = setInterval(() => { if (!C.pending) { clearInterval(t); location.reload(); } }, 500); },
});
const toPhone = (name, extra = {}) => { if (!C.secondary) link.send({ type: 'cmd', name, ...extra, to: 'phone' }); };
const toIpad = (m) => { if (!C.secondary) link.send({ type: 'ipad', ...m, to: 'ipad' }); };

function onData(m) {
  if (m.type === 'status') { C.status = m; C.statusAt = performance.now(); if (m.result?.what === 'ruler' && m.result.ok) C.ruler[m.result.info.truth] = m.result.info.read; if (m.result && C.pending && m.result.jobId === C.pending.jobId) finish(m.result); }
  else if (m.type === 'secondary') C.secondary = true;
  else if (m.type === 'primary') C.secondary = false;
  else if (m.type === 'got') { if (C.pending && m.jobId === C.pending.jobId) C.pending.gotAt = performance.now(); }
  else if (m.type === 'error') { C.errors.push({ t: new Date().toLocaleTimeString(), msg: `${m.from === 'ipad' ? 'iPad' : 'iPhone'}：${m.msg}` }); C.errors = C.errors.slice(-4); }
  else if (m.type === 'ipadinfo') { const first = !C.ipad; C.ipad = m; C.ipadAt = performance.now(); if (first) enterStep(C.step); }
  else if (m.type === 'pose') {
    C.pose = m; C.poseAt = performance.now();
    (C.hist ||= []).push([C.poseAt, m.thp, m.thd, m.ok]); while (C.hist.length && C.poseAt - C.hist[0][0] > 1000) C.hist.shift();
    const h = C.hist.filter((x) => x[3]); if (h.length >= 10) {
      const sd = (k) => { const v = h.map((x) => x[k]), mu = v.reduce((a, b) => a + b, 0) / v.length; return Math.sqrt(v.reduce((a, b) => a + (b - mu) ** 2, 0) / v.length); };
      const sp = sd(1), sdd = sd(2); if (sp < 2 && sdd < 2) C.jit = { p: sp, d: sdd }; // only while held still
    }
  }
  else if (m.type === 'ack') { if (C.pending && (m.jobId === C.pending.jobId || (!m.jobId && m.what === C.pending.name))) finish(m); else if (!C.pending) C.ack[m.what] = m; }
  else if (m.type === 'pong') C.rtt = performance.now() - m.t0;
  else if (m.type === 'caminfo') { C.cam = m; renderCam(); }
  else if (m.type === 'touch') C.touch = { ...m, at: performance.now() };
  else if (m.type === 'diffimg') C.diffimg = m.url;
  else if (m.type === 'result') { if (C.sweeping && m.kind === 'jitter') { m.kind = 'sweep'; C.sweeping = false; } C.results.push(m); renderTools(); }
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
function versionWarning() {
  const v = (x) => x ? `<b style="color:${x === VERSION ? 'var(--ok)' : 'var(--ng)'}">${x}</b>` : '—';
  let h = `<div class="note" style="margin-top:6px">版　PC ${v(VERSION)}　iPad ${v(C.ipad?.version)}　iPhone ${v(C.status?.version)}</div>`;
  if (C.secondary) h += '<div class="fix" style="margin-top:8px"><b>この操作画面は見るだけです</b>（別のタブで操作画面が開いています。そちらを使うか、そちらを閉じてください）</div>';
  if (C.status?.camState) h += `<div class="fix" style="margin-top:8px"><b>iPhoneのカメラ：${C.status.camState}</b></div>`;
  return h;
}
function renderLinks() {
  const dot = (ok, t) => `<span><span style="color:${ok ? 'var(--ok)' : 'var(--ng)'}">●</span> ${t}</span>`;
  const fps = C.status?.fps;
  $('#ver').innerHTML = versionWarning();
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
  const drift = a.verify?.ok ? a.verify.info.driftMm : null;
  const driftChk = chk(drift == null ? 'na' : drift <= 0.5 ? 'ok' : 'ng', '②から iPhone・iPad が動いていない（［ずれを確認］）', drift == null ? '' : `${drift.toFixed(2)} mm`);
  const driftFix = drift != null && drift > 0.5 ? ['iPhoneかiPadが動いています → ②からやり直す'] : [];
  const driftBtn = btn('ずれを確認', () => run('verify'), false);
  switch (C.step) {
    case 1: return {
      why: 'iPad・iPhoneをPCにつなぐ', todo: 'QRをiPadとiPhoneで読む → iPadは画面を1回タップ、iPhoneは［開始］',
      checks: [chk(live.ipad() ? 'ok' : 'ng', 'iPadがつながっている'), chk(live.ipad() && ip?.tapped ? 'ok' : 'ng', 'iPadをタップした（全画面・傾きセンサー）'),
        chk(live.phone() ? 'ok' : 'ng', 'iPhoneがつながっている'), chk(!live.phone() ? 'na' : s.fps >= 20 ? 'ok' : 'warn', 'iPhoneのカメラ 20 fps 以上', live.phone() ? `${s.fps} fps` : '')],
      fixes: [!live.ipad() || !live.phone() ? 'QRで開けない → 右上の「証明書」の手順を初回だけ行う' : '', live.phone() && s.fps < 20 ? 'fps が低い → iPhoneの低電力モードを切る・他のアプリを閉じる' : ''],
      btns: [next(live.ipad() && ip?.tapped && live.phone())] };
    case 2: {
      const pl = ci?.place, tilt = ci && ci.tiltCam != null && ip?.tilt != null ? Math.abs(ci.tiltCam - ip.tilt) : null;
      return {
      why: 'iPhoneから見たiPadの位置と傾きを測る（指の角度の基準になる）',
      todo: '1. 映像の薄い枠に、iPadの画面と ○ が入るようにiPhoneを置く\n2. 手を離して［測る］（しま模様・約20秒）\n3. 赤い指示が出たら、そのとおり動かして［もう一回測る］',
      checks: [chk(!ci ? 'na' : pl.ok.side ? 'ok' : 'ng', '真横から見ている（10°以内）', ci ? `${pl.side.toFixed(1)}°` : ''),
        chk(!ci ? 'na' : pl.ok.elev ? 'ok' : 'ng', '見下ろす角度 10〜20°', ci ? `${pl.elev.toFixed(1)}°` : ''),
        chk(!ci ? 'na' : pl.ok.dist ? 'ok' : 'ng', '○ までの距離 20〜30 cm', ci ? `${(pl.dist / 10).toFixed(1)} cm` : ''),
        chk(!ci ? 'na' : ci.n >= 200 ? 'ok' : 'ng', 'iPadの画面を読み取れた点 200 以上', ci ? `${ci.n}` : ''),
        chk(!ci ? 'na' : ci.inside ? 'ok' : 'ng', '指を測る範囲（黄色の点線）が映像に入っている'),
        chk(tilt == null ? 'na' : tilt <= 2 ? 'ok' : 'ng', '傾きの照合：カメラから／iPadのセンサー（差 2°以内）', tilt == null ? '' : `${ci.tiltCam.toFixed(1)}° / ${ip.tilt.toFixed(1)}°`),
        chk(!ci?.focal?.saved ? 'na' : ci.focal.off < 0.03 ? 'ok' : 'warn', '焦点距離が保存値と合う（差 3%以内）', ci?.focal ? `今回 ${ci.focal.now.toFixed(3)}・保存 ${ci.focal.saved ? ci.focal.saved.toFixed(3) : 'まだ'}` : ''),
        chk('na', '参考：測り直したときのばらつき（精度ではない）', ci ? `位置 ${ci.checkMm.toFixed(2)} mm・角度 ${ci.angleDeg.toFixed(2)}°` : '')],
      fixes: C.lastJob === 'cal' && a.cal && !a.cal.ok ? [a.cal.msg, 'iPadの画面の明るさを最大にする', '照明が画面に映り込まない向きにする', '測っている間はiPhone・iPadを動かさない'] :
        ci ? [...pl.hints.map((h) => h.text), !ci.inside ? '黄色の点線が映像からはみ出している → iPhoneを少し離す' : '', tilt != null && tilt > 2 ? '傾きが合わない → iPadの画面サイズの設定（検証・設定）を確かめる' : '', ci.focal?.saved && ci.focal.off >= 0.03 ? 'ピントが大きく動いた可能性 → もう一回測る' : ''] : [],
      btns: [btn(ci ? 'もう一回測る' : '測る', () => run('cal', { Wmm: ip.Wmm, Hmm: ip.Hmm, pip: ip.pip, w: ip.w, h: ip.h, mmPerPx: ip.mmPerPx }), !ci || !pl?.pass, !ip), next(!!ci && ci.n >= 200 && ci.inside && pl.pass)] };
    }
    case 3: return {
      why: '指がないときの映像を覚える（指だけを取り出すため）', todo: '1. 手を映像から出す\n2. ［撮る］（3秒後に撮影）',
      checks: [chk(s?.still ? 'ok' : 'ng', '映像が止まっている'), chk(!a.bg ? 'na' : a.bg.ok ? 'ok' : 'ng', '背景が撮れた'), driftChk],
      fixes: [...(a.bg && !a.bg.ok ? [a.bg.msg, '撮っている3秒間は、手・人の影・iPhoneを動かさない'] : []), ...driftFix],
      btns: [btn(a.bg?.ok ? 'もう一回' : '撮る', countdownBg, !a.bg?.ok), driftBtn, next(!!a.bg?.ok)] };
    case 4: {
      const p = C.pose, fresh = p && performance.now() - C.poseAt < 600, j = a.joints?.ok ? a.joints.info : null;
      return {
        why: '指の関節の位置を合わせる（ここから角度を測る）', todo: '1. 右手人差し指の中節の背を ○ に当てる\n2. 第1・第2関節を曲げて止める\n3. ［合わせる］（最長10秒）',
        checks: [chk(fresh ? 'ok' : 'ng', '指が見えている'), chk(C.touch?.on && performance.now() - C.touch.at < 2000 ? 'ok' : 'warn', 'iPadが指の接触を感じている（タッチ）', C.touch?.on && performance.now() - C.touch.at < 2000 ? `○ から ${Math.hypot(C.touch.x, C.touch.y).toFixed(0)} mm` : '感じていない'),
          chk(!j || j.skinSep == null ? 'na' : j.skinSep >= 3 ? 'ok' : 'warn', '指と背景の色の違い（この人の指の色をその場で覚える）', j?.skinSep != null ? `${j.skinSep.toFixed(1)}` : ''), chk(!j ? 'na' : Math.abs(j.pipOffsetMm) <= 3 ? 'ok' : 'ng', '第2関節が ○ から3mm以内', j ? `${j.pipOffsetMm.toFixed(1)} mm` : ''),
          chk(!fresh ? 'na' : p.thd >= 12 ? 'ok' : 'ng', '第1関節を12°以上曲げている', fresh ? `θd ${p.thd.toFixed(0)}°` : ''),
          chk(!fresh ? 'na' : p.ok ? 'ok' : 'ng', '指の形が合っている（一致度 0.72 以上）', fresh ? `${p.sp.toFixed(2)} / ${p.sd.toFixed(2)}` : '')],
        fixes: j && j.skinSep != null && j.skinSep < 3 ? ['背景と指の色が近い → 指の向こう側に、白か濃い色の紙を立てる（③からやり直す）'] : a.joints && !a.joints.ok ? [a.joints.msg, '指が見えない → 中節の背を ○ に当て、映像の黄色の点線の中に指が入っているか見る', '形が合わない → 背景を撮り直す（③）'] : [],
        btns: [btn(j ? 'もう一回' : '合わせる', () => run('joints'), !j), next(!!j)] };
    }
    case 5: {
      const p = C.pose, fresh = p && performance.now() - C.poseAt < 600;
      return {
        why: '仮想指が指に合わせて動くか確かめる', todo: '指を曲げ伸ばしして、iPadの仮想指と映像の青・オレンジの棒を見る',
        checks: [chk(fresh && p.ok ? 'ok' : 'ng', '指を追えている', fresh ? `${p.sp.toFixed(2)} / ${p.sd.toFixed(2)}` : ''),
          chk(!C.jit ? 'na' : C.jit.p <= 0.5 && C.jit.d <= 0.5 ? 'ok' : 'warn', '指を止めたときの揺れ 0.5° 以下（直近1秒）', C.jit ? `θp ±${C.jit.p.toFixed(2)}° θd ±${C.jit.d.toFixed(2)}°` : '指を止めると出ます'),
          driftChk, chk(C.ipad?.eyeOn ? 'ok' : 'na', '視線追従', C.ipad?.eyeStatus || 'オフ（正面から見た絵）')],
        fixes: [...(fresh && !p.ok ? ['見失う → 指が黄色の点線の中にあるか、背景を撮り直す（③）'] : []), ...driftFix],
        btns: [driftBtn, btn(C.ipad?.eyeOn ? '視線追従を切る' : '視線追従を入れる', () => toIpad({ eye: !C.ipad?.eyeOn }), false), btn('指合わせからやり直す', () => goStep(4), false)] };
    }
  }
}
const btn = (label, fn, primary, disabled = false) => ({ label, fn, primary, disabled });
const next = (enabled) => ({ label: '次へ ▶', fn: () => { C.done[C.step] = true; goStep(C.step + 1); }, next: true, disabled: !enabled, primary: enabled });
// A job is sent with an id. The iPhone answers "got" at once; without it the command is sent once more after 1 s.
// While it runs, the iPhone's own phase is shown. Every job has a time limit; then the buttons come back.
// the stripes wait until the screen has settled after every change: 15-25 s (Fable P0-4)
const LIMIT = { cal: 60, verify: 60, bg: 10, joints: 15, recFinger: 25, ruler: 10 };
const NAMES_JA = { cal: 'iPadの位置を測る', verify: 'ずれの確認', bg: '背景を撮る', joints: '指を合わせる', recFinger: '指を記録', ruler: '定規で確かめる' };
function run(name, extra = {}) {
  if (C.pending || C.secondary) return;
  const jobId = `${name}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  C.ack[name] = null;
  C.pending = { name, jobId, extra, sentAt: performance.now(), gotAt: null, resent: false, lastPhase: '' };
  toPhone(name, { ...extra, jobId }); render();
}
function finish(res) {
  const p = C.pending; if (!p) return;
  if (p.name === 'ruler' && res.ok) C.ruler[res.info.truth] = res.info.read;
  C.ack[p.name] = res; C.lastJob = p.name; C.pending = null;
  link.send({ type: 'resultAck', jobId: p.jobId, to: 'phone' });
  render();
}
setInterval(() => {
  const p = C.pending; if (!p) return;
  const now = performance.now(), job = C.status?.job;
  if (job && job.jobId === p.jobId) p.lastPhase = job.phase;
  if (!p.gotAt && !p.resent && now - p.sentAt > 1000) { p.resent = true; toPhone(p.name, { ...p.extra, jobId: p.jobId }); }
  // the iPhone has gone (page closed, Wi-Fi lost): say so now instead of waiting for the time limit
  if (now - p.sentAt > 3000 && now - C.statusAt > 3000) {
    C.ack[p.name] = { ok: false, msg: `iPhoneとの接続が切れました（止まった所：${p.lastPhase || '開始前'}）` }; C.lastJob = p.name; C.pending = null; render(); return;
  }
  if (now - p.sentAt > LIMIT[p.name] * 1000) {
    C.ack[p.name] = { ok: false, msg: `時間切れ（${p.gotAt ? `iPhoneは受け取った。止まった所：${p.lastPhase || '不明'}` : 'iPhoneが命令を受け取っていない'}）` };
    C.pending = null; toPhone('abort'); render();
  }
}, 250);
function busyText() {
  const p = C.pending; if (!p) return C.countdown;
  const job = C.status?.job, mine = job && job.jobId === p.jobId;
  const sec = Math.floor((performance.now() - p.sentAt) / 1000);
  return `${NAMES_JA[p.name]}：${mine ? job.phase : p.gotAt ? 'iPhoneが受け取りました' : 'iPhoneに送りました（返事を待っています）'}（${sec}／${LIMIT[p.name]} 秒）`;
}
function countdownBg() {
  if (C.pending) return;
  C.ack.bg = null; let n = 3;
  const tick = () => { if (n > 0) { C.countdown = `${n} 秒後に撮ります（手を出して、動かさない）`; toPhone('countdown', { n }); n--; render(); setTimeout(tick, 1000); } else { C.countdown = ''; run('bg'); } };
  tick();
}
function goStep(i) { if (C.pending) return; C.step = i; enterStep(i); render(); renderCam(); }
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
  $('#why').textContent = v.why; $('#todo').innerHTML = v.todo.split('\n').map((x) => `<div>${x}</div>`).join('');
  $('#extra').innerHTML = C.step === 2 && C.diffimg ? `<div class="lbl">白と黒の差（iPadの画面がくっきり白く見えれば良い）</div><img src="${C.diffimg}" style="width:100%;border-radius:8px;border:1px solid var(--line)">` : '';
  $('#checks').innerHTML = v.checks.map((c) => `<li class="c-${c.state}"><b>${{ ok: '○', ng: '×', na: '−', warn: '△' }[c.state]}</b><span>${c.text}</span><span class="v">${c.value}</span></li>`).join('');
  $('#busy').textContent = busyText();
  $('#errs').innerHTML = C.errors.map((e) => `<div>${e.t}　${e.msg}</div>`).join('');
  const fixes = (v.fixes || []).filter(Boolean);
  $('#fix').hidden = !fixes.length; $('#fix').innerHTML = `<b>直し方</b><ul>${fixes.map((f) => `<li>${f}</li>`).join('')}</ul>`;
  const box = $('#btns'); box.innerHTML = '';
  const btns = C.pending ? [{ label: '中止', fn: () => toPhone('abort'), abort: true }] : v.btns;
  for (const b of btns) {
    const e = document.createElement('button'); e.className = 'btn' + (b.primary ? ' primary' : '') + (b.next ? ' next' : '');
    e.textContent = b.label; e.disabled = C.secondary || !!b.disabled || (!!C.countdown && !b.abort); e.onclick = b.fn; box.appendChild(e);
  }
  const p = C.pose, fresh = p && performance.now() - C.poseAt < 600;
  $('#p').textContent = fresh ? (p.fthp ?? p.thp).toFixed(1) + '°' : '—'; $('#d').textContent = fresh ? (p.fthd ?? p.thd).toFixed(1) + '°' : '—';
  $('#trk').textContent = fresh ? (p.ok ? `一致度 ${p.sp.toFixed(2)} / ${p.sd.toFixed(2)}・処理 ${p.proc} ms` : '指を見失っています') : '';
  renderNums();
}
const row = (k, v) => `<tr><td>${k}</td><td>${v}</td></tr>`;
function renderNums() {
  const s = C.status, ci = C.ack.cal?.info, j = C.ack.joints?.info, ip = C.ipad;
  const lk = s?.locks, lv = (x) => x ? `<span style="color:${/^固定した/.test(x) ? 'var(--ok)' : 'var(--warn)'}">${x}</span>` : '—（②で測る前に調べます）';
  $('#nums').innerHTML = (s ? row('ピント', lv(lk?.focusMode)) + row('露出（明るさ）', lv(lk?.exposureMode)) + row('色（ホワイトバランス）', lv(lk?.whiteBalanceMode))
      + row('映像の鮮明さ', s.sharp == null ? '—' : `${s.sharp.toFixed(0)}${s.sharp < 30 ? '<span style="color:var(--warn)">（ぼけている可能性：○ から離す）</span>' : ''}`)
      + row('iPadの表示の返事', s.showMs == null ? '—' : `中央値 ${s.showMs.toFixed(0)} ms・時間切れ ${s.showTimeouts} 回`)
      + row('表示が落ち着くまで', s.settleMs == null ? '—' : `中央値 ${s.settleMs.toFixed(0)} ms`)
      + row('iPadのタッチ', C.touch && performance.now() - C.touch.at < 2000 && C.touch.on ? `触れている（○ から x ${C.touch.x.toFixed(1)}・y ${C.touch.y.toFixed(1)} mm）` : '触れていない')
      + row('指の色', s.skin ? 'この人の色を覚えて使用中' : 'まだ（④で覚える）') : '')
    + (s ? row('カメラ', `${s.fps} fps・${s.W}×${s.H}`) + row('1フレームの処理', `${s.proc} ms`) + row('PC↔iPhone 往復', C.rtt != null ? `${C.rtt.toFixed(0)} ms` : '—') : '')
    + (ip ? row('iPadの画面', `${ip.Wmm.toFixed(0)} × ${ip.Hmm.toFixed(0)} mm`) + row('iPadの傾き（センサー）', ip.tilt != null ? `${ip.tilt.toFixed(1)}°` : '—') : '')
    + (ci ? row('点のずれ', `${ci.rms.toFixed(2)} 画素（使えた点 ${ci.n}）`) + row('カメラまでの距離', `${(ci.dist / 10).toFixed(1)} cm`) + row('見下ろす角度', `${ci.elev.toFixed(1)}°`) + row('真横からのずれ', `${ci.side.toFixed(1)}°`) + row('焦点距離（画像幅比）', `${ci.fW.toFixed(3)}（今回だけで求めた値 ${ci.focal.now.toFixed(3)}・保存 ${ci.focal.saved ? ci.focal.saved.toFixed(3) : 'まだ'}）`) + row('姿勢に使った点（○ から70mm以内）', `${ci.near}`) + row('指の面の解像度', `${ci.scale.toFixed(1)} px/mm`) : '')
    + (j ? row('第2関節の ○ からのずれ', `${j.pipOffsetMm.toFixed(1)} mm`) + row('中節の長さ / 太さ', `${j.LmMm.toFixed(1)} / ${j.diaMm.toFixed(1)} mm`) : '');
}

// ---------------- camera choice / focus (shown in steps 1-2) ----------------
function renderCam() {
  const el = $('#camBox'); if (!el) return;
  const c = C.cam; if (!c || C.step > 2) { el.innerHTML = ''; return; }
  const opts = c.devices.map((d) => `<option value="${d.id}" ${d.id === c.current ? 'selected' : ''}>${d.label}</option>`).join('');
  const fd = c.focusDistance, manual = fd && c.focusModes.includes('manual');
  el.innerHTML = `<div class="lbl">iPhoneのカメラ</div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><select id="camSel" style="background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:5px 8px;color:inherit">${opts}</select><span class="note">${c.w}×${c.h}・${Math.round(c.fps || 0)} fps</span></div>
    <div class="note" style="margin-top:4px">カメラは「背面カメラ（広角）」だけを使います。ピントが合わないときは ○ から20cm以上離す。</div>
    ${manual ? `<div style="display:flex;gap:8px;align-items:center;margin-top:6px"><span class="note">ピント</span><button class="btn" id="fAuto">自動</button><input type="range" id="fDist" min="${fd.min}" max="${fd.max}" step="${fd.step || 0.01}" value="${c.focusNow ?? fd.min}" style="flex:1"></div>`
      : `<div class="note" style="margin-top:4px">${c.focusModes.length ? `ピントの方式：${c.focusModes.join(' / ')}（手動の距離指定は不可）` : 'このiPhoneのブラウザでは、ピントを手動で動かせません（自動のみ）'}</div>`}
    ${c.err ? `<div class="note" style="color:var(--ng)">${c.err}</div>` : ''}`;
  $('#camSel').onchange = (e) => toPhone('camera', { id: e.target.value });
  if (manual) { $('#fAuto').onclick = () => toPhone('focus', { mode: 'continuous' }); $('#fDist').onchange = (e) => toPhone('focus', { mode: 'manual', d: +e.target.value }); }
}

// ---------------- verification / settings ----------------
function renderTools() {
  const last = (k) => C.results.filter((r) => r.kind === k).slice(-1)[0], j = last('jitter'), l = last('latency'), sw = last('sweep');
  const rul = Object.entries(C.ruler), rulOk = rul.filter(([t, r]) => Math.abs(r - t) <= 2).length;
  $('#tools').innerHTML = `
    <div class="lbl">実機の記録（recordings フォルダに保存。直したときの確かめに使う）</div>
    <div style="margin-top:4px"><button class="btn" id="tRec">${C.rec ? '記録を止める' : '記録を始める'}</button> <button class="btn" id="tRecF" ${C.rec ? '' : 'disabled'}>指を10秒記録</button> <a class="note" href="./replay.html" target="_blank">記録を再生して確かめる</a></div>
    <div class="note">${C.rec ? `記録中：${C.rec}（②③の画像も保存されます）` : ''}</div>
    <div class="lbl">本当の角度と比べる（三角定規かカードを ○ に立て、曲がる面に沿わせる）</div>
    <div style="margin-top:4px">${[30, 45, 60, 90].map((t) => `<button class="btn tRul" data-t="${t}">${t}°</button>`).join(' ')}</div>
    <div class="note">${rul.length ? rul.map(([t, r]) => `${t}° → 読み ${r.toFixed(1)}°（差 ${(r - t).toFixed(1)}°）`).join('　') + `　${rulOk >= 2 ? '<b style="color:var(--ok)">合格（2つ以上で差 2°以内）</b>' : '2つ以上の角度で差 2°以内なら合格'}` : 'まだ'}</div>
    <div class="lbl">iPadの絵だけ動かす確認（手を ○ に置いたまま止める）</div>
    <div style="margin-top:4px"><button class="btn" id="tSweep">確かめる（4秒）</button> ${sw ? (sw.error || `θp ±${sw.p.toFixed(2)}° / θd ±${sw.d.toFixed(2)}°（0.5°以下なら絵の影響なし）`) : ''}</div>
    <div class="lbl">ほか</div>
    <div style="margin-top:8px"><button class="btn" id="tJit">揺れを測る（指を止めて3秒）</button> ${j ? (j.error || `θp ${j.p.toFixed(2)}° / θd ${j.d.toFixed(2)}°（目標 0.5°以下）`) : ''}</div>
    <div style="margin-top:8px"><button class="btn" id="tLat">遅れを測る（iPhoneをiPadの画面に向ける）</button> ${l ? (l.error || `往復 中央値 ${l.median.toFixed(0)} ms`) : ''}</div>
    <div style="margin-top:12px" class="note">iPadの画面の大きさ（カードを iPad に当てて枠と合わせる）</div>
    <div><button class="btn" id="tCard">枠を出す / 消す</button> <input type="range" id="tCardW" min="300" max="600" step="1" style="width:200px"></div>`;
  $('#tJit').onclick = () => toPhone('jitter');
  $('#tRec').onclick = () => { C.rec = C.rec ? null : new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19); toPhone('rec', { on: !!C.rec, id: C.rec }); renderTools(); };
  $('#tRecF').onclick = () => run('recFinger');
  document.querySelectorAll('.tRul').forEach((b) => (b.onclick = () => run('ruler', { truth: +b.dataset.t })));
  $('#tSweep').onclick = () => { C.sweeping = true; toIpad({ sweep: true }); toPhone('jitter'); };
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
