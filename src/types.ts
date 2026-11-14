import type { V3 } from './math';
export type Side = 'front' | 'back';
export type SceneKind = 'press' | 'release' | 'stroke';
/** Hand-side tilts: +x = MCP moves right, +y = MCP moves up in device coordinates. */
export type Pose = { tiltX: number; tiltY: number; dip: number };
export type PoseSource = 'mediapipe' | 'markers' | 'simulation';
export type PoseFrame = {
  type: 'pose'; version: 2; seq: number; source: PoseSource; pose: Pose;
  valid: boolean; calibrated: boolean; contact: boolean; axes: 'plane-y' | 'estimated-xy';
  rotation: number; confidence: number; sentAt: number; streamId?: string;
};
export type FingerConfig = {
  middleLength: number; distalLength: number; radius: number; yaw: number; pitch: number;
  dipRest: number; side: Side; thickness: number;
};
export type Skeleton = {
  pip: V3; dip: V3; tip: V3; pad: V3; padNormal: V3; middleDirection: V3;
  distalDirection: V3; flexDirection: V3; bendAxis: V3;
};
export type Ball = { center: V3; radius: number };
export type Contact = { point: V3; normal: V3; depth: number; angle: number };
export const neutralPose = (): Pose => ({ tiltX: 0, tiltY: 0, dip: 0 });
