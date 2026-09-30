/**
 * Adventure content bundled as JSON imports (Vite / Vitest / tsx all support them), for the
 * in-browser host that can't read data/adventures/ or data/i18n/ from disk. Keep the lists in sync with the folders:
 * tests/hostInPage.test.ts compares it with the files on disk.
 */
import type { SrdDatabase } from '../engine/data/srd';
import { FlagRegistry } from '../engine/world/flags';
import type { CompanionRoster } from '../engine/party/companions';
import { validateAdventureSources, type AdventureSource, type LoadedAdventures } from './content';
import flagsJson from '../../data/adventures/flags.json';
import demo from '../../data/adventures/demo/millbrook_demo.json';
import starter from '../../data/adventures/starter/millbrook_disappearances.json';
import ch1 from '../../data/adventures/arc1/ch1_whispering_fen.json';
import ch2 from '../../data/adventures/arc1/ch2_salt_and_treason.json';
import ch3 from '../../data/adventures/arc1/ch3_the_gilded_lie.json';
import ch4 from '../../data/adventures/arc1/ch4_wyrmfire.json';
import ch5 from '../../data/adventures/arc1/ch5_the_hungering_dark.json';
import { parseOverlay, type ContentTranslations } from '../shared/contentI18n';
import daDemo from '../../data/i18n/da/millbrook_demo.json';
import daStarter from '../../data/i18n/da/millbrook_disappearances.json';
import daCh1 from '../../data/i18n/da/ch1_whispering_fen.json';
import daCh2 from '../../data/i18n/da/ch2_salt_and_treason.json';
import daCh3 from '../../data/i18n/da/ch3_the_gilded_lie.json';
import daCh4 from '../../data/i18n/da/ch4_wyrmfire.json';

/** Bundled adventure files, keyed by their path under data/adventures/. */
export const BUNDLED_ADVENTURES: AdventureSource[] = [
  { file: 'demo/millbrook_demo.json', raw: demo },
  { file: 'starter/millbrook_disappearances.json', raw: starter },
  { file: 'arc1/ch1_whispering_fen.json', raw: ch1 },
  { file: 'arc1/ch2_salt_and_treason.json', raw: ch2 },
  { file: 'arc1/ch3_the_gilded_lie.json', raw: ch3 },
  { file: 'arc1/ch4_wyrmfire.json', raw: ch4 },
  { file: 'arc1/ch5_the_hungering_dark.json', raw: ch5 },
];

/** Bundled content translations (data/i18n/<lang>/<key>.json), same keys as the server loads.
 * Keep in sync with the folder (tests/hostInPage.test.ts). */
export const BUNDLED_TRANSLATIONS: ContentTranslations = {
  da: {
    millbrook_demo: parseOverlay(daDemo),
    millbrook_disappearances: parseOverlay(daStarter),
    ch1_whispering_fen: parseOverlay(daCh1),
    ch2_salt_and_treason: parseOverlay(daCh2),
    ch3_the_gilded_lie: parseOverlay(daCh3),
    ch4_wyrmfire: parseOverlay(daCh4),
  },
};

/** A fresh flag registry from the bundled flags.json (adventure docs are added while validating). */
export function bundledFlagRegistry(): FlagRegistry {
  return FlagRegistry.fromJson(flagsJson);
}

/** Validates the bundled adventures, like loadAdventures does for the server. */
export function loadBundledAdventures(db: SrdDatabase, registry: FlagRegistry, companions?: CompanionRoster): LoadedAdventures {
  return validateAdventureSources(BUNDLED_ADVENTURES, db, registry, companions);
}
