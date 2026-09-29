import { describe, expect, it } from 'vitest';
import demo from '../../../data/adventures/demo/millbrook_demo.json';
import { buildCharacter } from '../character/builder';
import { toBuildInput } from '../character/creator';
import { quickBuild } from '../character/quickBuild';
import { Rng } from '../core/rng';
import { loadSrd } from '../data/srdBundle';
import { newGameState } from '../session/GameSession';
import { intentContext, keywordIntent, validateIntent, type Intent } from './intent';
import { improvisedDc, resolveIntent } from './resolve';
import { perform, startAdventure, type RunContext } from './runner';
import { validateAdventure } from './validate';

const db = loadSrd();

function playing(seed = 1, patch?: (a: typeof demo) => void): RunContext {
  const raw = structuredClone(demo);
  patch?.(raw);
  const adventure = validateAdventure(raw, db).adventure!;
  const hero = buildCharacter(toBuildInput(quickBuild('bard', db, Rng.fromSeed('b'))), db);
  const ctx = { state: newGameState(hero, 'heroic', seed), adventure, rng: Rng.fromSeed(seed), db };
  startAdventure(ctx);
  return ctx;
}

const resolveText = (ctx: RunContext, text: string) => {
  const ictx = intentContext(ctx);
  return resolveIntent(ctx, validateIntent(keywordIntent(text, ictx), ictx), text);
};
const resolve = (ctx: RunContext, intent: Intent, text = 'x') => {
  const ictx = intentContext(ctx);
  return resolveIntent(ctx, validateIntent(intent, ictx), text);
};

describe('resolveIntent', () => {
  it('performs an offered action when the intent names one', () => {
    const ctx = playing();
    const r = resolveText(ctx, 'talk to the mayor');
    expect(r.via).toBe('action');
    expect(r.actionId).toBe('talk_mayor');
    expect(ctx.state.flags['adv.millbrook_demo.has_key']).toBe(true);
    expect(r.playerAction).toBe('talk to the mayor');
  });

  it('routes a skill check to the authored check with that skill (adventure DC)', () => {
    const ctx = playing();
    const r = resolve(ctx, { action: 'skill_check', skill: 'investigation', target: 'notice_board' });
    expect(r.via).toBe('action');
    expect(r.actionId).toBe('notice_board.read');
    expect(r.result.rolls[0]!.target).toEqual({ kind: 'DC', value: 10 });
  });

  it('improvises other checks at the SRD DC for the scene tier, once per scene entry', () => {
    const ctx = playing();
    expect(improvisedDc(ctx)).toBe(15);
    const r = resolveText(ctx, 'I try to persuade Hobb to double the reward');
    expect(r.via).toBe('improvised_check');
    expect(r.result.rolls).toHaveLength(1);
    expect(r.result.rolls[0]!.label).toBe('Persuasion');
    expect(r.result.rolls[0]!.target?.value).toBe(15);
    expect(r.result.facts[0]).toMatch(/^The Persuasion attempt (succeeds|fails)/);
    // No mechanical change from an improvised attempt.
    expect(ctx.state.flags).toEqual({});
    const again = resolveText(ctx, 'I persuade Hobb again');
    expect(again.via).toBe('already_tried');
    expect(again.result.rolls).toHaveLength(0);
    // Leaving and coming back allows a fresh attempt.
    perform(ctx, 'exit.to_mill');
    perform(ctx, 'exit.back');
    expect(resolveText(ctx, 'I persuade Hobb again').via).toBe('improvised_check');
  });

  it('maps skill verbs onto gated exits, and verbs that are part of an action label to that action', () => {
    const ctx = playing(2);
    perform(ctx, 'exit.to_mill');
    const force = resolveText(ctx, 'I force the door open');
    expect(force.actionId).toBe('exit.force');
    expect(force.result.rolls[0]!.label).toBe('Athletics');
    if (!force.result.rolls[0]!.success) return;
    perform(ctx, 'exit.up');
    expect(ctx.state.location.sceneId).toBe('old_mill');
  });

  it('a skill verb inside an offered action label picks that action', () => {
    const ctx = playing();
    perform(ctx, 'talk_mayor');
    perform(ctx, 'exit.to_mill');
    perform(ctx, 'exit.unlock');
    expect(resolveText(ctx, 'climb back up to the mill').actionId).toBe('exit.up');
  });

  it('uses the scene tier when set', () => {
    const ctx = playing(1, (a) => {
      (a.chapters[0]!.scenes[0] as Record<string, unknown>).improvisedDifficulty = 'easy';
    });
    expect(improvisedDc(ctx)).toBe(10);
  });

  it('is deterministic for a given seed', () => {
    const a = resolveText(playing(5), 'I sneak past the stalls');
    const b = resolveText(playing(5), 'I sneak past the stalls');
    expect(a.result.rolls[0]!.text).toBe(b.result.rolls[0]!.text);
  });

  it('handles look, talk, move, attack, rest and nonsense without inventing mechanics', () => {
    const ctx = playing();
    expect(resolve(ctx, { action: 'look' }).via).toBe('look');
    const talk = resolve(ctx, { action: 'talk' });
    expect(talk.via).toBe('talk');
    expect(talk.result.facts[0]).toMatch(/Mayor Hobb, who seems friendly/);
    expect(resolve(ctx, { action: 'move' }).result.facts[0]).toBe('From here you can go: walk to the old mill.');
    const attack = resolve(ctx, { action: 'attack', target: 'mayor_hobb' });
    expect(attack.via).toBe('refused');
    expect(ctx.state.hero.hp).toBe(ctx.state.hero.maxHp);
    expect(resolve(ctx, { action: 'rest' }).via).toBe('refused');
    expect(resolve(ctx, { action: 'other' }).result.facts).toEqual(['Nothing obvious comes of that.']);
    for (const r of [attack]) expect(r.result.rolls).toEqual([]);
  });

  it('attack triggers an authored fight when one is offered', () => {
    const ctx = playing();
    perform(ctx, 'talk_mayor');
    perform(ctx, 'exit.to_mill');
    perform(ctx, 'exit.unlock');
    // First entry already started the fight via onEnter; the fight action is still offered until won.
    const r = resolve(ctx, { action: 'attack' });
    expect(r.actionId).toBe('fight_rats');
    expect(r.result.encounter).toBe('cellar_rats');
  });
});
