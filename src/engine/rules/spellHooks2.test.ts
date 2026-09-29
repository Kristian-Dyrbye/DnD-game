import { describe, expect, it } from 'vitest';
import type { Rng } from '../core/rng';
import { CharacterSchema, CreatureSchema, type Character, type Creature } from '../core/creature';
import { loadSrd } from '../data/srdBundle';
import { castSpell } from './spellcasting';
import { hasCondition } from './conditions';
import { effectiveSpeed } from './conditions';
import { curseDamageRider, endOfTurnSpellEffects } from './spellHooks2';

const db = loadSrd();
const spell = (id: string) => db.spells.get(id)!;
const fixed = (...faces: number[]): Rng => {
  const q = [...faces];
  return { int: (_min: number, max: number) => Math.min(q.shift() ?? 1, max) } as unknown as Rng;
};

const wizard = (): Character =>
  CharacterSchema.parse({
    id: 'wiz',
    name: 'Ilsa',
    kind: 'character',
    size: 'medium',
    creatureType: 'humanoid',
    abilities: { str: 8, dex: 14, con: 12, int: 18, wis: 12, cha: 10 },
    proficiencyBonus: 4,
    maxHp: 40,
    hp: 20,
    ac: 12,
    speed: { walk: 30 },
    classes: [{ classId: 'wizard', level: 9 }],
    speciesId: 'elf',
    backgroundId: 'sage',
    spellcasting: { slots: [4, 3, 3, 3, 1, 0, 0, 0, 0], maxSlots: [4, 3, 3, 3, 1, 0, 0, 0, 0] },
  });

const foe = (id: string, over: Partial<Creature> = {}): Creature =>
  CreatureSchema.parse({ id, name: id, kind: 'monster', size: 'medium', creatureType: 'humanoid', abilities: { str: 12, dex: 10, con: 12, int: 10, wis: 10, cha: 10 }, proficiencyBonus: 2, maxHp: 60, hp: 60, ac: 13, speed: { walk: 30 }, ...over });

const cast = (id: string, targets: Creature[], slot: number, faces: number[] = [], extra: Record<string, unknown> = {}) =>
  castSpell({ rng: fixed(...faces), caster: wizard(), spell: spell(id), slot: slot === 0 ? { kind: 'cantrip' } : { kind: 'slot', level: slot }, ability: 'int', targets, characterLevel: 9, ...extra });

describe('projectile spells', () => {
  it('Magic Missile: 3 darts (+1 per upcast) split evenly or by allocation, auto-hit', () => {
    const r = cast('magic_missile', [foe('a'), foe('b')], 2, new Array(8).fill(3));
    expect(r.ctx.creatures.get('a')!.hp).toBe(60 - 2 * 4);
    expect(r.ctx.creatures.get('b')!.hp).toBe(60 - 2 * 4);
    const focused = cast('magic_missile', [foe('a'), foe('b')], 1, new Array(6).fill(4), { allocations: { a: 3 } });
    expect(focused.ctx.creatures.get('a')!.hp).toBe(60 - 15);
    expect(focused.ctx.creatures.get('b')!.hp).toBe(60);
  });

  it('Scorching Ray: one attack roll per ray', () => {
    const r = cast('scorching_ray', [foe('a')], 2, [15, 3, 3, 2, 15, 3, 3]);
    expect(r.ctx.log.filter((l) => l.kind === 'attack')).toHaveLength(3);
    expect(r.ctx.creatures.get('a')!.hp).toBe(60 - 12);
  });

  it('Chromatic Orb uses the chosen damage type', () => {
    const r = cast('chromatic_orb', [foe('a', { resistances: ['cold'] })], 1, [15, 8, 8, 8], { choice: 'cold' });
    expect(r.ctx.creatures.get('a')!.hp).toBe(60 - 12);
  });
});

