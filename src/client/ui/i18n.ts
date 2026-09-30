/**
 * The client's current UI language. `t()` reads the `language` signal, so every component that
 * calls it re-renders when the language changes (no reload). Set from settings.gameplay.language.
 */
import { signal } from '@preact/signals';
import { translate, translatePlural, translator, type Language, type MessageKey, type Params, type PluralKey, type Translator } from '../../shared/i18n';
import { formatCoins } from './text';

export const language = signal<Language>('en');

export function t(key: MessageKey, params?: Params): string {
  return translate(language.value, key, params);
}

export function tn(base: PluralKey, count: number, params?: Params): string {
  return translatePlural(language.value, base, count, params);
}

/** A translator for the current language (subscribes the caller like t()). */
export function currentTranslator(): Translator {
  return translator(language.value);
}

/** Coins in the current language ("12 GP 5 SP" / "12 gm 5 sm"). */
export function coins(cp: number): string {
  return formatCoins(cp, currentTranslator());
}

/** Switches the UI language and tells the browser (screen readers, hyphenation). */
export function applyLanguage(lang: Language): void {
  language.value = lang;
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
}
