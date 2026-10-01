/**
 * Web edition co-op (C009): the friend's page reaches the host's page over a peer channel (a WebRTC
 * data channel; the public PeerJS broker only introduces the two pages, see peerjs.ts). The channel
 * carries the same ClientCommand/ServerEvent JSON as the server's /ws, and the host page lets each
 * channel in through the same table door (host/tableDoor.ts), so seats, join codes, tokens and away
 * marks work exactly as in the desktop edition. No browser APIs here: tests use a fake channel pair.
 */
import type { ClientCommand, ServerEvent } from '../../shared/protocol';
import type { DoorConnection, TableDoor } from '../../host/tableDoor';
import { FINAL_CLOSE_CODES, type Transport, type TransportHandlers } from './transport';

/** One message pipe to the other page. Handlers are set once, right after the channel is made. */
export interface PeerChannel {
  send(data: string): void;
  close(): void;
  isOpen(): boolean;
  on(handlers: { open(): void; message(data: string): void; close(): void }): void;
}

/**
 * A hang-up notice the host sends before closing a channel (a data channel has no close codes):
 * 4001 = the seat was taken over by a newer page, 1008 = too many wrong join codes. The guest then
 * stops reconnecting, or two tabs of one player would take the seat from each other forever.
 */
export interface HangUp {
  hangUp: { code: number; reason: string };
}

const isHangUp = (v: unknown): v is HangUp => typeof v === 'object' && v !== null && 'hangUp' in v;

/** The guest page's transport: dials the host's room, reconnects with backoff, rejoins via onOpen. */
export class PeerTransport implements Transport {
  private channel: PeerChannel | null = null;
  private retry = 0;
  private stopped = false;
  private readonly outbox: string[] = [];

  /** `dial` opens a new channel to the host's room (peerjs.ts, or a test pair). */
  constructor(
    private readonly dial: () => PeerChannel,
    private readonly timers: { setTimeout(fn: () => void, ms: number): unknown } = globalThis,
  ) {}

  connect(handlers: TransportHandlers): void {
    if (this.channel || this.stopped) return;
    handlers.onStatus('connecting');
    const ch = this.dial();
    this.channel = ch;
    ch.on({
      open: () => {
        this.retry = 0;
        handlers.onStatus('open');
        for (const cmd of handlers.onOpen?.() ?? []) ch.send(JSON.stringify(cmd));
        while (this.outbox.length) ch.send(this.outbox.shift()!);
      },
      message: (data) => {
        try {
          const msg = JSON.parse(data) as unknown;
          if (isHangUp(msg)) {
            if (FINAL_CLOSE_CODES.includes(msg.hangUp.code)) this.stopped = true;
            return;
          }
          handlers.onEvent(msg as ServerEvent);
        } catch {
          // Ignore malformed messages.
        }
      },
      close: () => {
        if (this.channel !== ch) return;
        this.channel = null;
        handlers.onStatus('closed');
        if (this.stopped) return;
        // A room that never answered counts as a failed try too.
        const delay = Math.min(10_000, 500 * 2 ** this.retry++);
        this.timers.setTimeout(() => this.connect(handlers), delay);
      },
    });
  }

  send(cmd: ClientCommand): void {
    const raw = JSON.stringify(cmd);
    if (this.channel?.isOpen()) this.channel.send(raw);
    else this.outbox.push(raw);
  }

  /** The host hung up for good (seat taken over by another page, or too many wrong codes). */
  get hungUp(): boolean {
    return this.stopped;
  }

  /** Stops dialing (the guest left the table). */
  disconnect(): void {
    this.stopped = true;
    this.channel?.close();
  }
}

/**
 * The host page's side: lets a guest's channel in through the table door. Every channel starts
 * without a seat (it must `join` with the code); events go out as JSON, the hang-up notice before a
 * forced close. Returns the door connection (tests read its seat).
 */
export function admitPeer(door: TableDoor, ch: PeerChannel): DoorConnection {
  let ended = false;
  const conn = door.open({
    send: (e) => {
      if (ch.isOpen()) ch.send(JSON.stringify(e));
    },
    close: (code, reason) => {
      if (ch.isOpen()) ch.send(JSON.stringify({ hangUp: { code, reason } } satisfies HangUp));
      ch.close();
    },
    isOpen: () => !ended && ch.isOpen(),
  });
  ch.on({
    open: () => undefined,
    message: (data) => conn.receive(data),
    close: () => {
      ended = true;
      conn.closed();
    },
  });
  return conn;
}
