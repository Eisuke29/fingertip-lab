// 同期ラボ: side camera -> theta_p / theta_d -> virtual finger on this screen.
import * as T from './tracker.js';
import { Display } from './display.js';
import { EyeTracker } from './eye.js';

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
const SIM = params.has('sim');
const STORE = 'syncLab.v1';

// ---------------- state ----------------
const DEFAULTS = { mmPerPx: 0.25, mmCalibrated: false, Lm: 25, Ld: 22, dia: 15, eyeX: 120, eyeY: 120, eyeZ: 450, hfov: 65, smooth: 1.2, pipFrac: { x: 0.5, y: 0.8 }, eyeCam: '' };
const S = {
  settings: { ...DEFAULTS }, step: 'camera', open: 'camera', mode: 'setup',
  stream: null, video: null, W: 0, H: 0, camLabel: '', locks: null,
  fps: 0, frameTimes: [], procMs: 0, stats: null, statsPrev: null, shake: null,
  glass: null, glassDone: false, placeTicks: [false, false, false], placeDone: false,
  bg: new T.Background(), bgInfo: null, bgBusy: false,
  cal: null, jointsDone: false, model: null,
  raw: null, filt: null, ok: false, prev: {}, lostRun: 0,
  fP: new T.OneEuro(1.2, 0.25), fD: new T.OneEuro(1.2, 0.25),
  log: null, collect: null, lat: null, results: [],
  eyeMode: 'fixed', msg: null,
};
try { const s = JSON.parse(localStorage.getItem(STORE) || 'null'); if (s) { Object.assign(S.settings, s.settings || {}); S.glass = s.glass || null; S.cal = s.cal || null; } } catch {}
const save = () => { try { localStorage.setItem(STORE, JSON.stringify({ settings: S.settings, glass: S.glass, cal: S.cal })); } catch {} };
const applySmooth = () => { S.fP.minCutoff = S.fD.minCutoff = S.settings.smooth; };
applySmooth();

// ---------------- elements ----------------
const cam = $('#cam'), cctx = cam.getContext('2d');
const work = document.createElement('canvas'), wctx = work.getContext('2d', { willReadFrequently: true });
const small = document.createElement('canvas'); small.width = 160; small.height = 90; const sctx = small.getContext('2d', { willReadFrequently: true });
const mini = $('#miniCam'), mctx = mini.getContext('2d');
const display = new Display($('#display'));
const eye = new EyeTracker();
let sim = null;

// ---------------- steps ----------------
const STEPS = [
  { id: 'camera', title: 'カメラをつなぐ' },
  { id: 'place', title: 'カメラを置く' },
  { id: 'glass', title: '画面の線を合わせる' },
  { id: 'bg', title: '背景を撮る' },
  { id: 'joints', title: '指を置いて関節を合わせる' },
  { id: 'track', title: '動かして確かめる' },
];
const stepDone = {
  camera: () => !!S.stream, place: () => S.placeDone, glass: () => S.glassDone,
  bg: () => S.bg.ready, joints: () => S.jointsDone, track: () => S.jointsDone && S.ok,
};
const stepIndex = (id) => STEPS.findIndex(s => s.id === id);
function unlocked(id) { const i = stepIndex(id); return STEPS.slice(0, i).every(s => stepDone[s.id]()); }
function advance() {
  const next = STEPS.find(s => !stepDone[s.id]());
  S.step = next ? next.id : 'track'; S.open = S.step; renderSide();
}

const placeSVG = `
<svg class="diagram" viewBox="0 0 360 200" role="img" aria-label="カメラの置き方">
  <defs><marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#5aa9ff"/></marker></defs>
  <text x="180" y="16" text-anchor="middle" fill="#9aa1ab" font-size="11">体験者の側から見た図（画面は奥へ寝ている）</text>
  <polygon points="95,40 265,40 285,150 75,150" fill="#262b34" stroke="#4a5260"/>
  <text x="180" y="62" text-anchor="middle" fill="#9aa1ab" font-size="11">画面</text>
  <circle cx="180" cy="128" r="9" fill="none" stroke="#ff4d4d" stroke-width="2.5"/>
  <text x="180" y="112" text-anchor="middle" fill="#ffb3b3" font-size="10">○ 指を当てる所</text>
  <rect x="14" y="112" width="22" height="34" rx="4" fill="#3a404b" stroke="#9aa1ab"/>
  <circle cx="33" cy="129" r="3" fill="#5aa9ff"/>
  <text x="25" y="164" text-anchor="middle" fill="#cfd3d9" font-size="10">iPhone</text>
  <line x1="38" y1="129" x2="160" y2="129" stroke="#5aa9ff" stroke-width="2" stroke-dasharray="5 4" marker-end="url(#ar)"/>
  <text x="98" y="122" text-anchor="middle" fill="#5aa9ff" font-size="10">20〜30cm・水平</text>
  <rect x="318" y="96" width="12" height="62" fill="#000" stroke="#6b7280"/>
  <text x="324" y="172" text-anchor="middle" fill="#cfd3d9" font-size="10">黒い板</text>
  <text x="180" y="190" text-anchor="middle" fill="#9aa1ab" font-size="10">レンズは ○ と同じ高さ・同じ奥行き。カメラは傾けない</text>
</svg>`;
const okSVG = `
<svg class="diagram" viewBox="0 0 320 180" role="img" aria-label="こう映ればOK">
  <rect width="320" height="180" fill="#0b0b0d"/>
  <line x1="20" y1="160" x2="300" y2="58" stroke="#8a919c" stroke-width="3"/>
  <polygon points="20,160 300,58 300,180 20,180" fill="#20242b" opacity=".85"/>
  <g stroke-linecap="round" fill="none">
    <line x1="150" y1="98" x2="98" y2="40" stroke="#d6a284" stroke-width="22"/>
    <line x1="150" y1="98" x2="190" y2="84" stroke="#d6a284" stroke-width="21"/>
    <line x1="190" y1="84" x2="205" y2="56" stroke="#dcab8e" stroke-width="19"/>
  </g>
  <text x="160" y="16" text-anchor="middle" fill="#9aa1ab" font-size="11">こう映ればOK：画面は1本の線、背景は黒、指が大きく映る</text>
</svg>`;

