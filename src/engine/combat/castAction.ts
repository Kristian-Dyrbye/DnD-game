/**
 * Spells and class-feature actions on the battle map (Build Prompt §6, §10). Wraps the pure
 * rules-level `castSpell` / `useFeatureAction` with the combat action economy (Action / Bonus
 * Action from the spell's casting time or the feature's cost), range (Touch = 5 ft, Self = the
 * caster) and line of sight, then folds every changed creature back into the CombatState and turns
 * the effect log into combat events. Used by the companion AI (A067); the battle-map UI can call it.
 *
 * Simplifications: spell attack rolls use effects.ts (conditions, distance) — grid-only modes such as
 * "enemy within 5 ft" and cover are applied by the AI's scoring, not the roll; the Bonus Action spell
 * rule (no other slot spell that turn) is respected by the AI, not enforced here.
 */
import type { Character, Creature } from '../core/creature';
import type { Spell } from '../data/schemas';
import type { SrdDatabase } from '../data/srd';
import { spellInfo, spellOptions, useFeatureAction, featureActions } from '../character/features';
import type { Ability } from '../rules/basics';
import type { LogEntry } from '../rules/effects';
import { castSpell, SpellError, type SlotChoice } from '../rules/spellcasting';
import { dbOf, fail, type ActionResult, type CombatContext, type CombatEvent, type CombatEventKind, type CombatState } from './combatState';
import { distanceFt, type Point } from './grid';
import { addZone, createZone, zoneStrike } from './zones';
import { hasLineOfSight } from './los';
import { spend, type EconomyKind } from './turns';

const isCharacter = (c: Creature | undefined): c is Character => !!c && c.kind === 'character' && 'classes' in c;

const LOG_KIND: Record<LogEntry['kind'], CombatEventKind> = {
  attack: 'attack',
  save: 'save',
  damage: 'damage',
  heal: 'effect',
  temp_hp: 'effect',
  condition: 'condition',
  hook: 'effect',
  info: 'info',
};

/** Spell range in feet: Touch 5, Self 0, feet as written; undefined = no limit on the map. */
export function spellRangeFt(spell: Spell): number | undefined {
  switch (spell.range.kind) {
    case 'self':
      return 0;
    case 'touch':
      return 5;
    case 'feet':
      return spell.range.amount ?? 5;
    default:
      return undefined;
  }
}

/** Action economy a spell uses in combat (undefined: reaction or longer casting times). */
export function spellEconomy(spell: Spell): 'action' | 'bonusAction' | undefined {
  return spell.castingTime.unit === 'action' ? 'action' : spell.castingTime.unit === 'bonus_action' ? 'bonusAction' : undefined;
}

/** The class a known spell is cast through and its spellcasting ability. */
export function spellcastingSource(c: Character, spell: Spell, db: SrdDatabase): { classId: string; ability: Ability } {
  const prepared = c.spellcasting?.prepared.find((p) => p.spellId === spell.id);
  const abilityOf = (classId: string): Ability | undefined => db.classes.get(classId)?.spellcasting.ability;
  const best = (): Ability => (['int', 'wis', 'cha'] as const).reduce<Ability>((a, b) => (c.abilities[b] > c.abilities[a] ? b : a), 'int');
  if (prepared) {
    const cls = prepared.classId.startsWith('feat:') ? prepared.classId.split(':')[2] : prepared.classId;
    return { classId: prepared.classId, ability: (cls ? abilityOf(cls) : undefined) ?? best() };
  }
  const own = c.classes.find((x) => spell.classes.includes(x.classId) && abilityOf(x.classId)) ?? c.classes.find((x) => abilityOf(x.classId));
  return own ? { classId: own.classId, ability: abilityOf(own.classId)! } : { classId: c.classes[0]!.classId, ability: best() };
}

/** Does the character know/prepare this spell (cantrip list or prepared list)? */
export function knowsSpell(c: Character, spellId: string): boolean {
  return !!c.spellcasting && (c.spellcasting.cantrips.includes(spellId) || c.spellcasting.prepared.some((p) => p.spellId === spellId));
}

