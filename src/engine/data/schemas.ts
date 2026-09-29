/**
 * Zod schemas for every file in data/srd/. The importers (scripts/srd/) must produce JSON that
 * passes these, and the engine validates again at load time (engine/data/srd.ts).
 * Each file is a JSON array of records with unique `id`s, except rules-tables.json (an object).
 */
import { z } from 'zod';
import {
  AbilitySchema,
  ConditionSchema,
  CreatureTypeSchema,
  DamageTypeSchema,
  SizeSchema,
  SkillSchema,
} from '../rules/basics';
import { SpeedSchema, SensesSchema } from '../core/creature';
import {
  AreaSchema,
  CostSchema,
  DamageSchema,
  DiceSchema,
  DurationSchema,
  EffectSchema,
  IdSchema,
  TextSchema,
} from './common';

// ---------------------------------------------------------------- conditions

export const ConditionDataSchema = z.object({
  id: ConditionSchema,
  name: z.string(),
  text: TextSchema,
});

// ---------------------------------------------------------------- equipment

export const WEAPON_PROPERTIES = [
  'ammunition',
  'finesse',
  'heavy',
  'light',
  'loading',
  'range',
  'reach',
  'thrown',
  'two_handed',
  'versatile',
] as const;
export const WEAPON_MASTERIES = ['cleave', 'graze', 'nick', 'push', 'sap', 'slow', 'topple', 'vex'] as const;

export const WeaponSchema = z.object({
  id: IdSchema,
  name: z.string(),
  category: z.enum(['simple', 'martial']),
  kind: z.enum(['melee', 'ranged']),
  damage: DamageSchema,
  properties: z.array(z.enum(WEAPON_PROPERTIES)),
  versatileDice: DiceSchema.optional(),
  /** Normal/long range in feet (ranged or thrown). */
  range: z.object({ normal: z.number().int(), long: z.number().int() }).optional(),
  ammunition: z.string().optional(),
  mastery: z.enum(WEAPON_MASTERIES),
  weightLb: z.number().min(0),
  cost: CostSchema,
});

export const ArmorSchema = z.object({
  id: IdSchema,
  name: z.string(),
  category: z.enum(['light', 'medium', 'heavy', 'shield']),
  /** Base AC (shield: bonus). */
  ac: z.number().int(),
  /** Max Dex bonus: null = unlimited (light), 2 (medium), 0 (heavy). */
  dexCap: z.number().int().nullable(),
  strengthRequirement: z.number().int().optional(),
  stealthDisadvantage: z.boolean(),
  weightLb: z.number().min(0),
  cost: CostSchema,
  donMinutes: z.number().min(0),
  doffMinutes: z.number().min(0),
});

export const GearSchema = z.object({
  id: IdSchema,
  name: z.string(),
  category: z.enum(['adventuring_gear', 'ammunition', 'arcane_focus', 'druidic_focus', 'holy_symbol', 'tool', 'pack', 'mount', 'vehicle', 'tack', 'food', 'other']),
  cost: CostSchema,
  weightLb: z.number().min(0).optional(),
  text: TextSchema.optional(),
  /** For tools: the ability used. */
  toolAbility: AbilitySchema.optional(),
  /** Packs: contents as [itemId, quantity]. */
  contents: z.array(z.tuple([IdSchema, z.number().int().positive()])).optional(),
  /** Free-form tags (future crafting: "material"). */
  tags: z.array(z.string()).default([]),
});

// ---------------------------------------------------------------- origins

export const SpeciesSchema = z.object({
  id: IdSchema,
  name: z.string(),
  creatureType: CreatureTypeSchema,
  sizes: z.array(SizeSchema).min(1),
  speed: z.number().int(),
  darkvision: z.number().int().optional(),
  traits: z.array(z.object({ name: z.string(), text: TextSchema, effects: z.array(EffectSchema).optional() })),
  /** Sub-choices such as Draconic Ancestry or Elven Lineage. */
  lineages: z
    .array(z.object({ id: IdSchema, name: z.string(), damageType: DamageTypeSchema.optional(), text: TextSchema.optional() }))
    .optional(),
});

