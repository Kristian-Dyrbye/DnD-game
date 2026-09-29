/**
 * Condition evaluation and flag writes for adventure data. Conditions read world flags, time of
 * day, weather, faction reputation, hero level and visited scenes. Unknown flags are simply unset,
 * so later arcs can safely read flags that earlier arcs never wrote.
 */
import type { TimeOfDay } from '../world/clock';
import type { Condition, FlagWrite } from './schema';

export { timeOfDay, type TimeOfDay } from '../world/clock';

export type Flags = Record<string, boolean | number | string>;

export interface ConditionContext {
  flags: Flags;
  timeOfDay: TimeOfDay;
  weather?: string;
  reputation: Record<string, number>;
  level: number;
  visited: ReadonlySet<string>;
}

export function evalCondition(c: Condition | undefined, ctx: ConditionContext): boolean {
  if (!c) return true;
  if ('all' in c) return c.all.every((x) => evalCondition(x, ctx));
  if ('any' in c) return c.any.some((x) => evalCondition(x, ctx));
  if ('not' in c) return !evalCondition(c.not, ctx);
  if ('timeOfDay' in c) return c.timeOfDay.includes(ctx.timeOfDay);
  if ('weather' in c) return ctx.weather !== undefined && c.weather.includes(ctx.weather);
  if ('visited' in c) return ctx.visited.has(c.visited);
  if ('level' in c) return inRange(ctx.level, c.level.gte, c.level.lte);
  if ('reputation' in c) return inRange(ctx.reputation[c.reputation.faction] ?? 0, c.reputation.gte, c.reputation.lte);
  const v = ctx.flags[c.flag];
  if (c.exists !== undefined && (v !== undefined) !== c.exists) return false;
  if (c.eq !== undefined && v !== c.eq) return false;
  if (c.gte !== undefined || c.lte !== undefined) return typeof v === 'number' && inRange(v, c.gte, c.lte);
  // A bare { flag } means "is truthy".
  if (c.exists === undefined && c.eq === undefined) return Boolean(v);
  return true;
}

function inRange(v: number, gte?: number, lte?: number): boolean {
  return (gte === undefined || v >= gte) && (lte === undefined || v <= lte);
}

export function applyFlagWrites(flags: Flags, writes: readonly FlagWrite[]): void {
  for (const w of writes) {
    if ('set' in w) flags[w.set] = w.value;
    else if ('inc' in w) flags[w.inc] = (typeof flags[w.inc] === 'number' ? (flags[w.inc] as number) : 0) + w.by;
    else delete flags[w.clear];
  }
}

/** Every flag name a condition reads (validator + editor support). */
export function flagsRead(c: Condition | undefined, out = new Set<string>()): Set<string> {
  if (!c) return out;
  if ('all' in c) c.all.forEach((x) => flagsRead(x, out));
  else if ('any' in c) c.any.forEach((x) => flagsRead(x, out));
  else if ('not' in c) flagsRead(c.not, out);
  else if ('flag' in c) out.add(c.flag);
  return out;
}
