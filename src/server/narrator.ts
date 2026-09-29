/**
 * The server's Narrator: gathers the prompt context (state + adventure + lore), builds the
 * narration prompt and streams it from the configured LLM. Returns nothing for the mock provider
 * (its canned prose ignores the facts), which makes the engine use template narration.
 */
import type { NarrationJob, Narrator } from '../engine/adventure/narration';
import type { SrdDatabase } from '../engine/data/srd';
import type { Lore } from '../engine/world/lore';
import { gatherNarrationContext } from '../llm/context/gather';
import { buildNarrationPrompt } from '../llm/context/narration';
import type { LlmProvider } from '../llm/types';

export function llmNarrator(getLlm: () => LlmProvider, lore: Lore, db?: SrdDatabase): Narrator {
  return async function* narrate(job: NarrationJob, signal?: AbortSignal) {
    const llm = getLlm();
    if (llm.name === 'mock') return;
    const context = gatherNarrationContext(job.ctx.state, lore, job.ctx.adventure, db);
    const prompt = buildNarrationPrompt(context, { kind: job.kind, facts: job.facts, ...(job.playerAction && { playerAction: job.playerAction }) });
    yield* llm.stream(prompt.messages, { task: 'narrate', temperature: 0.8, maxTokens: 450, timeoutMs: 90_000, ...(signal && { signal }) });
  };
}
