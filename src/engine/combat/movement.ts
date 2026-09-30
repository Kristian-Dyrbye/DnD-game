/**
 * Grid movement and opportunity-attack triggers (Build Prompt §10, SRD 5.2.1 "Movement and
 * Position", "Moving around Other Creatures", "Opportunity Attacks", Crawling, Prone).
 *
 * Costs (every square is 5 ft, diagonals included):
 * - Entering a square costs 5 ft, +5 if it is Difficult Terrain. For multi-square creatures the
 *   step is difficult if ANY newly occupied square is. Difficult Terrain is not cumulative.
 * - Another creature's space is Difficult Terrain unless that creature is Tiny or your ally.
 * - Crawling (Prone) adds +5 per square (+10 in Difficult Terrain): 10 ft normal, 15 ft difficult.
 * - You may pass through the space of an ally, an Incapacitated creature, a Tiny creature, or a
 *   creature two or more sizes larger/smaller than you; you can never end a move in another
 *   creature's space.
 *
 * Opportunity attacks: a hostile creature whose reach contained the mover before a step and not
 * after it gets a trigger for that step (the attack happens *before* the step, with the mover
 * still at `step.from`). No triggers when the mover Disengaged or the movement is forced /
 * teleportation. Attacks are never rolled here.
 *
 * Execution design: `planMove` is pure (validates a path, costs it, lists triggers). `moveAlong`
 * executes a plan step by step through `moveToken`, calling `beforeStep` with the triggers that
 * fire for that step; the caller resolves the attacks there and may return false to halt (e.g.
 * the mover dropped to 0 HP or its speed became 0). `canReact` is re-checked at execution time,
 * so an attacker that has spent its reaction stops generating triggers.
 */
import { SIZES, type Size } from '../rules/basics';
import type { Creature } from '../core/creature';
import { ENGLISH_MESSAGES, type Messages } from '../i18n';
import { effectiveSpeed, type ConditionTable } from '../rules/conditions';
import { canPlace, canStep, cellKey, footprintSize, isDifficult, moveToken, withinReach, type Grid, type GridToken, type Point } from './grid';

// ---------------------------------------------------------------- budget

export type MoveMode = 'walk' | 'fly' | 'swim' | 'climb' | 'burrow';

export interface BudgetOptions {
  mode?: MoveMode;
  /** Number of Dash actions taken this turn (each adds the current Speed). */
  dashes?: number;
  table?: ConditionTable;
}

/**
 * Feet of movement available this turn: current Speed for the mode (after conditions, exhaustion
 * and effects; 0 when Grappled/Restrained/etc.) × (1 + dashes). A mode the creature lacks gives 0.
 */
export function movementBudget(c: Creature, opts: BudgetOptions = {}): number {
  const mode = opts.mode ?? 'walk';
  const base = mode === 'walk' ? c.speed.walk : (c.speed[mode] ?? 0);
  if (base <= 0) return 0;
  return effectiveSpeed(c, opts.table, base) * (1 + Math.max(0, opts.dashes ?? 0));
}

/** Movement spent to stand up from Prone: half Speed rounded down; null if Speed is 0 (can't stand). */
export function standUpCost(c: Creature, table?: ConditionTable): number | null {
  const speed = effectiveSpeed(c, table);
  return speed <= 0 ? null : Math.floor(speed / 2);
}

// ---------------------------------------------------------------- pathing

export interface PathOptions {
  /** Is `otherId` hostile to `moverId`? Default: every other creature is hostile. */
  isHostile?: (moverId: string, otherId: string) => boolean;
  /** Incapacitated creatures can be moved through. Default: none are. */
  isIncapacitated?: (id: string) => boolean;
  /** Mover is Prone and crawling (+5 ft per square). */
  crawling?: boolean;
  /** Token ids ignored entirely (swarms, corpses, the grappled creature being dragged...). */
  ignore?: readonly string[];
}

export interface ReachableSquare {
  x: number;
  y: number;
  costFt: number;
  /** Top-left positions entered, excluding the start, ending at this square. */
  path: Point[];
}

const DIRS: readonly Point[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 1, y: -1 },
  { x: 1, y: 1 },
  { x: -1, y: 1 },
  { x: -1, y: -1 },
];

const sizeIndex = (s: Size): number => SIZES.indexOf(s);

interface Mover {
  token: GridToken;
  others: GridToken[];
  opts: PathOptions;
}

function moverOf(grid: Grid, tokenId: string, opts: PathOptions): Mover {
  const token = grid.tokens[tokenId];
  if (!token) throw new Error(`Unknown token ${tokenId}`);
  const ignore = new Set(opts.ignore ?? []);
  const others = Object.values(grid.tokens).filter((t) => t.id !== tokenId && !ignore.has(t.id));
  return { token, others, opts };
}

const hostile = (m: Mover, otherId: string): boolean => m.opts.isHostile?.(m.token.id, otherId) ?? true;

