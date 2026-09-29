/**
 * Companions (spec §6, DESIGN.md §11): full SRD characters built like Quick Builds from the roster
 * (data/companions.json), levelled to the party's level with automatic choices. Up to 3 travel with
 * the hero; extra recruits wait (status "waiting"). Status and loyalty live in world flags so later
 * arcs can read them.
 */
import { z } from 'zod';
import { buildCharacter } from '../character/builder';
import { toBuildInput } from '../character/creator';
import { classLevel } from '../character/derived';
import { levelUp, maxSpellLevelAt, pendingChoices, type LevelUpOptions } from '../character/leveling';
import { quickBuild } from '../character/quickBuild';
import { totalLevel, type Character } from '../core/creature';
import { Rng } from '../core/rng';
import type { SrdDatabase } from '../data/srd';
import type { Ability, Skill } from '../rules/basics';
import { SKILLS } from '../rules/basics';
import type { GameState } from '../session/gameState';
import { AppearanceSchema } from '../appearance/appearance';

export const MAX_COMPANIONS = 3;

export const CompanionDefSchema = z.object({
  id: z.string(),
  name: z.string(),
  classId: z.string(),
  subclassId: z.string().optional(),
  species: z.string(),
  lineage: z.string().optional(),
  background: z.string(),
  role: z.enum(['healer', 'ranged', 'defender', 'striker']).optional(),
  personality: z.string(),
  goal: z.string(),
  voice: z.string(),
  factions: z.array(z.string()).default([]),
  appearance: AppearanceSchema.prefault({}),
  statusFlag: z.string(),
  loyaltyFlag: z.string(),
  /** Fallback banter (when the LLM is unavailable) and lines for low loyalty. */
  banter: z.array(z.string()).default([]),
  grumbles: z.array(z.string()).default([]),
});
export type CompanionDef = z.infer<typeof CompanionDefSchema>;
export const CompanionRosterSchema = z.object({ companions: z.array(CompanionDefSchema) });
export type CompanionRoster = z.infer<typeof CompanionRosterSchema>;

export type CompanionStatus = 'unmet' | 'met' | 'in_party' | 'waiting' | 'left' | 'betrayed' | 'dead';

/** Automatic level-up choices: subclass from the roster, ASI into the main ability, first valid spells/picks. */
export function autoLevelChoices(c: Character, db: SrdDatabase, classId: string, subclassId?: string): Omit<LevelUpOptions, 'classId' | 'hp'> {
  const newLevel = classLevel(c, classId) + 1;
  const cls = db.classes.get(classId)!;
  const out: Omit<LevelUpOptions, 'classId' | 'hp'> = {};
  const known = new Set([...(c.spellcasting?.cantrips ?? []), ...(c.spellcasting?.prepared ?? []).map((p) => p.spellId)]);
  const spells = db.spellsForClass(classId, Math.max(1, maxSpellLevelAt(db, classId, newLevel))).filter((s) => !known.has(s.id));
  for (const ch of pendingChoices(c, db, classId, newLevel)) {
    if (ch.kind === 'subclass') out.subclassId = subclassId && ch.options.includes(subclassId) ? subclassId : ch.options[0]!;
    if (ch.kind === 'feat') {
      const main = (cls.primaryAbilities[0] ?? 'str') as Ability;
      const second = (cls.primaryAbilities[1] ?? 'con') as Ability;
      out.feat = { featId: 'ability_score_improvement', increases: c.abilities[main] <= 18 ? { [main]: 2 } : { [second]: 1, con: 1 } };
    }
    if (ch.kind === 'cantrips') out.cantrips = spells.filter((s) => s.level === 0).slice(0, ch.count).map((s) => s.id);
    if (ch.kind === 'spells') out.spells = spells.filter((s) => s.level > 0).slice(0, ch.count).map((s) => s.id);
    if (ch.kind === 'weapon_mastery') out.weaponMasteries = [...db.weapons.values()].filter((w) => w.mastery && !c.weaponMasteries.includes(w.id)).slice(0, ch.count).map((w) => w.id);
    if (ch.kind === 'expertise') out.expertise = Object.entries(c.skills).filter(([, v]) => v === 'proficient').slice(0, ch.count).map(([k]) => k as Skill);
    if (ch.kind === 'skills') out.skills = SKILLS.filter((k) => !c.skills[k]).slice(0, ch.count);
  }
  return out;
}

/** Levels a character (single class) up to `level` with average HP and automatic choices. */
export function autoLevelTo(c: Character, level: number, db: SrdDatabase, subclassId?: string): Character {
  let cur = c;
  const classId = cur.classes[0]!.classId;
  while (totalLevel(cur) < Math.min(20, level)) {
    cur = levelUp(cur, db, { classId, hp: { mode: 'average' }, ignoreXp: true, ...autoLevelChoices(cur, db, classId, subclassId) }).character;
  }
  return cur;
}

/** Builds a companion's full character sheet at a level. */
export function buildCompanion(def: CompanionDef, level: number, db: SrdDatabase): Character {
  const s = quickBuild(def.classId, db, Rng.fromSeed(`companion:${def.id}`), { species: def.species, background: def.background, ...(def.lineage && { lineage: def.lineage }) });
  const c = buildCharacter({ ...toBuildInput(s, def.id), name: def.name, appearance: def.appearance }, db);
  return autoLevelTo({ ...c, id: def.id, name: def.name, appearance: def.appearance }, level, db, def.subclassId);
}

