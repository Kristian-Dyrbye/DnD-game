/**
 * SRD rules names in the player's language (A149): classes, species, skills, conditions, weapons…
 * Translations are id-keyed overlays `data/i18n/<lang>/srd/<kind>.json` in the content overlay format
 * (shared/contentI18n.ts: path = SRD id or `<group>/<id>` for rules words, text = name, hash = English
 * name for i18n:check). Bundled with static JSON imports (server, web and tests alike); a missing
 * name falls back to the English one the caller passes. Only names: SRD rules texts stay English.
 * English sources: engine/i18n/srdNameSources.ts.
 */
import type { ContentOverlay } from '../../shared/contentI18n';
import type { Language } from '../../shared/i18nCore';
import { ABILITY_NAMES, SKILL_NAMES, type Ability, type Skill } from '../rules/basics';
import daRules from '../../../data/i18n/da/srd/rules.json';
import daConditions from '../../../data/i18n/da/srd/conditions.json';
import daClasses from '../../../data/i18n/da/srd/classes.json';
import daSubclasses from '../../../data/i18n/da/srd/subclasses.json';
import daSpecies from '../../../data/i18n/da/srd/species.json';
import daBackgrounds from '../../../data/i18n/da/srd/backgrounds.json';
import daFeats from '../../../data/i18n/da/srd/feats.json';
import daWeapons from '../../../data/i18n/da/srd/weapons.json';
import daArmor from '../../../data/i18n/da/srd/armor.json';

export const SRD_NAME_KINDS = [
  'rules', 'conditions', 'classes', 'subclasses', 'species', 'backgrounds', 'feats',
  'weapons', 'armor', 'gear', 'spells', 'monsters', 'magic-items',
] as const;
export type SrdNameKind = (typeof SRD_NAME_KINDS)[number];

/** Bundled overlays by language and kind. Add new `data/i18n/<lang>/srd/<kind>.json` files here (a test compares with the folder). */
export const SRD_NAME_OVERLAYS: Partial<Record<Language, Partial<Record<SrdNameKind, ContentOverlay>>>> = {
  da: {
    rules: daRules,
    conditions: daConditions,
    classes: daClasses,
    subclasses: daSubclasses,
    species: daSpecies,
    backgrounds: daBackgrounds,
    feats: daFeats,
    weapons: daWeapons,
    armor: daArmor,
  },
};

/** Name of an SRD thing in `lang`; `english` when there is no (finished) translation. */
export function srdName(lang: Language, kind: SrdNameKind, path: string, english: string): string {
  if (lang === 'en') return english;
  const e = SRD_NAME_OVERLAYS[lang]?.[kind]?.strings[path];
  return e && !e.todo && typeof e.text === 'string' && e.text.trim() !== '' ? e.text : english;
}

export const abilityName = (lang: Language, a: Ability): string => srdName(lang, 'rules', `ability/${a}`, ABILITY_NAMES[a]);
/** "Con" / Danish "Kon" (check labels). */
export const abilityShort = (lang: Language, a: Ability): string => srdName(lang, 'rules', `ability_short/${a}`, a[0]!.toUpperCase() + a.slice(1));
export const skillName = (lang: Language, s: Skill): string => srdName(lang, 'rules', `skill/${s}`, SKILL_NAMES[s]);
/** Rules words without their own file: damage, creature_type, size, school, mastery, property. */
export const ruleWord = (lang: Language, group: string, id: string, english: string): string => srdName(lang, 'rules', `${group}/${id}`, english);
