/** Ends timed story conditions (poisoned for an hour…) when the clock passes their end (A130). */
import { expireStoryConditions } from '../adventure/storyConditions';
import type { GameSystem, SystemEvent } from './registry';

export function storyConditionSystem(): GameSystem {
  return {
    id: 'storyConditions',
    version: 1,
    onTimeAdvance(state): SystemEvent[] {
      return expireStoryConditions(state).map((text) => ({ systemId: 'storyConditions', text }));
    },
  };
}
