// Rules of 3D Fortris (js/game.js) and saved progress (js/progress.js). Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { FortrisGame, rotateCell, directionalOffset, ROTATION_OFFSETS } from '../js/game.js';
import { SHAPES, DEFAULT_WELL, QUEUE_LENGTH, dropDelay, clampWellSize, clampWellHeight } from '../js/config.js';
import { parseProgress, mergeProgress, fromLegacy, addScore, saveProgress, loadProgress, freshProgress, PROGRESS_KEY, LEGACY_KEY } from '../js/progress.js';

const seeded = (seed = 7) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const shape = name => SHAPES.find(s => s.name === name);
const make = (opts = {}) => {
  const events = [];
  // Rule tests use the Classic 20-high well unless they say otherwise
  const g = new FortrisGame({ rng: seeded(), onEvent: (t, d) => events.push({ t, d }), height: 20, ...opts });
  return { g, events, has: t => events.some(e => e.t === t) };
};
/** Fill layer y completely except the given [x, z] holes. */
const fillLayer = (g, y, holes = []) => {
  for (let z = 0; z < g.size.depth; z++) for (let x = 0; x < g.size.width; x++) {
    if (!holes.some(([hx, hz]) => hx === x && hz === z)) g.grid[y][z][x] = { color: '#ffffff' };
  }
};
/** Replace the active piece with a named shape at (x, y, z). */
const place = (g, name, x, y, z) => { g.active = { ...g.createPiece(shape(name)), position: { x, y, z } }; };

test('four quarter turns about any axis return every cell home', () => {
  for (const axis of ['x', 'y', 'z']) {
    let c = [1, 2, 3];
    for (let i = 0; i < 4; i++) c = rotateCell(c, axis);
    assert.deepEqual(c, [1, 2, 3]);
  }
});

test('wall kicks are tried smallest-shift first, starting with no shift', () => {
  assert.deepEqual(ROTATION_OFFSETS[0], { x: 0, y: 0, z: 0 });
  assert.equal(ROTATION_OFFSETS.length, 125);
  const cost = o => Math.abs(o.x) + Math.abs(o.y) + Math.abs(o.z);
  for (let i = 1; i < ROTATION_OFFSETS.length; i++) assert.ok(cost(ROTATION_OFFSETS[i]) >= cost(ROTATION_OFFSETS[i - 1]));
});

test('a new game: 10x10x15 well, level 1, three queued, the piece waits at the top centre', () => {
  const { g } = make({ height: undefined });
  assert.deepEqual(g.size, DEFAULT_WELL);
  assert.deepEqual(DEFAULT_WELL, { width: 10, depth: 10, height: 15 });
  assert.equal(g.level, 1);
  assert.equal(g.queue.length, QUEUE_LENGTH);
  assert.equal(g.gravity, false);
  assert.equal(g.active.position.x, 5);
  assert.equal(g.active.position.z, 5);
  const top = Math.max(...g.cellsOf().map(c => c.y));
  assert.equal(top, 14);
  g.tick(30); // no gravity until released
  assert.equal(Math.max(...g.cellsOf().map(c => c.y)), 14);
});

test('well size is clamped to 6..14 and stays square', () => {
  assert.equal(clampWellSize(3), 6);
  assert.equal(clampWellSize(99), 14);
  assert.equal(clampWellSize('abc'), 10);
  const { g } = make({ size: 8 });
  assert.deepEqual(g.size, { width: 8, depth: 8, height: 20 });
});

test('well height is 12, 15 or 20; a new game resets to level 1 at any height', () => {
  assert.equal(clampWellHeight(13), 12);
  assert.equal(clampWellHeight(16), 15);
  assert.equal(clampWellHeight(40), 20);
  assert.equal(clampWellHeight('x'), 15);
  const { g } = make({ height: 12 });
  g.level = 7; g.score = 999; g.lines = 33;
  g.reset();
  assert.equal(g.size.height, 12);
  assert.equal(g.level, 1); assert.equal(g.score, 0); assert.equal(g.lines, 0);
});

test('levelling up only speeds the game: the well and the falling piece carry on', () => {
  const { g } = make();
  g.lines = 4;
  fillLayer(g, 0, [[2, 2]]);
  g.grid[1][7][7] = { color: '#abcdef' };
  place(g, 'Mono', 2, 19, 2);
  const slower = g.dropDelay;
  g.release(); g.release();
  assert.equal(g.level, 2);
  assert.ok(g.dropDelay < slower);
  assert.deepEqual(g.grid[0][7][7], { color: '#abcdef' }, 'the stack is kept');
  assert.ok(g.active && !g.over);
});

test('drop speed: 1200 ms - 90 ms per level, never below 250 ms', () => {
  assert.equal(dropDelay(1), 1110);
  assert.equal(dropDelay(5), 750);
  assert.equal(dropDelay(30), 250);
});

