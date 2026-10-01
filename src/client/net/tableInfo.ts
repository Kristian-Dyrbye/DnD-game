/**
 * Co-op table helpers for the UI (C006b): the host's GET /api/table answer, who may be lent a companion,
 * and where a guest goes after sitting down. Pure (no DOM, no signals) so tests need no browser.
 */
import type { Character } from '../../engine/core/creature';
import type { Seat, TablePolicy } from '../../engine/session/table';

/** GET /api/table (local edition, host only). */
export interface TableInfo {
  allowJoin: boolean;
  /** The server listens on the network (decided at start: allowJoin turned on later needs a restart). */
  lan: boolean;
  code: string | null;
  urls: string[];
  seats: Seat[];
  policy: TablePolicy;
  /** Web edition (C009b): the room on the PeerJS broker (webRoom.ts RoomStatus); absent in the local edition. */
  broker?: 'off' | 'opening' | 'open' | 'down' | 'taken' | 'unsupported';
}

export async function fetchTable(fetchFn: typeof fetch = fetch): Promise<TableInfo> {
  const res = await fetchFn('/api/table');
  if (!res.ok) throw new Error(`table: HTTP ${res.status}`);
  return (await res.json()) as TableInfo;
}

/**
 * What the table panel says about the door: closed, open but needs a restart, open with links, or no
 * network found; in the web edition also reaching the broker, broker down, room open in another tab.
 */
export function doorState(info: Pick<TableInfo, 'allowJoin' | 'lan' | 'urls' | 'broker'>): 'closed' | 'restart' | 'open' | 'noNetwork' | 'connecting' | 'brokerDown' | 'roomTaken' {
  if (!info.allowJoin) return 'closed';
  if (info.broker) {
    if (info.broker === 'open') return info.urls.length ? 'open' : 'connecting';
    if (info.broker === 'down' || info.broker === 'unsupported') return 'brokerDown';
    if (info.broker === 'taken') return 'roomTaken';
    return 'connecting';
  }
  if (!info.lan) return 'restart';
  return info.urls.length ? 'open' : 'noNetwork';
}

/** Companion control values the host may pick: AI, the host, or a seated player (spectators play nobody). */
export function controlOptions(seats: readonly Seat[]): { value: string; seat?: Seat }[] {
  return [{ value: 'ai' }, { value: 'player' }, ...seats.filter((s) => s.role === 'player').map((s) => ({ value: `seat:${s.id}`, seat: s }))];
}

/** Roster companions the host may lend (player-made heroes belong to whoever built them). */
export function lendable(companions: readonly Character[], origins: Record<string, string>): Character[] {
  return companions.filter((c) => origins[c.id] !== 'hero');
}

/** Does `seat` already play a character (a guest's hero from an earlier visit)? */
export function seatHasCharacter(control: Record<string, string> | undefined, seat: string): boolean {
  return Object.values(control ?? {}).includes(`seat:${seat}`);
}

/** After `joined`: a player without a character builds one in the creator; spectators and returning players go to the game. */
export function afterJoin(role: 'player' | 'spectator', control: Record<string, string> | undefined, seat: string): 'creator' | 'game' {
  return role === 'player' && !seatHasCharacter(control, seat) ? 'creator' : 'game';
}
