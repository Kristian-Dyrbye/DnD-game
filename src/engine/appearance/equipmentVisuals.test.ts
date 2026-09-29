import { describe, expect, it } from 'vitest';
import { loadSrd } from '../data/srdBundle';
import { equipmentLook, lookKey, visualFor, VISUAL_PARTS } from './equipmentVisuals';

const db = loadSrd();

describe('equipment visuals', () => {
  it('every SRD weapon and the shield get a part (explicit or fallback)', () => {
    for (const w of db.weapons.values()) expect(visualFor(w.id, db), w.id).toBeDefined();
    expect(visualFor('shield', db)).toBe('shield_round');
    expect(visualFor('rope_hempen', db)).toBeUndefined();
    for (const p of [visualFor('longsword', db), visualFor('greataxe', db), visualFor('longbow', db), visualFor('heavy_crossbow', db), visualFor('blowgun', db)]) expect(VISUAL_PARTS).toContain(p);
  });

  it('fallbacks follow the weapon data', () => {
    expect(visualFor('musket', db)).toBe('crossbow_2h'); // ranged + loading + two-handed
    expect(visualFor('pistol', db)).toBe('crossbow_1h');
    expect(visualFor('sling', db)).toBe('bow');
    expect(visualFor('whip', db)).toBe('sword_1h');
  });

  it('magic weapons show their base item', () => {
    const plusOne = [...db.magicItems.values()].find((m) => m.baseItem && db.weapons.has(m.baseItem));
    if (plusOne) expect(visualFor(plusOne.id, db)).toBe(visualFor(plusOne.baseItem!, db));
  });

  it('look: main hand, shield/off hand; two-handed fills both hands; wizards carry the spellbook', () => {
    const inv = (items: [string, string?][]) => ({ inventory: items.map(([itemId, equipped], i) => ({ uid: `u${i}`, itemId, quantity: 1, ...(equipped && { equipped: equipped as 'main_hand' }) })) });
    expect(equipmentLook(inv([['longsword', 'main_hand'], ['shield', 'shield']]), db)).toEqual({ right: 'sword_1h', left: 'shield_round' });
    expect(equipmentLook(inv([['greatsword', 'main_hand'], ['dagger', 'off_hand']]), db)).toEqual({ right: 'sword_2h' });
    expect(equipmentLook(inv([['shortsword', 'main_hand'], ['dagger', 'off_hand']]), db)).toEqual({ right: 'sword_1h', left: 'dagger' });
    expect(equipmentLook(inv([['arcane_focus_wand', 'main_hand'], ['spellbook']]), db)).toEqual({ right: 'wand', left: 'spellbook' });
    expect(equipmentLook(inv([['rope_hempen']]), db)).toEqual({});
    expect(lookKey({ right: 'bow' })).toBe('bow|-');
  });
});
