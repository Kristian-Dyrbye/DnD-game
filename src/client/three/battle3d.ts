/**
 * Pure helpers for the 3D battle map (no three.js here, so they are unit-testable): grid ↔ world
 * coordinates (1 world unit = one 5-ft square, x → +x, y → +z, ground at y = 0), the overlay colour
 * of each square, and which tokens get a full character model (the rest use stand-ins).
 */
import { cellKey, footprintSize, type Grid, type GridToken } from '../../engine/combat/grid';
import type { Creatures } from '../../engine/combat/turns';

/** Centre of square (x, y) in world units. */
export function squareCentre(x: number, y: number): { x: number; z: number } {
  return { x: x + 0.5, z: y + 0.5 };
}

/** Centre of a token's footprint in world units. */
export function tokenCentre(t: Pick<GridToken, 'x' | 'y' | 'size'>): { x: number; z: number } {
  const n = footprintSize(t.size);
  return { x: t.x + n / 2, z: t.y + n / 2 };
}

/** Square under a world point on the ground, or null when off the map. */
export function worldToSquare(grid: Pick<Grid, 'width' | 'height'>, wx: number, wz: number): { x: number; y: number } | null {
  const x = Math.floor(wx);
  const y = Math.floor(wz);
  return x >= 0 && y >= 0 && x < grid.width && y < grid.height ? { x, y } : null;
}

export interface OverlaySets {
  reachable?: ReadonlySet<string>;
  aoe?: ReadonlySet<string>;
  zones?: ReadonlySet<string>;
}

/** Overlay colour (hex) and opacity for a square, or null for plain ground. AoE wins over zones over reach. */
export function overlayFor(key: string, o: OverlaySets): { color: number; opacity: number } | null {
  if (o.aoe?.has(key)) return { color: 0xff7828, opacity: 0.45 };
  if (o.zones?.has(key)) return { color: 0xaa6eff, opacity: 0.3 };
  if (o.reachable?.has(key)) return { color: 0x78c8ff, opacity: 0.25 };
  return null;
}

/** Ground tint for terrain: blocking squares are raised blocks, difficult ground is darker. */
export function terrainOf(grid: Grid, x: number, y: number): 'blocking' | 'difficult' | 'normal' {
  const cell = grid.cells[cellKey({ x, y })];
  if (cell?.blocking) return 'blocking';
  if (cell?.terrain === 'difficult') return 'difficult';
  return 'normal';
}

/** Wall/door segments from the grid's edges, in world units (x0,z0 → x1,z1). */
export function edgeSegments(grid: Grid): { x0: number; z0: number; x1: number; z1: number; door: boolean; open: boolean }[] {
  return Object.entries(grid.edges).map(([k, e]) => {
    const [xs, ys, side] = k.split(',');
    const x = Number(xs);
    const y = Number(ys);
    const door = e.kind === 'door';
    const open = door && e.open === true;
    return side === 'N' ? { x0: x, z0: y, x1: x + 1, z1: y, door, open } : { x0: x, z0: y, x1: x, z1: y + 1, door, open };
  });
}

/**
 * Tokens that get a full model, up to `max` (settings.performance.maxNpcModels): characters with an
 * appearance first (party first), then monsters with a stat block; everyone else uses a stand-in.
 */
export function modelTokens(grid: Grid, creatures: Creatures, sides: Record<string, string>, max: number): Set<string> {
  const isPc = (id: string) => {
    const c = creatures[id];
    return !!c && c.kind === 'character' && 'appearance' in c && !!(c as { appearance?: unknown }).appearance;
  };
  const ids = Object.keys(grid.tokens).filter((id) => isPc(id) || !!creatures[id]?.statBlockId);
  const rank = (id: string) => (isPc(id) ? 0 : 2) + (sides[id] === 'party' ? 0 : 1);
  ids.sort((a, b) => rank(a) - rank(b));
  return new Set(ids.slice(0, Math.max(0, max)));
}

export const SIDE_COLOURS: Record<string, number> = { party: 0x3f7fbf, enemy: 0xb8453c, neutral: 0x8a8a5a };

/** HP ring colour, as on the 2D map. */
export function hpColour(hp: number, maxHp: number): number {
  const f = Math.max(0, Math.min(1, hp / Math.max(1, maxHp)));
  return f > 0.5 ? 0x6fd06f : f > 0.25 ? 0xe0b040 : 0xe0483e;
}

/**
 * How much farther than the default the camera must sit so the whole board fits a viewport of this
 * aspect ratio (width / height). 1 for landscape views; grows as the view narrows (phones).
 */
export function fitFactor(aspect: number): number {
  if (!Number.isFinite(aspect) || aspect <= 0) return 1;
  // The default distance frames the board for an aspect of about 1.3; narrower views see less sideways.
  return Math.max(1, 1.3 / aspect);
}
