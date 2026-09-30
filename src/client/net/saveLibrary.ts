/**
 * The save browser's view of stored games: list, delete, export and import. The local edition asks
 * the server's file store over REST; the web edition uses the in-page browser store (IndexedDB).
 * Saving and loading themselves are game commands (`save`/`load`) and go through the transport.
 */
import type { MemorySaves } from '../../host/memorySaves';
import { parseSaveText } from '../../engine/session/saveFile';
import type { SaveFile, SaveListEntry, SaveMeta } from '../../shared/save';

export interface SaveLibrary {
  /** Readable saves, newest first. */
  list(): Promise<SaveMeta[]>;
  remove(slot: string): Promise<void>;
  /** The whole save file (for Export save). */
  exportFile(slot: string): Promise<SaveFile>;
  /** Stores the text of an exported save as a new manual save. Throws with a readable message if invalid. */
  importText(text: string): Promise<SaveMeta>;
}

/** A fresh slot id for an imported save. */
export function importSlotId(now = Date.now()): string {
  return `import-${now.toString(36)}`;
}

function newestFirst(list: SaveListEntry[]): SaveMeta[] {
  return list.flatMap((e) => (e.ok ? [e.meta] : [])).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

async function errorOf(res: Response): Promise<Error> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return new Error(body.error ?? `Request failed (${res.status})`);
}

/** The local server's saves folder (/api/saves). */
export const serverSaveLibrary: SaveLibrary = {
  async list() {
    const res = await fetch('/api/saves');
    return res.ok ? newestFirst((await res.json()) as SaveListEntry[]) : [];
  },
  async remove(slot) {
    await fetch(`/api/saves/${slot}`, { method: 'DELETE' });
  },
  async exportFile(slot) {
    const res = await fetch(`/api/saves/${slot}`);
    if (!res.ok) throw await errorOf(res);
    return (await res.json()) as SaveFile;
  },
  async importText(text) {
    // Checked here too, so a broken file gets the same message in both editions.
    const file = parseSaveText(text);
    const res = await fetch(`/api/saves/${importSlotId()}/import`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(file) });
    if (!res.ok) throw await errorOf(res);
    return (await res.json()) as SaveMeta;
  },
};

/** The web edition's saves (the same MemorySaves the in-page game host writes to). */
export function browserSaveLibrary(saves: MemorySaves): SaveLibrary {
  return {
    async list() {
      return newestFirst(saves.list());
    },
    async remove(slot) {
      saves.delete(slot);
      await saves.flush();
    },
    async exportFile(slot) {
      return saves.file(slot);
    },
    async importText(text) {
      const meta = saves.importFile(parseSaveText(text), importSlotId());
      await saves.flush();
      return meta;
    },
  };
}

let current: SaveLibrary = serverSaveLibrary;

export function saveLibrary(): SaveLibrary {
  return current;
}

export function setSaveLibrary(lib: SaveLibrary): void {
  current = lib;
}

/** File name for an exported save: hero + date, safe on Windows. */
export function exportFileName(meta: SaveMeta): string {
  const hero = meta.characterName.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'hero';
  return `solo-dnd-${hero}-${meta.savedAt.slice(0, 10)}.json`;
}

/** Downloads a save file as .json (Export save). */
export function downloadSave(file: SaveFile): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = exportFileName(file.meta);
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
