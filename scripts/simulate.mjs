import WebSocket from 'ws';

const args = process.argv.slice(2);
const arg = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const url = new URL(arg('--url', 'ws://localhost:5173/input'));
url.searchParams.set('role', 'tracker');
url.searchParams.set('room', arg('--room', 'lab'));
const socket = new WebSocket(url);
let timer;
socket.on('open', () => {
  console.log('INPUT SIMULATION: fixed PIP, DIP press/hold/release, independent hand tilt (no camera).');
  let seq = 0;
  const start = Date.now();
  timer = setInterval(() => {
    const t = (Date.now() - start) / 1000;
    const dip = t < 1 ? 0 : t < 3 ? (t - 1) / 2 * 1.12 : t < 5 ? 1.12 : Math.max(0, (7 - t) / 2 * 1.12);
    socket.send(JSON.stringify({ type: 'pose', version: 2, seq: seq++, source: 'simulation',
      pose: { tiltX: t > 8 ? Math.sin((t - 8) * 2) * 0.15 : 0, tiltY: t > 8 ? Math.cos((t - 8) * 2) * 0.1 : 0, dip },
      contact: t > 0.6 && t < 11, axes: 'estimated-xy', rotation: Number(arg('--rotation', '0')),
      valid: true, calibrated: true, confidence: 1, sentAt: Date.now() }));
    if (t > 12) { clearInterval(timer); socket.close(); }
  }, 33);
});
socket.on('close', code => { clearInterval(timer); if (code === 4003) { console.error('Close the other /tracker page before running this sender.'); process.exitCode = 1; } });
socket.on('error', err => { console.error(err.message); process.exitCode = 1; });
