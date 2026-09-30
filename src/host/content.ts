/**
 * Validates already-parsed adventure JSON into the adventures map. Shared by the server (files read
 * from disk) and the in-browser host (JSON bundled by Vite), so both editions load content the same way.
 * Invalid adventures are reported and skipped so one broken file never stops the game from starting.
 */
import type { Adventure } from '../engine/adventure/schema';
import { validateAdventure } from '../engine/adventure/validate';
import type { SrdDatabase } from '../engine/data/srd';
import type { FlagRegistry } from '../engine/world/flags';
import type { CompanionRoster } from '../engine/party/companions';

export interface LoadedAdventures {
  adventures: Map<string, Adventure>;
  problems: { file: string; errors: string[] }[];
}

/** One adventure source: a name for error messages plus the parsed JSON. */
export interface AdventureSource {
  file: string;
  raw: unknown;
}

/** True for JSON that looks like an adventure (flag registries and other data are skipped). */
export function isAdventureJson(raw: unknown): boolean {
  return !!raw && typeof raw === 'object' && 'formatVersion' in raw;
}

export function validateAdventureSources(sources: AdventureSource[], db?: SrdDatabase, registry?: FlagRegistry, companions?: CompanionRoster): LoadedAdventures {
  const adventures = new Map<string, Adventure>();
  const problems: LoadedAdventures['problems'] = [];
  for (const { file, raw } of sources) {
    if (!isAdventureJson(raw)) continue;
    const res = validateAdventure(raw, db, registry, companions);
    if (res.ok && res.adventure) {
      adventures.set(res.adventure.id, res.adventure);
      registry?.addDocs(res.adventure.flags);
    } else problems.push({ file, errors: res.errors });
  }
  return { adventures, problems };
}