export function companionStatus(state: GameState, def: CompanionDef): CompanionStatus {
  return (state.flags[def.statusFlag] as CompanionStatus | undefined) ?? 'unmet';
}

export interface RecruitResult {
  joined: boolean;
  /** Party full: the companion waits at the nearest safe house. */
  waiting: boolean;
  message: string;
}

/** Recruits a companion (built at the hero's level). Party full → they wait instead. */
export function recruitCompanion(state: GameState, def: CompanionDef, db: SrdDatabase): RecruitResult {
  const status = companionStatus(state, def);
  if (status === 'in_party') return { joined: false, waiting: false, message: `${def.name} is already with you.` };
  if (status === 'dead' || status === 'betrayed') return { joined: false, waiting: false, message: `${def.name} cannot join you.` };
  if (state.companions.length >= MAX_COMPANIONS) {
    state.flags[def.statusFlag] = 'waiting';
    return { joined: false, waiting: true, message: `${def.name} will wait for you at the nearest safe house (your party is full).` };
  }
  const existing = state.extensions.companionSheets as Record<string, Character> | undefined;
  const sheet = existing?.[def.id] ?? buildCompanion(def, totalLevel(state.hero), db);
  const leveled = totalLevel(sheet) < totalLevel(state.hero) ? autoLevelTo(sheet, totalLevel(state.hero), db, def.subclassId) : sheet;
  state.companions = [...state.companions, leveled];
  state.flags[def.statusFlag] = 'in_party';
  if (state.flags[def.loyaltyFlag] === undefined) state.flags[def.loyaltyFlag] = 50;
  return { joined: true, waiting: false, message: `${def.name} joins your party.` };
}

/** A companion leaves the party (to wait, or for good with status left/betrayed/dead). Their sheet is kept. */
export function partWithCompanion(state: GameState, def: CompanionDef, status: Exclude<CompanionStatus, 'in_party' | 'unmet' | 'met'>): void {
  const c = state.companions.find((x) => x.id === def.id);
  state.companions = state.companions.filter((x) => x.id !== def.id);
  if (c) state.extensions.companionSheets = { ...((state.extensions.companionSheets as Record<string, Character> | undefined) ?? {}), [def.id]: c };
  state.flags[def.statusFlag] = status;
}

/** Companions level with the hero (spec §6). */
export function levelCompanionsWithHero(state: GameState, roster: CompanionRoster, db: SrdDatabase): string[] {
  const target = totalLevel(state.hero);
  const out: string[] = [];
  state.companions = state.companions.map((c) => {
    if (totalLevel(c) >= target) return c;
    const def = roster.companions.find((d) => d.id === c.id);
    out.push(`${c.name} reaches level ${target}.`);
    return autoLevelTo(c, target, db, def?.subclassId);
  });
  return out;
}

// ---------------------------------------------------------------- loyalty (A085)

export const LOYALTY_LOW = 20;
export const LOYALTY_HIGH = 70;

/** "Ser Corwin Ashvale" → "Corwin", "Rook Marrowby" → "Rook". */
export function shortName(name: string): string {
  const words = name.split(/\s+/).filter((w) => !/^(Ser|Sir|Lady|Lord|Dame|Brother|Sister)$/.test(w));
  return words[0] ?? name;
}

export function loyaltyOf(state: GameState, def: CompanionDef): number {
  const v = state.flags[def.loyaltyFlag];
  return typeof v === 'number' ? v : 50;
}

/**
 * Applies an approval change for a companion who is with the party (others don't see it).
 * Loyalty is clamped to 0–100. Returns the log line, or undefined if nothing changed.
 */
export function changeApproval(state: GameState, def: CompanionDef, delta: number): string | undefined {
  if (companionStatus(state, def) !== 'in_party' || delta === 0) return undefined;
  const before = loyaltyOf(state, def);
  const after = Math.max(0, Math.min(100, before + delta));
  state.flags[def.loyaltyFlag] = after;
  const mood = delta >= 20 ? 'strongly approves' : delta > 0 ? 'approves' : delta <= -20 ? 'strongly disapproves' : 'disapproves';
  const warn = after <= LOYALTY_LOW && before > LOYALTY_LOW ? ' Their patience is wearing thin.' : '';
  return `${shortName(def.name)} ${mood}. (${delta > 0 ? '+' : ''}${delta})${warn}`;
}

// ---------------------------------------------------------------- control toggle (A087)

export type Control = 'ai' | 'player';

/** Companions the player controls in combat (default: AI). Stored in extensions.party.control. */
export function playerControlled(state: GameState): string[] {
  const control = (state.extensions.party as { control?: Record<string, Control> } | undefined)?.control ?? {};
  return state.companions.filter((c) => control[c.id] === 'player').map((c) => c.id);
}

export function setControl(state: GameState, companionId: string, control: Control): void {
  if (!state.companions.some((c) => c.id === companionId)) throw new Error('That companion is not in your party.');
  const party = (state.extensions.party as { control?: Record<string, Control> } | undefined) ?? {};
  state.extensions.party = { ...party, control: { ...(party.control ?? {}), [companionId]: control } };
}