function stepBody(id) {
  const st = S.settings;
  switch (id) {
    case 'camera': return `
      <p>横から指を撮るカメラを選びます。iPhone（Iriun）なら、先に iPhone で Iriun アプリを開いてください。</p>
      <div class="row"><select id="camSel"><option value="">カメラを選ぶ…</option></select>
        <button class="btn primary" id="camStart">${S.stream ? '切り替える' : '開始'}</button></div>
      ${S.stream ? `<p class="note">使用中：${esc(S.camLabel)}（${S.W}×${S.H}）</p>` : ''}
      ${S.locks ? `<p class="note">${S.locks}</p>` : ''}
      ${SIM ? '<p class="note">合成カメラで動作中です。</p>' : ''}`;
    case 'place': return `
      ${placeSVG}
      <ul>
        <li>iPhone は ○ の<b>真左</b>（右手の親指側）に、<b>傾けずに</b>立てる</li>
        <li>レンズを ○ と同じ高さにする（本やスタンドで調整）</li>
        <li>指の向こう側（右）に黒い板を立てる</li>
      </ul>
      ${okSVG}
      <label class="tick"><input type="checkbox" data-tick="0" ${S.placeTicks[0] ? 'checked' : ''}> 映像で、画面が<b>1本の細い線</b>に見える（画面の表面は見えない）</label>
      <label class="tick"><input type="checkbox" data-tick="1" ${S.placeTicks[1] ? 'checked' : ''}> ○ のあたりが映像の中央付近にある</label>
      <label class="tick"><input type="checkbox" data-tick="2" ${S.placeTicks[2] ? 'checked' : ''}> 指の向こう側が黒い板になっている</label>
      <p class="note">左の映像の下にある自動チェック（フレームレート・明るさ・揺れ）も見てください。× のままでも進めますが、精度が落ちます。</p>
      <div class="row"><button class="btn primary" id="placeOk" ${S.placeTicks.every(Boolean) ? '' : 'disabled'}>置けた</button></div>`;
    case 'glass': return `
      <p>映像の中の<b>画面の線</b>に、白い2つの点をドラッグして合わせます。線はなるべく長くとってください。</p>
      <p class="note">手は映像の外に出しておきます。</p>
      <div class="row"><button class="btn primary" id="glassOk">この線で決定</button></div>`;
    case 'bg': return `
      <p><b>手を映像の外に出して</b>から「背景を撮る」を押します（約1秒）。</p>
      ${S.bgBusy ? '<progress id="bgProg" max="30" value="0"></progress>' : ''}
      ${S.bgInfo ? `<p class="note">${S.bgInfo}</p>` : ''}
      <div class="row"><button class="btn primary" id="bgShot" ${S.bgBusy ? 'disabled' : ''}>${S.bg.ready ? '撮り直す' : '背景を撮る'}</button></div>
      <p class="note">照明やカメラの位置を変えたら撮り直してください。</p>`;
    case 'joints': return `
      <p>右手の人差し指の<b>中節の背</b>を ○ に当て、<b>第2関節も第1関節もはっきり曲げて</b>止めます。親指は奥に握り込みます。</p>
      <div class="row"><button class="btn primary" id="autoJ">自動で合わせる</button></div>
      ${S.cal ? `<p class="note"><span class="swatch" style="background:var(--red)"></span>PIP と <span class="swatch" style="background:var(--orange)"></span>DIP の点が関節のしわの位置からずれていたら、ドラッグで直します。青とオレンジの棒が指に重なっていればOKです。</p>` : ''}
      ${S.msg ? `<p class="note" style="color:var(--warn)">${S.msg}</p>` : ''}
      <div class="row"><button class="btn primary" id="jointsOk" ${S.cal ? '' : 'disabled'}>決定</button></div>`;
    case 'track': return `
      <div class="pair">
        <div class="big"><small>θp</small><span id="liveP">—</span>°</div>
        <div class="big"><small>θd</small><span id="liveD">—</span>°</div>
      </div>
      <p>ゆっくり曲げ伸ばしして、<span class="swatch" style="background:var(--blue)"></span>青と<span class="swatch" style="background:var(--orange)"></span>オレンジの棒が指から外れないか見ます。画面の線の下には、PIPを中心に点対称に伸びる<b>仮想の指</b>（点線）が描かれます。</p>
      <p class="note" id="liveS"></p>
      <div class="row"><button class="btn primary" id="goPlay">体験画面へ</button><button class="btn" id="goVerify">検証へ</button></div>`;
  }
  return '';
}

