/**
 * Saving throws in combat and stat-block riders (Build Prompt §10; SRD 5.2.1 Grappled condition,
 * monster stat block wording).
 *
 * - `combatSave`: a save with condition, effect, feature and Dodge modes.
 * - `applyActionRiders`: conditions a monster action gives on a hit / failed save (parsed by
 *   rules/monsters.ts actionRiders): size limit, excluded creature types, a follow-up save,
 *   Grappled with its escape DC (the same 'grappled_by' effect Unarmed Strike grapples use),
 *   "until the grapple ends" conditions tied to the grappler, 1-round conditions, end-of-turn saves.
 */
import type { Character, Creature } from '../core/creature';
import { addEffect } from '../rules/activeEffects';
import { SIZES, type Ability, type Skill } from '../rules/basics';
import { abilityCheck, savingThrow, type D20TestResult } from '../rules/checks';
import { applyCondition, checkModes, saveModes } from '../rules/conditions';
import type { ActionRider } from '../rules/monsters';
import { effectSaveAdjustments } from '../rules/spellHooks';
import { effectCheckBonuses, effectCheckModes, effectSaveAdjustments3 } from '../rules/spellHooks3';
import { featureCheckBonuses, featureCheckModes, featureSaveModes } from '../character/features';
import { consumeHelpCheck, dodgeSaveModes, helpCheckModes } from './actionEffects';
import { dbOf, withCreature, type CombatContext, type CombatEvent, type CombatState } from './combatState';

const isCharacter = (c: Creature): c is Character => c.kind === 'character' && 'classes' in c;

const ABILITY_NAME: Record<Ability, string> = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' };

/** A saving throw with condition, effect, feature and Dodge modes (Grapple/Shove saves, monster actions). */
export function combatSave(state: CombatState, ctx: CombatContext, id: string, ability: Ability, dc: number): D20TestResult {
  const c = state.creatures[id] as Creature;
  const cond = saveModes(c, ability, ctx.table);
  const e1 = effectSaveAdjustments(c, ability);
  const e3 = effectSaveAdjustments3(c, ability);
  const dodge = dodgeSaveModes(c, ability, ctx.table);
  const feat = isCharacter(c) ? featureSaveModes(c, dbOf(ctx), ability) : { advantage: [], disadvantage: [] };
  return savingThrow(c, ability, {
    rng: ctx.rng,
    dc,
    advantage: [...cond.advantage, ...e1.advantage, ...e3.advantage, ...dodge.advantage, ...feat.advantage],
    disadvantage: [...cond.disadvantage, ...e3.disadvantage, ...feat.disadvantage],
    bonuses: [...e1.modifiers, ...e3.modifiers],
    ...(cond.autoFail && { autoFail: cond.autoFail }),
  });
}

/**
 * An ability check made in combat with every mode source (conditions, features, effects, Help);
 * consumes a Help bonus for that skill. Used by Hide, Search and grapple escapes.
 */
export function combatCheck(
  state: CombatState,
  ctx: CombatContext,
  id: string,
  ability: Ability,
  skill: Skill | undefined,
  dc: number | undefined,
  opts: { requires?: ('sight' | 'hearing')[] } = {},
): { state: CombatState; result: D20TestResult } {
  const c = state.creatures[id] as Creature;
  const cond = checkModes(c, opts.requires ? { requires: opts.requires } : {}, ctx.table);
  const modes: { advantage: string[]; disadvantage: string[] }[] = [cond, effectCheckModes(c, ability), helpCheckModes(c, skill)];
  const bonuses = [...effectCheckBonuses(c, skill, ctx.rng)];
  if (isCharacter(c)) {
    const db = dbOf(ctx);
    modes.push(featureCheckModes(c, db, ability, skill));
    bonuses.push(...featureCheckBonuses(c, db, ability, skill));
  }
  const autoFail = cond.autoFail;
  const result = abilityCheck(c, ability, skill, {
    rng: ctx.rng,
    ...(dc !== undefined && { dc }),
    advantage: modes.flatMap((m) => m.advantage),
    disadvantage: modes.flatMap((m) => m.disadvantage),
    bonuses,
    ...(autoFail && { autoFail }),
  });
  const used = skill && helpCheckModes(c, skill).advantage.length ? consumeHelpCheck(c, skill) : c;
  return { state: used === c ? state : withCreature(state, used), result };
}

/** Put the Grappled condition + 'grappled_by' marker (escape DC) on `target`. */
export function grappleTarget<T extends Creature>(target: T, grapplerId: string, dc: number, table?: CombatContext['table']): { creature: T; applied: boolean } {
  const applied = applyCondition(target, { condition: 'grappled', sourceId: grapplerId }, table);
  if (!applied.applied) return { creature: target, applied: false };
  return { creature: addEffect(applied.creature, { key: 'grappled_by', sourceId: grapplerId, data: { dc, grapplerId } }), applied: true };
}

/**
 * Apply an action's riders to `targetId` (after a hit or a failed save). `label` names the action
 * in the log. Follow-up saves are rolled once per distinct save and shared by its riders.
 */
export function applyActionRiders(
  state: CombatState,
  ctx: CombatContext,
  sourceId: string,
  targetId: string,
  riders: readonly ActionRider[],
  label: string,
): { state: CombatState; events: CombatEvent[] } {
  const events: CombatEvent[] = [];
  let next = state;
  const saved = new Map<string, boolean>();
  for (const r of riders) {
    const target = next.creatures[targetId];
    if (!target || target.dead) break;
    if (r.maxSize && SIZES.indexOf(target.size) > SIZES.indexOf(r.maxSize)) continue;
    if (r.excludeTypes?.includes(target.creatureType)) continue;
    if (r.save) {
      const key = `${r.save.ability}:${r.save.dc}`;
      if (!saved.has(key)) {
        const s = combatSave(next, ctx, targetId, r.save.ability, r.save.dc);
        saved.set(key, s.success === true);
        events.push({ kind: 'save', actorId: sourceId, targetId, text: `${target.name} ${ABILITY_NAME[r.save.ability]} save vs ${label}: ${s.text}` });
      }
      if (saved.get(key)) continue;
    }
    if (r.condition === 'grappled') {
      const g = grappleTarget(target, sourceId, r.escapeDc ?? 10, ctx.table);
      next = withCreature(next, g.creature);
      events.push({ kind: 'condition', actorId: sourceId, targetId, text: g.applied ? `${target.name} is Grappled (${label}, escape DC ${r.escapeDc ?? 10}).` : `${target.name} can't be Grappled.` });
      continue;
    }
    const res = applyCondition(
      target,
      {
        condition: r.condition,
        // Tied to the grappler so the condition ends with the grapple (see releaseFrom).
        sourceId: r.whileGrappled ? sourceId : `${sourceId}:${label}`,
        ...(r.untilEndOfNextTurn && { roundsLeft: 1 }),
        ...(r.endSave && { endSave: r.endSave }),
      },
      ctx.table,
    );
    next = withCreature(next, res.creature);
    const name = r.condition[0]!.toUpperCase() + r.condition.slice(1);
    events.push({ kind: 'condition', actorId: sourceId, targetId, text: res.applied ? `${target.name} has the ${name} condition (${label}).` : `${target.name} is immune to ${name}.` });
  }
  return { state: next, events };
}
