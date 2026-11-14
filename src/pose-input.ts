import { neutralPose, type Pose, type PoseFrame } from './types';
export class PoseReceiver {
  pose: Pose = neutralPose();
  frame: PoseFrame | null = null;
  status: 'waiting' | 'ready' | 'hold' | 'lost' | 'rotation' = 'waiting';
  private lastValid = -Infinity;
  private seq = -1;
  private stream = '';
  private lastContact = false;
  alignRequired = true;
  streamChanged = false;
  ingest(frame: PoseFrame, now: number) {
    this.streamChanged = false;
    if ((frame.streamId || '') !== this.stream) {
      this.streamChanged = this.seq >= 0;
      this.stream = frame.streamId || ''; this.seq = -1; this.lastValid = -Infinity; this.alignRequired = true;
    }
    if (frame.seq <= this.seq) return false;
    this.seq = frame.seq; this.frame = frame;
    if (frame.valid && frame.calibrated) { this.pose = { ...frame.pose }; this.lastValid = now; this.lastContact = frame.contact; }
    return true;
  }
  sample(now: number, rotation: number) {
    const age = now - this.lastValid;
    if (this.frame && this.frame.rotation !== rotation) { this.status = 'rotation'; this.alignRequired = true; }
    else if (age > 650) { this.status = this.lastValid === -Infinity ? 'waiting' : 'lost'; this.alignRequired = true; }
    else if (!this.frame?.valid || !this.frame.calibrated || age > 180) this.status = 'hold';
    else this.status = 'ready';
    return { pose: { ...this.pose }, status: this.status, valid: this.status === 'ready',
      hold: this.status === 'hold', contact: this.status === 'hold' ? this.lastContact : !!this.frame?.contact, source: this.frame?.source, axes: this.frame?.axes };
  }
  align() { if (this.status !== 'ready') return false; this.alignRequired = false; return true; }
  invalidate() { this.alignRequired = true; }
}
