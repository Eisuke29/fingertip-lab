import { copy, distance, type InputMode, type InputSample, type InteractionEvent, type Vec3 } from './types';

/** Both input devices feed this one controller. No display-condition branches here. */
export class InteractionEngine {
  mode: InputMode = 'surface';
  gain = 1;
  travel = 120;
  held = false;
  phase: 'idle' | 'approach' | 'hooked' | 'lifted' | 'returning' = 'idle';
  tip: Vec3 = { x: 0, y: 0, z: 0 };
  product: Vec3 = { x: 0, y: 0, z: 0 };
  rest: Vec3 = { x: 0, y: 0, z: 0 };
  lift = 0;
  private previousValue = 0;
  private contactTip: Vec3 = { x: 0, y: 0, z: 0 };
  private releaseOffset: Vec3 = { x: 0, y: 0, z: 0 };
  private velocity: Vec3 = { x: 0, y: 0, z: 0 };
  private hasLifted = false;
  private lastSample?: InputSample;
  private events: InteractionEvent[] = [];

  reset(mode: InputMode, rest: Vec3, tip: Vec3) {
    if (this.held) this.release('mode-reset');
    this.mode = mode;
    this.rest = copy(rest);
    this.product = copy(rest);
    this.tip = copy(tip);
    this.phase = 'idle';
    this.lift = 0;
    this.velocity = { x: 0, y: 0, z: 0 };
    this.releaseOffset = { x: 0, y: 0, z: 0 };
    this.lastSample = undefined;
  }

  release(reason = 'release') {
    if (!this.held) return;
    this.held = false;
    this.phase = 'returning';
    if (this.lastSample) {
      this.releaseOffset = {
        x: this.tip.x - this.lastSample.tip.x,
        y: this.tip.y - this.lastSample.tip.y,
        z: this.tip.z - this.lastSample.tip.z,
      };
      this.events.push({ kind: 'release', reason, value: this.lastSample.value,
        lift: this.lift, source: this.lastSample.source, seq: this.lastSample.seq });
    }
  }

  tick(dt: number, input: InputSample) {
    dt = Math.min(0.04, Math.max(0, dt));
    const previousInput = this.lastSample;
    this.lastSample = input;
    if (this.held && (!input.active || (this.mode === 'rear' && input.value <= 0.065))) {
      this.release(input.active ? 'neutral' : 'input-ended');
    }
    if (!this.held && input.active && input.eligible && input.value >= 0.14) {
      this.held = true;
      this.phase = 'hooked';
      if (previousInput?.active && previousInput.value < 0.14 && input.value > previousInput.value) {
        const t = (0.14 - previousInput.value) / (input.value - previousInput.value);
        this.contactTip = { x: previousInput.tip.x + (input.tip.x - previousInput.tip.x) * t,
          y: previousInput.tip.y + (input.tip.y - previousInput.tip.y) * t,
          z: previousInput.tip.z + (input.tip.z - previousInput.tip.z) * t };
        this.previousValue = 0.14;
      } else {
        this.contactTip = copy(input.tip);
        this.previousValue = input.value;
      }
      this.lift = 0;
      this.hasLifted = false;
      this.releaseOffset = { x: 0, y: 0, z: 0 };
      this.events.push({ kind: 'contact', reason: 'hook', value: input.value, lift: 0,
        source: input.source, seq: input.seq });
    }
    if (this.held) {
      // Integrating increments makes a live gain change continuous at the tip.
      this.lift = Math.max(0, this.lift + (input.value - this.previousValue) * this.travel * this.gain);
      this.previousValue = input.value;
      this.tip = { x: input.tip.x, y: this.contactTip.y + this.lift, z: input.tip.z };
      this.product = copy(this.tip);
      if (this.lift > 18) {
        this.phase = 'lifted';
        if (!this.hasLifted) {
          this.hasLifted = true;
          this.events.push({ kind: 'lift', reason: 'lifted', value: input.value,
            lift: this.lift, source: input.source, seq: input.seq });
        }
      } else this.phase = 'hooked';
    } else {
      const blend = Math.exp(-dt * 11);
      this.releaseOffset.x *= blend;
      this.releaseOffset.y *= blend;
      this.releaseOffset.z *= blend;
      this.tip = { x: input.tip.x + this.releaseOffset.x,
        y: input.tip.y + this.releaseOffset.y, z: input.tip.z + this.releaseOffset.z };
      // Damped return to the pedestal; fixed substeps keep tab-resume stable.
      for (let i = 0; i < 4; i++) {
        for (const axis of ['x', 'y', 'z'] as const) {
          this.velocity[axis] += ((this.rest[axis] - this.product[axis]) * 115 - this.velocity[axis] * 19) * dt / 4;
          this.product[axis] += this.velocity[axis] * dt / 4;
        }
      }
      if (distance(this.product, this.rest) < 0.4) {
        this.product = copy(this.rest);
        this.lift = 0;
        this.velocity = { x: 0, y: 0, z: 0 };
        this.phase = input.active ? 'approach' : 'idle';
      } else this.phase = 'returning';
    }
  }

  drainEvents() { return this.events.splice(0); }
}
