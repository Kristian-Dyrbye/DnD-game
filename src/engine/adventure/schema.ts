/**
 * Adventure format v1 (see ADVENTURE_FORMAT.md). Authored arcs and generated side quests share this
 * schema, so one runner plays both. The data is the skeleton: scenes, what can be done there, the
 * DCs and the consequences. The LLM only narrates it.
 */
import { z } from 'zod';
import { ABILITIES, ConditionSchema as RulesConditionSchema, DamageTypeSchema, SKILLS } from '../rules/basics';
import { TIERS } from '../world/factions';
import { DungeonMapSchema } from '../world/dungeon';
import { AdventureFlagDocSchema } from '../world/flags';
import { SCAR_LOCATIONS } from '../core/creature';

export const ADVENTURE_FORMAT_VERSION = 1;

const Id = z.string().regex(/^[a-z0-9_.-]+$/, 'ids are lowercase snake_case (dots allowed for flag namespaces)');
const FlagValue = z.union([z.boolean(), z.number(), z.string()]);

// ---------------------------------------------------------------- conditions

/** SRD DC tiers (rules-tables dcByDifficulty). */
export const DIFFICULTIES = ['very_easy', 'easy', 'medium', 'hard', 'very_hard', 'nearly_impossible'] as const;
export type DifficultyTier = (typeof DIFFICULTIES)[number];

export const TIMES_OF_DAY = ['dawn', 'day', 'dusk', 'night'] as const;

export type Condition =
  | { flag: string; eq?: z.infer<typeof FlagValue>; gte?: number; lte?: number; exists?: boolean }
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | { timeOfDay: (typeof TIMES_OF_DAY)[number][] }
  | { weather: string[] }
  | { reputation: { faction: string; gte?: number; lte?: number; tier?: (typeof TIERS)[number] } }
  | { level: { gte?: number; lte?: number } }
  | { visited: string }
  | { hours: { from: number; to: number } }
  | { coins: { gte: number } }
  | { item: string }
  | { since: { flag: string; gteHours?: number; lteHours?: number } }
  | { count: { flags: string[]; min?: number; max?: number } };

export const ConditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.object({ flag: z.string(), eq: FlagValue.optional(), gte: z.number().optional(), lte: z.number().optional(), exists: z.boolean().optional() }).strict(),
    z.object({ all: z.array(ConditionSchema) }).strict(),
    z.object({ any: z.array(ConditionSchema) }).strict(),
    z.object({ not: ConditionSchema }).strict(),
    z.object({ timeOfDay: z.array(z.enum(TIMES_OF_DAY)).min(1) }).strict(),
    z.object({ weather: z.array(z.string()).min(1) }).strict(),
    // `tier`: at least this reputation tier (hostile … revered).
    z.object({ reputation: z.object({ faction: z.string(), gte: z.number().optional(), lte: z.number().optional(), tier: z.enum(TIERS).optional() }) }).strict(),
    z.object({ level: z.object({ gte: z.number().optional(), lte: z.number().optional() }) }).strict(),
    z.object({ visited: z.string() }).strict(),
    // Hour window [from, to) on the 24-hour clock; wraps past midnight when from > to (22 → 6).
    z.object({ hours: z.object({ from: z.number().int().min(0).max(23), to: z.number().int().min(0).max(24) }) }).strict(),
    // The hero carries at least this many copper pieces (gate a bribe or a purchase).
    z.object({ coins: z.object({ gte: z.number().int().min(0) }).strict() }).strict(),
    // The hero carries this item.
    z.object({ item: z.string() }).strict(),
    // Hours of game time since `flag` was last set by an outcome (false if never set).
    z.object({ since: z.object({ flag: z.string(), gteHours: z.number().min(0).optional(), lteHours: z.number().min(0).optional() }).strict() }).strict(),
    // How many of these flags are truthy, at least `min` / at most `max` ("two of the three clues").
    z.object({ count: z.object({ flags: z.array(z.string()).min(1), min: z.number().int().min(0).optional(), max: z.number().int().min(0).optional() }).strict() }).strict(),
  ]),
);

// ---------------------------------------------------------------- outcomes

export const FlagWriteSchema = z.union([
  z.object({ set: z.string(), value: FlagValue.default(true) }).strict(),
  z.object({ inc: z.string(), by: z.number().default(1) }).strict(),
  z.object({ clear: z.string() }).strict(),
]);
export type FlagWrite = z.infer<typeof FlagWriteSchema>;

