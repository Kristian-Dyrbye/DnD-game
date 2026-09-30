/**
 * Engine message catalog (A141): the lines and facts the engine writes into the story log, in the
 * session's language. Same model as the UI catalogs (shared/i18n.ts): flat key maps, `{name}`
 * placeholders, `.one`/`.other` plurals, English fallback. Log entries keep the language they were
 * written in (old lines are never re-rendered). Pure: the session holds the language and passes a
 * `Messages` object to whoever writes text; functions default to ENGLISH_MESSAGES so tests and
 * callers without a language stay unchanged.
 */
import { format, pluralForm, type Language, type Params } from '../shared/i18nCore';
import { en, type EngineKey } from './i18n/en';
import { da } from './i18n/da';

export type { EngineKey } from './i18n/en';

export const ENGINE_CATALOGS: Record<Language, Partial<Record<EngineKey, string>>> = { en, da };

/** Keys that come as a `.one` / `.other` pair, named by their base. */
export type EnginePluralKey = { [K in EngineKey]: K extends `${infer B}.one` ? (`${B}.other` extends EngineKey ? B : never) : never }[EngineKey];

/** Engine text in one language. */
export interface Messages {
  lang: Language;
  m(key: EngineKey, params?: Params): string;
  mn(base: EnginePluralKey, count: number, params?: Params): string;
  /** 1234 cp → "12 gp 3 sp 4 cp" (Danish "12 gm 3 sm 4 km"). */
  coins(cp: number): string;
}

const cache = new Map<Language, Messages>();

export function messages(lang: Language): Messages {
  const hit = cache.get(lang);
  if (hit) return hit;
  const m = (key: EngineKey, params?: Params) => format(ENGINE_CATALOGS[lang][key] ?? en[key] ?? key, params);
  const made: Messages = {
    lang,
    m,
    mn: (base, count, params) => m(`${base}.${pluralForm(lang, count)}` as EngineKey, { count, ...params }),
    coins(cp) {
      const gp = Math.floor(cp / 100);
      const sp = Math.floor((cp % 100) / 10);
      const c = cp % 10;
      return [gp && m('coins.gp', { n: gp }), sp && m('coins.sp', { n: sp }), c && m('coins.cp', { n: c })].filter(Boolean).join(' ') || m('coins.cp', { n: 0 });
    },
  };
  cache.set(lang, made);
  return made;
}

export const ENGLISH_MESSAGES: Messages = messages('en');

/** Keys a catalog lacks compared with English (the test keeps Danish complete). */
export function missingEngineKeys(lang: Language): EngineKey[] {
  return (Object.keys(en) as EngineKey[]).filter((k) => ENGINE_CATALOGS[lang][k] === undefined);
}
