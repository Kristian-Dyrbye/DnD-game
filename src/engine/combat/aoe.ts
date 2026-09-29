/**
 * Area-of-effect templates on the battle grid (Build Prompt §10; SRD 5.2.1 Rules Glossary "Area of
 * Effect", "Cone", "Cube", "Cylinder", "Emanation", "Line", "Sphere"). Pure: no side effects, so the
 * same calls drive the battle-map preview overlay and the actual resolution (aoeResolve.ts).
 *
 * Geometry works in grid units (1 = 5 ft; square (x, y) covers [x, x+1] × [y, y+1]). The origin is
 * any point: a lattice point (square corner), an edge midpoint or a square centre.
 * - Sphere / Cylinder: centred on the origin (a Cylinder's height is ignored on the flat map).
 * - Emanation: extends from the anchor creature's footprint and so moves with it; the anchor itself
 *   isn't included unless `includeOrigin`.
 * - Cone: along `direction`; its width at distance t along the axis is t (SRD), up to `sizeFt` long.
 * - Line: `sizeFt` long, `widthFt` wide (default 5), centred on the axis.
 * - Cube: the origin lies on the near face (centred, or shifted sideways by `offsetFt`), side `sizeFt`.
 *
 * Grid rules (the SRD gives none for areas, so we use the common grid convention and document it):
 * - Radial shapes (Sphere, Cylinder, Emanation) use `metric` 'grid' by default: a square is in the
 *   area when its centre is within the radius counted in squares (Chebyshev, every square 5 ft incl.
 *   diagonals, matching the SRD grid rule for ranges), so a 20-ft Fireball from an intersection is
 *   8×8 squares and a 15-ft Emanation around a Medium creature 7×7. 'euclidean' gives true circles.
 * - Otherwise (Cones, Lines, Cubes, euclidean circles: exact geometry) a square is in the area when
 *   at least half of it is covered (sampled on a 4×4 sub-grid). Cone/Line lengths are true lengths,
 *   so a diagonal 30-ft Line covers 4 squares.
 * - Line of effect (SRD): "If all straight lines extending from the point of origin to a location in
 *   the area of effect are blocked, that location isn't included". Lines are traced with los.ts
 *   `traceLine` from the origin (or the nearest corners of the origin square) to each square's
 *   corners; walls, closed doors and blocking squares block, creatures don't. Blocking squares are
 *   never in the area.
 * - A creature is affected when any square of its footprint is in the area.
 */
import type { Area } from '../data/common';
import { footprintSize, inBounds, isBlockingSquare, tokenSquares, type Grid, type Point } from './grid';
import { traceLine } from './los';

export type AoeShape = Area['shape'];
export type AoeMetric = 'grid' | 'euclidean';

export interface AoeTemplate {
  shape: AoeShape;
  /** Radius (sphere, cylinder, emanation), side (cube) or length (cone, line), in feet. */
  sizeFt: number;
  /** Line width in feet (default 5). */
  widthFt?: number;
  /** Cylinder height in feet (informational; the map is flat). */
  heightFt?: number;
  /** Point of origin in grid units (unused for emanations, which use the anchor's footprint). */
  origin: Point;
  /** Aim vector for cone / line / cube (any length, not zero). */
  direction?: Point;
  /** Square the effect comes from, for line-of-effect tracing (e.g. the caster's square for a cone "from you"). */
  originSquare?: Point;
  /** Emanation: token id of the creature/object it extends from. */
  anchorId?: string;
  /** Include the origin creature (emanation) — the SRD lets the creator decide. */
  includeOrigin?: boolean;
  /** Cube: shift of the cube to the right of `direction` (screen, y down), in feet; the origin stays on the near face (±sizeFt/2). */
  offsetFt?: number;
  /** Distance rule for radial shapes (default 'grid'). */
  metric?: AoeMetric;
}

export interface AoePreview {
  /** Squares in the area (for highlighting), sorted by row then column. */
  squares: Point[];
  /** Squares inside the shape that line of effect doesn't reach (e.g. behind a wall). */
  blocked: Point[];
  /** Tokens with at least one footprint square in the area. */
  creatureIds: string[];
}

