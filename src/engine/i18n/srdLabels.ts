/**
 * SRD words inside engine lines (A149e). Roll modifiers and Advantage/Disadvantage sources are
 * English labels built all over the rules code ("Strength", "Half Cover", "Prone (target, within 5 ft)",
 * "Bless", "Paralyzed: Strength"); instead of threading a language through every label site they are
 * translated where a line is printed: `srdLabel` maps a known English label to the session language
 * (English passes through untouched), `mathLine` is formatD20Test with translated labels.
 * In-sentence words: `conditionWord` / `damageWord` / `creatureTypeWord` (English keeps the ids the
 * lines always used; other languages use the SRD name overlays in lower case).
 */
import { formatD20Test, type D20TestText, type Modifier } from '../core/dice';
import type { Language } from '../../shared/i18nCore';
import { ABILITY_NAMES, type Ability } from '../rules/basics';
import type { EngineKey, Messages } from '../i18n';
import { en } from './en';
import { abilityName, ruleWord, srdName, type SrdNameKind } from './srdNames';
import { srdNameSources, titleCase } from './srdNameSources';

/** Fixed English labels with their own catalog keys (feature names, cover, misc). */
const FIXED_KEYS: EngineKey[] = [
  'mod.proficiency', 'mod.expertise', 'mod.halfProficiency', 'mod.exhaustion',
  'lbl.halfCover', 'lbl.threeQuartersCover', 'lbl.spellcasting', 'lbl.magicArmor', 'lbl.unarmored',
  'lbl.unarmoredDefense', 'lbl.draconicResilience', 'lbl.jackOfAllTrades', 'lbl.initiative', 'lbl.bonus',
  'lbl.spellAttack', 'lbl.rage', 'lbl.dangerSense', 'lbl.recklessAttack', 'lbl.recklessAttackTarget',
  'lbl.feralInstinct', 'lbl.remarkableAthlete', 'lbl.bardicInspiration', 'lbl.sacredWeapon', 'lbl.indomitable',
  'lbl.tacticalMind', 'lbl.thaumaturge', 'lbl.magician', 'lbl.surprised', 'lbl.sapped', 'lbl.steadyAim',
  'lbl.enlarge', 'lbl.reduce',
];
/** Name kinds searched by English name, first match wins. */
const NAME_KINDS: SrdNameKind[] = ['conditions', 'spells', 'feats', 'weapons', 'armor', 'magic-items', 'classes'];
const SUFFIXES: [string, EngineKey][] = [
  [' (attacker)', 'lbl.attacker'],
  [' (target)', 'lbl.target'],
  [' (target, within 5 ft)', 'lbl.targetNear'],
  [' (target, beyond 5 ft)', 'lbl.targetFar'],
];

const dictionaries = new Map<Language, Map<string, string>>();

function dictionary(msgs: Messages): Map<string, string> {
  const hit = dictionaries.get(msgs.lang);
  if (hit) return hit;
  const d = new Map<string, string>();
  const add = (english: string, text: string) => {
    if (!d.has(english)) d.set(english, text);
  };
  for (const k of FIXED_KEYS) add(en[k], msgs.m(k));
  for (const [a, n] of Object.entries(ABILITY_NAMES)) add(n, abilityName(msgs.lang, a as Ability));
  for (const kind of NAME_KINDS) for (const s of srdNameSources(kind)) if (typeof s.value === 'string') add(s.value, srdName(msgs.lang, kind, s.path, s.value));
  for (const id of ['cleave', 'graze', 'nick', 'push', 'sap', 'slow', 'topple', 'vex']) add(titleCase(id), ruleWord(msgs.lang, 'mastery', id, titleCase(id)));
  dictionaries.set(msgs.lang, d);
  return d;
}

/** A roll label or Advantage/Disadvantage source in the session language; unknown labels stay as they are. */
export function srdLabel(msgs: Messages, label: string): string {
  if (msgs.lang === 'en') return label;
  const d = dictionary(msgs);
  const direct = d.get(label);
  if (direct !== undefined) return direct;
  for (const [suffix, key] of SUFFIXES) {
    if (label.endsWith(suffix)) return msgs.m(key, { name: srdLabel(msgs, label.slice(0, -suffix.length)) });
  }
  const colon = label.indexOf(': ');
  if (colon > 0) return `${srdLabel(msgs, label.slice(0, colon))}: ${srdLabel(msgs, label.slice(colon + 2))}`;
  if (label.startsWith('Reduce ')) return `${msgs.m('lbl.reduce')} ${label.slice(7)}`;
  return label;
}

export const srdLabels = (msgs: Messages, labels: readonly string[]): string[] => labels.map((l) => srdLabel(msgs, l));

/** formatD20Test with the modifier labels in the session language. */
export function mathLine(t: D20TestText, msgs: Messages): string {
  return formatD20Test(msgs.lang === 'en' ? t : { ...t, modifiers: t.modifiers.map((m): Modifier => ({ ...m, label: srdLabel(msgs, m.label) })) }, msgs);
}

const lower = (s: string) => s.toLocaleLowerCase();

/** Condition inside a sentence: English the id ("poisoned"), else the overlay name in lower case ("forgiftet"). */
export const conditionWord = (lang: Language, id: string): string => (lang === 'en' ? id : lower(srdName(lang, 'conditions', id, id)));
/** Damage type inside a sentence: "fire" / "ild". */
export const damageWord = (lang: Language, id: string): string => (lang === 'en' ? id : lower(ruleWord(lang, 'damage', id, id)));
/** Creature type inside a sentence: "undead" / "udød". */
export const creatureTypeWord = (lang: Language, id: string): string => (lang === 'en' ? id : lower(ruleWord(lang, 'creature_type', id, id)));
