import { describe, expect, it } from 'vitest';
import { HandCalibration, measureHand, OneEuro, type HandSample } from '../src/calibration';
import { MarkerTracker } from '../src/marker-tracking';
import { PoseReceiver } from '../src/pose-input';
import { rotate, v } from '../src/math';
import { validPose } from '../server/protocol.mjs';
import { neutralPose, type PoseFrame } from '../src/types';

const image = (down = false, bent = false): HandSample['image'] => [down ? { x: 127, y: 281 } : { x: 120, y: 240 }, { x: 240, y: 240 }, { x: 330, y: 200 }, bent ? { x: 345, y: 265 } : { x: 395, y: 210 }];
function record(c: HandCalibration, kind: 'neutral' | 'down' | 'left' | 'bent', sample: HandSample) { for (let i = 0; i < 12; i++) c.push(sample); expect(c.record(kind)).toBe(true); }
const packet = (seq = 0): PoseFrame => ({ type: 'pose', version: 2, seq, source: 'markers', pose: neutralPose(), valid: true, calibrated: true, contact: true, axes: 'plane-y', rotation: 0, confidence: 1, sentAt: 100, streamId: 'one' });

describe('independent hand measurement and calibration', () => {
  it('uses MCP/PIP for hand tilt and PIP/DIP/tip for DIP angle', () => {
    const rest = measureHand(image(), null)!, down = measureHand(image(true), null)!, bent = measureHand(image(false, true), null)!;
    expect(down.bend).toBe(rest.bend); expect(bent.handAngle).toBe(rest.handAngle); expect(bent.bend).toBeGreaterThan(rest.bend + 0.5);
    const c = new HandCalibration(); record(c, 'neutral', rest); record(c, 'down', down); record(c, 'bent', bent);
    const moved = c.pose(down, 0.1); expect(moved.tiltY).toBeLessThan(-0.2); expect(moved.tiltX).toBe(0); expect(moved.dip).toBe(0);
    for (let i = 0; i < 40; i++) c.pose(bent, 0.1);
    const flexed = c.pose(bent, 0.1); expect(Math.abs(flexed.tiltY)).toBeLessThan(0.001); expect(flexed.dip).toBeGreaterThan(1);
  });
  it('calibrates two non-collinear estimated axes without a second mirror inversion', () => {
    const sample = (hand = v(-0.05), bent = false) => measureHand(image(false, bent), [hand, v(), v(0.035), bent ? v(0.04, 0.025) : v(0.06, 0.005)])!;
    const c = new HandCalibration(); c.mode = 'estimated-xy';
    const rest = sample(), down = sample(rotate(v(-0.05), v(0, 0, 1), 0.3)), left = sample(rotate(v(-0.05), v(0, 1, 0), 0.3));
    record(c, 'neutral', rest); record(c, 'down', down); record(c, 'left', left); record(c, 'bent', sample(v(-0.05), true));
    expect(c.pose(down, 0.1).tiltY).toBeCloseTo(-0.3, 2);
    for (let i = 0; i < 40; i++) c.pose(left, 0.1);
    const p = c.pose(left, 0.1); expect(p.tiltX).toBeCloseTo(-0.3, 3); expect(p.tiltY).toBeCloseTo(0, 3);
  });
  it('smooths jitter while still and follows real motion with little lag', () => {
    const f = new OneEuro(); let maxJitter = 0;
    for (let i = 0; i < 60; i++) { const out = f.filter(0.5 + (i % 2 ? 0.02 : -0.02), 1 / 30); if (i > 10) maxJitter = Math.max(maxJitter, Math.abs(out - 0.5)); }
    expect(maxJitter).toBeLessThan(0.008);
    let out = 0; for (let i = 0; i < 9; i++) out = f.filter(0.5 + (i + 1) * 0.1, 1 / 30);
    expect(1.4 - out).toBeLessThan(0.2);
  });
  it('rejects frames whose image bone lengths jump away from the calibrated pose', () => {
    const c = new HandCalibration(); record(c, 'neutral', measureHand(image(), null)!);
    expect(c.plausible(measureHand(image(true), null)!)).toBe(true);
    expect(c.plausible(measureHand([{ x: 120, y: 240 }, { x: 240, y: 240 }, { x: 265, y: 230 }, { x: 395, y: 210 }], null)!)).toBe(false);
  });
  it('rejects missing/foreshortened joints and unstable calibration', () => {
    expect(measureHand([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 20, y: 0 }, { x: 40, y: 0 }], null)).toBeNull();
    const c = new HandCalibration(); expect(c.record('neutral')).toBe(false);
    for (let i = 0; i < 12; i++) c.push(measureHand(image(i % 2 === 0), null)); expect(c.record('neutral')).toBe(false); expect(c.ready).toBe(false);
  });
});

