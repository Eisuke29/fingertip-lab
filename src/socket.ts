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
  /** Closed by the relay because another tracker already owns this room. */
  duplicate = false;
  constructor(private role: 'viewer' | 'tracker', private room: string) {
    if (!isStaticDemo) this.connect();
    else queueMicrotask(() => this.onStatus?.('公開版（中継なし）'));
  }
  private connect() {
    if (this.closed) return;
    const url = new URL('/input', location.href); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('role', this.role); url.searchParams.set('room', this.room);
    const ws = this.socket = new WebSocket(url);
    ws.onopen = () => { this.connected = true; this.onStatus?.(`中継に接続 · room ${this.room}`); };
    ws.onmessage = event => { try { const frame = JSON.parse(event.data); if (frame.type === 'pose' && frame.version === 2) this.onPose?.(frame); else if (frame.type === 'peers' && typeof frame.viewers === 'number') this.onPeers?.(frame.viewers); } catch {} };
    ws.onclose = event => {
      this.connected = false; this.duplicate = event.code === 4003; this.onStatus?.(event.code === 4003 ? '同じroomに別の計測画面あり' : '中継に再接続中');
      if (!this.closed && event.code !== 4003) this.retry = setTimeout(() => this.connect(), 1300);
    };
    ws.onerror = () => {};
  }
  send(frame: PoseFrame) { if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(frame)); }
  close() { this.closed = true; clearTimeout(this.retry); this.socket?.close(); }
}
