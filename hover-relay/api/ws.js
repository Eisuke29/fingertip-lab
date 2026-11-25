// A small relay between two devices (Vercel Function, WebSocket): whatever one device of a room sends, the other gets. Nothing is stored or logged.
// Both connections must end up in the same instance: every device is told the instance, and they come back until the other one is there.
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { randomUUID } from 'node:crypto';

const OK = /^(https:\/\/eisuke29\.github\.io|http:\/\/localhost(:\d+)?)$/, INST = randomUUID().slice(0, 8), rooms = new Map();
const server = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }); r.end('relay ok'); });
const wss = new WebSocketServer({ server, maxPayload: 16 * 1024, perMessageDeflate: false, verifyClient: ({ origin }) => OK.test(origin || '') });
const say = (ws, m) => { if (ws?.readyState === 1) ws.send(JSON.stringify(m)); };
wss.on('connection', (ws, q) => {
  const p = new URL(q.url, 'http://x').searchParams, room = p.get('room') || '', role = p.get('role'); if (!/^[A-Z0-9]{6,12}$/.test(room) || !['a', 'b'].includes(role)) { ws.close(1008); return; }
  const R = rooms.get(room) || {}; rooms.set(room, R); if (R[role]) { const old = R[role]; R[role] = null; old.close(4001); } R[role] = ws; const other = role === 'a' ? 'b' : 'a';
  say(ws, { t: 'hi', inst: INST, peer: !!R[other] }); say(R[other], { t: 'peer', on: true });
  let n = 0, t0 = Date.now(); ws.alive = true; ws.on('pong', () => { ws.alive = true; });
  ws.on('message', (d, binary) => { if (binary) return; if (Date.now() - t0 > 1000) { t0 = Date.now(); n = 0; } if (++n > 250) return; const o = R[other]; if (o?.readyState === 1 && o.bufferedAmount < 65536) o.send(d.toString()); });
  ws.on('close', () => { if (R[role] !== ws) return; R[role] = null; say(R[other], { t: 'peer', on: false }); if (!R.a && !R.b) rooms.delete(room); });
  ws.on('error', () => {});
});
setInterval(() => { for (const ws of wss.clients) { if (!ws.alive) { ws.terminate(); continue; } ws.alive = false; ws.ping(); } }, 20000).unref();
export default server;
