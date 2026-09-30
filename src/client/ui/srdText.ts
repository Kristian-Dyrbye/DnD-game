/**
 * SRD rules names in the current UI language (A149): thin wrappers over engine/i18n/srdNames.ts
 * that read the language signal, so components re-render on a switch. Not for the title screen's
 * first load (keeps the name overlays out of it).
 */
import type { Ability, Skill } from '../../engine/rules/basics';
import { abilityName, abilityShort, ruleWord, skillName, srdName, type SrdNameKind } from '../../engine/i18n/srdNames';
import { language } from './i18n';

export const srdText = (kind: SrdNameKind, id: string, english: string): string => srdName(language.value, kind, id, english);
export const abilityText = (a: Ability): string => abilityName(language.value, a);
/** "Str" / "Sty". */
export const abilityAbbr = (a: Ability): string => abilityShort(language.value, a);
export const skillText = (s: Skill): string => skillName(language.value, s);
export const ruleText = (group: string, id: string, english: string): string => ruleWord(language.value, group, id, english);
