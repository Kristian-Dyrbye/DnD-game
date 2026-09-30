/**
 * Switches the client to the web edition (no server): the game host runs in the page, saves go to
 * IndexedDB, settings to localStorage and the story is read aloud by the browser's speechSynthesis.
 * main.tsx calls it before the first render in the web build (Vite mode `web`).
 */
import { openBrowserSaves } from '../host/indexedDbSaves';
import type { MemorySaves } from '../host/memorySaves';
import { ttsPlayer, webSpeechEngine, type SpeechEngine } from './audio/ttsPlayer';
import { setTransport } from './net/gameSocket';
import { browserSaveLibrary, setSaveLibrary } from './net/saveLibrary';
import { InPageTransport } from './net/transport';
import { localSettingsBackend, setSettingsBackend } from './ui/settingsState';

export async function startWebEdition(opts: { indexedDB?: IDBFactory; storage?: Pick<Storage, 'getItem' | 'setItem'>; speech?: SpeechEngine } = {}): Promise<{ transport: InPageTransport; saves: MemorySaves; persistent: boolean }> {
  const { saves, persistent } = await openBrowserSaves(opts.indexedDB ?? globalThis.indexedDB);
  setSaveLibrary(browserSaveLibrary(saves));
  setSettingsBackend(localSettingsBackend(opts.storage ?? globalThis.localStorage));
  ttsPlayer.useSpeech(opts.speech ?? webSpeechEngine());
  const transport = new InPageTransport(async () => (await import('../host/inPage')).createInPageHost({ saves }));
  setTransport(transport);
  return { transport, saves, persistent };
}
