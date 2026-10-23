/* ==========================================================================
   3D FORTRIS - MAIN APPLICATION (game loop, camera, 3D panels, VR, PWA)
   Structure follows 3D Labyrinth's app.js; the rules live in game.js.
   ========================================================================== */

import { VERSION, CAMERA, VR, SCORE } from './config.js';
import { FortrisGame } from './game.js';
import { StereoRenderEngine } from './renderer.js';
import { WellView } from './well.js';
import { ControlsHandler } from './controls.js';
import { HUD3D } from './hud3d.js';
import { soundEngine } from './audio.js';
import { UIManager } from './ui.js';
import { TVLink } from './link.js';
import { PROGRESS_KEY, loadProgress, saveProgress, parseProgress, mergeProgress, addScore } from './progress.js';

// Buttons the phone controller may press (anything else on the data channel is ignored)
const REMOTE_ACTIONS = new Set(['left', 'right', 'up', 'down', 'rotX', 'rotY', 'rotZ', 'rotX-', 'rotY-', 'rotZ-', 'drop',
  'pause', 'confirm', 'focusPrev', 'focusNext', 'turnL', 'turnR', 'top', 'restart']);
const ROTATIONS = { rotX: ['x', 1], 'rotX-': ['x', -1], rotY: ['y', 1], 'rotY-': ['y', -1], rotZ: ['z', 1], 'rotZ-': ['z', -1] };
const MOVES = new Set(['left', 'right', 'up', 'down']);
const CLEAR_TITLES = ['', 'LAYER!', 'DOUBLE!', 'TRIPLE!', 'QUAD!'];
const STEREO_RATIO = 0.035;   // eye separation as a fraction of viewing distance at Depth = 1.0
const HALF_PI = Math.PI / 2;

