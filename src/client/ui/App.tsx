/** Root UI component: switches between the title screen, the character creator and the game. */
import { GAME_TITLE } from '../../shared/version';
import { StatusIndicator } from './StatusIndicator';
import { Creator } from './creator/Creator';
import { combatDemoClass, screen, settingsOpen, startNewCharacter } from './state';
import { CombatScreen } from './combat/CombatScreen';
import { demoAct, demoCombat, startDemoCombat } from './combat/combatDemo';
import { useEffect } from 'preact/hooks';
import { audio } from '../audio/AudioManager';
import { loadSettings } from './settingsState';
import { SettingsPanel } from './SettingsPanel';
import { GameScreen } from './game/GameScreen';

function TitleScreen() {
  return (
    <main class="title-screen">
      <h1>{GAME_TITLE}</h1>
      <p>A solo adventure with a local AI Dungeon Master.</p>
      <div class="title-actions">
        <button type="button" class="primary" onClick={startNewCharacter}>
          New Game
        </button>
        <button type="button" onClick={() => (settingsOpen.value = true)}>
          Settings
        </button>
      </div>
    </main>
  );
}

/** The local combat sandbox (`#combat-<class>`). */
function DemoCombat() {
  if (!demoCombat.value && combatDemoClass) startDemoCombat(combatDemoClass);
  const cur = demoCombat.value;
  if (!cur) return null;
  return <CombatScreen enc={cur.enc} ctx={cur.ctx} act={demoAct} onLeave={() => (screen.value = 'title')} />;
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
