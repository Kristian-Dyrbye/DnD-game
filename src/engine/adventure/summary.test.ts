import { describe, expect, it } from 'vitest';
import demo from '../../../data/adventures/demo/millbrook_demo.json';
import { MockLlm } from '../../llm/mock';
import { llmSummarizer, summaryMessages } from '../../llm/prompts/summary';
import type { LlmProvider } from '../../llm/types';
import { buildCharacter } from '../character/builder';
import { toBuildInput } from '../character/creator';
import { quickBuild } from '../character/quickBuild';
import { Rng } from '../core/rng';
import { loadSrd } from '../data/srdBundle';
import { GameSession, newGameState } from '../session/GameSession';
import type { GameState } from '../session/gameState';
import { adventureActionPort } from './sessionActions';
import { clampSummary, linesSince, templateSummary, updateSummary, type Summarizer } from './summary';
import { validateAdventure } from './validate';

const db = loadSrd();
const adventure = validateAdventure(structuredClone(demo), db).adventure!;
const hero = () => buildCharacter(toBuildInput(quickBuild('monk', db, Rng.fromSeed('m'))), db);

function stateWithLog(): GameState {
  const s = newGameState(hero(), 'heroic', 1);
  s.log = [
    { id: 1, kind: 'narration', text: 'You arrive in Millbrook. Bread smells drift by.' },
    { id: 2, kind: 'player', text: 'I ask about the rats.' },
    { id: 3, kind: 'system', text: '+50 XP' },
    { id: 4, kind: 'dialogue', speaker: 'Mayor Hobb', text: 'Ten gold if you clear them!' },
  ];
  s.nextId = 5;
  return s;
}

describe('summary helpers', () => {
  it('collects story lines since the last summary, skipping system lines', () => {
    const s = stateWithLog();
    expect(linesSince(s)).toEqual({ lines: ['You arrive in Millbrook. Bread smells drift by.', 'The hero: I ask about the rats.', 'Mayor Hobb: Ten gold if you clear them!'], lastId: 4 });
    s.summaryUpTo = 2;
    expect(linesSince(s).lines).toEqual(['Mayor Hobb: Ten gold if you clear them!']);
  });

  it('template keeps one sentence per line and clamps from the front', () => {
    expect(templateSummary('Earlier things happened.', ['You arrive. It rains.', 'The hero: I wave.'])).toBe('Earlier things happened. You arrive. The hero: I wave.');
    const long = Array.from({ length: 200 }, (_, i) => `Sentence ${i}.`).join(' ');
    const c = clampSummary(long, 100);
    expect(c.length).toBeLessThanOrEqual(100);
    expect(c.startsWith('Sentence')).toBe(true);
    expect(c.endsWith('Sentence 199.')).toBe(true);
  });
});

describe('updateSummary', () => {
  it('uses the summarizer result and advances summaryUpTo', async () => {
    const s = stateWithLog();
    const calls: [string, string[]][] = [];
    const summarizer: Summarizer = async (prev, lines) => {
      calls.push([prev, lines]);
      return 'The hero reached Millbrook and Mayor Hobb offered ten gold to clear the rats.';
    };
    await updateSummary(s, summarizer);
    expect(s.summary).toBe('The hero reached Millbrook and Mayor Hobb offered ten gold to clear the rats.');
    expect(s.summaryUpTo).toBe(4);
    expect(calls[0]![1]).toHaveLength(3);
    // Nothing new → no call.
    await updateSummary(s, summarizer);
    expect(calls).toHaveLength(1);
  });

  it('falls back to the template when the summarizer throws or returns junk', async () => {
    const s = stateWithLog();
    await updateSummary(s, async () => {
      throw new Error('down');
    });
    expect(s.summary).toBe('You arrive in Millbrook. The hero: I ask about the rats. Mayor Hobb: Ten gold if you clear them!');
    const t = stateWithLog();
    await updateSummary(t, async () => 'ok');
    expect(t.summary).toMatch(/^You arrive in Millbrook\./);
  });
});

describe('llmSummarizer', () => {
  it('calls the model with the previous summary and new events; refuses the mock', async () => {
    const llm = new MockLlm({ script: ['The hero took the job.'] });
    const provider: LlmProvider = { name: 'ollama', chat: llm.chat.bind(llm), stream: llm.stream.bind(llm), listModels: llm.listModels.bind(llm), status: llm.status.bind(llm) };
    expect(await llmSummarizer(() => provider)('Before.', ['A', 'B'])).toBe('The hero took the job.');
    expect(llm.calls[0]!.opts.task).toBe('summarize');
    expect(summaryMessages('Before.', ['A', 'B'])[1]!.content).toBe('STORY SO FAR:\nBefore.\n\nNEW EVENTS:\nA\nB');
    await expect(llmSummarizer(() => new MockLlm())('x', ['y'])).rejects.toThrow();
  });
});

describe('summary in the session', () => {
  it('summarizes after each scene change, in the background, and saves it with the game', async () => {
    const seen: string[][] = [];
    const port = adventureActionPort(new Map([[adventure.id, adventure]]), adventure.id, db, {
      summarizer: async (prev, lines) => {
        seen.push(lines);
        return `${prev} The hero finished scene ${seen.length}.`.trim();
      },
    });
    const session = new GameSession({ actions: port, newSeed: () => 's' });
    await session.handle({ type: 'new_game', hero: hero(), mode: 'heroic' });
    await session.handle({ type: 'choose', actionId: 'talk_mayor' });
    expect(session.current.summary).toBe('');
    await session.handle({ type: 'choose', actionId: 'exit.to_mill' });
    await port.idle();
    expect(session.current.summary).toBe('The hero finished scene 1.');
    expect(seen[0]!.some((l) => l.includes('Mayor Hobb promises'))).toBe(true);
    await session.handle({ type: 'choose', actionId: 'exit.back' });
    await port.idle();
    expect(session.current.summary).toBe('The hero finished scene 1. The hero finished scene 2.');
    expect(seen[1]!.some((l) => l.includes('Mayor Hobb promises'))).toBe(false);
  });
});
