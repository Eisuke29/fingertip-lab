// PC page (role 'lab': only listens). The iPad keeps its normal screen; this page shows what its touch sensor reports,
// guides the person through postures, and tests whether the DIP bend can be read from it.
// When the iPhone is measuring, its DIP angle is the truth (degrees). Otherwise the posture itself is (0 / 50 / 100 %).
import { connect } from './wslink.js';
import { boot } from './boot.js';
import * as M from './touchmodel.js';

const $ = (s) => document.querySelector(s), now = () => performance.now();
const L = { list: [], at: -1e9, cancels: 0, pose: null, poseAt: -1e9, radii: new Set(), run: null, trials: [], result: null, unit: '%', hist: [], raw: [] };
const FAST = new URLSearchParams(location.search).has('fast') ? 0.25 : 1; // tests only
const PREP = 3000 * FAST, HOLD = 2000 * FAST, GIVEUP = 8000 * FAST, NEED = 15 * FAST, ROUNDS = 4;
const POSTS = { s: '先の関節を まっすぐ', h: '先の関節を 半分 曲げる', f: '先の関節を いっぱい 曲げる', p: '先はまっすぐのまま、\n第二関節だけ 動かす' };
const LEVEL = { s: 0, h: 50, f: 100, p: 0 };
const START = '○に中節の背を置いて［はじめる］';

const VERSION = await boot();
const link = connect('lab', VERSION, { onOld: () => location.reload(), onState: (t) => { L.state = t; }, onData });
function onData(m) {
  if (m.type === 'pose') { if (m.ok) { L.pose = m; L.poseAt = now(); } return; }
  if (m.type !== 'touches') return;
  L.list = m.list; L.at = now(); L.cancels = m.cancels;
  for (const t of m.list) L.radii.add(`${t.rx.toFixed(2)}x${t.ry.toFixed(2)}`);
  const f = M.features(m.list), cam = now() - L.poseAt < 300 ? L.pose : null, R = L.run;
  if (R?.hold) {
    if (f) R.hold.push({ f, thd: cam?.thd ?? null, thp: cam?.thp ?? null });
    L.raw.push({ round: R.round, post: R.post, t: Math.round(now()), list: m.list, thd: cam?.thd ?? null, thp: cam?.thp ?? null });
  }
  if (L.result?.model) {
    L.hist.push([now(), f ? M.predict(L.result.model, f) : null, L.unit === '°' ? cam?.thd ?? null : null]);
    while (L.hist.length && now() - L.hist[0][0] > 15000) L.hist.shift();
  }
}

// ---------- guided run ----------
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function say(t) {
  $('#now').innerText = t;
  try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(t.replace(/\n/g, '')); u.lang = 'ja-JP'; u.rate = 1.1; speechSynthesis.speak(u); } catch {}
}
const touching = () => L.list.length > 0 && now() - L.at < 500;
async function until(f, ms, R) { const t = now(); while (!f()) { if (R.stop) throw new Error('stop'); if (now() - t > ms) return false; await wait(40); } return true; }
async function sleep(ms, R) { const t = now(); while (now() - t < ms) { if (R.stop) throw new Error('stop'); await wait(40); } }
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
async function run() {
  const R = L.run = { stop: false, round: 0, post: null, hold: null };
  L.trials = []; L.raw = []; L.result = null; L.hist = []; L.radii.clear(); L.cancel0 = L.cancels;
  $('#resCard').hidden = $('#liveCard').hidden = true; $('#stop').hidden = false;
  let k = 0; const total = ROUNDS * 4;
  try {
    for (R.round = 1; R.round <= ROUNDS; R.round++) {
      if (touching()) { say('指を いちど離す'); if (!await until(() => !touching(), 20000, R)) throw new Error('iPadがまだ何かに触れていると感じています。手や腕が画面に触れていないか見てください。'); await sleep(600 * FAST, R); }
      say('○に 中節の背を置く');
      if (!await until(touching, 30000, R)) throw new Error('指の接触がiPadから届きません。iPadの画面を1回タップしてあるか見てください。');
      for (const post of shuffle(['s', 'h', 'f', 'p'])) {
        R.post = post; say(POSTS[post]); await sleep(PREP, R);
        $('#now').innerText = `${POSTS[post]}\n（そのまま）`; R.hold = [];
        const h = R.hold, t = now();
        while (now() - t < GIVEUP && (now() - t < HOLD || h.length < NEED)) await sleep(50, R);
        R.hold = null;
        const th = h.filter((x) => x.thd != null);
        L.trials.push({ round: R.round, post, n: h.length, f: h.length >= NEED ? M.medianFeature(h.map((x) => x.f)) : null,
          thd: th.length && th.length >= 0.8 * h.length ? M.med(th.map((x) => x.thd)) : null, thp: th.length ? M.med(th.map((x) => x.thp)) : null });
        $('#prog').style.width = `${100 * ++k / total}%`;
      }
    }
    await finish(); say('おわり。指を離してよいです');
  } catch (e) { say(e.message === 'stop' ? START : e.message); }
  L.run = null; $('#stop').hidden = true; $('#prog').style.width = '0';
}
async function finish() {
  const got = L.trials.filter((t) => t.f), cam = got.length > 0 && got.every((t) => t.thd != null); // all from the camera, or none: units are never mixed
  L.unit = cam ? '°' : '%';
  for (const t of L.trials) t.y = cam ? t.thd : LEVEL[t.post];
  const r = L.result = M.evaluate(L.trials), u = L.unit, kinds = L.radii.size, lost = L.trials.length - got.length, can = L.cancels - (L.cancel0 || 0);
  const head = { yes: '読めそう', some: '少しだけ読める', mixed: '先の関節と第二関節を区別できない', no: '読めない', few: '接触が足りず、判定できない' }[r.verdict];
  const row = (a, b) => `<tr><td>${a}</td><td>${b}</td></tr>`;
  $('#res').innerHTML = `<div class="big ${r.verdict}">${head}</div><table>`
    + (r.verdict === 'few' ? '' : row('置き直したときの推定の誤差', `平均 ${r.err.toFixed(0)}${u}`) + row('タッチを使わない場合の誤差', `平均 ${r.base.toFixed(0)}${u}`) + row('偶然でこの結果になる割合', `${(r.p * 100).toFixed(1)}%`)
      + (r.pipErr == null ? '' : row('第二関節だけ動かしたときの誤差', `平均 ${r.pipErr.toFixed(0)}${u}`)))
    + row('接触の大きさの種類（多いほど細かい）', kinds) + row('接触が取れなかった姿勢', `${lost} / ${L.trials.length}`) + row('iPadが接触を打ち切った回数', can) + '</table>'
    + `<div class="mut">${cam ? '正解：iPhoneの角度' : '正解：案内した姿勢（まっすぐ0%・半分50%・いっぱい100%）。iPhoneで測りながら行うと角度になります'}</div>${table()}`;
  $('#resCard').hidden = false; $('#liveCard').hidden = !r.model || r.verdict === 'no'; // no estimate is shown when there is nothing to read
  $('#camNote').textContent = cam ? '　iPhoneの角度（橙）' : '';
  const id = `touch-${new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)}`;
  let saved = false;
  try { saved = (await fetch(`/api/rec/${id}/touch.json`, { method: 'POST', body: JSON.stringify({ unit: u, trials: L.trials, result: r, kinds, lost, cancels: can, raw: L.raw }) })).ok; } catch {}
  $('#res').insertAdjacentHTML('beforeend', `<div class="mut">${saved ? `記録：recordings/${id}/touch.json` : '記録を保存できませんでした'}</div>`);
}
function table() { // raw averages, so the numbers can be judged without trusting the calculation
  const g = (p, k) => { const v = L.trials.filter((t) => t.post === p && t.f).map((t) => t.f[k]); return v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(1) : '—'; };
  return `<table style="margin-top:10px"><tr class="mut"><td>平均（mm）</td><td>まっすぐ / 半分 / いっぱい / 第二関節だけ</td></tr>${M.KEYS.map((k) => `<tr><td>${M.KEY_JA[k]}</td><td>${['s', 'h', 'f', 'p'].map((p) => g(p, k)).join(' / ')}</td></tr>`).join('')}</table>`;
}
$('#go').onclick = () => run();
$('#stop').onclick = () => { if (L.run) L.run.stop = true; };

