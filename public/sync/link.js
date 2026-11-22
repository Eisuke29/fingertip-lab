// iPad (host) <-> iPhone / PC monitor over WebRTC (PeerJS). The public PeerJS server is only used to exchange
// connection info; data and video then go directly between the devices on the same Wi-Fi.
const PEERJS = 'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js';
function loadScript(src) {
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('通信ライブラリを読み込めません（インターネット接続を確認）')); document.head.appendChild(s); });
}
export async function getPeerClass() { if (!window.Peer) await loadScript(PEERJS); return window.Peer; }

// 4-character room code without look-alike characters; the peer id is 'fl-' + code
const ALPHA = 'ACDEFHJKMNPRTUVWXY34679';
export const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => ALPHA[b % ALPHA.length]).join('');
export const peerIdOf = (code) => 'fl-' + String(code).trim().toUpperCase();

// Host (iPad): many connections, each tagged with a role ('phone' or 'monitor')
export async function host(code, h) {
  const Peer = await getPeerClass();
  const peer = new Peer(peerIdOf(code), { debug: 0 });
  const conns = new Set();
  const api = {
    peer, conns,
    send(m, role = 'phone') { for (const c of conns) if (c.open && c.role === role) c.send(m); },
    has(role) { for (const c of conns) if (c.open && c.role === role) return true; return false; },
  };
  peer.on('open', () => h.onReady?.());
  peer.on('connection', (c) => {
    c.role = c.metadata?.role === 'monitor' ? 'monitor' : 'phone';
    if (c.role === 'phone') for (const o of conns) if (o.role === 'phone') { try { o.close(); } catch {} conns.delete(o); }
    conns.add(c);
    c.on('open', () => h.onOpen?.(c));
    c.on('data', (m) => h.onData?.(m, c));
    c.on('close', () => { conns.delete(c); h.onClose?.(c); });
    c.on('error', () => {});
  });
  peer.on('call', (call) => { call.answer(); call.on('stream', (s) => h.onStream?.(s, call)); });
  peer.on('disconnected', () => { try { peer.reconnect(); } catch {} });
  peer.on('error', (e) => h.onError?.(e));
  return api;
}

// Client (iPhone or PC monitor). Retries until the host is there.
export async function client(code, h, role = 'phone') {
  const Peer = await getPeerClass();
  const peer = new Peer({ debug: 0 });
  let conn = null, alive = true, stream = null;
  const calls = new Map();
  const api = {
    peer, get connected() { return !!conn?.open; },
    send(m) { if (conn?.open) conn.send(m); },
    setStream(s) { stream = s; },
    call(id) { if (!stream) return; try { calls.get(id)?.close(); } catch {} calls.set(id, peer.call(id, stream)); },
    // the host stopped answering: drop the old link and connect again
    reconnect() { const c = conn; conn = null; pendingAt = 0; if (peer.disconnected) { try { peer.reconnect(); } catch {} } try { c?.close(); } catch {} setTimeout(() => { if (!conn) connect(); }, 2000); },
    close() { alive = false; try { peer.destroy(); } catch {} },
  };
  const state = (t) => h.onState?.(t);
  let pendingAt = 0;
  const connect = () => {
    if (!alive || peer.destroyed || conn?.open) return;
    if (performance.now() - pendingAt < 8000) return; // a connection attempt is already under way
    pendingAt = performance.now();
    state('iPadを探しています');
    const c = peer.connect(peerIdOf(code), { serialization: 'json', reliable: true, metadata: { role } });
    // diagnose: found the iPad but the direct link between the devices does not come up
    const watch = setInterval(() => {
      const pc = c.peerConnection; if (!pc) return;
      const s = pc.iceConnectionState;
      if (s === 'checking') state('iPadは見つかりました。直接つないでいます');
      if (s === 'failed' || s === 'disconnected') { state('iPadは見つかりましたが、直接つながりません（Wi-Fiが端末どうしの通信を止めている可能性）'); clearInterval(watch); }
      if (c.open) clearInterval(watch);
    }, 500);
    setTimeout(() => { if (!c.open && c.peerConnection) state('iPadは見つかりましたが、直接つながりません（Wi-Fiが端末どうしの通信を止めている可能性）'); }, 12000);
    c.on('open', () => { conn = c; pendingAt = 0; clearInterval(watch); state('つながりました'); h.onOpen?.(); });
    c.on('data', (m) => h.onData?.(m));
    c.on('close', () => { if (conn === c) { conn = null; h.onClose?.(); } pendingAt = 0; setTimeout(connect, 1500); });
    c.on('error', () => {});
  };
  peer.on('open', connect);
  peer.on('call', (call) => { call.answer(); call.on('stream', (s) => h.onStream?.(s)); });
  peer.on('disconnected', () => { state('仲介サーバーとの接続が切れました。再接続しています'); try { peer.reconnect(); } catch {} });
  peer.on('error', (e) => {
    h.onError?.(e);
    if (e.type === 'peer-unavailable') { pendingAt = 0; state(`番号 ${String(code).toUpperCase()} のiPadが見つかりません（iPadのアプリが開いているか、番号が合っているか確認）`); setTimeout(connect, 2000); }
    else if (e.type === 'network' || e.type === 'server-error' || e.type === 'socket-error') state('仲介サーバーにつながりません（インターネット接続を確認）');
    else state(`通信エラー：${e.type}`);
  });
  setTimeout(() => { if (!peer.open) state('仲介サーバーにつながりません（インターネット接続を確認）'); }, 8000);
  return api;
}
