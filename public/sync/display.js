// The screen image: virtual middle + distal phalanx inside a shallow box behind the glass,
// rendered with an off-axis projection for a given eye position (screen frame, mm).
// Screen frame: origin = screen centre, x = right, y = up (toward the far edge), z = out of the screen.
import * as THREE from 'three';

const rad = (d) => d * Math.PI / 180;

function gridTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  g.fillStyle = '#d9dde3'; g.fillRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(40,48,60,.22)'; g.lineWidth = 2;
  for (let i = 0; i <= 256; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(256, i); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

export class Display {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    this.renderer.localClippingEnabled = true;
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x15171c);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera();
    this.camera.matrixAutoUpdate = true;
    this.clip = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0); // keep z <= 0 (inside the screen)
    this.pose = { thp: 70, thd: 20, ok: false };
    this.cfg = null;
    this.root = new THREE.Group(); this.scene.add(this.root);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x6a707a, 1.7));
    this.sun = new THREE.DirectionalLight(0xffffff, 1.6); this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024); this.sun.shadow.radius = 4; this.sun.shadow.bias = -0.0008;
    const sc = this.sun.shadow.camera; sc.left = -160; sc.right = 160; sc.top = 160; sc.bottom = -160; sc.near = 10; sc.far = 900;
    this.scene.add(this.sun, this.sun.target);
    this.tex = gridTexture();
    const mat = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.0, clippingPlanes: [this.clip], transparent: true });
    this.matMid = mat(0x4a86e8); this.matDist = mat(0xf0953a);
    this.mid = new THREE.Mesh(new THREE.BufferGeometry(), this.matMid);
    this.dist = new THREE.Mesh(new THREE.BufferGeometry(), this.matDist);
    for (const m of [this.mid, this.dist]) { m.castShadow = true; this.scene.add(m); }
    this.geomKey = '';
  }

  // cfg: { mmPerPx, pipFrac:{x,y}, Lm, Ld, dia }
  layout(cfg) {
    this.cfg = cfg;
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.Wm = w * cfg.mmPerPx; this.Hm = h * cfg.mmPerPx;
    this.pip = new THREE.Vector2((cfg.pipFrac.x - 0.5) * this.Wm, (0.5 - cfg.pipFrac.y) * this.Hm);
    this.buildBox();
    const key = [cfg.Lm, cfg.Ld, cfg.dia].join();
    if (key !== this.geomKey) {
      this.geomKey = key; const r = cfg.dia / 2;
      this.mid.geometry.dispose(); this.dist.geometry.dispose();
      this.mid.geometry = new THREE.CapsuleGeometry(r, cfg.Lm, 8, 24);
      this.dist.geometry = new THREE.CapsuleGeometry(r * 0.9, Math.max(1, cfg.Ld - r * 0.9), 8, 24);
    }
  }

  buildBox() {
    this.root.clear();
    const P = this.pip, Wm = this.Wm, Hm = this.Hm;
    // fullBox: the whole screen is a window into the box (iPad). Otherwise a box around the PIP (PC lab).
    const mg = 6;
    const [bx0, bx1, by0, by1, D] = this.cfg.fullBox
      ? [-Wm / 2 + mg, Wm / 2 - mg, -Hm / 2 + mg, Hm / 2 - mg, 90]
      : [P.x - 75, P.x + 75, P.y - 40, P.y + 110, 80];
    const sc = this.sun.shadow.camera, ext = Math.max(160, Math.hypot(Wm, Hm) / 2 + 40);
    sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.updateProjectionMatrix();
    this.box = { bx0, bx1, by0, by1, D };
    const wall = new THREE.MeshStandardMaterial({ map: this.tex, roughness: 0.9, side: THREE.FrontSide });
    const addPlane = (w, h, pos, rot, rep) => {
      const t = this.tex.clone(); t.repeat.set(w / 20 * rep, h / 20 * rep); t.needsUpdate = true;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), wall.clone()); m.material.map = t;
      m.position.copy(pos); m.rotation.set(...rot); m.receiveShadow = true; this.root.add(m);
    };
    const cx = (bx0 + bx1) / 2, cy = (by0 + by1) / 2, bw = bx1 - bx0, bh = by1 - by0;
    addPlane(bw, bh, new THREE.Vector3(cx, cy, -D), [0, 0, 0], 1);                       // back
    addPlane(D, bh, new THREE.Vector3(bx0, cy, -D / 2), [0, Math.PI / 2, 0], 1);          // left
    addPlane(D, bh, new THREE.Vector3(bx1, cy, -D / 2), [0, -Math.PI / 2, 0], 1);         // right
    addPlane(bw, D, new THREE.Vector3(cx, by0, -D / 2), [-Math.PI / 2, 0, 0], 1);         // bottom (near edge)
    addPlane(bw, D, new THREE.Vector3(cx, by1, -D / 2), [Math.PI / 2, 0, 0], 1);          // top (far edge)
    // opaque screen surface around the window, at z = 0
    const frame = new THREE.MeshBasicMaterial({ color: 0x15171c });
    const rect = (x0, y0, x1, y1) => { if (x1 <= x0 || y1 <= y0) return; const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, y1 - y0), frame); m.position.set((x0 + x1) / 2, (y0 + y1) / 2, 0); this.root.add(m); };
    const X0 = -Wm, X1 = Wm, Y0 = -Hm, Y1 = Hm;
    rect(X0, Y0, X1, by0); rect(X0, by1, X1, Y1); rect(X0, by0, bx0, by1); rect(bx1, by0, X1, by1);
    // window rim
    const rim = new THREE.LineBasicMaterial({ color: 0x3a404b });
    const pts = [[bx0, by0], [bx1, by0], [bx1, by1], [bx0, by1], [bx0, by0]].map(([x, y]) => new THREE.Vector3(x, y, 0.05));
    this.root.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), rim));
    // PIP ring on the glass
    const ring = new THREE.Mesh(new THREE.RingGeometry(8, 10.5, 48), new THREE.MeshBasicMaterial({ color: 0xff4d4d }));
    ring.position.set(P.x, P.y, 0.1); this.root.add(ring);
    const dot = new THREE.Mesh(new THREE.CircleGeometry(1.4, 24), new THREE.MeshBasicMaterial({ color: 0xff4d4d }));
    dot.position.set(P.x, P.y, 0.1); this.root.add(dot);
    // light from the upper front
    if (this.cfg.sideLight) { // from the left: the virtual finger's shadow falls sideways on the back wall and shows its length
      this.sun.position.set(P.x - 230, P.y + 60, 150); this.sun.target.position.set(P.x + 20, P.y + 10, -D);
    } else { this.sun.position.set(P.x + 70, P.y + 160, 260); this.sun.target.position.set(P.x, P.y + 30, -D); }
  }

  setPose(thp, thd, ok) { this.pose = { thp, thd, ok }; }

  // segment endpoints in the screen frame (mm), shared with tests
  geometry(thp, thd) {
    const r = this.cfg.dia / 2, P = new THREE.Vector3(this.pip.x, this.pip.y, r);
    const u = new THREE.Vector3(0, Math.cos(rad(thp)), -Math.sin(rad(thp)));         // virtual middle = point-symmetric extension of the proximal
    const e = rad(thp - thd), dd = new THREE.Vector3(0, Math.cos(e), -Math.sin(e));   // virtual distal, flexed by thd toward the palm side
    const vdip = P.clone().addScaledVector(u, this.cfg.Lm);
    const tip = vdip.clone().addScaledVector(dd, this.cfg.Ld);
    return { P, u, dd, vdip, tip };
  }

  placeCapsule(mesh, a, dir, L) {
    mesh.position.copy(a).addScaledVector(dir, L / 2);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  }

  render(eye) {
    if (!this.cfg) return;
    const { thp, thd, ok } = this.pose, r = this.cfg.dia / 2;
    const G = this.geometry(thp, thd);
    // keep the virtual finger inside the box (the box is deep enough for the full range; clamp just in case)
    this.placeCapsule(this.mid, G.P, G.u, this.cfg.Lm);
    this.placeCapsule(this.dist, G.vdip, G.dd, Math.max(1, this.cfg.Ld - r * 0.9));
    // how long the virtual middle looks from the eye (1 = full length, 0 = seen end-on)
    const toEye = new THREE.Vector3(eye.x, eye.y, eye.z).sub(G.P).normalize();
    this.lastForeshort = Math.sqrt(Math.max(0, 1 - toEye.dot(G.u) ** 2));
    const op = ok ? 1 : 0.35;
    this.matMid.opacity = op; this.matDist.opacity = op;
    this.matMid.depthWrite = ok; this.matDist.depthWrite = ok;
    // off-axis projection for the eye
    const n = 5, f = 4000, E = eye, Wm = this.Wm, Hm = this.Hm;
    const ez = Math.max(40, E.z);
    const l = (-Wm / 2 - E.x) * n / ez, rr = (Wm / 2 - E.x) * n / ez, b = (-Hm / 2 - E.y) * n / ez, t = (Hm / 2 - E.y) * n / ez;
    this.camera.position.set(E.x, E.y, ez); this.camera.quaternion.identity(); this.camera.updateMatrixWorld();
    this.camera.projectionMatrix.makePerspective(l, rr, t, b, n, f);
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
    this.renderer.render(this.scene, this.camera);
  }

  // screen-px position of the PIP ring (for DOM labels)
  pipScreenPx() { return { x: this.cfg.pipFrac.x * innerWidth, y: this.cfg.pipFrac.y * innerHeight }; }
}
