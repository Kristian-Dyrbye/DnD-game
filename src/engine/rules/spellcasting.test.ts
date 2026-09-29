import { describe, expect, it } from 'vitest';
import type { Rng } from '../core/rng';
import { CharacterSchema, CreatureSchema, type Character, type Creature } from '../core/creature';
import { loadSrd } from '../data/srdBundle';
import { hasCondition } from './conditions';
import { createEffectContext } from './effects';
import {
  SpellError,
  cantripMultiplier,
  castSpell,
  concentrationCheck,
  concentrationDc,
  pactSlots,
  recoverSlots,
  scaleCantripEffects,
  spellAttackBonus,
  spellSaveDc,
  spellSlots,
} from './spellcasting';

const db = loadSrd();
const tables = db.rules;
const spell = (id: string) => db.spells.get(id)!;

function fixed(...faces: number[]): Rng {
  const q = [...faces];
  return { int: (_min: number, max: number) => Math.min(q.shift() ?? 1, max) } as unknown as Rng;
}

function wizard(over: Partial<Character> = {}): Character {
  return CharacterSchema.parse({
    id: 'wiz',
    name: 'Ilsa',
    kind: 'character',
    size: 'medium',
    creatureType: 'humanoid',
    abilities: { str: 8, dex: 14, con: 12, int: 18, wis: 12, cha: 10 },
    proficiencyBonus: 3,
    maxHp: 30,
    hp: 30,
    ac: 12,
    speed: { walk: 30 },
    saveProficiencies: ['int', 'wis'],
    classes: [{ classId: 'wizard', level: 5 }],
    speciesId: 'elf',
    backgroundId: 'sage',
    spellcasting: { slots: [4, 3, 2, 0, 0, 0, 0, 0, 0], maxSlots: [4, 3, 2, 0, 0, 0, 0, 0, 0] },
    ...over,
  });
}

const orc = (id = 'orc', over: Partial<Creature> = {}): Creature =>
  CreatureSchema.parse({
    id,
    name: id,
    kind: 'monster',
    size: 'medium',
    creatureType: 'humanoid',
    abilities: { str: 16, dex: 12, con: 16, int: 7, wis: 11, cha: 10 },
    proficiencyBonus: 2,
    maxHp: 60,
    hp: 60,
    ac: 13,
    speed: { walk: 30 },
    ...over,
  });

