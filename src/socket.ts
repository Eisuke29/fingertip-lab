import { isStaticDemo } from './deployment';
import type { PoseFrame } from './types';
export class PoseSocket {
  onPose?: (frame: PoseFrame) => void;
  onStatus?: (status: string) => void;
  /** Sender only: number of display devices in the room, announced by the relay. */
  onPeers?: (viewers: number) => void;
  private socket?: WebSocket;
  private retry?: ReturnType<typeof setTimeout>;
  private closed = false;
  connected = false;
  /** Closed by the relay because a newer tracker took over this room. */
  replaced = false;
  onReplaced?: () => void;
  constructor(private role: 'viewer' | 'tracker', private room: string) {
    if (!isStaticDemo) this.connect();
    else queueMicrotask(() => this.onStatus?.('公開版（PCと接続なし）'));
  }
  private connect() {
    if (this.closed) return;
    const url = new URL('/input', location.href); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('role', this.role); url.searchParams.set('room', this.room);
    const ws = this.socket = new WebSocket(url);
    ws.onopen = () => { this.connected = true; this.onStatus?.(`PCと接続済み · 接続名 ${this.room}`); };
    ws.onmessage = event => { try { const frame = JSON.parse(event.data); if (frame.type === 'pose' && frame.version === 2) this.onPose?.(frame); else if (frame.type === 'peers' && typeof frame.viewers === 'number') this.onPeers?.(frame.viewers); } catch {} };
    ws.onclose = event => {
      this.connected = false; this.replaced = event.code === 4004; this.onStatus?.(this.replaced ? '別のタブに切り替わりました' : 'PCに再接続中');
      if (this.replaced) this.onReplaced?.();
      if (!this.closed && !this.replaced) this.retry = setTimeout(() => this.connect(), 1300);
    };
    ws.onerror = () => {};
  }
  send(frame: PoseFrame) { if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(frame)); }
  close() { this.closed = true; clearTimeout(this.retry); this.socket?.close(); }
}
