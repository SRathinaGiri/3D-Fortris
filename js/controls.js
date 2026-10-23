/* ==========================================================================
   3D FORTRIS - INPUT
   Everything becomes a named action (onAction):
     moves      left right up down        (relative to the camera)
     rotations  rotX rotX- rotY rotY- rotZ rotZ-
     game       drop pause restart turnL turnR top mute panels
     3D panels  confirm focusPrev focusNext
   Sources: keyboard, Bluetooth/USB gamepads, Quest controllers (WebXR) and,
   through app.js, the on-screen pad and the phone controller. Dragging on the
   view orbits the camera, pinch / wheel zooms (read via takeOrbit()).
   Wake-lock and the dialog-tap hook follow 3D Labyrinth's controls.js.
   ========================================================================== */

const REPEAT_DELAY = 0.22, REPEAT_RATE = 0.085; // seconds: held stick / D-pad auto-repeat

const KEY_ACTIONS = {
  ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
  KeyQ: 'rotX', KeyE: 'rotX-', KeyA: 'rotY', KeyD: 'rotY-', KeyW: 'rotZ', KeyS: 'rotZ-',
  Space: 'drop', Enter: 'confirm', KeyP: 'pause', Escape: 'pause', KeyR: 'restart',
  KeyV: 'turnR', KeyT: 'top', KeyM: 'mute', KeyH: 'panels'
};
const REPEATABLE = new Set(['left', 'right', 'up', 'down']); // the OS key repeat moves a held piece, as in v1
const MOVES = { left: 'focusPrev', up: 'focusPrev', right: 'focusNext', down: 'focusNext' };

