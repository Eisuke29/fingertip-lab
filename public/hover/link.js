// Two devices, two ways at the same time: direct (WebRTC data channel) and through the relay (WebSocket). Whichever works is used, the faster one when both do.
// The direct way is tried only after both devices have allowed the camera: before that Safari hides the addresses.
export const RELAY = new URLSearchParams(typeof location === 'undefined' ? '' : location.search).get('relay') || 'wss://hover-relay.vercel.app/api/ws';
const ALPHA = 'ACDEFHJKMNPRTUVWXY34679';
export const newRoom = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => ALPHA[b % ALPHA.length]).join('');

// how long a way takes there and back, how much is lost, how far apart the two clocks are
export class Meter {
  constructor() { this.r = []; this.sent = 0; this.got = 0; this.open = new Map(); this.off = null; this.best = 1e9; this.last = -1e9; }
  ping(now) { const id = ++this.sent; this.open.set(id, now); if (this.open.size > 40) this.open.delete(this.open.keys().next().value); return id; }
  pong(id, now, theirs) { const t = this.open.get(id); if (t == null) return; this.open.delete(id); this.got++; this.last = now; const d = now - t; this.r.push(d); if (this.r.length > 50) this.r.shift(); if (d <= this.best || now - this.tBest > 60000) { this.best = d; this.tBest = now; this.off = theirs - (t + d / 2); } }
  get rtt() { if (!this.r.length) return null; const a = [...this.r].sort((x, y) => x - y); return a[a.length >> 1]; }
  get p95() { if (!this.r.length) return null; const a = [...this.r].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(a.length * 0.95))]; }
  get loss() { const n = this.sent - Math.min(3, this.open.size); return n > 5 ? Math.max(0, 1 - this.got / n) : null; }
  fresh(now) { return now - this.last < 1500; }
}
// direct is used when it is alive and not clearly slower
export function choose(direct, relay, now, was) {
  const d = direct.fresh(now), r = relay.fresh(now); if (!d && !r) return null; if (d !== r) return d ? 'direct' : 'relay';
  const m = was === 'direct' ? 25 : 5; return direct.rtt <= relay.rtt + m ? 'direct' : 'relay';
}

