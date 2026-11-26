// The iPad's side of "the fist comes closer, the finger goes in": finds the iPhone, shows it where the screen is (bright dots), takes the place and
// height of the hand from it. Touching teaches what cannot be known beforehand. The page that draws asks sample() once per picture.
import { Link, newRoom } from './link.js?v=4';
import { Fit, Track, Slow, Mid, POINT } from './geom.js?v=4';
const KEY = 'hover.pad', now = () => performance.now(), el = (h) => { const t = document.createElement('template'); t.innerHTML = h.trim(); return t.content.firstChild; };
const CSS = `#hvChip { position:fixed; left:96px; top:14px; z-index:4; min-height:44px; padding:0 16px; border-radius:22px; border:0; font:600 15px/1 system-ui,"Hiragino Sans",sans-serif; background:rgba(20,22,26,.82); color:#f4f2ef; display:flex; align-items:center; gap:8px; } #hvChip i { width:10px; height:10px; border-radius:50%; background:#f0b264; } #hvChip.ok i { background:#4fd58a; } #hvChip.ng i { background:#ff6b5e; }
#hvPanel { position:fixed; left:14px; top:68px; z-index:5; width:min(400px,calc(100% - 28px)); max-height:calc(100% - 90px); overflow:auto; background:rgba(20,22,26,.94); color:#f4f2ef; border-radius:18px; padding:16px; font:16px/1.6 system-ui,"Hiragino Sans",sans-serif; touch-action:pan-y; } #hvPanel b { font-size:19px; } #hvPanel ol { margin:8px 0; padding-left:22px; } #hvPanel li::before { content:none; } #hvPanel p { margin:6px 0; color:#b9c0c8; font-size:14px; }
#hvQr { background:#fff; padding:10px; border-radius:12px; width:190px; margin:10px 0; } #hvQr svg { display:block; width:100%; height:auto; } #hvPanel button { font:600 15px/1 inherit; border:0; border-radius:12px; min-height:44px; padding:0 14px; background:#2c323a; color:#f4f2ef; margin:4px 6px 4px 0; } #hvPanel label { display:block; font-weight:600; margin-top:10px; font-size:15px; } #hvPanel label span { float:right; color:#b9c0c8; } #hvPanel input { width:100%; height:36px; margin:0; } #hvLog { margin:8px 0 0; white-space:pre-wrap; font:12px/1.5 ui-monospace,monospace; color:#9aa3ad; }
#hvCalib { position:fixed; inset:0; z-index:60; background:#000; touch-action:none; } #hvCalib i { position:absolute; left:0; top:0; border-radius:50%; background:#fff; } #hvCalib span { position:absolute; left:0; right:0; bottom:28px; text-align:center; color:#555; font:600 18px/1.4 system-ui,"Hiragino Sans",sans-serif; }`;

