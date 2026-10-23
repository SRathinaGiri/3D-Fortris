/* ==========================================================================
   3D FORTRIS - GAME RULES
   The v1 rules (js/gameState.js in 1.x), unchanged: pieces spawn at the top
   centre and wait until released (first DROP), then fall; a second DROP is a
   hard drop. Full 3D layers clear, a bomb removes the block under it, a new
   level every five layers. What changed is only the plumbing: the game is
   driven by tick(dt) from the render loop instead of timers, reports what
   happened through onEvent, and has no DOM / storage, so it runs in Node.
   ========================================================================== */

import { DEFAULT_WELL, QUEUE_LENGTH, LAYERS_PER_LEVEL, SCORE, SHAPES, dropDelay, clampWellSize, clampWellHeight } from './config.js';

const createLayer = size => Array.from({ length: size.depth }, () => Array.from({ length: size.width }, () => null));
const createGrid = size => Array.from({ length: size.height }, () => createLayer(size));
const cloneGrid = grid => grid.map(layer => layer.map(row => row.slice()));

export const rotateCell = ([x, y, z], axis) => {
  switch (axis) {
    case 'x': return [x, -z, y];
    case 'y': return [z, y, -x];
    case 'z': return [-y, x, z];
    default: return [x, y, z];
  }
};

/** dir -1 = the other way round (three quarter turns). */
const rotatePiece = (piece, axis, dir = 1) => {
  let cells = piece.cells;
  for (let i = 0; i < (dir < 0 ? 3 : 1); i++) cells = cells.map(c => rotateCell(c, axis));
  return { ...piece, cells };
};

// Wall kicks tried after a rotation, smallest shift first (y, then x, then z on ties)
export const ROTATION_OFFSETS = (() => {
  const values = [0, -1, 1, -2, 2];
  const combos = [];
  for (const y of values) for (const x of values) for (const z of values) combos.push({ x, y, z });
  combos.sort((a, b) => {
    const sumA = Math.abs(a.x) + Math.abs(a.y) + Math.abs(a.z);
    const sumB = Math.abs(b.x) + Math.abs(b.y) + Math.abs(b.z);
    if (sumA !== sumB) return sumA - sumB;
    if (Math.abs(a.y) !== Math.abs(b.y)) return Math.abs(a.y) - Math.abs(b.y);
    if (Math.abs(a.x) !== Math.abs(b.x)) return Math.abs(a.x) - Math.abs(b.x);
    return Math.abs(a.z) - Math.abs(b.z);
  });
  return combos;
})();

const TOTAL_SHAPE_WEIGHT = SHAPES.reduce((sum, s) => sum + (s.weight ?? 1), 0);

const normalizeAngle = angle => {
  const twoPi = Math.PI * 2;
  if (!Number.isFinite(angle)) return 0;
  return ((angle % twoPi) + twoPi) % twoPi;
};

const angleToGridOffset = angle => {
  const a = normalizeAngle(angle);
  const px = Math.cos(a), pz = Math.sin(a);
  if (Math.abs(px) >= Math.abs(pz)) return { x: px >= 0 ? 1 : -1, y: 0, z: 0 };
  return { x: 0, y: 0, z: pz >= 0 ? 1 : -1 };
};

const BASE_DIRECTION_OFFSETS = {
  left: { x: -1, y: 0, z: 0 },
  right: { x: 1, y: 0, z: 0 },
  up: { x: 0, y: 0, z: -1 },
  down: { x: 0, y: 0, z: 1 }
};

/**
 * Grid step for "left/right/up/down" as seen from a camera at orbit angle theta
 * (camera at x = cos θ, z = sin θ around the well): up = away from the camera.
 */
export function directionalOffset(key, cameraTheta) {
  const base = BASE_DIRECTION_OFFSETS[key];
  if (!base) return null;
  if (!Number.isFinite(cameraTheta)) return base;
  const forward = normalizeAngle(cameraTheta + Math.PI);
  const right = normalizeAngle(forward + Math.PI / 2);
  const angle = { up: forward, down: forward + Math.PI, right, left: right + Math.PI }[key];
  return angleToGridOffset(angle);
}

export class FortrisGame {
  /**
   * @param {object} o
   * @param {number} [o.size] well width = depth
   * @param {number} [o.height] well height (12 / 15 / 20)
   * @param {() => number} [o.rng] random source (seeded in tests)
   * @param {(type: string, data?: object) => void} [o.onEvent]
   */
  constructor({ size = DEFAULT_WELL.width, height = DEFAULT_WELL.height, rng = Math.random, onEvent = () => {} } = {}) {
    this.rng = rng;
    this.onEvent = onEvent;
    this.reset(size, height);
  }

  emit(type, data = {}) { this.onEvent(type, data); }

