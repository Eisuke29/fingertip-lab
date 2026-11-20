// Pivot Finger Stage — 3D video prototype.
// The back of the index finger's middle phalanx lies flat on the glass; PIP is the pivot.
// θp (proximal phalanx angle to the glass) -> virtual middle segment (extension of the proximal line through PIP).
// θd (real DIP flexion) -> virtual distal segment. Vertical plane only.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
const DEG = Math.PI / 180;
const params = new URLSearchParams(location.search);
const CAPTURE = params.has('capture');
if (CAPTURE) document.body.classList.add('capture');
if (params.has('clean')) document.body.classList.add('clean');

// ---------- dimensions (meters) ----------
const PAD = { w: 0.1785, l: 0.2476, t: 0.0061, bezel: 0.0090 };
const SCREEN = { w: PAD.w - 2 * PAD.bezel, l: PAD.l - 2 * PAD.bezel };
const ROOT = V(0.028, 0, -0.005);                // PIP contact projected on the glass (right half: the right hand comes from the visitor's right)
const H = V(0.28, 0, 1).normalize();             // horizontal direction from PIP toward DIP / the hand: the hand enters from the visitor side (+z)
const RF = 0.0082;                               // finger radius
const PHI = 48 * DEG;                            // index MCP flexion (metacarpal vs proximal)
const BALL_R = 0.022;


// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: CAPTURE });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.localClippingEnabled = true;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const GALLERY = new THREE.Color(0xebe8e3);
scene.background = GALLERY;
scene.fog = new THREE.Fog(GALLERY, 2.2, 6);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;

const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.01, 20);
// Showcase tilt: the tablet leans back by TILT on a stand. Gravity "up" in the device frame:
const TILT = 35 * Math.PI / 180;
const ENV_UP = new THREE.Vector3(0, Math.cos(TILT), -Math.sin(TILT));
camera.up.copy(ENV_UP);
// env (gravity) frame -> device frame
const ENV2DEV = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -TILT);
const envToDev = (v) => v.clone().applyQuaternion(ENV2DEV);
// visitor eye: standing in front of the showcase, ~46 cm in front of and 32 cm above the tablet centre
const EYE = envToDev(new THREE.Vector3(-0.13, 0.36, 0.40));   // head is left of the right hand, looking down past it
const envG = new THREE.Group(); envG.rotation.x = -TILT;
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.copy(ROOT).add(V(0, -0.01, 0));
controls.minDistance = 0.12; controls.maxDistance = 2.0;
controls.minPolarAngle = 4 * Math.PI / 180; controls.maxPolarAngle = 84 * Math.PI / 180;   // never below the pedestal top

// layers: 0 = real world, 1 = virtual objects (inside the screen), 2 = lights for the screen render only
const L_VIRTUAL = 1, L_SCREENLIGHT = 2;

// ---------- lights (real world) ----------
scene.add(envG);
envG.add(new THREE.HemisphereLight(0xffffff, 0xd9d2c7, 0.9));
const key = new THREE.DirectionalLight(0xffffff, 2.2);
key.position.set(-0.35, 0.9, 0.45);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -0.35, right: 0.35, top: 0.35, bottom: -0.35, near: 0.1, far: 2.5 });
key.shadow.bias = -0.0004; key.shadow.radius = 4;
envG.add(key);
const rim = new THREE.DirectionalLight(0xfff4e8, 0.7); rim.position.set(0.6, 0.4, -0.6); envG.add(rim);

// ---------- environment: gallery floor + pedestal ----------
const PED_H = 0.92;
const woodMat = new THREE.MeshStandardMaterial({ color: 0xd8c3a2, roughness: 0.72, transparent: true });
const pedestal = new THREE.Mesh(new RoundedBoxGeometry(0.46, PED_H, 0.40, 3, 0.006), woodMat);
// env-frame height of the tablet's lower edge -> pedestal top just below it
const PED_TOP = -(PAD.t * Math.cos(TILT) + (PAD.l / 2) * Math.sin(TILT)) - 0.012;
pedestal.position.set(0, PED_TOP - PED_H / 2, 0.06);
pedestal.receiveShadow = true; pedestal.castShadow = true;
envG.add(pedestal);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshStandardMaterial({ color: 0xdedad3, roughness: 0.35, metalness: 0 }));
floor.rotation.x = -Math.PI / 2; floor.position.y = PED_TOP - PED_H; floor.receiveShadow = true;
envG.add(floor);
// a couple of distant blurred-ish plinths for gallery feel
for (const [x, z, h] of [[-1.4, -1.6, 1.0], [1.7, -2.2, 0.8], [-2.4, 0.4, 0.9]]) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.45, h, 0.45), new THREE.MeshStandardMaterial({ color: 0xf3f1ed, roughness: 0.9 }));
  m.position.set(x, floor.position.y + h / 2, z); m.receiveShadow = true; envG.add(m);
}

// ---------- tablet ----------
const device = new THREE.Group(); scene.add(device);
const bodyMat = new THREE.MeshStandardMaterial({ color: 0x6d7073, metalness: 0.85, roughness: 0.32, transparent: true });
const body = new THREE.Mesh(new RoundedBoxGeometry(PAD.w, PAD.t, PAD.l, 4, 0.0028), bodyMat);
body.position.y = -PAD.t / 2; body.castShadow = true; body.receiveShadow = true; device.add(body);
const bezelMat = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.2, metalness: 0, transparent: true });
const bezel = new THREE.Mesh(new RoundedBoxGeometry(PAD.w - 0.0016, 0.0004, PAD.l - 0.0016, 2, 0.0002), bezelMat);
bezel.position.y = -0.0003; device.add(bezel);

// showcase stand
const standMat = new THREE.MeshStandardMaterial({ color: 0x9a9ea2, metalness: 0.7, roughness: 0.35, transparent: true });
const standPlate = new THREE.Mesh(new RoundedBoxGeometry(PAD.w * 0.62, 0.004, PAD.l * 0.6, 2, 0.0015), standMat);
standPlate.position.set(0, -PAD.t - 0.0022, -0.01); standPlate.castShadow = true; device.add(standPlate);
const standLip = new THREE.Mesh(new RoundedBoxGeometry(PAD.w * 0.75, 0.012, 0.006, 2, 0.0015), standMat);
standLip.position.set(0, -PAD.t + 0.003, PAD.l / 2 + 0.0035); standLip.castShadow = true; device.add(standLip);
{ // leg from the plate's upper part down to the pedestal (env frame)
  const pDev = V(0, -PAD.t - 0.004, -0.08), c = Math.cos(TILT), sn = Math.sin(TILT);
  const yE = pDev.y * c - pDev.z * sn, zE = pDev.y * sn + pDev.z * c;
  const h = yE - PED_TOP;
  const leg = new THREE.Mesh(new RoundedBoxGeometry(0.05, h, 0.006, 2, 0.002), standMat);
  leg.position.set(0, PED_TOP + h / 2, zE - 0.004); leg.castShadow = true; envG.add(leg);
  const foot = new THREE.Mesh(new RoundedBoxGeometry(0.12, 0.006, 0.16, 2, 0.002), standMat);
  foot.position.set(0, PED_TOP + 0.003, zE + 0.05); foot.castShadow = true; foot.receiveShadow = true; envG.add(foot);
}

// screen: render target filled from the visitor's eye (off-axis projection)
const RT_W = 1024, RT_H = Math.round(1024 * SCREEN.l / SCREEN.w);
const screenRT = new THREE.WebGLRenderTarget(RT_W, RT_H, { samples: 4 });
screenRT.texture.colorSpace = THREE.SRGBColorSpace;
const screenMat = new THREE.MeshBasicMaterial({ map: screenRT.texture, toneMapped: false, transparent: true });
const screenGeo = new THREE.PlaneGeometry(SCREEN.w, SCREEN.l);
const screen = new THREE.Mesh(screenGeo, screenMat);
screen.rotation.x = -Math.PI / 2; screen.position.y = 0.0002; device.add(screen);
// glass: reflections + shadow catcher
const glass = new THREE.Mesh(new THREE.PlaneGeometry(PAD.w - 0.002, PAD.l - 0.002),
  new THREE.MeshPhysicalMaterial({ color: 0x000000, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.12, envMapIntensity: 1.2 }));
glass.rotation.x = -Math.PI / 2; glass.position.y = 0.0005; device.add(glass);
const shadowCatch = new THREE.Mesh(new THREE.PlaneGeometry(PAD.w, PAD.l), new THREE.ShadowMaterial({ opacity: 0.35 }));
shadowCatch.rotation.x = -Math.PI / 2; shadowCatch.position.y = 0.0008; shadowCatch.receiveShadow = true; device.add(shadowCatch);

// screen corners (world) for the off-axis projection: pa = lower-left, pb = lower-right, pc = upper-left (as seen by visitor at +z)
const pa = V(-SCREEN.w / 2, 0, SCREEN.l / 2), pb = V(SCREEN.w / 2, 0, SCREEN.l / 2), pc = V(-SCREEN.w / 2, 0, -SCREEN.l / 2);
const screenCam = new THREE.PerspectiveCamera();
screenCam.layers.set(L_VIRTUAL); screenCam.layers.enable(L_SCREENLIGHT); screenCam.layers.enable(3);
function updateScreenCamera(eye) {
  const vr = pb.clone().sub(pa).normalize(), vu = pc.clone().sub(pa).normalize(), vn = vr.clone().cross(vu).normalize();
  const va = pa.clone().sub(eye), vb = pb.clone().sub(eye), vc = pc.clone().sub(eye);
  const d = -va.dot(vn), n = 0.01, f = 3;
  const l = vr.dot(va) * n / d, r = vr.dot(vb) * n / d, b = vu.dot(va) * n / d, t = vu.dot(vc) * n / d;
  screenCam.projectionMatrix.makePerspective(l, r, t, b, n, f);
  screenCam.projectionMatrixInverse.copy(screenCam.projectionMatrix).invert();
  screenCam.position.copy(eye);
  screenCam.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(vr, vu, vn));
  screenCam.updateMatrixWorld(true);
}
// plane UVs: (0,0) bottom-left of PlaneGeometry; after rotation.x=-90°, v=0 is +z (visitor side) => matches pa..pc

