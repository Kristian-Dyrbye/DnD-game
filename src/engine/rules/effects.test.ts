import { describe, expect, it } from 'vitest';
import type { Rng } from '../core/rng';
import { CreatureSchema, type Creature } from '../core/creature';
import { formatDice } from '../core/dice';
import { loadSrd } from '../data/srdBundle';
import { createEffectContext, durationRounds, executeEffects, upcastDice } from './effects';
import { hasCondition } from './conditions';

/** Fixed dice: returns faces in order (d20s and damage dice share the queue). */
function fixed(...faces: number[]): Rng {
  const q = [...faces];
  return { int: (_min: number, max: number) => Math.min(q.shift() ?? 1, max) } as unknown as Rng;
}

function make(id: string, over: Partial<Creature> = {}): Creature {
  return CreatureSchema.parse({
    id,
    name: id,
    kind: 'monster',
    size: 'medium',
    creatureType: 'humanoid',
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    proficiencyBonus: 2,
    maxHp: 40,
    hp: 40,
    ac: 13,
    speed: { walk: 30 },
    ...over,
  });
}

const spell = (id: string) => loadSrd().spells.get(id)!;
const wizard = make('wiz', { kind: 'character' as never });

describe('executeEffects with real SRD spells', () => {
  it('Fireball: one damage roll shared by all; half on a successful save', () => {
    const a = make('a');
    const b = make('b');
    // d20 for a: 5 (fail), 8d6 damage: all 3s = 24, d20 for b: 18 (success) → 12
    const ctx = createEffectContext({ rng: fixed(5, 3, 3, 3, 3, 3, 3, 3, 3, 18), source: wizard, targets: [a, b], saveDc: 15 });
    executeEffects(spell('fireball').effects!, ['a', 'b'], ctx);
    expect(ctx.creatures.get('a')!.hp).toBe(40 - 24);
    expect(ctx.creatures.get('b')!.hp).toBe(40 - 12);
    expect(ctx.log.filter((l) => l.kind === 'save')).toHaveLength(2);
  });

  it('Fireball upcast at level 5 rolls 10d6', () => {
    const faces = [2, ...new Array(10).fill(1)];
    const ctx = createEffectContext({ rng: fixed(...faces), source: wizard, targets: [make('a')], saveDc: 15, upcastLevels: 2 });
    executeEffects(spell('fireball').effects!, ['a'], ctx);
    expect(ctx.creatures.get('a')!.hp).toBe(30);
    expect(ctx.log.find((l) => l.kind === 'damage')!.text).toContain('10d6');
  });

  it('Fire Bolt: miss does nothing, hit deals damage, crit doubles dice', () => {
    const miss = createEffectContext({ rng: fixed(2), source: wizard, targets: [make('a')], attackBonus: 5 });
    executeEffects(spell('fire_bolt').effects!, ['a'], miss);
    expect(miss.creatures.get('a')!.hp).toBe(40);
    const hit = createEffectContext({ rng: fixed(12, 7), source: wizard, targets: [make('a')], attackBonus: 5 });
    executeEffects(spell('fire_bolt').effects!, ['a'], hit);
    expect(hit.creatures.get('a')!.hp).toBe(33);
    const crit = createEffectContext({ rng: fixed(20, 7, 6), source: wizard, targets: [make('a')], attackBonus: 5 });
    executeEffects(spell('fire_bolt').effects!, ['a'], crit);
    expect(crit.creatures.get('a')!.hp).toBe(27);
  });

  it('Cure Wounds heals dice + spell mod, upcast adds 2d8 per level', () => {
    const ctx = createEffectContext({ rng: fixed(4, 4, 4, 4), source: wizard, targets: [make('a', { hp: 5 })], spellMod: 3, upcastLevels: 1 });
    executeEffects(spell('cure_wounds').effects!, ['a'], ctx);
    expect(ctx.creatures.get('a')!.hp).toBe(5 + 16 + 3);
  });

  it('Hold Person: failed save applies Paralyzed with a 10-round duration and source id', () => {
    const ctx = createEffectContext({ rng: fixed(3), source: wizard, targets: [make('a')], saveDc: 14, conditionSourceId: 'wiz:hold_person' });
    executeEffects(spell('hold_person').effects!, ['a'], ctx);
    const a = ctx.creatures.get('a')!;
    expect(hasCondition(a, 'paralyzed')).toBe(true);
    expect(a.conditions[0]).toMatchObject({ sourceId: 'wiz:hold_person', roundsLeft: 10 });
  });

  it('respects resistance and reports deaths', () => {
    const tough = make('a', { resistances: ['fire'], hp: 5 });
    const ctx = createEffectContext({ rng: fixed(1, 6, 6, 6, 6, 6, 6, 6, 6), source: wizard, targets: [tough], saveDc: 15 });
    executeEffects(spell('fireball').effects!, ['a'], ctx);
    expect(ctx.creatures.get('a')!.dead).toBe(true);
    expect(ctx.log.find((l) => l.kind === 'damage')!.text).toMatch(/fire resisted.*dies!/);
  });

  it('calls onDamaged (for concentration) and logs unknown hooks', () => {
    const hits: number[] = [];
    const ctx = createEffectContext({ rng: fixed(12, 5), source: wizard, targets: [make('a')], attackBonus: 5, onDamaged: (_c, _id, n) => hits.push(n) });
    executeEffects([...spell('fire_bolt').effects!, { kind: 'hook', hook: 'mystery' }], ['a'], ctx);
    expect(hits).toEqual([5]);
    expect(ctx.log.at(-1)!.text).toContain('not implemented');
  });

  it('runs registered hooks', () => {
    const ctx = createEffectContext({
      rng: fixed(),
      source: wizard,
      targets: [make('a')],
      hooks: { shove: (c, id) => c.log.push({ targetId: id, kind: 'hook', text: 'shoved' }) },
    });
    executeEffects([{ kind: 'hook', hook: 'shove' }], ['a'], ctx);
    expect(ctx.log[0]!.text).toBe('shoved');
  });
});

describe('helpers', () => {
  it('upcastDice merges same-size dice and appends others', () => {
    expect(formatDice(upcastDice('8d6', '1d6', 2))).toBe('10d6');
    expect(formatDice(upcastDice('3d6', '2d4', 1))).toBe('3d6+2d4');
    expect(formatDice(upcastDice('2d8', undefined, 3))).toBe('2d8');
  });

  it('converts durations to rounds', () => {
    expect(durationRounds({ unit: 'minute', amount: 1, concentration: true })).toBe(10);
    expect(durationRounds({ unit: 'round', amount: 1, concentration: false })).toBe(1);
    expect(durationRounds({ unit: 'instantaneous', concentration: false })).toBeUndefined();
  });
});
