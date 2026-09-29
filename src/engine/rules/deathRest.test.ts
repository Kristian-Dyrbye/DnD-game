import { describe, expect, it } from 'vitest';
import type { Rng } from '../core/rng';
import { CharacterSchema, CreatureSchema, type Character, type Creature } from '../core/creature';
import { applyDamage } from './damage';
import { healFromZero, needsDeathSave, resolveDamageAtZero, rollDeathSave, stabilize } from './death';
import { hasCondition } from './conditions';
import { RestError, hitDicePool, longRest, rechargeResources, shortRest } from './rest';

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
    abilities: { str: 16, dex: 12, con: 14, int: 8, wis: 10, cha: 10 },
    proficiencyBonus: 2,
    maxHp: 20,
    hp: 20,
    ac: 16,
    speed: { walk: 30 },
    classes: [{ classId: 'fighter', level: 3 }],
    speciesId: 'human',
    backgroundId: 'soldier',
    hitDice: { d10: 3 },
    ...over,
  });
}

function goblin(over: Partial<Creature> = {}): Creature {
  return CreatureSchema.parse({
    id: 'gob',
    name: 'Goblin',
    kind: 'monster',
    size: 'small',
    creatureType: 'fey',
    abilities: { str: 8, dex: 15, con: 10, int: 10, wis: 8, cha: 8 },
    proficiencyBonus: 2,
    maxHp: 10,
    hp: 10,
    ac: 15,
    speed: { walk: 30 },
    ...over,
  });
}

function hit<T extends Creature>(c: T, amount: number, crit = false) {
  const { creature, report } = applyDamage(c, [{ amount, type: 'slashing' }]);
  return resolveDamageAtZero(c, creature as T, report, { crit });
}

describe('dropping to 0 HP', () => {
  it('monsters die at 0 HP', () => {
    const r = hit(goblin(), 12);
    expect(r).toMatchObject({ event: 'died', cause: 'monster_at_zero', creature: { dead: true, hp: 0 } });
  });

  it('characters fall unconscious and must make death saves', () => {
    const r = hit(pc({ hp: 5 }), 8);
    expect(r.event).toBe('unconscious');
    expect(hasCondition(r.creature, 'unconscious')).toBe(true);
    expect(needsDeathSave(r.creature)).toBe(true);
  });

  it('massive damage kills outright (SRD example: max 12, 6 HP, 18 damage)', () => {
    const r = hit(pc({ maxHp: 12, hp: 6 }), 18);
    expect(r).toMatchObject({ event: 'died', cause: 'massive_damage' });
  });

  it('damage at 0 HP = 1 failure, 2 on a crit, and ≥ max HP kills', () => {
    const down = pc({ hp: 0 });
    expect(hit(down, 3).creature.deathSaves.failures).toBe(1);
    expect(hit(down, 3, true).creature.deathSaves.failures).toBe(2);
    expect(hit(pc({ hp: 0, deathSaves: { successes: 0, failures: 2, stable: false } }), 1).event).toBe('died');
    expect(hit(down, 20).cause).toBe('massive_damage');
  });

  it('damage ends stability', () => {
    expect(hit(stabilize(pc({ hp: 0 })), 2).creature.deathSaves).toEqual({ successes: 0, failures: 1, stable: false });
  });

  it('temp HP soaking all damage causes nothing', () => {
    expect(hit(pc({ hp: 0, tempHp: 5 }), 3).event).toBe('none');
  });
});

