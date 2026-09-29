import { describe, expect, it } from 'vitest';
import loreJson from '../../../data/world/lore.json';
import { buildCharacter } from '../character/builder';
import { toBuildInput } from '../character/creator';
import { quickBuild } from '../character/quickBuild';
import { Rng } from '../core/rng';
import { loadSrd } from '../data/srdBundle';
import { newGameState } from '../session/GameSession';
import { createDefaultRegistry, currentWeather } from '../systems';
import { MINUTES_PER_DAY } from './clock';
import { LoreSchema } from './lore';
import { WEATHER_BLOCK_MINUTES, weatherAt, weatherChangeText, weatherEffects } from './weather';

const lore = LoreSchema.parse(loreJson);
const db = loadSrd();

describe('weatherAt', () => {
  it('is deterministic per campaign, region and 8-hour block', () => {
    expect(weatherAt(lore, 'gloamfen', 500, 'c1')).toEqual(weatherAt(lore, 'gloamfen', 900, 'c1'));
    expect(weatherAt(lore, 'gloamfen', 500, 'c1').block).toBe(1);
    const kinds = new Set(Array.from({ length: 60 }, (_, i) => weatherAt(lore, 'aurelmark', i * WEATHER_BLOCK_MINUTES, 'c1').kind));
    expect(kinds.size).toBeGreaterThan(1);
  });

  it('only picks weather from the region climate for the season', () => {
    for (const region of lore.regions) {
      for (let day = 0; day < 360; day += 7) {
        const w = weatherAt(lore, region.id, day * MINUTES_PER_DAY, 'seed');
        const season = lore.calendar.months[Math.floor(day / 30)]!.season;
        expect(region.climate[season]).toContain(w.kind);
      }
    }
  });

  it('storms always bring strong wind; unknown regions fall back to the first region', () => {
    for (let b = 0; b < 200; b++) {
      const w = weatherAt(lore, 'brinescatter_isles', b * WEATHER_BLOCK_MINUTES, 'x');
      if (w.kind === 'storm') expect(w.wind).toBe('strong');
    }
    expect(weatherAt(lore, 'nowhere', 0, 'x').regionId).toBe(lore.regions[0]!.id);
  });
});

describe('weatherEffects', () => {
  it('encodes travel, obscurement, wind and hazards', () => {
    expect(weatherEffects({ kind: 'clear', wind: 'calm' })).toMatchObject({ travelMultiplier: 1, obscured: 'none', perceptionDisadvantage: false, rangedDisadvantage: false, extinguishesFlames: false });
    expect(weatherEffects({ kind: 'fog', wind: 'calm' })).toMatchObject({ obscured: 'heavy', perceptionDisadvantage: true });
    expect(weatherEffects({ kind: 'fog', wind: 'strong' })).toMatchObject({ obscured: 'light', rangedDisadvantage: true, extinguishesFlames: true });
    expect(weatherEffects({ kind: 'storm', wind: 'strong' })).toMatchObject({ travelMultiplier: 0.5, rangedDisadvantage: true, extinguishesFlames: true });
    expect(weatherEffects({ kind: 'snow', wind: 'calm' }).hazard).toBe('extreme_cold');
    expect(weatherEffects({ kind: 'heat', wind: 'breezy' })).toMatchObject({ hazard: 'extreme_heat', description: 'Oppressive heat, breezy' });
  });

  it('describes changes', () => {
    const base = { regionId: 'r', block: 0 };
    expect(weatherChangeText(undefined, { ...base, kind: 'rain', wind: 'calm' })).toBe('Rain begins to fall.');
    expect(weatherChangeText({ ...base, kind: 'rain', wind: 'calm' }, { ...base, kind: 'rain', wind: 'calm' })).toBeUndefined();
    expect(weatherChangeText({ ...base, kind: 'rain', wind: 'calm' }, { ...base, kind: 'rain', wind: 'strong' })).toBe('The wind picks up sharply.');
    expect(weatherChangeText({ ...base, kind: 'clear', wind: 'calm' }, { ...base, kind: 'fog', wind: 'strong' })).toBe('Fog rolls in, thick and grey. A strong wind blows.');
  });
});

describe('weather system', () => {
  it('initialises for the party region and updates as blocks pass or the region changes', () => {
    let region = 'aurelmark';
    const reg = createDefaultRegistry({ lore, regionOf: () => region });
    const hero = buildCharacter(toBuildInput(quickBuild('fighter', db, Rng.fromSeed('f'))), db);
    const s = newGameState(hero, 'heroic', 'weather-test');
    reg.init(s);
    expect(currentWeather(s)).toEqual(weatherAt(lore, 'aurelmark', s.time, s.campaignId));
    reg.advanceTime(s, 10);
    expect(currentWeather(s)!.block).toBe(1);
    // Travel into the Gloamfen during the same block: weather re-rolled for the new region.
    region = 'gloamfen';
    reg.advanceTime(s, 5);
    expect(currentWeather(s)!.regionId).toBe('gloamfen');
    const later = reg.advanceTime(s, WEATHER_BLOCK_MINUTES * 5);
    expect(currentWeather(s)!.block).toBe(Math.floor(s.time / WEATHER_BLOCK_MINUTES));
    for (const e of later) expect(['clock', 'weather']).toContain(e.systemId);
  });
});
