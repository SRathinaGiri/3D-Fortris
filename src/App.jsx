import { useMemo } from 'react';
import ControlPanel from './components/ControlPanel.jsx';
import GameCanvas from './components/GameCanvas.jsx';
import LevelProgress from './components/LevelProgress.jsx';
import ScorePanel from './components/ScorePanel.jsx';
import useGameLogic from './hooks/useGameLogic.js';
import './App.css';

function App() {
  const game = useGameLogic();
  const {
    grid,
    activePiece,
    nextPiece,
    score,
    level,
    linesCleared,
    viewType,
    stereoSettings,
    isPaused,
    togglePause,
    resetGame,
    updateView,
    updateStereoSettings,
    message,
    clearingLayers,
  } = game;

  const hudStats = useMemo(() => [
    { label: 'Score', value: score.toLocaleString() },
    { label: 'Level', value: level },
    { label: 'Cleared Layers', value: linesCleared },
  ], [score, level, linesCleared]);

  return (
    <div className="app">
      <header className="app__header">
        <div>
          <h1>3DTris</h1>
          <p className="app__tagline">Stack, rotate and clear entire volumes in a fully 3D Tetris experience.</p>
        </div>
        <div className="header__actions">
          <button type="button" className="secondary" onClick={togglePause}>
            {isPaused ? 'Resume' : 'Pause'}
          </button>
          <button type="button" onClick={resetGame}>
            Restart
          </button>
        </div>
      </header>

      <main className="app__body">
        <section className="app__sidebar">
          <ScorePanel stats={hudStats} nextPiece={nextPiece} />
          <LevelProgress level={level} lines={linesCleared} />
          <ControlPanel
            viewType={viewType}
            stereoSettings={stereoSettings}
            onViewChange={updateView}
            onStereoChange={updateStereoSettings}
            message={message}
          />
          <article className="tips">
            <h3>Controls</h3>
            <ul>
              <li>Arrow keys: Move the falling piece</li>
              <li>Q / E: Rotate around the X axis</li>
              <li>W / S: Rotate around the Z axis</li>
              <li>A / D: Rotate around the Y axis</li>
              <li>Space: Hard drop</li>
              <li>P: Pause / resume</li>
            </ul>
          </article>
        </section>

        <section className="app__stage">
          <GameCanvas
            grid={grid}
            activePiece={activePiece}
            viewType={viewType}
            stereoSettings={stereoSettings}
            clearingLayers={clearingLayers}
          />
        </section>
      </main>
    </div>
  );
}

export default App;
