/**
 * Runtime creature model shared by heroes, companions, NPCs and monsters. It holds the
 * *current* state (HP, conditions, resources); static data (class features, stat-block
 * actions) is referenced by id and looked up in data/srd. Saved as part of GameState.
 */
import { z } from 'zod';
import {
  AbilitySchema,
  AbilityScoresSchema,
  ConditionSchema,
  CreatureTypeSchema,
  DamageTypeSchema,
  ProficiencyLevelSchema,
  SizeSchema,
  SkillSchema,
} from '../rules/basics';
import { AppearanceSchema } from '../appearance/appearance';

export const SpeedSchema = z.object({
  walk: z.number().int().min(0),
  fly: z.number().int().min(0).optional(),
  swim: z.number().int().min(0).optional(),
  climb: z.number().int().min(0).optional(),
  burrow: z.number().int().min(0).optional(),
  /** Can fly in place (no falling when speed is 0). */
  hover: z.boolean().optional(),
});
export type Speed = z.infer<typeof SpeedSchema>;

export const SensesSchema = z.object({
  darkvision: z.number().int().min(0).optional(),
  blindsight: z.number().int().min(0).optional(),
  tremorsense: z.number().int().min(0).optional(),
  truesight: z.number().int().min(0).optional(),
});

/** A condition on a creature, with where it came from and when it ends. */
export const ActiveConditionSchema = z.object({
  condition: ConditionSchema,
  /** Id of the creature/effect that caused it (for "ends if the grappler is incapacitated" etc.). */
  sourceId: z.string().optional(),
  /** Remaining rounds; omitted = until removed. */
  roundsLeft: z.number().int().min(0).optional(),
  /** Save to end it at end of each turn. */
  endSave: z.object({ ability: AbilitySchema, dc: z.number().int() }).optional(),
});
export type ActiveCondition = z.infer<typeof ActiveConditionSchema>;

/** A limited-use resource (Rage uses, Ki/Focus, spell slots are tracked separately). */
export const ResourceSchema = z.object({
  current: z.number().int().min(0),
  max: z.number().int().min(0),
  recharge: z.enum(['short', 'long', 'turn', 'dawn', 'never']),
  /** Long-rest resources that regain some uses on a Short Rest (Rage: 1). */
  shortRestRegain: z.number().int().min(0).optional(),
});
export type Resource = z.infer<typeof ResourceSchema>;

/**
 * A temporary rules effect on a creature (weapon mastery riders, spell buffs...).
 * Expires on a turn event of some creature, after N rounds, or when consumed by an attack.
 */
export const ActiveEffectSchema = z.object({
  id: z.string(),
  /** What it is: 'sap', 'vex', 'slow', 'bless'... Engine code interprets keys. */
  key: z.string(),
  /** Creature that created it. */
  sourceId: z.string().optional(),
  /** For effects that concern one other creature (Vex: advantage against this target). */
  targetId: z.string().optional(),
  expires: z
    .object({
      on: z.enum(['start_of_turn', 'end_of_turn']),
      creatureId: z.string(),
      /** Matching events to ignore first ("end of your NEXT turn" set during your turn → 1). */
      skip: z.number().int().min(0).default(0),
    })
    .optional(),
  roundsLeft: z.number().int().min(0).optional(),
  /** Removed after the next attack roll it affects. */
  consumeOn: z.enum(['own_attack', 'own_attack_vs_target', 'attacked']).optional(),
  data: z.record(z.string(), z.unknown()).default({}),
});
export type ActiveEffect = z.infer<typeof ActiveEffectSchema>;

export const CreatureKindSchema = z.enum(['character', 'monster', 'npc']);

export const CreatureSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  kind: CreatureKindSchema,
  size: SizeSchema,
  creatureType: CreatureTypeSchema,
  abilities: AbilityScoresSchema,
  proficiencyBonus: z.number().int().min(2).max(9),
  maxHp: z.number().int().min(1),
  hp: z.number().int().min(0),
  tempHp: z.number().int().min(0).default(0),
  ac: z.number().int().min(0),
  speed: SpeedSchema,
  senses: SensesSchema.default({}),
  saveProficiencies: z.array(AbilitySchema).default([]),
  skills: z.partialRecord(SkillSchema, ProficiencyLevelSchema).default({}),
  resistances: z.array(DamageTypeSchema).default([]),
  immunities: z.array(DamageTypeSchema).default([]),
  vulnerabilities: z.array(DamageTypeSchema).default([]),
  conditionImmunities: z.array(ConditionSchema).default([]),
  conditions: z.array(ActiveConditionSchema).default([]),
  effects: z.array(ActiveEffectSchema).default([]),
  /** Dead (0 HP monster, 3 failed death saves, massive damage, exhaustion 6). */
  dead: z.boolean().default(false),
  /** 0–6 (2024 exhaustion). */
  exhaustion: z.number().int().min(0).max(6).default(0),
  languages: z.array(z.string()).default([]),
  resources: z.record(z.string(), ResourceSchema).default({}),
  /** Exact save / skill bonuses printed in a stat block (used instead of ability + proficiency). */
  saveBonuses: z.partialRecord(AbilitySchema, z.number().int()).optional(),
  skillBonuses: z.partialRecord(SkillSchema, z.number().int()).optional(),
  /** Monster stat block id (data/srd/monsters) for monsters and statted NPCs. */
  statBlockId: z.string().optional(),
});
export type Creature = z.infer<typeof CreatureSchema>;

/** One class a character has levels in (multiclassing = several entries). */
export const ClassLevelSchema = z.object({
  classId: z.string(),
  subclassId: z.string().optional(),
  level: z.number().int().min(1).max(20),
});

