import type { ControlFrame } from './types';
import { isStaticDemo } from './deployment';

export class InputSocket {
  private socket?: WebSocket;
  private retry?: ReturnType<typeof setTimeout>;
  private stopped = false;
  connected = false;
  onFrame?: (frame: ControlFrame) => void;
  onStatus?: (connected: boolean, message: string) => void;

  constructor(private role: 'viewer' | 'tracker', readonly room: string) {
    if (isStaticDemo) { queueMicrotask(() => this.onStatus?.(false, '公開デモ · 表面タッチ')); return; }
    this.connect();
  }

  private connect() {
    if (this.stopped) return;
    const url = new URL('/input', window.location.href);
    url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('role', this.role);
    url.searchParams.set('room', this.room);
    const ws = this.socket = new WebSocket(url);
    ws.onopen = () => { this.connected = true; this.onStatus?.(true, '中継サーバーに接続'); };
    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'control') this.onFrame?.(data);
        else if (data.type === 'error') this.onStatus?.(false, data.message);
      } catch { /* Malformed messages never become input. */ }
    };
    ws.onclose = (event) => {
      this.connected = false;
      this.onStatus?.(false, event.code === 4003 ? 'このルームは別の追跡画面が使用中です' : '再接続を待っています');
      if (!this.stopped && event.code !== 4003) this.retry = setTimeout(() => this.connect(), 1400);
    };
    ws.onerror = () => { /* onclose owns reconnection. */ };
  }

  send(frame: ControlFrame) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(frame));
  }
  close() { this.stopped = true; clearTimeout(this.retry); this.socket?.close(); }
}
