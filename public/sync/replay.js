// Replays a recording (recordings/<id>/) through the same code the iPhone uses (Fable P0-10).
import * as G from './geom.js';
import * as T from './tracker.js';
const $ = (s) => document.querySelector(s);
const out = (h) => { $('#out').insertAdjacentHTML('beforeend', h); };
const recs = await (await fetch('/api/recs', { cache: 'no-store' })).json();
$('#sel').innerHTML = recs.map((r) => `<option value="${r.id}">${r.id}（${r.files.length} 枚）</option>`).join('') || '<option>記録がありません</option>';
const img = (id, name) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error(`${name} がありません`)); i.src = `/rec/${id}/${name}`; });
function pixels(i, W, H) { const c = document.createElement('canvas'); c.width = W || i.width; c.height = H || i.height; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(i, 0, 0, c.width, c.height); return x.getImageData(0, 0, c.width, c.height); }
const luma = (d) => { const L = new Float32Array(d.width * d.height); for (let k = 0; k < L.length; k++) L[k] = d.data[4 * k]; return L; };
$('#go').onclick = async () => {
  $('#out').innerHTML = '';
  const id = $('#sel').value, files = recs.find((r) => r.id === id)?.files || [];
  try {
    const cal = await (await fetch(`/rec/${id}/cal.json`)).json(), m = cal.screen, HW = cal.W >> 1, HH = cal.H >> 1;
    // ---- iPad position from the saved stripes ----
    const frames = { white: luma(pixels(await img(id, 'cal_white.png'))), black: luma(pixels(await img(id, 'cal_black.png'))), gray: {} };
    for (const { axis, bit } of G.grayPlan(m, cal.MIN)) frames.gray[`${axis}:${bit}`] = [luma(pixels(await img(id, `cal_${axis}${bit}_p.png`))), luma(pixels(await img(id, `cal_${axis}${bit}_i.png`)))];
    const dec = G.decodeGray(frames, m, HW, HH, cal.MIN), rs = G.ransacHomography(dec.src, dec.dst, 3);
    const isrc = rs.inliers.map((i) => dec.src[i]), idst = rs.inliers.map((i) => dec.dst[i]);
    // same as the iPhone: the points within 70 mm of the ring, with the focal length it used
    const near = isrc.map((q, i) => i).filter((i) => Math.abs(isrc[i].x - m.pip.x) <= 70 && Math.abs(isrc[i].y - m.pip.y) <= 70);
    const ps = near.length >= 200 ? near.map((i) => isrc[i]) : isrc, pd = near.length >= 200 ? near.map((i) => idst[i]) : idst;
    const pose = G.estimatePose(ps, pd, cal.W, cal.H, cal.info.focal?.saved ? { f: cal.info.focal.saved * cal.W } : {});
    const dC = Math.hypot(...pose.C.map((v, i) => v - cal.pose.C[i]));
    out(`<h3>iPadの位置</h3><table><tr><th></th><th>記録したとき</th><th>今の計算</th></tr>
      <tr><td>使えた点</td><td>${cal.info.n}</td><td>${isrc.length}</td></tr>
      <tr><td>点のずれ（画素）</td><td>${cal.info.rms.toFixed(2)}</td><td>${pose.rms.toFixed(2)}</td></tr>
      <tr><td>カメラの位置（mm）</td><td>${cal.pose.C.map((v) => v.toFixed(1)).join(', ')}</td><td>${pose.C.map((v) => v.toFixed(1)).join(', ')}</td></tr>
      <tr><td>焦点距離（画像幅比）</td><td>${(cal.pose.f / cal.W).toFixed(4)}</td><td>${(pose.f / cal.W).toFixed(4)}</td></tr>
      <tr><td>画面が映った割合</td><td></td><td>${(dec.screenFrac * 100).toFixed(0)}%</td></tr></table>
      <div class="note">カメラの位置の差 ${dC.toFixed(2)} mm</div>`);
    // ---- finger: background + 10 s of frames through the tracker ----
    if (!files.includes('finger.json')) { out('<p class="note">指の記録はありません（PCの［指を10秒記録］）</p>'); return; }
    const setup = await (await fetch(`/rec/${id}/finger_setup.json`)).json(), rows = await (await fetch(`/rec/${id}/finger.json`)).json();
    const rect = G.makeRect(cal.pose, m.pip.x, m.pip.y), buf = () => new ImageData(rect.W, rect.H);
    const rectOf = async (name) => G.warp(rect, pixels(await img(id, name), cal.W, cal.H), 0, 0, rect.W, rect.H, buf());
    const bg = new T.Background();
    for (const f of files.filter((f) => /^bg_\d+\.jpg$/.test(f))) bg.add(await rectOf(f));
    if (!bg.n) { out('<p class="ng">背景の画像がありません</p>'); return; }
    bg.finish();
    const model = T.buildModel(setup.cal); let prev = {}; const res = [];
    for (const r of rows) {
      const im = await rectOf(r.name), f = T.foregroundC(im, { x0: 0, y0: 0, w: rect.W, h: rect.H }, bg, { skin: setup.skin, gain: T.cornerGain(im, bg) });
      // frames are ~0.1-0.5 s apart, so every frame is searched over the whole range (no "near the last angle")
      const t = T.track(f, model, {}); prev = { okP: t.scoreP > T.SCORE_OK, okD: t.scoreD > T.SCORE_OK };
      res.push({ ...r, nthp: t.thp, nthd: t.thd, nok: prev.okP && prev.okD });
    }
    const okN = res.filter((r) => r.nok).length, dif = res.filter((r) => r.ok && r.nok).map((r) => Math.max(Math.abs(r.thp - r.nthp), Math.abs(r.thd - r.nthd)));
    out(`<h3>指（${res.length} 枚）</h3><div>今の計算で指を追えた割合 <b>${(okN / res.length * 100).toFixed(0)}%</b>・記録したときとの差 中央値 ${dif.length ? dif.slice().sort((a, b) => a - b)[dif.length >> 1].toFixed(2) : '—'}°・最大 ${dif.length ? Math.max(...dif).toFixed(1) : '—'}°</div>`);
    window.replayRows = res;
    const c = document.createElement('canvas'); c.width = 900; c.height = 260; $('#out').appendChild(c);
    const x = c.getContext('2d'), X = (t) => 40 + (t / 10000) * 840, Y = (d) => 240 - (d + 30) / 210 * 220;
    x.strokeStyle = '#2f343e'; for (let d = 0; d <= 180; d += 30) { x.beginPath(); x.moveTo(40, Y(d)); x.lineTo(880, Y(d)); x.stroke(); x.fillStyle = '#9aa1ab'; x.fillText(`${d}°`, 6, Y(d) + 4); }
    const plot = (k, col, dash) => { x.strokeStyle = col; x.setLineDash(dash); x.lineWidth = 2; x.beginPath(); let on = false; for (const r of res) { if (r[k] == null) { on = false; continue; } on ? x.lineTo(X(r.t), Y(r[k])) : x.moveTo(X(r.t), Y(r[k])); on = true; } x.stroke(); x.setLineDash([]); };
    plot('thp', '#4a86e8', [6, 4]); plot('thd', '#f0953a', [6, 4]); plot('nthp', '#4a86e8', []); plot('nthd', '#f0953a', []);
    out('<div class="note">青 θp・橙 θd。点線＝記録したとき、実線＝今の計算</div>');
  } catch (e) { out(`<p class="ng">${e.message}</p>`); }
};
