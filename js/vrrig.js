/* ==========================================================================
   3D FORTRIS - VR RIG (Meta Quest)
   Where the well stands in the room, and the ways out:
     - placement: distance in front of you, sideways offset, height (how far
       its floor is below your eyes), size (tower height in metres) and turn.
       Table / Giant are presets; anything you change is remembered (settings).
     - while playing: the stick on the "world" hand (the one that doesn't move
       the piece; menu → Controls) turns the well (left / right) and pushes it
       away / pulls it closer (forward / back); squeeze that hand's grip to
       grab the well and move it with your hand; squeeze both grips and pull
       your hands apart / together to resize it
     - "Place well" on the pause panel: the game waits, both hands' grips and
       sticks move the well, trigger (or ✔) when done
     - a ☰ button floats beside the score bar: point and pull the trigger for
       the pause panel (Resume, Place well, Recenter, Table / Giant, Restart,
       Exit VR). B / Y does the same. Panel buttons are picked by pointing.
   ========================================================================== */

import { VR } from './config.js';

export const VR_PRESETS = {
  table: { dist: 1.0, side: 0, below: 0.8, size: 0.7 },   // a desk-sized tower; you look down into it
  giant: { dist: 2.6, side: 0, below: null, size: 2.6 }    // standing on the floor (below = your eye height)
};
const LIMITS = { dist: [0.35, 8], side: [-4, 4], below: [-1.5, 3], size: [0.2, 5] };
const clamp = (v, [a, b]) => Math.max(a, Math.min(b, v));

function iconTexture(label, color) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  g.fillStyle = 'rgba(2,6,23,0.85)';
  g.beginPath(); g.arc(64, 64, 58, 0, Math.PI * 2); g.fill();
  g.lineWidth = 7; g.strokeStyle = color; g.stroke();
  g.fillStyle = color; g.font = '900 64px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(label, 64, 68);
  const t = new THREE.CanvasTexture(cv);
  t.minFilter = THREE.LinearFilter;
  return t;
}

