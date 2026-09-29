import { describe, expect, it } from 'vitest';
import type { Rng } from '../core/rng';
import { CharacterSchema, CreatureSchema, type Character, type Creature } from '../core/creature';
import { loadSrd } from '../data/srdBundle';
import { castSpell, concentrationCheck } from './spellcasting';
import { createEffectContext } from './effects';
import { effectiveSpeed, conditionImmunities } from './conditions';
import { onTurnEvent, tickEffects } from './activeEffects';
import {
  attackedEffectModes,
  breakInvisibility,
  consumeAttackedEffects,
  effectDamageRiders,
  effectSaveAdjustments,
  effectiveAc,
  revertExpiredEffects,
  rollEffectBonuses,
  startOfTurnEffects,
} from './spellHooks';

const db = loadSrd();
const spell = (id: string) => db.spells.get(id)!;
const fixed = (...faces: number[]): Rng => {
  const q = [...faces];
  return { int: (_min: number, max: number) => Math.min(q.shift() ?? 1, max) } as unknown as Rng;
};

function caster(over: Partial<Character> = {}): Character {
  return CharacterSchema.parse({
    id: 'cleric',
    name: 'Mara',
    kind: 'character',
    size: 'medium',
    creatureType: 'humanoid',
    abilities: { str: 10, dex: 14, con: 14, int: 10, wis: 16, cha: 10 },
    proficiencyBonus: 3,
    maxHp: 30,
    hp: 30,
    ac: 12,
    speed: { walk: 30 },
    classes: [{ classId: 'cleric', level: 5 }],
    speciesId: 'human',
    backgroundId: 'acolyte',
    spellcasting: { slots: [4, 3, 2, 0, 0, 0, 0, 0, 0], maxSlots: [4, 3, 2, 0, 0, 0, 0, 0, 0] },
    ...over,
  });
}

const ally = (id: string, over: Partial<Creature> = {}): Creature =>
  CreatureSchema.parse({ id, name: id, kind: 'npc', size: 'medium', creatureType: 'humanoid', abilities: { str: 12, dex: 12, con: 12, int: 10, wis: 10, cha: 10 }, proficiencyBonus: 2, maxHp: 20, hp: 20, ac: 14, speed: { walk: 30 }, ...over });

const cast = (id: string, targets: Creature[], slot = 1, c = caster()) =>
  castSpell({ rng: fixed(), caster: c, spell: spell(id), slot: { kind: 'slot', level: slot }, ability: 'wis', targets, characterLevel: 5 });

