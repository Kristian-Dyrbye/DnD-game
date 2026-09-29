/** Default system set for a campaign. New built-in systems are registered here. */
import type { Calendar } from '../world/lore';
import { clockSystem } from './clockSystem';
import { SystemRegistry } from './registry';

export function createDefaultRegistry(calendar?: Calendar): SystemRegistry {
  return new SystemRegistry().register(clockSystem(calendar));
}

export { SystemRegistry, type GameSystem, type SystemEvent, type RestKind } from './registry';
