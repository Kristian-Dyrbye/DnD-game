import { describe, expect, it } from 'vitest';
import demo from '../../../data/adventures/demo/millbrook_demo.json';
import type { ServerEvent } from '../../shared/protocol';
import { buildCharacter } from '../character/builder';
import { toBuildInput } from '../character/creator';
import { quickBuild } from '../character/quickBuild';
import { Rng } from '../core/rng';
import { loadSrd } from '../data/srdBundle';
import { GameSession, newGameState } from '../session/GameSession';
import { applyFlagWrites, evalCondition, timeOfDay, type ConditionContext } from './conditions';
import { AdventureError, availableActions, describeScene, getProgress, perform, resolveEncounter, startAdventure, type RunContext } from './runner';
import type { Adventure } from './schema';
import { adventureActionPort } from './sessionActions';
import { validateAdventure } from './validate';

const db = loadSrd();
const hero = () => buildCharacter(toBuildInput(quickBuild('fighter', db, Rng.fromSeed('f'))), db);
const adventure = (): Adventure => {
  const r = validateAdventure(structuredClone(demo), db);
  if (!r.adventure) throw new Error(r.errors.join('\n'));
  return r.adventure;
};
const ctx = (seed = 1): RunContext => ({ state: newGameState(hero(), 'heroic', seed), adventure: adventure(), rng: Rng.fromSeed(seed), db });

const cc = (over: Partial<ConditionContext> = {}): ConditionContext => ({ flags: {}, timeOfDay: 'day', reputation: {}, level: 1, visited: new Set(), ...over });

describe('conditions', () => {
  it('evaluates flags, logic, time, weather, reputation, level and visited', () => {
    const c = cc({ flags: { a: true, n: 3, s: 'spared' }, weather: 'rain', reputation: { guild: 5 }, level: 4, visited: new Set(['x']) });
    expect(evalCondition({ flag: 'a' }, c)).toBe(true);
    expect(evalCondition({ flag: 'missing' }, c)).toBe(false);
    expect(evalCondition({ flag: 'missing', exists: false }, c)).toBe(true);
    expect(evalCondition({ flag: 's', eq: 'spared' }, c)).toBe(true);
    expect(evalCondition({ flag: 'n', gte: 3, lte: 3 }, c)).toBe(true);
    expect(evalCondition({ flag: 's', gte: 1 }, c)).toBe(false);
    expect(evalCondition({ all: [{ flag: 'a' }, { not: { flag: 'missing' } }] }, c)).toBe(true);
    expect(evalCondition({ any: [{ flag: 'missing' }, { timeOfDay: ['night'] }] }, c)).toBe(false);
    expect(evalCondition({ weather: ['rain', 'storm'] }, c)).toBe(true);
    expect(evalCondition({ reputation: { faction: 'guild', gte: 5 } }, c)).toBe(true);
    expect(evalCondition({ reputation: { faction: 'other', gte: 1 } }, c)).toBe(false);
    expect(evalCondition({ level: { gte: 5 } }, c)).toBe(false);
    expect(evalCondition({ visited: 'x' }, c)).toBe(true);
  });

  it('writes flags', () => {
    const f: Record<string, boolean | number | string> = { gone: true };
    applyFlagWrites(f, [{ set: 'a', value: true }, { inc: 'n', by: 2 }, { inc: 'n', by: 1 }, { clear: 'gone' }]);
    expect(f).toEqual({ a: true, n: 3 });
  });

  it('maps minutes to time of day', () => {
    expect(timeOfDay(6 * 60)).toBe('dawn');
    expect(timeOfDay(8 * 60)).toBe('day');
    expect(timeOfDay(19 * 60)).toBe('dusk');
    expect(timeOfDay(23 * 60)).toBe('night');
    expect(timeOfDay(24 * 60 + 8 * 60)).toBe('day');
  });
});

