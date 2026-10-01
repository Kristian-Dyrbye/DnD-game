/**
 * How the client reaches the game: over a WebSocket to the local server (default edition), or
 * in-page, running the game host inside the browser (web edition). Both speak the same
 * ClientCommand/ServerEvent protocol, and events always arrive as fresh JSON copies.
 */
import type { ClientCommand, ServerEvent } from '../../shared/protocol';
import type { GameHost } from '../../host/gameHost';

export type Connection = 'connecting' | 'open' | 'closed';

/** Close codes after which a page must not reconnect: 4001 = a newer page took the seat over, 1008 = refused (origin, too many wrong codes). */
export const FINAL_CLOSE_CODES: readonly number[] = [4001, 1008];

export interface TransportHandlers {
  onEvent(e: ServerEvent): void;
  onStatus(s: Connection): void;
  /** Commands to send first after a (re)connect, before queued ones (e.g. get_state after a reconnect). */
  onOpen?(): ClientCommand[];
}

export interface Transport {
  /** Starts connecting (idempotent). */
  connect(handlers: TransportHandlers): void;
  /** Sends a command; commands sent before the connection is open wait in an outbox. */
  send(cmd: ClientCommand): void;
}

/** The local server's /ws game channel; reconnects with backoff. `guest` = a co-op guest page (C006): never the host's seat, even on the host's PC. */
export class WebSocketTransport implements Transport {
  private ws: WebSocket | null = null;
  private retry = 0;
  private readonly outbox: string[] = [];

  constructor(private readonly guest = false) {}

  connect(handlers: TransportHandlers): void {
    if (this.ws || typeof WebSocket === 'undefined') return;
    handlers.onStatus('connecting');
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const sock = new WebSocket(`${proto}://${location.host}/ws${this.guest ? '?guest' : ''}`);
    this.ws = sock;
    sock.onopen = () => {
      handlers.onStatus('open');
      this.retry = 0;
      for (const cmd of handlers.onOpen?.() ?? []) sock.send(JSON.stringify(cmd));
      while (this.outbox.length) sock.send(this.outbox.shift()!);
    };
    sock.onmessage = (m) => {
      try {
        handlers.onEvent(JSON.parse(String(m.data)) as ServerEvent);
      } catch {
        // Ignore malformed server messages.
      }
    };
    sock.onclose = (ev) => {
      this.ws = null;
      handlers.onStatus('closed');
      if (FINAL_CLOSE_CODES.includes(ev.code)) return;
      const delay = Math.min(10_000, 500 * 2 ** this.retry++);
      setTimeout(() => this.connect(handlers), delay);
    };
  }

  send(cmd: ClientCommand): void {
    const raw = JSON.stringify(cmd);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(raw);
    else this.outbox.push(raw);
  }
}

/** Runs the game host in the page. The host module (engine + bundled adventures) loads lazily. */
export class InPageTransport implements Transport {
  private host: GameHost | undefined;
  private starting = false;
  private readonly outbox: string[] = [];
  private readonly waiting: ((host: GameHost) => void)[] = [];

  /** `load` creates the host; the default imports the web edition's host (a separate chunk). */
  constructor(private readonly load: () => Promise<GameHost> = async () => (await import('../../host/inPage')).createInPageHost()) {}

  connect(handlers: TransportHandlers): void {
    if (this.host || this.starting) return;
    this.starting = true;
    handlers.onStatus('connecting');
    this.load().then(
      (host) => {
        this.host = host;
        // A JSON round trip, like the WebSocket: the UI never shares objects with the live game state.
        // Errors caused by another connection (a co-op guest's peer channel, C009) are that page's business.
        host.on((e, from) => from === undefined && handlers.onEvent(JSON.parse(JSON.stringify(e)) as ServerEvent));
        handlers.onStatus('open');
        for (const cmd of handlers.onOpen?.() ?? []) this.deliver(JSON.stringify(cmd));
        while (this.outbox.length) this.deliver(this.outbox.shift()!);
        for (const resolve of this.waiting.splice(0)) resolve(host);
      },
      (err: unknown) => {
        this.starting = false;
        handlers.onStatus('closed');
        handlers.onEvent({ type: 'error', message: `The game failed to start: ${err instanceof Error ? err.message : String(err)}` });
      },
    );
  }

  send(cmd: ClientCommand): void {
    const raw = JSON.stringify(cmd);
    if (this.host) this.deliver(raw);
    else this.outbox.push(raw);
  }

  /** The running host once it has started (web co-op lets guests' peer channels in to it, C009). */
  ready(): Promise<GameHost> {
    return this.host ? Promise.resolve(this.host) : new Promise((resolve) => this.waiting.push(resolve));
  }

  /** Waits for everything sent so far (tests). */
  async idle(): Promise<void> {
    await this.host?.idle();
  }

  private deliver(raw: string): void {
    const err = this.host!.receive(raw);
    if (err) this.host!.session.emit(err);
  }
}
