/**
 * Factions and reputation (spec §11.2). Reputation is −100…+100 per faction, stored in
 * `state.extensions.reputation` (initialised from lore defaults by the factions system). Named
 * tiers (campaign bible): Hostile ≤ −60, Unfriendly ≤ −20, Neutral, Friendly ≥ 20, Honored ≥ 50,
 * Revered ≥ 80. Changes ripple once through lore relationships: allies gain half, enemies lose half.
 * Gating helpers cover quests/allies (tier checks), prices, safe houses and refusal of service.
 */
import type { GameState } from '../session/gameState';
import type { Lore } from './lore';

export const TIERS = ['hostile', 'unfriendly', 'neutral', 'friendly', 'honored', 'revered'] as const;
export type Tier = (typeof TIERS)[number];

export const TIER_NAMES: Record<Tier, string> = { hostile: 'Hostile', unfriendly: 'Unfriendly', neutral: 'Neutral', friendly: 'Friendly', honored: 'Honored', revered: 'Revered' };

export const REP_MIN = -100;
export const REP_MAX = 100;

export function tierOf(score: number): Tier {
  if (score <= -60) return 'hostile';
  if (score <= -20) return 'unfriendly';
  if (score >= 80) return 'revered';
  if (score >= 50) return 'honored';
  if (score >= 20) return 'friendly';
  return 'neutral';
}

export function tierAtLeast(score: number, tier: Tier): boolean {
  return TIERS.indexOf(tierOf(score)) >= TIERS.indexOf(tier);
}

export type ReputationMap = Record<string, number>;

export function defaultReputation(lore: Lore): ReputationMap {
  return Object.fromEntries(lore.factions.map((f) => [f.id, f.defaultReputation]));
}

export function reputationMap(state: GameState): ReputationMap {
  return (state.extensions.reputation as ReputationMap | undefined) ?? {};
}

export function getReputation(state: GameState, factionId: string, lore?: Lore): number {
  return reputationMap(state)[factionId] ?? lore?.factions.find((f) => f.id === factionId)?.defaultReputation ?? 0;
}

export interface ReputationChange {
  faction: string;
  delta: number;
  from: number;
  to: number;
  /** New tier when the change crossed a tier boundary. */
  newTier?: Tier;
  /** True for the half-strength ripple to allies/enemies. */
  ripple?: boolean;
}

const clamp = (n: number) => Math.max(REP_MIN, Math.min(REP_MAX, n));

/**
 * Changes a faction's reputation and ripples half the change (rounded toward zero) to its allies
 * (same sign) and enemies (opposite sign). Unknown factions (not in lore) change without ripple.
 */
export function changeReputation(state: GameState, factionId: string, delta: number, lore?: Lore): ReputationChange[] {
  const map = { ...reputationMap(state) };
  const changes: ReputationChange[] = [];
  const apply = (id: string, d: number, ripple: boolean) => {
    if (d === 0) return;
    const from = map[id] ?? lore?.factions.find((f) => f.id === id)?.defaultReputation ?? 0;
    const to = clamp(from + d);
    if (to === from) return;
    map[id] = to;
    const newTier = tierOf(to) !== tierOf(from) ? tierOf(to) : undefined;
    changes.push({ faction: id, delta: to - from, from, to, ...(newTier && { newTier }), ...(ripple && { ripple }) });
  };
  apply(factionId, delta, false);
  const half = Math.trunc(delta / 2);
  for (const [other, rel] of Object.entries(lore?.factions.find((f) => f.id === factionId)?.relationships ?? {})) {
    apply(other, rel === 'allied' ? half : -half, true);
  }
  state.extensions.reputation = map;
  return changes;
}

// ---------------------------------------------------------------- gating helpers

/** Price multiplier for a shop run by this faction (A080 builds on it). Hostile shops refuse. */
export function priceMultiplier(score: number): number | undefined {
  const byTier: Record<Tier, number | undefined> = { hostile: undefined, unfriendly: 1.25, neutral: 1, friendly: 0.9, honored: 0.8, revered: 0.7 };
  return byTier[tierOf(score)];
}

export function refusesService(score: number): boolean {
  return tierOf(score) === 'hostile';
}

/** Safe houses open at Friendly. */
export function canUseSafeHouse(score: number): boolean {
  return tierAtLeast(score, 'friendly');
}

export function describeChange(c: ReputationChange, lore?: Lore): string {
  const name = lore?.factions.find((f) => f.id === c.faction)?.name ?? c.faction.replace(/_/g, ' ');
  const sign = c.delta > 0 ? '+' : '';
  return `${name}: ${sign}${c.delta} reputation${c.newTier ? ` (now ${TIER_NAMES[c.newTier]})` : ''}`;
}