function overlaps(a: Pick<GridToken, 'x' | 'y' | 'size'>, b: Pick<GridToken, 'x' | 'y' | 'size'>): boolean {
  const na = footprintSize(a.size);
  const nb = footprintSize(b.size);
  return a.x < b.x + nb && b.x < a.x + na && a.y < b.y + nb && b.y < a.y + na;
}

/**
 * Cost in feet for the mover to shift its footprint from top-left `from` to adjacent `to`,
 * or null when the step is impossible (wall, blocking square, off-grid, impassable creature).
 */
function stepCost(grid: Grid, m: Mover, from: Point, to: Point): number | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const n = footprintSize(m.token.size);
  let difficult = false;
  for (let oy = 0; oy < n; oy++) {
    for (let ox = 0; ox < n; ox++) {
      const q = { x: from.x + ox, y: from.y + oy };
      const r = { x: q.x + dx, y: q.y + dy };
      if (!canStep(grid, q, r)) return null;
      if (isDifficult(grid, r)) difficult = true;
    }
  }
  const footprint = { x: to.x, y: to.y, size: m.token.size };
  for (const o of m.others) {
    if (!overlaps(footprint, o)) continue;
    const ally = !hostile(m, o.id);
    const tiny = o.size === 'tiny';
    const passable =
      ally ||
      tiny ||
      (m.opts.isIncapacitated?.(o.id) ?? false) ||
      Math.abs(sizeIndex(o.size) - sizeIndex(m.token.size)) >= 2;
    if (!passable) return null;
    if (!ally && !tiny) difficult = true;
  }
  return 5 + (difficult ? 5 : 0) + (m.opts.crawling ? 5 : 0);
}

function canEnd(grid: Grid, m: Mover, p: Point): boolean {
  return canPlace(grid, m.token.size, p, [m.token.id, ...(m.opts.ignore ?? [])]);
}

/**
 * All squares (top-left positions) the token can end a move on within `budgetFt`, with the
 * cheapest cost and path (Dijkstra over 8-neighbour steps). The start square is not included.
 */
export function reachableSquares(
  grid: Grid,
  tokenId: string,
  budgetFt: number,
  opts: PathOptions = {},
): Map<string, ReachableSquare> {
  const m = moverOf(grid, tokenId, opts);
  const start: Point = { x: m.token.x, y: m.token.y };
  const best = new Map<string, { cost: number; prev: string | null; p: Point }>();
  best.set(cellKey(start), { cost: 0, prev: null, p: start });
  // Bucket queue: all costs are multiples of 5.
  const buckets: Point[][] = [[start]];
  for (let b = 0; b < buckets.length; b++) {
    const bucket = buckets[b];
    if (!bucket) continue;
    for (let i = 0; i < bucket.length; i++) {
      const p = bucket[i] as Point;
      const cur = best.get(cellKey(p));
      if (!cur || cur.cost !== b * 5) continue; // stale entry
      for (const d of DIRS) {
        const q = { x: p.x + d.x, y: p.y + d.y };
        const c = stepCost(grid, m, p, q);
        if (c === null) continue;
        const cost = cur.cost + c;
        if (cost > budgetFt) continue;
        const key = cellKey(q);
        const old = best.get(key);
        if (old && old.cost <= cost) continue;
        best.set(key, { cost, prev: cellKey(p), p: q });
        (buckets[cost / 5] ??= []).push(q);
      }
    }
  }
  const out = new Map<string, ReachableSquare>();
  for (const [key, node] of best) {
    if (node.prev === null || !canEnd(grid, m, node.p)) continue;
    const path: Point[] = [];
    let k: string | null = key;
    while (k !== null) {
      const n = best.get(k);
      if (!n || n.prev === null) break;
      path.push(n.p);
      k = n.prev;
    }
    path.reverse();
    out.set(key, { x: node.p.x, y: node.p.y, costFt: node.cost, path });
  }
  return out;
}

// ---------------------------------------------------------------- moving + opportunity attacks

export interface MoveContext extends PathOptions {
  /** Movement left this turn; ignored for forced movement. */
  budgetFt: number;
  /** Took the Disengage action this turn: no opportunity attacks. */
  disengaged?: boolean;
  /** Pushed/pulled/hurled (not using own movement): no budget use, no opportunity attacks. */
  forced?: boolean;
  /** Reach in feet an attacker uses for opportunity attacks. Default 5. */
  reachOf?: (id: string) => number;
  /** Can this creature take a reaction now (reaction unused, not Incapacitated...)? Default true. */
  canReact?: (id: string) => boolean;
  /** Can the attacker see the mover? Opportunity attacks need sight. Default true. */
  canSee?: (attackerId: string, targetId: string) => boolean;
  /** Language of the error texts (default English). */
  msgs?: Messages;
}

export interface MoveStep {
  from: Point;
  to: Point;
  costFt: number;
  /** Total cost after this step. */
  totalFt: number;
}

export interface OpportunityTrigger {
  attackerId: string;
  targetId: string;
  /** Index into the plan's steps: the attack happens before this step, mover at step.from. */
  atStep: number;
}

export interface MovePlan {
  ok: boolean;
  error?: string;
  steps: MoveStep[];
  costFt: number;
  triggers: OpportunityTrigger[];
}

