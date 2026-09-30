import { describe, expect, it } from 'vitest';
import demo from '../../../data/adventures/demo/millbrook_demo.json';
import { MockLlm } from '../../llm/mock';
import { intentMessages, parseIntent } from '../../llm/prompts/intent';
import type { LlmProvider } from '../../llm/types';
import { buildCharacter } from '../character/builder';
import { toBuildInput } from '../character/creator';
import { quickBuild } from '../character/quickBuild';
import { Rng } from '../core/rng';
import { loadSrd } from '../data/srdBundle';
import { newGameState } from '../session/GameSession';
import { intentContext, keywordIntent, validateIntent, type IntentContext } from './intent';
import { startAdventure } from './runner';
import { validateAdventure } from './validate';

const db = loadSrd();
const adventure = validateAdventure(structuredClone(demo), db).adventure!;

function squareContext(): IntentContext {
  const hero = buildCharacter(toBuildInput(quickBuild('rogue', db, Rng.fromSeed('r'))), db);
  const ctx = { state: newGameState(hero, 'heroic', 1), adventure, rng: Rng.fromSeed(1), db };
  startAdventure(ctx);
  return intentContext(ctx);
}

describe('intent context', () => {
  it('lists offered actions with keywords, NPCs and POIs', () => {
    const ictx = squareContext();
    expect(ictx.actions.map((a) => a.id)).toEqual(['talk_mayor', 'notice_board.read', 'talk.mayor_hobb.mill_talk', 'exit.to_mill']);
    expect(ictx.actions.find((a) => a.id === 'talk.mayor_hobb.mill_talk')?.keywords).toEqual(['ask', 'miller', 'question']);
    expect(ictx.actions.find((a) => a.id === 'notice_board.read')?.keywords).toEqual(['notice', 'board', 'read']);
    expect(ictx.npcs).toEqual([{ id: 'mayor_hobb', name: 'Mayor Hobb' }]);
    expect(ictx.pois).toEqual([{ id: 'notice_board', name: 'Notice board' }]);
  });
});

describe('keyword fallback parser', () => {
  const ictx = squareContext();
  it('maps text to offered actions', () => {
    expect(keywordIntent('I go and talk to the mayor', ictx)).toMatchObject({ action: 'choose_action', actionId: 'talk_mayor', target: 'mayor_hobb' });
    expect(keywordIntent('read the notice board', ictx)).toMatchObject({ action: 'choose_action', actionId: 'notice_board.read' });
    expect(keywordIntent('walk over to the old mill', ictx)).toMatchObject({ action: 'choose_action', actionId: 'exit.to_mill' });
  });

  it('matches whole words with letters beyond a–z (Danish keywords, A143)', () => {
    const da: IntentContext = { actions: [{ id: 'well.examine', label: 'Undersøg brønden', keywords: ['brønd', 'kridt'] }], npcs: [], pois: [] };
    expect(keywordIntent('jeg ser på brønd og kridt', da)).toMatchObject({ action: 'choose_action', actionId: 'well.examine' });
    // "br" + "nd" halves of "brønd" must not count as words.
    expect(keywordIntent('br nd', da).action).not.toBe('choose_action');
  });

  it('recognises skill checks, attacks and other verbs', () => {
    expect(keywordIntent('I try to persuade Hobb to pay more', ictx)).toMatchObject({ action: 'skill_check', skill: 'persuasion', target: 'mayor_hobb' });
    expect(keywordIntent('sneak behind the stalls', ictx)).toMatchObject({ action: 'skill_check', skill: 'stealth' });
    expect(keywordIntent('I attack the mayor!', ictx)).toMatchObject({ action: 'attack', target: 'mayor_hobb' });
    expect(keywordIntent('I sleep under the stars', ictx)).toMatchObject({ action: 'rest' });
    expect(keywordIntent('I whistle a jaunty tune', ictx)).toMatchObject({ action: 'other' });
  });
});

describe('validateIntent', () => {
  const ictx = squareContext();
  it('keeps real actions and targets', () => {
    const v = validateIntent({ action: 'choose_action', actionId: 'talk_mayor', target: 'Mayor Hobb' }, ictx);
    expect(v).toEqual({ intent: { action: 'choose_action', actionId: 'talk_mayor', target: 'Mayor Hobb' }, actionId: 'talk_mayor', targetId: 'mayor_hobb', notes: [] });
  });

  it('drops invented ids and targets, and downgrades invalid intents', () => {
    const v = validateIntent({ action: 'choose_action', actionId: 'open_secret_vault', target: 'dragon' }, ictx);
    expect(v.actionId).toBeUndefined();
    expect(v.targetId).toBeUndefined();
    expect(v.intent.action).toBe('other');
    expect(v.notes).toEqual(['unknown action "open_secret_vault"', 'choose_action without a valid action', 'target "dragon" is not here']);
    expect(validateIntent({ action: 'skill_check' }, ictx).intent.action).toBe('other');
  });
});

describe('parseIntent (LLM)', () => {
  const ictx = squareContext();
  // A non-mock provider backed by MockLlm scripts, so the LLM path is exercised.
  const fake = (llm: MockLlm): LlmProvider => ({ ...llm, name: 'fake', chat: llm.chat.bind(llm), stream: llm.stream.bind(llm), listModels: llm.listModels.bind(llm), status: llm.status.bind(llm) });

  it('uses the model JSON when valid', async () => {
    const llm = new MockLlm({ script: ['```json\n{"action":"skill_check","skill":"intimidation","target":"mayor_hobb","approach":"loom over him"}\n```'] });
    const r = await parseIntent(fake(llm), 'I loom over Hobb until he pays up', ictx);
    expect(r).toEqual({ source: 'llm', intent: { action: 'skill_check', skill: 'intimidation', target: 'mayor_hobb', approach: 'loom over him' } });
    expect(llm.calls[0]!.opts.task).toBe('intent');
    expect(llm.calls[0]!.opts.format).toMatchObject({ type: 'object' });
  });

  it('retries once, then falls back to keywords', async () => {
    const llm = new MockLlm({ script: ['not json at all', '{"action":"fly"}'] });
    const r = await parseIntent(fake(llm), 'talk to the mayor', ictx);
    expect(llm.calls).toHaveLength(2);
    expect(r).toEqual({ source: 'keywords', intent: { action: 'choose_action', actionId: 'talk_mayor', target: 'mayor_hobb' } });
  });

  it('skips the model entirely for the mock provider', async () => {
    const llm = new MockLlm();
    const r = await parseIntent(llm, 'read the notice board', ictx);
    expect(r.source).toBe('keywords');
    expect(llm.calls).toHaveLength(0);
  });

  it('lists offered action ids, people and things in the prompt', () => {
    const m = intentMessages('hello', ictx);
    expect(m[1]!.content).toContain('talk_mayor: Speak with Mayor Hobb');
    expect(m[1]!.content).toContain('PEOPLE: mayor_hobb: Mayor Hobb');
    expect(m[1]!.content).toContain('PLAYER: hello');
  });
});
