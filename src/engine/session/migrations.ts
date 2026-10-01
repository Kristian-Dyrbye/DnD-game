/**
 * Save migrations. Each step upgrades a raw save object by exactly one schema version.
 * Loading runs every step from the file's version up to SAVE_SCHEMA_VERSION.
 * Rules: never delete a step; every step gets a fixture test; steps must be pure.
 *
 * How to add a version: bump SAVE_SCHEMA_VERSION in shared/version.ts, append
 * { from: N, to: N+1, migrate } here, and add a fixture test in migrations.test.ts.
 */
import { SAVE_SCHEMA_VERSION } from '../../shared/version';

// Raw saves are untyped JSON until the final version is validated.
type RawSave = Record<string, unknown>;

export interface Migration {
  from: number;
  to: number;
  description: string;
  migrate(save: RawSave): RawSave;
}

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationError';
  }
}

export const MIGRATIONS: Migration[] = [
  {
    from: 0,
    to: 1,
    description: 'Prototype format {version, savedAt, hero, state} → envelope {schemaVersion, meta, state}',
    migrate(save) {
      const hero = (save.hero ?? {}) as Record<string, unknown>;
      return {
        schemaVersion: 1,
        meta: {
          slotId: String(save.slot ?? 'imported'),
          kind: 'manual',
          name: String(save.slot ?? 'Imported save'),
          savedAt: String(save.savedAt ?? new Date(0).toISOString()),
          characterName: String(hero.name ?? 'Unknown hero'),
          level: Number(hero.level ?? 1),
          location: String(save.location ?? 'Unknown'),
          mode: save.hardcore === true ? 'hardcore' : 'heroic',
          playTimeMinutes: 0,
        },
        state: save.state ?? {},
      };
    },
  },
  {
    from: 1,
    to: 2,
    description: 'Co-op (C002): state.origins marks every existing companion as a roster companion',
    migrate(save) {
      const state = (save.state ?? {}) as Record<string, unknown>;
      const companions = Array.isArray(state.companions) ? (state.companions as { id?: unknown }[]) : [];
      const origins = { ...(state.origins as Record<string, string> | undefined) };
      for (const c of companions) if (typeof c.id === 'string' && !origins[c.id]) origins[c.id] = 'companion';
      return { ...save, state: { ...state, origins } };
    },
  },
];

/** Version of a raw save. Files without `schemaVersion` are the v0 prototype format. */
export function saveVersion(raw: RawSave): number {
  if (typeof raw.schemaVersion === 'number') return raw.schemaVersion;
  if (typeof raw.version === 'number') return raw.version;
  return 0;
}

export function migrateSave(
  input: unknown,
  migrations: Migration[] = MIGRATIONS,
  target: number = SAVE_SCHEMA_VERSION,
): { save: RawSave; fromVersion: number; applied: string[] } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new MigrationError('Save is not a JSON object');
  }
  let save = structuredClone(input) as RawSave;
  const fromVersion = saveVersion(save);
  if (fromVersion > target) {
    throw new MigrationError(`Save is from a newer game version (schema ${fromVersion} > ${target})`);
  }
  const applied: string[] = [];
  let version = fromVersion;
  while (version < target) {
    const step = migrations.find((m) => m.from === version);
    if (!step) throw new MigrationError(`No migration from schema ${version}`);
    save = step.migrate(save);
    save.schemaVersion = step.to;
    applied.push(`${step.from}→${step.to}`);
    version = step.to;
  }
  return { save, fromVersion, applied };
}
