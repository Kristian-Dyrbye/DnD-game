/** Chooses the LLM provider from settings: the mock if `useMock` is on, otherwise Ollama. */
import type { Settings } from '../shared/settings';
import { MockLlm } from './mock';
import { OllamaClient } from './ollama';
import type { LlmProvider } from './types';

export function createLlmProvider(llm: Settings['llm'], fetchFn?: typeof fetch): LlmProvider {
  if (llm.useMock) return new MockLlm();
  return new OllamaClient({
    baseUrl: llm.baseUrl,
    model: llm.model,
    temperature: llm.temperature,
    // Idle unload frees RAM quickly; otherwise keep the model warm for an hour (not forever, so a closed game doesn't hold RAM).
    keepAlive: llm.unloadWhenIdle ? `${llm.idleMinutes}m` : '60m',
    ...(fetchFn && { fetch: fetchFn }),
  });
}
