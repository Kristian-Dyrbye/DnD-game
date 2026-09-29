import { describe, expect, it } from 'vitest';
import demo from '../../../data/adventures/demo/millbrook_demo.json';
import flagsJson from '../../../data/adventures/flags.json';
import tablesJson from '../../../data/tables/sidequests.json';
import loreJson from '../../../data/world/lore.json';
import type { ServerEvent } from '../../shared/protocol';
import { buildCharacter } from '../character/builder';
import { toBuildInput } from '../character/creator';
import { quickBuild } from '../character/quickBuild';
import { Rng } from '../core/rng';
import { loadSrd } from '../data/srdBundle';
import { GameSession, newGameState } from '../session/GameSession';
import { createDefaultRegistry } from '../systems';
import { MINUTES_PER_DAY } from '../world/clock';
import { changeReputation } from '../world/factions';
import { FlagRegistry } from '../world/flags';
import { LoreSchema } from '../world/lore';
import { getProgress } from './runner';
import { adventureActionPort } from './sessionActions';
import { acceptOffer, finishActive, offerSources, offersAt, refreshOffers, roadOffer, sideQuestState, type SideQuestDeps } from './sideQuests';
import { SideQuestTablesSchema } from './sidequestTables';
import { validateAdventure } from './validate';

const db = loadSrd();
const lore = LoreSchema.parse(loreJson);
const tables = SideQuestTablesSchema.parse(tablesJson);
const flags = FlagRegistry.fromJson(flagsJson);
const deps: SideQuestDeps = { tables, lore, db, flags };
const hero = () => buildCharacter(toBuildInput(quickBuild('paladin', db, Rng.fromSeed('p'))), db);

function fresh() {
  const s = newGameState(hero(), 'heroic', 'sq-avail');
  createDefaultRegistry({ lore }).init(s);
  return s;
}

describe('offer sources', () => {
  it('boards and taverns by location tags; faction contacts only when friendly', () => {
    const s = fresh();
    expect(offerSources(s, deps, 'millbrook').map((x) => x.source)).toEqual(['board', 'tavern']);
    expect(offerSources(s, deps, 'the_maw')).toEqual([]);
    changeReputation(s, 'crown_of_aurelmark', 30, lore);
    expect(offerSources(s, deps, 'millbrook').map((x) => x.label)).toContain('a contact from the Crown of Aurelmark');
  });
});

describe('offers', () => {
  it('are generated once per location per day, valid, and expire', () => {
    const s = fresh();
    const added = refreshOffers(s, deps, 'millbrook');
    expect(added.length).toBeGreaterThanOrEqual(1);
    for (const o of added) expect(validateAdventure(o.adventure, db, flags).errors).toEqual([]);
    expect(refreshOffers(s, deps, 'millbrook')).toEqual([]);
    expect(offersAt(s, 'millbrook')).toHaveLength(added.length);
    s.time += 4 * MINUTES_PER_DAY;
    expect(offersAt(s, 'millbrook')).toEqual([]);
  });

  it('prefers open threads (woven-in) when their flags are set', () => {
    const s = fresh();
    s.flags['arc.starter.ashby_fate'] = 'escaped';
    const offers = refreshOffers(s, deps, 'brightwater');
    expect(offers.some((o) => o.threadId === 'sextons_return')).toBe(true);
    // The same thread is never offered twice at once.
    expect(offers.filter((o) => o.threadId === 'sextons_return')).toHaveLength(1);
  });

  it('road offers come from travel discoveries', () => {
    const s = fresh();
    const o = roadOffer(s, deps, 'ravensgate');
    expect(o?.source).toBe('road');
    expect(offersAt(s, 'ravensgate')).toHaveLength(1);
  });

  it('accepting suspends the main adventure; finishing resumes it', () => {
    const s = fresh();
    s.extensions.adventure = { adventureId: 'main', sceneId: 'x', visited: ['x'], done: [], beats: [] };
    const [offer] = refreshOffers(s, deps, 'millbrook');
    acceptOffer(s, offer!.id);
    expect(sideQuestState(s).active?.adventure.id).toBe(offer!.id);
    expect(s.extensions.adventure).toBeUndefined();
    expect(() => acceptOffer(s, 'other')).toThrow('Finish your current job first.');
    s.extensions.adventure = { adventureId: offer!.id, sceneId: 'report', visited: [], done: [], beats: [], ending: 'done' };
    expect(finishActive(s)).toEqual({ name: offer!.adventure.name, ending: 'done' });
    expect(getProgress(s)?.adventureId).toBe('main');
    expect(sideQuestState(s).completed).toHaveLength(1);
  });
});

describe('side quests in the session', () => {
  it('look for work → take a job → play it → resume the main adventure', async () => {
    const adventure = validateAdventure(structuredClone(demo), db).adventure!;
    const port = adventureActionPort(new Map([[adventure.id, adventure]]), adventure.id, db, { lore, flags, sideQuests: tables });
    const session = new GameSession({ actions: port, systems: createDefaultRegistry({ lore }), newSeed: () => 'sq' });
    const events: ServerEvent[] = [];
    session.on((e) => events.push(e));
    await session.handle({ type: 'new_game', hero: hero(), mode: 'heroic' });
    const buttons = () => {
      const e = events.filter((x) => x.type === 'suggestions').at(-1);
      return e?.type === 'suggestions' ? e.actions : [];
    };
    expect(buttons().map((b) => b.id)).toContain('sq:look');
    await session.handle({ type: 'choose', actionId: 'sq:look' });
    const take = buttons().find((b) => b.id.startsWith('sq:take:'));
    expect(take).toBeDefined();
    expect(buttons().map((b) => b.id)).not.toContain('sq:look');

    await session.handle({ type: 'choose', actionId: take!.id });
    const sqId = take!.id.slice('sq:take:'.length);
    expect(getProgress(session.current)?.adventureId).toBe(sqId);
    expect(buttons().map((b) => b.id)).toContain('accept');

    // Play it: accept, go, resolve, come back, claim.
    await session.handle({ type: 'choose', actionId: 'accept' });
    await session.handle({ type: 'choose', actionId: 'exit.go' });
    session.current.flags[`side.${sqId}.resolved`] = true;
    await session.handle({ type: 'choose', actionId: 'exit.leave' });
    await session.handle({ type: 'choose', actionId: 'claim' });
    expect(events.some((e) => e.type === 'log' && e.entry.text.startsWith('Job complete:'))).toBe(true);
    expect(getProgress(session.current)?.adventureId).toBe(adventure.id);
    expect(session.current.location.sceneId).toBe('millbrook_square');
    expect(buttons().map((b) => b.id)).toContain('talk_mayor');
  });
});