function stepTriggers(m: Mover, ctx: MoveContext, from: Point, to: Point, atStep: number): OpportunityTrigger[] {
  if (ctx.disengaged || ctx.forced) return [];
  const id = m.token.id;
  const size = m.token.size;
  const before = { x: from.x, y: from.y, size };
  const after = { x: to.x, y: to.y, size };
  const out: OpportunityTrigger[] = [];
  for (const o of m.others) {
    if (!hostile(m, o.id)) continue;
    const reach = ctx.reachOf?.(o.id) ?? 5;
    if (!withinReach(o, before, reach) || withinReach(o, after, reach)) continue;
    if (ctx.canReact && !ctx.canReact(o.id)) continue;
    if (ctx.canSee && !ctx.canSee(o.id, id)) continue;
    out.push({ attackerId: o.id, targetId: id, atStep });
  }
  return out;
}

/** Validate and cost a path (top-left positions, excluding the start). Pure: the grid is untouched. */
export function planMove(grid: Grid, tokenId: string, path: readonly Point[], ctx: MoveContext): MovePlan {
  const m = moverOf(grid, tokenId, ctx);
  const steps: MoveStep[] = [];
  const triggers: OpportunityTrigger[] = [];
  let at: Point = { x: m.token.x, y: m.token.y };
  let total = 0;
  const fail = (error: string): MovePlan => ({ ok: false, error, steps, costFt: total, triggers });
  const msg = (ctx.msgs ?? ENGLISH_MESSAGES).m;
  for (const [i, to] of path.entries()) {
    const cost = stepCost(grid, m, at, to);
    if (cost === null) return fail(msg('move.blocked', { i, x: to.x, y: to.y }));
    if (!ctx.forced && total + cost > ctx.budgetFt) return fail(msg('move.tooFar', { i }));
    triggers.push(...stepTriggers(m, ctx, at, to, i));
    total += cost;
    steps.push({ from: at, to, costFt: cost, totalFt: total });
    at = to;
  }
  if (steps.length > 0 && !canEnd(grid, m, at)) return fail(msg('move.cantEnd', { x: at.x, y: at.y }));
  return { ok: true, steps, costFt: total, triggers };
}

export interface MoveResult {
  ok: boolean;
  error?: string;
  /** Steps actually taken. */
  stepsTaken: number;
  costFt: number;
  /** Triggers that fired (after the live canReact / canSee re-check), in order. */
  triggers: OpportunityTrigger[];
  /** Movement stopped early by `beforeStep`. */
  halted: boolean;
  position: Point;
}

/**
 * Plan and execute a move. For each step, fires the step's opportunity triggers (re-checking
 * `canReact`/`canSee` live) through `beforeStep`; returning false halts with the mover at
 * `step.from`. Note a halt may leave the mover mid-path in a pass-through space; the caller
 * handles that (SRD: ending a turn in another creature's space → Prone unless Tiny/larger).
 */
export function moveAlong(
  grid: Grid,
  tokenId: string,
  path: readonly Point[],
  ctx: MoveContext & { beforeStep?: (step: MoveStep, index: number, triggers: OpportunityTrigger[]) => boolean },
): MoveResult {
  const plan = planMove(grid, tokenId, path, ctx);
  const token = grid.tokens[tokenId] as GridToken;
  const start = { x: token.x, y: token.y };
  if (!plan.ok) {
    return { ok: false, ...(plan.error && { error: plan.error }), stepsTaken: 0, costFt: 0, triggers: [], halted: false, position: start };
  }
  const fired: OpportunityTrigger[] = [];
  let spent = 0;
  for (const [i, step] of plan.steps.entries()) {
    const now = plan.triggers.filter(
      (t) =>
        t.atStep === i &&
        (ctx.canReact?.(t.attackerId) ?? true) &&
        (ctx.canSee?.(t.attackerId, t.targetId) ?? true),
    );
    fired.push(...now);
    if (ctx.beforeStep && !ctx.beforeStep(step, i, now)) {
      return { ok: true, stepsTaken: i, costFt: spent, triggers: fired, halted: true, position: { ...step.from } };
    }
    if (!grid.tokens[tokenId]) {
      return { ok: true, stepsTaken: i, costFt: spent, triggers: fired, halted: true, position: { ...step.from } };
    }
    moveToken(grid, tokenId, step.to);
    spent = step.totalFt;
  }
  const last = plan.steps[plan.steps.length - 1];
  return { ok: true, stepsTaken: plan.steps.length, costFt: spent, triggers: fired, halted: false, position: last ? { ...last.to } : start };
}

/** Teleport: no path, no movement cost, never provokes. Fails if the destination can't hold the token. */
export function teleport(grid: Grid, tokenId: string, dest: Point, ignore: readonly string[] = []): boolean {
  const t = grid.tokens[tokenId];
  if (!t || !canPlace(grid, t.size, dest, [tokenId, ...ignore])) return false;
  moveToken(grid, tokenId, dest);
  return true;
}
