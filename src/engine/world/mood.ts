/**
 * Music mood for the current situation (spec §13): the scene's authored `mood` wins; otherwise the
 * lore location decides (settlements → town, ruins/dungeons → dungeon, else the region's
 * wilderness theme). Ambience beds follow the region/place. Moods match assets/audio-manifest.json.
 */
import type { Lore } from './lore';

export const MOODS = ['menu', 'town', 'tavern', 'wilderness_aurelmark', 'wilderness_gloamfen', 'wilderness_brinescatter', 'dungeon', 'battle', 'boss', 'victory'] as const;
export type Mood = (typeof MOODS)[number];
export type Ambience = 'forest' | 'swamp' | 'dungeon' | null;

const REGION_WILDS: Record<string, Mood> = { aurelmark: 'wilderness_aurelmark', gloamfen: 'wilderness_gloamfen', brinescatter_isles: 'wilderness_brinescatter' };

/** Maps an authored scene mood hint ("town", "tense", "tavern"...) to a music mood. */
export function moodFromHint(hint: string | undefined): Mood | undefined {
  if (!hint) return undefined;
  if ((MOODS as readonly string[]).includes(hint)) return hint as Mood;
  if (/tense|danger|dark|crypt|cave|dungeon/.test(hint)) return 'dungeon';
  if (/inn|tavern|feast/.test(hint)) return 'tavern';
  if (/town|market|village|city/.test(hint)) return 'town';
  return undefined;
}

export function moodFor(lore: Lore, opts: { sceneMood?: string; locationId?: string }): { mood: Mood; ambience: Ambience } {
  const loc = lore.locations.find((l) => l.id === opts.locationId);
  const region = loc?.regionId;
  const hinted = moodFromHint(opts.sceneMood);
  let mood: Mood;
  if (hinted) mood = hinted;
  else if (loc && ['city', 'town', 'village', 'port', 'fortress'].includes(loc.kind)) mood = 'town';
  else if (loc && ['ruin', 'dungeon', 'temple'].includes(loc.kind)) mood = 'dungeon';
  else mood = REGION_WILDS[region ?? ''] ?? 'wilderness_aurelmark';
  const ambience: Ambience = mood === 'dungeon' ? 'dungeon' : mood.startsWith('wilderness') ? (region === 'gloamfen' ? 'swamp' : region === 'aurelmark' ? 'forest' : null) : null;
  return { mood, ambience };
}
