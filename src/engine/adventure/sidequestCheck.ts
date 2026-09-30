/**
 * Side-quest quality gate (spec §7.4 / §17): a generated quest is rejected if it fails the
 * adventure validator, has a deadly or empty fight for the hero's level, needs a check the hero
 * cannot pass even on a natural 20, or cannot reach its "done" ending (solver), offers fewer than
 * 3 approaches, or has an outcome variant that can't end the job (A137). Rejected quests are
 * regenerated with a fresh seed; after too many failures nothing is offered (the caller shows no quest).
 */
import { totalLevel } from '../core/creature';
import type { Rng } from '../core/rng';
import { SKILL_ABILITY, abilityModifier, proficiencyContribution } from '../rules/basics';
import { rateEncounter } from './encounters';
import { generateSideQuest, type GeneratedQuest, type SideQuestOptions } from './sidequestGen';
import { solveAdventure } from './solver';
import type { Adventure } from './schema';
import { flagRefs, validateAdventure } from './validate';

export interface QuestCheck {
  ok: boolean;
  adventure?: Adventure;
  problems: string[];
}

/** Best bonus the hero has for a skill (ability mod + proficiency/expertise). */
function bestBonus(o: Pick<SideQuestOptions, 'state'>, skill: keyof typeof SKILL_ABILITY): number {
  const h = o.state.hero;
  return abilityModifier(h.abilities[SKILL_ABILITY[skill]]) + proficiencyContribution(h.skills[skill] ?? 'none', h.proficiencyBonus);
}

export function checkSideQuest(q: GeneratedQuest, o: Pick<SideQuestOptions, 'db' | 'state' | 'flags' | 'lore'>): QuestCheck {
  const v = validateAdventure(q.adventure, o.db, o.flags);
  if (!v.ok || !v.adventure) return { ok: false, problems: v.errors };
  const adv = v.adventure;
  const problems: string[] = [];
  const level = totalLevel(o.state.hero);

  // Fights must exist and not be deadly for this hero (SRD 2024 budgets).
  for (const e of adv.encounters) {
    const ms = e.monsters.flatMap((m) => Array.from({ length: m.count }, () => o.db.monsters.get(m.id)!));
    if (ms.length === 0) problems.push(`encounter ${e.id} has no monsters`);
    else if (o.db.tables && rateEncounter([level], ms, o.db.tables) === 'deadly') problems.push(`encounter ${e.id} is deadly for a level ${level} hero`);
  }

  // Every check must be passable on a natural 20.
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!v || typeof v !== 'object') return;
    const c = v as { skill?: keyof typeof SKILL_ABILITY; dc?: number; check?: unknown };
    if (c.skill && typeof c.dc === 'number' && 20 + bestBonus(o, c.skill) < c.dc) problems.push(`${c.skill} DC ${c.dc} is impossible for this hero`);
    Object.values(v).forEach(walk);
  };
  walk(adv.chapters);

  // Flags read but never written (and not world/arc state) would lock content forever.
  const { reads, writes } = flagRefs(adv);
  const written = new Set(writes.map((w) => w.id));
  for (const f of reads) if (f.startsWith(`side.${adv.id}.`) && !written.has(f)) problems.push(`flag ${f} is read but never set`);

  // Winnable with perfect luck?
  const base = { state: o.state, adventure: adv, db: o.db, ...(o.flags && { flags: o.flags }), ...(o.lore && { lore: o.lore }) };
  const solved = solveAdventure(base, 'done');
  if (!solved.ok) problems.push(`unwinnable: ${solved.reason}`);

  // Real choices (A137): ≥ 3 ways in, and every outcome variant can end the job 'done'.
  const site = adv.chapters.flatMap((c) => c.scenes).find((s) => s.id === 'site');
  const offered = q.approaches.filter((id) => site?.actions.some((a) => a.id === id));
  if (offered.length < 3) problems.push(`only ${offered.length} approaches`);
  if (q.outcomes.length < 2) problems.push(`only ${q.outcomes.length} outcome variants`);
  if (solved.ok) {
    for (const id of q.outcomes) {
      const flag = `side.${adv.id}.o_${id}`;
      if (!solveAdventure(base, 'done', undefined, (s) => s.flags[flag] === true).ok) problems.push(`outcome ${id} can't end the job`);
    }
  }

  return { ok: problems.length === 0, ...(problems.length === 0 && { adventure: adv }), problems };
}

export interface GenerateResult {
  adventure: Adventure;
  threadId?: string;
  attempts: number;
  /** Problems of the rejected attempts (for logs). */
  rejected: string[][];
}

/** Generates until a quest passes checkSideQuest (max `attempts`, default 6), each try with a fresh seed. */
export function generateValidSideQuest(o: Omit<SideQuestOptions, 'rng'> & { rng: Rng; attempts?: number }): GenerateResult | undefined {
  const rejected: string[][] = [];
  const max = o.attempts ?? 6;
  for (let i = 1; i <= max; i++) {
    const q = generateSideQuest({ ...o, rng: o.rng });
    const c = checkSideQuest(q, o);
    if (c.ok && c.adventure) return { adventure: c.adventure, ...(q.threadId && { threadId: q.threadId }), attempts: i, rejected };
    rejected.push(c.problems);
  }
  return undefined;
}
