/**
 * The table (co-op, C001): who sits at the game and what each seat may send. A seat is a player —
 * `host` (the PC running the game) or `guest-<n>` (a friend, or a spectator with no characters).
 * Seats live in session memory, never in saves: a save remembers characters, not who played them.
 * Character ownership is derived from companion control (`seat:<id>`, see party/companions.ts), so
 * there is one source of truth. Solo play is a table with only the host seat, where everything is allowed.
 */
import type { ClientCommand } from '../../shared/protocol';
import { currentId } from '../combat/turns';
import type { Encounter } from '../combat/encounter';
import type { GameState } from './gameState';

export type SeatId = string;
export const HOST_SEAT: SeatId = 'host';
export const SEAT_ID_PATTERN = /^(host|guest-[1-9][0-9]?)$/;

/** host_decides: only the host acts in the story, guests propose. anyone: every player seat may act. */
export type TablePolicy = 'host_decides' | 'anyone';

export interface Seat {
  id: SeatId;
  role: 'host' | 'player' | 'spectator';
  /** Display name (the player's, not the character's). */
  name?: string;
  /** The player is gone for now (socket closed): their characters fight on with the AI (C003). */
  away?: boolean;
}

export interface Table {
  seats: Seat[];
  policy: TablePolicy;
}

/** Why a command was refused: an engine message key (`table.*`). `propose` = a guest's story action the host may take up (C006). */
export type Refusal = { key: 'table.noSeat' | 'table.hostOnly' | 'table.spectator' | 'table.proposeOnly' | 'table.notYourTurn' | 'table.notYourCharacter'; propose?: boolean };
export type Verdict = { ok: true } | ({ ok: false } & Refusal);

export function soloTable(): Table {
  return { seats: [{ id: HOST_SEAT, role: 'host' }], policy: 'host_decides' };
}

export function seatOf(table: Table, id: SeatId): Seat | undefined {
  return table.seats.find((s) => s.id === id);
}

/** Seats a new guest (`guest-<n>`, lowest free n) and returns the seat. */
export function addSeat(table: Table, role: 'player' | 'spectator', name?: string): Seat {
  let n = 1;
  while (seatOf(table, `guest-${n}`)) n++;
  const seat: Seat = { id: `guest-${n}`, role, ...(name && { name }) };
  table.seats.push(seat);
  return seat;
}

/** Removes a guest seat (the host's seat can't be removed). Its characters fall back to the host. */
export function removeSeat(table: Table, id: SeatId): boolean {
  if (id === HOST_SEAT) return false;
  const before = table.seats.length;
  table.seats = table.seats.filter((s) => s.id !== id);
  return table.seats.length < before;
}

function controlMap(state: GameState): Record<string, string> {
  return (state.extensions.party as { control?: Record<string, string> } | undefined)?.control ?? {};
}

/**
 * The seat that plays a character: a companion with control `seat:<id>` belongs to that seat while it
 * is seated; everything else (the hero, AI or 'player' companions, an away seat's characters) is the host's.
 */
export function ownerOf(table: Table, state: GameState, characterId: string): SeatId {
  const control = controlMap(state)[characterId];
  if (control?.startsWith('seat:')) {
    const seat = control.slice(5);
    if (seatOf(table, seat)) return seat;
  }
  return HOST_SEAT;
}

/** Marks a guest seat away or back (the host is never away). Returns whether anything changed. */
export function setAway(table: Table, id: SeatId, away: boolean): boolean {
  const seat = seatOf(table, id);
  if (!seat || seat.role === 'host' || !!seat.away === away) return false;
  if (away) seat.away = true;
  else delete seat.away;
  return true;
}

/**
 * Who plays which creature in a fight (C003): the hero and the host's 'player' companions → host,
 * a `seat:<id>` companion → that seat while it is seated and not away. Characters missing from the
 * map (AI control, or a seat that left or is away) are played by the companion AI.
 */
