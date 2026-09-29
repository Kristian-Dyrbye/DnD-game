import { describe, expect, it } from 'vitest';
import type { ServerEvent } from '../../shared/protocol';
import { parseCommand } from '../../shared/protocol';
import { buildCharacter } from '../character/builder';
import { toBuildInput } from '../character/creator';
import { quickBuild } from '../character/quickBuild';
import { Rng } from '../core/rng';
import { loadSrd } from '../data/srdBundle';
import { GameSession } from './GameSession';
import { GameStateSchema } from './gameState';
import { deletePage, JournalError, JournalSchema, JOURNAL_MAX_PAGES, reorderPages, savePage } from './journal';

const db = loadSrd();

describe('journal model', () => {
  it('creates, updates, deletes and reorders pages', () => {
    const j = JournalSchema.parse({});
    const a = savePage(j, { title: 'Suspects', body: 'The mayor?' }, 480);
    const b = savePage(j, { title: '  ', body: 'untitled note' }, 500);
    expect(j.pages.map((p) => [p.id, p.title])).toEqual([
      [a, 'Suspects'],
      [b, 'Untitled'],
    ]);
    savePage(j, { id: a, title: 'Suspects', body: 'The mayor sold bad grain.' }, 600);
    expect(j.pages[0]).toEqual({ id: a, title: 'Suspects', body: 'The mayor sold bad grain.', updatedAt: 600 });
    reorderPages(j, [b, a]);
    expect(j.pages.map((p) => p.id)).toEqual([b, a]);
    deletePage(j, b);
    expect(j.pages.map((p) => p.id)).toEqual([a]);
    // Ids are never reused.
    expect(savePage(j, { title: 'New', body: '' }, 700)).toBe('p3');
  });

  it('rejects unknown pages, bad orders and a full journal', () => {
    const j = JournalSchema.parse({});
    expect(() => savePage(j, { id: 'p9', title: 'x', body: '' }, 0)).toThrow(JournalError);
    expect(() => deletePage(j, 'p1')).toThrow(JournalError);
    savePage(j, { title: 'a', body: '' }, 0);
    expect(() => reorderPages(j, ['p1', 'p1'])).toThrow(JournalError);
    for (let i = 1; i < JOURNAL_MAX_PAGES; i++) savePage(j, { title: `n${i}`, body: '' }, 0);
    expect(() => savePage(j, { title: 'one too many', body: '' }, 0)).toThrow(/full/);
  });

  it('old saves without a journal get an empty one', () => {
    const hero = buildCharacter(toBuildInput(quickBuild('fighter', db, Rng.fromSeed('f'))), db);
    const s = GameStateSchema.parse({ campaignId: 'c', mode: 'heroic', rng: [1, 2, 3, 4], hero, location: { name: 'x' } });
    expect(s.journal).toEqual({ pages: [], nextPage: 1 });
  });
});

describe('journal commands', () => {
  it('are validated, applied by the session, echoed as journal events and kept in snapshots', async () => {
    expect(parseCommand(JSON.stringify({ type: 'journal_save', page: { title: 't', body: 'b' } })).ok).toBe(true);
    expect(parseCommand(JSON.stringify({ type: 'journal_delete' })).ok).toBe(false);

    const session = new GameSession({ newSeed: () => 's' });
    const events: ServerEvent[] = [];
    session.on((e) => events.push(e));
    const hero = buildCharacter(toBuildInput(quickBuild('wizard', db, Rng.fromSeed('w'))), db);
    await session.handle({ type: 'journal_save', page: { title: 'x', body: '' }, reqId: 'r0' });
    expect(events.at(-1)).toEqual({ type: 'error', message: 'No game is running', reqId: 'r0' });

    await session.handle({ type: 'new_game', hero, mode: 'heroic' });
    await session.handle({ type: 'journal_save', page: { title: 'Clues', body: 'Seven teeth.' } });
    const ev = events.at(-1);
    expect(ev).toMatchObject({ type: 'journal', savedId: 'p1', journal: { pages: [{ id: 'p1', title: 'Clues', body: 'Seven teeth.' }] } });
    await session.handle({ type: 'journal_delete', id: 'p7', reqId: 'r1' });
    expect(events.at(-1)).toEqual({ type: 'error', message: 'That page no longer exists.', reqId: 'r1' });
    await session.handle({ type: 'get_state' });
    const snap = events.at(-1);
    expect(snap?.type === 'snapshot' && snap.state.journal.pages[0]?.title).toBe('Clues');
  });
});
