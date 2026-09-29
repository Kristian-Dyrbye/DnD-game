/** Factions system: initialises `state.extensions.reputation` from lore default reputations. */
import { defaultReputation, type ReputationMap } from '../world/factions';
import type { Lore } from '../world/lore';
import type { GameSystem } from './registry';

export function factionSystem(lore: Lore): GameSystem<ReputationMap> {
  return {
    id: 'reputation',
    version: 1,
    initState: () => defaultReputation(lore),
  };
}
