// iPad only, no server. The back of the middle phalanx rests on the ring. The person follows a moving picture of a finger;
// from that a small neural network learns DIP and PIP from the touch contacts (ml.js), and the virtual finger is drawn with them.
// Nothing is kept between people or places: the learning is done by the same person every time.
import * as ML from './ml.js';

const $ = (s) => document.querySelector(s), now = () => performance.now(), FAST = new URLSearchParams(location.search).has('fast') ? 3 : 1; // fast: tests only
const MM = 0.1924, NEAR = 30; // mm per CSS px (iPad A16). Contacts further than NEAR mm from the ring are the hand, not the finger
const ROUNDS = 4, PREP = 2.2, SEG = { dip: 8, pip: 8, both: 8 }, SKIP = 0.8; // seconds; the first SKIP of a segment is not learned
const SAY = { dip: '先の関節だけ、絵に合わせて動かす', pip: '第二関節だけ、絵に合わせて動かす', both: '両方いっしょに、絵に合わせて動かす' };
const START = '○に中節の背を置いて［キャリブレート］', HOME = 70;
const S = { touches: [], cancels: 0, cancel0: 0, sizes: new Set(), run: null, samples: [], raw: [], plan: {}, model: null, est: null, last: null, fh: [], display: null, info: true };

// the movement of the picture. DIP 0-60, PIP 40-100; only one joint, then the other, then both
function traj(round, seg, t) {
  const p = S.plan[round][seg], w = 2 * Math.PI / p.T;
  return { dip: seg === 'pip' ? 0 : 30 - 30 * Math.cos(w * t), pip: seg === 'dip' ? HOME : HOME + 30 * p.sign * Math.sin(w * t * (seg === 'both' ? p.k : 1)) };
}

// ---------- touch ----------
const onUi = (t) => !!t.target?.closest?.('.btn, .ui');
function read(e) {
  if (e.type === 'touchcancel') S.cancels++;
  S.touches = [...e.touches].filter((t) => !onUi(t)).map((t) => ({ x: (t.clientX - innerWidth / 2) * MM, y: (innerHeight / 2 - t.clientY) * MM, rx: (t.radiusX || 0) * MM, ry: (t.radiusY || 0) * MM, a: t.rotationAngle || 0, f: t.force || 0 }));
  if (e.cancelable && !onUi(e)) e.preventDefault(); // no magnifier, scroll or zoom under the finger
}
for (const n of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) addEventListener(n, read, { passive: false });
for (const n of ['gesturestart', 'contextmenu', 'dblclick']) addEventListener(n, (e) => e.preventDefault());
const near = () => S.touches.filter((t) => Math.hypot(t.x, t.y) <= NEAR);
// a still finger makes no events, so the current contacts are sampled at 30 Hz
setInterval(() => {
  const list = near(), f = ML.features(list), R = S.run;
  for (const t of list) S.sizes.add(`${t.rx.toFixed(2)}x${t.ry.toFixed(2)}`);
  if (!f) { S.fh = []; S.est = null; } else { S.fh.push(f); if (S.fh.length > 7) S.fh.shift(); }
  const x = f && ML.withMotion(f, S.fh.length > 6 ? S.fh[0] : null);
  if (R?.seg && R.t0) {
    const t = (now() - R.t0) / 1000 * FAST;
    if (t <= SEG[R.seg]) { if (x && t >= SKIP) S.samples.push({ round: R.round, seg: R.seg, t, x }); S.raw.push({ round: R.round, seg: R.seg, t: +t.toFixed(3), list: S.touches }); }
  }
  if (!R && S.model?.predict && x) {
    const [d, p] = S.model.predict(x), y = [Math.max(0, Math.min(75, d)), Math.max(25, Math.min(115, p))];
    S.est = S.est ? S.est.map((v, i) => v + 0.35 * (y[i] - v)) : y; S.last = S.est;
  }
}, 33);

