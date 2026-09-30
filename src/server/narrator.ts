/**
 * The server's Narrator: gathers the prompt context (state + adventure + lore), builds the
 * narration prompt and streams it from the configured LLM. Returns nothing for the mock provider
 * (its canned prose ignores the facts), which makes the engine use template narration.
 * Timeouts are sized for a CPU: a generous wait for the first chunk (prompt evaluation), then a
 * short idle limit between chunks. A timeout after at least one full sentence just ends the
 * stream (the engine keeps the whole sentences), without a notice.
 */
import { wholeSentences, type NarrationJob, type Narrator } from '../engine/adventure/narration';
import type { SrdDatabase } from '../engine/data/srd';
import type { Lore } from '../engine/world/lore';
import { gatherNarrationContext } from '../llm/context/gather';
import { buildNarrationPrompt } from '../llm/context/narration';
import { LlmError, type ChatOptions, type LlmProvider } from '../llm/types';

/** Stream settings per narration kind. */
export const NARRATION_OPTIONS = {
  story: { temperature: 0.8, maxTokens: 220, firstChunkTimeoutMs: 60_000, idleTimeoutMs: 15_000 },
  combat: { temperature: 0.8, maxTokens: 90, firstChunkTimeoutMs: 30_000, idleTimeoutMs: 10_000, queueAs: 'combat_narrate' },
} satisfies Record<string, ChatOptions>;

export function llmNarrator(getLlm: () => LlmProvider, lore: Lore, db?: SrdDatabase, onError?: (err: unknown) => void): Narrator {
  return async function* narrate(job: NarrationJob, signal?: AbortSignal) {
    const llm = getLlm();
    if (llm.name === 'mock') return;
    const context = gatherNarrationContext(job.ctx.state, lore, job.ctx.adventure, db);
    const prompt = buildNarrationPrompt(context, { kind: job.kind, facts: job.facts, ...(job.playerAction && { playerAction: job.playerAction }), ...(job.visit && { visit: job.visit }) });
    let text = '';
    try {
      const opts = job.kind === 'combat' ? NARRATION_OPTIONS.combat : NARRATION_OPTIONS.story;
      for await (const chunk of llm.stream(prompt.messages, { task: 'narrate', ...opts, ...(signal && { signal }) })) {
        text += chunk;
        yield chunk;
      }
    } catch (err) {
      if (err instanceof LlmError && err.kind === 'timeout' && wholeSentences(text)) return;
      // The engine falls back to template narration; the notice tells the player why.
      onError?.(err);
      throw err;
    }
  };
}
