/**
 * WebSocket game protocol shared by client and server. The client sends ClientCommands; the
 * server replies with ServerEvents. Commands are validated with zod on the server; events are
 * trusted by the client. Every command may carry `reqId`, echoed on its `error` / `ack` events.
 */
import { z } from 'zod';
import { CharacterSchema } from '../engine/core/creature';
import type { GameState, LogEntry, RollRecord } from '../engine/session/gameState';
import { SLOT_ID_PATTERN, type SaveMeta } from './save';

const base = { reqId: z.string().max(40).optional() };

export const ClientCommandSchema = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('ping') }),
  /** Start a campaign with a freshly created hero. */
  z.object({ ...base, type: z.literal('new_game'), hero: CharacterSchema, mode: z.enum(['heroic', 'hardcore']), seed: z.union([z.string(), z.number()]).optional() }),
  /** Ask for a full snapshot (e.g. after a reconnect). */
  z.object({ ...base, type: z.literal('get_state') }),
  /** Free text from the input box (goes through intent parsing in A054). */
  z.object({ ...base, type: z.literal('say'), text: z.string().min(1).max(500) }),
  /** A suggested action button. */
  z.object({ ...base, type: z.literal('choose'), actionId: z.string().min(1).max(80) }),
  z.object({ ...base, type: z.literal('save'), slot: z.string().regex(SLOT_ID_PATTERN), name: z.string().max(80).optional() }),
  z.object({ ...base, type: z.literal('load'), slot: z.string().regex(SLOT_ID_PATTERN) }),
]);
export type ClientCommand = z.infer<typeof ClientCommandSchema>;

export interface SuggestedAction {
  id: string;
  label: string;
}

export type ServerEvent =
  | { type: 'pong'; reqId?: string }
  | { type: 'ack'; reqId?: string; command: ClientCommand['type'] }
  | { type: 'error'; reqId?: string; message: string }
  /** Full state; sent after new_game, load and get_state. */
  | { type: 'snapshot'; state: GameState }
  /** A finished log entry (player text, system notes, complete narration). */
  | { type: 'log'; entry: LogEntry }
  /** Streaming narration: start → chunk* → end; the final text also arrives as a `log` entry. */
  | { type: 'narration'; phase: 'start' | 'chunk' | 'end'; entryId: number; text: string }
  | { type: 'roll'; roll: RollRecord }
  | { type: 'suggestions'; actions: SuggestedAction[] }
  | { type: 'saved'; meta: SaveMeta };

/** Parses a raw WebSocket message into a command, or returns a player-safe error message. */
export function parseCommand(raw: string): { ok: true; command: ClientCommand } | { ok: false; error: string; reqId?: string } {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'Invalid JSON' };
  }
  const res = ClientCommandSchema.safeParse(json);
  if (res.success) return { ok: true, command: res.data };
  const reqId = typeof (json as { reqId?: unknown })?.reqId === 'string' ? (json as { reqId: string }).reqId : undefined;
  const issue = res.error.issues[0];
  return { ok: false, error: `Invalid command${issue ? `: ${issue.path.join('.') || 'type'} ${issue.message}` : ''}`, ...(reqId && { reqId }) };
}
