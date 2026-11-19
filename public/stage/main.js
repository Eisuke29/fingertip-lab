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

// ---------- dimensions (meters) ----------
const PAD = { w: 0.1785, l: 0.2476, t: 0.0061, bezel: 0.0090 };
const SCREEN = { w: PAD.w - 2 * PAD.bezel, l: PAD.l - 2 * PAD.bezel };
const ROOT = V(-0.004, 0, 0.040);                 // PIP contact projected on the glass
const H = V(1, 0, 0.15).normalize();             // horizontal direction from PIP toward DIP / the hand (hand enters from the right, index side faces the visitor)
const RF = 0.0082;                               // finger radius
const PHI = 48 * DEG;                            // index MCP flexion (metacarpal vs proximal)
const BALL_R = 0.022;
const EYE = V(-0.035, 0.42, 0.36);               // visitor eye (screen content is rendered from here)

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: CAPTURE });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const GALLERY = new THREE.Color(0xebe8e3);
scene.background = GALLERY;
scene.fog = new THREE.Fog(GALLERY, 2.2, 6);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;

const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.01, 20);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.copy(ROOT).add(V(0, -0.01, 0));
controls.minDistance = 0.12; controls.maxDistance = 2.0;

// layers: 0 = real world, 1 = virtual objects (inside the screen), 2 = lights for the screen render only
const L_VIRTUAL = 1, L_SCREENLIGHT = 2;

// ---------- lights (real world) ----------
scene.add(new THREE.HemisphereLight(0xffffff, 0xd9d2c7, 0.9));
const key = new THREE.DirectionalLight(0xffffff, 2.2);
key.position.set(-0.35, 0.9, 0.45);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -0.35, right: 0.35, top: 0.35, bottom: -0.35, near: 0.1, far: 2.5 });
key.shadow.bias = -0.0004; key.shadow.radius = 4;
scene.add(key);
const rim = new THREE.DirectionalLight(0xfff4e8, 0.7); rim.position.set(0.6, 0.4, -0.6); scene.add(rim);

// ---------- environment: gallery floor + pedestal ----------
const PED_H = 0.92;
const woodMat = new THREE.MeshStandardMaterial({ color: 0xd8c3a2, roughness: 0.72, transparent: true });
const pedestal = new THREE.Mesh(new RoundedBoxGeometry(0.46, PED_H, 0.40, 3, 0.006), woodMat);
pedestal.position.set(0, -PAD.t - PED_H / 2, 0.02);
pedestal.receiveShadow = true; pedestal.castShadow = true;
scene.add(pedestal);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshStandardMaterial({ color: 0xdedad3, roughness: 0.35, metalness: 0 }));
floor.rotation.x = -Math.PI / 2; floor.position.y = -PAD.t - PED_H; floor.receiveShadow = true;
scene.add(floor);
// a couple of distant blurred-ish plinths for gallery feel
for (const [x, z, h] of [[-1.4, -1.6, 1.0], [1.7, -2.2, 0.8], [-2.4, 0.4, 0.9]]) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.45, h, 0.45), new THREE.MeshStandardMaterial({ color: 0xf3f1ed, roughness: 0.9 }));
  m.position.set(x, floor.position.y + h / 2, z); m.receiveShadow = true; scene.add(m);
}

// ---------- tablet ----------
const device = new THREE.Group(); scene.add(device);
const bodyMat = new THREE.MeshStandardMaterial({ color: 0x6d7073, metalness: 0.85, roughness: 0.32, transparent: true });
const body = new THREE.Mesh(new RoundedBoxGeometry(PAD.w, PAD.t, PAD.l, 4, 0.0028), bodyMat);
body.position.y = -PAD.t / 2; body.castShadow = true; body.receiveShadow = true; device.add(body);
const bezelMat = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.2, metalness: 0, transparent: true });
const bezel = new THREE.Mesh(new RoundedBoxGeometry(PAD.w - 0.0016, 0.0004, PAD.l - 0.0016, 2, 0.0002), bezelMat);
bezel.position.y = -0.0003; device.add(bezel);

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
screenCam.layers.set(L_VIRTUAL); screenCam.layers.enable(L_SCREENLIGHT);
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

