/**
 * Backstory suggestion for the character creator (spec §5 step 7). The LLM writes 3–5 sentences
 * from the character summary; if the LLM is unavailable a template backstory is used instead.
 * The result is plain prose the player can edit; it is stored for later narration.
 */
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

/** Deterministic fallback when no LLM is available. */
export function templateBackstory(s: BackstorySummary): string {
  const bg = s.background.toLowerCase();
  const hook =
    bg === 'soldier'
      ? 'You marched with a company that no longer exists, and you still count the names of those who did not come home.'
      : bg === 'criminal'
        ? 'You learned early that locks, lies and loyalties can all be broken, and one job went wrong enough to force you onto the road.'
        : bg === 'sage'
          ? 'You spent years among dusty books until a single torn page hinted at a truth no one else wanted found.'
          : bg === 'acolyte'
            ? 'You served a quiet temple until a vision — or a warning — sent you out beyond its walls.'
            : 'Something in your past still pulls at you, a question only the road can answer.';
  return `You are ${s.name || 'a wanderer'}, a ${s.species.toLowerCase()} ${s.className.toLowerCase()} raised in ${s.homeland ?? 'a small town at the edge of the known lands'}. ${hook} Now you seek adventure, coin and perhaps a purpose worth the risk.`;
}
