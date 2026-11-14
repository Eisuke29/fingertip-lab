import { describe, expect, it } from 'vitest';
import { contactAt, defaultFinger, entryAngle, FingerInteraction, solveFinger } from '../src/kinematics';
import { dist, radians, v } from '../src/math';
import { neutralPose, type Ball, type Side } from '../src/types';

const sphere = (side: Side): Ball => ({ center: v(0, 0, side === 'front' ? -200 : 192), radius: 70 });
describe.each(['front', 'back'] as const)('%s articulated finger', side => {
  const config = { ...defaultFinger(), side }, ball = sphere(side);
  it('keeps both lengths and the PIP fixed, moving only the distal section for DIP input', () => {
    const a = solveFinger(v(), neutralPose(), config), b = solveFinger(v(), { ...neutralPose(), dip: 1.1 }, config);
    expect(b.pip).toEqual(a.pip); expect(b.dip).toEqual(a.dip);
    expect(dist(b.pip, b.dip)).toBeCloseTo(config.middleLength, 10);
    expect(dist(b.dip, b.tip)).toBeCloseTo(config.distalLength, 10); expect(dist(a.tip, b.tip)).toBeGreaterThan(20);
  });
  it('uses the opposite screen direction for all four hand-side movements', () => {
    const rest = solveFinger(v(), neutralPose(), config);
    expect(solveFinger(v(), { tiltX: 0, tiltY: -0.2, dip: 0 }, config).dip.y).toBeGreaterThan(rest.dip.y);
    expect(solveFinger(v(), { tiltX: 0, tiltY: 0.2, dip: 0 }, config).dip.y).toBeLessThan(rest.dip.y);
    expect(solveFinger(v(), { tiltX: -0.2, tiltY: 0, dip: 0 }, config).dip.x).toBeGreaterThan(rest.dip.x);
    expect(solveFinger(v(), { tiltX: 0.2, tiltY: 0, dip: 0 }, config).dip.x).toBeLessThan(rest.dip.x);
  });
  it('reaches the fixed sphere from free space by DIP flexion', () => {
    expect(contactAt(solveFinger(v(), neutralPose(), config), ball)).toBeNull();
    const contact = contactAt(solveFinger(v(), { ...neutralPose(), dip: 1.1 }, config), ball);
    expect(contact?.depth).toBeGreaterThan(5);
  });
  it('applies angular gain only after the first pad collision, without stretching either bone', () => {
    const pose = { ...neutralPose(), dip: 1.0 }, boundary = entryAngle(v(), pose, config, ball)!;
    expect(boundary).toBeGreaterThan(0.1);
    for (const gain of [0.8, 1, 1.2]) {
      const engine = new FingerInteraction(); engine.gain = gain;
      engine.update(v(), { ...pose, dip: boundary - 0.01 }, config, ball, true);
      expect(engine.displayedDip).toBeCloseTo(boundary - 0.01, 5);
      engine.update(v(), pose, config, ball, true);
      expect(engine.displayedDip).toBeCloseTo(boundary + gain * (pose.dip - boundary), 4);
      expect(dist(engine.skeleton.pip, engine.skeleton.dip)).toBeCloseTo(config.middleLength, 8);
      expect(dist(engine.skeleton.dip, engine.skeleton.tip)).toBeCloseTo(config.distalLength, 8);
      expect(engine.setGain(1)).toBe(false);
    }
  });
  it('crosses the contact boundary smoothly in both directions', () => {
    const pose = { ...neutralPose(), dip: 1.1 }, boundary = entryAngle(v(), pose, config, ball)!;
    const engine = new FingerInteraction(); engine.gain = 1.2;
    let previous = solveFinger(v(), { ...pose, dip: boundary - 0.03 }, config).tip;
    for (const offset of [-0.02, -0.01, 0, 0.01, 0.02, 0.01, 0, -0.01]) {
      engine.update(v(), { ...pose, dip: boundary + offset }, config, ball, true);
      expect(dist(previous, engine.skeleton.tip)).toBeLessThan(1.2); previous = engine.skeleton.tip;
    }
  });
});
