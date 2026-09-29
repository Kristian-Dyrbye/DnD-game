/** Chooses the LLM provider from settings: the mock if `useMock` is on, otherwise Ollama. */
import type { Settings } from '../shared/settings';
import { MockLlm } from './mock';
import { OllamaClient } from './ollama';
import type { LlmProvider } from './types';

/** Context window for Ollama; the narration prompt budget (2200) + reply fit inside it. */
export const LLM_CONTEXT_TOKENS = 4096;

export function createLlmProvider(llm: Settings['llm'], fetchFn?: typeof fetch): LlmProvider {
  if (llm.useMock) return new MockLlm();
  return new OllamaClient({
    baseUrl: llm.baseUrl,
    model: llm.model,
    temperature: llm.temperature,
    // Idle unload frees RAM quickly; otherwise keep the model warm for an hour (not forever, so a closed game doesn't hold RAM).
    keepAlive: llm.unloadWhenIdle ? `${llm.idleMinutes}m` : '60m',
    // 4096 tokens keeps a 4B model's KV cache small enough for the 3 GB LLM budget (spec §1).
    numCtx: LLM_CONTEXT_TOKENS,
    ...(fetchFn && { fetch: fetchFn }),
  });
}