/** Lowest slot that can cast the spell now (cantrip → 'cantrip'); undefined if none is left. */
export function lowestSlotFor(c: Character, spell: Spell): SlotChoice | undefined {
  if (spell.level === 0) return { kind: 'cantrip' };
  const sc = c.spellcasting;
  if (!sc) return undefined;
  for (let lv = spell.level; lv <= 9; lv++) if ((sc.slots[lv - 1] ?? 0) > 0) return { kind: 'slot', level: lv };
  if (sc.pact && sc.pact.current > 0 && sc.pact.level >= spell.level) return { kind: 'pact' };
  return undefined;
}

/** Spell slots (incl. pact slots) the character has left. */
export function slotsLeft(c: Character): number {
  const sc = c.spellcasting;
  return sc ? sc.slots.reduce((s, n) => s + n, 0) + (sc.pact?.current ?? 0) : 0;
}

/** Why a target can't be reached by a spell/feature of this range from where the caster stands. */
export function reachProblem(state: CombatState, casterId: string, targetId: string, rangeFt: number | undefined): string | undefined {
  if (targetId === casterId) return undefined;
  if (rangeFt === 0) return 'Only the caster can be targeted';
  const a = state.grid.tokens[casterId];
  const b = state.grid.tokens[targetId];
  if (!a || !b) return 'Both creatures must be on the battle map';
  if (rangeFt !== undefined && distanceFt(a, b) > rangeFt) return `Out of range (${distanceFt(a, b)} ft > ${rangeFt} ft)`;
  if (!hasLineOfSight(state.grid, casterId, targetId)) return 'No clear line to the target';
  return undefined;
}

function merge(state: CombatState, changed: Iterable<Creature>): CombatState {
  const creatures = { ...state.creatures };
  for (const c of changed) creatures[c.id] = c;
  return { ...state, creatures };
}

export interface CastInCombatOptions {
  casterId: string;
  spellId: string;
  targetIds: string[];
  /** Default: the lowest slot that can cast it. */
  slot?: SlotChoice;
  /** Targets come from an area template (line of effect from the origin, not the caster). */
  areaTargets?: boolean;
  /** Override the casting cost (a readied spell is released with the Reaction). */
  economy?: EconomyKind;
  /** Aimed square: where a zone spell (Web, Moonbeam, Spiritual Weapon...) is placed. */
  aim?: Point;
  /** Direction of a wall (Wall of Fire); default east. */
  direction?: Point;
}