// ---------- virtual world (inside the screen) ----------
const VBG = new THREE.Color(0x0a0c0c);
const vKey = new THREE.SpotLight(0xffffff, 6, 0, 0.55, 0.6, 1.2);
vKey.position.set(-0.06, 0.25, 0.12); vKey.target.position.set(0.02, -0.04, 0);
vKey.castShadow = true; vKey.shadow.mapSize.set(1024, 1024); vKey.shadow.bias = -0.0003;
const vFill = new THREE.HemisphereLight(0xcfe9ff, 0x101010, 0.9);
for (const l of [vKey, vFill]) { l.layers.set(L_SCREENLIGHT); scene.add(l); }
scene.add(vKey.target);
const vFloor = new THREE.Mesh(new THREE.PlaneGeometry(SCREEN.w, SCREEN.l), new THREE.MeshStandardMaterial({ color: 0x15191a, roughness: 0.9 }));
vFloor.rotation.x = -Math.PI / 2; vFloor.position.y = -0.085; vFloor.receiveShadow = true; vFloor.layers.set(L_VIRTUAL);
vFloor.material.color.set(0x0b0d0d); scene.add(vFloor);
// outline of the virtual volume (structure view)
const vBox = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(SCREEN.w, 0.085, SCREEN.l)),
  new THREE.LineBasicMaterial({ color: 0x5fb59a, transparent: true, opacity: 0.55 }));
vBox.position.y = -0.0425; vBox.layers.set(L_VIRTUAL); scene.add(vBox);

const skinMat = new THREE.MeshStandardMaterial({ color: 0xb8b8b6, roughness: 0.6, metalness: 0 });
const vSkinMat = skinMat.clone();
function capsule() {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(RF, 0.02, 10, 28), vSkinMat);
  m.userData.len = 0.02;
  m.castShadow = true; m.layers.set(L_VIRTUAL); scene.add(m); return m;
}
const vMid = capsule(), vDist = capsule();
function placeCapsule(mesh, a, b, r = RF) {
  const d = b.clone().sub(a), len = d.length();
  mesh.position.copy(a).addScaledVector(d, 0.5);
  mesh.quaternion.setFromUnitVectors(UP, d.normalize());
  if (Math.abs(mesh.userData.len - len) > 1e-5) { mesh.geometry.dispose(); mesh.geometry = new THREE.CapsuleGeometry(r, len, 10, 28); mesh.userData.len = len; }
}

// jelly ball
const ballGeo = new THREE.SphereGeometry(BALL_R, 160, 120);
const ballRest = ballGeo.attributes.position.array.slice();
const ballCur = ballGeo.attributes.position.array.slice();
const ballMat = new THREE.MeshPhysicalMaterial({
  color: 0x46c494, roughness: 0.14, metalness: 0, transmission: 0.35, thickness: 0.03, ior: 1.36,
  attenuationColor: new THREE.Color(0x3fae86), attenuationDistance: 0.03, clearcoat: 1, clearcoatRoughness: 0.08,
  sheen: 0.15, sheenColor: new THREE.Color(0xd9fff0), emissive: 0x135c42, emissiveIntensity: 0.9,
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
ring.rotation.x = -Math.PI / 2; ring.position.copy(ROOT).add(V(0, 0.0003, 0)); scene.add(ring);

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
  console.log('[stage] hand loaded', { Lp, Lm, Ld });
  layoutBall();
  ready = true;
});

