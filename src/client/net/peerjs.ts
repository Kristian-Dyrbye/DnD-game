/**
 * PeerJS adapter for web co-op (C009b): turns PeerJS data connections into PeerChannels (peer.ts). The
 * public PeerJS broker (0.peerjs.com) only introduces the two pages (it sees their IP addresses and the
 * room id during the handshake); game data then flows page to page over WebRTC. The host page opens a
 * room under a fixed id, the guest page dials it. Loaded lazily (its own chunk), never by the title screen.
 * Written against the small RtcPeer/RtcConnection shapes below so tests can use a fake broker.
 */
import { Peer } from 'peerjs';
import type { PeerChannel } from './peer';

/** The parts of a PeerJS DataConnection used here. */
export interface RtcConnection {
  readonly open: boolean;
  send(data: string): unknown;
  close(opts?: { flush?: boolean }): void;
  on(event: string, fn: (arg?: unknown) => void): unknown;
}

/** The parts of a PeerJS Peer used here. */
export interface RtcPeer {
  readonly open: boolean;
  readonly destroyed: boolean;
  readonly disconnected: boolean;
  connect(id: string, opts: { reliable: boolean; serialization: string }): RtcConnection;
  reconnect(): void;
  destroy(): void;
  on(event: string, fn: (arg?: unknown) => void): unknown;
}

/** Makes a Peer (`id` undefined = the broker picks one). */
export type PeerFactory = (id?: string) => RtcPeer;

/** The real PeerJS on the public broker. */
export const pjsFactory: PeerFactory = (id) => (id ? new Peer(id) : new Peer()) as unknown as RtcPeer;

/** How the room looks from the host page: reaching the broker, open, broker unreachable, id in use (another tab), no WebRTC. */
export type RoomStatus = 'opening' | 'open' | 'down' | 'taken' | 'unsupported';

const errorType = (e: unknown): string => (typeof e === 'object' && e !== null && 'type' in e ? String((e as { type: unknown }).type) : '');

/** Wraps an open-or-opening data connection. Text messages only; close flushes queued messages first (the hang-up notice). */
export function channelOf(conn: RtcConnection): PeerChannel {
  let ended = false;
  return {
    send: (data) => void conn.send(data),
    close: () => conn.close({ flush: true }),
    isOpen: () => conn.open && !ended,
    on(h) {
      const end = () => {
        if (ended) return;
        ended = true;
        h.close();
      };
      conn.on('open', () => h.open());
      conn.on('data', (d) => typeof d === 'string' && h.message(d));
      conn.on('close', end);
      conn.on('error', () => {
        end();
        conn.close();
      });
    },
  };
}

export interface RoomHandle {
  close(): void;
}

/**
 * The host page's room: a Peer under `roomId` that hands every incoming connection to `onChannel`.
 * Losing the broker keeps the open channels (WebRTC is page to page) and tries to reconnect.
 */
export function openRoom(opts: {
  roomId: string;
  onChannel(ch: PeerChannel): void;
  onStatus(s: RoomStatus): void;
  factory?: PeerFactory;
  timers?: { setTimeout(fn: () => void, ms: number): unknown };
}): RoomHandle {
  const timers = opts.timers ?? globalThis;
  let closed = false;
  let peer: RtcPeer;
  try {
    peer = (opts.factory ?? pjsFactory)(opts.roomId);
  } catch {
    // PeerJS throws at once in a browser without WebRTC.
    opts.onStatus('unsupported');
    return { close: () => undefined };
  }
  opts.onStatus('opening');
  peer.on('open', () => !closed && opts.onStatus('open'));
  peer.on('connection', (conn) => {
    if (!closed) opts.onChannel(channelOf(conn as RtcConnection));
  });
  peer.on('disconnected', () => {
    if (closed || peer.destroyed) return;
    opts.onStatus('opening');
    timers.setTimeout(() => {
      if (!closed && !peer.destroyed && peer.disconnected) peer.reconnect();
    }, 3000);
  });
  peer.on('error', (e) => {
    if (closed) return;
    const type = errorType(e);
    if (type === 'unavailable-id') opts.onStatus('taken');
    else if (type === 'browser-incompatible') opts.onStatus('unsupported');
    else if (type !== 'peer-unavailable') opts.onStatus('down');
  });
  return {
    close() {
      closed = true;
      peer.destroy();
    },
  };
}

/**
 * The guest page's dialer for PeerTransport: every call opens a new channel to the host's room. One
 * guest Peer (id from the broker) is shared and made again if it was lost. A room that doesn't answer
 * (host page closed, broker down) closes the channel after `timeoutMs`, so the transport retries.
 */
export function dialRoom(roomId: string, opts: { factory?: PeerFactory; timeoutMs?: number; timers?: { setTimeout(fn: () => void, ms: number): unknown } } = {}): () => PeerChannel {
  const factory = opts.factory ?? pjsFactory;
  const timers = opts.timers ?? globalThis;
  const timeoutMs = opts.timeoutMs ?? 20_000;
  let peer: RtcPeer | undefined;
  /** Channels still waiting for the guest Peer to reach the broker / the room to answer. */
  const pending = new Set<() => void>();

  const guestPeer = (): RtcPeer => {
    if (peer && !peer.destroyed) return peer;
    const p = factory();
    peer = p;
    // The room isn't there, or the broker can't be reached: every waiting dial fails (and retries).
    // Anything but a missing room means this Peer lost the broker: drop it, the next dial makes a new one.
    p.on('error', (e) => {
      if (errorType(e) !== 'peer-unavailable' && !p.destroyed) p.destroy();
      for (const fail of [...pending]) fail();
    });
    p.on('disconnected', () => {
      if (!p.destroyed) p.destroy();
    });
    return p;
  };

  return () => {
    let handlers: Parameters<PeerChannel['on']>[0] | undefined;
    let ch: PeerChannel | undefined;
    let ended = false;
    const fail = () => {
      if (ended) return;
      ended = true;
      pending.delete(fail);
      ch?.close();
      handlers?.close();
    };
    const attach = (p: RtcPeer) => {
      if (ended) return;
      ch = channelOf(p.connect(roomId, { reliable: true, serialization: 'json' }));
      ch.on({
        open: () => {
          pending.delete(fail);
          handlers?.open();
        },
        message: (d) => handlers?.message(d),
        close: () => {
          if (ended) return;
          ended = true;
          pending.delete(fail);
          handlers?.close();
        },
      });
    };
    pending.add(fail);
    timers.setTimeout(() => pending.has(fail) && fail(), timeoutMs);
    try {
      const p = guestPeer();
      if (p.open) attach(p);
      else p.on('open', () => attach(p));
    } catch {
      // No WebRTC in this browser: fail after the transport has set its handlers.
      timers.setTimeout(fail, 0);
    }
    return {
      send: (data) => ch?.send(data),
      close: fail,
      isOpen: () => !ended && !!ch?.isOpen(),
      on(h) {
        handlers = h;
      },
    };
  };
}
