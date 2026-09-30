/**
 * Loads every adventure JSON under data/adventures/ (recursively) from disk and validates it with the
 * shared host loader (src/host/content.ts), and the content translation overlays under data/i18n/.
 * Unparseable or invalid files are reported and skipped.
 */
import type { CompanionRoster } from '../engine/party/companions';
import fs from 'node:fs';
import path from 'node:path';
import type { SrdDatabase } from '../engine/data/srd';
import { FlagRegistry } from '../engine/world/flags';
import { validateAdventureSources, type AdventureSource, type LoadedAdventures } from '../host/content';
import { parseOverlay, type ContentOverlay, type ContentTranslations } from '../shared/contentI18n';

export type { LoadedAdventures } from '../host/content';

/** Loads the flag registry (data/adventures/flags.json) if present, plus every adventure's flag docs. */
export function loadFlagRegistry(dir: string): FlagRegistry {
  const file = path.join(dir, 'flags.json');
  return fs.existsSync(file) ? FlagRegistry.fromJson(JSON.parse(fs.readFileSync(file, 'utf8'))) : new FlagRegistry();
}

/** Loads content overlays from `<dir>/<lang>/<key>.json` (A142). Invalid files are reported and skipped. */
export function loadTranslations(dir: string): { translations: ContentTranslations; problems: LoadedAdventures['problems'] } {
  const translations: ContentTranslations = {};
  const problems: LoadedAdventures['problems'] = [];
  if (!fs.existsSync(dir)) return { translations, problems };
  for (const lang of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!lang.isDirectory()) continue;
    const overlays: Record<string, ContentOverlay> = {};
    for (const f of fs.readdirSync(path.join(dir, lang.name))) {
      if (!f.endsWith('.json')) continue;
      const full = path.join(dir, lang.name, f);
      try {
        overlays[f.slice(0, -'.json'.length)] = parseOverlay(JSON.parse(fs.readFileSync(full, 'utf8')));
      } catch (err) {
        problems.push({ file: full, errors: [(err as Error).message] });
      }
    }
    translations[lang.name] = overlays;
  }
  return { translations, problems };
}

export function loadAdventures(dir: string, db?: SrdDatabase, registry?: FlagRegistry, companions?: CompanionRoster): LoadedAdventures {
  const sources: AdventureSource[] = [];
  const problems: LoadedAdventures['problems'] = [];
  const walk = (d: string) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.json')) {
        try {
          sources.push({ file: full, raw: JSON.parse(fs.readFileSync(full, 'utf8')) });
        } catch (err) {
          problems.push({ file: full, errors: [`Invalid JSON: ${(err as Error).message}`] });
        }
      }
    }
  };
  walk(dir);
  const loaded = validateAdventureSources(sources, db, registry, companions);
  return { adventures: loaded.adventures, problems: [...problems, ...loaded.problems] };
}
