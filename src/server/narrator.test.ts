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
import type { LlmProvider } from '../llm/types';
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

  it('yields nothing for the mock provider (so the engine uses templates)', async () => {
    const llm = new MockLlm();
    expect(await collect(llmNarrator(() => llm, lore, db)(job()))).toBe('');
    expect(llm.calls).toHaveLength(0);
  });
});
