/**
 * Schema for the side-quest generator tables (data/tables/sidequests.json, spec §7.4): quest types,
 * sites, antagonists (SRD monsters), complications, twists, rewards, patron name lists, and the
 * woven-in `threads` from the campaign bible (DESIGN.md §14) with their creating conditions and
 * flag/reputation write-backs. The generator itself is A108.
 */
import { z } from 'zod';
import { SKILLS, type Skill } from '../rules/basics';
import { ConditionSchema, FlagWriteSchema } from './schema';

const Weighted = { weight: z.number().int().min(1).default(1) };
const SkillEnum = z.enum(SKILLS as [Skill, ...Skill[]]);
export const SITE_KINDS = ['hideout', 'ruin', 'cave', 'wilds', 'lair', 'road', 'town'] as const;
export const ANTAGONIST_KINDS = ['outlaw', 'cultist', 'pirate', 'beast', 'monster', 'undead', 'rival'] as const;

export const SideQuestTablesSchema = z.object({
  questTypes: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      ...Weighted,
      goal: z.string(),
      siteKinds: z.array(z.enum(SITE_KINDS)).min(1),
      antagonistKinds: z.array(z.enum(ANTAGONIST_KINDS)).min(1),
      skills: z.array(SkillEnum).min(1),
      fight: z.boolean(),
    }),
  ),
  sites: z.array(z.object({ id: z.string(), kind: z.enum(SITE_KINDS), regions: z.array(z.string()).min(1), name: z.string(), seed: z.string() })),
  antagonists: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(ANTAGONIST_KINDS),
      regions: z.array(z.string()).min(1),
      name: z.string(),
      leader: z.string(),
      minions: z.array(z.string()),
      levels: z.tuple([z.number().int().min(1), z.number().int().max(20)]),
    }),
  ),
  complications: z.array(z.object({ id: z.string(), ...Weighted, text: z.string(), effect: z.enum(['ambush', 'deadline', 'rival', 'hazard_check', 'gate_check', 'hostage']), minutes: z.number().int().optional(), skill: SkillEnum.optional() })),
  twists: z.array(z.object({ id: z.string(), ...Weighted, text: z.string(), effect: z.enum(['reveal', 'spare_option', 'extra_encounter', 'clue', 'none']) })),
  rewards: z.object({
    goldPerLevel: z.object({ min: z.number().int().min(0), max: z.number().int().min(0) }),
    itemChance: z.number().min(0).max(1),
    itemRarityByLevel: z.array(z.object({ levels: z.tuple([z.number().int(), z.number().int()]), rarities: z.array(z.enum(['common', 'uncommon', 'rare', 'very_rare', 'legendary'])) })),
    reputation: z.object({ min: z.number().int(), max: z.number().int() }),
    xpDifficulty: z.enum(['low', 'moderate', 'high']),
  }),
  patrons: z.object({
    names: z.array(z.string()).min(1),
    relatives: z.array(z.string()).min(1),
    heirlooms: z.array(z.string()).min(1),
    mysteries: z.array(z.string()).min(1),
    parcels: z.array(z.string()).min(1),
  }),
  threads: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      if: ConditionSchema,
      questType: z.string(),
      locations: z.array(z.string()).min(1),
      villain: z.string(),
      antagonist: z.string(),
      writeBack: z.object({ flags: z.array(FlagWriteSchema).default([]), reputation: z.array(z.object({ faction: z.string(), delta: z.number().int() })).default([]) }),
    }),
  ),
});
export type SideQuestTables = z.infer<typeof SideQuestTablesSchema>;
