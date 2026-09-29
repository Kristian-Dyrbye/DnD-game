import { describe, expect, it } from 'vitest';
import lore from '../../../data/world/lore.json';
import {
  LoreSchema,
  REGION_TONES,
  factionRelation,
  locationById,
  regionById,
  regionOfLocation,
  routesFrom,
  type Lore,
} from './lore';

const parsed = LoreSchema.safeParse(lore);
const data = (parsed.success ? parsed.data : lore) as Lore;

function duplicates(ids: string[]): string[] {
  return ids.filter((id, i) => ids.indexOf(id) !== i);
}

describe('world/lore.json', () => {
  it('parses with LoreSchema', () => {
    expect(parsed.error?.issues ?? []).toEqual([]);
    expect(parsed.success).toBe(true);
  });

  it('has unique ids in every collection', () => {
    expect(duplicates(data.regions.map((r) => r.id))).toEqual([]);
    expect(duplicates(data.history.map((h) => h.id))).toEqual([]);
    expect(duplicates(data.gods.map((g) => g.id))).toEqual([]);
    expect(duplicates(data.factions.map((f) => f.id))).toEqual([]);
    expect(duplicates(data.locations.map((l) => l.id))).toEqual([]);
    expect(duplicates(data.calendar.months.map((m) => m.id))).toEqual([]);
    expect(duplicates(data.calendar.weekdays.map((w) => w.id))).toEqual([]);
  });

  it('has exactly 3 regions covering the three tones', () => {
    expect(data.regions).toHaveLength(3);
    expect(data.regions.map((r) => r.tone).sort()).toEqual([...REGION_TONES].sort());
  });

  it('resolves every cross-reference', () => {
    const regions = new Set(data.regions.map((r) => r.id));
    const factions = new Set(data.factions.map((f) => f.id));
    const gods = new Set(data.gods.map((g) => g.id));
    const locations = new Set(data.locations.map((l) => l.id));
    const bad: string[] = [];
    for (const g of data.gods) for (const r of g.favoredRegionIds) if (!regions.has(r)) bad.push(`god ${g.id} → ${r}`);
    for (const f of data.factions) {
      if (!regions.has(f.homeRegionId)) bad.push(`faction ${f.id} home → ${f.homeRegionId}`);
      if (f.godId !== undefined && !gods.has(f.godId)) bad.push(`faction ${f.id} god → ${f.godId}`);
      for (const other of Object.keys(f.relationships)) {
        if (!factions.has(other)) bad.push(`faction ${f.id} relation → ${other}`);
        if (other === f.id) bad.push(`faction ${f.id} relates to itself`);
      }
    }
    for (const l of data.locations) {
      if (!regions.has(l.regionId)) bad.push(`location ${l.id} region → ${l.regionId}`);
      for (const f of l.factionIds) if (!factions.has(f)) bad.push(`location ${l.id} faction → ${f}`);
    }
    for (const r of data.routes) {
      if (!locations.has(r.from)) bad.push(`route from ${r.from}`);
      if (!locations.has(r.to)) bad.push(`route to ${r.to}`);
      if (r.from === r.to) bad.push(`route loops at ${r.from}`);
    }
    expect(bad).toEqual([]);
  });

  it('has symmetric faction relationships', () => {
    const bad: string[] = [];
    for (const f of data.factions) {
      for (const [other, rel] of Object.entries(f.relationships)) {
        if (factionRelation(data, other, f.id) !== rel) bad.push(`${f.id} ↔ ${other}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('has at least 5 locations per region, placed inside the region bounds', () => {
    for (const region of data.regions) {
      const locs = data.locations.filter((l) => l.regionId === region.id);
      expect(locs.length, region.id).toBeGreaterThanOrEqual(5);
      const b = region.mapBounds;
      for (const l of locs) {
        const inside =
          l.mapPos.x >= b.x && l.mapPos.x <= b.x + b.width && l.mapPos.y >= b.y && l.mapPos.y <= b.y + b.height;
        expect(inside, `${l.id} inside ${region.id}`).toBe(true);
      }
    }
  });

  it('has a connected route graph with no duplicate links', () => {
    const keys = data.routes.map((r) => [r.from, r.to].sort().join('|'));
    expect(duplicates(keys)).toEqual([]);
    const first = data.locations[0]?.id ?? '';
    const seen = new Set([first]);
    const queue = [first];
    while (queue.length > 0) {
      const cur = queue.shift() ?? '';
      for (const r of routesFrom(data, cur)) {
        const next = r.from === cur ? r.to : r.from;
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    expect(data.locations.filter((l) => !seen.has(l.id)).map((l) => l.id)).toEqual([]);
  });

  it('meets the content requirements for factions', () => {
    for (const region of data.regions) {
      expect(data.factions.some((f) => f.homeRegionId === region.id), region.id).toBe(true);
    }
    expect(data.factions.some((f) => f.kind === 'pirate_crew')).toBe(true);
    // A villainous cult present in every region (campaign hook).
    const cult = data.factions.find((f) => f.kind === 'cult');
    expect(cult).toBeDefined();
    const cultRegions = new Set(
      data.locations.filter((l) => cult && l.factionIds.includes(cult.id)).map((l) => l.regionId),
    );
    expect(cultRegions.size).toBe(3);
    // Cross-region tension: some hostility between factions of different home regions.
    const crossHostile = data.factions.some((f) =>
      Object.entries(f.relationships).some(
        ([o, rel]) => rel === 'hostile' && data.factions.find((x) => x.id === o)?.homeRegionId !== f.homeRegionId,
      ),
    );
    expect(crossHostile).toBe(true);
  });

  it('has a consistent calendar', () => {
    const c = data.calendar;
    expect(c.daysPerYear).toBe(360);
    expect(c.months.length * c.daysPerMonth).toBe(c.daysPerYear);
    for (const s of ['spring', 'summer', 'autumn', 'winter']) {
      expect(c.months.filter((m) => m.season === s)).toHaveLength(3);
    }
  });

  it('has 1 starting location', () => {
    expect(data.locations.filter((l) => l.tags.includes('starting_location'))).toHaveLength(1);
  });
});

describe('lore helpers', () => {
  it('looks up regions and locations', () => {
    expect(regionById(data, 'gloamfen')?.tone).toBe('dark_fantasy');
    expect(regionById(data, 'nowhere')).toBeUndefined();
    expect(locationById(data, 'highcrown')?.kind).toBe('city');
    expect(regionOfLocation(data, 'gullhaven')?.id).toBe('brinescatter_isles');
    expect(regionOfLocation(data, 'nowhere')).toBeUndefined();
  });

  it('computes faction relations with neutral default', () => {
    expect(factionRelation(data, 'crown_of_aurelmark', 'red_gull_brotherhood')).toBe('hostile');
    expect(factionRelation(data, 'red_gull_brotherhood', 'tidewright_guild')).toBe('allied');
    expect(factionRelation(data, 'briarkin', 'tidewright_guild')).toBe('neutral');
    expect(factionRelation(data, 'briarkin', 'briarkin')).toBe('allied');
    expect(factionRelation(data, 'unknown', 'briarkin')).toBe('neutral');
  });

  it('lists routes touching a location in both directions', () => {
    const ids = routesFrom(data, 'gullhaven').map((r) => (r.from === 'gullhaven' ? r.to : r.from));
    expect(ids).toEqual(expect.arrayContaining(['port_sorrel', 'fennicks_rest', 'wreckers_cove']));
  });
});
