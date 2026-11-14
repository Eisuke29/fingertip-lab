import { describe, expect, it } from 'vitest';
import { InteractionEngine } from '../src/interaction';
import type { InputSample } from '../src/types';

function sample(value: number, active = true): InputSample {
  return { value, active, eligible: true, root: { x: 60, y: value * 120, z: 0 },
    tip: { x: 0, y: value * 120, z: -48 }, source: 'surface' };
}
function setup(gain = 1) {
  const engine = new InteractionEngine(); engine.reset('surface', { x: 0, y: 16.8, z: -48 }, sample(0).tip); engine.gain = gain;
  engine.tick(1 / 60, sample(0)); return engine;
}
describe('shared lifting controller', () => {
  it('does not apply gain before contact', () => {
    for (const gain of [0.75, 1, 1.25]) {
      const engine = setup(gain); engine.tick(1 / 60, sample(0.1));
      expect(engine.held).toBe(false); expect(engine.tip.y).toBeCloseTo(12);
    }
  });
  it('interpolates a fast crossing of contact and preserves unit gain', () => {
    const engine = setup(); engine.tick(1 / 60, sample(0.8));
    expect(engine.held).toBe(true); expect(engine.tip.y).toBeCloseTo(96);
  });
  it.each([0.75, 1, 1.25])('scales only post-contact displacement by %s', gain => {
    const engine = setup(gain); engine.tick(1 / 60, sample(0.2)); engine.tick(1 / 60, sample(0.7));
    expect(engine.tip.y).toBeCloseTo(16.8 + (0.7 - 0.14) * 120 * gain);
    expect(engine.product).toEqual(engine.tip);
  });
  it('does not jump when the gain changes without new input', () => {
    const engine = setup(0.75); engine.tick(1 / 60, sample(0.7));
    const before = { ...engine.tip }; engine.gain = 1.25; engine.tick(1 / 60, sample(0.7));
    expect(engine.tip).toEqual(before);
    engine.tick(1 / 60, sample(0.8)); expect(engine.tip.y - before.y).toBeCloseTo(15);
  });
  it('ignores an ineligible touch and releases on cancellation', () => {
    const engine = setup(); engine.tick(1 / 60, { ...sample(0.8), eligible: false }); expect(engine.held).toBe(false);
    engine.tick(1 / 60, sample(0.8)); expect(engine.held).toBe(true);
    engine.release('pointer-cancel'); engine.tick(1 / 60, sample(0.8, false)); expect(engine.held).toBe(false);
    for (let i = 0; i < 200; i++) engine.tick(1 / 60, sample(0, false));
    expect(engine.product).toEqual(engine.rest);
    expect(engine.drainEvents().some(e => e.kind === 'release' && e.reason === 'pointer-cancel')).toBe(true);
  });
  it('uses separate rear hook and release thresholds', () => {
    const engine = setup(); engine.mode = 'rear';
    engine.tick(1 / 60, sample(0.16)); expect(engine.held).toBe(true);
    engine.tick(1 / 60, sample(0.09)); expect(engine.held).toBe(true);
    engine.tick(1 / 60, sample(0.06)); expect(engine.held).toBe(false);
    engine.tick(1 / 60, sample(0.1)); expect(engine.held).toBe(false);
  });
  it('resets an ongoing grasp when switching modes', () => {
    const engine = setup(); engine.tick(1 / 60, sample(0.6));
    engine.reset('rear', { x: 0, y: 30, z: 48 }, { x: 0, y: 13, z: 48 });
    expect(engine.held).toBe(false); expect(engine.product.z).toBe(48); expect(engine.phase).toBe('idle');
  });
});
