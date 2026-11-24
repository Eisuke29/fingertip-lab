// iPad only, no server: the back of the middle phalanx rests on the ring. From what the touch sensor reports
// (contacts between PIP and DIP) the DIP bend is estimated after a calibration done by the same person, every time.
import * as M from './touchmodel.js';

const $ = (s) => document.querySelector(s), now = () => performance.now(), FAST = new URLSearchParams(location.search).has('fast') ? 0.25 : 1; // fast: tests only
const MM = 0.1924, NEAR = 30; // mm per CSS px (iPad A16). Contacts further than NEAR mm from the ring are the hand, not the middle phalanx
const PREP = 2500 * FAST, HOLD = 1500 * FAST, GIVEUP = 6000 * FAST, NEED = 20 * FAST, ROUNDS = 3;
const ANG = { s: 0, h: 30, f: 60, p: 0 };
const POSTS = { s: '先の関節をまっすぐ', h: '先の関節を半分曲げる', f: '先の関節をいっぱい曲げる', p: '先はまっすぐのまま、第二関節だけ動かす' };
const START = '○に中節の背を置き、曲げ伸ばしで数字が変わるか見る。次に［キャリブレート］';
const S = { touches: [], cancels: 0, cancel0: 0, sizes: new Set(), run: null, trials: [], raw: [], result: null, est: null, hist: [], ended: 0 };

// ---------- touch ----------
const onButton = (t) => !!t.target?.closest?.('.btn');
function read(e) {
  if (e.type === 'touchcancel') S.cancels++;
  S.touches = [...e.touches].filter((t) => !onButton(t)).map((t) => ({ x: (t.clientX - innerWidth / 2) * MM, y: (innerHeight / 2 - t.clientY) * MM, rx: (t.radiusX || 0) * MM, ry: (t.radiusY || 0) * MM, a: t.rotationAngle || 0, f: t.force || 0 }));
  if (e.cancelable && !e.target.closest?.('.btn')) e.preventDefault(); // no magnifier, scroll or zoom under the finger
}
for (const n of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) addEventListener(n, read, { passive: false });
for (const n of ['gesturestart', 'contextmenu', 'dblclick']) addEventListener(n, (e) => e.preventDefault());
const near = () => S.touches.filter((t) => Math.hypot(t.x, t.y) <= NEAR);
// a still finger makes no events, so the current contacts are sampled at 30 Hz
setInterval(() => {
  const list = near(), f = M.features(list), R = S.run;
  for (const t of list) S.sizes.add(`${t.rx.toFixed(2)}x${t.ry.toFixed(2)}`);
  if (R?.hold) { if (f) R.hold.push(f); S.raw.push({ round: R.round, post: R.post, t: Math.round(now()), list: S.touches }); }
  if (S.result?.model) {
    const p = f ? Math.max(0, Math.min(75, M.predict(S.result.model, f))) : null;
    S.est = p == null ? null : S.est == null ? p : S.est + 0.3 * (p - S.est);
  }
}, 33);