export function fightSeats(table: Table, state: GameState): Record<string, SeatId> {
  const out: Record<string, SeatId> = { [state.hero.id]: HOST_SEAT };
  for (const [id, control] of Object.entries(controlMap(state))) {
    if (!state.companions.some((c) => c.id === id)) continue;
    if (control === 'player') out[id] = HOST_SEAT;
    else if (control.startsWith('seat:')) {
      const seat = seatOf(table, control.slice(5));
      if (seat && !seat.away && seat.role !== 'spectator') out[id] = seat.id;
    }
  }
  return out;
}

/** Characters (hero + companions) a seat plays. Spectators own nothing. */
export function charactersOf(table: Table, state: GameState, seat: SeatId): string[] {
  if (seatOf(table, seat)?.role === 'spectator') return [];
  return [state.hero.id, ...state.companions.map((c) => c.id)].filter((id) => ownerOf(table, state, id) === seat);
}

type CommandType = ClientCommand['type'];

/** Anyone at the table, spectators included. */
const OPEN: ReadonlySet<CommandType> = new Set(['ping', 'get_state']);
/** The host alone: the game itself, its saves, its language and who plays which companion. */
const HOST_ONLY: ReadonlySet<CommandType> = new Set(['new_game', 'load', 'save', 'set_language', 'thumbnail', 'companion_control']);
/** Story actions a guest may only propose under host_decides (the rest of the story commands are refused). */
const PROPOSALS: ReadonlySet<CommandType> = new Set(['say', 'choose']);
/** Fight commands: decided by who owns the creature whose turn it is. */
const COMBAT: ReadonlySet<CommandType> = new Set(['combat_act', 'combat_flee']);
/** Any player seat, whatever the policy: bringing your own hero to the table (C002). */
const PLAYERS: ReadonlySet<CommandType> = new Set(['add_hero']);

/** The creature whose turn it is in the running fight, if any. */
function actingCreature(state: GameState | undefined): string | undefined {
  const fight = state?.extensions.combat as { enc?: Encounter } | undefined;
  return fight?.enc ? currentId(fight.enc.state.turns) : undefined;
}

/**
 * May `seat` send `cmd`? Story commands (say, choose, travel, shops, inventory, journal) follow the
 * table policy; saves/loads/new games/language/control are the host's; fight commands belong to the
 * seat that owns the creature whose turn it is; a level-up to the seat that owns the character
 * (`characterId`, default the hero); any player seat may add its own hero.
 */
export function allows(table: Table, cmd: Pick<ClientCommand, 'type'> & { characterId?: string }, seatId: SeatId, state?: GameState): Verdict {
  const seat = seatOf(table, seatId);
  if (!seat) return { ok: false, key: 'table.noSeat' };
  if (OPEN.has(cmd.type)) return { ok: true };
  if (HOST_ONLY.has(cmd.type)) return seat.role === 'host' ? { ok: true } : { ok: false, key: 'table.hostOnly' };
  if (seat.role === 'spectator') return { ok: false, key: 'table.spectator' };
  if (PLAYERS.has(cmd.type)) return { ok: true };
  if (cmd.type === 'level_up') {
    if (!state) return { ok: true };
    return ownerOf(table, state, cmd.characterId ?? state.hero.id) === seat.id ? { ok: true } : { ok: false, key: 'table.notYourCharacter' };
  }
  if (COMBAT.has(cmd.type)) {
    const acting = actingCreature(state);
    // No fight (or no turn): the fight port reports that itself.
    if (acting === undefined || !state) return { ok: true };
    return ownerOf(table, state, acting) === seat.id ? { ok: true } : { ok: false, key: 'table.notYourTurn' };
  }
  if (seat.role === 'host' || table.policy === 'anyone') return { ok: true };
  return PROPOSALS.has(cmd.type) ? { ok: false, key: 'table.proposeOnly', propose: true } : { ok: false, key: 'table.hostOnly' };
}
