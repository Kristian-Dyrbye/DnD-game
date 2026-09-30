import { describe, expect, it } from 'vitest';
import demo from '../../../data/adventures/demo/millbrook_demo.json';
import loreJson from '../../../data/world/lore.json';
import type { ServerEvent } from '../../shared/protocol';
import { adventureActionPort } from '../adventure/sessionActions';
import { validateAdventure } from '../adventure/validate';
import { buildCharacter } from '../character/builder';
import { toBuildInput } from '../character/creator';
import { quickBuild } from '../character/quickBuild';
import { Rng } from '../core/rng';
import { loadSrd } from '../data/srdBundle';
import { GameSession, newGameState } from '../session/GameSession';
import { calendarDate, clockParts, MINUTES_PER_DAY, TIME_COSTS, timeOfDay } from '../world/clock';
import { LoreSchema } from '../world/lore';
import { createDefaultRegistry, SystemRegistry, type GameSystem } from './index';
import { VERSIONS_KEY } from './registry';

const db = loadSrd();
const lore = LoreSchema.parse(loreJson);
const hero = () => buildCharacter(toBuildInput(quickBuild('druid', db, Rng.fromSeed('d'))), db);

describe('clock', () => {
  it('splits minutes into day/hour/minute/time of day', () => {
    expect(clockParts(8 * 60)).toEqual({ day: 1, hour: 8, minute: 0, timeOfDay: 'day' });
    expect(clockParts(MINUTES_PER_DAY + 19 * 60 + 30)).toEqual({ day: 2, hour: 19, minute: 30, timeOfDay: 'dusk' });
    expect(timeOfDay(5 * 60)).toBe('dawn');
    expect(timeOfDay(4 * 60 + 59)).toBe('night');
  });

  it('maps to the lore calendar', () => {
    expect(calendarDate(8 * 60, lore.calendar).text).toBe('Dawnday, 1 Seedwake 1247 AR');
    const d = calendarDate((30 + 3) * MINUTES_PER_DAY, lore.calendar);
    expect(d).toMatchObject({ month: 'Bloomrise', dayOfMonth: 4, season: 'spring', year: 1247 });
    expect(calendarDate(360 * MINUTES_PER_DAY, lore.calendar)).toMatchObject({ year: 1248, month: 'Seedwake', dayOfMonth: 1 });
    expect(calendarDate(100 * MINUTES_PER_DAY, lore.calendar).season).toBe('summer');
  });
});

describe('SystemRegistry', () => {
  it('initialises state, records versions and migrates old data', () => {
    const counter: GameSystem<{ ticks: number }> = {
      id: 'counter',
      version: 2,
      initState: () => ({ ticks: 0 }),
      migrate: (data) => ({ ticks: (data as { count: number }).count }),
    };
    const reg = new SystemRegistry().register(counter);
    const s = newGameState(hero(), 'heroic', 1);
    reg.init(s);
    expect(s.extensions.counter).toEqual({ ticks: 0 });
    expect(s.extensions[VERSIONS_KEY]).toEqual({ counter: 2 });

    const old = newGameState(hero(), 'heroic', 1);
    old.extensions.counter = { count: 7 };
    old.extensions[VERSIONS_KEY] = { counter: 1 };
    reg.init(old);
    expect(old.extensions.counter).toEqual({ ticks: 7 });
    expect(old.extensions[VERSIONS_KEY]).toEqual({ counter: 2 });
  });

  it('refuses duplicate and reserved ids', () => {
    const reg = new SystemRegistry().register({ id: 'a', version: 1 });
    expect(() => reg.register({ id: 'a', version: 1 })).toThrow();
    expect(() => reg.register({ id: VERSIONS_KEY, version: 1 })).toThrow();
  });

  it('advances time and notifies systems (onTimeAdvance, onRest)', () => {
    const seen: [number, number][] = [];
    const reg = new SystemRegistry().register({
      id: 'watch',
      version: 1,
      onTimeAdvance: (_s, from, to) => {
        seen.push([from, to]);
        return [];
      },
      onRest: (_s, kind) => [{ systemId: 'watch', text: `rested ${kind}` }],
    });
    const s = newGameState(hero(), 'heroic', 1);
    reg.advanceTime(s, TIME_COSTS.short_rest);
    expect(s.time).toBe(8 * 60 + 60);
    expect(seen).toEqual([[480, 540]]);
    expect(reg.advanceTime(s, 0)).toEqual([]);
    expect(reg.rest(s, 'long')).toEqual([{ systemId: 'watch', text: 'rested long' }]);
  });

  it('clock system reports phase changes and new days (only the final state on long jumps)', () => {
    const reg = createDefaultRegistry({ lore });
    const s = newGameState(hero(), 'heroic', 1);
    const clock = (evs: { systemId: string; text: string }[]) => evs.filter((e) => e.systemId === 'clock').map((e) => e.text);
    expect(clock(reg.advanceTime(s, 30))).toEqual([]);
    s.time = 17 * 60 + 50;
    expect(clock(reg.advanceTime(s, 20))).toEqual(['Dusk settles in.']);
    s.time = 22 * 60;
    expect(clock(reg.advanceTime(s, TIME_COSTS.long_rest))).toEqual(['A new day begins (day 2). It is Forgeday, 2 Seedwake 1247 AR. Dawn breaks.']);
  });
});

describe('time in play', () => {
  it('actions, exits and improvised attempts advance the clock; systems report it in the log', async () => {
    const adventure = validateAdventure(structuredClone(demo), db).adventure!;
    const reg = createDefaultRegistry({ lore });
    const session = new GameSession({ actions: adventureActionPort(new Map([[adventure.id, adventure]]), adventure.id, db), newSeed: () => 's', systems: reg });
    const events: ServerEvent[] = [];
    session.on((e) => events.push(e));
    await session.handle({ type: 'new_game', hero: hero(), mode: 'heroic' });
    expect(session.current.extensions[VERSIONS_KEY]).toEqual({ clock: 1, storyConditions: 1, weather: 1, map: 1, reputation: 1 });
    const t0 = session.current.time;
    await session.handle({ type: 'choose', actionId: 'talk_mayor' });
    expect(session.current.time).toBe(t0 + TIME_COSTS.explore_action);
    await session.handle({ type: 'choose', actionId: 'exit.to_mill' });
    expect(session.current.time).toBe(t0 + TIME_COSTS.explore_action + 15);
    await session.handle({ type: 'say', text: 'I look around' });
    expect(session.current.time).toBe(t0 + TIME_COSTS.explore_action + 15 + TIME_COSTS.quick_action);
    // Jump to just before dusk: the next action's time passing is reported.
    session.current.time = 17 * 60 + 55;
    await session.handle({ type: 'choose', actionId: 'exit.back' });
    expect(events.some((e) => e.type === 'log' && e.entry.kind === 'system' && e.entry.text === 'Dusk settles in.')).toBe(true);
  });
});
