export function validControl(data) {
  return data && data.type === 'control' && data.version === 1 &&
    Number.isSafeInteger(data.seq) && data.seq >= 0 &&
    Number.isFinite(data.value) && data.value >= 0 && data.value <= 1 &&
    typeof data.valid === 'boolean' && typeof data.calibrated === 'boolean' &&
    Number.isFinite(data.confidence) && data.confidence >= 0 && data.confidence <= 1 &&
    ['camera', 'simulation'].includes(data.source) && Number.isFinite(data.sentAt) &&
    (data.angle === undefined || Number.isFinite(data.angle));
}
