/**
 * Conditions engine. Applies and removes conditions, tracks durations and end-of-turn saves,
 * and turns the data-driven `modifiers` in data/srd/conditions.json into roll effects:
 * advantage/disadvantage sources, automatic failures, automatic crits, speed and action limits.
 * Exhaustion (2024) is numeric on the creature: −2 × level to D20 Tests (applied in checks.ts),
 * −5 ft × level to Speed, death at level 6.
 */
import type { ActiveCondition, Creature } from '../core/creature';
import type { Rng } from '../core/rng';
import type { ConditionData, ConditionModifiers } from '../data/schemas';
import { loadSrd } from '../data/srdBundle';
import { ABILITY_NAMES, type Ability, type Condition } from './basics';
import { savingThrow, type D20TestResult } from './checks';
import { effectSpeedPenalty } from './activeEffects';

export type ConditionTable = ReadonlyMap<string, ConditionData>;

const defaultTable = (): ConditionTable => loadSrd().conditions;

const NAME = (c: Condition) => c[0]!.toUpperCase() + c.slice(1);

// ---------------------------------------------------------------- queries

/** Every condition in effect, including implied ones (Unconscious → Incapacitated + Prone) and Exhaustion. */
export function effectiveConditions(c: Creature, table: ConditionTable = defaultTable()): Set<Condition> {
  const out = new Set<Condition>();
  const add = (cond: Condition) => {
    if (out.has(cond)) return;
    out.add(cond);
    for (const implied of table.get(cond)?.modifiers.implies ?? []) add(implied);
  };
  for (const ac of c.conditions) add(ac.condition);
  if (c.exhaustion > 0) out.add('exhaustion');
  return out;
}

export function hasCondition(c: Creature, cond: Condition, table: ConditionTable = defaultTable()): boolean {
  return effectiveConditions(c, table).has(cond);
}

/** Conditions this creature can't receive: its own immunities plus any granted by other conditions (Petrified → Poisoned). */
export function conditionImmunities(c: Creature, table: ConditionTable = defaultTable()): Set<Condition> {
  const out = new Set<Condition>(c.conditionImmunities);
  // Spell effects that grant immunity (Heroism: Frightened).
  for (const e of c.effects) for (const cond of (e.data.immuneConditions as Condition[] | undefined) ?? []) out.add(cond);
  for (const cond of effectiveConditions(c, table)) for (const i of table.get(cond)?.modifiers.immuneTo ?? []) out.add(i);
  return out;
}

/** Modifier blocks of every effective condition, with the ActiveCondition that caused them (for source rules). */
function activeModifiers(c: Creature, table: ConditionTable): { cond: Condition; mods: ConditionModifiers; source?: string }[] {
  const direct = new Map(c.conditions.map((ac) => [ac.condition, ac.sourceId]));
  return [...effectiveConditions(c, table)].map((cond) => {
    const source = direct.get(cond);
    return { cond, mods: table.get(cond)?.modifiers ?? {}, ...(source && { source }) };
  });
}

// ---------------------------------------------------------------- applying / removing

export interface ApplyResult<T extends Creature = Creature> {
  creature: T;
  applied: boolean;
  /** Why it wasn't applied. */
  reason?: 'immune';
  /** Exhaustion reached 6. */
  died?: boolean;
}

/** Adds a condition. Exhaustion adds a level. Re-applying keeps the longer duration. */
export function applyCondition<T extends Creature>(c: T, ac: ActiveCondition, table: ConditionTable = defaultTable()): ApplyResult<T> {
  if (conditionImmunities(c, table).has(ac.condition)) return { creature: c, applied: false, reason: 'immune' };
  if (ac.condition === 'exhaustion') return addExhaustion(c, 1);
  const existing = c.conditions.find((x) => x.condition === ac.condition && x.sourceId === ac.sourceId);
  let conditions: ActiveCondition[];
  if (existing) {
    const longer =
      existing.roundsLeft === undefined || (ac.roundsLeft !== undefined && ac.roundsLeft <= existing.roundsLeft) ? existing : ac;
    conditions = c.conditions.map((x) => (x === existing ? { ...longer } : x));
  } else {
    conditions = [...c.conditions, { ...ac }];
  }
  return { creature: { ...c, conditions }, applied: true };
}

