/**
 * Line of sight and cover on the battle grid (Build Prompt §10, SRD 5.2 cover + grid variant).
 *
 * Lines run between lattice points (square corners), traced with exact integer arithmetic:
 * - A line is *hard-blocked* when it passes through the interior of a blocking square, crosses a
 *   wall/closed-door edge, or passes through a vertex where solid edges lie on both sides of it
 *   (wall joints, wall corners, two pillars touching diagonally).
 * - Grazing is NOT blocking: touching a pillar corner, a free wall end, or running along a wall
 *   face does not block. A line that runs along a grid line whose end squares lie on opposite
 *   sides of it is blocked only if every unit edge it runs along is solid (no gap to slip through).
 * - The line's end points belong to a square (attacker / target square); at an end point the line
 *   must leave/enter that square without cutting through solid edges meeting at that corner.
 *
 * Cover: for every attacker corner (all corners of its footprint squares) and every target square,
 * trace lines to the target square's 4 corners. Lines hard-blocked: 0 → none, 1–2 → half,
 * 3 → three-quarters, 4 → total. Creatures (other than attacker/target/ignored) whose squares a
 * line passes through give half cover, low obstacles give their `coverObstacle` grade; per SRD only
 * the most protective source counts (max, not additive). The attacker uses the best
 * (corner, target square) pair. No unblocked line at all → no line of sight → total cover.
 */
import {
  getCell,
  isBlockingSquare,
  isSolidEdge,
  occupantsAt,
  tokenSquares,
  vertexSeparates,
  type CoverGrade,
  type Grid,
  type GridToken,
  type Point,
} from './grid';

export type { CoverGrade } from './grid';

export interface CoverResult {
  cover: CoverGrade;
  /** Bonus to AC (and Dex saves) for half / three-quarters cover. */
  acBonus: number;
  dexSaveBonus: number;
  /** False when no line reaches the target: it can't be targeted directly. */
  los: boolean;
}

export const COVER_BONUS: Record<CoverGrade, number> = { none: 0, half: 2, three_quarters: 5, total: 0 };

const COVER_RANK: Record<CoverGrade, number> = { none: 0, half: 1, three_quarters: 2, total: 3 };
const maxGrade = (a: CoverGrade, b: CoverGrade): CoverGrade => (COVER_RANK[a] >= COVER_RANK[b] ? a : b);

export interface TraceResult {
  /** Blocked by walls, closed doors or blocking squares. */
  blocked: boolean;
  /** Squares whose interior the line passes through (excluding the end squares' corners). */
  cells: Point[];
}

/** Direction from lattice point v to the centre of square `owner`, doubled to stay integral. */
function toCentre(v: Point, owner: Point): Point {
  return { x: 2 * owner.x + 1 - 2 * v.x, y: 2 * owner.y + 1 - 2 * v.y };
}

const neg = (p: Point): Point => ({ x: -p.x, y: -p.y });

/**
 * Trace the segment from lattice point `p` (a corner of square `pOwner`) to lattice point `q`
 * (a corner of square `qOwner`). Pure geometry: creatures are not considered here.
 */
export function traceLine(grid: Grid, p: Point, pOwner: Point, q: Point, qOwner: Point): TraceResult {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const cp = toCentre(p, pOwner);
  const cq = toCentre(q, qOwner);
  if (dx === 0 && dy === 0) {
    return { blocked: vertexSeparates(grid, p, cp, cq), cells: [] };
  }
  const d = { x: dx, y: dy };
  let blocked = vertexSeparates(grid, p, cp, d) || vertexSeparates(grid, q, neg(d), cq);

  // Along a grid line: no interiors crossed; check side-switching and intermediate vertices.
  if (dx === 0 || dy === 0) {
    const steps = Math.abs(dx + dy);
    const sx = Math.sign(dx);
    const sy = Math.sign(dy);
    const sideP = Math.sign(d.x * cp.y - d.y * cp.x);
    const sideQ = Math.sign(d.x * cq.y - d.y * cq.x);
    if (!blocked && sideP * sideQ < 0) {
      let allSolid = true;
      for (let i = 0; i < steps && allSolid; i++) {
        const ax = p.x + sx * i + (sx < 0 ? -1 : 0);
        const ay = p.y + sy * i + (sy < 0 ? -1 : 0);
        allSolid = dx === 0 ? isSolidEdge(grid, p.x, ay, 'W') : isSolidEdge(grid, ax, p.y, 'N');
      }
      blocked = allSolid;
    }
    for (let i = 1; i < steps && !blocked; i++) {
      blocked = vertexSeparates(grid, { x: p.x + sx * i, y: p.y + sy * i }, neg(d), d);
    }
    return { blocked, cells: [] };
  }

  // General line: crossings of vertical grid lines x = k and horizontal lines y = k.
  const ts: number[] = [0, 1];
  const loX = Math.min(p.x, q.x);
  const hiX = Math.max(p.x, q.x);
  for (let k = loX + 1; k < hiX; k++) {
    const num = (k - p.x) * dy; // y = p.y + num / dx
    ts.push((k - p.x) / dx);
    if (num % dx === 0) {
      if (!blocked) blocked = vertexSeparates(grid, { x: k, y: p.y + num / dx }, neg(d), d);
    } else if (!blocked) {
      blocked = isSolidEdge(grid, k, Math.floor(p.y + num / dx), 'W');
    }
  }
  const loY = Math.min(p.y, q.y);
  const hiY = Math.max(p.y, q.y);
  for (let k = loY + 1; k < hiY; k++) {
    const num = (k - p.y) * dx; // x = p.x + num / dy
    if (num % dy === 0) continue; // vertex, handled above
    ts.push((k - p.y) / dy);
    if (!blocked) blocked = isSolidEdge(grid, Math.floor(p.x + num / dy), k, 'N');
  }
  ts.sort((a, b) => a - b);
  const cells: Point[] = [];
  for (let i = 0; i + 1 < ts.length; i++) {
    const t0 = ts[i]!;
    const t1 = ts[i + 1]!;
    if (t1 - t0 < 1e-12) continue;
    const tm = (t0 + t1) / 2;
    const cell = { x: Math.floor(p.x + dx * tm), y: Math.floor(p.y + dy * tm) };
    cells.push(cell);
    if (!blocked && isBlockingSquare(grid, cell)) blocked = true;
  }
  return { blocked, cells };
}

