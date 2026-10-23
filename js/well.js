/* ==========================================================================
   3D FORTRIS - WELL SCENE (THREE.js meshes for the playfield)
   One unit = one cell. Cell (x, y, z) sits at (x - W/2 + 0.5, y + 0.5,
   z - D/2 + 0.5), floor at y = 0. Everything lives under `world`, which
   WebXR scales and places in the room (identity on a flat screen).
   Locked blocks are one InstancedMesh (colour per instance); the far walls
   are the inside of a back-face box, so they never hide the blocks.
   ========================================================================== */

const THEMES = ['#00f0ff', '#a855f7', '#34ff9a', '#ffc93c', '#ff4fa3', '#38bdf8', '#f97316'];
const GHOST_COLOR = 0x38bdf8;
const MAX_PIECE = 8;

/** Soft studio reflections (canvas equirect -> PMREM), as in 3D Labyrinth's materials.js. */
function makeEnvironment(renderer) {
  const cv = document.createElement('canvas');
  cv.width = 1024; cv.height = 512;
  const g = cv.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, 512);
  sky.addColorStop(0, '#dfeeff'); sky.addColorStop(0.45, '#8a9bb3'); sky.addColorStop(0.55, '#3a4250'); sky.addColorStop(1, '#0d0f14');
  g.fillStyle = sky; g.fillRect(0, 0, 1024, 512);
  g.fillStyle = 'rgba(255,255,255,0.95)';
  g.fillRect(140, 60, 160, 70); g.fillRect(620, 40, 220, 60);
  g.fillStyle = 'rgba(255,214,160,0.8)'; g.fillRect(420, 150, 120, 40);
  g.fillStyle = 'rgba(120,220,255,0.6)'; g.fillRect(880, 170, 90, 50);
  const tex = new THREE.CanvasTexture(cv);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromEquirectangular(tex).texture;
  tex.dispose(); pmrem.dispose();
  return env;
}

/** A cube with bevelled edges, so stacked blocks read as separate pieces in depth. */
function bevelCube(size = 0.94, bevel = 0.07) {
  const h = size / 2 - bevel;
  const shape = new THREE.Shape();
  shape.moveTo(-h, -h); shape.lineTo(h, -h); shape.lineTo(h, h); shape.lineTo(-h, h); shape.lineTo(-h, -h);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: size - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 1 });
  geo.center();
  return geo;
}

/** One grid cell, tiled across the walls and floor. */
function gridTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(0, 0, 64, 64);
  g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = 2;
  g.strokeRect(1, 1, 62, 62);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

function makeStars() {
  const n = 700, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const r = 90 + Math.random() * 90, th = Math.random() * Math.PI * 2, ph = Math.acos(Math.random() * 2 - 1);
    pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
    pos[i * 3 + 1] = r * Math.cos(ph) * 0.8;
    pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return new THREE.Points(g, new THREE.PointsMaterial({ color: 0x8fb4ff, size: 0.6, sizeAttenuation: true }));
}