test('release starts gravity; one interval later the piece is one layer lower', () => {
  const { g, has } = make();
  place(g, 'Mono', 5, 19, 5);
  g.release();
  assert.ok(has('release'));
  assert.equal(g.gravity, true);
  g.tick(dropDelay(1) / 1000 - 0.01);
  assert.equal(g.active.position.y, 19);
  g.tick(0.02);
  assert.equal(g.active.position.y, 18);
});

test('second release is a hard drop: the piece lands, locks, and the next one waits', () => {
  const { g, has } = make();
  place(g, 'Mono', 2, 19, 3);
  g.release(); g.release();
  assert.ok(has('harddrop') && has('lock') && has('spawn'));
  assert.deepEqual(g.grid[0][3][2], { color: shape('Mono').color });
  assert.equal(g.gravity, false, 'each new piece waits to be released (v1 rule)');
  assert.equal(g.pieces, 1);
});

test('moves are blocked by walls and by locked blocks', () => {
  const { g } = make();
  place(g, 'Mono', 0, 5, 0);
  assert.equal(g.shift({ x: -1, y: 0, z: 0 }), false);
  g.grid[5][0][1] = { color: '#fff' };
  assert.equal(g.shift({ x: 1, y: 0, z: 0 }), false);
  assert.equal(g.shift({ x: 0, y: 0, z: 1 }), true);
});

test('arrow keys follow the camera: up always moves away from it', () => {
  // Camera on +x looking at the well: away = -x, right = -z
  assert.deepEqual(directionalOffset('up', 0), { x: -1, y: 0, z: 0 });
  assert.deepEqual(directionalOffset('right', 0), { x: 0, y: 0, z: -1 });
  // Camera on +z: away = -z, right = +x
  assert.deepEqual(directionalOffset('up', Math.PI / 2), { x: 0, y: 0, z: -1 });
  assert.deepEqual(directionalOffset('right', Math.PI / 2), { x: 1, y: 0, z: 0 });
  assert.deepEqual(directionalOffset('left', Math.PI / 2), { x: -1, y: 0, z: 0 });
  assert.deepEqual(directionalOffset('down', 0.5), { x: 1, y: 0, z: 0 });
});

test('rotation next to a wall kicks the piece back inside', () => {
  const { g } = make();
  place(g, 'I', 0, 10, 5); // cells x = -2..1 would be outside: put it hard against the wall along z instead
  g.active.cells = [[0, 0, 0], [0, 0, 1], [0, 0, -1], [0, 0, -2]];
  g.active.position = { x: 0, y: 10, z: 5 };
  assert.ok(g.canPlace(g.active));
  assert.ok(g.rotate('y'));
  for (const c of g.cellsOf()) assert.ok(c.x >= 0 && c.x < 10, `cell inside after kick: ${JSON.stringify(c)}`);
});

test('rotating the other way (dir -1) undoes a rotation', () => {
  const { g } = make();
  place(g, 'T', 5, 10, 5);
  const before = JSON.stringify(g.cellsOf());
  g.rotate('z', 1); g.rotate('z', -1);
  assert.equal(JSON.stringify(g.cellsOf()), before);
});

test('a full layer clears, everything above drops, score = 100 x level', () => {
  const { g, events } = make();
  fillLayer(g, 0, [[4, 4]]);
  g.grid[1][0][0] = { color: '#abcdef' };
  place(g, 'Mono', 4, 19, 4);
  g.release(); g.release();
  const clear = events.find(e => e.t === 'clear');
  assert.ok(clear, 'clear event');
  assert.deepEqual(clear.d.layers, [0]);
  assert.equal(clear.d.cells.length, 100);
  assert.equal(g.lines, 1);
  assert.equal(g.score, 100);
  assert.deepEqual(g.grid[0][0][0], { color: '#abcdef' }, 'the block above fell into layer 0');
  assert.equal(g.layerFill()[0], 1);
});

test('five layers make a level; the multiplier uses the level before the clear', () => {
  const { g, has } = make();
  g.lines = 4; g.level = 1;
  fillLayer(g, 0, [[2, 2]]);
  fillLayer(g, 1, [[2, 2]]);
  g.active = { ...g.createPiece(shape('Pillar')), cells: [[0, 0, 0], [0, 1, 0]], position: { x: 2, y: 15, z: 2 } };
  g.release(); g.release();
  assert.equal(g.lines, 6);
  assert.equal(g.level, 2);
  assert.ok(has('levelup'));
  assert.equal(g.score, 2 * 100 * 1);
});

test('bomb removes the block under it for 50 points and leaves no block of its own', () => {
  const { g, events } = make();
  g.grid[0][3][3] = { color: '#123456' };
  place(g, 'Bomb', 3, 19, 3);
  g.release(); g.release();
  const bomb = events.find(e => e.t === 'bomb');
  assert.ok(bomb);
  assert.equal(bomb.d.removed.length, 1);
  assert.equal(g.grid[0][3][3], null);
  assert.equal(g.grid[1][3][3], null);
  assert.equal(g.score, 50);
});