export const EquipmentChoiceSchema = z.object({
  /** [itemId, quantity] pairs. */
  items: z.array(z.tuple([IdSchema, z.number().int().positive()])),
  /** Plus coins, in CP. */
  cost: CostSchema,
  /** Items the player picks, e.g. "one kind of Gaming Set". */
  choices: z.array(z.string()).default([]),
});

export const BackgroundSchema = z.object({
  id: IdSchema,
  name: z.string(),
  /** Three abilities: +2/+1 or +1/+1/+1 among these. */
  abilityScores: z.array(AbilitySchema).length(3),
  featId: IdSchema,
  /** e.g. Magic Initiate (Cleric) → "cleric". */
  featOption: z.string().optional(),
  skills: z.array(SkillSchema).length(2),
  tool: z.string(),
  equipment: z.object({ a: EquipmentChoiceSchema, b: EquipmentChoiceSchema }),
});

export const FeatSchema = z.object({
  id: IdSchema,
  name: z.string(),
  category: z.enum(['origin', 'general', 'fighting_style', 'epic_boon']),
  prerequisite: z
    .object({
      level: z.number().int().optional(),
      abilities: z.array(z.object({ ability: AbilitySchema, min: z.number().int() })).optional(),
      /** Any one of these abilities meets the minimum. */
      anyAbility: z.boolean().optional(),
      feature: z.string().optional(),
      text: z.string().optional(),
    })
    .optional(),
  repeatable: z.boolean().default(false),
  /** Ability score increase offered by the feat. */
  abilityIncrease: z.object({ abilities: z.array(AbilitySchema), amount: z.number().int(), max: z.number().int() }).optional(),
  text: TextSchema,
  effects: z.array(EffectSchema).optional(),
});

// ---------------------------------------------------------------- classes

export const ClassFeatureSchema = z.object({
  id: IdSchema,
  name: z.string(),
  level: z.number().int().min(1).max(20),
  text: TextSchema,
  effects: z.array(EffectSchema).optional(),
});

export const SpellcastingProgressionSchema = z.enum(['none', 'full', 'half', 'third', 'pact']);

export const ClassSchema = z.object({
  id: IdSchema,
  name: z.string(),
  hitDie: z.enum(['d6', 'd8', 'd10', 'd12']),
  primaryAbilities: z.array(AbilitySchema).min(1),
  saveProficiencies: z.array(AbilitySchema).length(2),
  skillChoices: z.object({ count: z.number().int(), from: z.array(SkillSchema) }),
  weaponProficiencies: z.array(z.string()),
  armorTraining: z.array(z.enum(['light', 'medium', 'heavy', 'shield'])),
  toolProficiencies: z.array(z.string()).default([]),
  startingEquipment: z.array(EquipmentChoiceSchema).min(1),
  spellcasting: z.object({
    progression: SpellcastingProgressionSchema,
    ability: AbilitySchema.optional(),
    /** Cantrips known and prepared spells by class level (index 0 = level 1). */
    cantripsKnown: z.array(z.number().int()).length(20).optional(),
    preparedSpells: z.array(z.number().int()).length(20).optional(),
  }),
  /** Class-specific table columns (Rages, Sneak Attack, Focus Points...), by level. */
  columns: z.record(z.string(), z.array(z.union([z.number(), z.string()])).length(20)).default({}),
  multiclass: z.object({
    /** Ability minimums (13), all required unless anyOf. */
    prerequisites: z.array(AbilitySchema),
    anyOf: z.boolean().default(false),
    proficienciesGained: z.array(z.string()),
  }),
  features: z.array(ClassFeatureSchema),
  subclassLevel: z.number().int().min(1).max(3),
  beginnerFriendly: z.boolean().default(false),
});

export const SubclassSchema = z.object({
  id: IdSchema,
  name: z.string(),
  classId: IdSchema,
  text: TextSchema,
  features: z.array(ClassFeatureSchema),
  /** Always-prepared spells by class level. */
  spells: z.record(z.string(), z.array(IdSchema)).optional(),
});

// ---------------------------------------------------------------- spells

export const SPELL_SCHOOLS = ['abjuration', 'conjuration', 'divination', 'enchantment', 'evocation', 'illusion', 'necromancy', 'transmutation'] as const;

