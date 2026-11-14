import { angle, clamp, degrees, dist, dot, length, mul, norm, rotationVector, sub, v, wrapAngle, type V3 } from './math';
import type { ImagePoint } from './marker-tracking';
import type { Pose } from './types';

export type HandSample = {
  image: [ImagePoint, ImagePoint, ImagePoint, ImagePoint];
  world: [V3, V3, V3, V3] | null;
  handAngle: number; handVector: V3 | null; bend: number;
};
export function measureHand(image: [ImagePoint, ImagePoint, ImagePoint, ImagePoint], world: [V3, V3, V3, V3] | null): HandSample | null {
  const [mcp, pip, dip, tip] = image;
  if ([Math.hypot(mcp.x - pip.x, mcp.y - pip.y), Math.hypot(pip.x - dip.x, pip.y - dip.y), Math.hypot(dip.x - tip.x, dip.y - tip.y)].some(n => n < 10)) return null;
  const handAngle = Math.atan2(-(mcp.y - pip.y), mcp.x - pip.x);
  let bend: number, handVector: V3 | null = null;
  if (world) {
    if ([length(sub(world[0], world[1])), length(sub(world[2], world[1])), length(sub(world[3], world[2]))].some(n => n < 0.004)) return null;
    handVector = norm(sub(world[0], world[1]));
    bend = angle(sub(world[2], world[1]), sub(world[3], world[2]));
  } else {
    const a = v(dip.x - pip.x, dip.y - pip.y), b = v(tip.x - dip.x, tip.y - dip.y);
    bend = angle(a, b);
  }
  return { image, world, handVector, handAngle, bend };
}
type Snapshot = { handVector: V3 | null; handAngle: number; bend: number; pip: ImagePoint; lengths: [number, number, number] };
const segmentLengths = (image: HandSample['image']): [number, number, number] =>
  [0, 1, 2].map(i => Math.hypot(image[i + 1].x - image[i].x, image[i + 1].y - image[i].y)) as [number, number, number];