export class ControlsHandler {
  constructor() {
    this.onAction = null;   // (name) => void
    this.menuMode = false;  // a 3D dialog is open: moves walk the buttons, drop confirms
    this.blockDrag = null;  // (pointerEvent) => true when the app consumed the press (dialog tap)
    this.source = 'keys';   // last input used, shown on the HUD
    this.orbit = { dx: 0, dy: 0, zoom: 1, dragging: false };
    this.pointers = new Map();
    this.padHeld = {};      // gamepad button edge detection
    this.repeat = {};       // held direction -> { t, fired }
    this.wakeLock = null;
    this.wakeLockRequested = false;
    this.initKeyboard();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.wakeLockRequested) this.requestWakeLock();
    });
  }

  fire(action, source) {
    if (source) this.source = source;
    if (this.menuMode) {
      if (MOVES[action]) action = MOVES[action];
      else if (action === 'drop') action = 'confirm';
    }
    if (this.onAction) this.onAction(action);
  }

  /* ---------- Wake lock (keeps the screen on during play) ---------- */
  async requestWakeLock() {
    this.wakeLockRequested = true;
    if (!('wakeLock' in navigator) || this.wakeLock) return;
    try {
      this.wakeLock = await navigator.wakeLock.request('screen');
      this.wakeLock.addEventListener('release', () => { this.wakeLock = null; });
    } catch (err) { console.warn('[Controls] Wake lock failed:', err.message); }
  }

  async releaseWakeLock() {
    this.wakeLockRequested = false;
    if (this.wakeLock) { try { await this.wakeLock.release(); } catch (_) { /* already released */ } this.wakeLock = null; }
  }

  /* ---------- Keyboard ---------- */
  initKeyboard() {
    window.addEventListener('keydown', e => {
      if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
      let action = KEY_ACTIONS[e.code];
      if (!action) return;
      if (action === 'turnR' && e.shiftKey) action = 'turnL';
      if ((e.code === 'Space' || e.code === 'Enter') && e.target && e.target.tagName === 'BUTTON') return; // let the focused button handle it
      if (e.repeat && !REPEATABLE.has(action)) return;
      e.preventDefault();
      this.fire(action, 'keys');
    });
  }

  /* ---------- Orbit drag / pinch / wheel on the 3D view ---------- */
  bindOrbit(surface) {
    const ignore = e => e.target.closest && e.target.closest('button, input, .modal-card, .modal-overlay:not(.hidden)');
    surface.addEventListener('pointerdown', e => {
      if (ignore(e)) return;
      if (this.blockDrag && this.blockDrag(e)) { e.preventDefault(); return; }
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try { surface.setPointerCapture(e.pointerId); } catch (_) { /* pointer already gone */ }
      this.orbit.dragging = true;
      e.preventDefault();
    });
    surface.addEventListener('pointermove', e => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      if (this.pointers.size === 1) {
        this.orbit.dx += e.clientX - p.x;
        this.orbit.dy += e.clientY - p.y;
      } else if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const before = Math.hypot(a.x - b.x, a.y - b.y);
        p.x = e.clientX; p.y = e.clientY;
        const after = Math.hypot(a.x - b.x, a.y - b.y);
        if (before > 10 && after > 10) this.orbit.zoom *= before / after;
        return;
      }
      p.x = e.clientX; p.y = e.clientY;
      e.preventDefault();
    });
    const end = e => {
      this.pointers.delete(e.pointerId);
      if (!this.pointers.size) this.orbit.dragging = false;
    };
    surface.addEventListener('pointerup', end);
    surface.addEventListener('pointercancel', end);
    surface.addEventListener('wheel', e => { e.preventDefault(); this.orbit.zoom *= Math.exp(e.deltaY * 0.001); }, { passive: false });
  }

  /** Orbit input gathered since the last call. */
  takeOrbit() {
    const o = { dx: this.orbit.dx, dy: this.orbit.dy, zoom: this.orbit.zoom, dragging: this.orbit.dragging };
    this.orbit.dx = this.orbit.dy = 0; this.orbit.zoom = 1;
    return o;
  }

  /* ---------- Held directions with auto-repeat (sticks, D-pads, thumbsticks) ---------- */
  holdDirection(id, dir, dt, source) {
    const r = this.repeat[id];
    if (!dir) { delete this.repeat[id]; return; }
    if (!r || r.dir !== dir) { this.repeat[id] = { dir, t: REPEAT_DELAY }; this.fire(dir, source); return; }
    r.t -= dt;
    if (r.t <= 0) { r.t += REPEAT_RATE; if (REPEATABLE.has(dir) && !this.menuMode) this.fire(dir, source); }
  }

  edge(id, pressed, action, source) {
    if (pressed && !this.padHeld[id]) this.fire(action, source);
    this.padHeld[id] = pressed;
  }

  /* ---------- Gamepads ---------- */
  /**
   * Standard mapping: D-pad / left stick move, A drop (OK in panels), B rotate Z, X rotate Y,
   * Y rotate X, LB / RB turn the camera, Select top view, Start pause. Right stick orbits.
   */
  pollGamepads(dt) {
    const pads = [...(navigator.getGamepads ? navigator.getGamepads() : [])].filter(Boolean);
    const pressed = i => pads.some(gp => gp.buttons[i] && gp.buttons[i].pressed);
    const map = { 0: 'drop', 1: 'rotZ', 2: 'rotY', 3: 'rotX', 4: 'turnL', 5: 'turnR', 8: 'top', 9: 'pause' };
    for (const [i, action] of Object.entries(map)) this.edge(`gp${i}`, pressed(+i), this.menuMode && i === '1' ? 'pause' : action, 'pad');
    let dir = null;
    for (const gp of pads) {
      const x = gp.axes[0] || 0, y = gp.axes[1] || 0;
      if (Math.hypot(x, y) > 0.5) dir = Math.abs(x) > Math.abs(y) ? (x > 0 ? 'right' : 'left') : (y > 0 ? 'down' : 'up');
      const b = i => gp.buttons[i] && gp.buttons[i].pressed;
      if (!dir) dir = b(12) ? 'up' : b(13) ? 'down' : b(14) ? 'left' : b(15) ? 'right' : null;
      const rx = gp.axes[2] || 0, ry = gp.axes[3] || 0;
      if (Math.hypot(rx, ry) > 0.2) { this.orbit.dx += rx * 600 * dt; this.orbit.dy += ry * 400 * dt; }
      if (dir) break;
    }
    this.holdDirection('pad', dir, dt, 'pad');
  }

  /**
   * Quest controllers: either thumbstick moves, A / X drops (OK in panels), B / Y pauses,
   * right trigger rotates Y, left trigger rotates X, either grip rotates Z.
   */
  pollXR(xrSession, dt) {
    if (!xrSession) return;
    let dir = null;
    for (const src of xrSession.inputSources) {
      const gp = src.gamepad;
      if (!gp) continue;
      const hand = src.handedness === 'left' ? 'L' : 'R';
      const ax = gp.axes || [];
      const [x, y] = (ax.length >= 4 && Math.hypot(ax[2], ax[3]) > 0.2) ? [ax[2], ax[3]] : [ax[0] || 0, ax[1] || 0];
      if (Math.hypot(x, y) > 0.6) dir = Math.abs(x) > Math.abs(y) ? (x > 0 ? 'right' : 'left') : (y > 0 ? 'down' : 'up');
      const b = i => !!(gp.buttons[i] && gp.buttons[i].pressed);
      this.edge(`xr${hand}0`, b(0), this.menuMode ? 'confirm' : (hand === 'R' ? 'rotY' : 'rotX'), 'vr');
      this.edge(`xr${hand}1`, b(1), 'rotZ', 'vr');
      this.edge(`xr${hand}4`, b(4), 'drop', 'vr');
      this.edge(`xr${hand}5`, b(5), 'pause', 'vr');
    }
    this.holdDirection('xr', dir, dt, 'vr');
  }
}