const CURL = { // flexion (deg) of [MCP, PIP, DIP] for the loosely closed fingers; thumb [CMC, MCP, IP]
  'middle-finger': [58, 96, 60], 'ring-finger': [66, 98, 58], 'pinky-finger': [74, 96, 52], 'thumb': [-28, -12, 12],
};
function poseHand(thp, thd, lift) {
  if (!hand) return;
  const { bones, armature, restP, restQ, Lp, Lm, Ld, M0 } = hand;
  const fr = fingerFrame(thp, thd);
  const off = UP.clone().multiplyScalar(lift);
  // index joint targets (world)
  const pip = ROOT.clone().addScaledVector(UP, RF).add(off);
  const dip = pip.clone().addScaledVector(H, Lm);
  const realDistal = H.clone().multiplyScalar(Math.cos(thd)).addScaledVector(UP, Math.sin(thd));
  const tip = dip.clone().addScaledVector(realDistal, Ld);
  const mcp = pip.clone().addScaledVector(fr.proxUp, Lp);
  // hand frame: a = MCP->PIP, n = palmar side of the index
  const a = fr.u, n = fr.n;
  const f = a.clone().multiplyScalar(Math.cos(PHI)).addScaledVector(n, -Math.sin(PHI));
  const p = n.clone().multiplyScalar(Math.cos(PHI)).addScaledVector(a, Math.sin(PHI));
  const l = f.clone().cross(p).normalize();
  // work in Armature-local space
  armature.updateWorldMatrix(true, false);
  const toLocal = armature.matrixWorld.clone().invert();
  const armQ = armature.getWorldQuaternion(new THREE.Quaternion()), armQi = armQ.clone().invert();
  const lv = (w) => w.clone().applyMatrix4(toLocal);
  const ld = (w) => w.clone().applyQuaternion(armQi).normalize();
  const Rhand = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(ld(l), ld(f), ld(fr.n.clone().multiplyScalar(Math.cos(PHI)).addScaledVector(a, Math.sin(PHI)))).multiply(M0.clone().transpose()));
  const lL = ld(l);
  const mcpL = lv(mcp), restMcp = restP['index-finger-phalanx-proximal'];
  const rigid = (n) => restP[n].clone().sub(restMcp).applyQuaternion(Rhand).add(mcpL);
  const setJ = (n, pos, q) => { bones[n].position.copy(pos); bones[n].quaternion.copy(q); };
  setJ('wrist', rigid('wrist'), Rhand.clone().multiply(restQ.wrist));
  for (const fname of FINGERS) {
    const chain = chainOf(fname);
    // metacarpal joint and the first knuckle are rigid with the palm (thumb: only its metacarpal base)
    const rigidCount = fname === 'thumb' ? 1 : 2;
    const pos = chain.map((nm, i) => (i < rigidCount ? rigid(nm) : null));
    for (let i = 0; i < rigidCount; i++) setJ(chain[i], pos[i], Rhand.clone().multiply(restQ[chain[i]]));
    let cum = 0;
    for (let i = rigidCount - 1; i < chain.length - 1; i++) {
      const a0 = restP[chain[i]], b0 = restP[chain[i + 1]], len = a0.distanceTo(b0);
      const d0 = b0.clone().sub(a0).normalize().applyQuaternion(Rhand);
      let dNew;
      if (fname === 'index-finger') {
        const tgt = [null, pip, dip, tip][i];
        dNew = lv(tgt).sub(pos[i]).normalize();
      } else {
        cum += (CURL[fname][i - (rigidCount - 1)] || 0) * DEG;
        dNew = d0.clone().applyAxisAngle(lL, cum);
      }
      pos[i + 1] = pos[i].clone().addScaledVector(dNew, len);
      const qSeg = new THREE.Quaternion().setFromUnitVectors(d0, dNew).multiply(Rhand);
      setJ(chain[i], pos[i], qSeg.clone().multiply(restQ[chain[i]]));
      if (i + 1 === chain.length - 1) setJ(chain[i + 1], pos[i + 1], qSeg.clone().multiply(restQ[chain[i + 1]]));
    }
  }
  hand.model.updateMatrixWorld(true);
}

