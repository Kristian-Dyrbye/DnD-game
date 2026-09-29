import { describe, expect, it } from 'vitest';
import type { Rng } from '../core/rng';
import { Rng as SeededRng } from '../core/rng';
import {
  POINT_BUY_BUDGET,
  STANDARD_ARRAY,
  canAdjustPointBuy,
  pointBuyCost,
  roll4d6DropLowest,
  rollAbilitySet,
  scoreProblems,
  suggestAssignment,
  suggestBackgroundBonus,
} from './abilityScores';

const fixed = (...faces: number[]): Rng => {
  const q = [...faces];
  return { int: () => q.shift() ?? 1 } as unknown as Rng;
};

describe('point buy', () => {
  it('uses the standard cost table (8 = 0 … 15 = 9)', () => {
    expect(pointBuyCost({ str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 })).toBe(0);
    expect(pointBuyCost({ str: 15, dex: 15, con: 15, int: 8, wis: 8, cha: 8 })).toBe(27);
    expect(pointBuyCost({ str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 })).toBe(9 + 7 + 5 + 4 + 2 + 0);
  });

  it('allows adjustments inside 8–15 and the 27-point budget', () => {
    const full = { str: 15, dex: 15, con: 15, int: 8, wis: 8, cha: 8 };
    expect(canAdjustPointBuy(full, 'int', 1)).toBe(false);
    expect(canAdjustPointBuy(full, 'str', 1)).toBe(false);
    expect(canAdjustPointBuy(full, 'str', -1)).toBe(true);
    expect(canAdjustPointBuy({}, 'wis', -1)).toBe(false);
    expect(POINT_BUY_BUDGET).toBe(27);
  });
});

describe('4d6 drop lowest', () => {
  it('keeps the three highest dice', () => {
    expect(roll4d6DropLowest(fixed(2, 6, 1, 5)).total).toBe(13);
  });

  it('rolls six scores between 3 and 18', () => {
    const set = rollAbilitySet(SeededRng.fromSeed('abilities'));
    expect(set).toHaveLength(6);
    for (const r of set) {
      expect(r.total).toBeGreaterThanOrEqual(3);
      expect(r.total).toBeLessThanOrEqual(18);
    }
  });
});

describe('assignment validation', () => {
  const array = { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 };

  it('standard array must use each value once', () => {
    expect(scoreProblems('standard_array', array)).toEqual([]);
    expect(scoreProblems('standard_array', { ...array, cha: 15 })).toEqual(['Use each Standard Array value once']);
    expect(scoreProblems('standard_array', { str: 15 })).toEqual(['Assign all six scores']);
    expect([...STANDARD_ARRAY]).toEqual([15, 14, 13, 12, 10, 8]);
  });

  it('point buy must stay within 8–15 and 27 points', () => {
    expect(scoreProblems('point_buy', array)).toEqual([]);
    expect(scoreProblems('point_buy', { ...array, str: 16 })).toEqual(['Point buy scores must be 8–15']);
    expect(scoreProblems('point_buy', { str: 15, dex: 15, con: 15, int: 15, wis: 8, cha: 8 })).toEqual(['Point buy costs 36/27']);
  });

  it('rolled values must match the pool', () => {
    const pool = [16, 12, 11, 10, 9, 7];
    expect(scoreProblems('roll', { str: 16, dex: 12, con: 11, int: 10, wis: 9, cha: 7 }, pool)).toEqual([]);
    expect(scoreProblems('roll', { str: 16, dex: 16, con: 11, int: 10, wis: 9, cha: 7 }, pool)).toEqual(['Use each rolled value once']);
    expect(scoreProblems('roll', array)).toEqual(['Roll your scores']);
    expect(scoreProblems(undefined, array)).toEqual(['Choose a method']);
  });
});

describe('suggestions', () => {
  it('puts high values in primary abilities, then Con and Dex', () => {
    expect(suggestAssignment([...STANDARD_ARRAY], ['str'])).toEqual({ str: 15, con: 14, dex: 13, wis: 12, cha: 10, int: 8 });
    expect(suggestAssignment([...STANDARD_ARRAY], ['dex', 'wis'])).toEqual({ dex: 15, wis: 14, con: 13, str: 12, cha: 10, int: 8 });
  });

  it('suggests +2 to the primary background ability', () => {
    expect(suggestBackgroundBonus(['str', 'dex', 'con'], ['str'], { str: 15, dex: 13, con: 14 })).toEqual({ str: 2, con: 1 });
  });
});
