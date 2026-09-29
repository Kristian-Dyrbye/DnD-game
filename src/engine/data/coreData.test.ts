import { describe, expect, it } from 'vitest';
import { loadSrd } from './srdBundle';
import { CONDITIONS } from '../rules/basics';

const db = loadSrd();

describe('conditions.json', () => {
  it('has all 15 conditions with text', () => {
    expect([...db.conditions.keys()].sort()).toEqual([...CONDITIONS].sort());
    for (const c of db.conditions.values()) expect(c.text.length, c.id).toBeGreaterThan(40);
  });

  it('encodes key modifiers', () => {
    expect(db.conditions.get('paralyzed')!.modifiers).toMatchObject({ autoFailSaves: ['str', 'dex'], autoCritWithin5ft: true, implies: ['incapacitated'] });
    expect(db.conditions.get('prone')!.modifiers).toMatchObject({ attacksAgainstWithin5ft: 'advantage', attacksAgainstBeyond5ft: 'disadvantage' });
    expect(db.conditions.get('restrained')!.modifiers.saves).toEqual({ dex: 'disadvantage' });
    expect(db.conditions.get('unconscious')!.modifiers.implies).toEqual(['incapacitated', 'prone']);
  });
});

describe('rules-tables.json', () => {
  const t = db.rules;

  it('XP thresholds', () => {
    expect(t.xpByLevel[0]).toBe(0);
    expect(t.xpByLevel[1]).toBe(300);
    expect(t.xpByLevel[19]).toBe(355_000);
  });

  it('spell slots (full, half, pact)', () => {
    expect(t.spellSlotsFull[0]).toEqual([2, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(t.spellSlotsFull[19]).toEqual([4, 3, 3, 3, 3, 2, 2, 1, 1]);
    expect(t.spellSlotsHalf[0]).toEqual([2, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(t.spellSlotsHalf[19]).toEqual([4, 3, 3, 3, 2, 0, 0, 0, 0]);
    expect(t.pactMagic[0]).toEqual([1, 1]);
    expect(t.pactMagic[10]).toEqual([3, 5]);
    expect(t.pactMagic[19]).toEqual([4, 5]);
    expect(t.multiclassSlots).toEqual(t.spellSlotsFull);
  });

  it('XP by CR and encounter budgets', () => {
    const xp = new Map(t.xpByCR);
    expect(xp.get(0.25)).toBe(50);
    expect(xp.get(1)).toBe(200);
    expect(xp.get(30)).toBe(155_000);
    expect(t.xpByCR).toHaveLength(34);
    expect(t.encounterBudget[0]).toEqual([50, 75, 100]);
    expect(t.encounterBudget[19]).toEqual([6400, 13200, 22000]);
  });

  it('typical DCs', () => {
    expect(t.dcByDifficulty).toEqual({ very_easy: 5, easy: 10, medium: 15, hard: 20, very_hard: 25, nearly_impossible: 30 });
  });
});
