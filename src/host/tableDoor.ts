/**
 * The table's door (co-op, C009): what one connection to the host may do and see, for any transport —
 * the server's WebSocket (/ws) and the web edition's peer channels share it, so the seat rules match.
 * A connection with a seat sends commands as that seat and receives the game's events (errors only when
 * it caused them, C008b); one without a seat may only ping and `join` with the code. A guest who drops
 * out is marked away (the AI plays their hero) until a connection reclaims the seat with its token.
 * No Node imports.
 */
import { HOST_SEAT, seatOf, type SeatId } from '../engine/session/table';
import { parseCommand, type ServerEvent } from '../shared/protocol';
import type { GameHost } from './gameHost';

/** One connection as the door sees it. */
export interface DoorLine {
  send(e: ServerEvent): void;
  /** Hangs up (4001 = seat taken over by a newer connection, 1008 = too many wrong codes). */
  close(code: number, reason: string): void;
  isOpen(): boolean;
}

export interface DoorConnection {
  /** A raw protocol message from this connection. */
  receive(raw: string): void;
  /** The connection closed. */
  closed(): void;
  /** The seat it plays now (undefined until it joins, or after it was released). */
  readonly seat: SeatId | undefined;
}

export interface TableDoor {
  /** A new connection; `seat` = a seat it already holds (the host's own page), else it must join. */
  open(line: DoorLine, seat?: SeatId): DoorConnection;
}

/** Wrong join codes before the door hangs up (guessing codes). */
export const MAX_FAILED_JOINS = 5;

export function tableDoor(host: GameHost): TableDoor {
  const { session } = host;
  // The live connection of each guest seat: a reload that reclaims the seat replaces the old one.
  const seated = new Map<SeatId, DoorLine>();
  return {
    open(line, initial) {
      let seat: SeatId | undefined;
      let off: (() => void) | undefined;
      let joins: Promise<void> = Promise.resolve();
      let failedJoins = 0;
      const unseat = (): void => {
        off?.();
        off = undefined;
        if (seat && seated.get(seat) === line) seated.delete(seat);
        seat = undefined;
      };
      const sit = (id: SeatId): void => {
        seat = id;
        if (id !== HOST_SEAT) {
          const before = seated.get(id);
          seated.set(id, line);
          if (before && before !== line) before.close(4001, 'Seat taken over');
        }
        off = host.on((e, from) => {
          // A refused or failed command is the sender's business only (C008b).
          if (from !== undefined && from !== line) return;
          line.send(e);
          // Released (by themselves or the host): the connection stays, without a seat, until it joins again.
          if (e.type === 'table' && seat && !seatOf(session.table, seat)) unseat();
        });
      };
      if (initial) {
        sit(initial);
        // A guest who drops out leaves their characters to the AI until they are back (C003).
        if (initial !== HOST_SEAT) void host.setSeatAway(initial, false);
      }
      return {
        get seat() {
          return seat;
        },
        closed() {
          const left = seat !== undefined && seat !== HOST_SEAT && seated.get(seat) === line ? seat : undefined;
          unseat();
          if (left) void host.setSeatAway(left, true);
        },
        receive(raw) {
          const parsed = parseCommand(raw);
          if (!parsed.ok) return line.send({ type: 'error', message: parsed.error, ...(parsed.reqId && { reqId: parsed.reqId }) });
          const cmd = parsed.command;
          const reqId = cmd.reqId ? { reqId: cmd.reqId } : {};
          if (seat) {
            if (cmd.type === 'join') return line.send({ type: 'error', message: session.msgs.m('table.alreadySeated'), ...reqId });
            void host.send(cmd, seat, line);
            return;
          }
          // No seat yet: only ping and join; the game's events start once seated.
          if (cmd.type === 'ping') return line.send({ type: 'pong', ...reqId });
          if (cmd.type !== 'join') return line.send({ type: 'error', message: session.msgs.m('table.noSeat'), ...reqId });
          // One join at a time per connection (a second one waits and finds the seat taken).
          joins = joins.then(async () => {
            if (seat) return line.send({ type: 'error', message: session.msgs.m('table.alreadySeated'), ...reqId });
            if (!line.isOpen()) return;
            const res = await host.join(cmd);
            if (!res.ok) {
              line.send({ type: 'error', message: res.message, ...reqId });
              if (++failedJoins >= MAX_FAILED_JOINS) line.close(1008, 'Too many join attempts');
              return;
            }
            if (!line.isOpen()) {
              void host.setSeatAway(res.seat, true);
              return;
            }
            sit(res.seat);
            line.send({ type: 'joined', seat: res.seat, role: res.role, token: res.token });
            line.send({ type: 'table', seats: structuredClone(session.table.seats), policy: session.table.policy });
            if (session.running) line.send(session.snapshot());
          });
        },
      };
    },
  };
}
