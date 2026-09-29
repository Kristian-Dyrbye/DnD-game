import { describe, expect, it } from 'vitest';
import { firstSentence, formatCoins, plain } from './text';

describe('UI text helpers', () => {
  it('strips emphasis and trims to the first sentence', () => {
    expect(plain('_Luck._ When you **roll** a 1')).toBe('Luck. When you roll a 1');
    expect(firstSentence('You gain the following benefits. More text.')).toBe('You gain the following benefits.');
    expect(firstSentence('a'.repeat(300), 20)).toHaveLength(20);
  });

  it('formats coins', () => {
    expect(formatCoins(5000)).toBe('50 GP');
    expect(formatCoins(1455)).toBe('14 GP 5 SP 5 CP');
    expect(formatCoins(0)).toBe('0 GP');
  });
});
