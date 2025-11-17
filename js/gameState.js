import { BOARD_SIZE, STORAGE_KEY, SHAPES } from './constants.js';

const QUEUE_LENGTH = 3;

const createLayer = () => Array.from(
  { length: BOARD_SIZE.depth },
  () => Array.from({ length: BOARD_SIZE.width }, () => null),
);

const createGrid = () => Array.from({ length: BOARD_SIZE.height }, () => createLayer());

const rotateCell = ([x, y, z], axis) => {
  switch (axis) {
    case 'x':
      return [x, -z, y];
    case 'y':
      return [z, y, -x];
    case 'z':
      return [-y, x, z];
    default:
      return [x, y, z];
  }
};

const rotatePiece = (piece, axis) => ({
  ...piece,
  cells: piece.cells.map((cell) => rotateCell(cell, axis)),
});

const randomShape = () => SHAPES[Math.floor(Math.random() * SHAPES.length)];

const spawnPosition = (shape) => {
  const highestOffset = shape.cells.reduce((max, [, y]) => Math.max(max, y), 0);
  return {
    x: Math.floor(BOARD_SIZE.width / 2),
    y: BOARD_SIZE.height - 1 - highestOffset,
    z: Math.floor(BOARD_SIZE.depth / 2),
  };
};

const createPiece = (shape = randomShape()) => ({
  ...shape,
  position: spawnPosition(shape),
});

const createQueue = (length = QUEUE_LENGTH) => Array.from({ length }, () => createPiece());

const mergePiece = (grid, piece) => {
  const newGrid = grid.map((layer) => layer.map((row) => row.slice()));
  piece.cells.forEach(([cx, cy, cz]) => {
    const x = piece.position.x + cx;
    const y = piece.position.y + cy;
    const z = piece.position.z + cz;
    if (y >= 0 && y < BOARD_SIZE.height && z >= 0 && z < BOARD_SIZE.depth && x >= 0 && x < BOARD_SIZE.width) {
      newGrid[y][z][x] = { color: piece.color };
    }
  });
  return newGrid;
};

export class GameState {
  constructor() {
    this.grid = createGrid();
    this.activePiece = null;
    this.upcomingPieces = [];
    this.nextPiece = null;
    this.score = 0;
    this.level = 1;
    this.linesCleared = 0;
    this.viewType = 'perspective';
    this.stereoSettings = { eyeDistance: 0.065, focusDepth: 5, fov: 60 };
    this.cubeOpacity = 0.85;
    this.isPaused = false;
    this.gameOver = false;
    this.message = '';
    this.clearingLayers = [];
    this.gravityEnabled = false;
    this.loopHandle = null;
    this.clearTimer = null;
    this.messageTimer = null;
    this.keyHandler = (event) => this.handleKey(event);
    this.subscribers = new Set();
    this.initializePieces();
    this.loadProgress();
  }

  initializePieces() {
    this.upcomingPieces = createQueue(QUEUE_LENGTH + 1);
    this.activePiece = this.upcomingPieces.shift() ?? createPiece();
    this.refillQueue();
  }

  refillQueue() {
    while (this.upcomingPieces.length < QUEUE_LENGTH) {
      this.upcomingPieces.push(createPiece());
    }
    this.nextPiece = this.upcomingPieces[0] ?? null;
  }

