import { GameRenderer } from './gameRenderer.js';

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
  const stats = {
    score: document.querySelector('[data-stat="score"]'),
    level: document.querySelector('[data-stat="level"]'),
    layers: document.querySelector('[data-stat="layers"]'),
  };

  const renderer = new GameRenderer(document.getElementById('gameCanvas'));

  const pauseHandler = () => gameState.togglePause();
  const restartHandler = () => gameState.resetGame();
  const viewHandler = (event) => gameState.updateView(event.target.value);
  const eyeHandler = (event) => gameState.updateStereoSettings({ eyeDistance: Number(event.target.value) });
  const focusHandler = (event) => gameState.updateStereoSettings({ focusDepth: Number(event.target.value) });
  const fovHandler = (event) => gameState.updateStereoSettings({ fov: Number(event.target.value) });
  const opacityHandler = (event) => gameState.updateOpacity(Number(event.target.value));

  pauseButton.addEventListener('click', pauseHandler);
  restartButton.addEventListener('click', restartHandler);
  viewSelect.addEventListener('change', viewHandler);
  eyeDistanceInput.addEventListener('input', eyeHandler);
  focusDepthInput.addEventListener('input', focusHandler);
  fovInput.addEventListener('input', fovHandler);
  opacityInput.addEventListener('input', opacityHandler);

  const renderNextPieces = (queue = []) => {
    if (!queue.length) {
      nextPieceContainer.innerHTML = '<p>No pieces queued</p>';
      return;
    }
    nextPieceContainer.innerHTML = queue
      .map(
        (piece, index) => `
          <article class="piece-preview__item">
            <p class="piece-preview__title">+${index + 1}</p>
            <div class="piece-preview" style="color: ${piece.color}">
              ${piece.cells.map(() => '<span>■</span>').join('')}
            </div>
          </article>
        `,
      )
      .join('');
  };

  const render = (state) => {
    pauseButton.textContent = state.isPaused ? 'Resume' : 'Pause';
    stats.score.textContent = state.score.toLocaleString();
    stats.level.textContent = state.level;
    stats.layers.textContent = state.linesCleared;

    const toNext = Math.max(0, 5 - (state.linesCleared % 5));
    const filled = ((5 - toNext) / 5) * 100;
    progressFill.style.width = `${filled}%`;
    const progressText = toNext === 0 ? 'Level up imminent!' : `${toNext} layers to next level`;
    progressLabel.textContent = `Level ${state.level} • ${progressText}`;

    renderNextPieces(state.nextQueue || []);
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

    if (state.message) {
      messageEl.textContent = state.message;
      messageEl.removeAttribute('hidden');
    } else {
      messageEl.setAttribute('hidden', 'hidden');
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
    renderer.destroy();
  };

  return { render, destroy };
}
