import { describe, expect, it } from 'vitest';
import { BendCalibration, hexToRgb, jointBend, MarkerTracker, type Point } from '../src/marker-tracking';

const colors = ['#e965ad', '#29c4d8', '#f2c94c'];
function image(points: { x: number; y: number; color: string; radius?: number }[]) {
  const pixels = new Uint8ClampedArray(320 * 240 * 4);
  for (const point of points) {
    const rgb = hexToRgb(point.color), radius = point.radius ?? 5;
    for (let y = point.y - radius; y <= point.y + radius; y++) for (let x = point.x - radius; x <= point.x + radius; x++) {
      if (x < 0 || y < 0 || x >= 320 || y >= 240 || (x - point.x) ** 2 + (y - point.y) ** 2 > radius ** 2) continue;
      const offset = (y * 320 + x) * 4;
      pixels[offset] = rgb.r; pixels[offset + 1] = rgb.g; pixels[offset + 2] = rgb.b; pixels[offset + 3] = 255;
    }
  }
  return pixels;
}
const markerPoints = [{ x: 60, y: 140 }, { x: 115, y: 140 }, { x: 155, y: 100 }];
describe('color marker tracking', () => {
  it('detects three components and an image-plane bend', () => {
    const tracker = new MarkerTracker();
    const result = tracker.detect(image(markerPoints.map((p, i) => ({ ...p, color: colors[i] }))), 320, 240, colors);
    expect(result.valid).toBe(true); expect(result.angle).toBeCloseTo(Math.PI / 4, 2);
    expect(result.points[1]!.x).toBeCloseTo(115);
  });
  it('rejects distant background colors and impossible component sizes', () => {
    const tracker = new MarkerTracker();
    tracker.detect(image(markerPoints.map((p, i) => ({ ...p, color: colors[i] }))), 320, 240, colors);
    const shifted = markerPoints.map((p, i) => ({ ...p, x: p.x + 150, color: colors[i] }));
    expect(tracker.detect(image(shifted), 320, 240, colors).valid).toBe(false);
    tracker.reset();
    expect(tracker.detect(image(markerPoints.map((p, i) => ({ ...p, color: colors[i], radius: 40 }))), 320, 240, colors).valid).toBe(false);
  });
  it('rejects missing, overlapping, and similar-colored markers', () => {
    const tracker = new MarkerTracker();
    expect(tracker.detect(image([{ x: 20, y: 20, color: colors[0] }]), 320, 240, colors).valid).toBe(false);
    expect(jointBend({ x: 0, y: 0, area: 20 }, { x: 2, y: 0, area: 20 }, { x: 40, y: 20, area: 20 })).toBeNull();
    expect(tracker.detect(image([]), 320, 240, [colors[0], colors[0], colors[2]]).valid).toBe(false);
  });
  it('is invariant to image-plane wrist rotation and translation', () => {
    const original = markerPoints.map(p => ({ ...p, area: 50 })) as Point[];
    const angle = 0.8;
    const transformed = original.map(p => ({ x: p.x * Math.cos(angle) - p.y * Math.sin(angle) + 30,
      y: p.x * Math.sin(angle) + p.y * Math.cos(angle) - 70, area: 50 }));
    expect(jointBend(...transformed as [Point, Point, Point])).toBeCloseTo(jointBend(...original as [Point, Point, Point])!, 10);
  });
});
describe('user calibration', () => {
  it('records multiple stable frames then maps and smooths to 0–1', () => {
    const calibration = new BendCalibration(); calibration.start('neutral', 0);
    for (let i = 0; i < 26; i++) calibration.feed(0.1, i * 33, 0.033);
    expect(calibration.neutral).toBeCloseTo(0.1);
    calibration.start('bent', 1000);
    for (let i = 0; i < 26; i++) calibration.feed(1.1, 1000 + i * 33, 0.033);
    expect(calibration.ready).toBe(true);
    let value = 0; for (let i = 0; i < 30; i++) value = calibration.feed(0.6, 2000 + i * 33, 0.033);
    expect(value).toBeCloseTo(0.5, 3);
  });
  it('rejects insufficient separation and unstable recordings', () => {
    const calibration = new BendCalibration(); calibration.start('neutral', 0);
    for (let i = 0; i < 26; i++) calibration.feed(0.1, i * 33, 0.033);
    calibration.start('bent', 1000);
    for (let i = 0; i < 26; i++) calibration.feed(0.2, 1000 + i * 33, 0.033);
    expect(calibration.ready).toBe(false);
    calibration.start('bent', 2000);
    for (let i = 0; i < 26; i++) calibration.feed(i % 2 ? 0.8 : 1.4, 2000 + i * 33, 0.033);
    expect(calibration.ready).toBe(false);
  });
});
