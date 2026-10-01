/** C005: seating guests and releasing seats in the session (the join code itself is the transport's, see host/joinDesk). */
import { describe, expect, it } from 'vitest';
import type { ServerEvent } from '../../shared/protocol';
import { buildCharacter } from '../character/builder';
import { toBuildInput } from '../character/creator';
import { quickBuild } from '../character/quickBuild';
import { Rng } from '../core/rng';
import { loadSrd } from '../data/srdBundle';
import { GameSession } from './GameSession';
import { allows, HOST_SEAT, MAX_GUESTS, ownerOf, soloTable } from './table';

const db = loadSrd();
const built = (cls: string, name: string) => ({ ...buildCharacter(toBuildInput(quickBuild(cls, db, Rng.fromSeed(name))), db), name });

function session() {
  const s = new GameSession({ newSeed: () => 'join' });
  const events: ServerEvent[] = [];
  s.on((e) => events.push(e));
  const errors = () => events.filter((e): e is Extract<ServerEvent, { type: 'error' }> => e.type === 'error').map((e) => e.message);
  return { s, events, errors };
}

describe('release_seat rights (C005)', () => {
  it('anyone may leave; only the host may free another seat', () => {
    const table = soloTable();
    table.seats.push({ id: 'guest-1', role: 'player' }, { id: 'guest-2', role: 'spectator' });
    expect(allows(table, { type: 'release_seat' }, 'guest-1').ok).toBe(true);
    expect(allows(table, { type: 'release_seat', seat: 'guest-2' }, 'guest-2').ok).toBe(true);
    expect(allows(table, { type: 'release_seat', seat: 'guest-2' }, 'guest-1')).toMatchObject({ ok: false, key: 'table.hostOnly' });
    expect(allows(table, { type: 'release_seat', seat: 'guest-1' }, HOST_SEAT).ok).toBe(true);
    // join is the transport's: it reaches the session (which refuses it) from any seat.
    expect(allows(table, { type: 'join' }, 'guest-2').ok).toBe(true);
  });
});

describe('seating and leaving (C005)', () => {
  it('a guest sits down (table event + log line) and, leaving, hands their hero to the AI', async () => {
    const { s, events, errors } = session();
    await s.handle({ type: 'new_game', hero: built('fighter', 'Mira'), mode: 'heroic' });
    const seat = s.seatGuest('player', 'Kim');
    expect(seat.id).toBe('guest-1');
    expect(events.findLast((e) => e.type === 'table')).toMatchObject({ seats: [{ id: 'host' }, { id: 'guest-1', role: 'player', name: 'Kim' }], policy: 'host_decides' });
    expect(s.current.log.at(-1)?.text).toBe('Kim sits down at the table.');

    await s.handle({ type: 'add_hero', hero: built('cleric', 'Wren') }, 'guest-1');
    expect(ownerOf(s.table, s.current, 'hero-2')).toBe('guest-1');

    await s.handle({ type: 'release_seat', reqId: 'bye' }, 'guest-1');
    expect(errors()).toEqual([]);
    expect(s.table.seats.map((x) => x.id)).toEqual(['host']);
    expect((s.current.extensions.party as { control: Record<string, string> }).control['hero-2']).toBe('ai');
    expect(events.findLast((e) => e.type === 'table')).toMatchObject({ seats: [{ id: 'host' }] });
    expect(events.at(-1)).toMatchObject({ type: 'ack', command: 'release_seat', reqId: 'bye' });
    expect(s.current.log.some((l) => l.text.startsWith('Kim leaves the table'))).toBe(true);
  });

  it('the host frees a guest seat; the host seat stays; a full table refuses more guests', async () => {
    const { s, errors } = session();
    s.seatGuest('spectator', 'Coach');
    await s.handle({ type: 'release_seat', seat: 'guest-1' });
    expect(s.table.seats).toHaveLength(1);
    await s.handle({ type: 'release_seat' });
    expect(errors()).toEqual(['The host’s seat can’t be released']);
    for (let i = 0; i < MAX_GUESTS; i++) s.seatGuest('spectator');
    expect(() => s.seatGuest('player')).toThrow('The table is full');
  });

  it('a join sent to the session is refused (it needs the transport), in the table language', async () => {
    const { s, errors } = session();
    s.language = 'da';
    await s.handle({ type: 'join', code: 'ABCDEF' });
    expect(errors()).toEqual(['Dette spil er ikke åbent for gæster']);
  });

  it('a guest going away or coming back tells the table', async () => {
    const { s, events } = session();
    s.seatGuest('player');
    await s.setSeatAway('guest-1', true);
    expect(events.findLast((e) => e.type === 'table')).toMatchObject({ seats: [{ id: 'host' }, { id: 'guest-1', away: true }] });
  });
});
