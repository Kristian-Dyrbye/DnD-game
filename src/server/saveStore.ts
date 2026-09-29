/**
 * Save files on disk: saves/<slotId>.json. Writes are atomic (temp file + rename), loads run
 * migrations, and corrupt files are reported rather than crashing the save browser.
 * Autosaves rotate through AUTOSAVE_SLOTS so one bad autosave never loses everything.
 */
import fs from 'node:fs';
import path from 'node:path';
import { migrateSave } from '../engine/session/migrations';
import {
  SLOT_ID_PATTERN,
  SaveFileSchema,
  SaveMetaSchema,
  type SaveFile,
  type SaveListEntry,
  type SaveMeta,
} from '../shared/save';
import { SAVE_SCHEMA_VERSION } from '../shared/version';

export const AUTOSAVE_SLOTS = ['auto-1', 'auto-2', 'auto-3'] as const;

export class SaveError extends Error {
  constructor(
    readonly kind: 'invalid_slot' | 'not_found' | 'corrupt' | 'invalid',
    message: string,
  ) {
    super(message);
    this.name = 'SaveError';
  }
}

export type SaveMetaInput = Omit<SaveMeta, 'slotId' | 'savedAt' | 'kind' | 'playTimeMinutes'> &
  Partial<Pick<SaveMeta, 'playTimeMinutes'>>;

export class SaveStore {
  constructor(
    private readonly dir: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  list(): SaveListEntry[] {
    let files: string[];
    try {
      files = fs.readdirSync(this.dir).filter((f) => f.endsWith('.json'));
    } catch {
      return [];
    }
    const entries = files.map((f): SaveListEntry => {
      const slotId = f.slice(0, -'.json'.length);
      try {
        const save = this.load(slotId);
        return { ok: true, meta: save.meta, schemaVersion: save.schemaVersion };
      } catch (err) {
        return { ok: false, slotId, error: (err as Error).message };
      }
    });
    // Newest first; corrupt entries last.
    return entries.sort((a, b) => {
      if (a.ok && b.ok) return b.meta.savedAt.localeCompare(a.meta.savedAt);
      return a.ok ? -1 : b.ok ? 1 : 0;
    });
  }

  load(slotId: string): SaveFile {
    const file = this.fileFor(slotId);
    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new SaveError('not_found', `No save in slot ${slotId}`);
      throw new SaveError('corrupt', `Save ${slotId} is not valid JSON`);
    }
    let migrated;
    try {
      migrated = migrateSave(raw).save;
    } catch (err) {
      throw new SaveError('corrupt', (err as Error).message);
    }
    const parsed = SaveFileSchema.safeParse(migrated);
    if (!parsed.success) throw new SaveError('corrupt', `Save ${slotId} failed validation: ${parsed.error.issues[0]?.message}`);
    // The slot is where the file lives, even if an imported file says otherwise.
    return { ...parsed.data, meta: { ...parsed.data.meta, slotId } };
  }

  save(slotId: string, meta: SaveMetaInput, state: unknown, kind: SaveMeta['kind'] = 'manual'): SaveFile {
    const file = this.fileFor(slotId);
    const fullMeta = SaveMetaSchema.safeParse({ ...meta, slotId, kind, savedAt: this.now().toISOString() });
    if (!fullMeta.success) throw new SaveError('invalid', fullMeta.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
    const saveFile: SaveFile = { schemaVersion: SAVE_SCHEMA_VERSION, meta: fullMeta.data, state };
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(saveFile), 'utf8');
    fs.renameSync(tmp, file);
    return saveFile;
  }

  /** Writes a new autosave, shifting older ones down (auto-1 is always the newest). */
  autosave(meta: SaveMetaInput, state: unknown): SaveFile {
    for (let i = AUTOSAVE_SLOTS.length - 1; i > 0; i--) {
      const from = this.fileFor(AUTOSAVE_SLOTS[i - 1]!);
      if (fs.existsSync(from)) fs.copyFileSync(from, this.fileFor(AUTOSAVE_SLOTS[i]!));
    }
    return this.save(AUTOSAVE_SLOTS[0], { ...meta, name: meta.name || 'Autosave' }, state, 'auto');
  }

  delete(slotId: string): void {
    try {
      fs.unlinkSync(this.fileFor(slotId));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new SaveError('not_found', `No save in slot ${slotId}`);
      throw err;
    }
  }

  private fileFor(slotId: string): string {
    if (!SLOT_ID_PATTERN.test(slotId)) throw new SaveError('invalid_slot', `Invalid slot id: ${slotId}`);
    return path.join(this.dir, `${slotId}.json`);
  }
}
