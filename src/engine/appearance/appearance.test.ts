import { describe, expect, it } from 'vitest';
import { AppearanceSchema, buildWidth, defaultAppearanceFor, sizeScale } from './appearance';

describe('appearance', () => {
  it('fills defaults and validates colors', () => {
    const a = AppearanceSchema.parse({});
    expect(a).toMatchObject({ outfit: 'knight', head: 'knight', build: 'average', showCape: true });
    expect(AppearanceSchema.safeParse({ skinTone: 'pink' }).success).toBe(false);
  });

  it('picks an outfit per class', () => {
    expect(defaultAppearanceFor('wizard').outfit).toBe('mage');
    expect(defaultAppearanceFor('barbarian').outfit).toBe('barbarian');
    expect(defaultAppearanceFor('ranger').head).toBe('rogue_hooded');
    expect(defaultAppearanceFor(undefined).outfit).toBe('knight');
  });

  it('scales by size and build', () => {
    expect(sizeScale('small')).toBeLessThan(1);
    expect(sizeScale('medium')).toBe(1);
    expect(buildWidth('broad')).toBeGreaterThan(buildWidth('slim'));
  });
});
