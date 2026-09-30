/**
 * Clock system: announces day/night changes and new days as time passes. Long jumps (a long rest,
 * travel) report only where the clock ends up, not every phase in between.
 */
import { ENGLISH_MESSAGES } from '../i18n';
import { calendarDate, clockParts } from '../world/clock';
import type { Calendar } from '../world/lore';
import type { GameSystem, SystemEvent } from './registry';

export function clockSystem(calendar?: Calendar): GameSystem {
  return {
    id: 'clock',
    version: 1,
    onTimeAdvance(_state, from, to, { m } = ENGLISH_MESSAGES): SystemEvent[] {
      const a = clockParts(from);
      const b = clockParts(to);
      const phase = m(`clock.${b.timeOfDay}`);
      if (b.day > a.day) {
        const parts = [m('clock.newDay', { day: b.day }), ...(calendar ? [m('clock.date', { date: calendarDate(to, calendar).text })] : []), phase];
        return [{ systemId: 'clock', text: parts.join(' ') }];
      }
      if (b.timeOfDay !== a.timeOfDay) return [{ systemId: 'clock', text: phase }];
      return [];
    },
  };
}
