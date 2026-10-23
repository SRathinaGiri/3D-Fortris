/* ==========================================================================
   3D FORTRIS - GAME CONSTANTS
   Every tunable lives here so balancing never means hunting through modules.
   Pure module (no THREE / DOM) so it can be unit-tested in Node.
   ========================================================================== */

export const VERSION = '2.0.1';

// 10×10 floor. Height 15 by default: a 20-high well renders very small in side-by-side 3D on a
// landscape phone (each eye gets a square half). 20 stays available as "Classic" (v1's height).
export const DEFAULT_WELL = { width: 10, depth: 10, height: 15 };

// Width / depth can be changed in the menu (the well stays square); height is one of WELL_HEIGHTS.
export const WELL_LIMITS = { min: 6, max: 14 };
export const WELL_HEIGHTS = [12, 15, 20];

export const QUEUE_LENGTH = 3;        // "Always plan three steps ahead"
export const LAYERS_PER_LEVEL = 5;    // a new level every five cleared layers
export const LAYER_SUMMARY_COUNT = 5; // bottom layers listed on the 3D "Layers" panel

// Gravity: one step down every max(MIN, BASE - level * PER_LEVEL) ms, once the piece is released
export const SPEED = { BASE_MS: 1200, PER_LEVEL_MS: 90, MIN_MS: 250 };

// Points: layers x LAYER x level; every block a bomb removes is worth BOMB_BLOCK
export const SCORE = { LAYER: 100, BOMB_BLOCK: 50, PERFECT_LAYERS: 5 };

export const SHAPES = [
  // Four-cube classics
  { name: 'I', color: '#38bdf8', cells: [[0, 0, 0], [1, 0, 0], [-1, 0, 0], [-2, 0, 0]] },
  { name: 'L', color: '#f472b6', cells: [[0, 0, 0], [1, 0, 0], [0, 0, 1], [0, 0, -1]] },
  { name: 'T', color: '#c084fc', cells: [[0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1]] },
  { name: 'S', color: '#34d399', cells: [[0, 0, 0], [1, 0, 0], [0, 0, 1], [-1, 0, 1]] },
  { name: 'Edge', color: '#f97316', cells: [[0, 0, 0], [1, 0, 0], [-1, 0, 0], [-1, 0, 1]] },
  { name: 'Skew', color: '#fb7185', cells: [[0, 0, 0], [1, 0, 0], [0, 0, 1], [1, 0, -1]] },
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
  // Utility: weight 0.07 of 13.07 = about 1 piece in 190 (v1 had 0.2, about 1 in 66)
  { name: 'Bomb', color: '#f43f5e', cells: [[0, 0, 0]], type: 'bomb', weight: 0.07 }
];

// Orbit camera around the well (theta / phi as in v1: x = r sinφ cosθ, z = r sinφ sinθ)
// THETA / SNAP_OFFSET keep the view ~29° off a grid axis: a diagonal (45°) view makes the arrow keys
// ambiguous, because "up" is then exactly as much +x as -z.
export const CAMERA = {
  THETA: 0.5,
  SNAP_OFFSET: 0.5,           // turnL / turnR snap to k·90° + this
  PHI: 1.05,
  PHI_MIN: 0.3, PHI_MAX: Math.PI / 2 + 0.25,
  TOP_PHI: 0.02,              // "Top" view: straight down the well
  ZOOM_MIN: 0.55, ZOOM_MAX: 1.8,
  AUTO_ROTATE: 0.054,         // rad/s (v1: 0.0009 per frame at 60 fps)
  DRAG: 0.004                 // rad per pixel of drag
};

// WebXR (Quest): the well is placed relative to the player's head when VR starts (and on Recenter),
// so it works seated or standing. Sizes in metres.
export const VR = {
  TABLE: { HEIGHT: 0.7, BELOW_EYES: 0.75, DIST: 0.75 },   // a desk-sized tower in front of you
  GIANT: { HEIGHT: 2.6, DIST: 2.2, STAND_EYE: 1.5 },      // a building-sized well standing on the floor
  HUD: { DIST: 1.1, FOV: 30, ASPECT: 1.6 }                // floating screen: score bar just above eye level
};

/** Gravity interval (ms) for a level. */
export function dropDelay(level) {
  return Math.max(SPEED.MIN_MS, SPEED.BASE_MS - level * SPEED.PER_LEVEL_MS);
}

/** Nearest allowed well height. */
export function clampWellHeight(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_WELL.height;
  return WELL_HEIGHTS.reduce((best, h) => (Math.abs(h - n) < Math.abs(best - n) ? h : best), WELL_HEIGHTS[0]);
}

/** Clamp a requested grid size to the allowed square well. */
export function clampWellSize(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_WELL.width;
  return Math.max(WELL_LIMITS.min, Math.min(WELL_LIMITS.max, Math.round(n)));
}
