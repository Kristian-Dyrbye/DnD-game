/**
 * Weapon mastery properties (SRD 5.2): what happens when a character with the mastery hits
 * (or, for Graze, misses) with the weapon. Riders are stored as active effects with the right
 * expiry; movement (Push) and the extra attacks (Cleave, Nick) are returned as instructions for
 * the combat module, which owns the grid and the action economy.
 */
import type { Creature } from '../core/creature';
import type { Rng } from '../core/rng';
import type { WEAPON_MASTERIES } from '../data/schemas';
import { SIZES } from './basics';
import { savingThrow, type D20TestResult } from './checks';
import { applyCondition, saveModes } from './conditions';
import { addEffect } from './activeEffects';

export type Mastery = (typeof WEAPON_MASTERIES)[number];

export interface MasteryHitInput {
  mastery: Mastery;
  attacker: Creature;
  target: Creature;
  /** Ability modifier used for the attack roll. */
  abilityMod: number;
  /** Damage actually dealt by the hit (Slow and Vex need > 0). */
  damageDealt: number;
  rng: Rng;
  /** Hit made on the attacker's own turn (default) or as a reaction on someone else's turn. */
  onOwnTurn?: boolean;
  /** The player chose to use the property (Push/Topple/Slow are optional). Default true. */
  use?: boolean;
}

export interface MasteryOutcome {
  attacker: Creature;
  target: Creature;
  /** Push: move the target up to this many feet straight away. */
  pushFt?: number;
  /** Cleave: the attacker may attack a second creature within 5 ft of the target (no ability mod to damage unless negative). */
  cleave?: boolean;
  save?: D20TestResult;
  text?: string;
}

const LARGE = SIZES.indexOf('large');

export function applyMasteryOnHit(i: MasteryHitInput): MasteryOutcome {
  const { attacker, target } = i;
  const onOwnTurn = i.onOwnTurn ?? true;
  if (i.use === false) return { attacker, target };
  switch (i.mastery) {
    case 'cleave':
      return { attacker, target, cleave: true, text: 'Cleave: may strike a second creature within 5 ft' };
    case 'push':
      if (SIZES.indexOf(target.size) > LARGE) return { attacker, target, text: `${target.name} is too large to push` };
      return { attacker, target, pushFt: 10, text: `Push: ${target.name} can be pushed 10 ft` };
    case 'sap':
      return {
        attacker,
        target: addEffect(target, { key: 'sap', sourceId: attacker.id, consumeOn: 'own_attack', expires: { on: 'start_of_turn', creatureId: attacker.id, skip: 0 } }),
        text: `Sap: ${target.name} has Disadvantage on its next attack`,
      };
    case 'slow':
      if (i.damageDealt <= 0) return { attacker, target };
      if (target.effects.some((e) => e.key === 'slow' && e.sourceId === attacker.id)) return { attacker, target };
      return {
        attacker,
        target: addEffect(target, { key: 'slow', sourceId: attacker.id, expires: { on: 'start_of_turn', creatureId: attacker.id, skip: 0 } }),
        text: `Slow: ${target.name}'s Speed drops by 10 ft`,
      };
    case 'topple': {
      const dc = 8 + i.abilityMod + attacker.proficiencyBonus;
      const save = savingThrow(target, 'con', { rng: i.rng, dc, ...saveModes(target, 'con') });
      if (save.success) return { attacker, target, save, text: `Topple: ${target.name} keeps its footing (${save.text})` };
      return { attacker, target: applyCondition(target, { condition: 'prone' }).creature, save, text: `Topple: ${target.name} falls Prone (${save.text})` };
    }
    case 'vex':
      if (i.damageDealt <= 0) return { attacker, target };
      return {
        attacker: addEffect(attacker, {
          key: 'vex',
          sourceId: attacker.id,
          targetId: target.id,
          consumeOn: 'own_attack_vs_target',
          expires: { on: 'end_of_turn', creatureId: attacker.id, skip: onOwnTurn ? 1 : 0 },
        }),
        target,
        text: `Vex: Advantage on the next attack against ${target.name}`,
      };
    case 'graze':
    case 'nick':
      return { attacker, target };
  }
}

/** Graze on a miss: damage equal to the attack's ability modifier (nothing if ≤ 0). */
export function grazeDamage(abilityMod: number): number {
  return Math.max(0, abilityMod);
}

/** Cleave's second hit: weapon dice only, plus the ability modifier only if it's negative. */
export function cleaveDamageModifier(abilityMod: number): number {
  return Math.min(0, abilityMod);
}
