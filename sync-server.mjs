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
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUB = path.join(ROOT, 'public');
const CERTS = path.join(ROOT, 'certs');
const HTTP_PORT = +(process.env.SYNC_HTTP_PORT || 8080), HTTPS_PORT = +(process.env.SYNC_HTTPS_PORT || 8443); // tests use other ports

// version of the pages = hash of every file in public/sync when the server starts (Fable review P0-5)
function hashPages() {
  const h = crypto.createHash('sha1'), dir = path.join(PUB, 'sync');
  for (const f of fs.readdirSync(dir).sort()) { const fp = path.join(dir, f); if (fs.statSync(fp).isFile()) { h.update(f); h.update(fs.readFileSync(fp)); } }
  return h.digest('hex').slice(0, 8);
}
const VERSION = hashPages();
// ---------- log: one line per command / result / error / connection, also to logs/<date>.txt (Fable P2-4) ----------
const stamp = () => new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
const LOGS = path.join(ROOT, 'logs'), REC = path.join(ROOT, 'recordings'), DATA = path.join(ROOT, 'data');
for (const d of [LOGS, REC, DATA]) fs.mkdirSync(d, { recursive: true });
const logFile = path.join(LOGS, `${stamp()}.txt`);
function log(line, show = true) {
  const t = new Date().toLocaleTimeString('ja-JP');
  if (show) console.log(`  ${t} ${line}`);
  try { fs.appendFileSync(logFile, `${t} ${line}\n`); } catch {}
}
const NAME = { ipad: 'iPad', phone: 'iPhone', monitor: 'PC' };
function logMessage(role, m) {
  if (m.type === 'cmd' && !['step', 'countdown', 'caminfo', 'preview'].includes(m.name)) log(`${NAME[role]} → 命令 ${m.name}${m.jobId ? `（${m.jobId}）` : ''}`);
  else if (m.type === 'ack') log(`${NAME[role]} → 結果 ${m.what}：${m.ok ? '成功' : `失敗（${m.msg}）`}`);
  else if (m.type === 'error') log(`${NAME[role]} のエラー：${m.msg}`);
}
// saved focal length per camera (Fable P1-2): the first measurements are kept, then their median is used
const FOCAL = path.join(DATA, 'focal.json');
const readFocal = () => { try { return JSON.parse(fs.readFileSync(FOCAL, 'utf8')); } catch { return {}; } };
function focalOf(key) {
  const l = readFocal()[key] || []; if (l.length < 3) return { fixed: null, list: l };
  const first = l.slice(0, 5).sort((a, b) => a - b); return { fixed: first[first.length >> 1], list: l };
}
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
const peers = { ipad: null, phone: null, monitors: new Set(), controller: null };
const presence = () => JSON.stringify({ type: 'presence', ipad: !!peers.ipad, phone: !!peers.phone, monitors: peers.monitors.size });
const all = () => [peers.ipad, peers.phone, ...peers.monitors].filter(Boolean);
const sendTo = (ws, data, binary = false) => { if (ws && ws.readyState === 1 && (!binary || ws.bufferedAmount < 1.5e6)) ws.send(data, { binary }); };
function attach(wss) {
  wss.on('connection', (ws, req) => {
    const q = new URL(req.url, 'http://x').searchParams, role = q.get('role');
    if (!['ipad', 'phone', 'monitor'].includes(role)) { ws.close(1008, 'role'); return; }
    // pages from before versioning keep reconnecting with old code: refuse them so they cannot take the slot
    if (q.get('v') !== VERSION) { console.log(`  古い版のページを断りました（${role}・版 ${q.get('v') || 'なし'}・今の版 ${VERSION}）`); ws.close(4001, 'old version'); return; }
    if (role === 'monitor') {
      peers.monitors.add(ws);
      if (!peers.controller) peers.controller = ws; else sendTo(ws, '{"type":"secondary"}'); // only one PC page controls
    }
    else { const old = peers[role]; if (old && old !== ws) { sendTo(old, '{"type":"replaced"}'); setTimeout(() => old.terminate(), 200); } peers[role] = ws; }
    ws.role = role; ws.alive = true;
    console.log(`  つながりました: ${role === 'ipad' ? 'iPad' : role === 'phone' ? 'iPhone' : 'PC確認画面'}（${req.socket.remoteAddress}）`);
    for (const c of all()) sendTo(c, presence());
    ws.on('pong', () => { ws.alive = true; });
    log(`つながりました：${NAME[role]}（${req.socket.remoteAddress}）`, false);
    ws.on('message', (data, isBinary) => {
      ws.alive = true;
      if (isBinary) { if (role === 'phone') for (const m of peers.monitors) sendTo(m, data, true); return; }
      let m; try { m = JSON.parse(data.toString()); } catch { return; }
      if (role === 'monitor' && ws !== peers.controller) return; // a second PC page only watches
      logMessage(role, m);
      m.from = role; const s = JSON.stringify(m);
      const to = [].concat(m.to || ['ipad', 'phone', 'monitor']).filter((r) => r !== role);
      if (to.includes('ipad')) sendTo(peers.ipad, s);
      if (to.includes('phone')) sendTo(peers.phone, s);
      if (to.includes('monitor')) for (const x of peers.monitors) sendTo(x, s);
    });
    ws.on('close', () => {
      if (role === 'monitor') {
        peers.monitors.delete(ws);
        if (peers.controller === ws) { peers.controller = [...peers.monitors][0] || null; if (peers.controller) sendTo(peers.controller, '{"type":"primary"}'); }
      } else if (peers[role] === ws) peers[role] = null;
      log(`切れました：${NAME[role]}`);
      for (const c of all()) sendTo(c, presence());
    });
  });
}
// heartbeat: a JSON beat the pages can see, plus protocol pings to drop dead sockets
setInterval(() => {
  for (const ws of all()) {
    ws.missed = ws.alive ? 0 : (ws.missed || 0) + 1; ws.alive = false;
    if (ws.missed >= 3) { log(`応答がないので切りました：${NAME[ws.role]}`); ws.terminate(); continue; }
    try { ws.ping(); } catch {} sendTo(ws, '{"type":"beat"}');
  }
}, 2000);

