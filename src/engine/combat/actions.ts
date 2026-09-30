/**
 * Combat actions other than the attack roll itself (Build Prompt §10; SRD 5.2.1 Rules Glossary:
 * Dash, Disengage, Dodge, Help, Hide, Ready, Search, Unarmed Strike (Grapple / Shove), Grappling,
 * Opportunity Attacks). Every function takes the plain `CombatState` and returns a new one plus
 * log events; nothing is mutated.
 *
 * - Dash / Disengage: Action, or Bonus Action when a feature allows it (`bonus: true`, e.g. Cunning Action).
 * - Dodge: 'dodge' effect until the start of your next turn (see actionEffects).
 * - Help: assist an attack (an enemy within 5 ft) or an ability check (an ally; you need proficiency
 *   in the chosen skill); benefit expires at the start of your next turn.
 * - Hide: needs Heavily Obscured or Three-Quarters/Total Cover against, and to be out of line of
 *   sight of, every enemy that could see you; DC 15 Dexterity (Stealth); success → Invisible
 *   (source 'hide') with the check total recorded as the DC to find you.
 * - Search (for a hidden creature): Wisdom (Perception) vs the recorded Stealth total.
 * - Ready: stores a trigger + readied response; `triggerReadied` spends the Reaction to resolve it.
 *   A readied spell (casting time of an action) is cast on Ready (its slot is spent) and held with
 *   Concentration; if Concentration ends first (damage, a new concentration spell, the next turn)
 *   the spell is lost. Released with the Reaction; targets are chosen then.
 * - Grapple / Shove: replace one attack of the Attack action (or an Opportunity Attack); target at most
 *   one size larger and within 5 ft; it makes the better of a Str or Dex save vs 8 + Str mod + PB.
 *   Escaping: action, Str (Athletics) or Dex (Acrobatics) vs the same DC. Characters grapple one
 *   creature per free hand (weapons, shields and current grapples fill hands); stat blocks aren't limited.
 * - Dragging: `moveCreature` with `drag` moves creatures you grapple along; every foot costs 1 extra
 *   foot unless the dragged creature is Tiny or two or more sizes smaller than you.
 * - `moveCreature`: walks a path, resolving Opportunity Attacks from hostile creatures whose reach
 *   the mover leaves (Reaction, melee attack; halted if the mover drops or can't move).
 */
import type { Character, Creature } from '../core/creature';
import { SIZES, SKILL_ABILITY, type Ability, type Skill } from '../rules/basics';
import { addEffect, removeEffects } from '../rules/activeEffects';
import { abilityCheck, saveModifiers, type D20TestResult } from '../rules/checks';
import { applyCondition, canAct, checkModes, hasCondition, isCrawlOnly, removeCondition, saveModes } from '../rules/conditions';
import { canMakeOpportunityAttacks, effectCheckBonuses, effectCheckModes } from '../rules/spellHooks3';
import { featureCheckBonuses, featureCheckModes } from '../character/features';
import { abilityModifier } from '../rules/basics';
import { HIDE_SOURCE, consumeHelpCheck, dodgeSaveModes, helpCheckModes, hideDc } from './actionEffects';
import { attackProfiles, canSee, findProfile, meleeReach, pushAway, resolveAttack, spendAttack, withinOneSizeLarger, type AttackKind, type AttackOutcome } from './attack';
import { areHostile, cloneGridTokens, dbOf, fail, withCreature, type ActionResult, type CombatContext, type CombatEvent, type CombatState, msgsOf } from './combatState';
import { canPlace, distanceFt, moveToken, type Grid, type Point } from './grid';
import { computeCover } from './los';
import { moveAlong, reachableSquares, type MoveMode, type OpportunityTrigger, type ReachableSquare } from './movement';
import { addDash, canReact, currentId, movementLeft, setDisengaged, spend, spendMovement, type EconomyKind } from './turns';
import { effectiveSpeed } from '../rules/conditions';
import { combatCheck, combatSave, grappleTarget } from './saves';
import { endConcentration, expendSlot, slotProblem, type SlotChoice } from '../rules/spellcasting';
import type { SpellcastingState } from '../core/creature';
import { castInCombat, knowsSpell, lowestSlotFor, spellEconomy } from './castAction';
import { zoneMembership, zonesAfterMove } from './zones';

const isCharacter = (c: Creature): c is Character => c.kind === 'character' && 'classes' in c;

function pay(state: CombatState, ctx: CombatContext, id: string, kind: EconomyKind): ActionResult<{ actor: Creature }> {
  const actor = state.creatures[id];
  if (!actor) return fail(state, `Unknown creature ${id}`);
  const r = spend(state.turns, id, kind, actor, ctx.table, msgsOf(ctx));
  if (!r.ok) return fail(state, r.error);
  return { ok: true, state: { ...state, turns: r.state }, events: [], actor };
}

const economyOf = (bonus?: boolean): EconomyKind => (bonus ? 'bonusAction' : 'action');
const verb = (ctx: CombatContext, bonus?: boolean) => msgsOf(ctx).m(bonus ? 'act.economy.bonus' : 'act.economy.action');

// ---------------------------------------------------------------- Dash, Disengage, Dodge

