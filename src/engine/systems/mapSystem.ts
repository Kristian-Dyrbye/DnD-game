/** Map system: owns `state.extensions.map` (current location, visited and known places). */
import type { Lore } from '../world/lore';
import { initialMap, type MapState } from '../world/travel';
import type { GameSystem } from './registry';

export function mapSystem(lore: Lore): GameSystem<MapState> {
  return { id: 'map', version: 1, initState: () => initialMap(lore) };
}
