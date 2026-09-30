/**
 * Deterministic scoring helpers for combat AI (Build Prompt §10: "Enemy AI is deterministic and
 * based on stat blocks, with simple tactical behaviors (focus on weak targets, use abilities, flee
 * when morale breaks where appropriate)"). Shared by the enemy AI (ai.ts) and companion AI (A067).
 *
 * - Expected damage: hit chance from the d20 (ranks 2–19 by the target number, nat 1 misses, nat 20
 *   hits; Advantage/Disadvantage squared) × average dice damage adjusted by the target's
 *   immunities / resistances / vulnerabilities. Saves: fail chance (no nat-1/20 rule for saves in the
 *   2024 rules) × full damage + success chance × half when the effect halves.
 * - Target ranking (`rankTargets`): conscious targets before downed ones. Beasts (Int ≤ 3) take the
 *   closest; everything else focuses the weakest: lowest current HP, lowest AC, Bloodied, closest, id.
 *   Intelligent creatures (Int ≥ 8) first avoid a Dodging target and prefer a concentrating caster,
 *   then any spellcaster.
 * - Morale (`moraleCheck`): the SRD 5.2.1 has no morale rule; fleeing is a DM judgement call, so this
 *   is a deliberately simple, data-driven guideline (`MoraleRule`). A monster flees when it is Bloodied
 *   (≤ half HP) and its side has lost its leader or at least half its members, or when it is at
 *   ≤ 25% HP with Int ≥ 6. Fearless creatures never flee: undead, constructs, creatures immune to
 *   Frightened and mindless ones (Int ≤ 3). Characters (companions) never flee by morale here.
 * No randomness anywhere: ties break on creature id.
 */
import type { Character, Creature } from '../core/creature';
import { diceStats, resolveRollMode, type Modifier, type RollMode } from '../core/dice';
import type { Damage } from '../data/common';
import type { SrdDatabase } from '../data/srd';
import type { Ability, CreatureType } from '../rules/basics';
import { saveModifiers } from '../rules/checks';
import type { ConditionTable } from '../rules/conditions';
import { dodgeActive } from './actionEffects';
import { targetAc, type AttackCheck, type AttackProfile } from './attack';
import { areHostile, msgsOf, sideOf, type CombatContext, type CombatState } from './combatState';

/** Tunable AI thresholds (data, not code). */
export const AI_TUNING = {
  /** At or below this Intelligence a creature fights like a beast: attacks the closest. */
  beastMaxInt: 3,
  /** At or above this Intelligence a creature prefers casters and avoids Dodging targets. */
  smartMinInt: 8,
  /** Score penalty (≈ damage points) per hostile threatening a ranged attacker's square. */
  rangedThreatPenalty: 2,
} as const;

// ---------------------------------------------------------------- expected damage

/** Chance to hit with a d20 + `bonus` against `ac` (nat 1 misses, nat 20 hits). */
export function hitChance(bonus: number, ac: number, mode: RollMode = 'normal'): number {
  const p = Math.min(0.95, Math.max(0.05, (21 - (ac - bonus)) / 20));
  return mode === 'advantage' ? 1 - (1 - p) ** 2 : mode === 'disadvantage' ? p * p : p;
}

/** Damage multiplier of a type against a creature's own defenses (immune 0, resistant ½, vulnerable ×2). */
export function damageMultiplier(target: Creature | undefined, type: string): number {
  if (!target) return 1;
  if (target.immunities.some((t) => t === type)) return 0;
  const resist = target.resistances.some((t) => t === type) ? 0.5 : 1;
  const vuln = target.vulnerabilities.some((t) => t === type) ? 2 : 1;
  return resist * vuln;
}

/** Average damage of dice + flat modifiers (modifiers count toward the first damage type). */
export function averageDamage(damage: readonly Damage[], mods: readonly Modifier[] = [], target?: Creature): number {
  let total = 0;
  damage.forEach((d, i) => {
    const flat = i === 0 ? mods.reduce((s, m) => s + m.value, 0) : 0;
    total += Math.max(0, diceStats(d.dice).average + flat) * damageMultiplier(target, d.type);
  });
  return total;
}