export class VRRig {
  constructor(app) {
    this.app = app;
    this.adjusting = false;
    this.hold = null;          // grip grab of the well: { hands: Map(index -> start pose), place0 }
    this.btn = { trig: [] };   // trigger edges (adjust mode)
    this.dirty = false;        // placement changed since the last save
    this.icons = { menu: iconTexture('☰', '#00f0ff'), done: iconTexture('✔', '#34ff9a') };
    this.menuBtn = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: this.icons.menu, transparent: true, depthTest: false, depthWrite: false }));
    this.menuBtn.renderOrder = 1003;
    this.menuBtn.visible = false;
    this.raycaster = new THREE.Raycaster();
  }

  /* ------------------------------ Placement ------------------------------ */
  get place() {
    const s = this.app.settings;
    if (!s.vrPlace) s.vrPlace = { mode: 'table', ...VR_PRESETS.table, turn: 0 };
    return s.vrPlace;
  }

  get worldHand() { return this.app.settings.vrHand === 'left' ? 'right' : 'left'; }

  /** Table / Giant: reset to that preset (Giant stands on the floor under you). */
  preset(mode) {
    const p = VR_PRESETS[mode] || VR_PRESETS.table, head = this.app.vr.head;
    const floorBelow = head && head.y > 0.8 ? head.y : VR.GIANT.STAND_EYE; // local-floor: the floor is at y = 0
    Object.assign(this.place, { mode, dist: p.dist, side: p.side, below: p.below === null ? floorBelow : p.below, size: p.size, turn: 0 });
    this.save();
  }

  /** Put the well where the placement says, relative to where your head was at Recenter. */
  apply() {
    const v = this.app.vr, p = this.place;
    if (!v.head) return;
    const { H } = this.app.well.extent, w = this.app.well.world;
    const right = new THREE.Vector3(-v.fwd.z, 0, v.fwd.x);
    w.scale.setScalar(p.size / H);
    w.position.copy(v.head).addScaledVector(v.fwd, p.dist).addScaledVector(right, p.side);
    w.position.y = v.head.y - p.below;
    w.rotation.set(0, v.yaw + p.turn, 0);
  }

  save() { this.dirty = false; this.app.ui.saveSettings(); }

  /* ------------------------------ Place-well mode ------------------------------ */
  startAdjust() {
    this.adjusting = true;
    this.btn.trig = [];
    this.app.hud.showBanner('📐 PLACE THE WELL', 'Grip: grab & move · both grips: resize · stick: turn / near-far · trigger: done', '#34ff9a', 600);
  }

  endAdjust() {
    if (!this.adjusting) return;
    this.adjusting = false;
    this.hold = null;
    if (this.place.mode !== 'custom') this.place.mode = 'custom';
    this.save();
    this.app.hud.hideBanner();
  }

  /* ------------------------------ Per frame ------------------------------ */
  /** Who owns a grip press: the well (world hand, place mode, or a second hand while the well is held) or the piece. */
  ownsGrip(hand) { return this.adjusting || hand === this.worldHand || !!this.hold; }

  poll(session, dt) {
    const app = this.app;
    if (!session) return;
    this.layoutMenu();
    const playing = app.state === 'PLAYING' && !app.hud.dialogVisible;
    const active = playing || this.adjusting;
    const xr = app.renderer.renderer.xr;
    const p = this.place, v = app.vr;
    let changed = false, grips = [];

    session.inputSources.forEach((src, i) => {
      const gp = src.gamepad;
      if (!gp) return;
      const hand = src.handedness === 'left' ? 'left' : 'right';
      const ctrl = xr.getController(i);
      ctrl.updateMatrixWorld(true);
      const b = k => !!(gp.buttons[k] && gp.buttons[k].pressed);

      // Panel open: point at its buttons (the trigger / A confirms the pointed one, in controls.js)
      if (app.hud.dialogVisible && !this.adjusting) {
        const origin = new THREE.Vector3().setFromMatrixPosition(ctrl.matrixWorld);
        const dir = new THREE.Vector3(0, 0, -1).transformDirection(ctrl.matrixWorld);
        const k = this.dialogHit(new THREE.Ray(origin, dir));
        if (k >= 0 && k !== app.hud.dialogSpec.focus) app.hud.setFocus(k);
      }

      if (!active) return;
      // Stick: the world hand's always; both in place mode (the game is waiting then)
      if (hand === this.worldHand || this.adjusting) {
        const ax = gp.axes || [];
        const [x, y] = ax.length >= 4 ? [ax[2] || 0, ax[3] || 0] : [ax[0] || 0, ax[1] || 0];
        if (Math.abs(x) > 0.25) { p.turn -= x * 1.4 * dt; changed = true; }
        if (Math.abs(y) > 0.25) { p.dist = clamp(p.dist - y * Math.max(0.5, p.size) * 0.9 * dt, LIMITS.dist); changed = true; }
      }
      if (b(1) && this.ownsGrip(hand)) grips.push({ i, ctrl });
      // Place mode: a trigger press ends it
      if (this.adjusting) {
        const t = b(0);
        if (t && !this.btn.trig[i]) { this.btn.trig[i] = t; app.handleAction('pause'); return; } // resumes (togglePause ends place mode)
        this.btn.trig[i] = t;
      }
    });

    // Grip grab: one hand moves / turns the well, two hands resize it too
    if (grips.length && v.head) {
      const ids = grips.map(g => g.i).join(',');
      const pose = ctrl => {
        const pos = new THREE.Vector3().setFromMatrixPosition(ctrl.matrixWorld);
        const f = new THREE.Vector3(0, 0, -1).transformDirection(ctrl.matrixWorld);
        return { pos, yaw: Math.atan2(-f.x, -f.z) };
      };
      if (!this.hold || this.hold.ids !== ids) {
        this.hold = { ids, place0: { ...p }, start: grips.map(g => pose(g.ctrl)) };
        this.pulse(session, grips.map(g => g.i), 0.3, 20);
      }
      const now = grips.map(g => pose(g.ctrl)), h = this.hold, p0 = h.place0;
      const right = new THREE.Vector3(-v.fwd.z, 0, v.fwd.x);
      // Move by the average hand movement
      const d = new THREE.Vector3();
      now.forEach((q, k) => d.add(q.pos.clone().sub(h.start[k].pos)));
      d.divideScalar(now.length);
      p.dist = clamp(p0.dist + d.dot(v.fwd), LIMITS.dist);
      p.side = clamp(p0.side + d.dot(right), LIMITS.side);
      p.below = clamp(p0.below - d.y, LIMITS.below);
      if (now.length === 1) {
        let dy = now[0].yaw - h.start[0].yaw;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        p.turn = p0.turn + dy;
      } else {
        const span0 = h.start[0].pos.distanceTo(h.start[1].pos), span = now[0].pos.distanceTo(now[1].pos);
        if (span0 > 0.05) p.size = clamp(p0.size * span / span0, LIMITS.size);
      }
      changed = true;
    } else if (this.hold) {
      this.hold = null;
      if (this.place.mode !== 'custom') this.place.mode = 'custom';
      this.save();
    }

    if (changed) {
      if (p.mode !== 'custom' && !this.hold) p.mode = 'custom';
      this.apply();
      this.dirty = true;
    } else if (this.dirty && !this.hold && !this.adjusting) this.save(); // the stick was let go
  }

  pulse(session, ids, v, ms) {
    for (const i of ids) {
      const s = session.inputSources[i], h = s && s.gamepad && s.gamepad.hapticActuators && s.gamepad.hapticActuators[0];
      if (h && h.pulse) h.pulse(v, ms).catch(() => {});
    }
  }

  /* ------------------------------ ☰ / ✔ button ------------------------------ */
  layoutMenu() {
    const app = this.app, bar = app.hud.bar.mesh;
    if (this.menuBtn.parent !== app.vrHud) app.vrHud.add(this.menuBtn);
    const s = bar.scale.y * 1.25;
    this.menuBtn.scale.set(s, s, 1);
    this.menuBtn.position.set(bar.position.x - bar.scale.x / 2 - s * 0.7, bar.position.y, bar.position.z);
    const show = app.state !== 'MENU' && (!app.hud.dialogVisible || this.adjusting);
    this.menuBtn.visible = show;
    const icon = this.adjusting ? this.icons.done : this.icons.menu;
    if (this.menuBtn.material.map !== icon) { this.menuBtn.material.map = icon; this.menuBtn.material.needsUpdate = true; }
  }

  hitMenu(worldRay) {
    if (!this.menuBtn.visible) return false;
    this.raycaster.ray.copy(worldRay);
    return this.raycaster.intersectObject(this.menuBtn, false).length > 0;
  }

  /** ☰: the pause panel (or back to the game); ✔ in place mode: done. */
  pressMenu() { this.app.audio.playTick(); this.app.handleAction('pause'); }

  /** Index of the panel button a ray points at, or -1. */
  dialogHit(worldRay) {
    const hud = this.app.hud, d = hud.dialogSpec;
    if (!d || !hud.dialog.mesh.visible) return -1;
    this.raycaster.ray.copy(worldRay);
    const m = this.raycaster.intersectObject(hud.dialog.mesh, false)[0];
    if (!m || !m.uv) return -1;
    const px = m.uv.x * 1024, py = (1 - m.uv.y) * 640;
    return d.buttons.findIndex(b => px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h);
  }

  onExit() { this.adjusting = false; this.hold = null; this.menuBtn.visible = false; if (this.dirty) this.save(); }
}
