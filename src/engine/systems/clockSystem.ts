/**
 * Clock system: announces day/night changes and new days as time passes. Long jumps (a long rest,
 * travel) report only where the clock ends up, not every phase in between. The calendar may depend
 * on the session language (translated month/weekday names from the lore overlay).
 */
import { ENGLISH_MESSAGES, type Messages } from '../i18n';
import type { Language } from '../../shared/i18nCore';
import { calendarDate, clockParts } from '../world/clock';
import type { Calendar } from '../world/lore';
import type { GameSystem, SystemEvent } from './registry';

/** A fixed calendar, or one per session language. */
export type CalendarSource = Calendar | ((lang: Language) => Calendar | undefined);

/** "Dawnday, 1 Seedwake 1247 AR" in the language of `msgs` (names come from `cal`). */
export function dateText(minutes: number, cal: Calendar, { m }: Messages = ENGLISH_MESSAGES): string {
  const d = calendarDate(minutes, cal);
  return m('clock.dateText', { weekday: d.weekday, day: d.dayOfMonth, month: d.month, year: d.year, suffix: cal.yearSuffix });
}

export function clockSystem(calendar?: CalendarSource): GameSystem {
  return {
    id: 'clock',
    version: 1,
    onTimeAdvance(_state, from, to, msgs = ENGLISH_MESSAGES): SystemEvent[] {
      const { m } = msgs;
      const a = clockParts(from);
      const b = clockParts(to);
      const phase = m(`clock.${b.timeOfDay}`);
      if (b.day > a.day) {
        const cal = typeof calendar === 'function' ? calendar(msgs.lang) : calendar;
        const parts = [m('clock.newDay', { day: b.day }), ...(cal ? [m('clock.date', { date: dateText(to, cal, msgs) })] : []), phase];
        return [{ systemId: 'clock', text: parts.join(' ') }];
      }
      if (b.timeOfDay !== a.timeOfDay) return [{ systemId: 'clock', text: phase }];
      return [];
    },
  };
}
