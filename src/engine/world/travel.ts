/**
 * Overland travel (spec §11.1) on the lore route graph. SRD 5.2.1 travel pace (Fast 4 mph,
 * Normal 3 mph, Slow 2 mph; 8 travel hours a day; Fast gives Disadvantage on Perception/Survival/
 * Stealth, Normal on Stealth, Slow gives Advantage on Perception/Survival), trails cap the pace at
 * Normal while good roads allow Fast. Ships sail day and night. Weather slows travel and brings
 * heat/cold hazards; random travel events (data/tables/travel-events.json) are rolled per day.
 * Locations become known when you reach them or a neighbour; you can only plan routes you know.
 */
import { z } from 'zod';
import { roll } from '../core/dice';
import type { Rng } from '../core/rng';
import { savingThrow, skillCheck, type D20TestResult } from '../rules/checks';
import { SKILLS, type Skill } from '../rules/basics';
import type { GameState } from '../session/gameState';
import { MINUTES_PER_DAY, timeOfDay } from './clock';
import type { Lore, Route } from './lore';
import { weatherAt, weatherEffects } from './weather';

// ---------------------------------------------------------------- data

export const PACES = ['slow', 'normal', 'fast'] as const;
export type Pace = (typeof PACES)[number];

export const PACE_MPH: Record<Pace, number> = { slow: 2, normal: 3, fast: 4 };
/** SRD travel pace effects on the travelers' checks. */
export const PACE_EFFECTS: Record<Pace, { advantage: Skill[]; disadvantage: Skill[] }> = {
  fast: { advantage: [], disadvantage: ['perception', 'survival', 'stealth'] },
  normal: { advantage: [], disadvantage: ['stealth'] },
  slow: { advantage: ['perception', 'survival'], disadvantage: [] },
};
export const TRAVEL_HOURS_PER_DAY = 8;
/** Ship speed for sea legs (a sailing ship crewed for round-the-clock travel). */
export const SEA_MPH = 3;
export const RIVER_MPH = 2;

const MonsterRef = z.object({ id: z.string(), count: z.number().int().min(1).default(1) });
export const TravelEventSchema = z.object({
  id: z.string(),
  regions: z.array(z.string()).default([]),
  routes: z.array(z.enum(['road', 'trail', 'sea', 'river'])).default([]),
  weather: z.array(z.string()).default([]),
  timeOfDay: z.array(z.enum(['dawn', 'day', 'dusk', 'night'])).default([]),
  weight: z.number().int().min(1).default(1),
  kind: z.enum(['flavor', 'encounter', 'hazard', 'discovery']),
  text: z.string(),
  monsters: z.array(MonsterRef).default([]),
  check: z
    .object({
      skill: z.enum(SKILLS as [Skill, ...Skill[]]),
      dc: z.number().int().min(1).max(30),
      success: z.string(),
      failure: z.string(),
      failureMinutes: z.number().int().min(0).default(0),
      failureExhaustion: z.number().int().min(0).max(2).default(0),
      failureDamage: z.string().optional(),
    })
    .optional(),
});
export type TravelEvent = z.infer<typeof TravelEventSchema>;
export const TravelEventTableSchema = z.object({ chancePerDay: z.number().min(0).max(1), events: z.array(TravelEventSchema) });
export type TravelEventTable = z.infer<typeof TravelEventTableSchema>;

// ---------------------------------------------------------------- map knowledge

export interface MapState {
  current: string;
  visited: string[];
  /** Known (shown on the map, can be travelled to). Includes visited. */
  known: string[];
}

export function getMap(state: GameState): MapState | undefined {
  return state.extensions.map as MapState | undefined;
}

export function neighbours(lore: Lore, id: string): Route[] {
  return lore.routes.filter((r) => r.from === id || r.to === id);
}

const other = (r: Route, id: string) => (r.from === id ? r.to : r.from);

/** Initial map: the starting location plus the places its routes lead to. */
export function initialMap(lore: Lore, start?: string): MapState {
  const id = start ?? lore.locations.find((l) => l.tags.includes('starting_location'))?.id ?? lore.locations[0]!.id;
  return { current: id, visited: [id], known: [id, ...neighbours(lore, id).map((r) => other(r, id))] };
}

