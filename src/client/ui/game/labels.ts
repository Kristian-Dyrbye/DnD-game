/**
 * UI words for engine states shown on the game screens (scar places, armor wear, wounds) in the
 * current language. Scar descriptions/origins are engine text and stay as written (A141).
 */
import { wearLabel } from '../../../engine/character/armorWear';
import type { WoundLevel } from '../../../engine/appearance/wounds';
import type { Scar, ScarLocation } from '../../../engine/core/creature';
import type { MessageKey } from '../../../shared/i18n';
import { t } from '../i18n';

export function scarLabel(location: ScarLocation): string {
  return t(`scar.${location}`);
}

/** "Left cheek: a thin white line (Goblin's scimitar)". */
export function scarLine(s: Scar): string {
  return `${scarLabel(s.location)}: ${s.description}${s.origin ? ` (${s.origin})` : ''}`;
}

export function wearText(wear: number): string {
  return t(`wear.${wearLabel(wear)}` as MessageKey);
}

export function woundText(level: WoundLevel): string | undefined {
  return level > 0 ? t(`wound.${level}` as MessageKey) : undefined;
}