// ---------- calibration ----------
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function say(t, quiet) {
  $('#now').textContent = t; if (quiet) return;
  try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(t); u.lang = 'ja-JP'; u.rate = 1.15; speechSynthesis.speak(u); } catch {}
}
const check = (R) => { if (R.stop) throw new Error('stop'); };
async function until(f, ms, R) { const t = now(); while (!f()) { check(R); if (now() - t > ms) return false; await wait(30); } return true; }
async function sleep(ms, R) { const t = now(); while (now() - t < ms) { check(R); await wait(30); } }
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
async function run() {
  const R = S.run = { stop: false, round: 0, post: null, hold: null }; let k = 0;
  S.trials = []; S.raw = []; S.result = null; S.est = null; S.sizes.clear(); S.cancel0 = S.cancels;
  $('#res').innerHTML = ''; $('#share').hidden = true; $('#go').textContent = 'やめる';
  try {
    for (R.round = 1; R.round <= ROUNDS; R.round++) {
      R.post = null;
      if (near().length) { say('指をいちど離す'); if (!await until(() => !near().length, 20000, R)) throw new Error('まだ○の近くに触れています。手が画面に触れていないか見てください'); await sleep(500 * FAST, R); }
      say('○に中節の背を置く'); if (!await until(() => near().length, 30000, R)) throw new Error('○の近くに接触がありません。もう一度［キャリブレート］');
      for (const post of shuffle(['s', 'h', 'f', 'p'])) {
        R.post = post; say(POSTS[post]); await sleep(PREP, R);
        say(`${POSTS[post]}（そのまま）`, true);
        const h = R.hold = [], t = now();
        while (now() - t < GIVEUP && (now() - t < HOLD || h.length < NEED)) { check(R); await wait(30); }
        R.hold = null;
        S.trials.push({ round: R.round, post, n: h.length, f: h.length >= NEED ? M.medianFeature(h) : null, y: ANG[post] });
        $('#prog').style.width = `${100 * ++k / (ROUNDS * 4)}%`;
      }
    }
    S.run = null; result(); say('おわり。曲げ伸ばしして、左の数字を見る');
  } catch (e) { say(e.message === 'stop' ? START : e.message, e.message === 'stop'); }
  S.run = null; $('#go').textContent = S.result ? 'もう一度キャリブレート' : 'キャリブレート（約1分）'; $('#prog').style.width = '0';
}
const HEAD = { yes: '読めそう', some: '少しだけ読める', mixed: '第二関節の動きと区別できない', no: '読めない', few: '接触が足りず判定できない' };
function result() {
  const r = S.result = M.evaluate(S.trials), lost = S.trials.filter((t) => !t.f).length, can = S.cancels - S.cancel0;
  const row = (a, b) => `<tr><td>${a}</td><td>${b}</td></tr>`;
  const avg = (p) => { const v = S.trials.filter((t) => t.post === p && t.f).map((t) => t.f.size); return v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(1) : '—'; };
  $('#res').innerHTML = `<div class="big ${r.verdict}">${HEAD[r.verdict]}</div><table>`
    + (r.verdict === 'few' ? '' : row('推定の誤差（平均）', `約 ${r.err.toFixed(0)}°`) + row('タッチを使わない場合', `約 ${r.base.toFixed(0)}°`) + row('偶然でこうなる割合', `${(r.p * 100).toFixed(1)}%`)
      + (r.pipErr == null ? '' : row('第二関節だけの時の誤差', `約 ${r.pipErr.toFixed(0)}°`)))
    + row('大きさ：まっすぐ', `${avg('s')} mm`) + row('大きさ：半分', `${avg('h')} mm`) + row('大きさ：いっぱい', `${avg('f')} mm`) + row('大きさ：第二関節だけ', `${avg('p')} mm`)
    + row('大きさの細かさ（種類）', S.sizes.size) + (lost ? row('接触が取れない姿勢', `${lost} / ${S.trials.length}`) : '') + (can ? row('iPadが打ち切った接触', can) : '') + '</table>';
  $('#share').hidden = false;
}
$('#go').onclick = () => { if (S.run) S.run.stop = true; else run(); };
$('#share').onclick = async () => {
  const data = JSON.stringify({ at: new Date().toISOString(), screen: [innerWidth, innerHeight], mmPerPx: MM, trials: S.trials, result: S.result, sizes: S.sizes.size, cancels: S.cancels - S.cancel0, raw: S.raw });
  const file = new File([data], `touch-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`, { type: 'application/json' });
  try { if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file] }); return; } } catch (e) { if (e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
};

// ---------- drawing ----------
const pad = $('#pad'), px = pad.getContext('2d'), fx = $('#fig').getContext('2d');
function finger(deg, col) { // side view: middle phalanx lying on the glass, distal phalanx bent up by deg
  fx.lineCap = 'round'; fx.lineWidth = 44; fx.strokeStyle = col;
  const a = deg * Math.PI / 180, x = 300, y = 300;
  fx.beginPath(); fx.moveTo(90, y); fx.lineTo(x, y); fx.lineTo(x + 170 * Math.cos(a), y - 170 * Math.sin(a)); fx.stroke();
}
function draw() {
  const dpr = devicePixelRatio || 1, W = innerWidth, H = innerHeight;
  if (pad.width !== Math.round(W * dpr) || pad.height !== Math.round(H * dpr)) { pad.width = Math.round(W * dpr); pad.height = Math.round(H * dpr); }
  px.setTransform(dpr, 0, 0, dpr, 0, 0); px.clearRect(0, 0, W, H);
  px.strokeStyle = '#9aa1ab'; px.lineWidth = 2; px.beginPath(); px.arc(W / 2, H / 2, 34, 0, 7); px.stroke();
  for (const t of S.touches) {
    px.fillStyle = Math.hypot(t.x, t.y) <= NEAR ? 'rgba(90,169,255,.5)' : 'rgba(154,161,171,.25)';
    px.beginPath(); px.ellipse(W / 2 + t.x / MM, H / 2 - t.y / MM, Math.max(4, t.rx / MM), Math.max(4, t.ry / MM), t.a * Math.PI / 180, 0, 7); px.fill();
  }
  const f = M.features(near());
  $('#vals').innerHTML = [['接触の数', f ? f.n : '—'], ['接触の大きさ（面積の平方根）', f ? `${f.size.toFixed(2)} mm` : '—'], ['接触の長さ', f ? `${f.len.toFixed(2)} mm` : '—'], ['大きさの種類', S.sizes.size]].map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('');
  fx.clearRect(0, 0, 560, 400); fx.fillStyle = '#343a45'; fx.fillRect(40, 324, 480, 6);
  const post = S.run?.post, live = !S.run && S.result?.model, bad = live && ['no', 'mixed'].includes(S.result.verdict);
  if (post) { finger(ANG[post], '#f5b84b'); $('#lab').textContent = 'この形にする'; $('#est').textContent = ''; }
  else if (live) {
    $('#lab').textContent = bad ? 'DIPの推定（判定が悪いので参考）' : 'DIPの推定'; $('#est').className = bad ? 'ref' : '';
    if (S.est == null) $('#est').textContent = '—'; else { finger(S.est, bad ? '#555c68' : '#5aa9ff'); $('#est').textContent = `約 ${Math.round(S.est)}°`; }
  } else { $('#lab').textContent = ''; $('#est').textContent = ''; }
  requestAnimationFrame(draw);
}
say('ontouchstart' in window || navigator.maxTouchPoints ? START : 'iPadで開いてください（タッチ画面が必要です）', true);
try { navigator.wakeLock?.request('screen').catch(() => {}); } catch {}
draw();
window.touchlab = { S };