type Footprint = Pick<GridToken, 'x' | 'y' | 'size'>;

interface Corner {
  point: Point;
  owner: Point;
}

/** Distinct lattice corners of a footprint, each with a footprint square that owns it. */
function footprintCorners(f: Footprint): Corner[] {
  const seen = new Map<string, Corner>();
  for (const sq of tokenSquares(f)) {
    for (const [ox, oy] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ] as const) {
      const point = { x: sq.x + ox, y: sq.y + oy };
      const k = `${point.x},${point.y}`;
      if (!seen.has(k)) seen.set(k, { point, owner: sq });
    }
  }
  return [...seen.values()];
}

function squareCorners(sq: Point): Point[] {
  return [
    { x: sq.x, y: sq.y },
    { x: sq.x + 1, y: sq.y },
    { x: sq.x, y: sq.y + 1 },
    { x: sq.x + 1, y: sq.y + 1 },
  ];
}

export interface CoverOptions {
  /** Token ids whose squares never give cover (attacker and target are always ignored). */
  ignoreIds?: readonly string[];
  /** Whether creatures in the way give half cover (default true). */
  creaturesGiveCover?: boolean;
}

/** Resolve an id or footprint; ids are looked up among the grid's tokens. */
function resolve(grid: Grid, f: string | Footprint): Footprint & { id?: string } {
  if (typeof f !== 'string') return f;
  const t = grid.tokens[f];
  if (!t) throw new Error(`Unknown token ${f}`);
  return t;
}

/** Cover granted by the soft sources (creatures, low obstacles) in the squares a line crosses. */
function softCover(grid: Grid, cells: readonly Point[], ignore: readonly string[], creatures: boolean): CoverGrade {
  let g: CoverGrade = 'none';
  for (const c of cells) {
    const obstacle = getCell(grid, c).coverObstacle;
    if (obstacle) g = maxGrade(g, obstacle);
    if (creatures && g === 'none' && occupantsAt(grid, c).some((id) => !ignore.includes(id))) g = 'half';
  }
  return g;
}

function gradeFromBlocked(n: number): CoverGrade {
  if (n <= 0) return 'none';
  if (n <= 2) return 'half';
  if (n === 3) return 'three_quarters';
  return 'total';
}

/**
 * Cover the target has against the attacker. Accepts token ids (looked up on the grid) or bare
 * footprints. The attacker's and target's own squares never give cover.
 */
export function computeCover(
  grid: Grid,
  attacker: string | Footprint,
  target: string | Footprint,
  opts: CoverOptions = {},
): CoverResult {
  const a = resolve(grid, attacker);
  const t = resolve(grid, target);
  const ignore = [...(opts.ignoreIds ?? [])];
  if (a.id) ignore.push(a.id);
  if (t.id) ignore.push(t.id);
  const creatures = opts.creaturesGiveCover ?? true;
  const ownSquares = new Set([...tokenSquares(a), ...tokenSquares(t)].map((s) => `${s.x},${s.y}`));

  let best: CoverGrade = 'total';
  for (const corner of footprintCorners(a)) {
    for (const sq of tokenSquares(t)) {
      let hard = 0;
      let soft: CoverGrade = 'none';
      for (const tc of squareCorners(sq)) {
        const r = traceLine(grid, corner.point, corner.owner, tc, sq);
        if (r.blocked) {
          hard++;
          continue;
        }
        const between = r.cells.filter((c) => !ownSquares.has(`${c.x},${c.y}`));
        soft = maxGrade(soft, softCover(grid, between, ignore, creatures));
      }
      const g = hard >= 4 ? 'total' : maxGrade(gradeFromBlocked(hard), soft);
      if (COVER_RANK[g] < COVER_RANK[best]) best = g;
      if (best === 'none') return result('none');
    }
  }
  return result(best);
}

function result(cover: CoverGrade): CoverResult {
  return { cover, acBonus: COVER_BONUS[cover], dexSaveBonus: COVER_BONUS[cover], los: cover !== 'total' };
}

/** True if at least one unblocked line joins a corner of `from` to a corner of a square of `to` (creatures ignored). */
export function hasLineOfSight(grid: Grid, from: string | Footprint, to: string | Footprint): boolean {
  const a = resolve(grid, from);
  const t = resolve(grid, to);
  for (const corner of footprintCorners(a)) {
    for (const sq of tokenSquares(t)) {
      for (const tc of squareCorners(sq)) {
        if (!traceLine(grid, corner.point, corner.owner, tc, sq).blocked) return true;
      }
    }
  }
  return false;
}
