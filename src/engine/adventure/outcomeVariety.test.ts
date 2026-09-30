import { describe, expect, it } from 'vitest';
import companionsJson from '../../../data/companions.json';
import flagsJson from '../../../data/adventures/flags.json';
import { buildCharacter } from '../character/builder';
import { toBuildInput } from '../character/creator';
import { quickBuild } from '../character/quickBuild';
import { Rng } from '../core/rng';
import { loadSrd } from '../data/srdBundle';
import { CompanionRosterSchema } from '../party/companions';
import { newGameState } from '../session/GameSession';
import { storyConditionSystem } from '../systems/storyConditionSystem';
import { FlagRegistry } from '../world/flags';
import { evalCondition, flagsRead, type ConditionContext } from './conditions';
import { templateNarration } from './narration';
import { availableActions, checkLabel, perform, pickText, startAdventure, type RunContext } from './runner';
import { CheckSchema } from './schema';
import { solveAdventure } from './solver';
import { duration } from './storyConditions';
import { flagRefs, validateAdventure } from './validate';

const db = loadSrd();
const roster = CompanionRosterSchema.parse(companionsJson);
const registry = FlagRegistry.fromJson(flagsJson);

const raw = {
  formatVersion: 1,
  id: 'variety_test',
  name: 'Variety test',
  kind: 'test',
  levelRange: [1, 3],
  summary: 'test',
  start: { chapter: 'c1', scene: 'gate' },
  chapters: [
    {
      id: 'c1',
      name: 'C1',
      summary: 's',
      start: 'gate',
      scenes: [
        {
          id: 'gate',
          name: 'Gate',
          seed: 'A tall gate in the rain.',
          revisitSeed: ['The gate again, dripping.', 'Back at the gate.'],
          actions: [
            { id: 'recruit', label: 'Ask Nettle to come', outcome: { recruit: 'nettle' } },
            { id: 'betray', label: 'She turns on you', outcome: { companionLeaves: { id: 'nettle', status: 'betrayed' } } },
            { id: 'kill', label: 'She dies', outcome: { companionLeaves: { id: 'nettle', status: 'dead' } } },
            { id: 'call_back', label: 'Call her back', outcome: { companionReturns: { id: 'nettle', loyalty: 45 } } },
            { id: 'sneak', label: 'Sneak past together', check: { skill: 'stealth', dc: 10, group: true, success: { flags: [{ set: '~sneaked' }] }, failure: { flags: [{ set: '~spotted' }] } } },
            { id: 'drink', label: 'Drink the ale', outcome: { texts: ['It tastes of copper.', 'It tastes of ditchwater.', 'It burns going down.'], conditions: [{ condition: 'poisoned', target: 'party', minutes: 60 }] } },
            { id: 'antidote', label: 'Take the antidote', outcome: { conditions: [{ condition: 'poisoned', remove: true }] } },
            { id: 'clue_a', label: 'Clue A', once: true, outcome: { flags: [{ set: '~a' }] } },
            { id: 'clue_b', label: 'Clue B', once: true, outcome: { flags: [{ set: '~b' }] } },
            { id: 'clue_c', label: 'Clue C', once: true, outcome: { flags: [{ set: '~c' }] } },
            { id: 'accuse', label: 'Accuse', if: { count: { flags: ['~a', '~b', '~c'], min: 2 } }, outcome: { ending: 'solved' } },
          ],
          exits: [{ id: 'yard', label: 'Into the yard', to: 'yard' }],
        },
        { id: 'yard', name: 'Yard', seed: 'A muddy yard.', exits: [{ id: 'gate', label: 'Back to the gate', to: 'gate' }] },
      ],
    },
  ],
  endings: [{ id: 'solved', name: 'Solved', text: 'Case closed.' }],
};

/** Rng returning fixed d20 faces. */
function faces(...list: number[]): Rng {
  const queue = [...list];
  return { int: (min: number) => queue.shift() ?? min } as unknown as Rng;
}