test('game over when the next piece cannot spawn', () => {
  const { g, has } = make();
  for (let y = 0; y < 19; y++) g.grid[y][5][5] = { color: '#fff' };
  for (let y = 0; y < 19; y++) g.grid[y][5][6] = { color: '#fff' };
  // Every shape covers the spawn cell (5, top, 5): block it from below with the next piece
  g.queue = [g.createPiece(shape('Mono')), ...g.queue.slice(1)];
  place(g, 'Mono', 5, 19, 5);
  g.release(); g.release(); // locks at y 19, the next Mono can't appear
  assert.ok(has('gameover'));
  assert.equal(g.over, true);
  assert.equal(g.active, null);
  g.release(); g.tick(5); // inert afterwards
  assert.equal(g.over, true);
});

test('landing() finds the resting place without moving the piece', () => {
  const { g } = make();
  g.grid[3][5][5] = { color: '#fff' };
  place(g, 'Mono', 5, 19, 5);
  assert.equal(g.landing().position.y, 4);
  assert.equal(g.active.position.y, 19);
});

test('random pieces come from the shape list, bombs rarely', () => {
  const { g } = make();
  const names = new Map();
  for (let i = 0; i < 4000; i++) { const s = g.randomShape(); names.set(s.name, (names.get(s.name) || 0) + 1); }
  assert.equal(names.size, SHAPES.length);
  assert.ok(names.get('Bomb') < names.get('Mono') * 0.12, 'bomb is about 1 piece in 190');
});

test('serialize -> restore resumes the exact game', () => {
  const a = make().g;
  fillLayer(a, 0, [[1, 1]]);
  a.score = 1234; a.level = 3; a.lines = 11;
  a.rotate('x');
  const data = JSON.parse(JSON.stringify(a.serialize()));
  const b = make({ height: 12 }).g;
  assert.equal(b.restore(data), true);
  assert.equal(b.size.height, 20, 'the saved well height wins');
  assert.equal(b.score, 1234); assert.equal(b.level, 3); assert.equal(b.lines, 11);
  assert.deepEqual(b.cellsOf(), a.cellsOf());
  assert.equal(b.layerFill()[0], 99);
  assert.equal(b.queue.length, 3);
  assert.equal(b.restore({ size: 10, grid: [[[]]], active: {} }), false, 'corrupt data starts fresh');
  assert.equal(b.score, 0);
});

/* ---------------- progress.js ---------------- */
const memory = (init = {}) => { const m = { ...init }; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, data: m }; };

test('high scores keep the best 8, ranked; zero scores are not recorded', () => {
  const p = freshProgress();
  for (let i = 1; i <= 10; i++) addScore(p, { score: i * 100, level: 1, lines: i, size: 10 });
  assert.equal(p.scores.length, 8);
  assert.equal(p.scores[0].score, 1000);
  assert.equal(addScore(p, { score: 5000, level: 4, lines: 20, size: 10 }), 1);
  assert.equal(addScore(p, { score: 0, level: 1, lines: 0, size: 10 }), 0);
  assert.equal(addScore(p, { score: 50, level: 1, lines: 0, size: 10 }), 0);
});

test('two open copies never lose each other\'s high scores', () => {
  const store = memory();
  const tab = loadProgress(store), app = loadProgress(store);
  addScore(tab, { score: 900, level: 2, lines: 6, size: 10, at: 1 });
  saveProgress(tab, store);
  addScore(app, { score: 400, level: 1, lines: 3, size: 8, at: 2 });
  const merged = saveProgress(app, store);
  assert.deepEqual(merged.scores.map(s => s.score), [900, 400]);
  assert.deepEqual(parseProgress(store.data[PROGRESS_KEY]).scores.map(s => s.score), [900, 400]);
});

test('merge: the saved game and size come from the primary record', () => {
  const a = { ...freshProgress(), saved: { score: 1 }, size: 12 };
  const b = { ...freshProgress(), saved: { score: 2 }, size: 8, totalLines: 30 };
  const m = mergeProgress(a, b);
  assert.deepEqual(m.saved, { score: 1 });
  assert.equal(m.size, 12);
  assert.equal(m.totalLines, 30);
});

test('v1 progress (3dtris-progress) is carried over once', () => {
  const legacy = JSON.stringify({ level: 3, score: 2500, linesCleared: 12, boardSize: { width: 12, depth: 12, height: 20 } });
  const p = fromLegacy(legacy);
  assert.equal(p.size, 12);
  assert.equal(p.scores[0].score, 2500);
  assert.equal(loadProgress(memory({ [LEGACY_KEY]: legacy })).scores[0].level, 3);
  assert.equal(parseProgress('{broken'), null);
});
