/** Save-file envelope schema: metadata for the save browser plus the (engine-owned) game state. */
import { z } from 'zod';

export const SLOT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/;

export const SaveMetaSchema = z.object({
  slotId: z.string().regex(SLOT_ID_PATTERN),
  kind: z.enum(['manual', 'auto']),
  /** Player-facing save name. */
  name: z.string().max(80),
  /** ISO timestamp. */
  savedAt: z.string(),
  characterName: z.string(),
  level: z.number().int().min(1).max(20),
  location: z.string(),
  mode: z.enum(['heroic', 'hardcore']),
  /** First-chapter adventure id of the save's campaign (absent in old saves = the starter arc). */
  campaign: z.string().optional(),
  /** Final ending the story reached (B002: such a save's world can start a new hero's campaign). */
  ending: z.string().max(80).optional(),
  playTimeMinutes: z.number().min(0).default(0),
  /** Small PNG/JPEG data URL of the 3D character (gear + scars). */
  thumbnail: z.string().optional(),
});

export type SaveMeta = z.infer<typeof SaveMetaSchema>;

export const SaveFileSchema = z.object({
  schemaVersion: z.number().int().min(1),
  meta: SaveMetaSchema,
  /** Validated by the engine's GameState schema when the game loads it. */
  state: z.unknown(),
});

export type SaveFile = z.infer<typeof SaveFileSchema>;

/** A row in the save browser. Corrupt files are listed so the player can see and delete them. */
export type SaveListEntry = { ok: true; meta: SaveMeta; schemaVersion: number } | { ok: false; slotId: string; error: string };
