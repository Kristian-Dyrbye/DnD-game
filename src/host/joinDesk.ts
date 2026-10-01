/**
 * The door to the table (co-op, C005): the host's 6-character join code and the seat tokens that let
 * a guest reclaim their seat after a reload. No Node imports (Web Crypto only), so the web edition's
 * peer transport (C009) can reuse it. Seats themselves live in the session's Table.
 */
import type { SeatId } from '../engine/session/table';

/** No 0/O, 1/I/L: a code read aloud over a call or typed off a phone screen. */
export const JOIN_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const JOIN_CODE_LENGTH = 6;

type RandomFill = (bytes: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>;
const cryptoFill: RandomFill = (bytes) => {
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
};

export function newJoinCode(fill: RandomFill = cryptoFill): string {
  const bytes = fill(new Uint8Array(JOIN_CODE_LENGTH));
  return [...bytes].map((b) => JOIN_CODE_ALPHABET[b % JOIN_CODE_ALPHABET.length]).join('');
}

/** Codes compare without case or surrounding spaces. */
export function sameCode(typed: string, code: string): boolean {
  return typed.trim().toUpperCase() === code.toUpperCase();
}

/** Random seat tokens (128 bits, hex). A seat has one live token: a new one replaces the old. */
export class SeatTokens {
  private bySeat = new Map<SeatId, string>();

  constructor(private readonly fill: RandomFill = cryptoFill) {}

  issue(seat: SeatId): string {
    const token = [...this.fill(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
    this.bySeat.set(seat, token);
    return token;
  }

  /** The seat a token belongs to (undefined for an unknown or replaced token). */
  seatOf(token: string | undefined): SeatId | undefined {
    if (!token) return undefined;
    for (const [seat, t] of this.bySeat) if (t === token) return seat;
    return undefined;
  }

  forget(seat: SeatId): void {
    this.bySeat.delete(seat);
  }
}
