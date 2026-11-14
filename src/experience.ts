import { defaultFinger, FingerInteraction } from './kinematics';
import { MaterialResponse } from './material';
import { add, clamp, degrees, radians, v, type V3 } from './math';
import { PoseReceiver } from './pose-input';
import { PivotScene } from './scene';
import { PoseSocket } from './socket';
import { isStaticDemo } from './deployment';
import { neutralPose, type Ball, type FingerConfig, type Pose, type SceneKind, type Side } from './types';
import { presetLabel, resolvePxPerMm, scalePresets, type ScalePreset } from './screen-scale';
import { $, href, icon, isDeveloper, renderPipeline, renderReadouts, roomName, rotation, setData, setText, slider, toggle } from './ui';

/** All lengths are millimetres on the real screen; they are converted to CSS px with pxPerMm. */
type Setup = {
  side: Side; radius: number; middleLength: number; distalLength: number; yaw: number; pitch: number; dipRest: number;
  offsetX: number; offsetY: number; ballRadius: number; ballDepth: number; ballX: number; ballY: number;
  skin: string; rootGap: number; viewYaw: number; viewPitch: number; contactMode: 'touch' | 'camera';
  thickness: number; breakDistance: number; scalePreset: ScalePreset; customPxPerMm: number;
};
const STORAGE = 'pivot-finger.setup.v3';
const sceneNames: Record<SceneKind, string> = { press: '押す', release: '離す', stroke: 'なぞる' };
const sceneInfo: Record<SceneKind, string> = {
  press: '指先をゆっくり曲げて、球を押し込む',
  release: '押したあと指先を戻すと、糸が伸びて切れる',
  stroke: '触れたまま手を左右へ傾けて、表面をなぞる',
};
// Adult index finger: middle phalanx ~25 mm, distal ~22 mm, ~16 mm wide. The ball is sized so DIP flexion
// starts touching it near 40° and presses ~6 mm by 62°, as in the original tuning.
const defaults = (): Setup => ({ side: 'front', radius: 8, middleLength: 25, distalLength: 22, yaw: 11, pitch: 30, dipRest: -35,
  offsetX: 0, offsetY: 0, ballRadius: 18, ballDepth: 48, ballX: 0, ballY: 0, skin: '#d9aa91', rootGap: 0, viewYaw: 0, viewPitch: 0,
  contactMode: 'touch', thickness: 6.5, breakDistance: 7, scalePreset: 'auto', customPxPerMm: 132 / 25.4 });

