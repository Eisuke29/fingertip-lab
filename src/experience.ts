import { defaultFinger, FingerInteraction } from './kinematics';
import { MaterialResponse } from './material';
import { add, clamp, degrees, radians, v, type V3 } from './math';
import { PoseReceiver } from './pose-input';
import { PivotScene } from './scene';
import { PoseSocket } from './socket';
import { isStaticDemo } from './deployment';
import { neutralPose, type Ball, type FingerConfig, type Pose, type SceneKind, type Side } from './types';
import { $, href, isDeveloper, roomName, rotation, slider } from './ui';

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
  const stageHtml = `<div class="view-container" id="stage"><header class="experience-header"><div><p class="overline">PIVOT / SOFT MATERIAL</p><p class="side-label" id="side-label">表側から、奥へ</p></div><a class="adjust-link" href="${href(developer ? 'product' : 'dev')}">${developer ? '体験へ' : '調整'}</a></header>
    <span class="simulation-badge" id="simulation-badge" hidden>入力シミュレーション</span><span class="scene-caption" id="scene-caption"></span>
    <div class="pivot-guide" id="pivot-guide" aria-hidden="true"><span class="posture-mark"></span></div>
    <p class="input-note" id="input-note">第2関節を印に当て、手側を少し倒します</p>
    <nav class="scene-nav" aria-label="触れる場面"><button data-scene="press" aria-pressed="true">押す・戻す</button><button data-scene="release" aria-pressed="false">触れて離す</button><button data-scene="stroke" aria-pressed="false">縁をなぞる</button></nav></div>`;
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
    $('side-label').textContent = setup.side === 'front' ? '表側から、奥へ' : '裏側から、手前へ';
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
    kind = button.dataset.scene as SceneKind; material.reset();
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
      const note = simulation ? (engine.contact ? '指腹が触れている場所だけ、へこみます' : '手側の傾きとDIPを、別々に操作できます') :
        remote.status === 'rotation' ? '端末の向きが変わりました。PCで向きと接点を合わせ直します' :
        remote.status === 'lost' ? '追跡が途切れました。姿勢を戻し、接点を合わせ直してください' :
        touchNeedsFresh ? '指を一度離し、接点を合わせ直してください' :
        visible && remote.valid ? '' : remote.status === 'hold' ? '追跡を待っています' :
        remote.status === 'waiting' ? (isStaticDemo ? `実指の入力はPCで接続 · <a href="${href('dev')}">描画確認</a>` : `PCの <a href="${href('tracker')}">追跡画面</a> で姿勢を校正します`) :
        setup.side === 'back' ? 'PCで接触を確認し、裏側の接点を合わせます' : '第2関節を印に当てます。小さな滑りで支点は動きません';
      $('input-note').innerHTML = note;
      $('scene-caption').textContent = kind === 'release' ? '触れてから、指腹を離す' : kind === 'stroke' ? '届く縁を、指腹でなぞる' : '';
      $('stage').dataset.contact = String(!!engine.contact); $('stage').dataset.depth = material.depth.toFixed(2);
      $('stage').dataset.source = simulation ? 'simulation' : remote.source || 'none';
      if (developer) {
        document.querySelectorAll<HTMLButtonElement>('[data-gain]').forEach(b => b.disabled = !!engine.contact);
        $<HTMLInputElement>('spread').disabled = !!engine.contact || engine.gain !== 1;
        $('diagnostics').textContent = `手側 X ${degrees(pose.tiltX).toFixed(1)}° / Y ${degrees(pose.tiltY).toFixed(1)}°\nDIP 入力 ${degrees(pose.dip).toFixed(1)}° → 表示 ${degrees(engine.displayedDip).toFixed(1)}°\n中節 ${setup.middleLength} / 末節 ${setup.distalLength} px\n指腹のへこみ ${material.depth.toFixed(2)} px\n入力 ${simulation ? 'シミュレーション' : remote.source || '未接続'} / ${remote.status}\n軸 ${simulation ? '描画のみ X・Y' : remote.axes || '未校正'}\n支点 ${pivot.x.toFixed(1)}, ${pivot.y.toFixed(1)}, 0`;
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function developerPanel(s: Setup) {
  return `<aside class="developer-panel"><header><p class="overline">PIVOT / DEVELOPMENT</p><h2>支点と、二つの関節。</h2><a id="tracker-link" href="#">PCの計測・校正画面 ↗</a><div class="status-line" id="connection">姿勢入力を待っています</div></header>
  <section class="dev-section"><h3>描画の確認</h3><div class="control-row"><input type="checkbox" id="use-simulation"/><label for="use-simulation">入力シミュレーション</label></div><p>実指の計測とは別の入力です。同じ二関節モデルと球へ再生します。</p><button class="primary full-width" id="play-pose">再生：押す → 保つ → 戻す</button>
    <div id="simulation-controls" hidden><div class="control-row"><input type="checkbox" id="sim-contact" checked/><label for="sim-contact">PIPを固定した接触状態</label></div>
      ${slider('hand-x', '手側 左 ← → 右', -25, 25, 0)}${slider('hand-y', '手側 下 ← → 上', -25, 25, 0)}${slider('dip', 'DIPのみの曲げ', -15, 75, 0)}
      <button class="full-width small" id="neutral-pose">基準姿勢へ戻す</button><p>手側を下に倒すと中節は上へ。DIPを動かしてもPIPとDIPの位置は変わりません。</p></div></section>
  <section class="dev-section"><h3>表裏と接点</h3><div class="two-cols"><select id="side" aria-label="表裏"><option value="front">表側 → 奥</option><option value="back">裏側 → 手前</option></select><select id="contact-mode" aria-label="表側の接触確認"><option value="touch">タッチで接触</option><option value="camera">カメラの固定点</option></select></div><button class="full-width small" id="realign" style="margin-top:12px">接点を合わせ直す</button><p>タッチは開始位置と接触の確認だけに使います。移動や圧力を曲げ角に換算しません。</p>
    <details><summary>継ぎ目・長さ・輪郭</summary>${slider('offset-x', '継ぎ目 X', -60, 60, s.offsetX, 1, ' px')}${slider('offset-y', '継ぎ目 Y', -60, 60, s.offsetY, 1, ' px')}
    ${slider('width', '指の半径', 10, 36, s.radius, 1, ' px')}${slider('middle-length', '中節の長さ', 70, 165, s.middleLength, 1, ' px')}${slider('distal-length', '末節の長さ', 45, 115, s.distalLength, 1, ' px')}
    ${slider('yaw', '基準の左右方向', -40, 40, s.yaw)}${slider('pitch', '基準の上下方向', 5, 55, s.pitch)}${slider('dip-rest', 'DIPの基準姿勢', -60, -10, s.dipRest)}
    <div class="control-row"><label for="skin-color">根元の色</label><input type="color" id="skin-color" value="${s.skin}"/></div></details></section>
  <section class="dev-section"><h3>球の初期配置</h3><p>調整は指を離してから。操作中の球の中心は固定です。</p><details><summary>大きさ・奥行き・位置</summary>${slider('ball-radius', '球の半径', 45, 105, s.ballRadius, 1, ' px')}${slider('ball-depth', 'ガラスからの奥行き', 135, 255, s.ballDepth, 1, ' px')}${slider('ball-x', '中心 X', -55, 55, s.ballX, 1, ' px')}${slider('ball-y', '中心 Y', -55, 55, s.ballY, 1, ' px')}</details></section>
  <section class="dev-section"><h3>押すときの表示倍率 g</h3><div class="button-row"><button data-gain="0.8">0.8</button><button data-gain="1" aria-pressed="true">1.0</button><button data-gain="1.2">1.2</button></div><p>g = 接触後の仮想DIP角変化 ÷ 入力DIP角変化。指を離して切り替えます。支点・中節・長さには掛けません。</p>
    <details><summary>素材だけの反応を確認</summary><p>g=1.0のまま、へこみの広がり一つだけを変更します。</p>${slider('spread', 'へこみの広がり', 0.3, 0.65, 0.43, 0.01, '')}</details>
    <div id="release-controls" hidden>${slider('break-distance', '糸が切れる距離', 12, 50, 26, 1, ' px')}</div><div id="stroke-controls" hidden>${slider('stroke-gain', '接触模様の追従', 0.25, 1.35, 0.65, 0.05, '')}</div></section>
  <section class="dev-section"><h3>見え方の確認</h3><details><summary>観察点と連続性</summary>${slider('view-yaw', '観察点の左右', -14, 14, s.viewYaw)}${slider('view-pitch', '見下ろす角度', -14, 14, s.viewPitch)}${slider('root-gap', '根元だけに作る隙間', 0, 18, s.rootGap, 1, ' px')}<p>隙間は描画だけに適用し、指先軌跡と変形は同じです。</p></details></section>
  <section class="dev-section"><h3>現在の状態</h3><div class="diagnostics" id="diagnostics"></div><button class="full-width small" id="reset-setup" style="margin-top:14px">位置合わせを初期値に戻す</button></section></aside>`;
}
