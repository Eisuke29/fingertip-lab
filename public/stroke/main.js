// Stroke Stage - a fork of public/stage (which stays as it is): the hand only slides, the finger is not bent.
// The virtual finger beyond PIP lags behind, leans and catches on the material inside the screen (pseudo-haptics).
// The base mapping (virtual middle = extension of the real proximal through PIP) is the dashed line; bending is a layer on top.
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
const ROOT0 = V(0.016, 0, -0.012), ROOT = ROOT0.clone(); // ROOT moves with the hand
//                // PIP contact projected on the glass (right half: the right hand comes from the visitor's right)
const H = V(0.28, 0, 1).normalize();             // horizontal direction from PIP toward DIP / the hand: the hand enters from the visitor side (+z)
const RF = 0.0082;                               // finger radius
const PHI = 48 * DEG;                            // index MCP flexion (metacarpal vs proximal)


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
const TILT = 26 * Math.PI / 180;   // the case's angle, measured
const ENV_UP = new THREE.Vector3(0, Math.cos(TILT), -Math.sin(TILT));
camera.up.copy(ENV_UP);
// env (gravity) frame -> device frame
const ENV2DEV = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -TILT);
const envToDev = (v) => v.clone().applyQuaternion(ENV2DEV);
// visitor eye: standing in front of the showcase, ~46 cm in front of and 32 cm above the tablet centre
const EYE = envToDev(new THREE.Vector3(-0.22, 0.38, 0.36));   // head is left of the right hand, looking down past it
const envG = new THREE.Group(); envG.rotation.x = -TILT;
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.copy(ROOT0).add(V(0, -0.01, 0));
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
  if (!panelBig && !mobile && !CAPTURE) h = Math.min(h, Hh - 16 - 424 - 56);      // keep clear of the control card (bottom right)
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
const vKey = new THREE.SpotLight(0xffffff, 0.75, 0, 0.9, 0.6, 1.2);
vKey.position.set(-0.14, 0.20, -0.10); vKey.target.position.set(0.02, -0.06, 0.02);
vKey.castShadow = true; vKey.shadow.mapSize.set(1024, 1024); vKey.shadow.bias = -0.0003;
const vFill = new THREE.HemisphereLight(0xffffff, 0x6a7070, 1.1);
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

const vCap = new THREE.Mesh(new THREE.CircleGeometry(RF, 40), vMidMat); vCap.layers.set(L_VIRTUAL); vCap.visible = false; scene.add(vCap); // closes the finger where the glass cuts it
// ---------- what is drawn instead of the finger (comparison conditions) ----------
const stickMat = new THREE.MeshStandardMaterial({ color: 0xd8dcdf, roughness: 0.5, clippingPlanes: BELOW_GLASS });
const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.0028, 0.0028, 1, 20), stickMat);
const cursorMesh = new THREE.Mesh(new THREE.SphereGeometry(0.0055, 28, 18), new THREE.MeshStandardMaterial({ color: 0xf2f4f5, roughness: 0.4, emissive: 0xffffff, emissiveIntensity: 0.15 }));
for (const m of [stick, cursorMesh]) { m.castShadow = true; m.layers.set(L_VIRTUAL); m.visible = false; scene.add(m); }