  /** A new game: always level 1, empty well. */
  reset(size = this.size.width, height = this.size.height) {
    const s = clampWellSize(size);
    this.size = { width: s, depth: s, height: clampWellHeight(height) };
    this.grid = createGrid(this.size);
    this.score = 0;
    this.level = 1;
    this.lines = 0;
    this.over = false;
    this.gravity = false;  // a fresh piece waits until it is released
    this.dropTimer = 0;
    this.pieces = 0;
    this.queue = Array.from({ length: QUEUE_LENGTH + 1 }, () => this.createPiece());
    this.active = this.queue.shift();
    this.refillQueue();
  }

  /* ---------------- Pieces ---------------- */
  randomShape() {
    const target = this.rng() * TOTAL_SHAPE_WEIGHT;
    let cumulative = 0;
    for (const shape of SHAPES) {
      cumulative += shape.weight ?? 1;
      if (target <= cumulative) return shape;
    }
    return SHAPES[SHAPES.length - 1];
  }

  spawnPosition(shape) {
    const highest = shape.cells.reduce((max, [, y]) => Math.max(max, y), 0);
    return { x: Math.floor(this.size.width / 2), y: this.size.height - 1 - highest, z: Math.floor(this.size.depth / 2) };
  }

  createPiece(shape = this.randomShape()) {
    return { name: shape.name, color: shape.color, type: shape.type, cells: shape.cells.map(c => c.slice()), position: this.spawnPosition(shape) };
  }

  refillQueue() {
    while (this.queue.length < QUEUE_LENGTH) this.queue.push(this.createPiece());
  }

  get dropDelay() { return dropDelay(this.level); }

  /* ---------------- Movement ---------------- */
  canPlace(piece, offset = { x: 0, y: 0, z: 0 }) {
    const { width, height, depth } = this.size;
    return piece.cells.every(([cx, cy, cz]) => {
      const x = piece.position.x + cx + offset.x;
      const y = piece.position.y + cy + offset.y;
      const z = piece.position.z + cz + offset.z;
      if (x < 0 || x >= width || y < 0 || y >= height || z < 0 || z >= depth) return false;
      return !this.grid[y][z][x];
    });
  }

  shift(offset) {
    if (!this.active || this.over) return false;
    if (!this.canPlace(this.active, offset)) return false;
    const p = this.active.position;
    this.active = { ...this.active, position: { x: p.x + offset.x, y: p.y + offset.y, z: p.z + offset.z } };
    return true;
  }

  /** Move 'left' | 'right' | 'up' | 'down' relative to the camera's orbit angle. */
  moveRelative(key, cameraTheta) {
    const offset = directionalOffset(key, cameraTheta);
    if (!offset) return false;
    const moved = this.shift(offset);
    this.emit(moved ? 'move' : 'bump', { offset });
    return moved;
  }

  rotate(axis, dir = 1) {
    if (!this.active || this.over) return false;
    const rotated = rotatePiece(this.active, axis, dir);
    for (const offset of ROTATION_OFFSETS) {
      if (this.canPlace(rotated, offset)) {
        const p = rotated.position;
        this.active = { ...rotated, position: { x: p.x + offset.x, y: p.y + offset.y, z: p.z + offset.z } };
        this.emit('rotate', { axis });
        return true;
      }
    }
    this.emit('bump', { axis });
    return false;
  }

  /** First press lets the waiting piece fall; a second press is a hard drop. */
  release() {
    if (!this.active || this.over) return;
    if (!this.gravity) {
      this.gravity = true;
      this.dropTimer = 0;
      this.emit('release');
      return;
    }
    this.hardDrop();
  }

  hardDrop() {
    if (!this.active || this.over) return;
    const from = this.active.position.y;
    while (this.canPlace(this.active, { x: 0, y: -1, z: 0 })) {
      this.active = { ...this.active, position: { ...this.active.position, y: this.active.position.y - 1 } };
    }
    this.emit('harddrop', { distance: from - this.active.position.y });
    this.lock();
  }

  /** One gravity step: fall a layer, or lock when resting on something. */
  step() {
    if (!this.active || this.over) return;
    if (this.canPlace(this.active, { x: 0, y: -1, z: 0 })) {
      this.active = { ...this.active, position: { ...this.active.position, y: this.active.position.y - 1 } };
      this.emit('fall');
      return;
    }
    this.lock();
  }

  /** Advance gravity by dt seconds (call only while playing). */
  tick(dt) {
    if (this.over || !this.gravity || !this.active) return;
    this.dropTimer += dt * 1000;
    const delay = this.dropDelay;
    while (this.dropTimer >= delay && this.gravity && !this.over) {
      this.dropTimer -= delay;
      this.step();
    }
  }

  /** Where the active piece would come to rest (the landing ghost). */
  landing(piece = this.active) {
    if (!piece) return null;
    let p = piece;
    while (this.canPlace(p, { x: 0, y: -1, z: 0 })) p = { ...p, position: { ...p.position, y: p.position.y - 1 } };
    return p;
  }

  cellsOf(piece = this.active) {
    if (!piece) return [];
    return piece.cells.map(([cx, cy, cz]) => ({ x: piece.position.x + cx, y: piece.position.y + cy, z: piece.position.z + cz }));
  }

