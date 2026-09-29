/**
 * Core SRD 5.2 vocabulary: abilities, skills, damage types, sizes, creature types,
 * conditions, plus the basic formulas (ability modifier, proficiency bonus).
 * Each list is a const tuple + zod enum so data files and saves validate against it.
 */
import { z } from 'zod';

export const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
export const AbilitySchema = z.enum(ABILITIES);
export type Ability = z.infer<typeof AbilitySchema>;

export const ABILITY_NAMES: Record<Ability, string> = {
  str: 'Strength',
  dex: 'Dexterity',
  con: 'Constitution',
  int: 'Intelligence',
  wis: 'Wisdom',
  cha: 'Charisma',
};

export const AbilityScoresSchema = z.object({
  str: z.number().int().min(1).max(30),
  dex: z.number().int().min(1).max(30),
  con: z.number().int().min(1).max(30),
  int: z.number().int().min(1).max(30),
  wis: z.number().int().min(1).max(30),
  cha: z.number().int().min(1).max(30),
});
export type AbilityScores = z.infer<typeof AbilityScoresSchema>;

/** SRD skills and their default abilities. */
export const SKILL_ABILITY = {
  acrobatics: 'dex',
  animal_handling: 'wis',
  arcana: 'int',
  athletics: 'str',
  deception: 'cha',
  history: 'int',
  insight: 'wis',
  intimidation: 'cha',
  investigation: 'int',
  medicine: 'wis',
  nature: 'int',
  perception: 'wis',
  performance: 'cha',
  persuasion: 'cha',
  religion: 'int',
  sleight_of_hand: 'dex',
  stealth: 'dex',
  survival: 'wis',
} as const satisfies Record<string, Ability>;

export type Skill = keyof typeof SKILL_ABILITY;
export const SKILLS = Object.keys(SKILL_ABILITY) as Skill[];
export const SkillSchema = z.enum(SKILLS as [Skill, ...Skill[]]);

export const SKILL_NAMES: Record<Skill, string> = {
  acrobatics: 'Acrobatics',
  animal_handling: 'Animal Handling',
  arcana: 'Arcana',
  athletics: 'Athletics',
  deception: 'Deception',
  history: 'History',
  insight: 'Insight',
  intimidation: 'Intimidation',
  investigation: 'Investigation',
  medicine: 'Medicine',
  nature: 'Nature',
  perception: 'Perception',
  performance: 'Performance',
  persuasion: 'Persuasion',
  religion: 'Religion',
  sleight_of_hand: 'Sleight of Hand',
  stealth: 'Stealth',
  survival: 'Survival',
};

/** none < half (e.g. Jack of All Trades) < proficient < expertise. */
export const PROFICIENCY_LEVELS = ['none', 'half', 'proficient', 'expertise'] as const;
export const ProficiencyLevelSchema = z.enum(PROFICIENCY_LEVELS);
export type ProficiencyLevel = z.infer<typeof ProficiencyLevelSchema>;

export const DAMAGE_TYPES = [
  'acid',
  'bludgeoning',
  'cold',
  'fire',
  'force',
  'lightning',
  'necrotic',
  'piercing',
  'poison',
  'psychic',
  'radiant',
  'slashing',
  'thunder',
] as const;
export const DamageTypeSchema = z.enum(DAMAGE_TYPES);
export type DamageType = z.infer<typeof DamageTypeSchema>;

export const SIZES = ['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'] as const;
export const SizeSchema = z.enum(SIZES);
export type Size = z.infer<typeof SizeSchema>;

/** Space a creature controls, in feet (SRD). Tiny is 2.5 ft; on the grid it shares a square. */
export const SIZE_SPACE_FEET: Record<Size, number> = {
  tiny: 2.5,
  small: 5,
  medium: 5,
  large: 10,
  huge: 15,
  gargantuan: 20,
};

/** Grid squares per side (5-ft squares, min 1). */
export function sizeSquares(size: Size): number {
  return Math.max(1, SIZE_SPACE_FEET[size] / 5);
}

export const CREATURE_TYPES = [
  'aberration',
  'beast',
  'celestial',
  'construct',
  'dragon',
  'elemental',
  'fey',
  'fiend',
  'giant',
  'humanoid',
  'monstrosity',
  'ooze',
  'plant',
  'undead',
] as const;
export const CreatureTypeSchema = z.enum(CREATURE_TYPES);
export type CreatureType = z.infer<typeof CreatureTypeSchema>;

/** SRD 5.2 conditions. Exhaustion has levels (1–6), tracked separately on the creature. */
export const CONDITIONS = [
  'blinded',
  'charmed',
  'deafened',
  'exhaustion',
  'frightened',
  'grappled',
  'incapacitated',
  'invisible',
  'paralyzed',
  'petrified',
  'poisoned',
  'prone',
  'restrained',
  'stunned',
  'unconscious',
] as const;
export const ConditionSchema = z.enum(CONDITIONS);
export type Condition = z.infer<typeof ConditionSchema>;

// ---------------------------------------------------------------- formulas

/** floor((score − 10) / 2). */
export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

/** Character proficiency bonus by total character level: +2 at 1–4 … +6 at 17–20. */
export function proficiencyBonus(level: number): number {
  if (!Number.isInteger(level) || level < 1 || level > 20) throw new RangeError(`Level must be 1–20, got ${level}`);
  return Math.ceil(level / 4) + 1;
}

/** Monster proficiency bonus by Challenge Rating: +2 at CR 0–4 … +9 at CR 29–30. */
export function proficiencyBonusForCR(cr: number): number {
  if (cr < 0 || cr > 30) throw new RangeError(`CR must be 0–30, got ${cr}`);
  if (cr < 5) return 2;
  return Math.ceil((Math.floor(cr) - 4) / 4) + 2;
}

/** Multiplier on proficiency bonus for a proficiency level. Half proficiency rounds down. */
export function proficiencyContribution(level: ProficiencyLevel, pb: number): number {
  switch (level) {
    case 'none':
      return 0;
    case 'half':
      return Math.floor(pb / 2);
    case 'proficient':
      return pb;
    case 'expertise':
      return pb * 2;
  }
}

/** Challenge ratings as they appear in stat blocks ("1/8" → 0.125). */
export function parseCR(cr: string | number): number {
  if (typeof cr === 'number') return cr;
  const frac = /^(\d+)\/(\d+)$/.exec(cr.trim());
  if (frac) return Number(frac[1]) / Number(frac[2]);
  const n = Number(cr);
  if (!Number.isFinite(n)) throw new RangeError(`Bad CR: ${cr}`);
  return n;
}

export function formatCR(cr: number): string {
  if (cr === 0.125) return '1/8';
  if (cr === 0.25) return '1/4';
  if (cr === 0.5) return '1/2';
  return String(cr);
}

export function formatModifier(mod: number): string {
  return mod < 0 ? `−${Math.abs(mod)}` : `+${mod}`;
}