// ---------- ball layout & deformation ----------
let BALL_C = V();
const CONTACT_THP = 68 * DEG, CONTACT_THD = 22 * DEG;
function layoutBall() {
  const { Lm, Ld } = hand;
  const fr = fingerFrame(CONTACT_THP, CONTACT_THD);
  const vDip = ROOT.clone().addScaledVector(fr.u, Lm);
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
const SOFT = { spread: 2.6, squash: 0.55, bulge: 0.45, k: 520, c: 11 }; // squishiness knobs (set from STIFF)
// Ball stiffness 0 (soft) .. 1 (hard). After the finger pad touches the ball, the displayed DIP flexion is scaled by
// a display gain G (< 1): the harder the ball, the less the virtual finger sinks in (pseudo-haptic stiffness).
let STIFF = 0.5, GAIN = 1;
function setStiffness(v) {
  STIFF = THREE.MathUtils.clamp(v, 0, 1);
  GAIN = 0.45 - 0.4 * STIFF;
  Object.assign(SOFT, { spread: 3.2 - 1.4 * STIFF, squash: 0.8 - 0.6 * STIFF, bulge: 0.55 - 0.3 * STIFF, k: 300 + 900 * STIFF, c: 8 + 14 * STIFF });
}
setStiffness(STIFF);
// Penetration (m) of the virtual finger (middle + distal capsules) into the undeformed ball for angles (thp, thd).
const _pq = V();
function penetrationAt(thp, thd) {
  const fr = fingerFrame(thp, thd);
  const a = ROOT.clone().addScaledVector(fr.u, RF * 0.5);
  const vDip = ROOT.clone().addScaledVector(fr.u, hand.Lm), vTip = vDip.clone().addScaledVector(fr.dDir, hand.Ld);
  const d1 = closestOnSeg(a, vDip, BALL_C, _pq).distanceTo(BALL_C);
  const d2 = closestOnSeg(vDip, vTip, BALL_C, _pq).distanceTo(BALL_C);
  return Math.max(0, BALL_R + RF - Math.min(d1, d2));
}
// Pseudo-haptic stiffness: remember the last pose that did not touch the ball; while touching, show a pose between it
// and the real pose so that the shown penetration is GAIN x the real one (PIP and DIP are both scaled).
let freePose = null;
function displayedPose(thp, thd) {
  const pen = penetrationAt(thp, thd);
  if (pen === 0) { freePose = [thp, thd]; return [thp, thd]; }
  if (!freePose || penetrationAt(freePose[0], freePose[1]) > 0) return [thp, thd];
  const want = GAIN * pen;
  let lo = 0, hi = 1;
  for (let i = 0; i < 16; i++) {
    const m = (lo + hi) / 2;
    if (penetrationAt(freePose[0] + m * (thp - freePose[0]), freePose[1] + m * (thd - freePose[1])) < want) lo = m; else hi = m;
  }
  return [freePose[0] + lo * (thp - freePose[0]), freePose[1] + lo * (thd - freePose[1])];
}
// Sphere grid layout (SphereGeometry(…, 160, 120)) for neighbour smoothing of the dent depth
const GW = 161, GH = 121;
const _dReq = new Float32Array(GW * GH), _dA = new Float32Array(GW * GH), _dB = new Float32Array(GW * GH);
function deformBall(segs, dt) {
  const pos = ballGeo.attributes.position.array;
  const N = pos.length / 3;
  const target = new Float32Array(pos.length);
  const pushed = new Uint8Array(N);
  let maxPen = 0; const cpt = V(); let any = false;
  const p = V(), q = V(), off = V();
  // 1) required inward depth (along the ball radius) so that each surface point sits just under the finger.
  //    The surface is only ever pushed toward the centre: an imprint of the finger pad, never a sleeve around it.
  const insideFinger = (pt) => { for (const [a, b] of segs) if (closestOnSeg(a, b, pt, q).distanceToSquared(pt) < RF * RF) return true; return false; };
  const nIn = V(), lo = V(), hi = V();
  _dReq.fill(0);
  for (let i = 0; i < N; i++) {
    if (!segs.length) break;
    p.set(ballRest[3 * i], ballRest[3 * i + 1], ballRest[3 * i + 2]).add(BALL_C);
    if (!insideFinger(p)) continue;
    nIn.copy(BALL_C).sub(p).normalize();
    lo.copy(p); let k = 0;
    do { hi.copy(lo); lo.addScaledVector(nIn, 0.0005); k++; } while (k < 80 && insideFinger(lo));
    for (let it = 0; it < 6; it++) { off.copy(hi).add(lo).multiplyScalar(0.5); if (insideFinger(off)) hi.copy(off); else lo.copy(off); }
    const d = lo.distanceTo(p) + 0.0002;
    _dReq[i] = d; pushed[i] = 1; any = true;
    if (d > maxPen) { maxPen = d; cpt.copy(p); }
  }
  // 2) spread the depth to the neighbours (smooth bowl instead of a cliff). Softer ball => wider bowl.
  _dA.set(_dReq);
  if (any) {
    const keep = 0.80 + 0.12 * (1 - STIFF);
    let src = _dA, dst = _dB;
    for (let it = 0; it < 14; it++) {
      for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
        const i = y * GW + x;
        const xl = x === 0 ? GW - 2 : x - 1, xr = x === GW - 1 ? 1 : x + 1;
        const yu = Math.max(0, y - 1), yd = Math.min(GH - 1, y + 1);
        const avg = (src[y * GW + xl] + src[y * GW + xr] + src[yu * GW + x] + src[yd * GW + x]) * 0.25;
        dst[i] = Math.max(_dReq[i], Math.max(src[i], avg * keep));
      }
      const t = src; src = dst; dst = t;
    }
    if (src !== _dA) _dA.set(src);
  }
  const press = maxPen;
  const cn = any ? cpt.clone().sub(BALL_C).normalize() : null;
  const sq = any ? Math.min(0.3, SOFT.squash * press / BALL_R) : 0;
  const pp = V(), dir = V();
  for (let i = 0; i < N; i++) {
    pp.set(ballRest[3 * i], ballRest[3 * i + 1], ballRest[3 * i + 2]);
    dir.copy(pp).normalize();
    let tx = pp.x - dir.x * _dA[i], ty = pp.y - dir.y * _dA[i], tz = pp.z - dir.z * _dA[i];
    if (any) {
      // 3) gentle bulge ring around the bowl and whole-body squash (centre stays fixed)
      const ang = Math.acos(THREE.MathUtils.clamp(dir.dot(cn), -1, 1)) * BALL_R;
      const ring = _dA[i] > 0.0002 ? 0 : Math.exp(-(((ang - 3.0 * RF) / (1.4 * RF)) ** 2));
      const bl = press * SOFT.bulge * ring; tx += dir.x * bl; ty += dir.y * bl; tz += dir.z * bl;
      if (!pushed[i]) {
        const along = tx * cn.x + ty * cn.y + tz * cn.z;
        const lx = tx - cn.x * along, ly = ty - cn.y * along, lz = tz - cn.z * along;
        const k1 = along < 0 ? -sq * along * 0.5 : 0;             // flatten the far side a little
        tx += cn.x * k1 + lx * sq * 0.35; ty += cn.y * k1 + ly * sq * 0.35; tz += cn.z * k1 + lz * sq * 0.35;
      }
    }
    target[3 * i] = tx; target[3 * i + 1] = ty; target[3 * i + 2] = tz;
  }
  // 4) jelly dynamics: under-damped spring toward the target (points under the finger follow it immediately)
  if (dt === 0) { ballCur.set(target); ballVel.fill(0); }
  else {
    const steps = Math.max(1, Math.ceil(dt / (1 / 240))), h = dt / steps;
    for (let sIt = 0; sIt < steps; sIt++) {
      for (let i = 0; i < pos.length; i++) {
        if (pushed[(i / 3) | 0]) { ballCur[i] = target[i]; ballVel[i] = 0; continue; }
        ballVel[i] += ((target[i] - ballCur[i]) * SOFT.k - ballVel[i] * SOFT.c) * h;
        ballCur[i] += ballVel[i] * h;
      }
    }
  }
  pos.set(ballCur);
  ballGeo.attributes.position.needsUpdate = true;
  ballGeo.computeVertexNormals();
  return { touching: any, pen: maxPen, point: any ? cpt : null };
}

