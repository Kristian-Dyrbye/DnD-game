/**
 * GameState: everything the engine needs to resume a campaign. It is plain JSON (saved inside the
 * save envelope's `state`) and validated with zod on load. Systems added later (clock, weather,
 * factions, crafting, home base…) keep their data under `extensions.<id>` so new systems never need
 * a GameState schema change — see ARCHITECTURE.md "Extension points".
 */
import { z } from 'zod';
import { CharacterSchema } from '../core/creature';

export const LogEntrySchema = z.object({
  id: z.number().int(),
  kind: z.enum(['narration', 'dialogue', 'player', 'system', 'roll']),
  text: z.string(),
  /** Speaker for dialogue (NPC/companion id or name). */
  speaker: z.string().optional(),
});
export type LogEntry = z.infer<typeof LogEntrySchema>;

/** One resolved roll, shown in the dice tray and roll history (math always visible). */
export const RollRecordSchema = z.object({
  id: z.number().int(),
  label: z.string(),
  /** The d20s rolled: one, or two for advantage/disadvantage (see `mode`). */
  dice: z.array(z.number().int()),
  /** Advantage keeps the higher die, disadvantage the lower. */
  mode: z.enum(['normal', 'advantage', 'disadvantage']).optional(),
  modifier: z.number().int(),
  total: z.number().int(),
  /** Full math line, e.g. `d20: 14 + 5 (Persuasion) = 19 vs DC 15 — Success`. */
  math: z.string(),
  success: z.boolean().optional(),
});
export type RollRecord = z.infer<typeof RollRecordSchema>;

export const GameStateSchema = z.object({
  /** Stable id for this campaign (same world flags continue after a Hardcore death). */
  campaignId: z.string(),
  mode: z.enum(['heroic', 'hardcore']),
  rng: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  hero: CharacterSchema,
  /** Companion characters (Phase 6). */
  companions: z.array(CharacterSchema).default([]),
  location: z.object({
    /** Adventure + scene ids (set by the scene runner, A051). */
    adventureId: z.string().optional(),
    sceneId: z.string().optional(),
    /** Player-facing name, used by the save browser. */
    name: z.string(),
  }),
  /** Minutes since the campaign began (clock/day-night in A072). */
  time: z.number().int().min(0).default(0),
  /** World and quest flags (persist across arcs and Hardcore deaths). */
  flags: z.record(z.string(), z.union([z.boolean(), z.number(), z.string()])).default({}),
  /** Recent story log; older text is condensed into `summary`. */
  log: z.array(LogEntrySchema).default([]),
  /** Rolling story summary (LLM-condensed after each scene, template fallback). Used instead of a long transcript. */
  summary: z.string().default(''),
  /** Log entries up to this id are already folded into `summary`. */
  summaryUpTo: z.number().int().default(0),
  rolls: z.array(RollRecordSchema).default([]),
  /** Next id for log entries and rolls. */
  nextId: z.number().int().default(1),
  playTimeMinutes: z.number().min(0).default(0),
  /** Per-system state, keyed by system id (ARCHITECTURE.md §6). */
  extensions: z.record(z.string(), z.unknown()).default({}),
});
export type GameState = z.infer<typeof GameStateSchema>;

/** Caps so the state (and every snapshot) stays small. */
export const LOG_LIMIT = 200;
export const ROLL_LIMIT = 50;
