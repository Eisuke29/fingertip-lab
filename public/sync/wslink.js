// Connection to the PC relay (sync-server.mjs). Reconnects by itself; a silent link is treated as dead.
// addr: the PC's address (e.g. 172.20.10.2), or 'local' when the page itself is served by the PC.
export const HTTPS_PORT = 8443;
export function wsUrl(addr, role) {
  if (addr === 'local') return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/sync-ws?role=${role}`;
  return `wss://${addr}:${HTTPS_PORT}/sync-ws?role=${role}`;
}
export function connect(addr, role, h = {}) {
  let ws = null, alive = true, lastMsg = 0, everOpen = false;
  const state = (t) => h.onState?.(t);
  const open = () => {
    if (!alive) return;
    state('PCにつないでいます');
    try { ws = new WebSocket(wsUrl(addr, role)); } catch { state('PCのアドレスが正しくありません'); return; }
    ws.binaryType = 'blob';
    const sock = ws;
    lastMsg = performance.now();
    sock.onopen = () => { lastMsg = performance.now(); everOpen = true; state('PCにつながりました'); h.onOpen?.(); };
    sock.onmessage = (e) => {
      lastMsg = performance.now();
      if (typeof e.data !== 'string') { h.onBinary?.(e.data); return; }
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.type === 'beat') return;
      if (m.type === 'presence') { api.presence = m; h.onPresence?.(m); return; }
      h.onData?.(m);
    };
    sock.onclose = () => {
      if (ws !== sock) return;
      ws = null; h.onClose?.();
      state(everOpen ? 'PCとの接続が切れました。つなぎ直しています'
        : `PC（${addr === 'local' ? location.host : addr}）につながりません。PCで同期サーバーが動いているか、アドレスと証明書を確認`);
      if (alive) setTimeout(open, 1500);
    };
  };
  const api = {
    presence: { ipad: false, phone: false, monitors: 0 },
    get connected() { return !!ws && ws.readyState === 1; },
    send(m) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); },
    sendBinary(b) { if (ws && ws.readyState === 1 && ws.bufferedAmount < 1e6) ws.send(b); },
    close() { alive = false; try { ws?.close(); } catch {} },
  };
  // the server sends a beat every 2 s; nothing for 6 s means the link is dead (e.g. after sleep)
  setInterval(() => {
    if (!ws || performance.now() - lastMsg < 6000) return;
    if (ws.readyState === 0 && performance.now() - lastMsg < 10000) return; // still opening
    const s = ws; ws = null; s.onclose = null; try { s.close(); } catch {}
    h.onClose?.(); state('PCから応答がありません。つなぎ直しています'); lastMsg = performance.now(); setTimeout(open, 300);
  }, 2000);
  open();
  return api;
}