// ---------- timeline ----------
// keys: [time, value]; eased (cosine) between keys
// Range of motion used for the animation (deg). Replace with values measured in this posture.
// PIP: interior angle between proximal and middle phalanx (180 = straight). DIP: flexion (0 = straight along the glass).
const ROM = { pip: [50, 150], dip: [0, 90] };
const K = {
  lift: [[0, 0.08], [2.6, 0], [29.4, 0], [30.8, 0.07], [31, 0.07]],
  thp: [[0, 68], [3.4, 68], [5.2, ROM.pip[0]], [7.6, ROM.pip[1]], [9.4, 68], [13.4, 68], [14.4, 80], [15.0, 80], [16.0, 68],
        [20, 68], [22, 55], [24.4, 85], [26, 68], [31, 68]],
  thd: [[0, 5], [9.8, 5], [11.0, 85], [11.8, 85], [12.8, 5], [13.4, 5], [14.4, ROM.dip[1]], [15.0, ROM.dip[1]], [16.0, 5],
        [16.6, 5], [17.6, 80], [18.2, 80], [19.6, ROM.dip[0]], [20.0, ROM.dip[0]], [20.8, 50], [26.0, 50], [26.8, 5], [31, 5]],
};
const SCENE_AT = (t) => (t < 16.4 ? 'press' : t < 19.9 ? 'release' : 'stroke');
const DURATION = 31;
function sample(keys, t) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) { const [t0, v0] = keys[i - 1], [t1, v1] = keys[i]; const s = (t - t0) / (t1 - t0); return v0 + (v1 - v0) * (0.5 - 0.5 * Math.cos(Math.PI * s)); }
  }
  return keys[keys.length - 1][1];
}

