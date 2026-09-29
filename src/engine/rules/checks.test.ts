import { describe, expect, it } from 'vitest';
import type { Rng } from '../core/rng';
import { Rng as RealRng } from '../core/rng';
import { CreatureSchema, type Creature } from '../core/creature';
import { abilityCheck, contest, d20Test, passiveScore, savingThrow, skillCheck } from './checks';

/** Rng stub returning fixed d20 faces. */
function fixed(...faces: number[]): Rng {
  const q = [...faces];
  return { int: () => q.shift() ?? 10 } as unknown as Rng;
}

function hero(over: Partial<Creature> = {}): Creature {
  return CreatureSchema.parse({
    id: 'hero',
    name: 'Brenna',
    kind: 'character',
    size: 'medium',
    creatureType: 'humanoid',
    abilities: { str: 16, dex: 14, con: 12, int: 8, wis: 10, cha: 15 },
    proficiencyBonus: 3,
    maxHp: 30,
    hp: 30,
    ac: 16,
    speed: { walk: 30 },
    saveProficiencies: ['str', 'con'],
    skills: { persuasion: 'proficient', stealth: 'expertise', athletics: 'half' },
    ...over,
  });
}

describe('d20Test core', () => {
  it('sums modifiers and compares against the DC', () => {
    const r = d20Test({ rng: fixed(14), label: 'Test', modifiers: [{ value: 5, label: 'Persuasion' }], target: { kind: 'DC', value: 15 } });
    expect(r).toMatchObject({ total: 19, success: true, mode: 'normal' });
    expect(r.text).toBe('d20: 14 + 5 (Persuasion) = 19 vs DC 15 — Success');
  });

  it('meets the DC exactly = success; one below = failure', () => {
    expect(d20Test({ rng: fixed(10), label: 'x', modifiers: [{ value: 5, label: 'm' }], target: { kind: 'DC', value: 15 } }).success).toBe(true);
    expect(d20Test({ rng: fixed(9), label: 'x', modifiers: [{ value: 5, label: 'm' }], target: { kind: 'DC', value: 15 } }).success).toBe(false);
  });

  it('rolls two dice with advantage and takes the higher', () => {
    const r = d20Test({ rng: fixed(4, 17), label: 'x', modifiers: [], advantage: ['Help'] });
    expect(r.d20).toEqual({ mode: 'advantage', rolls: [4, 17], natural: 17 });
    expect(r.total).toBe(17);
    expect(r.success).toBeUndefined();
  });

  it('cancels advantage and disadvantage', () => {
    const r = d20Test({ rng: fixed(8), label: 'x', modifiers: [], advantage: ['Help', 'Inspiration'], disadvantage: ['Poisoned'] });
    expect(r.mode).toBe('normal');
    expect(r.d20.rolls).toHaveLength(1);
  });

  it('applies exhaustion (−2 per level)', () => {
    const r = d20Test({ rng: fixed(12), label: 'x', modifiers: [{ value: 3, label: 'Dex' }], exhaustion: 2 });
    expect(r.total).toBe(11);
    expect(r.text).toContain('− 4 (Exhaustion)');
  });

  it('auto-fails regardless of the roll', () => {
    const r = d20Test({ rng: fixed(20), label: 'x', modifiers: [{ value: 10, label: 'm' }], target: { kind: 'DC', value: 5 }, autoFail: 'Paralyzed' });
    expect(r.success).toBe(false);
    expect(r.text).toContain('Automatic failure (Paralyzed)');
  });

  it('natural 20 is not an automatic success on checks', () => {
    expect(d20Test({ rng: fixed(20), label: 'x', modifiers: [{ value: -1, label: 'm' }], target: { kind: 'DC', value: 25 } }).success).toBe(false);
  });
});

describe('ability checks and saves', () => {
  it('adds proficiency, expertise and half proficiency to skills', () => {
    expect(skillCheck(hero(), 'persuasion', { rng: fixed(10) }).total).toBe(10 + 2 + 3);
    expect(skillCheck(hero(), 'stealth', { rng: fixed(10) }).total).toBe(10 + 2 + 6);
    expect(skillCheck(hero(), 'athletics', { rng: fixed(10) }).total).toBe(10 + 3 + 1);
    expect(skillCheck(hero(), 'arcana', { rng: fixed(10) }).total).toBe(10 - 1);
  });

  it('labels the math line with the skill', () => {
    const r = skillCheck(hero(), 'persuasion', { rng: fixed(14), dc: 15 });
    expect(r.text).toBe('d20: 14 + 2 (Charisma) + 3 (Proficiency: Persuasion) = 19 vs DC 15 — Success');
  });

  it('supports a skill with a non-default ability (Strength (Intimidation))', () => {
    const c = hero({ skills: { intimidation: 'proficient' } });
    expect(abilityCheck(c, 'str', 'intimidation', { rng: fixed(10) }).total).toBe(10 + 3 + 3);
  });

  it('plain ability checks have no proficiency', () => {
    const r = abilityCheck(hero(), 'str', undefined, { rng: fixed(10), dc: 12 });
    expect(r).toMatchObject({ total: 13, success: true, label: 'Strength check' });
  });

  it('saving throws add proficiency only for proficient saves', () => {
    expect(savingThrow(hero(), 'str', { rng: fixed(10) }).total).toBe(10 + 3 + 3);
    expect(savingThrow(hero(), 'dex', { rng: fixed(10) }).total).toBe(10 + 2);
  });

  it('includes extra bonuses and the creature exhaustion', () => {
    const r = savingThrow(hero({ exhaustion: 1 }), 'wis', { rng: fixed(10), bonuses: [{ value: 3, label: 'Bless' }], dc: 12 });
    expect(r.total).toBe(10 + 0 + 3 - 2);
    expect(r.success).toBe(false);
  });
});

describe('passive scores and contests', () => {
  it('computes passive Perception with ±5 for advantage', () => {
    const c = hero({ skills: { perception: 'proficient' } });
    expect(passiveScore(c, 'perception')).toBe(13);
    expect(passiveScore(c, 'perception', 1, 0)).toBe(18);
    expect(passiveScore(c, 'perception', 0, 1)).toBe(8);
    expect(passiveScore(c, 'perception', 1, 1)).toBe(13);
  });

  it('resolves contests; ties keep the status quo', () => {
    const a = skillCheck(hero(), 'athletics', { rng: fixed(15) });
    const b = skillCheck(hero(), 'athletics', { rng: fixed(10) });
    expect(contest(a, b)).toBe('a');
    expect(contest(b, a)).toBe('b');
    expect(contest(a, a)).toBe('tie');
  });

  it('is deterministic with a seeded rng', () => {
    const one = skillCheck(hero(), 'stealth', { rng: RealRng.fromSeed('s') }).total;
    const two = skillCheck(hero(), 'stealth', { rng: RealRng.fromSeed('s') }).total;
    expect(one).toBe(two);
  });
});
