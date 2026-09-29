/**
 * Loads every adventure JSON under data/adventures/ (recursively), validating each one. Invalid
 * files are reported and skipped so one broken adventure never stops the game from starting.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Adventure } from '../engine/adventure/schema';
import { validateAdventure } from '../engine/adventure/validate';
import type { SrdDatabase } from '../engine/data/srd';
import { FlagRegistry } from '../engine/world/flags';

export interface LoadedAdventures {
  adventures: Map<string, Adventure>;
  problems: { file: string; errors: string[] }[];
}

/** Loads the flag registry (data/adventures/flags.json) if present, plus every adventure's flag docs. */
export function loadFlagRegistry(dir: string): FlagRegistry {
  const file = path.join(dir, 'flags.json');
  return fs.existsSync(file) ? FlagRegistry.fromJson(JSON.parse(fs.readFileSync(file, 'utf8'))) : new FlagRegistry();
}

export function loadAdventures(dir: string, db?: SrdDatabase, registry?: FlagRegistry): LoadedAdventures {
  const adventures = new Map<string, Adventure>();
  const problems: LoadedAdventures['problems'] = [];
  const walk = (d: string) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.json')) {
        let raw: unknown;
        try {
          raw = JSON.parse(fs.readFileSync(full, 'utf8'));
        } catch (err) {
          problems.push({ file: full, errors: [`Invalid JSON: ${(err as Error).message}`] });
          continue;
        }
        // Only files that look like adventures (other JSON such as flag registries is skipped).
        if (!raw || typeof raw !== 'object' || !('formatVersion' in raw)) continue;
        const res = validateAdventure(raw, db, registry);
        if (res.ok && res.adventure) {
          adventures.set(res.adventure.id, res.adventure);
          registry?.addDocs(res.adventure.flags);
        } else problems.push({ file: full, errors: res.errors });
      }
    }
  };
  walk(dir);
  return { adventures, problems };
}