/** Dash: extra movement equal to your (current) Speed this turn. */
export function dash(state: CombatState, ctx: CombatContext, id: string, opts: { bonus?: boolean } = {}): ActionResult {
  const p = pay(state, ctx, id, economyOf(opts.bonus));
  if (!p.ok) return p;
  return { ok: true, state: { ...p.state, turns: addDash(p.state.turns, id) }, events: [{ kind: 'action', actorId: id, text: msgsOf(ctx).m('act.dash', { name: p.actor.name, economy: verb(ctx, opts.bonus) }) }] };
}

/** Disengage: no Opportunity Attacks from your movement for the rest of this turn. */
export function disengage(state: CombatState, ctx: CombatContext, id: string, opts: { bonus?: boolean } = {}): ActionResult {
  const p = pay(state, ctx, id, economyOf(opts.bonus));
  if (!p.ok) return p;
  return { ok: true, state: { ...p.state, turns: setDisengaged(p.state.turns, id) }, events: [{ kind: 'action', actorId: id, text: msgsOf(ctx).m('act.disengage', { name: p.actor.name, economy: verb(ctx, opts.bonus) }) }] };
}

/** Dodge: until the start of your next turn, attackers you can see have Disadvantage; Advantage on Dex saves. */
export function dodge(state: CombatState, ctx: CombatContext, id: string, opts: { bonus?: boolean } = {}): ActionResult {
  const p = pay(state, ctx, id, economyOf(opts.bonus));
  if (!p.ok) return p;
  const actor = addEffect(removeEffects(p.actor, (e) => e.key === 'dodge'), { key: 'dodge', sourceId: id, expires: { on: 'start_of_turn', creatureId: id, skip: 0 } });
  return { ok: true, state: withCreature(p.state, actor), events: [{ kind: 'action', actorId: id, text: msgsOf(ctx).m('act.dodge', { name: actor.name }) }] };
}

// ---------------------------------------------------------------- Help

export type HelpOptions = { mode: 'attack'; targetId: string } | { mode: 'check'; allyId: string; skill: Skill };

function proficientIn(c: Creature, skill: Skill): boolean {
  const level = c.skills[skill];
  return (level !== undefined && level !== 'none' && level !== 'half') || c.skillBonuses?.[skill] !== undefined;
}

export function help(state: CombatState, ctx: CombatContext, id: string, opts: HelpOptions): ActionResult {
  const helper = state.creatures[id];
  if (!helper) return fail(state, `Unknown creature ${id}`);
  const { m } = msgsOf(ctx);
  const expires = { on: 'start_of_turn' as const, creatureId: id, skip: 0 };
  if (opts.mode === 'attack') {
    const target = state.creatures[opts.targetId];
    const a = state.grid.tokens[id];
    const t = state.grid.tokens[opts.targetId];
    if (!target || !a || !t || target.dead) return fail(state, m('act.noEnemy'));
    if (!areHostile(state, ctx, id, opts.targetId)) return fail(state, m('act.notEnemy', { name: target.name }));
    if (distanceFt(a, t) > 5) return fail(state, m('act.distractFar', { name: target.name }));
    const p = pay(state, ctx, id, 'action');
    if (!p.ok) return p;
    const marked = addEffect(target, { key: 'help_attack', sourceId: id, expires, data: { helperId: id } });
    return { ok: true, state: withCreature(p.state, marked), events: [{ kind: 'action', actorId: id, targetId: target.id, text: m('act.distracts', { helper: helper.name, target: target.name }) }] };
  }
  const ally = state.creatures[opts.allyId];
  if (!ally || ally.dead || opts.allyId === id) return fail(state, m('act.chooseAlly'));
  if (areHostile(state, ctx, id, opts.allyId)) return fail(state, m('act.notAlly', { name: ally.name }));
  if (!proficientIn(helper, opts.skill)) return fail(state, m('act.notProficient', { name: helper.name, skill: opts.skill }));
  const p = pay(state, ctx, id, 'action');
  if (!p.ok) return p;
  const marked = addEffect(ally, { key: 'help_check', sourceId: id, expires, data: { skill: opts.skill } });
  return { ok: true, state: withCreature(p.state, marked), events: [{ kind: 'action', actorId: id, targetId: ally.id, text: m('act.helps', { helper: helper.name, ally: ally.name, skill: opts.skill }) }] };
}

export { combatCheck, combatSave } from './saves';

// ---------------------------------------------------------------- Hide and Search

export interface HideOptions {
  /** The hider stands in a Heavily Obscured area (darkness, fog...): cover isn't needed. */
  heavilyObscured?: boolean;
}

/** Why the creature can't try to hide right now, or undefined if it can. */
export function hideProblem(state: CombatState, ctx: CombatContext, id: string, opts: HideOptions = {}): string | undefined {
  const me = state.creatures[id];
  const { m } = msgsOf(ctx);
  if (!me || !state.grid.tokens[id]) return m('act.notOnMap');
  for (const t of Object.values(state.grid.tokens)) {
    const enemy = state.creatures[t.id];
    if (!enemy || enemy.dead || !areHostile(state, ctx, id, t.id)) continue;
    if (!canSee(state, ctx, enemy, me)) continue;
    if (opts.heavilyObscured && !enemy.senses.blindsight && !enemy.senses.truesight) continue;
    const cover = computeCover(state.grid, t.id, id).cover;
    if (cover === 'three_quarters' || cover === 'total') continue;
    return m('act.seen', { enemy: enemy.name, name: me.name });
  }
  return undefined;
}