/** Everything a choice, check, beat or encounter can cause. All fields optional. */
export const OutcomeSchema = z
  .object({
    /** Fixed facts the narrator must describe (never contradicted, never embellished mechanically). */
    text: z.string().optional(),
    /** Variants of the text: one is picked (seeded by campaign and time) and told after `text`, so repeats read differently. */
    texts: z.array(z.string()).min(1).optional(),
    flags: z.array(FlagWriteSchema).default([]),
    /** Move to another scene (same adventure). */
    goto: Id.optional(),
    /** Roll on a loot table / give fixed items and coins (copper). */
    loot: Id.optional(),
    items: z.array(z.object({ itemId: z.string(), quantity: z.number().int().min(1).default(1) })).default([]),
    coins: z.number().int().min(0).default(0),
    /** Items taken from the hero (as many as they carry, up to `quantity`). */
    removeItems: z.array(z.object({ itemId: z.string(), quantity: z.number().int().min(1).default(1) })).default([]),
    /** Coins (copper) paid. If the hero can't pay, nothing else in this outcome happens. */
    cost: z.number().int().min(0).default(0),
    /** Damage to the hero (or the whole party), optionally halved by a save. Heroic mode never drops below 1 HP. */
    damage: z
      .object({
        dice: z.string(),
        type: DamageTypeSchema,
        target: z.enum(['hero', 'party']).default('hero'),
        save: z.object({ ability: z.enum(ABILITIES), dc: z.number().int().min(1).max(30), half: z.boolean().default(true) }).strict().optional(),
      })
      .strict()
      .optional(),
    /** A permanent scar on the hero from a story event (spec §12), logged with this adventure as origin. */
    scar: z.object({ description: z.string(), location: z.enum(SCAR_LOCATIONS).optional(), damageType: z.string().optional() }).strict().optional(),
    /** Exhaustion levels gained (negative: removed). */
    exhaustion: z.number().int().min(-6).max(6).default(0),
    xp: z.number().int().min(0).default(0),
    reputation: z.array(z.object({ faction: z.string(), delta: z.number().int() })).default([]),
    /** Start an encounter (combat runner, A068). */
    encounter: Id.optional(),
    /** Minutes that pass. */
    minutes: z.number().int().min(0).default(0),
    /** Lore location ids revealed on the world map (a map, a rumour, a signpost). */
    discover: z.array(z.string()).default([]),
    /** A companion from data/companions.json joins the party (or waits if the party is full). */
    recruit: z.string().optional(),
    /** Companion approval changes (DESIGN §11: ±5 minor, ±10 significant, ±20 defining). Only companions in the party react. */
    approval: z.array(z.object({ companion: z.string(), delta: z.number().int().min(-50).max(50) })).default([]),
    /** A companion leaves the party: to wait, or for good (left / betrayed / dead). */
    companionLeaves: z.object({ id: z.string(), status: z.enum(['waiting', 'left', 'betrayed', 'dead']) }).optional(),
    /** A companion who waited, left or betrayed the party comes back (not the dead); loyalty rises to at least `loyalty`. */
    companionReturns: z.object({ id: z.string(), loyalty: z.number().int().min(0).max(100).default(40) }).strict().optional(),
    /**
     * Conditions from the story (poison in the ale, a terrifying vision): on the hero or the whole
     * party, for `minutes` of game time (default: until removed). `remove: true` ends it instead.
     */
    conditions: z
      .array(z.object({ condition: RulesConditionSchema, target: z.enum(['hero', 'party']).default('hero'), minutes: z.number().int().min(1).optional(), remove: z.boolean().default(false) }).strict())
      .default([]),
    /**
     * The party rests here (safe places only): 'short' spends Hit Dice automatically (1 hour),
     * 'long' restores HP, Hit Dice, spell slots and daily resources (8 hours).
     */
    rest: z.enum(['short', 'long']).optional(),
    /** Reveal a room of a dungeon map (a map found, a door opened, a view from a balcony). */
    revealRoom: z.object({ map: Id, room: Id }).strict().optional(),
    /** A one-line tutorial tip shown the first time this outcome happens (spec §4 starter arc: "the UI shows a one-line tip"). */
    tip: z.string().optional(),
    /** Ends the adventure with this ending id. */
    ending: Id.optional(),
  })
  .strict();
export type Outcome = z.infer<typeof OutcomeSchema>;
export type OutcomeInput = z.input<typeof OutcomeSchema>;

