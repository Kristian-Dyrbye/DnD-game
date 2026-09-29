import { describe, expect, it } from 'vitest';
import { WOUND_LOOK, woundLevel, woundWords } from './wounds';

describe('temporary wounds', () => {
  it('scale with missing HP and vanish when healed', () => {
    expect(woundLevel(20, 20)).toBe(0);
    expect(woundLevel(19, 20)).toBe(0);
    expect(woundLevel(17, 20)).toBe(1);
    expect(woundLevel(10, 20)).toBe(2);
    expect(woundLevel(3, 20)).toBe(3);
    expect(woundLevel(0, 20)).toBe(4);
    expect(woundLevel(20, 20)).toBe(0); // after a long rest
  });

  it('more decals and opacity at each step', () => {
    for (const l of [1, 2, 3, 4] as const) {
      expect(WOUND_LOOK[l].decals).toBeGreaterThan(WOUND_LOOK[(l - 1) as 0 | 1 | 2 | 3].decals);
      expect(WOUND_LOOK[l].opacity).toBeGreaterThan(WOUND_LOOK[(l - 1) as 0 | 1 | 2 | 3].opacity);
    }
    expect(woundWords(0)).toBeUndefined();
    expect(woundWords(3)).toBe('badly wounded');
  });
});