export function startExperience() {
  const developer = isDeveloper();
  let setup = defaults();
  try { const saved = JSON.parse(localStorage.getItem(STORAGE) || 'null'); if (saved && typeof saved === 'object') setup = { ...setup, ...saved }; } catch {}
  const stageHtml = `<div class="view-container" id="stage">
    <header class="experience-header">
      <div class="status-pill" id="status-pill" data-tone="off"><span class="dot"></span><span id="status-text">接続中</span></div>
      <a class="adjust-link" href="${href(developer ? 'product' : 'dev')}">${developer ? icon('phone', 16) + 'iPad体験' : icon('gear', 16) + '調整・お試し'}</a>
    </header>
    <span class="simulation-badge" id="simulation-badge" hidden>実指の入力ではありません</span>
    <div class="pivot-guide" id="pivot-guide" aria-hidden="true"><span class="ring"></span><span class="core"></span><span class="guide-label" id="guide-label">第2関節をここに</span></div>
    ${developer ? '<div class="ruler" id="ruler" hidden></div><div class="card-check" id="card-check" hidden><span>カードをここに重ねる（85.6×54mm）</span></div>' : ''}
    <p class="input-note" id="input-note" data-tone="info"></p>
    <div class="dock">
      <p class="scene-hint"><span class="side-chip" id="side-label">表側</span><strong id="scene-label">押す</strong><span id="scene-desc">${sceneInfo.press}</span></p>
      <nav class="scene-nav" aria-label="場面">${(['press', 'release', 'stroke'] as const).map(k => `<button data-scene="${k}" aria-pressed="${k === 'press'}">${icon(k, 20)}<span>${sceneNames[k]}</span></button>`).join('')}</nav>
    </div></div>`;
  $('app').innerHTML = `<main class="experience-layout ${developer ? 'dev-layout' : ''}">${developer ? '<div class="dev-stage-wrap"><div class="device">' : ''}${stageHtml}${developer ? '</div></div>' + developerPanel(setup) : ''}</main>`;
  const scene = new PivotScene($('stage'));
  const receiver = new PoseReceiver();
  const socket = new PoseSocket('viewer', roomName());
  const engine = new FingerInteraction();
  const material = new MaterialResponse();
  let kind: SceneKind = 'press';
  let pivot = v(), guide = v(), ball: Ball = { center: v(), radius: 70 };
  let pointerId: number | null = null;
  let touch = false, touchNeedsFresh = false, rearAligned = false;
  let cameraContactBefore = false, cameraOffSeen = true;
  let simulation = false, simulationContact = true, simPose = neutralPose();
  let playbackAt: number | null = null;
  let previousTime = performance.now(), lastUi = 0, disposed = false;
  let previousStatus = '', connectedText = '';
  let diagnostics: Record<string, unknown> = {};

  const ppm = () => resolvePxPerMm(setup.scalePreset, setup.customPxPerMm);
  const px = (mm: number) => mm * ppm();
  const config = (): FingerConfig => ({ ...defaultFinger(), side: setup.side, middleLength: px(setup.middleLength),
    distalLength: px(setup.distalLength), radius: px(setup.radius), thickness: px(setup.thickness),
    yaw: radians(setup.yaw), pitch: radians(setup.pitch), dipRest: radians(setup.dipRest) });
  function positionGuide() {
    const point = scene.project(guide), el = $('pivot-guide'), size = Math.max(36, px(setup.radius) * 2);
    el.style.left = point.x + 'px'; el.style.top = point.y + 'px'; el.style.width = el.style.height = size + 'px';
  }
  function drawOverlays() {
    if (!developer) return;
    const unit = ppm(), height = scene.height;
    const ticks: string[] = [];
    for (let mm = 0; mm * unit < height; mm++) {
      const y = (mm * unit).toFixed(1), long = mm % 10 === 0, mid = mm % 5 === 0;
      ticks.push(`<line x1="0" x2="${long ? 22 : mid ? 15 : 9}" y1="${y}" y2="${y}"/>`);
      if (long && mm) ticks.push(`<text x="26" y="${(mm * unit + 4).toFixed(1)}">${mm / 10}cm</text>`);
    }
    $('ruler').innerHTML = `<svg width="70" height="${height}" aria-hidden="true">${ticks.join('')}</svg>`;
    const card = $('card-check'); card.style.width = 85.6 * unit + 'px'; card.style.height = 53.98 * unit + 'px';
    setText($('scale-resolved'), `${presetLabel(setup.scalePreset) || '手動'} · 1mm = ${unit.toFixed(2)}px`);
  }
  function endTouch() {
    const id = pointerId; pointerId = null; touch = false; touchNeedsFresh = false;
    receiver.invalidate();
    if (id !== null && scene.canvas.hasPointerCapture(id)) scene.canvas.releasePointerCapture(id);
  }
  function alignScene() {
    endTouch(); rearAligned = false; cameraOffSeen = false; receiver.invalidate();
    scene.setView(radians(setup.viewYaw), radians(setup.viewPitch));
    guide = scene.glassPoint(scene.width * 0.5, scene.height * 0.56);
    pivot = add(guide, v(px(setup.offsetX), -px(setup.offsetY)));
    ball = { center: add(guide, v(px(setup.ballX), px(setup.ballY), setup.side === 'front' ? -px(setup.ballDepth) : px(setup.ballDepth - setup.thickness))), radius: px(setup.ballRadius) };
    material.breakDistance = px(setup.breakDistance); scene.strandRadius = px(0.3);
    engine.reset(); material.reset(); positionGuide(); drawOverlays();
    $('side-label').textContent = setup.side === 'front' ? '表側' : '裏側';
    $('guide-label').textContent = setup.side === 'front' ? '第2関節をここに' : '背面の印に第2関節';
  }
  function suspend() { endTouch(); receiver.invalidate(); rearAligned = false; cameraOffSeen = false; simulationContact = false; if (developer) $<HTMLInputElement>('sim-contact').checked = false; }
  function resetAfterLoss() { receiver.invalidate(); if (touch) touchNeedsFresh = true; rearAligned = false; cameraOffSeen = false; }
  socket.onStatus = text => { connectedText = text; if (developer) $('connection').textContent = text; };
  socket.onPose = frame => { receiver.ingest(frame, performance.now()); if (receiver.streamChanged) resetAfterLoss(); };

  scene.canvas.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0 || pointerId !== null || setup.side !== 'front' || setup.contactMode !== 'touch') return;
    event.preventDefault(); pointerId = event.pointerId; touch = true;
    pivot = add(scene.clientPoint(event.clientX, event.clientY), v(px(setup.offsetX), -px(setup.offsetY)));
    touchNeedsFresh = !simulation && !receiver.align();
    scene.canvas.setPointerCapture(event.pointerId);
  });
  // Contact coordinates are intentionally NOT used as angle or motion input.
  scene.canvas.addEventListener('pointermove', event => { if (event.pointerId === pointerId) event.preventDefault(); });
  scene.canvas.addEventListener('pointerup', event => { if (event.pointerId === pointerId) endTouch(); });
  scene.canvas.addEventListener('pointercancel', event => { if (event.pointerId === pointerId) endTouch(); });
  scene.canvas.addEventListener('lostpointercapture', event => { if (event.pointerId === pointerId) endTouch(); });
  scene.canvas.addEventListener('contextmenu', event => event.preventDefault());
  document.querySelectorAll<HTMLButtonElement>('[data-scene]').forEach(button => button.addEventListener('click', () => {
    kind = button.dataset.scene as SceneKind; material.reset(); $('scene-label').textContent = sceneNames[kind]; $('scene-desc').textContent = sceneInfo[kind];
    document.querySelectorAll('[data-scene]').forEach(b => b.setAttribute('aria-pressed', String((b as HTMLElement).dataset.scene === kind)));
    if (developer) updateSceneControls();
  }));
  scene.onResize = () => alignScene();
  window.addEventListener('orientationchange', () => { resetAfterLoss(); alignScene(); });
  window.addEventListener('blur', () => { if (!simulation) suspend(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) suspend(); });
  window.addEventListener('pagehide', () => { disposed = true; socket.close(); scene.dispose(); });
  window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });

  function saveSetup() { try { localStorage.setItem(STORAGE, JSON.stringify(setup)); } catch {} }
  function updateSceneControls() {
    if (!developer) return;
    $('release-controls').hidden = kind !== 'release'; $('stroke-controls').hidden = kind !== 'stroke';
  }
  if (developer) {
    $('tracker-link').setAttribute('href', href('tracker'));
    $<HTMLSelectElement>('side').value = setup.side;
    $('side').addEventListener('change', () => { setup.side = $<HTMLSelectElement>('side').value as Side; alignScene(); saveSetup(); });
    $<HTMLSelectElement>('contact-mode').value = setup.contactMode;
    $('contact-mode').addEventListener('change', () => { setup.contactMode = $<HTMLSelectElement>('contact-mode').value as Setup['contactMode']; alignScene(); saveSetup(); });
    $('use-simulation').addEventListener('change', () => {
      simulation = $<HTMLInputElement>('use-simulation').checked; playbackAt = null; simPose = neutralPose();
      receiver.invalidate(); endTouch(); simulationContact = true; $<HTMLInputElement>('sim-contact').checked = true;
      alignScene(); updateSimulationUi();
    });
    $('sim-contact').addEventListener('change', () => { simulationContact = $<HTMLInputElement>('sim-contact').checked; });
    for (const [id, key] of [['hand-x', 'tiltX'], ['hand-y', 'tiltY'], ['dip', 'dip']] as const) $(id).addEventListener('input', () => {
      playbackAt = null; simPose[key] = radians(Number($<HTMLInputElement>(id).value)); updateSimulationUi();
    });
    $('play-pose').addEventListener('click', () => {
      simulation = true; simulationContact = true; $<HTMLInputElement>('use-simulation').checked = true; $<HTMLInputElement>('sim-contact').checked = true;
      simPose = neutralPose(); playbackAt = performance.now(); alignScene(); updateSimulationUi();
    });
    $('neutral-pose').addEventListener('click', () => { playbackAt = null; simPose = neutralPose(); updateSimulationUi(); });
    $('realign').addEventListener('click', alignScene);
    document.querySelectorAll<HTMLButtonElement>('[data-gain]').forEach(button => button.addEventListener('click', () => {
      const value = Number(button.dataset.gain);
      if (engine.setGain(value)) { document.querySelectorAll('[data-gain]').forEach(b => b.setAttribute('aria-pressed', String(Number((b as HTMLElement).dataset.gain) === value))); }
    }));
    const numericFields: [string, keyof Setup][] = [['width', 'radius'], ['middle-length', 'middleLength'], ['distal-length', 'distalLength'],
      ['yaw', 'yaw'], ['pitch', 'pitch'], ['dip-rest', 'dipRest'], ['offset-x', 'offsetX'], ['offset-y', 'offsetY'],
      ['ball-radius', 'ballRadius'], ['ball-depth', 'ballDepth'], ['ball-x', 'ballX'], ['ball-y', 'ballY'],
      ['root-gap', 'rootGap'], ['view-yaw', 'viewYaw'], ['view-pitch', 'viewPitch'], ['thickness', 'thickness'], ['break-distance', 'breakDistance'], ['custom-scale', 'customPxPerMm']];
    for (const [id, key] of numericFields) $(id).addEventListener('input', () => {
      if (touch || engine.contact) { $<HTMLInputElement>(id).value = String(setup[key]); return; }
      const value = Number($<HTMLInputElement>(id).value); (setup[key] as number) = value;
      $(id + '-out').textContent = id === 'custom-scale' ? value.toFixed(2) : String(value) + (['yaw', 'pitch', 'dip-rest', 'view-yaw', 'view-pitch'].includes(id) ? '°' : ' mm');
      if (key === 'customPxPerMm') { setup.scalePreset = 'custom'; $<HTMLSelectElement>('scale-preset').value = 'custom'; }
      if (key !== 'rootGap') alignScene(); saveSetup();
    });
    $<HTMLSelectElement>('scale-preset').value = setup.scalePreset;
    $('scale-preset').addEventListener('change', () => {
      if (touch || engine.contact) { $<HTMLSelectElement>('scale-preset').value = setup.scalePreset; return; }
      setup.scalePreset = $<HTMLSelectElement>('scale-preset').value as ScalePreset;
      if (setup.scalePreset !== 'custom') { setup.customPxPerMm = ppm(); $<HTMLInputElement>('custom-scale').value = String(setup.customPxPerMm); $('custom-scale-out').textContent = setup.customPxPerMm.toFixed(2); }
      alignScene(); saveSetup();
    });
    $('show-ruler').addEventListener('change', () => { $('ruler').hidden = !$<HTMLInputElement>('show-ruler').checked; });
    $('show-card').addEventListener('change', () => { $('card-check').hidden = !$<HTMLInputElement>('show-card').checked; });
    $<HTMLInputElement>('skin-color').value = setup.skin;
    $('skin-color').addEventListener('input', () => { setup.skin = $<HTMLInputElement>('skin-color').value; saveSetup(); });
    $('stroke-gain').addEventListener('input', () => { material.strokeGain = Number($<HTMLInputElement>('stroke-gain').value); $('stroke-gain-out').textContent = material.strokeGain.toFixed(2); });
    $('spread').addEventListener('input', () => {
      if (engine.contact || engine.gain !== 1) return;
      material.spread = Number($<HTMLInputElement>('spread').value); $('spread-out').textContent = material.spread.toFixed(2);
    });
    $('reset-setup').addEventListener('click', () => { try { localStorage.removeItem(STORAGE); } catch {} location.reload(); });
    updateSimulationUi(); updateSceneControls();
  }
  function updateSimulationUi() {
    if (!developer) return;
    $('simulation-controls').hidden = !simulation;
    for (const [id, key] of [['hand-x', 'tiltX'], ['hand-y', 'tiltY'], ['dip', 'dip']] as const) {
      $<HTMLInputElement>(id).value = String(degrees(simPose[key])); $(id + '-out').textContent = degrees(simPose[key]).toFixed(1) + '°';
    }
  }
  alignScene();
  (window as unknown as { __pivot: unknown }).__pivot = { snapshot: () => structuredClone(diagnostics) };

  function frame(now: number) {
    if (disposed) return;
    const dt = Math.min(0.04, (now - previousTime) / 1000); previousTime = now;
    const remote = receiver.sample(now, rotation());
    if (!simulation && remote.status !== previousStatus) {
      if (['lost', 'rotation'].includes(remote.status)) resetAfterLoss(); previousStatus = remote.status;
    }
    if (simulation && playbackAt !== null) {
      const t = ((now - playbackAt) / 1000) % 9;
      simPose = { tiltX: t > 5.5 && t < 8 ? Math.sin((t - 5.5) * Math.PI) * 0.12 : 0,
        tiltY: t > 5.5 && t < 8 ? Math.cos((t - 5.5) * Math.PI) * 0.08 : 0,
        dip: t < 1 ? 0 : t < 3 ? (t - 1) / 2 * 1.12 : t < 5 ? 1.12 : t < 5.5 ? (5.5 - t) * 2 * 1.12 : t < 8 ? 1.04 : (9 - t) * 1.04 };
      if (now - lastUi > 100) updateSimulationUi();
    }
    const cameraMode = setup.side === 'back' || setup.contactMode === 'camera';
    if (!simulation && cameraMode && remote.valid) {
      if (!remote.contact) { cameraOffSeen = true; rearAligned = false; }
      else if (!cameraContactBefore && cameraOffSeen && receiver.align()) { pivot = add(guide, v(px(setup.offsetX), -px(setup.offsetY))); rearAligned = true; }
      cameraContactBefore = remote.contact;
    }
    const pose = simulation ? simPose : remote.pose;
    const active = simulation ? simulationContact || touch : cameraMode ? rearAligned && remote.contact && !receiver.alignRequired : touch && !touchNeedsFresh && !receiver.alignRequired;
    const enabled = active && (simulation || remote.valid) && !document.hidden;
    const hold = !simulation && active && remote.hold;
    engine.update(pivot, pose, config(), ball, enabled, hold);
    material.update(dt, engine.contact, engine.skeleton.pad, ball, kind, hold);
    const visible = simulation ? active : cameraMode ? active && (remote.valid || hold) : touch && (remote.valid || hold);
    scene.render(engine.skeleton, ball, material, config(), kind, visible, setup.rootGap, setup.skin);
    diagnostics = { pivot: { ...pivot }, pip: engine.skeleton.pip, dip: engine.skeleton.dip, tip: engine.skeleton.tip, pad: engine.skeleton.pad,
      rootScreen: scene.project(v(pivot.x, pivot.y, 0)), guide: scene.project(guide), ball: structuredClone(ball),
      input: { ...pose }, displayedDip: engine.displayedDip, gain: engine.gain, contact: engine.contact, depth: material.depth,
      thread: material.thread, strokeShift: { ...material.strokeShift }, side: setup.side, scene: kind, simulation: simulation || remote.source === 'simulation', inputSource: simulation ? 'simulation' : remote.source,
      tracking: remote.status, axes: remote.axes, aligned: !receiver.alignRequired, active, visible,
      lengths: [setup.middleLength, setup.distalLength], rootGap: setup.rootGap, pxPerMm: ppm() };
    if (now - lastUi > 100) {
      lastUi = now;
      $('pivot-guide').hidden = visible;
      $('simulation-badge').hidden = !(simulation || remote.source === 'simulation');
      // Status pill = what the input is doing; note = the one thing the user should do next (empty when nothing).
      const simulated = simulation || remote.source === 'simulation';
      const [tone, statusText] = simulation ? ['sim', '手動で動かし中'] :
        remote.status === 'ready' ? [simulated ? 'sim' : 'ok', simulated ? 'PCから手動の値を受信' : 'PCで指を読み取り中'] :
        remote.status === 'hold' ? ['wait', '追跡を待っています'] :
        remote.status === 'lost' ? ['err', '追跡が途切れました'] :
        remote.status === 'rotation' ? ['err', '画面の向きが変わりました'] :
        isStaticDemo ? ['off', '公開デモ'] : socket.connected ? ['wait', 'PCの読み取りを待っています'] : ['off', 'PCに接続中'];
      setData($('status-pill'), 'tone', tone); setText($('status-text'), statusText);
      const [noteTone, note] = simulation ? ['info', ''] :
        remote.status === 'rotation' ? ['err', '画面の向きが変わりました。PCの「端末の向き」を合わせて、動きを登録し直してください'] :
        remote.status === 'lost' ? ['err', '追跡が途切れました。指を一度離して、もう一度当ててください'] :
        touchNeedsFresh ? ['warn', '指を一度離して、もう一度当ててください'] :
        visible && remote.valid ? ['info', ''] :
        remote.status === 'hold' ? ['warn', 'PCのカメラに人差し指が映っているか確認してください'] :
        remote.status === 'waiting' ? (isStaticDemo ? ['info', `公開版：実指入力なし · <a href="${href('dev')}">調整・お試しで動きを見る</a>`] : ['info', `PCで<a href="${href('tracker')}">指の読み取り</a>を開き、カメラを開始してください`]) :
        setup.side === 'back' || setup.contactMode === 'camera' ? ['info', '第2関節を印に合わせると、PCが接触を判定します'] : ['info', '第2関節を ○ に当てると、指の続きが現れます'];
      if ($('input-note').innerHTML !== note) $('input-note').innerHTML = note;
      setData($('input-note'), 'tone', noteTone);
      $('stage').dataset.contact = String(!!engine.contact); $('stage').dataset.depth = material.depth.toFixed(2);
      $('stage').dataset.source = simulation ? 'simulation' : remote.source || 'none';
      if (developer) {
        document.querySelectorAll<HTMLButtonElement>('[data-gain]').forEach(b => b.disabled = !!engine.contact);
        $<HTMLInputElement>('spread').disabled = !!engine.contact || engine.gain !== 1;
        const receiving = simulation || remote.status === 'ready';
        const statusName = ({ waiting: '未接続', ready: '受信中', hold: '保持', lost: '途絶', rotation: '向き変更' } as Record<string, string>)[remote.status];
        renderPipeline($('pipeline'), [
          ['入力', simulation ? 'シミュ' : statusName, receiving ? 'ok' : remote.status === 'hold' ? 'wait' : 'off'],
          ['指の位置', active ? '決定' : '未決定', active ? 'ok' : 'off'],
          ['球に接触', engine.contact ? 'あり' : 'なし', engine.contact ? 'ok' : 'off'],
          ['へこみ', material.depth > 0.05 ? (material.depth / ppm()).toFixed(1) + ' mm' : '0', material.depth > 0.05 ? 'ok' : 'off'],
        ]);
        const deg = (r: number) => degrees(r).toFixed(1) + '°';
        renderReadouts($('diagnostics'), [
          ['手の傾き 左右', deg(pose.tiltX)], ['手の傾き 上下', deg(pose.tiltY)], ['表示倍率 g', engine.gain.toFixed(1)],
          ['指先の曲げ 入力', deg(pose.dip)], ['指先の曲げ 表示', deg(engine.displayedDip)], ['へこみ', (material.depth / ppm()).toFixed(1) + ' mm'],
        ]);
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function developerPanel(s: Setup) {
  return `<aside class="developer-panel">
  <header class="panel-head">
    <div><p class="eyebrow">Pivot Finger Lab</p><h1>調整・お試し</h1><p class="subtitle">PCで開く画面 · 指や球の見た目を合わせ、カメラなしでも動きを試せます</p></div>
    <a class="pill-link" id="tracker-link" href="#" target="_blank" rel="noopener">${icon('camera', 16)}指の読み取り${icon('external', 13)}</a>
  </header>
  <p class="conn-line">${icon('info', 14)}<span id="connection">接続待ち</span></p>
  <ol class="pipeline" id="pipeline"></ol>
  <div class="readouts" id="diagnostics"></div>

  <section class="card">
    <h2>入力</h2>
    <p class="card-desc">PCのカメラがなくても、スライダーで指を動かして見え方を確かめられます。</p>
    ${toggle('use-simulation', '手動で動かす', false, '実際の指の代わりにスライダーで動かす')}
    <button class="secondary full-width" id="play-pose">${icon('play', 14)}自動再生（押す→戻す→なぞる）</button>
    <div id="simulation-controls" class="sub" hidden>
      ${slider('dip', '指先の曲げ', -15, 75, 0, 1, '°', '右へ動かすと球を押す')}
      ${slider('hand-y', '手の傾き 上下', -25, 25, 0, 1, '°', '− 下 / + 上')}
      ${slider('hand-x', '手の傾き 左右', -25, 25, 0, 1, '°', '− 左 / + 右')}
      ${toggle('sim-contact', '接点あり', true)}
      <button class="ghost" id="neutral-pose">${icon('reset', 14)}基準姿勢に戻す</button>
    </div>
  </section>

  <section class="card">
    <h2>表示条件</h2>
    <div class="field-grid">
      <label for="side">面</label><select id="side"><option value="front">表側（画面の奥へ）</option><option value="back">裏側（手前へ出る）</option></select>
      <span class="label-cell">表示倍率 g<small>球に触れていない時だけ変更可</small></span>
      <div class="segmented"><button data-gain="0.8">0.8</button><button data-gain="1" aria-pressed="true">1.0</button><button data-gain="1.2">1.2</button></div>
    </div>
    <div id="release-controls" hidden>${slider('break-distance', '糸が切れる距離', 2, 15, s.breakDistance, 0.5, ' mm')}</div>
    <div id="stroke-controls" hidden>${slider('stroke-gain', '表面模様の追従率', 0.25, 1.35, 0.65, 0.05, '')}</div>
  </section>

  <section class="card">
    <h2>実物大に合わせる</h2>
    <p class="card-desc">指と球をmmで決め、画面の密度で実物大に描きます。iPadでは通常「自動」のままで合います。</p>
    <div class="field-grid"><label for="scale-preset">画面</label><select id="scale-preset">${scalePresets.map(p => `<option value="${p.id}">${p.label}</option>`).join('')}</select></div>
    <p class="scale-resolved" id="scale-resolved"></p>
    ${toggle('show-card', 'カードで大きさを確認', false, 'クレジットカード等を画面の枠に重ね、ずれたら下で合わせる')}
    ${slider('custom-scale', '1mmあたりのpx', 3, 8, Number(s.customPxPerMm.toFixed(2)), 0.01, '', '動かすと「手動で合わせる」になります')}
    ${toggle('show-ruler', '画面の左端に定規を表示', false, '指を画面に置いて長さ・太さを測る')}
  </section>

  <section class="card">
    <h2>自分の指の大きさ</h2>
    <p class="card-desc">定規で測った値を入れます。中節＝第2関節〜第1関節、末節＝第1関節〜指先。</p>
    ${slider('middle-length', '中節の長さ', 15, 35, s.middleLength, 0.5, ' mm')}${slider('distal-length', '末節の長さ', 14, 30, s.distalLength, 0.5, ' mm')}
    ${slider('width', '指の太さ（半径）', 5, 12, s.radius, 0.5, ' mm', '幅の半分。第1関節の幅が16mmなら8mm')}
  </section>

  <details class="card" id="dev-advanced"><summary>接触の検出</summary>
    <div class="field-grid"><label for="contact-mode">検出方法</label><select id="contact-mode"><option value="touch">タッチ（画面に当てる）</option><option value="camera">カメラ固定点（PCで判定）</option></select></div>
    <p class="card-desc">タッチが反応しない端末や裏側では「カメラ固定点」を選び、PCの「指の読み取り」でカメラによる接触判定を有効にします。</p>
    <button class="secondary full-width" id="realign">${icon('reset', 14)}接点を登録し直す</button>
  </details>
  <details class="card"><summary>指の向きと継ぎ目</summary>
    <p class="card-desc">指を離した状態で変更できます。実指の見え方に合わせます。</p>
    ${slider('offset-x', '継ぎ目 X', -12, 12, s.offsetX, 0.5, ' mm')}${slider('offset-y', '継ぎ目 Y', -12, 12, s.offsetY, 0.5, ' mm')}
    ${slider('yaw', '基準の向き 左右', -40, 40, s.yaw)}${slider('pitch', '基準の向き 上下', 5, 55, s.pitch)}${slider('dip-rest', '指先の基準の曲げ', -60, -10, s.dipRest)}
    ${slider('root-gap', '根元の隙間', 0, 4, s.rootGap, 0.1, ' mm', '描画だけを切り取る比較条件')}
    ${slider('thickness', '端末の厚み（裏側用）', 3, 15, s.thickness, 0.5, ' mm')}
    <div class="switch-row"><label class="switch-text" for="skin-color">根元の色</label><input type="color" id="skin-color" value="${s.skin}"/></div>
  </details>
  <details class="card"><summary>球</summary>
    ${slider('ball-radius', '半径', 8, 35, s.ballRadius, 0.5, ' mm')}${slider('ball-depth', '奥行き', 25, 90, s.ballDepth, 0.5, ' mm')}
    ${slider('ball-x', '中心 X', -15, 15, s.ballX, 0.5, ' mm')}${slider('ball-y', '中心 Y', -15, 15, s.ballY, 0.5, ' mm')}
    ${slider('spread', 'へこみの広がり', 0.3, 0.65, 0.43, 0.01, '', 'g=1.0 かつ非接触時のみ')}
  </details>
  <details class="card"><summary>観察点</summary>
    ${slider('view-yaw', '左右', -14, 14, s.viewYaw)}${slider('view-pitch', '上下', -14, 14, s.viewPitch)}
  </details>
  <button class="ghost danger" id="reset-setup">${icon('reset', 14)}すべての設定を初期値に戻す</button>
  </aside>`;
}
