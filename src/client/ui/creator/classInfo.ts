/** Original short class blurbs and roles for the creator (game text, not SRD; the texts live in the i18n catalogs). */
import type { MessageKey } from '../../../shared/i18n';
import { t } from '../i18n';

export interface ClassInfo {
  /** 1 = straightforward, 3 = many options to manage. */
  complexity: 1 | 2 | 3;
}

export const CLASS_INFO: Record<string, ClassInfo> = {
  barbarian: { complexity: 1 },
  bard: { complexity: 3 },
  cleric: { complexity: 2 },
  druid: { complexity: 3 },
  fighter: { complexity: 1 },
  monk: { complexity: 2 },
  paladin: { complexity: 2 },
  ranger: { complexity: 2 },
  rogue: { complexity: 1 },
  sorcerer: { complexity: 3 },
  warlock: { complexity: 3 },
  wizard: { complexity: 3 },
};

/** A class's role line or blurb in the current language (only for ids in CLASS_INFO). */
export function classText(classId: string, part: 'role' | 'blurb'): string {
  return t(`class.${classId}.${part}` as MessageKey);
}