// ---------- calibration ----------
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function say(t, quiet) {
  $('#now').textContent = t; if (quiet || FAST > 1) return;
  try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(t); u.lang = 'ja-JP'; u.rate = 1.15; speechSynthesis.speak(u); } catch {}
}
const check = (R) => { if (R.stop) throw new Error('stop'); };
async function until(f, ms, R) { const t = now(); while (!f()) { check(R); if (now() - t > ms) return false; await wait(30); } return true; }
async function sleep(sec, R) { const t = now(); while (now() - t < sec * 1000 / FAST) { check(R); await wait(16); } }
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
async function run() {
  const R = S.run = { stop: false, round: 0, seg: null, t0: 0 }; let k = 0;
  S.samples = []; S.raw = []; S.plan = {}; S.model = null; S.est = S.last = null; S.sizes.clear(); S.cancel0 = S.cancels; S.info = true;
  $('#res').innerHTML = ''; $('#share').hidden = true; $('#go').textContent = 'やめる'; view();
  try {
    for (let round = 1; round <= ROUNDS; round++) {
      // the order and the speed differ in every round, so that nothing but the touch can be learned
      const order = shuffle(['dip', 'pip', 'both']);
      R.round = round; S.plan[round] = Object.fromEntries(order.map((s) => [s, { T: 3.2 + 1.4 * Math.random(), sign: Math.random() < 0.5 ? -1 : 1, k: 0.6 + 0.3 * Math.random() }]));
      if (near().length) { say('指をいちど離す'); if (!await until(() => !near().length, 20000, R)) throw new Error('まだ○の近くに触れています。手が画面に触れていないか見てください'); await sleep(0.5, R); }
      say(`○に中節の背を置く（${round}/${ROUNDS}回目）`); if (!await until(() => near().length, 30000, R)) throw new Error('○の近くに接触がありません。もう一度［キャリブレート］');
      for (const seg of order) {
        R.seg = seg; R.t0 = 0; say(SAY[seg]); await sleep(PREP, R);
        R.t0 = now(); await sleep(SEG[seg], R); R.seg = null; R.t0 = 0;
        $('#prog').style.width = `${100 * ++k / (ROUNDS * 3)}%`;
      }
    }
    say('学習しています'); $('#left').hidden = true;
    S.model = await ML.train(S.samples, traj, { tick: async () => { check(R); await wait(0); } });
    S.run = null; S.info = !S.model.predict; result();
    say(S.model.predict ? 'おわり。曲げ伸ばしすると、画面の中の指が動きます' : '接触が足りず学習できません。もう一度［キャリブレート］');
    if (S.model.predict) setTimeout(() => { if (!S.run) { $('#now').textContent = ''; view(); } }, 3500 / FAST);
  } catch (e) { S.model = null; say(e.message === 'stop' ? START : e.message, e.message === 'stop'); }
  S.run = null; $('#go').textContent = S.model?.predict ? 'もう一度キャリブレート' : 'キャリブレート（約2分）'; $('#prog').style.width = '0'; view();
}
const HEAD = { yes: '読めそう', some: '少しだけ読める', no: '読めない' };
function result() {
  const m = S.model, can = S.cancels - S.cancel0, row = (a, b) => `<tr><td>${a}</td><td>${b}</td></tr>`;
  const joint = (name, s, kind) => `<div class="big ${s.verdict}">${name}：${HEAD[s.verdict]}</div><table>${row('推定の誤差（平均）', `約 ${s.err.toFixed(0)}°`)}${row('タッチを使わない場合', `約 ${s.base.toFixed(0)}°`)}${row('相関', s.r.toFixed(2))}${row('使った計算', kind === 'net' ? 'ニューラルネット' : '直線の式')}</table>`;
  $('#res').innerHTML = (m.predict ? joint('先の関節', m.score[0], m.kind[0]) + joint('第二関節', m.score[1], m.kind[1]) : '<div class="big no">学習できません</div>')
    + `<table style="margin-top:10px">${m.predict ? row('第二関節だけの時、先の関節の誤差', `約 ${m.cross.dipWhenPip.toFixed(0)}°`) + row('学習データ', `${m.rows} 個`) + row('反応の遅れ', `${m.lag.toFixed(1)} 秒`) : row('使えた回', `${m.rounds} / ${ROUNDS}`)}${row('大きさの細かさ（種類）', S.sizes.size)}${can ? row('iPadが打ち切った接触', can) : ''}</table>`;
  $('#share').hidden = false;
}
// while the finger is being drawn only the finger is on screen; the numbers on request
function view() {
  const live = !S.run && !!S.model?.predict, msg = !!$('#now').textContent;
  $('#chip').hidden = !live || msg; $('#info').hidden = !live; $('#right').hidden = live && !S.info; $('#share').hidden = !(live && S.info) && !(S.model && !S.run);
  $('#pipBox').hidden = !(live && S.model.score[1].verdict === 'no'); // the touch cannot tell PIP: set it by hand
  $('#info').textContent = S.info ? '数字をかくす' : '数字を見る';
}
$('#go').onclick = () => { if (S.run) S.run.stop = true; else run(); };
$('#info').onclick = () => { S.info = !S.info; view(); };
$('#pip').oninput = () => { $('#pipV').textContent = `${$('#pip').value}°`; };
$('#share').onclick = async () => {
  const { predict, ...m } = S.model || {};
  const data = JSON.stringify({ at: new Date().toISOString(), screen: [innerWidth, innerHeight], mmPerPx: MM, plan: S.plan, model: m, sizes: S.sizes.size, cancels: S.cancels - S.cancel0, raw: S.raw });
  const file = new File([data], `touch-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`, { type: 'application/json' });
  try { if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file] }); return; } } catch (e) { if (e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
};

// ---------- drawing ----------
const pad = $('#pad'), px = pad.getContext('2d'), fx = $('#fig').getContext('2d');
function finger(dip, pip) { // side view: middle phalanx on the glass, proximal up to the left by PIP, distal up to the right by DIP
  const y = 440, x0 = 230, x1 = 360, a = pip * Math.PI / 180, b = dip * Math.PI / 180;
  fx.clearRect(0, 0, 600, 540); fx.fillStyle = '#4a515e'; fx.fillRect(20, y + 24, 560, 6);
  fx.lineCap = fx.lineJoin = 'round'; fx.lineWidth = 46;
  const line = (c, ...q) => { fx.strokeStyle = c; fx.beginPath(); q.forEach((v, i) => (i ? fx.lineTo(...v) : fx.moveTo(...v))); fx.stroke(); };
  line('#8b93a1', [x0, y], [x0 - 230 * Math.cos(a), y - 230 * Math.sin(a)]);
  line('#f5b84b', [x1, y], [x1 + 120 * Math.cos(b), y - 120 * Math.sin(b)]);
  line('#4a86e8', [x0, y], [x1, y]);
}
function draw() {
  const dpr = devicePixelRatio || 1, W = innerWidth, H = innerHeight, R = S.run, live = !R && !!S.model?.predict;
  if (pad.width !== Math.round(W * dpr) || pad.height !== Math.round(H * dpr)) { pad.width = Math.round(W * dpr); pad.height = Math.round(H * dpr); }
  px.setTransform(dpr, 0, 0, dpr, 0, 0); px.clearRect(0, 0, W, H);
  if (!live || S.info) { // what the sensor reports, over the picture
    for (const t of S.touches) {
      px.fillStyle = Math.hypot(t.x, t.y) <= NEAR ? 'rgba(40,120,255,.5)' : 'rgba(90,97,108,.3)';
      px.beginPath(); px.ellipse(W / 2 + t.x / MM, H / 2 - t.y / MM, Math.max(4, t.rx / MM), Math.max(4, t.ry / MM), t.a * Math.PI / 180, 0, 7); px.fill();
    }
    const f = ML.features(near());
    $('#vals').innerHTML = [['接触の数', f ? f[0] : '—'], ['接触の大きさ（面積の平方根）', f ? `${f[1].toFixed(2)} mm` : '—'], ['接触の長さ', f ? `${f[2].toFixed(2)} mm` : '—']].map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('');
  }
  $('#left').hidden = !R?.seg;
  if (R?.seg) { const q = traj(R.round, R.seg, R.t0 ? Math.min(SEG[R.seg], (now() - R.t0) / 1000 * FAST) : 0); finger(q.dip, q.pip); }
  if (live) {
    const [sd, sp] = S.model.score, ref = (s) => (s.verdict === 'no' ? '（参考）' : '');
    $('#chip').textContent = S.est ? `先の関節 約${Math.round(S.est[0])}°${ref(sd)}　第二関節 ${sp.verdict === 'no' ? `${$('#pip').value}°（手動）` : `約${Math.round(S.est[1])}°`}` : '○に中節の背を置く';
  }
  if (S.display) { // not touching: the last pose stays, pale
    S.display.setFingerVisible(live && !!S.last);
    if (S.last) S.display.setPose(S.model?.score?.[1].verdict === 'no' ? +$('#pip').value : S.last[1], S.last[0], !!S.est);
    S.display.render({ x: 0, y: -100, z: 460 });
  }
  requestAnimationFrame(draw);
}
say('ontouchstart' in window || navigator.maxTouchPoints ? START : 'iPadで開いてください（タッチ画面が必要です）', true);
try { navigator.wakeLock?.request('screen').catch(() => {}); } catch {}
draw();
window.touchlab = { S, traj };
try { // the same virtual finger as the iPad + iPhone version
  const { Display } = await import('../sync/display.js'), d = new Display($('#scene'));
  const layout = () => d.layout({ mmPerPx: MM, pipFrac: { x: 0.5, y: 0.5 }, Lm: 25, Ld: 22, dia: 15, fullBox: true, sideLight: true });
  layout(); addEventListener('resize', layout); S.display = d;
} catch (e) { $('#now').textContent = `仮想指を描画できません（${e.message}）。再読み込みしてください`; }
