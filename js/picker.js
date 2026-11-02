/* ==========================================================================
   3D FORTRIS - ORIENTATION PICKER
   In ROTATE mode, a tap on the piece opens a grid of every distinct
   orientation of it (1 to 24: an I has 3, a T 12, the Edge 24), each drawn
   as a small 3D piece seen exactly as the camera sees the real one. Tap one:
   the piece turns straight to it (game.orient, with wall kicks) and goes
   back to MOVE. A tap outside the grid closes it (also back to MOVE).
   Flattest orientations come first (they fill layers); the current one is
   outlined. The grid hangs on the zero-parallax plane over the lower part
   of the view (the waiting piece stays visible at the top) and is drawn
   after a depth clear, so it fuses in every stereo mode. Quest: it floats on
   the HUD screen; point and pull the trigger.
   ========================================================================== */

import { orientations, orientationKey } from './game.js';

const MAX = 24;

export class OrientationPicker {
  constructor(app) {
    this.app = app;
    this.group = new THREE.Group();
    this.group.visible = false;
    this.isOpen = false;
    this.parent = null;

    this.clearer = new THREE.Mesh(new THREE.PlaneGeometry(0.001, 0.001),
      new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false, transparent: true }));
    this.clearer.renderOrder = 1030;
    this.clearer.frustumCulled = false;
    this.clearer.onBeforeRender = renderer => { if (!renderer.xr.isPresenting) renderer.clearDepth(); };
    this.group.add(this.clearer);

    this.panel = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: 0x020617, transparent: true, opacity: 0.8, depthTest: false, depthWrite: false }));
    this.panel.renderOrder = 1031;
    this.group.add(this.panel);
    this.title = this.textPlane('Tap a turn · tap outside to close');
    this.group.add(this.title);

    this.cubeGeo = new THREE.BoxGeometry(0.9, 0.9, 0.9);
    this.pieceMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.1, envMap: app.well.env, envMapIntensity: 0.6, transparent: true, opacity: 1 });
    this.tiles = [];
    for (let i = 0; i < MAX; i++) {
      const bg = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ color: 0x1e293b, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false }));
      bg.renderOrder = 1032;
      const frame = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)),
        new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, depthTest: false, depthWrite: false }));
      frame.renderOrder = 1033;
      const cubes = new THREE.InstancedMesh(this.cubeGeo, this.pieceMat, 8);
      cubes.renderOrder = 1034;
      cubes.frustumCulled = false;
      const spin = new THREE.Group();   // turned to the camera's view of the well
      spin.add(cubes);
      const holder = new THREE.Group(); // tile position + scale
      holder.add(spin);
      this.group.add(bg, frame, holder);
      this.tiles.push({ bg, frame, cubes, spin, holder, cells: null, key: '' });
    }
    this.raycaster = new THREE.Raycaster();
  }

  textPlane(text) {
    const cv = document.createElement('canvas');
    cv.width = 1024; cv.height = 96;
    const g = cv.getContext('2d');
    g.font = '800 54px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#e9d5ff';
    g.fillText(text, 512, 50);
    const t = new THREE.CanvasTexture(cv);
    t.minFilter = THREE.LinearFilter;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 96 / 1024), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthTest: false, depthWrite: false }));
    m.renderOrder = 1033;
    return m;
  }

  get open() { return this.isOpen; }

  show() {
    const g = this.app.game;
    if (!g.active || g.over) return;
    const all = orientations(g.active.cells);
    if (all.length < 2) { this.app.audio.playBump(); return; } // a cube, a mono, a bomb: nothing to pick
    const height = c => new Set(c.map(q => q[1])).size;
    const cur = orientationKey(g.active.cells);
    this.options = all.map((cells, i) => ({ cells, i, key: orientationKey(cells), h: height(cells) }))
      .sort((a, b) => a.h - b.h || a.i - b.i); // flat ones first, otherwise turn order
    this.pieceKey = JSON.stringify(g.active.cells) + g.active.color;
    this.pieceMat.color.set(g.active.color);
    this.pieceMat.emissive = new THREE.Color(g.active.color).multiplyScalar(0.3);
    this.tiles.forEach((t, i) => {
      const o = this.options[i];
      const on = !!o;
      t.bg.visible = t.frame.visible = t.holder.visible = on;
      t.cells = on ? o.cells : null;
      if (!on) return;
      t.key = o.key;
      const c = new THREE.Vector3();
      o.cells.forEach(([x, y, z]) => c.add(new THREE.Vector3(x, y, z)));
      c.divideScalar(o.cells.length);
      let r = 0.9;
      o.cells.forEach(([x, y, z]) => { r = Math.max(r, new THREE.Vector3(x, y, z).sub(c).length() + 0.8); });
      const m = new THREE.Matrix4();
      o.cells.forEach(([x, y, z], k) => t.cubes.setMatrixAt(k, m.makeTranslation(x - c.x, y - c.y, z - c.z)));
      t.cubes.count = o.cells.length;
      t.cubes.instanceMatrix.needsUpdate = true;
      t.r = r;
      const current = o.key === cur;
      t.frame.material.color.set(current ? 0xffc93c : 0x64748b);
      t.frame.material.opacity = current ? 1 : 0.6;
      t.bg.material.color.set(current ? 0x3b2f0b : 0x1e293b);
    });
    this.isOpen = true;
    this.app.audio.playTick();
    this.app.vibrate([8, 30, 8]);
  }

  hide() { this.isOpen = false; this.group.visible = false; }

  /** Grid over the lower part of the view: columns 3 / 4 / 6 by count, square tiles. */
  layout() {
    const hud = this.app.hud, info = hud.layoutInfo;
    if (!info) return;
    if (this.parent !== hud.parent) { hud.parent.add(this.group); this.parent = hud.parent; }
    const { viewW, viewH, distance, margin } = info;
    const n = this.options.length;
    const cols = n <= 3 ? n : n <= 12 ? 4 : 6, rows = Math.ceil(n / cols);
    const areaW = Math.min(viewW * 0.94, viewH * 1.25), areaTop = viewH * 0.12, areaBottom = -viewH / 2 + margin * 2;
    const titleH = viewH * 0.06;
    const cell = Math.min(areaW / cols, (areaTop - areaBottom - titleH) / rows);
    const w = cell * cols, h = cell * rows + titleH;
    const z = -distance * 0.995;
    const top = areaBottom + h;
    this.panel.scale.set(w + margin * 2, h + margin * 2, 1);
    this.panel.position.set(0, top - h / 2, z);
    this.title.scale.set(Math.min(w, titleH * 10.7), Math.min(w, titleH * 10.7), 1);
    this.title.position.set(0, top - titleH / 2, z);
    this.panelBox = { w: w + margin * 2, h: h + margin * 2 };
    this.tiles.forEach((t, i) => {
      if (!t.cells) return;
      const cx = -w / 2 + cell * (i % cols + 0.5), cy = top - titleH - cell * (Math.floor(i / cols) + 0.5);
      const s = cell * 0.92;
      t.bg.scale.set(s, s, 1); t.bg.position.set(cx, cy, z);
      t.frame.scale.set(s, s, 1); t.frame.position.set(cx, cy, z);
      t.holder.position.set(cx, cy, z + cell * 0.2);
      t.holder.scale.setScalar((s * 0.36) / t.r);
    });
  }

  update(dt) {
    const app = this.app, g = app.game;
    if (this.isOpen) {
      const key = g.active ? JSON.stringify(g.active.cells) + g.active.color : '';
      // Closed by anything that changes the piece behind its back: it landed, a key turned it, a dialog opened
      if (app.state !== 'PLAYING' || app.hud.dialogVisible || !g.active || g.over || key !== this.pieceKey) this.hide();
    }
    this.group.visible = this.isOpen;
    if (!this.isOpen) return;
    this.layout();
    this.clearer.visible = !app.inVR;
    // Each mini is seen as the camera sees the real piece
    const q = this.group.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(app.well.well.getWorldQuaternion(new THREE.Quaternion()));
    const wob = Math.sin(performance.now() / 600) * 0.12; // a slight sway, so the 3D shape reads
    for (const t of this.tiles) if (t.cells) { t.spin.quaternion.copy(q); t.spin.rotateY(wob); }
  }

  /** Index of the tile a world ray hits, -1 on the panel but no tile, null outside the panel. */
  hit(worldRay) {
    if (!this.isOpen) return null;
    this.group.updateMatrixWorld(true);
    this.raycaster.ray.copy(worldRay);
    for (let i = 0; i < this.tiles.length; i++) {
      const t = this.tiles[i];
      if (t.cells && this.raycaster.intersectObject(t.bg, false).length) return i;
    }
    return this.raycaster.intersectObject(this.panel, false).length ? -1 : null;
  }

  choose(i) {
    const t = this.tiles[i];
    if (!t || !t.cells) return;
    const ok = this.app.game.orient(t.cells);
    this.app.vibrate(ok ? 15 : [6, 30, 6]);
    this.hide();
    if (ok) this.app.grab.setMode(false); // picked: back to MOVE
  }

  /** Touch / mouse: called first from the view's pointerdown. True = the press is ours. */
  onPointerDown(e) {
    if (!this.isOpen || this.app.inVR) return false;
    const h = this.hit(this.app.grab.eyeRay(e).ray);
    this.app.audio.ensureContext();
    if (h === null) { this.hide(); this.app.grab.setMode(false); } // outside: close, back to MOVE
    else if (h >= 0) this.choose(h);
    return true; // on the panel's gaps too: never falls through to the well
  }
}
