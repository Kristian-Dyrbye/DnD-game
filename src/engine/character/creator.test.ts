import { describe, expect, it } from 'vitest';
import { loadSrd } from '../data/srdBundle';
import {
  canAdvance,
  chooseBackground,
  chooseClass,
  chooseSpecies,
  goToStep,
  newCreatorState,
  nextStep,
  prevStep,
  stepProblems,
  stepsFor,
  toBuildInput,
  type CreatorState,
} from './creator';
import { buildCharacter } from './builder';

const db = loadSrd();

describe('creator state machine', () => {
  it('starts on the class step and cannot advance without a class', () => {
    const s = newCreatorState();
    expect(s.step).toBe('class');
    expect(canAdvance(s, db)).toBe(false);
    expect(nextStep(s, db).step).toBe('class');
    expect(stepProblems(s, 'class', db)).toEqual(['Choose a class']);
  });

  it('moves forward and back through the steps', () => {
    let s = chooseClass(newCreatorState(), 'fighter');
    s = nextStep(s, db);
    expect(s.step).toBe('background');
    s = prevStep(s, db);
    expect(s.step).toBe('class');
  });

  it('skips the Spells step for non-casters', () => {
    expect(stepsFor(chooseClass(newCreatorState(), 'fighter'), db)).not.toContain('spells');
    expect(stepsFor(chooseClass(newCreatorState(), 'wizard'), db)).toContain('spells');
  });

  it('clears dependent choices when an earlier choice changes', () => {
    let s: CreatorState = { ...chooseClass(newCreatorState(), 'fighter'), classSkills: ['athletics', 'perception'], weaponMasteries: ['longsword'] };
    s = chooseClass(s, 'rogue');
    expect(s.classSkills).toEqual([]);
    expect(s.weaponMasteries).toEqual([]);
    s = chooseSpecies({ ...s, speciesId: 'elf', lineageId: 'drow' }, 'dwarf');
    expect(s.lineageId).toBeUndefined();
    s = chooseBackground({ ...s, backgroundBonus: { str: 2, con: 1 } }, 'sage');
    expect(s.backgroundBonus).toEqual({});
  });

  it('requires lineage and size choices on the species step', () => {
    expect(stepProblems({ ...newCreatorState(), speciesId: 'dragonborn' }, 'species', db)).toEqual(['Choose a Draconic Ancestry']);
    expect(stepProblems({ ...newCreatorState(), speciesId: 'human' }, 'species', db)).toEqual(['Choose a size']);
    expect(stepProblems({ ...newCreatorState(), speciesId: 'human', size: 'medium' }, 'species', db)).toEqual([]);
  });

  it('only jumps ahead when earlier steps are complete', () => {
    const s = newCreatorState();
    expect(goToStep(s, 'abilities', db).step).toBe('class');
    const done: CreatorState = { ...s, classId: 'fighter', backgroundId: 'soldier', speciesId: 'dwarf' };
    expect(goToStep(done, 'abilities', db).step).toBe('abilities');
  });

  it('a completed state builds a valid character', () => {
    const s: CreatorState = {
      ...newCreatorState(),
      step: 'review',
      classId: 'fighter',
      backgroundId: 'soldier',
      speciesId: 'dwarf',
      abilityMethod: 'standard_array',
      baseScores: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
      backgroundBonus: { str: 2, con: 1 },
      classSkills: ['perception', 'survival'],
      classEquipment: 0,
      backgroundEquipment: 'a',
      weaponMasteries: ['greatsword', 'longsword', 'javelin'],
      name: 'Brenna',
      difficulty: 'heroic',
    };
    expect(stepProblems(s, 'review', db)).toEqual([]);
    const c = buildCharacter(toBuildInput(s), db);
    expect(c).toMatchObject({ name: 'Brenna', abilities: { str: 17 } });
  });
});

describe('level-1 choices and spells', () => {
  const base = (classId: string): CreatorState => ({ ...newCreatorState(), classId, backgroundId: 'criminal', speciesId: 'dwarf', classSkills: [] });

  it('lists class picks: masteries, fighting style, expertise, orders, invocations, tools', async () => {
    const { creationChoices } = await import('./creator');
    const keys = (id: string) => creationChoices(base(id), db).map((c) => `${c.key}:${c.count}`);
    expect(keys('fighter')).toEqual(['weapon_mastery:3', 'fighting_style:1']);
    expect(keys('rogue')).toEqual(['weapon_mastery:2', 'expertise:2']);
    expect(keys('cleric')).toEqual(['divine_order:1']);
    expect(keys('warlock')).toEqual(['eldritch_invocation:1']);
    expect(keys('bard')).toEqual(['tool_proficiencies:3']);
    expect(keys('wizard')).toEqual([]);
    const barbWeapons = creationChoices(base('barbarian'), db)[0]!.options.map((o) => o.id);
    expect(barbWeapons).toContain('greataxe');
    expect(barbWeapons).not.toContain('longbow');
    const inv = creationChoices(base('warlock'), db)[0]!.options.map((o) => o.id);
    expect(inv).toContain('pact_of_the_blade');
    expect(inv).not.toContain('agonizing_blast');
  });

  it('skills step requires the class picks; expertise options are proficient skills', async () => {
    const { creationChoices, setChoiceValues } = await import('./creator');
    let s: CreatorState = { ...base('rogue'), classSkills: ['acrobatics', 'perception', 'insight', 'deception'] };
    expect(stepProblems(s, 'skills', db)).toEqual(['Choose weapon masteries (2)', 'Choose Expertise skills (2)']);
    const expertiseOpts = creationChoices(s, db)[1]!.options.map((o) => o.id);
    expect(expertiseOpts).toEqual(expect.arrayContaining(['stealth', 'sleight_of_hand', 'perception']));
    s = setChoiceValues(setChoiceValues(s, 'weapon_mastery', ['dagger', 'shortbow']), 'expertise', ['stealth', 'perception']);
    expect(stepProblems(s, 'skills', db)).toEqual([]);
  });

  it('spell counts come from the class table; Thaumaturge adds a cantrip', async () => {
    const { spellCounts } = await import('./creator');
    expect(spellCounts(base('wizard'), db)).toEqual({ cantrips: 3, spells: 4 });
    expect(spellCounts(base('paladin'), db)).toEqual({ cantrips: 0, spells: 2 });
    expect(spellCounts({ ...base('cleric'), choices: { divine_order: ['thaumaturge'] } }, db)).toEqual({ cantrips: 4, spells: 4 });
    expect(stepProblems({ ...base('wizard'), cantrips: ['fire_bolt'] }, 'spells', db)).toEqual(['Choose 3 cantrips', 'Choose 4 level 1 spells']);
  });

  it('builds a rogue with expertise and a bard with instruments', () => {
    const rogue = buildCharacter(
      { ...toBuildInput({ ...base('rogue'), baseScores: { str: 8, dex: 15, con: 14, int: 12, wis: 13, cha: 10 }, backgroundBonus: { dex: 2, con: 1 }, classSkills: ['acrobatics', 'perception', 'insight', 'deception'], expertise: ['stealth', 'perception'], weaponMasteries: ['dagger', 'shortbow'], classEquipment: 0, backgroundEquipment: 'a', name: 'Vex' }) },
      db,
    );
    expect(rogue.skills).toMatchObject({ stealth: 'expertise', perception: 'expertise', acrobatics: 'proficient' });
    expect(rogue.proficiencies.tools).toContain('thieves_tools');
  });
});
