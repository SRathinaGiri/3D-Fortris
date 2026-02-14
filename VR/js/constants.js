// Use a 10×10×20 volume by default so the playfield offers more room than the original grid.
export const DEFAULT_BOARD_SIZE = {
  width: 14,
  depth: 10,
  height: 20,
};

export const BOARD_LIMITS = {
  min: 6,
  max: 14,
};

export const STORAGE_KEY = '3dtris-progress';

export const SHAPES = [
  // Four-cube classics
  { name: 'I', color: '#38bdf8', cells: [[0, 0, 0], [1, 0, 0], [-1, 0, 0], [-2, 0, 0]] },
  { name: 'L', color: '#f472b6', cells: [[0, 0, 0], [1, 0, 0], [0, 0, 1], [0, 0, -1]] },
  { name: 'T', color: '#c084fc', cells: [[0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1]] },
  { name: 'S', color: '#34d399', cells: [[0, 0, 0], [1, 0, 0], [0, 0, 1], [-1, 0, 1]] },
  {
    name: 'Edge',
    color: '#f97316',
    cells: [
      [0, 0, 0],
      [1, 0, 0],
      [-1, 0, 0],
      [-1, 0, 1],
    ],
  },
  {
    name: 'Skew',
    color: '#fb7185',
    cells: [
      [0, 0, 0],
      [1, 0, 0],
      [0, 0, 1],
      [1, 0, -1],
    ],
  },
  { name: 'Cube', color: '#facc15', cells: [[0, 0, 0], [1, 0, 0], [0, 0, 1], [1, 0, 1], [0, 1, 0], [1, 1, 0], [0, 1, 1], [1, 1, 1]] },
  // Tri-cube variations
  { name: 'Tri-Line', color: '#60a5fa', cells: [[0, 0, 0], [1, 0, 0], [-1, 0, 0]] },
  { name: 'Tri-Corner', color: '#a3e635', cells: [[0, 0, 0], [1, 0, 0], [0, 0, 1]] },
  { name: 'Tri-Step', color: '#fbbf24', cells: [[0, 0, 0], [1, 0, 0], [1, 0, 1]] },
  // Duo cubes
  { name: 'Domino', color: '#f472b6', cells: [[0, 0, 0], [1, 0, 0]] },
  { name: 'Pillar', color: '#67e8f9', cells: [[0, 0, 0], [0, 0, 1]] },
  // Solo cube
  { name: 'Mono', color: '#a5b4fc', cells: [[0, 0, 0]] },
  // Utility
  { name: 'Bomb', color: '#f43f5e', cells: [[0, 0, 0]], type: 'bomb', weight: 0.2 },
];
