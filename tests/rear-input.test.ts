import { describe, expect, it } from 'vitest';
import { RearInput } from '../src/rear-input';
import type { ControlFrame } from '../src/types';

const frame = (seq: number, value: number, valid = true, streamId = 'one'): ControlFrame => ({ type: 'control', version: 1,
  seq, value, valid, calibrated: true, confidence: 1, source: 'camera', sentAt: 0, streamId });
describe('rear input freshness and neutral gate', () => {
  it('requires sustained neutral before the first grasp', () => {
    const input = new RearInput(); input.ingest(frame(0, 0.8), 0); expect(input.sample(0).active).toBe(false);
    input.ingest(frame(1, 0), 10); input.ingest(frame(2, 0), 210); expect(input.sample(210).active).toBe(true);
    input.ingest(frame(3, 0.8), 240); expect(input.sample(240).value).toBe(0.8);
  });
  it('holds brief loss, then releases and requires neutral after recovery', () => {
    const input = new RearInput(); input.ingest(frame(0, 0), 0); input.ingest(frame(1, 0), 200); input.ingest(frame(2, 0.8), 230);
    input.ingest(frame(3, 0.2, false), 260);
    expect(input.sample(380)).toMatchObject({ active: true, value: 0.8, status: 'holding' });
    expect(input.sample(900).active).toBe(false);
    input.ingest(frame(4, 0.8), 930); expect(input.sample(930).active).toBe(false);
    input.ingest(frame(5, 0), 960); input.ingest(frame(6, 0), 1170); expect(input.sample(1170).active).toBe(true);
  });
  it('rejects old sequence numbers and disarms a replacement stream', () => {
    const input = new RearInput(); input.ingest(frame(10, 0), 0); input.ingest(frame(11, 0), 200);
    input.ingest(frame(9, 1), 220); expect(input.value).toBe(0);
    input.ingest(frame(0, 0.7, true, 'two'), 250); expect(input.sample(250).active).toBe(false); expect(input.value).toBe(0.7);
  });
  it('does not arm on uncalibrated data', () => {
    const input = new RearInput(); input.ingest({ ...frame(0, 0), calibrated: false }, 0);
    input.ingest({ ...frame(1, 0), calibrated: false }, 500);
    expect(input.sample(500)).toMatchObject({ active: false, status: 'waiting' });
  });
  it('does not reuse a previous sender\'s last valid pose', () => {
    const input = new RearInput(); input.ingest(frame(0, 0), 0); input.ingest(frame(1, 0), 200);
    input.ingest(frame(2, 0.8), 230);
    input.ingest(frame(0, 0, false, 'replacement'), 250);
    expect(input.sample(260)).toMatchObject({ active: false, status: 'waiting' });
  });
});