// ---------- 2D screen panel: the flat image the tablet actually displays ----------
// Rendered for the fixed visitor eye (EYE), independent of the 3D camera, and drawn into a corner of the canvas.
const P2_H = 1000;
const screen2D = new THREE.WebGLRenderTarget(Math.round(P2_H * SCREEN.w / SCREEN.l), P2_H, { samples: 4 });
screen2D.texture.colorSpace = THREE.SRGBColorSpace;
// The tablet shows ONE flat image (made for the visitor eye). The 3D screen uses exactly that image, so the
// display looks the same from every viewing angle, like a real screen.
screenMat.map = screen2D.texture; screenRT.dispose();
const quadScene = new THREE.Scene(), quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: screen2D.texture, toneMapped: false })));
let panelOn = !new URLSearchParams(location.search).has('nopanel'), panelBig = false;
function panelRect() {
  const W = innerWidth, Hh = innerHeight, mobile = W < 640;
  const barH = CAPTURE ? 0 : (mobile ? 150 : 130);               // keep the enlarged panel above the control bar
  let h = panelBig ? Math.round(Hh - barH - 70) : Math.round(Hh * (mobile ? 0.26 : 0.42));
  if (!panelBig && !mobile && !CAPTURE) h = Math.min(h, Hh - 16 - 330 - 60);      // keep clear of the control card (bottom right)
  h = Math.max(120, h);
  const w = Math.round(h * SCREEN.w / SCREEN.l);
  const x = panelBig ? Math.round((W - w) / 2) : W - w - (mobile ? 14 : 30);
  const y = panelBig ? 50 : (mobile ? 96 : 40);
  return { x, y, w, h };
}
function layoutPanel() {
  const el = document.getElementById('panel2d'); if (!el) return;
  el.hidden = !panelOn; if (!panelOn) return;
  const r = panelRect();
  Object.assign(el.style, { left: r.x - 9 + 'px', top: r.y - 9 + 'px', width: r.w + 'px', height: r.h + 'px' });
  el.classList.toggle('big', panelBig);
}

// eye marker and sight lines to the screen corners ("see-through hand" view)
const eyeDot = new THREE.Mesh(new THREE.SphereGeometry(0.008, 24, 16), new THREE.MeshBasicMaterial({ color: 0x2f6f5b, transparent: true }));
const sightLines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x2f6f5b, transparent: true, opacity: 0.5 }));
{ const c = [V(-SCREEN.w / 2, 0, SCREEN.l / 2), V(SCREEN.w / 2, 0, SCREEN.l / 2), V(SCREEN.w / 2, 0, -SCREEN.l / 2), V(-SCREEN.w / 2, 0, -SCREEN.l / 2)];
  const pts = []; for (const k of c) pts.push(EYE, k); sightLines.geometry.setFromPoints(pts); }
eyeDot.position.copy(EYE); scene.add(eyeDot, sightLines); eyeDot.visible = sightLines.visible = false;
const SCREEN_CORNERS = [V(-SCREEN.w / 2, 0, SCREEN.l / 2), V(SCREEN.w / 2, 0, SCREEN.l / 2), V(SCREEN.w / 2, 0, -SCREEN.l / 2), V(-SCREEN.w / 2, 0, -SCREEN.l / 2)];
function updateSight(eye) { const pts = []; for (const k of SCREEN_CORNERS) pts.push(eye, k); sightLines.geometry.setFromPoints(pts); eyeDot.position.copy(eye); }
// front camera (top bezel). In eye-tracking mode it measures where the viewer's eyes are (e.g. MediaPipe Face Landmarker).
const frontCam = new THREE.Mesh(new THREE.CircleGeometry(0.0016, 24), new THREE.MeshBasicMaterial({ color: 0x1b1f22 }));
frontCam.rotation.x = -Math.PI / 2; frontCam.position.set(0, 0.0004, -PAD.l / 2 + 0.0045); scene.add(frontCam);
const frontLed = new THREE.Mesh(new THREE.RingGeometry(0.0019, 0.0026, 24), new THREE.MeshBasicMaterial({ color: 0x5fd39a, transparent: true, opacity: 0, toneMapped: false }));
frontLed.rotation.x = -Math.PI / 2; frontLed.position.copy(frontCam.position); scene.add(frontLed);
// Screen mode: 'fixed' = an ordinary tablet (one image, made for the fixed visitor eye)
//              'track' = the image is re-rendered for the viewer's current eye position (front-camera eye tracking)
let screenMode = 'fixed';
const curEye = V().copy(EYE);

// ---------- virtual world (inside the screen) ----------
const VBG = new THREE.Color(0x0a0c0c);
const vKey = new THREE.SpotLight(0xffffff, 7, 0, 0.7, 0.5, 1.2);
vKey.position.set(-0.05, 0.22, -0.08); vKey.target.position.set(0.02, -0.06, 0.02);
vKey.castShadow = true; vKey.shadow.mapSize.set(1024, 1024); vKey.shadow.bias = -0.0003;
const vFill = new THREE.HemisphereLight(0xcfe9ff, 0x202424, 0.7);
for (const l of [vKey, vFill]) { l.layers.set(L_SCREENLIGHT); scene.add(l); }
scene.add(vKey.target);
const vFloor = new THREE.Mesh(new THREE.PlaneGeometry(SCREEN.w, SCREEN.l), new THREE.MeshStandardMaterial({ color: 0x15191a, roughness: 0.9 }));
vFloor.rotation.x = -Math.PI / 2; vFloor.position.y = -0.085; vFloor.receiveShadow = true; vFloor.layers.set(L_VIRTUAL);
vFloor.material.color.set(0x0b0d0d); scene.add(vFloor);
// Inside of the screen: a shallow box (floor + walls with a faint grid) so the flat image reads as a window into
// a space. Layer 3 = seen only by the screen camera (not drawn in the 3D room, even in the structure view).
const L_SCREENONLY = 3, BOX_D = 0.085;
const gridTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  g.fillStyle = '#14181a'; g.fillRect(0, 0, 256, 256); g.strokeStyle = 'rgba(160,190,185,0.16)'; g.lineWidth = 2;
  for (let i = 0; i <= 256; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(256, i); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t; })();
function boxFace(w, h, rep2, pos, rotX, rotY) {
  const tex = gridTex.clone(); tex.needsUpdate = true; tex.repeat.set(w / 0.02, h / 0.02);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, color: 0xffffff }));
  m.position.copy(pos); m.rotation.set(rotX, rotY, 0); m.receiveShadow = true; m.layers.set(L_SCREENONLY); scene.add(m); return m;
}
boxFace(SCREEN.w, SCREEN.l, 0, V(0, -BOX_D, 0), -Math.PI / 2, 0);                                   // floor
boxFace(SCREEN.w, BOX_D, 0, V(0, -BOX_D / 2, -SCREEN.l / 2), 0, 0);                                 // far wall
boxFace(SCREEN.w, BOX_D, 0, V(0, -BOX_D / 2, SCREEN.l / 2), 0, Math.PI);                            // near wall
boxFace(SCREEN.l, BOX_D, 0, V(-SCREEN.w / 2, -BOX_D / 2, 0), 0, Math.PI / 2);                       // left wall
boxFace(SCREEN.l, BOX_D, 0, V(SCREEN.w / 2, -BOX_D / 2, 0), 0, -Math.PI / 2);                       // right wall
// outline of the virtual volume (structure view)
const vBox = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(SCREEN.w, 0.085, SCREEN.l)),
  new THREE.LineBasicMaterial({ color: 0x5fb59a, transparent: true, opacity: 0.55 }));
vBox.position.y = -0.0425; vBox.layers.set(L_VIRTUAL); scene.add(vBox);

// Part colours: the real phalanx and the virtual segment it drives share a colour.
const COL = { hand: new THREE.Color(0xb9b9b7), prox: new THREE.Color(0x4f8fe6), dist: new THREE.Color(0xf09a3e) };
const skinMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0, vertexColors: true });
const BELOW_GLASS = [new THREE.Plane(new THREE.Vector3(0, -1, 0), 0)];   // keep y <= 0
const vMidMat = new THREE.MeshStandardMaterial({ color: COL.prox, roughness: 0.55, transparent: true, opacity: 1, emissive: COL.prox, emissiveIntensity: 0.05, clippingPlanes: BELOW_GLASS });
const vDistMat = new THREE.MeshStandardMaterial({ color: COL.dist, roughness: 0.55, transparent: true, opacity: 1, emissive: COL.dist, emissiveIntensity: 0.05, clippingPlanes: BELOW_GLASS });
function capsule(mat) {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(RF, 0.02, 10, 28), mat);
  m.userData.len = 0.02;
  m.castShadow = true; m.layers.set(L_VIRTUAL); scene.add(m); return m;
}
const vMid = capsule(vMidMat), vDist = capsule(vDistMat);
function placeCapsule(mesh, a, b, r = RF) {
  const d = b.clone().sub(a), len = d.length();
  mesh.position.copy(a).addScaledVector(d, 0.5);
  mesh.quaternion.setFromUnitVectors(UP, d.normalize());
  if (Math.abs(mesh.userData.len - len) > 1e-5) { mesh.geometry.dispose(); mesh.geometry = new THREE.CapsuleGeometry(r, len, 10, 28); mesh.userData.len = len; }
}

