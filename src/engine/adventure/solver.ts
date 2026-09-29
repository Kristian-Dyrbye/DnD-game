/**
 * Adventure solver: can a hero actually reach an ending? Breadth-first search over (scene, flags)
 * states, assuming the best case — every check rolls a 20 and every encounter is won — so it finds
 * adventures that are impossible even with perfect luck (a missing exit, a flag nobody sets, a gate
 * that can never open). Used to reject broken generated side quests and as an authoring check.
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

/**
 * Searches for a path to `endingId` (or any ending when omitted). `base` is the starting game state
 * (hero, flags); it is not modified.
 */
export function solveAdventure(base: Omit<RunContext, 'rng'>, endingId?: string, limits = { depth: 30, nodes: 2000 }): SolveResult {
  const rng = new LuckyRng();
  const start = structuredClone(base.state);
  const ctx0: RunContext = { ...base, state: start, rng };
  startAdventure(ctx0);
  const key = (s: GameState) => `${getProgress(s)?.sceneId}|${JSON.stringify(Object.entries(s.flags).sort())}|${getProgress(s)?.done.length}`;
  const queue: { state: GameState; path: string[] }[] = [{ state: start, path: [] }];
  const seen = new Set([key(start)]);
  let explored = 0;
  const done = (s: GameState) => {
    const e = getProgress(s)?.ending;
    return e !== undefined && (endingId === undefined || e === endingId);
  };
  if (done(start)) return { ok: true, path: [], explored };
  while (queue.length) {
    const { state, path } = queue.shift()!;
    if (path.length >= limits.depth) continue;
    const ctx: RunContext = { ...base, state, rng };
    for (const a of availableActions(ctx)) {
      if (++explored > limits.nodes) return { ok: false, explored, reason: 'search limit reached' };
      const next = structuredClone(state);
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