  loadProgress() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return;
      const parsed = JSON.parse(saved);
      this.level = parsed.level ?? this.level;
      this.score = parsed.score ?? this.score;
      this.linesCleared = parsed.linesCleared ?? this.linesCleared;
    } catch (error) {
      console.warn('Failed to restore progress', error);
    }
  }

  persistProgress() {
    try {
      const payload = JSON.stringify({
        level: this.level,
        score: this.score,
        linesCleared: this.linesCleared,
      });
      localStorage.setItem(STORAGE_KEY, payload);
    } catch (error) {
      console.warn('Failed to persist progress', error);
    }
  }

  subscribe(listener) {
    this.subscribers.add(listener);
    listener(this.snapshot());
    return () => this.subscribers.delete(listener);
  }

  snapshot() {
    return {
      grid: this.grid,
      activePiece: this.activePiece,
      nextPiece: this.nextPiece,
      nextQueue: this.upcomingPieces,
      score: this.score,
      level: this.level,
      linesCleared: this.linesCleared,
      viewType: this.viewType,
      stereoSettings: this.stereoSettings,
      cubeOpacity: this.cubeOpacity,
      isPaused: this.isPaused,
      message: this.message,
      clearingLayers: this.clearingLayers,
    };
  }

  notify() {
    const state = this.snapshot();
    this.subscribers.forEach((listener) => listener(state));
    this.persistProgress();
  }

  start() {
    window.addEventListener('keydown', this.keyHandler);
    this.scheduleLoop();
    this.notify();
  }

  destroy() {
    this.stopLoop();
    window.removeEventListener('keydown', this.keyHandler);
    clearTimeout(this.clearTimer);
    clearTimeout(this.messageTimer);
  }

  scheduleLoop() {
    if (this.loopHandle) {
      clearInterval(this.loopHandle);
      this.loopHandle = null;
    }
    if (this.isPaused || this.gameOver || !this.gravityEnabled) return;
    this.loopHandle = setInterval(() => this.dropPiece(), this.loopDelay());
  }

  stopLoop() {
    if (this.loopHandle) {
      clearInterval(this.loopHandle);
      this.loopHandle = null;
    }
  }

  loopDelay() {
    return Math.max(250, 1200 - this.level * 90);
  }

  setMessage(text, duration = 0) {
    this.message = text;
    if (this.messageTimer) clearTimeout(this.messageTimer);
    if (duration > 0) {
      this.messageTimer = setTimeout(() => {
        this.message = '';
        this.notify();
      }, duration);
    }
  }

  resetGame() {
    this.grid = createGrid();
    this.initializePieces();
    this.score = 0;
    this.level = 1;
    this.linesCleared = 0;
    this.gameOver = false;
    this.isPaused = false;
    this.clearingLayers = [];
    this.gravityEnabled = false;
    this.setMessage('Fresh run engaged!', 2000);
    this.notify();
    this.scheduleLoop();
  }

  togglePause() {
    this.isPaused = !this.isPaused;
    this.setMessage(this.isPaused ? 'Game paused' : '');
    this.notify();
    this.scheduleLoop();
  }

  updateView(view) {
    this.viewType = view;
    this.notify();
  }

  updateStereoSettings(partial) {
    this.stereoSettings = { ...this.stereoSettings, ...partial };
    this.notify();
  }

  updateOpacity(value) {
    const clamped = Math.max(0.2, Math.min(1, Number.isFinite(value) ? value : this.cubeOpacity));
    this.cubeOpacity = clamped;
    this.notify();
  }

  canPlace(piece, offset = { x: 0, y: 0, z: 0 }) {
    return piece.cells.every(([cx, cy, cz]) => {
      const x = piece.position.x + cx + offset.x;
      const y = piece.position.y + cy + offset.y;
      const z = piece.position.z + cz + offset.z;
      if (x < 0 || x >= BOARD_SIZE.width) return false;
      if (y < 0 || y >= BOARD_SIZE.height) return false;
      if (z < 0 || z >= BOARD_SIZE.depth) return false;
      return !this.grid[y][z][x];
    });
  }

  updatePiecePosition(offset) {
    if (!this.activePiece) return;
    if (this.canPlace(this.activePiece, offset)) {
      this.activePiece = {
        ...this.activePiece,
        position: {
          x: this.activePiece.position.x + offset.x,
          y: this.activePiece.position.y + offset.y,
          z: this.activePiece.position.z + offset.z,
        },
      };
      this.notify();
    }
  }

  rotateActive(axis) {
    if (!this.activePiece) return;
    const rotated = rotatePiece(this.activePiece, axis);
    if (this.canPlace(rotated)) {
      this.activePiece = rotated;
      this.notify();
    }
  }

  hardDrop() {
    if (!this.activePiece) return;
    let fallingPiece = { ...this.activePiece, position: { ...this.activePiece.position } };
    while (this.canPlace(fallingPiece, { x: 0, y: -1, z: 0 })) {
      fallingPiece = {
        ...fallingPiece,
        position: { ...fallingPiece.position, y: fallingPiece.position.y - 1 },
      };
    }
    this.activePiece = fallingPiece;
    this.notify();
    this.dropPiece(true);
  }

  dropPiece(forceLock = false) {
    if (!this.activePiece) return;
    if (!forceLock && this.canPlace(this.activePiece, { x: 0, y: -1, z: 0 })) {
      this.activePiece = {
        ...this.activePiece,
        position: { ...this.activePiece.position, y: this.activePiece.position.y - 1 },
      };
      this.notify();
      return;
    }
    this.lockPiece();
  }

  lockPiece() {
    if (!this.activePiece) return;
    const merged = mergePiece(this.grid, this.activePiece);
    const clearedLayers = [];
    for (let y = 0; y < BOARD_SIZE.height; y += 1) {
      const isFull = merged[y].every((row) => row.every((cell) => cell));
      if (isFull) clearedLayers.push(y);
    }

    if (clearedLayers.length) {
      this.clearingLayers = clearedLayers;
      clearTimeout(this.clearTimer);
      this.clearTimer = setTimeout(() => {
        this.clearingLayers = [];
        this.notify();
      }, 400);
    }

    let collapsed = merged;
    if (clearedLayers.length) {
      const compacted = merged.filter((_, idx) => !clearedLayers.includes(idx));
      while (compacted.length < BOARD_SIZE.height) {
        compacted.push(createLayer());
      }
      collapsed = compacted;
    }

    this.grid = collapsed;
    this.score += clearedLayers.length * 100 * this.level;
    this.linesCleared += clearedLayers.length;
    const newLevel = Math.max(1, Math.floor(this.linesCleared / 5) + 1);
    if (newLevel !== this.level) {
      this.level = newLevel;
    }
    if (clearedLayers.length >= 5) {
      this.setMessage('Perfect clear!', 2000);
    }

    if (!this.upcomingPieces || !this.upcomingPieces.length) {
      this.upcomingPieces = createQueue(QUEUE_LENGTH + 1);
    }
    const candidate = this.upcomingPieces.shift() || createPiece();
    this.refillQueue();
    if (!this.canPlace(candidate)) {
      this.activePiece = null;
      this.gameOver = true;
      this.isPaused = true;
      this.setMessage('Mission failed. Restart to try again.');
      this.notify();
      this.scheduleLoop();
      return;
    }

    this.activePiece = candidate;
    this.gravityEnabled = false;
    this.notify();
    this.scheduleLoop();
  }

  releasePiece() {
    if (!this.activePiece) return;
    if (!this.gravityEnabled) {
      this.gravityEnabled = true;
      this.scheduleLoop();
      return;
    }
    this.hardDrop();
  }

  handleKey(event) {
    if (this.gameOver) return;
    const key = event.key.toLowerCase();
    switch (key) {
      case 'arrowleft':
        event.preventDefault();
        this.updatePiecePosition({ x: -1, y: 0, z: 0 });
        break;
      case 'arrowright':
        event.preventDefault();
        this.updatePiecePosition({ x: 1, y: 0, z: 0 });
        break;
      case 'arrowup':
        event.preventDefault();
        this.updatePiecePosition({ x: 0, y: 0, z: -1 });
        break;
      case 'arrowdown':
        event.preventDefault();
        this.updatePiecePosition({ x: 0, y: 0, z: 1 });
        break;
      case 'q':
      case 'e':
        this.rotateActive('x');
        break;
      case 'a':
      case 'd':
        this.rotateActive('y');
        break;
      case 'w':
      case 's':
        this.rotateActive('z');
        break;
      case ' ':
        event.preventDefault();
        this.releasePiece();
        break;
      case 'p':
        this.togglePause();
        break;
      default:
        break;
    }
  }
}