// jelly ball
// Soft body: a closed surface of point masses joined by springs along the mesh edges, kept round by internal pressure
// (volume) and a weak shape memory. The centre is fixed. The finger is a hard capsule; the surface can't enter it.
const ballGeo = (() => { const g0 = new THREE.IcosahedronGeometry(BALL_R, 16); g0.deleteAttribute('normal'); g0.deleteAttribute('uv'); return mergeVertices(g0, 1e-7); })();
ballGeo.computeVertexNormals();
const ballRest = ballGeo.attributes.position.array.slice();
const ballCur = ballGeo.attributes.position.array.slice();
const BIDX = ballGeo.index.array, BN = ballRest.length / 3;
const BEDGES = (() => { const set = new Set(), out = [];
  for (let f = 0; f < BIDX.length; f += 3) for (const [a, b] of [[BIDX[f], BIDX[f + 1]], [BIDX[f + 1], BIDX[f + 2]], [BIDX[f + 2], BIDX[f]]]) {
    const k = a < b ? a * 1e6 + b : b * 1e6 + a; if (!set.has(k)) { set.add(k); out.push(a, b); } }
  const e = new Uint32Array(out), L0 = new Float32Array(out.length / 2);
  for (let i = 0; i < L0.length; i++) { const a = e[2 * i] * 3, b = e[2 * i + 1] * 3; L0[i] = Math.hypot(ballRest[a] - ballRest[b], ballRest[a + 1] - ballRest[b + 1], ballRest[a + 2] - ballRest[b + 2]); }
  return { e, L0 }; })();
function meshVolume(x) { let v = 0; for (let f = 0; f < BIDX.length; f += 3) { const a = BIDX[f] * 3, b = BIDX[f + 1] * 3, c = BIDX[f + 2] * 3;
  v += x[a] * (x[b + 1] * x[c + 2] - x[b + 2] * x[c + 1]) - x[a + 1] * (x[b] * x[c + 2] - x[b + 2] * x[c]) + x[a + 2] * (x[b] * x[c + 1] - x[b + 1] * x[c]); } return v / 6; }
const BALL_V0 = meshVolume(ballRest), BALL_A0 = 4 * Math.PI * BALL_R * BALL_R / BN;
const ballMat = new THREE.MeshPhysicalMaterial({
  color: 0x3fb98a, roughness: 0.22, metalness: 0, transmission: 0.15, thickness: 0.03, ior: 1.36,
  attenuationColor: new THREE.Color(0x3fae86), attenuationDistance: 0.03, clearcoat: 1, clearcoatRoughness: 0.08,
  sheen: 0.2, sheenColor: new THREE.Color(0xd9fff0), emissive: 0x135c42, emissiveIntensity: 0.12,
});
const ball = new THREE.Mesh(ballGeo, ballMat);
ball.castShadow = true; ball.layers.set(L_VIRTUAL); scene.add(ball);

// sticky thread
const threadMat = new THREE.MeshPhysicalMaterial({ color: 0xb8f0d6, roughness: 0.08, transmission: 0.5, thickness: 0.002, emissive: 0x0e3a2b, emissiveIntensity: 0.5 });
const thread = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 12, 8, true), threadMat);
thread.layers.set(L_VIRTUAL); thread.visible = false; scene.add(thread);
{ // pinch the middle of the cylinder so it reads like a stretched strand
  const p = thread.geometry.attributes.position;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i), s = 0.45 + 0.55 * (2 * Math.abs(y)) ** 1.6; p.setX(i, p.getX(i) * s); p.setZ(i, p.getZ(i) * s); }
  thread.geometry.computeVertexNormals();
}

// contact ring on the glass (exhibition touch feedback), real-world layer
const ring = new THREE.Mesh(new THREE.RingGeometry(0.009, 0.0105, 64), new THREE.MeshBasicMaterial({ color: 0x8fe0c0, transparent: true, opacity: 0, toneMapped: false }));
ring.rotation.x = -Math.PI / 2; ring.position.copy(ROOT).add(V(0, -0.0004, 0)); ring.layers.set(L_VIRTUAL); scene.add(ring);

// pivot guide (structure view): the real proximal phalanx and the virtual middle segment are one straight line through PIP
const guideGeo = new THREE.BufferGeometry().setFromPoints([V(), V(), V()]);
const guide = new THREE.Line(guideGeo, new THREE.LineDashedMaterial({ color: 0x2f6f5b, dashSize: 0.004, gapSize: 0.0025, transparent: true, opacity: 0.9, depthTest: false }));
guide.renderOrder = 10; guide.frustumCulled = false; scene.add(guide);
const pivotDot = new THREE.Mesh(new THREE.SphereGeometry(0.0022, 20, 12), new THREE.MeshBasicMaterial({ color: 0xe0503a, depthTest: false }));
pivotDot.renderOrder = 11; scene.add(pivotDot);

// ---------- taut thread (cut task) ----------
// A thread stretched across the finger's path inside the screen. STRING.strength = 0: cut on first touch.
// (Later: >0 lets the finger push the thread aside and it only snaps beyond a stretch threshold.)
const STRING = { strength: 0, segs: 28, radius: 0.0009 };
const stringMat = new THREE.MeshStandardMaterial({ color: 0xff5d6c, roughness: 0.45, emissive: 0xff5d6c, emissiveIntensity: 0.35 });
const stringMeshes = [0, 1].map(() => { const m = new THREE.Mesh(new THREE.BufferGeometry(), stringMat); m.layers.set(L_VIRTUAL); m.castShadow = true; m.frustumCulled = false; scene.add(m); return m; });
const anchorMat = new THREE.MeshStandardMaterial({ color: 0x6c7377, metalness: 0.6, roughness: 0.4 });
const anchors = [0, 1].map(() => { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.0025, 0.0025, 0.012, 16), anchorMat); m.layers.set(L_VIRTUAL); scene.add(m); return m; });
let strA = V(), strB = V();
const str = { cut: false, cutT: 0, ropes: null };
function layoutString() {
  const fr = fingerFrame(68 * DEG, 35 * DEG);
  const vDip = vRoot().addScaledVector(fr.u, hand.Lm);
  // just outside the finger pad at DIP 40° -> touched while flexing, clear of the relaxed finger
  const c = vDip.clone().addScaledVector(fr.dDir, hand.Ld * 0.6).addScaledVector(fr.nD, RF + 0.003);
  // across the screen (mostly left-right for the visitor) while still crossing the finger plane at c
  const lat = SIDE_DIR.clone();   // crosses the finger plane at right angles -> only the finger pad can reach it
  strA = c.clone().addScaledVector(lat, -0.05); strB = c.clone().addScaledVector(lat, 0.05);
  anchors[0].position.copy(strA); anchors[1].position.copy(strB);
  for (const a of anchors) a.quaternion.setFromUnitVectors(UP, ENV_UP);
}
function resetString() { str.cut = false; str.cutT = 0; str.ropes = null; }
function tautPoint(t, sc) { return strA.clone().lerp(strB, t * sc + (1 - sc) * 0.5).addScaledVector(ENV_UP, -0.0004 * sc * Math.sin(Math.PI * t)); }
function ropeTube(mesh, pts) {
  mesh.geometry.dispose();
  mesh.geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), Math.max(8, pts.length * 2), STRING.radius, 8, false);
}
function updateString(dt, show, fingerSegs) {
  for (const m of [...stringMeshes, ...anchors]) m.visible = show > 0.01;
  if (show <= 0.01) return;
  const sc = Math.max(0.001, show);
  for (const a of anchors) a.scale.setScalar(sc);
  if (!str.cut) {
    // touch test: thread segment vs finger capsules
    let hit = null;
    if (show > 0.99) for (let k = 1; k < 40; k++) {
      const pt = tautPoint(k / 40, 1);
      for (const [a, b] of fingerSegs) if (closestOnSeg(a, b, pt, _pq).distanceTo(pt) < RF + STRING.radius) { hit = k / 40; break; }
      if (hit !== null) break;
    }
    if (hit !== null && STRING.strength === 0) {
      str.cut = true; str.cutT = 0;
      const n = STRING.segs, cutAt = hit, g = V();
      const mk = (from, to, frac) => { // rope from anchor (fixed) to the cut end
        const pts = []; for (let i = 0; i <= n; i++) pts.push(from.clone().lerp(to, i / n));
        return { p: pts, q: pts.map((v) => v.clone()), rest: from.distanceTo(to) / n * 0.97 };
      };
      const cp = tautPoint(cutAt, 1);
      str.ropes = [mk(strA, cp), mk(strB, cp)];
    } else {
      const pts = []; for (let i = 0; i <= 12; i++) pts.push(tautPoint(i / 12, sc));
      ropeTube(stringMeshes[0], pts); stringMeshes[1].visible = false;
      return;
    }
  }
  // cut halves: verlet ropes, fixed at the anchors, falling under (env) gravity
  str.cutT += dt;
  const G = ENV_UP.clone().multiplyScalar(-2.5), steps = Math.max(1, Math.ceil(dt / (1 / 240))), h = dt / steps;
  for (const r of str.ropes) {
    for (let st = 0; st < steps; st++) {
      for (let i = 1; i < r.p.length; i++) {
        const v = r.p[i].clone().sub(r.q[i]).multiplyScalar(0.985);
        r.q[i].copy(r.p[i]); r.p[i].add(v).addScaledVector(G, h * h);
      }
      for (let it = 0; it < 12; it++) for (let i = 0; i < r.p.length - 1; i++) {
        const a = r.p[i], b = r.p[i + 1], d = b.clone().sub(a), L = d.length(), diff = (L - r.rest) / L;
        if (i === 0) b.addScaledVector(d, -diff); else { a.addScaledVector(d, 0.5 * diff); b.addScaledVector(d, -0.5 * diff); }
      }
      r.p[0].copy(r === str.ropes[0] ? strA : strB);
    }
  }
  ropeTube(stringMeshes[0], str.ropes[0].p); ropeTube(stringMeshes[1], str.ropes[1].p);
  stringMeshes[1].visible = true;
}

