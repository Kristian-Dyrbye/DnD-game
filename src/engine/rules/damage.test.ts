import { describe, expect, it } from 'vitest';
import type { Rng } from '../core/rng';
import { CreatureSchema, type Creature } from '../core/creature';
import { parseDice } from '../core/dice';
import { adjustForDefenses, applyDamage, attackRoll, doubleDice, grantTempHp, heal, isBloodied, rollDamage } from './damage';

function fixed(...faces: number[]): Rng {
  const q = [...faces];
  return { int: () => q.shift() ?? 1 } as unknown as Rng;
}

function target(over: Partial<Creature> = {}): Creature {
  return CreatureSchema.parse({
    id: 't',
    name: 'Ogre',
    kind: 'monster',
    size: 'large',
    creatureType: 'giant',
    abilities: { str: 19, dex: 8, con: 16, int: 5, wis: 7, cha: 7 },
    proficiencyBonus: 2,
    maxHp: 20,
    hp: 20,
    ac: 11,
    speed: { walk: 40 },
    ...over,
  });
}

const mods = [
  { value: 3, label: 'Strength' },
  { value: 2, label: 'Proficiency' },
];

describe('attackRoll', () => {
  it('hits when total meets AC', () => {
    const r = attackRoll({ rng: fixed(6), label: 'Longsword', modifiers: mods, targetAc: 11 });
    expect(r).toMatchObject({ hit: true, crit: false, total: 11 });
    expect(r.text).toBe('d20: 6 + 3 (Strength) + 2 (Proficiency) = 11 vs AC 11 — Hit');
  });

  it('misses below AC', () => {
    expect(attackRoll({ rng: fixed(5), label: 'x', modifiers: mods, targetAc: 11 }).hit).toBe(false);
  });

  it('natural 20 crits even against huge AC; natural 1 always misses', () => {
    const crit = attackRoll({ rng: fixed(20), label: 'x', modifiers: [], targetAc: 30 });
    expect(crit).toMatchObject({ hit: true, crit: true });
    expect(crit.text).toContain('Critical Hit!');
    const fumble = attackRoll({ rng: fixed(1), label: 'x', modifiers: [{ value: 50, label: 'm' }], targetAc: 5 });
    expect(fumble.hit).toBe(false);
    expect(fumble.text).toContain('Miss (natural 1)');
  });

  it('supports expanded crit range (Champion 19)', () => {
    expect(attackRoll({ rng: fixed(19), label: 'x', modifiers: [], targetAc: 25, critOn: 19 })).toMatchObject({ hit: true, crit: true });
  });

  it('auto-crits hits against paralyzed targets, but not misses', () => {
    expect(attackRoll({ rng: fixed(10), label: 'x', modifiers: mods, targetAc: 11, autoCrit: 'Paralyzed' })).toMatchObject({ hit: true, crit: true });
    expect(attackRoll({ rng: fixed(2), label: 'x', modifiers: mods, targetAc: 11, autoCrit: 'Paralyzed' })).toMatchObject({ hit: false, crit: false });
  });

  it('uses advantage (takes higher die)', () => {
    const r = attackRoll({ rng: fixed(3, 15), label: 'x', modifiers: mods, targetAc: 18, advantage: ['Reckless Attack'] });
    expect(r).toMatchObject({ hit: true, total: 20 });
  });
});

describe('rollDamage', () => {
  it('adds modifiers once to the first entry', () => {
    const r = rollDamage(fixed(4, 2), [{ dice: '1d8', type: 'slashing' }, { dice: '1d4', type: 'fire' }], { modifiers: [{ value: 3, label: 'Strength' }] });
    expect(r.parts.map((p) => p.total)).toEqual([7, 2]);
    expect(r.total).toBe(9);
    expect(r.text).toBe('1d8 slashing: [4] + 3 (Strength) = 7; 1d4 fire: [2] = 2');
  });

  it('doubles dice (not modifiers) on a crit', () => {
    const r = rollDamage(fixed(6, 5, 3, 1), [{ dice: '2d6', type: 'slashing' }], { crit: true, modifiers: [{ value: 4, label: 'Strength' }] });
    expect(r.parts[0]!.roll.notation).toBe('4d6');
    expect(r.total).toBe(6 + 5 + 3 + 1 + 4);
    expect(r.text.startsWith('Critical!')).toBe(true);
    expect(doubleDice(parseDice('1d8+2')).terms).toEqual([
      { kind: 'dice', sign: 1, count: 2, sides: 8 },
      { kind: 'const', sign: 1, value: 2 },
    ]);
  });

  it('never deals negative damage', () => {
    expect(rollDamage(fixed(1), [{ dice: '1d4', type: 'piercing' }], { modifiers: [{ value: -3, label: 'Str' }] }).total).toBe(0);
  });
});

describe('applying damage', () => {
  it('reduces HP and reports it', () => {
    const { creature, report } = applyDamage(target(), [{ amount: 7, type: 'slashing' }]);
    expect(creature.hp).toBe(13);
    expect(report).toMatchObject({ hpLost: 7, droppedToZero: false, overflow: 0 });
  });

  it('applies immunity, resistance (round down) and vulnerability', () => {
    const t = target({ immunities: ['poison'], resistances: ['fire'], vulnerabilities: ['cold'] });
    expect(adjustForDefenses(t, { amount: 9, type: 'poison' })).toEqual({ amount: 0, type: 'poison', note: 'immune' });
    expect(adjustForDefenses(t, { amount: 9, type: 'fire' })).toEqual({ amount: 4, type: 'fire', note: 'resisted' });
    expect(adjustForDefenses(t, { amount: 9, type: 'cold' })).toEqual({ amount: 18, type: 'cold', note: 'vulnerable' });
    expect(adjustForDefenses(target({ resistances: ['fire'], vulnerabilities: ['fire'] }), { amount: 9, type: 'fire' }).amount).toBe(8);
    expect(adjustForDefenses(target(), { amount: 9, type: 'acid' }, { resistAll: true }).amount).toBe(4);
  });

  it('temp HP absorb first and do not stack', () => {
    const t = grantTempHp(grantTempHp(target(), 5), 3);
    expect(t.tempHp).toBe(5);
    const { creature, report } = applyDamage(t, [{ amount: 8, type: 'bludgeoning' }]);
    expect(creature).toMatchObject({ tempHp: 0, hp: 17 });
    expect(report.absorbedByTempHp).toBe(5);
  });

  it('drops to 0 with overflow, and flags massive damage', () => {
    const hit = applyDamage(target({ hp: 6 }), [{ amount: 15, type: 'slashing' }]);
    expect(hit.creature.hp).toBe(0);
    expect(hit.report).toMatchObject({ droppedToZero: true, overflow: 9, instantDeath: false });
    const massive = applyDamage(target({ hp: 6 }), [{ amount: 26, type: 'slashing' }]);
    expect(massive.report.instantDeath).toBe(true);
  });

  it('heals up to max and reports bloodied', () => {
    expect(heal(target({ hp: 15 }), 10)).toMatchObject({ healed: 5, creature: { hp: 20 } });
    expect(isBloodied(target({ hp: 10 }))).toBe(true);
    expect(isBloodied(target({ hp: 11 }))).toBe(false);
  });
});
