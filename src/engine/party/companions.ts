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
import { ENGLISH_MESSAGES, type Messages } from '../i18n';

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

/**
 * +2 for an Ability Score Improvement without passing 20: +2 to the main ability if it fits, else
 * +1 each to the first two abilities (primary abilities, then Con, Dex, Wis, Str, Cha, Int) that can
 * still grow. Always spends the full +2 while any ability is below 20.
 */
export function asiIncreases(abilities: Record<Ability, number>, primary: readonly Ability[]): Partial<Record<Ability, number>> {
  const order = [...new Set<Ability>([...primary, 'con', 'dex', 'wis', 'str', 'cha', 'int'])];
  const main = order[0]!;
  if (abilities[main] <= 18) return { [main]: 2 };
  const room = order.filter((a) => abilities[a] < 20);
  if (room.length >= 2) return { [room[0]!]: 1, [room[1]!]: 1 };
  if (room.length === 1) return abilities[room[0]!] <= 18 ? { [room[0]!]: 2 } : { [room[0]!]: 1 };
  return {};
}

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
      out.feat = { featId: 'ability_score_improvement', increases: asiIncreases(c.abilities, (cls.primaryAbilities as Ability[]) ?? []) };
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
export function recruitCompanion(state: GameState, def: CompanionDef, db: SrdDatabase, msgs: Messages = ENGLISH_MESSAGES): RecruitResult {
  const name = { name: def.name };
  const status = companionStatus(state, def);
  if (status === 'in_party') return { joined: false, waiting: false, message: msgs.m('companion.already', name) };
  if (status === 'dead' || status === 'betrayed') return { joined: false, waiting: false, message: msgs.m('companion.cannotJoin', name) };
  if (state.companions.length >= MAX_COMPANIONS) {
    state.flags[def.statusFlag] = 'waiting';
    return { joined: false, waiting: true, message: msgs.m('companion.partyFull', name) };
  }
  const existing = state.extensions.companionSheets as Record<string, Character> | undefined;
  const sheet = existing?.[def.id] ?? buildCompanion(def, totalLevel(state.hero), db);
  const leveled = totalLevel(sheet) < totalLevel(state.hero) ? autoLevelTo(sheet, totalLevel(state.hero), db, def.subclassId) : sheet;
  state.companions = [...state.companions, leveled];
  state.flags[def.statusFlag] = 'in_party';
  if (state.flags[def.loyaltyFlag] === undefined) state.flags[def.loyaltyFlag] = 50;
  return { joined: true, waiting: false, message: msgs.m('companion.joins', name) };
}

/**
 * Recruit without building a sheet (no rules data, e.g. the solver): only the status/loyalty flags
 * change, with the same party-size rule as recruitCompanion.
 */
export function recruitFlagsOnly(state: GameState, def: CompanionDef, roster: CompanionRoster, msgs: Messages = ENGLISH_MESSAGES): RecruitResult {
  const name = { name: def.name };
  const status = companionStatus(state, def);
  if (status === 'in_party') return { joined: false, waiting: false, message: msgs.m('companion.already', name) };
  if (status === 'dead' || status === 'betrayed') return { joined: false, waiting: false, message: msgs.m('companion.cannotJoin', name) };
  const inParty = roster.companions.filter((d) => companionStatus(state, d) === 'in_party').length;
  if (inParty >= MAX_COMPANIONS) {
    state.flags[def.statusFlag] = 'waiting';
    return { joined: false, waiting: true, message: msgs.m('companion.partyFull', name) };
  }
  state.flags[def.statusFlag] = 'in_party';
  if (state.flags[def.loyaltyFlag] === undefined) state.flags[def.loyaltyFlag] = 50;
  return { joined: true, waiting: false, message: msgs.m('companion.joins', name) };
}

/**
 * A companion who waited, left or betrayed the party comes back (A130): their kept sheet rejoins
 * (levelled to the hero; built fresh if none was kept), loyalty rises to at least `loyalty`. The
 * dead never return. Without `db` (the solver) only the flags change. Party full → they wait.
 */