// ---------- geometry of the finger (shared real / virtual) ----------
function fingerFrame(thp, thd) {
  const proxUp = H.clone().multiplyScalar(Math.cos(thp)).addScaledVector(UP, Math.sin(thp)); // PIP -> MCP
  const u = proxUp.clone().negate();                                                        // virtual middle direction
  const n = H.clone().addScaledVector(u, -H.dot(u)).normalize();                            // palmar side of virtual finger
  const dDir = u.clone().multiplyScalar(Math.cos(thd)).addScaledVector(n, Math.sin(thd));   // virtual distal direction
  const nD = n.clone().multiplyScalar(Math.cos(thd)).addScaledVector(u, -Math.sin(thd));    // palmar normal of virtual distal
  return { proxUp, u, n, dDir, nD };
}

// ---------- hand model ----------
// The WebXR generic hand has a FLAT joint hierarchy (every joint is a child of "Armature"), so we compute
// each joint's position and orientation with our own forward kinematics and write them directly.
let hand = null;
const handHolder = new THREE.Group(); scene.add(handHolder);
const FINGERS = ['thumb', 'index-finger', 'middle-finger', 'ring-finger', 'pinky-finger'];
const chainOf = (f) => f === 'thumb'
  ? ['thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip']
  : [`${f}-metacarpal`, `${f}-phalanx-proximal`, `${f}-phalanx-intermediate`, `${f}-phalanx-distal`, `${f}-tip`];
new GLTFLoader().load('./assets/right.glb', (g) => {
  const model = g.scene;
  handHolder.add(model);
  model.updateMatrixWorld(true);
  const bones = {}; let armature = null;
  model.traverse((o) => {
    bones[o.name] = o; if (o.name === 'Armature') armature = o;
    if (o.isSkinnedMesh || o.isMesh) { o.geometry.deleteAttribute('normal'); o.geometry = mergeVertices(o.geometry, 1e-4); o.geometry.computeVertexNormals(); o.material = skinMat; o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; }
  });
  const restP = {}, restQ = {};
  for (const f of FINGERS) for (const n of chainOf(f)) { restP[n] = bones[n].position.clone(); restQ[n] = bones[n].quaternion.clone(); }
  restP.wrist = bones.wrist.position.clone(); restQ.wrist = bones.wrist.quaternion.clone();
  const P = (n) => restP[n];
  const Lp = P('index-finger-phalanx-proximal').distanceTo(P('index-finger-phalanx-intermediate'));
  const Lm = P('index-finger-phalanx-intermediate').distanceTo(P('index-finger-phalanx-distal'));
  const Ld = P('index-finger-phalanx-distal').distanceTo(P('index-finger-tip'));
  const f0 = P('middle-finger-phalanx-proximal').clone().sub(P('wrist')).normalize();
  const p0 = P('index-finger-phalanx-proximal').clone().sub(P('pinky-finger-phalanx-proximal')).cross(f0).normalize();
  const l0 = f0.clone().cross(p0).normalize();
  const M0 = new THREE.Matrix4().makeBasis(l0, f0, p0);
  hand = { model, bones, armature, restP, restQ, Lp, Lm, Ld, M0 };
  buildVertexGroups(model);
  model.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    const names = o.skeleton.bones.map((b) => b.name);
    const iP = names.indexOf('index-finger-phalanx-proximal'), iD = names.indexOf('index-finger-phalanx-distal'), iT = names.indexOf('index-finger-tip');
    const si = o.geometry.attributes.skinIndex, sw = o.geometry.attributes.skinWeight, n = si.count;
    const col = new Float32Array(n * 3), c = new THREE.Color();
    for (let v = 0; v < n; v++) {
      let wP = 0, wD = 0;
      for (let k = 0; k < 4; k++) { const b = si.getComponent(v, k), w = sw.getComponent(v, k); if (b === iP) wP += w; else if (b === iD || b === iT) wD += w; }
      const sharpen = (w) => THREE.MathUtils.smoothstep(w, 0.35, 0.65);
      wP = sharpen(wP); wD = sharpen(wD);
      c.copy(COL.hand).lerp(COL.prox, wP).lerp(COL.dist, wD);
      col.set([c.r, c.g, c.b], v * 3);
    }
    o.geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
  });
  calibratePipHeight();
  console.log('[stage] hand loaded', { Lp, Lm, Ld, PIP_H });
  layoutBall();
  layoutString();
  ready = true;
});

const CURL0 = { // flexion (deg) of [MCP, PIP, DIP] for the loosely closed fingers; thumb [CMC, MCP, IP]
  'middle-finger': [58, 96, 60], 'ring-finger': [66, 98, 58], 'pinky-finger': [74, 96, 52], 'thumb': [18, 28, 32],   // thumb tucked toward the palm (keeps the screen visible)
};
let PIP_H = RF;                       // height of the PIP joint centre above the glass (calibrated from the model)
const vRoot = (lift = 0) => ROOT.clone().addScaledVector(UP, PIP_H + lift);   // real PIP centre = point-symmetry centre

// vertex groups (dominant bone family) for collision checks
let VGROUPS = null, SKIN = null;
function buildVertexGroups(model) {
  model.traverse((o) => { if (o.isSkinnedMesh) SKIN = o; });
  const names = SKIN.skeleton.bones.map((b) => b.name);
  const si = SKIN.geometry.attributes.skinIndex, sw = SKIN.geometry.attributes.skinWeight;
  const fam = (n) => (n.startsWith('thumb') ? 'thumb' : n === 'index-finger-phalanx-intermediate' ? 'idxMid'
    : n.startsWith('index') && n !== 'index-finger-metacarpal' ? 'idx' : n.startsWith('middle') && !n.endsWith('metacarpal') ? 'middle-finger'
    : n.startsWith('ring') && !n.endsWith('metacarpal') ? 'ring-finger' : n.startsWith('pinky') && !n.endsWith('metacarpal') ? 'pinky-finger' : 'palm');
  VGROUPS = { thumb: [], idxMid: [], idx: [], 'middle-finger': [], 'ring-finger': [], 'pinky-finger': [], palm: [] };
  for (let v = 0; v < si.count; v++) {
    const acc = {};
    for (let k = 0; k < 4; k++) { const w = sw.getComponent(v, k); if (w > 0) { const f = fam(names[si.getComponent(v, k)]); acc[f] = (acc[f] || 0) + w; } }
    let best = 'palm', bw = -1; for (const [f, w] of Object.entries(acc)) if (w > bw) { best = f; bw = w; }
    if (best === "idxMid" || v % 2 === 0) VGROUPS[best].push(v);   // subsample (except the contact segment) for speed
  }
}
const _sv = V();
// lowest point (device frame y) of a vertex group over the tablet / stand footprint
function groupMinY(group) {
  let mn = Infinity;
  for (const v of VGROUPS[group]) {
    SKIN.getVertexPosition(v, _sv); SKIN.localToWorld(_sv);
    if (Math.abs(_sv.x) < PAD.w / 2 + 0.012 && _sv.z > -PAD.l / 2 - 0.012 && _sv.z < PAD.l / 2 + 0.014) mn = Math.min(mn, _sv.y);
  }
  return mn;
}
function calibratePipHeight() {
  PIP_H = RF; handHolder.position.set(0, 0, 0);
  applyHandPose(68 * DEG, 10 * DEG, 0, { phi: PHI, curl: CURL0 });
  hand.model.updateMatrixWorld(true);
  const pipY = hand.bones['index-finger-phalanx-intermediate'].getWorldPosition(V()).y;
  const minY = groupMinY('idxMid');
  PIP_H = pipY - minY + 0.0002;        // the back of the middle phalanx just touches the glass
}

