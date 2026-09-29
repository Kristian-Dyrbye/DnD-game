import { describe, expect, it } from 'vitest';
import { loadSrd } from '../data/srdBundle';
import { buildCharacter, type CharacterBuildInput } from './builder';
import { addClass, attacksPerAction, multiclassGains, multiclassProblems } from './multiclass';
import { levelUp } from './leveling';
import type { Character } from '../core/creature';

const db = loadSrd();

const base: CharacterBuildInput = {
  id: 'hero',
  name: 'Brenna',
  classId: 'fighter',
  speciesId: 'dwarf',
  backgroundId: 'soldier',
  baseScores: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 13 },
  backgroundBonus: { str: 2, con: 1 },
  classSkills: ['perception', 'survival'],
  classEquipment: 0,
  backgroundEquipment: 'a',
  weaponMasteries: ['greatsword'],
  choices: { fighting_style: ['defense'] },
};

const fighter = () => buildCharacter(base, db);

describe('multiclass prerequisites', () => {
  it('needs 13 in the primary ability of the current and new class', () => {
    expect(multiclassProblems(fighter(), db, 'rogue')).toEqual([]); // Str 17 (fighter), Dex 13 (rogue)
    expect(multiclassProblems(fighter(), db, 'wizard')).toEqual(['Wizard needs Intelligence 13+']);
    expect(multiclassProblems(fighter(), db, 'paladin')).toEqual([]); // Str and Cha 13
    expect(multiclassProblems(fighter(), db, 'monk')).toEqual(['Monk needs Dexterity and Wisdom 13+']);
    expect(multiclassProblems(fighter(), db, 'fighter')).toEqual(['Already has Fighter levels']);
  });

  it('checks the current class too', () => {
    const weak: Character = { ...fighter(), abilities: { ...fighter().abilities, str: 12, dex: 12 } };
    expect(multiclassProblems(weak, db, 'paladin')).toEqual(expect.arrayContaining(['Fighter needs Strength or Dexterity 13+']));
  });
});

describe('multiclass gains', () => {
  it('parses proficiencies gained', () => {
    expect(multiclassGains(db.classes.get('fighter')!)).toMatchObject({ weapons: ['martial'], armor: ['light', 'medium', 'shield'] });
    expect(multiclassGains(db.classes.get('rogue')!)).toMatchObject({ skills: { count: 1, from: 'class' }, tools: ['thieves_tools'], armor: ['light'] });
    expect(multiclassGains(db.classes.get('bard')!)).toMatchObject({ skills: { count: 1, from: 'any' }, instruments: 1 });
    expect(multiclassGains(db.classes.get('wizard')!)).toEqual({ weapons: [], armor: [], tools: [], instruments: 0 });
    expect(multiclassGains(db.classes.get('druid')!).armor).toEqual(['light', 'shield']);
  });
});

describe('addClass', () => {
  it('adds rogue level 1: average HP (not max), d8 hit die, skill + thieves tools, PB from total level', () => {
    const r = addClass(fighter(), db, 'rogue', { hp: { mode: 'average' }, ignoreXp: true, skill: 'stealth' });
    const c = r.character;
    expect(c.classes).toEqual([
      { classId: 'fighter', level: 1 },
      { classId: 'rogue', level: 1 },
    ]);
    expect(r.hpGained).toBe(5 + 2 + 1);
    expect(c.hitDice).toEqual({ d10: 1, d8: 1 });
    expect(c.skills.stealth).toBe('proficient');
    expect(c.proficiencies.tools).toContain('thieves_tools');
    expect(r.features).toEqual(expect.arrayContaining(['Sneak Attack', 'Expertise']));
  });

  it('rejects invalid choices', () => {
    expect(() => addClass(fighter(), db, 'rogue', { hp: { mode: 'average' }, ignoreXp: true })).toThrow(/Choose a skill/);
    expect(() => addClass(fighter(), db, 'rogue', { hp: { mode: 'average' }, ignoreXp: true, skill: 'arcana' })).toThrow(/not a Rogue skill/);
    expect(() => addClass(fighter(), db, 'wizard', { hp: { mode: 'average' }, ignoreXp: true })).toThrow(/Intelligence/);
  });

  it('paladin/wizard multiclass uses the multiclass slot table (full + ceil(half))', () => {
    const smart = buildCharacter({ ...base, baseScores: { ...base.baseScores, int: 13 } }, db);
    let c = addClass(smart, db, 'wizard', { hp: { mode: 'average' }, ignoreXp: true }).character;
    expect(c.spellcasting!.maxSlots[0]).toBe(2);
    c = addClass(c, db, 'paladin', { hp: { mode: 'average' }, ignoreXp: true }).character;
    // wizard 1 + ceil(paladin 1 / 2) = caster level 2 → three level 1 slots
    expect(c.spellcasting!.maxSlots.slice(0, 2)).toEqual([3, 0]);
  });

  it('Extra Attack does not stack across classes', () => {
    let c = fighter();
    for (let i = 0; i < 4; i++) c = levelUp(c, db, { classId: 'fighter', hp: { mode: 'average' }, ignoreXp: true, ...(i === 1 && { subclassId: 'champion' }), ...(i === 2 && { feat: { featId: 'ability_score_improvement', increases: { con: 1, dex: 1 } } }) }).character;
    expect(c.classes[0]!.level).toBe(5);
    expect(attacksPerAction(c)).toBe(2);
    expect(attacksPerAction({ ...c, classes: [...c.classes, { classId: 'paladin', level: 5 }] })).toBe(2);
    expect(attacksPerAction({ ...c, classes: [{ classId: 'fighter', level: 11 }] })).toBe(3);
  });
});
