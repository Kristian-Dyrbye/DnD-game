/**
 * Rogue and Thief features (SRD 5.2). Sneak Attack is a once-per-turn weapon-hit rider; Cunning
 * Strike trades Sneak Attack dice for effects (cunningStrike). Reactions and rerolls (Uncanny
 * Dodge, Reliable Talent, Stroke of Luck) are helpers the combat/check code calls.
 */
import type { Character, Creature } from '../../core/creature';
import type { Rng } from '../../core/rng';
import { SIZES, abilityModifier } from '../../rules/basics';
import { addEffect } from '../../rules/activeEffects';
import { savingThrow, type D20TestResult } from '../../rules/checks';
import { applyCondition, saveModes } from '../../rules/conditions';
import { classLevel } from '../derived';
import type { FeatureImpl } from './types';

const level = (c: Character) => classLevel(c, 'rogue');

export function sneakAttackDice(c: Character): number {
  return Math.ceil(level(c) / 2);
}

export const rogueFeatures: FeatureImpl[] = [
  {
    id: 'sneak_attack',
    owner: 'rogue',
    onWeaponHit: (c, _db, ctx) => {
      const finesseOrRanged = ctx.attack.properties.includes('finesse') || ctx.attack.properties.includes('ammunition') || ctx.attack.properties.includes('range');
      const allyHelps = ctx.allyAdjacentToTarget && !ctx.hadDisadvantage;
      if (!ctx.firstHitThisTurn || !finesseOrRanged || !(ctx.hadAdvantage || allyHelps)) return undefined;
      const dice = sneakAttackDice(c) - (ctx.sneakAttackDiceSpent ?? 0);
      if (dice <= 0) return { text: 'Sneak Attack (all dice spent on Cunning Strike)' };
      return { extraDamage: [{ dice: `${dice}d6`, type: ctx.attack.damage[0]!.type }], text: 'Sneak Attack' };
    },
  },
  {
    id: 'steady_aim',
    owner: 'rogue',
    actions: [
      {
        id: 'steady_aim',
        name: 'Steady Aim',
        cost: 'bonus_action',
        problem: (c) => (c.effects.some((e) => e.key === 'steady_aim') ? 'Already aiming' : undefined),
        use: (c) => ({
          // Advantage on the next attack this turn; Speed 0 until the end of the turn (combat enforces the speed).
          character: addEffect(c, { key: 'steady_aim', sourceId: c.id, consumeOn: 'own_attack', expires: { on: 'end_of_turn', creatureId: c.id, skip: 0 } }),
          log: [`${c.name} takes careful aim (Advantage on the next attack, can't move this turn).`],
        }),
      },
    ],
  },
  { id: 'evasion', owner: 'rogue', onGain: (c) => (c.effects.some((e) => e.key === 'evasion') ? c : addEffect(c, { key: 'evasion', sourceId: c.id })) },
  {
    id: 'slippery_mind',
    owner: 'rogue',
    onGain: (c) => ({ ...c, saveProficiencies: [...new Set([...c.saveProficiencies, 'wis' as const, 'cha' as const])] }),
  },
  {
    id: 'stroke_of_luck',
    owner: 'rogue',
    resources: () => ({ stroke_of_luck: { current: 1, max: 1, recharge: 'short' } }),
  },
  // Thief
  { id: 'second_story_work', owner: 'thief', onGain: (c) => ({ ...c, speed: { ...c.speed, climb: c.speed.walk } }) },
];

export type CunningStrikeOption = 'poison' | 'trip' | 'withdraw' | 'daze' | 'knock_out' | 'obscure';

/** Sneak Attack dice each option costs, and the Rogue level that unlocks it. */
export const CUNNING_STRIKES: Record<CunningStrikeOption, { cost: number; level: number }> = {
  poison: { cost: 1, level: 5 },
  trip: { cost: 1, level: 5 },
  withdraw: { cost: 1, level: 5 },
  daze: { cost: 2, level: 14 },
  knock_out: { cost: 6, level: 14 },
  obscure: { cost: 3, level: 14 },
};

export const cunningStrikeDc = (c: Character) => 8 + abilityModifier(c.abilities.dex) + c.proficiencyBonus;

