import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BOARD_SIZE, STORAGE_KEY } from './gameSettings.js';

const SHAPES = [
  { name: 'I', color: '#38bdf8', cells: [[0, 0, 0], [1, 0, 0], [-1, 0, 0], [-2, 0, 0]] },
  { name: 'L', color: '#f472b6', cells: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]] },
  { name: 'T', color: '#c084fc', cells: [[0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1]] },
  { name: 'S', color: '#34d399', cells: [[0, 0, 0], [1, 0, 0], [0, 0, 1], [-1, 0, 1]] },
  { name: 'Cube', color: '#facc15', cells: [[0, 0, 0], [1, 0, 0], [0, 0, 1], [1, 0, 1], [0, 1, 0], [1, 1, 0], [0, 1, 1], [1, 1, 1]] },
];

const createLayer = () => Array.from({ length: BOARD_SIZE.depth }, () => Array.from({ length: BOARD_SIZE.width }, () => null));
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

const createPiece = (shape = randomShape()) => ({
  ...shape,
  position: {
    x: Math.floor(BOARD_SIZE.width / 2),
    y: BOARD_SIZE.height - 1,
    z: Math.floor(BOARD_SIZE.depth / 2),
  },
});

const canPlace = (grid, piece, offset = { x: 0, y: 0, z: 0 }) => {
  return piece.cells.every(([cx, cy, cz]) => {
    const x = piece.position.x + cx + offset.x;
    const y = piece.position.y + cy + offset.y;
    const z = piece.position.z + cz + offset.z;
    if (x < 0 || x >= BOARD_SIZE.width) return false;
    if (y < 0 || y >= BOARD_SIZE.height) return false;
    if (z < 0 || z >= BOARD_SIZE.depth) return false;
    return !grid[y][z][x];
  });
};

const mergePiece = (grid, piece) => {
  const newGrid = grid.map((layer) => layer.map((row) => row.slice()));
  piece.cells.forEach(([cx, cy, cz]) => {
    const x = piece.position.x + cx;
    const y = piece.position.y + cy;
    const z = piece.position.z + cz;
    if (y >= 0 && y < BOARD_SIZE.height) {
      newGrid[y][z][x] = { color: piece.color };
    }
  });
  return newGrid;
};