// ---------- live view ----------
const bx = $('#blob').getContext('2d'), gx = $('#graph').getContext('2d');
function draw() {
  const list = now() - L.at < 1500 ? L.list : [], f = M.features(list), ip = link.presence.ipad;
  $('#conn').textContent = `${L.state || ''}　iPad：${ip ? 'つながっている' : 'まだ'}　iPhoneの角度：${now() - L.poseAt < 500 ? '届いている（正解に使う）' : 'なし（姿勢を正解にする）'}`;
  $('#go').disabled = !!L.run || !ip;
  const W = 720, H = 520, k = 9; bx.clearRect(0, 0, W, H);
  bx.strokeStyle = '#2f343e'; bx.beginPath();
  for (let i = -8; i <= 8; i++) { bx.moveTo(W / 2 + i * 5 * k, 0); bx.lineTo(W / 2 + i * 5 * k, H); bx.moveTo(0, H / 2 + i * 5 * k); bx.lineTo(W, H / 2 + i * 5 * k); }
  bx.stroke(); bx.strokeStyle = '#9aa1ab'; bx.beginPath(); bx.arc(W / 2, H / 2, 10, 0, 7); bx.stroke();
  for (const t of list) { bx.fillStyle = 'rgba(90,169,255,.45)'; bx.beginPath(); bx.ellipse(W / 2 + t.x * k, H / 2 - t.y * k, Math.max(2, t.rx * k), Math.max(2, t.ry * k), t.a * Math.PI / 180, 0, 7); bx.fill(); }
  $('#vals').innerHTML = M.KEYS.map((q) => `<tr><td>${M.KEY_JA[q]}</td><td>${f ? f[q].toFixed(q === 'n' ? 0 : 2) + (['n', 'force'].includes(q) ? '' : ' mm') : '—'}</td></tr>`).join('') + `<tr><td>大きさの種類（ここまで）</td><td>${L.radii.size}</td></tr>`;
  if (L.result?.model) {
    const p = f ? M.predict(L.result.model, f) : null, mx = L.unit === '°' ? 90 : 100, GW = 1000, GH = 300;
    $('#est').textContent = p == null ? '指が触れていません' : `${Math.round(Math.max(0, Math.min(mx, p)))}${L.unit}`;
    gx.clearRect(0, 0, GW, GH);
    for (const [c, col] of [[1, '#5aa9ff'], [2, '#f0953a']]) {
      gx.strokeStyle = col; gx.lineWidth = 3; gx.beginPath(); let pen = false;
      for (const h of L.hist) {
        if (h[c] == null) { pen = false; continue; }
        const x = GW - (now() - h[0]) / 15000 * GW, y = GH - 10 - Math.max(0, Math.min(mx, h[c])) / mx * (GH - 20);
        pen ? gx.lineTo(x, y) : gx.moveTo(x, y); pen = true;
      }
      gx.stroke();
    }
  }
  requestAnimationFrame(draw);
}
draw();
window.touchlab = { L };
