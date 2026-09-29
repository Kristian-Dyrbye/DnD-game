/**
 * Campaign clock (spec §11.3). Time is whole minutes since the campaign began (day 1, 00:00 =
 * 1 Seedwake of the lore calendar's start year). Everything that takes time — exploring, travel,
 * rests, downtime — advances it through SystemRegistry.advanceTime so systems can react.
 */
import type { Calendar, Season } from './lore';

export const MINUTES_PER_DAY = 24 * 60;

/** Default durations in minutes. Travel time is computed by the travel system (A074). */
export const TIME_COSTS = {
  /** Performing a scene action (searching, talking, a skill attempt). */
  explore_action: 10,
  /** A quick improvised attempt or a look around. */
  quick_action: 5,
  short_rest: 60,
  long_rest: 8 * 60,
  /** One day of downtime activity. */
  downtime_day: 8 * 60,
} as const;

export type TimeOfDay = 'dawn' | 'day' | 'dusk' | 'night';

export function timeOfDay(minutes: number): TimeOfDay {
  const hour = Math.floor(minutes / 60) % 24;
  if (hour >= 5 && hour < 7) return 'dawn';
  if (hour >= 7 && hour < 18) return 'day';
  if (hour >= 18 && hour < 20) return 'dusk';
  return 'night';
}

export interface ClockParts {
  /** 1-based campaign day. */
  day: number;
  hour: number;
  minute: number;
  timeOfDay: TimeOfDay;
}

export function clockParts(minutes: number): ClockParts {
  const m = Math.max(0, Math.floor(minutes));
  return { day: Math.floor(m / MINUTES_PER_DAY) + 1, hour: Math.floor((m % MINUTES_PER_DAY) / 60), minute: m % 60, timeOfDay: timeOfDay(m) };
}

export interface CalendarDate {
  year: number;
  /** 0-based month index. */
  monthIndex: number;
  month: string;
  dayOfMonth: number;
  weekday: string;
  season: Season;
  /** "Dawnday, 1 Seedwake 1247 AR". */
  text: string;
}

export function calendarDate(minutes: number, cal: Calendar): CalendarDate {
  const dayIndex = clockParts(minutes).day - 1;
  const year = cal.startYear + Math.floor(dayIndex / cal.daysPerYear);
  const dayOfYear = dayIndex % cal.daysPerYear;
  const monthIndex = Math.min(cal.months.length - 1, Math.floor(dayOfYear / cal.daysPerMonth));
  const month = cal.months[monthIndex]!;
  const dayOfMonth = (dayOfYear % cal.daysPerMonth) + 1;
  const weekday = cal.weekdays[dayIndex % cal.weekdays.length]!.name;
  return { year, monthIndex, month: month.name, dayOfMonth, weekday, season: month.season, text: `${weekday}, ${dayOfMonth} ${month.name} ${year} ${cal.yearSuffix}` };
}
