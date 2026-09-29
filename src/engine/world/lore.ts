/**
 * World lore schema (Build Prompt §7.1, §11.2–11.4): the continent of Orrimar, its three
 * tonal regions, history, gods, factions, key locations, travel routes and calendar.
 * Content lives in `data/world/lore.json`; this module validates it and offers small
 * pure lookups for the map, reputation, time/weather and narrator systems.
 */
import { z } from 'zod';
import { IdSchema } from '../data/common';

export const REGION_TONES = ['high_fantasy', 'dark_fantasy', 'swashbuckling'] as const;
export type RegionTone = (typeof REGION_TONES)[number];

export const SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const;
export const SeasonSchema = z.enum(SEASONS);
export type Season = z.infer<typeof SeasonSchema>;

/** Weather ids used by the weather system (§11.4). */
export const WEATHER_KINDS = ['clear', 'rain', 'fog', 'storm', 'snow', 'heat'] as const;
export const WeatherKindSchema = z.enum(WEATHER_KINDS);
export type WeatherKind = z.infer<typeof WeatherKindSchema>;

export const FACTION_KINDS = ['guild', 'cult', 'kingdom', 'pirate_crew', 'order', 'tribe', 'company'] as const;
export const LOCATION_KINDS = [
  'city',
  'town',
  'village',
  'ruin',
  'dungeon',
  'wilderness',
  'port',
  'fortress',
  'temple',
  'landmark',
] as const;
export const ROUTE_KINDS = ['road', 'trail', 'sea', 'river'] as const;

/** Continent map is MAP_WIDTH × MAP_HEIGHT units; (0,0) is the top-left corner. */
export const MAP_WIDTH = 1000;
export const MAP_HEIGHT = 700;

const ProseSchema = z.string().min(1);

export const MapPosSchema = z.object({
  x: z.number().min(0).max(MAP_WIDTH),
  y: z.number().min(0).max(MAP_HEIGHT),
});
export type MapPos = z.infer<typeof MapPosSchema>;

export const MapBoundsSchema = z.object({
  x: z.number().min(0),
  y: z.number().min(0),
  width: z.number().positive(),
  height: z.number().positive(),
});
export type MapBounds = z.infer<typeof MapBoundsSchema>;

/** Injected into the narrator's system prompt while the party is in the region. */
export const ToneProfileSchema = z.object({
  style: ProseSchema,
  vocabulary: z.array(z.string().min(1)).min(6).max(10),
  themes: z.array(z.string().min(1)).min(3).max(5),
  avoid: z.array(z.string().min(1)).min(2).max(4),
});
export type ToneProfile = z.infer<typeof ToneProfileSchema>;

/** Likely weather per season; the weather system picks from these lists. */
export const ClimateSchema = z.object({
  spring: z.array(WeatherKindSchema).min(1),
  summer: z.array(WeatherKindSchema).min(1),
  autumn: z.array(WeatherKindSchema).min(1),
  winter: z.array(WeatherKindSchema).min(1),
});
export type Climate = z.infer<typeof ClimateSchema>;

export const RegionSchema = z.object({
  id: IdSchema,
  name: ProseSchema,
  tone: z.enum(REGION_TONES),
  summary: ProseSchema,
  toneProfile: ToneProfileSchema,
  climate: ClimateSchema,
  dangerLevel: z.number().int().min(1).max(5),
  travelNotes: ProseSchema,
  /** Rough rectangle the region occupies on the continent map. */
  mapBounds: MapBoundsSchema,
});
export type Region = z.infer<typeof RegionSchema>;

export const HistoryEventSchema = z.object({
  id: IdSchema,
  name: ProseSchema,
  yearsAgo: z.number().int().min(0),
  summary: ProseSchema,
});
export type HistoryEvent = z.infer<typeof HistoryEventSchema>;

export const GodSchema = z.object({
  id: IdSchema,
  name: ProseSchema,
  title: ProseSchema,
  domains: z.array(z.string().min(1)).min(1),
  alignment: ProseSchema,
  symbol: ProseSchema,
  summary: ProseSchema,
  favoredRegionIds: z.array(IdSchema),
});
export type God = z.infer<typeof GodSchema>;

