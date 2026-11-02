# 🧊 3D Fortris PWA (Stereoscopic 3D block-stacking)

Pieces fall inside a **3D well** instead of a 2D one. Rotate them about any axis, fill entire horizontal layers to clear them, and level up every five layers.

Version 2 keeps the v1 game rules exactly and moves the game onto the 3D engine of [3D Labyrinth](https://github.com/SRathinaGiri/3DLabyrinth): stereo modes, smart glasses, WebXR VR, the in-scene 3D HUD, gamepads, a phone as controller and an installable offline PWA.

## Rules (unchanged from v1)
- 10×10 floor, width/depth 6–14 (menu slider). **Height 12 / 15 / 20** (menu): 15 by default, because a tall well renders small in side-by-side 3D on a landscape phone; 20 is v1's *Classic* height.
- A new piece **waits at the top** (⏸ HOLD on the bar). **DROP** (Space) releases it; DROP again is a **hard drop**.
- Full layers clear: **100 × level** points per layer. 💣 Bomb removes the block under it: **+50**. Bombs come about **1 piece in 10** (weight 1.44 against 13 for the other shapes), so a misplaced block can soon be blown away. v2.0 had 1 in 190, which left most games with none; v1 had 1 in 66.
- A new level every **5 layers**: levels only make pieces fall faster (max(250, 1200 − 90 × level) ms) and multiply the points. The well carries on as it is; the level-up is a small notification. A new game always starts at level 1 (Continue resumes a saved game at its level).
- Three pieces queued ("plan three steps ahead"). Game over when a new piece can't appear.
- Moves are **relative to the camera** (↑ = away from you), as in v1.

Small additions: E / D / S rotate the other way round, Restart mid-game asks first, and the game in progress is saved (**Continue** in the menu) alongside a high-score table. v1's saved score and grid size are carried over.

## 3D features (from 3D Labyrinth)
- **Modes**: 2D, Parallel SBS, Cross-Eye SBS, Anaglyph (red/cyan), Smart-Glasses HSBS (RayNeo / XREAL / Rokid / TCL) and **WebXR VR**.
- **Auto stereo**: eye separation and focal plane follow the camera distance. Zero parallax sits at the well's centre, so the near half pops out of the screen.
- **In-scene HUD** on the focal plane (works in every mode, both eyes): status bar, **NEXT** panel with the coming pieces as spinning 3D models, **LAYERS** panel (blocks each bottom layer still needs, stack height), a small notification strip at the bottom (clears, level-ups, bombs), and tappable 3D dialogs. The camera fits the well's actual outline below the bar, so it fills each eye.
- **Scene**: bevelled glossy blocks with reflections, real shadows, see-through far walls, a landing ghost that can't be mistaken for a block: every cube cycles through the rainbow (each a different hue) with moving diagonal stripes, and its outline and a fainter copy show through any blocks in front, so a spot down a pit still shows; a bright tile marks what each column will rest on, drop guides, particle bursts for clears and bombs, a light wave on level-up, a grey-out on game over.
- **Camera**: drag to orbit, pinch / wheel to zoom, ↶ ↷ (V / Shift+V) quarter turns, ⊡ top view (T), optional auto-rotate.

## Controls
| Action | Keyboard | Gamepad | In the 3D view (touch / mouse) | Quest | Phone joypad |
|---|---|---|---|---|---|
| Move | Arrows | D-pad / left stick | Drag the piece | Thumbstick · trigger-drag the piece · grip + move your hand | MOVE stick |
| Rotate | Q / A / W (E / D / S reverse) | Y / X / B | Tap the piece → drag along a ring (red X, green Y, blue Z) | Trigger-drag a ring · grip + twist your wrist | SPIN: swipe to roll, two-finger twist · ⟲X ⟲Y ⟲Z |
| Release (lower on the rope) | Space | A | Tap the rope or ⬇ | Trigger on the rope / button · A / X | Release |
| Hard drop (cut the rope) | Space again | A again | Tap the rope again or ✂ | Trigger again · A / X | Fast drop |
| Turn camera | V / Shift+V | LB / RB | Drag the empty view | (walk around) | ↶ ↷ ⊡ |
| Pause | P / Esc | Start | ⏸ | B / Y | ⏸ |

### In-scene controls (v2.1)
The flat touch pad sits at screen depth, so it never fuses in Cross-Eye / Parallel view. The controls now live **inside the 3D scene** (`js/grab.js`):
- **The piece**: drag it to slide it, cell by cell, across the well. Tap it to show the **rotation rings**; drag along a ring and the piece turns 90° every ~57° of drag. You can still drag the piece to slide it while the rings show. To put them away, tap the piece again, tap a ring without dragging, or tap empty space (a drag on empty space still orbits). They stay on for the next pieces until you put them away.
- **The pulley and rope**: a gantry runs across the well's ceiling. The waiting piece hangs straight down on a rope from a pulley on its trolley, and the trolley follows the piece as you slide it. **First tap** on the rope (or the ⬇ button beside the pulley): the pulley unwinds and lowers the piece at the level's speed, still on its rope. **Second tap** (rope or ✂): the rope is cut where you touched it and the piece drops (hard drop). If the piece lands on its rope, it is unhooked and the pulley reels the rope back in. DROP / Space do the same two steps. Taps on the piece, or on the rope just above it, never count as the rope.
- **3D cursor**: a glowing dot at the pointer, drawn for both eyes so it fuses. Over a side-by-side view the OS pointer is hidden (it only exists in one half).
- **Per-eye picking**: a touch in either half of a side-by-side view is cast from *that* eye's camera (left / right, cross and swap respected), so a piece in front of or behind the screen plane is hit where you see it.
- Touch pad **Auto** now hides the flat pad in side-by-side modes (On still forces it). Drag on empty space still orbits.

The on-screen pad shows automatically on touch screens in 2D / anaglyph (menu: Controls → Touch pad: Auto / On / Off).

## VR (Meta Quest)
Tap **🥽 VR** in the Quest browser. Each controller has a pointer ray: pull the **trigger** on the piece to slide it, on a ring to turn it, on the rope or its ceiling button to lower the piece, again to cut the rope (hard drop) (trigger at nothing keeps the old rotations: right = Y, left = X). **Squeeze the grip** to hold the piece like a real block: twist your wrist ~50° for a quarter turn about the nearest axis, move your hand one cell to slide it; controllers pulse on each step. Height isn't a problem in VR: the tower's size is set in metres whatever the row count, and its top sits just below eye level, so you look down into it. The well is placed relative to your head: **🪑 Table** (a 70 cm tower in front of you) or **🏙 Giant** (2.6 m, standing on the floor). Moves follow where you stand around the well. The pause panel has Recenter, Table/Giant and Exit VR.

## 📲 Phone as controller
Menu → Controls → **📲 Phone controller** shows a 6-digit code and the address of `controller.html`. Open it on a phone on the **same Wi-Fi**, enter the code, and use it as a **joypad**: MOVE stick (hold to repeat), SPIN pad (swipe to roll the piece the way you swipe, relative to the camera; twist two fingers to turn it clockwise / anticlockwise as you see it), a big ✂ Release / ⤓ Fast drop button that follows the game, plus ⟲X ⟲Y ⟲Z, OK, view and pause. In landscape the stick and spin pad sit either side of the drop button.
As in 3D Labyrinth, the two devices are introduced once through the public **PeerJS** signalling server (`0.peerjs.com`, bundled PeerJS 1.5.5, MIT) with Google STUN; TURN relays are disabled, so button presses then go directly between the devices. Codes use their own namespace (`fortris3d-v1-`), so they never reach a Labyrinth screen.

## Run locally
```bash
python -m http.server 8087
```
Then open http://localhost:8087. Everything else is bundled (three.js r128, sounds are synthesised), so the game works offline.

## Tests
```bash
npm test
```
- `tests/logic.test.mjs`: the game rules (spawn, hold/release, hard drop, wall kicks, clears, scoring, levels, bomb, game over, camera-relative moves, save/resume) and the high-score storage.
- `tests/version.test.mjs`: version in sync everywhere, every module cached by the service worker and pinned in the import map, installable icons, only approved outside hosts.

## Releasing
Bump the version in **all** of: `js/config.js` (`VERSION`), `sw.js` (`CACHE_VERSION`), `manifest.json`, `index.html` and `controller.html` (badge + `?v=`). The tests fail if any disagree.

## Structure
```
js/config.js    constants, shapes, speeds (pure)
js/game.js      the rules (pure, unit-tested)
js/progress.js  high scores + saved game (pure)
js/well.js      three.js scene: well, blocks, ghost, effects
js/renderer.js  stereo engine (from 3D Labyrinth)
js/hud3d.js     in-scene HUD, NEXT / LAYERS panels, 3D dialogs
js/controls.js  keyboard / gamepad / Quest / orbit input
js/grab.js      in-scene controls: piece drag, rotation rings, ceiling pulley + rope, 3D cursor, Quest grab
js/audio.js     Web Audio synth
js/ui.js        menu, settings, touch pad
js/link.js      phone pairing (PeerJS)
js/pad.js       controller.html logic
js/app.js       game loop, camera, VR, PWA
```

## License
MIT. three.js and PeerJS are MIT.