// ---------- camera presets ----------
const SIDE_DIR = H.clone().cross(UP).normalize();  // perpendicular to the finger plane (visitor side)
const CAMS = {
  pov: { pos: EYE.clone(), target: V(0.0, -0.012, -0.005), fov: 35 },
  side: { pos: ROOT.clone().addScaledVector(SIDE_DIR, 0.36).add(V(0, 0.03, 0)), target: ROOT.clone().add(V(0.02, -0.01, 0)), fov: 32 },
  orbit: { pos: ROOT.clone().add(V(0.32, 0.22, 0.32)), target: ROOT.clone().add(V(0, -0.005, 0)), fov: 35 },
};
let camAnim = null, camMode = 'auto';
// "おまかせ" camera: the same shot list as the video. [t0, t1, view, (u) => {orbit:[az,el,dist,dx,dy,dz]} | {pov:fov}]
const SHOTS = [
  [0, 3.4, 'experience', (u) => ({ orbit: [35 - 25 * u, 32, 0.34, 0, -0.008, 0] })],
  [3.4, 9.4, 'structure', (u) => ({ orbit: [-8 + 6 * u, 6, 0.30, 0.012, -0.02, 0] })],
  [9.4, 13.2, 'experience', () => ({ pov: 27 })],
  [13.2, 16.4, 'experience', (u) => ({ orbit: [-28 + 6 * u, 32, 0.20, 0.006, -0.01, 0] })],
  [16.4, 19.9, 'experience', (u) => ({ orbit: [-22 + 4 * u, 26, 0.18, 0.006, -0.01, 0] })],
  [19.9, 26.8, 'experience', () => ({ pov: 27 })],
  [26.8, 31.01, 'structure', (u) => ({ orbit: [20 + 200 * u, 24, 0.30, 0.006, -0.02, 0] })],
];
function shotAt(t) {
  const i = Math.max(0, SHOTS.findIndex((s) => t >= s[0] && t < s[1]));
  const sh = SHOTS[i], u = Math.min(1, (t - sh[0]) / (sh[1] - sh[0])), e = 0.5 - 0.5 * Math.cos(Math.PI * u);
  const c = sh[3](e);
  let pos, target, fov;
  if (c.orbit) {
    const [az, el, d, ox, oy, oz] = c.orbit; target = ROOT.clone().add(V(ox, oy, oz));
    pos = target.clone().add(V(d * Math.cos(el * DEG) * Math.sin(az * DEG), d * Math.sin(el * DEG), d * Math.cos(el * DEG) * Math.cos(az * DEG))); fov = 32;
  } else { pos = EYE.clone(); target = V(0.0, -0.012, 0.01); fov = c.pov; }
  return { i, view: sh[2], pos, target, fov };
}
let autoShot = -1, autoBlend = null, viewOverride = null;
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
let view = 'experience';
function setView(v, fromAuto = false) {
  view = v; if (!fromAuto && camMode === 'auto') viewOverride = v;
  document.querySelectorAll('#views button').forEach((x) => x.classList.toggle('on', x.dataset.view === v));
  const ghost = v === 'structure';
  camera.layers.set(0); if (ghost) camera.layers.enable(L_VIRTUAL);
  woodMat.opacity = ghost ? 0.18 : 1; woodMat.depthWrite = !ghost;
  bodyMat.opacity = ghost ? 0.25 : 1; bodyMat.depthWrite = !ghost;
  bezelMat.opacity = ghost ? 0.15 : 1; bezelMat.depthWrite = !ghost;
  screenMat.opacity = ghost ? 0.0 : 1;
  vFloor.visible = false; vBox.visible = ghost;
  vSkinMat.transparent = ghost; vSkinMat.opacity = ghost ? 0.75 : 1;
  vSkinMat.emissive.set(ghost ? 0x2a6b58 : 0x000000);
}
setView('experience', true);

