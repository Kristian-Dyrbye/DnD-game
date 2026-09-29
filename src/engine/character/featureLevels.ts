/** Class levels at which a feature is gained ("You gain this feature again at X levels 8, 12, and 16"). */
import type { ClassData } from '../data/schemas';

export function featureLevels(f: ClassData['features'][number]): number[] {
  const again = /again at [\w ]*?levels? ([\d, and]+)/.exec(f.text)?.[1];
  const extra = again ? [...again.matchAll(/\d+/g)].map((m) => Number(m[0])) : [];
  return [f.level, ...extra];
}