describe('tracking watchdog and contact registration', () => {
  it('freezes short loss, restores alignment requirement after long loss and rejects stale sequences', () => {
    const r = new PoseReceiver(); expect(r.align()).toBe(false); r.ingest(packet(), 0); expect(r.sample(10, 0).valid).toBe(true); expect(r.align()).toBe(true);
    r.ingest({ ...packet(1), valid: false, contact: false, pose: { tiltX: 1, tiltY: 1, dip: 1 } }, 100);
    expect(r.sample(200, 0)).toMatchObject({ hold: true, contact: true, pose: neutralPose() }); expect(r.alignRequired).toBe(false);
    expect(r.sample(651, 0).status).toBe('lost'); expect(r.alignRequired).toBe(true);
    expect(r.ingest(packet(0), 700)).toBe(false); expect(r.sample(700, 0).status).toBe('lost');
    r.ingest(packet(2), 710); expect(r.sample(710, 0).status).toBe('ready'); expect(r.alignRequired).toBe(true); expect(r.align()).toBe(true);
  });
  it('requires re-registration after sender replacement or screen rotation', () => {
    const r = new PoseReceiver(); r.ingest(packet(9), 0); r.sample(0, 0); r.align();
    expect(r.sample(1, 90).status).toBe('rotation'); expect(r.alignRequired).toBe(true);
    r.ingest({ ...packet(0), streamId: 'two' }, 100); expect(r.streamChanged).toBe(true); expect(r.sample(100, 0).valid).toBe(true); expect(r.alignRequired).toBe(true);
  });
});

describe('input validation', () => {
  it('accepts only bounded three-angle pose frames, never the old scalar control protocol', () => {
    expect(validPose(packet())).toBe(true); expect(validPose({ type: 'control', version: 1, value: 1 })).toBe(false);
    expect(validPose({ ...packet(), pose: { ...neutralPose(), dip: NaN } })).toBe(false);
    expect(validPose({ ...packet(), rotation: 45 })).toBe(false); expect(validPose({ ...packet(), confidence: 2 })).toBe(false);
  });
  it('tracks four distinct colors and invalidates a frame if any proximal or distal point disappears', () => {
    const width = 160, height = 120, data = new Uint8ClampedArray(width * height * 4), colors = ['#ff0000', '#00ff00', '#0000ff', '#ff00ff'];
    const rgb = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 0, 255]];
    for (let i = 0; i < 4; i++) for (let x = 20 + i * 30; x < 26 + i * 30; x++) for (let y = 40; y < 46; y++) { const at = (y * width + x) * 4; data.set([...rgb[i], 255], at); }
    const tracker = new MarkerTracker(); expect(tracker.detect(data, width, height, colors).valid).toBe(true);
    for (let x = 20; x < 26; x++) for (let y = 40; y < 46; y++) data.fill(0, (y * width + x) * 4, (y * width + x) * 4 + 4);
    expect(tracker.detect(data, width, height, colors).valid).toBe(false);
  });
});