class GameApp {
  constructor() {
    this.version = VERSION;
    this.state = 'MENU'; // MENU, PLAYING, PAUSED, OVER
    this.depth = 1.0;
    this.focusOffset = 0;
    this.progress = loadProgress();
    this.settings = { opacity: 0.85, autoRotate: true, ghost: true, guides: true, panels: true, pad: 'auto' };
    this.orbit = { theta: CAMERA.THETA, phi: CAMERA.PHI, zoom: 1, target: null, top: false, camPhi: CAMERA.PHI };
    this.vr = { mode: 'table', pending: false, frames: 0, head: null, fwd: null, yaw: 0, turn: 0 };
    this.vrHud = new THREE.Group();

    this.scene = new THREE.Scene();
    this.renderer = new StereoRenderEngine(document.getElementById('gameCanvas'));
    this.scene.add(this.renderer.cameraGroup);
    this.scene.add(this.vrHud);
    this.well = new WellView(this.scene, this.renderer.renderer);
    this.controls = new ControlsHandler();
    this.hud = new HUD3D(this.renderer.mainCamera);
    this.audio = soundEngine;
    this.renderer.onBeforeEyes = aspect => this.hud.layout(this.renderer.focalLength, this.renderer.fov, aspect);

    this.game = new FortrisGame({ size: this.progress.size, height: this.progress.height, onEvent: (t, d) => this.onGameEvent(t, d) });
    this.dirty = { grid: true, piece: true };

    this.ui = new UIManager(this);
    this.controls.bindOrbit(document.getElementById('viewportFrame'));
    this.controls.onAction = a => this.handleAction(a);
    this.bindDialogPointer();

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        if (this.state === 'PLAYING') this.togglePause();
        this.saveGame();
      }
      if (document.visibilityState === 'visible') this.syncProgress();
    });
    // Another copy of the game (tab / installed app) saved: adopt its high scores
    window.addEventListener('storage', e => { if (e.key === PROGRESS_KEY || e.key === null) this.syncProgress(); });
    window.addEventListener('resize', () => this.renderer.handleResize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.renderer.handleResize(), 250));

    this.setupWebXR();
    this.registerServiceWorker();
    this.ui.showMenuPage();
    this.animate = this.animate.bind(this);
    this.renderer.renderer.setAnimationLoop(this.animate);
    console.log(`[3D Fortris v${VERSION}] ready`);
  }

  get best() { return this.progress.scores.length ? this.progress.scores[0].score : 0; }

  /* ------------------------------ Game lifecycle ------------------------------ */
  /** Call from a user gesture (audio, full-screen and the rotation lock need one). */
  startGame({ resume = false } = {}) {
    this.audio.ensureContext();
    this.closeDialog();
    this.lockOrientation();
    this.syncProgress();
    const saved = this.progress.saved;
    if (!(resume && saved && this.game.restore(saved))) {
      if (saved && saved.score > 0) addScore(this.progress, { score: saved.score, level: saved.level, lines: saved.lines, size: saved.size, height: saved.height }); // abandoned run still counts
      this.game.reset(this.progress.size, this.progress.height); // a new game always starts at level 1
      this.progress.saved = null;
      this.saveProgress();
    }
    this.well.clearEffects();
    this.well.build(this.game.size, this.game.level);
    this.well.setOpacity(this.settings.opacity);
    this.dirty.grid = this.dirty.piece = true;
    this.audio.level = this.game.level;
    this.ui.showGamePage();
    this.renderer.handleResize();
    this.hud.setVisible(true);
    this.hud.setPanelsVisible(this.settings.panels);
    this.controls.requestWakeLock();
    this.audio.startMusic();
    this.orbit.target = null;
    this.cam = null; // re-fit the camera to this well at once
    if (this.inVR) this.applyVR();
    this.state = 'PLAYING';
    this.hud.showBanner(`LEVEL ${this.game.level}`, resume && saved ? 'Welcome back · DROP to release' : 'Press DROP to release the piece', '#00f0ff', 2.2);
  }

  togglePause() {
    if (this.state === 'PLAYING') {
      this.state = 'PAUSED';
      this.audio.stopMusic();
      this.controls.releaseWakeLock();
      this.saveGame();
      this.openPauseDialog();
    } else if (this.state === 'PAUSED') {
      this.state = 'PLAYING';
      this.closeDialog();
      this.ui.hideModals();
      this.audio.startMusic();
      this.controls.requestWakeLock();
    }
  }

  openPauseDialog() {
    const g = this.game;
    const lines = [`Level ${g.level} · ★ ${g.score.toLocaleString()} · ${g.lines} layers`];
    if (this.inVR) {
      lines.push('Thumbstick to choose · trigger or A to select');
      this.openDialog({ title: 'PAUSED', color: '#00f0ff', lines, buttons: [{ id: 'resume', label: '▶ Resume' }, { id: 'restart', label: '↻ Restart' },
        { id: 'recenter', label: '🎯 Recenter' }, { id: 'vrsize', label: this.vr.mode === 'table' ? '🏙 Giant' : '🪑 Table' }, { id: 'exitvr', label: '⏏ Exit VR' }] });
      return;
    }
    if (this.orientStatus) lines.push(this.orientStatus);
    this.openDialog({ title: 'PAUSED', color: '#00f0ff', lines, buttons: [{ id: 'resume', label: '▶ Resume' }, { id: 'restart', label: '↻ Restart' },
      { id: 'settings', label: '⚙ 3D' }, { id: 'menu', label: '☰ Menu' }] });
  }

  /** Restart mid-game asks first (v1 restarted at once; a stray R shouldn't cost a long run). */
  askRestart() {
    if (this.state === 'OVER' || this.game.score === 0) { this.startGame(); return; }
    if (this.state === 'PLAYING') { this.state = 'PAUSED'; this.audio.stopMusic(); }
    this.openDialog({ title: 'NEW GAME?', color: '#ffc93c', lines: [`This run: ★ ${this.game.score.toLocaleString()} (kept in the high scores)`],
      buttons: [{ id: 'newgame', label: '↻ New game' }, { id: 'resume', label: '✖ Keep playing' }] });
  }

  stopGame() {
    this.saveGame();
    this.unlockOrientation();
    this.state = 'MENU';
    this.closeDialog();
    this.audio.stopMusic();
    this.controls.releaseWakeLock();
    this.hud.hideBanner();
    this.ui.showMenuPage();
  }

  gameOver() {
    this.state = 'OVER';
    const g = this.game;
    const rank = addScore(this.progress, { score: g.score, level: g.level, lines: g.lines, size: g.size.width, height: g.size.height });
    this.progress.saved = null;
    this.saveProgress();
    this.well.gameOverFade();
    this.audio.stopMusic();
    this.audio.playGameOver();
    this.vibrate([80, 60, 200]);
    this.controls.releaseWakeLock();
    const lines = [`Level ${g.level} · ${g.lines} layers · ${g.pieces} pieces`];
    lines.push(rank === 1 ? '🏆 New best on this device!' : rank ? `#${rank} on this device · best ★ ${this.best.toLocaleString()}` : `Best ★ ${this.best.toLocaleString()}`);
    setTimeout(() => {
      if (this.state !== 'OVER') return;
      this.openDialog({ title: 'GAME OVER', color: '#ff3b5c', big: `★ ${g.score.toLocaleString()}`, lines,
        buttons: [{ id: 'newgame', label: '↻ New game' }, { id: 'menu', label: this.inVR ? '⏏ Exit VR' : '☰ Menu' }] });
    }, 900);
  }

  /* ------------------------------ Rules -> scene / sound ------------------------------ */
  onGameEvent(type, d) {
    const g = this.game;
    switch (type) {
      case 'move': this.audio.playMove(); this.dirty.piece = true; break;
      case 'fall': this.dirty.piece = true; break;
      case 'bump': this.audio.playBump(); break;
      case 'rotate': this.audio.playRotate(); this.dirty.piece = true; break;
      case 'release': this.audio.playRelease(); break;
      case 'harddrop': this.audio.playHardDrop(d.distance); break;
      case 'lock': this.audio.playLock(); this.vibrate(12); break;
      case 'bomb':
        this.audio.playBomb(); this.vibrate([30, 30, 90]);
        this.well.bombBurst(d.at, d.removed);
        if (d.removed.length) this.hud.showBanner('💥 BOOM', `+${d.removed.length * SCORE.BOMB_BLOCK}`, '#ff7a1a', 1.0);
        break;
      case 'clear': {
        const n = d.layers.length;
        this.audio.playClear(n); this.vibrate([20, 30, 40]);
        this.well.clearBurst(d.cells, d.layers);
        this.progress.totalLines += n;
        const title = n >= SCORE.PERFECT_LAYERS ? 'PERFECT CLEAR!' : CLEAR_TITLES[n] || `${n} LAYERS!`;
        this.hud.showBanner(title, `+${(n * SCORE.LAYER * g.level).toLocaleString()}`, '#34ff9a', 1.3);
        break;
      }
      case 'levelup':
        this.audio.playLevelUp();
        this.audio.level = d.level;
        this.well.levelWave(d.level);
        // Only the speed changes: the well carries on as it is, with a notification after the clear's own
        setTimeout(() => { if (this.state === 'PLAYING') this.hud.showBanner(`⚡ LEVEL ${d.level}`, 'Pieces fall faster', '#ffc93c', 1.6); }, 1100);
        break;
      case 'spawn': this.dirty.grid = this.dirty.piece = true; this.saveGame(); break;
      case 'gameover': this.dirty.grid = this.dirty.piece = true; this.pendingOver = true; break;
    }
  }

  /** Push the rules' state into the scene and HUD (at most once per frame). */
  flush() {
    const g = this.game;
    if (this.dirty.grid) {
      this.well.setGrid(g.grid);
      this.hud.setLayers(g.layerFill(), g.size, g.stackHeight());
      this.hud.setNext(g.queue);
      this.dirty.piece = true;
    }
    if (this.dirty.piece) {
      const landing = g.active ? g.cellsOf(g.landing()) : [];
      this.well.setActive(g.cellsOf(), g.active && g.active.color, g.active && g.active.type === 'bomb', landing);
    }
    this.dirty.grid = this.dirty.piece = false;
  }

  /* ------------------------------ Progress ------------------------------ */
  saveProgress() { this.progress = saveProgress(this.progress); }

  /** Remember the game in progress so it can be resumed after closing. */
  saveGame() {
    if (this.state === 'MENU' && !this.progress.saved) return;
    if (this.state === 'OVER' || this.game.over) return;
    if (this.state !== 'MENU') this.progress.saved = this.game.serialize();
    this.saveProgress();
  }

  syncProgress() {
    let stored = null;
    try { stored = parseProgress(localStorage.getItem(PROGRESS_KEY)); } catch (_) { /* storage blocked */ }
    if (!stored) return;
    // Mid-game this copy's run is the newest; at the menu the stored one is (another copy may have played)
    this.progress = this.state === 'MENU' ? mergeProgress(stored, this.progress) : mergeProgress(this.progress, stored);
    if (this.state === 'MENU') this.ui.renderMenu();
  }

  /* ------------------------------ Orientation lock (from 3D Labyrinth) ------------------------------ */
  /**
   * Side-by-side 3D (cardboard, smart glasses) is always viewed in landscape, so those modes lock
   * landscape; 2D/anaglyph lock whatever the player is holding. Must run inside a tap. Android allows
   * it only in full-screen; iOS Safari has no lock API, so a failure is reported on the pause panel.
   */
  lockOrientation() {
    if (this.inVR) { this.orientStatus = ''; return; }
    const so = screen.orientation;
    if (!matchMedia('(pointer: coarse)').matches) { this.orientStatus = ''; return; } // desktop: nothing to lock
    if (!so || typeof so.lock !== 'function') { this.orientFailed('not supported by this browser'); return; }
    const want = this.renderer.isDualView ? 'landscape' : (so.type && so.type.startsWith('landscape') ? 'landscape' : 'portrait');
    const ok = () => { this.orientStatus = `🔒 Rotation locked: ${want}`; };
    const lock = retry => so.lock(want).then(ok, err => {
      if (retry && document.fullscreenElement) setTimeout(() => lock(false), 300);
      else this.orientFailed((err && err.name) || 'refused');
    });
    if (document.fullscreenEnabled && !document.fullscreenElement) {
      document.documentElement.requestFullscreen({ navigationUI: 'hide' }).then(() => lock(true), () => lock(false));
    } else lock(true);
  }

  orientFailed(why) {
    this.orientStatus = `⚠ Rotation lock unavailable (${why})`;
    console.warn('[Orientation] lock failed:', why);
  }

  unlockOrientation() {
    try { if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock(); } catch (_) { /* not locked */ }
  }

  /* ------------------------------ Input ------------------------------ */
  openDialog(spec) {
    this.hud.showDialog(spec);
    this.controls.menuMode = true;
  }

  closeDialog() {
    this.hud.hideDialog();
    this.controls.menuMode = false;
  }

  /** Taps on the canvas while a dialog is open: map to eye-local NDC (works in both SBS halves). */
  bindDialogPointer() {
    const canvas = this.renderer.renderer.domElement;
    const toNdc = e => {
      const r = canvas.getBoundingClientRect();
      let u = (e.clientX - r.left) / r.width;
      const v = (e.clientY - r.top) / r.height;
      if (this.renderer.isDualView) u = (u % 0.5) * 2; // either eye's half maps to the same panel
      return [u * 2 - 1, 1 - v * 2];
    };
    this.controls.blockDrag = e => {
      if (!this.hud.dialogVisible) return false; // a drag orbits the camera
      const i = this.hud.hitIndex(...toNdc(e));
      if (i >= 0) { this.hud.setFocus(i); this.dialogAction(this.hud.focusedAction()); }
      return true;
    };
    canvas.addEventListener('pointermove', e => {
      if (e.pointerType === 'mouse' && this.hud.dialogVisible) this.hud.setFocus(this.hud.hitIndex(...toNdc(e)));
    });
  }

  dialogAction(id) {
    this.audio.ensureContext();
    switch (id) {
      case 'resume': this.togglePause(); break;
      case 'restart': this.askRestart(); break;
      case 'newgame': this.startGame(); break;
      case 'menu': if (this.inVR) this.exitVR(); this.stopGame(); break;
      case 'settings': this.ui.showModal('pauseScreen'); break; // sliders need a real 2D form
      case 'recenter': this.placeVR(); this.togglePause(); break;
      case 'vrsize': this.vr.mode = this.vr.mode === 'table' ? 'giant' : 'table'; this.placeVR(); this.togglePause(); break;
      case 'exitvr': this.exitVR(); break;
    }
  }

  /** Every input source ends up here: keys, gamepad, Quest, on-screen pad, phone. */
  handleAction(a) {
    const settingsOpen = !document.getElementById('pauseScreen').classList.contains('hidden');
    if (this.hud.dialogVisible && !settingsOpen) {
      if (a === 'focusPrev') return this.hud.moveFocus(-1);
      if (a === 'focusNext') return this.hud.moveFocus(1);
      if (a === 'confirm') return this.dialogAction(this.hud.focusedAction());
    }
    const playing = this.state === 'PLAYING' && !this.hud.dialogVisible;
    if (MOVES.has(a)) { if (playing) this.game.moveRelative(a, this.controlTheta()); return; }
    if (ROTATIONS[a]) { if (playing) this.game.rotate(...ROTATIONS[a]); return; }
    switch (a) {
      case 'drop':
        if (playing) this.game.release();
        else if (this.state === 'MENU') this.startGame({ resume: !!this.progress.saved });
        break;
      case 'confirm': if (this.state === 'MENU') this.startGame({ resume: !!this.progress.saved }); break;
      case 'pause':
        if (settingsOpen) this.ui.hideModals();
        else if (this.state === 'PLAYING' || this.state === 'PAUSED') this.togglePause();
        break;
      case 'restart': if (this.state !== 'MENU') { this.ui.hideModals(); this.askRestart(); } break;
      case 'turnL': case 'turnR': this.turnView(a === 'turnR' ? 1 : -1); break;
      case 'top': if (!this.inVR) { this.orbit.top = !this.orbit.top; this.ui.syncCamera(); } break;
      case 'mute': this.ui.toggleMute(); break;
      case 'panels': this.settings.panels = !this.settings.panels; this.hud.setPanelsVisible(this.settings.panels); this.ui.syncLook(); this.ui.saveSettings(); break;
    }
  }

  /** Quarter turn of the view (flat: the camera orbits; VR: the well turns in front of you). */
  turnView(dir) {
    this.audio.playTick();
    if (this.inVR) { this.vr.turn += dir * HALF_PI; this.applyVR(); return; }
    const o = this.orbit, off = CAMERA.SNAP_OFFSET;
    const from = o.target ?? o.theta;
    o.target = Math.round((from - off) / HALF_PI) * HALF_PI + off - dir * HALF_PI;
  }

  /** Orbit angle the moves are relative to: the camera, or in VR the head's position around the well. */
  controlTheta() {
    if (!this.inVR) return this.orbit.theta;
    const head = this.renderer.mainCamera.getWorldPosition(new THREE.Vector3());
    const local = this.well.well.worldToLocal(head);
    return Math.atan2(local.z, local.x);
  }

  vibrate(p) { if (navigator.vibrate) { try { navigator.vibrate(p); } catch (_) { /* unsupported */ } } }

  /* ------------------------------ Camera ------------------------------ */
  updateCamera(dt) {
    const r = this.renderer;
    const o = this.orbit, input = this.controls.takeOrbit();
    if (r.renderer.xr.isPresenting) return;
    if (input.dx || input.dy) { o.theta -= input.dx * CAMERA.DRAG; o.phi -= input.dy * CAMERA.DRAG; o.target = null; }
    o.phi = Math.max(CAMERA.PHI_MIN, Math.min(CAMERA.PHI_MAX, o.phi));
    o.zoom = Math.max(CAMERA.ZOOM_MIN, Math.min(CAMERA.ZOOM_MAX, o.zoom * input.zoom));
    if (o.target !== null) {
      o.theta += (o.target - o.theta) * Math.min(1, 7 * dt);
      if (Math.abs(o.target - o.theta) < 0.002) { o.theta = o.target; o.target = null; }
    } else if (this.settings.autoRotate && !input.dragging && !o.top && this.state === 'PLAYING') {
      o.theta += CAMERA.AUTO_ROTATE * dt;
    }
    o.camPhi += ((o.top ? CAMERA.TOP_PHI : o.phi) - o.camPhi) * Math.min(1, 6 * dt);

    const sp = Math.sin(o.camPhi), cp = Math.cos(o.camPhi), ct = Math.cos(o.theta), st = Math.sin(o.theta);
    const dir = new THREE.Vector3(sp * ct, cp, sp * st);   // centre -> camera
    const up = new THREE.Vector3(-cp * ct, sp, -cp * st); // true camera-up on the sphere: smooth into the top view
    const fit = this.fitWell(dir, up, r.fov, r.eyeAspect());
    const k = this.cam && this.cam.ready ? Math.min(1, 4 * dt) : 1; // ease, so auto-rotate doesn't make the well "breathe"
    this.cam = this.cam || {};
    this.cam.dist = this.cam.ready ? this.cam.dist + (fit.dist - this.cam.dist) * k : fit.dist;
    this.cam.lift = this.cam.ready ? this.cam.lift + (fit.lift - this.cam.lift) * k : fit.lift;
    this.cam.ready = true;
    const dist = this.cam.dist * o.zoom;
    const target = new THREE.Vector3(0, this.well.extent.H / 2, 0).addScaledVector(up, this.cam.lift);
    const eye = dir.clone().multiplyScalar(dist).add(target);
    r.cameraGroup.position.copy(eye);
    r.cameraGroup.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(eye, target, up));

    // Stereo follows the viewing distance: zero parallax at the well's centre, the near half pops out
    r.setFocalLength(dist * (1 + this.focusOffset));
    r.setEyeDistance(this.depth * dist * STEREO_RATIO);
  }

  /**
   * Smallest camera distance at which all 8 corners of the well fit on screen below the HUD bar,
   * plus the sideways "lift" of the aim point that centres them there. A bounding sphere wastes a
   * lot of height on a tall, narrow well, which matters most in side-by-side 3D on a phone.
   */
  fitWell(dir, up, fovDeg, aspect) {
    const { W, H, D } = this.well.extent;
    const right = new THREE.Vector3().crossVectors(up, dir); // camera +x
    const tv = Math.tan(fovDeg * Math.PI / 360), th = tv * aspect;
    const top = Math.min(0.94, this.hud.topNdc - 0.04), bottom = -0.94, side = 0.94;
    const pts = [];
    for (const x of [-W / 2, W / 2]) for (const y of [-H / 2, H / 2]) for (const z of [-D / 2, D / 2]) {
      const v = new THREE.Vector3(x, y, z);
      pts.push({ x: v.dot(right), y: v.dot(up), z: v.dot(dir) });
    }
    const ndc = (d, lift) => {
      let minY = Infinity, maxY = -Infinity, maxX = 0;
      for (const p of pts) {
        const depth = d - p.z;
        if (depth <= 0.1) return null;
        maxX = Math.max(maxX, Math.abs(p.x) / (depth * th));
        const ny = (p.y - lift) / (depth * tv);
        minY = Math.min(minY, ny); maxY = Math.max(maxY, ny);
      }
      return { minY, maxY, maxX };
    };
    const solve = d => { // lift that centres the well between the bar and the bottom edge
      let lift = 0;
      for (let i = 0; i < 4; i++) {
        const n = ndc(d, lift);
        if (!n) return null;
        lift += ((n.minY + n.maxY) / 2 - (top + bottom) / 2) * d * tv;
      }
      const n = ndc(d, lift);
      return n && n.maxX <= side && n.maxY <= top + 1e-3 && n.minY >= bottom - 1e-3 ? lift : null;
    };
    let lo = 0.5 * Math.max(W, H, D), hi = 40 * Math.max(W, H, D);
    for (let i = 0; i < 28; i++) { const mid = (lo + hi) / 2; if (solve(mid) === null) lo = mid; else hi = mid; }
    return { dist: hi, lift: solve(hi) ?? 0 };
  }

  /* ------------------------------ Phone controller ------------------------------ */
  async startPhoneLink() {
    if (this.link) { this.ui.showLinkPanel(this.link.code, this.link.connected ? 'connected' : 'waiting'); return; }
    this.ui.showLinkPanel(null, 'starting');
    this.link = new TVLink({
      onMessage: m => this.onRemoteMessage(m),
      onStatus: s => {
        this.ui.setLinkStatus(s);
        if (s === 'connected') { this.audio.playTick(); if (this.state !== 'MENU') this.hud.showBanner('📲 PHONE', 'Controller connected', '#34ff9a', 1.4); }
      }
    });
    try {
      const code = await this.link.start();
      this.ui.showLinkPanel(code, 'waiting');
    } catch (err) {
      this.link = null;
      this.ui.setLinkStatus('error:' + err.message);
    }
  }

  stopPhoneLink() {
    if (this.link) this.link.stop();
    this.link = null;
    this.ui.setLinkStatus('off');
  }

  onRemoteMessage(m) {
    if (!m || typeof m !== 'object' || m.t !== 'btn' || !REMOTE_ACTIONS.has(m.b)) return;
    this.audio.ensureContext();
    this.controls.fire(m.b, 'remote');
  }

  /** ~4x/s: tell the phone what the game is doing, so its screen can show it. */
  sendLinkState(now) {
    if (!this.link || !this.link.connected || now - (this.linkSentAt || 0) < 250) return;
    this.linkSentAt = now;
    const g = this.game;
    this.link.send({ t: 'state', s: this.state, lv: g.level, score: g.score, lines: g.lines, hold: !g.gravity,
      next: g.queue.slice(0, 3).map(p => p.name), panel: this.hud.dialogSpec ? this.hud.dialogSpec.title : null });
  }

  /* ------------------------------ Per-frame ------------------------------ */
  animate(timestamp) {
    const now = timestamp || performance.now();
    const dt = Math.min(Math.max(((now - (this.lastTime || now)) / 1000), 0.001), 0.05);
    this.lastTime = now;
    this.sendLinkState(now);
    if (this.state === 'MENU') {
      this.controls.pollGamepads(dt); // a pad's A button can start the game from the menu (glasses players)
      return; // the menu has no 3D view: save battery
    }

    const xr = this.renderer.renderer.xr;
    if (xr.isPresenting) {
      this.controls.pollXR(xr.getSession(), dt);
      if (this.vr.pending && ++this.vr.frames > 3) this.placeVR(); // the head pose is known after a few XR frames
      this.hud.layout(VR.HUD.DIST, VR.HUD.FOV, VR.HUD.ASPECT);
    }
    this.controls.pollGamepads(dt);
    if (this.state === 'PLAYING' && !this.hud.dialogVisible) this.game.tick(dt);
    if (this.pendingOver) { this.pendingOver = false; this.flush(); this.gameOver(); }
    this.flush();
    const g = this.game;
    this.hud.setStatus({ level: g.level, score: g.score, lines: g.lines, gravity: g.gravity || !g.active, source: this.controls.source, best: this.best });
    this.well.update(dt, g.gravity);
    this.hud.update(dt);
    this.updateCamera(dt);
    this.renderer.render(this.scene);
  }

  /* ------------------------------ WebXR ------------------------------ */
  get inVR() { return this.renderer.renderer.xr.isPresenting; }

  setupWebXR() {
    if (!navigator.xr) return;
    navigator.xr.isSessionSupported('immersive-vr').then(ok => {
      if (!ok) return;
      const btn = document.getElementById('webxrBtn');
      if (!btn) return;
      btn.style.display = 'inline-flex';
      btn.addEventListener('click', async () => {
        try {
          const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor'] });
          this.renderer.renderer.xr.setReferenceSpaceType('local-floor');
          await this.renderer.renderer.xr.setSession(session);
          session.addEventListener('end', () => this.onVREnd());
          this.renderer.cameraGroup.position.set(0, 0, 0);
          this.renderer.cameraGroup.quaternion.identity();
          this.hud.attachTo(this.vrHud);
          this.vr.pending = true; this.vr.frames = 0; this.vr.turn = 0;
          if (this.state === 'MENU') this.startGame({ resume: !!this.progress.saved });
          else if (this.state === 'PAUSED') this.togglePause();
        } catch (err) {
          console.warn('[WebXR] session failed:', err);
          alert('Could not start VR: ' + err.message);
        }
      });
    }).catch(() => {});
  }

  /**
   * Place the well (and the floating HUD) relative to where the player's head is right now:
   * Table = a desk-sized tower in front of you, Giant = a building-sized well standing on the floor.
   */
  placeVR() {
    const cam = this.renderer.mainCamera; // three r128 copies the XR head pose into the user camera each frame
    const head = cam.position.clone();
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    fwd.normalize();
    Object.assign(this.vr, { pending: false, head, fwd, yaw: Math.atan2(-fwd.x, -fwd.z) });
    this.vrHud.position.copy(head);
    this.vrHud.rotation.set(0, this.vr.yaw, 0);
    this.applyVR();
  }

  applyVR() {
    const v = this.vr;
    if (!v.head) return;
    const { H } = this.well.extent, w = this.well.world;
    if (v.mode === 'table') {
      w.scale.setScalar(VR.TABLE.HEIGHT / H);
      w.position.copy(v.head).addScaledVector(v.fwd, VR.TABLE.DIST);
      w.position.y = v.head.y - VR.TABLE.BELOW_EYES;
    } else {
      // local-floor puts the real floor at y = 0; if the headset gave no floor, assume a standing eye height
      const floorY = v.head.y > 0.8 ? 0 : v.head.y - VR.GIANT.STAND_EYE;
      w.scale.setScalar(VR.GIANT.HEIGHT / H);
      w.position.copy(v.head).addScaledVector(v.fwd, VR.GIANT.DIST);
      w.position.y = floorY;
    }
    w.rotation.set(0, v.yaw + v.turn, 0);
  }

  exitVR() {
    const session = this.renderer.renderer.xr.getSession();
    if (session) session.end();
  }

  onVREnd() {
    // three r128 copied the head pose into the user camera; the flat-screen rig expects it at rest
    const cam = this.renderer.mainCamera;
    cam.position.set(0, 0, 0); cam.quaternion.identity(); cam.scale.set(1, 1, 1); cam.updateMatrix();
    const w = this.well.world;
    w.scale.setScalar(1); w.position.set(0, 0, 0); w.rotation.set(0, 0, 0);
    this.hud.attachTo(this.renderer.mainCamera);
    this.vr.pending = false; this.vr.head = null;
    if (this.state === 'PLAYING') this.togglePause(); // back on the flat screen: give the player a moment
  }

  /* ------------------------------ PWA ------------------------------ */
  registerServiceWorker() {
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing && this.state !== 'PLAYING') { refreshing = true; location.reload(); }
    });
    window.addEventListener('load', () => {
      navigator.serviceWorker.register(`./sw.js?v=${VERSION}`).then(reg => {
        if (reg.waiting && navigator.serviceWorker.controller) this.ui.showUpdatePrompt(reg.waiting);
        reg.addEventListener('updatefound', () => {
          const w = reg.installing;
          w && w.addEventListener('statechange', () => {
            if (w.state === 'installed' && navigator.serviceWorker.controller) this.ui.showUpdatePrompt(w);
          });
        });
      }).catch(err => console.warn('[SW] registration failed:', err));
    });
  }
}

document.addEventListener('DOMContentLoaded', () => { window.app = new GameApp(); });
