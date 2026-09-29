import { describe, expect, it } from 'vitest';
import {
  ABILITIES,
  CONDITIONS,
  DAMAGE_TYPES,
  SKILLS,
  SKILL_ABILITY,
  SKILL_NAMES,
  abilityModifier,
  formatCR,
  formatModifier,
  parseCR,
  proficiencyBonus,
  proficiencyBonusForCR,
  proficiencyContribution,
  sizeSquares,
} from './basics';
import { CharacterSchema, CreatureSchema, totalLevel } from '../core/creature';

describe('ability modifiers', () => {
  it('matches the SRD table', () => {
    const table: [number, number][] = [
      [1, -5], [2, -4], [3, -4], [8, -1], [9, -1], [10, 0], [11, 0],
      [12, 1], [15, 2], [16, 3], [20, 5], [29, 9], [30, 10],
    ];
    for (const [score, mod] of table) expect(abilityModifier(score), `score ${score}`).toBe(mod);
  });
});

describe('proficiency bonus', () => {
  it('by character level', () => {
    const expected = [2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 6, 6, 6, 6];
    expected.forEach((pb, i) => expect(proficiencyBonus(i + 1), `level ${i + 1}`).toBe(pb));
    expect(() => proficiencyBonus(0)).toThrow(RangeError);
    expect(() => proficiencyBonus(21)).toThrow(RangeError);
  });

  it('by challenge rating', () => {
    const table: [number, number][] = [
      [0, 2], [0.125, 2], [4, 2], [5, 3], [8, 3], [9, 4], [12, 4],
      [13, 5], [16, 5], [17, 6], [20, 6], [21, 7], [24, 7], [25, 8], [28, 8], [29, 9], [30, 9],
    ];
    for (const [cr, pb] of table) expect(proficiencyBonusForCR(cr), `CR ${cr}`).toBe(pb);
  });

  it('scales by proficiency level', () => {
    expect(proficiencyContribution('none', 3)).toBe(0);
    expect(proficiencyContribution('half', 3)).toBe(1);
    expect(proficiencyContribution('proficient', 3)).toBe(3);
    expect(proficiencyContribution('expertise', 3)).toBe(6);
  });
});

describe('vocabulary', () => {
  it('has the SRD lists', () => {
    expect(ABILITIES).toHaveLength(6);
    expect(SKILLS).toHaveLength(18);
    expect(DAMAGE_TYPES).toHaveLength(13);
    expect(CONDITIONS).toHaveLength(15);
    expect(SKILL_ABILITY.stealth).toBe('dex');
    expect(SKILL_ABILITY.athletics).toBe('str');
    for (const s of SKILLS) expect(SKILL_NAMES[s]).toBeTruthy();
  });

  it('computes grid squares by size', () => {
    expect(sizeSquares('tiny')).toBe(1);
    expect(sizeSquares('medium')).toBe(1);
    expect(sizeSquares('large')).toBe(2);
    expect(sizeSquares('gargantuan')).toBe(4);
  });

  it('parses and formats CR and modifiers', () => {
    expect(parseCR('1/8')).toBe(0.125);
    expect(parseCR('1/2')).toBe(0.5);
    expect(parseCR('17')).toBe(17);
    expect(formatCR(0.25)).toBe('1/4');
    expect(formatCR(3)).toBe('3');
    expect(() => parseCR('big')).toThrow();
    expect(formatModifier(3)).toBe('+3');
    expect(formatModifier(-1)).toBe('−1');
    expect(formatModifier(0)).toBe('+0');
  });
});

describe('creature schemas', () => {
  const base = {
    id: 'hero',
    name: 'Brenna',
    size: 'medium',
    creatureType: 'humanoid',
    abilities: { str: 15, dex: 14, con: 13, int: 8, wis: 12, cha: 10 },
    proficiencyBonus: 2,
    maxHp: 12,
    hp: 12,
    ac: 16,
    speed: { walk: 30 },
  };

  it('fills defaults for a monster', () => {
    const goblin = CreatureSchema.parse({ ...base, id: 'goblin-1', kind: 'monster', statBlockId: 'goblin-warrior' });
    expect(goblin.conditions).toEqual([]);
    expect(goblin.exhaustion).toBe(0);
    expect(goblin.tempHp).toBe(0);
  });

  it('validates a multiclass character and sums levels', () => {
    const c = CharacterSchema.parse({
      ...base,
      kind: 'character',
      classes: [
        { classId: 'fighter', level: 3, subclassId: 'champion' },
        { classId: 'wizard', level: 2 },
      ],
      speciesId: 'dwarf',
      backgroundId: 'soldier',
      skills: { athletics: 'proficient', perception: 'expertise' },
    });
    expect(totalLevel(c)).toBe(5);
    expect(c.deathSaves).toEqual({ successes: 0, failures: 0, stable: false });
  });

  it('rejects bad data', () => {
    expect(CreatureSchema.safeParse({ ...base, kind: 'monster', abilities: { ...base.abilities, str: 31 } }).success).toBe(false);
    expect(CreatureSchema.safeParse({ ...base, kind: 'monster', skills: { flying: 'proficient' } }).success).toBe(false);
    expect(CharacterSchema.safeParse({ ...base, kind: 'character', classes: [], speciesId: 'x', backgroundId: 'y' }).success).toBe(false);
  });
});
