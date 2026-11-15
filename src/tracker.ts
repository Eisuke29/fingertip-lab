import { HandCalibration, measureHand, type HandSample } from './calibration';
import { MarkerTracker, sampleMarkerColor, type ImagePoint } from './marker-tracking';
import { degrees, radians, v } from './math';
import { PoseSocket } from './socket';
import { neutralPose, type Pose, type PoseFrame } from './types';
import { $, href, icon, renderPipeline, roomName, setData, setText, slider, toggle } from './ui';
import qrcode from 'qrcode-generator';
import type { HandLandmarker } from '@mediapipe/tasks-vision';

const names = ['付け根', '第2関節', '第1関節', '指先'];
const initialColors = ['#ff4055', '#4cd36a', '#bc51d9', '#141414'];
type RecordKind = 'neutral' | 'down' | 'left' | 'bent';
type PosePoints = [number, number][];
const restPose: PosePoints = [[6, 12], [28, 22], [44, 24], [56, 33]];
const poses: { kind: RecordKind; title: string; detail: string; points: PosePoints }[] = [
  { kind: 'neutral', title: '楽な姿勢', detail: '画面に楽に触れる姿勢で止める', points: restPose },
  { kind: 'down', title: '手を下へ傾ける', detail: '指先の曲げはそのまま、手を下へ', points: [[9, 35], [28, 22], [44, 24], [56, 33]] },
  { kind: 'left', title: '手を左へ傾ける', detail: '楽な姿勢から手を画面の左へ', points: [[14, 4], [28, 22], [44, 24], [56, 33]] },
  { kind: 'bent', title: '指先だけ曲げる', detail: '手を戻し、指先の関節だけ曲げる', points: [[6, 12], [28, 22], [44, 24], [47, 38]] },
];
const poseSvg = (points: PosePoints, ghost: boolean) => {
  const line = (pts: PosePoints) => pts.map(p => p.join(',')).join(' ');
  return `<svg class="pose-art" viewBox="0 0 64 42" aria-hidden="true"><line x1="0" y1="41" x2="64" y2="41" class="glass"/>${ghost ? `<polyline points="${line(restPose)}" class="ghost"/>` : ''}<polyline points="${line(points)}" class="bone"/>${points.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="${i === 1 ? 3.2 : 2.2}" class="${i === 1 ? 'pivot' : 'joint'}"/>`).join('')}</svg>`;
};
const sources: { id: PoseFrame['source']; title: string; detail: string }[] = [
  { id: 'mediapipe', title: '自動検出', detail: '目印なし' },
  { id: 'markers', title: '4色マーカー', detail: '色の目印＋自動検出' },
  { id: 'simulation', title: '手動', detail: 'カメラなし' },
];
const meter = (id: string, label: string) => `<div class="meter"><span class="meter-label">${label}</span><span class="meter-track"><span class="meter-zero"></span><span class="meter-fill" id="${id}-bar"></span></span><strong id="${id}">—</strong></div>`;

export function startTracker() {
  $('app').innerHTML = `<main class="tracker-shell">
  <header class="tracker-head">
    <div class="brand"><p class="eyebrow">Pivot Finger Lab</p><h1>指の読み取り<span class="room-chip">接続名 ${roomName()}</span></h1></div>
    <ol class="pipeline" id="pipeline"></ol>
    <div class="head-links"><span class="conn" id="network-state">接続中</span><a class="pill-link" href="${href('dev')}" target="_blank" rel="noopener">調整・お試し${icon('external', 13)}</a></div>
  </header>
  <div class="next-banner" id="next-banner" data-tone="info"><span class="next-num" id="next-num">1</span><div><strong id="next-title">準備中</strong><span id="next-detail"></span></div></div>
  <div class="tracker-grid">
    <div class="camera-col">
      <div class="camera-box"><video id="camera-video" autoplay muted playsinline></video><canvas id="camera-preview" width="640" height="480"></canvas>
        <div class="camera-empty" id="camera-empty">${icon('camera', 40)}<p>カメラは停止中です</p><span>右の ① で「カメラを開始」</span></div>
        <span class="camera-state" id="tracking-state">停止中</span></div>
      <div class="meters">${meter('read-y', '手の傾き 上下')}${meter('read-x', '手の傾き 左右')}${meter('read-dip', '指先の曲げ')}</div>
    </div>
    <aside class="side">
      <details class="step" id="step-camera" open><summary><span class="step-num">1</span><h2>カメラで指を映す</h2><span class="step-status" id="status-1"></span></summary>
        <div class="choice" role="radiogroup" aria-label="読み取り方法">${sources.map(src => `<button role="radio" data-source="${src.id}" aria-checked="${src.id === 'mediapipe'}"><strong>${src.title}</strong><small>${src.detail}</small></button>`).join('')}</div>
        <div class="button-row" id="camera-controls"><button class="primary" id="start-camera">${icon('camera', 16)}<span id="start-label">カメラを開始</span></button><button class="secondary" id="stop-camera" disabled>${icon('stop', 14)}停止</button></div>
        <div class="tracker-error" id="camera-error" hidden></div>
        <div class="checks" id="setup-checks" hidden></div>
        <details id="markers-panel" class="sub markers" hidden><summary>色の目印<span class="tag" id="marker-summary">0 / 4</span></summary><p class="card-desc">ボタンを押して、映像の目印の真ん中をクリック</p>${names.map((name, i) => `<div class="marker-row"><span class="marker-dot" id="marker-state-${i}"></span><input type="color" id="marker-color-${i}" value="${initialColors[i]}" aria-label="${name}の色"/><button class="secondary" data-pick="${i}">${name}</button></div>`).join('')}<button class="ghost" id="reacquire">${icon('reset', 14)}目印を探し直す</button></details>
        <details class="sub guide" id="setup-guide"><summary>カメラの置き方</summary>
          <svg class="setup-art" viewBox="0 0 300 150" aria-hidden="true">
  <text x="8" y="14" class="cap">上から見た図</text>
  <rect x="40" y="24" width="96" height="118" rx="9" class="pad"/><rect x="47" y="31" width="82" height="104" rx="4" class="screen"/>
  <path d="M88 150 L88 86" class="finger"/><circle cx="88" cy="86" r="4.5" class="pivot"/>
  <path d="M232 86 L98 86" class="ray"/>
  <g transform="translate(232 74)"><rect width="30" height="24" rx="5" class="cam"/><circle cx="0" cy="12" r="6" class="lens"/></g>
  <text x="196" y="118" class="note">指の真横</text><text x="196" y="132" class="note">25〜40cm</text>
  <text x="8" y="146" class="note">指先は画面の奥へ</text>
