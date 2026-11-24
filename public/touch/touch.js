// iPad only, no server. The back of the middle phalanx lies on the glass and points from PIP TOWARD THE PERSON
// (same as the confirmed 3D page, public/stage): the contact is therefore below PIP on the screen.
//  1. the screen shows where and how to put the finger, and says from the touch whether it is right
//  2. when it is, the virtual finger is drawn at once; its root follows where the finger really is, then stays
//  3. optional: the DIP bend is learned from the touch (ml.js). Touch cannot tell PIP: set by hand.
import * as ML from './ml.js?v=3';

const $ = (s) => document.querySelector(s), now = () => performance.now(), FAST = new URLSearchParams(location.search).has('fast') ? 3 : 1; // fast: tests only
const MM = 0.1924, DIA = 15, LM = 25, LD = 22; // mm per CSS px (iPad A16); size of the drawn finger
const LANE = 14, SIDE = 4, BAND = 7, STILL = 1.2; // mm: what belongs to the finger / allowed sideways / allowed up-down / allowed movement
const ROUNDS = 3, SEG = 8.4, SKIP = 0.6, RELAX = 12, CURL = 60; // RELAX, CURL: only how far the drawing bends between relaxed and curled
const S = { touches: [], cancels: 0, sizes: new Set(), place: null, lost: 0, hist: [], fh: [], run: null, samples: [], raw: [], plan: {}, model: null, est: null, display: null, judge: null };
const offset = () => +$('#off').value; // from the middle of the contact up to PIP (the person sets it by eye)

// ---------- touch ----------
const onUi = (t) => !!t.target?.closest?.('.btn, .ui');
function read(e) {
  if (e.type === 'touchcancel') S.cancels++;
  S.touches = [...e.touches].filter((t) => !onUi(t)).map((t) => ({ x: (t.clientX - innerWidth / 2) * MM, y: (innerHeight / 2 - t.clientY) * MM, rx: (t.radiusX || 0) * MM, ry: (t.radiusY || 0) * MM, a: t.rotationAngle || 0, f: t.force || 0 }));
  if (e.cancelable && !onUi(e)) e.preventDefault(); // no magnifier, scroll or zoom under the finger
}
for (const n of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) addEventListener(n, read, { passive: false });
for (const n of ['gesturestart', 'contextmenu', 'dblclick']) addEventListener(n, (e) => e.preventDefault());
// contacts of the finger: in the lane while it is being placed, around the place afterwards. The rest is the hand
const mine = () => S.touches.filter((t) => (S.place ? Math.abs(t.x - S.place.x) <= LANE && Math.abs(t.y - S.place.y) <= 25 : Math.abs(t.x) <= 2 * LANE && t.y <= 25 && t.y >= -50));

