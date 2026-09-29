/** Class levels at which a feature is gained ("You gain this feature again at X levels 8, 12, and 16"). */
import type { ClassData } from '../data/schemas';

export function featureLevels(f: ClassData['features'][number]): number[] {
  const again = /again at [\w ]*?levels? ([\d, and]+)/.exec(f.text)?.[1];
  const extra = again ? [...again.matchAll(/\d+/g)].map((m) => Number(m[0])) : [];
  return [f.level, ...extra];
}

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };

/**
 * Weapon Mastery count at a class level: the class table column when it exists (Barbarian,
 * Fighter), else the number in the feature text ("two kinds of weapons": Paladin, Ranger, Rogue).
 */
export function weaponMasteryCount(cls: ClassData, level: number): number {
  const col = cls.columns.weapon_mastery?.[level - 1];
  if (col !== undefined) return Number(col);
  const f = cls.features.find((x) => x.id === 'weapon_mastery');
  if (!f || f.level > level) return 0;
  const word = /mastery properties of (\w+) kinds/.exec(f.text)?.[1];
  return NUMBER_WORDS[word ?? ''] ?? 0;
}
