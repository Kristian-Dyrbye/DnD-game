/**
 * SRD rules names in the current UI language (A149): thin wrappers over engine/i18n/srdNames.ts
 * that read the language signal, so components re-render on a switch. Not for the title screen's
 * first load (keeps the name overlays out of it).
 */
import type { Ability, Skill } from '../../engine/rules/basics';
import { abilityName, abilityShort, ruleWord, skillName, srdName, type SrdNameKind } from '../../engine/i18n/srdNames';
import { itemName } from '../../engine/character/inventory';
import { db } from '../data';
import { language } from './i18n';

export const srdText = (kind: SrdNameKind, id: string, english: string): string => srdName(language.value, kind, id, english);
export const abilityText = (a: Ability): string => abilityName(language.value, a);
/** "Str" / "Sty". */
export const abilityAbbr = (a: Ability): string => abilityShort(language.value, a);
export const skillText = (s: Skill): string => skillName(language.value, s);
/** Item name (weapon/armor/gear/magic item, A149d); a magic weapon or armor adds its magic item: "Langsværd (Våben +1)". */
export const itemText = (itemId: string, magicItemId?: string): string =>
  itemName(itemId, db, language.value) + (magicItemId ? ` (${itemName(magicItemId, db, language.value)})` : '');
export const ruleText =(group: string, id: string, english: string): string => ruleWord(language.value, group, id, english);
