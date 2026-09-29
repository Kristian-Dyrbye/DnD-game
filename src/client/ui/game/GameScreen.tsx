/**
 * Main game screen (spec §8): top bar (location, clock, weather, map/journal/hint/save/menu), party panel on the
 * left, story log + actions in the centre, 3D hero view and dice tray on the right. Collapses to a
 * single column on narrow windows.
 */
import { equipmentLook } from '../../../engine/appearance/equipmentVisuals';
import { timeOfDay } from '../../../engine/world/clock';
import { weatherEffects, type WeatherState } from '../../../engine/world/weather';
import { CharacterPreview } from '../../three/LazyCharacterPreview';
import { useEffect, useState } from 'preact/hooks';
import { connection, dungeon, fight, gameState, heroFallen, lastError, objective, send, storyLog, streaming } from '../../net/gameSocket';
import { DungeonPanel } from './DungeonPanel';

/** Previews (reachable squares, attack checks) need a context; they never roll. */
const previewCtx = { rng: Rng.fromSeed('preview'), db };
import { loadSettings, settings, updateSettings } from '../settingsState';
import { continueWorldNext, hero, screen, settingsOpen, startNewCharacter } from '../state';
import { CombatScreen } from '../combat/CombatScreen';
import { Rng } from '../../../engine/core/rng';
import { db } from '../../data';
import { formatClock } from '../text';
import { ActionInput } from './ActionInput';
import { DiceTray } from './DiceTray';
import { JournalPanel } from './JournalPanel';
import { WorldMap } from './WorldMap';
import { speaking, ttsPlayer } from '../../audio/ttsPlayer';
import { InventoryPanel } from './InventoryPanel';
import { LevelUpPanel } from './LevelUpPanel';
import { ShopPanel } from './ShopPanel';
import { getMap } from '../../../engine/world/travel';
import { shopsAt } from '../../../engine/world/shops';
import { shops } from '../../data';
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
  const voiceOn = settings.value?.tts.enabled ?? false;
  const [journalOpen, setJournalOpen] = useState(false);
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [levelUpOpen, setLevelUpOpen] = useState(false);
  const [shopId, setShopId] = useState<string | null>(null);
  const here = state ? getMap(state)?.current : undefined;
  const localShops = here ? shopsAt(shops, here) : [];
  const [mapOpen, setMapOpen] = useState(() => typeof location !== 'undefined' && location.hash.endsWith('+map'));
  if (fight.value) {
    const f = fight.value;
    return (
      <CombatScreen
        enc={f.encounter}
        ctx={previewCtx}
        narration={streaming.value?.text || [...storyLog.value].reverse().find((e) => e.kind === 'narration')?.text}
        act={(a) => {
          send({ type: 'combat_act', action: a });
          return undefined;
        }}
        {...(f.canFlee && f.encounter.status === 'ongoing' && { onLeave: () => send({ type: 'combat_flee' }), leaveLabel: 'Flee' })}
      />
    );
  }
  if (heroFallen.value) {
    return (
      <main class="title-screen fallen">
        <h1>{heroFallen.value} has fallen</h1>
        <p>In Hardcore mode, death is final. But the world remembers what you did — its choices, its scars, its debts.</p>
        <div class="title-actions">
          <button
            type="button"
            class="primary"
            onClick={() => {
              heroFallen.value = null;
              continueWorldNext.value = true;
              startNewCharacter();
            }}
          >
            Create a new hero in this world
          </button>
          <button type="button" onClick={() => ((heroFallen.value = null), (screen.value = 'title'))}>
            Back to title
          </button>
        </div>
      </main>
    );
  }
  return (
    <div class="game-screen">
      <header class="game-bar">
        <div class="game-where">
          <strong>{state?.location.name ?? '…'}</strong>
          {state && <span class="muted">{formatClock(state.time, timeOfDay(state.time))}</span>}
          {weather && <span class="muted weather">{weatherEffects(weather).description}</span>}
        </div>
        <nav class="game-menu" aria-label="Game menu">
          <button type="button" disabled={!state} onClick={() => setMapOpen(true)}>
            Map
          </button>
          <button type="button" disabled={!state} onClick={() => setJournalOpen(true)}>
            Journal
          </button>
          <button type="button" disabled={!state} onClick={() => setInventoryOpen(true)}>
            Inventory
          </button>
          {localShops.map((s) => (
            <button key={s.id} type="button" class="shop-button" onClick={() => setShopId(s.id)}>
              {s.name}
            </button>
          ))}
          <button
            type="button"
            aria-pressed={hintOn}
            title="Show a small hint about your current objective"
            onClick={() => void updateSettings({ gameplay: { objectiveHint: !hintOn } })}
          >
            Hint: {hintOn ? 'on' : 'off'}
          </button>
          <button type="button" aria-pressed={voiceOn} title="Read the story aloud (Piper voice)" onClick={() => void updateSettings({ tts: { enabled: !voiceOn } })}>
            Voice: {voiceOn ? 'on' : 'off'}
          </button>
          {speaking.value && (
            <button type="button" onClick={() => ttsPlayer.skip()} title="Stop the narration voice">
              Skip voice
            </button>
          )}
          <button type="button" disabled={!state || connection.value !== 'open'} onClick={() => send({ type: 'save', slot: 'quicksave', name: 'Quick save' })}>
            Quick save
          </button>
          <button type="button" onClick={() => (settingsOpen.value = true)}>
            Settings
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
      {h && <PartyPanel hero={h} companions={state?.companions ?? []} onLevelUp={() => setLevelUpOpen(true)} loyalty={Object.fromEntries((state?.companions ?? []).map((c) => [c.id, Number(state?.flags[`world.${c.id}_loyalty`] ?? 50)]))} controls={(state?.extensions.party as { control?: Record<string, 'ai' | 'player'> } | undefined)?.control ?? {}} />}
      {levelUpOpen && h && <LevelUpPanel hero={h} onClose={() => setLevelUpOpen(false)} />}
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
      {mapOpen && <WorldMap onClose={() => setMapOpen(false)} />}
      {inventoryOpen && <InventoryPanel onClose={() => setInventoryOpen(false)} />}
      {shopId && <ShopPanel shopId={shopId} onClose={() => setShopId(null)} />}
      <aside class="game-side">
        {dungeon.value && h && <DungeonPanel view={dungeon.value} hero={h} />}
        <div class="hero-view">{h && <CharacterPreview appearance={h.appearance} size={h.size} height={240} look={equipmentLook(h, db)} />}</div>
        <DiceTray />
      </aside>
    </div>
  );
}
