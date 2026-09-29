/**
 * Character creator state machine (spec §5). Holds the player's in-progress choices, decides
 * which steps apply (no Spells step for non-casters), lists what's missing on each step, and
 * converts a finished state into a CharacterBuildInput for buildCharacter(). Pure; the UI keeps a
 * CreatorState in a signal and calls these functions.
 */
import type { SrdDatabase } from '../data/srd';
import { ABILITIES, type Ability, type AbilityScores, type Skill } from '../rules/basics';
import { validateBuild, type CharacterBuildInput } from './builder';
import { scoreProblems } from './abilityScores';
import { weaponMasteryCount } from './featureLevels';

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
  /** Rogue level-1 Expertise. */
  expertise: Skill[];
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
    expertise: [],
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
  return { ...s, classId, classSkills: [], expertise: [], classEquipment: undefined, weaponMasteries: [], choices: {}, cantrips: [], preparedSpells: [] } as CreatorState;
}

export function chooseBackground(s: CreatorState, backgroundId: string): CreatorState {
  if (s.backgroundId === backgroundId) return s;
  return { ...s, backgroundId, backgroundBonus: {}, classSkills: [], expertise: [], backgroundEquipment: undefined } as CreatorState;
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
      const out = scoreProblems(s.abilityMethod, s.baseScores, s.rolledPool);
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
      for (const ch of creationChoices(s, db)) if (choiceValues(s, ch.key).length !== ch.count) out.push(`Choose ${ch.label} (${ch.count})`);
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
    case 'spells': {
      const need = spellCounts(s, db);
      const out: string[] = [];
      if (s.cantrips.length !== need.cantrips) out.push(`Choose ${need.cantrips} cantrips`);
      if (s.preparedSpells.length !== need.spells) out.push(`Choose ${need.spells} level 1 spells`);
      return out;
    }
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

export interface CreationChoice {
  /** Where the pick is stored: 'weapon_mastery' → weaponMasteries, 'expertise' → expertise, else choices[key]. */
  key: string;
  label: string;
  count: number;
  options: { id: string; label: string; detail?: string }[];
}

const cap = (x: string) => x.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());

/** Current picks for a choice key. */
export function choiceValues(s: CreatorState, key: string): string[] {
  if (key === 'weapon_mastery') return s.weaponMasteries;
  if (key === 'expertise') return s.expertise;
  return s.choices[key] ?? [];
}

/** Stores picks for a choice key. */
export function setChoiceValues(s: CreatorState, key: string, values: string[]): CreatorState {
  if (key === 'weapon_mastery') return { ...s, weaponMasteries: values };
  if (key === 'expertise') return { ...s, expertise: values as Skill[] };
  return { ...s, choices: { ...s.choices, [key]: values } };
}

/** Class options the player must pick at level 1 (besides skills, spells and equipment). */
export function creationChoices(s: CreatorState, db: SrdDatabase): CreationChoice[] {
  const cls = s.classId ? db.classes.get(s.classId) : undefined;
  if (!cls) return [];
  const out: CreationChoice[] = [];
  const masteries = weaponMasteryCount(cls, 1);
  if (masteries > 0) {
    const meleeOnly = cls.id === 'barbarian';
    const weapons = [...db.weapons.values()].filter((w) => {
      if (meleeOnly && w.kind !== 'melee') return false;
      const t = cls.weaponProficiencies;
      return t.includes(w.category) || (w.category === 'martial' && ((t.includes('martial:light') && w.properties.includes('light')) || (t.includes('martial:finesse') && w.properties.includes('finesse'))));
    });
    out.push({ key: 'weapon_mastery', label: 'weapon masteries', count: masteries, options: weapons.map((w) => ({ id: w.id, label: w.name, detail: cap(w.mastery) })) });
  }
  if (cls.id === 'fighter') {
    const styles = [...db.feats.values()].filter((f) => f.category === 'fighting_style');
    out.push({ key: 'fighting_style', label: 'a Fighting Style', count: 1, options: styles.map((f) => ({ id: f.id, label: f.name, detail: f.text })) });
  }
  if (cls.id === 'rogue') {
    const bg = s.backgroundId ? db.backgrounds.get(s.backgroundId) : undefined;
    const prof = [...new Set([...(bg?.skills ?? []), ...s.classSkills, ...s.speciesSkills])];
    out.push({ key: 'expertise', label: 'Expertise skills', count: 2, options: prof.map((k) => ({ id: k, label: cap(k) })) });
  }
  if (cls.id === 'cleric') {
    out.push({ key: 'divine_order', label: 'a Divine Order', count: 1, options: [
      { id: 'protector', label: 'Protector', detail: 'Martial weapons and Heavy armor training.' },
      { id: 'thaumaturge', label: 'Thaumaturge', detail: 'One extra cantrip; add Wisdom to Arcana and Religion checks.' },
    ] });
  }
  if (cls.id === 'druid') {
    out.push({ key: 'primal_order', label: 'a Primal Order', count: 1, options: [
      { id: 'magician', label: 'Magician', detail: 'One extra cantrip; add Wisdom to Arcana and Nature checks.' },
      { id: 'warden', label: 'Warden', detail: 'Martial weapons and Medium armor training.' },
    ] });
  }
  if (cls.id === 'warlock') {
    const invocations = (cls.options.eldritch_invocation ?? []).filter((o) => !o.prerequisite || !/Level \d+\+/.test(o.prerequisite));
    out.push({ key: 'eldritch_invocation', label: 'an Eldritch Invocation', count: 1, options: invocations.map((o) => ({ id: o.id, label: o.name, detail: o.text })) });
  }
  const instruments = [...db.gear.values()].filter((g) => g.tags.includes('musical_instrument'));
  if (cls.id === 'bard') out.push({ key: 'tool_proficiencies', label: 'Musical Instruments', count: 3, options: instruments.map((g) => ({ id: g.id, label: g.name })) });
  if (cls.id === 'monk') {
    const artisan = [...db.gear.values()].filter((g) => g.category === 'tool' && /(Supplies|Tools|Utensils)$/.test(g.name) && !["Thieves' Tools", "Navigator's Tools"].includes(g.name));
    out.push({ key: 'tool_proficiencies', label: "an Artisan's Tool or Musical Instrument", count: 1, options: [...artisan, ...instruments].map((g) => ({ id: g.id, label: g.name })) });
  }
  return out;
}

/** Cantrips and level 1 spells to pick at creation (Thaumaturge/Magician add a cantrip). */
export function spellCounts(s: CreatorState, db: SrdDatabase): { cantrips: number; spells: number } {
  const cls = s.classId ? db.classes.get(s.classId) : undefined;
  if (!cls || cls.spellcasting.progression === 'none') return { cantrips: 0, spells: 0 };
  const extra = s.choices.divine_order?.[0] === 'thaumaturge' || s.choices.primal_order?.[0] === 'magician' ? 1 : 0;
  return { cantrips: (cls.spellcasting.cantripsKnown?.[0] ?? 0) + extra, spells: cls.spellcasting.preparedSpells?.[0] ?? 0 };
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
    ...(s.expertise.length && { expertise: s.expertise }),
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