const EPS = 1e-9;
const SAMPLES = [0.125, 0.375, 0.625, 0.875];

// ---------------------------------------------------------------- template construction

export interface TemplatePlacement {
  origin?: Point;
  /** Aim point (grid units) for cone / line / cube; direction = aim − origin. */
  aim?: Point;
  direction?: Point;
  originSquare?: Point;
  anchorId?: string;
  includeOrigin?: boolean;
  offsetFt?: number;
  metric?: AoeMetric;
}

/** Map a spell/feature `area` (data AreaSchema) plus a placement to a template. */
export function templateFromArea(area: Area, p: TemplatePlacement): AoeTemplate {
  const origin = p.origin ?? { x: 0, y: 0 };
  const direction = p.direction ?? (p.aim ? { x: p.aim.x - origin.x, y: p.aim.y - origin.y } : undefined);
  return {
    shape: area.shape,
    sizeFt: area.size,
    ...(area.shape === 'line' && { widthFt: area.width ?? 5 }),
    ...(area.shape === 'cylinder' && area.width !== undefined && { heightFt: area.width }),
    origin,
    ...(direction && { direction }),
    ...(p.originSquare && { originSquare: p.originSquare }),
    ...(p.anchorId !== undefined && { anchorId: p.anchorId }),
    ...(p.includeOrigin !== undefined && { includeOrigin: p.includeOrigin }),
    ...(p.offsetFt !== undefined && { offsetFt: p.offsetFt }),
    ...(p.metric && { metric: p.metric }),
  };
}

/**
 * A template that comes "from you" (Burning Hands, Thunderwave, Lightning Bolt, Spirit Guardians):
 * cones / lines / cubes start where the ray from the caster's centre towards `aim` leaves its
 * footprint (edge midpoint when aiming straight, corner when aiming diagonally); emanations anchor
 * on the caster; spheres / cylinders are centred on the caster.
 */
export function templateFromCaster(grid: Grid, casterId: string, area: Area, aim?: Point, extra: Omit<TemplatePlacement, 'origin' | 'aim' | 'direction' | 'originSquare' | 'anchorId'> = {}): AoeTemplate {
  const t = grid.tokens[casterId];
  if (!t) throw new Error(`Unknown token ${casterId}`);
  const n = footprintSize(t.size);
  const c = { x: t.x + n / 2, y: t.y + n / 2 };
  if (area.shape === 'emanation') return templateFromArea(area, { ...extra, origin: c, anchorId: casterId });
  if (area.shape === 'sphere' || area.shape === 'cylinder') return templateFromArea(area, { ...extra, origin: c });
  if (!aim) throw new Error(`A ${area.shape} needs an aim point`);
  const d = { x: aim.x - c.x, y: aim.y - c.y };
  const m = Math.max(Math.abs(d.x), Math.abs(d.y));
  if (m < EPS) throw new Error('Aim point is the caster itself');
  const s = n / 2 / m;
  const origin = { x: c.x + d.x * s, y: c.y + d.y * s };
  const clamp = (v: number, lo: number) => Math.min(lo + n - 1, Math.max(lo, Math.floor(v)));
  const originSquare = { x: clamp(origin.x - d.x * 1e-6, t.x), y: clamp(origin.y - d.y * 1e-6, t.y) };
  return templateFromArea(area, { ...extra, origin, direction: d, originSquare });
}

// ---------------------------------------------------------------- shape predicates

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function anchorBox(grid: Grid, tpl: AoeTemplate): Box {
  const id = tpl.anchorId;
  const t = id !== undefined ? grid.tokens[id] : undefined;
  if (!t) {
    if (id !== undefined) throw new Error(`Unknown token ${id}`);
    return { x0: tpl.origin.x, y0: tpl.origin.y, x1: tpl.origin.x, y1: tpl.origin.y };
  }
  const n = footprintSize(t.size);
  return { x0: t.x, y0: t.y, x1: t.x + n, y1: t.y + n };
}

