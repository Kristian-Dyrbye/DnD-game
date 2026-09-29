import { describe, expect, it } from 'vitest';
import { loadSrd } from './srdBundle';

const db = loadSrd();
const item = (id: string) => db.magicItems.get(id)!;

describe('magic items data', () => {
  it('imports the SRD magic items', () => {
    expect(db.magicItems.size).toBe(271);
    for (const m of db.magicItems.values()) expect(m.text.length, m.id).toBeGreaterThan(20);
  });

  it('expands +1/+2/+3 items by rarity', () => {
    expect(item('weapon_1')).toMatchObject({ category: 'weapon', rarity: 'uncommon', bonus: 1, baseItem: 'Any Simple or Martial' });
    expect(item('weapon_3')).toMatchObject({ rarity: 'very_rare', bonus: 3 });
    expect(item('armor_3')).toMatchObject({ rarity: 'legendary', bonus: 3 });
    expect(item('shield_2')).toMatchObject({ category: 'armor', baseItem: 'Shield', rarity: 'rare' });
  });

  it('parses attunement, charges and healing potions', () => {
    expect(item('staff_of_fire')).toMatchObject({ attunement: { required: true, by: 'a Druid, Sorcerer, Warlock, or Wizard' }, charges: 10 });
    expect(item('bag_of_holding').attunement.required).toBe(false);
    expect(item('potion_of_healing_superior')).toMatchObject({ rarity: 'rare', effects: [{ kind: 'heal', dice: '8d4+8' }] });
    expect(item('spell_scroll').rarity).toBe('varies');
  });
});
