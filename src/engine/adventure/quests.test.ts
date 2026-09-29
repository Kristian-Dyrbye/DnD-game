import { describe, expect, it } from 'vitest';
import demo from '../../../data/adventures/demo/millbrook_demo.json';
import type { ServerEvent } from '../../shared/protocol';
import { buildCharacter } from '../character/builder';
import { toBuildInput } from '../character/creator';
import { quickBuild } from '../character/quickBuild';
import { Rng } from '../core/rng';
import { loadSrd } from '../data/srdBundle';
import { GameSession, newGameState } from '../session/GameSession';
import { currentObjective, questContextLines, questLog, trackQuests } from './quests';
import { perform, resolveEncounter, startAdventure, type RunContext } from './runner';
import { adventureActionPort } from './sessionActions';
import { validateAdventure } from './validate';

const db = loadSrd();
const adventure = validateAdventure(structuredClone(demo), db).adventure!;
const hero = () => buildCharacter(toBuildInput(quickBuild('sorcerer', db, Rng.fromSeed('s'))), db);

function playing(): RunContext {
  const ctx = { state: newGameState(hero(), 'heroic', 1), adventure, rng: Rng.fromSeed(1), db };
  startAdventure(ctx);
  return ctx;
}

describe('quest tracking', () => {
  it('starts with the adventure and follows objectives through the demo', () => {
    const ctx = playing();
    expect(questLog(ctx.state).rat_problem).toMatchObject({ status: 'active', objectivesDone: [] });
    expect(currentObjective(ctx)).toBe('Find out who posted the notice about the rats');
    expect(questContextLines(ctx)).toEqual(['The hero is pursuing: The rats in the old mill.']);

    perform(ctx, 'talk_mayor');
    expect(currentObjective(ctx)).toBe("Get into the old mill's cellar");
    perform(ctx, 'exit.to_mill');
    perform(ctx, 'exit.unlock');
    expect(currentObjective(ctx)).toBe('Deal with whatever is in the cellar');
    resolveEncounter(ctx, 'cellar_rats', 'win');
    expect(currentObjective(ctx)).toBe('Return to Mayor Hobb for the reward');
    perform(ctx, 'exit.up');
    perform(ctx, 'exit.back');
    perform(ctx, 'claim_reward');
    expect(questLog(ctx.state).rat_problem).toMatchObject({ status: 'completed', objectivesDone: ['learn', 'enter', 'clear', 'reward'] });
    expect(currentObjective(ctx)).toBeUndefined();
    expect(questContextLines(ctx)).toEqual([]);
  });

  it('reports changes and supports start/fail conditions', () => {
    const raw = structuredClone(demo) as unknown as { quests: Record<string, unknown>[] };
    raw.quests.push({
      id: 'side',
      name: 'Side job',
      start: { flag: '~has_key' },
      objectives: [{ id: 'o', text: 'Do it', done: { flag: '~never' } }],
      fail: { flag: '~rats_cleared' },
    });
    const adv = validateAdventure(raw, db).adventure!;
    const ctx = { state: newGameState(hero(), 'heroic', 1), adventure: adv, rng: Rng.fromSeed(1), db };
    startAdventure(ctx);
    expect(questLog(ctx.state).side).toBeUndefined();
    perform(ctx, 'talk_mayor');
    expect(questLog(ctx.state).side?.status).toBe('active');
    ctx.state.flags['adv.millbrook_demo.rats_cleared'] = true;
    const changes = trackQuests(ctx);
    expect(changes).toContainEqual({ questId: 'side', change: 'failed' });
    expect(questLog(ctx.state).side?.status).toBe('failed');
  });

  it('the validator rejects duplicate quest and objective ids', () => {
    const raw = structuredClone(demo) as unknown as { quests: { id: string; objectives: { id: string }[] }[] };
    raw.quests.push(structuredClone(raw.quests[0]!));
    raw.quests[0]!.objectives.push(structuredClone(raw.quests[0]!.objectives[0]!));
    const r = validateAdventure(raw, db);
    expect(r.errors).toEqual(expect.arrayContaining(['Duplicate quest id "rat_problem"', 'Duplicate objective in quest rat_problem id "learn"']));
  });
});

describe('objective events', () => {
  it('the session sends the current objective after each action', async () => {
    const session = new GameSession({ actions: adventureActionPort(new Map([[adventure.id, adventure]]), adventure.id, db), newSeed: () => 's' });
    const events: ServerEvent[] = [];
    session.on((e) => events.push(e));
    await session.handle({ type: 'new_game', hero: hero(), mode: 'heroic' });
    const objectives = () => events.filter((e) => e.type === 'objective').map((e) => (e.type === 'objective' ? e.text : null));
    expect(objectives()).toEqual(['Find out who posted the notice about the rats']);
    await session.handle({ type: 'choose', actionId: 'talk_mayor' });
    expect(objectives().at(-1)).toBe("Get into the old mill's cellar");
  });
});
