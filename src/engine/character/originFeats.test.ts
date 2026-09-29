/** A046b: origin feat picks (Magic Initiate, Skilled) flow from the creator into buildCharacter. */
import { describe, expect, it } from 'vitest';
import { loadSrd } from '../data/srdBundle';
import { buildCharacter, validateBuild } from './builder';
import { chooseBackground, chooseSpecies, choiceValues, creationChoices, setChoiceValues, toBuildInput } from './creator';
import { quickBuild } from './quickBuild';
import { Rng } from '../core/rng';

const db = loadSrd();
const qb = (id: string) => quickBuild(id, db, Rng.fromSeed(id));

describe('origin feat choices', () => {
  it('Acolyte (Magic Initiate: Cleric) offers cleric cantrips, a level 1 spell and an ability, and applies them', () => {
    let s = qb('fighter');
    s = { ...chooseBackground(s, 'acolyte'), backgroundBonus: { wis: 2, cha: 1 }, classSkills: ['athletics', 'perception'] };
    const keys = creationChoices(s, db).map((c) => c.key);
    expect(keys).toEqual(expect.arrayContaining(['feat_bg_cantrips', 'feat_bg_spell', 'feat_bg_ability']));
    expect(keys).not.toContain('feat_bg_list');
    const cantripOpts = creationChoices(s, db).find((c) => c.key === 'feat_bg_cantrips')!.options.map((o) => o.id);
    expect(cantripOpts).toContain('guidance');
    expect(cantripOpts).not.toContain('fire_bolt');
    s = setChoiceValues(s, 'feat_bg_cantrips', ['guidance', 'sacred_flame']);
    s = setChoiceValues(s, 'feat_bg_spell', ['bless']);
    s = setChoiceValues(s, 'feat_bg_ability', ['wis']);
    const input = toBuildInput(s);
    expect(validateBuild(input, db).filter((p) => /Magic Initiate|list/.test(p))).toEqual([]);
    const c = buildCharacter(input, db);
    expect(c.spellcasting?.cantrips).toEqual(expect.arrayContaining(['guidance', 'sacred_flame']));
    expect(c.spellcasting?.prepared).toContainEqual({ spellId: 'bless', classId: 'feat:magic_initiate:cleric' });
    expect(c.choices['magic_initiate_ability:cleric']).toEqual(['wis']);
  });

  it('rejects spells from the wrong list and a wrong count', () => {
    let s = chooseBackground(qb('fighter'), 'acolyte');
    s = setChoiceValues(s, 'feat_bg_cantrips', ['fire_bolt']);
    s = setChoiceValues(s, 'feat_bg_spell', ['bless']);
    s = setChoiceValues(s, 'feat_bg_ability', ['wis']);
    const problems = validateBuild(toBuildInput(s), db);
    expect(problems).toContain('Magic Initiate: choose two cantrips');
    expect(problems).toContain('fire_bolt is not on the cleric list');
  });

  it('Human Versatile Magic Initiate asks for a list first, then spells from it', () => {
    let s = chooseSpecies(qb('fighter'), 'human');
    s = { ...s, speciesSkills: ['insight'], speciesFeatId: 'magic_initiate' };
    expect(creationChoices(s, db).map((c) => c.key)).toContain('feat_sp_list');
    expect(creationChoices(s, db).map((c) => c.key)).not.toContain('feat_sp_cantrips');
    s = setChoiceValues(s, 'feat_sp_list', ['wizard']);
    const opts = creationChoices(s, db).find((c) => c.key === 'feat_sp_cantrips')!.options.map((o) => o.id);
    expect(opts).toContain('fire_bolt');
  });

  it('Human Versatile Skilled adds three skill proficiencies', () => {
    let s = chooseSpecies(qb('fighter'), 'human');
    s = { ...s, speciesSkills: ['insight'], speciesFeatId: 'skilled' };
    const ch = creationChoices(s, db).find((c) => c.key === 'feat_sp_skilled')!;
    expect(ch.count).toBe(3);
    expect(ch.options.map((o) => o.id)).not.toContain('insight');
    s = setChoiceValues(s, 'feat_sp_skilled', ['arcana', 'history', 'nature']);
    const c = buildCharacter(toBuildInput(s), db);
    expect(c.skills.arcana).toBe('proficient');
    expect(c.skills.nature).toBe('proficient');
  });

  it('changing background or species clears the old feat picks', () => {
    let s = chooseBackground(qb('fighter'), 'acolyte');
    s = setChoiceValues(s, 'feat_bg_cantrips', ['guidance', 'sacred_flame']);
    expect(choiceValues(chooseBackground(s, 'soldier'), 'feat_bg_cantrips')).toEqual([]);
  });

  it('Quick Build fills every origin-feat pick with a valid build', () => {
    for (const id of db.classes.keys()) {
      const s = qb(id);
      expect(validateBuild(toBuildInput(s), db), id).toEqual([]);
    }
  });
});