function useGameLogic() {
  const [grid, setGrid] = useState(createGrid);
  const [activePiece, setActivePiece] = useState(() => createPiece());
  const [nextPiece, setNextPiece] = useState(() => createPiece());
  const [score, setScore] = useState(0);
  const [level, setLevel] = useState(1);
  const [linesCleared, setLinesCleared] = useState(0);
  const [viewType, setViewType] = useState('perspective');
  const [stereoSettings, setStereoSettings] = useState({ eyeDistance: 0.065, focusDepth: 5, fov: 60 });
  const [isPaused, setIsPaused] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [message, setMessage] = useState('');
  const [clearingLayers, setClearingLayers] = useState([]);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) {
      loadedRef.current = true;
      return;
    }
    try {
      const parsed = JSON.parse(saved);
      setLevel(parsed.level ?? 1);
      setScore(parsed.score ?? 0);
      setLinesCleared(parsed.linesCleared ?? 0);
    } catch (error) {
      console.warn('Failed to restore progress', error);
    } finally {
      loadedRef.current = true;
    }
  }, []);

  useEffect(() => {
    if (!loadedRef.current) return;
    if (typeof window === 'undefined') return;
    const payload = JSON.stringify({ level, score, linesCleared });
    window.localStorage.setItem(STORAGE_KEY, payload);
  }, [level, score, linesCleared]);

  const updatePiecePosition = useCallback((offset) => {
    setActivePiece((current) => {
      if (!current) return null;
      if (canPlace(grid, current, offset)) {
        return {
          ...current,
          position: {
            x: current.position.x + offset.x,
            y: current.position.y + offset.y,
            z: current.position.z + offset.z,
          },
        };
      }
      return current;
    });
  }, [grid]);

  const dropPiece = useCallback(() => {
    setActivePiece((current) => {
      if (!current) return null;
      if (canPlace(grid, current, { x: 0, y: -1, z: 0 })) {
        return { ...current, position: { ...current.position, y: current.position.y - 1 } };
      }
      const merged = mergePiece(grid, current);
      const cleared = [];
      for (let y = 0; y < BOARD_SIZE.height; y += 1) {
        const full = merged[y].every((row) => row.every((cell) => cell));
        if (full) cleared.push(y);
      }

      if (cleared.length) {
        setClearingLayers(cleared);
        setTimeout(() => setClearingLayers([]), 400);
      }

      let collapsed = merged;
      if (cleared.length) {
        const compacted = merged.filter((_, layerIndex) => !cleared.includes(layerIndex));
        while (compacted.length < BOARD_SIZE.height) {
          compacted.push(createLayer());
        }
        collapsed = compacted;
      }

      setGrid(collapsed);
      setScore((prev) => prev + cleared.length * 100 * level);
      const updatedLines = linesCleared + cleared.length;
      setLinesCleared(updatedLines);
      const computedLevel = Math.max(1, Math.floor(updatedLines / 5) + 1);
      if (computedLevel !== level) {
        setLevel(computedLevel);
      }
      if (cleared.length >= 5) {
        setMessage('Perfect clear!');
        setTimeout(() => setMessage(''), 2000);
      }
      if ((linesCleared + cleared.length) / 5 >= level) {
        setLevel((prev) => prev + 1);
      }

      const candidate = nextPiece;
      const freshPiece = { ...candidate, position: { ...candidate.position } };
      setNextPiece(createPiece());

      if (!canPlace(collapsed, freshPiece)) {
        setMessage('Mission failed. Restart to try again.');
        setIsPaused(true);
        setGameOver(true);
        return null;
      }

      return freshPiece;
    });
  }, [grid, level, linesCleared, nextPiece]);

  const rotateActive = useCallback((axis) => {
    setActivePiece((current) => {
      if (!current) return null;
      const rotated = rotatePiece(current, axis);
      if (canPlace(grid, rotated)) {
        return rotated;
      }
      return current;
    });
  }, [grid]);

  const hardDrop = useCallback(() => {
    setActivePiece((current) => {
      if (!current) return null;
      let testPiece = current;
      while (canPlace(grid, testPiece, { x: 0, y: -1, z: 0 })) {
        testPiece = {
          ...testPiece,
          position: { ...testPiece.position, y: testPiece.position.y - 1 },
        };
      }
      return testPiece;
    });
    setTimeout(() => dropPiece(), 0);
  }, [dropPiece, grid]);

  const loopSpeed = useMemo(() => Math.max(250, 1200 - level * 90), [level]);

  useEffect(() => {
    if (isPaused || gameOver) return;
    const interval = setInterval(() => {
      dropPiece();
    }, loopSpeed);
    return () => clearInterval(interval);
  }, [dropPiece, loopSpeed, isPaused, gameOver]);

  const togglePause = useCallback(() => {
    setIsPaused((prev) => {
      const next = !prev;
      setMessage(next ? 'Game paused' : '');
      return next;
    });
  }, []);

  const resetGame = useCallback(() => {
    setGrid(createGrid());
    setActivePiece(createPiece());
    setNextPiece(createPiece());
    setScore(0);
    setLevel(1);
    setLinesCleared(0);
    setGameOver(false);
    setIsPaused(false);
    setMessage('Fresh run engaged!');
    setTimeout(() => setMessage(''), 2000);
  }, []);

  const updateView = useCallback((nextView) => {
    setViewType(nextView);
  }, []);

  const updateStereoSettings = useCallback((partial) => {
    setStereoSettings((prev) => ({ ...prev, ...partial }));
  }, []);

  const handleKeyPress = useCallback((event) => {
    if (gameOver) return;
    switch (event.key.toLowerCase()) {
      case 'arrowleft':
        event.preventDefault();
        updatePiecePosition({ x: -1, y: 0, z: 0 });
        break;
      case 'arrowright':
        event.preventDefault();
        updatePiecePosition({ x: 1, y: 0, z: 0 });
        break;
      case 'arrowup':
        event.preventDefault();
        updatePiecePosition({ x: 0, y: 0, z: -1 });
        break;
      case 'arrowdown':
        event.preventDefault();
        updatePiecePosition({ x: 0, y: 0, z: 1 });
        break;
      case 'q':
        rotateActive('x');
        break;
      case 'e':
        rotateActive('x');
        break;
      case 'a':
        rotateActive('y');
        break;
      case 'd':
        rotateActive('y');
        break;
      case 'w':
        rotateActive('z');
        break;
      case 's':
        rotateActive('z');
        break;
      case ' ':
        event.preventDefault();
        hardDrop();
        break;
      case 'p':
        togglePause();
        break;
      default:
        break;
    }
  }, [gameOver, hardDrop, rotateActive, togglePause, updatePiecePosition]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [handleKeyPress]);

  return {
    grid,
    activePiece,
    nextPiece,
    score,
    level,
    linesCleared,
    viewType,
    stereoSettings,
    isPaused,
    message,
    clearingLayers,
    togglePause,
    resetGame,
    updateView,
    updateStereoSettings,
  };
}

export default useGameLogic;
