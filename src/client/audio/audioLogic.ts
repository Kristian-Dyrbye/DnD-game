/**
 * Pure audio helpers (tested without a browser): variant picking without immediate repeats,
 * effective volumes, and which sound effect a server event or UI action triggers.
 */
import type { ServerEvent } from '../../shared/protocol';
import { ENGINE_CATALOGS, type EngineKey } from '../../engine/i18n';

/** The fixed start of an engine line in every language ("Bought ", "Købt "…), so SFX work in any language. */
function startsLike(keys: EngineKey[]): (text: string) => boolean {
  const heads = Object.values(ENGINE_CATALOGS).flatMap((c) => keys.map((k) => c[k]?.split('{')[0] ?? '')).filter((h) => h.length > 1);
  return (text) => heads.some((h) => text.startsWith(h));
}

const COIN_LINE = startsLike(['shop.bought', 'shop.sold', 'story.received']);
const JOB_DONE_LINE = startsLike(['job.complete']);
const TRAVEL_LINE = startsLike(['travel.done', 'travel.doneDays.one', 'travel.doneDays.other']);

export interface Volumes {
  master: number;
  music: number;
  sfx: number;
}

export function channelVolume(v: Volumes, channel: 'music' | 'sfx' | 'ambience'): number {
  const c = channel === 'sfx' ? v.sfx : v.music * (channel === 'ambience' ? 0.5 : 1);
  return Math.max(0, Math.min(1, v.master * c));
}

/** Picks a random item, avoiding `last` when there is a choice. */
export function pickVariant<T>(items: readonly T[], last: T | undefined, rand: () => number = Math.random): T | undefined {
  if (items.length === 0) return undefined;
  const pool = items.length > 1 ? items.filter((i) => i !== last) : items;
  return pool[Math.floor(rand() * pool.length)];
}

/** Sound effect for a server event (or undefined). */
export function sfxForEvent(e: ServerEvent): string | undefined {
  switch (e.type) {
    case 'roll':
      return 'dice_roll';
    case 'saved':
      return e.meta.kind === 'manual' ? 'ui_confirm' : undefined;
    case 'journal':
      return 'page_turn';
    case 'shop':
      return undefined;
    case 'error':
      return 'ui_error';
    case 'log': {
      const t = e.entry.text;
      if (e.entry.kind !== 'system') return undefined;
      if (COIN_LINE(t)) return 'coin';
      if (JOB_DONE_LINE(t)) return 'quest_complete';
      if (TRAVEL_LINE(t)) return 'footstep_dirt';
      if (/^\+\d+ XP/.test(t)) return 'gem';
      if (/reputation|omdømme/.test(t)) return 'ui_tick';
      return undefined;
    }
    default:
      return undefined;
  }
}
