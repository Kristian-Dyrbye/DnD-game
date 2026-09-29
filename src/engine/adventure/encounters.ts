/**
 * Encounter building (SRD 5.2 "Combat Encounters"): XP budget per character by level and
 * difficulty (Low / Moderate / High), summed over the party so solo play and bigger parties
 * both scale; monsters' XP is compared to the budget with no group multiplier (2024 rules).
 * buildEncounter() picks random monsters from a candidate list to fill a budget.
 */
import type { Rng } from '../core/rng';
import type { Monster, RulesTables } from '../data/schemas';

export type Difficulty = 'low' | 'moderate' | 'high';
const INDEX: Record<Difficulty, 0 | 1 | 2> = { low: 0, moderate: 1, high: 2 };

export function xpBudget(partyLevels: number[], difficulty: Difficulty, tables: RulesTables): number {
  return partyLevels.reduce((sum, lvl) => sum + tables.encounterBudget[Math.min(20, Math.max(1, lvl)) - 1]![INDEX[difficulty]], 0);
}

export function encounterXp(monsters: Pick<Monster, 'xp'>[]): number {
  return monsters.reduce((s, m) => s + m.xp, 0);
}

/** Which difficulty band the monsters fall in for this party ('trivial' under Low, 'deadly' over High). */
export function rateEncounter(partyLevels: number[], monsters: Pick<Monster, 'xp'>[], tables: RulesTables): Difficulty | 'trivial' | 'deadly' {
  const xp = encounterXp(monsters);
  if (xp > xpBudget(partyLevels, 'high', tables)) return 'deadly';
  if (xp > xpBudget(partyLevels, 'moderate', tables)) return 'high';
  if (xp > xpBudget(partyLevels, 'low', tables)) return 'moderate';
  return xp >= xpBudget(partyLevels, 'low', tables) * 0.5 ? 'low' : 'trivial';
}

export interface EncounterOptions {
  partyLevels: number[];
  difficulty: Difficulty;
  candidates: Monster[];
  rng: Rng;
  /** Max creatures (the SRD advises against huge hordes; default 2 per character + 2). */
  maxMonsters?: number;
  /** Skip monsters whose CR exceeds the highest party level (SRD advice), default true. */
  capCrToPartyLevel?: boolean;
}

export interface Encounter {
  monsters: Monster[];
  xp: number;
  budget: number;
}

/** Randomly fills the XP budget without going over. Always returns at least one monster if any fits. */
export function buildEncounter(o: EncounterOptions, tables: RulesTables): Encounter {
  const budget = xpBudget(o.partyLevels, o.difficulty, tables);
  const maxLevel = Math.max(...o.partyLevels);
  const max = o.maxMonsters ?? o.partyLevels.length * 2 + 2;
  let pool = o.candidates.filter((m) => m.xp > 0 && m.xp <= budget && (o.capCrToPartyLevel === false || m.cr <= maxLevel));
  if (pool.length === 0) pool = [...o.candidates].sort((a, b) => a.xp - b.xp).slice(0, 1);
  const chosen: Monster[] = [];
  let spent = 0;
  // Start with a "leader" from the upper half of what fits, then fill with anything that still fits.
  const sorted = [...pool].sort((a, b) => b.xp - a.xp);
  const top = sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 2)));
  const leader = o.rng.pick(top);
  chosen.push(leader);
  spent += leader.xp;
  while (chosen.length < max) {
    const fits = pool.filter((m) => spent + m.xp <= budget);
    if (fits.length === 0) break;
    // Prefer repeating an already-chosen monster (coherent groups), else any that fits.
    const same = fits.filter((m) => chosen.some((c) => c.id === m.id));
    const next = same.length && o.rng.next() < 0.6 ? o.rng.pick(same) : o.rng.pick(fits);
    chosen.push(next);
    spent += next.xp;
  }
  return { monsters: chosen, xp: spent, budget };
}

/**
 * Scales an authored monster list to the actual party (spec §6, DESIGN §0): minions (the cheapest
 * non-boss monsters) are removed while the fight is above the High budget, and added from `pool`
 * while it is below the Low budget. Bosses (`bossIds`) are never removed.
 */
export function scaleMonsters(
  monsters: { id: string; count: number }[],
  partyLevels: number[],
  db: { monsters: ReadonlyMap<string, Pick<Monster, 'xp'>> },
  tables: RulesTables,
  opts: { pool?: string[]; bossIds?: string[] } = {},
): { id: string; count: number }[] {
  const out = monsters.map((m) => ({ ...m }));
  const xpOf = (id: string) => db.monsters.get(id)?.xp ?? 0;
  const total = () => out.reduce((s, m) => s + xpOf(m.id) * m.count, 0);
  const high = xpBudget(partyLevels, 'high', tables);
  const low = xpBudget(partyLevels, 'low', tables);
  const bosses = new Set(opts.bossIds ?? []);
  for (let guard = 0; guard < 40 && total() > high; guard++) {
    const living = out.filter((m) => m.count > 0);
    if (living.reduce((s, m) => s + m.count, 0) <= 1) break;
    const minion = living.filter((m) => !bosses.has(m.id)).sort((a, b) => xpOf(a.id) - xpOf(b.id))[0];
    if (!minion) break;
    minion.count--;
  }
  const pool = (opts.pool ?? []).filter((id) => xpOf(id) > 0).sort((a, b) => xpOf(a) - xpOf(b));
  for (let guard = 0; guard < 20 && pool.length && total() < low; guard++) {
    const add = pool[0]!;
    if (total() + xpOf(add) > high) break;
    const ex = out.find((m) => m.id === add);
    if (ex) ex.count++;
    else out.push({ id: add, count: 1 });
  }
  return out.filter((m) => m.count > 0);
}
