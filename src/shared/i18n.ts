/**
 * UI translations (owner request 2026-09-30: language setting with Danish). Catalogs are flat
 * key → text maps (src/shared/i18n/<lang>.ts); English is the source and the fallback for any key a
 * catalog misses. Texts may hold `{name}` placeholders. Plurals are key pairs `<base>.one` /
 * `<base>.other`, picked by Intl.PluralRules. No library: the needs are small and the title screen
 * must stay light. Pure module: the client keeps the current language in a signal (ui/i18n.ts).
 */
import { en, type MessageKey } from './i18n/en';
import { da } from './i18n/da';
import { format, pluralForm, type Language, type Params } from './i18nCore';

export type { MessageKey } from './i18n/en';
export { LANGUAGES, isLanguage, format, pluralForm, type Language, type Params } from './i18nCore';

/** Each language's name in itself (shown in the pickers). */
export const LANGUAGE_NAMES: Record<Language, string> = { en: 'English', da: 'Dansk' };

export type Catalog = Partial<Record<MessageKey, string>>;
export const CATALOGS: Record<Language, Catalog> = { en, da };

/** Keys that come as a `.one` / `.other` pair, named by their base. */
export type PluralKey = { [K in MessageKey]: K extends `${infer B}.one` ? (`${B}.other` extends MessageKey ? B : never) : never }[MessageKey];

/** The text for a key in a language (falls back to English, then to the key itself). */
export function translate(lang: Language, key: MessageKey, params?: Params): string {
  return format(CATALOGS[lang][key] ?? en[key] ?? key, params);
}

/** A plural text: `translatePlural('da', 'status.voices', 2)` → "2 stemmer installeret". `{count}` is filled in. */
export function translatePlural(lang: Language, base: PluralKey, count: number, params?: Params): string {
  return translate(lang, `${base}.${pluralForm(lang, count)}` as MessageKey, { count, ...params });
}

/** A translator bound to one language (for pure helpers that build UI text). */
export interface Translator {
  lang: Language;
  t(key: MessageKey, params?: Params): string;
  tn(base: PluralKey, count: number, params?: Params): string;
}

export function translator(lang: Language): Translator {
  return { lang, t: (key, params) => translate(lang, key, params), tn: (base, count, params) => translatePlural(lang, base, count, params) };
}

export const ENGLISH: Translator = translator('en');

/** Keys a catalog lacks compared with English (the test keeps Danish complete). */
export function missingKeys(lang: Language): MessageKey[] {
  return (Object.keys(en) as MessageKey[]).filter((k) => CATALOGS[lang][k] === undefined);
}