export const DeathSavesSchema = z.object({
  successes: z.number().int().min(0).max(3),
  failures: z.number().int().min(0).max(3),
  stable: z.boolean(),
});

/** Spell slots, pact slots, prepared spells and the current concentration effect. */
export const SpellcastingStateSchema = z.object({
  /** Remaining slots for levels 1–9 (index 0 = level 1). */
  slots: z.array(z.number().int().min(0)).length(9),
  maxSlots: z.array(z.number().int().min(0)).length(9),
  /** Warlock Pact Magic slots (all of the same level; recharge on a Short Rest). */
  pact: z.object({ current: z.number().int().min(0), max: z.number().int().min(0), level: z.number().int().min(1).max(5) }).optional(),
  cantrips: z.array(z.string()).default([]),
  /** Prepared (or always-prepared) spell ids, each tagged with the class it's cast through. */
  prepared: z.array(z.object({ spellId: z.string(), classId: z.string() })).default([]),
  concentration: z
    .object({
      spellId: z.string(),
      /** Stamped on every condition the spell created (see effects.ts). */
      sourceId: z.string(),
      targetIds: z.array(z.string()),
      roundsLeft: z.number().int().min(0).optional(),
    })
    .optional(),
});
export type SpellcastingState = z.infer<typeof SpellcastingStateSchema>;

/** One stack of items a character carries. Equipped weapons/armor drive AC and attacks. */
export const InventoryItemSchema = z.object({
  /** Unique within the inventory (so two identical daggers can be equipped separately). */
  uid: z.string(),
  /** Id in weapons/armor/gear/magic items. */
  itemId: z.string(),
  quantity: z.number().int().min(0),
  equipped: z.enum(['armor', 'shield', 'main_hand', 'off_hand', 'worn']).optional(),
  /** Magic item id layered on a base item (weapon_1 on a longsword). */
  magicItemId: z.string().optional(),
  attuned: z.boolean().optional(),
});
export type InventoryItem = z.infer<typeof InventoryItemSchema>;

export const SCAR_LOCATIONS = [
  'left_cheek',
  'right_cheek',
  'brow',
  'jaw',
  'neck',
  'chest',
  'back',
  'left_shoulder',
  'right_shoulder',
  'left_arm',
  'right_arm',
  'left_hand',
  'right_hand',
  'left_leg',
  'right_leg',
] as const;
export type ScarLocation = (typeof SCAR_LOCATIONS)[number];

/** A permanent scar: where, what made it, where it happened (spec §12). */
export const ScarSchema = z.object({
  id: z.string(),
  location: z.enum(SCAR_LOCATIONS),
  cause: z.enum(['crit', 'down', 'story']),
  description: z.string(),
  origin: z.string().optional(),
  /** Campaign minutes when it happened. */
  at: z.number().int().min(0).default(0),
});
export type Scar = z.infer<typeof ScarSchema>;

/** Player characters and companions: a creature plus class, species, background and progression. */
export const CharacterSchema = CreatureSchema.extend({
  kind: z.literal('character'),
  classes: z.array(ClassLevelSchema).min(1),
  speciesId: z.string(),
  backgroundId: z.string(),
  xp: z.number().int().min(0).default(0),
  /** Remaining hit dice per die size, e.g. { d10: 3, d8: 2 }. */
  hitDice: z.record(z.string(), z.number().int().min(0)).default({}),
  featIds: z.array(z.string()).default([]),
  deathSaves: DeathSavesSchema.default({ successes: 0, failures: 0, stable: false }),
  heroicInspiration: z.boolean().default(false),
  spellcasting: SpellcastingStateSchema.optional(),
  inventory: z.array(InventoryItemSchema).default([]),
  /** Coins in copper pieces. */
  coins: z.number().int().min(0).default(0),
  /** Chosen lineage/ancestry (dragon colour, elven lineage...). */
  lineageId: z.string().optional(),
  /** Weapon ids whose mastery property the character can use. */
  weaponMasteries: z.array(z.string()).default([]),
  /** Proficiency tokens: weapons ('simple', 'martial', 'martial:light', weapon ids), armor ('light'...'shield'), tools (item ids). */
  proficiencies: z
    .object({
      weapons: z.array(z.string()).default([]),
      armor: z.array(z.string()).default([]),
      tools: z.array(z.string()).default([]),
    })
    .prefault({}),
  /** Chosen class options (fighting style feat id, metamagic, invocations...). */
  choices: z.record(z.string(), z.array(z.string())).default({}),
  personality: z.object({ traits: z.string(), ideals: z.string(), bonds: z.string(), flaws: z.string(), backstory: z.string() }).partial().default({}),
  appearance: AppearanceSchema.prefault({}),
  /** Permanent scars with their origin (character/scars.ts). */
  scars: z.array(ScarSchema).default([]),
});
export type Character = z.infer<typeof CharacterSchema>;

export function totalLevel(c: Pick<Character, 'classes'>): number {
  return c.classes.reduce((sum, cl) => sum + cl.level, 0);
}

/** Which side a creature fights on. */
export const SideSchema = z.enum(['party', 'enemy', 'neutral']);
export type Side = z.infer<typeof SideSchema>;

export const GridPosSchema = z.object({ x: z.number().int(), y: z.number().int() });
export type GridPos = z.infer<typeof GridPosSchema>;

/** A creature taking part in an encounter. Turn-economy fields are added by the combat module (A062). */
export const CombatantSchema = z.object({
  creatureId: z.string(),
  side: SideSchema,
  position: GridPosSchema,
  initiative: z.number().int().optional(),
  /** Controlled by the player (hero, player-controlled companions) or by engine AI. */
  controller: z.enum(['player', 'ai']),
});
export type Combatant = z.infer<typeof CombatantSchema>;