export const profileToHit = (p: AttackProfile): number => p.toHit.reduce((s, m) => s + m.value, 0);

/** Expected damage of one attack given its preview (`checkAttack`); 0 if the attack can't be made. */
export function expectedAttackDamage(p: AttackProfile, check: AttackCheck, target: Creature): number {
  if (!check.ok) return 0;
  const mode = resolveRollMode(check.advantage.length, check.disadvantage.length);
  const avg = averageDamage(p.damage, p.damageModifiers, target) * (check.autoCrit ? 1.6 : 1);
  return (check.autoCrit ? Math.max(0.95, hitChance(profileToHit(p), check.ac, mode)) : hitChance(profileToHit(p), check.ac, mode)) * avg;
}

/** Rough expected damage of an attack without a position preview (for Opportunity Attack risk). */
export function roughAttackDamage(p: AttackProfile, target: Creature): number {
  return hitChance(profileToHit(p), targetAc(target)) * averageDamage(p.damage, p.damageModifiers, target);
}

/** Chance a creature fails a save against `dc`. */
export function saveFailChance(target: Creature, ability: Ability, dc: number): number {
  const bonus = saveModifiers(target, ability).reduce((s, m) => s + m.value, 0);
  return Math.min(1, Math.max(0, (dc - 1 - bonus) / 20));
}

/** Expected damage of a save-for-half (or save-or-nothing) effect against one target. */
export function expectedSaveDamage(damage: readonly Damage[], target: Creature, ability: Ability, dc: number, halfOnSave: boolean): number {
  const fail = saveFailChance(target, ability, dc);
  const avg = averageDamage(damage, [], target);
  return avg * (fail + (halfOnSave ? (1 - fail) * 0.5 : 0));
}

// ---------------------------------------------------------------- target ranking

export interface TargetCandidate {
  id: string;
  creature: Creature;
  distanceFt: number;
}

const isCharacter = (c: Creature): c is Character => c.kind === 'character' && 'classes' in c;

export function isConcentrating(c: Creature): boolean {
  return isCharacter(c) && c.spellcasting?.concentration !== undefined;
}

/** A creature that casts spells: a character with cantrips/prepared spells, or a stat block with Spellcasting. */
export function isSpellcaster(c: Creature, db: SrdDatabase): boolean {
  if (isCharacter(c)) return !!c.spellcasting && (c.spellcasting.cantrips.length > 0 || c.spellcasting.prepared.length > 0);
  const m = c.statBlockId ? db.monsters.get(c.statBlockId) : undefined;
  return !!m?.spellcasting;
}

export const isBloodied = (c: Creature): boolean => c.hp * 2 <= c.maxHp;
export const isDown = (c: Creature): boolean => c.dead || c.hp <= 0;

function compareKeys(a: readonly (number | string)[], b: readonly (number | string)[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i];
    const y = b[i];
    if (x === y) continue;
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (typeof x === 'number' && typeof y === 'number') return x - y;
    return String(x) < String(y) ? -1 : 1;
  }
  return 0;
}

/** Order targets by the attacker's preference (best first). See the module doc for the rules. */
export function rankTargets(attacker: Creature, candidates: readonly TargetCandidate[], opts: { db: SrdDatabase; table?: ConditionTable }): TargetCandidate[] {
  const int = attacker.abilities.int;
  const key = (t: TargetCandidate): (number | string)[] => {
    const c = t.creature;
    const down = c.hp <= 0 ? 1 : 0;
    if (int <= AI_TUNING.beastMaxInt) return [down, t.distanceFt, c.hp + c.tempHp, t.id];
    const smart = int >= AI_TUNING.smartMinInt;
    const dodging = smart && dodgeActive(c, opts.table) ? 1 : 0;
    const caster = smart ? (isConcentrating(c) ? 0 : isSpellcaster(c, opts.db) ? 1 : 2) : 0;
    return [down, dodging, caster, c.hp + c.tempHp, targetAc(c), isBloodied(c) ? 0 : 1, t.distanceFt, t.id];
  };
  return [...candidates].sort((a, b) => compareKeys(key(a), key(b)));
}

// ---------------------------------------------------------------- morale