export class WellView {
  constructor(scene, renderer) {
    this.scene = scene;
    this.env = makeEnvironment(renderer);
    scene.background = new THREE.Color(0x020617);
    this.world = new THREE.Group();
    scene.add(this.world);
    this.well = new THREE.Group();
    this.world.add(this.well);

    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x141626, 0.6);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 0.85);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.bias = -0.0006;
    this.world.add(this.sun, this.sun.target);
    this.rim = new THREE.PointLight(0x93c5fd, 0.5, 0, 2);
    this.world.add(this.rim);

    this.stars = makeStars();
    scene.add(this.stars);

    this.cubeGeo = bevelCube();
    this.boxGeo = new THREE.BoxGeometry(0.97, 0.97, 0.97);
    this.gridTex = gridTexture();
    this.lockedMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.12, envMap: this.env, envMapIntensity: 0.6 });
    this.activeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25, metalness: 0.1, envMap: this.env, envMapIntensity: 0.7, emissive: 0x000000 });
    this.ghostMat = new THREE.MeshBasicMaterial({ color: GHOST_COLOR, transparent: true, opacity: 0.16, depthWrite: false });
    this.ghostEdgeMat = new THREE.LineBasicMaterial({ color: GHOST_COLOR, transparent: true, opacity: 0.75 });
    this.guideMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3 });
    this.markerMat = new THREE.MeshBasicMaterial({ color: GHOST_COLOR, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false });

    this.active = new THREE.InstancedMesh(this.cubeGeo, this.activeMat, MAX_PIECE);
    this.active.castShadow = true;
    this.active.count = 0;
    this.ghost = new THREE.InstancedMesh(this.boxGeo, this.ghostMat, MAX_PIECE);
    this.ghost.count = 0;
    this.ghostEdges = new THREE.LineSegments(new THREE.BufferGeometry(), this.ghostEdgeMat);
    this.ghostEdges.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_PIECE * 24 * 3), 3));
    this.guides = new THREE.LineSegments(new THREE.BufferGeometry(), this.guideMat);
    this.guides.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_PIECE * 2 * 3), 3));
    this.markers = new THREE.InstancedMesh(new THREE.CircleGeometry(0.3, 28).rotateX(-Math.PI / 2), this.markerMat, MAX_PIECE);
    this.markers.count = 0;
    for (const o of [this.ghostEdges, this.guides]) o.frustumCulled = false;
    this.bomb = this.makeBomb();
    this.well.add(this.active, this.ghost, this.ghostEdges, this.guides, this.markers, this.bomb);

    this.effects = [];
    this.disposables = [];
    this.opacity = 1;
    this.showGhost = true;
    this.showGuides = true;
    this.elapsed = 0;
    this.fade = null;
    this.size = null;
  }

  makeBomb() {
    const grp = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.42, 28, 18), new THREE.MeshStandardMaterial({ color: 0x1b1b24, roughness: 0.25, metalness: 0.6, envMap: this.env, envMapIntensity: 1 }));
    body.castShadow = true;
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.43, 0.05, 10, 32), new THREE.MeshBasicMaterial({ color: 0xf43f5e }));
    band.rotation.x = Math.PI / 2;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.14, 12), new THREE.MeshStandardMaterial({ color: 0x8b8b9a, metalness: 0.7, roughness: 0.3 }));
    cap.position.y = 0.44;
    this.spark = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffd34d }));
    this.spark.position.y = 0.62;
    grp.add(body, band, cap, this.spark);
    grp.visible = false;
    return grp;
  }

  track(...items) { this.disposables.push(...items); return items[0]; }

  cellPos(x, y, z, out = new THREE.Vector3()) {
    return out.set(x - this.size.width / 2 + 0.5, y + 0.5, z - this.size.depth / 2 + 0.5);
  }

  get extent() { return this.size ? { W: this.size.width, H: this.size.height, D: this.size.depth } : { W: 10, H: 20, D: 10 }; }

  /** (Re)build the well for a size: walls, floor, rim and the locked-block instance pool. */
  build(size, level = 1) {
    if (this.size && this.size.width === size.width && this.size.height === size.height) { this.setTheme(level); return; }
    this.size = { ...size };
    if (this.static) this.well.remove(this.static);
    if (this.locked) this.well.remove(this.locked);
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    const { width: W, height: H, depth: D } = size;
    const grp = this.static = new THREE.Group();

    // Far walls: inside faces of a box (BackSide) -> the two walls facing the camera always show, the near ones never block
    const wallMat = (rx, ry) => {
      const t = this.track(this.gridTex.clone());
      t.needsUpdate = true;
      t.repeat.set(rx, ry);
      return this.track(new THREE.MeshBasicMaterial({ map: t, color: 0x00f0ff, transparent: true, opacity: 0.32, side: THREE.BackSide, depthWrite: false }));
    };
    const hidden = this.track(new THREE.MeshBasicMaterial({ visible: false }));
    this.wallMats = [wallMat(D, H), wallMat(D, H), hidden, hidden, wallMat(W, H), wallMat(W, H)];
    const walls = new THREE.Mesh(this.track(new THREE.BoxGeometry(W, H, D)), this.wallMats);
    walls.position.y = H / 2;
    walls.renderOrder = -1;
    grp.add(walls);

    // Floor with the grid, receiving the falling piece's shadow
    const floorTex = this.track(this.gridTex.clone());
    floorTex.needsUpdate = true;
    floorTex.repeat.set(W, D);
    this.floorMat = this.track(new THREE.MeshStandardMaterial({ color: 0x0f1a33, emissive: 0x00f0ff, emissiveMap: floorTex, emissiveIntensity: 0.28, roughness: 0.85, metalness: 0.1 }));
    const floor = new THREE.Mesh(this.track(new THREE.PlaneGeometry(W, D)), this.floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    grp.add(floor);
    const base = new THREE.Mesh(this.track(new THREE.BoxGeometry(W + 0.8, 0.5, D + 0.8)),
      this.track(new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.5, metalness: 0.4, envMap: this.env, envMapIntensity: 0.4 })));
    base.position.y = -0.26;
    base.receiveShadow = true;
    grp.add(base);

    // Glowing rim along every edge of the well
    this.rimMat = this.track(new THREE.LineBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.9 }));
    const rim = new THREE.LineSegments(this.track(new THREE.EdgesGeometry(new THREE.BoxGeometry(W, H, D))), this.rimMat);
    rim.position.y = H / 2;
    grp.add(rim);
    // Spawn zone: a faint ring of the top layer
    const top = new THREE.LineSegments(this.track(new THREE.EdgesGeometry(new THREE.BoxGeometry(W, 0.001, D))), this.track(new THREE.LineBasicMaterial({ color: 0xff3b5c, transparent: true, opacity: 0.45 })));
    top.position.y = H - 2;
    grp.add(top);
    this.well.add(grp);

    this.locked = new THREE.InstancedMesh(this.cubeGeo, this.lockedMat, W * H * D);
    this.locked.castShadow = this.locked.receiveShadow = true;
    const c = new THREE.Color(1, 1, 1);
    for (let i = 0; i < W * H * D; i++) this.locked.setColorAt(i, c); // instanceColor must exist before the first render
    this.locked.count = 0;
    this.well.add(this.locked);

    // Sun + shadow frustum sized to the well
    const ext = Math.max(W, D) / 2 + 2;
    this.sun.position.set(ext * 0.35, H + 14, ext * 0.6);
    this.sun.target.position.set(0, 0, 0);
    Object.assign(this.sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: H + 30 });
    this.sun.shadow.camera.updateProjectionMatrix();
    this.rim.position.set(-W, H * 0.9, -D);
    this.setTheme(level);
  }

  setTheme(level) {
    const col = new THREE.Color(THEMES[(level - 1) % THEMES.length]);
    if (this.rimMat) this.rimMat.color.copy(col);
    if (this.wallMats) for (const m of this.wallMats) if (m.map) m.color.copy(col);
    if (this.floorMat) this.floorMat.emissive.copy(col);
  }

  setOpacity(o) {
    this.opacity = Math.max(0.2, Math.min(1, o));
    for (const m of [this.lockedMat, this.activeMat]) {
      const t = this.opacity < 1;
      if (m.transparent !== t) m.needsUpdate = true;
      m.transparent = t;
      m.opacity = this.opacity;
    }
  }

  /** Locked blocks (call whenever the grid changes). */
  setGrid(grid) {
    if (!this.locked) return;
    const m = new THREE.Matrix4(), p = new THREE.Vector3(), col = new THREE.Color();
    let i = 0;
    grid.forEach((layer, y) => layer.forEach((row, z) => row.forEach((cell, x) => {
      if (!cell) return;
      m.makeTranslation(...this.cellPos(x, y, z, p).toArray());
      this.locked.setMatrixAt(i, m);
      this.locked.setColorAt(i, col.set(cell.color));
      i++;
    })));
    this.locked.count = i;
    this.locked.instanceMatrix.needsUpdate = true;
    if (this.locked.instanceColor) this.locked.instanceColor.needsUpdate = true;
    this.fade = null;
  }

  /** Falling piece, landing ghost, drop guides and footprint markers. */
  setActive(cells, color, isBomb, landing) {
    const m = new THREE.Matrix4(), p = new THREE.Vector3();
    const isB = !!isBomb && cells.length > 0;
    this.bomb.visible = isB;
    this.active.count = isB ? 0 : cells.length;
    if (isB) this.cellPos(cells[0].x, cells[0].y, cells[0].z, this.bomb.position);
    else {
      cells.forEach((c, i) => this.active.setMatrixAt(i, m.makeTranslation(...this.cellPos(c.x, c.y, c.z, p).toArray())));
      this.active.instanceMatrix.needsUpdate = true;
      if (color) { this.activeMat.color.set(color); this.activeColor = this.activeMat.color.clone(); }
    }

    // Ghost: only when the piece is above its landing spot
    const dropped = landing && cells.length && landing[0].y !== cells[0].y;
    const ghost = this.showGhost && dropped ? landing : [];
    this.ghost.count = ghost.length;
    const ep = this.ghostEdges.geometry.attributes.position, h = 0.49;
    let e = 0;
    ghost.forEach((c, i) => {
      this.cellPos(c.x, c.y, c.z, p);
      this.ghost.setMatrixAt(i, m.makeTranslation(p.x, p.y, p.z));
      // 12 cube edges
      for (const [a, b] of [[[-1, -1, -1], [1, -1, -1]], [[-1, 1, -1], [1, 1, -1]], [[-1, -1, 1], [1, -1, 1]], [[-1, 1, 1], [1, 1, 1]],
        [[-1, -1, -1], [-1, 1, -1]], [[1, -1, -1], [1, 1, -1]], [[-1, -1, 1], [-1, 1, 1]], [[1, -1, 1], [1, 1, 1]],
        [[-1, -1, -1], [-1, -1, 1]], [[1, -1, -1], [1, -1, 1]], [[-1, 1, -1], [-1, 1, 1]], [[1, 1, -1], [1, 1, 1]]]) {
        ep.setXYZ(e++, p.x + a[0] * h, p.y + a[1] * h, p.z + a[2] * h);
        ep.setXYZ(e++, p.x + b[0] * h, p.y + b[1] * h, p.z + b[2] * h);
      }
    });
    ep.needsUpdate = true;
    this.ghostEdges.geometry.setDrawRange(0, e);
    this.ghost.instanceMatrix.needsUpdate = true;

    // Footprint: the lowest cell of each column -> a marker where it will land and a guide line down to it
    const foot = new Map();
    (landing || []).forEach((c, i) => {
      const k = `${c.x}:${c.z}`, from = cells[i];
      if (!foot.has(k) || c.y < foot.get(k).land.y) foot.set(k, { land: c, from });
    });
    const gp = this.guides.geometry.attributes.position;
    let n = 0, g = 0;
    for (const { land, from } of foot.values()) {
      this.cellPos(land.x, land.y, land.z, p);
      this.markers.setMatrixAt(n++, m.makeTranslation(p.x, land.y + 0.01, p.z));
      if (this.showGuides && dropped && from) {
        gp.setXYZ(g++, p.x, from.y, p.z);
        gp.setXYZ(g++, p.x, land.y + 1, p.z);
      }
    }
    this.markers.count = this.showGhost ? n : 0;
    this.markers.instanceMatrix.needsUpdate = true;
    gp.needsUpdate = true;
    this.guides.geometry.setDrawRange(0, g);
  }

  /* ---------------- Effects ---------------- */
  burst(points, { size = 0.18, life = 1.6, gravity = 9 } = {}) {
    const n = points.length, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), vel = new Float32Array(n * 3);
    points.forEach((q, i) => {
      pos.set([q.x, q.y, q.z], i * 3);
      vel.set([q.vx, q.vy, q.vz], i * 3);
      col.set([q.c.r, q.c.g, q.c.b], i * 3);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({ size, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    this.well.add(pts);
    this.effects.push({ kind: 'points', obj: pts, vel, t: 0, life, gravity });
  }

  flash(obj, life = 0.6, grow = 0.25) {
    this.well.add(obj);
    this.effects.push({ kind: 'flash', obj, t: 0, life, grow, base: obj.scale.clone(), op: obj.material.opacity });
  }

  /** Full layers: a bright slab per layer and the cleared cubes bursting outward in their colours. */
  clearBurst(cells, layers) {
    const { width: W, depth: D } = this.size, p = new THREE.Vector3(), c = new THREE.Color();
    const pts = [];
    for (const q of cells) {
      if (Math.random() > 0.6) continue;
      this.cellPos(q.x, q.y, q.z, p);
      const out = new THREE.Vector3(p.x, 0, p.z).normalize().multiplyScalar(2 + Math.random() * 4);
      pts.push({ x: p.x, y: p.y, z: p.z, vx: out.x, vy: 2 + Math.random() * 4, vz: out.z, c: c.set(q.color).clone() });
    }
    this.burst(pts, { size: 0.28, life: 1.4 });
    for (const y of layers) {
      const slab = new THREE.Mesh(new THREE.BoxGeometry(W + 0.2, 1, D + 0.2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending }));
      slab.position.y = y + 0.5;
      this.flash(slab, 0.55, 0.35);
    }
  }

  /** Bomb: fireball + the removed block flying apart. */
  bombBurst(at, removed = []) {
    const p = this.cellPos(at.x, at.y, at.z), pts = [];
    const fire = [0xffd34d, 0xff7a1a, 0xff3b5c, 0xffffff].map(h => new THREE.Color(h));
    for (let i = 0; i < 140; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).normalize().multiplyScalar(2 + Math.random() * 5);
      pts.push({ x: p.x, y: p.y - 0.3, z: p.z, vx: v.x, vy: v.y, vz: v.z, c: fire[i % fire.length] });
    }
    for (const r of removed) {
      const q = this.cellPos(r.x, r.y, r.z), c = new THREE.Color(r.color);
      for (let i = 0; i < 24; i++) pts.push({ x: q.x, y: q.y, z: q.z, vx: (Math.random() - 0.5) * 5, vy: 2 + Math.random() * 3, vz: (Math.random() - 0.5) * 5, c });
    }
    this.burst(pts, { size: 0.24, life: 1.1, gravity: 6 });
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.6, 20, 14), new THREE.MeshBasicMaterial({ color: 0xffb340, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
    ball.position.copy(p);
    this.flash(ball, 0.45, 2.2);
  }

  /** Level up: a ring of light sweeps up the well. */
  levelWave(level) {
    this.setTheme(level);
    const { width: W, depth: D } = this.size;
    const ring = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(W + 0.3, 0.05, D + 0.3)), new THREE.LineBasicMaterial({ color: THEMES[(level - 1) % THEMES.length], transparent: true, opacity: 1 }));
    this.well.add(ring);
    this.effects.push({ kind: 'wave', obj: ring, t: 0, life: 1.4 });
  }

  /** Game over: the stack greys out from the top down. */
  gameOverFade() {
    if (!this.locked || !this.locked.instanceColor) return;
    const n = this.locked.count, from = [], m = new THREE.Matrix4(), p = new THREE.Vector3(), c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      this.locked.getMatrixAt(i, m); p.setFromMatrixPosition(m);
      this.locked.getColorAt(i, c);
      from.push({ y: p.y, c: c.clone() });
    }
    this.fade = { t: 0, from, top: this.size.height };
  }

  clearEffects() {
    for (const e of this.effects) { this.well.remove(e.obj); e.obj.geometry.dispose(); e.obj.material.dispose(); }
    this.effects = [];
    this.fade = null;
  }

  update(dt, gravityOn) {
    this.elapsed += dt;
    this.stars.rotation.y += dt * 0.01;
    // Falling piece glows a little while it waits to be released (HOLD)
    if (this.activeColor) this.activeMat.emissive.copy(this.activeColor).multiplyScalar(gravityOn ? 0.18 : 0.18 + 0.14 * (1 + Math.sin(this.elapsed * 5)));
    if (this.bomb.visible) { this.spark.scale.setScalar(0.8 + Math.random() * 0.7); this.bomb.rotation.y += dt; }
    this.markerMat.opacity = 0.35 + Math.sin(this.elapsed * 4) * 0.15;

    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      e.t += dt;
      const k = e.t / e.life;
      if (e.kind === 'points') {
        const p = e.obj.geometry.attributes.position, v = e.vel;
        for (let j = 0; j < v.length; j += 3) {
          v[j + 1] -= e.gravity * dt; v[j] *= 0.985; v[j + 2] *= 0.985;
          p.array[j] += v[j] * dt; p.array[j + 1] += v[j + 1] * dt; p.array[j + 2] += v[j + 2] * dt;
        }
        p.needsUpdate = true;
        e.obj.material.opacity = Math.max(0, 1 - Math.max(0, k - 0.5) * 2);
      } else if (e.kind === 'flash') {
        e.obj.scale.copy(e.base).multiplyScalar(1 + e.grow * k);
        e.obj.material.opacity = e.op * Math.max(0, 1 - k);
      } else if (e.kind === 'wave') {
        e.obj.position.y = k * this.size.height;
        e.obj.material.opacity = Math.max(0, 1 - k);
      }
      if (k >= 1) { this.well.remove(e.obj); e.obj.geometry.dispose(); e.obj.material.dispose(); this.effects.splice(i, 1); }
    }

    if (this.fade && this.locked) {
      const f = this.fade, gray = new THREE.Color(0x3b4252), c = new THREE.Color();
      f.t += dt;
      const front = f.top - f.t * f.top / 1.2; // sweeps top -> bottom in 1.2 s
      f.from.forEach((b, i) => { if (b.y >= front) this.locked.setColorAt(i, c.copy(b.c).lerp(gray, Math.min(1, (b.y - front) / 2))); });
      this.locked.instanceColor.needsUpdate = true;
      if (f.t > 2) this.fade = null;
    }
  }
}
