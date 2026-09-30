import { describe, expect, it } from 'vitest';
import demo from '../../data/adventures/demo/millbrook_demo.json';
import loreJson from '../../data/world/lore.json';
import { startAdventure } from '../engine/adventure/runner';
import { validateAdventure } from '../engine/adventure/validate';
import { buildCharacter } from '../engine/character/builder';
import { toBuildInput } from '../engine/character/creator';
import { quickBuild } from '../engine/character/quickBuild';
import { Rng } from '../engine/core/rng';
import { loadSrd } from '../engine/data/srdBundle';
import { newGameState } from '../engine/session/GameSession';
import { LoreSchema } from '../engine/world/lore';
import { MockLlm } from '../llm/mock';
import { estimateTokens } from '../llm/context/cards';
import { DEFAULT_PROMPT_BUDGET } from '../llm/context/narration';
import { LlmError, type LlmProvider } from '../llm/types';
import { llmNarrator } from './narrator';

const db = loadSrd();
const lore = LoreSchema.parse(loreJson);
const adventure = validateAdventure(structuredClone(demo), db).adventure!;

function job() {
  const hero = buildCharacter(toBuildInput(quickBuild('wizard', db, Rng.fromSeed('w'))), db);
  const ctx = { state: newGameState(hero, 'heroic', 1), adventure, rng: Rng.fromSeed(1), db };
  startAdventure(ctx);
  return { kind: 'outcome' as const, playerAction: 'Study the notices', facts: ['Only the rat notice is legible.'], ctx };
}

function wrap(llm: MockLlm): LlmProvider {
  return { name: llm.name, chat: llm.chat.bind(llm), stream: llm.stream.bind(llm), listModels: llm.listModels.bind(llm), status: llm.status.bind(llm) };
}

async function collect(it: AsyncIterable<string>): Promise<string> {
  let s = '';
  for await (const c of it) s += c;
  return s;
}

describe('llmNarrator', () => {
  it('streams from a real (non-mock) provider with the built narration prompt', async () => {
    const llm = new MockLlm({ script: ['You squint at the board. Only the rat notice is legible.'] });
    const provider: LlmProvider = { name: 'ollama', chat: llm.chat.bind(llm), stream: llm.stream.bind(llm), listModels: llm.listModels.bind(llm), status: llm.status.bind(llm) };
    const text = await collect(llmNarrator(() => provider, lore, db)(job()));
    expect(text).toBe('You squint at the board. Only the rat notice is legible.');
    const call = llm.calls[0]!;
    expect(call.opts.task).toBe('narrate');
    expect(call.messages[0]!.content).toMatch(/Dungeon Master/);
    expect(call.messages[0]!.content).toMatch(/Kingdom of Aurelmark/);
    expect(call.messages[1]!.content).toContain('1. Only the rat notice is legible.');
    expect(call.messages[1]!.content).toContain('"Study the notices"');
  });

  it('uses short replies with first-chunk and idle timeouts, and a prompt within the CPU budget', async () => {
    const llm = new MockLlm({ script: ['Fine.'] });
    const provider: LlmProvider = { ...wrap(llm), name: 'ollama' };
    await collect(llmNarrator(() => provider, lore, db)(job()));
    expect(llm.calls[0]!.opts).toMatchObject({ maxTokens: 220, firstChunkTimeoutMs: 60_000, idleTimeoutMs: 15_000 });
    expect(llm.calls[0]!.opts.timeoutMs).toBeUndefined();
    expect(llm.calls[0]!.messages[0]!.content).toMatch(/3 to 5 sentences/);
    const tokens = llm.calls[0]!.messages.reduce((n, m) => n + estimateTokens(m.content), 0);
    expect(tokens).toBeLessThanOrEqual(DEFAULT_PROMPT_BUDGET);
  });

  it('ends quietly on a timeout after a full sentence, but reports one before it', async () => {
    const errors: unknown[] = [];
    const timingOut = (first: string): LlmProvider => ({
      ...wrap(new MockLlm()),
      name: 'ollama',
      async *stream() {
        yield first;
        throw new LlmError('timeout', 'stalled');
      },
    });
    const narrate = (p: LlmProvider) => llmNarrator(() => p, lore, db, (e) => errors.push(e))(job());
    expect(await collect(narrate(timingOut('The board is bare. Only')))).toBe('The board is bare. Only');
    expect(errors).toHaveLength(0);
    await expect(collect(narrate(timingOut('The board')))).rejects.toMatchObject({ kind: 'timeout' });
    expect(errors).toHaveLength(1);
  });

  it('yields nothing for the mock provider (so the engine uses templates)', async () => {
    const llm = new MockLlm();
    expect(await collect(llmNarrator(() => llm, lore, db)(job()))).toBe('');
    expect(llm.calls).toHaveLength(0);
  });
});