/** Removes a condition (all sources, or only the given source). Removing Unconscious leaves the creature Prone. */
export function removeCondition<T extends Creature>(c: T, cond: Condition, sourceId?: string): T {
  const conditions = c.conditions.filter((x) => !(x.condition === cond && (sourceId === undefined || x.sourceId === sourceId)));
  const next = { ...c, conditions };
  if (cond === 'unconscious' && !conditions.some((x) => x.condition === 'unconscious') && !conditions.some((x) => x.condition === 'prone')) {
    next.conditions = [...conditions, { condition: 'prone' }];
  }
  return next;
}

/** Removes every condition caused by a source (e.g. when a grappler is incapacitated or a spell ends). */
export function removeConditionsFromSource(c: Creature, sourceId: string): Creature {
  return { ...c, conditions: c.conditions.filter((x) => x.sourceId !== sourceId) };
}

export function addExhaustion<T extends Creature>(c: T, levels: number): ApplyResult<T> {
  const exhaustion = Math.min(6, Math.max(0, c.exhaustion + levels));
  return { creature: { ...c, exhaustion }, applied: levels > 0, ...(exhaustion >= 6 && { died: true }) };
}

// ---------------------------------------------------------------- durations and saves

/** Counts down timed conditions (call at the end of the affected creature's turn). Expired ones are removed. */
export function tickConditions(c: Creature): { creature: Creature; expired: Condition[] } {
  const expired: Condition[] = [];
  const conditions: ActiveCondition[] = [];
  for (const ac of c.conditions) {
    if (ac.roundsLeft === undefined) {
      conditions.push(ac);
      continue;
    }
    const left = ac.roundsLeft - 1;
    if (left <= 0) expired.push(ac.condition);
    else conditions.push({ ...ac, roundsLeft: left });
  }
  return { creature: { ...c, conditions }, expired };
}

/** Rolls each "repeat the save at the end of each turn" condition; successes end the condition. */
export function endOfTurnSaves(
  c: Creature,
  rng: Rng,
  table: ConditionTable = defaultTable(),
): { creature: Creature; results: { condition: Condition; roll: D20TestResult }[] } {
  let creature = c;
  const results: { condition: Condition; roll: D20TestResult }[] = [];
  for (const ac of c.conditions) {
    if (!ac.endSave) continue;
    const roll = savingThrow(creature, ac.endSave.ability, { rng, dc: ac.endSave.dc, ...saveModes(creature, ac.endSave.ability, table) });
    results.push({ condition: ac.condition, roll });
    if (roll.success) creature = { ...creature, conditions: creature.conditions.filter((x) => x !== ac && !(x.condition === ac.condition && x.sourceId === ac.sourceId)) };
  }
  return { creature, results };
}

// ---------------------------------------------------------------- roll modes

export interface Modes {
  advantage: string[];
  disadvantage: string[];
  autoFail?: string;
}

export interface AttackContext {
  attacker: Creature;
  target: Creature;
  /** Distance between attacker and target in feet. */
  distanceFt: number;
  /** Frightened: whether the source of fear is in the attacker's line of sight (default true). */
  fearSourceVisible?: boolean;
  /** The attacker can see an Invisible target (Truesight, See Invisibility...). */
  attackerSeesInvisible?: boolean;
  /** The target can see an Invisible attacker. */
  targetSeesInvisible?: boolean;
}

/** Advantage/disadvantage sources and auto-crit from both creatures' conditions for an attack roll. */
export function attackModes(ctx: AttackContext, table: ConditionTable = defaultTable()): Modes & { autoCrit?: string } {
  const advantage: string[] = [];
  const disadvantage: string[] = [];
  let autoCrit: string | undefined;
  const push = (mode: 'advantage' | 'disadvantage' | undefined, label: string) => {
    if (mode === 'advantage') advantage.push(label);
    else if (mode === 'disadvantage') disadvantage.push(label);
  };

  for (const { cond, mods, source } of activeModifiers(ctx.attacker, table)) {
    if (!mods.ownAttacks) continue;
    if (mods.exceptAgainstSource && source === ctx.target.id) continue;
    if (mods.whileSourceVisible && ctx.fearSourceVisible === false) continue;
    if (cond === 'invisible' && ctx.targetSeesInvisible) continue;
    push(mods.ownAttacks, `${NAME(cond)} (attacker)`);
  }
  for (const { cond, mods } of activeModifiers(ctx.target, table)) {
    if (cond === 'invisible' && ctx.attackerSeesInvisible) continue;
    push(mods.attacksAgainst, `${NAME(cond)} (target)`);
    if (ctx.distanceFt <= 5) push(mods.attacksAgainstWithin5ft, `${NAME(cond)} (target, within 5 ft)`);
    else push(mods.attacksAgainstBeyond5ft, `${NAME(cond)} (target, beyond 5 ft)`);
    if (mods.autoCritWithin5ft && ctx.distanceFt <= 5) autoCrit ??= NAME(cond);
  }
  return { advantage, disadvantage, ...(autoCrit && { autoCrit }) };
}