// ---------- UI ----------
let playing = !CAPTURE, time = 0, manual = false, ready = false;
const $ = (id) => document.getElementById(id);
$('play').onclick = () => { playing = !playing; $('play').textContent = playing ? '❚❚' : '▶'; };
$('scrub').oninput = (e) => { time = e.target.value / 1000 * DURATION; playing = false; $('play').textContent = '▶'; resetMaterial(); };
for (const b of document.querySelectorAll('#views button')) b.onclick = () => setView(b.dataset.view);
for (const b of document.querySelectorAll('#cams button')) b.onclick = () => setCam(b.dataset.cam);
controls.addEventListener('start', () => { if (camMode !== 'orbit' && camMode !== 'free') { camAnim = null; setCam('free'); } });
$('trackBtn').onclick = () => { headTrack = !headTrack; $('trackBtn').classList.toggle('on', headTrack); $('trackBtn').textContent = headTrack ? '頭の位置に追従' : '目の位置を固定'; };
function setManual(on) { manual = on; $('manual').classList.toggle('manual', on); $('autoBtn').hidden = !on; }
for (const id of ['tp', 'td']) $(id).addEventListener('input', () => { if (!manual) setManual(true); });
$('stiff').addEventListener('input', (e) => { setStiffness(e.target.value / 100); $('stv').textContent = stiffLabel(); });
const stiffLabel = () => (STIFF < 0.25 ? 'とてもやわらかい' : STIFF < 0.6 ? 'やわらかめ' : STIFF < 0.85 ? 'かため' : 'かたい');
$('stv').textContent = stiffLabel();
$('autoBtn').onclick = () => { setManual(false); playing = true; $('play').textContent = '❚❚'; };
function resetMaterial() { mat.anchor = null; mat.threadState = 'none'; freePose = null; }

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
  const [thpV, thdV] = contact ? displayedPose(thp, thd) : [thp, thd];   // displayed (virtual) angles
  const fr = fingerFrame(thpV, thdV);
  const vDip = ROOT.clone().addScaledVector(fr.u, hand.Lm);
  const vTip = vDip.clone().addScaledVector(fr.dDir, hand.Ld);
  placeCapsule(vMid, ROOT, vDip); placeCapsule(vDist, vDip, vTip);
  vMid.visible = vDist.visible = contact;
  ring.material.opacity += ((contact ? 0.55 : 0) - ring.material.opacity) * Math.min(1, dt * 6);
  const s = 1 + (1 - appear) * 0.4; ring.scale.setScalar(s);
  // material
  const segs = contact ? [[vDip, vTip], [ROOT.clone().addScaledVector(fr.u, RF * 0.5), vDip]] : [];
  const res = deformBall(segs, dt);
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

