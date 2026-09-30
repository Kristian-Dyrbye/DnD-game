/**
 * Loads every adventure JSON under data/adventures/ (recursively) from disk and validates it with the
 * shared host loader (src/host/content.ts). Unparseable or invalid files are reported and skipped.
 */
import type { CompanionRoster } from '../engine/party/companions';
import fs from 'node:fs';
import path from 'node:path';
import type { SrdDatabase } from '../engine/data/srd';
import { FlagRegistry } from '../engine/world/flags';
import { validateAdventureSources, type AdventureSource, type LoadedAdventures } from '../host/content';

export type { LoadedAdventures } from '../host/content';

/** Loads the flag registry (data/adventures/flags.json) if present, plus every adventure's flag docs. */
export function loadFlagRegistry(dir: string): FlagRegistry {
  const file = path.join(dir, 'flags.json');
  return fs.existsSync(file) ? FlagRegistry.fromJson(JSON.parse(fs.readFileSync(file, 'utf8'))) : new FlagRegistry();
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