/** Condition effects on an ability check. `requires` = senses the check needs ('sight' for spotting, etc.). */
export function checkModes(
  c: Creature,
  opts: { requires?: ('sight' | 'hearing')[]; fearSourceVisible?: boolean } = {},
  table: ConditionTable = defaultTable(),
): Modes {
  const disadvantage: string[] = [];
  const advantage: string[] = [];
  let autoFail: string | undefined;
  for (const { cond, mods } of activeModifiers(c, table)) {
    if (mods.abilityChecks && !(mods.whileSourceVisible && opts.fearSourceVisible === false)) {
      (mods.abilityChecks === 'advantage' ? advantage : disadvantage).push(NAME(cond));
    }
    for (const sense of mods.autoFailChecksRequiring ?? []) if (opts.requires?.includes(sense)) autoFail ??= NAME(cond);
  }
  return { advantage, disadvantage, ...(autoFail && { autoFail }) };
}

/** Condition effects on a saving throw. */
export function saveModes(c: Creature, ability: Ability, table: ConditionTable = defaultTable()): Modes {
  const disadvantage: string[] = [];
  const advantage: string[] = [];
  let autoFail: string | undefined;
  for (const { cond, mods } of activeModifiers(c, table)) {
    if (mods.autoFailSaves?.includes(ability)) autoFail ??= `${NAME(cond)}: ${ABILITY_NAMES[ability]}`;
    const mode = mods.saves?.[ability];
    if (mode) (mode === 'advantage' ? advantage : disadvantage).push(NAME(cond));
  }
  return { advantage, disadvantage, ...(autoFail && { autoFail }) };
}

export function initiativeModes(c: Creature, table: ConditionTable = defaultTable()): Modes {
  const advantage: string[] = [];
  const disadvantage: string[] = [];
  for (const { cond, mods } of activeModifiers(c, table)) {
    if (mods.initiative === 'advantage') advantage.push(NAME(cond));
    else if (mods.initiative === 'disadvantage') disadvantage.push(NAME(cond));
  }
  return { advantage, disadvantage };
}

// ---------------------------------------------------------------- action and movement limits

/** Incapacitated creatures can't take actions, bonus actions or reactions (and lose concentration). */
export function canAct(c: Creature, table: ConditionTable = defaultTable()): boolean {
  return !activeModifiers(c, table).some((m) => m.mods.incapacitated);
}

/** Walking speed after conditions, exhaustion and speed effects (Slow mastery, Haste ×2, slow spell ×½); never below 0. */
export function effectiveSpeed(c: Creature, table: ConditionTable = defaultTable(), base = c.speed.walk): number {
  if (activeModifiers(c, table).some((m) => m.mods.speedZero)) return 0;
  const mult = c.effects.reduce((m, e) => m * (typeof e.data.speedMultiplier === 'number' ? e.data.speedMultiplier : 1), 1);
  return Math.max(0, Math.floor((base - 5 * c.exhaustion - effectSpeedPenalty(c)) * mult));
}

/** Prone creatures can only crawl (1 extra foot per foot) or spend half their speed to stand. */
export function isCrawlOnly(c: Creature, table: ConditionTable = defaultTable()): boolean {
  return activeModifiers(c, table).some((m) => m.mods.crawlOnly);
}

export function resistsAllDamage(c: Creature, table: ConditionTable = defaultTable()): boolean {
  return activeModifiers(c, table).some((m) => m.mods.resistAllDamage);
}

/** Charmed: may this creature attack or harm `targetId`? */
export function mayHarm(c: Creature, targetId: string, table: ConditionTable = defaultTable()): boolean {
  return !activeModifiers(c, table).some((m) => m.mods.cantHarmSource && m.source === targetId);
}