export const SpellSchema = z.object({
  id: IdSchema,
  name: z.string(),
  level: z.number().int().min(0).max(9),
  school: z.enum(SPELL_SCHOOLS),
  classes: z.array(IdSchema).min(1),
  castingTime: z.object({
    unit: z.enum(['action', 'bonus_action', 'reaction', 'minute', 'hour']),
    amount: z.number().int().positive().default(1),
    ritual: z.boolean().default(false),
    /** Reaction trigger text. */
    trigger: z.string().optional(),
  }),
  range: z.object({
    kind: z.enum(['self', 'touch', 'feet', 'miles', 'sight', 'unlimited', 'special']),
    amount: z.number().positive().optional(),
    /** "Self (15-foot Cone)" style areas centred on the caster. */
    area: AreaSchema.optional(),
  }),
  components: z.object({
    v: z.boolean(),
    s: z.boolean(),
    m: z.boolean(),
    material: z.string().optional(),
    /** Component with a GP cost (in CP), tracked abstractly. */
    materialCost: CostSchema.optional(),
    consumed: z.boolean().default(false),
  }),
  duration: DurationSchema,
  text: TextSchema,
  higherLevels: TextSchema.optional(),
  cantripUpgrade: TextSchema.optional(),
  /** Parsed hints (importer), refined by hand into `effects`. */
  attack: z.enum(['melee', 'ranged']).optional(),
  save: AbilitySchema.optional(),
  damage: z.array(DamageSchema).optional(),
  area: AreaSchema.optional(),
  conditions: z.array(ConditionSchema).optional(),
  effects: z.array(EffectSchema).optional(),
});

// ---------------------------------------------------------------- monsters

const MonsterActionSchema = z.object({
  name: z.string(),
  text: TextSchema,
  attack: z
    .object({
      kind: z.enum(['melee', 'ranged', 'melee_or_ranged']),
      bonus: z.number().int(),
      reach: z.number().int().optional(),
      range: z.object({ normal: z.number().int(), long: z.number().int().optional() }).optional(),
      damage: z.array(DamageSchema),
    })
    .optional(),
  save: z
    .object({
      ability: AbilitySchema,
      dc: z.number().int(),
      damage: z.array(DamageSchema).optional(),
      halfOnSuccess: z.boolean().default(false),
      area: AreaSchema.optional(),
    })
    .optional(),
  /** "Recharge 5–6" → 5. */
  recharge: z.number().int().min(2).max(6).optional(),
  /** "(3/Day)" style limits. */
  usesPerDay: z.number().int().positive().optional(),
  /** Multiattack: [actionName, count]. */
  multiattack: z.array(z.tuple([z.string(), z.number().int().positive()])).optional(),
  /** Legendary action cost. */
  cost: z.number().int().positive().optional(),
});

export const MonsterSchema = z.object({
  id: IdSchema,
  name: z.string(),
  size: z.array(SizeSchema).min(1),
  creatureType: CreatureTypeSchema,
  tags: z.array(z.string()).default([]),
  alignment: z.string(),
  ac: z.number().int(),
  initiative: z.number().int(),
  hp: z.number().int().positive(),
  hpDice: DiceSchema,
  speed: SpeedSchema,
  abilities: z.object({
    str: z.number().int(),
    dex: z.number().int(),
    con: z.number().int(),
    int: z.number().int(),
    wis: z.number().int(),
    cha: z.number().int(),
  }),
  /** Final save bonuses for all six abilities, as printed. */
  saves: z.record(AbilitySchema, z.number().int()),
  skills: z.partialRecord(SkillSchema, z.number().int()).default({}),
  resistances: z.array(DamageTypeSchema).default([]),
  immunities: z.array(DamageTypeSchema).default([]),
  vulnerabilities: z.array(DamageTypeSchema).default([]),
  conditionImmunities: z.array(ConditionSchema).default([]),
  senses: SensesSchema.default({}),
  passivePerception: z.number().int(),
  languages: z.string(),
  cr: z.number().min(0).max(30),
  xp: z.number().int().min(0),
  pb: z.number().int().min(2).max(9),
  gear: z.array(z.string()).default([]),
  traits: z.array(MonsterActionSchema).default([]),
  actions: z.array(MonsterActionSchema).default([]),
  bonusActions: z.array(MonsterActionSchema).default([]),
  reactions: z.array(MonsterActionSchema).default([]),
  legendary: z.object({ uses: z.number().int().positive(), actions: z.array(MonsterActionSchema) }).optional(),
  /** Which source file it came from (animals.md vs monsters-A-Z.md). */
  source: z.enum(['monsters', 'animals']),
});