/** One Euro filter: strong smoothing when still, little lag when moving (Casiez et al. 2012). */
export class OneEuro {
  private x: number | null = null; private dx = 0;
  constructor(private minCutoff = 1.2, private beta = 0.35, private dCutoff = 1) {}
  private alpha(cutoff: number, dt: number) { const tau = 1 / (2 * Math.PI * cutoff); return 1 / (1 + tau / dt); }
  reset() { this.x = null; this.dx = 0; }
  filter(value: number, dt: number) {
    if (this.x === null || dt <= 0) { this.x = value; return value; }
    const rawDx = (value - this.x) / dt;
    this.dx += (rawDx - this.dx) * this.alpha(this.dCutoff, dt);
    this.x += (value - this.x) * this.alpha(this.minCutoff + this.beta * Math.abs(this.dx), dt);
    return this.x;
  }
}
export class HandCalibration {
  mode: 'plane-y' | 'estimated-xy' = 'plane-y';
  neutral: Snapshot | null = null;
  down: Snapshot | null = null;
  left: Snapshot | null = null;
  bent: Snapshot | null = null;
  message = '次：楽な姿勢で止めて記録';
  private history: HandSample[] = [];
  private filters = { tiltX: new OneEuro(), tiltY: new OneEuro(), dip: new OneEuro() };
  get ready() { return !!(this.neutral && this.down && this.bent && (this.mode === 'plane-y' || this.left)); }
  reset() { this.neutral = this.down = this.left = this.bent = null; this.history = []; Object.values(this.filters).forEach(f => f.reset()); this.message = '次：楽な姿勢で止めて記録'; }
  push(sample: HandSample | null) { if (!sample) { this.history = []; return; } this.history.push(sample); if (this.history.length > 12) this.history.shift(); }
  record(kind: 'neutral' | 'down' | 'left' | 'bent') {
    if (this.history.length < 8) { this.message = '4点が映る姿勢で0.5秒止めてください'; return false; }
    const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
    const latest = this.history.at(-1)!;
    const direction = latest.handVector ? norm(v(median(this.history.map(s => s.handVector!.x)), median(this.history.map(s => s.handVector!.y)), median(this.history.map(s => s.handVector!.z)))) : null;
    const snapshot: Snapshot = { handVector: direction, handAngle: latest.handAngle + median(this.history.map(s => wrapAngle(s.handAngle - latest.handAngle))),
      bend: median(this.history.map(s => s.bend)), pip: { x: median(this.history.map(s => s.image[1].x)), y: median(this.history.map(s => s.image[1].y)) },
      lengths: [0, 1, 2].map(i => median(this.history.map(s => segmentLengths(s.image)[i]))) as [number, number, number] };
    if (this.history.some(s => Math.abs(s.bend - snapshot.bend) > 0.12 || Math.abs(wrapAngle(s.handAngle - snapshot.handAngle)) > 0.12)) { this.message = '手が動いています — 止めてからもう一度'; return false; }
    if (kind === 'neutral') { this.neutral = snapshot; this.down = this.left = this.bent = null; this.message = '次：指先はそのまま、手を下へ傾けて記録'; return true; }
    if (!this.neutral) { this.message = '先に「楽な姿勢」を記録してください'; return false; }
    if (kind === 'down') {
      const amount = this.mode === 'estimated-xy' && direction && this.neutral.handVector ? angle(direction, this.neutral.handVector) : Math.abs(wrapAngle(snapshot.handAngle - this.neutral.handAngle));
      if (amount < 0.09) { this.message = '手の傾きが小さすぎます（6°以上傾けてください）'; return false; }
      this.down = snapshot; this.message = this.mode === 'plane-y' ? '次：手を戻し、指先だけ曲げて記録' : '次：手を戻し、左へ傾けて記録';
    } else if (kind === 'left') {
      if (!direction || !this.neutral.handVector || !this.down?.handVector) { this.message = '左右の傾きは「自動検出」でのみ登録できます'; return false; }
      const a = norm(rotationVector(this.neutral.handVector, this.down.handVector)), b = rotationVector(this.neutral.handVector, direction);
      if (length(b) < 0.09 || Math.abs(dot(a, norm(b))) > 0.9) { this.message = '上下と左右を区別できません — カメラの位置を変えるか、上下のみにします'; return false; }
      this.left = snapshot; this.message = '次：手を戻し、指先だけ曲げて記録';
    } else {
      if (Math.abs(snapshot.bend - this.neutral.bend) < 0.12) { this.message = '指先の曲げが小さすぎます（7°以上曲げてください）'; return false; }
      this.bent = snapshot; this.message = '登録完了 — 楽な姿勢に戻してiPadに指を当てる';
    }
    return true;
  }
  pose(sample: HandSample, dt: number): Pose {
    if (!this.ready || !this.neutral || !this.down) return { tiltX: 0, tiltY: 0, dip: 0 };
    let tiltX = 0, tiltY = 0;
    if (this.mode === 'estimated-xy' && sample.handVector && this.neutral.handVector && this.down.handVector && this.left?.handVector) {
      const a = norm(rotationVector(this.neutral.handVector, this.down.handVector));
      const b = norm(rotationVector(this.neutral.handVector, this.left.handVector));
      const r = rotationVector(this.neutral.handVector, sample.handVector), ab = dot(a, b), det = 1 - ab * ab;
      if (det > 0.15) { tiltY = -(dot(r, a) - ab * dot(r, b)) / det; tiltX = -(dot(r, b) - ab * dot(r, a)) / det; }
    } else {
      const sign = Math.sign(wrapAngle(this.down.handAngle - this.neutral.handAngle));
      tiltY = -sign * wrapAngle(sample.handAngle - this.neutral.handAngle);
    }
    const raw = { tiltX: clamp(tiltX, -0.75, 0.75), tiltY: clamp(tiltY, -0.75, 0.75), dip: clamp(sample.bend - this.neutral.bend, -0.5, 1.5) };
    const step = Math.min(0.1, dt);
    return { tiltX: this.filters.tiltX.filter(raw.tiltX, step), tiltY: this.filters.tiltY.filter(raw.tiltY, step), dip: this.filters.dip.filter(raw.dip, step) };
  }
  /**
   * In a side view the three bone lengths in the image stay nearly constant. A large change means the detector
   * jumped (wrong joint, other hand) or the finger left the camera plane, so the frame is not trusted.
   */
  plausible(sample: HandSample) {
    if (!this.neutral) return true;
    const now = segmentLengths(sample.image);
    return now.every((n, i) => { const r = n / this.neutral!.lengths[i]; return r > 0.6 && r < 1.6; });
  }
  nearContact(sample: HandSample, radius: number) { return !!this.neutral && Math.hypot(sample.image[1].x - this.neutral.pip.x, sample.image[1].y - this.neutral.pip.y) <= radius; }
}