// Solve the free parameters of the hand (palm pitch, curl of the other fingers, thumb) so that nothing but the back of
// the index middle phalanx goes below the glass. The index finger itself is never changed. Cached per pose.
const CLEAR = 0.0012, poseCache = new Map();
function solveHand(thp, thd, lift) {
  const key = `${Math.round(thp / DEG * 2)}|${Math.round(thd / DEG / 3)}|${Math.round(lift * 400)}`;
  if (poseCache.has(key)) return poseCache.get(key);
  const pen = (g) => Math.max(0, CLEAR - groupMinY(g));
  const tryPose = (cfg) => { applyHandPose(thp, thd, lift, cfg); hand.model.updateMatrixWorld(true); };
  let best = { phi: PHI, curl: { ...CURL0 } };
  if (lift < 0.03) {
    const fingers = ['middle-finger', 'ring-finger', 'pinky-finger'];
    const total = () => pen('palm') * 4 + pen('thumb') + fingers.reduce((acc, f) => acc + pen(f), 0);
    let bestTotal = Infinity;
    // palm pitch (outer) x per-finger curl and thumb (inner); stop at the first collision-free configuration
    for (const ph of [48, 40, 56, 32, 64, 72, 24, 80].map((x) => x * DEG)) {
      const cfg = { phi: ph, curl: { ...CURL0 } };
      for (const f of fingers) {
        let bc = Infinity, bs = 1;
        for (const sc of [1, 1.15, 0.85, 1.3, 0.7, 1.45, 0.55, 1.6, 0.4, 1.8]) {
          cfg.curl[f] = CURL0[f].map((x) => x * sc); tryPose(cfg);
          const c = pen(f); if (c < bc - 1e-6) { bc = c; bs = sc; } if (c < 1e-5) break;
        }
        cfg.curl[f] = CURL0[f].map((x) => x * bs);
      }
      let bc = Infinity, bt = CURL0.thumb;
      for (const t of [CURL0.thumb, [8, 18, 28], [28, 36, 36], [-10, 0, 20], [-28, -12, 12], [-45, -20, 10]]) {
        cfg.curl.thumb = t; tryPose(cfg); const c = pen('thumb'); if (c < bc - 1e-6) { bc = c; bt = t; } if (c < 1e-5) break;
      }
      cfg.curl.thumb = bt; tryPose(cfg);
      const tot = total() + Math.abs(ph - PHI) * 1e-5;
      if (tot < bestTotal) { bestTotal = tot; best = cfg; }
      if (tot < 1e-4) break;
    }
  }
  if (poseCache.size > 4000) poseCache.clear();
  poseCache.set(key, best);
  return best;
}
function poseHand(thp, thd, lift) {
  if (!hand) return;
  const cfg = solveHand(thp, thd, lift);
  applyHandPose(thp, thd, lift, cfg);
  hand.model.updateMatrixWorld(true);
}
function applyHandPose(thp, thd, lift, cfg) {
  const { bones, armature, restP, restQ, Lp, Lm, Ld, M0 } = hand;
  const PH = cfg.phi, CURL = cfg.curl;
  const fr = fingerFrame(thp, thd);
  // index joint targets (device frame)
  const pip = vRoot(lift);
  const dip = pip.clone().addScaledVector(H, Lm);
  const realDistal = H.clone().multiplyScalar(Math.cos(thd)).addScaledVector(UP, Math.sin(thd));
  const tip = dip.clone().addScaledVector(realDistal, Ld);
  const mcp = pip.clone().addScaledVector(fr.proxUp, Lp);
  // hand frame: a = MCP->PIP, n = palmar side of the index
  const a = fr.u, n = fr.n;
  const f = a.clone().multiplyScalar(Math.cos(PH)).addScaledVector(n, -Math.sin(PH));
  const p = n.clone().multiplyScalar(Math.cos(PH)).addScaledVector(a, Math.sin(PH));
  const l = f.clone().cross(p).normalize();
  armature.updateWorldMatrix(true, false);
  const toLocal = armature.matrixWorld.clone().invert();
  const armQi = armature.getWorldQuaternion(new THREE.Quaternion()).invert();
  const lv = (w) => w.clone().applyMatrix4(toLocal);
  const ld = (w) => w.clone().applyQuaternion(armQi).normalize();
  const Rhand = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(ld(l), ld(f), ld(p)).multiply(M0.clone().transpose()));
  const lL = ld(l);
  const mcpL = lv(mcp), restMcp = restP['index-finger-phalanx-proximal'];
  const rigid = (nm) => restP[nm].clone().sub(restMcp).applyQuaternion(Rhand).add(mcpL);
  const setJ = (nm, pos, q) => { bones[nm].position.copy(pos); bones[nm].quaternion.copy(q); };
  setJ('wrist', rigid('wrist'), Rhand.clone().multiply(restQ.wrist));
  for (const fname of FINGERS) {
    const chain = chainOf(fname);
    const rigidCount = fname === 'thumb' ? 1 : 2;
    const pos = chain.map((nm, i) => (i < rigidCount ? rigid(nm) : null));
    for (let i = 0; i < rigidCount; i++) setJ(chain[i], pos[i], Rhand.clone().multiply(restQ[chain[i]]));
    let cum = 0;
    for (let i = rigidCount - 1; i < chain.length - 1; i++) {
      const a0 = restP[chain[i]], b0 = restP[chain[i + 1]], len = a0.distanceTo(b0);
      const d0 = b0.clone().sub(a0).normalize().applyQuaternion(Rhand);
      let dNew;
      if (fname === 'index-finger') dNew = lv([null, pip, dip, tip][i]).sub(pos[i]).normalize();
      else { cum += (CURL[fname][i - (rigidCount - 1)] || 0) * DEG; dNew = d0.clone().applyAxisAngle(lL, cum); }
      pos[i + 1] = pos[i].clone().addScaledVector(dNew, len);
      const qSeg = new THREE.Quaternion().setFromUnitVectors(d0, dNew).multiply(Rhand);
      setJ(chain[i], pos[i], qSeg.clone().multiply(restQ[chain[i]]));
      if (i + 1 === chain.length - 1) setJ(chain[i + 1], pos[i + 1], qSeg.clone().multiply(restQ[chain[i + 1]]));
    }
  }
}

// ---------- ball layout & deformation ----------
let BALL_C = V();
const CONTACT_THP = 68 * DEG, CONTACT_THD = 22 * DEG;
function layoutBall() {
  const { Lm, Ld } = hand;
  const fr = fingerFrame(CONTACT_THP, CONTACT_THD);
  const vDip = vRoot().addScaledVector(fr.u, Lm);
  const pad = vDip.clone().addScaledVector(fr.dDir, Ld * 0.62).addScaledVector(fr.nD, RF);
  BALL_C = pad.addScaledVector(fr.nD, BALL_R);
  ball.position.copy(BALL_C);
  console.log('[stage] ball center', BALL_C.toArray().map((x) => x.toFixed(4)));
}
const _q = V(), _p = V(), _d = V();
function closestOnSeg(a, b, p, out) {
  _d.copy(b).sub(a); const t = THREE.MathUtils.clamp(_p.copy(p).sub(a).dot(_d) / _d.lengthSq(), 0, 1);
  return out.copy(a).addScaledVector(_d, t);
}
const mat = { anchor: null, threadState: 'none', snapT: 0, pen: 0 };
const ballVel = new Float32Array(ballRest.length);
// Ball softness knob 0 (soft) .. 1 (firm): changes the material only (the finger is never altered).
//   ks: surface stretch stiffness, kp: internal pressure, kt: shape memory, c: damping (all per unit mass)
const SOFT = { ks: 260, kp: 220, kt: 220, c: 9 };
let STIFF = 0.3;
function setStiffness(v) {
  STIFF = THREE.MathUtils.clamp(v, 0, 1);
  Object.assign(SOFT, { ks: 120 + 480 * STIFF, kp: 160 + 420 * STIFF, kt: 120 + 700 * STIFF, c: 7 + 16 * STIFF });
}
setStiffness(STIFF);
// Penetration (m) of the virtual finger (middle + distal capsules) into the undeformed ball for angles (thp, thd).
const _pq = V();
function penetrationAt(thp, thd) {
  const fr = fingerFrame(thp, thd);
  const a = vRoot();
  const vDip = vRoot().addScaledVector(fr.u, hand.Lm), vTip = vDip.clone().addScaledVector(fr.dDir, hand.Ld);
  const d1 = closestOnSeg(a, vDip, BALL_C, _pq).distanceTo(BALL_C);
  const d2 = closestOnSeg(vDip, vTip, BALL_C, _pq).distanceTo(BALL_C);
  return Math.max(0, BALL_R + RF - Math.min(d1, d2));
}
const _acc = new Float32Array(BN * 3), _an = new Float32Array(BN * 3);
function deformBall(segs, dt) {
  const x = ballCur, v = ballVel, r0 = ballRest;
  const C = BALL_C;
  let touching = false; const cpt = V(); let nTouch = 0, maxPen = 0;
  if (dt === 0) { x.set(r0); v.fill(0); }
  const steps = Math.max(1, Math.ceil(dt * 1440)), h = dt / Math.max(1, steps);
  const q = V(), pw = V(), d = V();
  const { e, L0 } = BEDGES;
  const bb = new THREE.Box3(); for (const [sa, sb] of segs) { bb.expandByPoint(sa); bb.expandByPoint(sb); } bb.expandByScalar(RF);
  for (let st = 0; st < steps && dt > 0; st++) {
    _acc.fill(0);
    // surface springs (strain based)
    for (let i = 0; i < L0.length; i++) {
      const a = e[2 * i] * 3, b = e[2 * i + 1] * 3;
      const dx = x[b] - x[a], dy = x[b + 1] - x[a + 1], dz = x[b + 2] - x[a + 2], L = Math.hypot(dx, dy, dz) || 1e-9;
      const f = SOFT.ks * (L - L0[i]) / L0[i] / L;
      _acc[a] += f * dx; _acc[a + 1] += f * dy; _acc[a + 2] += f * dz; _acc[b] -= f * dx; _acc[b + 1] -= f * dy; _acc[b + 2] -= f * dz;
    }
    // internal pressure along the area-weighted vertex normals
    _an.fill(0);
    for (let f = 0; f < BIDX.length; f += 3) {
      const ia = BIDX[f] * 3, ib = BIDX[f + 1] * 3, ic = BIDX[f + 2] * 3;
      const ux = x[ib] - x[ia], uy = x[ib + 1] - x[ia + 1], uz = x[ib + 2] - x[ia + 2], wx = x[ic] - x[ia], wy = x[ic + 1] - x[ia + 1], wz = x[ic + 2] - x[ia + 2];
      const nx = (uy * wz - uz * wy) / 6, ny = (uz * wx - ux * wz) / 6, nz = (ux * wy - uy * wx) / 6;   // (area normal)/3
      for (const k of [ia, ib, ic]) { _an[k] += nx; _an[k + 1] += ny; _an[k + 2] += nz; }
    }
    const P = SOFT.kp * (BALL_V0 / meshVolume(x) - 1) / BALL_A0;
    for (let i = 0; i < BN * 3; i++) {
      const a = _acc[i] + P * _an[i] + SOFT.kt * (r0[i] - x[i]) - SOFT.c * v[i];
      v[i] += a * h; x[i] += v[i] * h;
    }
    // finger contact: the finger is rigid, the surface is pushed out of it (no velocity into the finger)
    if (segs.length) for (let i = 0; i < BN; i++) {
      pw.set(x[3 * i] + C.x, x[3 * i + 1] + C.y, x[3 * i + 2] + C.z);
      if (pw.x < bb.min.x || pw.x > bb.max.x || pw.y < bb.min.y || pw.y > bb.max.y || pw.z < bb.min.z || pw.z > bb.max.z) continue;
      for (const [sa, sb] of segs) {
        closestOnSeg(sa, sb, pw, q); d.copy(pw).sub(q); const dist = d.length();
        if (dist < RF) {
          const n = dist > 1e-7 ? d.divideScalar(dist) : d.set(0, 1, 0);
          if (RF - dist > maxPen) maxPen = RF - dist;
          pw.copy(q).addScaledVector(n, RF);
          const vn = v[3 * i] * n.x + v[3 * i + 1] * n.y + v[3 * i + 2] * n.z;
          if (vn < 0) { v[3 * i] -= vn * n.x; v[3 * i + 1] -= vn * n.y; v[3 * i + 2] -= vn * n.z; }
          v[3 * i] *= 0.9; v[3 * i + 1] *= 0.9; v[3 * i + 2] *= 0.9;                 // a little friction on the pad
          x[3 * i] = pw.x - C.x; x[3 * i + 1] = pw.y - C.y; x[3 * i + 2] = pw.z - C.z;
          if (st === steps - 1) { touching = true; nTouch++; cpt.add(pw); }
        }
      }
    }
  }
  if (nTouch) cpt.divideScalar(nTouch);
  const pos = ballGeo.attributes.position.array;
  pos.set(x);
  ballGeo.attributes.position.needsUpdate = true;
  ballGeo.computeVertexNormals();
  return { touching, pen: maxPen, point: touching ? cpt : null };
}

