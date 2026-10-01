/**
 * Static game data for the client: the SRD database and world lore (same validated data the server uses).
 * Lore and shop names follow the UI language through the same content overlays the host uses (data/i18n).
 */
import { computed } from '@preact/signals';
import { loadSrd } from '../engine/data/srdBundle';
import { LoreSchema, type Lore } from '../engine/world/lore';
import loreJson from '../../data/world/lore.json';
import { ShopTableSchema, type ShopTable } from '../engine/world/shops';
import shopsJson from '../../data/world/shops.json';
import { applyOverlay, parseOverlay, type ContentOverlay } from '../shared/contentI18n';
import type { Language } from '../shared/i18nCore';
import daLore from '../../data/i18n/da/lore.json';
import daShops from '../../data/i18n/da/shops.json';
import { language } from './ui/i18n';

export const db = loadSrd();
/** World lore (map, regions, locations) in English; ids are the same in every language. */
export const lore = LoreSchema.parse(loreJson);
/** Shops (names and locations; prices always come from the server), in English. */
export const shops = ShopTableSchema.parse(shopsJson);

/** Overlays for the client-side tables (keep in step with data/i18n/<lang>/{lore,shops}.json). */
const OVERLAYS: Partial<Record<Language, { lore: ContentOverlay; shops: ContentOverlay }>> = {
  da: { lore: parseOverlay(daLore), shops: parseOverlay(daShops) },
};

/** Lore in the current UI language (re-renders readers on a language switch). */
export const localLore = computed((): Lore => applyOverlay(lore, OVERLAYS[language.value]?.lore));
/** Shops in the current UI language. */
export const localShops = computed((): ShopTable => applyOverlay(shops, OVERLAYS[language.value]?.shops));