export class Hover {
  // MM: mm per CSS px. camera: () => Promise (asks for the camera; the direct way is only tried after that)
  constructor({ MM, camera }) {
    let s = {}; try { s = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch {} const q = new URLSearchParams(location.search);
    Object.assign(this, { MM, camera, room: q.get('room') || s.room || newRoom(), range: s.range ?? 110, full: s.full ?? 30, lead: s.lead ?? 60, link: null, phone: { at: -1e9 }, pose: null, cal: null, fails: 0, calAt: 0, why: '', last: null, hist: [], down: null, rel: null, lm: 6, sent: 0, got: 0, started: false });
    this.fit = new Fit(); if (s.c2 > 0.4 && s.c2 < 2.5) { this.fit.c = s.c2; this.known = true; } // the size of this hand, from the last time
    this.track = new Track(); this.mid = new Mid(); this.slow = new Slow(0.1); this.slowP = new Slow(0.25); this.ui(); this.save();
    addEventListener('resize', () => { if (this.pose || this.cal) { if (this.cal) this.fail('画面の大きさが変わりました'); this.pose = null; this.fails = 0; this.calAt = now() + 800; } }); // the middle of the page is elsewhere on the glass now
  }
  save() { try { localStorage.setItem(KEY, JSON.stringify({ room: this.room, range: this.range, full: this.full, lead: this.lead, c2: this.fit?.n ? +this.fit.c.toFixed(3) : this.known ? this.fit.c : undefined })); } catch {} }
  // ---------- what is on the screen ----------
  ui() {
    document.head.append(el(`<style>${CSS}</style>`));
    this.chip = el('<button id="hvChip" class="ui"><i></i><span></span></button>'); this.calib = el('<div id="hvCalib" hidden><i></i><span>合わせています。手をどけてください</span></div>');
    this.panel = el(`<div id="hvPanel" class="ui" hidden><b>iPhoneをつなぐ</b><ol><li>iPhoneのカメラで読み取る</li><li>iPhoneをスタンドに置く。iPadの画面全体と、手が写るように</li><li>白い点が出る間は、手をどける</li><li>画面に一度さわる</li></ol><div id="hvQr"></div><p id="hvState"></p><div><button id="hvCal">合わせ直す</button><button id="hvNew">新しい番号</button><button id="hvClose">閉じる</button></div>
      <label>指が入りはじめる高さ<span></span></label><input type="range" id="hvRange" min="20" max="200" step="10"><label>指が全部入る高さ<span></span></label><input type="range" id="hvFull" min="0" max="100" step="5"><label>先読み<span></span></label><input type="range" id="hvLead" min="0" max="160" step="10"><pre id="hvLog"></pre></div>`);
    document.body.append(this.chip, this.panel, this.calib); const $ = (s) => this.panel.querySelector(s);
    this.chip.onclick = () => { this.panel.hidden = !this.panel.hidden; this.seen = true; }; $('#hvClose').onclick = () => { this.panel.hidden = true; this.seen = true; };
    $('#hvCal').onclick = () => { this.fails = 0; this.calAt = 0; this.pose = null; this.why = ''; this.panel.hidden = true; }; $('#hvNew').onclick = () => { this.room = newRoom(); this.save(); this.connect(); };
    const bind = (id, k, u) => { const e = $(id), show = () => { e.previousElementSibling.querySelector('span').textContent = `${e.value}${u}`; }; e.value = this[k]; show(); e.oninput = () => { this[k] = +e.value; show(); this.save(); }; }; bind('#hvRange', 'range', ' mm'); bind('#hvFull', 'full', ' mm'); bind('#hvLead', 'lead', ' ms');
    for (const e of [this.chip, this.panel]) for (const n of ['touchstart', 'pointerdown']) e.addEventListener(n, (x) => x.stopPropagation());
  }
  url() { const u = new URL('../hover/phone.html', location.href), q = new URLSearchParams(location.search); u.searchParams.set('room', this.room); for (const k of ['relay', 'sim', 'cpu']) if (q.has(k)) u.searchParams.set(k, q.get(k) || '1'); return u.href; }
  async qr() {
    const box = this.panel.querySelector('#hvQr'); box.textContent = '';
    try { if (!window.qrcode) await new Promise((ok, ng) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js'; s.onload = ok; s.onerror = ng; document.head.append(s); }); const g = window.qrcode(0, 'M'); g.addData(this.url()); g.make(); box.innerHTML = g.createSvgTag({ cellSize: 4, margin: 0, scalable: true }); } catch { box.textContent = this.url(); box.style.cssText += ';color:#000;font-size:12px;word-break:break-all;width:auto'; }
  }
  // ---------- the way to the iPhone ----------
  async start() { if (this.started) return; this.started = true; this.panel.hidden = false; this.connect(); try { await this.camera?.(); } catch {} this.link?.allowed(); this.allowed = true; }
  connect() {
    this.link?.end(); this.pose = null; this.cal = null; this.calib.hidden = true; this.phone = { at: -1e9 }; this.last = null; this.fails = 0; this.qr();
    this.link = new Link(this.room, 'a', (k, d, way) => { try { if (k === 'data') this.take(d, way); else if (k === 'taken') this.why = '別の画面で開かれました'; } catch (e) { this.err = e.message; } }); if (this.allowed) this.link.allowed();
  }
  take(d, way) {
    const t = now();
    if (d.k === 's') { if (t - this.phone.at > 2500) this.panel.hidden = true; if (d.still === true && this.phone.still === false) this.fails = 0; this.phone = { ...d, at: t }; if (this.pose && d.pose !== this.pose.id) { this.pose = null; this.fails = 0; this.calAt = t + 600; this.why = 'iPhoneが動きました'; } }
    else if (d.k === 'a') { const c = this.cal; if (!c || d.id !== c.id || d.i !== c.i || c.i >= c.pts.length) return; c.i++; c.t = t; this.dot(); }
    else if (d.k === 'p') { const c = this.cal; if (!c || d.id !== c.id || c.i < c.pts.length) return; if (d.ok) { this.pose = { id: d.id, C: d.C, err: d.err, f: d.f, guessed: d.guessed }; this.cal = null; this.calib.hidden = true; this.fails = 0; this.why = ''; this.fit.off = [0, 0]; this.fit.n = Math.min(this.fit.n, 1); this.track.reset(); if (!this.seen) this.panel.hidden = true; } else this.fail(d.why || 'うまく合いませんでした'); }
    else if (d.k === 'h') this.hand(d, way, t);
  }
  // ---------- showing the iPhone where the screen is ----------
  begin(t) { const W = innerWidth * this.MM / 2, H = innerHeight * this.MM / 2, pts = [-0.74, 0, 0.74].flatMap((x) => [0.7, 0, -0.7].map((y) => [+(x * W).toFixed(1), +(y * H).toFixed(1)])); this.cal = { id: Math.floor(Math.random() * 1e6) + 1, i: -1, t, pts, half: [+W.toFixed(1), +H.toFixed(1)] }; this.calib.hidden = false; this.dot(); }
  dot() { const c = this.cal, e = this.calib.firstChild, p = c && c.pts[c.i]; if (!c || c.i >= c.pts.length) { this.calib.hidden = true; return; } e.hidden = !p; if (p) { const r = 7 / this.MM; e.style.width = e.style.height = `${2 * r}px`; e.style.transform = `translate(${innerWidth / 2 + p[0] / this.MM - r}px,${innerHeight / 2 - p[1] / this.MM - r}px)`; } }
  fail(why) { this.cal = null; this.calib.hidden = true; this.fails++; this.calAt = now() + 2500; this.why = why; }
  // once per picture
  step(t) {
    const L = this.link; if (!L) return; const c = this.cal, alive = !!L.way && t - this.phone.at < 2500;
    if (c && (!alive || t - c.t > (c.i >= c.pts.length ? 4000 : 3000))) this.fail(alive ? (c.i < 0 ? 'iPhoneが応えません' : 'iPhoneからiPadの画面が見えていません') : 'iPhoneとのつながりが切れました');
    else if (!c && !this.pose && alive && this.phone.ready && this.phone.still !== false && !this.down && t > this.calAt && this.fails < 3) this.begin(t);
    if (t - this.sent > (this.cal ? 50 : 150)) { this.sent = t; const k = this.cal; L.data({ k: 'pad', cal: k ? { id: k.id, i: k.i, pts: k.pts, half: k.half } : null, lm: this.lm, pose: this.pose?.id || 0 }); }
    const msg = this.msg(t), ok = !msg; if (msg !== this.shown) { this.shown = msg; this.chip.lastChild.textContent = msg || 'iPhone：OK'; this.chip.className = `ui ${ok ? 'ok' : this.fails >= 3 || this.err ? 'ng' : ''}`; this.panel.querySelector('#hvState').textContent = msg; }
    if (!this.panel.hidden && t - (this.tLog || 0) > 400) { this.tLog = t; this.panel.querySelector('#hvLog').textContent = this.info().join('\n'); }
  }
  // which finger and which part of it touches (the page that draws says so)
  point(contact, finger) { this.lm = POINT[contact]?.[finger] ?? 6; }
  msg(t = now()) {
    const L = this.link, P = this.phone; if (!L) return ''; if (this.err) return `エラー：${this.err}`;
    if (!L.way || t - P.at > 2500) return L.peer ? 'iPhoneとつないでいます' : 'iPhoneを待っています';
    if (P.err) return `iPhone：${P.err}`; if (!P.ready) return 'iPhoneが準備しています';
    if (this.cal) return '合わせています'; if (!this.pose) return this.fails >= 3 ? `${this.why}。iPhoneの向きを直して［合わせ直す］` : P.still === false ? 'iPhoneが止まるのを待っています' : this.why || 'これから合わせます';
    if (!this.last || this.last.none || t - this.last.at > 400) return '手が見えません（iPhoneに手が写るように）'; if (!this.fit.n && !this.known) return '画面に一度さわってください'; return '';
  }
  info() { const L = this.link, P = this.pose, m = L?.way && L.m[L.way], f = (v, n = 0) => (v == null ? '—' : v.toFixed(n)); return [`番号 ${this.room}　道 ${L?.way === 'direct' ? '直接' : L?.way === 'relay' ? '中継' : '—'} ${f(m?.rtt)} ms`, `iPhone ${f(this.phone.fps)} コマ/秒・手 ${f(this.phone.ms)} ms${this.phone.gpu === false ? '（CPU）' : ''}`, P ? `合わせ ずれ ${f(P.err, 1)} mm・カメラ ${P.C.map((v) => f(v / 10)).join(', ')} cm${P.guessed ? '（焦点は仮）' : ''}` : '合わせ —', `手の大きさ ×${f(this.fit.c, 2)}・ずれ ${this.fit.off.map((v) => f(v)).join(', ')} mm・さわった回数 ${this.fit.n}`, this.last && !this.last.none ? `高さ ${f(this.last.lift)} mm・遅れ ${f(this.last.age)} ms` : '手 —', ...(L?.log.slice(-3) || [])]; }
  // ---------- the hand ----------
  // the place needs the height too (the camera sees aslant): a calmer height is used for it, so that the place does not tremble with it
  hand(d, way, t) {
    this.got++; if (d.none || !this.pose || d.pid !== this.pose.id) { this.last = { none: true, at: t }; return; }
    const off = this.link.m[way]?.off, tc = off == null ? t - 50 : Math.max(t - 500, Math.min(t, d.t - off)), m = { g: d.g, dz: d.dz, Z: d.Z }, C = this.pose.C, touch = this.touchAt(tc);
    if (touch) { this.fit.learn(m, C, touch); if (this.fit.n % 30 === 1) this.save(); } const raw = this.mid.add(this.fit.height(m, C)), lift = this.slow.add(raw, tc), p = this.fit.place(m, C, touch ? 0 : this.slowP.add(raw, tc)); this.track.add(p, tc); this.last = { at: t, tc, raw, lift, p, age: t - tc };
  }
  // the page that draws tells where the contact is (null: nothing touches), every picture
  touch(p, t) {
    if (p && !this.down) this.down = t; if (!p && this.down) { this.down = null; const h = this.hist[this.hist.length - 1]; this.rel = h ? { p: h.p, t, d: null } : null; this.slow.v = this.slowP.v = 0; }
    if (p) { this.hist.push({ p: [p[0], p[1]], t }); if (this.hist.length > 40) this.hist.shift(); } else if (this.hist.length && t - this.hist[this.hist.length - 1].t > 300) this.hist.length = 0;
  }
  touchAt(tc) { if (!this.down || tc - this.down < 80) return null; let best = null; for (const h of this.hist) if (!best || Math.abs(h.t - tc) < Math.abs(best.t - tc)) best = h; return best && Math.abs(best.t - tc) < 60 ? best.p : null; }
  // where the knuckle is now and how high above the glass: { p: [x, y] mm, lift: mm } or null (no hand, or not ready)
  // before the first touch the height is a guess, and with it the place: nothing is given then
  sample(t) {
    const l = this.last; if (!this.pose || !l || l.none || t - l.at > 300 || !this.fit.n && !this.known) return null; const p = this.track.at(t + this.lead); if (!p) return null;
    const r = this.rel; if (r) { if (t - r.t > 500) this.rel = null; else { r.d ||= [r.p[0] - p[0], r.p[1] - p[1]]; const k = Math.exp(-(t - r.t) / 90); p[0] += r.d[0] * k; p[1] += r.d[1] * k; } } // let go: from where the contact was, without a jump
    const lift = Math.max(0, l.lift - 2); return { p, lift, in: Math.min(1, (this.range - lift) / Math.max(10, this.range - this.full)), raw: l.raw }; // in: 0 the finger begins to come in, 1 all of it is in (already some way above the glass: things can be touched without touching the glass)
  }
}
