/**
 * Intent parsing prompt (spec §3 item 3): turns the player's free text into a structured Intent
 * via a JSON-schema LLM call, with the keyword parser as the fallback. The result is validated by
 * the engine afterwards (validateIntent) — the model can suggest, never decide.
 */
import { IntentSchema, keywordIntent, type Intent, type IntentContext, type IntentOption } from '../../engine/adventure/intent';
import { ABILITY_NAMES, SKILL_NAMES } from '../../engine/rules/basics';
import { callStructured } from '../structured';
import type { ChatMessage, LlmProvider } from '../types';
import { inputLanguageNote } from './language';

export function intentMessages(text: string, ictx: IntentContext): ChatMessage[] {
  const note = inputLanguageNote(ictx.lang);
  const options = ictx.actions.map((a) => `${a.id}: ${a.label}${checkNote(a)}`).join('\n') || '(none)';
  const people = ictx.npcs.map((n) => `${n.id}: ${n.name}`).join(', ') || '(nobody)';
  const things = ictx.pois.map((p) => `${p.id}: ${p.name}`).join(', ') || '(nothing notable)';
  return [
    {
      role: 'system',
      content:
        'You convert a player\'s words in a fantasy game into one JSON intent. Reply with JSON only.\n' +
        '- If the words clearly mean one of the OFFERED ACTIONS, use {"action":"choose_action","actionId":"<id>"}. Match by meaning, not exact words ("relight the flame" = "Rekindle the brazier"; "search for tracks" = an action with skill survival).\n' +
        '- Otherwise pick the closest action type: skill_check (set "skill" to a D&D skill in snake_case), talk, move, look, attack, use_item, cast_spell, rest, other.\n' +
        '- "target" is the id of a person or thing below, if one is meant. "approach" is a few words on how.\n' +
        '- Never invent ids. Do not decide whether it works.' +
        (note ? `
- ${note}` : ''),
    },
    {
      role: 'user',
      content: `OFFERED ACTIONS:\n${options}\nPEOPLE: ${people}\nTHINGS: ${things}\n\nPLAYER: ${text}`,
    },
  ];
}

/** " [skill: survival]" when the action rolls a check its label doesn't already name. */
function checkNote(a: IntentOption): string {
  const name = a.skill ? SKILL_NAMES[a.skill] : a.ability ? ABILITY_NAMES[a.ability] : undefined;
  if (!name || a.label.toLowerCase().includes(name.toLowerCase())) return '';
  return a.skill ? ` [skill: ${a.skill}]` : ` [ability: ${name}]`;
}

export interface ParsedIntent {
  intent: Intent;
  source: 'llm' | 'keywords';
}

/** LLM intent with one retry; the keyword parser if the model is a mock, down, or unusable. */
export async function parseIntent(provider: LlmProvider, text: string, ictx: IntentContext): Promise<ParsedIntent> {
  if (provider.name === 'mock') return { intent: keywordIntent(text, ictx), source: 'keywords' };
  const res = await callStructured({
    provider,
    messages: intentMessages(text, ictx),
    schema: IntentSchema,
    fallback: () => keywordIntent(text, ictx),
    task: 'intent',
    opts: { temperature: 0.1, maxTokens: 120, timeoutMs: 20_000 },
  });
  return { intent: res.value, source: res.ok ? 'llm' : 'keywords' };
}
