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
import companionsJson from '../../../data/companions.json';
import { generateSideQuest, openThreads, questDc, threadDoneFlag } from './sidequestGen';
import { LuckyRng } from './solver';
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
    perform(ctx, `decide_${q.outcomes[0]}`);
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

describe('A137: approaches and outcome variants', () => {
  const companionIds = new Set(companionsJson.companions.map((c) => c.id));
  // One quest type at a time, no threads, no ambush/deadline (so the site's choices are all open on arrival).
  const only = (type: string) => ({
    ...tables,
    questTypes: tables.questTypes.filter((q) => q.id === type),
    complications: tables.complications.filter((c) => c.effect !== 'ambush' && c.effect !== 'deadline'),
    threads: [],
  });
  function arrive(type: string, rng: Rng = new LuckyRng(), s = state(3)) {
    s.hero.coins = 100_000;
    const q = generateSideQuest({ tables: only(type), lore, db, state: s, rng: Rng.fromSeed(type), locationId: 'millbrook', flags: registry, threadChance: 0 });
    const adv = validateAdventure(q.adventure, db, registry).adventure!;
    const ctx: RunContext = { state: s, adventure: adv, rng, db, flags: registry, lore };
    startAdventure(ctx);
    perform(ctx, 'accept');
    perform(ctx, 'exit.go');
    const f = (name: string) => s.flags[`side.${adv.id}.${name}`];
    return { q, adv, ctx, s, f, ids: () => availableActions(ctx).map((a) => a.id) };
  }

  it('every quest type offers ≥ 3 kinds of approach and ≥ 2 outcomes, with known approval tags', () => {
    for (const t of tables.questTypes) {
      expect(new Set([...t.approaches.map((a) => a.kind), ...(t.fight ? [] : ['fight'])]).size, t.id).toBeGreaterThanOrEqual(3);
      expect(t.outcomes.length, t.id).toBeGreaterThanOrEqual(2);
      if (t.fight) expect(t.approaches.some((a) => a.kind === 'fight'), t.id).toBe(true);
      for (const o of t.outcomes) for (const tag of o.tags) expect(tables.approvalTags[tag], `${t.id}.${o.id}: ${tag}`).toBeDefined();
    }
    for (const list of Object.values(tables.approvalTags)) for (const a of list) expect(companionIds.has(a.companion)).toBe(true);
  });

  it('each approach resolves the job its own way; the exit waits for a decision', () => {
    for (const t of tables.questTypes) {
      const { q, ids } = arrive(t.id);
      expect(q.approaches.length, t.id).toBeGreaterThanOrEqual(3);
      const offered = ids();
      for (const id of q.approaches.filter((x) => x !== 'force')) expect(offered, `${t.id}: ${id}`).toContain(id);
      for (const id of q.approaches.filter((x) => x !== 'confront' && x !== 'force')) {
        const a = arrive(t.id);
        const coins = a.s.hero.coins;
        const r = perform(a.ctx, id);
        expect(r.encounter, `${t.id}: ${id}`).toBeUndefined();
        expect(a.f('resolved'), `${t.id}: ${id}`).toBe(true);
        expect(a.f(`by_${id.replace(/_\d+$/, '')}`)).toBe(true);
        if (id === 'bribe') expect(a.s.hero.coins).toBe(coins - tables.rewards.bribePerLevel * 3 * 100);
        if (id === 'sneak' || id === 'trick') expect(r.approvals).toEqual(tables.approvalTags.clever);
        expect(a.ids()).not.toContain('exit.leave');
        expect(a.ids().filter((x) => x.startsWith('decide_'))).toEqual(q.outcomes.map((o) => `decide_${o}`));
      }
    }
  });

  it('a failed check starts the fight in fight jobs and is a setback (then force/give up) in the others', () => {
    const fail = Rng.fromSeed('x');
    fail.next = () => 0; // every d20 is a 1
    const hunt = arrive('hunt_fugitive', fail);
    expect(perform(hunt.ctx, 'sneak').encounter).toBe('fight');
    const inv = arrive('investigate', fail);
    expect(perform(inv.ctx, 'skill').encounter).toBeUndefined();
    expect(inv.f('setback')).toBe(true);
    expect(inv.ids()).toContain('force');
    perform(inv.ctx, 'exit.leave');
    expect(inv.ids()).toContain('give_up');
  });

  it('each outcome variant ends the job with its own pay, reputation and approval', () => {
    for (const t of tables.questTypes) {
      const results = t.outcomes.map((o, i) => {
        const a = arrive(t.id);
        const first = a.q.approaches.find((x) => x !== 'confront' && x !== 'bribe')!;
        perform(a.ctx, first);
        const coins = a.s.hero.coins;
        const d = perform(a.ctx, `decide_${o.id}`);
        expect(d.approvals ?? [], `${t.id}.${o.id}`).toEqual(o.tags.flatMap((tag) => tables.approvalTags[tag] ?? []));
        perform(a.ctx, 'exit.leave');
        const claims = a.ids().filter((x) => x === 'claim' || x.startsWith('claim_'));
        expect(claims, `${t.id}.${o.id}`).toEqual([i === 0 ? 'claim' : `claim_${o.id}`]);
        const end = perform(a.ctx, claims[0]!);
        expect(end.ending).toBe('done');
        const patronFaction = lore.locations.find((l) => l.id === 'millbrook')!.factionIds[0]!;
        const rep = (a.s.extensions.reputation as Record<string, number> | undefined)?.[patronFaction] ?? 0;
        return { o, paid: a.s.hero.coins - coins, rep };
      });
      for (const r of results) {
        if (r.o.goldMul === 0) expect(r.paid, `${t.id}.${r.o.id}`).toBe(0);
        else expect(r.paid).toBeGreaterThan(0);
      }
      const honest = results[0]!;
      for (const r of results.slice(1)) if (r.o.repMul < 0) expect(r.rep, `${t.id}.${r.o.id}`).toBeLessThan(honest.rep);
    }
  });

  it('outcomes without write-back leave the thread\'s world flags alone', () => {
    const s = state(2);
    s.flags['arc.starter.ashby_fate'] = 'escaped';
    const q = gen(s, 11, 'brightwater', 1);
    expect(q.threadId).toBe('sextons_return');
    expect(q.outcomes).toContain('let_go');
    const adv = validateAdventure(q.adventure, db, registry).adventure!;
    const ctx: RunContext = { state: s, adventure: adv, rng: new LuckyRng(), db, flags: registry, lore };
    startAdventure(ctx);
    perform(ctx, 'accept');
    const r = perform(ctx, 'exit.go');
    if (r.encounter) resolveEncounter(ctx, 'fight', 'win');
    else perform(ctx, 'talk');
    perform(ctx, 'decide_let_go');
    expect(s.flags[`side.${adv.id}.spared`]).toBe(true);
    perform(ctx, 'exit.leave');
    expect(perform(ctx, 'claim_let_go').ending).toBe('done');
    expect(s.flags['arc.starter.ashby_fate']).toBe('escaped');
    expect(s.flags[threadDoneFlag('sextons_return')]).toBe(true);
  });
});
