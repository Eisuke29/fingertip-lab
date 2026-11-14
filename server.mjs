import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { validPose } from './server/protocol.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 5173);
const production = process.argv.includes('--production');
const networkUrls = () => Object.values(os.networkInterfaces()).flat().filter(n => n && n.family === 'IPv4' && !n.internal)
  .map(n => `http://${n.address}:${port}`);
let vite;
const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  if (url.pathname === '/api/network' || url.pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ok: true, local: `http://localhost:${port}`, urls: networkUrls() }));
    return;
  }
  if (!production) return vite.middlewares(req, res);
  let name;
  try { name = decodeURIComponent(url.pathname); } catch { res.writeHead(400); res.end(); return; }
  const dist = path.resolve(root, 'dist');
  let target = path.resolve(dist, '.' + name);
  if (target !== dist && !target.startsWith(dist + path.sep)) { res.writeHead(403); res.end(); return; }
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) target = path.join(dist, 'index.html');
  if (!fs.existsSync(target)) { res.writeHead(503); res.end('Run npm run build first.'); return; }
  const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.task': 'application/octet-stream' };
  res.writeHead(200, { 'Content-Type': mime[path.extname(target)] || 'application/octet-stream' });
  fs.createReadStream(target).pipe(res);
});
if (!production) {
  const { createServer } = await import('vite');
  vite = await createServer({ root, server: { middlewareMode: true, hmr: { server } }, appType: 'spa' });
}

const wss = new WebSocketServer({ noServer: true, maxPayload: 2048 });
const rooms = new Map();
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url || '/', 'http://localhost');
  if (url.pathname !== '/input') return; // Vite handles its own HMR upgrade.
  if (req.headers.origin) {
    try {
      if (new URL(req.headers.origin).host !== req.headers.host) { socket.destroy(); return; }
    } catch { socket.destroy(); return; }
  }
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req, url));
});
wss.on('connection', (ws, req, url) => {
  const role = url.searchParams.get('role');
  const roomName = url.searchParams.get('room') || 'lab';
  if (!['viewer', 'tracker'].includes(role) || !/^[a-zA-Z0-9_-]{1,32}$/.test(roomName)) { ws.close(1008, 'Invalid role or room'); return; }
  if (!rooms.has(roomName)) rooms.set(roomName, { viewers: new Set(), tracker: null });
  const room = rooms.get(roomName);
  const broadcast = data => {
    const json = JSON.stringify(data);
    for (const viewer of room.viewers) if (viewer.readyState === WebSocket.OPEN) viewer.send(json);
  };
  // Tell the sender how many display devices are listening (no viewer data is shared).
  const announcePeers = () => {
    if (room.tracker?.readyState === WebSocket.OPEN) room.tracker.send(JSON.stringify({ type: 'peers', version: 1, viewers: room.viewers.size }));
  };
  if (role === 'viewer') {
    room.viewers.add(ws); announcePeers();
  } else {
    if (room.tracker?.readyState === WebSocket.OPEN) { ws.close(4003, 'Tracker already active'); return; }
    room.tracker = ws;
    ws.streamId = randomUUID();
    ws.seq = -1;
    ws.windowAt = Date.now();
    ws.frameCount = 0;
    announcePeers();
    ws.on('message', raw => {
      let frame;
      try { frame = JSON.parse(raw.toString()); } catch { return; }
      if (!validPose(frame) || frame.seq <= ws.seq) return;
      if (Date.now() - ws.windowAt > 1000) { ws.windowAt = Date.now(); ws.frameCount = 0; }
      if (++ws.frameCount > 100) return;
      ws.seq = frame.seq;
      // Explicitly project the schema: never relay pixels or arbitrary fields.
      broadcast({ type: 'pose', version: 2, seq: frame.seq,
        pose: { tiltX: frame.pose.tiltX, tiltY: frame.pose.tiltY, dip: frame.pose.dip },
        valid: frame.valid, calibrated: frame.calibrated, contact: frame.contact,
        axes: frame.axes, rotation: frame.rotation, confidence: frame.confidence,
        source: frame.source, sentAt: frame.sentAt, streamId: ws.streamId });
    });
  }
  ws.on('error', () => {});
  ws.on('close', () => {
    const wasViewer = room.viewers.delete(ws);
    if (room.tracker === ws) room.tracker = null;
    if (wasViewer) announcePeers();
    // Viewers' receive-time watchdog also covers a stopped-but-open sender.
    if (!room.tracker && !room.viewers.size) rooms.delete(roomName);
  });
});
server.listen(port, '0.0.0.0', () => {
  console.log(`\n  PIVOT FINGER LAB\n  Phone / PC : http://localhost:${port}\n  Developer  : http://localhost:${port}/?dev=1\n  PC tracker : http://localhost:${port}/tracker`);
  for (const url of networkUrls()) console.log(`  LAN phone  : ${url}`);
  console.log('  Keep this terminal running. Ctrl+C to stop.\n');
});
server.on('error', err => { console.error(err.code === 'EADDRINUSE' ? `Port ${port} is already in use. Stop the other server or set PORT.` : err); process.exitCode = 1; });
let closing = false;
async function close() {
  if (closing) return; closing = true;
  for (const client of wss.clients) client.close();
  wss.close();
  await vite?.close();
  server.close();
}
process.on('SIGINT', close);
process.on('SIGTERM', close);