describe('marker colours', () => {
  it('accepts one black pen mark, names the bad joint otherwise, and samples the clicked mark robustly', async () => {
    const { markerColorProblem, sampleMarkerColor } = await import('../src/marker-tracking');
    expect(markerColorProblem(['#e02020', '#20a040', '#8a3cc8', '#141414'])).toBeNull();
    expect(markerColorProblem(['#eaa58f', '#20a040', '#8a3cc8', '#141414'])).toContain('付け根で肌の色を採取');
    expect(markerColorProblem(['#e02020', '#8c8c8c', '#8a3cc8', '#141414'])).toContain('第2関節の色が薄すぎます');
    expect(markerColorProblem(['#e02020', '#101010', '#8a3cc8', '#141414'])).toContain('第2関節と指先');
    const width = 40, height = 40, data = new Uint8ClampedArray(width * height * 4).fill(200);
    for (let x = 20; x < 24; x++) for (let y = 20; y < 24; y++) data.set([30, 160, 60, 255], (y * width + x) * 4);
    data.set([255, 255, 255, 255], (21 * width + 21) * 4); // one stray pixel inside the mark
    const picked = sampleMarkerColor(data, width, height, 21, 21);
    expect(picked.hex).toBe('#1ea03c'); expect(picked.x).toBe(21);
  });
  it('tracks a black mark among three coloured marks', () => {
    const width = 160, height = 120, data = new Uint8ClampedArray(width * height * 4).fill(210);
    const rgb = [[220, 30, 30], [30, 170, 60], [140, 60, 200], [15, 15, 15]];
    for (let i = 0; i < 4; i++) for (let x = 20 + i * 30; x < 26 + i * 30; x++) for (let y = 40; y < 46; y++) data.set([...rgb[i], 255], (y * width + x) * 4);
    const r = new MarkerTracker().detect(data, width, height, ['#dc1e1e', '#1eaa3c', '#8c3cc8', '#0f0f0f']);
    expect(r.valid).toBe(true); expect(r.points[3]!.x).toBeCloseTo(112.5, 0);
  });
});

describe('marker tracking guided by hand-model hints', () => {
  it('takes the same-coloured mark nearest the model hint, not a larger blob elsewhere', () => {
    const width = 200, height = 120, data = new Uint8ClampedArray(width * height * 4).fill(210);
    const paint = (x0: number, y0: number, n: number, rgb: number[]) => { for (let x = x0; x < x0 + n; x++) for (let y = y0; y < y0 + n; y++) data.set([...rgb, 255], (y * width + x) * 4); };
    const red = [220, 30, 30], green = [30, 170, 60], purple = [140, 60, 200], black = [15, 15, 15];
    paint(20, 20, 4, red); paint(150, 20, 9, red); // the real mark (small) and a bigger red thing far away
    paint(50, 60, 5, green); paint(80, 70, 5, purple); paint(110, 80, 5, black);
    const colors = ['#dc1e1e', '#1eaa3c', '#8c3cc8', '#0f0f0f'];
    const hints = [{ x: 24, y: 24 }, { x: 52, y: 62 }, { x: 82, y: 72 }, { x: 112, y: 82 }];
    const r = new MarkerTracker().detect(data, width, height, colors, hints);
    expect(r.valid).toBe(true); expect(r.points[0]!.x).toBeCloseTo(21.5, 0);
    const noHint = new MarkerTracker().detect(data, width, height, colors);
    expect(noHint.points[0]!.x).toBeGreaterThan(100); // without a hint the larger blob wins
  });
});