// ---------------------------------------------------------------- checks and actions

export const CheckSchema = z
  .object({
    skill: z.enum(SKILLS).optional(),
    /** Plain ability check (or the ability to use with `skill`, e.g. Intimidation with Strength). */
    ability: z.enum(ABILITIES).optional(),
    /** Saving throw instead of a check. */
    save: z.enum(ABILITIES).optional(),
    dc: z.number().int().min(1).max(30),
    /** Group check (SRD): the hero and every conscious companion roll; it succeeds if at least half succeed. */
    group: z.boolean().default(false),
    /** Source names that grant advantage / disadvantage when the condition holds. */
    advantageIf: z.array(z.object({ if: ConditionSchema, source: z.string() })).default([]),
    disadvantageIf: z.array(z.object({ if: ConditionSchema, source: z.string() })).default([]),
    success: OutcomeSchema.prefault({}),
    failure: OutcomeSchema.prefault({}),
  })
  .strict()
  .refine((c) => [c.skill ?? c.ability, c.save].filter(Boolean).length === 1, { message: 'a check needs exactly one of skill/ability or save' });
export type Check = z.infer<typeof CheckSchema>;

/** Something the player can do in a scene (also used for POI interactions). */
export const ActionSchema = z
  .object({
    id: Id,
    label: z.string(),
    /** Hidden unless this holds. */
    if: ConditionSchema.optional(),
    /** Can only be done once (tracked per adventure). */
    once: z.boolean().default(false),
    check: CheckSchema.optional(),
    /** Applied when there is no check. */
    outcome: OutcomeSchema.optional(),
    /** Words that let free text match this action before intent parsing exists (A055). */
    keywords: z.array(z.string()).default([]),
  })
  .strict();
export type Action = z.infer<typeof ActionSchema>;

export const PoiSchema = z
  .object({
    id: Id,
    name: z.string(),
    /** Description seed for the narrator. */
    seed: z.string(),
    if: ConditionSchema.optional(),
    actions: z.array(ActionSchema).default([]),
  })
  .strict();

export const ExitSchema = z
  .object({
    id: Id,
    label: z.string(),
    to: Id,
    if: ConditionSchema.optional(),
    /** Optional gate (e.g. climb the wall, DC 12 Athletics); failure keeps the hero here. */
    check: CheckSchema.optional(),
    minutes: z.number().int().min(0).default(0),
  })
  .strict();

export const SceneSchema = z
  .object({
    id: Id,
    name: z.string(),
    /** Lore location id (world map / region tone). */
    locationId: z.string().optional(),
    seed: z.string(),
    /** Extra seed text that only applies when the condition holds (flags change the scene). */
    variants: z.array(z.object({ if: ConditionSchema, seed: z.string() })).default([]),
    /** Replaces `seed` when the party comes back (one picked per return), so template narration repeats less. */
    revisitSeed: z.union([z.string(), z.array(z.string()).min(1)]).optional(),
    npcs: z.array(Id).default([]),
    pois: z.array(PoiSchema).default([]),
    actions: z.array(ActionSchema).default([]),
    exits: z.array(ExitSchema).default([]),
    /** Room of a dungeon/building map (adventure `maps`) this scene takes place in (fog of war, fights). */
    map: z.object({ id: Id, room: Id }).strict().optional(),
    onEnter: OutcomeSchema.optional(),
    /** DC tier for checks the player improvises here (SRD table; default: the adventure's, else medium). */
    improvisedDifficulty: z.enum(DIFFICULTIES).optional(),
    /** Mood hint for music (A095). */
    mood: z.string().optional(),
  })
  .strict();
export type Scene = z.infer<typeof SceneSchema>;

export const ChapterSchema = z
  .object({
    id: Id,
    name: z.string(),
    summary: z.string(),
    start: Id,
    scenes: z.array(SceneSchema).min(1),
  })
  .strict();

// ---------------------------------------------------------------- conversations

/** A reply the player can pick in a conversation (a button; free text can match it via `keywords`). */
export const ConversationOptionSchema = z
  .object({
    id: Id,
    /** What the hero says or does ("Ask about the miller", "[Intimidation] Lean on him"). */
    label: z.string(),
    /** Hidden unless this holds. */
    if: ConditionSchema.optional(),
    /** Offered once per talk (hidden after it was picked, until the conversation starts again). */
    once: z.boolean().default(false),
    check: CheckSchema.optional(),
    /** Applied after the check's outcome (or alone when there is no check). */
    outcome: OutcomeSchema.optional(),
    /** Node to continue with; none = the conversation ends. */
    next: Id.optional(),
    /** Node to continue with when the check fails (default: `next`). */
    nextOnFail: Id.optional(),
    keywords: z.array(z.string()).default([]),
  })
  .strict();