// ---------- static files + status page ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary' };
function handler(ips) {
  return (req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/') { res.writeHead(302, { location: '/sync/monitor.html' }); res.end(); return; }
    if (u.pathname === '/api/version') { res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify({ v: VERSION })); return; }
    const vendor = u.pathname.startsWith('/vendor/three/') ? path.join(ROOT, 'node_modules', 'three', 'build', path.basename(u.pathname))
      : u.pathname === '/vendor/qrcode.js' ? path.join(ROOT, 'node_modules', 'qrcode-generator', 'dist', 'qrcode.js') : null;
    if (vendor) { fs.readFile(vendor, (e, buf) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'max-age=86400' }); res.end(buf); }); return; }
    // recordings from the iPhone (Fable P0-10): POST /api/rec/<id>/<name>, list /api/recs, files under /rec/<id>/<name>
    const safe = (x) => /^[\w.-]{1,80}$/.test(x) && !x.startsWith('.');
    if (u.pathname.startsWith('/api/rec/') && req.method === 'POST') {
      const [id, name] = u.pathname.slice(9).split('/').map(decodeURIComponent);
      if (!safe(id) || !safe(name)) { res.writeHead(400); res.end(); return; }
      const dir = path.join(REC, id); fs.mkdirSync(dir, { recursive: true });
      const out = fs.createWriteStream(path.join(dir, name)); req.pipe(out);
      out.on('finish', () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); });
      out.on('error', () => { res.writeHead(500); res.end(); });
      return;
    }
    if (u.pathname === '/api/recs') {
      const list = fs.readdirSync(REC).filter(safe).sort().reverse().map((id) => ({ id, files: fs.readdirSync(path.join(REC, id)).filter(safe).sort() }));
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(list)); return;
    }
    if (u.pathname.startsWith('/rec/')) {
      const [id, name] = u.pathname.slice(5).split('/').map(decodeURIComponent);
      if (!safe(id) || !safe(name || '')) { res.writeHead(400); res.end(); return; }
      fs.readFile(path.join(REC, id, name), (e, buf) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': TYPES[path.extname(name)] || 'application/octet-stream', 'cache-control': 'no-store' }); res.end(buf); });
      return;
    }
    if (u.pathname === '/api/focal') {
      if (req.method === 'POST') {
        let b = ''; req.on('data', (c) => { b += c; if (b.length > 1e4) req.destroy(); });
        req.on('end', () => { try { const { key, fW } = JSON.parse(b); if (typeof key === 'string' && fW > 0.3 && fW < 2) { const all = readFocal(); (all[key] ||= []).push(+fW.toFixed(5)); all[key] = all[key].slice(0, 20); fs.writeFileSync(FOCAL, JSON.stringify(all, null, 1)); } } catch {} res.writeHead(200); res.end('{}'); });
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(focalOf(u.searchParams.get('key') || ''))); return;
    }
    if (u.pathname === '/api/info') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ips, http: HTTP_PORT, https: HTTPS_PORT })); return; }
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
console.log(`  PCの操作画面: http://localhost:${HTTP_PORT}/`);
console.log(`  ページの版: ${VERSION}`);
console.log(`  記録: ${REC}　ログ: ${logFile}`);
console.log('  このウィンドウを閉じると止まります');
console.log('');