/** Hide action: DC 15 Dexterity (Stealth). Success → Invisible while hidden; the total is the DC to find you. */
export function hide(state: CombatState, ctx: CombatContext, id: string, opts: HideOptions & { bonus?: boolean } = {}): ActionResult<{ success: boolean; check: D20TestResult }> {
  const problem = hideProblem(state, ctx, id, opts);
  if (problem) return fail(state, problem);
  const p = pay(state, ctx, id, economyOf(opts.bonus));
  if (!p.ok) return p;
  const rolled = combatCheck(p.state, ctx, id, 'dex', 'stealth', 15);
  let next = rolled.state;
  const events: CombatEvent[] = [{ kind: 'check', actorId: id, text: msgsOf(ctx).m('act.hideTries', { name: p.actor.name, roll: rolled.result.text }) }];
  const success = rolled.result.success === true;
  if (success) {
    let c = next.creatures[id] as Creature;
    c = removeEffects(removeCondition(c, 'invisible', HIDE_SOURCE), (e) => e.key === 'hidden');
    c = applyCondition(c, { condition: 'invisible', sourceId: HIDE_SOURCE }, ctx.table).creature;
    c = addEffect(c, { key: 'hidden', sourceId: id, data: { stealthTotal: rolled.result.total } });
    next = withCreature(next, c);
    events.push({ kind: 'condition', actorId: id, text: msgsOf(ctx).m('act.hidden', { name: c.name, dc: rolled.result.total }) });
  }
  return { ok: true, state: next, events, success, check: rolled.result };
}

/** Search action aimed at a hidden creature: Wisdom (Perception) vs its Stealth total; success reveals it. */
export function searchFor(state: CombatState, ctx: CombatContext, id: string, hiddenId: string): ActionResult<{ found: boolean }> {
  const hidden = state.creatures[hiddenId];
  const dc = hidden ? hideDc(hidden) : undefined;
  if (!hidden || dc === undefined) return fail(state, msgsOf(ctx).m('act.notHidden'));
  const p = pay(state, ctx, id, 'action');
  if (!p.ok) return p;
  const rolled = combatCheck(p.state, ctx, id, 'wis', 'perception', dc, { requires: ['sight'] });
  let next = rolled.state;
  const found = rolled.result.success === true;
  const events: CombatEvent[] = [{ kind: 'check', actorId: id, targetId: hiddenId, text: msgsOf(ctx).m('act.searches', { name: p.actor.name, target: hidden.name, roll: rolled.result.text }) }];
  if (found) {
    const revealed = removeCondition(removeEffects(next.creatures[hiddenId] as Creature, (e) => e.key === 'hidden'), 'invisible', HIDE_SOURCE);
    next = withCreature(next, revealed);
    events.push({ kind: 'condition', targetId: hiddenId, text: msgsOf(ctx).m('act.found', { name: hidden.name }) });
  }
  return { ok: true, state: next, events, found };
}

// ---------------------------------------------------------------- Ready

export type ReadiedAction =
  | { kind: 'attack'; targetId?: string; profileId?: string }
  | { kind: 'move' }
  | { kind: 'spell'; spellId: string; slot?: SlotChoice }
  | { kind: 'other'; description: string };

/** Concentration source id that marks a held (readied) spell. */
const heldSourceId = (casterId: string, spellId: string): string => `${casterId}:readied:${spellId}`;

/** Is the caster still holding this readied spell with Concentration? */
export function holdsReadiedSpell(c: Creature, spellId: string): boolean {
  return c.kind === 'character' && (c as Character).spellcasting?.concentration?.sourceId === heldSourceId(c.id, spellId);
}

function slotBack(sc: SpellcastingState, slot: SlotChoice): SpellcastingState {
  if (slot.kind === 'slot') return { ...sc, slots: sc.slots.map((n, i) => (i === slot.level - 1 ? n + 1 : n)) };
  if (slot.kind === 'pact' && sc.pact) return { ...sc, pact: { ...sc.pact, current: sc.pact.current + 1 } };
  return sc;
}

