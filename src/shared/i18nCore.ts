/**
 * Language basics shared by the UI catalogs (shared/i18n.ts) and the engine message catalog
 * (engine/i18n.ts): the language list, `{name}` placeholders and plural forms. No catalogs here, so
 * the engine can use it without pulling in the UI texts.
 */
export const LANGUAGES = ['en', 'da'] as const;
export type Language = (typeof LANGUAGES)[number];

export type Params = Record<string, string | number>;

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}

/** Replaces `{name}` with params.name; unknown placeholders stay as written. */
export function format(text: string, params?: Params): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
}

const rules = new Map<Language, Intl.PluralRules>();

/** 'one' or 'other' for a count in a language (English and Danish only have these two). */
export function pluralForm(lang: Language, count: number): 'one' | 'other' {
  let r = rules.get(lang);
  if (!r) rules.set(lang, (r = new Intl.PluralRules(lang)));
  return r.select(count) === 'one' ? 'one' : 'other';
}
