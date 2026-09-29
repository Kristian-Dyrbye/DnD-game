/**
 * Single-target save actions from stat blocks (Build Prompt §10): Constrict, Dreadful Glare,
 * Paralyzing Tentacles… — "_Strength Saving Throw:_ DC 14, one Large or smaller creature the snake
 * can see within 10 feet. _Failure:_ …".
 *
 * Cost: one attack of the Attack action when the Multiattack names it ("makes one Bite attack and
 * uses Constrict"), otherwise the Action. Range from "within N feet" (5 if unstated), line of sight
 * required; "one creature Grappled by the X" needs the target to be grappled by the user. Failure:
 * the save damage (half on a success when the text says so) and the action's riders
 * (see rules/monsters.ts actionRiders). Recharge / per-day uses are spent.
 */
import type { Creature } from '../core/creature';
import { rollDamage } from '../rules/damage';
import { actionAvailable, actionRiders, isSingleTargetSave, multiattackSequence, saveActionRange, spendAction } from '../rules/monsters';
import { dealCombatDamage, spendAttack } from './attack';
import { reachProblem } from './castAction';
import { dbOf, fail, withCreature, type ActionResult, type CombatContext, type CombatEvent, type CombatState } from './combatState';
import { applyActionRiders, combatSave } from './saves';
import { setAttacksLeft, spend } from './turns';

type MonsterAction = NonNullable<ReturnType<typeof monsterActionOf>>;

/** The named action of a creature's stat block (actions, then bonus actions). */
export function monsterActionOf(c: Creature, ctx: CombatContext, name: string) {
  const m = c.statBlockId ? dbOf(ctx).monsters.get(c.statBlockId) : undefined;
  return m?.actions.find((a) => a.name === name) ?? m?.bonusActions.find((a) => a.name === name);
}

/** Single-target save actions the creature can use now. */
export function saveActions(c: Creature, ctx: CombatContext): MonsterAction[] {
  const m = c.statBlockId ? dbOf(ctx).monsters.get(c.statBlockId) : undefined;
  return (m?.actions ?? []).filter((a) => isSingleTargetSave(a) && actionAvailable(c, a));
}

/** Save actions the Multiattack uses alongside its attacks, in order (e.g. ['Constrict']). */
export function multiattackSaveActions(c: Creature, ctx: CombatContext): string[] {
  const m = c.statBlockId ? dbOf(ctx).monsters.get(c.statBlockId) : undefined;
  if (!m) return [];
  return multiattackSequence(m).filter((name) => {
    const a = m.actions.find((x) => x.name === name);
    return !!a && isSingleTargetSave(a);
  });
}

/** Why `targetId` can't be the target of this save action, or undefined. */
export function saveActionProblem(state: CombatState, ctx: CombatContext, actorId: string, action: MonsterAction, targetId: string): string | undefined {
  const target = state.creatures[targetId];
  if (!target || target.dead) return 'Invalid target';
  if (targetId === actorId) return `${action.name} targets another creature`;
  if (/one creature Grappled by the/i.test(action.text) && !target.effects.some((e) => e.key === 'grappled_by' && e.sourceId === actorId)) {
    return `${target.name} must be Grappled by the user of ${action.name}`;
  }
  return reachProblem(state, actorId, targetId, saveActionRange(action));
}

/** Use a single-target save action on `targetId` (see module doc). */
export function monsterSaveAction(state: CombatState, ctx: CombatContext, actorId: string, actionName: string, targetId: string): ActionResult<{ saved: boolean; damage: number }> {
  const actor = state.creatures[actorId];
  if (!actor) return fail(state, `Unknown creature ${actorId}`);
  const action = monsterActionOf(actor, ctx, actionName);
  if (!action || !isSingleTargetSave(action)) return fail(state, `${actor.name} has no save action ${actionName}`);
  if (!actionAvailable(actor, action)) return fail(state, `${action.name} isn't available (recharging or used up)`);
  const problem = saveActionProblem(state, ctx, actorId, action, targetId);
  if (problem) return fail(state, `${action.name}: ${problem}`);

  // Economy: part of the Attack action when the Multiattack names it, else the whole Action.
  let next: CombatState;
  if (multiattackSaveActions(actor, ctx).includes(action.name)) {
    const paid = spendAttack(state.turns, ctx, actor, 'action');
    if (!paid.ok) return fail(state, paid.error);
    next = { ...withCreature(state, paid.attacker), turns: paid.turns };
  } else {
    const paid = spend(state.turns, actorId, 'action', actor, ctx.table);
    if (!paid.ok) return fail(state, paid.error);
    next = { ...state, turns: setAttacksLeft(paid.state, actorId, 0) };
  }
  next = withCreature(next, spendAction(next.creatures[actorId] as Creature, action));

  const save = action.save!;
  const target = next.creatures[targetId] as Creature;
  const s = combatSave(next, ctx, targetId, save.ability, save.dc);
  const events: CombatEvent[] = [{ kind: 'save', actorId, targetId, text: `${actor.name} uses ${action.name} on ${target.name} — ${s.text}` }];
  let damage = 0;
  if (save.damage?.length && (!s.success || save.halfOnSuccess)) {
    const rolled = rollDamage(ctx.rng, save.damage);
    const half = s.success;
    const d = dealCombatDamage(
      next,
      ctx,
      actorId,
      targetId,
      rolled.parts.map((p) => ({ amount: half ? Math.floor(p.total / 2) : p.total, type: p.type })),
      { text: `${rolled.text}${half ? ' (half)' : ''}` },
    );
    next = d.state;
    damage = d.dealt;
    events.push(...d.events);
  }
  if (!s.success) {
    const r = applyActionRiders(next, ctx, actorId, targetId, actionRiders(action), action.name);
    next = r.state;
    events.push(...r.events);
  }
  return { ok: true, state: next, events, saved: s.success === true, damage };
}
