import { describe, expect, it } from 'vitest';
import { firstSentence, formatClock, formatCoins, plain } from './text';

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

describe('item display helpers', () => {
  it('reorders comma names and groups duplicates', async () => {
    const { itemDisplayName, groupNames } = await import('./text');
    expect(itemDisplayName("Clothes, Traveler's")).toBe("Traveler's Clothes");
    expect(itemDisplayName('Rope')).toBe('Rope');
    expect(groupNames([{ name: 'Javelin', quantity: 1 }, { name: 'Javelin', quantity: 1 }, { name: 'Arrows', quantity: 20 }, { name: 'Shield', quantity: 1, note: 'equipped' }])).toEqual(['2 × Javelin', '20 × Arrows', 'Shield (equipped)']);
  });

  it('formats the campaign clock', () => {
    expect(formatClock(8 * 60, 'day')).toBe('Day 1, 08:00 (day)');
    expect(formatClock(1440 + 19 * 60 + 5, 'dusk')).toBe('Day 2, 19:05 (dusk)');
  });
});
