/** C006: a guest's or spectator's say/choose becomes a proposal for the host; the host sets the table policy. */
import { describe, expect, it } from 'vitest';
import type { ProposalEvent, ServerEvent } from '../../shared/protocol';
import { buildCharacter } from '../character/builder';
import { toBuildInput } from '../character/creator';
import { quickBuild } from '../character/quickBuild';
import { Rng } from '../core/rng';
import { loadSrd } from '../data/srdBundle';
import { GameSession } from './GameSession';

const db = loadSrd();
const built = (cls: string, name: string) => ({ ...buildCharacter(toBuildInput(quickBuild(cls, db, Rng.fromSeed(name))), db), name });

async function table() {
  const s = new GameSession({ newSeed: () => 'prop' });
  const events: ServerEvent[] = [];
  s.on((e) => events.push(e));
  await s.handle({ type: 'new_game', hero: built('fighter', 'Mira'), mode: 'heroic' });
  s.seatGuest('player', 'Kim');
  s.seatGuest('spectator');
  await s.handle({ type: 'add_hero', hero: built('rogue', 'Wren') }, 'guest-1');
  s.suggest([{ id: 'study_ledger', label: 'Study the ledger' }]);
  events.length = 0;
  const of = <T extends ServerEvent['type']>(type: T) => events.filter((e): e is Extract<ServerEvent, { type: T }> => e.type === type);
  return { s, events, of };
}

describe('proposals (C006)', () => {
  it('host_decides: a guest’s choose is a proposal with the button label, the story does not move', async () => {
    const { s, of } = await table();
    const logBefore = s.current.log.length;
    await s.handle({ type: 'choose', actionId: 'study_ledger', actor: 'hero-2' }, 'guest-1');
    expect(of('error')).toEqual([]);
    expect(of('proposal')).toEqual<ProposalEvent[]>([{ type: 'proposal', id: 1, seat: 'guest-1', name: 'Kim', command: 'choose', actionId: 'study_ledger', label: 'Study the ledger', actor: 'hero-2' }]);
    expect(of('ack')).toEqual([]);
    expect(s.current.log.length).toBe(logBefore);
  });

  it('a guest’s free text and a spectator’s choice are proposals too; unknown buttons have no label', async () => {
    const { s, of } = await table();
    await s.handle({ type: 'say', text: 'Ask the barkeep about the mill' }, 'guest-1');
    await s.handle({ type: 'choose', actionId: 'gone' }, 'guest-2');
    expect(of('proposal')).toEqual([
      { type: 'proposal', id: 1, seat: 'guest-1', name: 'Kim', command: 'say', text: 'Ask the barkeep about the mill' },
      { type: 'proposal', id: 2, seat: 'guest-2', name: 'guest-2', command: 'choose', actionId: 'gone' },
    ]);
  });

  it('a nameless guest is shown by their hero’s name', async () => {
    const s = new GameSession({ newSeed: () => 'prop2' });
    const events: ServerEvent[] = [];
    s.on((e) => events.push(e));
    await s.handle({ type: 'new_game', hero: built('fighter', 'Mira'), mode: 'heroic' });
    s.seatGuest('player');
    await s.handle({ type: 'add_hero', hero: built('rogue', 'Wren') }, 'guest-1');
    await s.handle({ type: 'say', text: 'Look around' }, 'guest-1');
    expect(events.findLast((e) => e.type === 'proposal')).toMatchObject({ name: 'Wren' });
  });

  it('other story commands from a guest stay refused, and without a game a proposal is an error', async () => {
    const { s, of } = await table();
    await s.handle({ type: 'travel', to: 'ashfall', pace: 'normal' }, 'guest-1');
    expect(of('error').map((e) => e.message)).toHaveLength(1);
    expect(of('proposal')).toEqual([]);

    const empty = new GameSession();
    const events: ServerEvent[] = [];
    empty.on((e) => events.push(e));
    empty.seatGuest('player', 'Kim');
    await empty.handle({ type: 'say', text: 'hi' }, 'guest-1');
    expect(events.some((e) => e.type === 'proposal')).toBe(false);
    expect(events.some((e) => e.type === 'error')).toBe(true);
  });

  it('the host’s own story actions are never proposals', async () => {
    const { s, of } = await table();
    await s.handle({ type: 'say', text: 'Look around' });
    expect(of('proposal')).toEqual([]);
    expect(of('ack')).toMatchObject([{ command: 'say' }]);
  });
});

describe('set_policy (C006)', () => {
  it('the host switches to anyone: a table event, a log line, and guests act directly', async () => {
    const { s, of } = await table();
    await s.handle({ type: 'set_policy', policy: 'anyone', reqId: 'p' });
    expect(of('table').at(-1)).toMatchObject({ policy: 'anyone' });
    expect(of('ack')).toMatchObject([{ command: 'set_policy', reqId: 'p' }]);
    expect(s.current.log.at(-1)?.text).toBe('From now on every player at the table may act in the story.');

    await s.handle({ type: 'say', text: 'Look around' }, 'guest-1');
    expect(of('proposal')).toEqual([]);
    expect(of('ack').at(-1)).toMatchObject({ command: 'say' });
    // A spectator still only proposes.
    await s.handle({ type: 'say', text: 'Look around' }, 'guest-2');
    expect(of('proposal')).toHaveLength(1);
  });

  it('setting the same policy again changes nothing; a guest may not set it', async () => {
    const { s, of } = await table();
    await s.handle({ type: 'set_policy', policy: 'host_decides' });
    expect(of('table')).toEqual([]);
    await s.handle({ type: 'set_policy', policy: 'anyone' }, 'guest-1');
    expect(of('error')).toHaveLength(1);
    expect(s.table.policy).toBe('host_decides');
  });

  it('writes the policy line in the table’s language', async () => {
    const { s } = await table();
    s.language = 'da';
    await s.handle({ type: 'set_policy', policy: 'anyone' });
    await s.handle({ type: 'set_policy', policy: 'host_decides' });
    expect(s.current.log.slice(-2).map((e) => e.text)).toEqual(['Fra nu af må alle spillere ved bordet handle i historien.', 'Fra nu af bestemmer værten i historien; de andre kommer med forslag.']);
  });
});
