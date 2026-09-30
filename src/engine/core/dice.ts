/**
 * Dice notation, rolling and d20 tests with advantage/disadvantage.
 * Notation: terms joined by + or -, each either a constant or `NdX` with optional
 * keep-highest/lowest (`4d6kh3`, `2d20kl1`). Examples: "1d20+5", "2d6+1d4-1", "d8".
 * Every result carries the individual dice so the UI can show the math.
 */
import type { Rng } from './rng';
import { ENGLISH_MESSAGES, type Messages } from '../i18n';

export interface DiceTerm {
  kind: 'dice';
  sign: 1 | -1;
  count: number;
  sides: number;
  keep?: { which: 'highest' | 'lowest'; n: number };
}

export interface ConstTerm {
  kind: 'const';
  sign: 1 | -1;
  value: number;
}

export type Term = DiceTerm | ConstTerm;

export interface DiceExpr {
  terms: Term[];
}

export interface RolledDiceTerm extends DiceTerm {
  rolls: number[];
  /** Parallel to rolls: false for dice dropped by keep. */
  kept: boolean[];
  /** Signed sum of kept dice. */
  subtotal: number;
}

export interface RolledConstTerm extends ConstTerm {
  subtotal: number;
}

export interface RollResult {
  notation: string;
  terms: (RolledDiceTerm | RolledConstTerm)[];
  total: number;
}

export class DiceParseError extends Error {
  constructor(notation: string, reason: string) {
    super(`Bad dice notation "${notation}": ${reason}`);
    this.name = 'DiceParseError';
  }
}

const MAX_DICE = 100;
const MAX_SIDES = 1000;
const TERM_RE = /^(\d*)d(\d+)(?:(kh|kl)(\d+))?$|^(\d+)$/i;

export function parseDice(notation: string): DiceExpr {
  const src = notation.replace(/\s+/g, '').toLowerCase();
  if (!src) throw new DiceParseError(notation, 'empty');
  const parts = src.match(/[+-]?[^+-]+/g);
  if (!parts || parts.join('') !== src) throw new DiceParseError(notation, 'unexpected characters');
  const terms = parts.map((part): Term => {
    const sign: 1 | -1 = part.startsWith('-') ? -1 : 1;
    const body = part.replace(/^[+-]/, '');
    const m = TERM_RE.exec(body);
    if (!m) throw new DiceParseError(notation, `bad term "${body}"`);
    if (m[5] !== undefined) return { kind: 'const', sign, value: Number(m[5]) };
    const count = m[1] ? Number(m[1]) : 1;
    const sides = Number(m[2]);
    if (count < 1 || count > MAX_DICE) throw new DiceParseError(notation, `dice count must be 1–${MAX_DICE}`);
    if (sides < 2 || sides > MAX_SIDES) throw new DiceParseError(notation, `sides must be 2–${MAX_SIDES}`);
    const term: DiceTerm = { kind: 'dice', sign, count, sides };
    if (m[3]) {
      const n = Number(m[4]);
      if (n < 1 || n > count) throw new DiceParseError(notation, `keep must be 1–${count}`);
      term.keep = { which: m[3] === 'kh' ? 'highest' : 'lowest', n };
    }
    return term;
  });
  return { terms };
}

export function formatDice(expr: DiceExpr): string {
  return expr.terms
    .map((t, i) => {
      const sign = t.sign < 0 ? '-' : i > 0 ? '+' : '';
      if (t.kind === 'const') return `${sign}${t.value}`;
      const keep = t.keep ? `${t.keep.which === 'highest' ? 'kh' : 'kl'}${t.keep.n}` : '';
      return `${sign}${t.count}d${t.sides}${keep}`;
    })
    .join('');
}

export function roll(notation: string | DiceExpr, rng: Rng): RollResult {
  const expr = typeof notation === 'string' ? parseDice(notation) : notation;
  const terms = expr.terms.map((t): RolledDiceTerm | RolledConstTerm => {
    if (t.kind === 'const') return { ...t, subtotal: t.sign * t.value };
    const rolls = Array.from({ length: t.count }, () => rng.int(1, t.sides));
    const kept = keepMask(rolls, t.keep);
    const sum = rolls.reduce((acc, r, i) => (kept[i] ? acc + r : acc), 0);
    return { ...t, rolls, kept, subtotal: t.sign * sum };
  });
  return { notation: formatDice(expr), terms, total: terms.reduce((a, t) => a + t.subtotal, 0) };
}

function keepMask(rolls: number[], keep: DiceTerm['keep']): boolean[] {
  if (!keep) return rolls.map(() => true);
  const order = rolls
    .map((value, index) => ({ value, index }))
    .sort((x, y) => (keep.which === 'highest' ? y.value - x.value : x.value - y.value) || x.index - y.index);
  const keepIdx = new Set(order.slice(0, keep.n).map((o) => o.index));
  return rolls.map((_, i) => keepIdx.has(i));
}