describe('adventure validator', () => {
  it('accepts the demo adventure with no warnings', () => {
    const r = validateAdventure(structuredClone(demo), db);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it('reports broken references, unknown SRD ids and duplicate ids', () => {
    const bad = structuredClone(demo) as typeof demo;
    bad.chapters[0]!.scenes[0]!.exits[0]!.to = 'nowhere';
    bad.encounters[0]!.monsters[0]!.id = 'tarrasque_jr';
    bad.npcs.push({ ...bad.npcs[0]! });
    (bad.chapters[0]!.scenes[1]! as { onEnter?: unknown }).onEnter = { loot: 'no_table' };
    const r = validateAdventure(bad, db);
    expect(r.ok).toBe(false);
    expect(r.errors).toEqual(
      expect.arrayContaining([
        'scene millbrook_square: exit "to_mill" leads to unknown scene "nowhere"',
        'encounter cellar_rats: unknown monster "tarrasque_jr"',
        'Duplicate npc id "mayor_hobb"',
        'scene old_mill.onEnter: unknown loot table "no_table"',
      ]),
    );
  });

  it('reports schema errors with paths, and a missing reachable ending', () => {
    expect(validateAdventure({ formatVersion: 1 }).errors.length).toBeGreaterThan(0);
    const noEnd = structuredClone(demo) as typeof demo;
    const claim = (noEnd.chapters[0]!.scenes[0]! as unknown as { actions: { outcome: { ending?: string } }[] }).actions[1]!;
    delete claim.outcome.ending;
    expect(validateAdventure(noEnd, db).errors).toContain('no reachable ending');
  });
});

describe('scene runner', () => {
  it('starts at the start scene and lists actions, POIs and exits (with check labels)', () => {
    const c = ctx();
    const r = startAdventure(c);
    expect(r.entered).toEqual(['millbrook_square']);
    expect(c.state.location).toEqual({ adventureId: 'millbrook_demo', sceneId: 'millbrook_square', name: 'Millbrook Square' });
    expect(availableActions(c).map((a) => a.id)).toEqual(['talk_mayor', 'notice_board.read', 'exit.to_mill']);
    expect(availableActions(c).find((a) => a.id === 'notice_board.read')?.check).toBe('Investigation DC 10');
    expect(describeScene(c).npcs).toEqual(['Mayor Hobb']);
  });

  it('applies outcomes: flags, items, once-only actions, conditional exits', () => {
    const c = ctx();
    startAdventure(c);
    const torchesBefore = c.state.hero.inventory.find((i) => i.itemId === 'torch')?.quantity ?? 0;
    const r = perform(c, 'talk_mayor');
    expect(r.facts[0]).toMatch(/Mayor Hobb promises/);
    expect(c.state.flags['adv.millbrook_demo.has_key']).toBe(true);
    expect(c.state.hero.inventory.find((i) => i.itemId === 'torch')?.quantity).toBe(torchesBefore + 2);
    expect(availableActions(c).map((a) => a.id)).not.toContain('talk_mayor');
    expect(() => perform(c, 'talk_mayor')).toThrow(AdventureError);

    const t0 = c.state.time;
    perform(c, 'exit.to_mill');
    expect(c.state.time).toBe(t0 + 15);
    const ids = availableActions(c).map((a) => a.id);
    expect(ids).toContain('exit.unlock');
    expect(ids).not.toContain('exit.force');
  });

  it('resolves checks with the seeded rng (deterministic) and branches on the result', () => {
    const run = (seed: number) => {
      const c = ctx(seed);
      startAdventure(c);
      const r = perform(c, 'notice_board.read');
      return { success: r.rolls[0]!.success, flag: c.state.flags['adv.millbrook_demo.knows_key'], text: r.rolls[0]!.text };
    };
    expect(run(7)).toEqual(run(7));
    const outcomes = new Set(Array.from({ length: 30 }, (_, i) => run(i).success));
    expect(outcomes).toEqual(new Set([true, false]));
    for (let i = 0; i < 10; i++) {
      const o = run(i);
      expect(o.flag === true).toBe(o.success);
      expect(o.text).toMatch(/vs DC 10/);
    }
  });

  it('a failed gated exit keeps the hero in place; success moves on', () => {
    let moved = 0;
    for (let seed = 0; seed < 20; seed++) {
      const c = ctx(seed);
      startAdventure(c);
      perform(c, 'exit.to_mill');
      const r = perform(c, 'exit.force');
      if (r.rolls[0]!.success) {
        moved++;
        expect(c.state.location.sceneId).toBe('mill_cellar');
        expect(r.encounter).toBe('cellar_rats');
      } else expect(c.state.location.sceneId).toBe('old_mill');
    }
    expect(moved).toBeGreaterThan(0);
  });

  it('plays the demo to its ending: encounter win, loot, beat, reward', () => {
    const c = ctx(3);
    startAdventure(c);
    perform(c, 'talk_mayor');
    perform(c, 'exit.to_mill');
    const into = perform(c, 'exit.unlock');
    expect(into.facts).toContain('Two giant rats burst from the sacks!');
    expect(into.returning).toBe(false);
    const win = resolveEncounter(c, 'cellar_rats', 'win');
    expect(win.xp).toBe(50);
    expect(c.state.flags['adv.millbrook_demo.rats_cleared']).toBe(true);
    const loot = perform(c, 'chest.open');
    expect(loot.items).toEqual([{ itemId: 'potion_of_healing', quantity: 1 }]);
    expect(loot.coins).toBeGreaterThanOrEqual(20);
    perform(c, 'exit.up');
    const back = perform(c, 'exit.back');
    expect(back.facts).toContain('Walking back into the square, you hear children cheering about the rats.');
    expect(back.returning).toBe(true);
    const end = perform(c, 'claim_reward');
    expect(end.ending).toBe('rats_cleared');
    expect(c.state.extensions.reputation).toEqual({ crown_of_aurelmark: 1 });
    expect(c.state.hero.xp).toBe(100);
    expect(getProgress(c.state)?.ending).toBe('rats_cleared');
    expect(availableActions(c)).toEqual([]);
  });
});

describe('adventure action port', () => {
  it('runs the demo through a GameSession: scene text, suggestions, rolls and autosaves', async () => {
    const adv = adventure();
    const session = new GameSession({ actions: adventureActionPort(new Map([[adv.id, adv]]), adv.id, db), newSeed: () => 's' });
    const events: ServerEvent[] = [];
    session.on((e) => events.push(e));
    await session.handle({ type: 'new_game', hero: hero(), mode: 'heroic' });
    expect(events.some((e) => e.type === 'log' && e.entry.text.includes('mossy well'))).toBe(true);
    const sugg = events.filter((e) => e.type === 'suggestions').at(-1);
    expect(sugg?.type === 'suggestions' && sugg.actions.map((a) => a.id)).toEqual(['talk_mayor', 'notice_board.read', 'exit.to_mill']);

    await session.handle({ type: 'choose', actionId: 'notice_board.read' });
    expect(events.some((e) => e.type === 'roll' && e.roll.label === 'Investigation')).toBe(true);

    await session.handle({ type: 'say', text: 'I ask the mayor about the reward' });
    expect(session.current.flags['adv.millbrook_demo.has_key']).toBe(true);

    await session.handle({ type: 'choose', actionId: 'no_such_thing', reqId: 'z' });
    expect(events.at(-1)).toEqual({ type: 'error', message: '"no_such_thing" is not possible here', reqId: 'z' });
  });
});