function verifyBody() {
  const r = S.results;
  const last = (k) => r.filter(x => x.kind === k).slice(-1)[0];
  const j = last('揺れ'), l = last('遅れ');
  const acc = r.filter(x => x.kind === '精度');
  return `
  <div class="step open current"><header><span class="num">1</span><span class="ttl">揺れ（静止時のばらつき）</span></header><div class="body">
    <p>指を当てたまま止めて「測る」。3秒間の角度のばらつき（標準偏差）を出します。目標 0.5°以内。</p>
    <div class="row"><button class="btn primary" data-test="jitter">測る</button></div>
    ${j ? `<p>θp ${j.p.toFixed(2)}° / θd ${j.d.toFixed(2)}° … <span class="${j.pass ? 'pass' : 'fail'}">${j.pass ? '合格' : '不合格'}</span></p>` : ''}
  </div></div>
  <div class="step open"><header><span class="num">2</span><span class="ttl">精度（角度の分かる型紙）</span></header><div class="body">
    <p><a href="./template.html" target="_blank" style="color:var(--accent)">型紙を印刷</a>して切り、指の代わりに ○ に立てます。どの型紙かを選んで「測る」。目標 平均2°以内。</p>
    <div class="row"><select id="tplSel">${TEMPLATES.map(t => `<option value="${t.id}">型紙${t.id}：θp ${t.thp}° / θd ${t.thd}°</option>`).join('')}</select>
      <button class="btn primary" data-test="template">測る</button></div>
    ${acc.length ? `<table class="res"><tr><th>型紙</th><th>θp 測定</th><th>θd 測定</th><th>誤差</th></tr>${acc.map(a => `<tr><td>${a.id}</td><td>${a.mp.toFixed(1)}°</td><td>${a.md.toFixed(1)}°</td><td class="${a.pass ? 'pass' : 'fail'}">${a.ep.toFixed(1)}° / ${a.ed.toFixed(1)}°</td></tr>`).join('')}</table>` : ''}
  </div></div>
  <div class="step open"><header><span class="num">3</span><span class="ttl">遅れ（画面に出てからカメラで読めるまで）</span></header><div class="body">
    <p>iPhone を一時的に<b>画面へ向けて</b>「測る」。画面が白黒に点滅し、それがカメラに届くまでの時間を測ります（約10秒）。目標 100ms以内。終わったら iPhone を元の位置に戻し、「背景を撮る」からやり直します。</p>
    <div class="row"><button class="btn primary" data-test="latency">測る</button></div>
    ${l ? `<p>中央値 ${l.median.toFixed(0)} ms（90% ${l.p90.toFixed(0)} ms、${l.n}回）… <span class="${l.pass ? 'pass' : 'fail'}">${l.pass ? '合格' : '不合格'}</span></p>` : ''}
  </div></div>
  <div class="step open"><header><span class="num">4</span><span class="ttl">記録</span></header><div class="body">
    <p>計測した角度を毎フレーム記録し、CSVで保存します。</p>
    <div class="row"><button class="btn" data-test="log">${S.log ? '記録を止めて保存' : '記録を始める'}</button>
      <button class="btn" data-test="results" ${r.length ? '' : 'disabled'}>検証結果をCSVで保存</button></div>
    ${S.log ? `<p class="note">記録中… <span id="logN">0</span> フレーム</p>` : ''}
  </div></div>
  <p class="note" id="verifyMsg">${S.verifyMsg || ''}</p>`;
}

const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function renderSide() {
  const side = $('#side');
  if (S.mode === 'verify') { side.innerHTML = verifyBody(); bindVerify(); return; }
  side.innerHTML = STEPS.map((s, i) => {
    const done = stepDone[s.id](), cur = S.step === s.id, lock = !unlocked(s.id);
    const cls = ['step', done ? 'done' : '', cur ? 'current' : '', lock ? 'locked' : '', S.open === s.id && !lock ? 'open' : ''].join(' ');
    const st = done ? '済み' : cur ? 'いまここ' : lock ? '前の手順を先に' : '';
    return `<section class="${cls}" data-step="${s.id}"><header><span class="num">${done ? '✓' : i + 1}</span><span class="ttl">${s.title}</span><span class="st">${st}</span></header>
      <div class="body">${S.open === s.id && !lock ? stepBody(s.id) : ''}</div></section>`;
  }).join('');
  side.querySelectorAll('.step header').forEach(h => h.onclick = () => {
    const id = h.parentElement.dataset.step; if (!unlocked(id)) return;
    S.open = S.open === id ? null : id; renderSide();
  });
  bindSteps();
}

async function listCameras() {
  const sel = $('#camSel'); if (!sel) return;
  if (SIM) { sel.innerHTML = '<option value="sim">合成カメラ（テスト用）</option>'; return; }
  try {
    const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
    sel.innerHTML = '<option value="">カメラを選ぶ…</option>' + devs.map((d, i) => `<option value="${d.deviceId}">${esc(d.label || `カメラ ${i + 1}`)}</option>`).join('');
    const iriun = devs.find(d => /iriun/i.test(d.label));
    const cur = S.stream?.getVideoTracks()[0]?.getSettings().deviceId;
    sel.value = cur || iriun?.deviceId || '';
    fillEyeCams(devs);
  } catch (e) { sel.innerHTML = '<option>カメラ一覧を取得できません</option>'; }
}
function fillEyeCams(devs) {
  const sel = $('#sEyeCam'); const side = S.stream?.getVideoTracks()[0]?.getSettings().deviceId;
  sel.innerHTML = devs.map((d, i) => `<option value="${d.deviceId}">${esc(d.label || `カメラ ${i + 1}`)}</option>`).join('');
  const guess = devs.find(d => d.deviceId !== side && !/iriun/i.test(d.label));
  sel.value = S.settings.eyeCam && devs.some(d => d.deviceId === S.settings.eyeCam) ? S.settings.eyeCam : (guess?.deviceId || '');
}

function bindSteps() {
  const on = (id, fn) => { const e = document.getElementById(id); if (e) e.onclick = fn; };
  if (document.getElementById('camSel')) listCameras();
  on('camStart', () => startCamera($('#camSel').value));
  document.querySelectorAll('[data-tick]').forEach(cb => cb.onchange = () => { S.placeTicks[+cb.dataset.tick] = cb.checked; $('#placeOk').disabled = !S.placeTicks.every(Boolean); });
  on('placeOk', () => { S.placeDone = true; if (!S.glass) S.glass = defaultGlass(); advance(); });
  on('glassOk', () => { S.glassDone = true; S.bg.reset(); S.bgInfo = null; save(); advance(); });
  on('bgShot', () => captureBackground());
  on('autoJ', () => autoJoints());
  on('jointsOk', () => confirmJoints());
  on('goPlay', () => setMode('play'));
  on('goVerify', () => setMode('verify'));
}