/** Cast a spell into the Ready action: spend its slot now and start holding it with Concentration. */
function holdSpell(state: CombatState, ctx: CombatContext, id: string, action: Extract<ReadiedAction, { kind: 'spell' }>): ActionResult<{ action: ReadiedAction }> {
  const c = state.creatures[id];
  const { m } = msgsOf(ctx);
  if (!c || c.kind !== 'character' || !(c as Character).spellcasting) return fail(state, m('act.cantCast', { name: c?.name ?? id }));
  const caster = c as Character;
  const spell = dbOf(ctx).spells.get(action.spellId);
  if (!spell) return fail(state, `Unknown spell ${action.spellId}`);
  if (!knowsSpell(caster, spell.id)) return fail(state, m('act.notPrepared', { name: caster.name, spell: spell.name }));
  if (spellEconomy(spell) !== 'action') return fail(state, m('act.readyActionOnly'));
  const slot = action.slot ?? lowestSlotFor(caster, spell);
  if (!slot) return fail(state, m('act.noSlot', { name: caster.name, spell: spell.name }));
  const problem = slotProblem(spell, slot, caster.spellcasting, msgsOf(ctx));
  if (problem) return fail(state, problem);
  let next = state;
  const events: CombatEvent[] = [];
  if (caster.spellcasting!.concentration) {
    const map = new Map(Object.entries(state.creatures));
    const ended = endConcentration({ creatures: map }, id);
    next = { ...state, creatures: Object.fromEntries(map) };
    if (ended) events.push({ kind: 'info', actorId: id, text: m('act.stopsConcentrating', { name: caster.name, spell: ended }) });
  }
  const now = next.creatures[id] as Character;
  const held: Character = {
    ...now,
    spellcasting: {
      ...expendSlot(now.spellcasting!, slot),
      // Two ticks: survives the end of this turn and is gone by the end of the next one.
      concentration: { spellId: spell.id, sourceId: heldSourceId(id, spell.id), targetIds: [], roundsLeft: 2 },
    },
  };
  return { ok: true, state: withCreature(next, held), events, action: { ...action, slot } };
}

export function readiedOf(c: Creature): { trigger: string; action: ReadiedAction } | undefined {
  const e = c.effects.find((x) => x.key === 'readied');
  return e ? { trigger: String(e.data.trigger), action: e.data.action as ReadiedAction } : undefined;
}

/** Ready: choose a perceivable trigger and the response; resolved later with `triggerReadied`. */
export function ready(state: CombatState, ctx: CombatContext, id: string, trigger: string, action: ReadiedAction): ActionResult {
  const p = pay(state, ctx, id, 'action');
  if (!p.ok) return p;
  let base = p.state;
  let actorNow = p.actor;
  let held: ReadiedAction = action;
  const events: CombatEvent[] = [];
  if (action.kind === 'spell') {
    if (!canAct(p.actor, ctx.table)) return fail(state, msgsOf(ctx).m('turn.incapacitated', { name: p.actor.name }));
    const h = holdSpell(p.state, ctx, id, action);
    if (!h.ok) return fail(state, h.error);
    base = h.state;
    actorNow = h.state.creatures[id] as Creature;
    events.push(...h.events);
    held = h.action;
  }
  const actor = addEffect(removeEffects(actorNow, (e) => e.key === 'readied'), {
    key: 'readied',
    sourceId: id,
    expires: { on: 'start_of_turn', creatureId: id, skip: 0 },
    data: { trigger, action: held },
  });
  const { m } = msgsOf(ctx);
  const what = held.kind === 'spell' ? m('act.heldSpell', { spell: dbOf(ctx).spells.get(held.spellId)?.name ?? held.spellId }) : '';
  return { ok: true, state: withCreature(base, actor), events: [...events, { kind: 'action', actorId: id, text: m('act.readies', { name: actor.name, what, trigger }) }] };
}

/**
 * The trigger happened: spend the Reaction and use the readied response. A readied attack is
 * resolved here (one attack, no Extra Attack); 'move'/'other' are returned for the caller to carry
 * out (a readied move uses `moveCreature(..., { reactionMove: true })`).
 */
export function triggerReadied(
  state: CombatState,
  ctx: CombatContext,
  id: string,
  opts: { targetId?: string; targetIds?: string[] } = {},
): ActionResult<{ readied: ReadiedAction; attack?: AttackOutcome }> {
  const c = state.creatures[id];
  const r = c ? readiedOf(c) : undefined;
  const { m } = msgsOf(ctx);
  if (!c || !r) return fail(state, m('act.nothingReadied'));
  const cleared = (s: CombatState) => withCreature(s, removeEffects(s.creatures[id] as Creature, (e) => e.key === 'readied'));
  if (r.action.kind === 'attack') {
    const targetId = opts.targetId ?? r.action.targetId;
    if (!targetId) return fail(state, m('act.readyTarget'));
    const a = resolveAttack(state, ctx, { attackerId: id, targetId, kind: 'reaction', ...(r.action.profileId && { profile: r.action.profileId }) });
    if (!a.ok) return a;
    const { ok: _ok, state: s, events, ...outcome } = a;
    return { ok: true, state: cleared(s), events: [{ kind: 'action', actorId: id, text: m('act.readyTriggers', { name: c.name, trigger: r.trigger }) }, ...events], readied: r.action, attack: outcome };
  }
  if (r.action.kind === 'spell') {
    const spellName = dbOf(ctx).spells.get(r.action.spellId)?.name ?? r.action.spellId;
    if (!holdsReadiedSpell(c, r.action.spellId)) {
      return { ok: true, state: cleared(state), events: [{ kind: 'info', actorId: id, text: m('act.readyLost', { name: c.name, spell: spellName }) }], readied: r.action };
    }
    const targetIds = opts.targetIds ?? (opts.targetId ? [opts.targetId] : []);
    const slot: SlotChoice = r.action.slot ?? { kind: 'cantrip' };
    // The slot was spent on Ready: give it back and cast for real with the Reaction.
    const caster = c as Character;
    const { concentration: _held, ...rest } = caster.spellcasting!;
    const refunded: Character = { ...caster, spellcasting: slotBack(rest, slot) };
    const cast = castInCombat(withCreature(state, refunded), ctx, { casterId: id, spellId: r.action.spellId, targetIds, slot, economy: 'reaction' });
    if (!cast.ok) return fail(state, cast.error);
    return { ok: true, state: cleared(cast.state), events: [{ kind: 'action', actorId: id, text: m('act.readySpellTriggers', { name: c.name, spell: spellName, trigger: r.trigger }) }, ...cast.events], readied: r.action };
  }
  const p = pay(state, ctx, id, 'reaction');
  if (!p.ok) return p;
  return { ok: true, state: cleared(p.state), events: [{ kind: 'action', actorId: id, text: m('act.readyTriggers', { name: c.name, trigger: r.trigger }) }], readied: r.action };
}

