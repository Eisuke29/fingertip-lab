import { add, clamp, dist, dot, mul, norm, sub, v, type V3 } from './math';
import type { Ball, Contact, SceneKind } from './types';
/** Local depression and a small raised annulus. This never translates the sphere center. */
export function surfaceRadius(direction: V3, contactNormal: V3, depth: number, radius: number, spread = 0.43) {
  const theta = Math.acos(clamp(dot(norm(direction), norm(contactNormal)), -1, 1));
  const t = theta / spread, w = Math.exp(-t * t);
  return radius - depth * w + depth * 0.17 * t * t * Math.exp(-(((t - 0.9) / 0.75) ** 2));
}
export class MaterialResponse {
  contactNormal = v(0, 0, 1);
  depth = 0;
  thread: { start: V3; end: V3 } | null = null;
  strokeShift = { x: 0, y: 0 };
  breakDistance = 26;
  strokeGain = 0.65;
  spread = 0.43;
  recovery = 0.12;
  private previousContact: Contact | null = null;
  private tetherNormal: V3 | null = null;
  private previousPad: V3 | null = null;
  reset() { this.depth = 0; this.thread = null; this.strokeShift = { x: 0, y: 0 }; this.previousContact = null; this.tetherNormal = null; this.previousPad = null; }
  update(dt: number, contact: Contact | null, pad: V3, ball: Ball, scene: SceneKind, frozen = false) {
    if (frozen) return;
    dt = Math.min(0.05, Math.max(0, dt));
    if (contact) {
      this.contactNormal = { ...contact.normal }; this.depth = contact.depth;
      this.tetherNormal = { ...contact.normal }; this.thread = null;
      if (scene === 'stroke' && this.previousContact && this.previousPad) {
        const delta = sub(pad, this.previousPad), tangent = sub(delta, mul(contact.normal, dot(delta, contact.normal)));
        this.strokeShift.x += tangent.x / ball.radius * (1 - this.strokeGain) * 0.18;
        this.strokeShift.y += tangent.y / ball.radius * (1 - this.strokeGain) * 0.18;
      }
    } else {
      this.depth *= Math.exp(-dt / this.recovery); if (this.depth < 0.005) this.depth = 0;
      if (scene === 'release' && this.tetherNormal) {
        // Stretch is measured from the undeformed contact point, so a fast lift-off from a deep press
        // does not count the still-recovering dent as thread length. The drawn strand starts on the recovering surface.
        const start = add(ball.center, mul(this.tetherNormal, ball.radius - this.depth));
        const d = dist(add(ball.center, mul(this.tetherNormal, ball.radius)), pad);
        if (d <= this.breakDistance && d > 0.5) this.thread = { start, end: { ...pad } };
        else { this.thread = null; this.tetherNormal = null; }
      } else this.thread = null;
    }
    if (scene !== 'stroke' || !contact) {
      this.strokeShift.x *= Math.exp(-dt / 0.15); this.strokeShift.y *= Math.exp(-dt / 0.15);
    }
    this.previousPad = { ...pad }; this.previousContact = contact ? { ...contact } : null;
  }
  radiusAt(direction: V3, ball: Ball) { return surfaceRadius(direction, this.contactNormal, this.depth, ball.radius, this.spread); }
}