// ---------------- camera ----------------
async function startCamera(deviceId) {
  stopCamera();
  try {
    let stream;
    if (SIM) {
      const { createSimCamera } = await import('./sim.js');
      sim = createSimCamera(); stream = sim.stream; S.camLabel = '合成カメラ';
    } else {
      stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: deviceId ? { exact: deviceId } : undefined, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 } }, audio: false });
    }
    const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.srcObject = stream; await v.play();
    S.stream = stream; S.video = v; S.W = v.videoWidth; S.H = v.videoHeight;
    if (!SIM) S.camLabel = stream.getVideoTracks()[0].label;
    cam.width = work.width = S.W; cam.height = work.height = S.H;
    mini.width = 480; mini.height = Math.round(480 * S.H / S.W);
    $('#camEmpty').hidden = true;
    S.locks = await lockCamera(stream.getVideoTracks()[0]);
    S.frameTimes = [];
    v.requestVideoFrameCallback(onFrame);
    // restore a previous setup: the glass line is reused, the background is always retaken
    if (S.glass) { S.placeDone = true; S.glassDone = true; }
    S.bg.reset(); S.jointsDone = false;
    advance();
  } catch (e) {
    S.locks = `カメラを開けませんでした：${esc(e.message || e)}`; renderSide();
  }
}
function stopCamera() {
  if (S.stream) S.stream.getTracks().forEach(t => t.stop());
  if (sim) { sim.stop(); sim = null; }
  S.stream = null; S.video = null;
}
async function lockCamera(track) {
  if (SIM || !track.getCapabilities) return null;
  const caps = track.getCapabilities(), done = [], cannot = [];
  await new Promise(r => setTimeout(r, 800)); // let auto exposure settle first
  for (const [k, name] of [['exposureMode', '明るさ'], ['focusMode', 'ピント'], ['whiteBalanceMode', '色合い']]) {
    if (caps[k]?.includes?.('manual')) { try { await track.applyConstraints({ advanced: [{ [k]: 'manual' }] }); done.push(name); } catch { cannot.push(name); } }
    else cannot.push(name);
  }
  return (done.length ? `固定しました：${done.join('・')}。` : '') + (cannot.length ? `このカメラでは固定できません：${cannot.join('・')}（iPhone側のアプリで固定するか、照明を一定に保ってください）` : '');
}
function defaultGlass() { return { a: { x: S.W * 0.1, y: S.H * 0.75 }, b: { x: S.W * 0.9, y: S.H * 0.75 } }; }

// ---------------- per-frame processing ----------------
let frameN = 0;
function onFrame(now, meta) {
  if (!S.video) return;
  const v = S.video;
  S.frameTimes.push(now); while (S.frameTimes.length && now - S.frameTimes[0] > 1000) S.frameTimes.shift();
  S.fps = S.frameTimes.length;
  const t0 = performance.now();
  wctx.drawImage(v, 0, 0, S.W, S.H);
  frameN++;
  if (frameN % 6 === 0 || S.lat?.active || S.bgBusy) frameStats();
  if (S.bgBusy) bgFrame();
  if (S.bg.ready && S.cal) trackFrame(now);
  S.procMs = performance.now() - t0;
  if (S.lat?.active) latencyFrame(performance.now());
  if (S.log && S.raw) S.log.push([Math.round(now), S.raw.thp, S.raw.thd, S.filt?.thp, S.filt?.thd, S.raw.scoreP, S.raw.scoreD, S.ok ? 1 : 0, S.procMs.toFixed(2)]);
  if (S.collect && S.raw) { S.collect.rows.push({ ...S.raw, ok: S.ok }); }
  if (S.mode !== 'play') drawCam(cctx, cam.width / cam.getBoundingClientRect().width || 1);
  else if (frameN % 2 === 0) { drawCam(cctx, 2); mctx.drawImage(cam, 0, 0, mini.width, mini.height); }
  v.requestVideoFrameCallback(onFrame);
}

function frameStats() {
  sctx.drawImage(S.video, 0, 0, 160, 90);
  const d = sctx.getImageData(0, 0, 160, 90).data, L = new Float32Array(160 * 90);
  let sum = 0, hi = 0, lo = 0;
  for (let i = 0, k = 0; i < d.length; i += 4, k++) { const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; L[k] = l; sum += l; if (l > 250) hi++; if (l < 6) lo++; }
  const n = L.length, prev = S.statsPrev; let diff = null;
  if (prev) { diff = 0; for (let k = 0; k < n; k++) diff += Math.abs(L[k] - prev[k]); diff /= n; }
  S.statsPrev = L; S.stats = { mean: sum / n, hi: hi / n, lo: lo / n, diff };
  // center luma for the latency test
  let c = 0, cn = 0; for (let y = 30; y < 60; y++) for (let x = 50; x < 110; x++) { c += L[y * 160 + x]; cn++; }
  S.stats.center = c / cn;
}

function trackFrame(now) {
  if (!S.model) S.model = T.buildModel(S.cal);
  const m = S.model, roi = T.roiFor(m, S.W, S.H);
  const f = T.foreground(wctx.getImageData(roi.x0, roi.y0, roi.w, roi.h), roi, S.bg);
  const r = T.track(f, m, S.prev);
  const okP = r.scoreP > T.SCORE_OK, okD = r.scoreD > T.SCORE_OK;
  S.prev = { thp: r.thp, thd: r.thd, okP, okD };
  S.raw = r;
  S.ok = okP && okD;
  if (S.ok) { S.filt = { thp: S.fP.filter(r.thp, now), thd: S.fD.filter(r.thd, now) }; S.lostRun = 0; }
  else { S.lostRun++; if (S.lostRun > 15) { S.fP.reset(); S.fD.reset(); } }
  S.lastField = f;
}

