import { BendCalibration, hexToRgb, MarkerTracker, type Detection } from './marker-tracking';
import { InputSocket } from './socket';
import type { ControlFrame } from './types';
import { $, header, networkLinks, roomName, toast } from './ui';

export function startTracker() {
  $('app').innerHTML = `${header(true)}<main class="shell"><div class="intro"><div><p class="eyebrow">PC CAMERA / ONE-AXIS FINGER INPUT</p><h1>指の曲げ戻しを、つなぐ。</h1><p>3色の目印を横から追い、映像上の曲げ量だけをスマホへ送ります。映像はこのPC内で処理します。</p></div><span class="research-badge">TRACKER / ROOM ${roomName()}</span></div>
    <div class="tracker-layout"><div><section class="stage-card"><div class="stage-bar"><strong>PC カメラ</strong><span class="stage-mode" id="camera-resolution">CAMERA OFF</span></div>
      <div class="camera-stage" id="camera-stage"><video id="camera-video" autoplay playsinline muted></video><canvas id="camera-canvas" width="640" height="480" aria-label="カメラ映像と3色の検出点"></canvas><div class="camera-placeholder" id="camera-placeholder"><strong>指を、横から見える位置へ。</strong>端末の横から少し背面側にPCカメラを置きます。<br/>曲げても3つの目印が隠れない配置にしてください。</div></div>
      <div class="camera-footer"><span id="detection-status">カメラは停止中です</span><span class="muted" id="sequence-label">SEQ —</span></div></section>
      <div id="camera-error" class="camera-error" role="alert" hidden></div>
      <section class="panel" style="margin-top:18px"><div class="panel-head"><h2>背面の持ち方と、カメラの位置</h2><span class="panel-number">SETUP</span></div><div class="camera-instructions"><ol><li>右手で端末を縦持ちし、DIP（爪側の第一関節）とPIP（第二関節）の間の指の背を、充電口側に向けて端末の背に沿わせます。</li><li>横から見える位置に、PIP側の中節・DIPの横・爪側の末節の順で3色の小さな目印を貼ります。端末に当たる場所と関節の折れ目を避けます。</li><li>PCカメラを側面より少し背面側へ。指が端末の真裏に隠れず、3点の間隔が映像上で10px以上になる距離にします。</li><li>画面の各色を選び、映像内の対応する目印をクリックします。検出点と線を確認して、伸ばした姿勢と曲げた姿勢を記録します。</li></ol></div></section>
      <p class="annotation">これは単眼映像の相対的な一軸入力です。絶対的な3D関節角度の測定ではありません。手首だけを動かしたときの安定性は、実機で確認してください。</p>
    </div><aside class="sidebar"><section class="panel"><div class="panel-head"><h2>入力を用意する</h2><span class="panel-number">01 / SOURCE</span></div>
      <div class="segmented" id="source-buttons"><button data-source="camera" aria-pressed="true">実カメラ</button><button data-source="simulation" aria-pressed="false">入力シミュレーション</button></div>
      <div id="camera-controls"><div class="field"><label for="camera-device" class="field-label">使用するカメラ</label><select id="camera-device" class="full-width"><option value="">既定のカメラ</option></select></div><div class="display-options"><button class="primary" id="start-camera">カメラを起動</button><button id="stop-camera" disabled>停止</button></div><p class="field-note">PCの localhost で開いてカメラを許可します。スマホでの許可は不要です。</p></div>
      <div id="simulation-controls" hidden><div class="sim-big-label" style="margin-top:16px">入力シミュレーション</div><p class="field-note">カメラを使用せず、実入力と同じサーバー経由で送ります。スマホ画面と記録にも区別を表示します。</p><div class="range-row"><label for="simulation-value">伸ばす ← 曲げ量 → 曲げる</label><input id="simulation-value" type="range" min="0" max="1" step="0.01" value="0" /></div><button id="run-sequence" class="full-width small">伸ばす → 持ち上げる → 放す</button><p class="field-note">スライダーの ↑ / ↓ キーでも調整できます。</p></div>
    </section>
    <section class="panel" id="marker-panel"><div class="panel-head"><h2>3色の検出点を合わせる</h2><span class="panel-number">02 / MARKERS</span></div><p class="field-note" id="pick-status">色の右のボタンを選び、映像の目印をクリック</p>
      ${['PIP側の中節', 'DIPの横', '爪側の末節'].map((label, i) => `<div class="marker-row"><span class="marker-index">${i + 1}</span><input type="color" id="marker-color-${i}" value="${['#e965ad', '#29c4d8', '#f2c94c'][i]}" aria-label="${label}の色"/><button data-pick="${i}" aria-pressed="false">${label}を選ぶ</button><span id="marker-check-${i}" class="marker-check">—</span></div>`).join('')}
      <div class="range-row"><label for="color-tolerance">色相の許容幅 <output id="tolerance-output">20°</output></label><input type="range" id="color-tolerance" min="8" max="28" value="20" /></div><button id="reset-tracking" class="text-button small-text">検出点と姿勢の記録をリセット</button><p class="field-note">面積と前フレームからの連続性で選別します。大きく位置を変えたら、目印を選び直します。</p>
    </section>
    <section class="panel" id="calibration-panel"><div class="panel-head"><h2>使う人に合わせる</h2><span class="panel-number">03 / CALIBRATE</span></div><p id="calibration-status" class="field-note">伸ばした姿勢、次に楽に曲げた姿勢を記録します</p><div class="calibration-buttons"><button id="record-neutral">1. 伸ばした姿勢を記録</button><button id="record-bent" disabled>2. 楽に曲げた姿勢を記録</button></div><div class="signal-bar"><span id="calibration-progress"></span></div><p id="calibration-values" class="field-note">各姿勢を約1秒、止めて測ります</p></section>
    <section class="panel"><div class="panel-head"><h2>スマホへ送っている操作量</h2><span class="panel-number">LIVE</span></div><div class="readout"><strong id="live-value">0.00</strong><span>0 → 1</span></div><div class="signal-bar"><span id="live-fill"></span></div><div id="tracking-state" class="status-strip"><span id="live-status">入力を待っています</span></div><p class="field-note" id="source-label">入力元：実カメラ</p><p class="field-note">追跡が長く途切れると商品を放します。復帰後は、いったん伸ばしてから再開します。</p></section>
    <section class="panel"><div class="panel-head"><h2>スマホで開く</h2><span class="panel-number">SAME WI-FI</span></div><div id="phone-links" class="network-list"></div><p class="field-note">商品画面で「背面から手前」を選択。ルーム：${roomName()}</p><a class="small-text" href="/?room=${roomName()}">このPCで商品画面を開く ↗</a></section></aside></div>
    <footer class="footer"><p>FINGERTIP / LOCAL CAMERA TRACKER</p><p>送信データ：曲げ量・取得状態・連番・入力元。カメラ映像は送信しません。</p></footer></main>`;

  const video = $<HTMLVideoElement>('camera-video');
  const canvas = $<HTMLCanvasElement>('camera-canvas');
  const visible = canvas.getContext('2d')!;
  const processCanvas = document.createElement('canvas');
  processCanvas.width = 320; processCanvas.height = 240;
  const processContext = processCanvas.getContext('2d', { willReadFrequently: true })!;
  const detector = new MarkerTracker();
  const calibration = new BendCalibration();
  const socket = new InputSocket('tracker', roomName());
  let source: 'camera' | 'simulation' = 'camera';
  let stream: MediaStream | null = null;
  let starting = false;
  let pick = -1;
  let seq = 0;
  let latest: Detection = { valid: false, angle: 0, confidence: 0, points: [null, null, null], reason: 'カメラは停止中です' };
  let value = 0;
  let previousCameraFrameAt = performance.now();
  let previousVideoTime = -1;
  let lastVideoAdvance = -Infinity;
  let sequenceAt: number | null = null;
  let alive = true;
  let receivedVideoFrames = 0;
  const colors = () => [0, 1, 2].map(i => $<HTMLInputElement>('marker-color-' + i).value);

  socket.onStatus = (connected, message) => { $('connection').textContent = connected ? `ルーム ${roomName()}` : message; $('connection').classList.toggle('connected', connected); };
  networkLinks($('phone-links'));

  function reset() {
    detector.reset(); calibration.reset(); value = 0;
    calibration.message = '伸ばした姿勢、次に楽に曲げた姿勢を記録します';
  }
  function stopCamera() {
    stream?.getTracks().forEach(track => track.stop());
    stream = null; video.srcObject = null; lastVideoAdvance = -Infinity; previousVideoTime = -1;
    latest = { ...latest, valid: false, points: [null, null, null], reason: 'カメラは停止中です' };
    $('camera-placeholder').hidden = false;
    $('camera-resolution').textContent = 'CAMERA OFF';
    $<HTMLButtonElement>('start-camera').disabled = false; $<HTMLButtonElement>('stop-camera').disabled = true;
    visible.clearRect(0, 0, canvas.width, canvas.height);
  }
  async function listCameras() {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const select = $<HTMLSelectElement>('camera-device');
      const selected = select.value;
      select.replaceChildren(new Option('既定のカメラ', ''));
      for (const [index, device] of devices.filter(d => d.kind === 'videoinput').entries()) select.add(new Option(device.label || `カメラ ${index + 1}`, device.deviceId));
      select.value = selected;
    } catch { /* Camera start reports actionable errors. */ }
  }
  async function startCamera() {
    if (starting) return;
    $('camera-error').hidden = true;
    if (!navigator.mediaDevices?.getUserMedia) {
      $('camera-error').textContent = 'カメラはPCの http://localhost:5173/tracker で起動してください。LANのHTTPアドレスではカメラ権限を使えません。';
      $('camera-error').hidden = false; return;
    }
    stopCamera(); reset(); starting = true;
    $<HTMLButtonElement>('start-camera').disabled = true;
    try {
      const device = $<HTMLSelectElement>('camera-device').value;
      const next = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 960 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 }, ...(device ? { deviceId: { exact: device } } : {}) }, audio: false });
      if (source !== 'camera' || !alive) { next.getTracks().forEach(t => t.stop()); return; }
      stream = next; video.srcObject = stream;
      await video.play();
      processCanvas.height = Math.round(320 * video.videoHeight / video.videoWidth);
      canvas.width = 640; canvas.height = Math.round(640 * video.videoHeight / video.videoWidth);
      $('camera-stage').style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
      $('camera-placeholder').hidden = true;
      $('camera-resolution').textContent = `${video.videoWidth} × ${video.videoHeight} / LOCAL`;
      $<HTMLButtonElement>('stop-camera').disabled = false;
      for (const track of stream.getVideoTracks()) track.onended = () => { stopCamera(); toast('カメラ入力が終了しました'); };
      listCameras();
    } catch (error) {
      const name = error instanceof DOMException ? error.name : '';
      const message = name === 'NotAllowedError' ? 'カメラが許可されていません。ブラウザーのアドレスバーからカメラを許可し、再度起動してください。' : name === 'NotFoundError' ? 'PCにカメラが見つかりません。Webカメラを接続するか、入力シミュレーションで経路を確認してください。' : `カメラを起動できませんでした：${error instanceof Error ? error.message : String(error)}`;
      stopCamera(); $('camera-error').textContent = message; $('camera-error').hidden = false;
    } finally { starting = false; $<HTMLButtonElement>('start-camera').disabled = !!stream; }
  }
  $('start-camera').addEventListener('click', startCamera);
  $('stop-camera').addEventListener('click', stopCamera);
  $('source-buttons').addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-source]');
    if (!button) return;
    source = button.dataset.source as typeof source;
    stopCamera(); reset(); sequenceAt = null;
    $<HTMLInputElement>('simulation-value').value = '0';
    document.querySelectorAll<HTMLButtonElement>('[data-source]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.source === source)));
    $('camera-controls').hidden = source !== 'camera'; $('simulation-controls').hidden = source !== 'simulation';
    $('marker-panel').hidden = $('calibration-panel').hidden = source !== 'camera';
    $('source-label').textContent = '入力元：' + (source === 'camera' ? '実カメラ' : '入力シミュレーション');
    $('camera-placeholder').innerHTML = source === 'simulation' ? '<strong>入力シミュレーション</strong>映像は使用していません。<br/>スライダーの操作をサーバー経由で送信しています。' : '<strong>指を、横から見える位置へ。</strong>端末の横から少し背面側にPCカメラを置きます。<br/>曲げても3つの目印が隠れない配置にしてください。';
  });
  $('simulation-value').addEventListener('input', () => { sequenceAt = null; });
  $('simulation-value').addEventListener('keydown', event => {
    const e = event as KeyboardEvent;
    if (!['ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault(); sequenceAt = null;
    const input = $<HTMLInputElement>('simulation-value');
    input.value = String(Math.max(0, Math.min(1, Number(input.value) + (e.key === 'ArrowUp' ? 0.05 : -0.05))));
  });
  $('run-sequence').addEventListener('click', () => { sequenceAt = performance.now(); });
  $('marker-panel').addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-pick]');
    if (!button) return;
    pick = Number(button.dataset.pick);
    document.querySelectorAll<HTMLButtonElement>('[data-pick]').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.pick) === pick)));
    $('pick-status').textContent = `${pick + 1}番の目印を、映像の中でクリックしてください`;
  });
  canvas.addEventListener('click', event => {
    if (pick < 0 || !stream || video.readyState < 2) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(2, Math.min(processCanvas.width - 3, Math.round((event.clientX - rect.left) / rect.width * processCanvas.width)));
    const y = Math.max(2, Math.min(processCanvas.height - 3, Math.round((event.clientY - rect.top) / rect.height * processCanvas.height)));
    const pixels = processContext.getImageData(x - 2, y - 2, 5, 5).data;
    const channel = (c: number) => {
      const values = Array.from({ length: 25 }, (_, i) => pixels[i * 4 + c]).sort((a, b) => a - b);
      return values[12].toString(16).padStart(2, '0');
    };
    $<HTMLInputElement>('marker-color-' + pick).value = '#' + channel(0) + channel(1) + channel(2);
    detector.seed(pick, x, y); calibration.reset();
    $('pick-status').textContent = `${pick + 1}番の色と位置を選びました。検出点を確認してください`;
    pick = -1;
    document.querySelectorAll('[data-pick]').forEach(b => b.setAttribute('aria-pressed', 'false'));
  });
  for (let i = 0; i < 3; i++) $('marker-color-' + i).addEventListener('input', () => { detector.previous[i] = null; calibration.reset(); });
  $('color-tolerance').addEventListener('input', () => { detector.tolerance = Number($<HTMLInputElement>('color-tolerance').value); $('tolerance-output').textContent = detector.tolerance + '°'; calibration.reset(); });
  $('reset-tracking').addEventListener('click', () => { reset(); toast('検出点と姿勢の記録をリセットしました'); });
  $('record-neutral').addEventListener('click', () => calibration.start('neutral', performance.now()));
  $('record-bent').addEventListener('click', () => calibration.start('bent', performance.now()));
  listCameras();

  function drawOverlay() {
    visible.drawImage(video, 0, 0, canvas.width, canvas.height);
    const scale = canvas.width / processCanvas.width;
    visible.lineWidth = 2;
    const points = latest.points;
    if (points.every(p => p)) {
      visible.strokeStyle = latest.valid ? '#f8fbeb' : '#edbe64';
      visible.beginPath(); visible.moveTo(points[0]!.x * scale, points[0]!.y * scale);
      visible.lineTo(points[1]!.x * scale, points[1]!.y * scale); visible.lineTo(points[2]!.x * scale, points[2]!.y * scale); visible.stroke();
    }
    points.forEach((point, i) => {
      if (!point) return;
      visible.strokeStyle = '#ffffff'; visible.fillStyle = colors()[i];
      visible.beginPath(); visible.arc(point.x * scale, point.y * scale, 9, 0, Math.PI * 2); visible.fill(); visible.stroke();
      visible.fillStyle = '#ffffff'; visible.font = 'bold 15px sans-serif';
      visible.fillText(String(i + 1), point.x * scale + 13, point.y * scale - 10);
    });
  }
  function tick() {
    if (!alive) return;
    const now = performance.now();
    let valid = false;
    if (source === 'simulation') {
      if (sequenceAt !== null) {
        const t = (now - sequenceAt) / 1000;
        $<HTMLInputElement>('simulation-value').value = String(t < 0.9 ? 0 : t < 2.7 ? (t - 0.9) / 1.8 : t < 3.7 ? 1 : Math.max(0, 1 - (t - 3.7) / 1.5));
        if (t > 5.7) sequenceAt = null;
      }
      value = Number($<HTMLInputElement>('simulation-value').value); valid = true;
    } else if (stream && video.readyState >= 2) {
      if (video.currentTime !== previousVideoTime) {
        const frameDt = (now - previousCameraFrameAt) / 1000; previousCameraFrameAt = now;
        previousVideoTime = video.currentTime; lastVideoAdvance = now; receivedVideoFrames++;
        processContext.drawImage(video, 0, 0, processCanvas.width, processCanvas.height);
        latest = detector.detect(processContext.getImageData(0, 0, processCanvas.width, processCanvas.height).data, processCanvas.width, processCanvas.height, colors());
        value = calibration.feed(latest.valid ? latest.angle : null, now, frameDt);
        drawOverlay();
      }
      valid = latest.valid && calibration.ready && !calibration.capturing && now - lastVideoAdvance < 250;
    }
    const packet: ControlFrame = { type: 'control', version: 1, seq: seq++, source, value,
      valid, calibrated: source === 'simulation' || calibration.ready,
      confidence: source === 'simulation' ? 1 : valid ? latest.confidence : 0,
      sentAt: Date.now(), ...(source === 'camera' && latest.valid ? { angle: latest.angle } : {}) };
    socket.send(packet);
    $('live-value').textContent = value.toFixed(2); $('live-fill').style.width = value * 100 + '%';
    $('sequence-label').textContent = `SEQ ${seq}`;
    $('live-status').textContent = source === 'simulation' ? '入力シミュレーションを送信中' : valid ? '有効な操作量を送信中' : !stream ? 'カメラ入力を待っています' : !latest.valid ? '追跡無効 · 目印を確認' : '姿勢の記録を完了してください';
    $('tracking-state').dataset.state = valid ? 'ready' : 'lost';
    $('detection-status').textContent = source === 'simulation' ? '入力シミュレーション · 映像なし' : latest.reason;
    $('calibration-status').textContent = calibration.message;
    $('calibration-progress').style.width = (calibration.capturing ? calibration.progress : calibration.ready ? 1 : 0) * 100 + '%';
    $('calibration-values').textContent = calibration.ready ? '伸ばす = 0 / 楽に曲げる = 1 · 平滑化あり' : '各姿勢を約1秒、止めて測ります';
    $<HTMLButtonElement>('record-neutral').disabled = !stream || !latest.valid || !!calibration.capturing;
    $<HTMLButtonElement>('record-bent').disabled = !stream || !latest.valid || calibration.neutral === null || !!calibration.capturing;
    latest.points.forEach((point, i) => { $('marker-check-' + i).textContent = point ? '検出' : '—'; $('marker-check-' + i).classList.toggle('ok', !!point); });
    if (import.meta.env.DEV) (window as unknown as { __tracker: unknown }).__tracker = { source, valid, value, seq, cameraActive: !!stream, receivedVideoFrames, calibrated: calibration.ready };
  }
  const timer = setInterval(tick, 33);
  document.addEventListener('visibilitychange', () => {
    // A hidden tracker must not silently send frozen camera data as valid.
    if (document.hidden && source === 'camera') { lastVideoAdvance = -Infinity; latest.valid = false; }
  });
  window.addEventListener('pagehide', () => { alive = false; clearInterval(timer); stopCamera(); socket.close(); });
  window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
}
