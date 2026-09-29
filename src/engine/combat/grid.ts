/**
 * Battle grid model (Build Prompt §10): 5-ft squares with integer coords {x, y}
 * (x → east, y → south; square (x, y) covers [x, x+1] × [y, y+1] in grid units).
 *
 * - Cells are stored sparsely in `cells` keyed "x,y"; a missing cell is open, normal terrain.
 *   `blocking` squares (solid wall/pillar) block movement and sight. `coverObstacle` marks a low
 *   obstacle (low wall, furniture) that grants at most that degree of cover but never blocks sight.
 * - Thin walls and doors live on square *edges*, stored in `edges` under a canonical key:
 *   every edge is the North ("x,y,N") or West ("x,y,W") edge of some square. The East edge of
 *   (x, y) is the West edge of (x+1, y); the South edge is the North edge of (x, y+1).
 *   Walls and closed doors block movement and sight; open doors block nothing.
 * - Tokens place creatures: (x, y) is the top-left square of the footprint (Tiny/Small/Medium 1×1,
 *   Large 2×2, Huge 3×3, Gargantuan 4×4).
 * - Distance (SRD 5.2 grid play): every square entered costs 5 ft, diagonals included, so
 *   distance is Chebyshev between the closest squares of two footprints.
 *
 * Everything is plain JSON (validated by GridSchema) so it can live in GameState.
 * Mutating helpers (setCell, setEdge, placeToken…) modify the grid passed in.
 */
import { z } from 'zod';
import { SizeSchema, sizeSquares, type Size } from '../rules/basics';

export interface Point {
  x: number;
  y: number;
}

export const TERRAINS = ['normal', 'difficult'] as const;
export const TerrainSchema = z.enum(TERRAINS);
export type Terrain = z.infer<typeof TerrainSchema>;

export const CoverGradeSchema = z.enum(['none', 'half', 'three_quarters', 'total']);
export type CoverGrade = z.infer<typeof CoverGradeSchema>;

export const CellSchema = z.object({
  terrain: TerrainSchema.optional(),
  /** Solid feature filling the square (wall block, pillar): blocks movement and sight. */
  blocking: z.boolean().optional(),
  /** Low obstacle: grants this much cover to lines passing through it; never blocks sight. */
  coverObstacle: z.enum(['half', 'three_quarters']).optional(),
  /** Free-form hazard tags ("fire", "acid", "pit") for later systems. */
  hazards: z.array(z.string()).optional(),
});
export type Cell = z.infer<typeof CellSchema>;

export const EdgeFeatureSchema = z.object({
  kind: z.enum(['wall', 'door']),
  /** Doors only: open doors block nothing. */
  open: z.boolean().optional(),
});
export type EdgeFeature = z.infer<typeof EdgeFeatureSchema>;

export const GridTokenSchema = z.object({
  id: z.string(),
  x: z.number().int(),
  y: z.number().int(),
  size: SizeSchema,
});
export type GridToken = z.infer<typeof GridTokenSchema>;

export const GridSchema = z.object({
  width: z.number().int().min(1),
  height: z.number().int().min(1),
  cells: z.record(z.string(), CellSchema),
  edges: z.record(z.string(), EdgeFeatureSchema),
  tokens: z.record(z.string(), GridTokenSchema),
});
export type Grid = z.infer<typeof GridSchema>;

export type Side = 'N' | 'E' | 'S' | 'W';

export function createGrid(width: number, height: number): Grid {
  return { width, height, cells: {}, edges: {}, tokens: {} };
}

// ---------------------------------------------------------------- cells

export function cellKey(p: Point): string {
  return `${p.x},${p.y}`;
}

export function inBounds(grid: Grid, p: Point): boolean {
  return p.x >= 0 && p.y >= 0 && p.x < grid.width && p.y < grid.height;
}

const EMPTY_CELL: Cell = Object.freeze({});

export function getCell(grid: Grid, p: Point): Cell {
  return grid.cells[cellKey(p)] ?? EMPTY_CELL;
}

/** Merge `patch` into the cell at p (drops the entry again if it becomes empty). */
export function setCell(grid: Grid, p: Point, patch: Partial<Cell>): void {
  const next: Cell = { ...getCell(grid, p), ...patch };
  for (const k of Object.keys(next) as (keyof Cell)[]) if (next[k] === undefined) delete next[k];
  if (Object.keys(next).length === 0) delete grid.cells[cellKey(p)];
  else grid.cells[cellKey(p)] = next;
}

