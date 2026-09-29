import { describe, expect, it } from 'vitest';
import companionsJson from '../../../data/companions.json';
import demo from '../../../data/adventures/demo/millbrook_demo.json';
import loreJson from '../../../data/world/lore.json';
import type { ServerEvent } from '../../shared/protocol';
import { scaleMonsters } from '../adventure/encounters';
import { adventureActionPort } from '../adventure/sessionActions';
import { validateAdventure } from '../adventure/validate';
import { buildCharacter } from '../character/builder';
import { toBuildInput } from '../character/creator';
import { validateBuild } from '../character/builder';
import { quickBuild } from '../character/quickBuild';
import { totalLevel } from '../core/creature';
import { Rng } from '../core/rng';
import { loadSrd } from '../data/srdBundle';
import { GameSession, newGameState } from '../session/GameSession';
import { LoreSchema } from '../world/lore';
import { autoLevelTo, buildCompanion, CompanionRosterSchema, companionStatus, levelCompanionsWithHero, MAX_COMPANIONS, partWithCompanion, recruitCompanion } from './companions';

const db = loadSrd();
const lore = LoreSchema.parse(loreJson);
const roster = CompanionRosterSchema.parse(companionsJson);
const def = (id: string) => roster.companions.find((c) => c.id === id)!;
const hero = (level = 1) => {
  const h = buildCharacter(toBuildInput(quickBuild('fighter', db, Rng.fromSeed('h'))), db);
  return level > 1 ? autoLevelTo(h, level, db) : h;
};

describe('companion sheets', () => {
  it('every roster companion builds as a valid SRD character with the design build', () => {
    for (const d of roster.companions) {
      const c = buildCompanion(d, 1, db);
      expect(c.id).toBe(d.id);
      expect(c.name).toBe(d.name);
      expect(c.classes[0]!.classId).toBe(d.classId);
      expect(c.speciesId).toBe(d.species);
      expect(c.backgroundId).toBe(d.background);
      expect(c.hp).toBeGreaterThan(0);
    }
    const s = quickBuild('rogue', db, Rng.fromSeed('x'), { species: 'tiefling', background: 'criminal', lineage: 'infernal' });
    expect(validateBuild(toBuildInput(s), db)).toEqual([]);
  });

  it('levels with automatic choices (subclass from the roster, ASI, spells)', () => {
    const nettle = buildCompanion(def('nettle'), 5, db);
    expect(totalLevel(nettle)).toBe(5);
    expect(nettle.classes[0]!.subclassId).toBe('circle_of_the_land');
    expect(nettle.spellcasting?.prepared.length).toBeGreaterThan(4);
    const corwin = buildCompanion(def('corwin'), 4, db);
    expect(corwin.classes[0]!.subclassId).toBe('oath_of_devotion');
    expect(corwin.abilities.str).toBeGreaterThan(buildCompanion(def('corwin'), 1, db).abilities.str);
  });
});

describe('recruiting', () => {
  it('joins at the hero level, up to three; the fourth waits; parting keeps the sheet', () => {
    const s = newGameState(hero(3), 'heroic', 1);
    expect(recruitCompanion(s, def('corwin'), db)).toMatchObject({ joined: true });
    expect(totalLevel(s.companions[0]!)).toBe(3);
    expect(s.flags['world.corwin_status']).toBe('in_party');
    expect(s.flags['world.corwin_loyalty']).toBe(50);
    expect(recruitCompanion(s, def('corwin'), db)).toMatchObject({ joined: false, message: 'Ser Corwin Ashvale is already with you.' });
    recruitCompanion(s, def('nettle'), db);
    recruitCompanion(s, def('rook'), db);
    expect(s.companions).toHaveLength(MAX_COMPANIONS);
    expect(recruitCompanion(s, def('aurek'), db)).toMatchObject({ waiting: true });
    expect(companionStatus(s, def('aurek'))).toBe('waiting');
    partWithCompanion(s, def('rook'), 'left');
    expect(s.companions.map((c) => c.id)).toEqual(['corwin', 'nettle']);
    expect((s.extensions.companionSheets as Record<string, unknown>).rook).toBeDefined();
    expect(recruitCompanion(s, def('aurek'), db).joined).toBe(true);
  });

  it('companions level with the hero', () => {
    const s = newGameState(hero(1), 'heroic', 1);
    recruitCompanion(s, def('nettle'), db);
    s.hero = autoLevelTo(s.hero, 3, db);
    expect(levelCompanionsWithHero(s, roster, db)).toEqual(['Nettle reaches level 3.']);
    expect(totalLevel(s.companions[0]!)).toBe(3);
  });

  it('adventure outcomes recruit and the companion fights alongside', async () => {
    const raw = structuredClone(demo) as unknown as { chapters: { scenes: { id: string; actions: Record<string, unknown>[] }[] }[] };
    raw.chapters[0]!.scenes[0]!.actions.push({ id: 'hire', label: 'Hire the retired knight', once: true, outcome: { text: 'Corwin nods.', recruit: 'corwin' } });
    const adventure = validateAdventure(raw, db).adventure!;
    const session = new GameSession({ actions: adventureActionPort(new Map([[adventure.id, adventure]]), adventure.id, db, { lore, companions: roster }), newSeed: () => 'c' });
    const events: ServerEvent[] = [];
    session.on((e) => events.push(e));
    await session.handle({ type: 'new_game', hero: hero(), mode: 'heroic' });
    await session.handle({ type: 'choose', actionId: 'hire' });
    expect(session.current.companions.map((c) => c.id)).toEqual(['corwin']);
    expect(events.some((e) => e.type === 'log' && e.entry.text === 'Ser Corwin Ashvale joins your party.')).toBe(true);
    await session.handle({ type: 'choose', actionId: 'talk_mayor' });
    await session.handle({ type: 'choose', actionId: 'exit.to_mill' });
    await session.handle({ type: 'choose', actionId: 'exit.unlock' });
    const fight = session.current.extensions.combat as { enc: { state: { creatures: Record<string, unknown> } } };
    expect(Object.keys(fight.enc.state.creatures)).toContain('corwin');
  });
});

describe('encounter scaling', () => {
  it('trims minions above the High budget, never the boss, and fills from the pool below Low', () => {
    const tables = db.tables!;
    const big = scaleMonsters([{ id: 'bandit_captain', count: 1 }, { id: 'bandit', count: 8 }], [1], db, tables, { bossIds: ['bandit_captain'] });
    expect(big.find((m) => m.id === 'bandit_captain')?.count).toBe(1);
    expect((big.find((m) => m.id === 'bandit')?.count ?? 0)).toBeLessThan(8);
    const small = scaleMonsters([{ id: 'rat', count: 1 }], [5, 5], db, tables, { pool: ['goblin_warrior'] });
    expect(small.find((m) => m.id === 'goblin_warrior')?.count).toBeGreaterThan(0);
    expect(scaleMonsters([{ id: 'giant_rat', count: 2 }], [1], db, tables)).toEqual([{ id: 'giant_rat', count: 2 }]);
  });
});

describe('automatic Ability Score Improvements', () => {
  it('always spend the full +2 without passing 20', async () => {
    const { asiIncreases } = await import('./companions');
    const base = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
    expect(asiIncreases({ ...base, str: 16 }, ['str', 'con'])).toEqual({ str: 2 });
    expect(asiIncreases({ ...base, str: 19 }, ['str', 'con'])).toEqual({ str: 1, con: 1 }); // the old code gave only con +1
    expect(asiIncreases({ ...base, str: 20, con: 20 }, ['str', 'con'])).toEqual({ dex: 1, wis: 1 });
  });
});
