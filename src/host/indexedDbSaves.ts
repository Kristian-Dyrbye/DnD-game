/**
 * Web edition saves in the browser's IndexedDB (one object store: slot → save file JSON text).
 * openBrowserSaves() falls back to memory-only saves when IndexedDB is missing or refused
 * (e.g. some private windows), so the game always starts.
 */
import { MemorySaves, type MemorySavesOptions, type SaveBackend } from './memorySaves';

export const SAVES_DB = 'solo-dnd';
const STORE = 'saves';

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

function openDb(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(name, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Could not open IndexedDB'));
    req.onblocked = () => reject(new Error('IndexedDB is blocked by another tab'));
  });
}

/** A SaveBackend over one IndexedDB database. */
export async function indexedDbBackend(factory: IDBFactory, name = SAVES_DB): Promise<SaveBackend> {
  const db = await openDb(factory, name);
  const store = (mode: IDBTransactionMode) => db.transaction(STORE, mode).objectStore(STORE);
  return {
    async readAll() {
      const s = store('readonly');
      const [keys, values] = await Promise.all([request(s.getAllKeys()), request(s.getAll())]);
      return keys.flatMap((k, i): Array<[string, string]> => (typeof k === 'string' && typeof values[i] === 'string' ? [[k, values[i] as string]] : []));
    },
    async write(slot, text) {
      await request(store('readwrite').put(text, slot));
    },
    async remove(slot) {
      await request(store('readwrite').delete(slot));
    },
  };
}

/** Save slots kept in IndexedDB; memory-only (with a warning) if the browser refuses storage. */
export async function openBrowserSaves(factory: IDBFactory | undefined = globalThis.indexedDB, opts: Omit<MemorySavesOptions, 'backend'> & { name?: string } = {}): Promise<{ saves: MemorySaves; persistent: boolean }> {
  const { name, ...rest } = opts;
  if (factory) {
    try {
      return { saves: await MemorySaves.open(await indexedDbBackend(factory, name), rest), persistent: true };
    } catch (err) {
      console.warn('Browser storage is unavailable; saves last until the page closes.', err);
    }
  }
  return { saves: new MemorySaves(rest), persistent: false };
}
