/**
 * Clock system: announces day/night changes and new days as time passes. Long jumps (a long rest,
 * travel) report only where the clock ends up, not every phase in between.
 */
import { calendarDate, clockParts, type TimeOfDay } from '../world/clock';
import type { Calendar } from '../world/lore';
import type { GameSystem, SystemEvent } from './registry';

const PHASE_TEXT: Record<TimeOfDay, string> = {
  dawn: 'Dawn breaks.',
  day: 'The sun is up.',
  dusk: 'Dusk settles in.',
  night: 'Night has fallen.',
};

export function clockSystem(calendar?: Calendar): GameSystem {
  return {
    id: 'clock',
    version: 1,
    onTimeAdvance(_state, from, to): SystemEvent[] {
      const a = clockParts(from);
      const b = clockParts(to);
      if (b.day > a.day) {
        const date = calendar ? ` It is ${calendarDate(to, calendar).text}.` : '';
        return [{ systemId: 'clock', text: `A new day begins (day ${b.day}).${date} ${PHASE_TEXT[b.timeOfDay]}`.trim() }];
      }
      if (b.timeOfDay !== a.timeOfDay) return [{ systemId: 'clock', text: PHASE_TEXT[b.timeOfDay] }];
      return [];
    },
  };
}
