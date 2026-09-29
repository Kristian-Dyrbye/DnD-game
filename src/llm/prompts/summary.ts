/**
 * Story summary prompt (spec §3): condenses the previous summary plus the latest scene's lines into
 * a short "story so far" that replaces the transcript in later prompts. Plain text, low
 * temperature; the engine validates length and falls back to a template (engine/adventure/summary.ts).
 */
import type { Summarizer } from '../../engine/adventure/summary';
import type { ChatMessage, LlmProvider } from '../types';

export function summaryMessages(previous: string, lines: string[]): ChatMessage[] {
  return [
    {
      role: 'system',
      content:
        'You keep a running summary of a solo fantasy adventure. Rewrite the story so far in at most 8 short sentences, past tense, third person. ' +
        'Keep names, promises, debts, enemies made, items gained, choices and unresolved threads; drop scenery and small talk. Invent nothing. Plain text only.',
    },
    { role: 'user', content: `STORY SO FAR:\n${previous || '(the adventure has just begun)'}\n\nNEW EVENTS:\n${lines.join('\n')}` },
  ];
}

/** A Summarizer backed by the LLM; throws for the mock so the engine uses its template. */
export function llmSummarizer(getLlm: () => LlmProvider): Summarizer {
  return async (previous, lines) => {
    const llm = getLlm();
    if (llm.name === 'mock') throw new Error('mock provider: use template summary');
    return llm.chat(summaryMessages(previous, lines), { task: 'summarize', temperature: 0.3, maxTokens: 320, timeoutMs: 60_000 });
  };
}
