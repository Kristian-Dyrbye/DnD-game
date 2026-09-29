import { describe, expect, it } from 'vitest';
import { CharacterSchema, CreatureSchema, type Character, type Creature } from '../core/creature';
import { Rng } from '../core/rng';
import { applyCondition } from '../rules/conditions';
import { compareInitiative, initiativeBonus, initiativeRollModes, rollInitiative, rollInitiativeOrder, toEntries } from './initiative';

/** Rng stub returning queued d20 faces (then 10). */
function fixed(...faces: number[]): Rng {
  const q = [...faces];
  return { int: () => q.shift() ?? 10 } as unknown as Rng;
}

function pc(over: Partial<Character> = {}): Character {
  return CharacterSchema.parse({
    id: 'hero',
    name: 'Brenna',
    kind: 'character',
    size: 'medium',
    creatureType: 'humanoid',
    abilities: { str: 16, dex: 14, con: 14, int: 8, wis: 10, cha: 10 },
    proficiencyBonus: 2,
    maxHp: 20,
    hp: 20,
    ac: 16,
    speed: { walk: 30 },
    classes: [{ classId: 'fighter', level: 3 }],
    speciesId: 'human',
    backgroundId: 'soldier',
    ...over,
  });
}

function mon(over: Partial<Creature> = {}): Creature {
  return CreatureSchema.parse({
    id: 'gob',
    name: 'Goblin',
    kind: 'monster',
    size: 'small',
    creatureType: 'humanoid',
    abilities: { str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 },
    proficiencyBonus: 2,
    maxHp: 7,
    hp: 7,
    ac: 15,
    speed: { walk: 30 },
    ...over,
  });
}

describe('initiative modifiers and modes', () => {
  it('characters: Dex (+ Alert); monsters: printed stat block Initiative, else Dex', () => {
    expect(initiativeBonus(pc())).toEqual([{ value: 2, label: 'Dexterity' }]);
    expect(initiativeBonus(pc({ featIds: ['alert'] })).map((m) => m.value)).toEqual([2, 2]);
    expect(initiativeBonus(mon({ statBlockId: 'goblin_warrior' }))).toEqual([{ value: 2, label: 'Initiative' }]);
    expect(initiativeBonus(mon({ abilities: { str: 8, dex: 18, con: 10, int: 10, wis: 8, cha: 8 } }))).toEqual([{ value: 4, label: 'Dexterity' }]);
  });

  it('Invisible → advantage, Incapacitated → disadvantage, surprise → disadvantage', () => {
    const inv = applyCondition(mon(), { condition: 'invisible' }).creature;
    expect(initiativeRollModes(inv).advantage).toContain('Invisible');
    const inc = applyCondition(mon(), { condition: 'incapacitated' }).creature;
    expect(initiativeRollModes(inc).disadvantage).toContain('Incapacitated');
    expect(initiativeRollModes(mon(), { surprised: true }).disadvantage).toEqual(['Surprised']);
  });

  it('feature advantage (Feral Instinct, Barbarian 7)', () => {
    const barb = pc({ classes: [{ classId: 'barbarian', level: 7 }] });
    expect(initiativeRollModes(barb).advantage).toContain('Feral Instinct');
    const r = rollInitiative({ creature: barb, side: 'party' }, { rng: fixed(4, 17) });
    expect(r.roll.mode).toBe('advantage');
    expect(r.initiative).toBe(19);
    expect(r.text).toMatch(/Brenna initiative: d20 \(adv: 4, 17 → 17\) \+ 2 \(Dexterity\) = 19 \[adv: Feral Instinct\]/);
  });

  it('surprised roll takes the lower die', () => {
    const r = rollInitiative({ creature: mon(), side: 'enemy', surprised: true }, { rng: fixed(15, 3) });
    expect(r.roll.mode).toBe('disadvantage');
    expect(r.initiative).toBe(5);
  });

  it('Exhaustion subtracts 2 per level', () => {
    const r = rollInitiative({ creature: mon({ exhaustion: 1 }), side: 'enemy' }, { rng: fixed(10) });
    expect(r.initiative).toBe(10);
  });
});

describe('initiative order', () => {
  it('is deterministic with a seeded Rng', () => {
    const ps = [
      { creature: pc(), side: 'party' as const },
      { creature: mon({ id: 'g1' }), side: 'enemy' as const },
      { creature: mon({ id: 'g2' }), side: 'enemy' as const },
    ];
    const a = rollInitiativeOrder(ps, { rng: Rng.fromSeed('init') });
    const b = rollInitiativeOrder(ps, { rng: Rng.fromSeed('init') });
    expect(a.map((r) => [r.id, r.initiative])).toEqual(b.map((r) => [r.id, r.initiative]));
    for (let i = 1; i < a.length; i++) expect(a[i - 1]!.initiative).toBeGreaterThanOrEqual(a[i]!.initiative);
  });

  it('ties: higher Dex modifier, then party first, then id', () => {
    const fast = mon({ id: 'z', abilities: { str: 8, dex: 18, con: 10, int: 10, wis: 8, cha: 8 } });
    // hero d20 14 + 2 = 16; fast 12 + 4 = 16; gob b 14 + 2 = 16; gob a 14 + 2 = 16
    const order = rollInitiativeOrder(
      [
        { creature: mon({ id: 'b' }), side: 'enemy' },
        { creature: pc(), side: 'party' },
        { creature: fast, side: 'enemy' },
        { creature: mon({ id: 'a' }), side: 'enemy' },
      ],
      { rng: fixed(14, 14, 12, 14) },
    );
    expect(order.map((r) => r.initiative)).toEqual([16, 16, 16, 16]);
    expect(order.map((r) => r.id)).toEqual(['z', 'hero', 'a', 'b']);
    expect(compareInitiative(order[0]!, order[1]!)).toBeLessThan(0);
  });

  it('groups share one roll', () => {
    const order = rollInitiativeOrder(
      [
        { creature: mon({ id: 'g1' }), side: 'enemy', group: 'goblins' },
        { creature: mon({ id: 'g2' }), side: 'enemy', group: 'goblins' },
        { creature: pc(), side: 'party' },
      ],
      { rng: fixed(5, 18) },
    );
    expect(order.map((r) => r.id)).toEqual(['hero', 'g1', 'g2']);
    expect(order[1]!.initiative).toBe(7);
    expect(order[2]!.initiative).toBe(7);
    expect(order[2]!.sharedRoll).toBe(true);
    expect(toEntries(order)[1]).toEqual({ id: 'g1', side: 'enemy', initiative: 7, dexMod: 2, group: 'goblins' });
  });
});