// ---------- timeline ----------
// keys: [time, value]; eased (cosine) between keys
// Range of motion used for the animation (deg). Replace with values measured in this posture.
// PIP: interior angle between proximal and middle phalanx (180 = straight). DIP: flexion (0 = straight along the glass).
const ROM = { pip: [45, 115], dip: [0, 90] };
const K = {
  lift: [[0, 0.08], [2.6, 0], [33.2, 0], [34.8, 0.07], [36, 0.07]],
  // 3.4–9.4: full range of PIP and DIP with no object (pure mapping). Ball 9.4–26.8, thread 27–33.
  thp: [[0, 68], [3.4, 68], [4.8, ROM.pip[0]], [6.6, ROM.pip[1]], [8.2, 68], [13.2, 68], [14.2, 73], [15.0, 73], [16.0, 68],
        [20.0, 62], [22.6, 78], [24.8, 62], [26.4, 68], [36, 68]],
  thd: [[0, 5], [6.6, 5], [7.6, ROM.dip[1]], [8.6, ROM.dip[0]], [10.4, 5], [11.4, 55], [12.0, 55], [12.8, 5], [13.4, 5], [14.4, 42], [15.0, 42], [16.0, 5],
        [16.6, 5], [17.6, 55], [18.2, 55], [19.6, 0], [20.0, 50], [22.6, 22], [24.8, 50], [26.4, 20], [26.8, 5],
        [28.4, 5], [29.8, 58], [30.4, 58], [31.4, 5], [36, 5]],
  ball: [[0, 0], [9.2, 0], [10.0, 1], [26.6, 1], [27.2, 0], [36, 0]],
  string: [[0, 0], [27.2, 0], [27.9, 1], [36, 1]],
};
const SCENE_AT = (t) => (t < 16.4 ? 'press' : t < 19.9 ? 'release' : t < 26.8 ? 'stroke' : 'cut');
const DURATION = 36;
function sample(keys, t) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) { const [t0, v0] = keys[i - 1], [t1, v1] = keys[i]; const s = (t - t0) / (t1 - t0); return v0 + (v1 - v0) * (0.5 - 0.5 * Math.cos(Math.PI * s)); }
  }
  return keys[keys.length - 1][1];
}

// ---------- camera presets ----------
// All orbits are defined in the env (gravity) frame around a target: az from the visitor (+z), el above horizontal.
const SIDE_DIR = H.clone().cross(UP).normalize();  // perpendicular to the finger plane
function orbitPos(target, az, el, d) {
  const dirEnv = V(Math.cos(el * DEG) * Math.sin(az * DEG), Math.sin(el * DEG), Math.cos(el * DEG) * Math.cos(az * DEG));
  return target.clone().addScaledVector(envToDev(dirEnv), d);
}
const FOCUS = () => vRoot().add(V(0, -0.02, -0.012));
const CAMS = {
  pov: { pos: EYE.clone(), target: ROOT.clone().add(V(-0.012, -0.02, -0.012)), fov: 30 },
  side: { pos: orbitPos(ROOT.clone().add(V(0, -0.02, 0)), -90, 8, 0.32), target: ROOT.clone().add(V(0, -0.02, 0)), fov: 32 },
  orbit: { pos: orbitPos(ROOT, 35, 25, 0.36), target: ROOT.clone().add(V(0, -0.012, 0)), fov: 35 },
};
let camAnim = null, camMode = 'auto';
// "おまかせ" camera: [t0, t1, view, (u) => {orbit:[az,el,dist]} (env frame, around FOCUS) | {pov:fov}]
const SHOTS = [
  [0, 3.4, 'experience', (u) => ({ orbit: [30 - 20 * u, 26, 0.40] })],
  [3.4, 9.4, 'structure', (u) => ({ orbit: [-90 + 8 * u, 8, 0.30] })],
  [9.4, 13.2, 'experience', () => ({ pov: 15 })],
  [13.2, 16.4, 'experience', (u) => ({ orbit: [-48 + 6 * u, 40, 0.24] })],
  [16.4, 19.9, 'experience', (u) => ({ orbit: [-42 + 4 * u, 38, 0.23] })],
  [19.9, 26.8, 'experience', () => ({ pov: 15 })],
  [26.8, 31.8, 'experience', (u) => ({ orbit: [-46 + 6 * u, 40, 0.24] })],
  [31.8, 36.01, 'structure', (u) => ({ orbit: [-40 + 220 * u, 20, 0.34] })],
];
const portraitScale = () => { const a = camera.aspect; return a < 1 ? Math.min(1.9, Math.pow(1.3 / a, 0.75)) : 1; };
function shotAt(t) {
  const i = Math.max(0, SHOTS.findIndex((s) => t >= s[0] && t < s[1]));
  const sh = SHOTS[i], u = Math.min(1, (t - sh[0]) / (sh[1] - sh[0])), e = 0.5 - 0.5 * Math.cos(Math.PI * u);
  const c = sh[3](e);
  let pos, target, fov;
  if (c.orbit) { target = FOCUS(); pos = orbitPos(target, c.orbit[0], c.orbit[1], c.orbit[2] * portraitScale()); fov = 32; }
  else { target = CAMS.pov.target.clone(); pos = target.clone().lerp(EYE, portraitScale()); fov = c.pov; }
  return { i, view: sh[2], pos, target, fov };
}
let autoShot = -1, autoBlend = null;
function applyAutoCam(t, dt, cut = false) {
  const sp = shotAt(t);
  if (sp.i !== autoShot) {
    if (!cut && autoShot !== -1) autoBlend = { k: 0, p: camera.position.clone(), t: controls.target.clone(), f: camera.fov };
    autoShot = sp.i;
    if (!viewOverride) setView(sp.view, true);
  }
  let { pos, target, fov } = sp;
  if (autoBlend && !cut) {
    autoBlend.k = Math.min(1, autoBlend.k + dt / 1.2); const e = 0.5 - 0.5 * Math.cos(Math.PI * autoBlend.k);
    pos = autoBlend.p.clone().lerp(pos, e); target = autoBlend.t.clone().lerp(target, e); fov = THREE.MathUtils.lerp(autoBlend.f, fov, e);
    if (autoBlend.k >= 1) autoBlend = null;
  }
  camera.position.copy(pos); controls.target.copy(target);
  if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); }
  camera.lookAt(target);
}
function setCam(name, instant = false) {
  camMode = name; controls.autoRotate = name === 'orbit'; controls.autoRotateSpeed = 1.2;
  document.querySelectorAll('#cams button').forEach((x) => x.classList.toggle('on', x.dataset.cam === name));
  if (name === 'auto') { autoShot = -1; viewOverride = null; return; }
  if (name === 'free') return;
  const c = CAMS[name];
  if (instant) { camera.position.copy(c.pos); controls.target.copy(c.target); camera.fov = c.fov; camera.updateProjectionMatrix(); return; }
  camAnim = { t: 0, fromP: camera.position.clone(), fromT: controls.target.clone(), fromF: camera.fov, c };
}


