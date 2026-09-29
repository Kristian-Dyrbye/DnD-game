/** Pure helpers for the dice tray (which die counts, crit/fumble styling, outcome text). */
import type { RollRecord } from '../../../engine/session/gameState';

/** Index of the die that counts: the higher for advantage, the lower for disadvantage. */
export function keptIndex(r: Pick<RollRecord, 'dice' | 'mode'>): number {
  if (r.dice.length < 2 || !r.mode || r.mode === 'normal') return 0;
  const best = r.mode === 'advantage' ? Math.max(...r.dice) : Math.min(...r.dice);
  return r.dice.indexOf(best);
}

export function dieClass(value: number, kept: boolean): string {
  return ['die', 'd20', kept ? 'kept' : 'dropped', kept && value === 20 ? 'crit' : '', kept && value === 1 ? 'fumble' : ''].filter(Boolean).join(' ');
}

export function modeLabel(r: Pick<RollRecord, 'mode'>): string | undefined {
  return r.mode === 'advantage' ? 'Advantage' : r.mode === 'disadvantage' ? 'Disadvantage' : undefined;
}

export function outcomeLabel(r: Pick<RollRecord, 'success'>): string | undefined {
  return r.success === undefined ? undefined : r.success ? 'Success' : 'Failure';
}
