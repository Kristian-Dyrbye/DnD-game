/**
 * Content in the session's language (A142): English adventures and world tables with the
 * data/i18n/<lang>/<key>.json overlays merged in (shared/contentI18n.ts). Adventures are keyed by
 * their id, tables by TABLE_KEYS. Built lazily once per language; English = the content as loaded.
 */
import type { Adventure } from '../engine/adventure/schema';
import { applyOverlay, type ContentTranslations } from '../shared/contentI18n';
import type { WorldTables } from './gameHost';

/** Overlay key (file name) of each world table. */
export const TABLE_KEYS = {
  lore: 'lore',
  travelEvents: 'travel-events',
  shops: 'shops',
  sideQuests: 'sidequests',
  defeats: 'defeat-outcomes',
  companions: 'companions',
} as const satisfies Record<keyof WorldTables, string>;

/** English source file of each table overlay key (project-relative; for `$source` and i18n:check). */
export const TABLE_SOURCES: Record<string, string> = {
  lore: 'data/world/lore.json',
  'travel-events': 'data/tables/travel-events.json',
  shops: 'data/world/shops.json',
  sidequests: 'data/tables/sidequests.json',
  'defeat-outcomes': 'data/tables/defeat-outcomes.json',
  companions: 'data/companions.json',
};

export interface LocalizedContent {
  adventures: ReadonlyMap<string, Adventure>;
  tables: WorldTables;
}

/** Returns a per-language content getter (cached). Languages without overlays get the English content. */
export function contentByLanguage(
  adventures: ReadonlyMap<string, Adventure>,
  tables: WorldTables,
  translations: ContentTranslations = {},
): (lang: string) => LocalizedContent {
  const english: LocalizedContent = { adventures, tables };
  const cache = new Map<string, LocalizedContent>();
  return (lang) => {
    const overlays = translations[lang];
    if (!overlays || Object.keys(overlays).length === 0) return english;
    let c = cache.get(lang);
    if (!c) {
      const t = { ...tables } as Record<keyof WorldTables, unknown>;
      for (const [field, key] of Object.entries(TABLE_KEYS) as [keyof WorldTables, string][]) t[field] = applyOverlay(tables[field], overlays[key]);
      c = {
        adventures: new Map([...adventures].map(([id, a]) => [id, applyOverlay(a, overlays[id])])),
        tables: t as unknown as WorldTables,
      };
      cache.set(lang, c);
    }
    return c;
  };
}
