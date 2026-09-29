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
});
export type Resource = z.infer<typeof ResourceSchema>;

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
  /** Dead (0 HP monster, 3 failed death saves, massive damage, exhaustion 6). */
  dead: z.boolean().default(false),
  /** 0–6 (2024 exhaustion). */
  exhaustion: z.number().int().min(0).max(6).default(0),
  languages: z.array(z.string()).default([]),
  resources: z.record(z.string(), ResourceSchema).default({}),
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
