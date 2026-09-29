import { describe, expect, it } from 'vitest';
import { SrdDatabase, validateSrdFile } from './srd';
import { loadSrd } from './srdBundle';
import { toId } from './common';
import { SpellSchema } from './schemas';

const fireball = {
  id: 'fireball',
  name: 'Fireball',
  level: 3,
  school: 'evocation',
  classes: ['sorcerer', 'wizard'],
  castingTime: { unit: 'action' },
  range: { kind: 'feet', amount: 150 },
  components: { v: true, s: true, m: true, material: 'a ball of bat guano and sulfur' },
  duration: { unit: 'instantaneous' },
  text: 'A bright streak flashes...',
  higherLevels: 'The damage increases by 1d6 for each spell slot level above 3.',
  save: 'dex',
  damage: [{ dice: '8d6', type: 'fire' }],
  area: { shape: 'sphere', size: 20 },
  effects: [
    {
      kind: 'area',
      area: { shape: 'sphere', size: 20 },
      effects: [{ kind: 'save', ability: 'dex', onFail: [{ kind: 'damage', damage: [{ dice: '8d6', type: 'fire' }], upcast: '1d6' }], onSuccess: 'half' }],
    },
  ],
};

describe('SRD schemas', () => {
  it('accepts a complete spell with nested effects', () => {
    const res = SpellSchema.safeParse(fireball);
    expect(res.success, JSON.stringify(res.error?.issues)).toBe(true);
    if (res.success) expect(res.data.castingTime).toEqual({ unit: 'action', amount: 1, ritual: false });
  });

  it('rejects bad dice, ids and nested effects', () => {
    expect(SpellSchema.safeParse({ ...fireball, damage: [{ dice: '8x6', type: 'fire' }] }).success).toBe(false);
    expect(SpellSchema.safeParse({ ...fireball, id: 'Fire Ball' }).success).toBe(false);
    expect(SpellSchema.safeParse({ ...fireball, effects: [{ kind: 'save', ability: 'luck', onFail: [] }] }).success).toBe(false);
  });
});

describe('validateSrdFile / SrdDatabase', () => {
  it('reports non-arrays, bad records and duplicate ids', () => {
    expect(validateSrdFile('spells.json', {}).report.errors[0]).toContain('expected a JSON array');
    const { records, report } = validateSrdFile('spells.json', [fireball, { ...fireball, level: 12 }, fireball]);
    expect(records).toHaveLength(2);
    expect(report.errors.some((e) => e.includes('level'))).toBe(true);
    expect(report.errors.some((e) => e.includes('duplicate id "fireball"'))).toBe(true);
  });

  it('looks up records and filters spells by class', () => {
    const db = new SrdDatabase({ 'spells.json': [fireball] });
    expect(db.spells.get('fireball')?.level).toBe(3);
    expect(db.spellsForClass('wizard')).toHaveLength(1);
    expect(db.spellsForClass('wizard', 2)).toHaveLength(0);
    expect(db.spellsForClass('cleric')).toHaveLength(0);
    expect(db.errors).toEqual([]);
  });
});

describe('committed data/srd files', () => {
  it('all validate against their schemas', () => {
    const db = loadSrd();
    expect(db.errors).toEqual([]);
  });
});

describe('toId', () => {
  it('makes snake_case ids from names', () => {
    expect(toId('Goblin Warrior')).toBe('goblin_warrior');
    expect(toId("Tasha's Hideous Laughter")).toBe('tashas_hideous_laughter');
    expect(toId('Boon of the Night Spirit')).toBe('boon_of_the_night_spirit');
    expect(toId('Potion of Healing (Greater)')).toBe('potion_of_healing_greater');
  });
});