// ---------- the material inside the screen ----------
// k: how fast the fingertip follows (1/s), hold: how far it sticks before slipping (m), bump: height of the grains (m),
// drag: how much the surface is pulled along, dent: how deep it gives way (m)
const MATS = {
  smooth: { name: 'つるつる', k: 45, hold: 0, bump: 0, drag: 0, dent: 0.0006, color: 0x9fc4d6, rough: 0.12 },
  rough: { name: 'ざらざら', k: 20, hold: 0.0035, bump: 0.0013, drag: 0, dent: 0.0004, color: 0xc2ae8e, rough: 0.95 },
  catchy: { name: '引っかかる', k: 15, hold: 0.016, bump: 0, drag: 0.35, dent: 0.0018, color: 0x6fa58e, rough: 0.8 },
  sticky: { name: 'ねばねば', k: 3, hold: 0, bump: 0, drag: 0.6, dent: 0.0030, color: 0xb98fc9, rough: 0.25 },
};
const SN = [96, 136], SW = SCREEN.w - 0.002, SL = SCREEN.l - 0.002;
const surfGeo = new THREE.PlaneGeometry(SW, SL, SN[0], SN[1]); surfGeo.rotateX(-Math.PI / 2);
const surfTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 256, 256); g.strokeStyle = 'rgba(0,0,0,.28)'; g.lineWidth = 5; g.strokeRect(0, 0, 256, 256); g.strokeStyle = 'rgba(0,0,0,.10)'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(128, 0); g.lineTo(128, 256); g.moveTo(0, 128); g.lineTo(256, 128); g.stroke();
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(SW / 0.012, SL / 0.012); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; })();
const surfMat = new THREE.MeshStandardMaterial({ map: surfTex, color: 0xffffff, roughness: 0.6, metalness: 0 });
const surf = new THREE.Mesh(surfGeo, surfMat); surf.receiveShadow = true; surf.layers.set(L_VIRTUAL); surf.frustumCulled = false; scene.add(surf);
const surfRest = surfGeo.attributes.position.array.slice();
let surfY = -0.045;
// grains: a fixed bumpy height field (the same for what is drawn and for what the fingertip feels)
const grain = (x, z) => Math.max(0, Math.sin(x * 1450) * Math.sin(z * 1450));
let matKey = 'smooth';
function setMat(k) { if (k === matKey && surfMat.userData.set) return; matKey = k; surfMat.userData.set = true; surfMat.color.set(MATS[k].color); surfMat.roughness = MATS[k].rough; document.querySelectorAll('#mats button').forEach((x) => x.classList.toggle('on', x.dataset.mat === k)); }
function layoutSurface() { // the relaxed fingertip just reaches it
  const fr = fingerFrame(THP0 * DEG, THD);
  surfY = vRoot().addScaledVector(fr.u, hand.Lm).addScaledVector(fr.dDir, hand.Ld).y - RF;
}
function deformSurface(spheres, pullX, pullZ) { // spheres: [Vector3, radius]. The finger never goes into the material: the material gives way
  const p = surfGeo.attributes.position.array, r0 = surfRest, M = MATS[matKey], c = spheres[0]?.[0];
  for (let i = 0; i < p.length; i += 3) {
    let x = r0[i], z = r0[i + 2], y = surfY + (M.bump ? M.bump * grain(x, z) : 0);
    if (c) {
      const dx = x - c.x, dz = z - c.z, d2 = dx * dx + dz * dz;
      if (d2 < 0.0025) {
        const q = Math.exp(-d2 / (2 * 0.011 * 0.011));
        x += pullX * M.drag * q; z += pullZ * M.drag * q; y -= M.dent * q;
        for (const [s, r] of spheres) { const ex = x - s.x, ez = z - s.z, e2 = ex * ex + ez * ez; if (e2 < r * r) y = Math.min(y, s.y - Math.sqrt(r * r - e2) - 0.0001); }
      }
    }
    p[i] = x; p[i + 1] = y; p[i + 2] = z;
  }
  surfGeo.attributes.position.needsUpdate = true; surfGeo.computeVertexNormals();
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

const THP0 = 78, THD = 20 * DEG;   // the real finger keeps this shape: only the hand moves

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
new GLTFLoader().load('../stage/assets/right.glb', (g) => {
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
  layoutSurface();
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
  applyHandPose(THP0 * DEG, THD, 0, { phi: PHI, curl: CURL0 });
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
      for (const t of [CURL0.thumb, [30, 45, 50], [36, 30, 60], [24, 55, 60], [44, 40, 40], [14, 50, 70], [8, 18, 28], [28, 36, 36], [-10, 0, 20], [-28, -12, 12], [-45, -20, 10]]) {
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


// ---------- camera presets ----------
// All orbits are defined in the env (gravity) frame around a target: az from the visitor (+z), el above horizontal.
const SIDE_DIR = H.clone().cross(UP).normalize();  // perpendicular to the finger plane
function orbitPos(target, az, el, d) {
  const dirEnv = V(Math.cos(el * DEG) * Math.sin(az * DEG), Math.sin(el * DEG), Math.cos(el * DEG) * Math.cos(az * DEG));
  return target.clone().addScaledVector(envToDev(dirEnv), d);
}
const FOCUS = () => ROOT0.clone().add(V(0, -0.016, -0.012));
const CAMS = {
  pov: { pos: EYE.clone(), target: ROOT0.clone().add(V(-0.012, -0.02, -0.012)), fov: 30 },
  side: { pos: orbitPos(ROOT0.clone().add(V(0, -0.02, 0)), -90, 8, 0.32), target: ROOT0.clone().add(V(0, -0.02, 0)), fov: 32 },
  orbit: { pos: orbitPos(ROOT0, 35, 25, 0.36), target: ROOT0.clone().add(V(0, -0.012, 0)), fov: 35 },
};
let camAnim = null, camMode = 'auto';
// "おまかせ" camera: [t0, t1, view, (u) => {orbit:[az,el,dist]} (env frame, around FOCUS) | {pov:fov}]
const SHOTS = [
  [0, 4, 'experience', (u) => ({ orbit: [34 - 22 * u, 30, 0.40] })],
  [4, 11, 'experience', () => ({ pov: 17 })],
  [11, 18, 'experience', (u) => ({ orbit: [-40 + 6 * u, 44, 0.27] })],
  [18, 25, 'structure', (u) => ({ orbit: [-8 - 10 * u, 16, 0.30] })],
  [25, 33.01, 'experience', () => ({ pov: 17 })],
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

// ---------- the hand's movement ----------
// [material, t0, t1]; in each part: left-right first, then front-back
const PARTS = [['smooth', 0, 4], ['rough', 4, 11], ['catchy', 11, 18], ['catchy', 18, 25], ['sticky', 25, 33]];
const DURATION = 33;
const RANGE = { x0: -0.034, x1: 0.050, z0: -0.058, z1: 0.012 };
function pathAt(t) {
  const p = PARTS.find((q) => t < q[2]) || PARTS[PARTS.length - 1], u = t - p[1], len = p[2] - p[1], env = THREE.MathUtils.smoothstep(u, 0, 0.6) * (1 - THREE.MathUtils.smoothstep(u, len - 0.5, len));
  const cross = len > 5 ? THREE.MathUtils.smoothstep(u, len * 0.58, len * 0.58 + 0.8) : 0;   // left-right -> front-back
  return { x: ROOT0.x + 0.030 * env * Math.sin(u * 1.9) * (1 - cross), z: ROOT0.z + 0.024 * env * Math.sin(u * 1.9) * cross };
}

// ---------- fingertip: follows, sticks, slips ----------
const TIP = { x: ROOT0.x, z: ROOT0.z, slip: true, lag: V(), bend: 0, speed: 0, bob: 0 };
let kind = 'finger', bendMode = 'whole', gain = 1;
function stepTip(tx, tz, dt) {
  const M = MATS[matKey], dx = tx - TIP.x, dz = tz - TIP.z, d = Math.hypot(dx, dz);
  if (M.hold) { if (d > M.hold) TIP.slip = true; if (d < 0.0015) TIP.slip = false; } else TIP.slip = true;
  const q = TIP.slip ? 1 - Math.exp(-M.k * dt) : 0, mx = dx * q, mz = dz * q;
  TIP.x += mx; TIP.z += mz; TIP.speed = Math.hypot(mx, mz) / Math.max(dt, 1e-3);
  const L = Math.hypot(TIP.x - tx, TIP.z - tz), mxL = 0.030; // never left behind more than this
  if (L > mxL) { TIP.x = tx + (TIP.x - tx) * mxL / L; TIP.z = tz + (TIP.z - tz) * mxL / L; }
  TIP.lag.set(TIP.x - tx, 0, TIP.z - tz);
}

// ---------- UI ----------
let playing = !CAPTURE, time = 0, manual = false, ready = false;
const $ = (id) => document.getElementById(id);
$('mats').innerHTML = Object.entries(MATS).map(([k, m]) => `<button data-mat="${k}">${m.name}</button>`).join('');
$('play').onclick = () => { if (manual) setManual(false); else playing = !playing; $('play').textContent = playing ? '❚❚' : '▶'; };
let pendingSeek = null;
$('scrub').oninput = (e) => { setManual(false); pendingSeek = e.target.value / 1000 * DURATION; playing = false; $('play').textContent = '▶'; };
for (const b of document.querySelectorAll('#views button')) b.onclick = () => setView(b.dataset.view);
for (const b of document.querySelectorAll('#cams button')) b.onclick = () => setCam(b.dataset.cam);
controls.addEventListener('start', () => { if (camMode !== 'orbit' && camMode !== 'free') { camAnim = null; setCam('free'); } });
function setManual(on) { manual = on; $('autoBtn').hidden = !on; if (!on) { playing = true; $('play').textContent = '❚❚'; } }
$('autoBtn').onclick = () => setManual(false);
const pick = (id, key, f) => { for (const b of document.querySelectorAll(`#${id} button`)) b.onclick = () => { document.querySelectorAll(`#${id} button`).forEach((x) => x.classList.toggle('on', x === b)); f(b.dataset[key]); }; };
for (const b of document.querySelectorAll('#mats button')) b.onclick = () => { if (!manual) { aim.x = ROOT.x; aim.z = ROOT.z; setManual(true); playing = false; } setMat(b.dataset.mat); };
pick('kinds', 'kind', (v) => { kind = v; }); pick('bends', 'bend', (v) => { bendMode = v; });
$('gain').oninput = () => { gain = +$('gain').value; $('gv').textContent = `${gain.toFixed(1)} 倍`; }; $('gain').oninput();
$('tp').oninput = () => { $('tpv').textContent = `${$('tp').value}°`; }; $('tp').oninput();
// drag on the tablet screen: the hand slides there (the rest of the picture still turns the camera)
const aim = { x: ROOT0.x, z: ROOT0.z }, ray = new THREE.Raycaster(), glassPlane = new THREE.Plane(UP, 0);
function onGlass(e, ox = 0, oz = 0) {
  ray.setFromCamera(new THREE.Vector2(e.clientX / innerWidth * 2 - 1, 1 - e.clientY / innerHeight * 2), camera);
  const p = ray.ray.intersectPlane(glassPlane, V()); return p && { x: p.x - ox, z: p.z - oz };
}
let dragOff = null;
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || !ready) return; const p = onGlass(e); if (!p || Math.abs(p.x) > PAD.w / 2 || Math.abs(p.z) > PAD.l / 2 + 0.03) return;
  dragOff = { x: p.x - ROOT.x, z: p.z - ROOT.z }; aim.x = ROOT.x; aim.z = ROOT.z; controls.enabled = false; setManual(true); playing = false;
  if (camMode === 'auto') setCam('free'); // the picture must not move while the hand is being moved
  try { renderer.domElement.setPointerCapture(e.pointerId); } catch {}
}, true);
renderer.domElement.addEventListener('pointermove', (e) => { if (!dragOff) return; const p = onGlass(e, dragOff.x, dragOff.z); if (p) { aim.x = THREE.MathUtils.clamp(p.x, RANGE.x0, RANGE.x1); aim.z = THREE.MathUtils.clamp(p.z, RANGE.z0, RANGE.z1); } }, true);
for (const n of ['pointerup', 'pointercancel']) renderer.domElement.addEventListener(n, () => { dragOff = null; controls.enabled = true; }, true);

function seekTo(t) {
  const p0 = pathAt(Math.max(0, t - 2)); TIP.x = tipRest(p0).x; TIP.z = tipRest(p0).z;
  for (let s = Math.max(0, t - 2); s < t; s += 1 / 60) { time = s; frame(1 / 60); }
  time = t;
}
const tipRest = (p) => { const fr = fingerFrame(+$('tp').value * DEG, THD); return hand ? V(p.x, 0, p.z).addScaledVector(fr.u, hand.Lm).addScaledVector(fr.dDir, hand.Ld) : V(p.x, 0, p.z); };

// ---------- frame ----------
let last = performance.now();
const _ax = V();
function frame(dt) {
  if (!ready) return;
  const thp = +$('tp').value * DEG;
  if (manual) { const f = 1 - Math.exp(-16 * dt); ROOT.x += (aim.x - ROOT.x) * f; ROOT.z += (aim.z - ROOT.z) * f; }
  else { const p = pathAt(time); ROOT.x = p.x; ROOT.z = p.z; const part = PARTS.find((q) => time < q[2]) || PARTS[0]; setMat(part[0]); }
  poseHand(thp, THD, 0);
  ring.position.set(ROOT.x, ring.position.y, ROOT.z); ring.material.opacity += (0.55 - ring.material.opacity) * Math.min(1, dt * 6);
  const M = MATS[matKey], rest = tipRest(ROOT);
  stepTip(rest.x, rest.z, dt);
  // the base (no bending): virtual middle = straight extension of the real proximal phalanx
  const base = fingerFrame(thp, THD), vR = vRoot();
  const lx = TIP.lag.dot(SIDE_DIR) * gain, lz = TIP.lag.dot(H) * gain;
  // sideways: leans after the fingertip that stayed behind. Along the finger: the DIP bends (or stretches).
  const whole = bendMode === 'whole', cl = THREE.MathUtils.clamp;
  const b1 = kind === 'finger' ? (whole ? cl(lx * 16, -0.6, 0.6) : 0) : cl(lx * 22, -0.7, 0.7), b2 = kind === 'finger' ? cl(lx * 44, -1.2, 1.2) : b1;
  const p1 = whole ? cl(lz * 9, -0.3, 0.3) : 0, flex = cl(THD + lz * 30, -0.35, 1.25);
  const fr = fingerFrame(thp + p1, kind === 'finger' ? flex : 0);
  const u = fr.u.clone().addScaledVector(SIDE_DIR, Math.tan(b1)).normalize(), d = kind === 'finger' ? fr.dDir.clone().addScaledVector(SIDE_DIR, Math.tan(b2)).normalize() : u.clone();
  // the fingertip stays on the material (it rides up the grains and sinks in by the dent)
  const bumpH = M.bump ? M.bump * grain(TIP.x, TIP.z) : 0; TIP.bob += (bumpH - TIP.bob) * Math.min(1, dt * 40);
  const need = surfY + RF - M.dent + TIP.bob * (0.4 + 0.6 * Math.min(2, gain)) - vR.y, k = cl(need / (u.y * hand.Lm + d.y * hand.Ld), 0.75, 1.35);
  const vDip = vR.clone().addScaledVector(u, hand.Lm * k), vTip = vDip.clone().addScaledVector(d, hand.Ld * k);
  placeCapsule(vMid, vR, vDip); placeCapsule(vDist, vDip, vTip);
  { const c = vR.clone().addScaledVector(u, vR.y / Math.max(0.3, -u.y)); vCap.position.set(c.x, -0.00005, c.z); vCap.rotation.set(-Math.PI / 2, 0, Math.atan2(-u.z, u.x)); vCap.scale.set(Math.min(2, 1 / Math.max(0.3, -u.y)), 1, 1); vCap.visible = kind === 'finger'; }
  vMid.visible = vDist.visible = kind === 'finger'; stick.visible = kind === 'stick'; cursorMesh.visible = kind === 'cursor';
  let spheres;
  if (kind === 'stick') { const e = vTip.clone(); e.y -= RF - 0.0028; _ax.copy(e).sub(vR); stick.scale.y = _ax.length(); stick.position.copy(vR).addScaledVector(_ax, 0.5); stick.quaternion.setFromUnitVectors(UP, _ax.normalize()); spheres = [[e, 0.0028]]; }
  else if (kind === 'cursor') { cursorMesh.position.set(rest.x + TIP.lag.x * gain, vTip.y - RF + 0.0055, rest.z + TIP.lag.z * gain); spheres = [[cursorMesh.position.clone(), 0.0055]]; }
  else { spheres = [[vTip, RF]]; for (let i = 1; i <= 5; i++) spheres.push([vTip.clone().lerp(vDip, i / 5), RF]); }
  deformSurface(spheres, -TIP.lag.x, -TIP.lag.z);
  { const mcpW = vR.clone().addScaledVector(base.proxUp, hand.Lp), e = vR.clone().addScaledVector(base.u, hand.Lm + hand.Ld), g = guide.geometry.attributes.position;
    g.setXYZ(0, mcpW.x, mcpW.y, mcpW.z); g.setXYZ(1, vR.x, vR.y, vR.z); g.setXYZ(2, e.x, e.y, e.z); g.needsUpdate = true; guide.computeLineDistances();
    guide.visible = pivotDot.visible = ghostK > 0.5; pivotDot.position.copy(vR); }
  TIP.bend = d.angleTo(kind === 'finger' ? base.dDir : base.u) / DEG;
  const set = (key, text, w) => { const e = document.querySelector(`#hud [data-k=${key}]`); e.querySelector('b').textContent = text; e.querySelector('i').style.width = `${Math.min(100, w)}%`; };
  set('lag', `${(TIP.lag.length() * 1000).toFixed(0)} mm`, TIP.lag.length() / 0.03 * 100); set('bend', `${(kind === 'cursor' ? 0 : TIP.bend).toFixed(0)}°`, kind === 'cursor' ? 0 : TIP.bend / 80 * 100);
  TIP.out = { vR, vDip, vTip, k, spheres };
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
  if (playing && !manual) { time = (time + dt) % DURATION; $('scrub').value = time / DURATION * 1000; }
  $('time').textContent = time.toFixed(1);
  if (camAnim) {
    camAnim.t = Math.min(1, camAnim.t + dt / 1.1); const e = 0.5 - 0.5 * Math.cos(Math.PI * camAnim.t);
    camera.position.lerpVectors(camAnim.fromP, camAnim.c.pos, e); controls.target.lerpVectors(camAnim.fromT, camAnim.c.target, e);
    camera.fov = THREE.MathUtils.lerp(camAnim.fromF, camAnim.c.fov, e); camera.updateProjectionMatrix();
    if (camAnim.t >= 1) camAnim = null;
  }
  if (ghostK !== ghostTarget) { ghostK = THREE.MathUtils.clamp(ghostK + Math.sign(ghostTarget - ghostK) * dt / 0.5, 0, 1); applyGhost(); }
  if (pendingSeek !== null) { seekTo(pendingSeek); pendingSeek = null; }
  if (camMode === 'auto') applyAutoCam(time, dt); else controls.update();
  frame(dt);
  render();
  if (!CAPTURE) requestAnimationFrame(tick);
}
if (!CAPTURE) requestAnimationFrame(tick);

addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); layoutPanel(); });
$('panel2d').onclick = () => { panelBig = !panelBig; layoutPanel(); };
function setScreenMode(m) { screenMode = m; document.querySelectorAll('#smode button').forEach((x) => x.classList.toggle('on', x.dataset.mode === m)); }
for (const b of document.querySelectorAll('#smode button')) b.onclick = () => setScreenMode(b.dataset.mode);
setScreenMode('fixed');
$('panelBtn').onclick = () => { panelOn = !panelOn; panelBig = false; $('panelBtn').classList.toggle('on', panelOn); layoutPanel(); };
$('panelBtn').classList.toggle('on', panelOn);
layoutPanel();

setMat('smooth'); surfMat.userData.set = true;
vMidMat.side = vDistMat.side = THREE.DoubleSide; // the cut at the glass shows the finger's own colour
// hooks for screenshots / tests
window.stage = {
  get ready() { return ready; }, setView: (v) => setView(v, false, true), setCam: (n) => setCam(n, true), DURATION, MATS,
  seek(t) { setManual(false); playing = false; seekTo(t); frame(1 / 60); if (camMode === 'auto') applyAutoCam(t, 0, true); },
  drive(x, z) { setManual(true); playing = false; aim.x = x; aim.z = z; }, setMat, set(o) { if (o.kind) kind = o.kind; if (o.bend) bendMode = o.bend; if (o.gain != null) gain = o.gain; },
  solve: (t) => solveHand(t * DEG, THD, 0), dbg: () => ({ ROOT, TIP, surfY, RF, hand, groupMinY, VGROUPS, surfGeo, matKey, manual, camera, controls }),
};
