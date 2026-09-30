/**
 * Attack rolls, damage rolls and applying damage/healing/temporary HP to creatures.
 * SRD 5.2: natural 20 on an attack roll is a Critical Hit (hits regardless of AC, damage dice
 * rolled twice, modifiers once); natural 1 always misses. Immunity → 0; Resistance halves
 * (round down) and Vulnerability doubles, each applied once per damage instance.
 * Temporary HP absorb damage first and don't stack (keep the higher).
 * All creature functions are pure: they return a new creature plus a report.
 */
import { formatD20Test, parseDice, roll, type DiceExpr, type Modifier, type RollResult } from '../core/dice';
import type { Rng } from '../core/rng';
import { ENGLISH_MESSAGES, type Messages } from '../i18n';
import type { Creature } from '../core/creature';
import type { Damage } from '../data/common';
import type { DamageType } from './basics';
import { d20Test, type D20TestInput, type D20TestResult } from './checks';

// ---------------------------------------------------------------- attack rolls

export interface AttackRollInput extends Omit<D20TestInput, 'target' | 'autoFail'> {
  targetAc: number;
  /** Lowest natural roll that crits (Champion: 19, later 18). */
  critOn?: number;
  /** Any hit is a crit (attacker within 5 ft of a Paralyzed/Unconscious target). */
  autoCrit?: string;
}

export interface AttackRollResult extends D20TestResult {
  hit: boolean;
  crit: boolean;
}

export function attackRoll(input: AttackRollInput): AttackRollResult {
  const base = d20Test({ ...input, target: { kind: 'AC', value: input.targetAc } });
  const natural = base.d20.natural;
  const critOn = input.critOn ?? 20;
  let hit: boolean;
  let crit = false;
  if (natural === 1) hit = false;
  else if (natural >= critOn) {
    hit = true;
    crit = true;
  } else hit = base.total >= input.targetAc;
  if (hit && input.autoCrit) crit = true;
  const { m } = input.msgs ?? ENGLISH_MESSAGES;
  const outcome = !hit ? m(natural === 1 ? 'roll.missNat1' : 'roll.miss') : crit ? (natural >= critOn ? m('roll.crit') : m('roll.critBecause', { reason: input.autoCrit ?? '' })) : m('roll.hit');
  return {
    ...base,
    hit,
    crit,
    success: hit,
    text: formatD20Test({ d20: base.d20, modifiers: base.modifiers, total: base.total, target: { kind: 'AC', value: input.targetAc }, outcome }, input.msgs),
  };
}

// ---------------------------------------------------------------- damage rolls

export interface DamageRollPart {
  type: DamageType;
  roll: RollResult;
  total: number;
}

export interface DamageRollResult {
  parts: DamageRollPart[];
  total: number;
  crit: boolean;
  text: string;
}

/** Doubles the number of dice in every dice term (critical hits). Constants are unchanged. */
export function doubleDice(expr: DiceExpr): DiceExpr {
  return { terms: expr.terms.map((t) => (t.kind === 'dice' ? { ...t, count: t.count * 2, ...(t.keep && { keep: { ...t.keep, n: t.keep.n * 2 } }) } : t)) };
}

/**
 * Rolls each damage entry; flat modifiers (ability mod, magic bonus) are added to the first entry.
 * Damage never goes below 0 per entry.
 */
export function rollDamage(rng: Rng, damage: Damage[], opts: { crit?: boolean; modifiers?: Modifier[]; msgs?: Messages } = {}): DamageRollResult {
  const crit = opts.crit ?? false;
  const flat = (opts.modifiers ?? []).reduce((s, m) => s + m.value, 0);
  const parts = damage.map((d, i): DamageRollPart => {
    const expr = parseDice(d.dice);
    const r = roll(crit ? doubleDice(expr) : expr, rng);
    return { type: d.type, roll: r, total: Math.max(0, r.total + (i === 0 ? flat : 0)) };
  });
  const total = parts.reduce((s, p) => s + p.total, 0);
  const text = parts
    .map((p, i) => {
      const dice = p.roll.terms
        .map((t) => (t.kind === 'dice' ? `[${t.rolls.join(', ')}]` : `${t.sign < 0 ? '−' : '+'} ${t.value}`))
        .join(' ');
      const mods = i === 0 ? (opts.modifiers ?? []).filter((m) => m.value !== 0).map((m) => ` ${m.value < 0 ? '−' : '+'} ${Math.abs(m.value)} (${m.label})`).join('') : '';
      return `${p.roll.notation} ${p.type}: ${dice}${mods} = ${p.total}`;
    })
    .join('; ');
  return { parts, total, crit, text: `${crit ? (opts.msgs ?? ENGLISH_MESSAGES).m('roll.critPrefix') : ''}${text}` };
}

