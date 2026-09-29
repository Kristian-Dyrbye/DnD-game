import { describe, expect, it } from 'vitest';
import loreJson from '../../../data/world/lore.json';
import eventsJson from '../../../data/tables/travel-events.json';
import { buildCharacter } from '../character/builder';
import { toBuildInput } from '../character/creator';
import { quickBuild } from '../character/quickBuild';
import { Rng } from '../core/rng';
import { loadSrd } from '../data/srdBundle';
import { newGameState } from '../session/GameSession';
import { createDefaultRegistry } from '../systems';
import { LoreSchema } from './lore';
import {
  arriveAt,
  discover,
  effectivePace,
  getMap,
  initialMap,
  legHours,
  planRoute,
  travel,
  TravelEventTableSchema,
  type TravelEventTable,
} from './travel';

const db = loadSrd();
const lore = LoreSchema.parse(loreJson);
const table = TravelEventTableSchema.parse(eventsJson);
const hero = () => buildCharacter(toBuildInput(quickBuild('ranger', db, Rng.fromSeed('r'))), db);

function fresh(seed: number | string = 1) {
  const state = newGameState(hero(), 'heroic', seed);
  createDefaultRegistry({ lore }).init(state);
  return state;
}

describe('travel events table', () => {
  it('is valid, uses SRD monsters and known regions', () => {
    const regions = new Set(lore.regions.map((r) => r.id));
    for (const e of table.events) {
      for (const r of e.regions) expect(regions.has(r), `${e.id}: ${r}`).toBe(true);
      for (const m of e.monsters) expect(db.monsters.has(m.id), `${e.id}: ${m.id}`).toBe(true);
      if (e.kind === 'encounter') expect(e.monsters.length).toBeGreaterThan(0);
      if (e.kind === 'hazard') expect(e.check).toBeDefined();
    }
    for (const r of regions) expect(table.events.some((e) => e.regions.includes(r))).toBe(true);
  });
});

describe('map knowledge', () => {
  it('starts at Millbrook knowing its neighbours; arriving reveals more', () => {
    const m = initialMap(lore);
    expect(m.current).toBe('millbrook');
    expect(m.known.sort()).toEqual(['brightwater', 'millbrook', 'ravensgate']);
    arriveAt(m, lore, 'ravensgate');
    expect(m.known).toEqual(expect.arrayContaining(['hollowmere', 'lantern_hold']));
    expect(m.visited).toEqual(['millbrook', 'ravensgate']);
    discover(m, ['the_maw']);
    expect(m.known).toContain('the_maw');
  });

  it('the map system initialises extensions.map', () => {
    expect(getMap(fresh())).toMatchObject({ current: 'millbrook' });
  });
});

describe('route planning and pace', () => {
  it('finds the fastest known route and refuses unknown places', () => {
    expect(planRoute(lore, 'millbrook', 'highcrown')!.map((l) => l.to)).toEqual(['brightwater', 'highcrown']);
    expect(planRoute(lore, 'millbrook', 'highcrown', ['millbrook', 'brightwater'])).toBeUndefined();
    expect(planRoute(lore, 'millbrook', 'millbrook')).toEqual([]);
  });

  it('applies SRD pace, trail caps, vessel speed and weather', () => {
    const road = { from: 'a', to: 'b', kind: 'road' as const, miles: 24 };
    expect(legHours(road, 'normal')).toBe(8);
    expect(legHours(road, 'fast')).toBe(6);
    expect(legHours(road, 'slow')).toBe(12);
    expect(effectivePace('trail', 'fast')).toBe('normal');
    expect(legHours({ ...road, kind: 'trail' }, 'fast')).toBe(8);
    expect(legHours({ ...road, kind: 'sea' }, 'slow')).toBe(8);
    expect(legHours(road, 'normal', 0.5)).toBe(16);
  });
});

describe('travel', () => {
  const quiet: TravelEventTable = { chancePerDay: 0, events: [] };

  it('moves along known routes, advancing the clock with overnight camps', () => {
    const state = fresh('quiet-weather');
    const r = travel({ state, lore, rng: Rng.fromSeed(1), events: quiet }, 'ravensgate', 'normal');
    expect(r.ok).toBe(true);
    expect(r.arrived).toBe(true);
    expect(getMap(state)!.current).toBe('ravensgate');
    // 30 road miles at 3 mph = 10 h (or longer in bad weather) → needs one night's camp.
    expect(r.minutes).toBeGreaterThanOrEqual(10 * 60 + 16 * 60 - 60);
    expect(state.time).toBe(8 * 60 + r.minutes);
  });

  it('refuses unknown destinations without moving or spending time', () => {
    const state = fresh();
    const r = travel({ state, lore, rng: Rng.fromSeed(1), events: quiet }, 'the_maw', 'normal');
    expect(r).toMatchObject({ ok: false, arrived: false, minutes: 0, at: 'millbrook' });
    expect(state.time).toBe(8 * 60);
  });

  it('rolls events: encounters interrupt, hazards roll checks (deterministic by seed)', () => {
    const always: TravelEventTable = { chancePerDay: 1, events: table.events.filter((e) => e.id === 'road_bandits') };
    const state = fresh();
    const r = travel({ state, lore, rng: Rng.fromSeed(3), events: always }, 'ravensgate', 'normal');
    expect(r.encounter).toEqual({ eventId: 'road_bandits', monsters: [{ id: 'bandit', count: 3 }] });
    expect(r.arrived).toBe(false);
    expect(getMap(state)!.current).toBe('millbrook');

    const hazard: TravelEventTable = {
      chancePerDay: 1,
      events: [{ id: 'test_hazard', regions: [], routes: [], weather: [], timeOfDay: [], weight: 1, kind: 'hazard', text: 'A rockslide!', monsters: [], check: { skill: 'athletics', dc: 30, success: 'ok', failure: 'Ouch.', failureMinutes: 30, failureExhaustion: 1 } }],
    };
    const s2 = fresh();
    const before = s2.hero.exhaustion;
    const r2 = travel({ state: s2, lore, rng: Rng.fromSeed(4), events: hazard }, 'brightwater', 'fast');
    expect(r2.rolls.some((x) => x.label === 'Athletics')).toBe(true);
    expect(r2.log.map((l) => l.text)).toContain('Ouch.');
    expect(s2.hero.exhaustion).toBeGreaterThan(before);
    expect(r2.arrived).toBe(true);

    const a = travel({ state: fresh(), lore, rng: Rng.fromSeed(9), events: table }, 'brightwater', 'normal');
    const b = travel({ state: fresh(), lore, rng: Rng.fromSeed(9), events: table }, 'brightwater', 'normal');
    expect(a.log).toEqual(b.log);
  });

  it('pace changes hazard checks (fast = disadvantage on Survival)', () => {
    const lost: TravelEventTable = {
      chancePerDay: 1,
      events: [{ id: 'lost', regions: [], routes: [], weather: [], timeOfDay: [], weight: 1, kind: 'hazard', text: 'Fog.', monsters: [], check: { skill: 'survival', dc: 10, success: 'ok', failure: 'lost', failureMinutes: 0, failureExhaustion: 0 } }],
    };
    const r = travel({ state: fresh(), lore, rng: Rng.fromSeed(2), events: lost }, 'brightwater', 'fast');
    expect(r.rolls.find((x) => x.label === 'Survival')!.mode).toBe('disadvantage');
    const s = travel({ state: fresh(), lore, rng: Rng.fromSeed(2), events: lost }, 'brightwater', 'slow');
    expect(s.rolls.find((x) => x.label === 'Survival')!.mode).toBe('advantage');
  });
});
