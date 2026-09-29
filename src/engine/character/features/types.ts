/**
 * Class feature implementation contract. Each class module registers FeatureImpl objects keyed
 * by (classId or subclassId, feature id). Hook points are small and composable; the queries in
 * queries.ts merge all active features, so combat/checks never special-case a class.
 */
import type { Modifier } from '../../core/dice';
import type { Character, Creature, Resource } from '../../core/creature';
import type { Rng } from '../../core/rng';
import type { Damage } from '../../data/common';
import type { SrdDatabase } from '../../data/srd';
import type { Ability, Condition, DamageType, Skill } from '../../rules/basics';
import type { WeaponAttack } from '../derived';

export interface Modes {
  advantage: string[];
  disadvantage: string[];
}

export interface WeaponHitContext {
  attack: WeaponAttack;
  target: Creature;
  crit: boolean;
  rng: Rng;
  /** First hit with this kind of rider this turn (Frenzy, Sneak Attack: once per turn). */
  firstHitThisTurn: boolean;
  /** The attack had advantage (Sneak Attack) / Reckless Attack was used. */
  hadAdvantage: boolean;
}

export interface WeaponHitRider {
  extraDamage?: Damage[];
  /** Flat bonuses added to the weapon damage (Rage Damage). */
  modifiers?: Modifier[];
  text?: string;
}

export interface FeatureActionResult {
  character: Character;
  /** Other creatures changed by the action (Bardic Inspiration target...). */
  others?: Creature[];
  log: string[];
}

export interface FeatureActionParams {
  rng: Rng;
  target?: Creature;
  /** Several targets (Turn Undead, Land's Aid area). */
  targets?: Creature[];
  choice?: string;
}

/** Spell modifiers a feature adds when casting (see spellcasting.castSpell options). */
export interface SpellOptions {
  healBonus?: number;
  maxHealDice?: boolean;
  cantripDamageBonus?: number;
}

export interface FeatureAction {
  id: string;
  name: string;
  cost: 'action' | 'bonus_action' | 'reaction' | 'free';
  /** Resource spent (key in character.resources). */
  resource?: string;
  /** Why it can't be used right now, or undefined if usable. */
  problem?(c: Character): string | undefined;
  use(c: Character, db: SrdDatabase, params: FeatureActionParams): FeatureActionResult;
}

export interface FeatureImpl {
  /** snake_case feature id as in classes.json / subclasses.json (e.g. 'rage'). */
  id: string;
  /** Class or subclass id that owns it. */
  owner: string;
  /** Resource pools granted (max computed from level). Current values are preserved by syncResources. */
  resources?(c: Character, db: SrdDatabase): Record<string, Resource>;
  saveModes?(c: Character, ability: Ability): Partial<Modes>;
  checkModes?(c: Character, ability: Ability, skill?: Skill): Partial<Modes>;
  initiativeModes?(c: Character): Partial<Modes>;
  /** Flat bonuses to ability checks (Thaumaturge: +Wis to Arcana/Religion). */
  checkBonus?(c: Character, ability: Ability, skill?: Skill): Modifier[];
  /** Extra resistances while conditions hold (Rage: B/P/S). */
  resistances?(c: Character): DamageType[];
  conditionImmunities?(c: Character): Condition[];
  /** Attack roll modes when this character attacks / is attacked. */
  attackModes?(c: Character, attack: { melee: boolean; ability: Ability }): Partial<Modes>;
  attackedModes?(c: Character, attackerIsMelee: boolean): Partial<Modes>;
  onWeaponHit?(c: Character, db: SrdDatabase, ctx: WeaponHitContext): WeaponHitRider | undefined;
  actions?: FeatureAction[];
  /** Applied once when the feature is gained (Primal Champion +4 Str/Con, Jack of All Trades). */
  onGain?(c: Character, db: SrdDatabase): Character;
  /** Changes to a spell being cast (Disciple of Life, Supreme Healing, Potent Spellcasting). */
  spellOptions?(c: Character, spell: { level: number; healing: boolean; damaging: boolean }, slotLevel: number): SpellOptions;
  /** Whether the character can cast spells / concentrate while this feature is active (Rage: no). */
  blocksSpellcasting?(c: Character): boolean;
}
