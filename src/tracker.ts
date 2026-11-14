import { HandCalibration, measureHand, type HandSample } from './calibration';
import { MarkerTracker, type ImagePoint } from './marker-tracking';
import { degrees, radians, v } from './math';
import { PoseSocket } from './socket';
import { neutralPose, type Pose, type PoseFrame } from './types';
import { $, href, icon, renderPipeline, roomName, setData, setText, slider, toggle } from './ui';
import qrcode from 'qrcode-generator';
import type { HandLandmarker } from '@mediapipe/tasks-vision';

const names = ['MCP', 'PIP', 'DIP', 'TIP'];
const initialColors = ['#ff4055', '#4cd36a', '#4185f4', '#bc51d9'];
type RecordKind = 'neutral' | 'down' | 'left' | 'bent';
type PosePoints = [number, number][];
const restPose: PosePoints = [[6, 12], [28, 22], [44, 24], [56, 33]];
const poses: { kind: RecordKind; title: string; detail: string; points: PosePoints }[] = [
  { kind: 'neutral', title: '基準姿勢', detail: '画面に楽に触れる姿勢で止める', points: restPose },
  { kind: 'down', title: '手側を下へ倒す', detail: '指先はそのまま、手の甲側を下へ', points: [[9, 35], [28, 22], [44, 24], [56, 33]] },
  { kind: 'left', title: '手側を左へ倒す', detail: '基準から手側を画面の左へ', points: [[14, 4], [28, 22], [44, 24], [56, 33]] },
  { kind: 'bent', title: 'DIPだけ曲げる', detail: '手側を基準に戻し、指先だけ曲げる', points: [[6, 12], [28, 22], [44, 24], [47, 38]] },
];
const poseSvg = (points: PosePoints, ghost: boolean) => {
  const line = (pts: PosePoints) => pts.map(p => p.join(',')).join(' ');
  return `<svg class="pose-art" viewBox="0 0 64 42" aria-hidden="true"><line x1="0" y1="41" x2="64" y2="41" class="glass"/>${ghost ? `<polyline points="${line(restPose)}" class="ghost"/>` : ''}<polyline points="${line(points)}" class="bone"/>${points.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="${i === 1 ? 3.2 : 2.2}" class="${i === 1 ? 'pivot' : 'joint'}"/>`).join('')}</svg>`;
};
const sources: { id: PoseFrame['source']; title: string; detail: string }[] = [
  { id: 'mediapipe', title: '自動検出', detail: '目印なし' },
  { id: 'markers', title: '4色マーカー', detail: '色シールを貼る' },
  { id: 'simulation', title: 'シミュレーション', detail: 'カメラなし' },
];
const meter = (id: string, label: string) => `<div class="meter"><span class="meter-label">${label}</span><span class="meter-track"><span class="meter-zero"></span><span class="meter-fill" id="${id}-bar"></span></span><strong id="${id}">—</strong></div>`;

export function startTracker() {
  $('app').innerHTML = `<main class="tracker-shell">
  <header class="tracker-head">
    <div class="brand"><p class="eyebrow">Pivot Finger Lab</p><h1>計測画面<span class="room-chip">room ${roomName()}</span></h1></div>
    <ol class="pipeline" id="pipeline"></ol>
    <div class="head-links"><span class="conn" id="network-state">接続中</span><a class="pill-link" href="${href('dev')}" target="_blank" rel="noopener">開発画面${icon('external', 13)}</a></div>
  </header>
  <div class="next-banner" id="next-banner" data-tone="info"><span class="next-num" id="next-num">1</span><div><strong id="next-title">準備中</strong><span id="next-detail"></span></div></div>
  <div class="tracker-grid">
    <div class="camera-col">
      <div class="camera-box"><video id="camera-video" autoplay muted playsinline></video><canvas id="camera-preview" width="640" height="480"></canvas>
        <div class="camera-empty" id="camera-empty">${icon('camera', 40)}<p>カメラは停止中です</p><span>右の ① で計測方式を選び「カメラを開始」</span></div>
        <span class="camera-state" id="tracking-state">停止中</span></div>
      <div class="meters">${meter('read-y', '手側 上下')}${meter('read-x', '手側 左右')}${meter('read-dip', 'DIP 曲げ')}</div>
    </div>
    <aside class="side">
      <section class="step" id="step-camera"><header><span class="step-num">1</span><h2>カメラと計測方式</h2></header>
        <div class="choice" role="radiogroup" aria-label="計測方式">${sources.map(src => `<button role="radio" data-source="${src.id}" aria-checked="${src.id === 'mediapipe'}"><strong>${src.title}</strong><small>${src.detail}</small></button>`).join('')}</div>
        <div class="button-row" id="camera-controls"><button class="primary" id="start-camera">${icon('camera', 16)}<span id="start-label">カメラを開始</span></button><button class="secondary" id="stop-camera" disabled>${icon('stop', 14)}停止</button></div>
        <div class="tracker-error" id="camera-error" hidden></div>
        <div id="sender-simulation" class="sub" hidden>${slider('send-dip', 'DIP（指先の曲げ）', -15, 75, 0)}${slider('send-y', '手側 上下', -25, 25, 0)}${slider('send-x', '手側 左右', -25, 25, 0)}${toggle('send-contact', '接触あり', false)}</div>
        <details id="markers-panel" class="sub markers" open hidden><summary>色の目印<span class="tag" id="marker-summary">0 / 4</span></summary><p class="card-desc">MCP・PIP・DIP・指先に異なる色の目印を付け、ボタンを押してから映像上の目印をクリックします。</p>${names.map((name, i) => `<div class="marker-row"><span class="marker-dot" id="marker-state-${i}"></span><input type="color" id="marker-color-${i}" value="${initialColors[i]}" aria-label="${name}の色"/><button class="secondary" data-pick="${i}">${name} の色を採取</button></div>`).join('')}<button class="ghost" id="reacquire">${icon('reset', 14)}再検出</button></details>
      </section>
      <section class="step" id="calibration-panel"><header><span class="step-num">2</span><h2>校正</h2><span class="step-count" id="calibration-count"></span></header>
        <p class="card-desc">横から見たカメラで、各姿勢を約0.5秒止めて記録します。<kbd>Space</kbd> で次の姿勢を記録できます。</p>
        <div class="calibration-list">${poses.map(pose => `<button class="pose" data-record="${pose.kind}" ${pose.kind === 'left' ? 'id="record-left" hidden' : ''}>${poseSvg(pose.points, pose.kind !== 'neutral')}<span class="pose-text"><strong>${pose.title}</strong><small>${pose.detail}</small></span><span class="pose-state"></span></button>`).join('')}</div>
        <p class="status-text" id="calibration-message"></p></section>
      <section class="step" id="step-phone"><header><span class="step-num">3</span><h2>iPhoneで表示を開く</h2></header>
        <div class="qr-area" id="network-links"><p class="card-desc">アドレスを取得中…</p></div>
        <div id="contact-panel" class="sub">${toggle('contact-armed', 'カメラで接触を判定', false, '裏側・タッチが効かない時。指を合わせてから有効に')}<div class="contact-line"><span>判定</span><span class="tag" id="contact-state">無効</span></div>${slider('contact-radius', '許容半径', 8, 40, 18, 1, ' px')}</div>
      </section>
      <details class="step" id="tracker-advanced"><summary>詳細設定</summary>
        <div class="field-grid"><label for="camera-device">カメラ</label><select id="camera-device"><option value="">既定</option></select>
          <label for="phone-rotation">端末の向き</label><select id="phone-rotation"><option value="0">縦 0°</option><option value="90">横 90°</option><option value="180">縦 180°</option><option value="270">横 270°</option></select>
          <label for="axis-mode">計測軸</label><select id="axis-mode"><option value="plane-y">面内1軸（上下）</option><option value="estimated-xy">2軸推定（上下・左右）</option></select></div>
        ${toggle('mirror-preview', 'プレビューを左右反転', true)}
        <button class="ghost danger" id="reset-calibration">${icon('reset', 14)}校正をやり直す</button></details>
    </aside></div></main>`;
  const video = $<HTMLVideoElement>('camera-video');
  const preview = $<HTMLCanvasElement>('camera-preview');
  const ctx = preview.getContext('2d')!;
  const raw = document.createElement('canvas'); raw.width = 640; raw.height = 480;
  const rawCtx = raw.getContext('2d', { willReadFrequently: true })!;
  const calibration = new HandCalibration(), markers = new MarkerTracker(), socket = new PoseSocket('tracker', roomName());
  let detector: HandLandmarker | null = null, stream: MediaStream | null = null;
  let running = false, starting = false, disposed = false, lastProcess = 0, lastVideo = -1, seq = 0;
  let sample: HandSample | null = null, pose = neutralPose(), lastPixels: ImageData | null = null;
  let pick: number | null = null, lastPip: ImagePoint | null = null, lastSeen = 0, selectedHand = '';
  let reason = '停止中', modelState = 'idle', markersFolded = false;
  let currentSource: PoseFrame['source'] = 'mediapipe';
  let recording: RecordKind | null = null;
  const source = () => currentSource;
  const simulationPose = (): Pose => ({ tiltX: radians(Number($<HTMLInputElement>('send-x').value)), tiltY: radians(Number($<HTMLInputElement>('send-y').value)), dip: radians(Number($<HTMLInputElement>('send-dip').value)) });
  const fail = (message: string) => { $('camera-error').textContent = message; $('camera-error').hidden = false; };
  socket.onStatus = text => $('network-state').textContent = text;
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
    $('start-label').textContent = starting ? '起動中…' : running ? '計測中' : 'カメラを開始';
    $<HTMLButtonElement>('stop-camera').disabled = !running;
  }
  function recordPose(kind: RecordKind) {
    if (recording || !running) return;
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
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24, max: 30 }, ...(device ? { deviceId: { exact: device } } : {}) } });
      video.srcObject = stream; await video.play();
      raw.height = Math.round(raw.width * video.videoHeight / video.videoWidth);
      preview.width = raw.width; preview.height = raw.height;
      preview.parentElement!.style.aspectRatio = `${raw.width} / ${raw.height}`;
      if (source() === 'mediapipe' && !detector) {
        reason = 'モデル読み込み中'; $('tracking-state').textContent = reason; modelState = 'loading';
        const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision');
        const vision = await FilesetResolver.forVisionTasks(`${import.meta.env.BASE_URL}vendor/mediapipe`);
        const options = { baseOptions: { modelAssetPath: `${import.meta.env.BASE_URL}models/hand_landmarker.task` }, runningMode: 'VIDEO' as const, numHands: 2, minHandDetectionConfidence: 0.6, minHandPresenceConfidence: 0.6, minTrackingConfidence: 0.6 };
        try { detector = await HandLandmarker.createFromOptions(vision, { ...options, baseOptions: { ...options.baseOptions, delegate: 'GPU' } }); }
        catch { detector = await HandLandmarker.createFromOptions(vision, { ...options, baseOptions: { ...options.baseOptions, delegate: 'CPU' } }); }
        modelState = 'ready';
      }
      if (disposed) { await stopCamera(); return; }
      const devices = await navigator.mediaDevices.enumerateDevices();
      const select = $<HTMLSelectElement>('camera-device'); select.replaceChildren(new Option('既定', ''));
      devices.filter(d => d.kind === 'videoinput').forEach((d, i) => select.add(new Option(d.label || `カメラ ${i + 1}`, d.deviceId)));
      select.value = device; running = true; markersFolded = false; $<HTMLDetailsElement>('markers-panel').open = true; lastVideo = -1; resetCalibration();
      $('camera-empty').hidden = true;
    } catch (error) { modelState = detector ? 'ready' : 'error'; await stopCamera(); fail(`${error instanceof Error ? error.message : error}（計測方式を4色マーカーに変更して再試行可）`); }
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
    const p = (y * raw.width + x) * 4;
    $<HTMLInputElement>(`marker-color-${pick}`).value = '#' + [...lastPixels.data.slice(p, p + 3)].map(n => n.toString(16).padStart(2, '0')).join('');
    markers.seed(pick, x, y); pick = null; preview.style.cursor = ''; resetCalibration();
  });
  for (let i = 0; i < 4; i++) $(`marker-color-${i}`).addEventListener('change', () => { markers.reset(); resetCalibration(); });
  $('reacquire').addEventListener('click', () => { markers.reset(); resetCalibration(); });
  $('contact-radius').addEventListener('input', () => $('contact-radius-out').textContent = $<HTMLInputElement>('contact-radius').value + ' px');
  for (const id of ['send-x', 'send-y', 'send-dip']) $(id).addEventListener('input', () => $(id + '-out').textContent = $<HTMLInputElement>(id).value + '°');
  const lanRank = (url: string) => /\/\/192\.168\./.test(url) ? 0 : /\/\/10\./.test(url) ? 1 : /\/\/172\./.test(url) ? 3 : 2;
  function showAddresses(urls: string[], selected = 0) {
    const box = $('network-links'); const url = urls[selected];
    const qr = qrcode(0, 'M'); qr.addData(url); qr.make();
    box.innerHTML = `<div class="qr">${qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true })}</div>
      <div class="qr-text"><p>iPhoneを<strong>このPCと同じWi-Fi</strong>につなぎ、カメラアプリでQRコードを読み取ります。</p>
      <a class="url" href="${url}" target="_blank" rel="noopener">${url.replace(/^http:\/\//, '')}</a>
      ${urls.length > 1 ? `<p class="alt">開けない時は別のアドレス：${urls.map((u, i) => i === selected ? '' : `<button class="link" data-address="${i}">${new URL(u).hostname}</button>`).join('')}</p>` : ''}</div>`;
    box.querySelectorAll<HTMLButtonElement>('[data-address]').forEach(b => b.addEventListener('click', () => showAddresses(urls, Number(b.dataset.address))));
  }
  fetch('/api/network').then(r => r.json()).then(data => {
    const urls = (data.urls.length ? data.urls as string[] : [data.local as string]).map(address => { const url = new URL(address); url.searchParams.set('room', roomName()); return url.href; })
      .sort((a, b) => lanRank(a) - lanRank(b));
    showAddresses(urls);
  }).catch(() => { $('network-links').innerHTML = '<p class="card-desc">起動したターミナルに表示されたLANアドレスをiPhoneで開きます。</p>'; });

  function processCamera(now: number, dt: number) {
    if (!running || video.readyState < 2 || video.currentTime === lastVideo) return;
    lastVideo = video.currentTime;
    rawCtx.drawImage(video, 0, 0, raw.width, raw.height); sample = null;
    let points: (ImagePoint | null)[] = [null, null, null, null];
    try {
      if (source() === 'markers') {
        lastPixels = rawCtx.getImageData(0, 0, raw.width, raw.height);
        const tracked = markers.detect(lastPixels.data, raw.width, raw.height, initialColors.map((_, i) => $<HTMLInputElement>(`marker-color-${i}`).value));
        points = tracked.points; reason = tracked.reason;
        setText($('marker-summary'), `${points.filter(Boolean).length} / 4`);
        // Fold the color setup once all four markers are found, so calibration stays in view.
        if (tracked.valid && !markersFolded) { markersFolded = true; $<HTMLDetailsElement>('markers-panel').open = false; }
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
          }
        }
        reason = sample ? '4点を追跡中' : '人差し指の4点が映っていない';
      }
    } catch (error) { sample = null; reason = `計測エラー：${error instanceof Error ? error.message : error}`; }
    if (sample) { lastPip = sample.image[1]; lastSeen = now; pose = calibration.pose(sample, dt); }
    else if (now - lastSeen > 650) { lastPip = null; markers.reset(); }
    calibration.push(sample);
    const mirror = $<HTMLInputElement>('mirror-preview').checked;
    ctx.save(); ctx.clearRect(0, 0, raw.width, raw.height); if (mirror) { ctx.translate(raw.width, 0); ctx.scale(-1, 1); } ctx.drawImage(raw, 0, 0);
    if (calibration.neutral) {
      ctx.strokeStyle = '#f3e5ba'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(calibration.neutral.pip.x, calibration.neutral.pip.y, Number($<HTMLInputElement>('contact-radius').value), 0, Math.PI * 2); ctx.stroke();
    }
    ctx.strokeStyle = '#f9efc8'; ctx.lineWidth = 2; ctx.beginPath(); points.forEach((p, i) => { if (p) i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }); ctx.stroke();
    points.forEach((p, i) => { if (p) { ctx.fillStyle = initialColors[i]; ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2); ctx.fill(); } $(`marker-state-${i}`).classList.toggle('ok', !!p); }); ctx.restore();
    ctx.fillStyle = '#fff9dc'; ctx.font = '12px sans-serif'; points.forEach((p, i) => { if (p) ctx.fillText(['MCP', 'PIP', 'DIP', 'TIP'][i], (mirror ? raw.width - p.x : p.x) + 9, p.y - 9); });
  }
  let lastFrame: PoseFrame | null = null;
  (window as unknown as { __pivotTracker: unknown }).__pivotTracker = { snapshot: () => ({ running, modelState, source: source(), calibrated: calibration.ready, frame: structuredClone(lastFrame), points: sample?.image || null, reason }) };
  function tick(now: number) {
    if (disposed) return;
    if (now - lastProcess >= 45) {
      const dt = Math.min(0.1, (now - lastProcess) / 1000); lastProcess = now;
      const sim = source() === 'simulation'; if (!sim) processCamera(now, dt);
      const valid = sim || (running && !!sample && calibration.ready && now - lastSeen < 180);
      const contact = sim ? $<HTMLInputElement>('send-contact').checked : valid && $<HTMLInputElement>('contact-armed').checked && calibration.nearContact(sample!, Number($<HTMLInputElement>('contact-radius').value));
      if (sim) pose = simulationPose();
      lastFrame = { type: 'pose', version: 2, seq: seq++, source: source(), pose: { ...pose }, valid, calibrated: sim || calibration.ready, contact,
        axes: calibration.mode, rotation: Number($<HTMLSelectElement>('phone-rotation').value), confidence: valid ? 1 : 0, sentAt: Date.now() };
      socket.send(lastFrame);
      setText($('tracking-state'), sim ? 'シミュレーション（実指ではない）' : pick !== null ? `映像上の ${names[pick]} の目印をクリック` : reason);
      $('tracking-state').dataset.ok = String(!sim && !!sample);
      $('contact-state').textContent = contact ? 'あり' : $<HTMLInputElement>('contact-armed').checked ? 'なし' : '無効';
      const steps = calibrationSteps();
      renderPipeline($('pipeline'), [
        ['カメラ', sim ? '使用しない' : running ? '取得中' : starting ? '起動中' : '停止', sim ? 'skip' : running ? 'ok' : starting ? 'wait' : 'off'],
        ['手指検出', sim ? '—' : sample ? '4点検出' : running ? '未検出' : '—', sim ? 'skip' : sample ? 'ok' : running ? 'wait' : 'off'],
        ['校正', sim ? '—' : calibration.ready ? '完了' : `${steps.done}/${steps.total}`, sim ? 'skip' : calibration.ready ? 'ok' : running ? 'wait' : 'off'],
        ['送信', !socket.connected ? '中継なし' : valid ? '送信中' : '無効値', !socket.connected ? 'off' : valid ? 'ok' : 'wait'],
        ['表示端末', viewers === null ? '—' : viewers + '台', viewers ? 'ok' : 'off'],
      ]);
      for (const [id, value, range] of [['read-x', pose.tiltX, 30], ['read-y', pose.tiltY, 30], ['read-dip', pose.dip, 75]] as const) {
        const deg = degrees(value), share = Math.min(1, Math.abs(deg) / range) * 50;
        setText($(id), valid ? deg.toFixed(1) + '°' : '—');
        const bar = $(id + '-bar'); bar.style.left = (deg < 0 ? 50 - share : 50) + '%'; bar.style.width = (valid ? share : 0) + '%';
      }
      // One "next action" for the whole screen, plus per-step state.
      const cameraDone = sim || running, calibrated = sim || calibration.ready, phoneDone = !!viewers;
      const current = !cameraDone ? 1 : !calibrated ? 2 : !phoneDone ? 3 : 4;
      [['step-camera', 1], ['calibration-panel', 2], ['step-phone', 3]].forEach(([id, n]) => setData($(id as string), 'state', (n as number) < current ? 'done' : n === current ? 'current' : 'todo'));
      const next = nextRecord(), nextPose = poses.find(p => p.kind === next);
      const [tone, num, title, detail] =
        socket.duplicate ? ['err', '!', 'このroomでは別の計測画面が動いています', `他のタブ・PCの計測画面を閉じて再読み込みするか、URLの ?room= を別の名前にします（現在 ${roomName()}）`] :
        !socket.connected ? ['err', '!', '中継サーバーに接続できません', 'PCで npm run dev が動いているか確認してください。自動で再接続します'] :
        sim ? (phoneDone ? ['ok', '✓', 'シミュレーション値を送信中', 'スライダーで角度を動かすと、iPhoneの指が動きます（実指ではありません）'] : ['info', '3', 'iPhoneで表示を開く', '右の ③ のQRコードを読み取ります']) :
        starting ? ['info', '1', 'カメラを起動しています', modelState === 'loading' ? '手指検出モデルを読み込み中…' : 'ブラウザーのカメラ許可を確認してください'] :
        !running ? ['info', '1', '計測方式を選んで「カメラを開始」', 'まずは「自動検出」で試し、指が隠れる場合は4色マーカーにします'] :
        !sample ? ['warn', '1', '人差し指をカメラに映してください', source() === 'markers' ? '4つの色の目印がすべて映るようにし、必要なら各色を採取し直します' : '付け根（MCP）から指先までが横から見える位置に置きます'] :
        !calibration.ready ? ['info', '2', recording ? 'そのまま静止してください…' : `校正：「${nextPose?.title ?? ''}」で止めて記録`, recording ? '約0.5秒動かさずに保つと記録されます' : `${nextPose?.detail ?? ''}。止めたら Space キーか右のボタン`] :
        !phoneDone ? ['info', '3', 'iPhoneで表示を開く', '右の ③ のQRコードを読み取ります。同じWi-Fiが必要です'] :
        ['ok', '✓', '準備完了 — iPhoneの ○ に第2関節を当てる', `表示端末 ${viewers}台に送信中。指先を曲げると球が押されます`];
      setData($('next-banner'), 'tone', tone); setText($('next-num'), num); setText($('next-title'), title); setText($('next-detail'), detail);
    }
    requestAnimationFrame(tick);
  }
  window.addEventListener('pagehide', () => { disposed = true; socket.close(); void stopCamera(); detector?.close(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { sample = null; $<HTMLInputElement>('contact-armed').checked = false; } });
  updateUi(); requestAnimationFrame(tick);
}
