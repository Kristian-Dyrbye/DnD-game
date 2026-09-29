import { describe, expect, it } from 'vitest';
import { dieClass, keptIndex, modeLabel, outcomeLabel } from './dice';

describe('dice tray helpers', () => {
  it('picks the die that counts', () => {
    expect(keptIndex({ dice: [12] })).toBe(0);
    expect(keptIndex({ dice: [4, 17], mode: 'advantage' })).toBe(1);
    expect(keptIndex({ dice: [4, 17], mode: 'disadvantage' })).toBe(0);
    expect(keptIndex({ dice: [9, 9], mode: 'advantage' })).toBe(0);
  });

  it('marks crits and fumbles only on the kept die', () => {
    expect(dieClass(20, true)).toContain('crit');
    expect(dieClass(20, false)).not.toContain('crit');
    expect(dieClass(1, true)).toContain('fumble');
    expect(dieClass(7, false)).toContain('dropped');
  });

  it('labels mode and outcome', () => {
    expect(modeLabel({ mode: 'advantage' })).toBe('Advantage');
    expect(modeLabel({ mode: 'normal' })).toBeUndefined();
    expect(outcomeLabel({ success: false })).toBe('Failure');
    expect(outcomeLabel({})).toBeUndefined();
  });
});
