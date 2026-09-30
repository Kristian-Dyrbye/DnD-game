/** A149d: gear, magic item and weapon names in the session language (attack lines, potions, inventory, shops). */
import { describe, expect, it } from 'vitest';
import { buildCharacter } from '../character/builder';
import { toBuildInput } from '../character/creator';
import { itemName } from '../character/inventory';
import { quickBuild } from '../character/quickBuild';
import type { Character, Creature } from '../core/creature';
import { Rng } from '../core/rng';
import { loadSrd } from '../data/srdBundle';
import { messages, type Messages } from '../i18n';
import { srdName } from '../i18n/srdNames';
import { monsterToCreature } from '../rules/monsters';
import { resolveAttack } from './attack';
import type { CombatContext, CombatState } from './combatState';
import { createGrid, placeToken } from './grid';
import { useMagicItem } from './otherActions';
import { startCombat } from './turns';

const db = loadSrd();
const da = messages('da');

function fixed(...faces: number[]): Rng {
  const q = [...faces];
  return { int: () => q.shift() ?? 10 } as unknown as Rng;
}
const ctx = (msgs?: Messages, ...faces: number[]): CombatContext => ({ rng: fixed(...faces), db, ...(msgs && { msgs }) });
const text = (r: { ok: boolean; events?: { text: string }[] }) => (r.ok && r.events ? r.events.map((e) => e.text).join('\n') : '');

/** Fighter with a longsword (magic +1 if asked) and a Potion of Healing, next to a goblin. */
function fight(magic = false): { state: CombatState; uid: string } {
  const base = buildCharacter(toBuildInput(quickBuild('fighter', db, Rng.fromSeed('fighter'))), db);
  const hero: Character = {
    ...base,
    id: 'hero',
    name: 'Brenna',
    inventory: [
      ...base.inventory.filter((i) => !db.weapons.has(i.itemId)),
      { uid: 'ls', itemId: 'longsword', quantity: 1, equipped: 'main_hand', ...(magic && { magicItemId: 'weapon_1' }) },
      { uid: 'pot', itemId: 'potion_of_healing', quantity: 1 },
    ],
  };
  const goblin: Creature = monsterToCreature(db.monsters.get('goblin_warrior')!, 'g1', 'Goblin');
  const grid = createGrid(10, 10);
  placeToken(grid, { id: 'hero', x: 2, y: 2, size: hero.size });
  placeToken(grid, { id: 'g1', x: 3, y: 2, size: goblin.size });
  const turns = startCombat([
    { id: 'hero', side: 'party', initiative: 20, dexMod: 0 },
    { id: 'g1', side: 'enemy', initiative: 1, dexMod: 0 },
  ]);
  return { state: { grid, turns: { ...turns, round: 1, currentIndex: 0, turnActive: true }, creatures: { hero, g1: goblin } }, uid: 'ls' };
}

describe('item names (A149d)', () => {
  it('every gear and magic item has a Danish name; English is unchanged', () => {
    const missing = [...db.gear.values(), ...db.magicItems.values()].filter((g) => itemName(g.id, db, 'da') === '').map((g) => g.id);
    expect(missing).toEqual([]);
    expect(itemName('rope', db, 'da')).toBe('Reb');
    expect(itemName('longsword', db, 'da')).toBe(srdName('da', 'weapons', 'longsword', 'Longsword'));
    expect(itemName('chain_mail', db, 'da')).toBe('Ringbrynje');
    expect(itemName('bag_of_holding', db, 'da')).toBe('Rummelig pose');
    expect(itemName('rope', db)).toBe('Rope');
    expect(itemName('bag_of_holding', db, 'en')).toBe('Bag of Holding');
    expect(itemName('no_such_thing', db, 'da')).toBe('no such thing');
    const translated = [...db.gear.values()].filter((g) => itemName(g.id, db, 'da') !== g.name).length;
    expect(translated).toBeGreaterThan(130); // a few names are the same in Danish (Net, Horn, Pony…)
  });

  it('attack lines name the weapon (and its magic item) in Danish', () => {
    const { state, uid } = fight(true);
    const sword = srdName('da', 'weapons', 'longsword', 'Longsword');
    const r = resolveAttack(state, ctx(da, 15, 5), { attackerId: 'hero', targetId: 'g1', profile: `weapon:${uid}:melee` });
    expect(text(r)).toContain(`${sword} (Våben +1)`);
    expect(text(r)).not.toMatch(/Longsword|Weapon, \+1/);
    const en = resolveAttack(fight(true).state, ctx(undefined, 15, 5), { attackerId: 'hero', targetId: 'g1', profile: `weapon:${uid}:melee` });
    expect(text(en)).toContain('Longsword (Weapon, +1)');
  });

  it('drinking a potion is logged with its Danish name', () => {
    const { state } = fight();
    const r = useMagicItem(state, ctx(da, 3, 3), 'hero', 'pot');
    expect(text(r)).toContain('Brenna drikker en Helbredende drik.');
    const en = useMagicItem(fight().state, ctx(undefined, 3, 3), 'hero', 'pot');
    expect(text(en)).toContain('Brenna drinks a Potion of Healing.');
  });
});
