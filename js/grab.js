/* ==========================================================================
   3D FORTRIS - IN-SCENE CONTROLS ("grab")
   Controls that live inside the 3D scene, so they fuse in every stereo mode
   (the HTML touch pad sits at screen depth and never fuses in cross / parallel
   view):
     - the piece itself: drag it to move it across the well, tap it for the
       rotation rings (red X, green Y, blue Z), drag along a ring to turn it 90°
     - a rope ties the waiting piece to a post at the near corner of the well:
       tap the rope or the post's ✂ button to cut it and release the piece;
       while it falls the post shows ⤓, tap it for a hard drop
     - a 3D cursor at the pointer, drawn for both eyes so it fuses too
     - Meta Quest: point and pull the trigger (same as a tap / drag), squeeze
       the grip to hold the piece and twist your wrist to turn it, move your
       hand a cell to slide it
   Picking uses the camera of the eye whose half was touched (left / right /
   swapped / cross), not the centre camera: a piece off the zero-parallax
   plane would otherwise be missed by its parallax.
   Everything is in the well's local frame (one unit = one cell), so it
   scales with the well in VR.
   ========================================================================== */

const AXES = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
const RING_COLORS = { x: 0xff4d6d, y: 0x34ff9a, z: 0x4da3ff };
const TAP_PX = 10, TAP_MS = 350;      // a press that moves less than this is a tap
const RING_STEP = 1.0;                // radians of drag along a ring for one quarter turn (~57°)
const TWIST_STEP = 0.85;              // radians of wrist twist (Quest grip) for one quarter turn
const PICK = { rope: 0.42, ring: 0.42, post: 0.75, pad: 0.35 }; // pick tolerances in cells
const ROPE_FROM = 0.22;               // the rope near the piece doesn't count as rope (that's the piece)
const CUT_TIME = 0.45;

function glowTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(160,250,255,0.95)');
  grd.addColorStop(0.55, 'rgba(0,240,255,0.35)');
  grd.addColorStop(1, 'rgba(0,240,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
}

function iconTexture(text, color) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  g.fillStyle = 'rgba(2,6,23,0.78)';
  g.beginPath(); g.arc(64, 64, 58, 0, Math.PI * 2); g.fill();
  g.lineWidth = 7; g.strokeStyle = color; g.stroke();
  g.fillStyle = '#ffffff'; g.font = '700 70px system-ui, "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 64, 70);
  const t = new THREE.CanvasTexture(cv);
  t.minFilter = THREE.LinearFilter;
  return t;
}

/** Axis-angle of a quaternion as a rotation vector (angle in [-π, π]). */
function rotationVector(q) {
  const w = Math.max(-1, Math.min(1, q.w));
  let angle = 2 * Math.acos(w);
  const s = Math.sqrt(1 - w * w);
  if (s < 1e-6) return new THREE.Vector3();
  if (angle > Math.PI) angle -= 2 * Math.PI;
  return new THREE.Vector3(q.x / s, q.y / s, q.z / s).multiplyScalar(angle);
}

/** Nearest grid axis to a vector: ['x' | 'y' | 'z', ±1]. */
export function snapAxis(v) {
  const ax = Math.abs(v.x), ay = Math.abs(v.y), az = Math.abs(v.z);
  if (ax >= ay && ax >= az) return ['x', Math.sign(v.x) || 1];
  if (ay >= az) return ['y', Math.sign(v.y) || 1];
  return ['z', Math.sign(v.z) || 1];
}

export class GrabControls {
  /** @param {object} app the GameApp (game, well, renderer, audio, controls, hud) */
  constructor(app) {
    this.app = app;
    this.root = new THREE.Group();
    app.well.well.add(this.root);
    this.raycaster = new THREE.Raycaster();
    this.ringsOn = false;
    this.drag = null;          // active pointer drag (touch / mouse)
    this.hover = null;         // what the mouse / ray is over (for highlights)
    this.cursorAt = null;      // { point (local), until (s) }
    this.elapsed = 0;
    this.cut = null;           // rope-cut animation
    this.xr = [];              // per Quest controller state
    this.ropeKey = '';
    this.post = { corner: null, pos: new THREE.Vector3(), ready: false };

    this.buildCursor();
    this.buildPost();
    this.buildRope();
    this.buildRings();
  }

  /* ------------------------------ Scene objects ------------------------------ */
  buildCursor() {
    this.glowTex = glowTexture();
    this.cursor = this.makeCursor();
    this.root.add(this.cursor);
  }