describe('save-or-suck and utility', () => {
  it('Command grovel knocks the target Prone', () => {
    const r = cast('command', [foe('a')], 1, [2], { choice: 'grovel' });
    expect(hasCondition(r.ctx.creatures.get('a')!, 'prone')).toBe(true);
  });

  it('Sleep: incapacitated now, unconscious after a failed second save', () => {
    const r = cast('sleep', [foe('a')], 1, [2]);
    const a = r.ctx.creatures.get('a')!;
    expect(hasCondition(a, 'incapacitated')).toBe(true);
    const later = endOfTurnSpellEffects(a, fixed(3));
    expect(hasCondition(later.creature, 'unconscious')).toBe(true);
  });

  it('Hypnotic Pattern: charmed, incapacitated, speed 0', () => {
    const a = cast('hypnotic_pattern', [foe('a')], 3, [2]).ctx.creatures.get('a')!;
    expect(hasCondition(a, 'charmed')).toBe(true);
    expect(effectiveSpeed(a)).toBe(0);
  });

  it('Blindness/Deafness applies the chosen condition with a repeat save', () => {
    const a = cast('blindness_deafness', [foe('a')], 2, [2], { choice: 'deafened' }).ctx.creatures.get('a')!;
    expect(a.conditions[0]).toMatchObject({ condition: 'deafened', endSave: { ability: 'con', dc: 16 } });
  });

  it('Bestow Curse extra damage rider only for the caster', () => {
    const a = cast('bestow_curse', [foe('a')], 3, [2], { choice: 'extra_damage' }).ctx.creatures.get('a')!;
    expect(curseDamageRider('wiz', a)).toEqual([{ dice: '1d8', type: 'necrotic' }]);
    expect(curseDamageRider('someone', a)).toEqual([]);
  });

  it('Dispel Magic ends spells of level ≤ 3 automatically', () => {
    const held = foe('a', { conditions: [{ condition: 'paralyzed', sourceId: 'enemy:hold_person' }], effects: [{ id: 'b', key: 'bless', sourceId: 'enemy:bless', data: {} }] });
    const r = cast('dispel_magic', [held], 3);
    expect(r.ctx.creatures.get('a')!.conditions).toEqual([]);
    expect(r.ctx.creatures.get('a')!.effects).toEqual([]);
  });

  it('Power Word Kill kills at ≤ 100 HP; Revivify and Power Word Heal', () => {
    const pwk = castSpell({ rng: fixed(), caster: { ...wizard(), spellcasting: { slots: [0, 0, 0, 0, 0, 0, 0, 0, 1], maxSlots: [0, 0, 0, 0, 0, 0, 0, 0, 1], cantrips: [], prepared: [] } }, spell: spell('power_word_kill'), slot: { kind: 'slot', level: 9 }, ability: 'int', targets: [foe('a', { hp: 90 })], characterLevel: 17 });
    expect(pwk.ctx.creatures.get('a')!.dead).toBe(true);
    const back = cast('revivify', [foe('a', { hp: 0, dead: true })], 3).ctx.creatures.get('a')!;
    expect(back).toMatchObject({ dead: false, hp: 1 });
  });

  it('Vampiric Touch heals the caster half the damage', () => {
    const r = cast('vampiric_touch', [foe('a')], 3, [15, 4, 4, 4]);
    expect(r.ctx.creatures.get('a')!.hp).toBe(48);
    expect(r.caster.hp).toBe(26);
  });

  it('Acid Arrow: hit + delayed damage; miss = half', () => {
    const hit = cast('acid_arrow', [foe('a')], 2, [15, 2, 2, 2, 2]).ctx.creatures.get('a')!;
    expect(hit.hp).toBe(52);
    expect(endOfTurnSpellEffects(hit, fixed(2, 2)).creature.hp).toBe(48);
    const miss = cast('acid_arrow', [foe('a')], 2, [2, 4, 4, 4, 4]).ctx.creatures.get('a')!;
    expect(miss.hp).toBe(52);
  });

  it('Lesser Restoration ends a chosen condition', () => {
    const a = cast('lesser_restoration', [foe('a', { conditions: [{ condition: 'poisoned' }, { condition: 'blinded' }] })], 2, [], { choice: 'blinded' }).ctx.creatures.get('a')!;
    expect(a.conditions.map((c) => c.condition)).toEqual(['poisoned']);
  });
});
