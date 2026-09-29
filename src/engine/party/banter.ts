/**
 * Companion banter (spec §6): companions speak up occasionally — briefly, and not every turn.
 * A cooldown (actions and game time since the last line) plus a seeded chance decides when; the
 * speaker is picked among companions in the party. The line comes from an injected generator (the
 * LLM, voicing the companion) or falls back to the roster's written lines (grumbles when loyalty
 * is low). Deterministic given the state.
 */
import { Rng } from '../core/rng';
import type { GameState } from '../session/gameState';
import { companionStatus, loyaltyOf, LOYALTY_LOW, type CompanionDef, type CompanionRoster } from './companions';

export interface BanterState {
  /** Player actions since the last line. */
  actions: number;
  lastAt: number;
  lastSpeaker?: string;
}

export const BANTER_MIN_ACTIONS = 4;
export const BANTER_MIN_MINUTES = 30;
export const BANTER_CHANCE = 0.35;

/** Generates a line for a companion (LLM). Throw or return '' to use the written fallback. */
export type BanterGenerator = (def: CompanionDef, mood: 'content' | 'resentful', context: string) => Promise<string>;

function banterState(state: GameState): BanterState {
  return (state.extensions.banter as BanterState | undefined) ?? { actions: 0, lastAt: -1e9 }; // finite so it survives JSON saves
}

/** Counts a player action and decides whether someone speaks up now. Returns the speaker, if any. */
export function banterDue(state: GameState, roster: CompanionRoster): CompanionDef | undefined {
  const b = banterState(state);
  b.actions++;
  state.extensions.banter = b;
  const present = roster.companions.filter((d) => companionStatus(state, d) === 'in_party');
  if (present.length === 0 || b.actions < BANTER_MIN_ACTIONS || state.time - b.lastAt < BANTER_MIN_MINUTES) return undefined;
  const rng = Rng.fromSeed(`${state.campaignId}:banter:${state.time}:${b.actions}:${state.nextId}`);
  if (rng.next() >= BANTER_CHANCE) return undefined;
  // Prefer someone who didn't speak last time.
  const pool = present.length > 1 ? present.filter((d) => d.id !== b.lastSpeaker) : present;
  return rng.pick(pool);
}

/** Produces and records a banter line (LLM or fallback). */
export async function speakBanter(state: GameState, def: CompanionDef, context: string, gen?: BanterGenerator): Promise<string> {
  const mood = loyaltyOf(state, def) <= LOYALTY_LOW ? 'resentful' : 'content';
  let line = '';
  if (gen) {
    try {
      line = (await gen(def, mood, context)).trim().replace(/^["“]|["”]$/g, '');
    } catch {
      line = '';
    }
    if (line.length > 240) line = `${line.slice(0, 237)}…`;
  }
  if (!line) {
    const pool = mood === 'resentful' && def.grumbles.length ? def.grumbles : def.banter;
    line = pool.length ? Rng.fromSeed(`${state.campaignId}:banterline:${state.nextId}`).pick(pool) : '';
  }
  state.extensions.banter = { actions: 0, lastAt: state.time, lastSpeaker: def.id } satisfies BanterState;
  return line;
}
