/**
 * Co-op guest page (C006): a page opened from the host's join link (`?join=CODE`). It sits down with
 * `join` on every (re)connect, keeps its seat token in localStorage so a reload reclaims the seat, and
 * never sends the host-only `set_language` (one language per table: the host's). Pure helpers; the
 * storage is passed in so tests need no browser.
 */
import type { ClientCommand } from '../../shared/protocol';
import type { Language } from '../../shared/i18nCore';

/** Key/value storage (localStorage or a test stand-in). */
export interface SeatStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** The join code from a page's query string (`?join=ab3k9x` → `AB3K9X`), or null for a normal page. */
export function joinCodeFrom(search: string): string | null {
  const code = new URLSearchParams(search).get('join')?.trim().toUpperCase();
  return code && /^[A-Z0-9]{4,12}$/.test(code) ? code : null;
}

const KEY = 'solo-dnd.seat';

interface Stored {
  code: string;
  token: string;
  name?: string;
}

function read(store: SeatStore | undefined): Stored | undefined {
  try {
    const raw = store?.getItem(KEY);
    const v = raw ? (JSON.parse(raw) as Partial<Stored>) : undefined;
    return typeof v?.code === 'string' && typeof v.token === 'string' ? (v as Stored) : undefined;
  } catch {
    return undefined;
  }
}

/** The token that reclaims this browser's seat at the table with `code` (a token for another code is stale). */
export function seatToken(store: SeatStore | undefined, code: string): string | undefined {
  const v = read(store);
  return v?.code === code ? v.token : undefined;
}

/** The player name this browser joined with last (any table). */
export function seatName(store: SeatStore | undefined): string | undefined {
  return read(store)?.name;
}

/** Remembers the seat token (after `joined`) and the player's name. */
export function rememberSeat(store: SeatStore | undefined, code: string, token: string, name?: string): void {
  try {
    store?.setItem(KEY, JSON.stringify({ code, token, ...(name && { name }) }));
  } catch {
    // Private mode / full storage: the seat just won't survive a reload.
  }
}

/** Forgets the seat (after leaving the table): the next join takes a new one. */
export function forgetSeat(store: SeatStore | undefined): void {
  try {
    store?.removeItem(KEY);
  } catch {
    // ignore
  }
}

/**
 * Commands to send when the connection opens. A guest joins (with its token after a reload; the join
 * answer brings the snapshot); the host sets its language and asks for a fresh snapshot after a reconnect.
 */
export function openCommands(opts: { code: string | null; store?: SeatStore; name?: string; role?: 'player' | 'spectator'; language: Language; hasState: boolean }): ClientCommand[] {
  if (opts.code) {
    const token = seatToken(opts.store, opts.code);
    const name = opts.name ?? seatName(opts.store);
    return [{ type: 'join', code: opts.code, ...(opts.role && { role: opts.role }), ...(name && { name }), ...(token && { token }) }];
  }
  return [{ type: 'set_language', language: opts.language }, ...(opts.hasState ? [{ type: 'get_state' } as const] : [])];
}