export function returnCompanion(state: GameState, def: CompanionDef, roster: CompanionRoster, loyalty: number, db?: SrdDatabase, msgs: Messages = ENGLISH_MESSAGES): RecruitResult {
  const name = { name: def.name };
  const status = companionStatus(state, def);
  if (status === 'in_party') return { joined: false, waiting: false, message: msgs.m('companion.already', name) };
  if (status === 'dead') return { joined: false, waiting: false, message: msgs.m('companion.cannotReturn', name) };
  const inParty = db ? state.companions.length : roster.companions.filter((d) => companionStatus(state, d) === 'in_party').length;
  state.flags[def.loyaltyFlag] = Math.max(loyaltyOf(state, def), loyalty);
  if (inParty >= MAX_COMPANIONS) {
    state.flags[def.statusFlag] = 'waiting';
    return { joined: false, waiting: true, message: msgs.m('companion.backPartyFull', name) };
  }
  if (db) {
    const kept = (state.extensions.companionSheets as Record<string, Character> | undefined)?.[def.id];
    const sheet = kept ?? buildCompanion(def, totalLevel(state.hero), db);
    state.companions = [...state.companions, totalLevel(sheet) < totalLevel(state.hero) ? autoLevelTo(sheet, totalLevel(state.hero), db, def.subclassId) : sheet];
  }
  state.flags[def.statusFlag] = 'in_party';
  return { joined: true, waiting: false, message: msgs.m(status === 'betrayed' || status === 'left' ? 'companion.returns' : 'companion.rejoins', name) };
}

/** Log line for a companion parting with the given status. */
export function partingLine(def: CompanionDef, status: Exclude<CompanionStatus, 'in_party' | 'unmet' | 'met'>, msgs: Messages = ENGLISH_MESSAGES): string {
  return msgs.m(status === 'waiting' ? 'companion.waits' : status === 'left' ? 'companion.leaves' : status === 'betrayed' ? 'companion.betrayed' : 'companion.dead', { name: def.name });
}

/** A companion leaves the party (to wait, or for good with status left/betrayed/dead). Their sheet is kept. */
export function partWithCompanion(state: GameState, def: CompanionDef, status: Exclude<CompanionStatus, 'in_party' | 'unmet' | 'met'>): void {
  const c = state.companions.find((x) => x.id === def.id);
  state.companions = state.companions.filter((x) => x.id !== def.id);
  if (c) state.extensions.companionSheets = { ...((state.extensions.companionSheets as Record<string, Character> | undefined) ?? {}), [def.id]: c };
  state.flags[def.statusFlag] = status;
}

/** Companions level with the hero (spec §6). */
export function levelCompanionsWithHero(state: GameState, roster: CompanionRoster, db: SrdDatabase, msgs: Messages = ENGLISH_MESSAGES): string[] {
  const target = totalLevel(state.hero);
  const out: string[] = [];
  state.companions = state.companions.map((c) => {
    if (totalLevel(c) >= target) return c;
    const def = roster.companions.find((d) => d.id === c.id);
    out.push(msgs.m('companion.levels', { name: c.name, level: target }));
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
export function changeApproval(state: GameState, def: CompanionDef, delta: number, msgs: Messages = ENGLISH_MESSAGES): string | undefined {
  if (companionStatus(state, def) !== 'in_party' || delta === 0) return undefined;
  const before = loyaltyOf(state, def);
  const after = Math.max(0, Math.min(100, before + delta));
  state.flags[def.loyaltyFlag] = after;
  const mood = delta >= 20 ? 'companion.approvesStrongly' : delta > 0 ? 'companion.approves' : delta <= -20 ? 'companion.disapprovesStrongly' : 'companion.disapproves';
  const line = msgs.m(mood, { name: shortName(def.name), delta: `${delta > 0 ? '+' : ''}${delta}` });
  return after <= LOYALTY_LOW && before > LOYALTY_LOW ? `${line} ${msgs.m('companion.patience')}` : line;
}

// ---------------------------------------------------------------- control toggle (A087)

export type Control = 'ai' | 'player';

/** Companions the player controls in combat (default: AI). Stored in extensions.party.control. */
export function playerControlled(state: GameState): string[] {
  const control = (state.extensions.party as { control?: Record<string, Control> } | undefined)?.control ?? {};
  return state.companions.filter((c) => control[c.id] === 'player').map((c) => c.id);
}

export function setControl(state: GameState, companionId: string, control: Control, msgs: Messages = ENGLISH_MESSAGES): void {
  if (!state.companions.some((c) => c.id === companionId)) throw new Error(msgs.m('companion.notInParty'));
  const party = (state.extensions.party as { control?: Record<string, Control> } | undefined) ?? {};
  state.extensions.party = { ...party, control: { ...(party.control ?? {}), [companionId]: control } };
}
