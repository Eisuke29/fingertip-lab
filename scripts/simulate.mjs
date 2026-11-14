import WebSocket from 'ws';

const args = process.argv.slice(2);
const arg = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const url = new URL(arg('--url', 'ws://localhost:5173/input'));
url.searchParams.set('role', 'tracker');
url.searchParams.set('room', arg('--room', 'lab'));
const socket = new WebSocket(url);
let timer;
socket.on('open', () => {
  console.log('INPUT SIMULATION: neutral -> lift -> hold -> release (no camera).');
  let seq = 0;
  const start = Date.now();
  timer = setInterval(() => {
    const t = (Date.now() - start) / 1000;
    const value = t < 1 ? 0 : t < 3 ? (t - 1) / 2 : t < 4 ? 1 : Math.max(0, 1 - (t - 4) / 1.5);
    socket.send(JSON.stringify({ type: 'control', version: 1, seq: seq++, source: 'simulation',
      value, valid: true, calibrated: true, confidence: 1, sentAt: Date.now() }));
    if (t > 6) { clearInterval(timer); socket.close(); }
  }, 33);
});
socket.on('close', code => { clearInterval(timer); if (code === 4003) { console.error('Close the other /tracker page before running this sender.'); process.exitCode = 1; } });
socket.on('error', err => { console.error(err.message); process.exitCode = 1; });
