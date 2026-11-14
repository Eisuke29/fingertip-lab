export function validPose(data) {
  return data && data.type === 'pose' && data.version === 2 &&
    Number.isSafeInteger(data.seq) && data.seq >= 0 &&
    data.pose && ['tiltX','tiltY','dip'].every(key => Number.isFinite(data.pose[key]) && Math.abs(data.pose[key]) <= Math.PI) &&
    typeof data.valid === 'boolean' && typeof data.calibrated === 'boolean' &&
    typeof data.contact === 'boolean' && ['plane-y','estimated-xy'].includes(data.axes) &&
    [0,90,180,270].includes(data.rotation) &&
    Number.isFinite(data.confidence) && data.confidence >= 0 && data.confidence <= 1 &&
    ['mediapipe', 'markers', 'simulation'].includes(data.source) && Number.isFinite(data.sentAt);
}
