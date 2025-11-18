# 3DTris

3DTris is an experimental Three.js powered Tetris prototype where pieces fall inside a cubic volume instead of a 2D well. Rotate shapes across any axis, clear fully occupied 3D layers, and unlock new levels as you progress.

## Controls

| Action | Keys |
| --- | --- |
| Move piece (x/z axis) | Arrow keys |
| Rotate X axis | `Q` / `E` |
| Rotate Y axis | `A` / `D` |
| Rotate Z axis | `W` / `S` |
| Release piece / hard drop | `Space` (press once to let the block start falling, press again to hard drop) |
| Pause | `P` or the pause button |

## Visual settings

The control panel exposes multiple view modes (Perspective, 2D Top, Cross View, Parallel View, Anaglyph, and Stereo 3D). Stereo mode unlocks adjustments for eye distance, focus depth and field of view. These values are fed into Three.js' `StereoCamera`/`AnaglyphEffect` so the playfield can be examined from different depth profiles without reloading the page.