describe('buff hooks', () => {
  it('Bless adds 1d4 to attacks and saves; ends with concentration', () => {
    const r = cast('bless', [ally('a'), ally('b')]);
    const a = r.ctx.creatures.get('a')!;
    expect(rollEffectBonuses(a, 'attack', fixed(3))).toEqual([{ value: 3, label: 'Bless' }]);
    expect(rollEffectBonuses(a, 'check', fixed(3))).toEqual([]);
    expect(a.effects[0]).toMatchObject({ key: 'bless', sourceId: 'cleric:bless', roundsLeft: 10 });
    const ctx = createEffectContext({ rng: fixed(), source: ally('orc'), targets: [r.caster, a] });
    concentrationCheck(ctx, 'cleric', 30, fixed(1));
    expect(ctx.creatures.get('a')!.effects).toEqual([]);
  });

  it('Bane subtracts 1d4 on a failed Cha save', () => {
    const r = cast('bane', [ally('orc')]);
    expect(rollEffectBonuses(r.ctx.creatures.get('orc')!, 'save', fixed(2))).toEqual([{ value: -2, label: 'Bane' }]);
  });

  it('Shield +5 AC until the caster next turn; Shield of Faith +2; Mage Armor 13 + Dex', () => {
    const shielded = castSpell({ rng: fixed(), caster: caster(), spell: spell('shield'), slot: { kind: 'slot', level: 1 }, ability: 'wis', targets: [caster()], characterLevel: 5 }).caster;
    expect(effectiveAc(shielded)).toBe(17);
    expect(onTurnEvent([shielded], 'start_of_turn', 'cleric').creatures[0]!.effects).toHaveLength(0);
    const sof = cast('shield_of_faith', [ally('a')]).ctx.creatures.get('a')!;
    expect(effectiveAc(sof)).toBe(16);
    const mage = castSpell({ rng: fixed(), caster: caster(), spell: spell('mage_armor'), slot: { kind: 'slot', level: 1 }, ability: 'wis', targets: [caster()], characterLevel: 5 }).caster;
    expect(effectiveAc(mage)).toBe(13 + 2);
    expect(effectiveAc(mage, true)).toBe(12);
  });

  it('Haste doubles speed, +2 AC, Dex save advantage; Slow halves and −2', () => {
    const fast = cast('haste', [ally('a')], 3).ctx.creatures.get('a')!;
    expect(effectiveSpeed(fast)).toBe(60);
    expect(effectiveAc(fast)).toBe(16);
    expect(effectSaveAdjustments(fast, 'dex').advantage).toEqual(['Haste']);
    const slowed = castSpell({ rng: fixed(1), caster: caster(), spell: spell('slow'), slot: { kind: 'slot', level: 3 }, ability: 'wis', targets: [ally('orc')], characterLevel: 5 }).ctx.creatures.get('orc')!;
    expect(effectiveSpeed(slowed)).toBe(15);
    expect(effectiveAc(slowed)).toBe(12);
    expect(effectSaveAdjustments(slowed, 'dex').modifiers).toEqual([{ value: -2, label: 'Slow' }]);
  });

  it('Heroism: frightened immunity and temp HP each turn', () => {
    const brave = cast('heroism', [ally('a')]).ctx.creatures.get('a')!;
    expect(conditionImmunities(brave).has('frightened')).toBe(true);
    expect(startOfTurnEffects(brave).tempHp).toBe(3);
  });

  it("Hunter's Mark / Hex put a damage rider on the caster against the target", () => {
    const r = cast('hunters_mark', [ally('orc')]);
    expect(effectDamageRiders(r.caster, 'orc', true)).toEqual([{ dice: '1d6', type: 'force' }]);
    expect(effectDamageRiders(r.caster, 'goblin', true)).toEqual([]);
    expect(r.caster.effects[0]!.roundsLeft).toBe(600);
    expect(cast('hunters_mark', [ally('orc')], 3).caster.effects[0]!.roundsLeft).toBe(8 * 600);
  });

  it('Guiding Bolt: next attack against the target has Advantage and is consumed', () => {
    const r = castSpell({ rng: fixed(15, 3, 3, 3, 3), caster: caster(), spell: spell('guiding_bolt'), slot: { kind: 'slot', level: 1 }, ability: 'wis', targets: [ally('orc', { maxHp: 40, hp: 40 })], characterLevel: 5 });
    const orc = r.ctx.creatures.get('orc')!;
    expect(orc.hp).toBe(40 - 12);
    expect(attackedEffectModes(orc).advantage).toEqual(['Guiding Bolt']);
    expect(attackedEffectModes(consumeAttackedEffects(orc)).advantage).toEqual([]);
  });

  it('Faerie Fire and Blur change attacks against the creature', () => {
    const lit = castSpell({ rng: fixed(1), caster: caster(), spell: spell('faerie_fire'), slot: { kind: 'slot', level: 1 }, ability: 'wis', targets: [ally('orc')], characterLevel: 5 }).ctx.creatures.get('orc')!;
    expect(attackedEffectModes(lit).advantage).toEqual(['Faerie Fire']);
    const blurred = castSpell({ rng: fixed(), caster: caster(), spell: spell('blur'), slot: { kind: 'slot', level: 2 }, ability: 'wis', targets: [caster()], characterLevel: 5 }).caster;
    expect(attackedEffectModes(blurred).disadvantage).toEqual(['Blur']);
    expect(attackedEffectModes(blurred, ally('bat', { senses: { blindsight: 60 } })).disadvantage).toEqual([]);
  });

  it('Aid raises max HP (+5 per upcast) and reverts on expiry', () => {
    const aided = cast('aid', [ally('a')], 3).ctx.creatures.get('a')!;
    expect(aided).toMatchObject({ maxHp: 30, hp: 30 });
    const t = tickEffects({ ...aided, effects: aided.effects.map((e) => ({ ...e, roundsLeft: 1 })) });
    expect(revertExpiredEffects(t.creature, t.expired)).toMatchObject({ maxHp: 20, hp: 20 });
  });

  it('False Life upcast, Heal ends conditions, Invisibility breaks', () => {
    const fl = castSpell({ rng: fixed(4, 4), caster: caster(), spell: spell('false_life'), slot: { kind: 'slot', level: 3 }, ability: 'wis', targets: [caster()], characterLevel: 5 }).caster;
    expect(fl.tempHp).toBe(4 + 4 + 4 + 10);
    const inv = cast('invisibility', [ally('a')], 2).ctx.creatures.get('a')!;
    expect(inv.conditions.some((c) => c.condition === 'invisible')).toBe(true);
    expect(breakInvisibility(inv).conditions).toEqual([]);
  });
});