describe('white fingertip mark', () => {
  it('accepts one white mark, rejects white plus black, and tracks a small white mark but not a large white area', async () => {
    const { markerColorProblem } = await import('../src/marker-tracking');
    expect(markerColorProblem(['#ff4055', '#4cd36a', '#bc51d9', '#ffffff'])).toBeNull();
    expect(markerColorProblem(['#ff4055', '#141414', '#bc51d9', '#ffffff'])).toContain('白か黒');
    const width = 160, height = 120, data = new Uint8ClampedArray(width * height * 4).fill(120);
    for (let p = 0; p < width * height; p++) data[p * 4 + 3] = 255;
    const paint = (x0: number, y0: number, w: number, h: number, rgb: number[]) => { for (let x = x0; x < x0 + w; x++) for (let y = y0; y < y0 + h; y++) data.set([...rgb, 255], (y * width + x) * 4); };
    paint(0, 90, 160, 30, [250, 250, 250]); // a big white screen area
    paint(20, 40, 6, 6, [220, 30, 30]); paint(50, 40, 6, 6, [30, 170, 60]); paint(80, 40, 6, 6, [140, 60, 200]); paint(110, 40, 6, 6, [245, 245, 245]);
    const r = new MarkerTracker().detect(data, width, height, ['#dc1e1e', '#1eaa3c', '#8c3cc8', '#f5f5f5']);
    expect(r.valid).toBe(true); expect(r.points[3]!.y).toBeCloseTo(42.5, 0);
  });
});

describe('known marks are followed only near their predicted position', () => {
  const frame = () => {
    const width = 240, height = 140, data = new Uint8ClampedArray(width * height * 4);
    for (let p = 0; p < width * height; p++) data.set([60, 60, 62, 255], p * 4);
    const paint = (x0: number, y0: number, n: number, rgb: number[]) => { for (let x = x0; x < x0 + n; x++) for (let y = y0; y < y0 + n; y++) if (x < width && y < height) data.set([...rgb, 255], (y * width + x) * 4); };
    return { width, height, data, paint };
  };
  const red = [220, 40, 40], green = [40, 170, 70], purple = [140, 60, 200], white = [245, 245, 245];
  const colors = ['#dc2828', '#28aa46', '#8c3cc8', '#f5f5f5'];
  it('follows the marks as they move and ignores a same-coloured blob elsewhere', () => {
    const tracker = new MarkerTracker();
    [[20, 40], [60, 40], [95, 40], [120, 40]].forEach(([x, y], i) => tracker.seed(i, x + 3, y + 3));
    let last: ReturnType<MarkerTracker['detect']> | null = null;
    for (let step = 0; step < 8; step++) {
      const { width, height, data, paint } = frame(), dy = step * 3;
      paint(20, 40 + dy, 6, red); paint(60, 40 + dy, 6, green); paint(95, 40 + dy, 6, purple); paint(120, 40 + dy, 6, white);
      paint(200, 10, 10, red); // a red thing far from the finger
      last = tracker.detect(data, width, height, colors);
    }
    expect(last!.valid).toBe(true);
    expect(last!.points[0]!.x).toBeCloseTo(22.5, 0); expect(last!.points[0]!.y).toBeCloseTo(42.5 + 21, 0);
  });
  it('does not jump to the reflection of a mark in the glass, even when the real mark disappears for a moment', () => {
    const tracker = new MarkerTracker();
    [[20, 40], [60, 40], [95, 40], [120, 40]].forEach(([x, y], i) => tracker.seed(i, x + 3, y + 3));
    const draw = (tipVisible: boolean) => {
      const { width, height, data, paint } = frame();
      paint(20, 40, 6, red); paint(60, 40, 6, green); paint(95, 40, 6, purple);
      if (tipVisible) paint(120, 40, 6, white);
      paint(120, 72, 6, [235, 235, 235]); // reflection of the white tip mark, ~30 px below in the glass
      return tracker.detect(data, width, height, colors);
    };
    expect(draw(true).points[3]!.y).toBeCloseTo(42.5, 0);
    const hidden = draw(false);
    expect(hidden.points[3]).toBeNull(); expect(hidden.valid).toBe(false); // holds instead of taking the reflection
    expect(draw(true).points[3]!.y).toBeCloseTo(42.5, 0);
  });
});
