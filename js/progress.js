/* ==========================================================================
   3D FORTRIS - SAVED PROGRESS (localStorage)
   High scores + the game in progress (so a closed tab or app can be resumed).
   The same game can be open twice on one device (installed app + browser
   tab), so every save MERGES with what is stored: high scores only ever grow,
   the game in progress comes from the copy that saved last.
   Pure module (storage is passed in) so it can be unit-tested in Node.
   ========================================================================== */

import { clampWellSize, clampWellHeight, DEFAULT_WELL } from './config.js';

export const PROGRESS_KEY = '3d_fortris_progress';
export const LEGACY_KEY = '3dtris-progress'; // v1 saved { level, score, linesCleared, boardSize }
export const MAX_SCORES = 8;

export const freshProgress = () => ({ scores: [], saved: null, size: DEFAULT_WELL.width, height: DEFAULT_WELL.height, totalLines: 0 });

const cleanScore = s => s && Number.isFinite(s.score) && s.score >= 0
  ? { score: Math.floor(s.score), level: Math.max(1, s.level | 0), lines: Math.max(0, s.lines | 0), size: clampWellSize(s.size), height: clampWellHeight(s.height ?? 20), at: Number(s.at) || 0 }
  : null;

/** Stored JSON -> clean progress record (null when nothing usable is stored). */
export function parseProgress(json) {
  try {
    const p = JSON.parse(json || 'null');
    if (!p || typeof p !== 'object' || !Array.isArray(p.scores)) return null;
    return {
      scores: p.scores.map(cleanScore).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, MAX_SCORES),
      saved: p.saved && typeof p.saved === 'object' ? p.saved : null,
      size: clampWellSize(p.size ?? DEFAULT_WELL.width),
      height: clampWellHeight(p.height ?? DEFAULT_WELL.height),
      totalLines: Math.max(0, p.totalLines | 0)
    };
  } catch (_) { return null; } // corrupt: treat as nothing stored
}

/** v1 kept only the last run's score/level and the grid size: carry them over once. */
export function fromLegacy(json) {
  try {
    const old = JSON.parse(json || 'null');
    if (!old || typeof old !== 'object') return null;
    const p = freshProgress();
    if (old.boardSize) p.size = clampWellSize(old.boardSize.width ?? old.boardSize.depth);
    const s = cleanScore({ score: old.score, level: old.level, lines: old.linesCleared, size: p.size, height: 20, at: 0 });
    if (s && s.score > 0) p.scores.push(s);
    p.totalLines = Math.max(0, old.linesCleared | 0);
    return p;
  } catch (_) { return null; }
}

const scoreKey = s => `${s.score}|${s.level}|${s.lines}|${s.size}|${s.height}|${s.at}`;

/**
 * Combine two records. High scores are the union (top MAX_SCORES); the saved game, well size and
 * lifetime line count come from `primary` (the record judged most recent by the caller).
 */
export function mergeProgress(primary, other) {
  if (!other) return primary;
  const seen = new Map();
  for (const s of [...primary.scores, ...other.scores]) seen.set(scoreKey(s), s);
  return {
    scores: [...seen.values()].sort((a, b) => b.score - a.score).slice(0, MAX_SCORES),
    saved: primary.saved,
    size: primary.size,
    height: primary.height,
    totalLines: Math.max(primary.totalLines, other.totalLines)
  };
}

export function loadProgress(storage = globalThis.localStorage) {
  try {
    const p = parseProgress(storage.getItem(PROGRESS_KEY));
    if (p) return p;
    return fromLegacy(storage.getItem(LEGACY_KEY)) || freshProgress();
  } catch (_) { return freshProgress(); } // storage blocked
}

/** Merge `mine` into what is stored, write it back, and return the merged record to keep in memory. */
export function saveProgress(mine, storage = globalThis.localStorage) {
  try {
    const merged = mergeProgress(mine, parseProgress(storage.getItem(PROGRESS_KEY)));
    storage.setItem(PROGRESS_KEY, JSON.stringify(merged));
    return merged;
  } catch (_) { return mine; } // private mode / storage blocked: keep playing from memory
}

/** Add a finished run; returns its rank (1 = new best) or 0 when it didn't make the table. */
export function addScore(progress, run) {
  const s = cleanScore({ ...run, at: run.at || Date.now() });
  if (!s || s.score <= 0) return 0;
  progress.scores = [...progress.scores, s].sort((a, b) => b.score - a.score).slice(0, MAX_SCORES);
  const i = progress.scores.indexOf(s);
  return i < 0 ? 0 : i + 1;
}