// ---------- is the finger where the screen asks? (30 Hz) ----------
function judge(f) {
  const ch = [], want = -offset();
  if (!f) return { ok: false, ch: [{ ok: false, t: '指が触れている', v: 'まだ' }], msg: '中節の背を、青い楕円に置く' };
  const x = f[5], y = f[6], dx = -x, dy = want - y, H = S.hist;
  H.push({ t: now(), x, y }); while (H.length && now() - H[0].t > 700 / FAST) H.shift();
  const still = H.length >= 8 && now() - H[0].t > 500 / FAST && Math.max(...H.map((q) => Math.hypot(q.x - x, q.y - y))) < STILL;
  const a = Math.abs(dx) <= SIDE, b = Math.abs(dy) <= BAND;
  ch.push({ ok: true, t: '指が触れている', v: '' });
  ch.push({ ok: a, t: '左右', v: a ? '合っている' : `あと ${Math.abs(dx).toFixed(0)} mm ${dx > 0 ? '右' : '左'}へ` });
  ch.push({ ok: b, t: '上下', v: b ? '合っている' : `あと ${Math.abs(dy).toFixed(0)} mm ${dy > 0 ? '上' : '下'}へ` });
  ch.push({ ok: still, t: '止まっている', v: still ? '' : 'そのまま待つ' });
  const bad = ch.find((c) => !c.ok);
  return { ok: !bad, ch, msg: bad ? (bad.t === '止まっている' ? 'そのまま待つ' : bad.v.replace('あと', '指を')) : '', x, y };
}
setInterval(() => {
  const list = mine(), f0 = ML.features(list), R = S.run;
  for (const t of list) S.sizes.add(`${t.rx.toFixed(2)}x${t.ry.toFixed(2)}`);
  if (!S.place) {
    S.judge = judge(f0); if (!f0) S.hist = [];
    if (S.judge.ok) { S.place = { x: S.judge.x, y: S.judge.y }; S.lost = 0; S.fh = []; S.est = null; }
    return;
  }
  if (!f0) { S.est = null; S.fh = []; S.lost ||= now(); if (now() - S.lost > 600 / FAST) { S.place = null; S.hist = []; } return; }
  S.lost = 0;
  const f = f0.slice(); f[5] -= S.place.x; f[6] -= S.place.y; // relative to this placement
  S.fh.push(f); if (S.fh.length > 7) S.fh.shift();
  const x = ML.withMotion(f, S.fh.length > 6 ? S.fh[0] : null);
  if (R?.t0) {
    const t = (now() - R.t0) / 1000 * FAST;
    if (t <= SEG) { if (t >= SKIP) S.samples.push({ round: R.round, seg: 'press', t, x }); S.raw.push({ round: R.round, t: +t.toFixed(3), place: S.place, list: S.touches }); }
  }
  if (!R && S.model?.predict) { const y = Math.max(0, Math.min(1.15, S.model.predict(x)[0])); S.est = S.est == null ? y : S.est + 0.35 * (y - S.est); }
}, 33 / FAST);

