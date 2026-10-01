/**
 * Main game screen (spec §8): top bar (location, clock, weather, map/journal/hint/save/menu), party panel on the
 * left, story log + actions in the centre, 3D hero view and dice tray on the right. Collapses to a
 * single column on narrow windows.
 */
import { CharacterScreen } from './CharacterScreen';
import { SaveBrowser } from '../SaveBrowser';
import { armorWear } from '../../../engine/character/armorWear';
import { woundLevel } from '../../../engine/appearance/wounds';
import { equipmentLook } from '../../../engine/appearance/equipmentVisuals';
import { timeOfDay } from '../../../engine/world/clock';
import { weatherEffects, type WeatherState } from '../../../engine/world/weather';
import { CharacterPreview } from '../../three/LazyCharacterPreview';
import { useEffect, useState } from 'preact/hooks';
import { connection, dungeon, fight, gameState, heroFallen, joinCode, lastError, mySeat, objective, send, storyLog, streaming, waitingFor } from '../../net/gameSocket';
import { pageSeat, seatId, viewedHero } from '../../net/coopView';
import { DungeonPanel } from './DungeonPanel';

/** Previews (reachable squares, attack checks) need a context; they never roll. */
const previewCtx = { rng: Rng.fromSeed('preview'), db };
import { loadSettings, settings, updateSettings } from '../settingsState';
import { continueWorldNext, hero, screen, settingsOpen, startAddingHero, startNewCharacter } from '../state';
import { CombatScreen } from '../combat/CombatScreen';
import { Rng } from '../../../engine/core/rng';
import { db } from '../../data';
import { formatClock } from '../text';
import { ActionInput } from './ActionInput';
import { DiceTray } from './DiceTray';
import { JournalPanel } from './JournalPanel';
import { WorldMap } from './WorldMap';
import { speaking, ttsPlayer } from '../../audio/ttsPlayer';
import { WEB_EDITION } from '../../edition';
import { InventoryPanel } from './InventoryPanel';
import { LevelUpPanel } from './LevelUpPanel';
import { ShopPanel } from './ShopPanel';
import { getMap } from '../../../engine/world/travel';
import { shopsAt } from '../../../engine/world/shops';
import { localShops } from '../../data';
import { PartyPanel } from './PartyPanel';
import { TablePanel } from './TablePanel';
import { StoryLog } from './StoryLog';
import { currentTranslator, language, t } from '../i18n';
import { messages } from '../../../engine/i18n';