// ---------------------------------------------------------------- applying damage

export interface DamageInstance {
  amount: number;
  type: DamageType;
}

export interface DamageReport {
  /** Damage after immunity/resistance/vulnerability, per instance. */
  adjusted: (DamageInstance & { note?: 'immune' | 'resisted' | 'vulnerable' | 'resisted+vulnerable' })[];
  totalAfterDefenses: number;
  absorbedByTempHp: number;
  hpLost: number;
  /** HP went from > 0 to 0 this time. */
  droppedToZero: boolean;
  /** Damage left over after reaching 0 HP (for massive-damage and death-save rules). */
  overflow: number;
  /** Massive damage: overflow ≥ max HP → instant death (SRD). */
  instantDeath: boolean;
}

export interface DefenseOptions {
  /** Extra resistances from conditions/effects (Petrified: all types). */
  resistAll?: boolean;
  extraResistances?: DamageType[];
}

export function adjustForDefenses(c: Creature, inst: DamageInstance, opts: DefenseOptions = {}): DamageReport['adjusted'][number] {
  if (c.immunities.includes(inst.type)) return { amount: 0, type: inst.type, note: 'immune' };
  const resisted = opts.resistAll || c.resistances.includes(inst.type) || (opts.extraResistances ?? []).includes(inst.type);
  const vulnerable = c.vulnerabilities.includes(inst.type);
  let amount = inst.amount;
  if (resisted) amount = Math.floor(amount / 2);
  if (vulnerable) amount *= 2;
  const note = resisted && vulnerable ? 'resisted+vulnerable' : resisted ? 'resisted' : vulnerable ? 'vulnerable' : undefined;
  return { amount, type: inst.type, ...(note && { note }) };
}

export function applyDamage(c: Creature, instances: DamageInstance[], opts: DefenseOptions = {}): { creature: Creature; report: DamageReport } {
  const adjusted = instances.map((i) => adjustForDefenses(c, i, opts));
  const totalAfterDefenses = adjusted.reduce((s, a) => s + a.amount, 0);
  const absorbedByTempHp = Math.min(c.tempHp, totalAfterDefenses);
  const remaining = totalAfterDefenses - absorbedByTempHp;
  const hpLost = Math.min(c.hp, remaining);
  const overflow = remaining - hpLost;
  const newHp = c.hp - hpLost;
  const droppedToZero = c.hp > 0 && newHp === 0;
  return {
    creature: { ...c, tempHp: c.tempHp - absorbedByTempHp, hp: newHp },
    report: {
      adjusted,
      totalAfterDefenses,
      absorbedByTempHp,
      hpLost,
      droppedToZero,
      overflow,
      instantDeath: (droppedToZero || c.hp === 0) && remaining > 0 && overflow >= c.maxHp,
    },
  };
}

/** Healing up to max HP. Returns the amount actually restored. */
export function heal<T extends Creature>(c: T, amount: number): { creature: T; healed: number } {
  const healed = Math.max(0, Math.min(amount, c.maxHp - c.hp));
  return { creature: { ...c, hp: c.hp + healed }, healed };
}

/** Temporary HP don't stack: keep whichever is higher. */
export function grantTempHp<T extends Creature>(c: T, amount: number): T {
  return { ...c, tempHp: Math.max(c.tempHp, amount) };
}

/** Bloodied = at half HP or fewer (SRD glossary). */
export function isBloodied(c: Creature): boolean {
  return c.hp <= Math.floor(c.maxHp / 2);
}
