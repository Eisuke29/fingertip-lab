import { defaultFinger, FingerInteraction } from './kinematics';
import { MaterialResponse } from './material';
import { add, clamp, degrees, radians, v, type V3 } from './math';
import { PoseReceiver } from './pose-input';
import { PivotScene } from './scene';
import { PoseSocket } from './socket';
import { isStaticDemo } from './deployment';
import { neutralPose, type Ball, type FingerConfig, type Pose, type SceneKind, type Side } from './types';
import { $, href, isDeveloper, renderPipeline, renderTable, roomName, rotation, slider } from './ui';

type Setup = {
  side: Side; radius: number; middleLength: number; distalLength: number; yaw: number; pitch: number; dipRest: number;
  offsetX: number; offsetY: number; ballRadius: number; ballDepth: number; ballX: number; ballY: number;
  skin: string; rootGap: number; viewYaw: number; viewPitch: number; contactMode: 'touch' | 'camera';
};
const defaults = (): Setup => ({ ...defaultFinger(), side: 'front', yaw: 11, pitch: 23, dipRest: -35, offsetX: 0, offsetY: 0,
  ballRadius: 70, ballDepth: 200, ballX: 0, ballY: 0, skin: '#d9aa91', rootGap: 0, viewYaw: 0, viewPitch: 0, contactMode: 'touch' });