/** Applies a Cunning Strike after Sneak Attack damage. Returns undefined if not allowed. */
export function cunningStrike(
  rogue: Character,
  target: Creature,
  option: CunningStrikeOption,
  rng: Rng,
): { rogue: Character; target: Creature; diceCost: number; save?: D20TestResult; text: string } | undefined {
  const def = CUNNING_STRIKES[option];
  if (level(rogue) < def.level || def.cost > sneakAttackDice(rogue)) return undefined;
  const dc = cunningStrikeDc(rogue);
  const save = (ability: 'con' | 'dex') => savingThrow(target, ability, { rng, dc, ...saveModes(target, ability) });
  const src = `${rogue.id}:cunning_strike`;
  switch (option) {
    case 'poison': {
      const s = save('con');
      const t = s.success ? target : applyCondition(target, { condition: 'poisoned', sourceId: src, roundsLeft: 10, endSave: { ability: 'con', dc } }).creature;
      return { rogue, target: t, diceCost: def.cost, save: s, text: s.success ? `${target.name} resists the poison` : `${target.name} is Poisoned` };
    }
    case 'trip': {
      if (SIZES.indexOf(target.size) > SIZES.indexOf('large')) return { rogue, target, diceCost: def.cost, text: `${target.name} is too big to trip` };
      const s = save('dex');
      return { rogue, target: s.success ? target : applyCondition(target, { condition: 'prone' }).creature, diceCost: def.cost, save: s, text: s.success ? `${target.name} keeps its footing` : `${target.name} is knocked Prone` };
    }
    case 'withdraw':
      return {
        rogue: addEffect(rogue, { key: 'withdraw', sourceId: rogue.id, expires: { on: 'end_of_turn', creatureId: rogue.id, skip: 0 } }),
        target,
        diceCost: def.cost,
        text: `${rogue.name} can move half their Speed without provoking Opportunity Attacks`,
      };
    case 'daze': {
      const s = save('con');
      const t = s.success ? target : addEffect(target, { key: 'dazed', sourceId: rogue.id, expires: { on: 'end_of_turn', creatureId: target.id, skip: 0 } });
      return { rogue, target: t, diceCost: def.cost, save: s, text: s.success ? `${target.name} shakes it off` : `${target.name} is Dazed (only one of move, action or bonus action next turn)` };
    }
    case 'knock_out': {
      const s = save('con');
      const t = s.success ? target : applyCondition(target, { condition: 'unconscious', sourceId: src, roundsLeft: 10, endSave: { ability: 'con', dc } }).creature;
      return { rogue, target: t, diceCost: def.cost, save: s, text: s.success ? `${target.name} stays conscious` : `${target.name} is knocked Unconscious` };
    }
    case 'obscure': {
      const s = save('dex');
      const t = s.success ? target : applyCondition(target, { condition: 'blinded', sourceId: src, roundsLeft: 1 }).creature;
      return { rogue, target: t, diceCost: def.cost, save: s, text: s.success ? `${target.name} blinks it away` : `${target.name} is Blinded until the end of its next turn` };
    }
  }
}

/** Uncanny Dodge (5, reaction): halve an attack's damage (round down). */
export function uncannyDodge(damage: number): number {
  return Math.floor(damage / 2);
}

/** Reliable Talent (7): a d20 of 9 or lower counts as 10 on checks using a proficiency. */
export function reliableTalent(c: Character, result: D20TestResult, proficient: boolean): D20TestResult {
  if (level(c) < 7 || !proficient || result.d20.natural >= 10) return result;
  const total = result.total + (10 - result.d20.natural);
  const success = result.target ? total >= result.target.value : result.success;
  return { ...result, total, ...(success !== undefined && { success }), text: `${result.text} (Reliable Talent: d20 counts as 10 → ${total})` };
}

/** Stroke of Luck (20): turn a failed D20 Test into a natural 20. */
export function strokeOfLuck(c: Character, result: D20TestResult): { character: Character; result: D20TestResult } | undefined {
  const r = c.resources.stroke_of_luck;
  if (!r || r.current < 1 || result.success !== false) return undefined;
  const total = result.total + (20 - result.d20.natural);
  return {
    character: { ...c, resources: { ...c.resources, stroke_of_luck: { ...r, current: 0 } } },
    result: { ...result, total, success: result.target ? total >= result.target.value : true, text: `${result.text} → Stroke of Luck: natural 20 (${total})` },
  };
}
