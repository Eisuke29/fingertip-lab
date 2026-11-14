import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { DisplayCondition, InputMode, Vec3 } from './types';

const vector = (v: Vec3) => new THREE.Vector3(v.x, v.y, v.z);

export class ProductScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  width = 600;
  height = 520;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(36, 1, 1, 5000);
  private pouch = new THREE.Group();
  private finger = new THREE.Group();
  private skin = new THREE.MeshStandardMaterial({ color: 0xdca784, roughness: 0.69, metalness: 0 });
  private tube = new THREE.Mesh(new THREE.BufferGeometry(), this.skin);
  private tipCap = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), this.skin);
  private nail = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), new THREE.MeshPhysicalMaterial({ color: 0xf2d8c6, roughness: 0.3, clearcoat: 0.35 }));
  private point = new THREE.Group();
  private pedestal: THREE.Mesh;
  private shadow: THREE.Mesh;
  private floor: THREE.Mesh;
  private surfaceClip = [new THREE.Plane(new THREE.Vector3(0, 0, -1), 0)];
  private rearClip = [new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)];
  private observer: ResizeObserver;
  private lastShape = '';
  private lastRender = '';
  private dirty = true;
  private onResize?: () => void;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.localClippingEnabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;
    this.canvas = this.renderer.domElement;
    this.canvas.setAttribute('aria-label', '仮想の指先でループ付きポーチを持ち上げる操作領域');
    this.canvas.setAttribute('role', 'img');
    this.canvas.tabIndex = 0;
    container.prepend(this.canvas);
    this.scene.add(new THREE.HemisphereLight(0xfff7eb, 0x8a8d88, 2.3));
    const key = new THREE.DirectionalLight(0xfff4df, 3.1);
    key.position.set(-230, 350, 460);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, { left: -420, right: 420, top: 420, bottom: -420, near: 1, far: 1300 });
    key.shadow.bias = -0.0007;
    key.shadow.normalBias = 0.4;
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xe2eafa, 0.7);
    fill.position.set(300, 40, 100);
    this.scene.add(fill);

    this.pedestal = new THREE.Mesh(new THREE.CylinderGeometry(124, 132, 25, 96),
      new THREE.MeshStandardMaterial({ color: 0xe0d9ca, roughness: 0.97 }));
    this.pedestal.position.y = -116;
    this.pedestal.receiveShadow = true;
    this.scene.add(this.pedestal);
    const floor = this.floor = new THREE.Mesh(new THREE.PlaneGeometry(2200, 1600), new THREE.ShadowMaterial({ color: 0x5e584c, opacity: 0.11 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -129;
    floor.receiveShadow = true;
    this.scene.add(floor);
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 64), new THREE.MeshBasicMaterial({ color: 0x554c3e, transparent: true, opacity: 0.10, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = -103.2;
    this.shadow.scale.set(73, 32, 1);
    this.scene.add(this.shadow);
    this.makePouch();
    this.scene.add(this.pouch);

    this.tube.castShadow = true;
    this.tipCap.castShadow = true;
    this.finger.add(this.tube, this.tipCap, this.nail);
    this.scene.add(this.finger);
    const dot = new THREE.Mesh(new THREE.SphereGeometry(7, 24, 16), new THREE.MeshStandardMaterial({ color: 0x346454, roughness: 0.6 }));
    const outline = new THREE.Mesh(new THREE.TorusGeometry(9, 1.5, 8, 32), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    outline.position.z = 1;
    this.point.add(dot, outline);
    this.scene.add(this.point);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.resize();
  }

  private makePouch() {
    const fabric = new THREE.MeshStandardMaterial({ color: 0xa5a38d, roughness: 0.95 });
    const body = new THREE.Mesh(new RoundedBoxGeometry(151, 116, 35, 5, 16), fabric);
    body.position.set(0, -109, -8);
    body.castShadow = true; body.receiveShadow = true;
    this.pouch.add(body);
    // Slightly inset front panel and individual stitches make the scale legible.
    const panel = new THREE.Mesh(new RoundedBoxGeometry(137, 101, 2, 4, 13), new THREE.MeshStandardMaterial({ color: 0xa9a790, roughness: 1 }));
    panel.position.set(0, -110, 10);
    this.pouch.add(panel);
    const stitchMaterial = new THREE.MeshStandardMaterial({ color: 0xc9c5ad, roughness: 1 });
    const stitchGeometry = new THREE.CapsuleGeometry(0.35, 2.4, 2, 4);
    const stitches = new THREE.InstancedMesh(stitchGeometry, stitchMaterial, 66);
    const stitch = new THREE.Object3D();
    let stitchIndex = 0;
    for (let i = 0; i < 20; i++) {
      for (const y of [-66, -154]) {
        stitch.rotation.z = Math.PI / 2;
        stitch.position.set(-55 + i * 5.8, y, 11.5);
        stitch.updateMatrix(); stitches.setMatrixAt(stitchIndex++, stitch.matrix);
      }
    }
    for (let i = 0; i < 13; i++) for (const x of [-63, 63]) {
      stitch.rotation.z = 0;
      stitch.position.set(x, -75 - i * 5.6, 11.5);
      stitch.updateMatrix(); stitches.setMatrixAt(stitchIndex++, stitch.matrix);
    }
    this.pouch.add(stitches);
    const zip = new THREE.Mesh(new THREE.BoxGeometry(120, 2.5, 4), new THREE.MeshStandardMaterial({ color: 0x797a67, metalness: 0.35, roughness: 0.6 }));
    zip.position.set(0, -54, 5);
    this.pouch.add(zip);
    const pull = new THREE.Mesh(new RoundedBoxGeometry(6, 16, 2.5, 2, 1), new THREE.MeshStandardMaterial({ color: 0xa7a18b, metalness: 0.72, roughness: 0.35 }));
    pull.rotation.z = -0.3;
    pull.position.set(49, -60, 12);
    this.pouch.add(pull);
    // The loop straddles the fingertip in depth; normal depth testing supplies occlusion.
    const loop = new THREE.Mesh(new THREE.TorusGeometry(36, 3.7, 12, 80), new THREE.MeshStandardMaterial({ color: 0x6e7463, roughness: 0.83 }));
    loop.position.set(0, -23, 0);
    loop.scale.x = 0.82;
    loop.rotation.y = -0.65;
    loop.castShadow = true;
    this.pouch.add(loop);
    const attachment = new THREE.Mesh(new RoundedBoxGeometry(17, 13, 7, 2, 2), fabric);
    attachment.position.set(0, -54, -3);
    this.pouch.add(attachment);
  }

  setResizeHandler(handler: () => void) { this.onResize = handler; }
  private resize() {
    const rect = this.container.getBoundingClientRect();
    this.width = Math.max(1, rect.width); this.height = Math.max(1, rect.height);
    this.renderer.setSize(this.width, this.height, false);
    this.dirty = true;
    this.camera.aspect = this.width / this.height;
    // At z=0 one world unit is one CSS pixel, regardless of DPR or orientation.
    this.camera.position.set(0, 0, this.height / (2 * Math.tan(THREE.MathUtils.degToRad(18))));
    this.camera.updateProjectionMatrix();
    this.onResize?.();
  }
  screenPoint(v: Vec3) {
    this.camera.updateMatrixWorld();
    const p = vector(v).project(this.camera);
    return { x: (p.x + 1) * this.width / 2, y: (1 - p.y) * this.height / 2 };
  }
  worldRoot(clientX: number, clientY: number, offsetX: number, offsetY: number): Vec3 {
    const rect = this.canvas.getBoundingClientRect();
    return { x: clientX - rect.left - rect.width / 2 + offsetX,
      y: rect.height / 2 - (clientY - rect.top) - offsetY, z: 0 };
  }
  setRest(rest: Vec3) {
    this.dirty = true;
    this.pedestal.position.z = rest.z - 8;
    this.pedestal.position.y = rest.y - 179.5;
    this.floor.position.y = rest.y - 192.5;
    this.shadow.position.y = rest.y - 166.6;
    this.shadow.position.z = rest.z;
  }

  render(options: { root: Vec3; tip: Vec3; product: Vec3; rest: Vec3; mode: InputMode; display: DisplayCondition; width: number; visible: boolean; held: boolean; value: number }) {
    const { root, tip, product, rest, mode, display, width, visible, held, value } = options;
    const renderKey = [root.x, root.y, root.z, tip.x, tip.y, tip.z, product.x, product.y, product.z,
      width, value, mode, display, visible].map(v => typeof v === 'number' ? Math.round(v * 100) / 100 : v).join(',');
    if (!this.dirty && renderKey === this.lastRender) return;
    this.lastRender = renderKey; this.dirty = false;
    this.pouch.position.copy(vector(product));
    // The attachment origin is exactly the displayed contact, even while moving sideways.
    this.pouch.rotation.set(0, 0, 0);
    this.shadow.position.x = product.x * 0.2;
    const elevation = Math.max(0, product.y - rest.y);
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = 0.13 * Math.exp(-elevation / 160);
    this.shadow.scale.set(73 + elevation * 0.12, 32 + elevation * 0.07, 1);
    this.finger.visible = visible && display === 'finger';
    this.skin.clippingPlanes = mode === 'surface' ? this.surfaceClip : this.rearClip;
    this.point.visible = visible && display === 'point';
    this.point.position.copy(vector(tip));
    if (this.finger.visible) {
      const shape = [root.x, root.y, tip.x, tip.y, tip.z, width, value, mode].map(v => typeof v === 'number' ? Math.round(v * 5) / 5 : v).join(',');
      if (shape !== this.lastShape) {
        this.lastShape = shape;
        const start = vector(root), end = vector(tip);
        let controls: THREE.Vector3[];
        if (mode === 'surface') {
          controls = [start, start.clone().lerp(end, 0.34), start.clone().lerp(end, 0.73), end];
          controls[1].z = -18; controls[2].z = tip.z * 0.82;
        } else {
          // The proximal part stays behind the glass and is clipped there.
          // Only the distal continuation emerges toward the viewer.
          start.z = -18;
          const dip = new THREE.Vector3(rest.x + 8, rest.y + 48, -5);
          const middle = start.clone().lerp(dip, 0.5); middle.z = -22;
          controls = [start, middle, dip,
            new THREE.Vector3(tip.x + 1, (dip.y + tip.y) / 2, tip.z + 12 + 10 * value), end];
        }
        const curve = new THREE.CatmullRomCurve3(controls, false, 'centripetal');
        const geometry = new THREE.TubeGeometry(curve, 34, 1, 14, false);
        const positions = geometry.getAttribute('position');
        for (let i = 0; i <= 34; i++) {
          const t = i / 34, center = curve.getPointAt(t);
          const radius = width / 2 * (1 - 0.17 * t);
          for (let j = 0; j <= 14; j++) {
            const index = i * 15 + j;
            positions.setXYZ(index, center.x + (positions.getX(index) - center.x) * radius,
              center.y + (positions.getY(index) - center.y) * radius,
              center.z + (positions.getZ(index) - center.z) * radius);
          }
        }
        geometry.computeVertexNormals();
        this.tube.geometry.dispose(); this.tube.geometry = geometry;
        this.tipCap.position.copy(end);
        this.tipCap.scale.setScalar(width * 0.415);
        const tangent = curve.getTangent(1).normalize();
        this.nail.position.copy(end).addScaledVector(tangent, -width * 0.36);
        this.nail.position.z += width * 0.395;
        this.nail.scale.set(width * 0.285, width * 0.43, width * 0.055);
        this.nail.rotation.z = Math.atan2(tangent.y, tangent.x) - Math.PI / 2;
      }
    }
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.observer.disconnect();
    this.scene.traverse(object => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose();
      }
    });
    this.renderer.dispose();
  }
}
