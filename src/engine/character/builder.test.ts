import { describe, expect, it } from 'vitest';
import { loadSrd } from '../data/srdBundle';
import { BuildError, buildCharacter, validateBuild, type CharacterBuildInput } from './builder';
import { armorClass, baseSpeed, initiativeModifiers, maxHitPoints, unarmedStrike, weaponAttack } from './derived';
import type { Character } from '../core/creature';

const db = loadSrd();

const fighter: CharacterBuildInput = {
  id: 'hero',
  name: 'Brenna',
  classId: 'fighter',
  speciesId: 'dwarf',
  backgroundId: 'soldier',
  baseScores: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  backgroundBonus: { str: 2, con: 1 },
  classSkills: ['perception', 'survival'],
  classEquipment: 0,
  backgroundEquipment: 'a',
  weaponMasteries: ['greatsword', 'longsword', 'javelin'],
  choices: { fighting_style: ['defense'] },
};

describe('buildCharacter: level 1 fighter', () => {
  const c = buildCharacter(fighter, db);

  it('applies background increases and derived basics', () => {
    expect(c.abilities).toMatchObject({ str: 17, con: 15 });
    expect(c.proficiencyBonus).toBe(2);
    expect(c.saveProficiencies).toEqual(['str', 'con']);
    expect(c.hitDice).toEqual({ d10: 1 });
  });

  it('HP = d10 max + Con + Dwarven Toughness', () => {
    expect(c.maxHp).toBe(10 + 2 + 1);
    expect(c.hp).toBe(c.maxHp);
  });

  it('skills from background + class, dwarf darkvision and poison resistance', () => {
    expect(c.skills).toEqual({ athletics: 'proficient', intimidation: 'proficient', perception: 'proficient', survival: 'proficient' });
    expect(c.senses.darkvision).toBe(120);
    expect(c.resistances).toEqual(['poison']);
  });

  it('starting equipment is equipped: chain mail + Defense style = AC 17', () => {
    expect(c.inventory.find((i) => i.itemId === 'chain_mail')!.equipped).toBe('armor');
    expect(c.inventory.find((i) => i.itemId === 'greatsword')!.equipped).toBe('main_hand');
    expect(c.featIds).toEqual(['savage_attacker', 'defense']);
    expect(c.ac).toBe(17);
    expect(c.coins).toBe(400 + 1400);
    expect(c.inventory.filter((i) => i.itemId === 'javelin')).toHaveLength(8);
  });

  it('weapon attack: Str +3, proficiency +2, mastery known', () => {
    const gs = weaponAttack(c, db, c.inventory.find((i) => i.itemId === 'greatsword')!)!;
    expect(gs).toMatchObject({ toHit: 5, ability: 'str', mastery: 'graze', proficient: true, damage: [{ dice: '2d6', type: 'slashing' }] });
    expect(gs.damageModifiers).toEqual([{ value: 3, label: 'Strength' }]);
    expect(unarmedStrike(c).toHit).toBe(5);
  });

  it('dwarf in chain mail meets no Str requirement issue (Str 17 ≥ 13): speed 30', () => {
    expect(baseSpeed(c, db)).toBe(30);
    expect(armorClass(c, db)).toMatchObject({ untrainedArmor: false, heavyArmorTooHeavy: false });
  });
});

