// 同期サーバー: the PC relays messages between the iPhone (measures), the iPad (shows) and the PC monitor.
// Plain WebSocket over the local network, so it works on tethering where direct device-to-device WebRTC does not.
//   http://localhost:8080/        status page, certificate for iOS, monitor
//   https://<PC>:8443/sync-ws     WebSocket for the iPad / iPhone (iOS needs https for the camera pages)
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUB = path.join(ROOT, 'public');
const CERTS = path.join(ROOT, 'certs');
const HTTP_PORT = 8080, HTTPS_PORT = 8443;

const lanIPs = () => Object.values(os.networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => a.address);

// ---------- certificates (local CA, created once; server certificate re-issued for the current addresses) ----------
function findOpenssl() {
  for (const p of ['openssl', 'C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe', 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe']) {
    try { execFileSync(p, ['version'], { stdio: 'ignore' }); return p; } catch {}
  }
  throw new Error('openssl が見つかりません（Git for Windows を入れてください）');
}
function ensureCerts(ips) {
  fs.mkdirSync(CERTS, { recursive: true });
  const ssl = findOpenssl(), f = (n) => path.join(CERTS, n);
  if (!fs.existsSync(f('ca.crt'))) {
    execFileSync(ssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', f('ca.key'), '-out', f('ca.crt'), '-days', '3650', '-sha256',
      '-subj', '/CN=Fingertip Lab Local CA', '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign'], { stdio: 'ignore' });
  }
  const san = ['DNS:localhost', 'IP:127.0.0.1', ...ips.map((ip) => `IP:${ip}`)].join(',');
  const stamp = path.join(CERTS, 'server.san');
  if (fs.existsSync(f('server.crt')) && fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8') === san) return;
  fs.writeFileSync(f('server.ext'), `basicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=${san}\n`);
  execFileSync(ssl, ['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', f('server.key'), '-out', f('server.csr'), '-subj', '/CN=fingertip-lab'], { stdio: 'ignore' });
  execFileSync(ssl, ['x509', '-req', '-in', f('server.csr'), '-CA', f('ca.crt'), '-CAkey', f('ca.key'), '-CAcreateserial', '-out', f('server.crt'), '-days', '397', '-sha256', '-extfile', f('server.ext')], { stdio: 'ignore' });
  fs.writeFileSync(stamp, san);
}

// ---------- relay ----------
const peers = { ipad: null, phone: null, monitors: new Set() };
const presence = () => JSON.stringify({ type: 'presence', ipad: !!peers.ipad, phone: !!peers.phone, monitors: peers.monitors.size });
const all = () => [peers.ipad, peers.phone, ...peers.monitors].filter(Boolean);
const sendTo = (ws, data, binary = false) => { if (ws && ws.readyState === 1 && (!binary || ws.bufferedAmount < 1.5e6)) ws.send(data, { binary }); };
function attach(wss) {
  wss.on('connection', (ws, req) => {
    const role = new URL(req.url, 'http://x').searchParams.get('role');
    if (!['ipad', 'phone', 'monitor'].includes(role)) { ws.close(1008, 'role'); return; }
    if (role === 'monitor') peers.monitors.add(ws);
    else { if (peers[role] && peers[role] !== ws) peers[role].terminate(); peers[role] = ws; }
    ws.role = role; ws.alive = true;
    console.log(`  つながりました: ${role === 'ipad' ? 'iPad' : role === 'phone' ? 'iPhone' : 'PC確認画面'}（${req.socket.remoteAddress}）`);
    for (const c of all()) sendTo(c, presence());
    ws.on('pong', () => { ws.alive = true; });
    ws.on('message', (data, isBinary) => {
      ws.alive = true;
      if (isBinary) { if (role === 'phone') { sendTo(peers.ipad, data, true); for (const m of peers.monitors) sendTo(m, data, true); } return; }
      let m; try { m = JSON.parse(data.toString()); } catch { return; }
      m.from = role; const s = JSON.stringify(m);
      if (role === 'phone') { sendTo(peers.ipad, s); for (const x of peers.monitors) sendTo(x, s); }
      else if (role === 'ipad') { const to = m.to || 'phone'; if (to === 'phone' || to === 'all') sendTo(peers.phone, s); if (to === 'monitor' || to === 'all') for (const x of peers.monitors) sendTo(x, s); }
      else sendTo(peers.ipad, s);
    });
    ws.on('close', () => {
      if (role === 'monitor') peers.monitors.delete(ws); else if (peers[role] === ws) peers[role] = null;
      console.log(`  切れました: ${role === 'ipad' ? 'iPad' : role === 'phone' ? 'iPhone' : 'PC確認画面'}`);
      for (const c of all()) sendTo(c, presence());
    });
  });
}
// heartbeat: a JSON beat the pages can see, plus protocol pings to drop dead sockets
setInterval(() => {
  for (const ws of all()) { if (!ws.alive) { ws.terminate(); continue; } ws.alive = false; try { ws.ping(); } catch {} sendTo(ws, '{"type":"beat"}'); }
}, 2000);

// ---------- static files + status page ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary' };
function statusPage(ips) {
  const ip = ips[0] || '（ネットワーク未接続）';
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>同期サーバー</title>
<style>body{margin:0;padding:24px;background:#101216;color:#eef0f3;font:16px/1.6 system-ui,"Yu Gothic UI",sans-serif}h1{font-size:18px;margin:0 0 4px}.addr{font:700 44px ui-monospace,monospace;letter-spacing:.04em}
.card{background:#181b21;border:1px solid #2f343e;border-radius:12px;padding:14px 16px;margin:14px 0;max-width:720px}.dot{font-size:18px}a{color:#5aa9ff}.mut{color:#9aa1ab;font-size:14px}ol{margin:6px 0;padding-left:20px}</style></head><body>
<h1>PCのアドレス（iPad・iPhoneに入れる）</h1><div class="addr">${ip}</div>
<div class="card" id="st">接続状況を確認中…</div>
<div class="card"><b><a href="/sync/monitor.html">PCの確認画面を開く</a></b></div>
<div class="card"><b>初回だけ：iPhoneとiPadに証明書を入れる</b>
<ol><li>iPhone（iPadも）のSafariで <b>http://${ip}:${HTTP_PORT}/ca</b> を開き「許可」</li>
<li>設定 →「プロファイルがダウンロード済み」→ インストール</li>
<li>設定 → 一般 → 情報 → 証明書信頼設定 →「Fingertip Lab Local CA」をオン</li>
<li>確認：Safariで <a href="https://${ip}:${HTTPS_PORT}/ok">https://${ip}:${HTTPS_PORT}/ok</a> を開いて「OK」と出ればよい</li></ol>
<div class="mut">証明書はこのPCのフォルダ certs/ にだけあります。</div></div>
<script>async function u(){try{const p=await (await fetch('/api/presence')).json();const d=(b,t)=>'<span class="dot" style="color:'+(b?'#3ecf8e':'#ff6b6b')+'">●</span> '+t;document.getElementById('st').innerHTML=d(p.ipad,'iPad')+'　'+d(p.phone,'iPhone')+'　'+d(p.monitors>0,'PC確認画面');}catch{}}setInterval(u,1000);u();</script></body></html>`;
}
function handler(ips) {
  return (req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(statusPage(ips)); return; }
    if (u.pathname === '/ok') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'access-control-allow-origin': '*' }); res.end('<meta name="viewport" content="width=device-width"><h1 style="font-family:sans-serif">OK（証明書は信頼されています）</h1>'); return; }
    if (u.pathname === '/ca' || u.pathname === '/ca.crt') { res.writeHead(200, { 'content-type': 'application/x-x509-ca-cert', 'content-disposition': 'attachment; filename="fingertip-lab-ca.crt"' }); res.end(fs.readFileSync(path.join(CERTS, 'ca.crt'))); return; }
    if (u.pathname === '/api/presence') { res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(presence()); return; }
    const file = path.normalize(path.join(PUB, decodeURIComponent(u.pathname)));
    if (!file.startsWith(PUB)) { res.writeHead(403); res.end(); return; }
    fs.stat(file, (err, st) => {
      const f = !err && st.isDirectory() ? path.join(file, 'index.html') : file;
      fs.readFile(f, (e, buf) => {
        if (e) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }); res.end(buf);
      });
    });
  };
}

// ---------- start ----------
const ips = lanIPs();
ensureCerts(ips);
const h = handler(ips);
const httpServer = http.createServer(h);
const httpsServer = https.createServer({ key: fs.readFileSync(path.join(CERTS, 'server.key')), cert: fs.readFileSync(path.join(CERTS, 'server.crt')) }, h);
for (const s of [httpServer, httpsServer]) { const wss = new WebSocketServer({ noServer: true, maxPayload: 4e6 }); attach(wss);
  s.on('upgrade', (req, sock, head) => { if (new URL(req.url, 'http://x').pathname !== '/sync-ws') { sock.destroy(); return; } wss.handleUpgrade(req, sock, head, (ws) => wss.emit('connection', ws, req)); }); }
httpServer.listen(HTTP_PORT, '0.0.0.0');
httpsServer.listen(HTTPS_PORT, '0.0.0.0');
console.log('');
console.log('  同期サーバーを起動しました');
console.log(`  PCのアドレス: ${ips.join(' / ') || '（ネットワーク未接続）'}`);
console.log(`  状況・証明書: http://localhost:${HTTP_PORT}/`);
console.log('  このウィンドウを閉じると止まります');
console.log('');