// ---------------------------------------------------------------- Grapple and Shove

export interface UnarmedOptionOpts {
  /** 'action' (one attack of the Attack action, default), 'opportunity', 'reaction' or 'free'. */
  kind?: Extract<AttackKind, 'action' | 'opportunity' | 'reaction' | 'free'>;
  /** Grapple needs a free hand. Default: counted from the grappler's gear and grapples (see freeHands). */
  handFree?: boolean;
}

/** The target picks the better of its Strength and Dexterity saves (avoiding automatic failures). */
function betterSave(state: CombatState, ctx: CombatContext, id: string): Ability {
  const c = state.creatures[id] as Creature;
  const score = (a: Ability) => {
    const m = saveModes(c, a, ctx.table);
    if (m.autoFail) return -100;
    const adv = m.advantage.length + dodgeSaveModes(c, a, ctx.table).advantage.length > 0 ? 3 : 0;
    const dis = m.disadvantage.length > 0 ? 3 : 0;
    return saveModifiers(c, a).reduce((s, x) => s + x.value, 0) + adv - dis;
  };
  return score('dex') > score('str') ? 'dex' : 'str';
}

function unarmedOption(
  state: CombatState,
  ctx: CombatContext,
  attackerId: string,
  targetId: string,
  what: 'Grapple' | 'Shove',
  opts: UnarmedOptionOpts,
): ActionResult<{ attacker: Creature; target: Creature; save: D20TestResult; dc: number }> {
  let attacker = state.creatures[attackerId];
  const target = state.creatures[targetId];
  const at = state.grid.tokens[attackerId];
  const tt = state.grid.tokens[targetId];
  const { m } = msgsOf(ctx);
  if (!attacker || !target || !at || !tt || target.dead || attackerId === targetId) return fail(state, m('act.invalidTarget'));
  if (distanceFt(at, tt) > 5) return fail(state, m('act.within5', { name: target.name }));
  if (!withinOneSizeLarger(attacker, target)) return fail(state, m(`act.tooLarge.${what}`, { name: target.name }));
  if (what === 'Grapple' && !(opts.handFree ?? freeHands(state, ctx, attacker) > 0)) return fail(state, m('act.freeHand'));
  const paid = spendAttack(state.turns, ctx, attacker, opts.kind ?? 'action');
  if (!paid.ok) return fail(state, paid.error);
  attacker = paid.attacker;
  const next = { ...withCreature(state, attacker), turns: paid.turns };
  const dc = 8 + abilityModifier(attacker.abilities.str) + attacker.proficiencyBonus;
  const ability = betterSave(next, ctx, targetId);
  const save = combatSave(next, ctx, targetId, ability, dc);
  const events: CombatEvent[] = [{ kind: 'save', actorId: attackerId, targetId, text: m(`act.tries.${what}`, { name: attacker.name, target: target.name, roll: save.text }) }];
  return { ok: true, state: next, events, attacker, target, save, dc };
}

/** Creatures currently Grappled by `grapplerId`. */
export function grappledBy(state: CombatState, grapplerId: string): string[] {
  return Object.values(state.creatures)
    .filter((c) => c.effects.some((e) => e.key === 'grappled_by' && e.sourceId === grapplerId))
    .map((c) => c.id);
}

/**
 * Free hands of a character: 2 minus hands holding equipped weapons (two-handed ones take both) or
 * a shield, minus creatures it is grappling. Stat blocks have no hand limit (Infinity).
 */
export function freeHands(state: CombatState, ctx: CombatContext, c: Creature): number {
  if (c.kind !== 'character' || !('inventory' in c)) return Infinity;
  const db = dbOf(ctx);
  let used = 0;
  for (const i of (c as Character).inventory) {
    if (i.equipped === 'main_hand') used += db.weapons.get(i.itemId)?.properties.includes('two_handed') ? 2 : 1;
    else if (i.equipped === 'off_hand' || i.equipped === 'shield') used += 1;
  }
  return Math.max(0, 2 - used - grappledBy(state, c.id).length);
}

