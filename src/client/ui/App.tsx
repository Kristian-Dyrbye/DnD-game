/** Root UI component: switches between the title screen, the character creator and the game. */
import { GAME_TITLE } from '../../shared/version';
import { StatusIndicator } from './StatusIndicator';
import { Creator } from './creator/Creator';
import { hero, screen, startNewCharacter } from './state';
import { connection, gameState, lastError, storyLog } from '../net/gameSocket';

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

/** Minimal game screen until the full layout (A052): shows the server's story log. */
function GameScreen() {
  const h = hero.value;
  const state = gameState.value;
  return (
    <main class="title-screen">
      <h1>{state?.hero.name ?? h?.name ?? 'Your hero'}</h1>
      <p>{state ? `Your adventure begins in ${state.location.name}…` : connection.value === 'open' ? 'Starting your adventure…' : 'Connecting to the game server…'}</p>
      <ul class="story-log">
        {storyLog.value.map((e) => (
          <li key={e.id} class={`log-${e.kind}`}>{e.text}</li>
        ))}
      </ul>
      {lastError.value && <p class="hint">{lastError.value}</p>}
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
