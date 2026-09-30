import { describe, expect, it } from 'vitest';
import demo from '../../../data/adventures/demo/millbrook_demo.json';
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
import { checkSideQuest, generateValidSideQuest } from './sidequestCheck';
import { generateSideQuest } from './sidequestGen';
import { SideQuestTablesSchema } from './sidequestTables';
import { availableActions, getProgress, perform, resolveEncounter, startAdventure } from './runner';
import { clonePlain, LuckyRng, solveAdventure } from './solver';
import { validateAdventure } from './validate';

const db = loadSrd();
const lore = LoreSchema.parse(loreJson);
const tables = SideQuestTablesSchema.parse(tablesJson);
const flags = FlagRegistry.fromJson(flagsJson);

function state(level = 2) {
  const hero = buildCharacter(toBuildInput(quickBuild('rogue', db, Rng.fromSeed('r'))), db);
  hero.classes[0]!.level = level;
  return newGameState(hero, 'heroic', 'check');
}
const opts = (level = 2) => ({ tables, lore, db, state: state(level), flags, locationId: 'millbrook' });

describe('solver', () => {
  it('LuckyRng always rolls the maximum', () => {
    const r = new LuckyRng();
    expect(r.int(1, 20)).toBe(20);
    expect(r.int(1, 6)).toBe(6);
  });

  it('finds a winning path through the demo adventure', () => {
    const adventure = validateAdventure(structuredClone(demo), db).adventure!;
    const res = solveAdventure({ state: state(), adventure, db }, 'rats_cleared');
    expect(res.ok).toBe(true);
    expect(res.path!.at(-1)).toBe('claim_reward'); // shortest path: force the door with a lucky roll
  });

  it('reports an ending no path can reach', () => {
    const raw = structuredClone(demo) as unknown as { chapters: { scenes: { id: string; exits: { if?: unknown }[] }[] }[] };
    // Lock the only way out of the square behind a flag nothing sets.
    raw.chapters[0]!.scenes[0]!.exits[0]!.if = { flag: '~never' };
    const adventure = validateAdventure(raw, db).adventure!;
    const res = solveAdventure({ state: state(), adventure, db }, 'rats_cleared');
    expect(res).toMatchObject({ ok: false, reason: 'ending "rats_cleared" is unreachable' });
  });

  it('leaves the base state untouched and returns a path that replays', () => {
    const adventure = validateAdventure(structuredClone(demo), db).adventure!;
    const base = state();
    const before = JSON.stringify(base);
    const res = solveAdventure({ state: base, adventure, db }, 'rats_cleared');
    expect(JSON.stringify(base)).toBe(before);
    const c = { state: structuredClone(base), adventure, db, rng: new LuckyRng() };
    startAdventure(c);
    for (const id of res.path!) {
      let r = perform(c, id);
      for (let g = 0; r.encounter && g < 5; g++) r = resolveEncounter(c, r.encounter, 'win');
    }
    expect(getProgress(c.state)?.ending).toBe('rats_cleared');
  });

  it('clonePlain deep-copies plain data', () => {
    const src = { a: [1, { b: 'x' }], n: null, s: new Set([1]), o: { deep: { v: true } } };
    const copy = clonePlain(src);
    expect(copy).toEqual(src);
    expect(copy.a[1]).not.toBe(src.a[1]);
    expect(copy.o.deep).not.toBe(src.o.deep);
    expect(copy.s).not.toBe(src.s);
    expect([...copy.s]).toEqual([1]);
  });
});

describe('runner: perform checks only the chosen action', () => {
  it('refuses unknown, used-up and gated actions like availableActions does', () => {
    const adventure = validateAdventure(structuredClone(demo), db).adventure!;
    const c = { state: state(), adventure, db, rng: new LuckyRng() };
    startAdventure(c);
    expect(() => perform(c, 'no_such_action')).toThrow(/not possible/);
    expect(() => perform(c, 'exit.no_such_exit')).toThrow(/not possible/);
    expect(() => perform(c, 'no_poi.look')).toThrow(/not possible/);
    const offered = availableActions(c).map((a) => a.id);
    expect(offered.length).toBeGreaterThan(0);
    const onceId = adventure.chapters[0]!.scenes[0]!.actions.find((a) => a.once && offered.includes(a.id))?.id;
    if (onceId) {
      perform(c, onceId);
      expect(availableActions(c).map((a) => a.id)).not.toContain(onceId);
      expect(() => perform(c, onceId)).toThrow(/not possible/);
    }
  });
});

describe('checkSideQuest', () => {
  it('accepts well-formed generated quests', () => {
    let ok = 0;
    for (let i = 0; i < 25; i++) {
      const q = generateSideQuest({ ...opts(1 + (i % 8)), rng: Rng.fromSeed(i) });
      const c = checkSideQuest(q, opts(1 + (i % 8)));
      if (c.ok) ok++;
      else expect(c.problems.length).toBeGreaterThan(0);
    }
    expect(ok).toBeGreaterThanOrEqual(20);
  });

  it('rejects deadly fights, impossible checks, locked flags and unwinnable quests', () => {
    const q = generateSideQuest({ ...opts(1), rng: Rng.fromSeed(3), threadChance: 0 });
    const adv = q.adventure as { encounters: { monsters: { id: string; count: number }[] }[]; chapters: { scenes: { id: string; actions: Record<string, unknown>[]; exits: Record<string, unknown>[] }[] }[]; id: string };
    adv.encounters[0]!.monsters = [{ id: 'adult_red_dragon', count: 1 }];
    const site = adv.chapters[0]!.scenes.find((s) => s.id === 'site')!;
    site.actions.push({ id: 'impossible', label: 'Impossible', check: { skill: 'arcana', dc: 30 } });
    const offer = adv.chapters[0]!.scenes.find((s) => s.id === 'offer')!;
    offer.exits[0]!.if = { flag: '~never_set' };
    const c = checkSideQuest(q, opts(1));
    expect(c.ok).toBe(false);
    expect(c.problems).toEqual(
      expect.arrayContaining([
        'encounter fight is deadly for a level 1 hero',
        'arcana DC 30 is impossible for this hero',
        `flag side.${adv.id}.never_set is read but never set`,
        'unwinnable: ending "done" is unreachable',
      ]),
    );
  });
});

describe('generateValidSideQuest', () => {
  it('regenerates until a quest passes, deterministically', () => {
    const a = generateValidSideQuest({ ...opts(3), rng: Rng.fromSeed(9) });
    const b = generateValidSideQuest({ ...opts(3), rng: Rng.fromSeed(9) });
    expect(a).toBeDefined();
    expect(a!.adventure).toEqual(b!.adventure);
    expect(a!.attempts).toBeGreaterThanOrEqual(1);
    expect(a!.rejected).toHaveLength(a!.attempts - 1);
  });

  it('gives up (undefined) after the attempt limit when every quest is broken', () => {
    const broken = { ...tables, antagonists: tables.antagonists.map((x) => ({ ...x, leader: 'tarrasque', minions: [] })) };
    expect(generateValidSideQuest({ ...opts(1), tables: broken, rng: Rng.fromSeed(1), attempts: 3 })).toBeUndefined();
  });
});
