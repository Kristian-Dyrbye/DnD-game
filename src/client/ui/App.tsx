/** Root UI component: switches between the title screen, the character creator and the game. */
import { GAME_TITLE } from '../../shared/version';
import { StatusIndicator } from './StatusIndicator';
import { Creator } from './creator/Creator';
import { hero, screen, startNewCharacter } from './state';

function TitleScreen() {
  return (
    <main class="title-screen">
      <h1>{GAME_TITLE}</h1>
      <p>A solo adventure with a local AI Dungeon Master.</p>
      <div class="title-actions">
        <button type="button" class="primary" onClick={startNewCharacter}>
          New Game
        </button>
      </div>
    </main>
  );
}

/** Placeholder until the game screen (Phase 4). */
function GameScreen() {
  const h = hero.value;
  return (
    <main class="title-screen">
      <h1>{h?.name ?? 'Your hero'}</h1>
      <p>Your adventure begins in Millbrook… (the story screen arrives in the next build phase)</p>
      <button type="button" onClick={() => (screen.value = 'title')}>Back to title</button>
    </main>
  );
}

export function App() {
  return (
    <>
      {screen.value === 'creator' ? <Creator /> : screen.value === 'game' ? <GameScreen /> : <TitleScreen />}
      <StatusIndicator />
    </>
  );
}