// ---------- view mode ----------
// The tablet is an ordinary display: everything virtual exists ONLY inside the one flat screen image.
// 'experience' = as seen; 'structure' = "see-through hand": the real hand turns translucent so the screen image under it
// is visible, and the eye the image is made for is marked. Virtual objects are never placed in the 3D room.
let view = 'experience', ghostK = 0, ghostTarget = 0;
function setView(v, fromAuto = false, instant = false) {
  view = v; if (!fromAuto && camMode === 'auto') viewOverride = v;
  ghostTarget = v === 'structure' ? 1 : 0; if (instant || CAPTURE) ghostK = ghostTarget;
  document.querySelectorAll('#views button').forEach((x) => x.classList.toggle('on', x.dataset.view === v));
  applyGhost();
}
function applyGhost() {
  const g = ghostK, ghost = g > 0.01, lerp = THREE.MathUtils.lerp;
  camera.layers.set(0); if (ghost) camera.layers.enable(L_VIRTUAL);   // structure view: the virtual space behind the glass
  woodMat.opacity = lerp(1, 0.18, g); woodMat.depthWrite = !ghost;
  standMat.opacity = lerp(1, 0.2, g); standMat.depthWrite = !ghost;
  bodyMat.opacity = lerp(1, 0.25, g); bodyMat.depthWrite = !ghost;
  bezelMat.opacity = lerp(1, 0.15, g); bezelMat.depthWrite = !ghost;
  screenMat.opacity = 1 - g;
  shadowCatch.material.opacity = lerp(0.35, 0.07, g);
  eyeDot.visible = sightLines.visible = ghost; eyeDot.material.opacity = g; sightLines.material.opacity = 0.5 * g;
  vFloor.visible = false; vBox.visible = ghost; vBox.material.opacity = 0.55 * g;
  for (const m of [vMidMat, vDistMat]) { m.opacity = lerp(1, 0.62, g); m.emissiveIntensity = lerp(0.05, 0.35, g); }
}
let viewOverride = null;
setView('experience', true, true);
addEventListener('keydown', (e) => { if (e.code === 'Space' && !(e.target instanceof HTMLInputElement)) { e.preventDefault(); setView(view === 'structure' ? 'experience' : 'structure'); } });

// ---------- face tracking (optional, the visitor's own webcam) ----------
const face = { on: false, lm: null, video: null, base: null, off: V(), lastT: -1 };
async function startFace() {
  const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3';
  const { FilesetResolver, FaceLandmarker } = await import(`${MP}/vision_bundle.mjs`);
  const fs = await FilesetResolver.forVisionTasks(`${MP}/wasm`);
  face.lm = await FaceLandmarker.createFromOptions(fs, { baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task', delegate: 'GPU' }, runningMode: 'VIDEO', numFaces: 1 });
  const v = document.getElementById('faceVideo');
  v.srcObject = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' }, audio: false });
  await v.play(); face.video = v; face.base = null; face.on = true;
}
function stopFace() {
  face.on = false; if (face.video?.srcObject) { face.video.srcObject.getTracks().forEach((t) => t.stop()); face.video.srcObject = null; }
}
const ENV_RIGHT = envToDev(V(1, 0, 0)), EYE_FWD = EYE.clone().sub(V(0, 0, 0)).normalize();
function updateFace() {
  if (!face.on || !face.video || face.video.readyState < 2 || face.video.currentTime === face.lastT) return;
  face.lastT = face.video.currentTime;
  const r = face.lm.detectForVideo(face.video, performance.now());
  const L = r.faceLandmarks?.[0]; if (!L) return;
  const a = L[33], b = L[263];                                   // outer eye corners
  const x = (a.x + b.x) / 2, y = (a.y + b.y) / 2, ipd = Math.hypot(a.x - b.x, a.y - b.y);
  if (!face.base) face.base = { x, y, ipd };
  // the webcam is not mirrored: moving to your right moves the face left in the image
  const tgt = V().addScaledVector(ENV_RIGHT, (face.base.x - x) * 0.6).addScaledVector(ENV_UP, (face.base.y - y) * 0.45)
    .addScaledVector(EYE_FWD, (face.base.ipd / ipd - 1) * 0.35);
  face.off.lerp(tgt, 0.35);
}

// ---------- UI ----------
let playing = !CAPTURE, time = 0, manual = false, ready = false;
const $ = (id) => document.getElementById(id);
$('play').onclick = () => { playing = !playing; $('play').textContent = playing ? '❚❚' : '▶'; };
let pendingSeek = null;
$('scrub').oninput = (e) => { pendingSeek = e.target.value / 1000 * DURATION; playing = false; $('play').textContent = '▶'; };
for (const b of document.querySelectorAll('#views button')) b.onclick = () => setView(b.dataset.view);
for (const b of document.querySelectorAll('#cams button')) b.onclick = () => setCam(b.dataset.cam);
controls.addEventListener('start', () => { if (camMode !== 'orbit' && camMode !== 'free') { camAnim = null; setCam('free'); } });
function setManual(on) { manual = on; $('manual').classList.toggle('manual', on); $('autoBtn').hidden = !on; }
for (const id of ['tp', 'td']) $(id).addEventListener('input', () => { if (!manual) setManual(true); });
$('stiff').addEventListener('input', (e) => { setStiffness(e.target.value / 100); $('stv').textContent = stiffLabel(); });
const stiffLabel = () => (STIFF < 0.25 ? 'とてもやわらかい' : STIFF < 0.6 ? 'やわらかめ' : STIFF < 0.85 ? 'かため' : 'かたい');
$('stv').textContent = stiffLabel();
for (const b of document.querySelectorAll('#objs button')) b.onclick = () => { manualObj = b.dataset.obj; resetString(); document.querySelectorAll('#objs button').forEach((x) => x.classList.toggle('on', x === b)); if (!manual) setManual(true); };
$('autoBtn').onclick = () => { setManual(false); playing = true; $('play').textContent = '❚❚'; };
let manualObj = 'ball';
function resetMaterial() { mat.anchor = null; mat.threadState = 'none'; resetString(); }

// Seek: rebuild the material state by simulating from the start of the scene that contains t.
const SCENE_STARTS = [0, 9.2, 27.2];
function seekTo(t) {
  resetMaterial(); ballCur.set(ballRest); ballVel.fill(0);
  const st = Math.max(...SCENE_STARTS.filter((x) => x <= t));
  const start = st === 0 ? Math.max(0, t - 1.5) : (t - st > 8 ? t - 8 : st);
  for (let s2 = start; s2 < t; s2 += 1 / 60) { time = s2; frame(1 / 60); }
  time = t;
}

// ---------- frame ----------
let last = performance.now();
let wasTouching = false;
function frame(dt) {
  if (!ready) return;
  let thp, thd, lift, mode;
  if (window.__pose) { [thp, thd] = window.__pose.map((x) => x * DEG); lift = 0; mode = 'press'; }
  else if (manual) { thp = +$('tp').value * DEG; thd = +$('td').value * DEG; lift = 0; mode = 'release'; }
  else { thp = sample(K.thp, time) * DEG; thd = sample(K.thd, time) * DEG; lift = sample(K.lift, time); mode = SCENE_AT(time); }
  { const h = document.getElementById('hud'); if (h) { h.querySelector('[data-k=pip] b').textContent = (thp / DEG).toFixed(0) + '°'; h.querySelector('[data-k=dip] b').textContent = (thd / DEG).toFixed(0) + '°';
    h.querySelector('[data-k=pip] i').style.width = ((thp / DEG - 30) / 150 * 100).toFixed(1) + '%'; h.querySelector('[data-k=dip] i').style.width = (thd / DEG / 90 * 100).toFixed(1) + '%'; } }
  if (!manual && !CAPTURE) { $('tp').value = (thp / DEG).toFixed(1); $('td').value = (thd / DEG).toFixed(1); }
  $('tpv').textContent = (thp / DEG).toFixed(0) + '°'; $('tdv').textContent = (thd / DEG).toFixed(0) + '°';
  poseHand(thp, thd, lift);
  const contact = lift < 0.0008;
  const appear = THREE.MathUtils.clamp(1 - lift / 0.0008, 0, 1);
  // virtual finger
  // Base mapping: virtual middle = point reflection of the real proximal phalanx through PIP (always collinear),
  // virtual distal = real DIP flexion 1:1. (Pseudo-haptic / exaggeration layers can later replace these two lines.)
  const thpV = thp, thdV = thd;
  const fr = fingerFrame(thpV, thdV);
  const vR = vRoot();                                           // real PIP centre (point-symmetry centre)
  const vDip = vR.clone().addScaledVector(fr.u, hand.Lm);
  const vTip = vDip.clone().addScaledVector(fr.dDir, hand.Ld);
  placeCapsule(vMid, vR, vDip); placeCapsule(vDist, vDip, vTip);   // drawn only below the glass (clipping plane)
  { const pipW = vRoot(lift), mcpW = pipW.clone().addScaledVector(fr.proxUp, hand.Lp);
    const g = guide.geometry.attributes.position; g.setXYZ(0, mcpW.x, mcpW.y, mcpW.z); g.setXYZ(1, pipW.x, pipW.y, pipW.z); g.setXYZ(2, vDip.x, vDip.y, vDip.z);
    g.needsUpdate = true; guide.computeLineDistances();
    guide.visible = pivotDot.visible = ghostK > 0.5 && contact; pivotDot.position.copy(pipW); }
  vMid.visible = vDist.visible = contact;
  ring.material.opacity += ((contact ? 0.55 : 0) - ring.material.opacity) * Math.min(1, dt * 6);
  const s = 1 + (1 - appear) * 0.4; ring.scale.setScalar(s);
  // material
  const ballK = manual || window.__pose ? (manualObj === 'ball' ? 1 : 0) : sample(K.ball, time);
  const strK = manual || window.__pose ? (manualObj === 'string' ? 1 : 0) : sample(K.string, time);
  ball.visible = ballK > 0.01; ball.scale.setScalar(Math.max(0.001, ballK * (1 + 0.12 * Math.sin(Math.PI * ballK))));
  const segs = contact && ballK > 0.99 ? [[vDip, vTip], [vR, vDip]] : [];
  const res = deformBall(segs, dt);
  const fSegs = contact ? [[vDip, vTip], [vR, vDip]] : [];
  if (!manual && strK < 0.01) resetString();
  if (manual && str.cut && str.cutT > 2.5) {                  // manual mode: re-tie the thread once the finger is away
    let near = false; for (let k = 1; k < 40 && !near; k++) { const pt = tautPoint(k / 40, 1); for (const [a, b] of fSegs) if (closestOnSeg(a, b, pt, _pq).distanceTo(pt) < RF * 2) near = true; }
    if (!near) resetString();
  }
  updateString(dt, strK, fSegs);
  // thread (release scene)
  const padNow = vDip.clone().addScaledVector(fr.dDir, hand.Ld * 0.62).addScaledVector(fr.nD, RF);
  if (res.touching) { mat.anchor = res.point.clone(); mat.threadState = 'stuck'; }
  else if (mat.threadState === 'stuck') {
    const len = mat.anchor ? mat.anchor.distanceTo(padNow) : 1;
    if (mode !== 'release' || !mat.anchor) mat.threadState = 'none';
    else if (len > 0.016) { mat.threadState = 'snap'; mat.snapT = 0; }
  }
  thread.visible = false;
  if (mat.threadState === 'stuck' && !res.touching && mat.anchor) {
    const a = mat.anchor, b = padNow, len = a.distanceTo(b);
    const r = 0.0016 * (1 - 0.65 * len / 0.016);
    thread.visible = contact; thread.position.copy(a).add(b).multiplyScalar(0.5);
    thread.quaternion.setFromUnitVectors(UP, b.clone().sub(a).normalize());
    thread.scale.set(r, len, r);
  } else if (mat.threadState === 'snap') {
    mat.snapT += dt; if (mat.snapT > 0.25) mat.threadState = 'none';
  }
  wasTouching = res.touching;
}

function renderScreen(rt, eye) { updateScreenCamera(eye); renderer.setRenderTarget(rt); renderer.render(scene, screenCam); }
function render() {
  camera.updateMatrixWorld(true);
  // the screen image: rendered once for the fixed visitor eye, independent of the 3D camera
  scene.background = VBG; scene.fog = null; scene.environmentIntensity = 0.12;
  if (screenMode === 'track') { const e = camera.getWorldPosition(V()); if (e.y > 0) { if (e.y < 0.05) e.y = 0.05; curEye.copy(e); } }
  else curEye.copy(EYE);
  updateSight(curEye); frontLed.material.opacity = screenMode === 'track' ? 0.9 : 0;
  if (panelOn || ghostK < 0.99) renderScreen(screen2D, curEye);
  renderer.setRenderTarget(null);
  scene.background = GALLERY; scene.fog = new THREE.Fog(GALLERY, 2.2, 6); scene.environmentIntensity = 0.55;
  renderer.render(scene, camera);
  if (panelOn) {
    const r = panelRect(), y = innerHeight - r.y - r.h;
    renderer.setScissorTest(true); renderer.setViewport(r.x, y, r.w, r.h); renderer.setScissor(r.x, y, r.w, r.h);
    renderer.render(quadScene, quadCam);
    renderer.setScissorTest(false); renderer.setViewport(0, 0, innerWidth, innerHeight);
  }
}

function tick(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (playing && !manual) { time = (time + dt) % DURATION; if (time < dt) resetMaterial(); $('scrub').value = time / DURATION * 1000; }
  $('time').textContent = time.toFixed(1);
  if (camAnim) {
    camAnim.t = Math.min(1, camAnim.t + dt / 1.1); const e = 0.5 - 0.5 * Math.cos(Math.PI * camAnim.t);
    camera.position.lerpVectors(camAnim.fromP, camAnim.c.pos, e); controls.target.lerpVectors(camAnim.fromT, camAnim.c.target, e);
    camera.fov = THREE.MathUtils.lerp(camAnim.fromF, camAnim.c.fov, e); camera.updateProjectionMatrix();
    if (camAnim.t >= 1) camAnim = null;
  }
  if (ghostK !== ghostTarget) { ghostK = THREE.MathUtils.clamp(ghostK + Math.sign(ghostTarget - ghostK) * dt / 0.5, 0, 1); applyGhost(); }
  if (pendingSeek !== null) { seekTo(pendingSeek); pendingSeek = null; }
  updateFace();
  if (face.on) { camera.position.copy(EYE).add(face.off); controls.target.copy(CAMS.pov.target); camera.fov = 30; camera.updateProjectionMatrix(); camera.lookAt(controls.target); }
  else if (camMode === 'auto') applyAutoCam(time, dt); else controls.update();
  frame(dt);
  render();
  if (!CAPTURE) requestAnimationFrame(tick);
}
if (!CAPTURE) requestAnimationFrame(tick);

addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); layoutPanel(); });
$('panel2d').onclick = () => { panelBig = !panelBig; layoutPanel(); };
function setScreenMode(m) {
  screenMode = m; document.querySelectorAll('#smode button').forEach((x) => x.classList.toggle('on', x.dataset.mode === m));
  $('faceBtn').hidden = m !== 'track'; if (m !== 'track' && face.on) { stopFace(); $('faceBtn').classList.remove('on'); }
}
for (const b of document.querySelectorAll('#smode button')) b.onclick = () => setScreenMode(b.dataset.mode);
$('faceBtn').onclick = async () => {
  if (face.on) { stopFace(); $('faceBtn').classList.remove('on'); $('faceVideo').hidden = true; setCam('auto'); return; }
  $('faceBtn').textContent = '準備中…';
  try { await startFace(); $('faceBtn').classList.add('on'); $('faceVideo').hidden = false; camMode = 'face'; document.querySelectorAll('#cams button').forEach((x) => x.classList.remove('on')); }
  catch (err) { console.warn('[stage] face tracking failed', err); alertBox('カメラを開けませんでした（' + (err.message || err) + '）'); }
  $('faceBtn').textContent = '自分の顔で試す';
};
function alertBox(msg) { const el = $('faceMsg'); el.textContent = msg; el.hidden = false; setTimeout(() => { el.hidden = true; }, 4000); }
setScreenMode('fixed');
$('panelBtn').onclick = () => { panelOn = !panelOn; panelBig = false; $('panelBtn').classList.toggle('on', panelOn); layoutPanel(); };
$('panelBtn').classList.toggle('on', panelOn);
layoutPanel();

