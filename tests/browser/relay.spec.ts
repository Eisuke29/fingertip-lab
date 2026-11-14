import { test, expect } from '@playwright/test';
import WebSocket from 'ws';

test('relay isolates rooms, drops duplicate sequences, and forwards only the pose schema', async () => {
  const room = 'relay-' + Date.now();
  const connect = async (role: string, name = room) => { const ws = new WebSocket(`ws://localhost:5173/input?role=${role}&room=${name}`); await new Promise<void>(resolve => ws.on('open', () => resolve())); return ws; };
  const viewer = await connect('viewer'), other = await connect('viewer', room + '-other'), sender = await connect('tracker');
  const frames: any[] = [], unrelated: any[] = [];
  viewer.on('message', raw => frames.push(JSON.parse(String(raw)))); other.on('message', raw => unrelated.push(JSON.parse(String(raw))));
  const packet = { type: 'pose', version: 2, seq: 1, source: 'markers', pose: { tiltX: -0.2, tiltY: 0, dip: 0.6 }, valid: true, calibrated: true, contact: true, axes: 'plane-y', rotation: 0, confidence: 1, sentAt: Date.now(), pixels: 'NEVER_FORWARD' };
  try {
    sender.send(JSON.stringify(packet)); await expect.poll(() => frames.length).toBe(1);
    expect(frames[0].pose).toEqual(packet.pose); expect(frames[0].pixels).toBeUndefined(); expect(frames[0].streamId).toBeTruthy();
    sender.send(JSON.stringify(packet)); sender.send(JSON.stringify({ type: 'control', version: 1, value: 1 }));
    await new Promise(resolve => setTimeout(resolve, 100)); expect(frames).toHaveLength(1); expect(unrelated).toHaveLength(0);
    const duplicate = await connect('tracker');
    const code = await new Promise(resolve => duplicate.on('close', code => resolve(code))); expect(code).toBe(4003);
  } finally { viewer.close(); other.close(); sender.close(); }
});
