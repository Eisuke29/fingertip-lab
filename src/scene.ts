import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { add, mul, norm, sub, v, type V3 } from './math';
import type { Ball, FingerConfig, SceneKind, Skeleton } from './types';
import type { MaterialResponse } from './material';

const vector = (p: V3) => new THREE.Vector3(p.x, p.y, p.z);
const yAxis = new THREE.Vector3(0, 1, 0);
function radialTexture() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(69,55,47,.4)'); gradient.addColorStop(0.4, 'rgba(69,55,47,.13)'); gradient.addColorStop(1, 'rgba(69,55,47,0)');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; return texture;
}
function grainTexture() {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 256;
  const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#f6fbf8'; ctx.fillRect(0, 0, 512, 256);
  ctx.fillStyle = '#9ab9ae';
  for (let y = 4; y < 256; y += 13) for (let x = 4; x < 512; x += 13) {
    ctx.beginPath(); ctx.arc(x + (y % 2) * 3, y, 0.9, 0, Math.PI * 2); ctx.fill();
  }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping; return texture;
}

export class PivotScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  width = 390;
  height = 800;
  viewYaw = 0;
  viewPitch = 0;
  onResize?: () => void;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 1, 6000);
  private raycaster = new THREE.Raycaster();
  private glass = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  private finger = new THREE.Group();
  private skin = new THREE.MeshPhysicalMaterial({ color: 0xd9aa91, roughness: 0.56, metalness: 0, clearcoat: 0.13 });
  private nailMaterial = new THREE.MeshPhysicalMaterial({ color: 0xf0d9c8, roughness: 0.29, clearcoat: 0.9 });
  private creaseMaterial = new THREE.MeshStandardMaterial({ color: 0xb98570, roughness: 0.8, transparent: true, opacity: 0.38 });
  private cylinder = new THREE.CylinderGeometry(0.91, 1, 1, 40, 2, true);
  private sphere = new THREE.SphereGeometry(1, 32, 24);
  private middle = new THREE.Mesh(this.cylinder, this.skin);
  private distal = new THREE.Mesh(this.cylinder, this.skin);
  private joint = new THREE.Mesh(this.sphere, this.skin);
  private cap = new THREE.Mesh(this.sphere, this.skin);
  private nail = new THREE.Mesh(this.sphere, this.nailMaterial);
  private crease = new THREE.Mesh(new THREE.TorusGeometry(1, 0.018, 6, 40, Math.PI * 0.85), this.creaseMaterial);
  private rootShadow: THREE.Mesh;
  private contactShadow: THREE.Mesh;
  private ballGeometry = new THREE.SphereGeometry(1, 96, 64);
  private baseDirections: Float32Array;
  private ballMaterial = new THREE.MeshPhysicalMaterial({ color: 0xa7c9b9, roughness: 0.22, transmission: 0.38, thickness: 38,
    ior: 1.34, attenuationColor: new THREE.Color(0xadd1c0), attenuationDistance: 160, clearcoat: 0.85, clearcoatRoughness: 0.16, transparent: true, opacity: 0.96 });
  private ballMesh = new THREE.Mesh(this.ballGeometry, this.ballMaterial);
  private pattern = grainTexture();
  private uniforms = { normal: { value: new THREE.Vector3(0, 0, 1) }, shift: { value: new THREE.Vector2() }, enabled: { value: 0 } };
  private strand = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshPhysicalMaterial({ color: 0xb8d8c9, roughness: 0.2, clearcoat: 1, transparent: true, opacity: 0.88 }));
  private observer: ResizeObserver;
  private lastKey = '';
  private dirty = true;
  private environment: THREE.WebGLRenderTarget;
  private lastThread = '';
  /** Thread tube radius in world units (CSS px). */
  strandRadius = 1.25;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x0b0c0b);
    this.renderer.localClippingEnabled = true;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 0.95;
    this.canvas = this.renderer.domElement;
    this.canvas.setAttribute('aria-label', 'PIPを支点とする二節の指と、固定された柔らかい球');
    this.canvas.tabIndex = 0; container.prepend(this.canvas);
    this.scene.background = new THREE.Color(0x0b0c0b); // dark, so the screen does not light up the finger or show up as a white mark in the camera
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.environment = pmrem.fromScene(room, 0.04); this.scene.environment = this.environment.texture; this.scene.environmentIntensity = 0.65;
    room.dispose(); pmrem.dispose();
    this.scene.add(new THREE.HemisphereLight(0xfff5e8, 0x9cae9d, 1.2));
    const light = new THREE.DirectionalLight(0xfff1de, 2.3); light.position.set(-230, 350, 450); this.scene.add(light);
    const fill = new THREE.DirectionalLight(0xe9f3ff, 0.9); fill.position.set(300, -80, 220); this.scene.add(fill);
    this.finger.add(this.middle, this.distal, this.joint, this.cap, this.nail, this.crease);
    this.scene.add(this.finger, this.ballMesh, this.strand);
    const shadow = new THREE.MeshBasicMaterial({ map: radialTexture(), transparent: true, opacity: 0.55, depthWrite: false });
    this.rootShadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), shadow); this.rootShadow.scale.set(65, 65, 1);
    this.contactShadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), shadow.clone()); this.contactShadow.scale.set(35, 35, 1);
    this.scene.add(this.rootShadow, this.contactShadow);
    this.baseDirections = new Float32Array(this.ballGeometry.attributes.position.array);
    this.ballMaterial.map = this.pattern;
    this.ballMaterial.onBeforeCompile = shader => {
      shader.uniforms.uStrokeNormal = this.uniforms.normal; shader.uniforms.uStrokeShift = this.uniforms.shift; shader.uniforms.uStrokeOn = this.uniforms.enabled;
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vSphereDirection;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSphereDirection = normalize(position);');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vSphereDirection;\nuniform vec3 uStrokeNormal;\nuniform vec2 uStrokeShift;\nuniform float uStrokeOn;')
        .replace('#include <map_fragment>', `
          #ifdef USE_MAP
            float a = acos(clamp(dot(normalize(vSphereDirection), uStrokeNormal), -1.0, 1.0));
            float localMask = exp(-pow(a / 0.48, 2.0));
            vec4 texel = texture2D(map, vMapUv + uStrokeShift * localMask);
            diffuseColor.rgb *= mix(vec3(1.0), texel.rgb, uStrokeOn);
          #endif
        `);
    };
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(container); this.resize();
  }
  private resize() {
    const rect = this.container.getBoundingClientRect(); this.width = Math.max(1, rect.width); this.height = Math.max(1, rect.height);
    this.renderer.setSize(this.width, this.height, false); this.setView(this.viewYaw, this.viewPitch); this.onResize?.();
  }
  setView(yaw: number, pitch: number) {
    this.viewYaw = yaw; this.viewPitch = pitch;
    const d = this.height / (2 * Math.tan(THREE.MathUtils.degToRad(16)));
    this.camera.aspect = this.width / this.height;
    this.camera.position.set(d * Math.sin(yaw) * Math.cos(pitch), d * Math.sin(pitch), d * Math.cos(yaw) * Math.cos(pitch));
    this.camera.lookAt(0, 0, 0); this.camera.updateProjectionMatrix(); this.camera.updateMatrixWorld(); this.dirty = true;
  }
  project(point: V3) { const p = vector(point).project(this.camera); return { x: (p.x + 1) * this.width / 2, y: (1 - p.y) * this.height / 2 }; }
  glassPoint(localX: number, localY: number): V3 {
    this.raycaster.setFromCamera(new THREE.Vector2(localX / this.width * 2 - 1, 1 - localY / this.height * 2), this.camera);
    const result = this.raycaster.ray.intersectPlane(this.glass, new THREE.Vector3());
    return result ? { x: result.x, y: result.y, z: 0 } : v();
  }
  clientPoint(clientX: number, clientY: number): V3 {
    const rect = this.canvas.getBoundingClientRect(); return this.glassPoint(clientX - rect.left, clientY - rect.top);
  }
  private segment(mesh: THREE.Mesh, start: V3, end: V3, radius: number) {
    const d = vector(end).sub(vector(start)); mesh.position.copy(vector(start)).addScaledVector(d, 0.5);
    mesh.quaternion.setFromUnitVectors(yAxis, d.clone().normalize()); mesh.scale.set(radius, d.length(), radius);
  }
  render(s: Skeleton, ball: Ball, response: MaterialResponse, config: FingerConfig, kind: SceneKind, visible: boolean, rootGap: number, skinColor: string) {
    const key = JSON.stringify([s, ball, response.depth, response.contactNormal, response.thread, response.strokeShift, config.radius, config.side, visible, rootGap, skinColor, kind]);
    if (key === this.lastKey && !this.dirty) return; this.lastKey = key; this.dirty = false;
    this.finger.visible = this.rootShadow.visible = visible;
    const sign = config.side === 'front' ? -1 : 1;
    const planes = [new THREE.Plane(new THREE.Vector3(0, 0, sign), 0),
      new THREE.Plane(vector(s.middleDirection), -vector(s.middleDirection).dot(vector(s.pip)) - rootGap)];
    for (const material of [this.skin, this.nailMaterial, this.creaseMaterial]) material.clippingPlanes = planes;
    this.skin.color.set(skinColor);
    this.segment(this.middle, s.pip, s.dip, config.radius);
    const endCenter = add(s.tip, mul(s.distalDirection, -config.radius * 0.5));
    this.segment(this.distal, s.dip, endCenter, config.radius * 0.9);
    this.joint.position.copy(vector(s.dip)); this.joint.scale.setScalar(config.radius * 0.93);
    this.cap.position.copy(vector(endCenter)); this.cap.scale.setScalar(config.radius * 0.82);
    const dorsal = vector(s.padNormal).negate();
    const localX = new THREE.Vector3().crossVectors(vector(s.distalDirection), dorsal).normalize();
    const basis = new THREE.Matrix4().makeBasis(localX, vector(s.distalDirection), dorsal);
    this.nail.quaternion.setFromRotationMatrix(basis);
    this.nail.position.copy(vector(add(s.dip, mul(s.distalDirection, config.distalLength * 0.79)))).addScaledVector(dorsal, config.radius * 0.82);
    this.nail.scale.set(config.radius * 0.59, config.radius * 0.88, config.radius * 0.065);
    this.crease.position.copy(vector(s.dip)).addScaledVector(vector(s.padNormal), config.radius * 0.55);
    this.crease.quaternion.setFromRotationMatrix(basis); this.crease.scale.setScalar(config.radius * 0.8);
    this.rootShadow.position.set(s.pip.x, s.pip.y, -0.8);
    this.rootShadow.scale.set(config.radius * 4.0, config.radius * 3.2, 1);
    this.ballMesh.position.copy(vector(ball.center));
    const positions = this.ballGeometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const n = v(this.baseDirections[i * 3], this.baseDirections[i * 3 + 1], this.baseDirections[i * 3 + 2]);
      const r = response.radiusAt(n, ball); positions.setXYZ(i, n.x * r, n.y * r, n.z * r);
    }
    positions.needsUpdate = true; this.ballGeometry.computeVertexNormals(); this.ballGeometry.computeBoundingSphere();
    this.uniforms.normal.value.copy(vector(response.contactNormal));
    this.uniforms.shift.value.set(response.strokeShift.x, response.strokeShift.y); this.uniforms.enabled.value = kind === 'stroke' ? 0.52 : 0;
    this.contactShadow.visible = visible && response.depth > 0.2;
    this.contactShadow.position.copy(vector(add(ball.center, mul(response.contactNormal, ball.radius - response.depth + 0.2))));
    this.contactShadow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), vector(response.contactNormal));
    (this.contactShadow.material as THREE.MeshBasicMaterial).opacity = Math.min(0.32, response.depth / 60);
    this.strand.visible = !!response.thread;
    if (response.thread) {
      const threadKey = JSON.stringify(response.thread);
      if (threadKey !== this.lastThread) {
        this.lastThread = threadKey;
        const start = vector(response.thread.start), end = vector(response.thread.end), middle = start.clone().lerp(end, 0.5);
        middle.y -= start.distanceTo(end) * 0.09;
        const curve = new THREE.CatmullRomCurve3([start, middle, end]);
        this.strand.geometry.dispose(); this.strand.geometry = new THREE.TubeGeometry(curve, 20, this.strandRadius, 9, false);
      }
    }
    this.renderer.render(this.scene, this.camera);
  }
  dispose() {
    this.observer.disconnect(); this.environment.dispose(); this.pattern.dispose();
    this.scene.traverse(object => { if (object instanceof THREE.Mesh) { object.geometry.dispose(); for (const m of Array.isArray(object.material) ? object.material : [object.material]) m.dispose(); } });
    this.renderer.dispose();
  }
}
