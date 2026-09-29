/**
 * Tests for the hand-written spell effects in data/srd/overrides/spells.json (A034a):
 * overrides validate and are applied to spells.json, core-kind spells behave correctly through
 * executeEffects, and every hook is well-named and carries its numbers as params.
 */
import { describe, expect, it } from 'vitest';
import type { Rng } from '../core/rng';
import { CreatureSchema, type Creature } from '../core/creature';
import type { Effect } from '../data/common';
import { loadSrd } from '../data/srdBundle';
import spellsJson from '../../../data/srd/spells.json';
import overridesJson from '../../../data/srd/overrides/spells.json';
import { createEffectContext, executeEffects } from './effects';
import { hasCondition } from './conditions';

/** Fixed dice: returns faces in order (d20s and damage dice share the queue). */
function fixed(...faces: number[]): Rng {
  const q = [...faces];
  return { int: (_min: number, max: number) => Math.min(q.shift() ?? 1, max) } as unknown as Rng;
}

function make(id: string, over: Partial<Creature> = {}): Creature {
  return CreatureSchema.parse({
    id,
    name: id,
    kind: 'monster',
    size: 'medium',
    creatureType: 'humanoid',
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    proficiencyBonus: 2,
    maxHp: 40,
    hp: 40,
    ac: 13,
    speed: { walk: 30 },
    ...over,
  });
}

const spell = (id: string) => loadSrd().spells.get(id)!;
const caster = make('caster', { kind: 'character' as never });

interface RawSpell {
  id: string;
  effects?: unknown[];
}
const overrides = overridesJson as unknown as RawSpell[];

function walk(effects: Effect[], visit: (e: Effect) => void): void {
  for (const e of effects) {
    visit(e);
    if (e.kind === 'save') {
      walk(e.onFail, visit);
      if (Array.isArray(e.onSuccess)) walk(e.onSuccess, visit);
    } else if (e.kind === 'attack') walk(e.onHit, visit);
    else if (e.kind === 'area') walk(e.effects, visit);
  }
}

describe('spell overrides', () => {
  it('all SRD data (incl. spell overrides) validates', () => {
    expect(loadSrd().errors).toEqual([]);
  });

  it('overrides are sorted, unique, and applied to spells.json', () => {
    const ids = overrides.map((o) => o.id);
    expect(ids).toEqual([...ids].sort());
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(40);
    for (const o of overrides) {
      const s = spell(o.id);
      expect(s, o.id).toBeDefined();
      expect(s.effects, o.id).toEqual(o.effects);
    }
  });

  it('every hook name is snake_case and carries non-empty params', () => {
    const hooks: { spell: string; hook: string; params?: Record<string, unknown> }[] = [];
    for (const s of loadSrd().spells.values()) {
      walk(s.effects ?? [], (e) => {
        if (e.kind === 'hook') hooks.push({ spell: s.id, hook: e.hook, ...(e.params && { params: e.params }) });
      });
    }
    expect(hooks.length).toBeGreaterThan(30);
    for (const h of hooks) {
      expect(h.hook, h.spell).toMatch(/^[a-z0-9_]+$/);
      // Every hooked spell in the SRD has numbers or options worth capturing.
      expect(h.params && Object.keys(h.params).length > 0, `${h.spell} hook params`).toBe(true);
    }
    // Override hooks are named after their spell.
    const overrideIds = new Set(overrides.map((o) => o.id));
    for (const h of hooks) if (overrideIds.has(h.spell)) expect(h.hook).toBe(h.spell);
  });

  it('raw spells.json matches the loaded database (regenerated after overrides)', () => {
    const raw = spellsJson as unknown as RawSpell[];
    const mm = raw.find((s) => s.id === 'magic_missile')!;
    expect(mm.effects).toEqual([
      { kind: 'hook', hook: 'magic_missile', params: { darts: 3, dartsPerUpcast: 1, autoHit: true, damage: { dice: '1d4+1', type: 'force' } } },
    ]);
  });
});

