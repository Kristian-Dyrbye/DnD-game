import { describe, expect, it } from 'vitest';
import { CharacterSchema, type Character } from '../core/creature';
import { loadSrd } from '../data/srdBundle';
import { armorWear, mendYourself, repairAtSmith, repairCost, wearFromFight, wearLabel, WEAR_MAX } from './armorWear';

const db = loadSrd();

const knight = (over: Partial<Character> = {}): Character =>
  CharacterSchema.parse({
    id: 'hero', name: 'Mira', kind: 'character', size: 'medium', creatureType: 'humanoid',
    abilities: { str: 16, dex: 10, con: 14, int: 10, wis: 10, cha: 10 }, proficiencyBonus: 2, maxHp: 20, hp: 20, ac: 18, speed: { walk: 30 },
    classes: [{ classId: 'fighter', level: 1 }], speciesId: 'human', backgroundId: 'soldier', coins: 5000,
    inventory: [
      { uid: 'a', itemId: 'chain_mail', quantity: 1, equipped: 'armor' },
      { uid: 's', itemId: 'shield', quantity: 1, equipped: 'shield' },
      { uid: 'l', itemId: 'leather_armor', quantity: 1 },
    ],
    ...over,
  });

describe('armor wear', () => {
  it('hits in a fight wear equipped armor and shield (crits double), capped', () => {
    const c = wearFromFight(knight(), { hits: 4, crits: 1 });
    expect(c.inventory.find((i) => i.uid === 'a')!.wear).toBe(15); // (4 + 1) × 3
    expect(c.inventory.find((i) => i.uid === 's')!.wear).toBe(10); // (4 + 1) × 2
    expect(c.inventory.find((i) => i.uid === 'l')!.wear).toBeUndefined(); // not worn
    expect(armorWear(c)).toBe(15);
    expect(armorWear(wearFromFight(c, { hits: 100, crits: 0 }))).toBe(WEAR_MAX);
    expect(wearLabel(0)).toBe('pristine');
    expect(wearLabel(15)).toBe('scuffed');
    expect(wearLabel(80)).toBe('battered');
  });

  it('a smith repairs fully for gold and an hour; mending yourself takes 8 hours and removes up to 50', () => {
    const worn = wearFromFight(knight(), { hits: 20, crits: 0 }); // chain mail 60
    const armor = worn.inventory.find((i) => i.uid === 'a')!;
    const cost = repairCost(armor, db);
    expect(cost).toBe(Math.round((7500 * 0.25 * 60) / 100)); // chain mail 75 gp
    const r = repairAtSmith(worn, 'a', db);
    if (!r.ok) throw new Error(r.error);
    expect(r.character.coins).toBe(5000 - cost);
    expect(r.minutes).toBe(60);
    expect(armorWear(r.character)).toBe(0);
    const m = mendYourself(worn, 'a');
    if (!m.ok) throw new Error(m.error);
    expect(armorWear(m.character)).toBe(10);
    expect(m.minutes).toBe(480);
    expect(repairAtSmith(knight({ coins: 0 }), 'a', db).ok).toBe(false); // nothing to repair
    expect(repairAtSmith({ ...worn, coins: 10 }, 'a', db).ok).toBe(false); // can't afford
  });
});
