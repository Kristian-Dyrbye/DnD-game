/**
 * Switches the client to the web edition (no server): the game host runs in the page, saves go to
 * IndexedDB and settings to localStorage. Call before the first connect/loadSettings (A126 wires it
 * to the web build).
 */
import { openBrowserSaves } from '../host/indexedDbSaves';
import type { MemorySaves } from '../host/memorySaves';
import { setTransport } from './net/gameSocket';
import { browserSaveLibrary, setSaveLibrary } from './net/saveLibrary';
import { InPageTransport } from './net/transport';
import { localSettingsBackend, setSettingsBackend } from './ui/settingsState';

export async function startWebEdition(opts: { indexedDB?: IDBFactory; storage?: Pick<Storage, 'getItem' | 'setItem'> } = {}): Promise<{ transport: InPageTransport; saves: MemorySaves; persistent: boolean }> {
  const { saves, persistent } = await openBrowserSaves(opts.indexedDB ?? globalThis.indexedDB);
  setSaveLibrary(browserSaveLibrary(saves));
  setSettingsBackend(localSettingsBackend(opts.storage ?? globalThis.localStorage));
  const transport = new InPageTransport(async () => (await import('../host/inPage')).createInPageHost({ saves }));
  setTransport(transport);
  return { transport, saves, persistent };
}