function ctx(opts: { roster?: boolean; db?: boolean } = {}): RunContext {
  const hero = buildCharacter(toBuildInput(quickBuild('fighter', db, Rng.fromSeed('v'))), db);
  const adventure = validateAdventure(structuredClone(raw), db, registry, roster).adventure!;
  const state = newGameState(hero, 'heroic', 'variety');
  const c: RunContext = { state, adventure, rng: Rng.fromSeed(3), flags: registry, ...(opts.db !== false && { db }), ...(opts.roster !== false && { companions: roster }) };
  startAdventure(c);
  return c;
}

const cc = (flags: Record<string, boolean | number | string>, defaults?: Record<string, boolean | number | string>): ConditionContext => ({ flags, ...(defaults && { defaults }), timeOfDay: 'day', reputation: {}, level: 1, visited: new Set() });

describe('count-of-flags condition', () => {
  it('counts truthy flags (defaults too) against min/max', () => {
    const c = { count: { flags: ['x', 'y', 'z'], min: 2 } };
    expect(evalCondition(c, cc({ x: true }))).toBe(false);
    expect(evalCondition(c, cc({ x: true, y: 3 }))).toBe(true);
    expect(evalCondition(c, cc({ x: true, y: 0 }, { z: 'yes' }))).toBe(true);
    expect(evalCondition({ count: { flags: ['x', 'y'], max: 0 } }, cc({ y: false }))).toBe(true);
    expect([...flagsRead({ not: c })]).toEqual(['x', 'y', 'z']);
  });

  it('resolves ~names inside count and reports them as read flags', () => {
    const adv = ctx().adventure;
    const accuse = adv.chapters[0]!.scenes[0]!.actions.find((a) => a.id === 'accuse')!;
    const flags = (accuse.if as { count: { flags: string[] } }).count.flags;
    expect(flags.every((f) => !f.startsWith('~'))).toBe(true);
    expect([...flagRefs(adv).reads]).toEqual(expect.arrayContaining(flags));
  });

  it('gates an action on two of three clues; the solver finds the ending', () => {
    const c = ctx();
    expect(availableActions(c).some((a) => a.id === 'accuse')).toBe(false);
    perform(c, 'clue_a');
    perform(c, 'clue_c');
    expect(availableActions(c).some((a) => a.id === 'accuse')).toBe(true);
    const base = ctx({ db: false, roster: false });
    const { rng: _r, ...noRng } = base;
    // Solve from a fresh state (ctx() already started the adventure).
    const fresh = { ...noRng, state: newGameState(base.state.hero, 'heroic', 'solve') };
    const solved = solveAdventure(fresh, 'solved');
    expect(solved.ok).toBe(true);
    expect(solved.path).toEqual(expect.arrayContaining(['accuse']));
  });
});

describe('group checks', () => {
  it('the hero and each conscious companion roll; half passing is a success', () => {
    const c = ctx();
    perform(c, 'recruit');
    c.rng = faces(20, 1);
    const r = perform(c, 'sneak');
    expect(r.rolls).toHaveLength(2);
    expect(r.rolls[1]!.label).toMatch(/^Nettle/);
    expect(Object.keys(c.state.flags).some((k) => k.endsWith('.sneaked'))).toBe(true);

    c.rng = faces(1, 1);
    perform(c, 'sneak');
    expect(Object.keys(c.state.flags).some((k) => k.endsWith('.spotted'))).toBe(true);
  });

  it('a lone hero rolls once; the label says Group', () => {
    const c = ctx();
    expect(perform(c, 'sneak').rolls).toHaveLength(1);
    expect(checkLabel(CheckSchema.parse({ skill: 'stealth', dc: 12, group: true }))).toBe('Group Stealth DC 12');
  });
});

