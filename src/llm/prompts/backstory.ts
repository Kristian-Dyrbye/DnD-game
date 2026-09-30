/**
 * Backstory suggestion for the character creator (spec §5 step 7). The LLM writes 3–5 sentences
 * from the character summary; if the LLM is unavailable a template backstory is used instead.
 * The result is plain prose the player can edit; it is stored for later narration.
 */
import { messages, type EngineKey } from '../../engine/i18n';
import { isLanguage, type Language } from '../../shared/i18nCore';
import type { ChatMessage } from '../types';

export interface BackstorySummary {
  name: string;
  species: string;
  className: string;
  background: string;
  traits?: string;
  ideals?: string;
  bonds?: string;
  flaws?: string;
  /** Region/tone hint from the world lore (optional). */
  homeland?: string;
  /** Language of the template story (the player's setting); the LLM prompt stays English until A150. */
  language?: Language;
}

export function backstoryMessages(s: BackstorySummary): ChatMessage[] {
  const details = [
    `Name: ${s.name || 'unnamed'}`,
    `Species: ${s.species}`,
    `Class: ${s.className}`,
    `Background: ${s.background}`,
    s.homeland && `Homeland: ${s.homeland}`,
    s.traits && `Personality traits: ${s.traits}`,
    s.ideals && `Ideals: ${s.ideals}`,
    s.bonds && `Bonds: ${s.bonds}`,
    s.flaws && `Flaws: ${s.flaws}`,
  ].filter(Boolean);
  return [
    {
      role: 'system',
      content:
        'You write short, vivid backstories for heroes in an original fantasy world. Write 3 to 5 sentences in second person ("You..."). ' +
        'Mention where they grew up, one formative event, and why they now seek adventure. Do not invent game statistics, magic items or ' +
        'named places from other published settings. No lists, no headings — just the story.',
    },
    { role: 'user', content: details.join('\n') },
  ];
}

const HOOKS = { soldier: 'backstory.soldier', criminal: 'backstory.criminal', sage: 'backstory.sage', acolyte: 'backstory.acolyte' } as const satisfies Record<string, EngineKey>;

/** Deterministic fallback when no LLM is available, in the summary's language (default English). */
export function templateBackstory(s: BackstorySummary): string {
  const { m } = messages(isLanguage(s.language) ? s.language : 'en'); // the server gets it from a request body
  const hook = m(HOOKS[s.background.toLowerCase() as keyof typeof HOOKS] ?? 'backstory.other');
  const intro = m('backstory.intro', {
    name: s.name || m('backstory.wanderer'),
    species: s.species.toLowerCase(),
    className: s.className.toLowerCase(),
    homeland: s.homeland ?? m('backstory.homeland'),
  });
  return `${intro} ${hook} ${m('backstory.outro')}`;
}
