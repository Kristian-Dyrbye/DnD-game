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
 *   Readied spells (held with Concentration) are not modelled yet.
 * - Grapple / Shove: replace one attack of the Attack action (or an Opportunity Attack); target at most
 *   one size larger and within 5 ft; it makes the better of a Str or Dex save vs 8 + Str mod + PB.
 *   Escaping: action, Str (Athletics) or Dex (Acrobatics) vs the same DC.
 * - `moveCreature`: walks a path, resolving Opportunity Attacks from hostile creatures whose reach
 *   the mover leaves (Reaction, melee attack; halted if the mover drops or can't move).
 */
import type { Character, Creature } from '../core/creature';
import { SKILL_ABILITY, type Ability, type Skill } from '../rules/basics';
import { addEffect, removeEffects } from '../rules/activeEffects';
import { abilityCheck, saveModifiers, savingThrow, type D20TestResult } from '../rules/checks';
import { applyCondition, canAct, checkModes, hasCondition, isCrawlOnly, removeCondition, saveModes } from '../rules/conditions';
import { effectSaveAdjustments } from '../rules/spellHooks';
import { canMakeOpportunityAttacks, effectCheckBonuses, effectCheckModes, effectSaveAdjustments3 } from '../rules/spellHooks3';
import { featureCheckBonuses, featureCheckModes, featureSaveModes } from '../character/features';
import { abilityModifier } from '../rules/basics';
import { HIDE_SOURCE, consumeHelpCheck, dodgeSaveModes, helpCheckModes, hideDc } from './actionEffects';
import { attackProfiles, canSee, findProfile, meleeReach, pushAway, resolveAttack, spendAttack, withinOneSizeLarger, type AttackKind, type AttackOutcome } from './attack';
import { areHostile, cloneGridTokens, dbOf, fail, withCreature, type ActionResult, type CombatContext, type CombatEvent, type CombatState } from './combatState';
import { distanceFt, type Point } from './grid';
import { computeCover } from './los';
import { moveAlong, type MoveMode, type OpportunityTrigger } from './movement';
import { addDash, canReact, currentId, movementLeft, setDisengaged, spend, spendMovement, type EconomyKind } from './turns';
import { effectiveSpeed } from '../rules/conditions';

const isCharacter = (c: Creature): c is Character => c.kind === 'character' && 'classes' in c;

function pay(state: CombatState, ctx: CombatContext, id: string, kind: EconomyKind): ActionResult<{ actor: Creature }> {
  const actor = state.creatures[id];
  if (!actor) return fail(state, `Unknown creature ${id}`);
  const r = spend(state.turns, id, kind, actor, ctx.table);
  if (!r.ok) return fail(state, r.error);
  return { ok: true, state: { ...state, turns: r.state }, events: [], actor };
}

const economyOf = (bonus?: boolean): EconomyKind => (bonus ? 'bonusAction' : 'action');
const verb = (bonus?: boolean) => (bonus ? 'Bonus Action' : 'action');

// ---------------------------------------------------------------- Dash, Disengage, Dodge

/** Dash: extra movement equal to your (current) Speed this turn. */
export function dash(state: CombatState, ctx: CombatContext, id: string, opts: { bonus?: boolean } = {}): ActionResult {
  const p = pay(state, ctx, id, economyOf(opts.bonus));
  if (!p.ok) return p;
  return { ok: true, state: { ...p.state, turns: addDash(p.state.turns, id) }, events: [{ kind: 'action', actorId: id, text: `${p.actor.name} Dashes (${verb(opts.bonus)}).` }] };
}

/** Disengage: no Opportunity Attacks from your movement for the rest of this turn. */
export function disengage(state: CombatState, ctx: CombatContext, id: string, opts: { bonus?: boolean } = {}): ActionResult {
  const p = pay(state, ctx, id, economyOf(opts.bonus));
  if (!p.ok) return p;
  return { ok: true, state: { ...p.state, turns: setDisengaged(p.state.turns, id) }, events: [{ kind: 'action', actorId: id, text: `${p.actor.name} Disengages (${verb(opts.bonus)}).` }] };
}

/** Dodge: until the start of your next turn, attackers you can see have Disadvantage; Advantage on Dex saves. */
export function dodge(state: CombatState, ctx: CombatContext, id: string, opts: { bonus?: boolean } = {}): ActionResult {
  const p = pay(state, ctx, id, economyOf(opts.bonus));
  if (!p.ok) return p;
  const actor = addEffect(removeEffects(p.actor, (e) => e.key === 'dodge'), { key: 'dodge', sourceId: id, expires: { on: 'start_of_turn', creatureId: id, skip: 0 } });
  return { ok: true, state: withCreature(p.state, actor), events: [{ kind: 'action', actorId: id, text: `${actor.name} takes the Dodge action.` }] };
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
  const expires = { on: 'start_of_turn' as const, creatureId: id, skip: 0 };
  if (opts.mode === 'attack') {
    const target = state.creatures[opts.targetId];
    const a = state.grid.tokens[id];
    const t = state.grid.tokens[opts.targetId];
    if (!target || !a || !t || target.dead) return fail(state, 'No such enemy on the map');
    if (!areHostile(state, ctx, id, opts.targetId)) return fail(state, `${target.name} isn't an enemy`);
    if (distanceFt(a, t) > 5) return fail(state, `${target.name} must be within 5 ft to distract it`);
    const p = pay(state, ctx, id, 'action');
    if (!p.ok) return p;
    const marked = addEffect(target, { key: 'help_attack', sourceId: id, expires, data: { helperId: id } });
    return { ok: true, state: withCreature(p.state, marked), events: [{ kind: 'action', actorId: id, targetId: target.id, text: `${helper.name} distracts ${target.name}: the next ally attack against it has Advantage.` }] };
  }
  const ally = state.creatures[opts.allyId];
  if (!ally || ally.dead || opts.allyId === id) return fail(state, 'Choose another creature to help');
  if (areHostile(state, ctx, id, opts.allyId)) return fail(state, `${ally.name} isn't an ally`);
  if (!proficientIn(helper, opts.skill)) return fail(state, `${helper.name} isn't proficient in ${opts.skill}`);
  const p = pay(state, ctx, id, 'action');
  if (!p.ok) return p;
  const marked = addEffect(ally, { key: 'help_check', sourceId: id, expires, data: { skill: opts.skill } });
  return { ok: true, state: withCreature(p.state, marked), events: [{ kind: 'action', actorId: id, targetId: ally.id, text: `${helper.name} helps ${ally.name} with ${opts.skill}: Advantage on the next check.` }] };
}

// ---------------------------------------------------------------- ability checks in combat

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

/** A saving throw with condition, effect, feature and Dodge modes (Grapple/Shove saves). */
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

// ---------------------------------------------------------------- Hide and Search

export interface HideOptions {
  /** The hider stands in a Heavily Obscured area (darkness, fog...): cover isn't needed. */
  heavilyObscured?: boolean;
}

/** Why the creature can't try to hide right now, or undefined if it can. */
export function hideProblem(state: CombatState, ctx: CombatContext, id: string, opts: HideOptions = {}): string | undefined {
  const me = state.creatures[id];
  if (!me || !state.grid.tokens[id]) return 'Not on the map';
  for (const t of Object.values(state.grid.tokens)) {
    const enemy = state.creatures[t.id];
    if (!enemy || enemy.dead || !areHostile(state, ctx, id, t.id)) continue;
    if (!canSee(state, ctx, enemy, me)) continue;
    if (opts.heavilyObscured && !enemy.senses.blindsight && !enemy.senses.truesight) continue;
    const cover = computeCover(state.grid, t.id, id).cover;
    if (cover === 'three_quarters' || cover === 'total') continue;
    return `${enemy.name} can see ${me.name} (needs Heavy Obscurement or Three-Quarters Cover)`;
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
  const events: CombatEvent[] = [{ kind: 'check', actorId: id, text: `${p.actor.name} tries to Hide — Stealth: ${rolled.result.text}` }];
  const success = rolled.result.success === true;
  if (success) {
    let c = next.creatures[id] as Creature;
    c = removeEffects(removeCondition(c, 'invisible', HIDE_SOURCE), (e) => e.key === 'hidden');
    c = applyCondition(c, { condition: 'invisible', sourceId: HIDE_SOURCE }, ctx.table).creature;
    c = addEffect(c, { key: 'hidden', sourceId: id, data: { stealthTotal: rolled.result.total } });
    next = withCreature(next, c);
    events.push({ kind: 'condition', actorId: id, text: `${c.name} is hidden (Invisible; DC ${rolled.result.total} to find).` });
  }
  return { ok: true, state: next, events, success, check: rolled.result };
}

/** Search action aimed at a hidden creature: Wisdom (Perception) vs its Stealth total; success reveals it. */
export function searchFor(state: CombatState, ctx: CombatContext, id: string, hiddenId: string): ActionResult<{ found: boolean }> {
  const hidden = state.creatures[hiddenId];
  const dc = hidden ? hideDc(hidden) : undefined;
  if (!hidden || dc === undefined) return fail(state, 'That creature isn\'t hidden');
  const p = pay(state, ctx, id, 'action');
  if (!p.ok) return p;
  const rolled = combatCheck(p.state, ctx, id, 'wis', 'perception', dc, { requires: ['sight'] });
  let next = rolled.state;
  const found = rolled.result.success === true;
  const events: CombatEvent[] = [{ kind: 'check', actorId: id, targetId: hiddenId, text: `${p.actor.name} searches for ${hidden.name} — Perception: ${rolled.result.text}` }];
  if (found) {
    const revealed = removeCondition(removeEffects(next.creatures[hiddenId] as Creature, (e) => e.key === 'hidden'), 'invisible', HIDE_SOURCE);
    next = withCreature(next, revealed);
    events.push({ kind: 'condition', targetId: hiddenId, text: `${hidden.name} is found and no longer hidden.` });
  }
  return { ok: true, state: next, events, found };
}

// ---------------------------------------------------------------- Ready

export type ReadiedAction =
  | { kind: 'attack'; targetId?: string; profileId?: string }
  | { kind: 'move' }
  | { kind: 'other'; description: string };

export function readiedOf(c: Creature): { trigger: string; action: ReadiedAction } | undefined {
  const e = c.effects.find((x) => x.key === 'readied');
  return e ? { trigger: String(e.data.trigger), action: e.data.action as ReadiedAction } : undefined;
}

/** Ready: choose a perceivable trigger and the response; resolved later with `triggerReadied`. */
export function ready(state: CombatState, ctx: CombatContext, id: string, trigger: string, action: ReadiedAction): ActionResult {
  const p = pay(state, ctx, id, 'action');
  if (!p.ok) return p;
  const actor = addEffect(removeEffects(p.actor, (e) => e.key === 'readied'), {
    key: 'readied',
    sourceId: id,
    expires: { on: 'start_of_turn', creatureId: id, skip: 0 },
    data: { trigger, action },
  });
  return { ok: true, state: withCreature(p.state, actor), events: [{ kind: 'action', actorId: id, text: `${actor.name} readies: "${trigger}".` }] };
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
  opts: { targetId?: string } = {},
): ActionResult<{ readied: ReadiedAction; attack?: AttackOutcome }> {
  const c = state.creatures[id];
  const r = c ? readiedOf(c) : undefined;
  if (!c || !r) return fail(state, 'Nothing readied');
  const cleared = (s: CombatState) => withCreature(s, removeEffects(s.creatures[id] as Creature, (e) => e.key === 'readied'));
  if (r.action.kind === 'attack') {
    const targetId = opts.targetId ?? r.action.targetId;
    if (!targetId) return fail(state, 'Choose a target for the readied attack');
    const a = resolveAttack(state, ctx, { attackerId: id, targetId, kind: 'reaction', ...(r.action.profileId && { profile: r.action.profileId }) });
    if (!a.ok) return a;
    const { ok: _ok, state: s, events, ...outcome } = a;
    return { ok: true, state: cleared(s), events: [{ kind: 'action', actorId: id, text: `${c.name}'s readied action triggers: "${r.trigger}".` }, ...events], readied: r.action, attack: outcome };
  }
  const p = pay(state, ctx, id, 'reaction');
  if (!p.ok) return p;
  return { ok: true, state: cleared(p.state), events: [{ kind: 'action', actorId: id, text: `${c.name}'s readied action triggers: "${r.trigger}".` }], readied: r.action };
}

// ---------------------------------------------------------------- Grapple and Shove

export interface UnarmedOptionOpts {
  /** 'action' (one attack of the Attack action, default), 'opportunity', 'reaction' or 'free'. */
  kind?: Extract<AttackKind, 'action' | 'opportunity' | 'reaction' | 'free'>;
  /** Grapple needs a free hand. Default true. */
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
  if (!attacker || !target || !at || !tt || target.dead || attackerId === targetId) return fail(state, 'Invalid target');
  if (distanceFt(at, tt) > 5) return fail(state, `${target.name} must be within 5 ft`);
  if (!withinOneSizeLarger(attacker, target)) return fail(state, `${target.name} is too large to ${what.toLowerCase()}`);
  if (what === 'Grapple' && opts.handFree === false) return fail(state, 'Grappling needs a free hand');
  const paid = spendAttack(state.turns, ctx, attacker, opts.kind ?? 'action');
  if (!paid.ok) return fail(state, paid.error);
  attacker = paid.attacker;
  const next = { ...withCreature(state, attacker), turns: paid.turns };
  const dc = 8 + abilityModifier(attacker.abilities.str) + attacker.proficiencyBonus;
  const ability = betterSave(next, ctx, targetId);
  const save = combatSave(next, ctx, targetId, ability, dc);
  const events: CombatEvent[] = [{ kind: 'save', actorId: attackerId, targetId, text: `${attacker.name} tries to ${what} ${target.name} — ${save.text}` }];
  return { ok: true, state: next, events, attacker, target, save, dc };
}

/** Unarmed Strike (Grapple): on a failed save the target is Grappled (escape DC = the save DC). */
export function grapple(state: CombatState, ctx: CombatContext, attackerId: string, targetId: string, opts: UnarmedOptionOpts = {}): ActionResult<{ success: boolean }> {
  const r = unarmedOption(state, ctx, attackerId, targetId, 'Grapple', opts);
  if (!r.ok) return r;
  if (r.save.success) return { ok: true, state: r.state, events: r.events, success: false };
  const applied = applyCondition(r.target, { condition: 'grappled', sourceId: attackerId }, ctx.table);
  if (!applied.applied) return { ok: true, state: r.state, events: [...r.events, { kind: 'condition', targetId, text: `${r.target.name} can't be Grappled.` }], success: false };
  const marked = addEffect(applied.creature, { key: 'grappled_by', sourceId: attackerId, data: { dc: r.dc, grapplerId: attackerId } });
  return {
    ok: true,
    state: withCreature(r.state, marked),
    events: [...r.events, { kind: 'condition', actorId: attackerId, targetId, text: `${r.target.name} is Grappled by ${r.attacker.name} (escape DC ${r.dc}).` }],
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
    return { ok: true, state: withCreature(r.state, applied.creature), events: [...r.events, { kind: 'condition', targetId, text: applied.applied ? `${r.target.name} is knocked Prone.` : `${r.target.name} can't be knocked Prone.` }], success: applied.applied };
  }
  const pushed = pushAway(r.state.grid, attackerId, targetId, 5);
  return { ok: true, state: { ...r.state, grid: pushed.grid }, events: [...r.events, { kind: 'move', targetId, text: `${r.target.name} is shoved ${pushed.movedFt} ft.` }], success: pushed.movedFt > 0 };
}

/** Escape a grapple: action, Str (Athletics) or Dex (Acrobatics) vs the escape DC (default: the better one). */
export function escapeGrapple(state: CombatState, ctx: CombatContext, id: string, opts: { skill?: 'athletics' | 'acrobatics' } = {}): ActionResult<{ success: boolean }> {
  const c = state.creatures[id];
  const g = c?.effects.find((e) => e.key === 'grappled_by');
  if (!c || !g || !hasCondition(c, 'grappled', ctx.table)) return fail(state, `${c?.name ?? id} isn't Grappled`);
  const p = pay(state, ctx, id, 'action');
  if (!p.ok) return p;
  const dc = typeof g.data.dc === 'number' ? g.data.dc : 10;
  const bonus = (s: Skill) => abilityModifier(c.abilities[SKILL_ABILITY[s]]) + (proficientIn(c, s) ? c.proficiencyBonus : 0);
  const skill = opts.skill ?? (bonus('acrobatics') > bonus('athletics') ? 'acrobatics' : 'athletics');
  const rolled = combatCheck(p.state, ctx, id, SKILL_ABILITY[skill], skill, dc);
  const success = rolled.result.success === true;
  const events: CombatEvent[] = [{ kind: 'check', actorId: id, text: `${c.name} tries to escape the grapple — ${rolled.result.text}` }];
  let next = rolled.state;
  if (success) {
    next = withCreature(next, releaseFrom(next.creatures[id] as Creature, g.sourceId ?? ''));
    events.push({ kind: 'condition', actorId: id, text: `${c.name} escapes.` });
  }
  return { ok: true, state: next, events, success };
}

function releaseFrom<T extends Creature>(c: T, grapplerId: string): T {
  return removeCondition(removeEffects(c, (e) => e.key === 'grappled_by' && e.sourceId === grapplerId), 'grappled', grapplerId);
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
      events.push({ kind: 'condition', targetId: c.id, text: `${c.name} is no longer Grappled.` });
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
}

/**
 * Move along `path` (top-left squares after the start), resolving Opportunity Attacks before the
 * steps that leave a hostile creature's reach. Movement stops early if the mover drops to 0 HP,
 * becomes Incapacitated, its Speed drops to 0, or it is pushed off its path.
 */
export function moveCreature(state: CombatState, ctx: CombatContext, id: string, path: readonly Point[], opts: MoveOptions = {}): ActionResult<{ movedFt: number; halted: boolean; triggers: OpportunityTrigger[] }> {
  const mover = state.creatures[id];
  if (!mover || !state.grid.tokens[id]) return fail(state, `Unknown creature ${id}`);
  if (!mover.dead && mover.hp <= 0) return fail(state, `${mover.name} is down`);
  const db = dbOf(ctx);
  const budgetFt = opts.reactionMove ? effectiveSpeed(mover, ctx.table) : currentId(state.turns) === id && state.turns.turnActive ? movementLeft(state.turns, id, mover, { ...(opts.mode && { mode: opts.mode }), ...(ctx.table && { table: ctx.table }) }) : 0;
  if (budgetFt <= 0) return fail(state, `${mover.name} has no movement left`);
  const disengaged = !opts.reactionMove && (state.turns.budgets[id]?.disengaged ?? false);

  const grid = cloneGridTokens(state.grid);
  let cur: CombatState = { ...state, grid };
  const events: CombatEvent[] = [];
  let displaced = false;
  const result = moveAlong(grid, id, path, {
    budgetFt,
    disengaged,
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
        events.push({ kind: 'action', actorId: t.attackerId, targetId: id, text: `${attacker.name} makes an Opportunity Attack against ${cur.creatures[id]?.name ?? id}.` });
        const a = resolveAttack(cur, ctx, { attackerId: t.attackerId, targetId: id, kind: 'opportunity', profile });
        if (!a.ok) {
          events.push({ kind: 'info', actorId: t.attackerId, text: a.error });
          continue;
        }
        events.push(...a.events);
        cur = a.state;
        if (cur.grid !== grid) displaced = true;
      }
      const m = cur.creatures[id];
      if (displaced || !m || m.dead || m.hp <= 0 || !canAct(m, ctx.table) || effectiveSpeed(m, ctx.table) <= 0) return false;
      const pos = grid.tokens[id];
      return !!pos && pos.x === step.from.x && pos.y === step.from.y;
    },
  });
  if (!result.ok) return fail(state, result.error ?? 'Illegal move');
  if (!displaced) cur = { ...cur, grid };
  if (!opts.reactionMove && result.costFt > 0) {
    const m = cur.creatures[id] as Creature;
    const s = spendMovement(cur.turns, id, Math.min(result.costFt, movementLeft(cur.turns, id, m, { ...(opts.mode && { mode: opts.mode }), ...(ctx.table && { table: ctx.table }) })), m, {
      ...(opts.mode && { mode: opts.mode }),
      ...(ctx.table && { table: ctx.table }),
    });
    if (s.ok) cur = { ...cur, turns: s.state };
  }
  events.push({ kind: 'move', actorId: id, text: `${mover.name} moves ${result.costFt} ft${result.halted ? ' and is stopped' : ''}.` });
  return { ok: true, state: cur, events, movedFt: result.costFt, halted: result.halted, triggers: result.triggers };
}

/** Convenience: an Opportunity Attack outside of `moveCreature` (e.g. a creature leaving reach via a readied move). */
export function opportunityAttack(state: CombatState, ctx: CombatContext, attackerId: string, targetId: string, profile?: string): ActionResult<AttackOutcome> {
  const a = state.creatures[attackerId];
  if (!a || !canMakeOpportunityAttacks(a)) return fail(state, `${a?.name ?? attackerId} can't make Opportunity Attacks`);
  const p = profile ?? findProfile(a, dbOf(ctx))?.id;
  return resolveAttack(state, ctx, { attackerId, targetId, kind: 'opportunity', ...(p && { profile: p }) });
}