/** Min, max and average (for AI estimates and tooltips). */
export function diceStats(notation: string | DiceExpr): { min: number; max: number; average: number } {
  const expr = typeof notation === 'string' ? parseDice(notation) : notation;
  let min = 0;
  let max = 0;
  let average = 0;
  for (const t of expr.terms) {
    if (t.kind === 'const') {
      min += t.sign * t.value;
      max += t.sign * t.value;
      average += t.sign * t.value;
      continue;
    }
    const n = t.keep?.n ?? t.count;
    const lo = n;
    const hi = n * t.sides;
    // Keep-dice averages aren't linear, so they are computed separately.
    const avg = t.keep ? keepAverage(t) : (n * (t.sides + 1)) / 2;
    if (t.sign > 0) {
      min += lo;
      max += hi;
    } else {
      min -= hi;
      max -= lo;
    }
    average += t.sign * avg;
  }
  return { min, max, average };
}

/** Exact average of NdXkhK / klK by enumeration (small pools only), else an approximation. */
function keepAverage(t: DiceTerm): number {
  if (!t.keep) return (t.count * (t.sides + 1)) / 2;
  const outcomes = t.sides ** t.count;
  if (outcomes > 200_000) return (t.keep.n * (t.sides + 1)) / 2;
  let total = 0;
  const rolls = new Array<number>(t.count).fill(1);
  for (let i = 0; i < outcomes; i++) {
    const kept = keepMask(rolls, t.keep);
    total += rolls.reduce((a, r, j) => (kept[j] ? a + r : a), 0);
    for (let j = 0; j < t.count; j++) {
      if (rolls[j]! < t.sides) {
        rolls[j]!++;
        break;
      }
      rolls[j] = 1;
    }
  }
  return total / outcomes;
}

// ---------------------------------------------------------------- d20 tests

export type RollMode = 'normal' | 'advantage' | 'disadvantage';

/** Any advantage plus any disadvantage cancel out to normal (SRD). */
export function resolveRollMode(advantageSources: number, disadvantageSources: number): RollMode {
  if (advantageSources > 0 && disadvantageSources === 0) return 'advantage';
  if (disadvantageSources > 0 && advantageSources === 0) return 'disadvantage';
  return 'normal';
}

export interface D20Roll {
  mode: RollMode;
  /** One die for normal rolls, two for advantage/disadvantage. */
  rolls: number[];
  /** The die that counts. */
  natural: number;
}

export function rollD20(rng: Rng, mode: RollMode = 'normal'): D20Roll {
  if (mode === 'normal') {
    const r = rng.int(1, 20);
    return { mode, rolls: [r], natural: r };
  }
  const rolls = [rng.int(1, 20), rng.int(1, 20)];
  const natural = mode === 'advantage' ? Math.max(...rolls) : Math.min(...rolls);
  return { mode, rolls, natural };
}

export interface Modifier {
  value: number;
  /** Where it comes from, e.g. "Persuasion", "Bless". */
  label: string;
}

export interface D20TestText {
  d20: D20Roll;
  modifiers: Modifier[];
  total: number;
  /** DC or AC, if any. */
  target?: { kind: 'DC' | 'AC'; value: number };
  outcome?: string;
}

/**
 * The visible math line, e.g.
 *   "d20: 14 + 5 (Persuasion) = 19 vs DC 15 — Success"
 *   "d20 (adv: 7, 14 → 14) + 5 (Persuasion) = 19 vs DC 15 — Success"
 * Words (adv/dis, vs, DC/AC) in `msgs`' language; the outcome comes already localized.
 */
export function formatD20Test(t: D20TestText, msgs: Messages = ENGLISH_MESSAGES): string {
  const die =
    t.d20.mode === 'normal'
      ? `d20: ${t.d20.natural}`
      : `d20 (${msgs.m(t.d20.mode === 'advantage' ? 'roll.adv' : 'roll.dis')}: ${t.d20.rolls.join(', ')} → ${t.d20.natural})`;
  const mods = t.modifiers
    .filter((m) => m.value !== 0)
    .map((m) => ` ${m.value < 0 ? '−' : '+'} ${Math.abs(m.value)} (${m.label})`)
    .join('');
  const target = t.target ? ` ${msgs.m('roll.vs', { kind: msgs.m(t.target.kind === 'DC' ? 'roll.DC' : 'roll.AC'), n: t.target.value })}` : '';
  const outcome = t.outcome ? ` — ${t.outcome}` : '';
  return `${die}${mods} = ${t.total}${target}${outcome}`;
}

/** "2d6+3: [4, 2] + 3 = 9" style text for damage and other rolls. Dropped dice shown as ~x~. */
export function formatRoll(r: RollResult, label?: string): string {
  const parts = r.terms.map((t, i) => {
    const sign = t.sign < 0 ? ' − ' : i > 0 ? ' + ' : '';
    if (t.kind === 'const') return `${sign}${t.value}`;
    const dice = t.rolls.map((v, j) => (t.kept[j] ? String(v) : `~${v}~`)).join(', ');
    return `${sign}[${dice}]`;
  });
  return `${label ? `${label} ` : ''}${r.notation}: ${parts.join('')} = ${r.total}`;
}