/** Unarmed Strike (Grapple): on a failed save the target is Grappled (escape DC = the save DC). */
export function grapple(state: CombatState, ctx: CombatContext, attackerId: string, targetId: string, opts: UnarmedOptionOpts = {}): ActionResult<{ success: boolean }> {
  const r = unarmedOption(state, ctx, attackerId, targetId, 'Grapple', opts);
  if (!r.ok) return r;
  if (r.save.success) return { ok: true, state: r.state, events: r.events, success: false };
  const applied = grappleTarget(r.target, attackerId, r.dc, ctx.table);
  if (!applied.applied) return { ok: true, state: r.state, events: [...r.events, { kind: 'condition', targetId, text: msgsOf(ctx).m('act.cantGrapple', { name: r.target.name }) }], success: false };
  const marked = applied.creature;
  return {
    ok: true,
    state: withCreature(r.state, marked),
    events: [...r.events, { kind: 'condition', actorId: attackerId, targetId, text: msgsOf(ctx).m('act.grappled', { target: r.target.name, name: r.attacker.name, dc: r.dc }) }],
    success: true,
  };
}

/** Unarmed Strike (Shove): on a failed save, push the target 5 ft away or knock it Prone. */
export function shove(
  state: CombatState,
  ctx: CombatContext,
  attackerId: string,
  targetId: string,
  opts: UnarmedOptionOpts & { effect: 'push' | 'prone' },
): ActionResult<{ success: boolean }> {
  const r = unarmedOption(state, ctx, attackerId, targetId, 'Shove', opts);
  if (!r.ok) return r;
  if (r.save.success) return { ok: true, state: r.state, events: r.events, success: false };
  if (opts.effect === 'prone') {
    const applied = applyCondition(r.target, { condition: 'prone' }, ctx.table);
    return { ok: true, state: withCreature(r.state, applied.creature), events: [...r.events, { kind: 'condition', targetId, text: msgsOf(ctx).m(applied.applied ? 'act.prone' : 'act.cantProne', { name: r.target.name }) }], success: applied.applied };
  }
  const pushed = pushAway(r.state.grid, attackerId, targetId, 5);
  return { ok: true, state: { ...r.state, grid: pushed.grid }, events: [...r.events, { kind: 'move', targetId, text: msgsOf(ctx).m('act.shoved', { name: r.target.name, ft: pushed.movedFt }) }], success: pushed.movedFt > 0 };
}

/** Escape a grapple: action, Str (Athletics) or Dex (Acrobatics) vs the escape DC (default: the better one). */
export function escapeGrapple(state: CombatState, ctx: CombatContext, id: string, opts: { skill?: 'athletics' | 'acrobatics' } = {}): ActionResult<{ success: boolean }> {
  const c = state.creatures[id];
  const g = c?.effects.find((e) => e.key === 'grappled_by');
  if (!c || !g || !hasCondition(c, 'grappled', ctx.table)) return fail(state, msgsOf(ctx).m('act.notGrappled', { name: c?.name ?? id }));
  const p = pay(state, ctx, id, 'action');
  if (!p.ok) return p;
  const dc = typeof g.data.dc === 'number' ? g.data.dc : 10;
  const bonus = (s: Skill) => abilityModifier(c.abilities[SKILL_ABILITY[s]]) + (proficientIn(c, s) ? c.proficiencyBonus : 0);
  const skill = opts.skill ?? (bonus('acrobatics') > bonus('athletics') ? 'acrobatics' : 'athletics');
  const rolled = combatCheck(p.state, ctx, id, SKILL_ABILITY[skill], skill, dc);
  const success = rolled.result.success === true;
  const events: CombatEvent[] = [{ kind: 'check', actorId: id, text: msgsOf(ctx).m('act.escapeTries', { name: c.name, roll: rolled.result.text }) }];
  let next = rolled.state;
  if (success) {
    next = withCreature(next, releaseFrom(next.creatures[id] as Creature, g.sourceId ?? ''));
    events.push({ kind: 'condition', actorId: id, text: msgsOf(ctx).m('act.escapes', { name: c.name }) });
  }
  return { ok: true, state: next, events, success };
}

/** Ends a grapple and every condition tied to it (conditions sourced to the grappler itself). */
function releaseFrom<T extends Creature>(c: T, grapplerId: string): T {
  const freed = removeCondition(removeEffects(c, (e) => e.key === 'grappled_by' && e.sourceId === grapplerId), 'grappled', grapplerId);
  return { ...freed, conditions: freed.conditions.filter((x) => x.sourceId !== grapplerId) };
}

/** The grappler lets go (no action required). */
export function releaseGrapple(state: CombatState, grapplerId: string, targetId: string): CombatState {
  const t = state.creatures[targetId];
  return t ? withCreature(state, releaseFrom(t, grapplerId)) : state;
}

/**
 * Grapples end when the grappler is Incapacitated or the target is farther away than the
 * grappler's reach (5 ft). Call after movement/conditions change (e.g. at each turn boundary).
 */
export function settleGrapples(state: CombatState, ctx: CombatContext): { state: CombatState; events: CombatEvent[] } {
  let next = state;
  const events: CombatEvent[] = [];
  for (const c of Object.values(state.creatures)) {
    for (const e of c.effects.filter((x) => x.key === 'grappled_by')) {
      const grappler = e.sourceId ? state.creatures[e.sourceId] : undefined;
      const gt = e.sourceId ? state.grid.tokens[e.sourceId] : undefined;
      const tt = state.grid.tokens[c.id];
      const broken = !grappler || grappler.dead || !canAct(grappler, ctx.table) || !gt || !tt || distanceFt(gt, tt) > 5;
      if (!broken) continue;
      next = withCreature(next, releaseFrom(next.creatures[c.id] as Creature, e.sourceId ?? ''));
      events.push({ kind: 'condition', targetId: c.id, text: msgsOf(ctx).m('act.grappleEnds', { name: c.name }) });
    }
  }
  return { state: next, events };
}

