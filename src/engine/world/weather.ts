/**
 * Weather (spec §11.4). Region- and season-aware: each region's lore climate lists likely weather
 * per season. Weather is rolled per 8-hour block from a seed made of the campaign id, block and
 * region, so it is deterministic and needs no saved RNG state. Mechanical effects are data: travel
 * speed, obscurement (and the sight-based Perception disadvantage that follows), strong wind
 * (ranged attack disadvantage, flames out), and heat/cold hazards for travel.
 */
import { Rng } from '../core/rng';
import { ENGLISH_MESSAGES, type Messages } from '../i18n';
import { calendarDate } from './clock';
import type { Lore, WeatherKind } from './lore';

export const WEATHER_BLOCK_MINUTES = 8 * 60;

export type Wind = 'calm' | 'breezy' | 'strong';

export interface WeatherState {
  kind: WeatherKind;
  wind: Wind;
  regionId: string;
  /** 8-hour block this weather belongs to. */
  block: number;
}

export interface WeatherEffects {
  /** Multiplier on overland travel speed. */
  travelMultiplier: number;
  /** How far sight is hampered outdoors. */
  obscured: 'none' | 'light' | 'heavy';
  /** Wisdom (Perception) checks relying on sight have disadvantage (lightly obscured or worse). */
  perceptionDisadvantage: boolean;
  /** Strong wind: disadvantage on ranged weapon attack rolls. */
  rangedDisadvantage: boolean;
  /** Rain/storm/strong wind put out unprotected open flames (torches, campfires). */
  extinguishesFlames: boolean;
  /** Travel hazard the travel system (A074) resolves with Constitution saves. */
  hazard?: 'extreme_heat' | 'extreme_cold';
  /** One line the narrator and UI can use. */
  description: string;
}

const BASE: Record<WeatherKind, Omit<WeatherEffects, 'rangedDisadvantage' | 'perceptionDisadvantage' | 'description'>> = {
  clear: { travelMultiplier: 1, obscured: 'none', extinguishesFlames: false },
  rain: { travelMultiplier: 0.75, obscured: 'light', extinguishesFlames: true },
  fog: { travelMultiplier: 0.75, obscured: 'heavy', extinguishesFlames: false },
  storm: { travelMultiplier: 0.5, obscured: 'light', extinguishesFlames: true },
  snow: { travelMultiplier: 0.5, obscured: 'light', extinguishesFlames: false, hazard: 'extreme_cold' },
  heat: { travelMultiplier: 0.75, obscured: 'none', extinguishesFlames: false, hazard: 'extreme_heat' },
};

/** `description` is in the language of `msgs` (default English). */
export function weatherEffects(w: Pick<WeatherState, 'kind' | 'wind'>, { m }: Messages = ENGLISH_MESSAGES): WeatherEffects {
  const b = BASE[w.kind];
  const strong = w.wind === 'strong';
  // Strong wind disperses fog to light obscurement.
  const obscured = strong && b.obscured === 'heavy' ? 'light' : b.obscured;
  return {
    travelMultiplier: b.travelMultiplier,
    obscured,
    perceptionDisadvantage: obscured !== 'none',
    rangedDisadvantage: strong,
    extinguishesFlames: b.extinguishesFlames || strong,
    ...(b.hazard && { hazard: b.hazard }),
    description: strong ? m('weather.strongWind', { weather: m(`weather.${w.kind}`) }) : w.wind === 'breezy' ? m('weather.breezy', { weather: m(`weather.${w.kind}`) }) : m(`weather.${w.kind}`),
  };
}

/** The weather for a region at a time (deterministic per campaign, block and region). */
export function weatherAt(lore: Lore, regionId: string, minutes: number, campaignId: string): WeatherState {
  const region = lore.regions.find((r) => r.id === regionId) ?? lore.regions[0]!;
  const block = Math.floor(minutes / WEATHER_BLOCK_MINUTES);
  const season = calendarDate(minutes, lore.calendar).season;
  const rng = Rng.fromSeed(`${campaignId}:weather:${region.id}:${block}`);
  const kind = rng.pick(region.climate[season]);
  const windRoll = rng.int(1, 100);
  const wind: Wind = kind === 'storm' || windRoll > 90 ? 'strong' : windRoll > 60 ? 'breezy' : 'calm';
  return { kind, wind, regionId: region.id, block };
}

export function weatherChangeText(prev: WeatherState | undefined, next: WeatherState, { m }: Messages = ENGLISH_MESSAGES): string | undefined {
  if (prev && prev.kind === next.kind && prev.wind === next.wind) return undefined;
  if (prev && prev.kind === next.kind) return m(next.wind === 'strong' ? 'weather.windUp' : 'weather.windDown');
  return m(`weather.to.${next.kind}`) + (next.wind === 'strong' && next.kind !== 'storm' ? ` ${m('weather.windBlows')}` : '');
}
