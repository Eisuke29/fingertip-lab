export type InputMode = 'surface' | 'rear';
export type DisplayCondition = 'finger' | 'point';
export type InputSource = 'surface' | 'camera' | 'simulation';
export type Vec3 = { x: number; y: number; z: number };
export type ControlFrame = {
  type: 'control';
  version: 1;
  seq: number;
  value: number;
  valid: boolean;
  calibrated: boolean;
  confidence: number;
  source: 'camera' | 'simulation';
  sentAt: number;
  streamId?: string;
  angle?: number;
};
export type InputSample = {
  active: boolean;
  value: number;
  eligible: boolean;
  tip: Vec3;
  root: Vec3;
  source: InputSource;
  seq?: number;
};
export type InteractionEvent = {
  kind: 'contact' | 'release' | 'lift';
  reason: string;
  value: number;
  lift: number;
  source: InputSource;
  seq?: number;
};
export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
export const copy = (v: Vec3): Vec3 => ({ ...v });
export const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** randomUUID is secure-context-only; the phone also runs on ordinary LAN HTTP. */
export function newId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