/** Solid square (in bounds only; off-grid squares are not treated as blocking). */
export function isBlockingSquare(grid: Grid, p: Point): boolean {
  return getCell(grid, p).blocking === true;
}

export function isDifficult(grid: Grid, p: Point): boolean {
  return getCell(grid, p).terrain === 'difficult';
}

// ---------------------------------------------------------------- edges

/** Canonical key of the given side of square (x, y). */
export function edgeKey(x: number, y: number, side: Side): string {
  switch (side) {
    case 'N':
      return `${x},${y},N`;
    case 'W':
      return `${x},${y},W`;
    case 'E':
      return `${x + 1},${y},W`;
    case 'S':
      return `${x},${y + 1},N`;
  }
}

export function getEdge(grid: Grid, x: number, y: number, side: Side): EdgeFeature | undefined {
  return grid.edges[edgeKey(x, y, side)];
}

/** Put a wall/door on an edge, or clear it with `undefined`. */
export function setEdge(grid: Grid, x: number, y: number, side: Side, feature: EdgeFeature | undefined): void {
  const key = edgeKey(x, y, side);
  if (feature) grid.edges[key] = { ...feature };
  else delete grid.edges[key];
}

/** Open or close a door; returns false if there is no door on that edge. */
export function setDoorOpen(grid: Grid, x: number, y: number, side: Side, open: boolean): boolean {
  const e = grid.edges[edgeKey(x, y, side)];
  if (!e || e.kind !== 'door') return false;
  e.open = open;
  return true;
}

/** Wall or closed door on this edge (blocks movement and sight). */
export function isWallEdge(grid: Grid, x: number, y: number, side: Side): boolean {
  const e = getEdge(grid, x, y, side);
  return !!e && (e.kind === 'wall' || e.open !== true);
}

/**
 * Edge that nothing can pass: a wall/closed door, a face of a blocking square, or an edge on (or
 * beyond) the map border — the border acts like a wall, so lines can't slip round a wall end
 * that touches the edge of the map.
 */
export function isSolidEdge(grid: Grid, x: number, y: number, side: Side): boolean {
  if (isWallEdge(grid, x, y, side)) return true;
  const n = neighbour({ x, y }, side);
  if (!inBounds(grid, { x, y }) || !inBounds(grid, n)) return true;
  if (isBlockingSquare(grid, { x, y })) return true;
  return isBlockingSquare(grid, n);
}

function neighbour(p: Point, side: Side): Point {
  switch (side) {
    case 'N':
      return { x: p.x, y: p.y - 1 };
    case 'S':
      return { x: p.x, y: p.y + 1 };
    case 'E':
      return { x: p.x + 1, y: p.y };
    case 'W':
      return { x: p.x - 1, y: p.y };
  }
}

// ---------------------------------------------------------------- tokens

/** Squares per side of a creature's footprint. */
export function footprintSize(size: Size): number {
  return sizeSquares(size);
}

/** All squares a token covers. */
export function tokenSquares(t: Pick<GridToken, 'x' | 'y' | 'size'>): Point[] {
  const n = footprintSize(t.size);
  const out: Point[] = [];
  for (let dy = 0; dy < n; dy++) for (let dx = 0; dx < n; dx++) out.push({ x: t.x + dx, y: t.y + dy });
  return out;
}

export function tokenCovers(t: Pick<GridToken, 'x' | 'y' | 'size'>, p: Point): boolean {
  const n = footprintSize(t.size);
  return p.x >= t.x && p.y >= t.y && p.x < t.x + n && p.y < t.y + n;
}

/** Ids of tokens covering square p. */
export function occupantsAt(grid: Grid, p: Point): string[] {
  return Object.values(grid.tokens)
    .filter((t) => tokenCovers(t, p))
    .map((t) => t.id);
}

export function isOccupied(grid: Grid, p: Point, ignoreIds: readonly string[] = []): boolean {
  return occupantsAt(grid, p).some((id) => !ignoreIds.includes(id));
}

/** True if a token of `size` could stand with its top-left at p (in bounds, no blocking square, no other creature). */
export function canPlace(grid: Grid, size: Size, p: Point, ignoreIds: readonly string[] = []): boolean {
  return tokenSquares({ x: p.x, y: p.y, size }).every(
    (q) => inBounds(grid, q) && !isBlockingSquare(grid, q) && !isOccupied(grid, q, ignoreIds),
  );
}

export function placeToken(grid: Grid, token: GridToken): void {
  grid.tokens[token.id] = { ...token };
}

export function removeToken(grid: Grid, id: string): void {
  delete grid.tokens[id];
}

