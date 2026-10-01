/**
 * The web edition's co-op room (C009b), host page side: while settings.table.allowJoin is on, the page
 * keeps a room open on the PeerJS broker (roomHost.ts, a lazy chunk) and guests join with the room link
 * `<site>?room=<id>&join=<code>`. Room id and join code are kept in localStorage so a reload of the
 * host page keeps the link the friend already has. This module stays tiny: it is in the title chunk.
 */
import { signal } from '@preact/signals';
import { newJoinCode } from '../../host/joinDesk';
import type { Seat, TablePolicy } from '../../engine/session/table';
import type { TableInfo } from './tableInfo';

/** From roomHost/peerjs: reaching the broker, open, broker unreachable, id in use (another tab), no WebRTC. */
export type RoomStatus = 'off' | 'opening' | 'open' | 'down' | 'taken' | 'unsupported';

export interface RoomState {
  status: RoomStatus;
  roomId?: string;
  code?: string;
}

/** The host page's room, read by the Table panel. */
export const webRoom = signal<RoomState>({ status: 'off' });

type RandomFill = (bytes: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>;
const cryptoFill: RandomFill = (bytes) => {
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
};

const ROOM_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** A fresh room id (`solo-dnd-` + 10 random letters/digits): the host page's address on the broker. */
export function newRoomId(fill: RandomFill = cryptoFill): string {
  return `solo-dnd-${[...fill(new Uint8Array(10))].map((b) => ROOM_ALPHABET[b % ROOM_ALPHABET.length]).join('')}`;
}

type Store = Pick<Storage, 'getItem' | 'setItem'>;
const KEY = 'solo-dnd.room';

/** The room id + join code this browser hosts under (made once, then reused across reloads). */
export function hostRoomIds(store: Store | undefined, fill: RandomFill = cryptoFill): { roomId: string; code: string } {
  try {
    const v = JSON.parse(store?.getItem(KEY) ?? 'null') as { roomId?: unknown; code?: unknown } | null;
    if (typeof v?.roomId === 'string' && /^solo-dnd-[a-z0-9]{10}$/.test(v.roomId) && typeof v.code === 'string' && /^[A-Z0-9]{4,12}$/.test(v.code)) return { roomId: v.roomId, code: v.code };
  } catch {
    // A broken entry: make a new room.
  }
  const ids = { roomId: newRoomId(fill), code: newJoinCode(fill) };
  try {
    store?.setItem(KEY, JSON.stringify(ids));
  } catch {
    // Private mode: the link changes on reload.
  }
  return ids;
}

/** The link a friend opens: this page's address with the room and join code (any old query/hash dropped). */
export function roomLink(href: string, roomId: string, code: string): string {
  const url = new URL(href);
  url.search = `?room=${encodeURIComponent(roomId)}&join=${encodeURIComponent(code)}`;
  url.hash = '';
  return url.toString();
}

/** The Table panel's door info in the web edition (no /api/table): from the room state. */
export function roomTableInfo(room: RoomState, allowJoin: boolean, href: string, seats: Seat[], policy: TablePolicy): TableInfo {
  const open = allowJoin && room.status === 'open' && !!room.roomId && !!room.code;
  return {
    allowJoin,
    lan: true,
    code: open ? room.code! : null,
    urls: open ? [roomLink(href, room.roomId!, room.code!)] : [],
    seats,
    policy,
    broker: allowJoin ? room.status : 'off',
  };
}

/** What opening a room needs (roomHost.ts in the app; a fake in tests). */
export type RoomOpener = (roomId: string, onStatus: (s: Exclude<RoomStatus, 'off'>) => void) => Promise<{ close(): void }>;

/**
 * Opens/closes the room as allowJoin turns on/off (calls are serialised: a quick off/on never leaves two
 * rooms). Returns the switch and the join code getter for the in-page host (undefined = door closed).
 */
export function roomSwitch(opts: { store?: Store; open: RoomOpener; fill?: RandomFill }): { set(on: boolean): Promise<void>; joinCode(): string | undefined } {
  let handle: { close(): void } | undefined;
  let chain = Promise.resolve();
  const set = (on: boolean): Promise<void> =>
    (chain = chain.then(async () => {
      if (on === !!handle) return;
      if (!on) {
        handle!.close();
        handle = undefined;
        webRoom.value = { status: 'off' };
        return;
      }
      const ids = hostRoomIds(opts.store, opts.fill);
      webRoom.value = { status: 'opening', ...ids };
      try {
        handle = await opts.open(ids.roomId, (status) => {
          if (handle || webRoom.peek().status !== 'off') webRoom.value = { status, ...ids };
        });
      } catch {
        webRoom.value = { status: 'down', ...ids };
      }
    }));
  return {
    set,
    joinCode: () => (handle && webRoom.peek().status !== 'off' ? webRoom.peek().code : undefined),
  };
}
