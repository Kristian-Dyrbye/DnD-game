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
