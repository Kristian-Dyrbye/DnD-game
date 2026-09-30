/**
 * The remaining SRD 5.2.1 actions on the battle map (Rules Glossary: Study, Influence, Utilize,
 * Magic [Action]).
 *
 * - Study: Action; an Intelligence check (Arcana, History, Investigation, Nature or Religion) to
 *   recall or work out something. The caller supplies the DC (default 15, "medium") and uses the result.
 * - Influence: Action; Deception, Intimidation, Performance, Persuasion or Animal Handling against a
 *   creature that can perceive you. Default DC = 15 or the target's Intelligence score, whichever
 *   is higher. The caller decides what success means (a monster stops fighting, hesitates…).
 * - Utilize: Action; use a nonmagical object (pull a lever, light a torch). Logged only.
 * - Magic: use a magic item with automated effects. Potions take a Bonus Action ("Drinking or
 *   administering a potion takes a Bonus Action"), other items the Magic action; a potion can be
 *   given to a creature within 5 ft and is used up. Casting spells is castInCombat.
 */
import type { Character, Creature } from '../core/creature';
import { removeItem } from '../character/inventory';
import type { Skill } from '../rules/basics';
import { canAct } from '../rules/conditions';
import { createEffectContext, executeEffects } from '../rules/effects';
import { combatCheck } from './actions';
import { dbOf, fail, type ActionResult, type CombatContext, type CombatEvent, type CombatState, msgsOf } from './combatState';
import { distanceFt } from './grid';
import { spend, type EconomyKind } from './turns';

export const STUDY_SKILLS = ['arcana', 'history', 'investigation', 'nature', 'religion'] as const satisfies readonly Skill[];
export const INFLUENCE_SKILLS = ['deception', 'intimidation', 'performance', 'persuasion', 'animal_handling'] as const satisfies readonly Skill[];
export type StudySkill = (typeof STUDY_SKILLS)[number];
export type InfluenceSkill = (typeof INFLUENCE_SKILLS)[number];

const INFLUENCE_ABILITY = { deception: 'cha', intimidation: 'cha', performance: 'cha', persuasion: 'cha', animal_handling: 'wis' } as const;

function payFor(state: CombatState, ctx: CombatContext, id: string, kind: EconomyKind): ActionResult<{ actor: Creature }> {
  const actor = state.creatures[id];
  if (!actor || actor.dead) return fail(state, `Unknown creature ${id}`);
  if (!canAct(actor, ctx.table)) return fail(state, msgsOf(ctx).m('turn.incapacitated', { name: actor.name }));
  const r = spend(state.turns, id, kind, actor, ctx.table, msgsOf(ctx));
  if (!r.ok) return fail(state, r.error);
  return { ok: true, state: { ...state, turns: r.state }, events: [], actor };
}

/** Study: an Intelligence check with a knowledge/investigation skill (no topic: "the foes and the battlefield"). */
export function study(state: CombatState, ctx: CombatContext, id: string, opts: { skill: StudySkill; topic?: string; dc?: number }): ActionResult<{ success: boolean }> {
  const p = payFor(state, ctx, id, 'action');
  if (!p.ok) return p;
  const r = combatCheck(p.state, ctx, id, 'int', opts.skill, opts.dc ?? 15);
  const { m } = msgsOf(ctx);
  return {
    ok: true,
    state: r.state,
    events: [{ kind: 'check', actorId: id, text: m('other.studies', { name: p.actor.name, topic: opts.topic ?? m('other.studyTopic'), roll: r.result.text }) }],
    success: r.result.success === true,
  };
}

/** Influence: a social check against a creature within earshot/sight (60 ft, line of sight not required). */
export function influence(
  state: CombatState,
  ctx: CombatContext,
  id: string,
  targetId: string,
  opts: { skill: InfluenceSkill; dc?: number },
): ActionResult<{ success: boolean; dc: number }> {
  const target = state.creatures[targetId];
  const a = state.grid.tokens[id];
  const b = state.grid.tokens[targetId];
  const { m } = msgsOf(ctx);
  if (!target || target.dead || !a || !b || targetId === id) return fail(state, m('act.invalidTarget'));
  if (distanceFt(a, b) > 60) return fail(state, m('other.tooFar', { name: target.name }));
  const p = payFor(state, ctx, id, 'action');
  if (!p.ok) return p;
  const dc = opts.dc ?? Math.max(15, target.abilities.int);
  const r = combatCheck(p.state, ctx, id, INFLUENCE_ABILITY[opts.skill], opts.skill, dc);
  return {
    ok: true,
    state: r.state,
    events: [{ kind: 'check', actorId: id, targetId, text: m('other.influences', { name: p.actor.name, target: target.name, roll: r.result.text }) }],
    success: r.result.success === true,
    dc,
  };
}

