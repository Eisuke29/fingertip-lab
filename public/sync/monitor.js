// PC monitor: watches the iPhone camera and the estimates; can press the same buttons as the iPad.
import { client } from './link.js';

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
let saved = {}; try { saved = JSON.parse(localStorage.getItem('syncMonitor.v1') || '{}'); } catch {}
$('#code').value = (params.get('room') || saved.room || '').toUpperCase();
let link = null, ui = null, status = null, pose = null, poseAt = 0;

$('#go').onclick = join;
$('#code').addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });
if (params.get('room')) setTimeout(join, 50);
async function join() {
  const room = $('#code').value.trim().toUpperCase();
  if (room.length !== 4) { $('#joinMsg').textContent = '4文字を入れてください'; return; }
  saved.room = room; try { localStorage.setItem('syncMonitor.v1', JSON.stringify(saved)); } catch {}
  $('#joinMsg').textContent = 'つないでいます…';
  try {
    link = await client(room, {
      onOpen: () => { $('#join').style.display = 'none'; $('#main').classList.add('on'); },
      onData, onStream: (s) => { const v = $('#pv'); v.srcObject = s; v.play().catch(() => {}); },
      onClose: () => {}, onError: () => {},
    }, 'monitor');
  } catch (e) { $('#joinMsg').textContent = e.message; }
}
function onData(m) {
  if (m.type === 'ui') { ui = m; renderUI(); }
  else if (m.type === 'status') { status = m; renderNums(); }
  else if (m.type === 'pose') { pose = m; poseAt = performance.now(); }
  else if (m.type === 'ack') renderNums();
}
function renderUI() {
  $('#stages').innerHTML = ui.names.map((n, i) => `<span class="sg ${i === ui.stage ? 'cur' : ui.done[i] ? 'done' : ''}" data-i="${i}"><i>${ui.done[i] && i !== ui.stage ? '✓' : i + 1}</i>${n}</span>`).join('');
  $('#stages').querySelectorAll('.sg').forEach((e) => (e.onclick = () => link.send({ type: 'goto', i: +e.dataset.i })));
  $('#inst').textContent = ui.inst; $('#res').innerHTML = ui.res;
  const box = $('#btns'); box.innerHTML = '';
  ui.btns.forEach((b, i) => { const e = document.createElement('button'); e.className = 'btn' + (b.primary ? ' primary' : ''); e.textContent = b.label; e.disabled = b.disabled; e.onclick = () => link.send({ type: 'press', i }); box.appendChild(e); });
  renderNums();
}
const row = (k, v) => `<tr><td>${k}</td><td>${v}</td></tr>`;
function renderNums() {
  const c = ui?.calInfo;
  $('#cal').innerHTML = c ? row('点の一致（再投影のずれ）', `${c.rms.toFixed(2)} px（${c.n}/${c.of} 点）`) + row('カメラまでの距離', `${(c.dist / 10).toFixed(1)} cm`) + row('見下ろす角度', `${c.elev.toFixed(1)}°`)
    + row('指の面に対する横向きのずれ', `${c.side.toFixed(1)}°`) + row('焦点距離（画像幅比）', c.fW.toFixed(3)) + row('指の面の解像度', `${c.scale.toFixed(1)} px/mm`) : row('未測定', '—');
  const s = status, j = ui?.joints;
  $('#meas').innerHTML = s ? row('カメラ', `${s.fps} fps・${s.W}×${s.H}`) + row('1フレームの処理', `${s.proc} ms`) + row('通信（往復）', ui?.rtt != null ? `${ui.rtt.toFixed(0)} ms` : '—')
    + (s.res != null ? row('角度の分解能（1画素）', `${s.res.toFixed(2)}°`) : '') + (j ? row('PIPの ○ からのずれ', `${j.pipOffsetMm.toFixed(1)} mm`) + row('中節の長さ / 太さ', `${j.LmMm.toFixed(1)} / ${j.diaMm.toFixed(1)} mm`) : '') : row('iPhone', '未接続');
}
setInterval(() => {
  const fresh = pose && performance.now() - poseAt < 600;
  $('#p').textContent = fresh ? (pose.fthp ?? pose.thp).toFixed(1) + '°' : '—'; $('#d').textContent = fresh ? (pose.fthd ?? pose.thd).toFixed(1) + '°' : '—';
  $('#trk').textContent = fresh ? (pose.ok ? `一致度 ${pose.sp.toFixed(2)} / ${pose.sd.toFixed(2)}` : '指を見失っています') : '';
}, 100);
window.monitor = { get ui() { return ui; }, get status() { return status; } };
