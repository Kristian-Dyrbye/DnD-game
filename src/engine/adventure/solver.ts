/**
 * Adventure solver: can a hero actually reach an ending? Breadth-first search over (scene, flags)
 * states, assuming the best case — every check rolls a 20 and every encounter is won — so it finds
 * adventures that are impossible even with perfect luck (a missing exit, a flag nobody sets, a gate
 * that can never open). Used to reject broken generated side quests and as an authoring check.
 * Hot path: states are copied with clonePlain (not structuredClone) and the queue is an array with a
 * cursor; the runner caches scene lookups and flag defaults for it.
 */
import { Rng } from '../core/rng';
import type { GameState } from '../session/gameState';
import { availableActions, getProgress, perform, resolveEncounter, startAdventure, type RunContext } from './runner';

/** An Rng that always rolls the maximum: checks succeed unless they can't possibly. */
export class LuckyRng extends Rng {
  constructor() {
    super([1, 2, 3, 4]);
  }
  override next(): number {
    return 0.999999;
  }
}

export interface SolveResult {
  ok: boolean;
  /** Action ids of a winning path (when ok). */
  path?: string[];
  explored: number;
  reason?: string;
}

/** Deep copy of plain JSON-like data (GameState is saved as JSON); much faster than structuredClone. */
export function clonePlain<T>(v: T): T {
  if (typeof v !== 'object' || v === null) return v;
  if (Array.isArray(v)) {
    const arr = new Array(v.length);
    for (let i = 0; i < v.length; i++) arr[i] = clonePlain(v[i]);
    return arr as T;
  }
  if (Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) return structuredClone(v);
  const src = v as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(src)) out[k] = clonePlain(src[k]);
  return out as T;
}

function flagsKey(flags: GameState['flags']): string {
  const keys = Object.keys(flags).sort();
  let s = '';
  for (const k of keys) s += `${k}=${typeof flags[k] === 'string' ? JSON.stringify(flags[k]) : String(flags[k])};`;
  return s;
}

type Node = { state: GameState; path: string[] };

/**
 * Searches for a path to `endingId` (or any ending when omitted). `base` is the starting game state
 * (hero, flags); it is not modified.
 */
export function solveAdventure(base: Omit<RunContext, 'rng'>, endingId?: string, limits = { depth: 30, nodes: 2000 }): SolveResult {
  const rng = new LuckyRng();
  const start = clonePlain(base.state);
  const ctx0: RunContext = { ...base, state: start, rng };
  startAdventure(ctx0);
  const key = (s: GameState) => {
    const p = getProgress(s);
    // An open conversation is part of the position (its node and used once-per-talk options).
    const talk = p?.talk ? `${p.talk.npc}.${p.talk.conversation}.${p.talk.node}.${p.talk.chosen.join(',')}` : '';
    return `${p?.sceneId}|${flagsKey(s.flags)}|${p?.done.length}|${talk}`;
  };
  // FIFO queue; a cursor instead of shift() (O(n) on big queues).
  const queue: Node[] = [{ state: start, path: [] }];
  let head = 0;
  const seen = new Set([key(start)]);
  let explored = 0;
  const done = (s: GameState) => {
    const e = getProgress(s)?.ending;
    return e !== undefined && (endingId === undefined || e === endingId);
  };
  if (done(start)) return { ok: true, path: [], explored };
  while (head < queue.length) {
    const { state, path } = queue[head]!;
    queue[head++] = undefined as unknown as Node; // let processed states be collected
    if (path.length >= limits.depth) continue;
    const ctx: RunContext = { ...base, state, rng };
    for (const a of availableActions(ctx)) {
      if (++explored > limits.nodes) return { ok: false, explored, reason: 'search limit reached' };
      const next = clonePlain(state);
      const c: RunContext = { ...base, state: next, rng };
      let r = perform(c, a.id);
      // Win every fight (chained fights too).
      for (let guard = 0; r.encounter && guard < 5; guard++) r = resolveEncounter(c, r.encounter, 'win');
      if (done(next)) return { ok: true, path: [...path, a.id], explored };
      if (getProgress(next)?.ending) continue; // a different ending: dead end for this search
      const k = key(next);
      if (seen.has(k)) continue;
      seen.add(k);
      queue.push({ state: next, path: [...path, a.id] });
    }
  }
  return { ok: false, explored, reason: endingId ? `ending "${endingId}" is unreachable` : 'no ending is reachable' };
}
