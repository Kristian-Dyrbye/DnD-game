/**
 * WebSocket game protocol shared by client and server. The client sends ClientCommands; the
 * server replies with ServerEvents. Commands are validated with zod on the server; events are
 * trusted by the client. Every command may carry `reqId`, echoed on its `error` / `ack` events.
 */
import { z } from 'zod';
import { CharacterSchema } from '../engine/core/creature';
import type { GameState, LogEntry, RollRecord } from '../engine/session/gameState';
import type { Journal } from '../engine/session/journal';
import type { ShopView } from '../engine/world/shops';
import type { Ambience, Mood } from '../engine/world/mood';
import type { Encounter } from '../engine/combat/encounter';
import { SLOT_ID_PATTERN, type SaveMeta } from './save';

const base = { reqId: z.string().max(40).optional() };

const PointSchema = z.object({ x: z.number().int().min(0).max(200), y: z.number().int().min(0).max(200) });
export const PlayerActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('move'), path: z.array(PointSchema).min(1).max(80) }),
  z.object({ kind: z.literal('attack'), targetId: z.string().max(60), profileId: z.string().max(120).optional() }),
  z.object({ kind: z.literal('dash') }),
  z.object({ kind: z.literal('disengage') }),
  z.object({ kind: z.literal('dodge') }),
  z.object({ kind: z.literal('end_turn') }),
]);

export const ClientCommandSchema = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('ping') }),
  /** Start a campaign with a freshly created hero. */
  z.object({
    ...base,
    type: z.literal('new_game'),
    hero: CharacterSchema,
    mode: z.enum(['heroic', 'hardcore']),
    seed: z.union([z.string(), z.number()]).optional(),
    /** Hardcore: a new hero continues in the same world (flags, map, reputation, time kept). */
    continueWorld: z.boolean().optional(),
  }),
  /** Level up the hero (choices as required by leveling.pendingChoices). */
  z.object({
    ...base,
    type: z.literal('level_up'),
    classId: z.string().max(40),
    hpMode: z.enum(['average', 'roll']),
    subclassId: z.string().max(60).optional(),
    feat: z.object({ featId: z.string().max(60), increases: z.record(z.string(), z.number().int().min(1).max(2)).optional() }).optional(),
    cantrips: z.array(z.string().max(60)).max(6).optional(),
    spells: z.array(z.string().max(60)).max(10).optional(),
    weaponMasteries: z.array(z.string().max(60)).max(6).optional(),
    expertise: z.array(z.string().max(40)).max(4).optional(),
    skills: z.array(z.string().max(40)).max(4).optional(),
  }),
  /** Toggle a companion between AI and player control (outside combat). */
  z.object({ ...base, type: z.literal('companion_control'), companionId: z.string().max(40), control: z.enum(['ai', 'player']) }),
  /** Combat: one hero action on the battle map, or fleeing the fight. */
  z.object({ ...base, type: z.literal('combat_act'), action: PlayerActionSchema }),
  z.object({ ...base, type: z.literal('combat_flee') }),
  /** Ask for a full snapshot (e.g. after a reconnect). */
  z.object({ ...base, type: z.literal('get_state') }),
  /** Free text from the input box (goes through intent parsing in A054). */
  z.object({ ...base, type: z.literal('say'), text: z.string().min(1).max(500) }),
  /** A suggested action button. */
  z.object({ ...base, type: z.literal('choose'), actionId: z.string().min(1).max(80) }),
  z.object({ ...base, type: z.literal('save'), slot: z.string().regex(SLOT_ID_PATTERN), name: z.string().max(80).optional() }),
  z.object({ ...base, type: z.literal('load'), slot: z.string().regex(SLOT_ID_PATTERN) }),
  /** Travel on the world map to a known location. */
  z.object({ ...base, type: z.literal('travel'), to: z.string().max(60), pace: z.enum(['slow', 'normal', 'fast']).default('normal') }),
  /** Inventory. */
  z.object({ ...base, type: z.literal('equip'), uid: z.string().max(20), slot: z.enum(['armor', 'shield', 'main_hand', 'off_hand', 'worn']).optional() }),
  z.object({ ...base, type: z.literal('unequip'), uid: z.string().max(20) }),
  /** Shops at the current location. */
  z.object({ ...base, type: z.literal('shop_open'), shopId: z.string().max(60) }),
  z.object({ ...base, type: z.literal('shop_buy'), shopId: z.string().max(60), itemId: z.string().max(80), qty: z.number().int().min(1).max(99).default(1) }),
  z.object({ ...base, type: z.literal('shop_sell'), shopId: z.string().max(60), uid: z.string().max(20), qty: z.number().int().min(1).max(99).default(1) }),
  z.object({ ...base, type: z.literal('shop_haggle'), shopId: z.string().max(60) }),
  /** Journal: create (no id) or update a page. */
  z.object({ ...base, type: z.literal('journal_save'), page: z.object({ id: z.string().max(12).optional(), title: z.string().max(200), body: z.string().max(25_000) }) }),
  z.object({ ...base, type: z.literal('journal_delete'), id: z.string().max(12) }),
  z.object({ ...base, type: z.literal('journal_reorder'), ids: z.array(z.string().max(12)).max(250) }),
]);
export type ClientCommand = z.infer<typeof ClientCommandSchema>;

export interface SuggestedAction {
  id: string;
  label: string;
  /** Free-text suggestion: clicking sends this as a `say` command instead of `choose`. */
  say?: string;
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
  | { type: 'saved'; meta: SaveMeta }
  /** Current objective for the optional hint (the client shows it only if the setting is on). */
  | { type: 'objective'; text: string | null }
  /** The journal after a change (also part of every snapshot). `savedId` is the page just saved. */
  | { type: 'journal'; journal: Journal; savedId?: string }
  /** Spoken audio for a log entry is ready at /api/tts/<entryId>.wav (only when TTS is on). */
  | { type: 'tts'; entryId: number }
  /** The running fight (null when it ends). */
  | { type: 'combat'; encounter: Encounter | null; canFlee?: boolean }
  /** Hardcore: the hero died; a new hero can continue in this world. */
  | { type: 'hero_fallen'; name: string }
  /** Music mood + ambience bed for the current place (the client crossfades). */
  | { type: 'mood'; mood: Mood; ambience: Ambience }
  /** A shop's current offer (after shop_open and every trade). */
  | { type: 'shop'; shop: ShopView };

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