export function startExperience() {
  const developer = isDeveloper();
  let setup = defaults();
  try { const saved = JSON.parse(localStorage.getItem('pivot-finger.setup.v2') || 'null'); if (saved && typeof saved === 'object') setup = { ...setup, ...saved }; } catch {}
  const stageHtml = `<div class="view-container" id="stage"><header class="experience-header"><p class="stage-condition"><span id="side-label">表側</span><span class="sep">/</span><span id="scene-label">押す</span></p><a class="adjust-link" href="${href(developer ? 'product' : 'dev')}">${developer ? '体験画面' : '調整'}</a></header>
    <span class="simulation-badge" id="simulation-badge" hidden>入力シミュレーション</span>
    <div class="pivot-guide" id="pivot-guide" aria-hidden="true"><span class="posture-mark"></span></div>
    <p class="input-note" id="input-note"></p>
    <nav class="scene-nav" aria-label="場面"><button data-scene="press" aria-pressed="true">押す</button><button data-scene="release" aria-pressed="false">離す</button><button data-scene="stroke" aria-pressed="false">なぞる</button></nav></div>`;
  $('app').innerHTML = `<main class="experience-layout ${developer ? 'dev-layout' : ''}">${developer ? '<div class="dev-stage-wrap">' : ''}${stageHtml}${developer ? '</div>' + developerPanel(setup) : ''}</main>`;
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

  const config = (): FingerConfig => ({ ...defaultFinger(), side: setup.side, middleLength: setup.middleLength,
    distalLength: setup.distalLength, radius: setup.radius, yaw: radians(setup.yaw), pitch: radians(setup.pitch), dipRest: radians(setup.dipRest) });
  function positionGuide() {
    const point = scene.project(guide); $('pivot-guide').style.left = point.x + 'px'; $('pivot-guide').style.top = point.y + 'px';
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
    pivot = add(guide, v(setup.offsetX, -setup.offsetY));
    ball = { center: add(guide, v(setup.ballX, setup.ballY, setup.side === 'front' ? -setup.ballDepth : setup.ballDepth - 8)), radius: setup.ballRadius };
    engine.reset(); material.reset(); positionGuide();
    $('side-label').textContent = setup.side === 'front' ? '表側' : '裏側';
  }
  function suspend() { endTouch(); receiver.invalidate(); rearAligned = false; cameraOffSeen = false; simulationContact = false; if (developer) $<HTMLInputElement>('sim-contact').checked = false; }
  function resetAfterLoss() { receiver.invalidate(); if (touch) touchNeedsFresh = true; rearAligned = false; cameraOffSeen = false; }
  socket.onStatus = text => { connectedText = text; if (developer) $('connection').textContent = text; };
  socket.onPose = frame => { receiver.ingest(frame, performance.now()); if (receiver.streamChanged) resetAfterLoss(); };

  scene.canvas.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0 || pointerId !== null || setup.side !== 'front' || setup.contactMode !== 'touch') return;
    event.preventDefault(); pointerId = event.pointerId; touch = true;
    pivot = add(scene.clientPoint(event.clientX, event.clientY), v(setup.offsetX, -setup.offsetY));
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
    kind = button.dataset.scene as SceneKind; material.reset(); $('scene-label').textContent = button.textContent || '';
    document.querySelectorAll('[data-scene]').forEach(b => b.setAttribute('aria-pressed', String((b as HTMLElement).dataset.scene === kind)));
    if (developer) updateSceneControls();
  }));
  scene.onResize = () => alignScene();
  window.addEventListener('orientationchange', () => { resetAfterLoss(); alignScene(); });
  window.addEventListener('blur', () => { if (!simulation) suspend(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) suspend(); });
  window.addEventListener('pagehide', () => { disposed = true; socket.close(); scene.dispose(); });
  window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });

  function saveSetup() { try { localStorage.setItem('pivot-finger.setup.v2', JSON.stringify(setup)); } catch {} }
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
      ['root-gap', 'rootGap'], ['view-yaw', 'viewYaw'], ['view-pitch', 'viewPitch']];
    for (const [id, key] of numericFields) $(id).addEventListener('input', () => {
      if (touch || engine.contact) { $<HTMLInputElement>(id).value = String(setup[key]); return; }
      const value = Number($<HTMLInputElement>(id).value); (setup[key] as number) = value;
      $(id + '-out').textContent = String(value) + (['yaw', 'pitch', 'dip-rest', 'view-yaw', 'view-pitch'].includes(id) ? '°' : ' px');
      if (key !== 'rootGap') alignScene(); saveSetup();
    });
    $<HTMLInputElement>('skin-color').value = setup.skin;
    $('skin-color').addEventListener('input', () => { setup.skin = $<HTMLInputElement>('skin-color').value; saveSetup(); });
    $('break-distance').addEventListener('input', () => { material.breakDistance = Number($<HTMLInputElement>('break-distance').value); $('break-distance-out').textContent = material.breakDistance + ' px'; });
    $('stroke-gain').addEventListener('input', () => { material.strokeGain = Number($<HTMLInputElement>('stroke-gain').value); $('stroke-gain-out').textContent = material.strokeGain.toFixed(2); });
    $('spread').addEventListener('input', () => {
      if (engine.contact || engine.gain !== 1) return;
      material.spread = Number($<HTMLInputElement>('spread').value); $('spread-out').textContent = material.spread.toFixed(2);
    });
    $('reset-setup').addEventListener('click', () => { try { localStorage.removeItem('pivot-finger.setup.v2'); } catch {} location.reload(); });
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
      else if (!cameraContactBefore && cameraOffSeen && receiver.align()) { pivot = add(guide, v(setup.offsetX, -setup.offsetY)); rearAligned = true; }
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
      lengths: [setup.middleLength, setup.distalLength], rootGap: setup.rootGap };
    if (now - lastUi > 100) {
      lastUi = now;
      $('pivot-guide').hidden = visible;
      $('simulation-badge').hidden = !(simulation || remote.source === 'simulation');
      // One short status statement; empty while the finger is shown and tracking normally.
      const note = simulation ? '' :
        remote.status === 'rotation' ? '画面の向きが変化 — PCで再校正' :
        remote.status === 'lost' ? '追跡途絶 — 指を離して当て直す' :
        touchNeedsFresh ? '指を離して当て直す' :
        visible && remote.valid ? '' : remote.status === 'hold' ? '追跡待ち' :
        remote.status === 'waiting' ? (isStaticDemo ? `公開版：実指入力なし · <a href="${href('dev')}">開発画面</a>` : `PC未接続 · <a href="${href('tracker')}">計測画面</a>で校正`) :
        setup.side === 'back' ? 'PCで接触を確認' : '第2関節を ○ に当てる';
      if ($('input-note').innerHTML !== note) $('input-note').innerHTML = note;
      $('stage').dataset.contact = String(!!engine.contact); $('stage').dataset.depth = material.depth.toFixed(2);
      $('stage').dataset.source = simulation ? 'simulation' : remote.source || 'none';
      if (developer) {
        document.querySelectorAll<HTMLButtonElement>('[data-gain]').forEach(b => b.disabled = !!engine.contact);
        $<HTMLInputElement>('spread').disabled = !!engine.contact || engine.gain !== 1;
        const receiving = simulation || remote.status === 'ready';
        const sourceName = simulation ? 'シミュレーション' : ({ mediapipe: 'MediaPipe', markers: '4色マーカー', simulation: 'PC側シミュレーション' } as Record<string, string>)[remote.source || ''] || '—';
        const statusName = ({ waiting: '未接続', ready: '受信中', hold: '保持', lost: '途絶', rotation: '画面の向き変更' } as Record<string, string>)[remote.status];
        renderPipeline($('pipeline'), [
          ['入力', simulation ? 'SIM' : statusName, receiving ? 'ok' : remote.status === 'hold' ? 'wait' : 'off'],
          ['接点', active ? '登録済' : '未登録', active ? 'ok' : 'off'],
          ['接触', engine.contact ? 'あり' : 'なし', engine.contact ? 'ok' : 'off'],
          ['変形', material.depth > 0.05 ? material.depth.toFixed(1) + ' px' : '0', material.depth > 0.05 ? 'ok' : 'off'],
        ]);
        const deg = (r: number) => degrees(r).toFixed(1) + '°';
        renderTable($('diagnostics'), [
          ['入力源', sourceName], ['計測軸', simulation ? 'X・Y（描画のみ）' : remote.axes === 'plane-y' ? '面内1軸（Y）' : remote.axes === 'estimated-xy' ? '2軸推定（X・Y）' : '—'],
          ['手側 θx（左右）', deg(pose.tiltX)], ['手側 θy（上下）', deg(pose.tiltY)],
          ['DIP 入力', deg(pose.dip)], ['DIP 表示', deg(engine.displayedDip)], ['表示倍率 g', engine.gain.toFixed(1)],
          ['へこみ深さ', material.depth.toFixed(2) + ' px'], ['中節 / 末節', `${setup.middleLength} / ${setup.distalLength} px`],
        ]);
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function developerPanel(s: Setup) {
  return `<aside class="developer-panel"><header class="panel-head"><div><h1>開発画面</h1><p class="meta"><span id="connection">接続待ち</span></p></div><a id="tracker-link" href="#">計測画面 ↗</a></header>
  <section class="dev-section state-section"><h2>状態</h2><ol class="pipeline" id="pipeline"></ol><table class="data-table" id="diagnostics"></table></section>
  <section class="dev-section"><h2><span class="num">1</span>入力</h2>
    <div class="control-row"><input type="checkbox" id="use-simulation"/><label for="use-simulation">入力シミュレーション（実指を使わない）</label></div>
    <button class="full-width" id="play-pose">自動再生：押す → 保持 → 戻す</button>
    <div id="simulation-controls" hidden><div class="control-row"><input type="checkbox" id="sim-contact" checked/><label for="sim-contact">接点あり</label></div>
      ${slider('hand-x', '手側 θx（左 − / 右 +）', -25, 25, 0)}${slider('hand-y', '手側 θy（下 − / 上 +）', -25, 25, 0)}${slider('dip', 'DIP 屈曲 θd', -15, 75, 0)}
      <button class="full-width" id="neutral-pose">基準姿勢</button></div></section>
  <section class="dev-section"><h2><span class="num">2</span>接点</h2>
    <div class="field-grid"><label for="side">面</label><select id="side"><option value="front">表側（奥へ伸びる）</option><option value="back">裏側（手前へ出る）</option></select>
    <label for="contact-mode">接触検出</label><select id="contact-mode"><option value="touch">タッチ</option><option value="camera">カメラ固定点</option></select></div>
    <button class="full-width" id="realign">接点を再登録</button>
    <details><summary>指の形状・継ぎ目</summary>${slider('offset-x', '継ぎ目 X', -60, 60, s.offsetX, 1, ' px')}${slider('offset-y', '継ぎ目 Y', -60, 60, s.offsetY, 1, ' px')}
    ${slider('width', '指の半径', 10, 36, s.radius, 1, ' px')}${slider('middle-length', '中節長', 70, 165, s.middleLength, 1, ' px')}${slider('distal-length', '末節長', 45, 115, s.distalLength, 1, ' px')}
    ${slider('yaw', '基準方向 左右', -40, 40, s.yaw)}${slider('pitch', '基準方向 上下', 5, 55, s.pitch)}${slider('dip-rest', 'DIP 基準角', -60, -10, s.dipRest)}
    <div class="control-row"><label for="skin-color">根元の色</label><input type="color" id="skin-color" value="${s.skin}"/></div></details></section>
  <section class="dev-section"><h2><span class="num">3</span>素材</h2>
    <details><summary>球の大きさ・位置</summary>${slider('ball-radius', '半径', 45, 105, s.ballRadius, 1, ' px')}${slider('ball-depth', 'ガラスからの奥行き', 135, 255, s.ballDepth, 1, ' px')}${slider('ball-x', '中心 X', -55, 55, s.ballX, 1, ' px')}${slider('ball-y', '中心 Y', -55, 55, s.ballY, 1, ' px')}</details>
    ${slider('spread', 'へこみの広がり', 0.3, 0.65, 0.43, 0.01, '')}
    <div id="release-controls" hidden>${slider('break-distance', '糸の破断距離', 12, 50, 26, 1, ' px')}</div><div id="stroke-controls" hidden>${slider('stroke-gain', '表面模様の追従率', 0.25, 1.35, 0.65, 0.05, '')}</div></section>
  <section class="dev-section"><h2><span class="num">4</span>条件</h2>
    <p class="label">表示倍率 g = Δθ<sub>表示</sub> / Δθ<sub>入力</sub>（接触後のみ）</p><div class="button-row segmented"><button data-gain="0.8">0.8</button><button data-gain="1" aria-pressed="true">1.0</button><button data-gain="1.2">1.2</button></div>
    ${slider('root-gap', '根元の隙間', 0, 18, s.rootGap, 1, ' px')}
    <details><summary>観察点</summary>${slider('view-yaw', '左右', -14, 14, s.viewYaw)}${slider('view-pitch', '上下', -14, 14, s.viewPitch)}</details></section>
  <section class="dev-section"><button class="full-width quiet" id="reset-setup">設定を初期値に戻す</button></section></aside>`;
}
