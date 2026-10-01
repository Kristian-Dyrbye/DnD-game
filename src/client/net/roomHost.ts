/**
 * Opens the web edition's co-op room on the host page (C009b): a PeerJS room whose incoming channels go
 * through the table door of the page's own game host, exactly like LAN guests on the server's /ws.
 * Lazy chunk (with PeerJS); webEdition.ts loads it when allowJoin is turned on.
 */
import type { GameHost } from '../../host/gameHost';
import { tableDoor, type TableDoor } from '../../host/tableDoor';
import { admitPeer } from './peer';
import { openRoom, type PeerFactory, type RoomHandle, type RoomStatus } from './peerjs';

/** One door per game host, so a room closed and opened again still knows who sits where. */
const doors = new WeakMap<GameHost, TableDoor>();

export async function openHostRoom(opts: { roomId: string; ready(): Promise<GameHost>; onStatus(s: RoomStatus): void; factory?: PeerFactory }): Promise<RoomHandle> {
  const host = await opts.ready();
  const door = doors.get(host) ?? tableDoor(host);
  doors.set(host, door);
  return openRoom({
    roomId: opts.roomId,
    onStatus: opts.onStatus,
    onChannel: (ch) => void admitPeer(door, ch),
    ...(opts.factory && { factory: opts.factory }),
  });
}