// ---------------------------------------------------------------- movement with Opportunity Attacks

export interface MoveOptions {
  mode?: MoveMode;
  /** Readied movement on someone else's turn: budget = Speed, no own-turn movement spent. */
  reactionMove?: boolean;
  /** Which attack each Opportunity attacker uses (profile id); default its first melee attack. */
  oaProfile?: (attackerId: string) => string | undefined;
  /** Whether a creature takes its Opportunity Attack (AI/player choice). Default: yes. */
  takeOpportunity?: (attackerId: string, targetId: string) => boolean;
  /** Creatures the mover grapples and drags along (they end next to the mover). */
  drag?: readonly string[];
}

/**
 * Squares the creature can walk to this turn under exactly the rules `moveCreature` uses (movement
 * left, crawling while Prone, dragging at double cost, passing Incapacitated creatures), so previews
 * (the battle map, AI helpers, tests) never offer a move that will be refused.
 */
export function reachableForMove(state: CombatState, ctx: CombatContext, id: string, opts: { drag?: readonly string[] } = {}): Map<string, ReachableSquare> {
  const mover = state.creatures[id];
  if (!mover || !state.grid.tokens[id]) return new Map();
  const left = movementLeft(state.turns, id, mover, ctx.table ? { table: ctx.table } : {});
  const drag = opts.drag ?? [];
  const costFactor = drag.some((d) => state.creatures[d] && dragDoublesCost(mover, state.creatures[d]!)) ? 2 : 1;
  return reachableSquares(state.grid, id, Math.floor(left / costFactor), {
    isHostile: (a, b) => areHostile(state, ctx, a, b),
    isIncapacitated: (x) => {
      const c = state.creatures[x];
      return !!c && (!canAct(c, ctx.table) || c.dead);
    },
    crawling: isCrawlOnly(mover, ctx.table),
    ...(drag.length && { ignore: drag }),
  });
}

/** Dragging costs 1 extra foot per foot unless the creature is Tiny or 2+ sizes smaller than the mover. */
export function dragDoublesCost(mover: Creature, dragged: Creature): boolean {
  return dragged.size !== 'tiny' && SIZES.indexOf(mover.size) - SIZES.indexOf(dragged.size) < 2;
}

/**
 * Put a dragged creature next to the mover: the squares the mover left (latest first), then any
 * free square within 5 ft of the mover closest to where the dragged creature was.
 */
function placeDragged(grid: Grid, moverId: string, draggedId: string, trail: readonly Point[]): boolean {
  const m = grid.tokens[moverId];
  const d = grid.tokens[draggedId];
  if (!m || !d) return false;
  const near = (p: Point) => distanceFt(m, { ...d, x: p.x, y: p.y }) <= 5;
  const fits = (p: Point) => near(p) && canPlace(grid, d.size, p, [draggedId]);
  const around: Point[] = [];
  for (let y = m.y - 3; y <= m.y + 3; y++) for (let x = m.x - 3; x <= m.x + 3; x++) around.push({ x, y });
  around.sort((a, b) => Math.hypot(a.x - d.x, a.y - d.y) - Math.hypot(b.x - d.x, b.y - d.y));
  const spot = [...[...trail].reverse(), ...around].find(fits);
  if (!spot) return false;
  moveToken(grid, draggedId, spot);
  return true;
}

/**
 * Move along `path` (top-left squares after the start), resolving Opportunity Attacks before the
 * steps that leave a hostile creature's reach. Movement stops early if the mover drops to 0 HP,
 * becomes Incapacitated, its Speed drops to 0, or it is pushed off its path.
 */
