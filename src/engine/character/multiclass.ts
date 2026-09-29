/**
 * Multiclassing (SRD 5.2): prerequisites (13+ in the primary ability of every current class
 * and the new class; "Strength or Dexterity" style primaries need only one), the limited
 * proficiencies gained from a new class, and adding the first level of a new class.
 * HP, hit dice, proficiency bonus and multiclass spell slots are handled by levelUp/recompute.
 */
import type { Character } from '../core/creature';
import type { ClassData } from '../data/schemas';
import type { SrdDatabase } from '../data/srd';
import { ABILITY_NAMES, type Skill } from '../rules/basics';
import { LevelError, levelUp, type LevelUpOptions, type LevelUpResult } from './leveling';

export const MULTICLASS_MIN_SCORE = 13;

function primaryProblem(c: Character, cls: ClassData): string | undefined {
  const scores = cls.multiclass.prerequisites.map((a) => c.abilities[a] >= MULTICLASS_MIN_SCORE);
  const ok = cls.multiclass.anyOf ? scores.some(Boolean) : scores.every(Boolean);
  if (ok) return undefined;
  const names = cls.multiclass.prerequisites.map((a) => ABILITY_NAMES[a]).join(cls.multiclass.anyOf ? ' or ' : ' and ');
  return `${cls.name} needs ${names} ${MULTICLASS_MIN_SCORE}+`;
}

/** Why the character can't take a first level in `classId` (empty = allowed). */
export function multiclassProblems(c: Character, db: SrdDatabase, classId: string): string[] {
  const target = db.classes.get(classId);
  if (!target) return [`Unknown class ${classId}`];
  if (c.classes.some((x) => x.classId === classId)) return [`Already has ${target.name} levels`];
  const problems: string[] = [];
  for (const cl of c.classes) {
    const cls = db.classes.get(cl.classId);
    const p = cls && primaryProblem(c, cls);
    if (p) problems.push(p);
  }
  const p = primaryProblem(c, target);
  if (p) problems.push(p);
  return problems;
}

export interface MulticlassGains {
  weapons: string[];
  armor: ('light' | 'medium' | 'heavy' | 'shield')[];
  /** Number of skills to choose, and from which list ('any' or the class list). */
  skills?: { count: number; from: 'any' | 'class' };
  tools: string[];
  /** Musical instruments to choose. */
  instruments: number;
}

/** Parses the class's "As a Multiclass Character" proficiency lines. */
export function multiclassGains(cls: ClassData): MulticlassGains {
  const g: MulticlassGains = { weapons: [], armor: [], tools: [], instruments: 0 };
  for (const line of cls.multiclass.proficienciesGained) {
    const l = line.toLowerCase();
    if (l.includes('martial weapons')) g.weapons.push('martial');
    if (l.startsWith('training with')) {
      if (/\blight\b/.test(l)) g.armor.push('light');
      if (/\bmedium\b/.test(l)) g.armor.push('medium');
      if (/\bheavy\b/.test(l)) g.armor.push('heavy');
      if (l.includes('shields')) g.armor.push('shield');
    }
    if (l === 'shields') g.armor.push('shield');
    if (l.includes('one skill')) g.skills = { count: 1, from: l.includes("skill list") ? 'class' : 'any' };
    if (l.includes("thieves' tools")) g.tools.push('thieves_tools');
    if (l.includes('musical instrument')) g.instruments += 1;
  }
  return g;
}

export interface MulticlassOptions extends Omit<LevelUpOptions, 'classId'> {
  skill?: Skill;
  instrument?: string;
}

/** Takes the first level of a new class, applying multiclass proficiencies. */
export function addClass(c: Character, db: SrdDatabase, classId: string, o: MulticlassOptions): LevelUpResult {
  const problems = multiclassProblems(c, db, classId);
  if (problems.length) throw new LevelError(problems.join('; '));
  const cls = db.classes.get(classId)!;
  const gains = multiclassGains(cls);
  if (gains.skills) {
    if (!o.skill) throw new LevelError(`Choose a skill from ${cls.name}`);
    if (gains.skills.from === 'class' && !cls.skillChoices.from.includes(o.skill)) throw new LevelError(`${o.skill} is not a ${cls.name} skill`);
  }
  if (gains.instruments && !o.instrument) throw new LevelError('Choose a musical instrument');

  const result = levelUp(c, db, { ...o, classId });
  const ch = result.character;
  const skills = { ...ch.skills };
  if (o.skill && !skills[o.skill]) skills[o.skill] = 'proficient';
  const uniq = <T>(xs: T[]) => [...new Set(xs)];
  return {
    ...result,
    character: {
      ...ch,
      skills,
      proficiencies: {
        weapons: uniq([...ch.proficiencies.weapons, ...gains.weapons]),
        armor: uniq([...ch.proficiencies.armor, ...gains.armor]),
        tools: uniq([...ch.proficiencies.tools, ...gains.tools, ...(o.instrument ? [o.instrument] : [])]),
      },
    },
  };
}

/** Extra Attack from several classes doesn't stack: attacks per Attack action. */
export function attacksPerAction(c: Character): number {
  const fighter = c.classes.find((x) => x.classId === 'fighter')?.level ?? 0;
  if (fighter >= 20) return 4;
  if (fighter >= 11) return 3;
  const extraAttackClasses = ['barbarian', 'fighter', 'monk', 'paladin', 'ranger'];
  return c.classes.some((x) => extraAttackClasses.includes(x.classId) && x.level >= 5) ? 2 : 1;
}
