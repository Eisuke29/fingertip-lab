// Finds the eyes in a camera picture, in its own thread so that drawing is never held up. Classic worker (MediaPipe loads its wasm with importScripts).
const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3', MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
let lm = null;
self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === 'init') {
      const { FaceLandmarker, FilesetResolver } = await import(`${MP}/vision_bundle.mjs`), fs = await FilesetResolver.forVisionTasks(`${MP}/wasm`);
      lm = await FaceLandmarker.createFromOptions(fs, { baseOptions: { modelAssetPath: MODEL, delegate: 'CPU' }, runningMode: 'VIDEO', numFaces: 1 });
      self.postMessage({ type: 'ready' });
    } else if (m.type === 'frame') {
      const t0 = performance.now(), r = lm.detectForVideo(m.bitmap, m.t), L = r.faceLandmarks?.[0]; m.bitmap.close();
      self.postMessage({ type: 'eyes', t: m.t, ms: performance.now() - t0, pts: L && L.length > 473 ? [L[468], L[473]].map((p) => ({ x: p.x, y: p.y })) : null });
    }
  } catch (err) { self.postMessage({ type: 'error', msg: String(err && err.message || err) }); }
};