// ---------------------------------------------------------------- magic items

export const MagicItemSchema = z.object({
  id: IdSchema,
  name: z.string(),
  category: z.enum(['armor', 'potion', 'ring', 'rod', 'scroll', 'staff', 'wand', 'weapon', 'wondrous_item']),
  rarity: z.enum(['common', 'uncommon', 'rare', 'very_rare', 'legendary', 'artifact', 'varies']),
  attunement: z.object({ required: z.boolean(), by: z.string().optional() }),
  /** Base item filter, e.g. "any sword" or a specific armor id. */
  baseItem: z.string().optional(),
  /** +1/+2/+3 style bonus. */
  bonus: z.number().int().optional(),
  charges: z.number().int().optional(),
  text: TextSchema,
  effects: z.array(EffectSchema).optional(),
});

// ---------------------------------------------------------------- rules tables

const LevelTable = <T extends z.ZodTypeAny>(t: T) => z.array(t).length(20);

export const RulesTablesSchema = z.object({
  /** XP needed to reach level i+1 (index 0 = level 1 = 0 XP). */
  xpByLevel: LevelTable(z.number().int()),
  /** XP value by CR, as [cr, xp] pairs. */
  xpByCR: z.array(z.tuple([z.number(), z.number().int()])),
  /** Spell slots by caster level for full casters (index 0 = level 1), 9 entries each. */
  spellSlotsFull: LevelTable(z.array(z.number().int()).length(9)),
  spellSlotsHalf: LevelTable(z.array(z.number().int()).length(9)),
  /** Warlock Pact Magic: [slots, slotLevel] by warlock level. */
  pactMagic: LevelTable(z.tuple([z.number().int(), z.number().int()])),
  /** Multiclass spellcaster table (combined caster level 1–20). */
  multiclassSlots: LevelTable(z.array(z.number().int()).length(9)),
  /** XP budget per character by level: [low, moderate, high]. */
  encounterBudget: LevelTable(z.tuple([z.number().int(), z.number().int(), z.number().int()])),
  /** Typical DCs: very easy … nearly impossible. */
  dcByDifficulty: z.record(z.string(), z.number().int()),
});

// ---------------------------------------------------------------- registry

/** File name → record schema. Used by the loader and the validation test. */
export const SRD_FILES = {
  'conditions.json': ConditionDataSchema,
  'weapons.json': WeaponSchema,
  'armor.json': ArmorSchema,
  'gear.json': GearSchema,
  'species.json': SpeciesSchema,
  'backgrounds.json': BackgroundSchema,
  'feats.json': FeatSchema,
  'classes.json': ClassSchema,
  'subclasses.json': SubclassSchema,
  'spells.json': SpellSchema,
  'monsters.json': MonsterSchema,
  'magic-items.json': MagicItemSchema,
} as const;

export type SrdFileName = keyof typeof SRD_FILES;
export type Weapon = z.infer<typeof WeaponSchema>;
export type Armor = z.infer<typeof ArmorSchema>;
export type Gear = z.infer<typeof GearSchema>;
export type Species = z.infer<typeof SpeciesSchema>;
export type Background = z.infer<typeof BackgroundSchema>;
export type Feat = z.infer<typeof FeatSchema>;
export type ClassData = z.infer<typeof ClassSchema>;
export type Subclass = z.infer<typeof SubclassSchema>;
export type Spell = z.infer<typeof SpellSchema>;
export type Monster = z.infer<typeof MonsterSchema>;
export type MagicItem = z.infer<typeof MagicItemSchema>;
export type ConditionData = z.infer<typeof ConditionDataSchema>;
export type RulesTables = z.infer<typeof RulesTablesSchema>;
