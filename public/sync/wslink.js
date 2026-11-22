// Connection to the PC relay (sync-server.mjs). Reconnects by itself; a silent link is treated as dead.
// The page's version goes with the connection; the server refuses other versions (code 4001).
export function connect(role, version, h = {}) {
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/sync-ws?role=${role}&v=${version}`;
  let ws = null, alive = true, lastMsg = 0, everOpen = false;
  const state = (t) => h.onState?.(t);
  const open = () => {
    if (!alive) return;
    state('PCにつないでいます');
    try { ws = new WebSocket(url); } catch { state('PCにつなげません'); setTimeout(open, 2000); return; }
    ws.binaryType = 'blob';
    const sock = ws; lastMsg = performance.now();
    sock.onopen = () => { lastMsg = performance.now(); everOpen = true; state('PCにつながりました'); h.onOpen?.(); };
    sock.onmessage = (e) => {
      lastMsg = performance.now();
      if (typeof e.data !== 'string') { h.onBinary?.(e.data); return; }
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.type === 'beat') return;
      if (m.type === 'presence') { api.presence = m; h.onPresence?.(m); return; }
      h.onData?.(m);
    };
    sock.onclose = (ev) => {
      if (ws !== sock) return;
      ws = null; h.onClose?.();
      if (ev.code === 4001) { alive = false; state('このページは古い版です'); h.onOld?.(); return; }
      state(everOpen ? 'PCとの接続が切れました。つなぎ直しています' : 'PCにつながりません。PCで同期サーバーが動いているか確認');
      if (alive) setTimeout(open, 1500);
    };
  };
  const api = {
    presence: { ipad: false, phone: false, monitors: 0 },
    get connected() { return !!ws && ws.readyState === 1; },
    get buffered() { return ws ? ws.bufferedAmount : 0; },
    send(m) { if (ws && ws.readyState === 1) { ws.send(JSON.stringify(m)); return true; } return false; },
    // preview frames are dropped while anything is queued (commands must not wait behind video; Fable P0-9)
    sendBinary(b) { if (ws && ws.readyState === 1 && ws.bufferedAmount < 200000) ws.send(b); },
    close() { alive = false; try { ws?.close(); } catch {} },
  };
  // the server sends a beat every 2 s; nothing for 7 s means the link is dead (e.g. after sleep)
  setInterval(() => {
    if (!ws || performance.now() - lastMsg < 7000) return;
    if (ws.readyState === 0 && performance.now() - lastMsg < 10000) return;
    const s = ws; ws = null; s.onclose = null; try { s.close(); } catch {}
    h.onClose?.(); state('PCから応答がありません。つなぎ直しています'); lastMsg = performance.now(); setTimeout(open, 300);
  }, 2000);
  setTimeout(open, 0);
  return api;
}
