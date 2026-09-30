/**
 * In-memory save slots for the in-browser host (same envelope, slot ids and 3 rotating autosaves as
 * the server's SaveStore). Stored as JSON text so a loaded game never shares objects with the save.
 * The web edition swaps this for a persistent browser store (A125).
 */
import type { SavePort } from '../engine/session/GameSession';
import { migrateSave } from '../engine/session/migrations';
import { SLOT_ID_PATTERN, SaveFileSchema, SaveMetaSchema, type SaveFile, type SaveListEntry, type SaveMeta } from '../shared/save';
import { SAVE_SCHEMA_VERSION } from '../shared/version';

export const MEMORY_AUTOSAVE_SLOTS = ['auto-1', 'auto-2', 'auto-3'] as const;

export class MemorySaves implements SavePort {
  private readonly files = new Map<string, string>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  save(slot: string, meta: Parameters<SavePort['save']>[1], state: unknown, kind: SaveMeta['kind'] = 'manual'): SaveMeta {
    if (!SLOT_ID_PATTERN.test(slot)) throw new Error(`Invalid slot id: ${slot}`);
    const full = SaveMetaSchema.parse({ ...meta, slotId: slot, kind, savedAt: this.now().toISOString() });
    const file: SaveFile = { schemaVersion: SAVE_SCHEMA_VERSION, meta: full, state };
    this.files.set(slot, JSON.stringify(file));
    return full;
  }

  autosave(meta: Parameters<SavePort['autosave']>[0], state: unknown): SaveMeta {
    for (let i = MEMORY_AUTOSAVE_SLOTS.length - 1; i > 0; i--) {
      const older = this.files.get(MEMORY_AUTOSAVE_SLOTS[i - 1]!);
      if (older) this.files.set(MEMORY_AUTOSAVE_SLOTS[i]!, older);
    }
    return this.save(MEMORY_AUTOSAVE_SLOTS[0], { ...meta, name: meta.name || 'Autosave' }, state, 'auto');
  }

  /** The full (migrated, validated) save file in a slot. Throws if missing or corrupt. */
  file(slot: string): SaveFile {
    const text = this.files.get(slot);
    if (text === undefined) throw new Error(`No save in slot ${slot}`);
    const parsed = SaveFileSchema.parse(migrateSave(JSON.parse(text)).save);
    return { ...parsed, meta: { ...parsed.meta, slotId: slot } };
  }

  load(slot: string): unknown {
    return this.file(slot).state;
  }

  list(): SaveListEntry[] {
    return [...this.files.keys()]
      .map((slot): SaveListEntry => {
        try {
          const f = this.file(slot);
          return { ok: true, meta: f.meta, schemaVersion: f.schemaVersion };
        } catch (err) {
          return { ok: false, slotId: slot, error: (err as Error).message };
        }
      })
      .sort((a, b) => (a.ok && b.ok ? b.meta.savedAt.localeCompare(a.meta.savedAt) : a.ok ? -1 : b.ok ? 1 : 0));
  }

  delete(slot: string): void {
    this.files.delete(slot);
  }
}
