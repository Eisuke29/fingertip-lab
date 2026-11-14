import { InteractionEngine } from './interaction';
import { RearInput } from './rear-input';
import { SessionRecords, type Pair, type Trial } from './records';
import { ProductScene } from './scene';
import { InputSocket } from './socket';
import { clamp01, copy, distance, newId, type DisplayCondition, type InputMode, type InputSample, type InputSource, type Vec3 } from './types';
import { $, appHref, header, networkLinks, roomName, toast } from './ui';
import { isStaticDemo, repositoryUrl } from './deployment';

type Settings = { angle: number; width: number; offsetX: number; offsetY: number };
const defaultSettings: Settings = { angle: 128, width: 25, offsetX: 0, offsetY: 0 };

export function startProductApp() {
  $('app').innerHTML = `${header()}<main class="shell">
    ${isStaticDemo ? `<div class="notice warning" style="margin:0 0 22px" role="note">公開デモ：表面タッチ・比較試行・CSV保存を試せます。背面カメラ操作は <a href="${repositoryUrl}#起動">PCで起動</a> してください。</div>` : ''}
    <div class="intro"><div><p class="eyebrow">A SMALL OBJECT. A NEW WAY TO FEEL.</p><h1>指先で、持ち上げる。</h1><p>指の続きを、画面の向こうへ。ループを掛けて、ポーチをそっと持ち上げてみてください。</p></div><span class="research-badge">RESEARCH PROTOTYPE / 01</span></div>
    <div class="workspace"><section class="stage-card" aria-label="商品と操作領域">
      <div class="stage-bar"><strong>ループポーチ <span class="muted small-text">/ 同じ外見の小物</span></strong><span id="stage-mode" class="stage-mode">SURFACE → INSIDE</span></div>
      <div class="stage" id="stage"><div class="stage-notes"><span id="depth-label" class="depth-label">ガラス面から、奥へ</span><span id="condition-label">奥行きのある指</span></div>
        <div id="start-guide" class="start-guide" aria-hidden="true"><span>＋</span></div><div class="stage-foot" id="stage-foot">右の人差し指を曲げて、丸いガイドへ</div><div class="sim-banner" id="sim-banner" hidden>入力シミュレーション · 実カメラではありません</div></div>
      <div class="stage-hint" aria-live="polite"><span class="step-icon" id="hint-icon">↑</span><div><strong id="hint-title">丸いガイドに触れて、そのまま上へ</strong><p id="hint-copy">短く動かすとループが掛かります。指を離すとポーチを放します。</p></div></div>
    </section><aside class="sidebar">
      <section class="panel"><div class="panel-head"><h2>触れ方を選ぶ</h2><span class="panel-number">01 / INPUT</span></div>
        <div class="field"><div class="segmented" id="mode-buttons"><button data-mode="surface" aria-pressed="true"><span>↘</span>表面から奥</button><button data-mode="rear" aria-pressed="false" ${isStaticDemo ? 'disabled title="背面カメラ操作はPCでサーバーを起動してください"' : ''}><span>↗</span>背面から手前</button></div><p id="mode-note" class="field-note">タッチしたまま上へ動かし、離して放す</p></div>
        <div class="field"><span class="field-label">指の表示条件</span><div class="display-options" id="display-buttons"><button data-display="finger" aria-pressed="true">奥行きのある指</button><button data-display="point" aria-pressed="false">接触点のみ</button></div><p class="field-note">入力・ループの位置・商品の運動は共通です</p></div>
        <div class="status-strip" id="input-status"><span id="status-label">タッチを待っています</span><span id="status-value">0%</span></div><div class="signal-bar" aria-hidden="true"><span id="signal-fill"></span></div>
        <div id="rear-help" class="field-note" hidden>PCの <a href="${appHref('tracker')}">/tracker</a> で追跡を開始。最初は指を伸ばしてください。画面へのタッチは不要です。</div>
        <details class="dev" id="dev-settings"><summary>開発・位置合わせ</summary><div class="dev-body">
          <div class="field"><label class="field-label" for="gain">接触後の表示倍率 g <output id="gain-output">1.00</output></label><div class="gain-presets"><button data-gain="0.75">0.75</button><button data-gain="1">1.00</button><button data-gain="1.25">1.25</button></div><input type="range" id="gain" min="0.5" max="1.5" step="0.05" value="1" /><p class="field-note">表示変位 ÷ 入力変位。接触前は等倍です。</p></div>
          <div class="range-row"><label for="angle">表面の輪郭の向き <output id="angle-output">128°</output></label><input type="range" id="angle" min="70" max="170" value="128" /></div>
          <div class="range-row"><label for="finger-width">実指に合わせる幅 <output id="width-output">25 px</output></label><input type="range" id="finger-width" min="16" max="38" value="25" /></div>
          <div class="range-pair"><div class="range-row"><label for="offset-x">つなぎ目 X <output id="offset-x-output">0</output></label><input type="range" id="offset-x" min="-45" max="45" value="0" /></div><div class="range-row"><label for="offset-y">つなぎ目 Y <output id="offset-y-output">0</output></label><input type="range" id="offset-y" min="-45" max="45" value="0" /></div></div>
          <div class="range-pair"><div class="field"><label class="field-label" for="compare-a">比較条件 A</label><select id="compare-a"><option value="0.75">g = 0.75</option><option value="1">g = 1.00</option><option value="1.25">g = 1.25</option></select></div><div class="field"><label class="field-label" for="compare-b">比較条件 B</label><select id="compare-b"><option value="1.25">g = 1.25</option><option value="1">g = 1.00</option><option value="0.75">g = 0.75</option></select></div></div>
          <button class="text-button small-text" id="reset-alignment">位置合わせを初期値に戻す</button><p class="annotation">倍率を変えても根元は実タッチ位置に追従します。図の軸に沿うよう向きと幅を調整してください。</p>
        </div></details>
      </section>
      <section class="panel"><div class="panel-head"><h2>2回、持ち上げて比べる</h2><span class="panel-number">02 / COMPARE</span></div><div id="comparison-body"></div></section>
      <section class="panel"><div class="panel-head"><h2>この端末の記録</h2><span class="panel-number">03 / RECORD</span></div><div class="records-line"><span class="muted">完了した比較</span><span id="record-count">0 組</span></div><button id="export-csv" class="full-width small">CSVを書き出す ↓</button><p id="storage-note" class="field-note">自動でローカル保存 · 映像は記録しません</p></section>
    </aside></div>
    <details class="setup"><summary>実機のセットアップと、この試作で確かめること</summary><div class="setup-content"><p>表面：端末を机に置くか左手で支え、曲げた右人差し指をガイドに当てます。実指の曲がる手前の軸が仮想の指につながるよう、開発設定で向きを調整します。</p><p>背面：右手で縦持ちし、DIPとPIPの間の指の背を充電口側に向けて背面へ沿わせます。PCカメラを端末の横〜少し背面側に置き、3個の目印が見えるようにします。</p><p>PCの追跡画面：<code>http://localhost:5173/tracker?room=${roomName()}</code></p><p>同じWi-Fiのスマホで開くアドレス：</p><div id="network-links" class="network-list"></div><p>PCとスマホは同じルーム <code>${roomName()}</code> を使います。スマホのカメラやモーション許可は不要です。</p><p>「持ち上げにくさ」と「自分の指先で触れた感じ」を記録します。実物の重量を測る機能ではなく、擬似触覚の効果を検討するための試作です。</p></div></details>
    <footer class="footer"><p>FINGERTIP / PSEUDO-HAPTIC PRODUCT INTERACTION</p><p>表面と背面の比較は、姿勢・入力・ガラスへの接触を含む方式全体の差として扱います。</p></footer></main>`;

  const scene = new ProductScene($('stage'));
  const engine = new InteractionEngine();
  const rear = new RearInput();
  const records = new SessionRecords();
  const socket = new InputSocket('viewer', roomName());
  let mode: InputMode = 'surface';
  let display: DisplayCondition = 'finger';
  let settings = { ...defaultSettings };
  try {
    const saved = JSON.parse(localStorage.getItem('fingertip-lab.alignment') || 'null');
    if (saved && Object.values(saved).every(v => typeof v === 'number' && Number.isFinite(v))) {
      settings = { angle: Math.max(70, Math.min(170, saved.angle ?? 128)), width: Math.max(16, Math.min(38, saved.width ?? 25)),
        offsetX: Math.max(-45, Math.min(45, saved.offsetX ?? 0)), offsetY: Math.max(-45, Math.min(45, saved.offsetY ?? 0)) };
    }
  } catch { /* Defaults remain usable without persistent storage. */ }
  let rest: Vec3 = { x: 0, y: 45, z: -48 };
  let guide: Vec3 = { x: 0, y: 0, z: 0 };
  let surfaceRoot = copy(guide);
  let pointer: { id: number; startY: number; x: number; y: number; eligible: boolean } | null = null;
  let inputValue = 0;
  let currentSource: InputSource = 'surface';
  let previousRearStatus = '';
  let lastStreamId = '';
  let previousFrame = performance.now();
  let lastUi = 0;
  let currentPair: Pair | undefined;
  let currentTrial: Trial | undefined;
  let trialStage: 'none' | 'present' | 'choose' | 'done' = 'none';
  let trialIndex = 1;
  let hasLifted = false;
  let released = false;
  let rating: number | undefined;
  let disposed = false;
  let debug: Record<string, unknown> = {};

  const comparisonActive = () => trialStage === 'present' || trialStage === 'choose';
  const log = (event: string, extra: Partial<Parameters<SessionRecords['log']>[0]> = {}) => records.log({
    event, mode, display, source: currentSource, gain: engine.gain,
    pairId: currentPair?.id, trialId: currentTrial?.id, ...extra,
  });
  const frontVector = () => {
    const rad = settings.angle * Math.PI / 180;
    return { x: Math.cos(rad) * 103, y: Math.sin(rad) * 103, z: -48 };
  };
  const idleTip = () => mode === 'surface' ? { x: 0, y: rest.y - 17, z: rest.z } : { x: 0, y: rest.y - 17, z: rest.z };
  function resetScene(reason: string, interrupt = true) {
    endPointer(reason);
    if (interrupt) interruptTrial(reason);
    rear.disarm();
    rest = { x: 0, y: Math.min(62, scene.height * 0.09), z: mode === 'surface' ? -48 : 48 };
    const vec = frontVector();
    guide = mode === 'surface' ? { x: -vec.x, y: rest.y - 17 - vec.y, z: 0 } : { x: 87, y: rest.y - 38, z: 0 };
    surfaceRoot = copy(guide);
    engine.travel = Math.min(126, scene.height * 0.23);
    engine.reset(mode, rest, idleTip());
    scene.setRest(rest);
    positionGuide();
  }
  function positionGuide() {
    const point = scene.screenPoint({ x: guide.x - settings.offsetX, y: guide.y + settings.offsetY, z: 0 });
    $('start-guide').style.left = point.x + 'px'; $('start-guide').style.top = point.y + 'px';
  }
  function endPointer(reason: string) {
    const old = pointer;
    pointer = null;
    inputValue = 0;
    engine.release(reason);
    if (old && scene.canvas.hasPointerCapture(old.id)) scene.canvas.releasePointerCapture(old.id);
  }
  function interruptTrial(reason: string) {
    if (trialStage !== 'present' || !currentTrial || currentTrial.completed || currentTrial.interrupted) return;
    if (!currentTrial.contacts.length && !hasLifted) return;
    currentTrial.interrupted = true;
    hasLifted = released = false;
    log('trial-interrupted', { reason }); records.save(); renderComparison();
  }
  function controlsState() {
    const active = comparisonActive();
    $('dev-settings').hidden = active;
    document.querySelectorAll<HTMLButtonElement>('[data-mode],[data-display]').forEach(b => { b.disabled = active || (isStaticDemo && b.dataset.mode === 'rear'); });
  }
  function updateSettingsUi() {
    for (const [id, key, unit] of [['angle', 'angle', '°'], ['finger-width', 'width', ' px'], ['offset-x', 'offsetX', ''], ['offset-y', 'offsetY', '']] as const) {
      $<HTMLInputElement>(id).value = String(settings[key]);
      $(id === 'finger-width' ? 'width-output' : id + '-output').textContent = settings[key] + unit;
    }
  }
  function setGain(gain: number, shouldLog = true) {
    engine.gain = gain;
    $<HTMLInputElement>('gain').value = String(gain);
    $('gain-output').textContent = gain.toFixed(2);
    document.querySelectorAll<HTMLButtonElement>('[data-gain]').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.gain) === gain)));
    if (shouldLog) log('gain-changed');
  }

  $('mode-buttons').addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-mode]');
    if (!button || comparisonActive() || (isStaticDemo && button.dataset.mode === 'rear')) return;
    mode = button.dataset.mode as InputMode;
    currentSource = mode === 'surface' ? 'surface' : rear.source;
    resetScene('mode-changed');
    document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    $('mode-note').textContent = mode === 'surface' ? 'タッチしたまま上へ動かし、離して放す' : 'PCカメラで指の曲げ戻しを読み、表面には触れずに操作';
    $('rear-help').hidden = mode !== 'rear';
    $('start-guide').hidden = mode !== 'surface';
    $('stage-mode').textContent = mode === 'surface' ? 'SURFACE → INSIDE' : 'BACKSIDE → VIEWER';
    $('depth-label').textContent = mode === 'surface' ? 'ガラス面から、奥へ' : '端末の奥から、見る人の側へ';
    $('stage-foot').textContent = mode === 'surface' ? '右の人差し指を曲げて、丸いガイドへ' : '右手で縦持ち · 表面に触れず、第一関節を曲げ戻し';
    log('mode-changed');
  });
  $('display-buttons').addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-display]');
    if (!button || comparisonActive()) return;
    display = button.dataset.display as DisplayCondition;
    document.querySelectorAll<HTMLButtonElement>('[data-display]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.display === display)));
    $('condition-label').textContent = display === 'finger' ? '奥行きのある指' : '同じ位置の接触点';
    log('display-changed');
  });
  $('dev-settings').addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-gain]');
    if (button) setGain(Number(button.dataset.gain));
  });
  $('gain').addEventListener('input', () => setGain(Number($<HTMLInputElement>('gain').value)));
  for (const [id, key] of [['angle', 'angle'], ['finger-width', 'width'], ['offset-x', 'offsetX'], ['offset-y', 'offsetY']] as const) {
    $(id).addEventListener('input', () => {
      settings[key] = Number($<HTMLInputElement>(id).value); updateSettingsUi(); resetScene('alignment-changed');
      try { localStorage.setItem('fingertip-lab.alignment', JSON.stringify(settings)); } catch { /* Optional alignment persistence. */ }
    });
  }
  $('reset-alignment').addEventListener('click', () => { settings = { ...defaultSettings }; updateSettingsUi(); resetScene('alignment-reset'); try { localStorage.removeItem('fingertip-lab.alignment'); } catch {} });
  $('export-csv').addEventListener('click', () => { records.download(); toast('このセッションの記録をCSVに書き出しました'); });

  scene.canvas.addEventListener('pointerdown', event => {
    if (mode !== 'surface' || pointer || !event.isPrimary || event.button !== 0 || trialStage === 'choose') return;
    event.preventDefault();
    const root = scene.worldRoot(event.clientX, event.clientY, settings.offsetX, settings.offsetY);
    const vec = frontVector();
    const tip = { x: root.x + vec.x, y: root.y + vec.y, z: rest.z };
    pointer = { id: event.pointerId, startY: event.clientY, x: event.clientX, y: event.clientY, eligible: distance(tip, rest) < 38 };
    surfaceRoot = root; inputValue = 0;
    scene.canvas.setPointerCapture(event.pointerId);
    engine.tick(0, { root, tip, value: 0, active: true, eligible: pointer.eligible, source: 'surface' });
  });
  scene.canvas.addEventListener('pointermove', event => {
    if (!pointer || pointer.id !== event.pointerId) return;
    event.preventDefault();
    pointer.x = event.clientX; pointer.y = event.clientY;
    inputValue = clamp01((pointer.startY - event.clientY) / engine.travel);
  });
  scene.canvas.addEventListener('pointerup', event => { if (pointer?.id === event.pointerId) endPointer('pointer-up'); });
  scene.canvas.addEventListener('pointercancel', event => { if (pointer?.id === event.pointerId) { endPointer('pointer-cancel'); interruptTrial('pointer-cancel'); } });
  scene.canvas.addEventListener('lostpointercapture', event => { if (pointer?.id === event.pointerId) { endPointer('capture-lost'); interruptTrial('capture-lost'); } });
  scene.canvas.addEventListener('contextmenu', event => event.preventDefault());

  socket.onFrame = frame => {
    if (lastStreamId && frame.streamId !== lastStreamId && mode === 'rear') {
      engine.release('input-stream-changed'); interruptTrial('input-stream-changed');
    }
    lastStreamId = frame.streamId || '';
    rear.ingest(frame, performance.now());
  };
  socket.onStatus = (connected, message) => { $('connection').classList.toggle('connected', connected); $('connection').textContent = connected ? `ルーム ${roomName()}` : message; };

  function beginTrial(index: number, attempt = 1) {
    trialIndex = index; rating = undefined; hasLifted = released = false;
    currentTrial = undefined;
    resetScene('trial-start', false);
    setGain(currentPair!.order[index - 1], false);
    currentTrial = { id: newId(), pairId: currentPair!.id, index, attempt, gain: engine.gain, mode, display,
      source: currentSource, startedAt: new Date().toISOString(), contacts: [], releases: [], interrupted: false, completed: false };
    records.data.trials.push(currentTrial);
    trialStage = 'present';
    log('trial-start'); controlsState(); renderComparison(); records.save();
  }
  function beginPair() {
    if (engine.held || pointer) { toast('一度指を離してから比較を始めてください'); return; }
    const a = Number($<HTMLSelectElement>('compare-a').value), b = Number($<HTMLSelectElement>('compare-b').value);
    const previous = records.data.pairs.at(-1);
    const reverse = previous && previous.order.includes(a) && previous.order.includes(b) ? previous.order[0] === a : !!(crypto.getRandomValues(new Uint8Array(1))[0] & 1);
    currentPair = { id: newId(), order: reverse ? [b, a] : [a, b], mode, display, startedAt: new Date().toISOString() };
    records.data.pairs.push(currentPair);
    log('pair-start'); beginTrial(1);
  }
  function renderComparison() {
    const container = $('comparison-body');
    if (trialStage === 'none' || trialStage === 'done') {
      container.innerHTML = `${trialStage === 'done' ? '<p class="comparison-title">回答を保存しました ✓</p>' : ''}<p class="comparison-copy">同じ見た目のポーチを、順番を入れ替えて2回提示します。どちらが持ち上げにくく感じるでしょう。</p><button class="primary full-width" data-action="start">${trialStage === 'done' ? 'もう一組、比べる' : '比較をはじめる →'}</button><p class="field-note">比較中は倍率を隠します。各回の最後に、指先で触れた感じも回答します。</p>`;
    } else if (trialStage === 'present') {
      const interrupted = currentTrial?.interrupted;
      container.innerHTML = `<div class="trial-progress" aria-hidden="true"><span class="on"></span><span class="${trialIndex === 2 ? 'on' : ''}"></span></div><p class="comparison-title">${trialIndex}回目のポーチ</p><p class="comparison-copy" id="trial-instruction">${interrupted ? '入力が中断されました。この回をやり直してください。' : released && hasLifted ? '持ち上げと解放を確認しました。下の質問に回答してください。' : '一度持ち上げてから、指を離すか伸ばしてポーチを放してください。'}</p>
        ${interrupted ? '<button class="primary full-width" data-action="retry">この回をやり直す</button>' : `<fieldset class="rating" ${released && hasLifted ? '' : 'disabled'}><legend>自分の指先で触れた感じ</legend><div class="rating-options">${[1, 2, 3, 4, 5, 6, 7].map(n => `<label><input type="radio" name="ownership" value="${n}" ${rating === n ? 'checked' : ''}/><span>${n}</span></label>`).join('')}</div><div class="rating-endpoints"><span>全くない</span><span>強くある</span></div></fieldset><button class="primary full-width" id="trial-next" data-action="next" ${released && hasLifted && rating ? '' : 'disabled'}>${trialIndex === 1 ? '2回目のポーチへ →' : '比較の回答へ →'}</button>`}
        <button class="text-button small-text" style="margin-top:12px" data-action="cancel">比較を中止する</button>`;
    } else {
      container.innerHTML = '<p class="comparison-title">どちらが持ち上げにくかったですか？</p><p class="comparison-copy">実物の重量ではなく、この画面での体験について回答してください。</p><div class="choice-list"><button data-action="choice" data-choice="first">1回目</button><button data-action="choice" data-choice="second">2回目</button><button data-action="choice" data-choice="same">同じくらい</button><button data-action="choice" data-choice="unsure">わからない</button></div>';
    }
  }
  $('comparison-body').addEventListener('change', event => {
    const input = event.target as HTMLInputElement;
    if (input.name === 'ownership') { rating = Number(input.value); $<HTMLButtonElement>('trial-next').disabled = !(released && hasLifted && rating); }
  });
  $('comparison-body').addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-action]');
    if (!button || button.disabled) return;
    const action = button.dataset.action;
    if (action === 'start') beginPair();
    else if (action === 'retry') {
      currentTrial!.endedAt = new Date().toISOString(); records.save(); beginTrial(trialIndex, currentTrial!.attempt + 1);
    } else if (action === 'next' && released && hasLifted && rating && !engine.held && !pointer) {
      currentTrial!.rating = rating; currentTrial!.completed = true; currentTrial!.endedAt = new Date().toISOString();
      log('trial-completed'); records.save();
      if (trialIndex === 1) beginTrial(2);
      else { trialStage = 'choose'; currentTrial = undefined; resetScene('answer', false); renderComparison(); }
    } else if (action === 'choice') {
      currentPair!.choice = button.dataset.choice; currentPair!.endedAt = new Date().toISOString();
      log('pair-choice', { reason: button.dataset.choice }); records.save(true);
      trialStage = 'done'; currentTrial = undefined; controlsState(); setGain(1, false); renderComparison();
    } else if (action === 'cancel') {
      if (currentTrial) { currentTrial.interrupted = true; currentTrial.endedAt = new Date().toISOString(); }
      if (currentPair) currentPair.endedAt = new Date().toISOString();
      log('pair-cancelled'); trialStage = 'none'; currentTrial = undefined; currentPair = undefined;
      controlsState(); resetScene('comparison-cancelled', false); setGain(1, false); renderComparison(); records.save();
    }
  });

  function suspend(reason: string) { endPointer(reason); rear.disarm(); engine.release(reason); interruptTrial(reason); records.save(true); }
  window.addEventListener('blur', () => suspend('window-blur'));
  document.addEventListener('visibilitychange', () => { if (document.hidden) suspend('page-hidden'); });
  window.addEventListener('pagehide', () => { suspend('page-hide'); disposed = true; socket.close(); scene.dispose(); });
  window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
  scene.setResizeHandler(() => resetScene('resize'));
  updateSettingsUi(); resetScene('initial', false); setGain(1, false); renderComparison();
  networkLinks($('network-links'));
  log('session-open');

  function frame(now: number) {
    if (disposed) return;
    const dt = Math.min(0.04, (now - previousFrame) / 1000); previousFrame = now;
    let sample: InputSample;
    const remote = rear.sample(now);
    if (mode === 'surface') {
      if (pointer) surfaceRoot = scene.worldRoot(pointer.x, pointer.y, settings.offsetX, settings.offsetY);
      else for (const axis of ['x', 'y', 'z'] as const) surfaceRoot[axis] += (guide[axis] - surfaceRoot[axis]) * (1 - Math.exp(-dt * 6));
      const vec = frontVector();
      sample = { root: copy(surfaceRoot), tip: { x: surfaceRoot.x + vec.x, y: surfaceRoot.y + vec.y, z: rest.z },
        active: !!pointer && trialStage !== 'choose',
        eligible: !!pointer?.eligible && Math.abs(surfaceRoot.x + vec.x - rest.x) < 34,
        value: inputValue, source: 'surface' };
    } else {
      if (previousRearStatus !== remote.status) {
        if (remote.status === 'lost') { engine.release('tracking-lost'); interruptTrial('tracking-lost'); }
        log('tracking-' + remote.status); previousRearStatus = remote.status;
      }
      const source = rear.source;
      if (currentSource !== source && currentTrial?.contacts.length) interruptTrial('input-source-changed');
      currentSource = source;
      sample = { root: copy(guide), tip: { x: 0, y: rest.y - 17 + remote.value * engine.travel,
        z: rest.z + 18 * Math.sin(remote.value * Math.PI / 2) },
        active: remote.active && !document.hidden && trialStage !== 'choose', eligible: true, value: remote.value, source, seq: rear.seq };
    }
    engine.tick(dt, sample);
    for (const event of engine.drainEvents()) {
      log(event.kind, { reason: event.reason, value: event.value, lift: event.lift, seq: event.seq, source: event.source });
      if (trialStage === 'present' && currentTrial && !currentTrial.interrupted) {
        if (event.kind === 'contact') { currentTrial.contacts.push(new Date().toISOString()); currentTrial.source = event.source; }
        if (event.kind === 'lift') hasLifted = true;
        if (event.kind === 'release') { currentTrial.releases.push(new Date().toISOString()); if (hasLifted) released = true; }
        renderComparison(); records.save();
      }
    }
    scene.render({ root: sample.root, tip: engine.tip, product: engine.product, rest, mode, display,
      width: settings.width, visible: true, held: engine.held, value: sample.value });
    debug = { mode, display, gain: engine.gain, root: copy(sample.root), rootScreen: scene.screenPoint(sample.root),
      tip: copy(engine.tip), product: copy(engine.product), held: engine.held, phase: engine.phase, lift: engine.lift,
      guide: scene.screenPoint({ x: guide.x - settings.offsetX, y: guide.y + settings.offsetY, z: 0 }), travel: engine.travel,
      inputValue: sample.value, rearStatus: remote.status, source: currentSource, trialStage, trialIndex };
    if (now - lastUi > 100) {
      lastUi = now;
      const status = mode === 'surface' ? (pointer ? engine.held ? 'ループを持っています' : pointer.eligible ? '上へ動かして引っ掛ける' : '丸いガイドから始めてください' : 'タッチを待っています') :
        ({ waiting: 'PCの追跡入力を待っています', neutral: 'いったん指を伸ばしてください', ready: engine.held ? '曲げ量で持ち上げています' : '追跡中 · 曲げると持ち上げる', holding: '一時的な追跡の途切れ · 姿勢を保持', lost: '追跡が途切れました · 伸ばして再開' }[remote.status]);
      $('status-label').textContent = status; $('input-status').dataset.state = mode === 'rear' ? remote.status : engine.phase;
      $('status-value').textContent = Math.round(sample.value * 100) + '%'; $('signal-fill').style.width = sample.value * 100 + '%';
      $('sim-banner').hidden = mode !== 'rear' || rear.source !== 'simulation';
      $('start-guide').classList.toggle('active', !!pointer);
      const phaseText = engine.held ? ['✓', 'ループが掛かりました。そっと持ち上げる', mode === 'surface' ? '指を離すと放します。指の根元は実タッチ位置についてきます。' : '指を伸ばして戻すとポーチを放します。'] : mode === 'surface' ? ['↑', '丸いガイドに触れて、そのまま上へ', '短く動かすとループが掛かります。指を離すとポーチを放します。'] : ['↗', '端末の背面で、第一関節を曲げ戻し', status];
      $('hint-icon').textContent = phaseText[0]; $('hint-title').textContent = phaseText[1]; $('hint-copy').textContent = phaseText[2];
      $('record-count').textContent = records.data.pairs.filter(pair => pair.choice).length + ' 組';
      $('storage-note').textContent = records.storageError || '自動でローカル保存 · 映像は記録しません';
      $('stage').dataset.phase = engine.phase;
    }
    requestAnimationFrame(frame);
  }
  if (import.meta.env.DEV) (window as unknown as { __fingertip: unknown }).__fingertip = { snapshot: () => structuredClone(debug) };
  requestAnimationFrame(frame);
}