export type ConversationOption = z.infer<typeof ConversationOptionSchema>;

export const ConversationNodeSchema = z
  .object({
    id: Id,
    /** The line spoken (verbatim in the log; the AI edition may voice it). */
    text: z.string(),
    /** Who speaks it: an NPC id of this adventure (default: the conversation's NPC). */
    speaker: Id.optional(),
    options: z.array(ConversationOptionSchema).default([]),
  })
  .strict();
export type ConversationNode = z.infer<typeof ConversationNodeSchema>;

/** A dialogue tree with an NPC, started by a "talk" button while the NPC is present. */
export const ConversationSchema = z
  .object({
    id: Id,
    /** Button that starts it (default "Talk to <name>"). */
    label: z.string().optional(),
    if: ConditionSchema.optional(),
    /** Can only be had once per adventure (after it ends). */
    once: z.boolean().default(false),
    start: Id,
    nodes: z.array(ConversationNodeSchema).min(1),
    keywords: z.array(z.string()).default([]),
  })
  .strict();
export type Conversation = z.infer<typeof ConversationSchema>;

export const NpcSchema = z
  .object({
    id: Id,
    name: z.string(),
    /** SRD monster id used for the stat block (commoner, guard, mage...). */
    statBlock: z.string(),
    personality: z.string(),
    secrets: z.array(z.string()).default([]),
    /** How the LLM should voice them (accent, pace, verbal tics) + optional TTS voice id. */
    voice: z.string(),
    ttsVoice: z.string().optional(),
    factions: z.array(z.string()).default([]),
    attitude: z.enum(['friendly', 'indifferent', 'hostile']).default('indifferent'),
    /**
     * Where the NPC is by hour. When set, the NPC appears only where and when an entry matches
     * (scene `npcs` lists are ignored for them). Hours as in the `hours` condition.
     */
    schedule: z.array(z.object({ scene: Id, from: z.number().int().min(0).max(23), to: z.number().int().min(0).max(24), if: ConditionSchema.optional() })).default([]),
    /** Dialogue trees (A129): offered as "talk" actions wherever the NPC is present. */
    conversations: z.array(ConversationSchema).default([]),
  })
  .strict();
export type Npc = z.infer<typeof NpcSchema>;

export const EncounterSchema = z
  .object({
    id: Id,
    name: z.string(),
    /** Monster groups; a group with `if` only joins when the condition holds (one encounter instead of variants). */
    monsters: z.array(z.object({ id: z.string(), count: z.number().int().min(1).default(1), if: ConditionSchema.optional() })).min(1),
    /** Per monster id: tougher/weaker/renamed foes (a wounded dragon at 60% HP, a named lieutenant). */
    statOverrides: z
      .record(z.string(), z.object({ name: z.string().optional(), hpPercent: z.number().int().min(1).max(500).optional(), hp: z.number().int().min(1).optional(), ac: z.number().int().min(1).max(30).optional() }).strict())
      .default({}),
    /** Grid map reference (A064) and terrain notes. */
    map: z.string().optional(),
    /** Room of `map` where the fight happens (default: the current scene's room). */
    room: z.string().optional(),
    terrain: z.array(z.string()).default([]),
    /** Scale by party: add/remove monsters to hit this difficulty (A068). */
    scaling: z.object({ target: z.enum(['low', 'moderate', 'high']), pool: z.array(z.string()).default([]) }).optional(),
    /** Monster ids never trimmed when scaling to a small party (default: the most expensive monster). */
    bosses: z.array(z.string()).default([]),
    /** Friendly stat blocks that fight on the party's side (AI-controlled), e.g. town guards. */
    allies: z.array(z.object({ id: z.string(), count: z.number().int().min(1).default(1), if: ConditionSchema.optional() })).default([]),
    canFlee: z.boolean().default(true),
    win: OutcomeSchema.prefault({}),
    lose: OutcomeSchema.prefault({}),
    flee: OutcomeSchema.prefault({}),
  })
  .strict();
export type AdventureEncounter = z.infer<typeof EncounterSchema>;

