import { DEFAULT_BOARD_SIZE, BOARD_LIMITS, STORAGE_KEY, SHAPES } from './constants.js';

const QUEUE_LENGTH = 3;

const clampGridSize = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_BOARD_SIZE.width;
  return Math.max(BOARD_LIMITS.min, Math.min(BOARD_LIMITS.max, Math.round(numeric)));
};

const readSavedProgress = () => {
  try {
    if (typeof localStorage === 'undefined') return null;
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return null;
    return JSON.parse(saved);
  } catch (error) {
    console.warn('Failed to read progress', error);
    return null;
  }
};

const createLayer = (boardSize) =>
  Array.from({ length: boardSize.depth }, () => Array.from({ length: boardSize.width }, () => null));

const createGrid = (boardSize) => Array.from({ length: boardSize.height }, () => createLayer(boardSize));

const cloneGrid = (grid) => grid.map((layer) => layer.map((row) => row.slice()));

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

const ROTATION_OFFSETS = (() => {
  const values = [0, -1, 1, -2, 2];
  const combos = [];
  values.forEach((y) => {
    values.forEach((x) => {
      values.forEach((z) => {
        combos.push({ x, y, z });
      });
    });
  });
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

const TOTAL_SHAPE_WEIGHT = SHAPES.reduce((sum, shape) => sum + (shape.weight ?? 1), 0);

const randomShape = () => {
  const target = Math.random() * TOTAL_SHAPE_WEIGHT;
  let cumulative = 0;
  for (const shape of SHAPES) {
    cumulative += shape.weight ?? 1;
    if (target <= cumulative) return shape;
  }
  return SHAPES[SHAPES.length - 1];
};

const randomShape = () => {
  const target = Math.random() * TOTAL_SHAPE_WEIGHT;
  let cumulative = 0;
  for (const shape of SHAPES) {
    cumulative += shape.weight ?? 1;
    if (target <= cumulative) return shape;
  }
  return SHAPES[SHAPES.length - 1];
};

const spawnPosition = (shape, boardSize) => {
  const highestOffset = shape.cells.reduce((max, [, y]) => Math.max(max, y), 0);
  return {
    x: Math.floor(boardSize.width / 2),
    y: boardSize.height - 1 - highestOffset,
    z: Math.floor(boardSize.depth / 2),
  };
};

const createPiece = (shape = randomShape(), boardSize = DEFAULT_BOARD_SIZE) => ({
  ...shape,
  position: spawnPosition(shape, boardSize),
});

const createQueue = (length = QUEUE_LENGTH, boardSize = DEFAULT_BOARD_SIZE) =>
  Array.from({ length }, () => createPiece(undefined, boardSize));

const mergePiece = (grid, piece, boardSize) => {
const newGrid = cloneGrid(grid);
  piece.cells.forEach(([cx, cy, cz]) => {
    const x = piece.position.x + cx;
    const y = piece.position.y + cy;
    const z = piece.position.z + cz;
    if (
      y >= 0 &&
      y < boardSize.height &&
      z >= 0 &&
      z < boardSize.depth &&
      x >= 0 &&
      x < boardSize.width
    ) {
      newGrid[y][z][x] = { color: piece.color };
    }
  });
  return newGrid;
};

const applyBombEffect = (grid, piece, boardSize) => {
  const newGrid = cloneGrid(grid);
  let removed = 0;
  piece.cells.forEach(([cx, cy, cz]) => {
    const x = piece.position.x + cx;
    const y = piece.position.y + cy;
    const z = piece.position.z + cz;
    if (x < 0 || x >= boardSize.width) return;
    if (z < 0 || z >= boardSize.depth) return;
    const targets = [];
    if (y - 1 >= 0) targets.push(y - 1);
    targets.push(y);
    const targetLayer = targets.find(
      (layer) => layer >= 0 && layer < boardSize.height && newGrid[layer][z][x],
    );
    if (typeof targetLayer === 'number') {
      newGrid[targetLayer][z][x] = null;
      removed += 1;
    }
  });
  return { grid: newGrid, removed };
};

export class GameState {
  constructor() {
    const savedProgress = readSavedProgress();
    this.boardSize = { ...DEFAULT_BOARD_SIZE };
    if (savedProgress?.boardSize) {
      const savedWidth = clampGridSize(savedProgress.boardSize.width ?? savedProgress.boardSize.depth);
      this.boardSize.width = savedWidth;
      this.boardSize.depth = savedWidth;
    }
    this.grid = createGrid(this.boardSize);
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
    this.applySavedProgress(savedProgress);
  }

  initializePieces() {
    this.upcomingPieces = createQueue(QUEUE_LENGTH + 1, this.boardSize);
    this.activePiece = this.upcomingPieces.shift() ?? createPiece(undefined, this.boardSize);
    this.refillQueue();
  }

  refillQueue() {
    while (this.upcomingPieces.length < QUEUE_LENGTH) {
      this.upcomingPieces.push(createPiece(undefined, this.boardSize));
    }
    this.nextPiece = this.upcomingPieces[0] ?? null;
  }

  applySavedProgress(savedProgress) {
    if (!savedProgress) return;
    this.level = savedProgress.level ?? this.level;
    this.score = savedProgress.score ?? this.score;
    this.linesCleared = savedProgress.linesCleared ?? this.linesCleared;
  }

  persistProgress() {
    try {
      if (typeof localStorage === 'undefined') return;
      const payload = JSON.stringify({
        level: this.level,
        score: this.score,
        linesCleared: this.linesCleared,
        boardSize: this.boardSize,
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
      boardSize: this.boardSize,
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

  resetGame(options = {}) {
    const { message = 'Fresh run engaged!', messageDuration = 2000 } = options;
    this.grid = createGrid(this.boardSize);
    this.initializePieces();
    this.score = 0;
    this.level = 1;
    this.linesCleared = 0;
    this.gameOver = false;
    this.isPaused = false;
    this.clearingLayers = [];
    this.gravityEnabled = false;
    this.setMessage(message, messageDuration);
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

  updateBoardSize(nextSize) {
    const sanitized = clampGridSize(nextSize);
    if (sanitized === this.boardSize.width && sanitized === this.boardSize.depth) {
      return;
    }
    this.boardSize = { ...this.boardSize, width: sanitized, depth: sanitized };
    this.resetGame({
      message: `Playfield resized to ${sanitized}×${sanitized}. Fresh run engaged!`,
      messageDuration: 2500,
    });
  }

  canPlace(piece, offset = { x: 0, y: 0, z: 0 }) {
    return piece.cells.every(([cx, cy, cz]) => {
      const x = piece.position.x + cx + offset.x;
      const y = piece.position.y + cy + offset.y;
      const z = piece.position.z + cz + offset.z;
      if (x < 0 || x >= this.boardSize.width) return false;
      if (y < 0 || y >= this.boardSize.height) return false;
      if (z < 0 || z >= this.boardSize.depth) return false;
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
    for (const offset of ROTATION_OFFSETS) {
      if (this.canPlace(rotated, offset)) {
        this.activePiece = {
          ...rotated,
          position: {
            x: rotated.position.x + offset.x,
            y: rotated.position.y + offset.y,
            z: rotated.position.z + offset.z,
          },
        };
        this.notify();
        return;
      }
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
    let merged;
    let bombRemoval = 0;
    if (this.activePiece.type === 'bomb') {
      const result = applyBombEffect(this.grid, this.activePiece, this.boardSize);
      merged = result.grid;
      bombRemoval = result.removed;
    } else {
      merged = mergePiece(this.grid, this.activePiece, this.boardSize);
    }
    const clearedLayers = [];
    for (let y = 0; y < this.boardSize.height; y += 1) {
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
      while (compacted.length < this.boardSize.height) {
        compacted.push(createLayer(this.boardSize));
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

    if (bombRemoval > 0) {
      this.score += bombRemoval * 50;
      this.setMessage('Bomb cleared an obstacle!', 1200);
    }

    if (!this.upcomingPieces || !this.upcomingPieces.length) {
      this.upcomingPieces = createQueue(QUEUE_LENGTH + 1, this.boardSize);
    }
    const candidate = this.upcomingPieces.shift() || createPiece(undefined, this.boardSize);
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