describe('other builds', () => {
  it('wizard: unarmored AC, spell slots, finesse dagger uses Dex', () => {
    const wiz = buildCharacter(
      {
        id: 'w',
        name: 'Ilsa',
        classId: 'wizard',
        speciesId: 'elf',
        lineageId: 'high_elf',
        backgroundId: 'sage',
        baseScores: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 },
        backgroundBonus: { int: 2, con: 1 },
        classSkills: ['investigation', 'insight'],
        speciesSkills: ['perception'],
        classEquipment: 0,
        backgroundEquipment: 'b',
        cantrips: ['fire_bolt', 'light', 'mage_hand'],
        preparedSpells: ['magic_missile', 'shield', 'sleep', 'mage_armor'],
      },
      db,
    );
    expect(wiz.ac).toBe(12);
    expect(wiz.maxHp).toBe(6 + 2);
    expect(wiz.spellcasting).toMatchObject({ slots: [2, 0, 0, 0, 0, 0, 0, 0, 0], cantrips: ['fire_bolt', 'light', 'mage_hand'] });
    expect(wiz.spellcasting!.prepared).toHaveLength(4);
    const dagger = weaponAttack(wiz, db, wiz.inventory.find((i) => i.itemId === 'dagger')!)!;
    expect(dagger.ability).toBe('dex');
    expect(wiz.inventory.some((i) => i.itemId === 'spellbook')).toBe(true);
    expect(wiz.coins).toBe(500 + 5000);
  });

  it('barbarian unarmored defense uses Con; monk uses Wis; wood elf is fast', () => {
    const barb = buildCharacter(
      { ...fighter, classId: 'barbarian', classSkills: ['perception', 'nature'], classEquipment: 1, weaponMasteries: ['greataxe'], choices: {} },
      db,
    );
    expect(barb.ac).toBe(10 + 1 + 2);
    const monk = buildCharacter(
      {
        ...fighter,
        classId: 'monk',
        speciesId: 'elf',
        lineageId: 'wood_elf',
        speciesSkills: ['insight'],
        baseScores: { str: 10, dex: 15, con: 13, int: 8, wis: 15, cha: 10 },
        backgroundBonus: { dex: 2, con: 1 },
        classSkills: ['acrobatics', 'stealth'],
        classEquipment: 1,
        weaponMasteries: [],
        choices: {},
      },
      db,
    );
    expect(monk.ac).toBe(10 + 3 + 2);
    expect(monk.speed.walk).toBe(35);
  });

  it('dragonborn and tiefling resistances come from the lineage; drow darkvision 120', () => {
    const base = { ...fighter, speciesId: 'dragonborn', lineageId: 'red' };
    expect(buildCharacter(base, db).resistances).toEqual(['fire']);
    const tief = buildCharacter({ ...fighter, speciesId: 'tiefling', lineageId: 'chthonic' }, db);
    expect(tief.resistances).toEqual(['necrotic']);
    const drow = buildCharacter({ ...fighter, speciesId: 'elf', lineageId: 'drow', speciesSkills: ['insight'] }, db);
    expect(drow.senses.darkvision).toBe(120);
  });

  it('humans get a skill and an origin feat', () => {
    const h = buildCharacter({ ...fighter, speciesId: 'human', speciesSkills: ['stealth'], speciesFeatId: 'alert' }, db);
    expect(h.skills.stealth).toBe('proficient');
    expect(h.featIds).toContain('alert');
    expect(initiativeModifiers(h as Character).map((m) => m.label)).toContain('Alert');
  });

  it('higher-level builds use average HP and need a subclass', () => {
    expect(validateBuild({ ...fighter, level: 3 }, db)).toContain('Choose a subclass (level 3+)');
    const c = buildCharacter({ ...fighter, level: 3, subclassId: 'champion' }, db);
    expect(c.maxHp).toBe(maxHitPoints([{ hitDie: 'd10', level: 3 }], 15, 1));
    expect(c.maxHp).toBe(13 + 2 * (6 + 2 + 1));
  });
});

describe('validation', () => {
  it('reports every problem', () => {
    const problems = validateBuild(
      {
        ...fighter,
        backgroundBonus: { int: 2, con: 1 },
        classSkills: ['athletics', 'arcana'],
        speciesSkills: ['stealth'],
        weaponMasteries: ['a', 'b', 'c', 'd'],
        baseScores: { ...fighter.baseScores, str: 19 },
      },
      db,
    );
    expect(problems).toEqual(
      expect.arrayContaining([
        "Soldier can't increase int",
        'athletics is already granted by the background',
        'arcana is not a Fighter skill',
        'Dwarf grants no skill choice',
        'Fighter can master 3 weapon(s)',
        'Base str must be 3–18',
      ]),
    );
    expect(() => buildCharacter({ ...fighter, classSkills: [] }, db)).toThrow(BuildError);
  });

  it('requires lineage choices and valid bonus patterns', () => {
    expect(validateBuild({ ...fighter, speciesId: 'dragonborn' }, db)).toContain('Choose a Draconic Ancestry');
    expect(validateBuild({ ...fighter, backgroundBonus: { str: 3 } }, db)).toContain('Background bonus must be +2/+1 or +1/+1/+1');
    expect(validateBuild({ ...fighter, backgroundBonus: { str: 1, dex: 1, con: 1 } }, db)).toEqual([]);
  });
});
