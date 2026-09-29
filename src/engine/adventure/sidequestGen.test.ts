import { describe, expect, it } from 'vitest';
import flagsJson from '../../../data/adventures/flags.json';
import tablesJson from '../../../data/tables/sidequests.json';
import loreJson from '../../../data/world/lore.json';
import { buildCharacter } from '../character/builder';
import { toBuildInput } from '../character/creator';
import { quickBuild } from '../character/quickBuild';
import { Rng } from '../core/rng';
import { loadSrd } from '../data/srdBundle';
import { newGameState } from '../session/GameSession';
import { FlagRegistry } from '../world/flags';
import { LoreSchema } from '../world/lore';
import { availableActions, getProgress, perform, resolveEncounter, startAdventure, type RunContext } from './runner';
import { generateSideQuest, openThreads, questDc, threadDoneFlag } from './sidequestGen';
import { SideQuestTablesSchema } from './sidequestTables';
import { validateAdventure } from './validate';

const db = loadSrd();
const lore = LoreSchema.parse(loreJson);
const tables = SideQuestTablesSchema.parse(tablesJson);
const registry = FlagRegistry.fromJson(flagsJson);

function state(level = 1, seed = 'sq') {
  const hero = buildCharacter(toBuildInput(quickBuild('fighter', db, Rng.fromSeed('f'))), db);
  hero.classes[0]!.level = level;
  return newGameState(hero, 'heroic', seed);
}

const gen = (s = state(), seed: number | string = 1, locationId = 'millbrook', threadChance?: number) =>
  generateSideQuest({ tables, lore, db, state: s, rng: Rng.fromSeed(seed), locationId, flags: registry, ...(threadChance !== undefined && { threadChance }) });

describe('generateSideQuest', () => {
  it('produces valid adventures across regions, levels and seeds', () => {
    const places = ['millbrook', 'ravensgate', 'port_sorrel', 'highcrown', 'hollowmere', 'gullhaven'];
    for (let i = 0; i < 60; i++) {
      const level = 1 + (i % 12);
      const q = gen(state(level), i, places[i % places.length]!);
      const r = validateAdventure(q.adventure, db, registry);
      expect(r.errors, `seed ${i}: ${q.questType}`).toEqual([]);
      expect(r.adventure!.kind).toBe('side_quest');
      expect(r.adventure!.levelRange[0]).toBe(level);
    }
  });

  it('is deterministic for the same seed', () => {
    expect(gen(state(), 42).adventure).toEqual(gen(state(), 42).adventure);
    expect(gen(state(), 42).adventure).not.toEqual(gen(state(), 43).adventure);
  });

  it('uses region-appropriate sites and foes and sizes the fight to the hero level', () => {
    const q = gen(state(3), 7, 'gullhaven', 0);
    const adv = validateAdventure(q.adventure, db).adventure!;
    expect(adv.regionId).toBe('brinescatter_isles');
    const xp = adv.encounters[0]!.monsters.reduce((s, m) => s + db.monsters.get(m.id)!.xp * m.count, 0);
    // Moderate budget for a level-3 hero (SRD 2024 table).
    expect(xp).toBeLessThanOrEqual(db.tables!.encounterBudget[2]![1]);
    expect(questDc(3)).toBe(12);
    expect(questDc(7)).toBe(15);
  });
});

describe('woven-in threads', () => {
  it('offers only threads whose flags are set, preferring local ones, and never a resolved one', () => {
    const s = state();
    expect(openThreads({ tables, state: s, flags: registry })).toEqual([]);
    s.flags['arc.starter.ashby_fate'] = 'escaped';
    s.flags['world.player_outlawed'] = true;
    expect(openThreads({ tables, state: s, flags: registry }).map((t) => t.id).sort()).toEqual(['sextons_return', 'wanted']);
    const q = gen(s, 5, 'ravensgate', 1);
    expect(['sextons_return', 'wanted']).toContain(q.threadId);
    expect(JSON.stringify(q.adventure)).toContain(q.threadId === 'wanted' ? 'bounty hunters' : 'Brother Ashby');
    // Hollowmere is local to neither thread → falls back to the region's, then any open thread.
    expect(['sextons_return', 'wanted']).toContain(gen(s, 5, 'hollowmere', 1).threadId);
    s.flags[threadDoneFlag('sextons_return')] = true;
    expect(openThreads({ tables, state: s, flags: registry }).map((t) => t.id)).toEqual(['wanted']);
  });

  it('writes the thread consequences back to world flags when the quest is completed', () => {
    const s = state(2);
    s.flags['arc.starter.ashby_fate'] = 'escaped';
    const q = gen(s, 11, 'brightwater', 1);
    expect(q.threadId).toBe('sextons_return');
    const adv = validateAdventure(q.adventure, db, registry).adventure!;
    const ctx: RunContext = { state: s, adventure: adv, rng: Rng.fromSeed(3), db, flags: registry, lore };
    startAdventure(ctx);
    perform(ctx, 'accept');
    perform(ctx, 'exit.go');
    // Resolve the climax whatever shape it took.
    const ids = availableActions(ctx).map((a) => a.id);
    if (ids.includes('confront')) resolveEncounter(ctx, 'fight', 'win');
    else s.flags[`side.${adv.id}.resolved`] = true;
    perform(ctx, 'exit.leave');
    const coins = s.hero.coins;
    const end = perform(ctx, 'claim');
    expect(end.ending).toBe('done');
    expect(s.hero.coins).toBeGreaterThan(coins);
    expect(s.flags['arc.starter.ashby_fate']).toBe('captured');
    expect(s.flags[threadDoneFlag('sextons_return')]).toBe(true);
    expect(s.extensions.reputation).toMatchObject({ crown_of_aurelmark: expect.any(Number) });
    expect(getProgress(s)?.ending).toBe('done');
  });
});
