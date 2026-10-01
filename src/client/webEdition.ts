/**
 * Switches the client to the web edition (no server): the game host runs in the page, saves go to
 * IndexedDB, settings to localStorage and the story is read aloud by the browser's speechSynthesis.
 * main.tsx calls it before the first render in the web build (Vite mode `web`). With co-op allowed
 * (settings.table.allowJoin) the page also keeps a PeerJS room open for a friend (C009b); a friend's
 * page (`?room=…&join=…`) starts with startWebGuest instead and plays the host's game over the room.
 */
import { effect } from '@preact/signals';
import { openBrowserSaves } from '../host/indexedDbSaves';
import type { MemorySaves } from '../host/memorySaves';
import { ttsPlayer, webSpeechEngine, type SpeechEngine } from './audio/ttsPlayer';
import { setTransport } from './net/gameSocket';
import { PeerTransport } from './net/peer';
import type { PeerFactory } from './net/peerjs';
import { browserSaveLibrary, setSaveLibrary } from './net/saveLibrary';
import { InPageTransport } from './net/transport';
import { roomSwitch, type RoomOpener } from './net/webRoom';
import { localSettingsBackend, setSettingsBackend, settings } from './ui/settingsState';

type Store = Pick<Storage, 'getItem' | 'setItem'>;

export async function startWebEdition(
  opts: { indexedDB?: IDBFactory; storage?: Store; speech?: SpeechEngine; openRoom?: RoomOpener } = {},
): Promise<{ transport: InPageTransport; saves: MemorySaves; persistent: boolean; room: ReturnType<typeof roomSwitch> }> {
  const { saves, persistent } = await openBrowserSaves(opts.indexedDB ?? globalThis.indexedDB);
  setSaveLibrary(browserSaveLibrary(saves));
  const storage = opts.storage ?? globalThis.localStorage;
  setSettingsBackend(localSettingsBackend(storage));
  ttsPlayer.useSpeech(opts.speech ?? webSpeechEngine());
  let room: ReturnType<typeof roomSwitch> | undefined;
  const transport = new InPageTransport(async () => (await import('../host/inPage')).createInPageHost({ saves, joinCode: () => room?.joinCode() }));
  room = roomSwitch({
    store: storage,
    open:
      opts.openRoom ??
      (async (roomId, onStatus) => (await import('./net/roomHost')).openHostRoom({ roomId, ready: () => transport.ready(), onStatus })),
  });
  setTransport(transport);
  // The room follows the Allow-join setting (also after a reload: the friend's link keeps working).
  const r = room;
  effect(() => void r.set(settings.value?.table.allowJoin ?? false));
  return { transport, saves, persistent, room };
}

/**
 * A friend's page in the web edition: no game of its own (no host, no saves), only the host's game over
 * the PeerJS room. Settings stay this browser's (voice, text size); the join code comes from `?join=`.
 */
export async function startWebGuest(roomId: string, opts: { storage?: Store; speech?: SpeechEngine; factory?: PeerFactory } = {}): Promise<PeerTransport> {
  setSettingsBackend(localSettingsBackend(opts.storage ?? globalThis.localStorage));
  ttsPlayer.useSpeech(opts.speech ?? webSpeechEngine());
  const { dialRoom } = await import('./net/peerjs');
  const transport = new PeerTransport(dialRoom(roomId, opts.factory ? { factory: opts.factory } : {}));
  setTransport(transport);
  return transport;
}
