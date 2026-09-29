/**
 * Weather (spec §11.4). Region- and season-aware: each region's lore climate lists likely weather
 * per season. Weather is rolled per 8-hour block from a seed made of the campaign id, block and
 * region, so it is deterministic and needs no saved RNG state. Mechanical effects are data: travel
 * speed, obscurement (and the sight-based Perception disadvantage that follows), strong wind
 * (ranged attack disadvantage, flames out), and heat/cold hazards for travel.
 */
import { Rng } from '../core/rng';
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

const BASE: Record<WeatherKind, Omit<WeatherEffects, 'rangedDisadvantage' | 'perceptionDisadvantage' | 'description'> & { text: string }> = {
  clear: { travelMultiplier: 1, obscured: 'none', extinguishesFlames: false, text: 'Clear skies' },
  rain: { travelMultiplier: 0.75, obscured: 'light', extinguishesFlames: true, text: 'Steady rain' },
  fog: { travelMultiplier: 0.75, obscured: 'heavy', extinguishesFlames: false, text: 'Thick fog' },
  storm: { travelMultiplier: 0.5, obscured: 'light', extinguishesFlames: true, text: 'A howling storm' },
  snow: { travelMultiplier: 0.5, obscured: 'light', extinguishesFlames: false, hazard: 'extreme_cold', text: 'Falling snow' },
  heat: { travelMultiplier: 0.75, obscured: 'none', extinguishesFlames: false, hazard: 'extreme_heat', text: 'Oppressive heat' },
};

export function weatherEffects(w: Pick<WeatherState, 'kind' | 'wind'>): WeatherEffects {
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
    description: `${b.text}${strong ? ' and strong wind' : w.wind === 'breezy' ? ', breezy' : ''}`,
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

const CHANGE_TEXT: Record<WeatherKind, string> = {
  clear: 'The skies clear.',
  rain: 'Rain begins to fall.',
  fog: 'Fog rolls in, thick and grey.',
  storm: 'A storm breaks overhead.',
  snow: 'Snow starts to fall.',
  heat: 'The air turns hot and heavy.',
};

export function weatherChangeText(prev: WeatherState | undefined, next: WeatherState): string | undefined {
  if (prev && prev.kind === next.kind && prev.wind === next.wind) return undefined;
  if (prev && prev.kind === next.kind) return next.wind === 'strong' ? 'The wind picks up sharply.' : 'The wind dies down.';
  return CHANGE_TEXT[next.kind] + (next.wind === 'strong' && next.kind !== 'storm' ? ' A strong wind blows.' : '');
}
