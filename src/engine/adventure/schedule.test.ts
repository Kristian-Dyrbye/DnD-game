import { describe, expect, it } from 'vitest';
import { buildCharacter } from '../character/builder';
import { toBuildInput } from '../character/creator';
import { quickBuild } from '../character/quickBuild';
import { Rng } from '../core/rng';
import { loadSrd } from '../data/srdBundle';
import { newGameState } from '../session/GameSession';
import { evalCondition, inHours } from './conditions';
import { intentContext } from './intent';
import { activeDeadlines, availableActions, describeScene, getProgress, npcsHere, perform, startAdventure, type RunContext } from './runner';
import { validateAdventure } from './validate';

const db = loadSrd();

const raw = () => ({
  formatVersion: 1,
  id: 'town',
  name: 'Town',
  kind: 'test',
  levelRange: [1, 3],
  summary: 'Schedules and deadlines.',
  start: { chapter: 'c', scene: 'market' },
  chapters: [
    {
      id: 'c',
      name: 'C',
      summary: 'S',
      start: 'market',
      scenes: [
        {
          id: 'market',
          name: 'Market',
          seed: 'Stalls.',
          npcs: ['guard', 'baker'],
          actions: [
            { id: 'buy_bread', label: 'Buy bread', if: { hours: { from: 6, to: 14 } }, outcome: { text: 'Warm bread.' } },
            { id: 'night_thief', label: 'Chase the shadow', if: { timeOfDay: ['night'] }, outcome: { encounter: 'thieves' } },
            { id: 'accept_job', label: 'Accept the courier job', once: true, outcome: { flags: [{ set: '~job_taken' }] } },
            { id: 'wait', label: 'Wait an hour', outcome: { minutes: 50 } },
          ],
          exits: [{ id: 'to_tavern', label: 'Go to the tavern', to: 'tavern', minutes: 10 }],
        },
        {
          id: 'tavern',
          name: 'Tavern',
          seed: 'Smoke.',
          actions: [{ id: 'deliver', label: 'Deliver the letter', if: { flag: '~job_taken' }, outcome: { flags: [{ set: '~delivered' }], ending: 'done' } }],
          exits: [{ id: 'back', label: 'Back to the market', to: 'market', minutes: 10 }],
        },
      ],
    },
  ],
  npcs: [
    { id: 'guard', name: 'Guard Pell', statBlock: 'guard', personality: 'Stern.', voice: 'Clipped.' },
    { id: 'baker', name: 'Baker Wim', statBlock: 'commoner', personality: 'Jolly.', voice: 'Loud.', schedule: [{ scene: 'market', from: 6, to: 14 }, { scene: 'tavern', from: 18, to: 2 }] },
  ],
  encounters: [{ id: 'thieves', name: 'Thieves', monsters: [{ id: 'bandit', count: 2 }] }],
  deadlines: [
    {
      id: 'letter',
      text: 'Deliver the letter before the hour is out',
      start: { flag: '~job_taken' },
      met: { flag: '~delivered' },
      within: 60,
      warnAt: 20,
      missed: { text: 'The letter is too late; the courier guild is furious.', flags: [{ set: '~job_failed' }], reputation: [{ faction: 'couriers', delta: -5 }] },
    },
  ],
  flags: [
    { id: '~job_taken', description: 'Took the courier job.' },
    { id: '~delivered', description: 'Delivered the letter.' },
    { id: '~job_failed', description: 'Missed the delivery.' },
  ],
  endings: [{ id: 'done', name: 'Done', text: 'Delivered.' }],
});

function play(hour: number): RunContext {
  const r = validateAdventure(raw(), db);
  if (!r.adventure) throw new Error(r.errors.join('\n'));
  const hero = buildCharacter(toBuildInput(quickBuild('rogue', db, Rng.fromSeed('r'))), db);
  const state = newGameState(hero, 'heroic', 1);
  state.time = hour * 60;
  const ctx = { state, adventure: r.adventure, rng: Rng.fromSeed(1), db };
  startAdventure(ctx);
  return ctx;
}