</svg>
          <ol class="guide-list"><li>iPadは机に平らに置いて固定</li><li>カメラは<strong>指の真横</strong>、画面から<strong>3〜8cm上</strong>、25〜40cm離す</li><li>親指は人差し指から離す</li><li>指が映像の横幅の1/3以上に映るように</li></ol>
        </details>
        <div id="sender-simulation" class="sub" hidden>${slider('send-dip', '指先の曲げ', -15, 75, 0)}${slider('send-y', '手の傾き 上下', -25, 25, 0)}${slider('send-x', '手の傾き 左右', -25, 25, 0)}${toggle('send-contact', '接触あり', false)}</div>
      </details>
      <details class="step" id="calibration-panel"><summary><span class="step-num">2</span><h2>指の動きを登録</h2><span class="step-status" id="calibration-count"></span></summary>
        <p class="card-desc">姿勢を止めて <kbd>Space</kbd></p>
        <div class="calibration-list">${poses.map(pose => `<button class="pose" data-record="${pose.kind}" ${pose.kind === 'left' ? 'id="record-left" hidden' : ''}>${poseSvg(pose.points, pose.kind !== 'neutral')}<span class="pose-text"><strong>${pose.title}</strong><small>${pose.detail}</small></span><span class="pose-state"></span></button>`).join('')}</div>
        <p class="status-text" id="calibration-message"></p></details>
      <details class="step" id="step-phone"><summary><span class="step-num">3</span><h2>iPadで開く</h2><span class="step-status" id="status-3"></span></summary>
        <div class="qr-area" id="network-links"><p class="card-desc">アドレスを取得中…</p></div>
        <details id="contact-panel" class="sub guide"><summary>カメラで接触を判定（裏側用）</summary>${toggle('contact-armed', 'カメラで接触を判定', false)}<div class="contact-line"><span>判定</span><span class="tag" id="contact-state">無効</span></div>${slider('contact-radius', '許容半径', 8, 40, 18, 1, ' px')}</details>
      </details>
      <details class="step" id="tracker-advanced"><summary>詳細設定</summary>
        <div class="field-grid"><label for="camera-device">カメラ</label><select id="camera-device"><option value="">既定</option></select>
          <label for="phone-rotation">端末の向き</label><select id="phone-rotation"><option value="0">縦 0°</option><option value="90">横 90°</option><option value="180">縦 180°</option><option value="270">横 270°</option></select>
          <label for="axis-mode">読み取る傾き</label><select id="axis-mode"><option value="plane-y">上下のみ（横から撮影）</option><option value="estimated-xy">上下と左右（推定・斜めから撮影）</option></select></div>
        ${toggle('mirror-preview', 'プレビューを左右反転', true)}
        <button class="ghost danger" id="reset-calibration">${icon('reset', 14)}動きの登録をやり直す</button></details>
    </aside></div></main>`;
  const video = $<HTMLVideoElement>('camera-video');
  const preview = $<HTMLCanvasElement>('camera-preview');
  const ctx = preview.getContext('2d')!;
  const raw = document.createElement('canvas'); raw.width = 960; raw.height = 540;
  const rawCtx = raw.getContext('2d', { willReadFrequently: true })!;
  const calibration = new HandCalibration(), markers = new MarkerTracker(), socket = new PoseSocket('tracker', roomName());
  let detector: HandLandmarker | null = null, stream: MediaStream | null = null;
  let running = false, starting = false, disposed = false, lastProcess = 0, lastVideo = -1, seq = 0;
  let sample: HandSample | null = null, pose = neutralPose(), lastPixels: ImageData | null = null;
  let pick: number | null = null, lastPip: ImagePoint | null = null, lastSeen = 0, selectedHand = '';
  let reason = '停止中', modelState = 'idle', markersFolded = false, markerMiss = 0, openStep = 0;
  // Setup quality, measured continuously while the camera runs.
  let sideAngle: number | null = null, sizeRatio = 0, rejected = 0; const detections: boolean[] = [];
  let currentSource: PoseFrame['source'] = 'mediapipe';
  let recording: RecordKind | null = null;
  const source = () => currentSource;
  const simulationPose = (): Pose => ({ tiltX: radians(Number($<HTMLInputElement>('send-x').value)), tiltY: radians(Number($<HTMLInputElement>('send-y').value)), dip: radians(Number($<HTMLInputElement>('send-dip').value)) });
  const fail = (message: string) => { $('camera-error').textContent = message; $('camera-error').hidden = false; };
  socket.onStatus = text => $('network-state').textContent = text;
  socket.onReplaced = () => { void stopCamera(); };
  const calibrationSteps = () => { const keys = calibration.mode === 'estimated-xy' ? ['neutral', 'down', 'left', 'bent'] as const : ['neutral', 'down', 'bent'] as const; return { done: keys.filter(k => !!calibration[k]).length, total: keys.length }; };
  let viewers: number | null = null;
  socket.onPeers = n => { viewers = n; };
  function resetCalibration() { calibration.reset(); sample = null; pose = neutralPose(); $<HTMLInputElement>('contact-armed').checked = false; lastPip = null; selectedHand = ''; updateUi(); }
  const recordKeys = (): RecordKind[] => calibration.mode === 'estimated-xy' ? ['neutral', 'down', 'left', 'bent'] : ['neutral', 'down', 'bent'];
  const nextRecord = () => recordKeys().find(k => !calibration[k]) ?? null;
  function updateUi() {
    const sim = source() === 'simulation', markerMode = source() === 'markers';
    document.querySelectorAll<HTMLButtonElement>('[data-source]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.source === source())));
    $('sender-simulation').hidden = !sim; $('markers-panel').hidden = !markerMode;
    $('calibration-panel').hidden = $('contact-panel').hidden = sim; $('camera-controls').hidden = sim;
    $<HTMLSelectElement>('axis-mode').disabled = markerMode;
    $('record-left').hidden = calibration.mode !== 'estimated-xy';
    $('calibration-message').textContent = calibration.message;
    const next = running ? nextRecord() : null;
    document.querySelectorAll<HTMLButtonElement>('[data-record]').forEach(b => {
      const kind = b.dataset.record as RecordKind;
      b.setAttribute('aria-pressed', String(!!calibration[kind]));
      b.dataset.next = String(kind === next); b.dataset.busy = String(kind === recording);
      b.disabled = !running;
      b.querySelector('.pose-state')!.textContent = kind === recording ? '静止して…' : calibration[kind] ? '記録済' : kind === next ? '記録' : '';
    });
    const steps = calibrationSteps(); $('calibration-count').textContent = `${steps.done} / ${steps.total}`;
    $<HTMLButtonElement>('start-camera').disabled = starting || running;
    $('start-label').textContent = starting ? '起動中…' : running ? '読み取り中' : 'カメラを開始';
    $<HTMLButtonElement>('stop-camera').disabled = !running;
  }
  type Check = { label: string; state: 'ok' | 'warn' | 'bad'; detail: string };
  function setupChecks(): Check[] {
    const rate = detections.length ? detections.filter(Boolean).length / detections.length : 0;
    const checks: Check[] = [{ label: '指が映り続けている', state: rate >= 0.9 ? 'ok' : rate >= 0.7 ? 'warn' : 'bad',
      detail: rate >= 0.9 ? `検出率 ${Math.round(rate * 100)}%` : `検出率 ${Math.round(rate * 100)}% — 明るさ・背景・隠れを確認` }];
    checks.push({ label: '十分大きく映っている', state: sizeRatio >= 0.28 ? 'ok' : sizeRatio >= 0.18 ? 'warn' : 'bad',
      detail: sizeRatio ? `画面幅の ${Math.round(sizeRatio * 100)}%${sizeRatio < 0.28 ? ' — カメラを近づける（目標33%以上）' : ''}` : '—' });
    if (source() === 'mediapipe') checks.push({ label: '真横から撮れている', state: sideAngle === null ? 'bad' : sideAngle <= 25 ? 'ok' : sideAngle <= 40 ? 'warn' : 'bad',
      detail: sideAngle === null ? '—' : `ずれ ${Math.round(sideAngle)}°${sideAngle > 25 ? ' — カメラを指の真横へ回す（目標25°以内）' : ''}` });
    return checks;
  }
  const setupReady = () => setupChecks().every(c => c.state !== 'bad');
  function recordPose(kind: RecordKind) {
    if (recording || !running) return;
    if (!setupReady()) { calibration.message = '先に撮影チェックの × をなくす'; updateUi(); return; }
    recording = kind; updateUi();
    const started = performance.now();
    const attempt = () => {
      if (recording !== kind || !running) { recording = null; updateUi(); return; }
      const elapsed = performance.now() - started;
      // Give the hand a moment to settle after the click, then keep trying until it is still.
      const ok = elapsed > 350 && calibration.record(kind);
      if (ok || elapsed > 2600) { recording = null; updateUi(); } else { updateUi(); setTimeout(attempt, 120); }
    };
    setTimeout(attempt, 120);
  }
  async function stopCamera() {
    running = false; stream?.getTracks().forEach(track => track.stop()); stream = null; video.srcObject = null;
    sample = null; lastVideo = -1; lastPip = null; selectedHand = ''; calibration.reset(); markers.reset();
    $('camera-empty').hidden = false; reason = '停止中'; updateUi();
  }
  async function startCamera() {
    if (starting || running) return; starting = true; $('camera-error').hidden = true; updateUi();
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('カメラはPCの http://localhost:5173/tracker で開いてください。LAN上のHTTPでは取得できません。');
      const device = $<HTMLSelectElement>('camera-device').value;
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 60 }, ...(device ? { deviceId: { exact: device } } : {}) } });
      video.srcObject = stream; await video.play();
      raw.height = Math.round(raw.width * video.videoHeight / video.videoWidth);
      preview.width = raw.width; preview.height = raw.height;
      preview.parentElement!.style.aspectRatio = `${raw.width} / ${raw.height}`;
      // The hand model is the main input for 自動検出, and gives rough joint positions that steady the 4色マーカー.
      if (source() !== 'simulation' && !detector) {
        reason = 'モデル読み込み中'; $('tracking-state').textContent = reason; modelState = 'loading';
        try {
          const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision');
          const vision = await FilesetResolver.forVisionTasks(`${import.meta.env.BASE_URL}vendor/mediapipe`);
          const options = { baseOptions: { modelAssetPath: `${import.meta.env.BASE_URL}models/hand_landmarker.task` }, runningMode: 'VIDEO' as const, numHands: 2, minHandDetectionConfidence: 0.6, minHandPresenceConfidence: 0.6, minTrackingConfidence: 0.6 };
          try { detector = await HandLandmarker.createFromOptions(vision, { ...options, baseOptions: { ...options.baseOptions, delegate: 'GPU' } }); }
          catch { detector = await HandLandmarker.createFromOptions(vision, { ...options, baseOptions: { ...options.baseOptions, delegate: 'CPU' } }); }
          modelState = 'ready';
        } catch (error) {
          modelState = 'error';
          if (source() === 'mediapipe') throw error; // markers still work on colour alone
        }
      }
      if (disposed) { await stopCamera(); return; }
      const devices = await navigator.mediaDevices.enumerateDevices();
      const select = $<HTMLSelectElement>('camera-device'); select.replaceChildren(new Option('既定', ''));
      devices.filter(d => d.kind === 'videoinput').forEach((d, i) => select.add(new Option(d.label || `カメラ ${i + 1}`, d.deviceId)));
      select.value = device; running = true; markersFolded = false; sideAngle = null; sizeRatio = 0; detections.length = 0; $<HTMLDetailsElement>('setup-guide').open = false; lastVideo = -1; resetCalibration();
      $('camera-empty').hidden = true;
    } catch (error) { modelState = detector ? 'ready' : 'error'; await stopCamera(); fail(`${error instanceof Error ? error.message : error}（読み取り方法を4色マーカーに変更して再試行可）`); }
    finally { starting = false; updateUi(); }
  }
  $('start-camera').addEventListener('click', startCamera);
  $('stop-camera').addEventListener('click', stopCamera);
  document.querySelectorAll<HTMLButtonElement>('[data-source]').forEach(button => button.addEventListener('click', async () => {
    if (button.dataset.source === currentSource) return;
    currentSource = button.dataset.source as PoseFrame['source'];
    await stopCamera(); resetCalibration(); markers.reset(); if (source() === 'markers') { calibration.mode = 'plane-y'; $<HTMLSelectElement>('axis-mode').value = 'plane-y'; }
    updateUi();
  }));
  $('axis-mode').addEventListener('change', () => { calibration.mode = $<HTMLSelectElement>('axis-mode').value as HandCalibration['mode']; resetCalibration(); });
  for (const id of ['phone-rotation', 'mirror-preview', 'camera-device']) $(id).addEventListener('change', () => { resetCalibration(); if (id === 'camera-device' && running) void stopCamera(); });
  $('reset-calibration').addEventListener('click', resetCalibration);
  document.querySelectorAll<HTMLButtonElement>('[data-record]').forEach(button => button.addEventListener('click', () => recordPose(button.dataset.record as RecordKind)));
  document.addEventListener('keydown', event => {
    if (event.code !== 'Space' || event.repeat || (event.target as HTMLElement).closest('input, select, textarea, button, summary')) return;
    const next = nextRecord(); if (!running || source() === 'simulation' || !next) return;
    event.preventDefault(); recordPose(next);
  });
  document.querySelectorAll<HTMLButtonElement>('[data-pick]').forEach(button => button.addEventListener('click', () => { pick = Number(button.dataset.pick); $('camera-preview').style.cursor = 'crosshair'; }));
  preview.addEventListener('click', event => {
    if (pick === null || !lastPixels) return;
    const rect = preview.getBoundingClientRect(), mirror = $<HTMLInputElement>('mirror-preview').checked;
    const sx = (event.clientX - rect.left) / rect.width;
    const x = Math.max(0, Math.min(raw.width - 1, Math.round((mirror ? 1 - sx : sx) * raw.width)));
    const y = Math.max(0, Math.min(raw.height - 1, Math.round((event.clientY - rect.top) / rect.height * raw.height)));
    const picked = sampleMarkerColor(lastPixels.data, raw.width, raw.height, x, y);
    $<HTMLInputElement>(`marker-color-${pick}`).value = picked.hex;
    markers.seed(pick, picked.x, picked.y); pick = null; preview.style.cursor = ''; updateUi();
  });
  // Changing a marker colour only re-finds the marks; the registered finger motion is kept.
  for (let i = 0; i < 4; i++) $(`marker-color-${i}`).addEventListener('change', () => markers.reset());
  $('reacquire').addEventListener('click', () => markers.reset());
  $('contact-radius').addEventListener('input', () => $('contact-radius-out').textContent = $<HTMLInputElement>('contact-radius').value + ' px');
  for (const id of ['send-x', 'send-y', 'send-dip']) $(id).addEventListener('input', () => $(id + '-out').textContent = $<HTMLInputElement>(id).value + '°');
  const lanRank = (url: string) => /\/\/192\.168\./.test(url) ? 0 : /\/\/10\./.test(url) ? 1 : /\/\/172\./.test(url) ? 3 : 2;
  function showAddresses(urls: string[], selected = 0) {
    const box = $('network-links'); const url = urls[selected];
    const qr = qrcode(0, 'M'); qr.addData(url); qr.make();
    box.innerHTML = `<div class="qr">${qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true })}</div>
      <div class="qr-text"><p>iPadのカメラで読み取る（PCと同じWi-Fi）</p>
      <a class="url" href="${url}" target="_blank" rel="noopener">${url.replace(/^http:\/\//, '')}</a>
      ${urls.length > 1 ? `<p class="alt">開けない時：${urls.map((u, i) => i === selected ? '' : `<button class="link" data-address="${i}">${new URL(u).hostname}</button>`).join('')}</p>` : ''}</div>`;
    box.querySelectorAll<HTMLButtonElement>('[data-address]').forEach(b => b.addEventListener('click', () => showAddresses(urls, Number(b.dataset.address))));
  }
  fetch('/api/network').then(r => r.json()).then(data => {
    const urls = (data.urls.length ? data.urls as string[] : [data.local as string]).map(address => { const url = new URL(address); url.searchParams.set('room', roomName()); return url.href; })
      .sort((a, b) => lanRank(a) - lanRank(b));
    showAddresses(urls);
  }).catch(() => { $('network-links').innerHTML = '<p class="card-desc">起動したターミナルに表示されたLANアドレスをiPadで開きます。</p>'; });

  /** Rough MCP/PIP/DIP/tip from the hand model, used only to choose which colour blob is each mark. */
  let hints: (ImagePoint | null)[] | null = null;
  function markerHints(now: number): (ImagePoint | null)[] | null {
    if (!detector) return null;
    const result = detector.detectForVideo(video, now);
    const ref = markers.previous[1] ?? lastPip;
    const hand = result.landmarks.map(h => h).sort((a, b) => !ref ? 0 : Math.hypot(a[6].x * raw.width - ref.x, a[6].y * raw.height - ref.y) - Math.hypot(b[6].x * raw.width - ref.x, b[6].y * raw.height - ref.y))[0];
    return hand ? [5, 6, 7, 8].map(i => ({ x: hand[i].x * raw.width, y: hand[i].y * raw.height })) : null;
  }
  function processCamera(now: number, dt: number) {
    if (!running || video.readyState < 2 || video.currentTime === lastVideo) return;
    lastVideo = video.currentTime;
    rawCtx.drawImage(video, 0, 0, raw.width, raw.height); sample = null; hints = null;
    let points: (ImagePoint | null)[] = [null, null, null, null];
    try {
      if (source() === 'markers') {
        lastPixels = rawCtx.getImageData(0, 0, raw.width, raw.height);
        hints = markerHints(now);
        const tracked = markers.detect(lastPixels.data, raw.width, raw.height, initialColors.map((_, i) => $<HTMLInputElement>(`marker-color-${i}`).value), hints ?? undefined);
        points = tracked.points; reason = tracked.reason;
        setText($('marker-summary'), `${points.filter(Boolean).length} / 4`);
        // Open the colour setup only while marks stay missing; fold it once all four are found.
        markerMiss = tracked.valid ? 0 : markerMiss + 1;
        if (tracked.valid && !markersFolded) { markersFolded = true; $<HTMLDetailsElement>('markers-panel').open = false; }
        if (markerMiss === 20) { markersFolded = false; $<HTMLDetailsElement>('markers-panel').open = true; }
        if (tracked.valid) sample = measureHand(points as HandSample['image'], null);
      } else if (detector) {
        const result = detector.detectForVideo(video, now);
        const candidates = result.landmarks.map((hand, index) => ({ hand, index, label: result.handedness[index]?.[0]?.categoryName || '' }));
        const candidate = candidates.filter(c => !selectedHand || selectedHand === c.label).sort((a, b) => {
          if (!lastPip) return 0;
          return Math.hypot(a.hand[6].x * raw.width - lastPip.x, a.hand[6].y * raw.height - lastPip.y) - Math.hypot(b.hand[6].x * raw.width - lastPip.x, b.hand[6].y * raw.height - lastPip.y);
        })[0];
        if (candidate) {
          points = [5, 6, 7, 8].map(i => ({ x: candidate.hand[i].x * raw.width, y: candidate.hand[i].y * raw.height }));
          const worldHand = result.worldLandmarks[candidate.index];
          // Side-view mode deliberately uses only the image-plane angle, not inferred depth.
          const world = calibration.mode === 'estimated-xy' && worldHand ? [5, 6, 7, 8].map(i => v(worldHand[i].x, -worldHand[i].y, -worldHand[i].z)) as NonNullable<HandSample['world']> : null;
          if (!lastPip || Math.hypot(points[1]!.x - lastPip.x, points[1]!.y - lastPip.y) < raw.width * 0.18) {
            sample = measureHand(points as HandSample['image'], world); selectedHand = candidate.label;
            // Side-view check: the knuckle line (index MCP -> pinky MCP) should point along the camera axis.
            const w5 = worldHand?.[5], w17 = worldHand?.[17];
            if (w5 && w17) {
              const k = v(w17.x - w5.x, w17.y - w5.y, w17.z - w5.z), len = Math.hypot(k.x, k.y, k.z) || 1;
              const off = Math.acos(Math.min(1, Math.abs(k.z) / len)) * 180 / Math.PI;
              sideAngle = sideAngle === null ? off : sideAngle + (off - sideAngle) * 0.15;
            }
          }
        }
        reason = sample ? '4点を読み取り中' : '人差し指の付け根から指先までが映っていません';
      }
    } catch (error) { sample = null; reason = `読み取りエラー：${error instanceof Error ? error.message : error}`; }
    if (sample && !calibration.plausible(sample)) { sample = null; rejected++; reason = '検出が乱れたフレームを除外（指の長さが不自然）'; }
    if (sample) sizeRatio = sample.image.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - sample!.image[i].x, p.y - sample!.image[i].y), 0) / raw.width;
    detections.push(!!sample); if (detections.length > 30) detections.shift();
    if (sample) { lastPip = sample.image[1]; lastSeen = now; pose = calibration.pose(sample, dt); }
    else if (now - lastSeen > 650) { lastPip = null; markers.reset(); }
    calibration.push(sample);
    const mirror = $<HTMLInputElement>('mirror-preview').checked;
    ctx.save(); ctx.clearRect(0, 0, raw.width, raw.height); if (mirror) { ctx.translate(raw.width, 0); ctx.scale(-1, 1); } ctx.drawImage(raw, 0, 0);
    if (calibration.neutral) {
      ctx.strokeStyle = '#f3e5ba'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(calibration.neutral.pip.x, calibration.neutral.pip.y, Number($<HTMLInputElement>('contact-radius').value), 0, Math.PI * 2); ctx.stroke();
    }
    ctx.strokeStyle = '#f9efc8'; ctx.lineWidth = 2; ctx.beginPath(); points.forEach((p, i) => { if (p) i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }); ctx.stroke();
    if (hints) { ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); hints.forEach(h => { if (h) { ctx.beginPath(); ctx.arc(h.x, h.y, 10, 0, Math.PI * 2); ctx.stroke(); } }); ctx.setLineDash([]); }
    points.forEach((p, i) => { if (p) { ctx.fillStyle = source() === 'markers' ? $<HTMLInputElement>(`marker-color-${i}`).value : initialColors[i]; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); } $(`marker-state-${i}`).classList.toggle('ok', !!p); }); ctx.restore();
    ctx.fillStyle = '#fff9dc'; ctx.font = '12px sans-serif'; points.forEach((p, i) => { if (p) ctx.fillText(names[i], (mirror ? raw.width - p.x : p.x) + 9, p.y - 9); });
  }
  let lastFrame: PoseFrame | null = null;
  (window as unknown as { __pivotTracker: unknown }).__pivotTracker = { snapshot: () => ({ running, modelState, source: source(), calibrated: calibration.ready, frame: structuredClone(lastFrame), points: sample?.image || null, reason }) };
  function tick(now: number) {
    if (disposed) return;
    if (now - lastProcess >= 30) {
      const dt = Math.min(0.1, (now - lastProcess) / 1000); lastProcess = now;
      const sim = source() === 'simulation'; if (!sim) processCamera(now, dt);
      const valid = sim || (running && !!sample && calibration.ready && now - lastSeen < 180);
      const contact = sim ? $<HTMLInputElement>('send-contact').checked : valid && $<HTMLInputElement>('contact-armed').checked && calibration.nearContact(sample!, Number($<HTMLInputElement>('contact-radius').value));
      if (sim) pose = simulationPose();
      lastFrame = { type: 'pose', version: 2, seq: seq++, source: source(), pose: { ...pose }, valid, calibrated: sim || calibration.ready, contact,
        axes: calibration.mode, rotation: Number($<HTMLSelectElement>('phone-rotation').value), confidence: valid ? 1 : 0, sentAt: Date.now() };
      socket.send(lastFrame);
      setText($('tracking-state'), sim ? '手動入力（実際の指ではありません）' : pick !== null ? `映像上の ${names[pick]} の目印をクリック` : reason);
      $('tracking-state').dataset.ok = String(!sim && !!sample);
      $('contact-state').textContent = contact ? 'あり' : $<HTMLInputElement>('contact-armed').checked ? 'なし' : '無効';
      const steps = calibrationSteps();
      renderPipeline($('pipeline'), [
        ['カメラ', sim ? '使用しない' : running ? '取得中' : starting ? '起動中' : '停止', sim ? 'skip' : running ? 'ok' : starting ? 'wait' : 'off'],
        ['指の検出', sim ? '—' : sample ? '4点検出' : running ? '未検出' : '—', sim ? 'skip' : sample ? 'ok' : running ? 'wait' : 'off'],
        ['動きの登録', sim ? '—' : calibration.ready ? '完了' : `${steps.done}/${steps.total}`, sim ? 'skip' : calibration.ready ? 'ok' : running ? 'wait' : 'off'],
        ['iPadへ送信', !socket.connected ? '未接続' : valid ? '送信中' : '無効値', !socket.connected ? 'off' : valid ? 'ok' : 'wait'],
        ['iPad', viewers === null ? '—' : viewers + '台', viewers ? 'ok' : 'off'],
      ]);
      for (const [id, value, range] of [['read-x', pose.tiltX, 30], ['read-y', pose.tiltY, 30], ['read-dip', pose.dip, 75]] as const) {
        const deg = degrees(value), share = Math.min(1, Math.abs(deg) / range) * 50;
        setText($(id), valid ? deg.toFixed(1) + '°' : '—');
        const bar = $(id + '-bar'); bar.style.left = (deg < 0 ? 50 - share : 50) + '%'; bar.style.width = (valid ? share : 0) + '%';
      }
      // One "next action" for the whole screen, plus per-step state.
      const seenRate = detections.length ? detections.filter(Boolean).length / detections.length : 0;
      const cameraDone = sim || (running && (calibration.ready || seenRate >= 0.5)), calibrated = sim || calibration.ready, phoneDone = !!viewers;
      const current = !cameraDone ? 1 : !calibrated ? 2 : !phoneDone ? 3 : 4;
      const stepIds = ['step-camera', 'calibration-panel', 'step-phone'];
      stepIds.forEach((id, i) => setData($(id), 'state', i + 1 < current ? 'done' : i + 1 === current ? 'current' : 'todo'));
      // Open only the step that needs doing; the others stay folded (still clickable).
      if (current !== openStep) { openStep = current; stepIds.forEach((id, i) => { ($(id) as HTMLDetailsElement).open = i + 1 === Math.min(current, 3); }); }
      setText($('status-1'), sim ? '手動' : !running ? '' : sample ? '映っている' : '未検出');
      setText($('status-3'), viewers ? `${viewers}台` : '');
      const next = nextRecord(), nextPose = poses.find(p => p.kind === next);
      const [tone, num, title, detail] =
        socket.replaced ? ['err', '!', '別のタブで「指の読み取り」が開かれたので、この画面は止まりました', 'このタブを使うなら再読み込み'] :
        !socket.connected ? ['err', '!', 'PCのサーバーに接続できません', 'サーバー起動.bat を実行'] :
        sim ? (phoneDone ? ['ok', '✓', '手動の値を送信中', ''] : ['info', '3', 'iPadでQRコードを読み取る', '']) :
        starting ? ['info', '1', 'カメラを起動中…', ''] :
        !running ? ['info', '1', '「カメラを開始」を押す', ''] :
        !sample ? ['warn', '1', '人差し指を映す', source() === 'markers' ? reason : '付け根から指先まで横から映るように'] :
        !calibration.ready && !setupReady() ? ['warn', '1', 'カメラの位置を直してください', (setupChecks().find(c => c.state === 'bad')?.detail ?? '')] :
        !calibration.ready ? ['info', '2', recording ? '止めたまま…' : `「${nextPose?.title ?? ''}」で止めて Space`, recording ? '' : nextPose?.detail ?? ''] :
        !phoneDone ? ['info', '3', 'iPadでQRコードを読み取る', ''] :
        ['ok', '✓', '準備完了：iPadの ○ に第2関節を当てる', ''];
      const checks = running && !sim ? setupChecks() : [];
      $('setup-checks').hidden = !checks.length;
      if (checks.length) {
        const html = `<p class="checks-title">撮影チェック</p>` + checks.map(c => `<div class="check" data-state="${c.state}"><span class="mark">${c.state === 'ok' ? '✓' : c.state === 'warn' ? '!' : '×'}</span><span><strong>${c.label}</strong><small>${c.detail}</small></span></div>`).join('');
        if ($('setup-checks').innerHTML !== html) $('setup-checks').innerHTML = html;
      }
      setData($('next-banner'), 'tone', tone); setText($('next-num'), num); setText($('next-title'), title); setText($('next-detail'), detail);
    }
    requestAnimationFrame(tick);
  }
  window.addEventListener('pagehide', () => { disposed = true; socket.close(); void stopCamera(); detector?.close(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { sample = null; $<HTMLInputElement>('contact-armed').checked = false; } });
  updateUi(); requestAnimationFrame(tick);
}
