/**
 * Level advancement and feats (SRD 5.2): XP thresholds, level-up (HP, hit dice, proficiency
 * bonus, spell slots, new features), pending choices (subclass, ASI/feat, epic boon, new
 * cantrips/spells, weapon masteries), and applying feats (ability increases with caps,
 * retroactive HP when Constitution changes, Skilled, Magic Initiate spells).
 */
import type { Character, SpellcastingState } from '../core/creature';
import type { Rng } from '../core/rng';
import { roll } from '../core/dice';
import type { ClassData, Feat } from '../data/schemas';
import type { SrdDatabase } from '../data/srd';
import { abilityModifier, proficiencyBonus, type Ability, type Skill } from '../rules/basics';
import { pactSlots, spellSlots } from '../rules/spellcasting';
import { armorClass, baseSpeed, classLevel } from './derived';
import { featureLevels, weaponMasteryCount } from './featureLevels';
import { applyOnGain, syncResources } from './features';

export class LevelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LevelError';
  }
}

const totalLevel = (c: Character) => c.classes.reduce((s, x) => s + x.level, 0);

export function levelForXp(xp: number, xpByLevel: number[]): number {
  let level = 1;
  for (let i = 0; i < xpByLevel.length; i++) if (xp >= xpByLevel[i]!) level = i + 1;
  return level;
}

/** True if the character's XP allows another level. */
export function canLevelUp(c: Character, db: SrdDatabase): boolean {
  const lvl = totalLevel(c);
  return lvl < 20 && c.xp >= db.rules.xpByLevel[lvl]!;
}

export { featureLevels };

/** Class (and subclass) features gained at exactly this class level. */
export function featuresAtLevel(db: SrdDatabase, classId: string, level: number, subclassId?: string): ClassData['features'] {
  const cls = db.classes.get(classId);
  const sub = subclassId ? db.subclasses.get(subclassId) : undefined;
  return [...(cls?.features ?? []), ...(sub?.features ?? [])].filter((f) => featureLevels(f).includes(level));
}

export type PendingChoice =
  | { kind: 'subclass'; classId: string; options: string[] }
  | { kind: 'feat'; reason: 'asi' | 'epic_boon' }
  | { kind: 'cantrips'; classId: string; count: number }
  | { kind: 'spells'; classId: string; count: number }
  | { kind: 'weapon_mastery'; count: number }
  | { kind: 'expertise'; count: number }
  | { kind: 'skills'; count: number };

/** Choices the player must make when their class reaches `newLevel` in `classId`. */
export function pendingChoices(c: Character, db: SrdDatabase, classId: string, newLevel: number): PendingChoice[] {
  const cls = db.classes.get(classId);
  if (!cls) return [];
  const out: PendingChoice[] = [];
  const current = c.classes.find((x) => x.classId === classId);
  if (newLevel === cls.subclassLevel && !current?.subclassId) {
    out.push({ kind: 'subclass', classId, options: [...db.subclasses.values()].filter((s) => s.classId === classId).map((s) => s.id) });
  }
  const names = featuresAtLevel(db, classId, newLevel).map((f) => f.name);
  if (names.includes('Ability Score Improvement')) out.push({ kind: 'feat', reason: 'asi' });
  if (names.includes('Epic Boon')) out.push({ kind: 'feat', reason: 'epic_boon' });
  if (names.includes('Expertise')) out.push({ kind: 'expertise', count: 2 });
  if (names.includes('Deft Explorer')) out.push({ kind: 'expertise', count: 1 });
  const sub = current?.subclassId;
  if (sub && featuresAtLevel(db, classId, newLevel, sub).some((f) => f.name === 'Bonus Proficiencies' && sub === 'college_of_lore')) {
    out.push({ kind: 'skills', count: 3 });
  }
  const diff = (arr?: number[]) => (arr ? (arr[newLevel - 1] ?? 0) - (newLevel > 1 ? (arr[newLevel - 2] ?? 0) : 0) : 0);
  const cantrips = diff(cls.spellcasting.cantripsKnown);
  if (cantrips > 0) out.push({ kind: 'cantrips', classId, count: cantrips });
  const spells = newLevel === 1 ? (cls.spellcasting.preparedSpells?.[0] ?? 0) : diff(cls.spellcasting.preparedSpells);
  if (spells > 0) out.push({ kind: 'spells', classId, count: spells });
  const more = weaponMasteryCount(cls, newLevel) - (newLevel > 1 ? weaponMasteryCount(cls, newLevel - 1) : 0);
  if (more > 0) out.push({ kind: 'weapon_mastery', count: more });
  return out;
}

