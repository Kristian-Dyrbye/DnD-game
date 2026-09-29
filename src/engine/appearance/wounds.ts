/**
 * Temporary wounds (spec §12): cuts, bruises and blood shown on the model scale with missing HP and
 * fade as HP comes back (healing, rests). The engine only decides how wounded a creature looks; the
 * client draws decal overlays (client/three/wounds.ts).
 */

/** Wound steps: 0 = unhurt … 4 = at death's door (0 HP). */
export type WoundLevel = 0 | 1 | 2 | 3 | 4;

/** Missing HP → wound step: <10% none, <35% light, <60% heavy, >0 HP grievous, 0 HP down. */
export function woundLevel(hp: number, maxHp: number): WoundLevel {
  if (maxHp <= 0) return 0;
  if (hp <= 0) return 4;
  const missing = 1 - hp / maxHp;
  if (missing < 0.1) return 0;
  if (missing < 0.35) return 1;
  if (missing < 0.6) return 2;
  return 3;
}

/** How many decals and how opaque, per step. */
export const WOUND_LOOK: Record<WoundLevel, { decals: number; opacity: number }> = {
  0: { decals: 0, opacity: 0 },
  1: { decals: 10, opacity: 0.55 },
  2: { decals: 22, opacity: 0.75 },
  3: { decals: 36, opacity: 0.9 },
  4: { decals: 48, opacity: 1 },
};

/** A short phrase for narration / the character screen. */
export function woundWords(level: WoundLevel): string | undefined {
  return [undefined, 'scratched and bruised', 'bleeding from several cuts', 'badly wounded', 'grievously wounded'][level];
}
