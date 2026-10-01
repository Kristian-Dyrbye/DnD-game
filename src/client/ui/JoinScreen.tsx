/**
 * Co-op guest's title screen (C006b), shown instead of the normal title on a page opened from the host's
 * join link (`?join=CODE`). Not seated: name + player/spectator → `join`; a player then builds a hero in
 * the creator (sent as `add_hero`), a spectator goes straight to the game. Seated: back to the table or
 * leave it (`release_seat`). A stored seat token sits down again by itself after a reload.
 */
import { useEffect, useState } from 'preact/hooks';
import { GAME_TITLE } from '../../shared/version';
import { gameState, joinTable, lastError, mySeat, send, storedSeat } from '../net/gameSocket';
import { afterJoin } from '../net/tableInfo';
import { screen, startAddingHero } from './state';
import { t } from './i18n';
import { LanguagePicker } from './LanguagePicker';

export function JoinScreen() {
  const seated = mySeat.value;
  const [stored] = useState(storedSeat);
  const [name, setName] = useState(stored.name ?? '');
  const [role, setRole] = useState<'player' | 'spectator'>('player');
  /** Waiting for the join answer (and the snapshot that follows it) before moving on. */
  const [joining, setJoining] = useState(false);

  const join = (profile: { name?: string; role?: 'player' | 'spectator' }) => {
    lastError.value = null;
    setJoining(true);
    joinTable(profile);
  };

  // A reload with a stored token takes the same seat again without asking.
  useEffect(() => {
    if (stored.token && !mySeat.peek()) join({});
  }, []);

  useEffect(() => {
    if (lastError.value) setJoining(false);
  }, [lastError.value]);

  useEffect(() => {
    if (!joining || !seated || !gameState.value) return;
    setJoining(false);
    const control = (gameState.value.extensions.party as { control?: Record<string, string> } | undefined)?.control;
    if (afterJoin(seated.role, control, seated.seat) === 'creator') startAddingHero();
    else screen.value = 'game';
  }, [joining, seated, gameState.value]);

  return (
    <main class="title-screen join-screen">
      <h1>{GAME_TITLE}</h1>
      {seated ? (
        <>
          <p>{t(seated.role === 'spectator' ? 'join.seatedSpectator' : 'join.seatedPlayer')}</p>
          <div class="title-actions">
            <button type="button" class="primary" onClick={() => (screen.value = 'game')}>
              {t('join.back')}
            </button>
            <button type="button" onClick={() => send({ type: 'release_seat' })} title={t('join.leaveTitle')}>
              {t('join.leave')}
            </button>
          </div>
        </>
      ) : (
        <form
          class="join-form"
          onSubmit={(e) => {
            e.preventDefault();
            const n = name.trim();
            join({ ...(n && { name: n.slice(0, 40) }), role });
          }}
        >
          <p>{t('join.intro')}</p>
          <label>
            {t('join.name')}
            <input type="text" value={name} maxLength={40} autoComplete="nickname" onInput={(e) => setName((e.target as HTMLInputElement).value)} />
          </label>
          <fieldset class="join-role">
            <legend>{t('join.as')}</legend>
            <label>
              <input type="radio" name="role" checked={role === 'player'} onChange={() => setRole('player')} /> {t('join.player')}
            </label>
            <label>
              <input type="radio" name="role" checked={role === 'spectator'} onChange={() => setRole('spectator')} /> {t('join.spectator')}
            </label>
          </fieldset>
          <p class="hint small">{t(role === 'player' ? 'join.playerHint' : 'join.spectatorHint')}</p>
          <div class="title-actions">
            <button type="submit" class="primary" disabled={joining}>
              {t(joining ? 'join.joining' : 'join.join')}
            </button>
          </div>
          {lastError.value && (
            <p class="game-error" role="alert">
              {lastError.value}
            </p>
          )}
        </form>
      )}
      <LanguagePicker class="title-language" />
    </main>
  );
}