// ---------------------------------------------------------------- feats

export interface FeatChoice {
  featId: string;
  /** Ability increases the player picked (ASI: {str: 2} or {str: 1, dex: 1}; others: one ability +1). */
  increases?: Partial<Record<Ability, number>>;
  /** Skilled: three skills or tool ids. */
  skills?: Skill[];
  tools?: string[];
  /** Magic Initiate: spell list class + chosen spells. */
  spellList?: string;
  cantrips?: string[];
  spells?: string[];
}

export function featProblems(c: Character, db: SrdDatabase, choice: FeatChoice): string[] {
  const feat = db.feats.get(choice.featId);
  if (!feat) return [`Unknown feat ${choice.featId}`];
  const problems: string[] = [];
  const pre = feat.prerequisite;
  if (pre?.level && totalLevel(c) < pre.level) problems.push(`${feat.name} requires level ${pre.level}`);
  if (pre?.abilities?.length) {
    const ok = pre.abilities.map((p) => c.abilities[p.ability] >= p.min);
    if (pre.anyAbility ? !ok.some(Boolean) : !ok.every(Boolean)) problems.push(`${feat.name}: ${pre.text}`);
  }
  if (pre?.feature === 'spellcasting' && !c.spellcasting) problems.push(`${feat.name} requires the Spellcasting feature`);
  if (pre?.feature === 'fighting_style' && !c.classes.some((x) => ['fighter', 'paladin', 'ranger'].includes(x.classId))) problems.push(`${feat.name} requires the Fighting Style feature`);
  if (!feat.repeatable && c.featIds.includes(feat.id)) problems.push(`${feat.name} can't be taken twice`);
  const inc = Object.entries(choice.increases ?? {}).filter(([, v]) => v);
  if (feat.abilityIncrease) {
    const total = inc.reduce((s, [, v]) => s + (v ?? 0), 0);
    const expected = feat.abilityIncrease.amount;
    if (total !== expected) problems.push(`${feat.name}: distribute +${expected}`);
    if (feat.id === 'ability_score_improvement' && inc.some(([, v]) => (v ?? 0) > 2)) problems.push('ASI: at most +2 to one score');
    if (feat.id !== 'ability_score_improvement' && inc.length > 1) problems.push(`${feat.name}: increase one ability`);
    for (const [a, v] of inc) {
      if (!feat.abilityIncrease.abilities.includes(a as Ability)) problems.push(`${feat.name} can't increase ${a}`);
      if (c.abilities[a as Ability] + (v ?? 0) > feat.abilityIncrease.max) problems.push(`${a} can't exceed ${feat.abilityIncrease.max}`);
    }
  } else if (inc.length) problems.push(`${feat.name} gives no ability increase`);
  if (feat.id === 'skilled' && (choice.skills?.length ?? 0) + (choice.tools?.length ?? 0) !== 3) problems.push('Skilled: choose three skills or tools');
  if (feat.id === 'magic_initiate') {
    if (!['cleric', 'druid', 'wizard'].includes(choice.spellList ?? '')) problems.push('Magic Initiate: choose Cleric, Druid or Wizard');
    if ((choice.cantrips?.length ?? 0) !== 2 || (choice.spells?.length ?? 0) !== 1) problems.push('Magic Initiate: two cantrips and one level 1 spell');
    for (const id of [...(choice.cantrips ?? []), ...(choice.spells ?? [])]) {
      const sp = db.spells.get(id);
      if (!sp || !sp.classes.includes(choice.spellList ?? '')) problems.push(`${id} is not on the ${choice.spellList} list`);
    }
  }
  return problems;
}