function unit(d: Point | undefined, shape: AoeShape): Point {
  if (!d) throw new Error(`A ${shape} needs a direction`);
  const len = Math.hypot(d.x, d.y);
  if (len < EPS) throw new Error(`A ${shape} needs a non-zero direction`);
  return { x: d.x / len, y: d.y / len };
}

/** Point-in-shape test, a bounding box to scan, and whether squares are judged by their centre. */
function shapeOf(grid: Grid, tpl: AoeTemplate): { inside: (px: number, py: number) => boolean; box: Box; byCentre?: boolean } {
  const r = tpl.sizeFt / 5;
  const o = tpl.origin;
  const euclid = tpl.metric === 'euclidean';
  const dist = (dx: number, dy: number) => (euclid ? Math.hypot(dx, dy) : Math.max(Math.abs(dx), Math.abs(dy)));
  switch (tpl.shape) {
    case 'sphere':
    case 'cylinder':
      return { inside: (px, py) => dist(px - o.x, py - o.y) <= r + EPS, box: { x0: o.x - r, y0: o.y - r, x1: o.x + r, y1: o.y + r }, byCentre: !euclid };
    case 'emanation': {
      const b = anchorBox(grid, tpl);
      return {
        inside: (px, py) => dist(Math.max(0, b.x0 - px, px - b.x1), Math.max(0, b.y0 - py, py - b.y1)) <= r + EPS,
        box: { x0: b.x0 - r, y0: b.y0 - r, x1: b.x1 + r, y1: b.y1 + r },
        byCentre: !euclid,
      };
    }
    case 'cone':
    case 'line':
    case 'cube': {
      const u = unit(tpl.direction, tpl.shape);
      const half = tpl.shape === 'line' ? (tpl.widthFt ?? 5) / 10 : r / 2;
      const shift = tpl.shape === 'cube' ? (tpl.offsetFt ?? 0) / 5 : 0;
      const inside = (px: number, py: number): boolean => {
        const vx = px - o.x;
        const vy = py - o.y;
        const t = vx * u.x + vy * u.y;
        const s = vx * u.y - vy * u.x; // signed perpendicular distance
        if (t < -EPS || t > r + EPS) return false;
        if (tpl.shape === 'cone') return t > EPS && Math.abs(s) <= t / 2 + EPS;
        return Math.abs(s + shift) <= half + EPS;
      };
      const reach = r + half + Math.abs(shift);
      return { inside, box: { x0: o.x - reach, y0: o.y - reach, x1: o.x + reach, y1: o.y + reach } };
    }
  }
}

// ---------------------------------------------------------------- line of effect

interface Start {
  point: Point;
  owner: Point;
}

const isLattice = (p: Point) => Number.isInteger(p.x) && Number.isInteger(p.y);

function cornersOf(sq: Point): Point[] {
  return [
    { x: sq.x, y: sq.y },
    { x: sq.x + 1, y: sq.y },
    { x: sq.x, y: sq.y + 1 },
    { x: sq.x + 1, y: sq.y + 1 },
  ];
}

/** Lattice points (with the square they belong to) that line-of-effect lines start from. */
function startsOf(grid: Grid, tpl: AoeTemplate): Start[] {
  if (tpl.shape === 'emanation' && tpl.anchorId !== undefined) {
    const t = grid.tokens[tpl.anchorId];
    if (t) return tokenSquares(t).flatMap((sq) => cornersOf(sq).map((point) => ({ point, owner: sq })));
  }
  const o = tpl.origin;
  const nearest = (owner: Point): Start[] => {
    const cs = cornersOf(owner);
    const d = cs.map((c) => Math.hypot(c.x - o.x, c.y - o.y));
    const min = Math.min(...d);
    return cs.filter((_, i) => d[i]! <= min + EPS).map((point) => ({ point, owner }));
  };
  if (tpl.originSquare) return nearest(tpl.originSquare);
  if (isLattice(o)) {
    return [
      { x: o.x - 1, y: o.y - 1 },
      { x: o.x, y: o.y - 1 },
      { x: o.x - 1, y: o.y },
      { x: o.x, y: o.y },
    ]
      .filter((sq) => inBounds(grid, sq) && !isBlockingSquare(grid, sq))
      .map((owner) => ({ point: { ...o }, owner }));
  }
  return nearest({ x: Math.floor(o.x), y: Math.floor(o.y) });
}