/** Cast a known spell on the map: pays the Action/Bonus Action, checks range and line, runs its effects. */
export function castInCombat(state: CombatState, ctx: CombatContext, o: CastInCombatOptions): ActionResult<{ castAtLevel: number }> {
  const db = dbOf(ctx);
  const caster = state.creatures[o.casterId];
  if (!isCharacter(caster)) return fail(state, `${o.casterId} can't cast spells`);
  const spell = db.spells.get(o.spellId);
  if (!spell) return fail(state, `Unknown spell ${o.spellId}`);
  if (!knowsSpell(caster, spell.id)) return fail(state, `${caster.name} doesn't have ${spell.name} prepared`);
  const economy = spellEconomy(spell);
  if (!economy) return fail(state, `${spell.name} can't be cast as an action here`);
  const slot = o.slot ?? lowestSlotFor(caster, spell);
  if (!slot) return fail(state, `${caster.name} has no slot left for ${spell.name}`);
  const range = spellRangeFt(spell);
  const targets: Creature[] = [];
  const distances = new Map<string, number>();
  for (const id of o.targetIds) {
    const t = state.creatures[id];
    if (!t) return fail(state, `Unknown creature ${id}`);
    const problem = o.areaTargets ? undefined : reachProblem(state, o.casterId, id, range);
    if (problem) return fail(state, `${spell.name} → ${t.name}: ${problem}`);
    targets.push(t);
    const a = state.grid.tokens[o.casterId];
    const b = state.grid.tokens[id];
    distances.set(id, a && b ? distanceFt(a, b) : 5);
  }
  const paid = spend(state.turns, o.casterId, o.economy ?? economy, caster, ctx.table);
  if (!paid.ok) return fail(state, paid.error);
  const src = spellcastingSource(caster, spell, db);
  const level = spell.level === 0 ? 0 : slot.kind === 'slot' ? slot.level : slot.kind === 'pact' ? (caster.spellcasting?.pact?.level ?? spell.level) : spell.level;
  const opts = spellOptions(caster, db, spellInfo(spell, src.classId), level);
  try {
    const r = castSpell({
      rng: ctx.rng,
      ...(ctx.msgs && { msgs: ctx.msgs }),
      caster,
      spell,
      slot,
      ability: src.ability,
      targets,
      characterLevel: caster.classes.reduce((s, x) => s + x.level, 0),
      distances,
      ...opts,
    });
    let next = merge({ ...state, turns: paid.state }, [...r.ctx.creatures.values(), r.caster]);
    const events: CombatEvent[] = r.ctx.log.map((e) => ({ kind: LOG_KIND[e.kind], actorId: o.casterId, ...(e.targetId && { targetId: e.targetId }), text: e.text }));
    const zone = createZone(next, ctx, { caster: next.creatures[o.casterId]!, spell, ability: src.ability, levels: Math.max(0, r.castAtLevel - spell.level), ...(o.aim && { aim: o.aim }), ...(o.direction && { direction: o.direction }) });
    if (zone) {
      // Creatures caught by the casting itself aren't hit again by the zone this turn.
      const stamp = `${next.turns.round}:${next.turns.currentIndex}`;
      next = addZone(next, { ...zone, lastHit: Object.fromEntries(o.targetIds.map((id) => [id, stamp])) });
      events.push({ kind: 'effect', actorId: o.casterId, text: `${spell.name} fills the area.` });
      const firstTarget = o.targetIds.find((id) => id !== o.casterId);
      if (zone.attack && firstTarget) {
        const s = zoneStrike(next, ctx, zone.id, firstTarget);
        if (s.ok) {
          next = s.state;
          events.push(...s.events);
        } else events.push({ kind: 'info', actorId: o.casterId, text: s.error });
      }
    }
    return { ok: true, state: next, events, castAtLevel: r.castAtLevel };
  } catch (e) {
    if (e instanceof SpellError) return fail(state, e.message);
    throw e;
  }
}

export interface FeatureInCombatOptions {
  actorId: string;
  /** FeatureAction id (second_wind, lay_on_hands...). */
  actionId: string;
  targetId?: string;
  choice?: string;
}

/** Features whose target must be touched (5 ft). Others with a target use 60 ft by default. */
const TOUCH_FEATURES = new Set(['lay_on_hands']);

/** Use a class-feature action on the map: pays its cost, checks touch range, applies the result. */
export function featureInCombat(state: CombatState, ctx: CombatContext, o: FeatureInCombatOptions): ActionResult {
  const db = dbOf(ctx);
  const actor = state.creatures[o.actorId];
  if (!isCharacter(actor)) return fail(state, `${o.actorId} has no class features`);
  const found = featureActions(actor, db).find((a) => a.action.id === o.actionId);
  if (!found) return fail(state, `${actor.name} doesn't have ${o.actionId}`);
  if (found.problem) return fail(state, found.problem);
  const target = o.targetId ? state.creatures[o.targetId] : undefined;
  if (o.targetId && !target) return fail(state, `Unknown creature ${o.targetId}`);
  if (target) {
    const problem = reachProblem(state, o.actorId, target.id, TOUCH_FEATURES.has(o.actionId) ? 5 : 60);
    if (problem) return fail(state, `${found.action.name} → ${target.name}: ${problem}`);
  }
  const cost = found.action.cost;
  let turns = state.turns;
  if (cost !== 'free') {
    const paid = spend(state.turns, o.actorId, cost === 'bonus_action' ? 'bonusAction' : cost, actor, ctx.table);
    if (!paid.ok) return fail(state, paid.error);
    turns = paid.state;
  }
  const r = useFeatureAction(actor, db, o.actionId, { rng: ctx.rng, ...(target && { target }), ...(o.choice && { choice: o.choice }) });
  const next = merge({ ...state, turns }, [r.character, ...(r.others ?? [])]);
  return { ok: true, state: next, events: r.log.map((text) => ({ kind: 'action' as const, actorId: o.actorId, ...(o.targetId && { targetId: o.targetId }), text })) };
}