export function GameScreen() {
  const state = gameState.value;
  const h = state?.hero ?? hero.value;
  const weather = state?.extensions.weather as WeatherState | undefined;
  useEffect(() => {
    void loadSettings();
  }, []);
  const guest = joinCode.value !== null;
  const seat = pageSeat(guest, mySeat.value);
  const controls = (state?.extensions.party as { control?: Record<string, string> } | undefined)?.control ?? {};
  /** The hero this page looks at (a guest player's own hero, C008b). */
  const shown = h && viewedHero(seat, h, state?.companions ?? [], controls);
  const hintOn = settings.value?.gameplay.objectiveHint ?? false;
  const voiceOn = settings.value?.tts.enabled ?? false;
  const [journalOpen, setJournalOpen] = useState(false);
  const [inventoryOpen, setInventoryOpen] = useState(false);
  /** Id of the hero whose level-up dialog is open. */
  const [levelUpFor, setLevelUpFor] = useState<string | null>(null);
  const levelling = levelUpFor === null || !h ? undefined : levelUpFor === h.id ? h : state?.companions.find((c) => c.id === levelUpFor);
  const [characterOpen, setCharacterOpen] = useState(false);
  const [savesOpen, setSavesOpen] = useState(false);
  const [tableOpen, setTableOpen] = useState(false);
  const [shopId, setShopId] = useState<string | null>(null);
  const here = state ? getMap(state)?.current : undefined;
  const shopsHere = here ? shopsAt(localShops.value, here) : [];
  const [mapOpen, setMapOpen] = useState(() => typeof location !== 'undefined' && location.hash.endsWith('+map'));
  if (fight.value) {
    const f = fight.value;
    return (
      <CombatScreen
        enc={f.encounter}
        ctx={previewCtx}
        seat={seatId(seat)}
        {...(waitingFor.value && { waitingText: waitingFor.value.text })}
        narration={streaming.value?.text || [...storyLog.value].reverse().find((e) => e.kind === 'narration')?.text}
        act={(a) => {
          send({ type: 'combat_act', action: a });
          return undefined;
        }}
        {...(f.canFlee && f.encounter.status === 'ongoing' && { onLeave: () => send({ type: 'combat_flee' }), leaveLabel: t('game.flee') })}
      />
    );
  }
  if (heroFallen.value) {
    return (
      <main class="title-screen fallen">
        <h1>{t('fallen.title', { name: heroFallen.value })}</h1>
        <p>{t('fallen.text')}</p>
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
            {t('fallen.newHero')}
          </button>
          <button type="button" onClick={() => ((heroFallen.value = null), (screen.value = 'title'))}>
            {t('fallen.back')}
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
          {state && <span class="muted">{formatClock(state.time, timeOfDay(state.time), currentTranslator())}</span>}
          {weather && <span class="muted weather">{weatherEffects(weather, messages(language.value)).description}</span>}
        </div>
        <nav class="game-menu" aria-label={t('game.menuAria')}>
          <button type="button" disabled={!state} onClick={() => setMapOpen(true)}>
            {t('game.map')}
          </button>
          <button type="button" disabled={!state} onClick={() => setJournalOpen(true)}>
            {t('game.journal')}
          </button>
          <button type="button" disabled={!state} onClick={() => setCharacterOpen(true)}>
            {t('game.character')}
          </button>
          <button type="button" disabled={!state} onClick={() => setInventoryOpen(true)}>
            {t('game.inventory')}
          </button>
          {shopsHere.map((s) => (
            <button key={s.id} type="button" class="shop-button" onClick={() => setShopId(s.id)}>
              {s.name}
            </button>
          ))}
          {/* Settings, saves and voice are the host's (a guest's page may not change them, C006). */}
          {!guest && (
            <>
              <button
                type="button"
                aria-pressed={hintOn}
                title={t('game.hintTitle')}
                onClick={() => void updateSettings({ gameplay: { objectiveHint: !hintOn } })}
              >
                {t('game.hint', { state: t(hintOn ? 'common.on' : 'common.off') })}
              </button>
              <button type="button" aria-pressed={voiceOn} title={t(WEB_EDITION ? 'game.voiceTitleWeb' : 'game.voiceTitleLocal')} onClick={() => void updateSettings({ tts: { enabled: !voiceOn } })}>
                {t('game.voice', { state: t(voiceOn ? 'common.on' : 'common.off') })}
              </button>
              {speaking.value && (
                <button type="button" onClick={() => ttsPlayer.skip()} title={t('game.skipVoiceTitle')}>
                  {t('game.skipVoice')}
                </button>
              )}
              <button type="button" disabled={!state || connection.value !== 'open'} onClick={() => send({ type: 'save', slot: 'quicksave', name: t('game.quickSave') })}>
                {t('game.quickSave')}
              </button>
              <button type="button" disabled={!state || connection.value !== 'open'} onClick={() => setSavesOpen(true)}>
                {t('game.saveLoad')}
              </button>
              <button type="button" onClick={() => (settingsOpen.value = true)}>
                {t('game.settings')}
              </button>
              {/* Co-op: LAN join code (local edition) or a PeerJS room link (web edition, C009b). */}
              <button type="button" title={t('game.tableTitle')} onClick={() => setTableOpen(true)}>
                {t('game.table')}
              </button>
            </>
          )}
          <button type="button" onClick={() => (screen.value = 'title')}>
            {t('game.menu')}
          </button>
        </nav>
      </header>
      {hintOn && objective.value && (
        <p class="objective-hint" role="note">
          <span class="muted">{t('game.objective')}</span> {objective.value}
        </p>
      )}
      {h && <PartyPanel hero={h} companions={state?.companions ?? []} origins={state?.origins ?? {}} onLevelUp={setLevelUpFor} {...(state && { onAddHero: startAddingHero })} loyalty={Object.fromEntries((state?.companions ?? []).map((c) => [c.id, Number(state?.flags[`world.${c.id}_loyalty`] ?? 50)]))} controls={controls} seat={seat} />}
      {levelling && h && <LevelUpPanel key={levelling.id} hero={levelling} main={levelling.id === h.id} onClose={() => setLevelUpFor(null)} />}
      <main class="game-main">
        {connection.value !== 'open' && <p class="connection-note">{t(connection.value === 'connecting' ? (WEB_EDITION ? 'game.startingWeb' : 'game.connecting') : 'game.disconnected')}</p>}
        <StoryLog />
        {lastError.value && (
          <p class="game-error" role="alert">
            {lastError.value}{' '}
            <button type="button" class="link-button" onClick={() => (lastError.value = null)}>
              {t('common.dismiss')}
            </button>
          </p>
        )}
        <ActionInput />
      </main>
      {journalOpen && <JournalPanel onClose={() => setJournalOpen(false)} />}
      {characterOpen && shown && <CharacterScreen c={shown} onClose={() => setCharacterOpen(false)} />}
      {savesOpen && <SaveBrowser mode="save" onClose={() => setSavesOpen(false)} />}
      {tableOpen && <TablePanel onClose={() => setTableOpen(false)} />}
      {mapOpen && <WorldMap onClose={() => setMapOpen(false)} />}
      {inventoryOpen && <InventoryPanel onClose={() => setInventoryOpen(false)} />}
      {shopId && <ShopPanel shopId={shopId} onClose={() => setShopId(null)} />}
      <aside class="game-side">
        {dungeon.value && h && <DungeonPanel view={dungeon.value} hero={h} />}
        <div class="hero-view">{shown && <CharacterPreview appearance={shown.appearance} size={shown.size} height={240} look={equipmentLook(shown, db)} wounds={woundLevel(shown.hp, shown.maxHp)} seed={shown.id} scars={shown.scars.map((s) => s.location)} wear={armorWear(shown)} onSnapshot={guest ? undefined : (data) => send({ type: 'thumbnail', data })} />}</div>
        <DiceTray />
      </aside>
    </div>
  );
}