/** Applies a feat. Constitution increases raise max HP retroactively (1 per level per point of modifier). */
export function applyFeat(c: Character, db: SrdDatabase, choice: FeatChoice): Character {
  const problems = featProblems(c, db, choice);
  if (problems.length) throw new LevelError(problems.join('; '));
  const feat = db.feats.get(choice.featId) as Feat;
  const abilities = { ...c.abilities };
  for (const [a, v] of Object.entries(choice.increases ?? {})) abilities[a as Ability] += v ?? 0;
  const conDelta = abilityModifier(abilities.con) - abilityModifier(c.abilities.con);
  const hpDelta = conDelta * totalLevel(c);
  let next: Character = {
    ...c,
    abilities,
    maxHp: c.maxHp + hpDelta,
    hp: Math.max(0, c.hp + hpDelta),
    featIds: [...c.featIds, feat.id],
  };
  if (feat.id === 'skilled') {
    const skills = { ...next.skills };
    for (const s of choice.skills ?? []) skills[s] = skills[s] === 'expertise' ? 'expertise' : 'proficient';
    next = { ...next, skills, proficiencies: { ...next.proficiencies, tools: [...next.proficiencies.tools, ...(choice.tools ?? [])] } };
  }
  if (feat.id === 'magic_initiate') {
    const sc = next.spellcasting ?? { slots: new Array(9).fill(0), maxSlots: new Array(9).fill(0), cantrips: [], prepared: [] };
    next = {
      ...next,
      spellcasting: {
        ...sc,
        cantrips: [...sc.cantrips, ...(choice.cantrips ?? [])],
        prepared: [...sc.prepared, ...(choice.spells ?? []).map((spellId) => ({ spellId, classId: `feat:magic_initiate:${choice.spellList}` }))],
      },
    };
  }
  return recompute(next, db);
}

// ---------------------------------------------------------------- level up

export interface LevelUpOptions {
  classId: string;
  hp: { mode: 'average' } | { mode: 'roll'; rng: Rng };
  subclassId?: string;
  /** Needed when the new level grants ASI or Epic Boon. */
  feat?: FeatChoice;
  cantrips?: string[];
  spells?: string[];
  weaponMasteries?: string[];
  /** Expertise picks (must already be proficient). */
  expertise?: Skill[];
  /** Extra skill proficiencies (College of Lore Bonus Proficiencies). */
  skills?: Skill[];
  /** Skip the XP check (quick builds, companions leveling with the hero). */
  ignoreXp?: boolean;
}

export interface LevelUpResult {
  character: Character;
  classLevel: number;
  hpGained: number;
  features: string[];
}

