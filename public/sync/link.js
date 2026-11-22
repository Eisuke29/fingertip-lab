// iPhone <-> iPad link over WebRTC (PeerJS). The public PeerJS server is only used to exchange connection
// info; angles and the small preview video then go directly between the devices on the same Wi-Fi.
const PEERJS = 'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js';

function loadScript(src) {
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('通信ライブラリを読み込めません（インターネット接続を確認）')); document.head.appendChild(s); });
}
export async function getPeerClass() { if (!window.Peer) await loadScript(PEERJS); return window.Peer; }

export const newId = () => 'fl-' + Array.from(crypto.getRandomValues(new Uint8Array(5)), b => b.toString(36).padStart(2, '0')).join('').slice(0, 8);

// Host side (iPad). Calls back with each message; returns {send, peerId, onMedia}
export async function host(id, handlers) {
  const Peer = await getPeerClass();
  const peer = new Peer(id, { debug: 0 });
  let conn = null;
  const api = {
    peer, get connected() { return !!conn?.open; },
    send(m) { if (conn?.open) conn.send(m); },
  };
  peer.on('open', () => handlers.onReady?.(id));
  peer.on('connection', (c) => {
    if (conn) try { conn.close(); } catch {}
    conn = c;
    c.on('open', () => handlers.onOpen?.());
    c.on('data', (m) => handlers.onData?.(m));
    c.on('close', () => { if (conn === c) { conn = null; handlers.onClose?.(); } });
    c.on('error', () => {});
  });
  peer.on('call', (call) => { call.answer(); call.on('stream', (s) => handlers.onStream?.(s)); });
  peer.on('disconnected', () => { try { peer.reconnect(); } catch {} });
  peer.on('error', (e) => handlers.onError?.(e));
  return api;
}

// Client side (iPhone). Keeps retrying until connected.
export async function client(hostId, handlers) {
  const Peer = await getPeerClass();
  const peer = new Peer({ debug: 0 });
  let conn = null, call = null, stream = null, alive = true;
  const api = {
    peer, get connected() { return !!conn?.open; },
    send(m) { if (conn?.open) conn.send(m); },
    setStream(s) { stream = s; if (conn?.open) startCall(); },
    close() { alive = false; try { peer.destroy(); } catch {} },
  };
  const startCall = () => { if (!stream) return; try { call?.close(); } catch {} call = peer.call(hostId, stream); };
  const connect = () => {
    if (!alive || peer.disconnected || peer.destroyed) return;
    const c = peer.connect(hostId, { serialization: 'json', reliable: true });
    c.on('open', () => { conn = c; handlers.onOpen?.(); startCall(); });
    c.on('data', (m) => handlers.onData?.(m));
    c.on('close', () => { if (conn === c) { conn = null; handlers.onClose?.(); } setTimeout(connect, 1500); });
    c.on('error', () => {});
  };
  peer.on('open', connect);
  peer.on('disconnected', () => { try { peer.reconnect(); } catch {} });
  peer.on('error', (e) => { handlers.onError?.(e); if (e.type === 'peer-unavailable') setTimeout(connect, 2000); });
  return api;
}
