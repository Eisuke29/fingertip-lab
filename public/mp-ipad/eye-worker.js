// Finds the eyes in a camera picture, in its own thread so that drawing is never held up. Classic worker (MediaPipe loads its wasm with importScripts).
const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3', MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
let lm = null, n = 0, cv = null;
// the colour of the person's skin, from cheeks and forehead (middle value of small patches). Only three numbers leave this thread.
function skinOf(b, L) {
  const w = b.width, h = b.height, r = Math.max(3, Math.round(Math.hypot((L[468].x - L[473].x) * w, (L[468].y - L[473].y) * h) * 0.12)), px = [];
  cv ||= new OffscreenCanvas(8, 8); const g = cv.getContext('2d', { willReadFrequently: true });
  for (const p of [50, 280, 205, 425, 151].map((i) => L[i])) { g.drawImage(b, p.x * w - r, p.y * h - r, 2 * r, 2 * r, 0, 0, 8, 8); const d = g.getImageData(0, 0, 8, 8).data; for (let i = 0; i < d.length; i += 4) px.push([d[i], d[i + 1], d[i + 2]]); }
  return [0, 1, 2].map((k) => px.map((q) => q[k]).sort((a, c) => a - c)[px.length >> 1]);
}
self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === 'init') {
      const { FaceLandmarker, FilesetResolver } = await import(`${MP}/vision_bundle.mjs`), fs = await FilesetResolver.forVisionTasks(`${MP}/wasm`);
      lm = await FaceLandmarker.createFromOptions(fs, { baseOptions: { modelAssetPath: MODEL, delegate: 'CPU' }, runningMode: 'VIDEO', numFaces: 1 });
      self.postMessage({ type: 'ready' });
    } else if (m.type === 'frame') {
      const t0 = performance.now(), r = lm.detectForVideo(m.bitmap, m.t), L = r.faceLandmarks?.[0]; let skin = null; if (L && L.length > 473 && n++ % 10 === 0) try { skin = skinOf(m.bitmap, L); } catch {} m.bitmap.close();
      self.postMessage({ type: 'eyes', t: m.t, skin, ms: performance.now() - t0, pts: L && L.length > 473 ? [L[468], L[473]].map((p) => ({ x: p.x, y: p.y })) : null });
    }
  } catch (err) { self.postMessage({ type: 'error', msg: String(err && err.message || err) }); }
};
