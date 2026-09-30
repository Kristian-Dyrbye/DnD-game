/**
 * Reply language for LLM prompts (A150). Instructions stay in English (small models follow English
 * instructions best); a rule asks for the reply in the session language. English adds nothing, so
 * English prompts are unchanged. Ids and JSON keys always stay as given.
 */
import type { Language } from '../../shared/i18nCore';

/** The language's name as the model should read it. */
export const LANGUAGE_NAMES: Record<Language, string> = { en: 'English', da: 'Danish (dansk)' };

/** Extra guidance per language: address form and words small models get wrong. */
const STYLE: Partial<Record<Language, string>> = {
  da: 'Use natural, idiomatic Danish (not a word-for-word translation of English); address the hero as "du". Keep the names of people and places exactly as given.',
};

/** "Write your reply in Danish…" for prose replies; undefined for English. */
export function replyLanguageRule(lang: Language | undefined): string | undefined {
  if (!lang || lang === 'en') return undefined;
  return `Write your whole reply in ${LANGUAGE_NAMES[lang]}. ${STYLE[lang] ?? ''}`.trim();
}

/** For JSON replies: text values in the language, ids/keys untouched; undefined for English. */
export function jsonLanguageRule(lang: Language | undefined, fields: string): string | undefined {
  if (!lang || lang === 'en') return undefined;
  return `Write ${fields} in ${LANGUAGE_NAMES[lang]}. JSON keys, ids and enum values stay exactly as given (English).`;
}

/** For reading the player's words: they may write in the session language. */
export function inputLanguageNote(lang: Language | undefined): string | undefined {
  if (!lang || lang === 'en') return undefined;
  return `The player writes in ${LANGUAGE_NAMES[lang]}; the action labels are in that language too. Ids and enum values stay English.`;
}
