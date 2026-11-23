// Synthetic side camera in 3D (for tests without hardware): an iPad screen tilted in front of a freely placed
// camera, showing what the iPad shows (black / calibration dot / grid / scene), and a finger at known angles.
import { drawPattern } from './pattern.js';
const THREE_URL = '/vendor/three/three.module.js';

// the iPad (A16) in landscape: 1180 x 820 CSS px at 0.1924 mm/px -> the same numbers the real iPad page reports
export async function createSim3D({ width = 1920, height = 1080, fps = 30, sw = 1180, sh = 820, mmPerPx = 0.1924, pip = { x: 0, y: 0 } } = {}) {
  const Wmm = sw * mmPerPx, Hmm = sh * mmPerPx;
  const THREE = await import(THREE_URL);
  const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  renderer.setSize(width, height, false); renderer.setPixelRatio(1);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x2a2a2a);
  const f = 0.8 * width; // focal length in px (truth)
  const cam = new THREE.PerspectiveCamera(2 * Math.atan(height / 2 / f) * 180 / Math.PI, width / height, 5, 3000);
  // camera placed freely: left of the PIP, a little up the slope, looking down ~16 deg
  const C = new THREE.Vector3(pip.x - 210, pip.y + 15, 60);
  cam.position.copy(C); cam.up.set(0, 0, 1); cam.lookAt(pip.x, pip.y + 10, 25);
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(-60, 40, 300); scene.add(sun);

  // screen texture
  const sc = document.createElement('canvas'); sc.width = 2360; sc.height = 1640; const sx = sc.getContext('2d');
  const tex = new THREE.CanvasTexture(sc); tex.colorSpace = THREE.SRGBColorSpace;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(Wmm, Hmm), new THREE.MeshBasicMaterial({ map: tex }));
  scene.add(screen);
  const body = new THREE.Mesh(new THREE.BoxGeometry(248.6, 179.5, 7), new THREE.MeshLambertMaterial({ color: 0x1b1c1f }));
  body.position.z = -3.6; scene.add(body);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(400, 300), new THREE.MeshLambertMaterial({ color: 0x050505 }));
  back.position.set(pip.x + 110, pip.y, 60); back.rotation.y = -Math.PI / 2; scene.add(back);
  const pxmm = sc.width / Wmm, toPx = (x, y) => [(x + Wmm / 2) * pxmm, (Hmm / 2 - y) * pxmm];
  function drawScreen(state) {
    if (state.kind === 'scene') { sx.fillStyle = '#3c4048'; sx.fillRect(0, 0, sc.width, sc.height); const [x, y] = toPx(pip.x, pip.y); sx.strokeStyle = '#ff4d4d'; sx.lineWidth = 6; sx.beginPath(); sx.arc(x, y, 10 * pxmm, 0, 7); sx.stroke(); }
    else drawPattern(sx, sc.width, sc.height, state, sw, sh, mmPerPx);
    tex.needsUpdate = true;
  }
  drawScreen({ kind: 'black' });

  // finger (screen frame: middle phalanx on the glass along +y, palm side up = +z)
  const skin = new THREE.MeshLambertMaterial({ color: 0xd8a283 });
  const r = 7.5, Lm = 25, Lp = 44, Ld = 22;
  const cap = (rad, len) => new THREE.Mesh(new THREE.CapsuleGeometry(rad, len, 8, 20), skin);
  const prox = cap(r * 1.05, Lp), mid = cap(r, Lm), dist = cap(r * 0.9, Ld - r * 0.9);
  const palm = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), skin); palm.scale.set(38, 32, 16);
  const hand = new THREE.Group(); hand.add(prox, mid, dist, palm); scene.add(hand);
  const P = new THREE.Vector3(pip.x, pip.y, r), Y = new THREE.Vector3(0, 1, 0);
  const place = (m, a, d, L) => { m.position.copy(a).addScaledVector(d, L / 2); m.quaternion.setFromUnitVectors(Y, d); };
  const state = { handIn: false, manual: null, t0: performance.now(), thp: 70, thd: 30, screen: { kind: 'black' } };
  function pose(now) {
    const A = state.manual || (() => { const s = (now - state.t0) / 1000; return { thp: 75 + 25 * Math.sin(2 * Math.PI * s / 7), thd: 40 + 35 * Math.sin(2 * Math.PI * s / 4.6 + 1) }; })();
    state.thp = A.thp; state.thd = A.thd;
    const rp = (x) => x * Math.PI / 180;
    const dp = new THREE.Vector3(0, -Math.cos(rp(A.thp)), Math.sin(rp(A.thp)));
    const dd = new THREE.Vector3(0, Math.cos(rp(A.thd)), Math.sin(rp(A.thd)));
    const D = P.clone().add(new THREE.Vector3(0, Lm, 0));
    place(mid, P, Y, Lm); place(prox, P, dp, Lp); place(dist, D, dd, Ld - r * 0.9);
    palm.position.copy(P).addScaledVector(dp, Lp + 36); palm.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dp);
    hand.visible = state.handIn;
  }
  // output canvas with light sensor noise
  const out = document.createElement('canvas'); out.width = width; out.height = height; const ox = out.getContext('2d');
  const noise = document.createElement('canvas'); noise.width = noise.height = 256;
  { const n = noise.getContext('2d'), id = n.createImageData(256, 256); for (let i = 0; i < id.data.length; i += 4) { const v = Math.random() * 255; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255; } n.putImageData(id, 0, 0); }
  const pat = ox.createPattern(noise, 'repeat');
  const timer = setInterval(() => {
    pose(performance.now()); renderer.render(scene, cam);
    ox.drawImage(renderer.domElement, 0, 0);
    ox.save(); ox.globalAlpha = 0.04; ox.translate(-Math.floor(Math.random() * 256), -Math.floor(Math.random() * 256)); ox.fillStyle = pat; ox.fillRect(0, 0, width + 256, height + 256); ox.restore();
  }, 1000 / fps);
  const stream = out.captureStream(fps);
  return {
    stream, state, cam, THREE, truth: { f, C: [C.x, C.y, C.z], pip },
    setScreen(s) { state.screen = s; drawScreen(s); },
    angles: () => ({ thp: state.thp, thd: state.thd }),
    stop() { clearInterval(timer); stream.getTracks().forEach((t) => t.stop()); },
  };
}
