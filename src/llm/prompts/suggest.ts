/**
 * Suggested actions prompt (spec §3 item 4): asks the model for 3–5 short, contextual action ideas
 * as JSON. Ideas may name an offered action id; the engine merges and validates them
 * (engine/adventure/suggestions.ts). Returns [] for the mock or on failure → data buttons only.
 */
import { z } from 'zod';
import type { AvailableAction } from '../../engine/adventure/runner';
import type { SuggestionIdea } from '../../engine/adventure/suggestions';
import type { NarrationContext } from '../context/narration';
import { callStructured } from '../structured';
import type { ChatMessage, LlmProvider } from '../types';

export const SuggestionsSchema = z.object({
  suggestions: z
    .array(z.object({ label: z.string().min(2).max(60), actionId: z.string().optional() }))
    .min(1)
    .max(5),
});

export function suggestMessages(c: NarrationContext, offered: AvailableAction[]): ChatMessage[] {
  return [
    {
      role: 'system',
      content:
        'You suggest what a player might do next in a fantasy adventure. Reply with JSON only: {"suggestions":[{"label":"...","actionId":"..."}]}.\n' +
        '- Give 3 to 5 suggestions, each a short imperative phrase under 60 characters ("Ask the baker about the miller").\n' +
        '- When a suggestion is one of the OFFERED ACTIONS, copy its id into "actionId". Otherwise omit actionId.\n' +
        '- Only suggest things that fit the scene and the people present. Never promise rewards or outcomes.',
    },
    {
      role: 'user',
      content: [
        `HERO: ${c.party[0] ?? 'the hero'}`,
        `SCENE: ${c.scene}`,
        ...(c.recent.length ? [`RECENT:\n${c.recent.slice(-3).join('\n')}`] : []),
        `OFFERED ACTIONS:\n${offered.map((a) => `${a.id}: ${a.label}`).join('\n')}`,
      ].join('\n\n'),
    },
  ];
}

export async function suggestIdeas(provider: LlmProvider, c: NarrationContext, offered: AvailableAction[]): Promise<SuggestionIdea[]> {
  if (provider.name === 'mock') return [];
  const res = await callStructured({
    provider,
    messages: suggestMessages(c, offered),
    schema: SuggestionsSchema,
    fallback: { suggestions: [] as { label: string; actionId?: string }[] } as z.infer<typeof SuggestionsSchema>,
    task: 'suggest',
    opts: { temperature: 0.7, maxTokens: 200, timeoutMs: 45_000 },
  });
  return res.value.suggestions.map((s) => ({ label: s.label, ...(s.actionId && { actionId: s.actionId }) }));
}
