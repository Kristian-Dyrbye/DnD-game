import { describe, expect, it } from 'vitest';
import { loadSrd } from './srdBundle';

const db = loadSrd();
const cls = (id: string) => db.classes.get(id)!;

describe('classes data', () => {
  it('has the 12 SRD classes, each with one SRD subclass', () => {
    expect(db.classes.size).toBe(12);
    expect(db.subclasses.size).toBe(12);
    for (const c of db.classes.values()) {
      expect([...db.subclasses.values()].filter((s) => s.classId === c.id), c.id).toHaveLength(1);
    }
  });

  it('core traits', () => {
    expect(cls('barbarian')).toMatchObject({ hitDie: 'd12', saveProficiencies: ['str', 'con'], armorTraining: ['light', 'medium', 'shield'] });
    expect(cls('wizard')).toMatchObject({ hitDie: 'd6', primaryAbilities: ['int'], armorTraining: [] });
    expect(cls('bard').skillChoices).toMatchObject({ count: 3 });
    expect(cls('bard').skillChoices.from).toHaveLength(18);
    expect(cls('rogue').skillChoices.count).toBe(4);
    expect(cls('rogue').weaponProficiencies).toEqual(['simple', 'martial:finesse', 'martial:light']);
    expect(cls('monk').weaponProficiencies).toEqual(['simple', 'martial:light']);
  });

  it('features 1–20 including ASI and Epic Boon', () => {
    for (const c of db.classes.values()) {
      const names = c.features.map((f) => f.name);
      expect(names, c.id).toContain('Ability Score Improvement');
      expect(names, c.id).toContain('Epic Boon');
      expect(c.features.every((f) => f.level >= 1 && f.level <= 20 && f.text.length > 0), c.id).toBe(true);
    }
    expect(cls('fighter').features.find((f) => f.name === 'Action Surge')!.level).toBe(2);
    expect(cls('rogue').features.find((f) => f.name === 'Sneak Attack')!.level).toBe(1);
  });

  it('class table columns', () => {
    expect(cls('barbarian').columns.rages![0]).toBe(2);
    expect(cls('barbarian').columns.rage_damage![19]).toBe(4);
    expect(cls('rogue').columns.sneak_attack![0]).toBe('1d6');
    expect(cls('rogue').columns.sneak_attack![19]).toBe('10d6');
    expect(cls('monk').columns.martial_arts![0]).toBe('1d6');
    expect(cls('monk').columns.focus_points![0]).toBe(0);
    expect(cls('monk').columns.focus_points![1]).toBe(2);
  });

  it('spellcasting progression, cantrips and prepared spells', () => {
    expect(cls('wizard').spellcasting).toMatchObject({ progression: 'full', ability: 'int' });
    expect(cls('wizard').spellcasting.cantripsKnown![0]).toBe(3);
    expect(cls('wizard').spellcasting.preparedSpells![19]).toBe(25);
    expect(cls('paladin').spellcasting).toMatchObject({ progression: 'half', ability: 'cha' });
    expect(cls('paladin').spellcasting.cantripsKnown).toBeUndefined();
    expect(cls('warlock').spellcasting.progression).toBe('pact');
    expect(cls('fighter').spellcasting.progression).toBe('none');
  });

  it('starting equipment resolves to real items', () => {
    for (const c of db.classes.values()) {
      expect(c.startingEquipment.length, c.id).toBeGreaterThanOrEqual(2);
      for (const opt of c.startingEquipment) for (const [id] of opt.items) expect(db.item(id), `${c.id} → ${id}`).toBeDefined();
    }
    expect(cls('fighter').startingEquipment).toHaveLength(3);
    expect(cls('fighter').startingEquipment[2]!.cost).toBe(15500);
  });

  it('multiclass rules', () => {
    expect(cls('fighter').multiclass).toMatchObject({ prerequisites: ['str', 'dex'], anyOf: true });
    expect(cls('monk').multiclass).toMatchObject({ prerequisites: ['dex', 'wis'], anyOf: false, proficienciesGained: [] });
    expect(cls('rogue').multiclass.proficienciesGained).toContain("proficiency with Thieves' Tools");
  });

  it('option lists and subclass spells', () => {
    expect(cls('sorcerer').options.metamagic).toHaveLength(10);
    expect(cls('warlock').options.eldritch_invocation!.find((o) => o.id === 'agonizing_blast')!.prerequisite).toContain('Level 2+');
    expect(db.subclasses.get('life_domain')!.spells!['3']).toEqual(['aid', 'bless', 'cure_wounds', 'lesser_restoration']);
    expect(Object.keys(db.subclasses.get('circle_of_the_land')!.spells!)).toHaveLength(16);
    expect(db.subclasses.get('champion')!.features.map((f) => f.name)).toContain('Improved Critical');
  });
});