// deterministic hooks for video capture / screenshots
window.stage = {
  get ready() { return ready; },
  setHeadTrack() {},   // kept for old scripts; the display no longer follows the viewer
  setStiffness,
  setScreenMode: (m) => setScreenMode(m), setHud(on) { document.getElementById('hud').style.display = on ? '' : 'none'; },
  setPanel(on, big = false) { panelOn = on; panelBig = big; layoutPanel(); },
  // read-only handles for automated testing
  dbg: () => ({ vRoot, PIP_H, groupMinY, VGROUPS, THREE, scene, camera, hand, device, envG, ball, vMid, vDist, ROOT, H, UP, RF, BALL_R, BALL_C, EYE, TILT, ENV_UP, PAD, SCREEN, fingerFrame, K, sample, DEG, strA, strB, str }),
  penScan() { const out = []; for (let t = 10; t < DURATION; t += 0.1) { const a = sample(K.thp, t) * DEG, b = sample(K.thd, t) * DEG; out.push([+t.toFixed(1), +(penetrationAt(a, b) * 1000).toFixed(1)]); } return JSON.stringify(out.filter((x) => x[1] > 0).reduce((m, x) => (x[1] > m[1] ? x : m), [0, 0])) + ' R=' + BALL_R * 1000; },
  camPose(px, py, pz, tx, ty, tz, fov = 35) { controls.autoRotate = false; camera.position.set(px, py, pz); controls.target.set(tx, ty, tz); camera.fov = fov; camera.updateProjectionMatrix(); camera.lookAt(controls.target); camera.updateMatrixWorld(true); },
  ROOT: ROOT.toArray(), EYE: EYE.toArray(), SIDE: SIDE_DIR.toArray(), DURATION,
  setView: (v) => setView(v, false, true), setCam: (n) => setCam(n, true),
  autoCam(t) { camMode = 'auto'; viewOverride = null; applyAutoCam(t, 0, true); setView(shotAt(t).view, true, true); },
  // render time t (seconds); simulates from t-1.5s at 60 Hz so the jelly/thread state is consistent
  renderAt(t, cam) {
    if (cam && cam.startsWith('o:')) { const [, az, el, d] = cam.split(':').map(Number); this.orbitTo(az * DEG, el * DEG, d); }
    else if (cam) setCam(cam, true);
    seekTo(t); frame(1 / 60); if (!(cam && cam.startsWith('o:'))) controls.update(); render();
  },
  step(t, dt) { time = t; frame(dt); if (camMode !== 'auto') controls.update(); render(); },
  orbitTo(az, el, dist) { // env-frame orbit (radians) around the pivot
    const tg = CAMS.orbit.target; controls.target.copy(tg);
    camera.position.copy(orbitPos(tg, az / DEG, el / DEG, dist));
    camera.lookAt(tg); camera.updateMatrixWorld(true);
  },
  seekTo, poseCacheSize: () => poseCache.size, PIP_H: () => PIP_H,
};
