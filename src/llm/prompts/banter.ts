/**
 * Banter prompt (spec §6): one short in-character line from a companion reacting to what just
 * happened. No mechanics, no questions to the player that need answers.
 */
import type { BanterGenerator } from '../../engine/party/banter';
import type { Language } from '../../shared/i18nCore';
import type { ChatMessage, LlmProvider } from '../types';
import { replyLanguageRule } from './language';

export function banterMessages(name: string, personality: string, voice: string, mood: 'content' | 'resentful', context: string, lang?: Language): ChatMessage[] {
  const langRule = replyLanguageRule(lang);
  return [
    {
      role: 'system',
      content:
        `You are ${name}, a companion in a fantasy adventure. Personality: ${personality} Voice: ${voice} ` +
        `Current mood toward the hero: ${mood}. Reply with ONE short spoken line (max 25 words), in character, reacting to the recent events. ` +
        'No quotation marks, no stage directions, no game terms, no promises of rewards.' +
        (langRule ? ` ${langRule}` : ''),
    },
    { role: 'user', content: `RECENT EVENTS:\n${context}` },
  ];
}

/** The LLM banter generator; throws for the mock so the written lines are used. */
export function llmBanter(getLlm: () => LlmProvider): BanterGenerator {
  return async (def, mood, context, lang) => {
    const llm = getLlm();
    if (llm.name === 'mock') throw new Error('mock: use written banter');
    return llm.chat(banterMessages(def.name, def.personality, def.voice, mood, context, lang), { task: 'banter', temperature: 0.9, maxTokens: 60, timeoutMs: 30_000 });
  };
}
