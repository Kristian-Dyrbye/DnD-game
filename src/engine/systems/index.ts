/** Default system set for a campaign. New built-in systems are registered here. */
import type { Lore } from '../world/lore';
import { clockSystem } from './clockSystem';
import { SystemRegistry } from './registry';
import { weatherSystem, type RegionResolver } from './weatherSystem';

export interface DefaultSystemsOptions {
  lore?: Lore;
  /** Which lore region the party is in (for weather). */
  regionOf?: RegionResolver;
}

export function createDefaultRegistry(opts: DefaultSystemsOptions = {}): SystemRegistry {
  const reg = new SystemRegistry().register(clockSystem(opts.lore?.calendar));
  if (opts.lore) reg.register(weatherSystem(opts.lore, opts.regionOf ?? (() => undefined)));
  return reg;
}

export { SystemRegistry, type GameSystem, type SystemEvent, type RestKind } from './registry';
export { currentWeather, type RegionResolver } from './weatherSystem';
