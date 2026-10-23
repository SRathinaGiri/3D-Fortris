/* ==========================================================================
   3D FORTRIS - IN-SCENE HUD
   Canvas textures on planes parented to the camera and placed on the stereo
   focal plane (zero parallax), so it reads in every mode: both SBS halves,
   anaglyph, smart glasses and WebXR (bar / banner / dialog system from
   3D Labyrinth). Game messages are a small notification strip at the bottom,
   so a level-up or a clear never hides the well. Fortris panels: NEXT (the queue as small spinning 3D pieces,
   drawn over the scene after a depth clear) and LAYERS (the v1 playfield
   planner: how many blocks each bottom layer still needs).
   ========================================================================== */

import { LAYER_SUMMARY_COUNT, LAYERS_PER_LEVEL } from './config.js';

const NEXT_W = 256, NEXT_H = 640, LAYERS_W = 384, LAYERS_H = 480;

function makePanel(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  mesh.renderOrder = 999;
  mesh.frustumCulled = false;
  return { canvas, ctx: canvas.getContext('2d'), tex, mesh, key: '' };
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

function panelFrame(g, w, h, title) {
  g.clearRect(0, 0, w, h);
  g.fillStyle = 'rgba(2,6,23,0.72)';
  roundRect(g, 6, 6, w - 12, h - 12, 30); g.fill();
  g.strokeStyle = 'rgba(0,240,255,0.55)'; g.lineWidth = 4; g.stroke();
  g.fillStyle = '#00f0ff'; g.font = '800 40px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(title, w / 2, 50);
}

export class HUD3D {
  constructor(camera) {
    this.camera = camera;
    this.bar = makePanel(1024, 128);
    this.banner = makePanel(1024, 176);
    this.banner.mesh.visible = false;
    this.dialog = makePanel(1024, 640);
    this.dialog.mesh.visible = false;
    this.dialog.mesh.renderOrder = 1000;
    this.dialogSpec = null;  // { title, color, big, lines, buttons:[{id,label}], focus }
    this.dialogNdc = { hw: 1, hh: 1 };
    this.next = makePanel(NEXT_W, NEXT_H);
    this.layers = makePanel(LAYERS_W, LAYERS_H);

    // Mini pieces: drawn last, after a depth clear, so they sit on top of the scene yet keep their own 3D shading
    this.minis = new THREE.Group();
    const clearer = new THREE.Mesh(new THREE.PlaneGeometry(0.001, 0.001),
      new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false, transparent: true }));
    clearer.renderOrder = 1001;
    clearer.frustumCulled = false;
    clearer.onBeforeRender = renderer => renderer.clearDepth();
    this.minis.add(clearer);
    this.miniGeo = new THREE.BoxGeometry(0.9, 0.9, 0.9);
    this.miniBomb = new THREE.SphereGeometry(0.55, 20, 14);
    this.miniPieces = [];
    this.miniKey = '';
    this.slots = [];

    this.panelsOn = true;
    this.topNdc = 0.75;   // NDC y of the bar's lower edge: the camera fits the well below it
    this.distance = 10;
    this.bannerTimer = 0;
    this.elapsed = 0;
    this.parent = camera;
    this.attachTo(camera);
  }

  get all() { return [this.bar, this.banner, this.dialog, this.next, this.layers]; }

  /** Move every HUD panel under another parent (VR: a floating screen anchored in the room). */
  attachTo(parent) {
    this.parent = parent;
    for (const p of this.all) parent.add(p.mesh);
    parent.add(this.minis);
  }

  /** Fit panels to the eye frustum at the given distance (the focal plane). */
  layout(distance, fovDeg, aspect) {
    this.distance = distance;
    const viewH = 2 * distance * Math.tan((fovDeg * Math.PI / 180) / 2);
    const viewW = viewH * aspect;
    // Slim bar (at most ~10% of the height): every pixel of height matters in side-by-side 3D
    const barW = Math.min(viewW * 0.96, viewH * 0.8), barH = barW / 8;
    const barY = viewH / 2 - barH / 2 - viewH * 0.012;
    this.bar.mesh.scale.set(barW, barH, 1);
    this.bar.mesh.position.set(0, barY, -distance);
    this.topNdc = (barY - barH / 2) / (viewH / 2);
    // Notification strip along the bottom edge (over the floor, never over the falling piece)
    const bW = Math.min(viewW * 0.8, viewH * 0.9), bH = bW * 176 / 1024;
    this.banner.mesh.scale.set(bW, bH, 1);
    this.banner.mesh.position.set(0, -viewH / 2 + bH / 2 + viewH * 0.015, -distance * 0.999);

    // Side panels under the bar: NEXT on the right, LAYERS on the left, kept narrow so the well can be big
    const margin = viewH * 0.015, top = barY - barH / 2 - margin;
    const nW = Math.min(viewH * 0.13, viewW * 0.13), nH = nW * NEXT_H / NEXT_W;
    const nX = viewW / 2 - nW / 2 - margin, nY = top - nH / 2;
    this.next.mesh.scale.set(nW, nH, 1);
    this.next.mesh.position.set(nX, nY, -distance * 0.999);
    const lW = Math.min(viewH * 0.2, viewW * 0.16), lH = lW * LAYERS_H / LAYERS_W;
    this.layers.mesh.scale.set(lW, lH, 1);
    this.layers.mesh.position.set(-viewW / 2 + lW / 2 + margin, top - lH / 2, -distance * 0.999);

    // Slot centres for the mini pieces (canvas px -> camera space)
    const slotPx = 168, unit = nW / NEXT_W;
    this.slots = [0, 1, 2].map(i => ({
      x: nX, y: nY - ((112 + slotPx / 2 + i * slotPx) / NEXT_H - 0.5) * nH, z: -distance * 0.99, size: slotPx * 0.8 * unit
    }));
    this.placeMinis();

    const dW = Math.min(viewW * 0.94, viewH * 1.2), dH = dW * 0.625;
    this.dialog.mesh.scale.set(dW, dH, 1);
    this.dialog.mesh.position.set(0, -viewH * 0.02, -distance * 0.998);
    // Panel extent in NDC (identical for both eyes: it sits on the zero-parallax plane)
    this.dialogNdc = { hw: dW / viewW, hh: dH / viewH, cy: (-viewH * 0.02) / (viewH / 2) };
  }

  /* ---------------- NEXT panel: the queue as 3D pieces ---------------- */
  setNext(queue) {
    const key = queue.map(p => `${p.name}:${p.cells.join(';')}`).join('|');
    if (key === this.miniKey) return;
    this.miniKey = key;
    for (const m of this.miniPieces) { this.minis.remove(m.group); m.mat.dispose(); }
    this.miniPieces = queue.slice(0, 3).map((piece, i) => {
      const color = new THREE.Color(piece.color);
      const mat = new THREE.MeshStandardMaterial({ color, emissive: color.clone().multiplyScalar(0.3), roughness: 0.35, metalness: 0.1, transparent: true, opacity: 1 });
      const group = new THREE.Group(), spin = new THREE.Group();
      group.add(spin);
      const n = piece.cells.length;
      const c = piece.cells.reduce((a, [x, y, z]) => [a[0] + x / n, a[1] + y / n, a[2] + z / n], [0, 0, 0]);
      let r = 0;
      for (const [x, y, z] of piece.cells) {
        const m = new THREE.Mesh(piece.type === 'bomb' ? this.miniBomb : this.miniGeo, mat);
        m.position.set(x - c[0], y - c[1], z - c[2]);
        m.renderOrder = 1002;
        m.frustumCulled = false;
        spin.add(m);
        r = Math.max(r, Math.hypot(x - c[0], y - c[1], z - c[2]) + 0.8);
      }
      spin.rotation.x = 0.55;
      this.minis.add(group);
      return { group, spin, mat, radius: r, phase: i * 1.7 };
    });
    this.drawNextFrame();
    this.placeMinis();
  }

  placeMinis() {
    this.miniPieces.forEach((m, i) => {
      const s = this.slots[i];
      if (!s) return;
      m.group.position.set(s.x, s.y, s.z);
      m.group.scale.setScalar(s.size / 2 / m.radius);
    });
  }

  drawNextFrame() {
    const g = this.next.ctx;
    panelFrame(g, NEXT_W, NEXT_H, 'NEXT');
    for (let i = 0; i < 3; i++) {
      const y = 112 + i * 168;
      g.fillStyle = 'rgba(255,255,255,0.05)';
      roundRect(g, 22, y + 6, NEXT_W - 44, 156, 22); g.fill();
      g.fillStyle = '#64748b'; g.font = '700 26px system-ui, sans-serif'; g.textAlign = 'left';
      g.fillText(`+${i + 1}`, 34, y + 30);
    }
    this.next.tex.needsUpdate = true;
  }

  /* ---------------- LAYERS panel (the v1 playfield planner) ---------------- */
  setLayers(fill, size, stack) {
    const total = size.width * size.depth;
    const rows = fill.slice(0, LAYER_SUMMARY_COUNT);
    const key = `${rows.join(',')}|${total}|${stack}|${size.height}`;
    if (key === this.layers.key) return;
    this.layers.key = key;
    const g = this.layers.ctx, W = LAYERS_W;
    panelFrame(g, W, LAYERS_H, 'LAYERS');
    g.font = '600 24px system-ui, sans-serif'; g.fillStyle = '#94a3b8'; g.textAlign = 'center';
    g.fillText('blocks still needed', W / 2, 92);
    rows.forEach((filled, i) => {
      const y = LAYERS_H - 120 - i * 58; // layer 1 at the bottom, like the well
      const left = total - filled, k = filled / total;
      g.textAlign = 'left'; g.fillStyle = '#e2e8f0'; g.font = '800 28px system-ui, sans-serif';
      g.fillText(String(i + 1), 26, y);
      g.fillStyle = 'rgba(255,255,255,0.1)'; roundRect(g, 66, y - 15, 210, 30, 12); g.fill();
      if (k > 0) {
        g.fillStyle = k >= 0.85 ? '#34ff9a' : k >= 0.5 ? '#ffc93c' : '#38bdf8';
        roundRect(g, 66, y - 15, Math.max(24, 210 * k), 30, 12); g.fill();
      }
      g.textAlign = 'right'; g.fillStyle = left === 0 ? '#34ff9a' : left <= 3 ? '#ffc93c' : '#e2e8f0';
      g.fillText(String(left), W - 24, y);
    });
    const danger = stack / size.height;
    g.textAlign = 'center'; g.font = '800 28px system-ui, sans-serif';
    g.fillStyle = danger > 0.75 ? '#ff3b5c' : danger > 0.5 ? '#ffc93c' : '#94a3b8';
    g.fillText(`Stack ${stack} / ${size.height}`, W / 2, LAYERS_H - 46);
    this.layers.tex.needsUpdate = true;
  }

  setPanelsVisible(v) { this.panelsOn = v; this.syncPanels(); }

  syncPanels() {
    const on = this.panelsOn && this.bar.mesh.visible;
    this.next.mesh.visible = this.layers.mesh.visible = on;
    this.minis.visible = on && !this.dialogVisible; // minis draw over everything, so they make way for dialogs
  }

  /* ---------------- 3D dialogs (pause, game over...) ---------------- */
  get dialogVisible() { return this.dialog.mesh.visible; }

  showDialog(spec) {
    this.dialogSpec = { focus: 0, lines: [], ...spec };
    this.dialog.mesh.visible = true;
    this.hideBanner();
    this.drawDialog();
    this.syncPanels();
  }

  hideDialog() { this.dialog.mesh.visible = false; this.dialogSpec = null; this.syncPanels(); }

  moveFocus(delta) {
    const d = this.dialogSpec;
    if (!d) return;
    d.focus = (d.focus + delta + d.buttons.length) % d.buttons.length;
    this.drawDialog();
  }

  setFocus(i) {
    if (!this.dialogSpec || i < 0 || i === this.dialogSpec.focus) return;
    this.dialogSpec.focus = i;
    this.drawDialog();
  }

  focusedAction() { const d = this.dialogSpec; return d ? d.buttons[d.focus].id : null; }

  /** Map an eye-local NDC point to a dialog button index (-1 = none). */
  hitIndex(ndcX, ndcY) {
    const d = this.dialogSpec;
    if (!d) return -1;
    const { hw, hh, cy } = this.dialogNdc;
    const u = (ndcX / hw + 1) / 2, v = (1 - (ndcY - cy) / hh) / 2;
    if (u < 0 || u > 1 || v < 0 || v > 1) return -1;
    const px = u * 1024, py = v * 640;
    return d.buttons.findIndex(b => px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h);
  }

  drawDialog() {
    const d = this.dialogSpec, g = this.dialog.ctx, W = 1024, H = 640;
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(2,6,23,0.9)';
    roundRect(g, 8, 8, W - 16, H - 16, 44); g.fill();
    g.strokeStyle = d.color || '#00f0ff'; g.lineWidth = 6; g.stroke();
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = d.color || '#00f0ff';
    g.font = `900 ${d.title.length > 14 ? 74 : 92}px system-ui, sans-serif`;
    g.fillText(d.title, W / 2, 100);
    let y = 190;
    if (d.big) {
      g.fillStyle = '#ffc93c'; g.font = '900 96px system-ui, sans-serif';
      g.fillText(d.big, W / 2, y + 10); y += 100;
    }
    g.fillStyle = '#e2e8f0'; g.font = '600 42px system-ui, sans-serif';
    for (const line of d.lines) { g.fillText(line, W / 2, y); y += 56; }

    const n = d.buttons.length, gap = 26, bw = (W - 80 - gap * (n - 1)) / n, bh = 104, by = H - bh - 44;
    d.buttons.forEach((b, i) => {
      Object.assign(b, { x: 40 + i * (bw + gap), y: by, w: bw, h: bh });
      roundRect(g, b.x, b.y, b.w, b.h, 26);
      g.fillStyle = i === 0 ? (d.color || '#00f0ff') : 'rgba(255,255,255,0.12)';
      g.fill();
      if (i === d.focus) { g.strokeStyle = '#ffffff'; g.lineWidth = 8; g.stroke(); }
      g.fillStyle = i === 0 ? '#020617' : '#f8fafc';
      let size = 46;
      do { g.font = `800 ${size}px system-ui, sans-serif`; size -= 2; } while (size > 22 && g.measureText(b.label).width > b.w - 28);
      g.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + 2);
    });
    this.dialog.tex.needsUpdate = true;
  }

  /* ---------------- Status bar ---------------- */
  setStatus({ level, score, lines, gravity, source, best }) {
    const key = `${level}|${score}|${lines}|${gravity}|${source}|${best}`;
    if (key === this.bar.key) return;
    this.bar.key = key;
    const g = this.bar.ctx, W = 1024, H = 128;
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(2,6,23,0.72)';
    roundRect(g, 4, 8, W - 8, H - 16, 36); g.fill();
    g.strokeStyle = 'rgba(0,240,255,0.55)'; g.lineWidth = 3; g.stroke();
    g.textBaseline = 'middle';
    g.font = '800 54px system-ui, sans-serif';
    g.fillStyle = '#e2e8f0'; g.textAlign = 'left';
    g.fillText(`L${level}`, 34, H / 2 + 2);

    g.textAlign = 'center';
    g.fillStyle = score > 0 && score >= best ? '#ffc93c' : '#f8fafc';
    g.fillText(`★ ${score.toLocaleString()}`, 330, H / 2 + 2);

    // Layers cleared + pips toward the next level
    g.fillStyle = '#e2e8f0'; g.textAlign = 'right';
    g.fillText(`▤ ${lines}`, 650, H / 2 - 6);
    const done = lines % LAYERS_PER_LEVEL;
    for (let i = 0; i < LAYERS_PER_LEVEL; i++) {
      g.fillStyle = i < done ? '#34ff9a' : 'rgba(148,163,184,0.3)';
      roundRect(g, 540 + i * 23, 92, 17, 10, 4); g.fill();
    }

    // HOLD = waiting to be released (v1 rule), FALL = gravity on
    g.textAlign = 'center'; g.font = '800 40px system-ui, sans-serif';
    g.fillStyle = gravity ? '#34ff9a' : '#ffc93c';
    g.fillText(gravity ? '▼ FALL' : '⏸ HOLD', 820, H / 2 + 2);
    g.font = '700 40px system-ui, sans-serif'; g.textAlign = 'right';
    g.fillStyle = '#64748b';
    g.fillText({ touch: '👆', keys: '⌨', pad: '🎮', vr: '🥽', remote: '📲' }[source] || '', 1000, H / 2 + 2);
    this.bar.tex.needsUpdate = true;
  }

  showBanner(title, sub = '', color = '#00f0ff', seconds = 0) {
    const key = `${title}|${sub}|${color}`;
    this.banner.mesh.visible = true;
    this.bannerTimer = seconds;
    if (key === this.banner.key) return;
    this.banner.key = key;
    const g = this.banner.ctx, W = 1024, H = 176;
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(2,6,23,0.55)';
    roundRect(g, 6, 6, W - 12, H - 12, 40); g.fill();
    g.strokeStyle = color; g.lineWidth = 4; g.stroke();
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = color;
    g.font = `900 ${sub ? 64 : 80}px system-ui, sans-serif`;
    g.fillText(title, W / 2, sub ? 64 : H / 2);
    if (sub) {
      g.fillStyle = '#e2e8f0';
      g.font = '600 40px system-ui, sans-serif';
      g.fillText(sub, W / 2, 130);
    }
    this.banner.tex.needsUpdate = true;
  }

  hideBanner() { this.banner.mesh.visible = false; this.bannerTimer = 0; }

  setVisible(v) {
    this.bar.mesh.visible = v;
    if (!v) { this.hideBanner(); this.hideDialog(); }
    this.syncPanels();
  }

  update(dt) {
    this.elapsed += dt;
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.hideBanner();
    }
    for (const m of this.miniPieces) m.spin.rotation.y = this.elapsed * 0.8 + m.phase;
  }
}