// ---------- learning: relaxed <-> comfortably curled, following the picture ----------
const traj = (round, seg, t) => ({ dip: (1 - Math.cos(2 * Math.PI / S.plan[round] * t)) / 2 });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let msg = '';
function say(t, quiet) {
  msg = t; if (quiet || !t || FAST > 1) return;
  try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(t); u.lang = 'ja-JP'; u.rate = 1.15; speechSynthesis.speak(u); } catch {}
}
const check = (R) => { if (R.stop) throw new Error('stop'); };
async function until(f, ms, R) { const t = now(); while (!f()) { check(R); if (now() - t > ms) return false; await wait(30); } return true; }
async function sleep(sec, R) { const t = now(); while (now() - t < sec * 1000 / FAST) { check(R); await wait(16); } }
async function run() {
  const R = S.run = { stop: false, round: 0, t0: 0, show: false };
  S.samples = []; S.raw = []; S.plan = {}; S.model = null; S.est = null; S.sizes.clear(); S.cancels = 0; $('#res').innerHTML = ''; $('#share').hidden = true; $('#go').textContent = 'やめる'; $('#panel').hidden = true;
  try {
    for (let round = 1; round <= ROUNDS; round++) {
      R.round = round; S.plan[round] = 2.5 + 0.9 * Math.random(); // a different speed every time
      if (S.place || mine().length) { say('指をいちど離す'); if (!await until(() => !S.place && !mine().length, 20000, R)) throw new Error('まだ指が触れています。画面から離して、もう一度［DIPを学習］'); await sleep(0.4, R); }
      say(''); R.guide = true; if (round === 1) say('中節の背を、青い楕円に置く'); msg = ''; // the guide itself says what to do
      if (!await until(() => S.place, 60000, R)) throw new Error('指の位置が合いませんでした。もう一度［DIPを学習］'); R.guide = false;
      R.show = true; say('絵に合わせて、楽な範囲で、先の関節を曲げ伸ばす'); await sleep(2.2, R);
      R.t0 = now(); await sleep(SEG, R); R.t0 = 0; R.show = false; $('#prog').style.width = `${100 * round / ROUNDS}%`;
    }
    say('学習しています'); S.model = await ML.train(S.samples, traj, { tick: async () => { check(R); await wait(0); } }); result();
    const s = S.model.predict && S.model.score[0].verdict;
    say(!s ? '接触が足りず学習できません。もう一度［DIPを学習］' : s === 'no' ? 'タッチからはDIPを読めませんでした。［調整］の数字を見てください' : 'おわり。曲げ伸ばすと、画面の中の指先が動きます');
    const m = msg; setTimeout(() => { if (!S.run && msg === m) msg = ''; }, 6000 / FAST);
  } catch (e) { S.model = null; say(e.message === 'stop' ? '' : e.message, e.message === 'stop'); }
  S.run = null; $('#go').textContent = S.model?.predict ? 'もう一度学習' : 'DIPを学習（約40秒）'; $('#prog').style.width = '0';
}
const usable = () => !!S.model?.predict && S.model.score[0].verdict !== 'no';
const HEAD = { yes: '読めそう', some: '少しだけ読める', no: '読めない' };
function result() {
  const m = S.model, row = (a, b) => `<tr><td>${a}</td><td>${b}</td></tr>`, pc = (v) => `${(100 * v).toFixed(0)}%`;
  $('#res').innerHTML = m.predict ? `<div class="big ${m.score[0].verdict}">DIP：${HEAD[m.score[0].verdict]}</div><table>${row('推定の誤差（曲げ幅に対して）', pc(m.score[0].err))}${row('タッチを使わない場合', pc(m.score[0].base))}${row('相関', m.score[0].r.toFixed(2))}${row('使った計算', m.kind[0] === 'net' ? 'ニューラルネット' : '直線の式')}${row('学習データ', `${m.rows} 個`)}${row('大きさの細かさ（種類）', S.sizes.size)}${S.cancels ? row('iPadが打ち切った接触', S.cancels) : ''}</table>` : `<div class="big no">学習できません（使えた回 ${m.rounds} / ${ROUNDS}）</div>`;
  $('#share').hidden = false;
}
$('#go').onclick = () => { if (S.run) S.run.stop = true; else run(); };
$('#set').onclick = () => { $('#panel').hidden = !$('#panel').hidden; };
$('#share').onclick = async () => {
  const { predict, ...m } = S.model || {};
  const file = new File([JSON.stringify({ at: new Date().toISOString(), screen: [innerWidth, innerHeight], mmPerPx: MM, offset: offset(), plan: S.plan, model: m, sizes: S.sizes.size, cancels: S.cancels, raw: S.raw })], `touch-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`, { type: 'application/json' });
  try { if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file] }); return; } } catch (e) { if (e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
};

// ---------- drawing ----------
const pad = $('#pad'), px = pad.getContext('2d'), fx = $('#fig').getContext('2d');
// side view, the person on the left: proximal up from PIP, middle flat on the glass toward the person, distal lifted by DIP
function side(dip) {
  const g = 330, r = 22, P = [400, g - r], D = [250, g - r], a = +$('#pip').value * Math.PI / 180, b = dip * Math.PI / 180, text = (t, x, y, c, al = 'center') => { fx.fillStyle = c; fx.textAlign = al; fx.fillText(t, x, y); };
  fx.clearRect(0, 0, 600, 460); fx.font = '700 24px system-ui, sans-serif'; fx.lineCap = 'round'; fx.lineWidth = 2 * r;
  const line = (c, p, q) => { fx.strokeStyle = c; fx.beginPath(); fx.moveTo(...p); fx.lineTo(...q); fx.stroke(); };
  line('#4a86e8', P, [P[0] - 230 * Math.cos(a), P[1] - 230 * Math.sin(a)]);
  line('#f0953a', D, [D[0] - 120 * Math.cos(b), D[1] - 120 * Math.sin(b)]);
  line('#8b93a1', P, D);
  fx.fillStyle = '#eef0f3'; fx.fillRect(30, g + 1, 540, 5); fx.fillStyle = '#ff4d4d'; fx.beginPath(); fx.arc(...P, 9, 0, 7); fx.fill();
  fx.fillStyle = '#5aa9ff'; fx.fillRect(D[0], g + 8, P[0] - D[0], 8);
  text('ここ（背）を付ける', (D[0] + P[0]) / 2, g + 46, '#5aa9ff'); text('第二関節', P[0] + 34, P[1] + 8, '#ff8a8a', 'left'); text('手前', 34, g + 46, '#9aa1ab', 'left'); text('奥', 566, g + 46, '#9aa1ab', 'right');
}
function guide(W, H, j) { // where to put the finger, seen from above
  const X = (x) => W / 2 + x / MM, Y = (y) => H / 2 - y / MM, w = DIA / 2 + 1, c = j?.ok ? '#3ecf8e' : '#ff3b3b', cy = -offset();
  px.lineWidth = 3; px.fillStyle = 'rgba(255,255,255,.35)'; px.fillRect(X(-w), Y(0), 2 * w / MM, 46 / MM);
  px.strokeStyle = '#59616e'; px.setLineDash([10, 8]); px.beginPath(); for (const s of [-1, 1]) { px.moveTo(X(s * w), Y(0)); px.lineTo(X(s * w), Y(-46)); } px.stroke(); px.setLineDash([]);
  px.strokeStyle = c; px.lineWidth = 5; px.beginPath(); px.moveTo(X(-45), Y(0)); px.lineTo(X(45), Y(0)); px.stroke(); // PIP: long enough to be seen beside the finger
  px.fillStyle = 'rgba(40,120,255,.18)'; px.strokeStyle = '#2878ff'; px.lineWidth = 3; px.setLineDash([8, 6]); px.beginPath(); px.ellipse(X(0), Y(cy), 5 / MM, 8 / MM, 0, 0, 7); px.fill(); px.stroke(); px.setLineDash([]);
  px.font = '700 18px system-ui, sans-serif'; px.textBaseline = 'middle';
  const lab = (t, x, y, col, al) => { px.textAlign = al; const m = px.measureText(t).width + 16, x0 = al === 'left' ? x - 8 : al === 'right' ? x - m + 8 : x - m / 2; px.fillStyle = 'rgba(21,23,28,.85)'; px.beginPath(); px.roundRect(x0, y - 16, m, 32, 8); px.fill(); px.fillStyle = col; px.fillText(t, x, y); };
  lab('第二関節を、この線に合わせる', X(14), Y(5), '#ff9c9c', 'left'); lab('背が触れる所', X(12), Y(cy), '#8fc1ff', 'left'); lab('手は手前から', X(0), Y(-52), '#eef0f3', 'center');
  if (j?.x != null && !j.ok) { // which way to move
    const fx0 = X(j.x), fy0 = Y(j.y), tx = X(0), ty = Y(cy), L = Math.hypot(tx - fx0, ty - fy0);
    if (L > 12) { const ux = (tx - fx0) / L, uy = (ty - fy0) / L; px.strokeStyle = px.fillStyle = '#e08a00'; px.lineWidth = 6; px.beginPath(); px.moveTo(fx0, fy0); px.lineTo(tx - 10 * ux, ty - 10 * uy); px.stroke(); px.beginPath(); px.moveTo(tx, ty); px.lineTo(tx - 20 * ux - 10 * uy, ty - 20 * uy + 10 * ux); px.lineTo(tx - 20 * ux + 10 * uy, ty - 20 * uy - 10 * ux); px.fill(); }
  }
}
function draw() {
  const dpr = devicePixelRatio || 1, W = innerWidth, H = innerHeight, R = S.run, open = !$('#panel').hidden;
  if (pad.width !== Math.round(W * dpr) || pad.height !== Math.round(H * dpr)) { pad.width = Math.round(W * dpr); pad.height = Math.round(H * dpr); }
  px.setTransform(dpr, 0, 0, dpr, 0, 0); px.clearRect(0, 0, W, H);
  const placing = !S.place && (!R || R.guide);
  if (placing) guide(W, H, S.judge);
  if (placing || open) for (const t of S.touches) { px.fillStyle = 'rgba(40,120,255,.45)'; px.beginPath(); px.ellipse(W / 2 + t.x / MM, H / 2 - t.y / MM, Math.max(4, t.rx / MM), Math.max(4, t.ry / MM), t.a * Math.PI / 180, 0, 7); px.fill(); }
  // left card: how to place it / the picture to follow
  const q = R?.show ? traj(R.round, 'press', R.t0 ? Math.min(SEG, (now() - R.t0) / 1000 * FAST) : 0).dip : 0;
  $('#left').hidden = !(placing || R?.show);
  if (placing || R?.show) { side(R?.show ? RELAX + (CURL - RELAX) * q : RELAX); $('#cap').textContent = R?.show ? 'この動きに合わせる' : '横から見た置き方'; $('#checks').innerHTML = placing && S.judge ? S.judge.ch.map((c) => `<li class="${c.ok ? 'ok' : 'ng'}">${c.ok ? '✓' : '・'} ${c.t}<span class="v">${c.v}</span></li>`).join('') : ''; }
  // message
  const dip = usable() ? (S.est == null ? null : RELAX + (CURL - RELAX) * S.est) : +$('#dip').value;
  const t = msg || (placing ? `${R ? `${R.round}/${ROUNDS}回目　` : ''}${S.judge?.msg || ''}` : S.place && !R ? (usable() ? `曲げ ${S.est == null ? '—' : Math.round(Math.min(1, S.est) * 100)}%` : '') : '');
  if ($('#now').textContent !== t) $('#now').textContent = t;
  $('#dipL').hidden = usable();
  if (open) {
    const f = ML.features(mine());
    $('#offV').textContent = `${offset()} mm`; $('#pipV').textContent = `${$('#pip').value}°`; $('#dipV').textContent = `${$('#dip').value}°`;
    $('#vals').innerHTML = [['接触の数', f ? f[0] : '—'], ['接触の大きさ（面積の平方根）', f ? `${f[1].toFixed(2)} mm` : '—'], ['接触の中心（線から下へ）', f ? `${(-f[6]).toFixed(1)} mm` : '—']].map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('');
  }
  if (S.display) {
    const d = S.display; d.setFingerVisible(!!S.place && !R);
    if (S.place) d.pip.set(S.place.x, S.place.y + offset()); // the root goes where the finger is, then stays
    if (dip != null) d.setPose(+$('#pip').value, dip, !!S.place && !S.lost);
    d.render({ x: 0, y: -100, z: 460 });
  }
  requestAnimationFrame(draw);
}
if (!('ontouchstart' in window || navigator.maxTouchPoints)) msg = 'iPadで開いてください（タッチ画面が必要です）';
try { navigator.wakeLock?.request('screen').catch(() => {}); } catch {}
draw();
window.touchlab = { S, traj };
try {
  const THREE = await import('three'), { Display } = await import('../sync/display.js');
  class Finger extends Display {
    buildBox() { super.buildBox(); for (const m of [...this.root.children]) if (['RingGeometry', 'CircleGeometry'].includes(m.geometry?.type)) this.root.remove(m); } // the guide is drawn here instead
    geometry(thp, thd) { // as in the 3D page: the palm side of the virtual finger faces the person, so bending goes deeper and back toward the person
      const G = super.geometry(thp, thd), e = (thp + thd) * Math.PI / 180;
      G.dd = new THREE.Vector3(0, Math.cos(e), -Math.sin(e)); G.tip = G.vdip.clone().addScaledVector(G.dd, this.cfg.Ld); return G;
    }
  }
  const d = new Finger($('#scene')), layout = () => d.layout({ mmPerPx: MM, pipFrac: { x: 0.5, y: 0.5 }, Lm: LM, Ld: LD, dia: DIA, fullBox: true, sideLight: true });
  layout(); addEventListener('resize', layout); S.display = d;
} catch (e) { msg = `仮想指を描画できません（${e.message}）。再読み込みしてください`; }
