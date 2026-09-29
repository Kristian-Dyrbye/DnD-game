/**
 * Weather system: keeps `state.extensions.weather` (a WeatherState) in step with the clock and the
 * party's region, and announces changes. The region comes from an injected resolver (the server
 * knows which adventure scene maps to which lore location).
 */
import type { GameState } from '../session/gameState';
import type { Lore } from '../world/lore';
import { weatherAt, weatherChangeText, type WeatherState } from '../world/weather';
import type { GameSystem, SystemEvent } from './registry';

export type RegionResolver = (state: GameState) => string | undefined;

export function currentWeather(state: GameState): WeatherState | undefined {
  return state.extensions.weather as WeatherState | undefined;
}

export function weatherSystem(lore: Lore, regionOf: RegionResolver): GameSystem<WeatherState> {
  const compute = (state: GameState) => weatherAt(lore, regionOf(state) ?? lore.regions[0]!.id, state.time, state.campaignId);
  return {
    id: 'weather',
    version: 1,
    initState: compute,
    onTimeAdvance(state): SystemEvent[] {
      const prev = currentWeather(state);
      const next = compute(state);
      if (prev && prev.block === next.block && prev.regionId === next.regionId) return [];
      state.extensions.weather = next;
      if (!prev) return []; // First reading (old save): set quietly.
      const text = weatherChangeText(prev, next);
      return text ? [{ systemId: 'weather', text }] : [];
    },
  };
}