describe('core-kind spell behaviour', () => {
  it('Guiding Bolt: 4d6 radiant on a hit plus the advantage rider hook', () => {
    const ctx = createEffectContext({ rng: fixed(15, 3, 3, 3, 3), source: caster, targets: [make('a')], attackBonus: 5 });
    executeEffects(spell('guiding_bolt').effects!, ['a'], ctx);
    expect(ctx.creatures.get('a')!.hp).toBe(28);
    expect(ctx.log.some((l) => l.kind === 'hook' && l.text.includes('guiding_bolt'))).toBe(true);
    const miss = createEffectContext({ rng: fixed(2), source: caster, targets: [make('a')], attackBonus: 5 });
    executeEffects(spell('guiding_bolt').effects!, ['a'], miss);
    expect(miss.creatures.get('a')!.hp).toBe(40);
    expect(miss.log.some((l) => l.kind === 'hook')).toBe(false);
  });

  it('Ice Storm: bludgeoning + cold, shared roll, halved per type on a success', () => {
    // a fails (5): 2d10 = 5+5, 4d6 = 3+3+3+3 → 10 + 12 = 22; b succeeds (18) → 5 + 6 = 11
    const ctx = createEffectContext({ rng: fixed(5, 5, 5, 3, 3, 3, 3, 18), source: caster, targets: [make('a'), make('b')], saveDc: 15 });
    executeEffects(spell('ice_storm').effects!, ['a', 'b'], ctx);
    expect(ctx.creatures.get('a')!.hp).toBe(40 - 22);
    expect(ctx.creatures.get('b')!.hp).toBe(40 - 11);
    const dmgLog = ctx.log.find((l) => l.kind === 'damage')!.text;
    expect(dmgLog).toMatch(/bludgeoning/i);
    expect(dmgLog).toMatch(/cold/i);
  });

  it('Ice Storm upcast adds 1d10 bludgeoning per level', () => {
    const ctx = createEffectContext({ rng: fixed(1, 1, 1, 1, 1, 1, 1, 1), source: caster, targets: [make('a')], saveDc: 15, upcastLevels: 1 });
    executeEffects(spell('ice_storm').effects!, ['a'], ctx);
    expect(ctx.log.find((l) => l.kind === 'damage')!.text).toContain('3d10');
  });

  it('Flame Strike: fire and radiant both upcast', () => {
    const ctx = createEffectContext({ rng: fixed(2, ...new Array(14).fill(1)), source: caster, targets: [make('a')], saveDc: 15, upcastLevels: 2 });
    executeEffects(spell('flame_strike').effects!, ['a'], ctx);
    expect(ctx.creatures.get('a')!.hp).toBe(40 - 14);
  });

  it('Heal restores 70 HP (+10 per slot level above 6)', () => {
    const ctx = createEffectContext({ rng: fixed(), source: caster, targets: [make('a', { maxHp: 120, hp: 5 })] });
    executeEffects(spell('heal').effects!, ['a'], ctx);
    expect(ctx.creatures.get('a')!.hp).toBe(75);
    const up = createEffectContext({ rng: fixed(), source: caster, targets: [make('a', { maxHp: 120, hp: 5 })], upcastLevels: 2 });
    executeEffects(spell('heal').effects!, ['a'], up);
    expect(up.creatures.get('a')!.hp).toBe(95);
  });

  it('False Life grants 2d4 + 4 temporary HP', () => {
    const ctx = createEffectContext({ rng: fixed(2, 3), source: caster, targets: [] });
    executeEffects(spell('false_life').effects!, ['caster'], ctx);
    expect(ctx.creatures.get('caster')!.tempHp).toBe(9);
  });

  it('Web restrains on a failed save and no longer deals fire damage on cast', () => {
    const ctx = createEffectContext({ rng: fixed(3), source: caster, targets: [make('a')], saveDc: 14 });
    executeEffects(spell('web').effects!, ['a'], ctx);
    const a = ctx.creatures.get('a')!;
    expect(hasCondition(a, 'restrained')).toBe(true);
    expect(a.hp).toBe(40);
  });

  it('Hideous Laughter: Prone and Incapacitated on a failed save', () => {
    const ctx = createEffectContext({ rng: fixed(4), source: caster, targets: [make('a')], saveDc: 14 });
    executeEffects(spell('hideous_laughter').effects!, ['a'], ctx);
    const a = ctx.creatures.get('a')!;
    expect(hasCondition(a, 'prone')).toBe(true);
    expect(hasCondition(a, 'incapacitated')).toBe(true);
  });

  it('Divine Smite deals 2d8 radiant, +1d8 per upcast level', () => {
    const ctx = createEffectContext({ rng: fixed(4, 4, 4), source: caster, targets: [make('a')], upcastLevels: 1 });
    executeEffects(spell('divine_smite').effects!, ['a'], ctx);
    expect(ctx.creatures.get('a')!.hp).toBe(28);
  });

  it('Command no longer auto-applies Prone (the grovel option is a hook choice)', () => {
    const ctx = createEffectContext({ rng: fixed(2), source: caster, targets: [make('a')], saveDc: 14 });
    executeEffects(spell('command').effects!, ['a'], ctx);
    expect(hasCondition(ctx.creatures.get('a')!, 'prone')).toBe(false);
    expect(ctx.log.some((l) => l.kind === 'hook' && l.text.includes('command'))).toBe(true);
  });
});
