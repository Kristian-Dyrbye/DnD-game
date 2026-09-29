import { describe, expect, it } from 'vitest';
import { loadSrd } from './srdBundle';

const db = loadSrd();

describe('equipment data', () => {
  it('has all SRD weapons with mastery', () => {
    expect(db.weapons.size).toBe(38);
    expect(db.weapons.get('longsword')).toMatchObject({ damage: { dice: '1d8', type: 'slashing' }, versatileDice: '1d10', mastery: 'sap', cost: 1500 });
    expect(db.weapons.get('dagger')).toMatchObject({ properties: ['finesse', 'light', 'thrown'], range: { normal: 20, long: 60 }, mastery: 'nick' });
    expect(db.weapons.get('heavy_crossbow')).toMatchObject({ ammunition: 'bolts', range: { normal: 100, long: 400 } });
    expect(db.weapons.get('greatsword')!.damage.dice).toBe('2d6');
  });

  it('has armor with AC rules', () => {
    expect(db.armor.size).toBe(13);
    expect(db.armor.get('leather_armor')).toMatchObject({ ac: 11, dexCap: null, category: 'light' });
    expect(db.armor.get('breastplate')).toMatchObject({ ac: 14, dexCap: 2, stealthDisadvantage: false });
    expect(db.armor.get('chain_mail')).toMatchObject({ ac: 16, dexCap: 0, strengthRequirement: 13, donMinutes: 10 });
    expect(db.armor.get('shield')).toMatchObject({ ac: 2, category: 'shield' });
  });

  it('has gear, ammunition, focuses, tools, packs and mounts', () => {
    expect(db.gear.get('rope')).toMatchObject({ cost: 100, weightLb: 5 });
    expect(db.gear.get('arrows')).toMatchObject({ bundle: 20, category: 'ammunition' });
    expect(db.gear.get('thieves_tools')).toMatchObject({ category: 'tool', toolAbility: 'dex', cost: 2500 });
    expect(db.gear.get('lute')!.tags).toContain('musical_instrument');
    expect(db.gear.get('dice_set')!.tags).toContain('gaming_set');
    expect(db.gear.get('holy_symbol_amulet')!.category).toBe('holy_symbol');
    expect(db.gear.get('warhorse')).toMatchObject({ category: 'mount', carryingCapacityLb: 540 });
  });

  it('resolves every pack item to a real item', () => {
    const packs = [...db.gear.values()].filter((g) => g.category === 'pack');
    expect(packs).toHaveLength(7);
    for (const p of packs) {
      expect(p.contents?.length, p.id).toBeGreaterThan(5);
      for (const [id] of p.contents!) expect(db.item(id), `${p.id} → ${id}`).toBeDefined();
    }
    expect(db.gear.get('explorers_pack')!.contents).toContainEqual(['torch', 10]);
  });

  it('points every weapon ammunition at a gear item', () => {
    for (const w of db.weapons.values()) if (w.ammunition) expect(db.gear.get(w.ammunition), w.id).toBeDefined();
  });
});