// ---------------- drawing the camera view ----------------
const HANDLE_R = 11;
function handles() {
  const h = [];
  if (S.mode === 'setup' && S.open === 'glass' && S.glass) h.push({ k: 'ga', p: S.glass.a, col: '#ffffff' }, { k: 'gb', p: S.glass.b, col: '#ffffff' });
  if (S.mode === 'setup' && S.open === 'joints' && S.cal) h.push({ k: 'pip', p: S.cal.pipC, col: '#ff4d4d' }, { k: 'dip', p: S.cal.dipC, col: '#f0953a' });
  return h;
}
function drawCam(c, k) {
  if (!S.video) return;
  c.drawImage(work, 0, 0);
  const lw = (x) => x * k;
  c.lineCap = 'round';
  if (S.glass) {
    const { a, b } = S.glass, g = T.vec.unit(T.vec.sub(b, a));
    c.strokeStyle = 'rgba(255,255,255,.85)'; c.lineWidth = lw(2); c.setLineDash([lw(8), lw(6)]);
    c.beginPath(); c.moveTo(a.x - g.x * 3000, a.y - g.y * 3000); c.lineTo(a.x + g.x * 3000, a.y + g.y * 3000); c.stroke(); c.setLineDash([]);
  }
  const m = S.cal ? (S.model || (S.model = T.buildModel(S.cal))) : null;
  if (m && S.raw && S.bg.ready) {
    const thp = S.raw.thp, thd = S.raw.thd, alpha = S.ok ? 1 : 0.4;
    const bar = (p, dir, L, r, col) => {
      c.globalAlpha = 0.28 * alpha; c.strokeStyle = col; c.lineWidth = 2 * r; c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x + dir.x * L, p.y + dir.y * L); c.stroke();
      c.globalAlpha = alpha; c.lineWidth = lw(3); c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x + dir.x * L, p.y + dir.y * L); c.stroke(); c.globalAlpha = 1;
    };
    bar(m.pip, { x: m.g.x, y: m.g.y }, m.Lm, m.r, '#c9ced6');
    bar(m.pip, T.segDir(m, 'prox', thp), m.Lp, m.rp, '#4a86e8');
    bar(m.dip, T.segDir(m, 'dist', thd), m.Ld, m.rd, '#f0953a');
    // virtual finger below the glass (point-symmetric through the PIP)
    const V = T.virtualInImage(m, S.filt?.thp ?? thp, S.filt?.thd ?? thd);
    c.globalAlpha = alpha; c.setLineDash([lw(10), lw(7)]); c.lineWidth = lw(4);
    c.strokeStyle = '#4a86e8'; c.beginPath(); c.moveTo(V.pip.x, V.pip.y); c.lineTo(V.vdip.x, V.vdip.y); c.stroke();
    c.strokeStyle = '#f0953a'; c.beginPath(); c.moveTo(V.vdip.x, V.vdip.y); c.lineTo(V.vtip.x, V.vtip.y); c.stroke();
    c.setLineDash([]); c.globalAlpha = 1;
    c.fillStyle = '#ff4d4d'; c.beginPath(); c.arc(m.pip.x, m.pip.y, lw(5), 0, 7); c.fill();
    c.fillStyle = '#f0953a'; c.beginPath(); c.arc(m.dip.x, m.dip.y, lw(4), 0, 7); c.fill();
  }
  // draggable handles
  const pulse = 1 + 0.25 * Math.sin(performance.now() / 260);
  for (const h of handles()) {
    c.strokeStyle = h.col; c.lineWidth = lw(2.5);
    c.beginPath(); c.arc(h.p.x, h.p.y, lw(HANDLE_R) * pulse, 0, 7); c.stroke();
    c.fillStyle = h.col; c.beginPath(); c.arc(h.p.x, h.p.y, lw(4), 0, 7); c.fill();
  }
  updateHint();
}

function updateHint() {
  const el = $('#camHint'); let t = '', warn = false;
  if (S.mode === 'setup') {
    if (S.open === 'place') t = 'iPhone を ○ の真左に、傾けずに置く。画面が1本の線に見える高さへ';
    else if (S.open === 'glass') t = '白い点をドラッグして、画面の線に合わせる';
    else if (S.open === 'bg') { t = S.bgBusy ? '背景を撮っています…動かないで' : '手を映像の外に出して「背景を撮る」'; if (S.bgWarn) { t = S.bgWarn; warn = true; } }
    else if (S.open === 'joints') t = S.cal ? '赤＝PIP、オレンジ＝DIP。ずれていたらドラッグで直す' : '指を ○ に当て、両方の関節を曲げて「自動で合わせる」';
    else if (S.open === 'track' && S.cal) { t = S.ok ? '青とオレンジの棒が指から外れないか確かめる' : '指を見失っています（関節を曲げて ○ に当てる）'; warn = !S.ok; }
  }
  el.hidden = !t; el.textContent = t; el.classList.toggle('warn', warn);
}

// ---------------- dragging ----------------
let drag = null;
const toVideo = (e) => { const r = cam.getBoundingClientRect(); return { x: (e.clientX - r.left) * S.W / r.width, y: (e.clientY - r.top) * S.H / r.height }; };
cam.addEventListener('pointerdown', (e) => {
  const p = toVideo(e), k = S.W / cam.getBoundingClientRect().width;
  const h = handles().find(h => Math.hypot(h.p.x - p.x, h.p.y - p.y) < 28 * k);
  if (h) { drag = h.k; cam.setPointerCapture(e.pointerId); cam.classList.add('grabbing'); }
});
cam.addEventListener('pointermove', (e) => {
  const p = toVideo(e);
  if (!drag) { const k = S.W / cam.getBoundingClientRect().width; cam.classList.toggle('grab', handles().some(h => Math.hypot(h.p.x - p.x, h.p.y - p.y) < 28 * k)); return; }
  p.x = Math.max(0, Math.min(S.W, p.x)); p.y = Math.max(0, Math.min(S.H, p.y));
  if (drag === 'ga') S.glass.a = p; else if (drag === 'gb') S.glass.b = p;
  else if (drag === 'pip' || drag === 'dip') {
    const q = T.projectOnLine(p, S.cal.glass);
    if (drag === 'pip') S.cal.pipC = q; else S.cal.dipC = q;
    S.cal.T = T.measureThickness(fullField(), S.cal.glass, S.cal.pipC, S.cal.dipC, S.cal.side) || S.cal.T;
    S.model = null; S.prev = {};
  }
});
const endDrag = () => { if (drag) { drag = null; cam.classList.remove('grabbing'); save(); } };
cam.addEventListener('pointerup', endDrag); cam.addEventListener('pointercancel', endDrag);

// ---------------- setup actions ----------------
function fullField() { return T.foreground(wctx.getImageData(0, 0, S.W, S.H), { x0: 0, y0: 0, w: S.W, h: S.H }, S.bg); }

