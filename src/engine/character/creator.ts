/**
 * Character creator state machine (spec §5). Holds the player's in-progress choices, decides
 * which steps apply (no Spells step for non-casters), lists what's missing on each step, and
 * converts a finished state into a CharacterBuildInput for buildCharacter(). Pure; the UI keeps a
 * CreatorState in a signal and calls these functions.
 */
import type { SrdDatabase } from '../data/srd';
import { ABILITIES, type Ability, type AbilityScores, type Skill } from '../rules/basics';
import { validateBuild, type CharacterBuildInput } from './builder';

export const CREATOR_STEPS = ['class', 'background', 'species', 'abilities', 'skills', 'equipment', 'spells', 'appearance', 'identity', 'difficulty', 'review'] as const;
export type CreatorStep = (typeof CREATOR_STEPS)[number];

export const STEP_LABELS: Record<CreatorStep, string> = {
  class: 'Class',
  background: 'Background',
  species: 'Species',
  abilities: 'Ability Scores',
  skills: 'Skills',
  equipment: 'Equipment',
  spells: 'Spells',
  appearance: 'Appearance',
  identity: 'Name & Story',
  difficulty: 'Difficulty',
  review: 'Review',
};

export type AbilityMethod = 'standard_array' | 'point_buy' | 'roll';

export interface Appearance {
  body: string;
  face: string;
  hair: string;
  skinTone: string;
  primaryColor: string;
  secondaryColor: string;
}

export interface CreatorState {
  step: CreatorStep;
  classId?: string;
  backgroundId?: string;
  speciesId?: string;
  lineageId?: string;
  size?: 'small' | 'medium';
  abilityMethod?: AbilityMethod;
  /** Assigned base scores (before background bonus). */
  baseScores: Partial<AbilityScores>;
  /** Rolled totals waiting to be assigned (roll method). */
  rolledPool?: number[];
  backgroundBonus: Partial<Record<Ability, number>>;
  classSkills: Skill[];
  speciesSkills: Skill[];
  speciesFeatId?: string;
  classEquipment?: number;
  backgroundEquipment?: 'a' | 'b';
  choiceItems: Record<string, string>;
  weaponMasteries: string[];
  choices: Record<string, string[]>;
  cantrips: string[];
  preparedSpells: string[];
  appearance?: Appearance;
  name: string;
  personality: { traits?: string; ideals?: string; bonds?: string; flaws?: string; backstory?: string };
  difficulty?: 'heroic' | 'hardcore';
}

export function newCreatorState(): CreatorState {
  return {
    step: 'class',
    baseScores: {},
    backgroundBonus: {},
    classSkills: [],
    speciesSkills: [],
    choiceItems: {},
    weaponMasteries: [],
    choices: {},
    cantrips: [],
    preparedSpells: [],
    name: '',
    personality: {},
  };
}

/** The steps that apply to this build (Spells only for spellcasting classes). */
export function stepsFor(s: CreatorState, db: SrdDatabase): CreatorStep[] {
  const cls = s.classId ? db.classes.get(s.classId) : undefined;
  const casts = cls ? cls.spellcasting.progression !== 'none' : true;
  return CREATOR_STEPS.filter((st) => st !== 'spells' || casts);
}

/** Changing an earlier choice clears the later choices that depended on it. */
export function chooseClass(s: CreatorState, classId: string): CreatorState {
  if (s.classId === classId) return s;
  return { ...s, classId, classSkills: [], classEquipment: undefined, weaponMasteries: [], choices: {}, cantrips: [], preparedSpells: [] } as CreatorState;
}

export function chooseBackground(s: CreatorState, backgroundId: string): CreatorState {
  if (s.backgroundId === backgroundId) return s;
  return { ...s, backgroundId, backgroundBonus: {}, classSkills: [], backgroundEquipment: undefined } as CreatorState;
}

export function chooseSpecies(s: CreatorState, speciesId: string): CreatorState {
  if (s.speciesId === speciesId) return s;
  return { ...s, speciesId, lineageId: undefined, size: undefined, speciesSkills: [], speciesFeatId: undefined } as CreatorState;
}

