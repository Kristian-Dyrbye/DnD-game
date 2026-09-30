/**
 * Root UI component: switches between the title screen, the character creator and the game.
 * The creator, game and combat sandbox are separate chunks (they carry the SRD data), loaded when first shown.
 */
import { GAME_TITLE } from '../../shared/version';
import { StatusIndicator } from './StatusIndicator';
import { WEB_EDITION } from '../edition';
import { screen, settingsOpen, startNewCharacter } from './state';
import { useEffect, useState } from 'preact/hooks';
import { SaveBrowser } from './SaveBrowser';
import { AboutPanel } from './AboutPanel';
import { audio } from '../audio/AudioManager';
import { loadSettings } from './settingsState';
import { SettingsPanel } from './SettingsPanel';
import { lazyScreen } from './lazyScreen';

const Creator = lazyScreen(async () => (await import('./creator/Creator')).Creator, 'character creator');
const GameScreen = lazyScreen(async () => (await import('./game/GameScreen')).GameScreen, 'game');
const DemoCombat = lazyScreen(async () => (await import('./combat/DemoCombat')).DemoCombat, 'combat sandbox');

function TitleScreen() {
  // `#load` opens the save browser straight away (test shortcut).
  const [about, setAbout] = useState(false);
  const [loading, setLoading] = useState(() => typeof location !== 'undefined' && location.hash === '#load');
  return (
    <main class="title-screen">
      <h1>{GAME_TITLE}</h1>
      <p>{WEB_EDITION ? 'A solo adventure in your browser.' : 'A solo adventure with a local AI Dungeon Master.'}</p>
      <div class="title-actions">
        <button type="button" class="primary" onClick={startNewCharacter}>
          New Game
        </button>
        <button type="button" onClick={() => setLoading(true)}>
          Load Game
        </button>
        <button type="button" onClick={() => (settingsOpen.value = true)}>
          Settings
        </button>
        <button type="button" onClick={() => setAbout(true)}>
          About
        </button>
      </div>
      {loading && <SaveBrowser mode="load" onClose={() => setLoading(false)} />}
      {about && <AboutPanel onClose={() => setAbout(false)} />}
    </main>
  );
}

export function App() {
  // Menu music outside the game; in game the server sends the mood.
  useEffect(() => {
    void loadSettings();
    if (screen.value !== 'game') audio.setMood('menu', null);
  }, [screen.value]);
  return (
    <>
      {screen.value === 'creator' ? <Creator /> : screen.value === 'game' ? <GameScreen /> : screen.value === 'combat' ? <DemoCombat /> : <TitleScreen />}
      {screen.value !== 'combat' && <StatusIndicator />}
      {settingsOpen.value && <SettingsPanel onClose={() => (settingsOpen.value = false)} />}
    </>
  );
}
