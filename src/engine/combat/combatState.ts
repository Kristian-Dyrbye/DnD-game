/**
 * Shared shapes for combat actions (Build Prompt §10): the combat state bundle (grid + turn state +
 * creatures), the action context (rng, SRD db, condition table, hostility) and the event/result
 * types every action returns. Plain data only: actions never mutate the state they are given
 * (the grid is copied before tokens move).
 */
import type { Creature } from '../core/creature';
import type { Rng } from '../core/rng';
import type { SrdDatabase } from '../data/srd';
import { loadSrd } from '../data/srdBundle';
import type { ConditionTable } from '../rules/conditions';
import type { Grid, GridToken } from './grid';
import type { Creatures, TurnState } from './turns';
import type { Zone } from './zones';

export interface CombatState {
  grid: Grid;
  turns: TurnState;
  creatures: Creatures;
  /** Persistent spell zones (Spirit Guardians, Web...), see zones.ts. */
  zones?: Zone[];
}

export interface CombatContext {
  rng: Rng;
  db?: SrdDatabase;
  table?: ConditionTable;
  /** Is `b` hostile to `a`? Default: different initiative sides (party / enemy / neutral). */
  isHostile?: (a: string, b: string) => boolean;
}

export type CombatEventKind = 'action' | 'attack' | 'damage' | 'save' | 'check' | 'condition' | 'effect' | 'move' | 'info';

export interface CombatEvent {
  kind: CombatEventKind;
  actorId?: string;
  targetId?: string;
  /** Visible line for the combat log, including the full roll math. */
  text: string;
}

export type ActionResult<X extends object = object> =
  | ({ ok: true; state: CombatState; events: CombatEvent[] } & X)
  | { ok: false; error: string; state: CombatState; events: CombatEvent[] };

export const fail = (state: CombatState, error: string, events: CombatEvent[] = []): { ok: false; error: string; state: CombatState; events: CombatEvent[] } => ({
  ok: false,
  error,
  state,
  events,
});

export const dbOf = (ctx: CombatContext): SrdDatabase => ctx.db ?? loadSrd();

export function sideOf(state: CombatState, id: string): string | undefined {
  return state.turns.order.find((e) => e.id === id)?.side;
}

/** Hostility between two combatants (ctx.isHostile, else different sides). A creature is never hostile to itself. */
export function areHostile(state: CombatState, ctx: CombatContext, a: string, b: string): boolean {
  if (a === b) return false;
  if (ctx.isHostile) return ctx.isHostile(a, b);
  const sa = sideOf(state, a);
  const sb = sideOf(state, b);
  return sa !== undefined && sb !== undefined && sa !== sb;
}

export function getCreature(state: CombatState, id: string): Creature | undefined {
  return state.creatures[id];
}

export function tokenOf(state: CombatState, id: string): GridToken | undefined {
  return state.grid.tokens[id];
}

/** Copy of the grid whose tokens can be moved without touching the original. */
export function cloneGridTokens(grid: Grid): Grid {
  return { ...grid, tokens: Object.fromEntries(Object.entries(grid.tokens).map(([k, t]) => [k, { ...t }])) };
}

export const withCreature = (state: CombatState, c: Creature): CombatState => ({ ...state, creatures: { ...state.creatures, [c.id]: c } });
