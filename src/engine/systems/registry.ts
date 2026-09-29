/**
 * System Registry — the engine's extension point (ARCHITECTURE.md §6). A system is a plain object
 * with an id, a version and optional hooks. It owns `state.extensions[id]` (initialised and
 * migrated here) and reacts to time passing and rests. Built-in systems (clock now; weather,
 * factions, shops, companions later) and future ones (crafting, home base) plug in the same way.
 */
import type { GameState } from '../session/gameState';

export interface SystemEvent {
  systemId: string;
  text: string;
  kind?: 'info' | 'warning';
}

export type RestKind = 'short' | 'long';

export interface GameSystem<S = unknown> {
  id: string;
  version: number;
  /** Initial `state.extensions[id]` for a new campaign (or a save made before the system existed). */
  initState?(state: GameState): S;
  /** Upgrades saved data from an older system version. */
  migrate?(data: unknown, fromVersion: number): S;
  /** Called after the clock moved from `from` to `to` (minutes). */
  onTimeAdvance?(state: GameState, from: number, to: number): SystemEvent[];
  onRest?(state: GameState, kind: RestKind): SystemEvent[];
}

/** Where system versions are recorded inside `state.extensions`. */
export const VERSIONS_KEY = '_systemVersions';

export class SystemRegistry {
  private readonly systems = new Map<string, GameSystem>();

  register(system: GameSystem<never> | GameSystem): this {
    if (this.systems.has(system.id)) throw new Error(`System "${system.id}" is already registered`);
    if (system.id === VERSIONS_KEY) throw new Error('Reserved system id');
    this.systems.set(system.id, system as GameSystem);
    return this;
  }

  get(id: string): GameSystem | undefined {
    return this.systems.get(id);
  }

  list(): GameSystem[] {
    return [...this.systems.values()];
  }

  /** Initialises missing system state and migrates old versions. Call on new game and on load. */
  init(state: GameState): void {
    const versions = ((state.extensions[VERSIONS_KEY] as Record<string, number> | undefined) ?? {}) as Record<string, number>;
    for (const sys of this.systems.values()) {
      const saved = versions[sys.id];
      if (state.extensions[sys.id] === undefined) {
        if (sys.initState) state.extensions[sys.id] = sys.initState(state);
      } else if (saved !== undefined && saved < sys.version && sys.migrate) {
        state.extensions[sys.id] = sys.migrate(state.extensions[sys.id], saved);
      }
      versions[sys.id] = sys.version;
    }
    state.extensions[VERSIONS_KEY] = versions;
  }

  /** Moves the clock forward and lets every system react. */
  advanceTime(state: GameState, minutes: number): SystemEvent[] {
    if (minutes <= 0) return [];
    const from = state.time;
    state.time += Math.round(minutes);
    return this.timeAdvanced(state, from, state.time);
  }

  /** For code that already moved `state.time` (e.g. adventure outcomes): notify systems. */
  timeAdvanced(state: GameState, from: number, to: number): SystemEvent[] {
    if (to <= from) return [];
    return this.list().flatMap((s) => s.onTimeAdvance?.(state, from, to) ?? []);
  }

  rest(state: GameState, kind: RestKind): SystemEvent[] {
    return this.list().flatMap((s) => s.onRest?.(state, kind) ?? []);
  }
}