export class Link {
  // role a: iPad (shows the code), b: iPhone
  constructor(room, role, on) { Object.assign(this, { room, role, on, ws: null, peer: false, pc: null, dc: null, ready: false, other: false, way: null, cand: { own: new Set(), their: new Set() }, pair: '', log: [], delay: 500, tries: 0 }); this.m = { direct: new Meter(), relay: new Meter() }; this.open(); this.tick = setInterval(() => this.beat(), 200); }
  note(s) { this.log.push(`${new Date().toTimeString().slice(0, 8)} ${s}`); if (this.log.length > 60) this.log.shift(); }
  open() {
    if (this.dead) return; clearTimeout(this.again); const ws = this.ws = new WebSocket(`${RELAY}?room=${this.room}&role=${this.role}`); this.t0 = performance.now();
    ws.onopen = () => { this.delay = 500; this.note('中継につながった'); };
    ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } this.take(m, 'relay'); };
    ws.onclose = (e) => { if (this.ws !== ws) return; this.peer = false; this.note(`中継が切れた（${e.code}）`); if (e.code === 4001) { this.on?.('taken'); this.dead = true; return; } this.again = setTimeout(() => this.open(), this.delay); this.delay = Math.min(8000, this.delay * 1.7); };
    ws.onerror = () => {};
  }
  say(m, way) { const s = JSON.stringify(m); if (way === 'relay') { if (this.ws?.readyState === 1) { this.ws.send(s); return true; } } else if (this.dc?.readyState === 'open' && this.dc.bufferedAmount < 65536) { this.dc.send(s); return true; } return false; }
  // the camera is allowed: from now on the direct way may be tried
  allowed() { this.ready = true; this.say({ t: 'ready' }, 'relay'); this.call(); }
  take(m, way) {
    const now = performance.now();
    if (m.t === 'hi') { this.inst = m.inst; this.peer = m.peer; this.alone = now; this.joined(); } else if (m.t === 'peer') { this.peer = m.on; this.alone = now; if (m.on) this.joined(); else this.other = false; }
    else if (m.t === 'ready') { const was = this.other; this.other = true; if (!was && this.ready) this.say({ t: 'ready' }, 'relay'); this.call(); }
    else if (m.t === 'ping') this.say({ t: 'pong', id: m.id, c: now }, way); else if (m.t === 'pong') this.m[way].pong(m.id, now, m.c);
    else if (m.t === 'sdp' || m.t === 'ice') this.signal(m); else if (m.t === 'd') { if (!(m.n <= this.lastN && m.n > this.lastN - 1000)) { this.lastN = m.n; this.on?.('data', m.d, way); } }
  }
  joined() { this.peerAt = this.peer ? performance.now() : null; if (this.peer && this.ready) this.say({ t: 'ready' }, 'relay'); }
  beat() {
    const now = performance.now(); for (const w of ['relay', 'direct']) { if (w === 'relay' && !this.peer) continue; this.say({ t: 'ping', id: this.m[w].ping(now) }, w) || this.m[w].open.delete(this.m[w].sent) && this.m[w].sent--; }
    const w = choose(this.m.direct, this.m.relay, now, this.way); if (w !== this.way) { this.note(w ? `使う道：${w === 'direct' ? '直接' : '中継'}` : '途切れた'); this.way = w; }
    // alone in the room for a while: perhaps the other one is in another instance
    if (this.ws?.readyState === 1 && !this.peer && this.alone && now - this.alone > 5000 + (this.role === 'b' ? 1500 : 60000) + Math.random() * 1500) { this.note('相手を探し直す'); this.alone = null; this.ws.close(); }
    if (this.role === 'a' && this.ready && this.other && this.peer && this.pc && this.dc?.readyState !== 'open' && now - this.tCall > 9000) this.call(true);
    this.on?.('tick');
  }
  data(d) { this.n = (this.n || 0) + 1; return this.way ? this.say({ t: 'd', n: this.n, d }, this.way) : false; }
  call(again) {
    if (!this.ready || !this.other) return; if (this.role === 'a' && this.pc && !again) return; if (this.role === 'b') return; // the iPad calls
    this.tCall = performance.now(); this.tries++; this.note(`直接を試す（${this.tries}回目）`); this.make(); this.use(this.pc.createDataChannel('d', { ordered: false, maxRetransmits: 0 })); const pc = this.pc; pc.createOffer().then((o) => pc.setLocalDescription(o)).then(() => this.say({ t: 'sdp', k: this.tries, s: pc.localDescription }, 'relay')).catch((e) => this.note(e.message));
  }
  make() {
    this.pc?.close(); const pc = this.pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }); this.wait = [];
    pc.onicecandidate = (e) => { if (e.candidate) { this.seen('own', e.candidate.candidate); this.say({ t: 'ice', k: this.tries, c: e.candidate }, 'relay'); } };
    pc.ondatachannel = (e) => this.use(e.channel); pc.oniceconnectionstatechange = () => { if (this.pc === pc) { this.note(`直接：${pc.iceConnectionState}`); if (['connected', 'completed'].includes(pc.iceConnectionState)) this.stats(); } };
  }
  use(dc) { this.dc = dc; dc.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } this.take(m, 'direct'); }; dc.onopen = () => this.note('直接がつながった'); }
  async signal(m) {
    try {
      if (m.t === 'sdp' && m.s.type === 'offer') { this.tries = m.k; this.make(); const pc = this.pc; await pc.setRemoteDescription(m.s); for (const c of this.wait.splice(0)) await pc.addIceCandidate(c).catch(() => {}); await pc.setLocalDescription(await pc.createAnswer()); this.say({ t: 'sdp', k: m.k, s: pc.localDescription }, 'relay'); }
      else if (m.t === 'sdp' && m.k === this.tries) { await this.pc.setRemoteDescription(m.s); for (const c of this.wait.splice(0)) await this.pc.addIceCandidate(c).catch(() => {}); }
      else if (m.t === 'ice' && m.k === this.tries && this.pc) { this.seen('their', m.c.candidate); if (this.pc.remoteDescription) await this.pc.addIceCandidate(m.c).catch(() => {}); else this.wait.push(m.c); }
    } catch (e) { this.note(e.message); }
  }
  // only the kind of address is kept, not the address
  seen(who, c) { const k = /typ (\w+)/.exec(c)?.[1]; if (k) this.cand[who].add(k + (/\.local/.test(c) ? '(隠し)' : / 172\.20\.10\./.test(c) ? '(テザリング)' : / (10\.|192\.168\.|172\.)/.test(c) ? '(家/学内)' : '')); }
  async stats() { try { const s = await this.pc.getStats(), all = [...s.values()], p = all.find((x) => x.type === 'candidate-pair' && (x.selected || (x.nominated && x.state === 'succeeded'))); if (p) this.pair = `${s.get(p.localCandidateId)?.candidateType || '?'} ↔ ${s.get(p.remoteCandidateId)?.candidateType || '?'}`; } catch {} }
  end() { this.dead = true; clearInterval(this.tick); clearTimeout(this.again); this.pc?.close(); this.ws?.close(); }
}
