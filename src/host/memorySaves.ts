/**
 * Save slots for the in-browser host (same envelope, slot ids and 3 rotating autosaves as the
 * server's SaveStore). Stored as JSON text so a loaded game never shares objects with the save.
 * The session's SavePort is synchronous, so slots live in memory; with a SaveBackend (IndexedDB in
 * the web edition) they are read once when opened and every change is written through in order.
 */
import type { SavePort } from '../engine/session/GameSession';
import { migrateSave } from '../engine/session/migrations';
import { parseSaveFile } from '../engine/session/saveFile';
import { SLOT_ID_PATTERN, SaveFileSchema, SaveMetaSchema, type SaveFile, type SaveListEntry, type SaveMeta } from '../shared/save';
import { SAVE_SCHEMA_VERSION } from '../shared/version';

export const MEMORY_AUTOSAVE_SLOTS = ['auto-1', 'auto-2', 'auto-3'] as const;

/** Persistent storage behind MemorySaves: slot → save file JSON text. */
export interface SaveBackend {
  readAll(): Promise<Array<[slot: string, text: string]>>;
  write(slot: string, text: string): Promise<void>;
  remove(slot: string): Promise<void>;
}

export interface MemorySavesOptions {
  now?: () => Date;
  backend?: SaveBackend;
  /** A write to the backend failed (quota, private mode…). Default: console.warn. */
  onError?: (err: unknown) => void;
}

export class MemorySaves implements SavePort {
  private readonly files = new Map<string, string>();
  private readonly now: () => Date;
  private pending: Promise<void> = Promise.resolve();

  constructor(private readonly opts: MemorySavesOptions = {}) {
    this.now = opts.now ?? (() => new Date());
  }

  /** Opens saves kept in a backend (reads every slot once). */
  static async open(backend: SaveBackend, opts: Omit<MemorySavesOptions, 'backend'> = {}): Promise<MemorySaves> {
    const saves = new MemorySaves({ ...opts, backend });
    for (const [slot, text] of await backend.readAll()) if (SLOT_ID_PATTERN.test(slot)) saves.files.set(slot, text);
    return saves;
  }

  save(slot: string, meta: Parameters<SavePort['save']>[1], state: unknown, kind: SaveMeta['kind'] = 'manual'): SaveMeta {
    if (!SLOT_ID_PATTERN.test(slot)) throw new Error(`Invalid slot id: ${slot}`);
    const full = SaveMetaSchema.parse({ ...meta, slotId: slot, kind, savedAt: this.now().toISOString() });
    const file: SaveFile = { schemaVersion: SAVE_SCHEMA_VERSION, meta: full, state };
    this.put(slot, JSON.stringify(file));
    return full;
  }

  autosave(meta: Parameters<SavePort['autosave']>[0], state: unknown): SaveMeta {
    for (let i = MEMORY_AUTOSAVE_SLOTS.length - 1; i > 0; i--) {
      const older = this.files.get(MEMORY_AUTOSAVE_SLOTS[i - 1]!);
      if (older) this.put(MEMORY_AUTOSAVE_SLOTS[i]!, older);
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
    if (!this.files.delete(slot)) throw new Error(`No save in slot ${slot}`);
    this.persist((b) => b.remove(slot));
  }

  /** Stores an exported save file (validated, migrated) as a new manual save in `slot`. */
  importFile(raw: unknown, slot: string): SaveMeta {
    const file = parseSaveFile(raw);
    return this.save(slot, file.meta, file.state, 'manual');
  }

  /** Resolves when every change so far has reached the backend. */
  flush(): Promise<void> {
    return this.pending;
  }

  private put(slot: string, text: string): void {
    this.files.set(slot, text);
    this.persist((b) => b.write(slot, text));
  }

  /** Backend writes run one after another in call order; a failure never stops play. */
  private persist(op: (b: SaveBackend) => Promise<void>): void {
    const backend = this.opts.backend;
    if (!backend) return;
    const onError = this.opts.onError ?? ((err: unknown) => console.warn('Could not store the save in the browser:', err));
    this.pending = this.pending.then(() => op(backend)).catch(onError);
  }
}