export const FactionRelationSchema = z.enum(['allied', 'hostile']);
export type FactionRelation = z.infer<typeof FactionRelationSchema> | 'neutral';

export const FactionSchema = z.object({
  id: IdSchema,
  name: ProseSchema,
  kind: z.enum(FACTION_KINDS),
  homeRegionId: IdSchema,
  summary: ProseSchema,
  goals: z.array(ProseSchema).min(2).max(3),
  leader: z.object({ name: ProseSchema, summary: ProseSchema }),
  symbol: ProseSchema,
  /** Starting reputation toward the player, −100..100. */
  defaultReputation: z.number().int().min(-100).max(100),
  /** Other faction id → relation. Neutral pairs are omitted. Must be symmetric. */
  relationships: z.record(IdSchema, FactionRelationSchema),
  /** Patron deity, if any. */
  godId: IdSchema.optional(),
});
export type Faction = z.infer<typeof FactionSchema>;

export const LocationSchema = z.object({
  id: IdSchema,
  name: ProseSchema,
  regionId: IdSchema,
  kind: z.enum(LOCATION_KINDS),
  summary: ProseSchema,
  mapPos: MapPosSchema,
  /** Free-form snake_case tags, e.g. shop, tavern, quest_board, safe_house, night_danger, starting_location. */
  tags: z.array(IdSchema),
  /** Factions with a presence here. */
  factionIds: z.array(IdSchema),
});
export type Location = z.infer<typeof LocationSchema>;

/** Undirected travel link between two locations. */
export const RouteSchema = z.object({
  from: IdSchema,
  to: IdSchema,
  kind: z.enum(ROUTE_KINDS),
  miles: z.number().positive(),
});
export type Route = z.infer<typeof RouteSchema>;

export const CalendarSchema = z.object({
  daysPerYear: z.number().int().positive(),
  daysPerMonth: z.number().int().positive(),
  /** Year the game starts in, and its era suffix (e.g. "1247 AR"). */
  startYear: z.number().int(),
  yearSuffix: ProseSchema,
  months: z.array(z.object({ id: IdSchema, name: ProseSchema, season: SeasonSchema })).length(12),
  weekdays: z.array(z.object({ id: IdSchema, name: ProseSchema })).length(7),
});
export type Calendar = z.infer<typeof CalendarSchema>;

export const LoreSchema = z.object({
  continent: z.object({ name: ProseSchema, summary: ProseSchema }),
  regions: z.array(RegionSchema).length(3),
  history: z.array(HistoryEventSchema).min(6).max(10),
  gods: z.array(GodSchema).min(6).max(9),
  factions: z.array(FactionSchema).min(8).max(10),
  locations: z.array(LocationSchema).min(18).max(24),
  routes: z.array(RouteSchema).min(20).max(30),
  calendar: CalendarSchema,
});
export type Lore = z.infer<typeof LoreSchema>;

export function regionById(lore: Lore, id: string): Region | undefined {
  return lore.regions.find((r) => r.id === id);
}

export function locationById(lore: Lore, id: string): Location | undefined {
  return lore.locations.find((l) => l.id === id);
}

export function factionById(lore: Lore, id: string): Faction | undefined {
  return lore.factions.find((f) => f.id === id);
}

/** Relation between two factions; unknown or unlisted pairs are 'neutral'. */
export function factionRelation(lore: Lore, a: string, b: string): FactionRelation {
  if (a === b) return 'allied';
  return factionById(lore, a)?.relationships[b] ?? 'neutral';
}

/** Routes touching a location (routes are undirected). */
export function routesFrom(lore: Lore, locationId: string): Route[] {
  return lore.routes.filter((r) => r.from === locationId || r.to === locationId);
}

/** Region the given location belongs to. */
export function regionOfLocation(lore: Lore, locationId: string): Region | undefined {
  const loc = locationById(lore, locationId);
  return loc ? regionById(lore, loc.regionId) : undefined;
}