/** Raises one class by one level. Multiclass prerequisites are checked in multiclass.ts (A037). */
export function levelUp(c: Character, db: SrdDatabase, o: LevelUpOptions): LevelUpResult {
  if (totalLevel(c) >= 20) throw new LevelError('Already level 20');
  if (!o.ignoreXp && !canLevelUp(c, db)) throw new LevelError('Not enough XP');
  const cls = db.classes.get(o.classId);
  if (!cls) throw new LevelError(`Unknown class ${o.classId}`);
  const newClassLevel = classLevel(c, o.classId) + 1;
  const choices = pendingChoices(c, db, o.classId, newClassLevel);

  for (const ch of choices) {
    if (ch.kind === 'subclass' && !o.subclassId) throw new LevelError('Choose a subclass');
    if (ch.kind === 'subclass' && !ch.options.includes(o.subclassId!)) throw new LevelError(`${o.subclassId} is not a ${cls.name} subclass`);
    if (ch.kind === 'feat' && !o.feat) throw new LevelError(ch.reason === 'asi' ? 'Choose an Ability Score Improvement or feat' : 'Choose an Epic Boon');
    if (ch.kind === 'expertise' && (o.expertise?.length ?? 0) !== ch.count) throw new LevelError(`Choose ${ch.count} skills for Expertise`);
    if (ch.kind === 'feat' && ch.reason === 'epic_boon' && o.feat && db.feats.get(o.feat.featId)?.category !== 'epic_boon' && o.feat.featId !== 'ability_score_improvement') {
      throw new LevelError('Epic Boon: choose an epic boon feat');
    }
  }

  const die = Number(cls.hitDie.slice(1));
  const rolled = o.hp.mode === 'average' ? die / 2 + 1 : roll(`1${cls.hitDie}`, o.hp.rng).total;
  const hpGained = Math.max(1, rolled + abilityModifier(c.abilities.con)) + (c.speciesId === 'dwarf' ? 1 : 0);

  const classes = c.classes.some((x) => x.classId === o.classId)
    ? c.classes.map((x) => (x.classId === o.classId ? { ...x, level: newClassLevel, ...(o.subclassId && { subclassId: o.subclassId }) } : x))
    : [...c.classes, { classId: o.classId, level: 1 }];
  let next: Character = {
    ...c,
    classes,
    maxHp: c.maxHp + hpGained,
    hp: c.hp + hpGained,
    hitDice: { ...c.hitDice, [cls.hitDie]: (c.hitDice[cls.hitDie] ?? 0) + 1 },
    proficiencyBonus: proficiencyBonus(totalLevel(c) + 1),
    weaponMasteries: [...c.weaponMasteries, ...(o.weaponMasteries ?? [])],
  };
  if (next.spellcasting && (o.cantrips?.length || o.spells?.length)) {
    next = {
      ...next,
      spellcasting: {
        ...next.spellcasting,
        cantrips: [...next.spellcasting.cantrips, ...(o.cantrips ?? [])],
        prepared: [...next.spellcasting.prepared, ...(o.spells ?? []).map((spellId) => ({ spellId, classId: o.classId }))],
      },
    };
  }
  if (o.skills?.length || o.expertise?.length) {
    const skills = { ...next.skills };
    for (const s of o.skills ?? []) if (skills[s] !== 'expertise') skills[s] = 'proficient';
    for (const s of o.expertise ?? []) {
      if (skills[s] !== 'proficient' && skills[s] !== 'expertise') throw new LevelError(`Expertise needs proficiency in ${s}`);
      skills[s] = 'expertise';
    }
    next = { ...next, skills };
  }
  next = applyOnGain(next, db, o.classId, newClassLevel);
  next = recompute(next, db);
  if (o.feat) next = applyFeat(next, db, o.feat);
  next = syncResources(next, db);
  const subclass = next.classes.find((x) => x.classId === o.classId)?.subclassId;
  return {
    character: next,
    classLevel: newClassLevel,
    hpGained,
    features: featuresAtLevel(db, o.classId, newClassLevel, subclass).map((f) => f.name),
  };
}

/** Recomputes spell slots, AC and speed after level/feat changes. */
export function recompute(c: Character, db: SrdDatabase): Character {
  const casterClasses = c.classes.map((x) => ({ progression: db.classes.get(x.classId)?.spellcasting.progression ?? 'none', level: x.level }));
  const maxSlots = spellSlots(casterClasses, db.rules);
  const warlock = classLevel(c, 'warlock');
  const pact = warlock ? pactSlots(warlock, db.rules) : undefined;
  let next = c;
  if (c.spellcasting || maxSlots.some((n) => n > 0) || pact) {
    const sc: SpellcastingState = c.spellcasting ?? { slots: new Array(9).fill(0), maxSlots: new Array(9).fill(0), cantrips: [], prepared: [] };
    // New slots arrive full; existing expended slots stay expended.
    const slots = maxSlots.map((max, i) => Math.min(max, (sc.slots[i] ?? 0) + Math.max(0, max - (sc.maxSlots[i] ?? 0))));
    const newPact = pact ? { max: pact.max, level: pact.level, current: Math.min(pact.max, (sc.pact?.current ?? 0) + Math.max(0, pact.max - (sc.pact?.max ?? 0))) } : undefined;
    const { pact: _old, ...rest } = sc;
    next = { ...c, spellcasting: { ...rest, slots, maxSlots, ...(newPact && { pact: newPact }) } };
  }
  return { ...next, ac: armorClass(next, db).ac, speed: { ...next.speed, walk: baseSpeed(next, db) } };
}
