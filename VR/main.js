import { GameState } from './js/gameState.js';
import { initUI } from './js/ui.js';

const gameState = new GameState();
const ui = initUI(gameState);
const unsubscribe = gameState.subscribe((state) => ui.render(state));

gameState.start();

window.addEventListener('beforeunload', () => {
  unsubscribe();
  ui.destroy();
  gameState.destroy();
});
