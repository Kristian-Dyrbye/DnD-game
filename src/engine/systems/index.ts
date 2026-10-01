/** Default system set for a campaign. New built-in systems are registered here. */
import type { Language } from '../../shared/i18nCore';
import type { Lore } from '../world/lore';
import { clockSystem } from './clockSystem';
import { factionSystem } from './factionSystem';
import { mapSystem } from './mapSystem';
import { SystemRegistry } from './registry';
import { storyConditionSystem } from './storyConditionSystem';
import { weatherSystem, type RegionResolver } from './weatherSystem';

export interface DefaultSystemsOptions {
  lore?: Lore;
  /** Lore in a session language (translated calendar names); defaults to `lore` for every language. */
  loreFor?: (lang: Language) => Lore;
  /** Which lore region the party is in (for weather). */
  regionOf?: RegionResolver;
}

export function createDefaultRegistry(opts: DefaultSystemsOptions = {}): SystemRegistry {
  const { lore, loreFor } = opts;
  const calendar = loreFor ? (lang: Language) => loreFor(lang).calendar : lore?.calendar;
  const reg = new SystemRegistry().register(clockSystem(calendar)).register(storyConditionSystem());
  // Weather, map and reputation only read ids/numbers from the lore, so English lore serves every language.
  if (lore) {
    reg.register(weatherSystem(lore, opts.regionOf ?? (() => undefined)));
    reg.register(mapSystem(lore));
    reg.register(factionSystem(lore));
  }
  return reg;
}

export { SystemRegistry, type GameSystem, type SystemEvent, type RestKind } from './registry';
export { currentWeather, type RegionResolver } from './weatherSystem';
