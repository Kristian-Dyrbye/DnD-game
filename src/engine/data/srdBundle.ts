/**
 * Bundles the committed data/srd/*.json files (static JSON imports work in Vite, Vitest and tsx)
 * and exposes a lazily-built, cached SrdDatabase.
 */
import conditions from '../../../data/srd/conditions.json';
import weapons from '../../../data/srd/weapons.json';
import armor from '../../../data/srd/armor.json';
import gear from '../../../data/srd/gear.json';
import species from '../../../data/srd/species.json';
import backgrounds from '../../../data/srd/backgrounds.json';
import feats from '../../../data/srd/feats.json';
import classes from '../../../data/srd/classes.json';
import subclasses from '../../../data/srd/subclasses.json';
import spells from '../../../data/srd/spells.json';
import monsters from '../../../data/srd/monsters.json';
import magicItems from '../../../data/srd/magic-items.json';
import { SrdDatabase } from './srd';
import type { SrdFileName } from './schemas';

export const SRD_RAW: Record<SrdFileName, unknown> = {
  'conditions.json': conditions,
  'weapons.json': weapons,
  'armor.json': armor,
  'gear.json': gear,
  'species.json': species,
  'backgrounds.json': backgrounds,
  'feats.json': feats,
  'classes.json': classes,
  'subclasses.json': subclasses,
  'spells.json': spells,
  'monsters.json': monsters,
  'magic-items.json': magicItems,
};

let cached: SrdDatabase | undefined;

export function loadSrd(): SrdDatabase {
  cached ??= new SrdDatabase(SRD_RAW);
  return cached;
}
