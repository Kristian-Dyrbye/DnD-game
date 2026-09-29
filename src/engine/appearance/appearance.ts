/**
 * Character appearance (spec §5 step 6, §12). The 3D models are the KayKit modular adventurers:
 * five outfits sharing one rig, so any head can go on any body. Appearance is plain data saved
 * with the character; the client builds the model from it (src/client/three/characterModel.ts).
 */
import { z } from 'zod';

export const OUTFITS = ['knight', 'barbarian', 'mage', 'rogue', 'rogue_hooded'] as const;
export const OutfitSchema = z.enum(OUTFITS);
export type Outfit = z.infer<typeof OutfitSchema>;

export const OUTFIT_LABELS: Record<Outfit, string> = {
  knight: 'Knight',
  barbarian: 'Barbarian',
  mage: 'Mage',
  rogue: 'Rogue',
  rogue_hooded: 'Hooded Rogue',
};

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const AppearanceSchema = z.object({
  /** Body, arms and legs come from this outfit model. */
  outfit: OutfitSchema.default('knight'),
  /** Head (face and hair) model. */
  head: OutfitSchema.default('knight'),
  build: z.enum(['slim', 'average', 'broad']).default('average'),
  skinTone: hex.default('#c68c59'),
  /** Tint for cape and headgear. */
  primaryColor: hex.default('#7a2e2e'),
  showHeadgear: z.boolean().default(true),
  showCape: z.boolean().default(true),
});
export type Appearance = z.infer<typeof AppearanceSchema>;

export const SKIN_TONES = ['#f1d3b3', '#e0ac7e', '#c68c59', '#a0673e', '#7a4a2a', '#4f301c', '#8fa37a', '#b56b5a', '#7c8fb0'] as const;

/** Default outfit per class (the closest KayKit adventurer). */
const CLASS_OUTFIT: Record<string, Outfit> = {
  barbarian: 'barbarian',
  fighter: 'knight',
  paladin: 'knight',
  cleric: 'knight',
  monk: 'rogue',
  ranger: 'rogue_hooded',
  rogue: 'rogue',
  bard: 'mage',
  druid: 'mage',
  sorcerer: 'mage',
  warlock: 'mage',
  wizard: 'mage',
};

export function defaultAppearanceFor(classId: string | undefined): Appearance {
  const outfit = CLASS_OUTFIT[classId ?? ''] ?? 'knight';
  return AppearanceSchema.parse({ outfit, head: outfit === 'rogue_hooded' ? 'rogue_hooded' : outfit });
}

/** Model scale for a creature size (Small species are shorter). */
export function sizeScale(size: string): number {
  return size === 'small' ? 0.78 : size === 'large' ? 1.6 : 1;
}

/** Horizontal body scale for a build. */
export function buildWidth(build: Appearance['build']): number {
  return build === 'slim' ? 0.9 : build === 'broad' ? 1.12 : 1;
}