export const BeatSchema = z
  .object({
    id: Id,
    /** What must happen, for the narrator. */
    text: z.string(),
    /** Checked whenever flags or the scene change; fires once. */
    trigger: ConditionSchema,
    /** Only fires in these scenes (default: anywhere). */
    scenes: z.array(Id).default([]),
    outcome: OutcomeSchema.prefault({}),
    required: z.boolean().default(false),
  })
  .strict();

/** A time limit: starts when `start` holds (default: adventure start), met when `met` holds. */
export const DeadlineSchema = z
  .object({
    id: Id,
    /** For the narrator/journal ("Reach Ravensgate before the pyre is lit"). */
    text: z.string(),
    start: ConditionSchema.optional(),
    met: ConditionSchema,
    /** Minutes allowed after it starts. */
    within: z.number().int().min(1),
    /** Warn once when this many minutes (or fewer) remain. */
    warnAt: z.number().int().min(0).optional(),
    warning: z.string().optional(),
    /** Consequence when time runs out first. */
    missed: OutcomeSchema.prefault({}),
  })
  .strict();
export type Deadline = z.infer<typeof DeadlineSchema>;

/** Internal quest (never shown as a log; drives the optional objective hint and LLM context). */
export const QuestSchema = z
  .object({
    id: Id,
    name: z.string(),
    /** Starts when this holds (default: at the start of the adventure). */
    start: ConditionSchema.optional(),
    objectives: z
      .array(
        z
          .object({
            id: Id,
            /** Hint text, e.g. "Find a way into the old mill". */
            text: z.string(),
            done: ConditionSchema,
            /** Only hinted while this holds (e.g. after an earlier step). */
            if: ConditionSchema.optional(),
          })
          .strict(),
      )
      .min(1),
    /** Completed when this holds (default: every objective done). */
    complete: ConditionSchema.optional(),
    fail: ConditionSchema.optional(),
  })
  .strict();
export type Quest = z.infer<typeof QuestSchema>;

export const LootTableSchema = z
  .object({
    id: Id,
    /** How many times to roll (dice notation or a number). */
    rolls: z.union([z.number().int().min(1), z.string()]).default(1),
    entries: z
      .array(
        z.object({
          weight: z.number().int().min(1).default(1),
          itemId: z.string().optional(),
          quantity: z.number().int().min(1).default(1),
          /** Coins in copper, fixed or dice ("2d6*100" not supported: use "2d6" with `coinUnit`). */
          coins: z.union([z.number().int().min(0), z.string()]).optional(),
          coinUnit: z.enum(['cp', 'sp', 'gp']).default('gp'),
        }),
      )
      .min(1),
  })
  .strict();
export type LootTable = z.infer<typeof LootTableSchema>;

export const AdventureSchema = z
  .object({
    formatVersion: z.literal(ADVENTURE_FORMAT_VERSION),
    id: Id,
    name: z.string(),
    /** Campaign arc this belongs to (flags are namespaced arc.<arcId>.*). */
    arcId: z.string().optional(),
    kind: z.enum(['starter', 'arc', 'side_quest', 'test']).default('arc'),
    levelRange: z.tuple([z.number().int().min(1), z.number().int().max(20)]),
    regionId: z.string().optional(),
    summary: z.string(),
    start: z.object({ chapter: Id, scene: Id }),
    chapters: z.array(ChapterSchema).min(1),
    npcs: z.array(NpcSchema).default([]),
    encounters: z.array(EncounterSchema).default([]),
    beats: z.array(BeatSchema).default([]),
    deadlines: z.array(DeadlineSchema).default([]),
    quests: z.array(QuestSchema).default([]),
    lootTables: z.array(LootTableSchema).default([]),
    /** Dungeon/building maps (rooms, doors) for scenes and fights (engine/world/dungeon.ts). */
    maps: z.array(DungeonMapSchema).default([]),
    /** Documented flags this adventure reads/writes (for editors and validation). */
    /** Flags this adventure reads/writes; local ones may declare `type` (number/string), `default`, `values`, `min`/`max`. */
    flags: z.array(AdventureFlagDocSchema).default([]),
    /** `next`: the adventure (id) that starts right after this ending — how the campaign chains chapters. */
    endings: z.array(z.object({ id: Id, name: z.string(), text: z.string(), next: Id.optional() })).default([]),
    improvisedDifficulty: z.enum(DIFFICULTIES).default('medium'),
  })
  .strict();
export type Adventure = z.infer<typeof AdventureSchema>;