describe('slot tables', () => {
  it('single-class full and half casters', () => {
    expect(spellSlots([{ progression: 'full', level: 5 }], tables)).toEqual([4, 3, 2, 0, 0, 0, 0, 0, 0]);
    expect(spellSlots([{ progression: 'half', level: 5 }], tables)).toEqual([4, 2, 0, 0, 0, 0, 0, 0, 0]);
    expect(spellSlots([{ progression: 'none', level: 10 }], tables)).toEqual(new Array(9).fill(0));
  });

  it('multiclass: full levels + half levels rounded up (SRD example Ranger 4 / Sorcerer 3 = level 5)', () => {
    expect(spellSlots([{ progression: 'half', level: 4 }, { progression: 'full', level: 3 }], tables)).toEqual([4, 3, 2, 0, 0, 0, 0, 0, 0]);
    expect(spellSlots([{ progression: 'half', level: 1 }, { progression: 'full', level: 1 }], tables)).toEqual([3, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(spellSlots([{ progression: 'full', level: 3 }, { progression: 'none', level: 5 }], tables)).toEqual([4, 2, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('pact magic', () => {
    expect(pactSlots(1, tables)).toEqual({ max: 1, level: 1 });
    expect(pactSlots(5, tables)).toEqual({ max: 2, level: 3 });
    expect(pactSlots(0, tables)).toBeUndefined();
  });

  it('save DC and attack bonus', () => {
    expect(spellSaveDc(wizard(), 'int')).toBe(15);
    expect(spellAttackBonus(wizard(), 'int')).toBe(7);
  });

  it('cantrip scaling', () => {
    expect([1, 4, 5, 10, 11, 16, 17, 20].map(cantripMultiplier)).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
    const scaled = scaleCantripEffects(spell('fire_bolt').effects!, 2);
    expect(JSON.stringify(scaled)).toContain('"dice":"2d10"');
  });
});

describe('castSpell', () => {
  it('spends a slot and runs effects (Fireball at level 3)', () => {
    const r = castSpell({ rng: fixed(1, ...new Array(8).fill(4)), caster: wizard(), spell: spell('fireball'), slot: { kind: 'slot', level: 3 }, ability: 'int', targets: [orc()], characterLevel: 5 });
    expect(r.caster.spellcasting!.slots).toEqual([4, 3, 1, 0, 0, 0, 0, 0, 0]);
    expect(r.ctx.creatures.get('orc')!.hp).toBe(60 - 32);
    expect(r.castAtLevel).toBe(3);
  });

  it('refuses low or empty slots and incapacitated casters', () => {
    const base = { rng: fixed(), spell: spell('fireball'), ability: 'int' as const, targets: [orc()], characterLevel: 5 };
    expect(() => castSpell({ ...base, caster: wizard(), slot: { kind: 'slot', level: 2 } })).toThrow(/level 3\+ slot/);
    expect(() => castSpell({ ...base, caster: wizard({ spellcasting: { slots: [4, 3, 0, 0, 0, 0, 0, 0, 0], maxSlots: [4, 3, 2, 0, 0, 0, 0, 0, 0], cantrips: [], prepared: [] } }), slot: { kind: 'slot', level: 3 } })).toThrow(SpellError);
    expect(() => castSpell({ ...base, caster: wizard({ conditions: [{ condition: 'stunned' }] }), slot: { kind: 'slot', level: 3 } })).toThrow(/incapacitated/);
  });

  it('rituals use no slot; non-rituals cannot be ritual-cast', () => {
    const r = castSpell({ rng: fixed(), caster: wizard(), spell: spell('detect_magic'), slot: { kind: 'ritual' }, ability: 'int', targets: [], characterLevel: 5 });
    expect(r.caster.spellcasting!.slots).toEqual([4, 3, 2, 0, 0, 0, 0, 0, 0]);
    expect(() => castSpell({ rng: fixed(), caster: wizard(), spell: spell('fireball'), slot: { kind: 'ritual' }, ability: 'int', targets: [], characterLevel: 5 })).toThrow(/ritual/);
  });

  it('upcasts with a higher slot', () => {
    const r = castSpell({ rng: fixed(8, 6, 6, 6), caster: wizard(), spell: spell('cure_wounds'), slot: { kind: 'slot', level: 2 }, ability: 'int', targets: [orc('ally', { hp: 10 })], characterLevel: 5 });
    expect(r.ctx.creatures.get('ally')!.hp).toBe(10 + 8 + 6 + 6 + 6 + 4); // 4d8 (2d8 + 2d8 upcast) + Int mod
  });

  it('Pact Magic slots cast at the pact level', () => {
    const lock = wizard({ spellcasting: { slots: new Array(9).fill(0), maxSlots: new Array(9).fill(0), pact: { current: 2, max: 2, level: 3 }, cantrips: [], prepared: [] } });
    const r = castSpell({ rng: fixed(1, ...new Array(4).fill(3)), caster: lock, spell: spell('burning_hands'), slot: { kind: 'pact' }, ability: 'cha', targets: [orc()], characterLevel: 5 });
    expect(r.castAtLevel).toBe(3);
    expect(r.caster.spellcasting!.pact!.current).toBe(1);
    expect(r.ctx.log.find((l) => l.kind === 'damage')!.text).toContain('5d6');
  });

  it('scales cantrip damage with character level', () => {
    const r = castSpell({ rng: fixed(15, 5, 5), caster: wizard(), spell: spell('fire_bolt'), slot: { kind: 'cantrip' }, ability: 'int', targets: [orc()], characterLevel: 5 });
    expect(r.ctx.creatures.get('orc')!.hp).toBe(50);
  });
});

describe('concentration', () => {
  const hold = (caster: Character, target: Creature, save = 2) =>
    castSpell({ rng: fixed(save), caster, spell: spell('hold_person'), slot: { kind: 'slot', level: 2 }, ability: 'int', targets: [target], characterLevel: 5 });

  it('records concentration and stamps conditions with the source', () => {
    const r = hold(wizard(), orc());
    expect(r.caster.spellcasting!.concentration).toMatchObject({ spellId: 'hold_person', sourceId: 'wiz:hold_person', targetIds: ['orc'], roundsLeft: 10 });
    expect(hasCondition(r.ctx.creatures.get('orc')!, 'paralyzed')).toBe(true);
  });

  it('a new concentration spell ends the old one and its conditions', () => {
    const first = hold(wizard(), orc('a'));
    const second = castSpell({
      rng: fixed(2),
      caster: first.caster,
      spell: spell('hold_person'),
      slot: { kind: 'slot', level: 2 },
      ability: 'int',
      targets: [first.ctx.creatures.get('a')!, orc('b')],
      characterLevel: 5,
    });
    expect(second.ctx.log.some((l) => l.text.includes('stops concentrating on hold_person'))).toBe(true);
    expect(second.caster.spellcasting!.concentration!.targetIds).toEqual(['a', 'b']);
  });

  it('DC is max(10, half damage) capped at 30', () => {
    expect(concentrationDc(7)).toBe(10);
    expect(concentrationDc(25)).toBe(12);
    expect(concentrationDc(100)).toBe(30);
  });

  it('failing the Con save ends concentration and frees the target', () => {
    const r = hold(wizard(), orc());
    const ctx = createEffectContext({ rng: fixed(), source: orc(), targets: [r.caster, r.ctx.creatures.get('orc')!] });
    const save = concentrationCheck(ctx, 'wiz', 22, fixed(3));
    expect(save!.success).toBe(false);
    expect((ctx.creatures.get('wiz') as Character).spellcasting!.concentration).toBeUndefined();
    expect(hasCondition(ctx.creatures.get('orc')!, 'paralyzed')).toBe(false);
  });

  it('passing keeps concentration', () => {
    const r = hold(wizard(), orc());
    const ctx = createEffectContext({ rng: fixed(), source: orc(), targets: [r.caster, r.ctx.creatures.get('orc')!] });
    expect(concentrationCheck(ctx, 'wiz', 5, fixed(15))!.success).toBe(true);
    expect((ctx.creatures.get('wiz') as Character).spellcasting!.concentration).toBeDefined();
  });

  it('recovers slots on rests', () => {
    const state = { slots: [0, 0, 0, 0, 0, 0, 0, 0, 0], maxSlots: [4, 3, 2, 0, 0, 0, 0, 0, 0], pact: { current: 0, max: 2, level: 3 }, cantrips: [], prepared: [] };
    expect(recoverSlots(state, 'short')).toMatchObject({ slots: [0, 0, 0, 0, 0, 0, 0, 0, 0], pact: { current: 2 } });
    expect(recoverSlots(state, 'long').slots).toEqual([4, 3, 2, 0, 0, 0, 0, 0, 0]);
  });
});