export interface MoraleRule {
  enabled: boolean;
  /** HP fraction at or below which a creature is Bloodied (SRD: half). */
  bloodiedFraction: number;
  /** Fraction of the side's members lost that breaks a Bloodied creature's nerve. */
  sideLossFraction: number;
  /** HP fraction at which a clever enough creature flees regardless of its side. */
  desperateFraction: number;
  desperateMinInt: number;
  /** Creature types that never flee. */
  fearlessTypes: readonly CreatureType[];
  /** Int at or below which a creature is mindless and never flees. */
  mindlessMaxInt: number;
  /** Stat block ids matching this pattern count as leaders. */
  leaderPattern: RegExp;
}

export const DEFAULT_MORALE: MoraleRule = {
  enabled: true,
  bloodiedFraction: 0.5,
  sideLossFraction: 0.5,
  desperateFraction: 0.25,
  desperateMinInt: 6,
  fearlessTypes: ['undead', 'construct'],
  mindlessMaxInt: 3,
  leaderPattern: /(boss|captain|chief|leader|warlord|king|queen|priest)/i,
};

export interface MoraleOptions {
  morale?: Partial<MoraleRule>;
  /** Encounter roster id → side (incl. creatures already removed from the initiative order). */
  roster?: Readonly<Record<string, string>>;
  /** Explicit leaders (else stat blocks matching `leaderPattern`). */
  leaderIds?: readonly string[];
}

export function isFearless(c: Creature, rule: MoraleRule = DEFAULT_MORALE): boolean {
  return rule.fearlessTypes.includes(c.creatureType) || c.conditionImmunities.includes('frightened') || c.abilities.int <= rule.mindlessMaxInt;
}

/**
 * Same-side members of the actor's side, including itself. Uses the roster when given; otherwise
 * the initiative order (dead monsters leave it, so pass a roster to count them) plus, with a custom
 * `ctx.isHostile`, every other known creature that isn't hostile.
 */
export function sideMembers(state: CombatState, ctx: CombatContext, actorId: string, roster?: Readonly<Record<string, string>>): string[] {
  if (roster) {
    const side = roster[actorId] ?? sideOf(state, actorId);
    return Object.keys(roster).filter((id) => roster[id] === side).sort();
  }
  const side = sideOf(state, actorId);
  const ids = new Set(state.turns.order.filter((e) => e.side === side).map((e) => e.id));
  if (ctx.isHostile) for (const id of Object.keys(state.creatures)) if (!areHostile(state, ctx, actorId, id)) ids.add(id);
  ids.add(actorId);
  return [...ids].sort();
}

export interface MoraleResult {
  flee: boolean;
  reason: string;
}

export function moraleCheck(state: CombatState, ctx: CombatContext, actorId: string, opts: MoraleOptions = {}): MoraleResult {
  const rule: MoraleRule = { ...DEFAULT_MORALE, ...opts.morale };
  const c = state.creatures[actorId];
  if (!c || !rule.enabled || c.kind === 'character') return { flee: false, reason: 'holds' };
  if (isFearless(c, rule)) return { flee: false, reason: 'fearless' };
  const frac = c.hp / Math.max(1, c.maxHp);
  if (frac <= rule.desperateFraction && c.abilities.int >= rule.desperateMinInt) return { flee: true, reason: msgsOf(ctx).m('ai.morale.wounded') };
  if (frac > rule.bloodiedFraction) return { flee: false, reason: 'holds' };
  const members = sideMembers(state, ctx, actorId, opts.roster);
  const lost = (id: string) => {
    const m = state.creatures[id];
    return !m || isDown(m);
  };
  const leaders = opts.leaderIds ?? members.filter((id) => rule.leaderPattern.test(state.creatures[id]?.statBlockId ?? ''));
  if (leaders.some((id) => id !== actorId && lost(id))) return { flee: true, reason: msgsOf(ctx).m('ai.morale.leader') };
  const others = members.filter((id) => id !== actorId);
  if (others.length > 0 && others.filter(lost).length >= Math.ceil(members.length * rule.sideLossFraction)) return { flee: true, reason: msgsOf(ctx).m('ai.morale.breaking') };
  return { flee: false, reason: 'holds' };
}
