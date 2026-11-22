// Eye position from the front camera (MediaPipe FaceLandmarker). Video is processed locally only.
// Output: eye midpoint in the screen frame (mm): origin = screen centre, x right, y up, z out of the screen.
import { OneEuro } from './tracker.js';

const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const IPD = 63; // mm, adult average interpupillary distance

export class EyeTracker {
  constructor() { this.video = null; this.lm = null; this.eye = null; this.status = '停止中'; this.running = false; this.f = [new OneEuro(0.8, 0.02), new OneEuro(0.8, 0.02), new OneEuro(0.8, 0.02)]; }

  async start(deviceId) {
    this.stop();
    this.status = '前面カメラを起動中…';
    const stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: deviceId ? { exact: deviceId } : undefined, width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
    this.video = document.createElement('video'); this.video.muted = true; this.video.playsInline = true; this.video.srcObject = stream; await this.video.play();
    if (!this.lm) {
      this.status = '顔の認識モデルを読み込み中…';
      const { FaceLandmarker, FilesetResolver } = await import(`${MP}/vision_bundle.mjs`);
      const fs = await FilesetResolver.forVisionTasks(`${MP}/wasm`);
      this.lm = await FaceLandmarker.createFromOptions(fs, { baseOptions: { modelAssetPath: MODEL, delegate: 'GPU' }, runningMode: 'VIDEO', numFaces: 1 });
    }
    this.running = true; this.status = '顔を探しています'; this.f.forEach(f => f.reset());
    const loop = () => {
      if (!this.running) return;
      const now = performance.now();
      const res = this.lm.detectForVideo(this.video, now);
      const L = res.faceLandmarks?.[0];
      if (L && L.length > 473) this.solve(L, now); else { this.status = '顔が見えません（画面の正面に座ってください）'; }
      this.video.requestVideoFrameCallback(loop);
    };
    this.video.requestVideoFrameCallback(loop);
  }

  // cfg: { hfov (deg), camPos: {x,y,z} (mm, screen frame) }
  configure(cfg) { this.cfg = cfg; }

  solve(L, now) {
    const vw = this.video.videoWidth, vh = this.video.videoHeight, c = this.cfg;
    const a = L[468], b = L[473];
    const ipdPx = Math.hypot((a.x - b.x) * vw, (a.y - b.y) * vh);
    const f = (vw / 2) / Math.tan((c.hfov * Math.PI / 180) / 2);
    const Z = f * IPD / ipdPx;
    const u = (a.x + b.x) / 2 * vw - vw / 2, v = (a.y + b.y) / 2 * vh - vh / 2;
    const Xc = u * Z / f, Yc = v * Z / f;
    // the camera looks out of the screen: image right = screen -x, image down = screen -y
    const raw = { x: c.camPos.x - Xc, y: c.camPos.y - Yc, z: c.camPos.z + Z };
    this.eye = { x: this.f[0].filter(raw.x, now), y: this.f[1].filter(raw.y, now), z: this.f[2].filter(raw.z, now) };
    this.status = `目の位置 ${Math.round(Z)} mm`;
  }

  stop() {
    this.running = false; this.eye = null;
    if (this.video?.srcObject) this.video.srcObject.getTracks().forEach(t => t.stop());
    this.video = null; this.status = '停止中';
  }
}
