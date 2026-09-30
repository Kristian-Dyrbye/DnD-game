/**
 * English sources of the SRD name overlays (A149): every translatable rules name by kind, as
 * `SourceString`s (path = id path, value = English name, hash of it) so the shared overlay tools
 * (checkOverlay/stubOverlay in shared/contentI18n.ts) work on them. Used by `npm run i18n:check`
 * and tests; the game itself only needs engine/i18n/srdNames.ts (no SRD import there).
 */
import { SRD_RAW } from '../data/srdBundle';
import type { SrdFileName } from '../data/schemas';
import { ABILITY_NAMES, CREATURE_TYPES, DAMAGE_TYPES, SIZES, SKILL_NAMES } from '../rules/basics';
import { textHash, type SourceString } from '../../shared/contentI18n';
import { SRD_NAME_KINDS, type SrdNameKind } from './srdNames';

/** Rules words with no SRD data file: spell schools, weapon masteries and properties. */
const SCHOOLS = ['abjuration', 'conjuration', 'divination', 'enchantment', 'evocation', 'illusion', 'necromancy', 'transmutation'];
const MASTERIES = ['cleave', 'graze', 'nick', 'push', 'sap', 'slow', 'topple', 'vex'];
const PROPERTIES = ['ammunition', 'finesse', 'heavy', 'light', 'loading', 'range', 'reach', 'thrown', 'two_handed', 'versatile'];

/** "two_handed" → "Two-Handed", "fire" → "Fire". */
export const titleCase = (id: string): string => id.split('_').map((w) => w[0]!.toUpperCase() + w.slice(1)).join('-');

const FILE_OF: Record<Exclude<SrdNameKind, 'rules'>, SrdFileName> = {
  conditions: 'conditions.json',
  classes: 'classes.json',
  subclasses: 'subclasses.json',
  species: 'species.json',
  backgrounds: 'backgrounds.json',
  feats: 'feats.json',
  weapons: 'weapons.json',
  armor: 'armor.json',
  gear: 'gear.json',
  spells: 'spells.json',
  monsters: 'monsters.json',
  'magic-items': 'magic-items.json',
};

/** English file behind each kind (for the overlay's `$source`). */
export function srdNameSourceFile(kind: SrdNameKind): string {
  return kind === 'rules' ? 'src/engine/rules/basics.ts' : `data/srd/${FILE_OF[kind]}`;
}

interface Named {
  id: string;
  name: string;
  lineageLabel?: string | null;
  lineages?: { id: string; name: string }[];
}

/** Every English name of one kind, in a stable order. */
export function srdNameSources(kind: SrdNameKind): SourceString[] {
  const pairs: [string, string][] = [];
  if (kind === 'rules') {
    for (const [id, n] of Object.entries(ABILITY_NAMES)) pairs.push([`ability/${id}`, n]);
    for (const id of Object.keys(ABILITY_NAMES)) pairs.push([`ability_short/${id}`, titleCase(id)]);
    for (const [id, n] of Object.entries(SKILL_NAMES)) pairs.push([`skill/${id}`, n]);
    for (const id of DAMAGE_TYPES) pairs.push([`damage/${id}`, titleCase(id)]);
    for (const id of CREATURE_TYPES) pairs.push([`creature_type/${id}`, titleCase(id)]);
    for (const id of SIZES) pairs.push([`size/${id}`, titleCase(id)]);
    for (const id of SCHOOLS) pairs.push([`school/${id}`, titleCase(id)]);
    for (const id of MASTERIES) pairs.push([`mastery/${id}`, titleCase(id)]);
    for (const id of PROPERTIES) pairs.push([`property/${id}`, titleCase(id)]);
  } else {
    for (const e of SRD_RAW[FILE_OF[kind]] as Named[]) {
      pairs.push([e.id, e.name]);
      if (e.lineageLabel) pairs.push([`${e.id}/lineageLabel`, e.lineageLabel]);
      for (const l of e.lineages ?? []) pairs.push([`${e.id}/lineages/${l.id}`, l.name]);
    }
  }
  return pairs.map(([path, value]) => ({ path, value, hash: textHash(value) }));
}

export { SRD_NAME_KINDS };