function reachable(grid: Grid, starts: readonly Start[], sq: Point): boolean {
  for (const s of starts) {
    if (s.owner.x === sq.x && s.owner.y === sq.y) return true;
    for (const c of cornersOf(sq)) if (!traceLine(grid, s.point, s.owner, c, sq).blocked) return true;
  }
  return false;
}

/** True if an unblocked straight line joins the template's origin to square `sq`. */
export function hasLineOfEffect(grid: Grid, tpl: AoeTemplate, sq: Point): boolean {
  return reachable(grid, startsOf(grid, tpl), sq);
}

// ---------------------------------------------------------------- squares and creatures

function coverage(inside: (px: number, py: number) => boolean, sq: Point): number {
  let n = 0;
  for (const a of SAMPLES) for (const b of SAMPLES) if (inside(sq.x + a, sq.y + b)) n++;
  return n / (SAMPLES.length * SAMPLES.length);
}

/** Squares covered by the shape (≥ half), before line of effect; blocking squares and the emanation anchor excluded. */
export function shapeSquares(grid: Grid, tpl: AoeTemplate): Point[] {
  const { inside, box, byCentre } = shapeOf(grid, tpl);
  const anchor = tpl.shape === 'emanation' && !tpl.includeOrigin && tpl.anchorId !== undefined ? grid.tokens[tpl.anchorId] : undefined;
  const own = new Set(anchor ? tokenSquares(anchor).map((s) => `${s.x},${s.y}`) : []);
  const out: Point[] = [];
  const x0 = Math.max(0, Math.floor(box.x0) - 1);
  const y0 = Math.max(0, Math.floor(box.y0) - 1);
  const x1 = Math.min(grid.width - 1, Math.ceil(box.x1) + 1);
  const y1 = Math.min(grid.height - 1, Math.ceil(box.y1) + 1);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const sq = { x, y };
      if (own.has(`${x},${y}`) || isBlockingSquare(grid, sq)) continue;
      if (byCentre ? inside(x + 0.5, y + 0.5) : coverage(inside, sq) >= 0.5) out.push(sq);
    }
  }
  return out;
}

/** Full preview: area squares, squares cut off by walls, and affected creatures. */
export function previewArea(grid: Grid, tpl: AoeTemplate, opts: { excludeIds?: readonly string[] } = {}): AoePreview {
  const starts = startsOf(grid, tpl);
  const squares: Point[] = [];
  const blocked: Point[] = [];
  for (const sq of shapeSquares(grid, tpl)) (reachable(grid, starts, sq) ? squares : blocked).push(sq);
  const set = new Set(squares.map((s) => `${s.x},${s.y}`));
  const exclude = new Set(opts.excludeIds ?? []);
  if (tpl.shape === 'emanation' && !tpl.includeOrigin && tpl.anchorId !== undefined) exclude.add(tpl.anchorId);
  const creatureIds = Object.values(grid.tokens)
    .filter((t) => !exclude.has(t.id) && tokenSquares(t).some((s) => set.has(`${s.x},${s.y}`)))
    .map((t) => t.id);
  return { squares, blocked, creatureIds };
}

/** Squares in the area (shape ∩ line of effect). */
export function affectedSquares(grid: Grid, tpl: AoeTemplate): Point[] {
  return previewArea(grid, tpl).squares;
}

/** Token ids with any footprint square in the area (the emanation's anchor only with includeOrigin). */
export function affectedCreatures(grid: Grid, tpl: AoeTemplate, opts: { excludeIds?: readonly string[] } = {}): string[] {
  return previewArea(grid, tpl, opts).creatureIds;
}
