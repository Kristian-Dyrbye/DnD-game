/**
 * D20 Tests: ability checks, saving throws and the shared d20-test core (attack rolls reuse it).
 * Everything returns the full breakdown so the UI can show the math line, e.g.
 * "d20: 14 + 5 (Persuasion) = 19 vs DC 15 — Success".
 * Rules (SRD 5.2): advantage/disadvantage cancel; exhaustion subtracts 2 × level from every
 * D20 Test; natural 20/1 have no special effect on checks or saves.
 */
import { formatD20Test, resolveRollMode, rollD20, type D20Roll, type Modifier, type RollMode } from '../core/dice';
import type { Rng } from '../core/rng';
import type { Creature } from '../core/creature';
import {
  ABILITY_NAMES,
  SKILL_ABILITY,
  SKILL_NAMES,
  abilityModifier,
  proficiencyContribution,
  type Ability,
  type ProficiencyLevel,
  type Skill,
} from './basics';

export interface D20TestInput {
  rng: Rng;
  /** Name of the test, used in the math line when no other label fits ("Stealth", "Dexterity save"). */
  label: string;
  modifiers: Modifier[];
  /** Names of the sources granting advantage / disadvantage (for display and cancellation). */
  advantage?: string[];
  disadvantage?: string[];
  target?: { kind: 'DC' | 'AC'; value: number };
  /** Automatic failure (e.g. Paralyzed and a Strength save). The die is still rolled for display. */
  autoFail?: string;
  /** Exhaustion level (0–6): −2 per level. */
  exhaustion?: number;
}

export interface D20TestResult {
  label: string;
  d20: D20Roll;
  mode: RollMode;
  modifiers: Modifier[];
  total: number;
  /** Undefined when there was no target to compare against. */
  success?: boolean;
  target?: { kind: 'DC' | 'AC'; value: number };
  autoFail?: string;
  advantage: string[];
  disadvantage: string[];
  /** The visible math line. */
  text: string;
}

export function d20Test(input: D20TestInput): D20TestResult {
  const advantage = input.advantage ?? [];
  const disadvantage = input.disadvantage ?? [];
  const mode = resolveRollMode(advantage.length, disadvantage.length);
  const d20 = rollD20(input.rng, mode);
  const modifiers = [...input.modifiers];
  if (input.exhaustion && input.exhaustion > 0) modifiers.push({ value: -2 * input.exhaustion, label: 'Exhaustion' });
  const total = d20.natural + modifiers.reduce((sum, m) => sum + m.value, 0);
  let success: boolean | undefined;
  if (input.autoFail) success = false;
  else if (input.target) success = total >= input.target.value;
  const outcome = input.autoFail ? `Automatic failure (${input.autoFail})` : success === undefined ? undefined : success ? 'Success' : 'Failure';
  return {
    label: input.label,
    d20,
    mode,
    modifiers,
    total,
    ...(success !== undefined && { success }),
    ...(input.target && { target: input.target }),
    ...(input.autoFail && { autoFail: input.autoFail }),
    advantage,
    disadvantage,
    text: formatD20Test({ d20, modifiers, total, ...(input.target && { target: input.target }), ...(outcome && { outcome }) }),
  };
}

// ---------------------------------------------------------------- creature helpers

export interface CheckOptions {
  rng: Rng;
  dc?: number;
  advantage?: string[];
  disadvantage?: string[];
  /** Extra bonuses/penalties (Bless, Guidance, cover...). */
  bonuses?: Modifier[];
  autoFail?: string;
}

/** Modifier list for an ability check, optionally with a skill (uses the skill's default ability unless overridden). */
export function checkModifiers(c: Creature, ability: Ability, skill?: Skill, profOverride?: ProficiencyLevel): Modifier[] {
  const printed = skill && ability === SKILL_ABILITY[skill] ? c.skillBonuses?.[skill] : undefined;
  if (printed !== undefined) return [{ value: printed, label: SKILL_NAMES[skill!] }];
  const mods: Modifier[] = [{ value: abilityModifier(c.abilities[ability]), label: ABILITY_NAMES[ability] }];
  const level = profOverride ?? (skill ? (c.skills[skill] ?? 'none') : 'none');
  const prof = proficiencyContribution(level, c.proficiencyBonus);
  if (prof !== 0) {
    const kind = level === 'expertise' ? 'Expertise' : level === 'half' ? 'Half proficiency' : 'Proficiency';
    mods.push({ value: prof, label: skill ? `${kind}: ${SKILL_NAMES[skill]}` : kind });
  }
  return mods;
}

/** Ability check, e.g. abilityCheck(hero, 'cha', 'persuasion', { rng, dc: 15 }). */
export function abilityCheck(c: Creature, ability: Ability, skill: Skill | undefined, opts: CheckOptions): D20TestResult {
  return d20Test({
    rng: opts.rng,
    label: skill ? SKILL_NAMES[skill] : `${ABILITY_NAMES[ability]} check`,
    modifiers: [...checkModifiers(c, ability, skill), ...(opts.bonuses ?? [])],
    exhaustion: c.exhaustion,
    ...(opts.dc !== undefined && { target: { kind: 'DC' as const, value: opts.dc } }),
    ...(opts.advantage && { advantage: opts.advantage }),
    ...(opts.disadvantage && { disadvantage: opts.disadvantage }),
    ...(opts.autoFail && { autoFail: opts.autoFail }),
  });
}

/** Skill check with the skill's default ability. */
export function skillCheck(c: Creature, skill: Skill, opts: CheckOptions): D20TestResult {
  return abilityCheck(c, SKILL_ABILITY[skill], skill, opts);
}

export function saveModifiers(c: Creature, ability: Ability): Modifier[] {
  const printed = c.saveBonuses?.[ability];
  if (printed !== undefined) return [{ value: printed, label: `${ABILITY_NAMES[ability]} save` }];
  const mods: Modifier[] = [{ value: abilityModifier(c.abilities[ability]), label: ABILITY_NAMES[ability] }];
  if (c.saveProficiencies.includes(ability)) mods.push({ value: c.proficiencyBonus, label: 'Proficiency' });
  return mods;
}

export function savingThrow(c: Creature, ability: Ability, opts: CheckOptions): D20TestResult {
  return d20Test({
    rng: opts.rng,
    label: `${ABILITY_NAMES[ability]} save`,
    modifiers: [...saveModifiers(c, ability), ...(opts.bonuses ?? [])],
    exhaustion: c.exhaustion,
    ...(opts.dc !== undefined && { target: { kind: 'DC' as const, value: opts.dc } }),
    ...(opts.advantage && { advantage: opts.advantage }),
    ...(opts.disadvantage && { disadvantage: opts.disadvantage }),
    ...(opts.autoFail && { autoFail: opts.autoFail }),
  });
}

/** Passive score = 10 + check modifiers, ±5 for advantage/disadvantage (they cancel). */
export function passiveScore(c: Creature, skill: Skill, advantage = 0, disadvantage = 0): number {
  const mods = checkModifiers(c, SKILL_ABILITY[skill], skill);
  const mode = resolveRollMode(advantage, disadvantage);
  const adj = mode === 'advantage' ? 5 : mode === 'disadvantage' ? -5 : 0;
  return 10 + mods.reduce((s, m) => s + m.value, 0) + adj - 2 * c.exhaustion;
}

/** Opposed checks (SRD "contest"): higher total wins; a tie means the situation stays as it was. */
export function contest(a: D20TestResult, b: D20TestResult): 'a' | 'b' | 'tie' {
  if (a.total === b.total) return 'tie';
  return a.total > b.total ? 'a' : 'b';
}
