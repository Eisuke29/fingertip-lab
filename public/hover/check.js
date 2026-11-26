// (check.html) Step 1 of "the fist comes closer, the finger goes in": do the iPhone and the iPad find each other, and how long does it take?
import { Link, newRoom } from './link.js?v=1';
const $ = (s) => document.querySelector(s), q = new URLSearchParams(location.search), phone = !!q.get('room'), room = q.get('room') || newRoom(), KEY = 'hover.results';
let link = null, cam = null, place = null, runs = (() => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } })(), t0 = 0, first = {};
if (phone) { $('#title').textContent = 'iPhone'; $('#say').textContent = '背面カメラを使います。映像はどこにも送りません。'; $('#where').hidden = $('#again').hidden = $('#copy').hidden = true; $('#padT').textContent = 'ここを指でなぞると、iPadの点が動きます'; } else $('#padT').textContent = 'iPhoneの指に合わせて点が動きます';

$('#go').onclick = async () => {
  $('#go').disabled = true; $('#go').textContent = '許可を待っています';
  try { cam = await navigator.mediaDevices.getUserMedia({ video: { facingMode: phone ? 'environment' : 'user' }, audio: false }); } catch (e) { $('#go').disabled = false; $('#go').textContent = 'もう一度'; $('#say').textContent = `カメラを許可してください（${e.name}）`; return; }
  try { navigator.wakeLock?.request('screen').catch(() => {}); } catch {}
  $('#start').hidden = true; $('#live').hidden = false; if (!phone) invite(); connect();
};
function invite() {
  const u = new URL(location.href); u.search = ''; u.searchParams.set('room', room); if (q.get('relay')) u.searchParams.set('relay', q.get('relay')); const g = qrcode(0, 'M'); g.addData(u.href); g.make(); $('#qr').innerHTML = g.createSvgTag({ cellSize: 4, margin: 0, scalable: true }); $('#code').textContent = u.href; $('#invite').hidden = false;
}
function connect() { link?.end(); t0 = performance.now(); first = {}; link = new Link(room, phone ? 'b' : 'a', (k, d, way) => { if (k === 'data') show(d); else if (k === 'taken') $('#state').textContent = '別の画面で開かれました'; else draw(); }); link.allowed(); window.hover = { link, runs }; }
// the finger on the iPhone -> the dot on the iPad
const pad = $('#pad');
pad.addEventListener('pointermove', (e) => { if (!phone || !e.buttons && e.pointerType === 'mouse') return; const r = pad.getBoundingClientRect(), p = [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; put(p); link?.data([+p[0].toFixed(4), +p[1].toFixed(4)]); });
const put = (p) => { const r = pad.getBoundingClientRect(), o = $('#dot'); o.style.display = 'block'; o.style.transform = `translate(${p[0] * r.width}px,${p[1] * r.height}px)`; $('#padT').hidden = true; };
const show = (d) => { if (!phone) put(d); };
for (const b of $('#where').querySelectorAll('button')) b.onclick = () => { place = b.dataset.w; for (const x of $('#where').querySelectorAll('button')) x.style.background = x === b ? 'var(--ok)' : ''; connect(); link.note(place); };
$('#again').onclick = () => connect();
const ms = (v) => (v == null ? '—' : `${v.toFixed(0)} ms`);
function draw() {
  const now = performance.now(); let any = false;
  for (const w of ['direct', 'relay']) {
    const m = link.m[w], on = m.fresh(now), e = $(`#w-${w}`); any ||= on; if (on && first[w] == null) first[w] = now - t0;
    e.classList.toggle('on', link.way === w); e.querySelector('.n').textContent = on ? ms(m.rtt) : '—'; e.querySelector('.s').textContent = on ? `往復。遅いとき ${ms(m.p95)}・失う ${m.loss == null ? '—' : (m.loss * 100).toFixed(0) + '%'}・つながるまで ${(first[w] / 1000).toFixed(1)} 秒` : w === 'direct' ? (link.tries ? `${link.tries}回目を試しています` : '相手を待っています') : link.ws?.readyState === 1 ? (link.peer ? '測っています' : '相手を待っています') : 'つないでいます';
  }
  $('#state').textContent = any ? (link.way === 'direct' ? '直接つながっています' : '中継でつながっています') : link.peer ? '相手が見つかりました' : phone ? 'iPadを探しています' : 'iPhoneを待っています'; $('#invite').hidden = phone || any;
  $('#log').textContent = [`アドレスの種類：自分 ${[...link.cand.own].join('・') || '—'}／相手 ${[...link.cand.their].join('・') || '—'}`, link.pair && `つながった組：${link.pair}`, ...link.log.slice(-12)].filter(Boolean).join('\n');
  // one result per connection, 8 s after the first way opened
  if (!phone && any && !link.saved && now - t0 - Math.min(...Object.values(first)) > 8000) { link.saved = true; runs.push({ at: new Date().toLocaleString('ja'), place: place || '未選択', direct: link.m.direct.fresh(now) ? Math.round(link.m.direct.rtt) : null, relay: link.m.relay.fresh(now) ? Math.round(link.m.relay.rtt) : null, first: Object.fromEntries(Object.entries(first).map(([k, v]) => [k, +(v / 1000).toFixed(1)])), own: [...link.cand.own], their: [...link.cand.their], pair: link.pair }); try { localStorage.setItem(KEY, JSON.stringify(runs.slice(-40))); } catch {} link.note(`結果を記録（${runs.length}件目）`); }
}
$('#copy').onclick = async () => { const s = JSON.stringify({ runs, log: link?.log, ua: navigator.userAgent }, null, 1); try { await navigator.clipboard.writeText(s); $('#copy').textContent = 'コピーしました'; } catch { $('#log').textContent = s; } setTimeout(() => { $('#copy').textContent = '結果をコピー'; }, 2000); };
if (phone) { const n = document.createElement('p'); n.className = 'mut'; n.textContent = 'カメラを許可すると、すぐにつなぎ始めます。'; $('#start').append(n); }
