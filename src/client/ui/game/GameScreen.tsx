/**
 * Main game screen (spec §8): top bar (location, clock, map/journal/save/menu), party panel on the
 * left, story log + actions in the centre, 3D hero view and dice tray on the right. Collapses to a
 * single column on narrow windows.
 */
import { timeOfDay } from '../../../engine/world/clock';
import { weatherEffects, type WeatherState } from '../../../engine/world/weather';
import { CharacterPreview } from '../../three/CharacterPreview';
import { useEffect, useState } from 'preact/hooks';
import { connection, gameState, lastError, objective, send } from '../../net/gameSocket';
import { loadSettings, settings, updateSettings } from '../settingsState';
import { hero, screen } from '../state';
import { formatClock } from '../text';
import { ActionInput } from './ActionInput';
import { DiceTray } from './DiceTray';
import { JournalPanel } from './JournalPanel';
import { PartyPanel } from './PartyPanel';
import { StoryLog } from './StoryLog';

export function GameScreen() {
  const state = gameState.value;
  const h = state?.hero ?? hero.value;
  const weather = state?.extensions.weather as WeatherState | undefined;
  useEffect(() => {
    void loadSettings();
  }, []);
  const hintOn = settings.value?.gameplay.objectiveHint ?? false;
  const [journalOpen, setJournalOpen] = useState(false);
  return (
    <div class="game-screen">
      <header class="game-bar">
        <div class="game-where">
          <strong>{state?.location.name ?? '…'}</strong>
          {state && <span class="muted">{formatClock(state.time, timeOfDay(state.time))}</span>}
          {weather && <span class="muted weather">{weatherEffects(weather).description}</span>}
        </div>
        <nav class="game-menu" aria-label="Game menu">
          <button type="button" disabled title="World map (coming soon)">
            Map
          </button>
          <button type="button" disabled={!state} onClick={() => setJournalOpen(true)}>
            Journal
          </button>
          <button
            type="button"
            aria-pressed={hintOn}
            title="Show a small hint about your current objective"
            onClick={() => void updateSettings({ gameplay: { objectiveHint: !hintOn } })}
          >
            Hint: {hintOn ? 'on' : 'off'}
          </button>
          <button type="button" disabled={!state || connection.value !== 'open'} onClick={() => send({ type: 'save', slot: 'quicksave', name: 'Quick save' })}>
            Quick save
          </button>
          <button type="button" onClick={() => (screen.value = 'title')}>
            Menu
          </button>
        </nav>
      </header>
      {hintOn && objective.value && (
        <p class="objective-hint" role="note">
          <span class="muted">Objective:</span> {objective.value}
        </p>
      )}
      {h && <PartyPanel hero={h} companions={state?.companions ?? []} />}
      <main class="game-main">
        {connection.value !== 'open' && <p class="connection-note">{connection.value === 'connecting' ? 'Connecting to the game server…' : 'Disconnected — retrying…'}</p>}
        <StoryLog />
        {lastError.value && (
          <p class="game-error" role="alert">
            {lastError.value}{' '}
            <button type="button" class="link-button" onClick={() => (lastError.value = null)}>
              Dismiss
            </button>
          </p>
        )}
        <ActionInput />
      </main>
      {journalOpen && <JournalPanel onClose={() => setJournalOpen(false)} />}
      <aside class="game-side">
        <div class="hero-view">{h && <CharacterPreview appearance={h.appearance} size={h.size} height={240} />}</div>
        <DiceTray />
      </aside>
    </div>
  );
}
