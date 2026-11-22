// PC monitor (served by the PC's sync-server): the iPhone camera with the estimates, the numbers, and the same
// step buttons as the iPad.
import { connect } from './wslink.js';

const $ = (s) => document.querySelector(s);
let link = null, ui = null, status = null, statusAt = 0, pose = null, poseAt = 0, frameAt = 0, fw = 0, fh = 0;

if (/github\.io$/.test(location.hostname)) {
  $('#joinMsg').innerHTML = 'この画面はPCの同期サーバーから開きます：<br><b>同期サーバー起動.bat</b> を開いてから <a href="http://localhost:8080/sync/monitor.html" style="color:#5aa9ff">http://localhost:8080/sync/monitor.html</a>';
} else {
  link = connect('local', 'monitor', {
    onOpen: () => { $('#join').style.display = 'none'; $('#main').classList.add('on'); },
    onClose: () => { $('#join').style.display = 'flex'; $('#main').classList.remove('on'); },
    onData, onBinary: showFrame, onState: (t) => { $('#joinMsg').textContent = t; },
  });
}
function onData(m) {
  if (m.type === 'ui') { ui = m; renderUI(); }
  else if (m.type === 'status') { status = m; statusAt = performance.now(); renderNums(); }
  else if (m.type === 'pose') { pose = m; poseAt = performance.now(); }
  else if (m.type === 'ack') renderNums();
}
const pv = $('#pv'), pvx = pv.getContext('2d');
let drawing = false;
async function showFrame(b) {
  if (drawing) return; drawing = true;
  try { const bm = await createImageBitmap(b); if (pv.width !== bm.width) { pv.width = bm.width; pv.height = bm.height; } pvx.drawImage(bm, 0, 0); fw = bm.width; fh = bm.height; bm.close?.(); frameAt = performance.now(); } catch {}
  drawing = false;
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
  if (!link) return;
  const p = link.presence, dot = (ok, t) => `<span><span style="color:${ok ? 'var(--ok)' : 'var(--ng)'}">●</span> ${t}</span>`;
  const phoneLive = p.phone && performance.now() - statusAt < 3000, video = performance.now() - frameAt < 1500;
  $('#links').innerHTML = dot(link.connected, 'PC') + dot(p.ipad, 'iPad') + dot(phoneLive, `iPhone${phoneLive && status ? `（${status.fps} fps）` : ''}`) + dot(video, video ? `映像 ${fw}×${fh}` : '映像なし');
  const fresh = pose && performance.now() - poseAt < 600;
  $('#p').textContent = fresh ? (pose.fthp ?? pose.thp).toFixed(1) + '°' : '—'; $('#d').textContent = fresh ? (pose.fthd ?? pose.thd).toFixed(1) + '°' : '—';
  $('#trk').textContent = fresh ? (pose.ok ? `一致度 ${pose.sp.toFixed(2)} / ${pose.sd.toFixed(2)}` : '指を見失っています') : '';
}, 200);
window.monitor = { get ui() { return ui; }, get status() { return status; }, get link() { return link; } };
