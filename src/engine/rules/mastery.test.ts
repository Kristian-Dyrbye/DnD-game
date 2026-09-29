import { describe, expect, it } from 'vitest';
import type { Rng } from '../core/rng';
import { CreatureSchema, type Creature } from '../core/creature';
import { applyMasteryOnHit, cleaveDamageModifier, grazeDamage } from './mastery';
import { attackEffectModes, consumeAttackEffects, onTurnEvent, tickEffects, addEffect } from './activeEffects';
import { effectiveSpeed, hasCondition } from './conditions';

const fixed = (...faces: number[]): Rng => {
  const q = [...faces];
  return { int: () => q.shift() ?? 10 } as unknown as Rng;
};

function make(id: string, over: Partial<Creature> = {}): Creature {
  return CreatureSchema.parse({
    id,
    name: id,
    kind: 'monster',
    size: 'medium',
    creatureType: 'humanoid',
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    proficiencyBonus: 2,
    maxHp: 20,
    hp: 20,
    ac: 12,
    speed: { walk: 30 },
    ...over,
  });
}

const hero = make('hero', { proficiencyBonus: 3 });
const hit = (mastery: Parameters<typeof applyMasteryOnHit>[0]['mastery'], over: Partial<Parameters<typeof applyMasteryOnHit>[0]> = {}) =>
  applyMasteryOnHit({ mastery, attacker: hero, target: make('orc'), abilityMod: 3, damageDealt: 7, rng: fixed(), ...over });

describe('weapon masteries', () => {
  it('Sap: target has Disadvantage on its next attack, then it is consumed', () => {
    const { target } = hit('sap');
    expect(attackEffectModes(target, 'hero').disadvantage).toEqual(['Sapped']);
    const after = consumeAttackEffects(target, 'hero');
    expect(after.effects).toEqual([]);
  });

  it('Sap expires at the start of the attacker next turn', () => {
    const { target } = hit('sap');
    const r = onTurnEvent([target], 'start_of_turn', 'hero');
    expect(r.creatures[0]!.effects).toEqual([]);
    expect(r.expired[0]!.effect.key).toBe('sap');
  });

  it('Vex: Advantage on the next attack vs that target, lasting through the end of the attacker NEXT turn', () => {
    const { attacker } = hit('vex');
    expect(attackEffectModes(attacker, 'orc').advantage).toEqual(['Vex']);
    expect(attackEffectModes(attacker, 'goblin').advantage).toEqual([]);
    const endThisTurn = onTurnEvent([attacker], 'end_of_turn', 'hero').creatures[0]!;
    expect(endThisTurn.effects).toHaveLength(1);
    const endNextTurn = onTurnEvent([endThisTurn], 'end_of_turn', 'hero').creatures[0]!;
    expect(endNextTurn.effects).toHaveLength(0);
    expect(consumeAttackEffects(attacker, 'orc').effects).toHaveLength(0);
    expect(hit('vex', { damageDealt: 0 }).attacker.effects).toHaveLength(0);
  });

  it('Slow: −10 ft speed until the attacker next turn, never more than 10', () => {
    let { target } = hit('slow');
    expect(effectiveSpeed(target)).toBe(20);
    target = applyMasteryOnHit({ mastery: 'slow', attacker: make('ally'), target, abilityMod: 3, damageDealt: 4, rng: fixed() }).target;
    expect(effectiveSpeed(target)).toBe(20);
    expect(hit('slow', { damageDealt: 0 }).target.effects).toHaveLength(0);
  });

  it('Topple: Con save vs 8 + mod + PB or Prone', () => {
    const fail = hit('topple', { rng: fixed(5) });
    expect(fail.save!.text).toContain('vs DC 14');
    expect(hasCondition(fail.target, 'prone')).toBe(true);
    const pass = hit('topple', { rng: fixed(14) });
    expect(hasCondition(pass.target, 'prone')).toBe(false);
  });

  it('Push: 10 ft if Large or smaller', () => {
    expect(hit('push').pushFt).toBe(10);
    expect(hit('push', { target: make('ogre', { size: 'large' }) }).pushFt).toBe(10);
    expect(hit('push', { target: make('giant', { size: 'huge' }) }).pushFt).toBeUndefined();
  });

  it('Cleave, Graze and optional use', () => {
    expect(hit('cleave').cleave).toBe(true);
    expect(cleaveDamageModifier(3)).toBe(0);
    expect(cleaveDamageModifier(-1)).toBe(-1);
    expect(grazeDamage(4)).toBe(4);
    expect(grazeDamage(-1)).toBe(0);
    expect(hit('topple', { use: false }).save).toBeUndefined();
  });

  it('round-based effects tick down', () => {
    const c = addEffect(make('a'), { key: 'bless', roundsLeft: 2 });
    const t1 = tickEffects(c);
    expect(t1.creature.effects[0]!.roundsLeft).toBe(1);
    expect(tickEffects(t1.creature).expired.map((e) => e.key)).toEqual(['bless']);
    expect(addEffect(c, { key: 'bless' }).effects.map((e) => e.id)).toEqual(['bless-1', 'bless-2']);
  });
});