function captureBackground() {
  if (!S.video) return Promise.resolve(false);
  S.bgBusy = true; S.bgWarn = null; S.bgInfo = null; S.bg.reset(); S.bgFrames = -6; S.bgRef = null; S.model = null;
  if (sim) sim.state.handIn = false;
  renderSide();
  return new Promise((res) => { S.bgDone = res; });
}
function bgFrame() {
  // reject if something moves during the capture (hand still in view)
  if (S.bgFrames < 0) { S.bgFrames++; return; } // let the view settle
  if (S.bgFrames === 0 && !S.bgRef) S.bgRef = S.statsPrev && S.statsPrev.slice();
  else if (S.bgRef && S.statsPrev) {
    let d = 0; for (let k = 0; k < S.bgRef.length; k++) d += Math.abs(S.statsPrev[k] - S.bgRef[k]); d /= S.bgRef.length;
    if (d > 6) { S.bgBusy = false; S.bgWarn = '動きがあります。手を映像の外に出してから、もう一度押してください'; S.bg.reset(); renderSide(); S.bgDone?.(false); return; }
  }
  S.bg.add(wctx.getImageData(0, 0, S.W, S.H)); S.bgFrames++;
  const pr = document.getElementById('bgProg'); if (pr) pr.value = S.bgFrames;
  if (S.bgFrames >= 30) {
    S.bg.finish(); S.bgBusy = false;
    S.bgInfo = backgroundQuality();
    if (sim) sim.state.handIn = true;
    S.prev = {}; S.model = null;
    S.bgDone?.(true); advance();
  }
}
function backgroundQuality() {
  if (!S.glass) return '';
  const { a, b } = S.glass, g = T.vec.unit(T.vec.sub(b, a)), n = { x: -g.y, y: g.x };
  let s = 0, s2 = 0, c = 0;
  const L = T.vec.len(T.vec.sub(b, a));
  for (let t = 0; t <= L; t += 6) for (let h = 10; h < 260; h += 6) for (const sg of [1, -1]) {
    const x = Math.round(a.x + g.x * t + n.x * h * sg), y = Math.round(a.y + g.y * t + n.y * h * sg);
    if (x < 0 || y < 0 || x >= S.W || y >= S.H) continue;
    const v = S.bg.luma[y * S.W + x]; s += v; s2 += v * v; c++;
  }
  if (!c) return '';
  const sd = Math.sqrt(Math.max(0, s2 / c - (s / c) ** 2));
  S.bgSd = sd;
  return sd < 22 ? `背景は無地です（ばらつき ${sd.toFixed(0)}）。` : `背景に模様や物があるようです（ばらつき ${sd.toFixed(0)}）。黒い板で指の向こう側を覆うと安定します。`;
}

function autoJoints() {
  S.msg = null;
  if (sim) sim.state.manual = { thp: 70, thd: 45 };
  const run = () => {
    const f = fullField();
    const prop = T.proposeJoints(f, S.glass);
    if (!prop) { S.msg = '指が見つかりません。指を ○ に当て、背景が撮れているか確かめてください。'; renderSide(); return false; }
    const ref = T.refineJoints(f, { glass: S.glass, pipC: prop.pipC, dipC: prop.dipC, T: prop.T, side: prop.side });
    ref.T = T.measureThickness(f, ref.glass, ref.pipC, ref.dipC, ref.side) || prop.T;
    S.cal = ref; S.model = null; S.prev = {}; S.fP.reset(); S.fD.reset();
    if (sim) sim.state.manual = null;
    save(); renderSide(); return true;
  };
  if (sim) return new Promise(r => setTimeout(() => r(run()), 250));
  return Promise.resolve(run());
}
function confirmJoints() { if (!S.cal) return; S.jointsDone = true; save(); advance(); }

// ---------------- verification ----------------
const TEMPLATES = [{ id: 'A', thp: 45, thd: 20 }, { id: 'B', thp: 70, thd: 40 }, { id: 'C', thp: 90, thd: 60 }, { id: 'D', thp: 110, thd: 80 }];
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const sd = (a) => { const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length); };
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
function vmsg(t) { S.verifyMsg = t; const e = $('#verifyMsg'); if (e) e.textContent = t; }

async function collect(ms) { S.collect = { rows: [] }; await wait(ms); const rows = S.collect.rows; S.collect = null; return rows; }

async function measureJitter() {
  if (!S.cal || !S.bg.ready) { vmsg('先に準備（背景と関節合わせ）を済ませてください。'); return null; }
  if (sim) sim.state.manual = { thp: 80, thd: 30 };
  vmsg('測っています…指を止めたまま（3秒）'); await wait(300);
  const rows = (await collect(3000)).filter(r => r.ok);
  if (sim) sim.state.manual = null;
  if (rows.length < 10) { vmsg('指を見失っていて測れませんでした。'); return null; }
  const res = { kind: '揺れ', p: sd(rows.map(r => r.thp)), d: sd(rows.map(r => r.thd)), n: rows.length };
  res.pass = res.p <= 0.5 && res.d <= 0.5;
  S.results.push(res); vmsg(''); renderSide(); return res;
}

async function measureTemplate(id) {
  const tpl = TEMPLATES.find(t => t.id === id);
  if (!S.bg.ready || !S.glass) { vmsg('先に背景を撮ってください。'); return null; }
  if (sim) { sim.state.manual = { thp: tpl.thp, thd: tpl.thd }; await wait(250); }
  const keep = { cal: S.cal, model: S.model };
  const f = fullField(), prop = T.proposeJoints(f, S.glass);
  if (!prop) { vmsg('型紙が見つかりません。○ に立てて、もう一度。'); if (sim) sim.state.manual = null; return null; }
  const ref = T.refineJoints(f, { glass: S.glass, pipC: prop.pipC, dipC: prop.dipC, T: prop.T, side: prop.side });
  ref.T = T.measureThickness(f, ref.glass, ref.pipC, ref.dipC, ref.side) || prop.T;
  S.cal = ref; S.model = null; S.prev = {};
  vmsg('測っています…（1.5秒）');
  await wait(200);
  const rows = (await collect(1500)).filter(r => r.ok);
  S.cal = keep.cal; S.model = keep.model; S.prev = {};
  if (sim) sim.state.manual = null;
  if (rows.length < 5) { vmsg('型紙の輪郭がとれませんでした。'); return null; }
  const mp = mean(rows.map(r => r.thp)), md = mean(rows.map(r => r.thd));
  const res = { kind: '精度', id, tp: tpl.thp, td: tpl.thd, mp, md, ep: mp - tpl.thp, ed: md - tpl.thd };
  res.pass = Math.abs(res.ep) <= 2 && Math.abs(res.ed) <= 2;
  S.results.push(res); vmsg(''); renderSide(); return res;
}

