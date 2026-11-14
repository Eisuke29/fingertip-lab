import { HandCalibration, measureHand, type HandSample } from './calibration';
import { MarkerTracker, type ImagePoint } from './marker-tracking';
import { degrees, radians, v } from './math';
import { PoseSocket } from './socket';
import { neutralPose, type Pose, type PoseFrame } from './types';
import { $, href, roomName, slider } from './ui';
import type { HandLandmarker } from '@mediapipe/tasks-vision';

const names = ['MCP / 手の付け根', 'PIP / 第2関節・支点', 'DIP / 第1関節', '指先'];
const initialColors = ['#ff4055', '#4cd36a', '#4185f4', '#bc51d9'];
export function startTracker() {
  $('app').innerHTML = `<main class="tracker-shell"><header class="tracker-header"><div><div class="overline">PIVOT / HAND INPUT</div><h1>実指の、向きと曲げ。</h1><p>外部カメラで4点を計測し、姿勢だけを同じLANの端末へ送ります。</p></div><a href="${href('dev')}" target="_blank" rel="noopener">表示・位置合わせ ↗</a></header>
  <div class="tracker-grid"><div><div class="camera-box"><video id="camera-video" autoplay muted playsinline></video><canvas id="camera-preview" width="640" height="480"></canvas><div class="camera-empty" id="camera-empty"><strong>PCの外部カメラ</strong>PIP・DIP・指先・MCPが見える横視点から始めます</div></div>
    <div class="camera-footer"><span id="tracking-state">停止中</span><span id="network-state">中継へ接続中</span></div><div class="tracker-error" id="camera-error" hidden></div>
    <div class="tracker-panel"><h2>iPhoneで開くアドレス</h2><div id="network-links" class="network-links"></div><p>PCと同じWi-Fiで開きます。端末は固定し、カメラの位置と端末の向きを校正後に変えないでください。</p></div>
    <div class="tracker-note"><ol><li>スマホをスタンドで固定。人差し指を曲げ、PIP付近をガラスへ軽く当てます。カメラは指の外側に置きます。</li><li>4点が隠れる場合は4色の小さな目印へ切り替えます。背景に同じ色を置かず、カメラ映像内の点を選んで色を採取できます。</li><li>基準 → 手側を下 → 基準へ戻してDIPだけ曲げる、の順に記録します。2軸推定では左方向も記録します。</li><li>表側はスマホの印にPIPを当てます。裏側・タッチが反応しない場合は固定点の接触確認を使い、接触の許可を一度切ってから入れ直します。</li></ol><p>面内1軸は横視点の投影角です。斜め視点の2軸は単眼3D推定で、実際の指・iPhoneでの軸と遅延の確認はまだ行っていません。接触確認も画像上の近さであり、ガラスまでの距離の測定ではありません。</p></div></div>
  <aside><section class="tracker-panel"><h2>1. 入力と設置</h2><label for="tracking-source" class="small">計測方式</label><select id="tracking-source"><option value="mediapipe">MediaPipe / 人差し指</option><option value="markers">4色マーカー / 面内1軸</option><option value="simulation">通信の入力シミュレーション</option></select>
    <div id="camera-controls"><div class="button-row"><button class="primary" id="start-camera">カメラを開始</button><button id="stop-camera" disabled>停止</button></div><select id="camera-device" aria-label="カメラ"><option value="">既定のカメラ</option></select><div class="control-row"><input type="checkbox" id="mirror-preview" checked/><label for="mirror-preview">プレビューを鏡像にする</label></div><p>鏡像はプレビューだけに適用します。画面上の方向は次の動作校正で決めます。</p>
    <div id="markers-panel" hidden>${names.map((name, i) => `<div class="marker-row"><span class="marker-dot" id="marker-state-${i}"></span><input type="color" id="marker-color-${i}" value="${initialColors[i]}" aria-label="${name}の色"/><button data-pick="${i}">${name}の色を採る</button></div>`).join('')}<button class="full-width small" id="reacquire">4点を再検出</button></div></div>
    <div id="sender-simulation" hidden><p class="note-box warning">実指ではなく通信確認用の角度です。</p>${slider('send-x', '手側 左 ← → 右', -25, 25, 0)}${slider('send-y', '手側 下 ← → 上', -25, 25, 0)}${slider('send-dip', 'DIPの曲げ', -15, 75, 0)}<div class="control-row"><input type="checkbox" id="send-contact"/><label for="send-contact">固定点に接触</label></div></div>
    <label class="small" for="phone-rotation">校正する端末の画面向き</label><select id="phone-rotation"><option value="0">縦 / 0°</option><option value="90">横 / 90°</option><option value="180">縦 / 180°</option><option value="270">横 / 270°</option></select></section>
  <section class="tracker-panel" id="calibration-panel"><h2>2. 動作の校正</h2><select id="axis-mode" aria-label="計測軸"><option value="plane-y">面内1軸 / 上下を校正</option><option value="estimated-xy">単眼3D推定 / 上下・左右を校正</option></select><div class="calibration-list"><button data-record="neutral">① 接触姿勢を基準に記録</button><button data-record="down">② DIPを保って、手側を下へ</button><button data-record="left" id="record-left" hidden>③ 基準へ戻して、手側を左へ</button><button data-record="bent">③ 基準へ戻して、DIPだけ曲げる</button></div><p id="calibration-message"></p><div class="pose-readouts"><span>手側 X<strong id="read-x">—</strong></span><span>手側 Y<strong id="read-y">—</strong></span><span>DIP<strong id="read-dip">—</strong></span></div><p id="axis-status"></p><button class="full-width small" id="reset-calibration">校正をやり直す</button></section>
  <section class="tracker-panel" id="contact-panel"><h2>3. 裏側・固定点の接触確認</h2><div class="control-row"><input type="checkbox" id="contact-armed"/><label for="contact-armed">固定した接点で接触を許可</label></div>${slider('contact-radius', '基準PIPからの画像上の許容半径', 8, 40, 18, 1, ' px')}<p>校正済みのPIPが基準の近くにある間だけ送ります。端末やカメラを動かしたら校正をやり直します。表側のタッチ方式ではスマホ側の接触が優先されます。</p><div class="chip" id="contact-state">接触なし</div></section></aside></div></main>`;
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
  function resetCalibration() { calibration.reset(); sample = null; pose = neutralPose(); $<HTMLInputElement>('contact-armed').checked = false; lastPip = null; selectedHand = ''; updateUi(); }
  function updateUi() {
    const sim = source() === 'simulation', markerMode = source() === 'markers';
    $('camera-controls').hidden = sim; $('sender-simulation').hidden = !sim; $('markers-panel').hidden = !markerMode;
    $('calibration-panel').hidden = $('contact-panel').hidden = sim;
    $<HTMLSelectElement>('axis-mode').disabled = markerMode;
    $('record-left').hidden = calibration.mode !== 'estimated-xy';
    $('calibration-message').textContent = calibration.message;
    $('axis-status').textContent = calibration.ready ? (calibration.mode === 'plane-y' ? '面内1軸を校正済み / 左右は入力しません' : '単眼3Dの2軸を校正済み / 実指での各軸は未確認') : '未校正 / 姿勢は有効として送信しません';
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
        reason = 'MediaPipeモデルを準備中'; $('tracking-state').textContent = reason; modelState = 'loading';
        const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision');
        const vision = await FilesetResolver.forVisionTasks(`${import.meta.env.BASE_URL}vendor/mediapipe`);
        const options = { baseOptions: { modelAssetPath: `${import.meta.env.BASE_URL}models/hand_landmarker.task` }, runningMode: 'VIDEO' as const, numHands: 2, minHandDetectionConfidence: 0.6, minHandPresenceConfidence: 0.6, minTrackingConfidence: 0.6 };
        try { detector = await HandLandmarker.createFromOptions(vision, { ...options, baseOptions: { ...options.baseOptions, delegate: 'GPU' } }); }
        catch { detector = await HandLandmarker.createFromOptions(vision, { ...options, baseOptions: { ...options.baseOptions, delegate: 'CPU' } }); }
        modelState = 'ready';
      }
      if (disposed) { await stopCamera(); return; }
      const devices = await navigator.mediaDevices.enumerateDevices();
      const select = $<HTMLSelectElement>('camera-device'); select.replaceChildren(new Option('既定のカメラ', ''));
      devices.filter(d => d.kind === 'videoinput').forEach((d, i) => select.add(new Option(d.label || `カメラ ${i + 1}`, d.deviceId)));
      select.value = device; running = true; lastVideo = -1; resetCalibration();
      $('camera-empty').hidden = true;
    } catch (error) { modelState = detector ? 'ready' : 'error'; await stopCamera(); fail(`${error instanceof Error ? error.message : error} / 4色マーカーへの切り替えも利用できます。`); }
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
  document.querySelectorAll<HTMLButtonElement>('[data-pick]').forEach(button => button.addEventListener('click', () => { pick = Number(button.dataset.pick); $('tracking-state').textContent = `${names[pick]}の目印を映像上で選びます`; }));
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
  }).catch(() => { $('network-links').textContent = 'PCの起動ターミナルに表示されたLANアドレスを使います'; });

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
        reason = sample ? '人差し指の4点を追跡中' : '4点が見えるようカメラと指を合わせます';
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
      $('tracking-state').textContent = sim ? '入力シミュレーション / 実指の計測ではありません' : reason;
      $('contact-state').textContent = contact ? '固定点の近傍で接触を許可中' : '接触なし';
      for (const [id, value] of [['read-x', pose.tiltX], ['read-y', pose.tiltY], ['read-dip', pose.dip]] as const) $(id).textContent = valid ? degrees(value).toFixed(1) + '°' : '—';
    }
    requestAnimationFrame(tick);
  }
  window.addEventListener('pagehide', () => { disposed = true; socket.close(); void stopCamera(); detector?.close(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { sample = null; $<HTMLInputElement>('contact-armed').checked = false; } });
  updateUi(); requestAnimationFrame(tick);
}
