/* ==========================================================================
   3D FORTRIS - TWIN CONTROL
   Steering the real piece by touching it fails once it falls: it keeps
   moving away from the finger (or the Quest hand), so you chase it and
   overshoot. The twin is a still copy to steer instead:
     - a big copy of the current piece in a fixed column at the side of the
       view (right or left: the "hand" setting), seen exactly as the camera
       sees the real piece. Swipe it to roll the piece the way you swipe
       (camera-relative quarter turns), twist two fingers on it to turn it
     - under it a mini floor map of the well, turned to match the camera
       (up = away from you), each column shaded by its stack height, the
       piece's footprint in its colour. Touch or drag on the map and the
       real piece slides to that column (cell by cell, stopping at blocks)
     - Meta Quest: the twin and map ride on your off hand like a tablet;
       squeeze that hand's grip and twist to turn the piece, point the other
       hand's trigger at the map to move it (see grab.js)
   The flat-screen twin hangs on the zero-parallax plane like the HUD and is
   drawn over the scene after a depth clear, so it reads in every stereo mode.
   ========================================================================== */

const SWIPE_PX = 34, TWIST_RAD = 0.6;
const MAP_PX = 256;

export class TwinControl {
  constructor(app) {
    this.app = app;
    this.group = new THREE.Group();          // the whole column (twin + map)
    this.group.visible = false;

    // Draw over the scene: depth clear first (like the HUD's NEXT minis), all parts transparent so they sort after it
    this.clearer = new THREE.Mesh(new THREE.PlaneGeometry(0.001, 0.001),
      new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false, transparent: true }));
    this.clearer.renderOrder = 1010;
    this.clearer.frustumCulled = false;
    this.clearer.onBeforeRender = renderer => { if (!renderer.xr.isPresenting) renderer.clearDepth(); };
    this.group.add(this.clearer);

    // Backing card for the column
    this.cardMat = new THREE.MeshBasicMaterial({ color: 0x020617, transparent: true, opacity: 0.55, depthWrite: false, depthTest: false });
    this.card = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.cardMat);
    this.card.renderOrder = 1011;
    this.group.add(this.card);

    // Twin piece
    this.twin = new THREE.Group();
    this.pieceMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25, metalness: 0.1, envMap: app.well.env, envMapIntensity: 0.7, transparent: true, opacity: 1 });
    this.pieceMat.emissive = new THREE.Color(0x000000);
    this.cubes = new THREE.InstancedMesh(new THREE.BoxGeometry(0.92, 0.92, 0.92), this.pieceMat, 8);
    this.cubes.count = 0;
    this.cubes.renderOrder = 1013;
    this.cubes.frustumCulled = false;
    this.bomb = new THREE.Mesh(new THREE.SphereGeometry(0.5, 20, 14), new THREE.MeshStandardMaterial({ color: 0x1b1b24, metalness: 0.6, roughness: 0.25, transparent: true }));
    this.bomb.renderOrder = 1013;
    this.twin.add(this.cubes, this.bomb);
    this.twinHolder = new THREE.Group();
    this.twinHolder.add(this.twin);
    this.group.add(this.twinHolder);
    // Invisible pad over the twin for swipes
    this.pad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ visible: false }));
    this.group.add(this.pad);
    this.hint = this.textSprite('swipe ⟲ · twist ↻', 0.9);
    this.group.add(this.hint);

    // Mini floor map
    this.mapCanvas = document.createElement('canvas');
    this.mapCanvas.width = this.mapCanvas.height = MAP_PX;
    this.mapTex = new THREE.CanvasTexture(this.mapCanvas);
    this.mapTex.minFilter = THREE.LinearFilter;
    this.map = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: this.mapTex, transparent: true, depthTest: false, depthWrite: false }));
    this.map.renderOrder = 1012;
    this.mapHolder = new THREE.Group(); // turned so the map's "up" is away from the camera
    this.mapHolder.add(this.map);
    this.group.add(this.mapHolder);
    this.mapHint = this.textSprite('touch the map to move', 0.9);
    this.group.add(this.mapHint);

    this.raycaster = new THREE.Raycaster();
    this.drag = null;
    this.pieceKey = '';
    this.mapKey = '';
    this.parentKind = null;
    this.size = 1;
  }

  textSprite(text, aspectH) {
    const cv = document.createElement('canvas');
    cv.width = 512; cv.height = 64;
    const g = cv.getContext('2d');
    g.font = '700 34px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = 'rgba(203,213,225,0.85)';
    g.fillText(text, 256, 34);
    const t = new THREE.CanvasTexture(cv);
    t.minFilter = THREE.LinearFilter;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1 / 8), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthTest: false, depthWrite: false }));
    m.renderOrder = 1014;
    m.userData.aspectH = aspectH;
    return m;
  }

  /** 'off' (default since v2.4: tapping the piece toggles MOVE / ROTATE instead), 'right' or 'left'. */
  get enabled() { return this.app.settings.twin === 'right' || this.app.settings.twin === 'left'; }
  get hand() { return this.app.settings.twin === 'left' ? 'left' : 'right'; }

  /* ------------------------------ Placement ------------------------------ */
  /** Flat screen: a column under the HUD's side panels, on the hand's side. Called every frame before the eyes render. */
  layoutFlat() {
    const info = this.app.hud.layoutInfo;
    if (!info) return;
    if (this.parentKind !== 'flat') {
      this.app.hud.parent.add(this.group);
      this.parentKind = 'flat';
      this.group.quaternion.identity(); this.group.scale.setScalar(1);
    }
    const { viewW, viewH, distance, margin, top } = info;
    const right = this.hand === 'right';
    const panelsOn = this.app.settings.panels;
    const below = panelsOn ? (right ? info.nextBottom : info.layersBottom) : top;
    const avail = below - margin - (-viewH / 2 + margin);
    const w = Math.max(viewH * 0.12, Math.min(viewW * 0.24, viewH * 0.3, avail / 2.25));
    const x = (right ? 1 : -1) * (viewW / 2 - w / 2 - margin);
    const yTop = below - margin;
    this.place(w, x, yTop, -distance * 0.997);
  }

  /** Lay out the column: twin box on top, map below, both w wide, starting at yTop. */
  place(w, x, yTop, z) {
    this.size = w;
    const h = w * 2.2;
    this.card.scale.set(w, h, 1);
    this.card.position.set(x, yTop - h / 2, z);
    const twinY = yTop - w * 0.52;
    // A little towards the viewer so it pops out in 3D, pulled in by the same perspective so it stays in its column
    const pop = this.parentKind === 'flat' ? w * 0.25 : 0, k = z ? (Math.abs(z) - pop) / Math.abs(z) : 1;
    this.twinHolder.position.set(x * k, twinY * k, z + pop);
    this.pad.scale.set(w, w, 1);
    this.pad.position.set(x, twinY, z);
    this.hint.scale.set(w * 0.95, w * 0.95, 1);
    this.hint.position.set(x, yTop - w * 1.02, z);
    const mapY = yTop - w * 1.58;
    this.mapHolder.position.set(x, mapY, z);
    // The map turns with the camera: shrink it so the turned square still fits the column
    const a = this.mapHolder.rotation.z, fit = 1 / (Math.abs(Math.cos(a)) + Math.abs(Math.sin(a)));
    this.map.scale.set(w * 0.98 * fit, w * 0.98 * fit, 1);
    this.mapHint.scale.set(w * 0.95, w * 0.95, 1);
    this.mapHint.position.set(x, yTop - h + w * 0.04, z);
  }

  /** Quest: the column rides on the off hand's controller, like a small tablet (metres). */
  layoutXR(ctrl) {
    if (!ctrl) return;
    if (this.parentKind !== ctrl.uuid) {
      ctrl.add(this.group);
      this.parentKind = ctrl.uuid;
      this.group.position.set(0, 0.06, -0.08);
      this.group.rotation.set(-0.7, 0, 0); // tilted up towards the eyes
    }
    this.place(0.11, 0, 0.13, 0);
  }

  /* ------------------------------ Per frame ------------------------------ */
  update(dt, xrOffHand = null) {
    const app = this.app, g = app.game;
    const on = this.enabled && app.state === 'PLAYING' && !app.hud.dialogVisible && !!g.active && !g.over;
    this.group.visible = on;
    if (!on) return;
    if (app.inVR) this.layoutXR(xrOffHand); else this.layoutFlat();
    this.clearer.visible = !app.inVR;

    // The twin is seen exactly as the camera sees the real piece: well rotation, then into the camera's frame
    const wellQ = app.well.well.getWorldQuaternion(new THREE.Quaternion());
    const parentQ = this.group.getWorldQuaternion(new THREE.Quaternion());
    // In VR the twin keeps the well's orientation as seen from the head (so twisting matches what you see)
    this.twin.quaternion.copy(parentQ.clone().invert().multiply(wellQ));
    this.buildPiece();

    // Map turned so up = away from the camera (camera-relative, like the arrows)
    const cam = app.well.well.worldToLocal(app.renderer.mainCamera.getWorldPosition(new THREE.Vector3()));
    const f = new THREE.Vector2(-cam.x, -cam.z);
    if (f.lengthSq() > 1e-6) {
      f.normalize();
      const r = new THREE.Vector2(-f.y, f.x); // camera right on the floor
      // plane +X = grid +x  ->  screen (r.x, f.x)
      this.mapHolder.rotation.set(0, 0, Math.atan2(f.x, r.x));
    }
    this.drawMap();
  }

  buildPiece() {
    const g = this.app.game, p = g.active;
    const key = JSON.stringify(p.cells) + p.color + p.type;
    if (key === this.pieceKey) return;
    this.pieceKey = key;
    const isBomb = p.type === 'bomb';
    this.bomb.visible = isBomb;
    this.cubes.count = isBomb ? 0 : p.cells.length;
    // Centre the cells and fit their bounding sphere into the box
    const c = new THREE.Vector3();
    p.cells.forEach(([x, y, z]) => c.add(new THREE.Vector3(x, y, z)));
    c.divideScalar(p.cells.length);
    let r = 0.9;
    p.cells.forEach(([x, y, z]) => { r = Math.max(r, new THREE.Vector3(x, y, z).sub(c).length() + 0.87); });
    const m = new THREE.Matrix4();
    p.cells.forEach(([x, y, z], i) => this.cubes.setMatrixAt(i, m.makeTranslation(x - c.x, y - c.y, z - c.z)));
    this.cubes.instanceMatrix.needsUpdate = true;
    this.pieceMat.color.set(p.color);
    this.pieceMat.emissive.set(p.color).multiplyScalar(0.25);
    this.twinRadius = r;
    this.twin.scale.setScalar((this.size * 0.36) / r);
  }

  drawMap() {
    const g = this.app.game, { width: W, depth: D, height: H } = g.size;
    const cells = g.cellsOf();
    const key = `${g.pieces}|${g.lines}|${JSON.stringify(cells.map(c => [c.x, c.z]))}|${g.active.color}`;
    if (key === this.mapKey) return;
    this.mapKey = key;
    const ctx = this.mapCanvas.getContext('2d'), S = MAP_PX, cw = S / W, ch = S / D;
    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = 'rgba(2,6,23,0.92)'; ctx.fillRect(0, 0, S, S);
    // Column heights: how high the stack is in each column (pits read dark, towers bright)
    for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
      let h = 0;
      for (let y = H - 1; y >= 0; y--) if (g.grid[y][z][x]) { h = y + 1; break; }
      const k = h / H;
      ctx.fillStyle = h ? `hsl(${190 - k * 150}, 80%, ${18 + k * 45}%)` : 'rgba(15,26,51,1)';
      ctx.fillRect(x * cw + 1, z * ch + 1, cw - 2, ch - 2);
      if (h) { ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.font = `700 ${Math.floor(cw * 0.45)}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(h), x * cw + cw / 2, z * ch + ch / 2 + 1); }
    }
    // The piece's footprint
    const seen = new Set();
    for (const c of cells) {
      const k = `${c.x},${c.z}`;
      if (seen.has(k)) continue;
      seen.add(k);
      ctx.fillStyle = g.active.color;
      ctx.fillRect(c.x * cw + 2, c.z * ch + 2, cw - 4, ch - 4);
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3;
      ctx.strokeRect(c.x * cw + 2.5, c.z * ch + 2.5, cw - 5, ch - 5);
    }
    // The well's wall
    ctx.strokeStyle = '#00f0ff'; ctx.lineWidth = 4; ctx.strokeRect(2, 2, S - 4, S - 4);
    this.mapTex.needsUpdate = true;
  }

  /* ------------------------------ Hits ------------------------------ */
  /** What a world ray hits on the column: { kind: 'map', x, z } | { kind: 'twin' } | null. */
  hit(worldRay) {
    if (!this.group.visible) return null;
    this.raycaster.ray.copy(worldRay);
    const m = this.raycaster.intersectObject(this.map, false)[0];
    if (m && m.uv) {
      const { width: W, depth: D } = this.app.game.size;
      return { kind: 'map', x: Math.min(W - 1, Math.max(0, Math.floor(m.uv.x * W))), z: Math.min(D - 1, Math.max(0, Math.floor((1 - m.uv.y) * D))) };
    }
    if (this.raycaster.intersectObject(this.pad, false)[0]) return { kind: 'twin' };
    // The rest of the card swallows the touch too, so a near miss never orbits the camera or grabs the piece
    if (this.raycaster.intersectObject(this.card, false)[0]) return { kind: 'card' };
    return null;
  }

  /** Slide the real piece so its footprint's centre comes to column (x, z), cell by cell, stopping at blocks. */
  moveToCell(tx, tz) {
    const g = this.app.game;
    if (!g.active || g.over) return;
    for (let guard = 0; guard < 40; guard++) {
      const cs = g.cellsOf();
      const fx = Math.round(cs.reduce((s, c) => s + c.x, 0) / cs.length), fz = Math.round(cs.reduce((s, c) => s + c.z, 0) / cs.length);
      const dx = Math.sign(tx - fx), dz = Math.sign(tz - fz);
      if (!dx && !dz) return;
      const tryStep = o => { if (g.shift(o)) { g.emit('move', { offset: o }); return true; } return false; };
      const moved = (dx && tryStep({ x: dx, y: 0, z: 0 })) || (dz && tryStep({ x: 0, y: 0, z: dz }));
      if (!moved) { g.emit('bump', {}); return; }
    }
  }

  /* ------------------------------ Touch / mouse ------------------------------ */
  bind(surface) {
    surface.addEventListener('pointermove', e => this.onPointerMove(e));
    const end = e => this.onPointerUp(e);
    surface.addEventListener('pointerup', end);
    surface.addEventListener('pointercancel', end);
  }

  /** From the orbit handler's pointerdown, before the in-scene piece controls: true = ours. */
  onPointerDown(e) {
    if (this.app.inVR || !this.group.visible) return false;
    const h = this.hit(this.app.grab.eyeRay(e).ray);
    if (!h) return false;
    this.app.audio.ensureContext();
    try { e.currentTarget && e.currentTarget.setPointerCapture && e.currentTarget.setPointerCapture(e.pointerId); } catch (_) { /* gone */ }
    if (h.kind === 'map') { this.drag = { kind: 'map', ids: new Set([e.pointerId]) }; this.moveToCell(h.x, h.z); return true; }
    if (h.kind === 'twin') {
      const d = this.drag && this.drag.kind === 'twin' ? this.drag : (this.drag = { kind: 'twin', pts: new Map(), anchor: null, twist: null });
      d.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.restartTwin(d);
      return true;
    }
    this.drag = { kind: 'card', ids: new Set([e.pointerId]) };
    return true;
  }

  restartTwin(d) {
    const v = [...d.pts.values()];
    d.twist = v.length === 2 ? { last: Math.atan2(v[1].y - v[0].y, v[1].x - v[0].x), acc: 0 } : null;
    d.anchor = v.length === 1 ? { ...v[0] } : null;
  }

  onPointerMove(e) {
    const d = this.drag;
    if (!d) return;
    if (d.kind === 'map' && d.ids.has(e.pointerId)) {
      const h = this.hit(this.app.grab.eyeRay(e).ray);
      if (h && h.kind === 'map') this.moveToCell(h.x, h.z);
      e.preventDefault();
      return;
    }
    if (d.kind !== 'twin') return;
    const p = d.pts.get(e.pointerId);
    if (!p) return;
    e.preventDefault();
    p.x = e.clientX; p.y = e.clientY;
    const app = this.app;
    if (d.twist) {
      const v = [...d.pts.values()];
      const a = Math.atan2(v[1].y - v[0].y, v[1].x - v[0].x);
      let da = a - d.twist.last; if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI;
      d.twist.last = a; d.twist.acc += da;
      // screen y grows downwards: a growing angle is clockwise as you see it
      if (Math.abs(d.twist.acc) >= TWIST_RAD) { app.handleAction(d.twist.acc > 0 ? 'twistCW' : 'twistCCW'); d.twist.acc = 0; this.flash(); }
    } else if (d.anchor) {
      const dx = p.x - d.anchor.x, dy = p.y - d.anchor.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) >= SWIPE_PX) {
        app.handleAction(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'spinR' : 'spinL') : (dy > 0 ? 'spinD' : 'spinU'));
        d.anchor = { x: p.x, y: p.y };
        this.flash();
      }
    }
  }

  onPointerUp(e) {
    const d = this.drag;
    if (!d) return;
    if (d.kind === 'twin') {
      if (!d.pts.delete(e.pointerId)) return;
      if (d.pts.size) { this.restartTwin(d); return; }
    } else if (!d.ids.delete(e.pointerId) || d.ids.size) return;
    this.drag = null;
  }

  flash() { this.app.vibrate(10); this.pieceMat.emissiveIntensity = 2.2; clearTimeout(this.flashT); this.flashT = setTimeout(() => { this.pieceMat.emissiveIntensity = 1; }, 120); }

  get busy() { return !!this.drag; }

  reset() { this.drag = null; this.pieceKey = ''; this.mapKey = ''; }
}
