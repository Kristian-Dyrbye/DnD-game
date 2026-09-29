import { describe, expect, it } from 'vitest';
import { Rng } from './rng';
import {
  DiceParseError,
  diceStats,
  formatD20Test,
  formatDice,
  formatRoll,
  parseDice,
  resolveRollMode,
  roll,
  rollD20,
} from './dice';

/** An Rng stand-in that returns fixed die faces (for exact math tests). */
function fixed(...faces: number[]): Rng {
  const queue = [...faces];
  return {
    int: (min: number, max: number) => {
      const v = queue.shift();
      if (v === undefined) throw new Error('fixed rng exhausted');
      if (v < min || v > max) throw new Error(`face ${v} outside [${min}, ${max}]`);
      return v;
    },
  } as unknown as Rng;
}

describe('Rng', () => {
  it('is deterministic per seed and differs across seeds', () => {
    const a = Rng.fromSeed('dragon');
    const b = Rng.fromSeed('dragon');
    const c = Rng.fromSeed('dragons');
    const seqA = Array.from({ length: 10 }, () => a.int(1, 20));
    expect(Array.from({ length: 10 }, () => b.int(1, 20))).toEqual(seqA);
    expect(Array.from({ length: 10 }, () => c.int(1, 20))).not.toEqual(seqA);
  });

  it('can save and restore state mid-sequence', () => {
    const r = Rng.fromSeed(42);
    r.next();
    const saved = r.getState();
    const expected = [r.next(), r.next(), r.next()];
    const restored = new Rng(JSON.parse(JSON.stringify(saved)));
    expect([restored.next(), restored.next(), restored.next()]).toEqual(expected);
  });

  it('produces every d20 face with a roughly uniform distribution', () => {
    const r = Rng.fromSeed(1);
    const counts = new Array(21).fill(0);
    for (let i = 0; i < 20_000; i++) counts[r.int(1, 20)]++;
    expect(counts[0]).toBe(0);
    for (let f = 1; f <= 20; f++) expect(counts[f]).toBeGreaterThan(850); // expected 1000
  });

  it('picks, shuffles and rejects bad ranges', () => {
    const r = Rng.fromSeed(7);
    expect(['a', 'b', 'c']).toContain(r.pick(['a', 'b', 'c']));
    expect(r.shuffle([1, 2, 3, 4]).sort()).toEqual([1, 2, 3, 4]);
    expect(() => r.int(5, 1)).toThrow(RangeError);
    expect(() => r.pick([])).toThrow(RangeError);
  });
});

describe('parseDice / formatDice', () => {
  it('parses common notation', () => {
    expect(parseDice('1d20+5').terms).toEqual([
      { kind: 'dice', sign: 1, count: 1, sides: 20 },
      { kind: 'const', sign: 1, value: 5 },
    ]);
    expect(parseDice('d8').terms[0]).toMatchObject({ count: 1, sides: 8 });
    expect(parseDice('4d6kh3').terms[0]).toMatchObject({ keep: { which: 'highest', n: 3 } });
    expect(parseDice('2D20KL1').terms[0]).toMatchObject({ keep: { which: 'lowest', n: 1 } });
    expect(parseDice(' 2d6 + 1d4 - 1 ').terms).toHaveLength(3);
  });

  it('round-trips through formatDice', () => {
    for (const n of ['1d20+5', '4d6kh3', '2d6+1d4-1', '-1+1d4', '8d6']) {
      expect(formatDice(parseDice(n))).toBe(n);
    }
  });

  it('rejects bad notation', () => {
    for (const bad of ['', 'abc', '1d', 'd1', '0d6', '101d6', '1d6kh2', '2d6++1', '1d6*2']) {
      expect(() => parseDice(bad), bad).toThrow(DiceParseError);
    }
  });
});

describe('roll', () => {
  it('sums dice and constants', () => {
    const r = roll('2d6+3', fixed(4, 2));
    expect(r.total).toBe(9);
    expect(formatRoll(r, 'Longsword')).toBe('Longsword 2d6+3: [4, 2] + 3 = 9');
  });

  it('keeps highest 3 of 4d6 (ability score generation)', () => {
    const r = roll('4d6kh3', fixed(3, 6, 1, 5));
    expect(r.total).toBe(14);
    expect(r.terms[0]).toMatchObject({ kept: [true, true, false, true] });
    expect(formatRoll(r)).toBe('4d6kh3: [3, 6, ~1~, 5] = 14');
  });

  it('drops only one of two equal lowest dice', () => {
    const r = roll('4d6kh3', fixed(2, 2, 5, 6));
    expect(r.total).toBe(13);
  });

  it('handles negative terms', () => {
    const r = roll('1d4-1d4-2', fixed(3, 1));
    expect(r.total).toBe(0);
    expect(formatRoll(r)).toBe('1d4-1d4-2: [3] − [1] − 2 = 0');
  });

  it('stays within range with a real rng', () => {
    const rng = Rng.fromSeed('range');
    for (let i = 0; i < 500; i++) {
      const t = roll('3d6+2', rng).total;
      expect(t).toBeGreaterThanOrEqual(5);
      expect(t).toBeLessThanOrEqual(20);
    }
  });
});

describe('diceStats', () => {
  it('computes min/max/average', () => {
    expect(diceStats('2d6+3')).toEqual({ min: 5, max: 15, average: 10 });
    expect(diceStats('1d20-1d4')).toEqual({ min: -3, max: 19, average: 8 });
  });

  it('computes exact keep-highest averages', () => {
    expect(diceStats('4d6kh3').average).toBeCloseTo(12.2446, 3);
    expect(diceStats('2d20kh1').average).toBeCloseTo(13.825, 3);
  });
});

describe('d20 tests', () => {
  it('advantage and disadvantage cancel out', () => {
    expect(resolveRollMode(1, 0)).toBe('advantage');
    expect(resolveRollMode(0, 2)).toBe('disadvantage');
    expect(resolveRollMode(3, 1)).toBe('normal');
    expect(resolveRollMode(0, 0)).toBe('normal');
  });

  it('rolls one die normally and two with advantage/disadvantage', () => {
    expect(rollD20(fixed(11))).toEqual({ mode: 'normal', rolls: [11], natural: 11 });
    expect(rollD20(fixed(7, 14), 'advantage')).toEqual({ mode: 'advantage', rolls: [7, 14], natural: 14 });
    expect(rollD20(fixed(7, 14), 'disadvantage')).toEqual({ mode: 'disadvantage', rolls: [7, 14], natural: 7 });
  });

  it('formats the visible math line (spec §8 example)', () => {
    expect(
      formatD20Test({
        d20: { mode: 'normal', rolls: [14], natural: 14 },
        modifiers: [{ value: 5, label: 'Persuasion' }],
        total: 19,
        target: { kind: 'DC', value: 15 },
        outcome: 'Success',
      }),
    ).toBe('d20: 14 + 5 (Persuasion) = 19 vs DC 15 — Success');
  });

  it('shows both dice and negative modifiers', () => {
    expect(
      formatD20Test({
        d20: { mode: 'disadvantage', rolls: [18, 3], natural: 3 },
        modifiers: [
          { value: 4, label: 'Longsword' },
          { value: -2, label: 'Exhaustion' },
          { value: 0, label: 'ignored' },
        ],
        total: 5,
        target: { kind: 'AC', value: 13 },
        outcome: 'Miss',
      }),
    ).toBe('d20 (dis: 18, 3 → 3) + 4 (Longsword) − 2 (Exhaustion) = 5 vs AC 13 — Miss');
  });
});
