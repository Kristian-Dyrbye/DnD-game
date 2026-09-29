/**
 * Building blocks shared by the SRD data schemas: ids, dice, costs, damage and the
 * data-driven Effect description (executed by engine/rules/effects in A033).
 */
import { z } from 'zod';
import { AbilitySchema, ConditionSchema, DamageTypeSchema } from '../rules/basics';
import { parseDice } from '../core/dice';

/** snake_case id, e.g. "magic_missile", "goblin_warrior". */
export const IdSchema = z.string().regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/, 'id must be snake_case');

/** Dice notation checked with the real parser, e.g. "2d6+3". */
export const DiceSchema = z.string().refine(
  (s) => {
    try {
      parseDice(s);
      return true;
    } catch {
      return false;
    }
  },
  { message: 'invalid dice notation' },
);

/** Prices in copper pieces (1 GP = 100 CP) to avoid float money. */
export const CostSchema = z.number().int().min(0);

export const DamageSchema = z.object({
  dice: DiceSchema,
  type: DamageTypeSchema,
});
export type Damage = z.infer<typeof DamageSchema>;

/** Rules text as Markdown, kept for UI tooltips and as fixed facts for the narrator. */
export const TextSchema = z.string();

export const AREA_SHAPES = ['sphere', 'cube', 'cone', 'line', 'cylinder', 'emanation'] as const;
export const AreaSchema = z.object({
  shape: z.enum(AREA_SHAPES),
  /** Radius (sphere, cylinder, emanation), side (cube), length (cone, line) in feet. */
  size: z.number().positive(),
  /** Line width or cylinder height, in feet. */
  width: z.number().positive().optional(),
});
export type Area = z.infer<typeof AreaSchema>;

export const DurationSchema = z.object({
  unit: z.enum(['instantaneous', 'round', 'minute', 'hour', 'day', 'until_dispelled', 'special']),
  amount: z.number().int().positive().optional(),
  concentration: z.boolean().default(false),
});
export type Duration = z.infer<typeof DurationSchema>;

/**
 * One mechanical effect. Kept deliberately small; the effect executor (A033) interprets it.
 * Complex features point at a named hook (`kind: 'hook'`) implemented in code.
 */
export const EffectSchema: z.ZodType<Effect> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('damage'), damage: z.array(DamageSchema).min(1), upcast: DiceSchema.optional() }),
    z.object({ kind: z.literal('heal'), dice: DiceSchema, addSpellMod: z.boolean().default(false), upcast: DiceSchema.optional() }),
    z.object({ kind: z.literal('temp_hp'), dice: DiceSchema }),
    z.object({
      kind: z.literal('save'),
      ability: AbilitySchema,
      /** Fixed DC (monsters, items); omitted = caster's spell save DC. */
      dc: z.number().int().optional(),
      onFail: z.array(EffectSchema),
      onSuccess: z.union([z.literal('half'), z.literal('none'), z.array(EffectSchema)]).default('none'),
    }),
    z.object({
      kind: z.literal('attack'),
      attack: z.enum(['melee_spell', 'ranged_spell', 'melee_weapon', 'ranged_weapon']),
      onHit: z.array(EffectSchema),
    }),
    z.object({ kind: z.literal('condition'), condition: ConditionSchema, duration: DurationSchema.optional() }),
    z.object({ kind: z.literal('area'), area: AreaSchema, effects: z.array(EffectSchema) }),
    z.object({ kind: z.literal('hook'), hook: z.string(), params: z.record(z.string(), z.unknown()).optional() }),
  ]),
);

export type Effect =
  | { kind: 'damage'; damage: Damage[]; upcast?: string }
  | { kind: 'heal'; dice: string; addSpellMod: boolean; upcast?: string }
  | { kind: 'temp_hp'; dice: string }
  | {
      kind: 'save';
      ability: z.infer<typeof AbilitySchema>;
      dc?: number;
      onFail: Effect[];
      onSuccess: 'half' | 'none' | Effect[];
    }
  | { kind: 'attack'; attack: 'melee_spell' | 'ranged_spell' | 'melee_weapon' | 'ranged_weapon'; onHit: Effect[] }
  | { kind: 'condition'; condition: z.infer<typeof ConditionSchema>; duration?: Duration }
  | { kind: 'area'; area: Area; effects: Effect[] }
  | { kind: 'hook'; hook: string; params?: Record<string, unknown> };

/** Makes snake_case ids from names: "Goblin Warrior" → "goblin_warrior", "Tasha's Hideous Laughter" → "tashas_hideous_laughter". */
export function toId(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}
