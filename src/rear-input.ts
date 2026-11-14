import type { ControlFrame } from './types';

/** Local receive time, not the sender's clock, is used for the watchdog. */
export class RearInput {
  value = 0;
  source: 'camera' | 'simulation' = 'camera';
  seq = -1;
  status: 'waiting' | 'neutral' | 'ready' | 'holding' | 'lost' = 'waiting';
  private stream = '';
  private lastValidAt = -Infinity;
  private currentValid = false;
  private everValid = false;
  private armed = false;
  private neutralSince = -1;

  ingest(frame: ControlFrame, now: number) {
    if ((frame.streamId ?? '') !== this.stream) {
      this.stream = frame.streamId ?? '';
      this.seq = -1;
      this.lastValidAt = -Infinity;
      this.everValid = false;
      this.disarm();
    }
    if (frame.seq <= this.seq) return;
    this.seq = frame.seq;
    this.source = frame.source;
    this.currentValid = frame.valid && frame.calibrated;
    if (!this.currentValid) { this.neutralSince = -1; return; }
    if (now - this.lastValidAt > 650) this.disarm();
    this.lastValidAt = now;
    this.everValid = true;
    this.value = frame.value;
    if (!this.armed) {
      if (frame.value <= 0.065) {
        if (this.neutralSince < 0) this.neutralSince = now;
        if (now - this.neutralSince >= 180) this.armed = true;
      } else this.neutralSince = -1;
    }
  }

  disarm() { this.armed = false; this.neutralSince = -1; }

  sample(now: number) {
    const age = now - this.lastValidAt;
    if (age > 650) {
      this.disarm();
      this.status = this.everValid ? 'lost' : 'waiting';
      return { active: false, value: this.value, fresh: false, status: this.status };
    }
    if (!this.currentValid || age > 180) {
      this.status = 'holding';
      return { active: this.armed, value: this.value, fresh: false, status: this.status };
    }
    this.status = this.armed ? 'ready' : 'neutral';
    return { active: this.armed, value: this.value, fresh: true, status: this.status };
  }
}
