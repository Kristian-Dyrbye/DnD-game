import { describe, expect, it } from 'vitest';
import flagsJson from '../../../data/adventures/flags.json';
import tablesJson from '../../../data/tables/sidequests.json';
import loreJson from '../../../data/world/lore.json';
import { loadSrd } from '../data/srdBundle';
import { FlagRegistry } from '../world/flags';
import { LoreSchema } from '../world/lore';
import { flagsRead } from './conditions';
import { SideQuestTablesSchema } from './sidequestTables';

const db = loadSrd();
const lore = LoreSchema.parse(loreJson);
const t = SideQuestTablesSchema.parse(tablesJson);
const regions = new Set(lore.regions.map((r) => r.id));
const registry = FlagRegistry.fromJson(flagsJson);

describe('side-quest tables', () => {
  it('antagonists use SRD monsters and real regions; every region has sites and foes', () => {
    for (const a of t.antagonists) {
      for (const m of [a.leader, ...a.minions]) expect(db.monsters.has(m), `${a.id}: ${m}`).toBe(true);
      for (const r of a.regions) expect(regions.has(r), `${a.id}: ${r}`).toBe(true);
      expect(a.levels[0]).toBeLessThanOrEqual(a.levels[1]);
    }
    for (const s of t.sites) for (const r of s.regions) expect(regions.has(r), `${s.id}: ${r}`).toBe(true);
    for (const r of regions) {
      expect(t.antagonists.some((a) => a.regions.includes(r)), r).toBe(true);
      expect(t.sites.some((s) => s.regions.includes(r)), r).toBe(true);
    }
  });

  it('every quest type can be built in every region (a site and an antagonist of the right kinds)', () => {
    for (const q of t.questTypes) {
      for (const r of regions) {
        const site = t.sites.some((s) => q.siteKinds.includes(s.kind) && s.regions.includes(r));
        const foe = t.antagonists.some((a) => q.antagonistKinds.includes(a.kind) && a.regions.includes(r));
        expect(site && foe, `${q.id} in ${r}`).toBe(true);
      }
    }
  });

  it('reward tiers cover levels 1–20', () => {
    for (let lvl = 1; lvl <= 20; lvl++) expect(t.rewards.itemRarityByLevel.some((b) => lvl >= b.levels[0] && lvl <= b.levels[1]), `level ${lvl}`).toBe(true);
    expect(t.rewards.goldPerLevel.min).toBeLessThanOrEqual(t.rewards.goldPerLevel.max);
  });

  it('threads match the campaign bible: registry flags, valid write-backs, known places, quest types and foes', () => {
    expect(t.threads).toHaveLength(15);
    const types = new Set(t.questTypes.map((q) => q.id));
    const foes = new Set(t.antagonists.map((a) => a.id));
    for (const th of t.threads) {
      expect(types.has(th.questType), th.id).toBe(true);
      expect(foes.has(th.antagonist), th.id).toBe(true);
      for (const l of th.locations) expect(lore.locations.some((x) => x.id === l), `${th.id}: ${l}`).toBe(true);
      for (const f of flagsRead(th.if)) expect(registry.has(f), `${th.id} reads ${f}`).toBe(true);
      for (const w of th.writeBack.flags) {
        const id = 'set' in w ? w.set : 'inc' in w ? w.inc : w.clear;
        expect(registry.has(id), `${th.id} writes ${id}`).toBe(true);
        if ('set' in w) expect(registry.checkValue(id, w.value), `${th.id} ${id}`).toBeUndefined();
      }
      for (const r of th.writeBack.reputation) expect(lore.factions.some((f) => f.id === r.faction), `${th.id}: ${r.faction}`).toBe(true);
    }
  });
});
