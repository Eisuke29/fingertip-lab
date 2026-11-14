import { describe, expect, it } from 'vitest';
import { MaterialResponse, surfaceRadius } from '../src/material';
import { v } from '../src/math';
import type { Ball, Contact } from '../src/types';
const ball: Ball = { center: v(), radius: 70 };
const hit: Contact = { point: v(0, 0, 50), normal: v(0, 0, 1), depth: 20, angle: 0.5 };
describe('local material response', () => {
  it('matches the pad surface locally, leaves the far surface alone, and keeps the center fixed', () => {
    expect(surfaceRadius(v(0, 0, 1), hit.normal, 20, 70)).toBeCloseTo(50);
    expect(surfaceRadius(v(0, 0, -1), hit.normal, 20, 70)).toBeCloseTo(70, 5);
    const response = new MaterialResponse(); response.update(0.016, hit, hit.point, ball, 'press');
    expect(ball.center).toEqual(v()); expect(response.depth).toBe(20);
  });
  it('does not deform in free space and restores smoothly after release', () => {
    const response = new MaterialResponse(); response.update(0.016, null, v(0, 0, 100), ball, 'press'); expect(response.depth).toBe(0);
    response.update(0.016, hit, hit.point, ball, 'press'); response.update(0.016, null, v(0, 0, 80), ball, 'press');
    expect(response.depth).toBeGreaterThan(0); expect(response.depth).toBeLessThan(20);
    for (let i = 0; i < 100; i++) response.update(0.016, null, v(0, 0, 100), ball, 'press'); expect(response.depth).toBe(0);
  });
  it('holds the same shape through short tracking loss', () => {
    const response = new MaterialResponse(); response.update(0.016, hit, hit.point, ball, 'press');
    response.update(0.1, null, v(0, 0, 100), ball, 'press', true); expect(response.depth).toBe(20);
  });
  it('only tethers after contact and breaks at the chosen distance', () => {
    const response = new MaterialResponse(); response.breakDistance = 30;
    response.update(0.016, null, v(0, 0, 75), ball, 'release'); expect(response.thread).toBeNull();
    response.update(0.016, hit, hit.point, ball, 'release'); response.update(0.016, null, v(0, 0, 75), ball, 'release');
    expect(response.thread).not.toBeNull(); response.update(0.016, null, v(0, 0, 130), ball, 'release'); expect(response.thread).toBeNull();
  });
  it('keeps the thread when lifting quickly off a deep press, while the dent is still recovering', () => {
    const response = new MaterialResponse(); response.breakDistance = 26;
    const deep: Contact = { point: v(0, 0, 47), normal: v(0, 0, 1), depth: 23, angle: 0.5 };
    response.update(0.016, deep, deep.point, ball, 'release'); response.update(0.016, null, v(0, 0, 73.2), ball, 'release');
    expect(response.depth).toBeGreaterThan(15); expect(response.thread).not.toBeNull();
    expect(response.thread!.start.z).toBeLessThan(70);
  });
});