describe('story conditions', () => {
  it('poisons the party for an hour; the system ends it when time passes; remove ends it early', () => {
    const c = ctx();
    perform(c, 'recruit');
    const r = perform(c, 'drink');
    expect(r.facts).toContain(`${c.state.hero.name} is poisoned for 1 hour.`);
    expect(c.state.hero.conditions.some((x) => x.condition === 'poisoned')).toBe(true);
    expect(c.state.companions[0]!.conditions.some((x) => x.condition === 'poisoned')).toBe(true);

    const from = c.state.time;
    c.state.time += 30;
    expect(storyConditionSystem().onTimeAdvance!(c.state, from, c.state.time)).toEqual([]);
    c.state.time += 30;
    const ended = storyConditionSystem().onTimeAdvance!(c.state, from, c.state.time);
    expect(ended.map((e) => e.text)).toEqual([`${c.state.hero.name} is no longer poisoned.`, 'Nettle is no longer poisoned.']);
    expect(c.state.hero.conditions.some((x) => x.condition === 'poisoned')).toBe(false);

    perform(c, 'drink');
    const cured = perform(c, 'antidote');
    expect(cured.facts).toContain(`${c.state.hero.name} is no longer poisoned.`);
    expect(c.state.hero.conditions.some((x) => x.condition === 'poisoned')).toBe(false);
    // Nettle still has hers (the antidote targets the hero only).
    expect(c.state.companions[0]!.conditions.some((x) => x.condition === 'poisoned')).toBe(true);
    expect(duration(90)).toBe('1 hour 30 minutes');
  });
});

describe('text variants', () => {
  it('one variant is told per outcome, picked by seed without touching the dice', () => {
    const c = ctx();
    const before = c.rng.getState();
    const r = perform(c, 'drink');
    expect(['It tastes of copper.', 'It tastes of ditchwater.', 'It burns going down.']).toContain(r.facts[0]);
    expect(c.rng.getState()).toEqual(before);
    const picks = new Set(Array.from({ length: 30 }, (_, i) => pickText(['a', 'b', 'c'], `seed${i}`)));
    expect(picks.size).toBe(3);
    expect(pickText(['a', 'b', 'c'], 'same')).toBe(pickText(['a', 'b', 'c'], 'same'));
  });

  it('a return visit uses revisitSeed in template narration; the first visit uses the seed', () => {
    const c = ctx();
    expect(templateNarration({ kind: 'scene', facts: [], ctx: c, visit: 'first' })).toContain('A tall gate in the rain.');
    perform(c, 'exit.yard');
    const back = perform(c, 'exit.gate');
    expect(back.returning).toBe(true);
    const text = templateNarration({ kind: 'scene', facts: [], ctx: c, visit: 'return' });
    expect(text).not.toContain('A tall gate in the rain.');
    expect(text).toMatch(/The gate again, dripping\.|Back at the gate\./);
  });
});

describe('companion returns', () => {
  it('a betrayer comes back with their kept sheet and at least the given loyalty', () => {
    const c = ctx();
    perform(c, 'recruit');
    c.state.flags['world.nettle_loyalty'] = 10;
    perform(c, 'betray');
    expect(c.state.companions).toHaveLength(0);
    const r = perform(c, 'call_back');
    expect(r.partyLog).toEqual(['Nettle returns to your side.']);
    expect(c.state.flags['world.nettle_status']).toBe('in_party');
    expect(c.state.flags['world.nettle_loyalty']).toBe(45);
    expect(c.state.companions.map((x) => x.id)).toEqual(['nettle']);
  });

  it('the dead stay dead; without rules data only the flags change', () => {
    const c = ctx();
    perform(c, 'recruit');
    perform(c, 'kill');
    expect(perform(c, 'call_back').partyLog).toEqual(['Nettle cannot come back.']);

    const s = ctx({ db: false });
    s.state.flags['world.nettle_status'] = 'left';
    perform(s, 'call_back');
    expect(s.state.flags['world.nettle_status']).toBe('in_party');
    expect(s.state.companions).toHaveLength(0);
  });

  it('without a roster the return is collected for the caller', () => {
    const c = ctx({ roster: false });
    expect(perform(c, 'call_back').returns).toEqual([{ id: 'nettle', loyalty: 45 }]);
  });

  it('the validator rejects unknown companions and empty text variants', () => {
    const bad = structuredClone(raw) as typeof raw;
    const acts = bad.chapters[0]!.scenes[0]!.actions as { id: string; outcome?: Record<string, unknown> }[];
    acts.find((a) => a.id === 'call_back')!.outcome = { companionReturns: { id: 'nobody' } };
    acts.find((a) => a.id === 'drink')!.outcome = { texts: [' '] };
    const v = validateAdventure(bad, db, registry, roster);
    expect(v.errors.join('\n')).toMatch(/companionReturns names unknown companion "nobody"/);
    expect(v.errors.join('\n')).toMatch(/empty entry in texts/);
  });
});