/** What still blocks leaving a step. Empty = the step is complete. */
export function stepProblems(s: CreatorState, step: CreatorStep, db: SrdDatabase): string[] {
  switch (step) {
    case 'class':
      return s.classId && db.classes.has(s.classId) ? [] : ['Choose a class'];
    case 'background':
      return s.backgroundId && db.backgrounds.has(s.backgroundId) ? [] : ['Choose a background'];
    case 'species': {
      const sp = s.speciesId ? db.species.get(s.speciesId) : undefined;
      if (!sp) return ['Choose a species'];
      const out: string[] = [];
      if (sp.lineages?.length && !sp.lineages.some((l) => l.id === s.lineageId)) out.push(`Choose a ${sp.lineageLabel ?? 'lineage'}`);
      if (sp.sizes.length > 1 && !s.size) out.push('Choose a size');
      return out;
    }
    case 'abilities': {
      const out: string[] = [];
      if (!s.abilityMethod) out.push('Choose a method');
      if (ABILITIES.some((a) => s.baseScores[a] === undefined)) out.push('Assign all six scores');
      const bonus = Object.values(s.backgroundBonus).filter(Boolean).sort().join(',');
      if (bonus !== '1,2' && bonus !== '1,1,1') out.push('Apply your background increase (+2/+1 or +1/+1/+1)');
      return out;
    }
    case 'skills': {
      const cls = s.classId ? db.classes.get(s.classId) : undefined;
      const out: string[] = [];
      if (cls && s.classSkills.length !== cls.skillChoices.count) out.push(`Choose ${cls.skillChoices.count} class skills`);
      if (s.speciesId === 'human' && s.speciesSkills.length !== 1) out.push('Choose your Skillful skill');
      if (s.speciesId === 'elf' && s.speciesSkills.length !== 1) out.push('Choose your Keen Senses skill');
      if (s.speciesId === 'human' && !s.speciesFeatId) out.push('Choose your Versatile origin feat');
      return out;
    }
    case 'equipment':
      return s.classEquipment === undefined || !s.backgroundEquipment ? ['Choose your starting equipment'] : [];
    case 'appearance':
      return s.appearance ? [] : ['Customize your appearance'];
    case 'identity':
      return s.name.trim() ? [] : ['Enter a name'];
    case 'difficulty':
      return s.difficulty ? [] : ['Choose Heroic or Hardcore'];
    case 'spells':
    case 'review':
      return s.step === 'review' ? validateBuild(toBuildInput(s), db) : [];
  }
}

export function canAdvance(s: CreatorState, db: SrdDatabase): boolean {
  return stepProblems(s, s.step, db).length === 0;
}

export function nextStep(s: CreatorState, db: SrdDatabase): CreatorState {
  const steps = stepsFor(s, db);
  const i = steps.indexOf(s.step);
  if (!canAdvance(s, db) || i === steps.length - 1) return s;
  return { ...s, step: steps[i + 1]! };
}

export function prevStep(s: CreatorState, db: SrdDatabase): CreatorState {
  const steps = stepsFor(s, db);
  const i = steps.indexOf(s.step);
  return i > 0 ? { ...s, step: steps[i - 1]! } : s;
}

/** Jump to a step only if every earlier step is complete. */
export function goToStep(s: CreatorState, step: CreatorStep, db: SrdDatabase): CreatorState {
  const steps = stepsFor(s, db);
  const target = steps.indexOf(step);
  if (target < 0) return s;
  for (let i = 0; i < target; i++) if (stepProblems(s, steps[i]!, db).length) return s;
  return { ...s, step };
}

export function toBuildInput(s: CreatorState, id = 'hero'): CharacterBuildInput {
  return {
    id,
    name: s.name.trim(),
    classId: s.classId ?? '',
    speciesId: s.speciesId ?? '',
    ...(s.lineageId && { lineageId: s.lineageId }),
    ...(s.size && { size: s.size }),
    backgroundId: s.backgroundId ?? '',
    baseScores: { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8, ...s.baseScores },
    backgroundBonus: s.backgroundBonus,
    classSkills: s.classSkills,
    ...(s.speciesSkills.length && { speciesSkills: s.speciesSkills }),
    ...(s.speciesFeatId && { speciesFeatId: s.speciesFeatId }),
    classEquipment: s.classEquipment ?? 0,
    backgroundEquipment: s.backgroundEquipment ?? 'a',
    choiceItems: s.choiceItems,
    weaponMasteries: s.weaponMasteries,
    choices: s.choices,
    cantrips: s.cantrips,
    preparedSpells: s.preparedSpells,
    personality: s.personality,
  };
}
