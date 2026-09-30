/**
 * Ability score generation (SRD 5.2): Standard Array (15, 14, 13, 12, 10, 8), Point Buy (27
 * points, scores 8–15 with the standard costs) and 4d6-drop-lowest rolls assigned by the player.
 * Also a suggested assignment that puts the highest values into a class's primary abilities.
 */
import { roll, type RollResult } from '../core/dice';
import type { Rng } from '../core/rng';
import { ABILITIES, type Ability, type AbilityScores } from '../rules/basics';
import type { AbilityMethod } from './creator';
import { ENGLISH, type Translator } from '../../shared/i18n';

export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8] as const;
export const POINT_BUY_BUDGET = 27;
export const POINT_BUY_COST: Record<number, number> = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
export const POINT_BUY_MIN = 8;
export const POINT_BUY_MAX = 15;

export function pointBuyCost(scores: Partial<AbilityScores>): number {
  return ABILITIES.reduce((sum, a) => sum + (POINT_BUY_COST[scores[a] ?? 8] ?? Infinity), 0);
}

/** Can this ability go up/down by one in point buy? */
export function canAdjustPointBuy(scores: Partial<AbilityScores>, ability: Ability, delta: 1 | -1): boolean {
  const next = (scores[ability] ?? 8) + delta;
  if (next < POINT_BUY_MIN || next > POINT_BUY_MAX) return false;
  return pointBuyCost({ ...scores, [ability]: next }) <= POINT_BUY_BUDGET;
}

export interface AbilityRoll {
  roll: RollResult;
  total: number;
}

/** One 4d6-drop-lowest roll. */
export function roll4d6DropLowest(rng: Rng): AbilityRoll {
  const r = roll('4d6kh3', rng);
  return { roll: r, total: r.total };
}

/** Six rolls for the Roll method. */
export function rollAbilitySet(rng: Rng): AbilityRoll[] {
  return Array.from({ length: 6 }, () => roll4d6DropLowest(rng));
}

const sameMultiset = (a: number[], b: number[]) => a.length === b.length && [...a].sort().join(',') === [...b].sort().join(',');

/** Problems with an assignment for a method (empty = valid and complete). */
export function scoreProblems(method: AbilityMethod | undefined, scores: Partial<AbilityScores>, rolledPool?: number[], tr: Translator = ENGLISH): string[] {
  if (!method) return [tr.t('creator.problem.method')];
  const values = ABILITIES.map((a) => scores[a]);
  if (values.some((v) => v === undefined)) return [tr.t('creator.problem.assignAll')];
  const nums = values as number[];
  switch (method) {
    case 'standard_array':
      return sameMultiset(nums, [...STANDARD_ARRAY]) ? [] : [tr.t('creator.problem.useArray')];
    case 'point_buy': {
      if (nums.some((v) => v < POINT_BUY_MIN || v > POINT_BUY_MAX)) return [tr.t('creator.problem.pointRange')];
      const cost = pointBuyCost(scores);
      return cost > POINT_BUY_BUDGET ? [tr.t('creator.problem.pointCost', { cost, budget: POINT_BUY_BUDGET })] : [];
    }
    case 'roll':
      if (!rolledPool || rolledPool.length !== 6) return [tr.t('creator.problem.roll')];
      return sameMultiset(nums, rolledPool) ? [] : [tr.t('creator.problem.useRolled')];
  }
}

/** Assigns values (highest first) to the class's primary abilities, then Con, Dex, Wis, the rest. */
export function suggestAssignment(values: number[], primary: Ability[]): AbilityScores {
  const order: Ability[] = [...primary];
  for (const a of ['con', 'dex', 'wis', 'str', 'cha', 'int'] as Ability[]) if (!order.includes(a)) order.push(a);
  const sorted = [...values].sort((a, b) => b - a);
  const out = {} as AbilityScores;
  order.forEach((a, i) => (out[a] = sorted[i] ?? 8));
  return out;
}

/** Suggested background increase: +2 to the best primary option, +1 to the next best. */
export function suggestBackgroundBonus(options: Ability[], primary: Ability[], scores: Partial<AbilityScores>): Partial<Record<Ability, number>> {
  const ranked = [...options].sort((a, b) => Number(primary.includes(b)) - Number(primary.includes(a)) || (scores[b] ?? 0) - (scores[a] ?? 0));
  return { [ranked[0]!]: 2, [ranked[1]!]: 1 };
}