describe('hours condition', () => {
  it('handles plain and wrapping windows', () => {
    expect(inHours(8, 6, 14)).toBe(true);
    expect(inHours(14, 6, 14)).toBe(false);
    expect(inHours(23, 18, 2)).toBe(true);
    expect(inHours(1, 18, 2)).toBe(true);
    expect(inHours(3, 18, 2)).toBe(false);
    const base = { flags: {}, timeOfDay: 'day' as const, reputation: {}, level: 1, visited: new Set<string>() };
    expect(evalCondition({ hours: { from: 6, to: 14 } }, { ...base, hour: 9 })).toBe(true);
    expect(evalCondition({ hours: { from: 6, to: 14 } }, { ...base, hour: 15 })).toBe(false);
  });
});

describe('NPC schedules and time-limited actions', () => {
  it('shows the baker and the bread stall in the morning only', () => {
    const morning = play(8);
    expect(npcsHere(morning)).toEqual(['guard', 'baker']);
    expect(describeScene(morning).npcs).toEqual(['Guard Pell', 'Baker Wim']);
    expect(availableActions(morning).map((a) => a.id)).toContain('buy_bread');
    expect(intentContext(morning).npcs.map((n) => n.id)).toEqual(['guard', 'baker']);

    const evening = play(19);
    expect(npcsHere(evening)).toEqual(['guard']);
    expect(availableActions(evening).map((a) => a.id)).not.toContain('buy_bread');
    perform(evening, 'exit.to_tavern');
    expect(npcsHere(evening)).toEqual(['baker']);
  });

  it('offers night-only encounters at night', () => {
    expect(availableActions(play(23)).map((a) => a.id)).toContain('night_thief');
    expect(availableActions(play(12)).map((a) => a.id)).not.toContain('night_thief');
  });
});

describe('deadlines', () => {
  it('start when their condition holds, warn once, and are met in time', () => {
    const ctx = play(9);
    perform(ctx, 'accept_job');
    // The clock starts when the job is taken (after the action's 10 minutes).
    expect(activeDeadlines(ctx)).toEqual([{ id: 'letter', text: 'Deliver the letter before the hour is out', minutesLeft: 60 }]);
    const waited = perform(ctx, 'wait'); // +10 explore +50 → 0 left
    expect(getProgress(ctx.state)!.deadlines!.letter!.status).toBe('missed');
    expect(waited.facts).toContain('The letter is too late; the courier guild is furious.');
    expect(ctx.state.flags['adv.town.job_failed']).toBe(true);
    expect(ctx.state.extensions.reputation).toEqual({ couriers: -5 });
    expect(activeDeadlines(ctx)).toEqual([]);
  });

  it('warns when time is short and is met when delivered', () => {
    const ctx = play(9);
    perform(ctx, 'accept_job'); // 9:10, 60 minutes left
    ctx.state.time += 30; // 9:40
    const r = perform(ctx, 'exit.to_tavern'); // 9:50 → 20 left → warning
    expect(r.facts).toContain('Time is running short: Deliver the letter before the hour is out');
    expect(getProgress(ctx.state)!.deadlines!.letter!.warned).toBe(true);
    const done = perform(ctx, 'deliver'); // 10:00, delivered in time
    expect(done.facts.some((f) => f.startsWith('Time is running short'))).toBe(false);
    expect(getProgress(ctx.state)!.deadlines!.letter!.status).toBe('met');
    expect(ctx.state.flags['adv.town.job_failed']).toBeUndefined();
  });

  it('validator checks schedule scenes and deadline outcomes', () => {
    const bad = raw();
    bad.npcs[1]!.schedule![0]!.scene = 'nowhere';
    (bad.deadlines[0]!.missed as Record<string, unknown>).goto = 'void';
    const r = validateAdventure(bad, db);
    expect(r.errors).toEqual(expect.arrayContaining(['npc baker: schedule names unknown scene "nowhere"', 'deadline letter.missed: goto unknown scene "void"']));
  });
});