let headTrack = true; // screen content follows the viewing camera (head-tracked display); false = fixed visitor eye
function render() {
  camera.updateMatrixWorld(true);
  updateScreenCamera(headTrack ? camera.getWorldPosition(V()) : EYE);
  // screen pass (virtual world, dark backdrop)
  if (view === 'experience') {
    scene.background = VBG; scene.fog = null; scene.environmentIntensity = 0.12;
    renderer.setRenderTarget(screenRT); renderer.render(scene, screenCam); renderer.setRenderTarget(null);
    scene.background = GALLERY; scene.fog = new THREE.Fog(GALLERY, 2.2, 6); scene.environmentIntensity = 0.55;
  }
  renderer.render(scene, camera);
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
  if (camMode === 'auto') applyAutoCam(time, dt); else controls.update();
  frame(dt);
  render();
  if (!CAPTURE) requestAnimationFrame(tick);
}
if (!CAPTURE) requestAnimationFrame(tick);

addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

// deterministic hooks for video capture / screenshots
window.stage = {
  probe2() { poseHand(68*DEG, 10*DEG, 0); const o = {}; for (const n of ['wrist','index-finger-phalanx-proximal','index-finger-phalanx-intermediate','index-finger-phalanx-distal','index-finger-tip','middle-finger-phalanx-proximal','middle-finger-phalanx-intermediate','middle-finger-tip']) o[n] = hand.bones[n].getWorldPosition(V()).toArray().map((x) => +x.toFixed(4)); o.ROOT = ROOT.toArray(); o.H = H.toArray().map((x)=>+x.toFixed(3)); return JSON.stringify(o); },
  get ready() { return ready; },
  setHeadTrack(v) { headTrack = v; },
  setStiffness,
  camPose(px, py, pz, tx, ty, tz, fov = 35) { controls.autoRotate = false; camera.position.set(px, py, pz); controls.target.set(tx, ty, tz); camera.fov = fov; camera.updateProjectionMatrix(); camera.lookAt(controls.target); camera.updateMatrixWorld(true); },
  ROOT: ROOT.toArray(), EYE: EYE.toArray(), SIDE: SIDE_DIR.toArray(), DURATION,
  setView, setCam: (n) => setCam(n, true),
  autoCam(t) { camMode = 'auto'; viewOverride = null; applyAutoCam(t, 0, true); setView(shotAt(t).view, true); },
  // render time t (seconds); simulates from t-1.5s at 60 Hz so the jelly/thread state is consistent
  renderAt(t, cam) {
    if (cam && cam.startsWith('o:')) { const [, az, el, d] = cam.split(':').map(Number); this.orbitTo(az * DEG, el * DEG, d); }
    else if (cam) setCam(cam, true);
    resetMaterial(); ballCur.set(ballRest); ballVel.fill(0);
    const start = Math.max(0, t - 1.5);
    for (let s = start; s < t; s += 1 / 60) { time = s; frame(1 / 60); }
    time = t; frame(1 / 60); if (!(cam && cam.startsWith('o:'))) controls.update(); render();
  },
  step(t, dt) { time = t; frame(dt); if (camMode !== 'auto') controls.update(); render(); },
  orbitTo(az, el, dist) { // spherical camera around the PIP pivot
    const tg = CAMS.orbit.target; controls.target.copy(tg);
    camera.position.set(tg.x + dist * Math.cos(el) * Math.sin(az), tg.y + dist * Math.sin(el), tg.z + dist * Math.cos(el) * Math.cos(az));
    camera.lookAt(tg); camera.updateMatrixWorld(true);
  },
};
