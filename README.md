# 🧊 3D Fortris PWA (Stereoscopic 3D block-stacking)

Pieces fall inside a **3D well** instead of a 2D one. Rotate them about any axis, fill entire horizontal layers to clear them, and level up every five layers.

Version 2 keeps the v1 game rules exactly and moves the game onto the 3D engine of [3D Labyrinth](https://github.com/SRathinaGiri/3DLabyrinth): stereo modes, smart glasses, WebXR VR, the in-scene 3D HUD, gamepads, a phone as controller and an installable offline PWA.

## Rules (unchanged from v1)
- 10×10 floor, width/depth 6–14 (menu slider). **Height 12 / 15 / 20** (menu): 15 by default, because a tall well renders small in side-by-side 3D on a landscape phone; 20 is v1's *Classic* height.
- A new piece **waits at the top** (⏸ HOLD on the bar). **DROP** (Space) releases it; DROP again is a **hard drop**.
- Full layers clear: **100 × level** points per layer. 💣 Bomb removes the block under it: **+50**. Bombs are rarer than in v1: about 1 piece in 190 (v1: 1 in 66).
- A new level every **5 layers**: levels only make pieces fall faster (max(250, 1200 − 90 × level) ms) and multiply the points. The well carries on as it is; the level-up is a small notification. A new game always starts at level 1 (Continue resumes a saved game at its level).
- Three pieces queued ("plan three steps ahead"). Game over when a new piece can't appear.
- Moves are **relative to the camera** (↑ = away from you), as in v1.

Small additions: E / D / S rotate the other way round, Restart mid-game asks first, and the game in progress is saved (**Continue** in the menu) alongside a high-score table. v1's saved score and grid size are carried over.

## 3D features (from 3D Labyrinth)
- **Modes**: 2D, Parallel SBS, Cross-Eye SBS, Anaglyph (red/cyan), Smart-Glasses HSBS (RayNeo / XREAL / Rokid / TCL) and **WebXR VR**.
- **Auto stereo**: eye separation and focal plane follow the camera distance. Zero parallax sits at the well's centre, so the near half pops out of the screen.
- **In-scene HUD** on the focal plane (works in every mode, both eyes): status bar, **NEXT** panel with the coming pieces as spinning 3D models, **LAYERS** panel (blocks each bottom layer still needs, stack height), a small notification strip at the bottom (clears, level-ups, bombs), and tappable 3D dialogs. The camera fits the well's actual outline below the bar, so it fills each eye.
- **Scene**: bevelled glossy blocks with reflections, real shadows, see-through far walls, landing ghost + floor markers + drop guides, particle bursts for clears and bombs, a light wave on level-up, a grey-out on game over.
- **Camera**: drag to orbit, pinch / wheel to zoom, ↶ ↷ (V / Shift+V) quarter turns, ⊡ top view (T), optional auto-rotate.

## Controls
| Action | Keyboard | Gamepad | Quest | Touch pad / phone |
|---|---|---|---|---|
| Move | Arrows | D-pad / left stick | Thumbstick | ▲ ◀ ▶ ▼ |
| Rotate X / Y / Z | Q / A / W (E / D / S reverse) | Y / X / B | Left trigger / right trigger / grip | ⟲X ⟲Y ⟲Z |
| Release / hard drop | Space | A | A / X | DROP |
| Turn camera | V / Shift+V | LB / RB | (walk around) | ↶ ↷ |
| Pause | P / Esc | Start | B / Y | ⏸ |

The on-screen pad shows automatically on touch screens (menu: Controls → Touch pad: Auto / On / Off). In side-by-side 3D on a landscape phone the pad and toolbar float, translucent, over the view's corners, so the 2:1 view can use the full screen height.

## VR (Meta Quest)
Tap **🥽 VR** in the Quest browser. Height isn't a problem in VR: the tower's size is set in metres whatever the row count, and its top sits just below eye level, so you look down into it. The well is placed relative to your head: **🪑 Table** (a 70 cm tower in front of you) or **🏙 Giant** (2.6 m, standing on the floor). Moves follow where you stand around the well. The pause panel has Recenter, Table/Giant and Exit VR.

## 📲 Phone as controller
Menu → Controls → **📲 Phone controller** shows a 6-digit code and the address of `controller.html`. Open it on a phone on the **same Wi-Fi**, enter the code, and use its D-pad, rotations, DROP and view buttons.
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
js/audio.js     Web Audio synth
js/ui.js        menu, settings, touch pad
js/link.js      phone pairing (PeerJS)
js/pad.js       controller.html logic
js/app.js       game loop, camera, VR, PWA
```

## License
MIT. three.js and PeerJS are MIT.
