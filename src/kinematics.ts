import { add, clamp, cross, dist, dot, mul, norm, radians, rotate, sub, v, type V3 } from './math';
import type { Ball, Contact, FingerConfig, Pose, Skeleton } from './types';
export const defaultFinger = (): FingerConfig => ({
  middleLength: 114, distalLength: 80, radius: 16, yaw: radians(11), pitch: radians(23),
  dipRest: radians(-35), side: 'front', thickness: 8,
});
/** Fixed-length articulation. DIP input never participates in locating the DIP joint. */
export function solveFinger(pivot: V3, pose: Pose, config: FingerConfig): Skeleton {
  const sign = config.side === 'front' ? -1 : 1;
  let middle = norm(v(Math.sin(config.yaw) * Math.cos(config.pitch), Math.sin(config.pitch), sign * Math.cos(config.yaw) * Math.cos(config.pitch)));
  // Reverse the palmward input exactly once to extend through the fixed PIP pivot.
  const screenRight = -pose.tiltX, screenUp = -pose.tiltY;
  const transform = (a: V3) => rotate(rotate(a, v(0, 1, 0), sign * screenRight), v(1, 0, 0), -sign * screenUp);
  const towardBall = norm(v(-middle.x, -middle.y, sign * 0.8));
  let flex = norm(sub(towardBall, mul(middle, dot(towardBall, middle))));
  middle = norm(transform(middle)); flex = norm(transform(flex));
  const theta = config.dipRest + pose.dip;
  const distal = norm(add(mul(middle, Math.cos(theta)), mul(flex, Math.sin(theta))));
  const padNormal = norm(add(mul(flex, Math.cos(theta)), mul(middle, -Math.sin(theta))));
  const pip = v(pivot.x, pivot.y, config.side === 'back' ? -config.thickness : 0);
  const dip = add(pip, mul(middle, config.middleLength));
  const tip = add(dip, mul(distal, config.distalLength));
  const pad = add(add(dip, mul(distal, config.distalLength * 0.82)), mul(padNormal, config.radius * 0.78));
  return { pip, dip, tip, pad, padNormal, middleDirection: middle, distalDirection: distal, flexDirection: flex, bendAxis: norm(cross(middle, flex)) };
}
export function contactAt(skeleton: Skeleton, ball: Ball): Contact | null {
  const delta = sub(skeleton.pad, ball.center), distance = dist(skeleton.pad, ball.center);
  const depth = ball.radius - distance;
  if (depth <= 0 || dot(skeleton.padNormal, norm(mul(delta, -1))) < 0.12 || distance < ball.radius * 0.28) return null;
  return { point: { ...skeleton.pad }, normal: norm(delta), depth, angle: 0 };
}
/** First reachable pad/sphere boundary along the positive DIP flexion path. */
export function entryAngle(pivot: V3, pose: Pose, config: FingerConfig, ball: Ball): number | null {
  if (!contactAt(solveFinger(pivot, pose, config), ball)) return null;
  let previous = -0.4;
  for (let i = 1; i <= 36; i++) {
    const next = -0.4 + (pose.dip + 0.4) * i / 36;
    if (contactAt(solveFinger(pivot, { ...pose, dip: next }, config), ball)) {
      let lo = previous, hi = next;
      for (let j = 0; j < 13; j++) {
        const mid = (lo + hi) / 2;
        if (contactAt(solveFinger(pivot, { ...pose, dip: mid }, config), ball)) hi = mid; else lo = mid;
      }
      return (lo + hi) / 2;
    }
    previous = next;
  }
  return null;
}
export class FingerInteraction {
  gain = 1;
  firstContactAngle: number | null = null;
  contact: Contact | null = null;
  skeleton!: Skeleton;
  displayedDip = 0;
  private lastInput?: Pose;
  private lastPivot?: V3;
  private lastConfig = '';
  private lastBall = '';
  private cachedEntry: number | null = null;
  reset() { this.firstContactAngle = null; this.contact = null; this.cachedEntry = null; this.lastInput = undefined; }
  setGain(value: number) { if (this.contact) return false; this.gain = clamp(value, 0.5, 1.5); return true; }
  update(pivot: V3, input: Pose, config: FingerConfig, ball: Ball, enabled: boolean, hold = false) {
    if (hold && this.skeleton) return;
    const configKey = JSON.stringify(config), ballKey = JSON.stringify(ball);
    if (!this.lastInput || input.tiltX !== this.lastInput.tiltX || input.tiltY !== this.lastInput.tiltY || input.dip !== this.lastInput.dip ||
      !this.lastPivot || dist(pivot, this.lastPivot) > 0.0001 || configKey !== this.lastConfig || ballKey !== this.lastBall) {
      this.cachedEntry = entryAngle(pivot, input, config, ball);
      this.lastInput = { ...input }; this.lastPivot = { ...pivot }; this.lastConfig = configKey; this.lastBall = ballKey;
    }
    const boundary = enabled ? this.cachedEntry : null;
    this.displayedDip = boundary === null ? input.dip : boundary + this.gain * (input.dip - boundary);
    this.skeleton = solveFinger(pivot, { ...input, dip: this.displayedDip }, config);
    this.contact = enabled ? contactAt(this.skeleton, ball) : null;
    if (this.contact) {
      if (this.firstContactAngle === null) this.firstContactAngle = boundary ?? input.dip;
      this.contact.angle = this.firstContactAngle;
    } else this.firstContactAngle = null;
  }
}
