export const BOARD_SIZE = {
  width: 5,
  depth: 5,
  height: 20,
};

export const STORAGE_KEY = '3dtris-progress';

export const SHAPES = [
  { name: 'I', color: '#38bdf8', cells: [[0, 0, 0], [1, 0, 0], [-1, 0, 0], [-2, 0, 0]] },
  { name: 'L', color: '#f472b6', cells: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]] },
  { name: 'T', color: '#c084fc', cells: [[0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1]] },
  { name: 'S', color: '#34d399', cells: [[0, 0, 0], [1, 0, 0], [0, 0, 1], [-1, 0, 1]] },
  { name: 'Cube', color: '#facc15', cells: [[0, 0, 0], [1, 0, 0], [0, 0, 1], [1, 0, 1], [0, 1, 0], [1, 1, 0], [0, 1, 1], [1, 1, 1]] },
];
