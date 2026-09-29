import { describe, expect, it } from 'vitest';
import { loadSrd } from './srdBundle';

const db = loadSrd();

describe('feats data', () => {
  it('has the 17 SRD feats in four categories', () => {
    const count = (c: string) => [...db.feats.values()].filter((f) => f.category === c).length;
    expect(db.feats.size).toBe(17);
    expect([count('origin'), count('general'), count('fighting_style'), count('epic_boon')]).toEqual([4, 2, 4, 7]);
  });

  it('parses prerequisites, repeatability and ability increases', () => {
    expect(db.feats.get('grappler')).toMatchObject({
      prerequisite: { level: 4, anyAbility: true, abilities: [{ ability: 'str', min: 13 }, { ability: 'dex', min: 13 }] },
      abilityIncrease: { abilities: ['str', 'dex'], amount: 1, max: 20 },
    });
    expect(db.feats.get('magic_initiate')!.repeatable).toBe(true);
    expect(db.feats.get('alert')!.repeatable).toBe(false);
    expect(db.feats.get('archery')!.prerequisite!.feature).toBe('fighting_style');
    expect(db.feats.get('boon_of_spell_recall')).toMatchObject({ prerequisite: { level: 19, feature: 'spellcasting' }, abilityIncrease: { abilities: ['int', 'wis', 'cha'], max: 30 } });
  });

  it('backgrounds grant existing origin feats', () => {
    for (const bg of db.backgrounds.values()) {
      expect(db.feats.get(bg.featId)?.category, bg.id).toBe('origin');
    }
  });
});
