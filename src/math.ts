export type V3 = { x: number; y: number; z: number };
export const v = (x = 0, y = 0, z = 0): V3 => ({ x, y, z });
export const add = (a: V3, b: V3) => v(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a: V3, b: V3) => v(a.x - b.x, a.y - b.y, a.z - b.z);
export const mul = (a: V3, s: number) => v(a.x * s, a.y * s, a.z * s);
export const dot = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: V3, b: V3) => v(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
export const length = (a: V3) => Math.hypot(a.x, a.y, a.z);
export const norm = (a: V3) => mul(a, 1 / (length(a) || 1));
export const dist = (a: V3, b: V3) => length(sub(a, b));
export const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
export const radians = (degrees: number) => degrees * Math.PI / 180;
export const degrees = (radians: number) => radians * 180 / Math.PI;
export const lerp = (a: V3, b: V3, t: number) => add(a, mul(sub(b, a), t));
export function rotate(a: V3, axis: V3, angle: number): V3 {
  const n = norm(axis), c = Math.cos(angle), s = Math.sin(angle);
  return add(add(mul(a, c), mul(cross(n, a), s)), mul(n, dot(n, a) * (1 - c)));
}
export function angle(a: V3, b: V3) { return Math.acos(clamp(dot(norm(a), norm(b)), -1, 1)); }
export function rotationVector(from: V3, to: V3) { return mul(norm(cross(from, to)), angle(from, to)); }
export function wrapAngle(n: number) { return Math.atan2(Math.sin(n), Math.cos(n)); }