  makeCursor() {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, depthTest: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending }));
    s.scale.setScalar(0.55);
    s.renderOrder = 990;
    s.visible = false;
    return s;
  }

  buildPost() {
    const g = this.postGroup = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 1.3, 10),
      new THREE.MeshStandardMaterial({ color: 0x9aa4b8, metalness: 0.7, roughness: 0.3, envMap: this.app.well.env }));
    pole.position.y = -0.65;
    this.buttonMat = new THREE.MeshStandardMaterial({ color: 0xffb340, emissive: 0xff7a1a, emissiveIntensity: 0.6, roughness: 0.35, metalness: 0.2 });
    const button = this.button = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.4, 0.2, 28), this.buttonMat);
    this.icons = { cut: iconTexture('✂', '#ffb340'), fast: iconTexture('⤓', '#ff3b5c') };
    this.icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.icons.cut, depthWrite: false, transparent: true }));
    this.icon.scale.setScalar(0.85);
    this.icon.position.y = 0.62;
    this.icon.renderOrder = 980;
    g.add(pole, button, this.icon);
    g.visible = false;
    this.root.add(g);
  }

  buildRope() {
    this.ropeMat = new THREE.MeshStandardMaterial({ color: 0xf5e6c8, emissive: 0x6b5a3a, emissiveIntensity: 0.5, roughness: 0.8, transparent: true });
    this.rope = new THREE.Mesh(new THREE.BufferGeometry(), this.ropeMat);
    this.rope.frustumCulled = false;
    this.knot = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 8), this.ropeMat);
    this.rope.visible = this.knot.visible = false;
    this.root.add(this.rope, this.knot);
    this.ropePts = [];
  }

  buildRings() {
    this.rings = new THREE.Group();
    this.ringMeshes = {};
    for (const a of ['x', 'y', 'z']) {
      const m = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: RING_COLORS[a], transparent: true, opacity: 0.55, depthWrite: false }));
      m.renderOrder = 970;
      m.userData = { axis: a, radius: 0 };
      this.ringMeshes[a] = m;
      this.rings.add(m);
    }
    this.rings.visible = false;
    this.root.add(this.rings);
  }

  /* ------------------------------ Piece geometry (local) ------------------------------ */
  get active() { const g = this.app.game; return this.app.state === 'PLAYING' && !this.app.hud.dialogVisible && g.active && !g.over; }

  pieceInfo() {
    const g = this.app.game, w = this.app.well;
    const cells = g.cellsOf();
    if (!cells.length || !w.size) return null;
    const min = new THREE.Vector3(Infinity, Infinity, Infinity), max = new THREE.Vector3(-Infinity, -Infinity, -Infinity), p = new THREE.Vector3();
    for (const c of cells) { w.cellPos(c.x, c.y, c.z, p); min.min(p); max.max(p); }
    min.subScalar(0.5); max.addScalar(0.5);
    const centre = min.clone().add(max).multiplyScalar(0.5), half = max.clone().sub(min).multiplyScalar(0.5);
    // Rope attaches to the middle of the piece's top face
    let top = -Infinity; for (const c of cells) top = Math.max(top, c.y + 1);
    const tops = cells.filter(c => c.y + 1 === top).map(c => w.cellPos(c.x, c.y, c.z, new THREE.Vector3()));
    const attach = tops.reduce((s, v) => s.add(v), new THREE.Vector3()).divideScalar(tops.length);
    attach.y = top;
    return { cells, box: new THREE.Box3(min, max), centre, half, attach };
  }

  ringRadius(info, axis) {
    const h = info.half;
    const r = axis === 'x' ? Math.hypot(h.y, h.z) : axis === 'y' ? Math.hypot(h.x, h.z) : Math.hypot(h.x, h.y);
    return r + 0.45;
  }

  /** A point on axis ring at angle t (right-handed about the axis). */
  ringPoint(axis, centre, r, t, out = new THREE.Vector3()) {
    const c = Math.cos(t) * r, s = Math.sin(t) * r;
    // x: y -> z ; y: z -> x ; z: x -> y  (matches the game's +90° rotations)
    if (axis === 'x') return out.set(centre.x, centre.y + c, centre.z + s);
    if (axis === 'y') return out.set(centre.x + s, centre.y, centre.z + c);
    return out.set(centre.x + c, centre.y + s, centre.z);
  }

  ringAngle(axis, v) { // v = point - centre
    if (axis === 'x') return Math.atan2(v.z, v.y);
    if (axis === 'y') return Math.atan2(v.x, v.z);
    return Math.atan2(v.y, v.x);
  }

  /* ------------------------------ Rays ------------------------------ */
  /** The world ray under a pointer event, cast from the eye whose half of the canvas was touched. */
  eyeRay(e) {
    const r = this.app.renderer, canvas = r.renderer.domElement, rect = canvas.getBoundingClientRect();
    let u = (e.clientX - rect.left) / rect.width;
    const v = (e.clientY - rect.top) / rect.height;
    let cam = r.mainCamera, eyeW = rect.width, offX = rect.left;
    if (r.isDualView) {
      const leftHalf = u < 0.5;
      u = leftHalf ? u * 2 : (u - 0.5) * 2;
      eyeW = rect.width / 2;
      offX = rect.left + (leftHalf ? 0 : eyeW);
      const lc = r.swapEyes ? r.cameraR : r.cameraL, rc = r.swapEyes ? r.cameraL : r.cameraR;
      const halfShowsLc = r.mode === 'cross' ? !leftHalf : leftHalf; // renderer draws the "left" camera on the right in cross mode
      cam = halfShowsLc ? lc : rc;
    }
    this.raycaster.setFromCamera({ x: u * 2 - 1, y: 1 - v * 2 }, cam);
    return { ray: this.raycaster.ray.clone(), cam, view: { x: offX, y: rect.top, w: eyeW, h: rect.height } };
  }

  toLocalRay(worldRay) {
    const inv = new THREE.Matrix4().copy(this.app.well.well.matrixWorld).invert();
    return worldRay.clone().applyMatrix4(inv);
  }

  /** Screen pixel of a local point, seen by an eye camera in a viewport. */
  toScreen(local, cam, view) {
    const p = this.app.well.well.localToWorld(local.clone()).project(cam);
    return new THREE.Vector2(view.x + (p.x + 1) / 2 * view.w, view.y + (1 - p.y) / 2 * view.h);
  }

  /**
   * What a local ray points at, nearest first: post button, rope, a ring, the piece body.
   * Returns { kind, t, point, axis? } or null.
   */
  pick(ray) {
    if (!this.active) return null;
    const hits = [], info = this.pieceInfo();
    const tmp = new THREE.Vector3(), onRay = new THREE.Vector3(), onSeg = new THREE.Vector3();
    if (this.postGroup.visible) {
      const c = this.button.getWorldPosition(new THREE.Vector3());
      this.app.well.well.worldToLocal(c);
      if (ray.intersectSphere(new THREE.Sphere(c, PICK.post), tmp)) hits.push({ kind: 'post', t: ray.origin.distanceTo(tmp), point: tmp.clone() });
    }
    if (this.rope.visible && this.ropePts.length > 1) {
      let best = null;
      const from = Math.floor(this.ropePts.length * ROPE_FROM);
      for (let i = from; i < this.ropePts.length - 1; i++) {
        const d = Math.sqrt(ray.distanceSqToSegment(this.ropePts[i], this.ropePts[i + 1], onRay, onSeg));
        if (d < PICK.rope && (!best || d < best.d)) best = { d, t: ray.origin.distanceTo(onRay), point: onSeg.clone() };
      }
      if (best) hits.push({ kind: 'rope', t: best.t, point: best.point });
    }
    if (info && this.ringsOn) {
      for (const a of ['x', 'y', 'z']) {
        const R = this.ringRadius(info, a);
        let best = null;
        for (let i = 0; i < 64; i++) {
          const p = this.ringPoint(a, info.centre, R, i / 64 * Math.PI * 2, tmp);
          const d = Math.sqrt(ray.distanceSqToPoint(p));
          if (d < PICK.ring && (!best || d < best.d)) best = { d, point: p.clone() };
        }
        if (best) {
          ray.closestPointToPoint(best.point, onRay);
          hits.push({ kind: 'ring', axis: a, t: ray.origin.distanceTo(onRay), point: best.point, centre: info.centre.clone(), radius: R });
        }
      }
    }
    if (info) {
      const box = info.box.clone().expandByScalar(PICK.pad);
      if (ray.intersectBox(box, tmp)) hits.push({ kind: 'piece', t: ray.origin.distanceTo(tmp), point: tmp.clone(), centre: info.centre.clone() });
    }
    if (!hits.length) return null;
    // The thin targets win when they are under the pointer at all: post, then rope, then a ring
    // (a ring sits around the piece, the rope can run right past it when the piece is near the post)
    for (const kind of ['post', 'rope', 'ring']) {
      const h = hits.filter(x => x.kind === kind).sort((p, q) => p.t - q.t)[0];
      if (h) return h;
    }
    return hits[0];
  }

  /* ------------------------------ Pointer (touch / mouse) ------------------------------ */
  bind(surface) {
    surface.addEventListener('pointermove', e => this.onPointerMove(e));
    const end = e => this.onPointerUp(e);
    surface.addEventListener('pointerup', end);
    surface.addEventListener('pointercancel', end);
    surface.addEventListener('pointerleave', e => { if (!this.drag && e.pointerType === 'mouse') this.hideCursor(); });
  }

  /** Called from the orbit handler's pointerdown: true = the press is ours (no orbit). */
  onPointerDown(e) {
    if (this.drag || this.app.inVR) return false;
    if (e.pointerType === 'mouse' && e.button !== 0) return false;
    const { ray: wr, cam, view } = this.eyeRay(e);
    const ray = this.toLocalRay(wr);
    const hit = this.pick(ray);
    this.showCursorOnRay(ray, wr, cam, hit);
    if (!hit) { if (e.pointerType !== 'mouse') this.cursorAt.until = this.elapsed + 0.25; return false; }
    this.app.audio.ensureContext();
    try { e.currentTarget && e.currentTarget.setPointerCapture && e.currentTarget.setPointerCapture(e.pointerId); } catch (_) { /* gone */ }
    if (hit.kind === 'post') { this.pressPost(); this.drag = { id: e.pointerId, kind: 'done' }; return true; }
    if (hit.kind === 'rope') { this.cutRope(hit.point); this.drag = { id: e.pointerId, kind: 'done' }; return true; }
    const start = new THREE.Vector2(e.clientX, e.clientY);
    if (hit.kind === 'ring') {
      const v = hit.point.clone().sub(hit.centre);
      const tangent = AXES[hit.axis].clone().cross(v).normalize();
      const a = this.toScreen(hit.point, cam, view), b = this.toScreen(hit.point.clone().add(tangent), cam, view);
      const c = this.toScreen(hit.centre, cam, view);
      const toCam = cam.getWorldPosition(new THREE.Vector3());
      this.app.well.well.worldToLocal(toCam).sub(hit.centre);
      this.drag = { id: e.pointerId, kind: 'ring', axis: hit.axis, radius: hit.radius, start, last: start.clone(), acc: 0,
        tan: b.sub(a), centre2: c, facing: Math.sign(toCam.dot(AXES[hit.axis])) || 1, moved: 0 };
      this.ringMeshes[hit.axis].material.opacity = 1;
      return true;
    }
    // Piece body: drag moves it across the well; a tap shows / hides the rings
    const c = hit.centre;
    const o = this.toScreen(c, cam, view);
    const ex = this.toScreen(c.clone().add(AXES.x), cam, view).sub(o);
    const ez = this.toScreen(c.clone().add(AXES.z), cam, view).sub(o);
    this.drag = { id: e.pointerId, kind: 'move', start, t0: performance.now(), ex, ez, done: { x: 0, z: 0 }, moved: 0, bumped: false };
    return true;
  }

  onPointerMove(e) {
    const d = this.drag;
    if (!d || d.id !== e.pointerId) {
      // Hover: the 3D cursor follows the mouse (in SBS the OS pointer only shows in one half)
      if (!this.drag && e.pointerType === 'mouse' && this.app.state === 'PLAYING' && !this.app.inVR) {
        const { ray: wr, cam } = this.eyeRay(e);
        const ray = this.toLocalRay(wr);
        const hit = this.pick(ray);
        this.hover = hit;
        this.showCursorOnRay(ray, wr, cam, hit);
      }
      return;
    }
    e.preventDefault();
    const { ray: wr, cam } = this.eyeRay(e);
    this.showCursorOnRay(this.toLocalRay(wr), wr, cam, null);
    const p = new THREE.Vector2(e.clientX, e.clientY);
    d.moved = Math.max(d.moved, p.distanceTo(d.start));
    if (d.kind === 'ring') {
      let dTheta;
      const tl = d.tan.length();
      if (tl > 6) {
        const step = p.clone().sub(d.last);
        dTheta = step.dot(d.tan) / (tl * tl) / d.radius; // arc length in cells / radius
      } else { // ring tangent points at the eye: turn by the angle around the ring's centre on screen
        const a0 = Math.atan2(-(d.last.y - d.centre2.y), d.last.x - d.centre2.x);
        const a1 = Math.atan2(-(p.y - d.centre2.y), p.x - d.centre2.x);
        let da = a1 - a0; if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI;
        dTheta = da * d.facing;
      }
      d.last = p;
      d.acc += dTheta;
      while (Math.abs(d.acc) >= RING_STEP) {
        const dir = Math.sign(d.acc);
        d.acc -= dir * RING_STEP;
        this.rotate(d.axis, dir);
      }
    } else if (d.kind === 'move') {
      const v = p.clone().sub(d.start);
      const cells = this.solveCells(v, d.ex, d.ez);
      this.moveTo(d, Math.round(cells.x), Math.round(cells.z));
    }
  }

  onPointerUp(e) {
    const d = this.drag;
    if (!d || d.id !== e.pointerId) return;
    if (d.kind === 'move' && d.moved < TAP_PX && performance.now() - d.t0 < TAP_MS && !d.done.x && !d.done.z) this.toggleRings();
    if (d.kind === 'ring') this.ringMeshes[d.axis].material.opacity = 0.55;
    this.drag = null;
    if (e.pointerType !== 'mouse') this.hideCursor(0.25);
  }

  /** Drag vector (px) -> cells along x / z, from the screen images of one cell along each axis. */
  solveCells(v, ex, ez) {
    const det = ex.x * ez.y - ex.y * ez.x;
    const lx = ex.length(), lz = ez.length();
    if (Math.abs(det) > 0.25 * lx * lz && lx > 1 && lz > 1) {
      return { x: (v.x * ez.y - v.y * ez.x) / det, z: (ex.x * v.y - ex.y * v.x) / det };
    }
    // One axis is seen end-on (side view): move only along the one that shows
    const ax = lx > 1 ? v.dot(ex) / (lx * lx) : 0, az = lz > 1 ? v.dot(ez) / (lz * lz) : 0;
    return Math.abs(ax) * lx >= Math.abs(az) * lz ? { x: ax, z: 0 } : { x: 0, z: az };
  }

  /** Step the piece one cell at a time towards the dragged offset (stops at walls / blocks). */
  moveTo(d, tx, tz) {
    const g = this.app.game;
    for (const k of ['x', 'z']) {
      const target = k === 'x' ? tx : tz;
      while (d.done[k] !== target) {
        const s = Math.sign(target - d.done[k]);
        const offset = { x: k === 'x' ? s : 0, y: 0, z: k === 'z' ? s : 0 };
        if (!g.shift(offset)) { if (!d.bumped) { g.emit('bump', { offset }); d.bumped = true; } break; }
        d.done[k] += s;
        d.bumped = false;
        g.emit('move', { offset });
      }
    }
  }

  rotate(axis, dir) {
    if (!this.active) return false;
    const ok = this.app.game.rotate(axis, dir);
    this.app.vibrate(ok ? 10 : [6, 30, 6]);
    return ok;
  }

  toggleRings() {
    this.ringsOn = !this.ringsOn;
    this.app.audio.playTick();
  }

  /** The post's button: ✂ releases the waiting piece, ⤓ slams a falling one down. */
  pressPost() {
    if (!this.active) return;
    this.button.position.y = -0.08; // pressed in; springs back in update()
    if (!this.app.game.gravity) this.cutRope(this.ropeCut());
    else { this.app.game.hardDrop(); this.app.vibrate(25); }
  }

  ropeCut() { return this.ropePts.length ? this.ropePts[Math.floor(this.ropePts.length * 0.55)].clone() : null; }

  /** Cut the rope where it was touched (or in the middle) and release the piece. */
  cutRope(at) {
    if (!this.active || this.app.game.gravity) return;
    this.cutAt = at;
    this.app.game.release(); // emits 'release' -> onRelease() animates the cut
  }

  /** The piece was released (by any input): the rope snaps. */
  onRelease() {
    if (!this.ropePts.length || !this.rope.visible) return;
    const pts = this.ropePts.map(p => p.clone());
    let k = Math.floor(pts.length * 0.55);
    if (this.cutAt) {
      let best = Infinity;
      pts.forEach((p, i) => { const d = p.distanceTo(this.cutAt); if (d < best) { best = d; k = i; } });
      k = Math.max(2, Math.min(pts.length - 3, k));
    }
    this.cutAt = null;
    this.disposeCut();
    const mk = () => { const m = new THREE.Mesh(new THREE.BufferGeometry(), this.ropeMat.clone()); m.frustumCulled = false; this.root.add(m); return m; };
    this.cut = { t: 0, anchorSide: pts.slice(0, k + 1), pieceSide: pts.slice(k), a: mk(), b: mk() };
    this.rope.visible = this.knot.visible = false;
    this.ropeKey = '';
    const p = pts[k], c = new THREE.Color(0xffd34d), q = [];
    for (let i = 0; i < 26; i++) q.push({ x: p.x, y: p.y, z: p.z, vx: (Math.random() - 0.5) * 4, vy: Math.random() * 3, vz: (Math.random() - 0.5) * 4, c });
    this.app.well.burst(q, { size: 0.16, life: 0.6, gravity: 8 });
    this.app.audio.playSnip();
    this.app.vibrate([15, 20, 10]);
  }

  disposeCut() {
    if (!this.cut) return;
    for (const m of [this.cut.a, this.cut.b]) { this.root.remove(m); m.geometry.dispose(); m.material.dispose(); }
    this.cut = null;
  }

  /* ------------------------------ Cursor ------------------------------ */
  showCursorOnRay(localRay, worldRay, cam, hit) {
    let point;
    if (hit) point = hit.point.clone();
    else { // nothing under the pointer: put the cursor on the zero-parallax plane, where both eyes agree
      const world = worldRay.at(this.app.renderer.focalLength, new THREE.Vector3());
      point = this.app.well.well.worldToLocal(world);
    }
    this.cursorAt = { point, until: Infinity, hot: !!hit };
  }

  hideCursor(after = 0) { if (this.cursorAt) this.cursorAt.until = this.elapsed + after; }

  /* ------------------------------ Quest controllers ------------------------------ */
  setupXR() {
    const xr = this.app.renderer.renderer.xr;
    for (let i = 0; i < 2; i++) {
      const ctrl = xr.getController(i);
      this.app.scene.add(ctrl);
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]),
        new THREE.LineBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.7 }));
      line.scale.z = 3;
      ctrl.add(line);
      const cursor = this.makeCursor();
      this.root.add(cursor);
      this.xr.push({ ctrl, line, cursor, trig: false, grip: false, drag: null, twist: null });
    }
  }

  /** Per frame in VR: rays, highlights, trigger (tap / drag) and grip (grab + twist). */
  pollXR(session) {
    if (!session || !this.xr.length) return;
    const well = this.app.well.well;
    const wq = well.getWorldQuaternion(new THREE.Quaternion()), wqi = wq.clone().invert();
    session.inputSources.forEach((src, i) => {
      const s = this.xr[i];
      if (!s || !src.gamepad) return;
      const ctrl = s.ctrl;
      ctrl.updateMatrixWorld(true);
      const origin = new THREE.Vector3().setFromMatrixPosition(ctrl.matrixWorld);
      const dir = new THREE.Vector3(0, 0, -1).transformDirection(ctrl.matrixWorld);
      const ray = this.toLocalRay(new THREE.Ray(origin, dir));
      const play = this.active;
      const hit = play && !s.twist ? this.pick(ray) : null;
      s.cursor.visible = !!hit || !!s.drag;
      if (hit) s.cursor.position.copy(hit.point);
      s.line.scale.z = hit ? Math.max(0.05, origin.distanceTo(well.localToWorld(hit.point.clone()))) : 3;
      s.line.material.color.set(hit ? 0xffd34d : 0x00f0ff);
      const pulse = (v, ms) => { const h = src.gamepad.hapticActuators && src.gamepad.hapticActuators[0]; if (h && h.pulse) h.pulse(v, ms).catch(() => {}); };
      const b = k => !!(src.gamepad.buttons[k] && src.gamepad.buttons[k].pressed);
      const hand = src.handedness === 'left' ? 'L' : 'R';
      const trig = b(0), grip = b(1);

      // Trigger: press = tap on what the ray points at; hold on the piece / a ring = drag
      if (trig && !s.trig && !this.app.controls.menuMode) {
        if (!play || !hit) this.app.controls.fire(hand === 'R' ? 'rotY' : 'rotX', 'vr'); // pointing at nothing: the old trigger rotations
        else if (hit.kind === 'post') { this.pressPost(); pulse(0.6, 30); }
        else if (hit.kind === 'rope') { this.cutRope(hit.point); pulse(0.8, 40); }
        else if (hit.kind === 'ring') {
          s.drag = { kind: 'ring', axis: hit.axis, centre: hit.centre, last: this.ringAngle(hit.axis, hit.point.clone().sub(hit.centre)), acc: 0 };
          this.ringMeshes[hit.axis].material.opacity = 1;
        } else if (hit.kind === 'piece') {
          s.drag = { kind: 'move', plane: new THREE.Plane(new THREE.Vector3(0, 1, 0), -hit.centre.y), from: hit.point.clone(), t0: performance.now(), done: { x: 0, z: 0 }, bumped: false, moved: 0 };
        }
      }
      if (trig && s.drag) {
        const d = s.drag;
        if (d.kind === 'ring') {
          const n = AXES[d.axis], p = new THREE.Vector3();
          if (ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(n, d.centre), p)) {
            const ang = this.ringAngle(d.axis, p.sub(d.centre));
            let da = ang - d.last; if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI;
            d.last = ang; d.acc += da;
            while (Math.abs(d.acc) >= Math.PI / 4) { const sg = Math.sign(d.acc); d.acc -= sg * Math.PI / 2; if (this.rotate(d.axis, sg)) pulse(0.5, 25); }
            s.cursor.position.copy(this.ringPoint(d.axis, d.centre, this.ringRadius(this.pieceInfo() || { half: new THREE.Vector3() }, d.axis), ang));
          }
        } else if (d.kind === 'move') {
          const p = new THREE.Vector3();
          if (ray.intersectPlane(d.plane, p)) {
            d.moved = Math.max(d.moved, p.distanceTo(d.from));
            this.moveTo(d, Math.round(p.x - d.from.x), Math.round(p.z - d.from.z));
            s.cursor.position.copy(p);
          }
        }
      }
      if (!trig && s.trig && s.drag) {
        if (s.drag.kind === 'move' && s.drag.moved < 0.3 && performance.now() - s.drag.t0 < TAP_MS && !s.drag.done.x && !s.drag.done.z) this.toggleRings();
        if (s.drag.kind === 'ring') this.ringMeshes[s.drag.axis].material.opacity = 0.55;
        s.drag = null;
      }
      s.trig = trig;

      // Grip: hold the piece like a real block. Twist the wrist 90° to turn it, move the hand a cell to slide it.
      if (grip && !s.grip && play && !this.app.controls.menuMode) {
        s.twist = { q0: ctrl.getWorldQuaternion(new THREE.Quaternion()), p0: well.worldToLocal(origin.clone()) };
        pulse(0.4, 20);
      }
      if (grip && s.twist && play) {
        const q = ctrl.getWorldQuaternion(new THREE.Quaternion());
        const dq = q.clone().multiply(s.twist.q0.clone().invert());       // world-frame change since the grab
        const local = wqi.clone().multiply(dq).multiply(wq);              // ... in the well's frame
        const rv = rotationVector(local);
        const [axis] = snapAxis(rv), amount = rv[axis];
        if (Math.abs(amount) >= TWIST_STEP) {
          const sg = Math.sign(amount);
          if (this.rotate(axis, sg)) pulse(0.6, 30);
          // Take that quarter turn out of the reference, so the rest of the twist carries on
          const quarterL = new THREE.Quaternion().setFromAxisAngle(AXES[axis], sg * Math.PI / 2);
          const quarterW = wq.clone().multiply(quarterL).multiply(wqi);
          s.twist.q0.premultiply(quarterW);
        }
        const p = well.worldToLocal(origin.clone()), g = this.app.game;
        for (const k of ['x', 'z']) {
          const dd = p[k] - s.twist.p0[k];
          if (Math.abs(dd) >= 1) {
            const sg = Math.sign(dd), offset = { x: k === 'x' ? sg : 0, y: 0, z: k === 'z' ? sg : 0 };
            const moved = g.shift(offset);
            g.emit(moved ? 'move' : 'bump', { offset });
            if (moved) pulse(0.25, 12);
            s.twist.p0[k] += sg;
          }
        }
      }
      if (!grip) s.twist = null;
      s.grip = grip;
    });
  }

  setXRVisible(on) { for (const s of this.xr) { s.line.visible = on; if (!on) s.cursor.visible = false; } }

  /* ------------------------------ Per frame ------------------------------ */
  get busy() { return !!this.drag || this.xr.some(s => s.drag || s.twist); }

  update(dt) {
    this.elapsed += dt;
    const app = this.app, g = app.game, live = this.active;
    const info = live ? this.pieceInfo() : null;
    const holding = !!(live && info && !g.gravity);

    // OS cursor hidden over a side-by-side view: the fused 3D cursor replaces it
    const canvas = app.renderer.renderer.domElement;
    const hideOs = app.renderer.isDualView && app.state === 'PLAYING';
    if (this.osHidden !== hideOs) { canvas.style.cursor = hideOs ? 'none' : ''; this.osHidden = hideOs; }

    // Post at the well's corner nearest the viewer, just outside the rim
    this.postGroup.visible = !!(live && info);
    if (this.postGroup.visible) {
      this.placePost(dt);
      const mode = holding ? 'cut' : 'fast';
      if (this.iconMode !== mode) {
        this.iconMode = mode;
        this.icon.material.map = this.icons[mode];
        this.icon.material.needsUpdate = true;
        this.buttonMat.color.set(holding ? 0xffb340 : 0xff3b5c);
        this.buttonMat.emissive.set(holding ? 0xff7a1a : 0xc0122f);
      }
      const hot = (this.hover && this.hover.kind === 'post') || this.xr.some(s => s.cursor.visible && s.cursor.position.distanceTo(this.postGroup.position) < 1);
      this.buttonMat.emissiveIntensity = (hot ? 1.1 : 0.5) + 0.25 * Math.sin(this.elapsed * (holding ? 5 : 8));
      this.button.position.y += (0 - this.button.position.y) * Math.min(1, 12 * dt);
      this.icon.scale.setScalar(0.85 * (hot ? 1.15 : 1));
    }

    // Rope from the post to the waiting piece
    this.rope.visible = this.knot.visible = holding;
    if (holding) this.updateRope(info);
    else this.ropePts = [];

    // Rotation rings around the piece
    this.rings.visible = !!(info && this.ringsOn);
    if (this.rings.visible) this.updateRings(info);

    // Rope-cut recoil
    if (this.cut) {
      const c = this.cut;
      c.t += dt;
      const k = Math.min(1, c.t / CUT_TIME);
      const keepA = Math.max(2, Math.round(c.anchorSide.length * (1 - k)));
      const keepB = Math.max(2, Math.round(c.pieceSide.length * (1 - k)));
      this.setTube(c.a, c.anchorSide.slice(0, keepA));
      // The piece keeps its end of the rope for a moment as it starts to fall
      const shift = info ? info.attach.clone().sub(c.pieceSide[c.pieceSide.length - 1]) : new THREE.Vector3();
      this.setTube(c.b, c.pieceSide.slice(c.pieceSide.length - keepB).map(p => p.clone().add(shift)));
      c.a.material.opacity = c.b.material.opacity = 1 - k;
      if (k >= 1) this.disposeCut();
    }

    // Cursor
    const ca = this.cursorAt;
    this.cursor.visible = !!(ca && this.elapsed < ca.until && app.state === 'PLAYING' && !app.inVR);
    if (this.cursor.visible) {
      this.cursor.position.copy(ca.point);
      const pulse = 1 + 0.12 * Math.sin(this.elapsed * 9);
      this.cursor.scale.setScalar((ca.hot || this.drag ? 0.75 : 0.5) * pulse);
      this.cursor.material.color.set(ca.hot || this.drag ? 0xffd34d : 0xffffff);
    }
    for (const s of this.xr) if (s.cursor.visible) s.cursor.scale.setScalar(0.5 * (1 + 0.12 * Math.sin(this.elapsed * 9)));

    // Highlight: hovered ring
    for (const a of ['x', 'y', 'z']) {
      const dragging = (this.drag && this.drag.axis === a) || this.xr.some(s => s.drag && s.drag.axis === a);
      const hovered = this.hover && this.hover.kind === 'ring' && this.hover.axis === a;
      this.ringMeshes[a].material.opacity = dragging ? 1 : hovered ? 0.85 : 0.5;
    }
    // Rope glows when it is what the pointer would cut
    const ropeHot = (this.hover && this.hover.kind === 'rope') || this.xr.some(s => s.cursor.visible && this.ropePts.length && this.ropePts.some(p => p.distanceTo(s.cursor.position) < 0.3));
    this.ropeMat.emissive.set(ropeHot ? 0xffb340 : 0x6b5a3a);
  }

  placePost(dt) {
    const w = this.app.well, { W, H, D } = w.extent;
    const cam = this.app.renderer.mainCamera.getWorldPosition(new THREE.Vector3());
    w.well.worldToLocal(cam);
    const corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
    const score = ([sx, sz]) => sx * W / 2 * cam.x + sz * D / 2 * cam.z;
    let best = corners.reduce((b, c) => (score(c) > score(b) ? c : b));
    // Hysteresis: don't flick between two corners while the camera orbits past a diagonal
    if (this.post.corner && score(best) - score(this.post.corner) < 0.15 * Math.hypot(cam.x, cam.z)) best = this.post.corner;
    this.post.corner = best;
    const target = new THREE.Vector3(best[0] * (W / 2 + 0.55), H - 0.25, best[1] * (D / 2 + 0.55));
    if (!this.post.ready) { this.postGroup.position.copy(target); this.post.ready = true; }
    else this.postGroup.position.lerp(target, Math.min(1, 6 * dt));
  }

  updateRope(info) {
    const anchor = this.postGroup.position.clone().add(new THREE.Vector3(0, 0.12, 0));
    const end = info.attach.clone().add(new THREE.Vector3(0, 0.02, 0));
    const key = `${anchor.x.toFixed(2)},${anchor.y.toFixed(2)},${anchor.z.toFixed(2)}|${end.x},${end.y},${end.z}`;
    if (key === this.ropeKey) return;
    this.ropeKey = key;
    const len = anchor.distanceTo(end);
    const mid = anchor.clone().lerp(end, 0.5);
    mid.y = Math.max(end.y, anchor.y) + 0.25 + 0.12 * len; // a short rope arcs up from the post and over to the piece
    const curve = new THREE.QuadraticBezierCurve3(anchor, mid, end);
    this.ropePts = curve.getPoints(24);
    this.setTube(this.rope, this.ropePts);
    this.knot.position.copy(end);
  }

  setTube(mesh, pts) {
    if (pts.length < 2) { mesh.visible = false; return; }
    mesh.visible = true;
    const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), Math.max(4, pts.length * 2), 0.045, 6, false);
    mesh.geometry.dispose();
    mesh.geometry = geo;
  }

  updateRings(info) {
    this.rings.position.copy(info.centre);
    for (const a of ['x', 'y', 'z']) {
      const m = this.ringMeshes[a], R = this.ringRadius(info, a);
      if (Math.abs(m.userData.radius - R) > 1e-3) {
        m.geometry.dispose();
        const geo = new THREE.TorusGeometry(R, 0.06, 8, 72); // in the XY plane (axis z)
        if (a === 'x') geo.rotateY(Math.PI / 2);
        if (a === 'y') geo.rotateX(Math.PI / 2);
        m.geometry = geo;
        m.userData.radius = R;
      }
    }
  }

  /** A new game: forget drags, cut animations and the post's corner. */
  reset() {
    this.drag = null; this.hover = null; this.cursorAt = null; this.cutAt = null;
    this.disposeCut();
    this.post.ready = false; this.post.corner = null;
    this.ropeKey = ''; this.ropePts = [];
    for (const s of this.xr) { s.drag = null; s.twist = null; }
  }
}