function measureLatency() {
  if (!S.video) { vmsg('先にカメラを開始してください。'); return Promise.resolve(null); }
  const fl = $('#flash'); fl.style.display = 'block'; fl.style.background = '#000';
  S.lat = { active: true, white: false, flipT: 0, detected: true, samples: [], lo: 255, hi: 0, flips: 0 };
  return new Promise((resolve) => {
    let last = 0;
    const tick = (now) => {
      const L = S.lat;
      if (now - last > 700) {
        last = now; L.white = !L.white; L.detected = false; L.flips++;
        fl.style.background = L.white ? '#fff' : '#000';
        if (sim) sim.state.flash = L.white;
        requestAnimationFrame((t) => { L.flipT = t; }); // the frame in which the new colour is presented
      }
      if (L.flips > 16) {
        fl.style.display = 'none'; L.active = false; if (sim) sim.state.flash = null;
        const s = L.samples.slice(2).sort((a, b) => a - b);
        let res = null;
        if (s.length >= 4) { res = { kind: '遅れ', median: s[s.length >> 1], p90: s[Math.floor(s.length * 0.9)], n: s.length }; res.pass = res.median <= 100; S.results.push(res); vmsg(''); }
        else vmsg('点滅がカメラに映りませんでした。iPhone を画面に向けて、もう一度。');
        S.lat = null; renderSide(); resolve(res); return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
function latencyFrame(now) {
  const L = S.lat, c = S.stats?.center; if (c == null) return;
  L.lo = Math.min(L.lo * 0.995 + c * 0.005, c); L.hi = Math.max(L.hi * 0.995 + c * 0.005, c);
  if (L.hi - L.lo < 25 || L.detected || !L.flipT) return;
  const mid = (L.lo + L.hi) / 2;
  if ((L.white && c > mid) || (!L.white && c < mid)) { const dt = now - L.flipT; if (dt < 600) L.samples.push(dt); L.detected = true; }
}

function downloadCSV(name, rows) {
  const blob = new Blob(['﻿' + rows.map(r => r.join(',')).join('\n')], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const stamp = () => new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');

function bindVerify() {
  document.querySelectorAll('[data-test]').forEach(b => b.onclick = async () => {
    const k = b.dataset.test;
    if (k === 'jitter') measureJitter();
    else if (k === 'template') measureTemplate($('#tplSel').value);
    else if (k === 'latency') measureLatency();
    else if (k === 'log') {
      if (S.log) { const rows = S.log; S.log = null; downloadCSV(`sync-log-${stamp()}.csv`, [['t_ms', 'thp_raw', 'thd_raw', 'thp_filt', 'thd_filt', 'score_p', 'score_d', 'ok', 'proc_ms'], ...rows]); }
      else S.log = [];
      renderSide();
    } else if (k === 'results') {
      downloadCSV(`sync-results-${stamp()}.csv`, [['種類', '項目', '値1', '値2', '合否'], ...S.results.map(r =>
        r.kind === '揺れ' ? [r.kind, 'SD θp/θd (deg)', r.p.toFixed(3), r.d.toFixed(3), r.pass ? '合格' : '不合格']
        : r.kind === '遅れ' ? [r.kind, '中央値/90% (ms)', r.median.toFixed(0), r.p90.toFixed(0), r.pass ? '合格' : '不合格']
        : [r.kind, `型紙${r.id} 誤差 θp/θd (deg)`, r.ep.toFixed(2), r.ed.toFixed(2), r.pass ? '合格' : '不合格'])]);
    }
  });
}

// ---------------- checks / chips ----------------
function checkItems() {
  const st = S.stats, items = [];
  const fpsS = !S.stream ? 'na' : S.fps >= 25 ? 'ok' : S.fps >= 15 ? 'warn' : 'ng';
  items.push({ s: fpsS, t: 'フレームレート', v: S.stream ? `${S.fps} fps` : '—' });
  if (st) {
    const bs = st.hi > 0.05 ? 'ng' : st.mean < 25 && st.lo > 0.6 ? 'warn' : 'ok';
    items.push({ s: S.stream ? bs : 'na', t: '明るさ', v: st.hi > 0.05 ? '白飛びあり' : `平均 ${st.mean.toFixed(0)}` });
    const handOut = S.open === 'place' || S.open === 'glass' || S.open === 'bg';
    if (handOut && st.diff != null) items.push({ s: st.diff < 1.5 ? 'ok' : st.diff < 4 ? 'warn' : 'ng', t: '揺れ', v: st.diff < 1.5 ? '安定' : '動いている' });
  } else items.push({ s: 'na', t: '明るさ', v: '—' });
  items.push({ s: S.bg.ready ? (S.bgSd < 22 ? 'ok' : 'warn') : 'na', t: '背景', v: S.bg.ready ? (S.bgSd < 22 ? '無地' : '模様あり') : '未撮影' });
  if (S.cal) {
    const m = S.model || T.buildModel(S.cal), res = Math.atan(1 / (0.55 * m.Lp)) * 180 / Math.PI;
    items.push({ s: res <= 0.5 ? 'ok' : res <= 1 ? 'warn' : 'ng', t: '指の大きさ', v: `1画素 ≒ ${res.toFixed(2)}°` });
  } else items.push({ s: 'na', t: '指の大きさ', v: '関節合わせの後' });
  items.push({ s: !S.cal || !S.bg.ready ? 'na' : S.ok ? 'ok' : 'ng', t: '追跡', v: !S.cal || !S.bg.ready ? '—' : S.ok ? `OK（${S.procMs.toFixed(1)} ms）` : '見失い' });
  if (!S.settings.mmCalibrated) items.push({ s: 'warn', t: '画面の大きさ', v: '未調整（⚙）' });
  return items;
}
const MK = { ok: '○', warn: '△', ng: '×', na: '−' };
function updateChecks() {
  $('#checks').innerHTML = checkItems().map(i => `<span class="check ${i.s}"><span class="mk">${MK[i.s]}</span>${i.t} <b>${i.v}</b></span>`).join('');
  const chip = (id, s, v) => { const e = $(id); e.className = 'chip ' + s; e.querySelector('b').textContent = v; };
  chip('#chipCam', !S.stream ? '' : S.fps >= 25 ? 'ok' : 'warn', S.stream ? `${S.fps} fps` : '—');
  chip('#chipTrack', !S.cal || !S.bg.ready ? '' : S.ok ? 'ok' : 'ng', !S.cal || !S.bg.ready ? '—' : S.ok ? 'OK' : '見失い');
  const a = S.filt, ce = $('#chipAng'); ce.className = 'chip ' + (S.ok ? 'ok' : '');
  const bs = ce.querySelectorAll('b'); bs[0].textContent = a ? a.thp.toFixed(1) + '°' : '—'; bs[1].textContent = a ? a.thd.toFixed(1) + '°' : '—';
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  set('liveP', a ? a.thp.toFixed(1) : '—'); set('liveD', a ? a.thd.toFixed(1) : '—');
  set('hudP', a ? a.thp.toFixed(1) : '—'); set('hudD', a ? a.thd.toFixed(1) : '—');
  set('liveS', S.raw ? `一致度 基節 ${S.raw.scoreP.toFixed(2)} / 末節 ${S.raw.scoreD.toFixed(2)}（${T.SCORE_OK} 以上でOK）・処理 ${S.procMs.toFixed(1)} ms` : '');
  set('logN', S.log ? S.log.length : 0);
  set('eyeStatus', S.eyeMode === 'track' ? eye.status : '標準の目の位置で描いています');
  if (display.lastForeshort != null) set('foreshort', `目から見た仮想中節の長さ：実長の ${Math.round(display.lastForeshort * 100)}%`);
  // the "track" step completes once tracking is OK: refresh the list once
  if (S.mode === 'setup' && S.step === 'track' && S.ok && !S.trackSeen) { S.trackSeen = true; renderSide(); }
}
setInterval(updateChecks, 150);

// ---------------- display loop ----------------
function dispCfg() { const s = S.settings; return { mmPerPx: s.mmPerPx, pipFrac: s.pipFrac, Lm: s.Lm, Ld: s.Ld, dia: s.dia }; }
function layout() {
  display.layout(dispCfg());
  const p = display.pipScreenPx(); const lab = $('#pipLabel'); lab.style.left = (p.x + 13 / S.settings.mmPerPx) + 'px'; lab.style.top = p.y + 'px';
  eye.configure({ hfov: S.settings.hfov, camPos: { x: 0, y: display.Hm / 2 + 8, z: 0 } });
}
addEventListener('resize', layout);
function fixedEye() { return { x: display.pip.x - S.settings.eyeX, y: display.pip.y - S.settings.eyeY, z: S.settings.eyeZ }; }
function loop() {
  const a = S.filt;
  if (a) display.setPose(a.thp, a.thd, S.ok); else display.setPose(70, 25, false);
  display.render(S.eyeMode === 'track' && eye.eye ? eye.eye : fixedEye());
  requestAnimationFrame(loop);
}

// ---------------- modes ----------------
function setMode(m) {
  S.mode = m; document.body.dataset.mode = m;
  document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
  renderSide();
}
document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => setMode(b.dataset.mode));
addEventListener('keydown', (e) => { if (e.key === 'Escape') { if ($('#settings').classList.contains('open')) $('#settings').classList.remove('open'); else setMode('setup'); } });
document.querySelectorAll('#eyeSeg button').forEach(b => b.onclick = async () => {
  const m = b.dataset.eye; S.eyeMode = m;
  document.querySelectorAll('#eyeSeg button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  if (m === 'track') { try { await eye.start($('#sEyeCam').value || undefined); } catch (e) { eye.status = `前面カメラを開けません：${e.message}`; } }
  else eye.stop();
});

// ---------------- settings ----------------
function bindSettings() {
  const s = S.settings, num = (id, key) => { const e = $(id); e.value = s[key]; e.onchange = () => { const v = parseFloat(e.value); if (isFinite(v)) { s[key] = v; save(); applySmooth(); layout(); } }; };
  num('#sLm', 'Lm'); num('#sLd', 'Ld'); num('#sDia', 'dia'); num('#sEyeX', 'eyeX'); num('#sEyeY', 'eyeY'); num('#sEyeZ', 'eyeZ'); num('#sFov', 'hfov'); num('#sSmooth', 'smooth');
  const cw = $('#cardW'), card = $('#card');
  const showCard = () => { const w = 85.6 / s.mmPerPx; cw.value = Math.round(w); card.style.width = w + 'px'; card.style.height = (w * 54 / 85.6) + 'px';
    $('#mmInfo').textContent = `1px = ${s.mmPerPx.toFixed(4)} mm（画面 ${Math.round(innerWidth * s.mmPerPx)} × ${Math.round(innerHeight * s.mmPerPx)} mm）${s.mmCalibrated ? '' : '・未調整'}`; };
  cw.oninput = () => { s.mmPerPx = 85.6 / parseFloat(cw.value); s.mmCalibrated = true; showCard(); save(); layout(); };
  showCard();
  $('#sEyeCam').onchange = () => { s.eyeCam = $('#sEyeCam').value; save(); };
  $('#gear').onclick = () => { $('#settings').classList.toggle('open'); showCard(); if (!SIM) navigator.mediaDevices.enumerateDevices().then(d => fillEyeCams(d.filter(x => x.kind === 'videoinput'))).catch(() => {}); };
  $('#closeSettings').onclick = () => $('#settings').classList.remove('open');
  $('#resetCal').onclick = () => { S.glass = null; S.cal = null; S.model = null; S.glassDone = false; S.jointsDone = false; S.placeDone = false; S.bg.reset(); save(); advance(); $('#settings').classList.remove('open'); };
}

// ---------------- boot ----------------
if (SIM) $('#simBanner').style.display = 'block';
document.documentElement.style.setProperty('--workH', '54vh');
bindSettings(); layout(); renderSide(); requestAnimationFrame(loop);

// test / automation hooks
window.sync = {
  S, get sim() { return sim; }, T,
  start: () => startCamera(SIM ? 'sim' : ''),
  setGlass(a, b) { S.glass = { a, b }; S.placeDone = true; },
  confirmGlass() { S.glassDone = true; S.bg.reset(); advance(); },
  captureBackground, autoJoints, confirmJoints, measureJitter, measureTemplate, measureLatency, setMode, display,
};