describe('death saving throws', () => {
  const down = pc({ hp: 0, conditions: [{ condition: 'unconscious' }] });

  it('10+ succeeds, 9- fails', () => {
    expect(rollDeathSave(down, fixed(10))).toMatchObject({ outcome: 'success', character: { deathSaves: { successes: 1 } } });
    expect(rollDeathSave(down, fixed(9))).toMatchObject({ outcome: 'failure', character: { deathSaves: { failures: 1 } } });
  });

  it('natural 1 = two failures; natural 20 = regain 1 HP and wake up', () => {
    expect(rollDeathSave(down, fixed(1)).character.deathSaves.failures).toBe(2);
    const up = rollDeathSave(down, fixed(20));
    expect(up.outcome).toBe('revived');
    expect(up.character.hp).toBe(1);
    expect(hasCondition(up.character, 'unconscious')).toBe(false);
    expect(hasCondition(up.character, 'prone')).toBe(true);
  });

  it('three successes → stable; three failures → dead', () => {
    let c = down;
    for (let i = 0; i < 3; i++) c = rollDeathSave(c, fixed(15)).character;
    expect(c.deathSaves.stable).toBe(true);
    expect(needsDeathSave(c)).toBe(false);
    const dying = pc({ hp: 0, deathSaves: { successes: 2, failures: 2, stable: false } });
    expect(rollDeathSave(dying, fixed(4))).toMatchObject({ outcome: 'died', character: { dead: true } });
  });

  it('exhaustion lowers death saves', () => {
    expect(rollDeathSave(pc({ hp: 0, exhaustion: 1 }), fixed(11)).outcome).toBe('failure');
  });

  it('healing at 0 resets death saves and ends Unconscious', () => {
    const hurt = pc({ hp: 0, conditions: [{ condition: 'unconscious' }], deathSaves: { successes: 1, failures: 2, stable: false } });
    const { creature, healed } = healFromZero(hurt, 7);
    expect(healed).toBe(7);
    expect(creature.deathSaves).toEqual({ successes: 0, failures: 0, stable: false });
    expect(hasCondition(creature, 'unconscious')).toBe(false);
    expect(healFromZero(pc({ hp: 0, dead: true }), 5).healed).toBe(0);
  });
});

describe('resting', () => {
  it('short rest spends hit dice (die + Con, min 1) and stops at full HP', () => {
    const { character, rolls } = shortRest(pc({ hp: 5 }), fixed(6, 1, 9), ['d10', 'd10', 'd10']);
    expect(rolls.map((r) => r.healed)).toEqual([8, 3, 4]);
    expect(character.hp).toBe(20);
    expect(character.hitDice.d10).toBe(0);
    const capped = shortRest(pc({ hp: 18 }), fixed(10, 10), ['d10', 'd10']);
    expect(capped.rolls).toHaveLength(1);
    expect(capped.character.hitDice.d10).toBe(2);
  });

  it('short rest needs 1 HP and available dice', () => {
    expect(() => shortRest(pc({ hp: 0 }), fixed(), [])).toThrow(RestError);
    expect(() => shortRest(pc({ hp: 5, hitDice: { d10: 0 } }), fixed(5), ['d10'])).toThrow(/No d10/);
  });

  it('long rest restores HP and all hit dice, drops temp HP, reduces exhaustion', () => {
    const r = longRest(pc({ hp: 3, tempHp: 4, exhaustion: 2, hitDice: { d10: 0 } }), { d10: 3 });
    expect(r).toMatchObject({ hp: 20, tempHp: 0, exhaustion: 1, hitDice: { d10: 3 } });
  });

  it('recharges resources by rest type', () => {
    const res = { rage: { current: 0, max: 3, recharge: 'long' as const }, surge: { current: 0, max: 1, recharge: 'short' as const } };
    expect(shortRest(pc({ resources: res }), fixed()).character.resources).toMatchObject({ rage: { current: 0 }, surge: { current: 1 } });
    expect(longRest(pc({ resources: res }), { d10: 3 }).resources).toMatchObject({ rage: { current: 3 }, surge: { current: 1 } });
    expect(rechargeResources(res, [])).toEqual(res);
  });

  it('builds the hit dice pool for multiclass characters', () => {
    expect(hitDicePool([{ hitDie: 'd10', level: 3 }, { hitDie: 'd8', level: 2 }, { hitDie: 'd10', level: 1 }])).toEqual({ d10: 4, d8: 2 });
  });
});