/** Marks a location visited (and its neighbours known), making it current. */
export function arriveAt(map: MapState, lore: Lore, id: string): void {
  map.current = id;
  if (!map.visited.includes(id)) map.visited.push(id);
  for (const k of [id, ...neighbours(lore, id).map((r) => other(r, id))]) if (!map.known.includes(k)) map.known.push(k);
}

/** Reveal a location by story (a map, a rumour). */
export function discover(map: MapState, ids: string[]): void {
  for (const k of ids) if (!map.known.includes(k)) map.known.push(k);
}

// ---------------------------------------------------------------- planning

export interface Leg {
  from: string;
  to: string;
  kind: Route['kind'];
  miles: number;
}

/** Max pace on a route kind: good roads allow Fast, trails cap at Normal (SRD "Good Roads"). */
export function effectivePace(kind: Route['kind'], wanted: Pace): Pace {
  if (kind === 'trail' && wanted === 'fast') return 'normal';
  return wanted;
}

/** Travel hours for a leg (water legs use vessel speed; weather slows everything). */
export function legHours(leg: Leg, pace: Pace, weatherMultiplier = 1): number {
  const mph = leg.kind === 'sea' ? SEA_MPH : leg.kind === 'river' ? RIVER_MPH : PACE_MPH[effectivePace(leg.kind, pace)];
  return leg.miles / (mph * weatherMultiplier);
}

/** Fastest known route (Dijkstra on normal-pace hours). */
export function planRoute(lore: Lore, from: string, to: string, known?: readonly string[]): Leg[] | undefined {
  if (from === to) return [];
  const ok = (id: string) => !known || known.includes(id);
  const dist = new Map<string, number>([[from, 0]]);
  const prev = new Map<string, Leg>();
  const open = new Set<string>([from]);
  while (open.size) {
    const cur = [...open].reduce((a, b) => (dist.get(a)! <= dist.get(b)! ? a : b));
    open.delete(cur);
    if (cur === to) break;
    for (const r of neighbours(lore, cur)) {
      const next = other(r, cur);
      if (!ok(next)) continue;
      const leg: Leg = { from: cur, to: next, kind: r.kind, miles: r.miles };
      const d = dist.get(cur)! + legHours(leg, 'normal');
      if (d < (dist.get(next) ?? Infinity)) {
        dist.set(next, d);
        prev.set(next, leg);
        open.add(next);
      }
    }
  }
  if (!prev.has(to)) return undefined;
  const legs: Leg[] = [];
  for (let at = to; at !== from; ) {
    const leg = prev.get(at)!;
    legs.unshift(leg);
    at = leg.from;
  }
  return legs;
}

// ---------------------------------------------------------------- travelling

export interface TravelContext {
  state: GameState;
  lore: Lore;
  rng: Rng;
  events?: TravelEventTable;
}

export interface TravelLog {
  day: number;
  text: string;
  eventId?: string;
}

export interface TravelResult {
  ok: boolean;
  error?: string;
  legs: Leg[];
  /** Minutes that passed (travel + nights camped). */
  minutes: number;
  /** Where the party ended up (the destination unless an encounter interrupted). */
  at: string;
  arrived: boolean;
  log: TravelLog[];
  rolls: D20TestResult[];
  /** An encounter interrupted the journey (combat, A068); travel again to continue. */
  encounter?: { eventId: string; monsters: { id: string; count: number }[] };
}

function regionOf(lore: Lore, locationId: string): string | undefined {
  return lore.locations.find((l) => l.id === locationId)?.regionId;
}

function pickEvent(ctx: TravelContext, region: string | undefined, kind: Route['kind'], weather: string, tod: string): TravelEvent | undefined {
  const pool = (ctx.events?.events ?? []).filter(
    (e) =>
      (e.regions.length === 0 || (region !== undefined && e.regions.includes(region))) &&
      (e.routes.length === 0 || e.routes.includes(kind)) &&
      (e.weather.length === 0 || e.weather.includes(weather)) &&
      (e.timeOfDay.length === 0 || e.timeOfDay.includes(tod as never)),
  );
  if (pool.length === 0) return undefined;
  const total = pool.reduce((s, e) => s + e.weight, 0);
  let n = ctx.rng.int(1, total);
  return pool.find((e) => (n -= e.weight) <= 0);
}

/**
 * Travels to a known destination. Advances `state.time` (callers notify systems afterwards),
 * updates the map, resolves hazards and flavor events, and stops at an encounter.
 */
