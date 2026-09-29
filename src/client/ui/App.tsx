/** Root UI component. Placeholder title screen until the real screens are built. */
import { GAME_TITLE } from '../../shared/version';

export function App() {
  return (
    <main class="title-screen">
      <h1>{GAME_TITLE}</h1>
      <p>A solo adventure with a local AI Dungeon Master.</p>
    </main>
  );
}