/** Move a token's top-left to p (no legality check; see canPlace / movement rules). */
export function moveToken(grid: Grid, id: string, p: Point): void {
  const t = grid.tokens[id];
  if (!t) throw new Error(`Unknown token ${id}`);
  t.x = p.x;
  t.y = p.y;
}

// ---------------------------------------------------------------- distance

/** Squares between two single squares (every step 5 ft, diagonals included). */
export function squareDistance(a: Point, b: Point): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

type Footprint = Pick<GridToken, 'x' | 'y' | 'size'>;

/** Squares between the closest squares of two footprints (0 if they overlap). */
export function distanceSquares(a: Footprint, b: Footprint): number {
  const na = footprintSize(a.size);
  const nb = footprintSize(b.size);
  const gapX = Math.max(0, b.x - (a.x + na - 1), a.x - (b.x + nb - 1));
  const gapY = Math.max(0, b.y - (a.y + na - 1), a.y - (b.y + nb - 1));
  return Math.max(gapX, gapY);
}

export function distanceFt(a: Footprint, b: Footprint): number {
  return distanceSquares(a, b) * 5;
}

/** Within 5 ft of each other (touching, including diagonally). */
export function isAdjacent(a: Footprint, b: Footprint): boolean {
  return distanceSquares(a, b) <= 1;
}

/** Target within `reachFt` feet (5 = normal melee, 10 = reach weapons). */
export function withinReach(a: Footprint, b: Footprint, reachFt: number): boolean {
  return distanceFt(a, b) <= reachFt;
}

// ---------------------------------------------------------------- stepping

/**
 * Can a creature step from square `from` to the adjacent square `to` (orthogonal or diagonal)?
 * Checks bounds, blocking squares and walls/closed doors only (not creatures or terrain cost).
 * A diagonal step through a vertex is blocked when solid edges meet at that corner on both
 * sides of the move (e.g. two diagonal pillars, or a wall corner).
 */
export function canStep(grid: Grid, from: Point, to: Point): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.max(Math.abs(dx), Math.abs(dy)) !== 1) return false;
  if (!inBounds(grid, to) || isBlockingSquare(grid, to)) return false;
  if (dy === 0) return !isWallEdge(grid, from.x, from.y, dx > 0 ? 'E' : 'W');
  if (dx === 0) return !isWallEdge(grid, from.x, from.y, dy > 0 ? 'S' : 'N');
  const vx = dx > 0 ? from.x + 1 : from.x;
  const vy = dy > 0 ? from.y + 1 : from.y;
  return !vertexSeparates(grid, { x: vx, y: vy }, { x: -dx, y: -dy }, { x: dx, y: dy });
}

/** Unit directions of the solid edges meeting at lattice vertex v. */
export function solidRaysAt(grid: Grid, v: Point): Point[] {
  const rays: Point[] = [];
  if (isSolidEdge(grid, v.x, v.y - 1, 'W')) rays.push({ x: 0, y: -1 });
  if (isSolidEdge(grid, v.x, v.y, 'W')) rays.push({ x: 0, y: 1 });
  if (isSolidEdge(grid, v.x - 1, v.y, 'N')) rays.push({ x: -1, y: 0 });
  if (isSolidEdge(grid, v.x, v.y, 'N')) rays.push({ x: 1, y: 0 });
  return rays;
}

function cross(a: Point, b: Point): number {
  return a.x * b.y - a.y * b.x;
}

/** r lies strictly inside the rotation from a to b in the positive (cross > 0) direction. */
function strictlyBetween(a: Point, b: Point, r: Point): boolean {
  const ab = cross(a, b);
  const ar = cross(a, r);
  const rb = cross(r, b);
  if (ab > 0) return ar > 0 && rb > 0;
  if (ab < 0) return !(ar <= 0 && rb <= 0);
  // a, b collinear
  if (a.x * b.x + a.y * b.y > 0) return false; // same direction: empty arc (path never turns)
  return ar > 0; // opposite: half-plane
}

/**
 * Does a path at vertex v, where `a` points back along where it came from (or into its start
 * square) and `b` points where it goes next (or into its end square), get cut by solid
 * edges? True when solid edges lie strictly on both sides (both arcs between a and b). Edges
 * collinear with the path are grazed, not crossed.
 */
export function vertexSeparates(grid: Grid, v: Point, a: Point, b: Point): boolean {
  const rays = solidRaysAt(grid, v);
  if (rays.length < 2) return false;
  return rays.some((r) => strictlyBetween(a, b, r)) && rays.some((r) => strictlyBetween(b, a, r));
}