  /* ---------------- Locking & clearing ---------------- */
  lock() {
    if (!this.active) return;
    const piece = this.active;
    const { width, height, depth } = this.size;
    const inside = ({ x, y, z }) => x >= 0 && x < width && y >= 0 && y < height && z >= 0 && z < depth;
    let merged = cloneGrid(this.grid);
    let bombRemoved = 0;
    if (piece.type === 'bomb') {
      // A bomb takes out the block just below it (or the one it sits in)
      const removedCells = [];
      for (const c of this.cellsOf(piece)) {
        if (c.x < 0 || c.x >= width || c.z < 0 || c.z >= depth) continue;
        const target = [c.y - 1, c.y].find(l => l >= 0 && l < height && merged[l][c.z][c.x]);
        if (typeof target === 'number') {
          removedCells.push({ x: c.x, y: target, z: c.z, color: merged[target][c.z][c.x].color });
          merged[target][c.z][c.x] = null;
          bombRemoved += 1;
        }
      }
      this.emit('bomb', { at: this.cellsOf(piece)[0], removed: removedCells });
    } else {
      for (const c of this.cellsOf(piece)) if (inside(c)) merged[c.y][c.z][c.x] = { color: piece.color };
      this.emit('lock', { cells: this.cellsOf(piece), color: piece.color });
    }

    const cleared = [];
    for (let y = 0; y < height; y++) if (merged[y].every(row => row.every(cell => cell))) cleared.push(y);
    if (cleared.length) {
      const cells = [];
      for (const y of cleared) merged[y].forEach((row, z) => row.forEach((cell, x) => cells.push({ x, y, z, color: cell.color })));
      const compacted = merged.filter((_, i) => !cleared.includes(i));
      while (compacted.length < height) compacted.push(createLayer(this.size));
      merged = compacted;
      this.emit('clear', { layers: cleared, cells });
    }

    this.grid = merged;
    this.score += cleared.length * SCORE.LAYER * this.level;
    this.lines += cleared.length;
    this.pieces += 1;
    const newLevel = Math.max(1, Math.floor(this.lines / LAYERS_PER_LEVEL) + 1);
    if (newLevel !== this.level) {
      this.level = newLevel;
      this.emit('levelup', { level: newLevel });
    }
    if (cleared.length >= SCORE.PERFECT_LAYERS) this.emit('perfect');
    if (bombRemoved > 0) this.score += bombRemoved * SCORE.BOMB_BLOCK;

    if (!this.queue.length) this.queue = Array.from({ length: QUEUE_LENGTH + 1 }, () => this.createPiece());
    const candidate = this.queue.shift() || this.createPiece();
    this.refillQueue();
    this.gravity = false;
    this.dropTimer = 0;
    if (!this.canPlace(candidate)) {
      this.active = null;
      this.over = true;
      this.emit('gameover', { score: this.score });
      return;
    }
    this.active = candidate;
    this.emit('spawn', { piece: candidate });
  }

  /* ---------------- Info for the HUD ---------------- */
  /** Filled cells per layer, bottom first. */
  layerFill() {
    return this.grid.map(layer => layer.reduce((n, row) => n + row.reduce((m, c) => m + (c ? 1 : 0), 0), 0));
  }

  /** Height of the stack (number of layers with at least one block, counted from the bottom). */
  stackHeight() {
    const fill = this.layerFill();
    for (let y = fill.length - 1; y >= 0; y--) if (fill[y]) return y + 1;
    return 0;
  }

  /* ---------------- Save / resume ---------------- */
  serialize() {
    const piece = p => p && { name: p.name, color: p.color, type: p.type, cells: p.cells, position: p.position };
    return {
      size: this.size.width, height: this.size.height,
      grid: this.grid.map(layer => layer.map(row => row.map(c => (c ? c.color : 0)))),
      active: piece(this.active), queue: this.queue.map(piece),
      score: this.score, level: this.level, lines: this.lines, pieces: this.pieces
    };
  }

  /** Restore a serialize()d game; returns false (and leaves a fresh game) when the data doesn't fit. */
  restore(s) {
    try {
      if (!s || !Array.isArray(s.grid) || !s.active) return false;
      this.reset(s.size, s.height ?? s.grid.length);
      const { width, height, depth } = this.size;
      if (s.grid.length !== height || s.grid[0].length !== depth || s.grid[0][0].length !== width) throw new Error('size');
      this.grid = s.grid.map(layer => layer.map(row => row.map(c => (c ? { color: String(c) } : null))));
      const piece = p => ({ name: p.name, color: p.color, type: p.type, cells: p.cells.map(c => c.slice(0, 3).map(Number)), position: { ...p.position } });
      this.active = piece(s.active);
      this.queue = (s.queue || []).filter(Boolean).map(piece);
      this.refillQueue();
      this.score = s.score | 0; this.level = Math.max(1, s.level | 0); this.lines = s.lines | 0; this.pieces = s.pieces | 0;
      this.gravity = false;
      if (!this.canPlace(this.active)) throw new Error('blocked');
      return true;
    } catch (_) {
      this.reset(s && s.size, s && s.height);
      return false;
    }
  }
}