/** Utilize: use a nonmagical object (the effect is up to the caller). */
export function utilize(state: CombatState, ctx: CombatContext, id: string, what: string): ActionResult {
  const p = payFor(state, ctx, id, 'action');
  if (!p.ok) return p;
  return { ok: true, state: p.state, events: [{ kind: 'action', actorId: id, text: msgsOf(ctx).m('other.uses', { name: p.actor.name, what }) }] };
}

/** Magic items the character carries whose effects are automated (potions of healing…). */
export function usableMagicItems(c: Creature, ctx: CombatContext): { uid: string; itemId: string; name: string; bonusAction: boolean }[] {
  if (c.kind !== 'character' || !('inventory' in c)) return [];
  const db = dbOf(ctx);
  return (c as Character).inventory.flatMap((i) => {
    const m = db.magicItems.get(i.itemId);
    return m?.effects?.length && i.quantity > 0 ? [{ uid: i.uid, itemId: i.itemId, name: m.name, bonusAction: m.category === 'potion' }] : [];
  });
}

/** Magic: use a carried magic item (potion: Bonus Action, drink or give within 5 ft; used up). */
export function useMagicItem(state: CombatState, ctx: CombatContext, id: string, uid: string, targetId: string = id): ActionResult {
  const user = state.creatures[id];
  const { m } = msgsOf(ctx);
  if (!user || user.kind !== 'character' || !('inventory' in user)) return fail(state, m('other.noItems', { name: user?.name ?? id }));
  const entry = (user as Character).inventory.find((i) => i.uid === uid);
  const item = entry ? dbOf(ctx).magicItems.get(entry.itemId) : undefined;
  if (!entry || !item) return fail(state, m('other.noItem'));
  if (!item.effects?.length) return fail(state, m('other.noEffect', { item: item.name }));
  const potion = item.category === 'potion';
  const target = state.creatures[targetId];
  if (!target || target.dead) return fail(state, m('act.invalidTarget'));
  if (targetId !== id) {
    const a = state.grid.tokens[id];
    const b = state.grid.tokens[targetId];
    if (!potion) return fail(state, m('other.selfOnly', { item: item.name }));
    if (!a || !b || distanceFt(a, b) > 5) return fail(state, m('other.giveWithin', { name: target.name, item: item.name }));
  }
  const p = payFor(state, ctx, id, potion ? 'bonusAction' : 'action');
  if (!p.ok) return p;

  let owner: Character = { ...(user as Character), inventory: (user as Character).inventory.map((i) => ({ ...i })) };
  if (potion) {
    removeItem(owner, uid, 1);
  }
  const ectx = createEffectContext({ rng: ctx.rng, ...(ctx.msgs && { msgs: ctx.msgs }), source: owner, targets: targetId === id ? [] : [target] });
  executeEffects(item.effects, [targetId], ectx);
  const creatures = { ...p.state.creatures };
  for (const [cid, c] of ectx.creatures) creatures[cid] = c;
  const line = !potion
    ? m('other.uses', { name: user.name, what: item.name })
    : targetId === id
      ? m('other.drinks', { name: user.name, item: item.name })
      : m('other.gives', { name: user.name, target: target.name, item: item.name });
  const events: CombatEvent[] = [
    { kind: 'action', actorId: id, ...(targetId !== id && { targetId }), text: line },
    ...ectx.log.map((l): CombatEvent => ({ kind: 'effect', actorId: id, ...(l.targetId && { targetId: l.targetId }), text: l.text })),
  ];
  return { ok: true, state: { ...p.state, creatures }, events };
}