export function travel(ctx: TravelContext, to: string, pace: Pace): TravelResult {
  const { state, lore } = ctx;
  const map = (state.extensions.map as MapState | undefined) ?? (state.extensions.map = initialMap(lore));
  const base = { legs: [] as Leg[], minutes: 0, at: map.current, arrived: false, log: [] as TravelLog[], rolls: [] as D20TestResult[] };
  if (!map.known.includes(to)) return { ok: false, error: 'You do not know the way there yet.', ...base };
  const legs = planRoute(lore, map.current, to, map.known);
  if (!legs) return { ok: false, error: 'There is no known route there.', ...base };
  const start = state.time;
  const result: TravelResult = { ok: true, ...base, legs };
  const hero = state.hero;
  let hoursToday = 0;
  let day = 1;
  let rolledToday = false;

  const dayChecks = (leg: Leg) => {
    if (rolledToday) return;
    rolledToday = true;
    const region = regionOf(lore, leg.from);
    const w = weatherAt(lore, region ?? lore.regions[0]!.id, state.time, state.campaignId);
    const fx = weatherEffects(w);
    // Extreme heat/cold: one DC 10 Constitution save per travel day, Exhaustion on a failure.
    if (fx.hazard && leg.kind !== 'sea') {
      const save = savingThrow(hero, 'con', { rng: ctx.rng, dc: 10 });
      result.rolls.push(save);
      if (!save.success) hero.exhaustion = Math.min(6, hero.exhaustion + 1);
      result.log.push({ day, text: save.success ? `You endure the ${fx.hazard === 'extreme_heat' ? 'heat' : 'cold'}.` : `The ${fx.hazard === 'extreme_heat' ? 'heat' : 'cold'} wears you down (1 level of Exhaustion).` });
    }
    if (!ctx.events || ctx.rng.next() >= ctx.events.chancePerDay) return;
    const tod = ctx.rng.int(1, 3) === 1 ? 'night' : timeOfDay(state.time);
    const ev = pickEvent(ctx, region, leg.kind, w.kind, tod);
    if (!ev) return;
    result.log.push({ day, text: ev.text, eventId: ev.id });
    if (ev.kind === 'encounter' && ev.monsters.length) {
      result.encounter = { eventId: ev.id, monsters: ev.monsters };
      return;
    }
    if (ev.check) {
      const pe = PACE_EFFECTS[pace];
      const r = skillCheck(hero, ev.check.skill, {
        rng: ctx.rng,
        dc: ev.check.dc,
        ...(pe.advantage.includes(ev.check.skill) && { advantage: [`${pace} pace`] }),
        ...(pe.disadvantage.includes(ev.check.skill) && { disadvantage: [`${pace} pace`] }),
      });
      result.rolls.push(r);
      result.log.push({ day, text: r.success ? ev.check.success : ev.check.failure });
      if (!r.success) {
        state.time += ev.check.failureMinutes;
        hero.exhaustion = Math.min(6, hero.exhaustion + ev.check.failureExhaustion);
        if (ev.check.failureDamage) hero.hp = Math.max(1, hero.hp - roll(ev.check.failureDamage, ctx.rng).total);
      }
    }
  };

  for (const leg of legs) {
    const region = regionOf(lore, leg.from);
    let remaining = legHours(leg, pace, weatherEffects(weatherAt(lore, region ?? lore.regions[0]!.id, state.time, state.campaignId)).travelMultiplier);
    while (remaining > 1e-9) {
      dayChecks(leg);
      if (result.encounter) break;
      // Ships sail on through the night; on land the party travels 8 hours then camps.
      const cap = leg.kind === 'sea' ? 24 : TRAVEL_HOURS_PER_DAY;
      const step = Math.min(remaining, cap - hoursToday);
      state.time += Math.round(step * 60);
      remaining -= step;
      hoursToday += step;
      if (hoursToday >= cap - 1e-9 && remaining > 1e-9) {
        // Make camp until 08:00 the next morning.
        const nextMorning = (Math.floor(state.time / MINUTES_PER_DAY) + 1) * MINUTES_PER_DAY + 8 * 60;
        if (leg.kind !== 'sea') state.time = Math.max(state.time, nextMorning);
        hoursToday = 0;
        day++;
        rolledToday = false;
      }
    }
    if (result.encounter) break;
    arriveAt(map, lore, leg.to);
    result.at = leg.to;
  }
  result.arrived = result.at === to && !result.encounter;
  result.minutes = state.time - start;
  return result;
}
