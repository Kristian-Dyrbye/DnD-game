import { describe, expect, it } from 'vitest';
import { loadSrd } from './srdBundle';

const db = loadSrd();

describe('species data', () => {
  it('has the 9 SRD species', () => {
    expect([...db.species.keys()].sort()).toEqual(['dragonborn', 'dwarf', 'elf', 'gnome', 'goliath', 'halfling', 'human', 'orc', 'tiefling']);
  });

  it('parses size, speed, darkvision and traits', () => {
    expect(db.species.get('goliath')).toMatchObject({ speed: 35, sizes: ['medium'] });
    expect(db.species.get('human')!.sizes).toEqual(['medium', 'small']);
    expect(db.species.get('dwarf')!.darkvision).toBe(120);
    expect(db.species.get('halfling')!.darkvision).toBeUndefined();
    expect(db.species.get('halfling')!.traits.map((t) => t.name)).toContain('Luck');
  });

  it('parses lineages with damage types and spells', () => {
    const dragons = db.species.get('dragonborn')!.lineages!;
    expect(dragons).toHaveLength(10);
    expect(dragons.find((d) => d.id === 'red')!.damageType).toBe('fire');
    expect(db.species.get('elf')!.lineages!.find((l) => l.id === 'high_elf')!.spells).toEqual({ '1': ['prestidigitation'], '3': ['detect_magic'], '5': ['misty_step'] });
    expect(db.species.get('gnome')!.lineages!.find((l) => l.id === 'rock_gnome')!.spells).toEqual({ '1': ['mending', 'prestidigitation'] });
    expect(db.species.get('tiefling')!.lineages!.find((l) => l.id === 'infernal')).toMatchObject({ damageType: 'fire' });
    expect(db.species.get('goliath')!.lineages).toHaveLength(6);
  });
});

describe('background data', () => {
  it('has the 4 SRD backgrounds with origin feats', () => {
    expect([...db.backgrounds.keys()].sort()).toEqual(['acolyte', 'criminal', 'sage', 'soldier']);
    expect(db.backgrounds.get('acolyte')).toMatchObject({ featId: 'magic_initiate', featOption: 'cleric', abilityScores: ['int', 'wis', 'cha'] });
    expect(db.backgrounds.get('soldier')).toMatchObject({ featId: 'savage_attacker', tool: 'choice:gaming_set', skills: ['athletics', 'intimidation'] });
  });

  it('has equipment option A (real items) and B (50 GP)', () => {
    for (const bg of db.backgrounds.values()) {
      expect(bg.equipment.b.cost, bg.id).toBe(5000);
      for (const [id] of bg.equipment.a.items) expect(db.item(id), `${bg.id} → ${id}`).toBeDefined();
    }
    expect(db.backgrounds.get('criminal')!.equipment.a).toMatchObject({ cost: 1600, items: expect.arrayContaining([['dagger', 2]]) });
  });
});
