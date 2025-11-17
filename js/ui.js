import { GameRenderer } from './gameRenderer.js';

const PREVIEW_GRID_SIZE = 4;
const LAYER_SUMMARY_COUNT = 5;

export function initUI(gameState) {
  const pauseButton = document.querySelector('[data-action="pause"]');
  const restartButton = document.querySelector('[data-action="restart"]');
  const viewSelect = document.getElementById('viewMode');
  const eyeDistanceInput = document.getElementById('eyeDistance');
  const focusDepthInput = document.getElementById('focusDepth');
  const fovInput = document.getElementById('fov');
  const stereoGrid = document.querySelector('[data-stereo-grid]');
  const messageEl = document.querySelector('[data-panel-message]');
  const nextPieceContainer = document.querySelector('[data-next-piece]');
  const progressFill = document.querySelector('[data-progress-fill]');
  const progressLabel = document.querySelector('[data-progress-label]');
  const eyeValue = document.querySelector('[data-eye-value]');
  const focusValue = document.querySelector('[data-focus-value]');
  const fovValue = document.querySelector('[data-fov-value]');
  const opacityInput = document.getElementById('cubeOpacity');
  const opacityValue = document.querySelector('[data-opacity-value]');
  const autoRotateToggle = document.getElementById('autoRotate');
  const gridSizeInput = document.getElementById('gridSize');
  const layerTableBody = document.querySelector('[data-layer-table]');
  const stats = {
    score: document.querySelector('[data-stat="score"]'),
    level: document.querySelector('[data-stat="level"]'),
    layers: document.querySelector('[data-stat="layers"]'),
  };

  const renderer = new GameRenderer(document.getElementById('gameCanvas'));
  const renderRendererError = () => {
    const rendererError = renderer.getErrorMessage();
    if (rendererError) {
      messageEl.textContent = rendererError;
      messageEl.removeAttribute('hidden');
    }
    return rendererError;
  };
  renderRendererError();

  const pauseHandler = () => gameState.togglePause();
  const restartHandler = () => gameState.resetGame();
  const viewHandler = (event) => gameState.updateView(event.target.value);
  const eyeHandler = (event) => gameState.updateStereoSettings({ eyeDistance: Number(event.target.value) });
  const focusHandler = (event) => gameState.updateStereoSettings({ focusDepth: Number(event.target.value) });
  const fovHandler = (event) => gameState.updateStereoSettings({ fov: Number(event.target.value) });
  const opacityHandler = (event) => gameState.updateOpacity(Number(event.target.value));
  const autoRotateHandler = (event) => renderer.setAutoRotate(event.target.checked);
  const gridSizeHandler = (event) => gameState.updateBoardSize(Number(event.target.value));

  pauseButton.addEventListener('click', pauseHandler);
  restartButton.addEventListener('click', restartHandler);
  viewSelect.addEventListener('change', viewHandler);
  eyeDistanceInput.addEventListener('input', eyeHandler);
  focusDepthInput.addEventListener('input', focusHandler);
  fovInput.addEventListener('input', fovHandler);
  opacityInput.addEventListener('input', opacityHandler);
  if (gridSizeInput) {
    gridSizeInput.addEventListener('change', gridSizeHandler);
  }
  if (autoRotateToggle) {
    autoRotateToggle.addEventListener('change', autoRotateHandler);
    renderer.setAutoRotate(autoRotateToggle.checked);
  }

  const renderPreviewGrid = (piece) => {
    if (!piece?.cells?.length) return '';
    const xs = piece.cells.map(([cx]) => cx);
    const zs = piece.cells.map(([, , cz]) => cz);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minZ = Math.min(...zs);
    const maxZ = Math.max(...zs);
    const width = Math.max(1, maxX - minX + 1);
    const height = Math.max(1, maxZ - minZ + 1);
    const offsetX = Math.max(0, Math.floor((PREVIEW_GRID_SIZE - width) / 2));
    const offsetZ = Math.max(0, Math.floor((PREVIEW_GRID_SIZE - height) / 2));
    const filled = new Set();
    piece.cells.forEach(([cx, _cy, cz]) => {
      const col = cx - minX + offsetX;
      const row = cz - minZ + offsetZ;
      if (col >= 0 && col < PREVIEW_GRID_SIZE && row >= 0 && row < PREVIEW_GRID_SIZE) {
        filled.add(`${col}:${row}`);
      }
    });
    const cells = Array.from({ length: PREVIEW_GRID_SIZE * PREVIEW_GRID_SIZE }, (_, idx) => {
      const col = idx % PREVIEW_GRID_SIZE;
      const row = Math.floor(idx / PREVIEW_GRID_SIZE);
      const key = `${col}:${row}`;
      const filledClass = filled.has(key) ? ' piece-preview__cell--filled' : '';
      return `<span class="piece-preview__cell${filledClass}"></span>`;
    }).join('');
    return `
      <div class="piece-preview__grid" style="--cols: ${PREVIEW_GRID_SIZE}; --rows: ${PREVIEW_GRID_SIZE};">
        ${cells}
      </div>
    `;
  };

  const renderNextPieces = (queue = []) => {
    if (!queue.length) {
      nextPieceContainer.innerHTML = '<p>No pieces queued</p>';
      return;
    }
    nextPieceContainer.innerHTML = queue
      .map(
        (piece, index) => `
          <article class="piece-preview__item" style="--accent: ${piece.color}">
            <p class="piece-preview__title">+${index + 1}</p>
            ${renderPreviewGrid(piece)}
          </article>
        `,
      )
      .join('');
  };

  const renderLayerIntel = (grid = [], boardSize) => {
    if (!layerTableBody || !boardSize) return;
    const layersToShow = Math.min(boardSize.height, LAYER_SUMMARY_COUNT);
    const totalBlocks = boardSize.width * boardSize.depth;
    if (!layersToShow || !grid.length) {
      layerTableBody.innerHTML = '<tr><td colspan="3">Calibrating…</td></tr>';
      return;
    }
    const totalLabel = totalBlocks.toLocaleString();
    const rows = [];
    for (let y = 0; y < layersToShow; y += 1) {
      const layer = grid[y] ?? [];
      let filled = 0;
      layer.forEach((row) => row.forEach((cell) => { if (cell) filled += 1; }));
      const remaining = Math.max(0, totalBlocks - filled);
      rows.push({ layerNumber: y + 1, remaining });
    }
    layerTableBody.innerHTML = rows
      .map(
        ({ layerNumber, remaining }) => `
          <tr>
            <td>Layer ${layerNumber}</td>
            <td>${totalLabel}</td>
            <td class="${remaining === 0 ? 'layer-table__done' : ''}">${remaining.toLocaleString()}</td>
          </tr>
        `,
      )
      .join('');
  };

  const render = (state) => {
    pauseButton.textContent = state.isPaused ? 'Resume' : 'Pause';
    stats.score.textContent = state.score.toLocaleString();
    stats.level.textContent = state.level;
    stats.layers.textContent = state.linesCleared;

    if (gridSizeInput && state.boardSize) {
      gridSizeInput.value = state.boardSize.width;
    }

    const toNext = Math.max(0, 5 - (state.linesCleared % 5));
    const filled = ((5 - toNext) / 5) * 100;
    progressFill.style.width = `${filled}%`;
    const progressText = toNext === 0 ? 'Level up imminent!' : `${toNext} layers to next level`;
    progressLabel.textContent = `Level ${state.level} • ${progressText}`;

    renderNextPieces(state.nextQueue || []);
    renderLayerIntel(state.grid, state.boardSize);
    viewSelect.value = state.viewType;
    eyeDistanceInput.value = state.stereoSettings.eyeDistance;
    focusDepthInput.value = state.stereoSettings.focusDepth;
    fovInput.value = state.stereoSettings.fov;
    eyeValue.textContent = `${state.stereoSettings.eyeDistance.toFixed(3)}m`;
    focusValue.textContent = `${state.stereoSettings.focusDepth.toFixed(1)}m`;
    fovValue.textContent = `${state.stereoSettings.fov.toFixed(0)}°`;
    opacityInput.value = state.cubeOpacity ?? 1;
    opacityValue.textContent = `${Math.round((state.cubeOpacity ?? 1) * 100)}%`;

    if (['stereo', 'cross', 'parallel'].includes(state.viewType)) {
      stereoGrid.removeAttribute('hidden');
    } else {
      stereoGrid.setAttribute('hidden', 'hidden');
    }

    const rendererError = renderRendererError();
    if (!rendererError) {
      if (state.message) {
        messageEl.textContent = state.message;
        messageEl.removeAttribute('hidden');
      } else {
        messageEl.setAttribute('hidden', 'hidden');
      }
    }

    renderer.update(state);
  };

  const destroy = () => {
    pauseButton.removeEventListener('click', pauseHandler);
    restartButton.removeEventListener('click', restartHandler);
    viewSelect.removeEventListener('change', viewHandler);
    eyeDistanceInput.removeEventListener('input', eyeHandler);
    focusDepthInput.removeEventListener('input', focusHandler);
    fovInput.removeEventListener('input', fovHandler);
    opacityInput.removeEventListener('input', opacityHandler);
    if (gridSizeInput) {
      gridSizeInput.removeEventListener('change', gridSizeHandler);
    }
    if (autoRotateToggle) {
      autoRotateToggle.removeEventListener('change', autoRotateHandler);
    }
    renderer.destroy();
  };

  return { render, destroy };
}
