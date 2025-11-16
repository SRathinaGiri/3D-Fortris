# 3DTris

3DTris is an experimental Three.js powered Tetris prototype where pieces fall inside a cubic volume instead of a 2D well. Rotate shapes across any axis, clear fully occupied 3D layers, and unlock new levels as you progress. The project uses Vite + React on the front-end and stores the latest level/score inside `localStorage` so you can continue where you left off.

## Development

```bash
npm install
npm run dev
```

- `npm run build` – bundle the production build
- `npm run preview` – preview the production bundle locally
- `npm run lint` – run ESLint against the source

## Controls

| Action | Keys |
| --- | --- |
| Move piece (x/z axis) | Arrow keys |
| Rotate X axis | `Q` / `E` |
| Rotate Y axis | `A` / `D` |
| Rotate Z axis | `W` / `S` |
| Hard drop | `Space` |
| Pause | `P` or the pause button |

## Visual settings

The control panel exposes multiple view modes (Perspective, 2D Top, Cross View, Parallel View, Anaglyph, and Stereo 3D). Stereo mode unlocks adjustments for eye distance, focus depth and field of view. These values are fed into Three.js' `StereoCamera`/`AnaglyphEffect` so the playfield can be examined from different depth profiles without reloading the page.
