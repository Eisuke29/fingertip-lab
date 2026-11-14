import { HandCalibration, measureHand, type HandSample } from './calibration';
import { MarkerTracker, type ImagePoint } from './marker-tracking';
import { degrees, radians, v } from './math';
import { PoseSocket } from './socket';
import { neutralPose, type Pose, type PoseFrame } from './types';
import { $, href, renderPipeline, roomName, slider } from './ui';
import type { HandLandmarker } from '@mediapipe/tasks-vision';

const names = ['MCP', 'PIP', 'DIP', 'TIP'];
const initialColors = ['#ff4055', '#4cd36a', '#4185f4', '#bc51d9'];
export function startTracker() {
  $('app').innerHTML = `<main class="tracker-shell"><header class="topbar"><h1>計測画面</h1><ol class="pipeline" id="pipeline"></ol><p class="meta"><span id="network-state">接続中</span> · <a href="${href('dev')}" target="_blank" rel="noopener">開発画面 ↗</a></p></header>
  <div class="tracker-grid">
    <div class="camera-box"><video id="camera-video" autoplay muted playsinline></video><canvas id="camera-preview" width="640" height="480"></canvas><div class="camera-empty" id="camera-empty">カメラ停止中</div><span class="camera-state" id="tracking-state">停止中</span></div>
    <aside class="side">
      <section><h2><span class="num">1</span>カメラ</h2>
        <select id="tracking-source" aria-label="計測方式"><option value="mediapipe">MediaPipe（手指推定）</option><option value="markers">4色マーカー</option><option value="simulation">シミュレーション（カメラなし）</option></select>
        <div class="button-row" id="camera-controls"><button class="primary" id="start-camera">開始</button><button id="stop-camera" disabled>停止</button></div>
        <div class="tracker-error" id="camera-error" hidden></div>
        <div id="sender-simulation" hidden>${slider('send-x', '手側 θx', -25, 25, 0)}${slider('send-y', '手側 θy', -25, 25, 0)}${slider('send-dip', 'DIP θd', -15, 75, 0)}<div class="control-row"><input type="checkbox" id="send-contact"/><label for="send-contact">接触あり</label></div></div></section>
      <section id="calibration-panel"><h2><span class="num">2</span>校正<span class="hint">各姿勢で静止して押す</span></h2>
        <div class="calibration-list"><button data-record="neutral">基準姿勢</button><button data-record="down">手側を下へ倒す</button><button data-record="left" id="record-left" hidden>手側を左へ倒す</button><button data-record="bent">DIPだけ曲げる</button></div>
        <p class="status-text" id="calibration-message"></p></section>
      <section><h2><span class="num">3</span>計測値</h2><div class="readouts"><div><span>手側 θx</span><strong id="read-x">—</strong></div><div><span>手側 θy</span><strong id="read-y">—</strong></div><div><span>DIP θd</span><strong id="read-dip">—</strong></div></div></section>
      <section><h2><span class="num">4</span>iPhoneで開く</h2><div id="network-links" class="network-links"></div></section>
      <details id="tracker-advanced"><summary>詳細設定</summary>
        <div class="field-grid"><label for="camera-device">カメラ</label><select id="camera-device"><option value="">既定</option></select>
          <label for="phone-rotation">端末の向き</label><select id="phone-rotation"><option value="0">縦 0°</option><option value="90">横 90°</option><option value="180">縦 180°</option><option value="270">横 270°</option></select>
          <label for="axis-mode">計測軸</label><select id="axis-mode"><option value="plane-y">面内1軸（上下）</option><option value="estimated-xy">2軸推定（上下・左右）</option></select></div>
        <div class="control-row"><input type="checkbox" id="mirror-preview" checked/><label for="mirror-preview">プレビューを左右反転</label></div>
        <div id="contact-panel"><div class="control-row"><input type="checkbox" id="contact-armed"/><label for="contact-armed">固定点で接触判定（裏側用）</label><span class="tag" id="contact-state">無効</span></div>${slider('contact-radius', '許容半径', 8, 40, 18, 1, ' px')}</div>
        <div id="markers-panel" hidden><p class="hint">色ボタン → 映像上の点をクリック</p>${names.map((name, i) => `<div class="marker-row"><span class="marker-dot" id="marker-state-${i}"></span><input type="color" id="marker-color-${i}" value="${initialColors[i]}" aria-label="${name}の色"/><button data-pick="${i}">${name}</button></div>`).join('')}<button class="full-width" id="reacquire">再検出</button></div>
        <button class="quiet" id="reset-calibration">校正をリセット</button></details>
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
  let reason = '停止中', modelState = 'idle';
  const source = () => $<HTMLSelectElement>('tracking-source').value as PoseFrame['source'];
  const simulationPose = (): Pose => ({ tiltX: radians(Number($<HTMLInputElement>('send-x').value)), tiltY: radians(Number($<HTMLInputElement>('send-y').value)), dip: radians(Number($<HTMLInputElement>('send-dip').value)) });
  const fail = (message: string) => { $('camera-error').textContent = message; $('camera-error').hidden = false; };
  socket.onStatus = text => $('network-state').textContent = text;
  const calibrationSteps = () => { const keys = calibration.mode === 'estimated-xy' ? ['neutral', 'down', 'left', 'bent'] as const : ['neutral', 'down', 'bent'] as const; return { done: keys.filter(k => !!calibration[k]).length, total: keys.length }; };
  let viewers: number | null = null;
  socket.onPeers = n => { viewers = n; };
  function resetCalibration() { calibration.reset(); sample = null; pose = neutralPose(); $<HTMLInputElement>('contact-armed').checked = false; lastPip = null; selectedHand = ''; updateUi(); }
  function updateUi() {
    const sim = source() === 'simulation', markerMode = source() === 'markers';
    $('sender-simulation').hidden = !sim; $('markers-panel').hidden = !markerMode; if (markerMode) $<HTMLDetailsElement>('tracker-advanced').open = true;
    $('calibration-panel').hidden = $('contact-panel').hidden = sim; $('camera-controls').hidden = sim;
    $<HTMLSelectElement>('axis-mode').disabled = markerMode;
    $('record-left').hidden = calibration.mode !== 'estimated-xy';
    $('calibration-message').textContent = calibration.message;
    
    document.querySelectorAll<HTMLButtonElement>('[data-record]').forEach(b => { b.setAttribute('aria-pressed', String(!!calibration[b.dataset.record as 'neutral' | 'down' | 'left' | 'bent'])); });
    $<HTMLButtonElement>('start-camera').disabled = starting || running;
    $<HTMLButtonElement>('stop-camera').disabled = !running;
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
      select.value = device; running = true; lastVideo = -1; resetCalibration();
      $('camera-empty').hidden = true;
    } catch (error) { modelState = detector ? 'ready' : 'error'; await stopCamera(); fail(`${error instanceof Error ? error.message : error}（計測方式を4色マーカーに変更して再試行可）`); }
    finally { starting = false; updateUi(); }
  }
  $('start-camera').addEventListener('click', startCamera);
  $('stop-camera').addEventListener('click', stopCamera);
  $('tracking-source').addEventListener('change', async () => {
    await stopCamera(); resetCalibration(); markers.reset(); if (source() === 'markers') { calibration.mode = 'plane-y'; $<HTMLSelectElement>('axis-mode').value = 'plane-y'; }
    updateUi();
  });
  $('axis-mode').addEventListener('change', () => { calibration.mode = $<HTMLSelectElement>('axis-mode').value as HandCalibration['mode']; resetCalibration(); });
  for (const id of ['phone-rotation', 'mirror-preview', 'camera-device']) $(id).addEventListener('change', () => { resetCalibration(); if (id === 'camera-device' && running) void stopCamera(); });
  $('reset-calibration').addEventListener('click', resetCalibration);
  document.querySelectorAll<HTMLButtonElement>('[data-record]').forEach(button => button.addEventListener('click', () => { calibration.record(button.dataset.record as 'neutral' | 'down' | 'left' | 'bent'); updateUi(); }));
  document.querySelectorAll<HTMLButtonElement>('[data-pick]').forEach(button => button.addEventListener('click', () => { pick = Number(button.dataset.pick); $('tracking-state').textContent = `映像上の${names[pick]}の目印をクリック`; }));
  preview.addEventListener('click', event => {
    if (pick === null || !lastPixels) return;
    const rect = preview.getBoundingClientRect(), mirror = $<HTMLInputElement>('mirror-preview').checked;
    const sx = (event.clientX - rect.left) / rect.width;
    const x = Math.max(0, Math.min(raw.width - 1, Math.round((mirror ? 1 - sx : sx) * raw.width)));
    const y = Math.max(0, Math.min(raw.height - 1, Math.round((event.clientY - rect.top) / rect.height * raw.height)));
    const p = (y * raw.width + x) * 4;
    $<HTMLInputElement>(`marker-color-${pick}`).value = '#' + [...lastPixels.data.slice(p, p + 3)].map(n => n.toString(16).padStart(2, '0')).join('');
    markers.seed(pick, x, y); pick = null; resetCalibration();
  });
  for (let i = 0; i < 4; i++) $(`marker-color-${i}`).addEventListener('change', () => { markers.reset(); resetCalibration(); });
  $('reacquire').addEventListener('click', () => { markers.reset(); resetCalibration(); });
  $('contact-radius').addEventListener('input', () => $('contact-radius-out').textContent = $<HTMLInputElement>('contact-radius').value + ' px');
  for (const id of ['send-x', 'send-y', 'send-dip']) $(id).addEventListener('input', () => $(id + '-out').textContent = $<HTMLInputElement>(id).value + '°');
  fetch('/api/network').then(r => r.json()).then(data => {
    for (const address of data.urls.length ? data.urls : [data.local]) { const url = new URL(address); url.searchParams.set('room', roomName()); const link = document.createElement('a'); link.href = url.href; link.target = '_blank'; link.rel = 'noopener'; link.textContent = url.href; $('network-links').append(link); }
  }).catch(() => { $('network-links').textContent = '起動ターミナルに表示されたLANアドレス'; });

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
      $('tracking-state').textContent = sim ? 'シミュレーション（実指ではない）' : reason;
      $('contact-state').textContent = contact ? 'あり' : $<HTMLInputElement>('contact-armed').checked ? 'なし' : '無効';
      const steps = calibrationSteps();
      renderPipeline($('pipeline'), [
        ['カメラ', sim ? '使用しない' : running ? '取得中' : starting ? '起動中' : '停止', sim ? 'skip' : running ? 'ok' : starting ? 'wait' : 'off'],
        ['手指検出', sim ? '—' : sample ? '4点検出' : running ? '未検出' : '—', sim ? 'skip' : sample ? 'ok' : running ? 'wait' : 'off'],
        ['校正', sim ? '—' : calibration.ready ? '完了' : `${steps.done}/${steps.total}`, sim ? 'skip' : calibration.ready ? 'ok' : running ? 'wait' : 'off'],
        ['送信', !socket.connected ? '中継なし' : valid ? '送信中' : '無効値', !socket.connected ? 'off' : valid ? 'ok' : 'wait'],
        ['表示端末', viewers === null ? '—' : viewers + '台', viewers ? 'ok' : 'off'],
      ]);
      for (const [id, value] of [['read-x', pose.tiltX], ['read-y', pose.tiltY], ['read-dip', pose.dip]] as const) $(id).textContent = valid ? degrees(value).toFixed(1) + '°' : '—';
    }
    requestAnimationFrame(tick);
  }
  window.addEventListener('pagehide', () => { disposed = true; socket.close(); void stopCamera(); detector?.close(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { sample = null; $<HTMLInputElement>('contact-armed').checked = false; } });
  updateUi(); requestAnimationFrame(tick);
}