export function moveCreature(state: CombatState, ctx: CombatContext, id: string, path: readonly Point[], opts: MoveOptions = {}): ActionResult<{ movedFt: number; halted: boolean; triggers: OpportunityTrigger[] }> {
  const mover = state.creatures[id];
  if (!mover || !state.grid.tokens[id]) return fail(state, `Unknown creature ${id}`);
  const { m } = msgsOf(ctx);
  if (!mover.dead && mover.hp <= 0) return fail(state, m('act.isDown', { name: mover.name }));
  const db = dbOf(ctx);
  const budgetFt = opts.reactionMove ? effectiveSpeed(mover, ctx.table) : currentId(state.turns) === id && state.turns.turnActive ? movementLeft(state.turns, id, mover, { ...(opts.mode && { mode: opts.mode }), ...(ctx.table && { table: ctx.table }) }) : 0;
  if (budgetFt <= 0) return fail(state, m('act.noMovement', { name: mover.name }));
  const drag = opts.drag ?? [];
  for (const d of drag) {
    const c = state.creatures[d];
    if (!c || !state.grid.tokens[d] || !c.effects.some((e) => e.key === 'grappled_by' && e.sourceId === id)) return fail(state, m('act.notGrappling', { name: mover.name, target: c?.name ?? d }));
  }
  const costFactor = drag.some((d) => dragDoublesCost(mover, state.creatures[d] as Creature)) ? 2 : 1;
  const trail: Point[] = [];
  const disengaged = !opts.reactionMove && (state.turns.budgets[id]?.disengaged ?? false);

  const zonesBefore = state.zones?.length ? zoneMembership(state) : undefined;
  const grid = cloneGridTokens(state.grid);
  let cur: CombatState = { ...state, grid };
  const events: CombatEvent[] = [];
  let displaced = false;
  const result = moveAlong(grid, id, path, {
    budgetFt: Math.floor(budgetFt / costFactor),
    disengaged,
    msgs: msgsOf(ctx),
    ...(drag.length > 0 && { ignore: drag }),
    crawling: isCrawlOnly(mover, ctx.table) && (opts.mode ?? 'walk') === 'walk',
    isHostile: (a, b) => areHostile(cur, ctx, a, b),
    isIncapacitated: (x) => {
      const c = cur.creatures[x];
      return !!c && (!canAct(c, ctx.table) || c.dead);
    },
    reachOf: (x) => {
      const c = cur.creatures[x];
      return c ? meleeReach(c, db) : 0;
    },
    canReact: (x) => {
      const c = cur.creatures[x];
      return !!c && !c.dead && canReact(cur.turns, x, c, ctx.table) && canMakeOpportunityAttacks(c) && meleeReach(c, db) > 0 && (opts.takeOpportunity?.(x, id) ?? true);
    },
    canSee: (a, b) => {
      const ca = cur.creatures[a];
      const cb = cur.creatures[b];
      return !!ca && !!cb && canSee(cur, ctx, ca, cb);
    },
    beforeStep: (step, _i, triggers) => {
      for (const t of triggers) {
        const attacker = cur.creatures[t.attackerId];
        if (!attacker) continue;
        const profile = opts.oaProfile?.(t.attackerId) ?? attackProfiles(attacker, db).find((p) => p.melee)?.id;
        if (!profile) continue;
        events.push({ kind: 'action', actorId: t.attackerId, targetId: id, text: m('act.oa', { attacker: attacker.name, target: cur.creatures[id]?.name ?? id }) });
        const a = resolveAttack(cur, ctx, { attackerId: t.attackerId, targetId: id, kind: 'opportunity', profile });
        if (!a.ok) {
          events.push({ kind: 'info', actorId: t.attackerId, text: a.error });
          continue;
        }
        events.push(...a.events);
        cur = a.state;
        if (cur.grid !== grid) displaced = true;
      }
      const now = cur.creatures[id];
      if (displaced || !now || now.dead || now.hp <= 0 || !canAct(now, ctx.table) || effectiveSpeed(now, ctx.table) <= 0) return false;
      const pos = grid.tokens[id];
      const onPath = !!pos && pos.x === step.from.x && pos.y === step.from.y;
      if (onPath) trail.push({ ...step.from });
      return onPath;
    },
  });
  if (!result.ok) return fail(state, result.error ?? m('act.illegalMove'));
  if (!displaced) cur = { ...cur, grid };
  const draggedNames: string[] = [];
  if (!displaced && result.stepsTaken > 0) {
    for (const d of drag) if (placeDragged(grid, id, d, trail.slice(0, result.stepsTaken))) draggedNames.push(cur.creatures[d]?.name ?? d);
  }
  const spentFt = result.costFt * costFactor;
  if (!opts.reactionMove && spentFt > 0) {
    const now = cur.creatures[id] as Creature;
    const s = spendMovement(cur.turns, id, Math.min(spentFt, movementLeft(cur.turns, id, now, { ...(opts.mode && { mode: opts.mode }), ...(ctx.table && { table: ctx.table }) })), now, {
      ...(opts.mode && { mode: opts.mode }),
      ...(ctx.table && { table: ctx.table }),
      msgs: msgsOf(ctx),
    });
    if (s.ok) cur = { ...cur, turns: s.state };
  }
  if (zonesBefore && result.stepsTaken > 0) {
    const z = zonesAfterMove(cur, ctx, zonesBefore, { id, path: path.slice(0, result.stepsTaken) });
    cur = z.state;
    events.push(...z.events);
  }
  const dragText = draggedNames.length > 0 ? m('act.dragging', { names: draggedNames.join(m('ai.and')) }) : '';
  events.push({ kind: 'move', actorId: id, text: m('act.moves', { name: mover.name, ft: spentFt, drag: dragText, stopped: result.halted ? m('act.stopped') : '' }) });
  return { ok: true, state: cur, events, movedFt: spentFt, halted: result.halted, triggers: result.triggers };
}

/** Convenience: an Opportunity Attack outside of `moveCreature` (e.g. a creature leaving reach via a readied move). */
export function opportunityAttack(state: CombatState, ctx: CombatContext, attackerId: string, targetId: string, profile?: string): ActionResult<AttackOutcome> {
  const a = state.creatures[attackerId];
  if (!a || !canMakeOpportunityAttacks(a)) return fail(state, msgsOf(ctx).m('act.noOa', { name: a?.name ?? attackerId }));
  const p = profile ?? findProfile(a, dbOf(ctx))?.id;
  return resolveAttack(state, ctx, { attackerId, targetId, kind: 'opportunity', ...(p && { profile: p }) });
}
