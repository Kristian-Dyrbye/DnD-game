/** Root UI component: switches between the title screen, the character creator and the game. */
import { GAME_TITLE } from '../../shared/version';
import { StatusIndicator } from './StatusIndicator';
import { Creator } from './creator/Creator';
import { screen, startNewCharacter } from './state';

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

export function App() {
  return (
    <>
      {screen.value === 'creator' ? <Creator /> : <TitleScreen />}
      <StatusIndicator />
    </>
  );
}
