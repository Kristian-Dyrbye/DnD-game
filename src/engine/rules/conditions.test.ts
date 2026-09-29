import { describe, expect, it } from 'vitest';
import type { Rng } from '../core/rng';
import { CreatureSchema, type Creature } from '../core/creature';
import {
  addExhaustion,
  applyCondition,
  attackModes,
  canAct,
  checkModes,
  conditionImmunities,
  effectiveConditions,
  effectiveSpeed,
  endOfTurnSaves,
  hasCondition,
  initiativeModes,
  isCrawlOnly,
  mayHarm,
  removeCondition,
  removeConditionsFromSource,
  resistsAllDamage,
  saveModes,
  tickConditions,
} from './conditions';
import { skillCheck } from './checks';

function fixed(...faces: number[]): Rng {
  const q = [...faces];
  return { int: () => q.shift() ?? 10 } as unknown as Rng;
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
    maxHp: 10,
    hp: 10,
    ac: 12,
    speed: { walk: 30 },
    ...over,
  });
}

const withCond = (c: Creature, ...conds: Parameters<typeof applyCondition>[1][]) =>
  conds.reduce((acc, ac) => applyCondition(acc, ac).creature, c);

describe('applying and removing conditions', () => {
  it('adds implied conditions (Unconscious → Incapacitated, Prone)', () => {
    const c = withCond(make('a'), { condition: 'unconscious' });
    expect([...effectiveConditions(c)].sort()).toEqual(['incapacitated', 'prone', 'unconscious']);
    expect(hasCondition(c, 'prone')).toBe(true);
    expect(canAct(c)).toBe(false);
  });

  it('leaves the creature Prone when Unconscious ends', () => {
    const c = removeCondition(withCond(make('a'), { condition: 'unconscious' }), 'unconscious');
    expect(c.conditions.map((x) => x.condition)).toEqual(['prone']);
  });

  it('respects condition immunities, including Petrified → Poisoned', () => {
    expect(applyCondition(make('a', { conditionImmunities: ['charmed'] }), { condition: 'charmed' })).toMatchObject({ applied: false, reason: 'immune' });
    const stone = withCond(make('a'), { condition: 'petrified' });
    expect(conditionImmunities(stone).has('poisoned')).toBe(true);
    expect(applyCondition(stone, { condition: 'poisoned' }).applied).toBe(false);
    expect(resistsAllDamage(stone)).toBe(true);
  });

  it('does not duplicate a condition from the same source and keeps the longer duration', () => {
    let c = withCond(make('a'), { condition: 'poisoned', sourceId: 's', roundsLeft: 2 });
    c = applyCondition(c, { condition: 'poisoned', sourceId: 's', roundsLeft: 5 }).creature;
    expect(c.conditions).toEqual([{ condition: 'poisoned', sourceId: 's', roundsLeft: 5 }]);
    c = applyCondition(c, { condition: 'poisoned', sourceId: 's', roundsLeft: 1 }).creature;
    expect(c.conditions[0]!.roundsLeft).toBe(5);
  });

  it('removes everything from one source', () => {
    const c = withCond(make('a'), { condition: 'grappled', sourceId: 'ogre' }, { condition: 'restrained', sourceId: 'ogre' }, { condition: 'poisoned', sourceId: 'spider' });
    expect(removeConditionsFromSource(c, 'ogre').conditions.map((x) => x.condition)).toEqual(['poisoned']);
  });
});

describe('durations and end-of-turn saves', () => {
  it('ticks down and expires timed conditions', () => {
    const c = withCond(make('a'), { condition: 'blinded', roundsLeft: 2 }, { condition: 'prone' });
    const t1 = tickConditions(c);
    expect(t1.expired).toEqual([]);
    const t2 = tickConditions(t1.creature);
    expect(t2.expired).toEqual(['blinded']);
    expect(t2.creature.conditions.map((x) => x.condition)).toEqual(['prone']);
  });

  it('ends a condition on a successful end-of-turn save', () => {
    const c = withCond(make('a'), { condition: 'paralyzed', sourceId: 'hold', endSave: { ability: 'wis', dc: 13 } });
    const fail = endOfTurnSaves(c, fixed(5));
    expect(fail.results[0]!.roll.success).toBe(false);
    expect(hasCondition(fail.creature, 'paralyzed')).toBe(true);
    const pass = endOfTurnSaves(c, fixed(15));
    expect(pass.results[0]!.roll.success).toBe(true);
    expect(hasCondition(pass.creature, 'paralyzed')).toBe(false);
  });
});

describe('attack roll modes', () => {
  const hero = make('hero');
  const orc = make('orc');

  it('Blinded attacker has disadvantage; attacks against Blinded have advantage', () => {
    expect(attackModes({ attacker: withCond(hero, { condition: 'blinded' }), target: orc, distanceFt: 5 }).disadvantage).toEqual(['Blinded (attacker)']);
    expect(attackModes({ attacker: hero, target: withCond(orc, { condition: 'blinded' }), distanceFt: 5 }).advantage).toEqual(['Blinded (target)']);
  });

  it('Prone target: advantage within 5 ft, disadvantage beyond', () => {
    const prone = withCond(orc, { condition: 'prone' });
    expect(attackModes({ attacker: hero, target: prone, distanceFt: 5 }).advantage).toHaveLength(1);
    expect(attackModes({ attacker: hero, target: prone, distanceFt: 30 }).disadvantage).toHaveLength(1);
  });

  it('Paralyzed/Unconscious targets are auto-crit within 5 ft only', () => {
    const para = withCond(orc, { condition: 'paralyzed' });
    expect(attackModes({ attacker: hero, target: para, distanceFt: 5 }).autoCrit).toBe('Paralyzed');
    expect(attackModes({ attacker: hero, target: para, distanceFt: 10 }).autoCrit).toBeUndefined();
    expect(attackModes({ attacker: hero, target: withCond(orc, { condition: 'unconscious' }), distanceFt: 5 }).autoCrit).toBe('Unconscious');
  });

  it('Grappled attacker has disadvantage except against the grappler', () => {
    const grappled = withCond(hero, { condition: 'grappled', sourceId: 'orc' });
    expect(attackModes({ attacker: grappled, target: orc, distanceFt: 5 }).disadvantage).toEqual([]);
    expect(attackModes({ attacker: grappled, target: make('goblin'), distanceFt: 5 }).disadvantage).toHaveLength(1);
  });

  it('Frightened only matters while the source is visible', () => {
    const scared = withCond(hero, { condition: 'frightened', sourceId: 'dragon' });
    expect(attackModes({ attacker: scared, target: orc, distanceFt: 5 }).disadvantage).toHaveLength(1);
    expect(attackModes({ attacker: scared, target: orc, distanceFt: 5, fearSourceVisible: false }).disadvantage).toHaveLength(0);
  });

  it('Invisible attacker has advantage unless the target can see it', () => {
    const invis = withCond(hero, { condition: 'invisible' });
    expect(attackModes({ attacker: invis, target: orc, distanceFt: 5 }).advantage).toHaveLength(1);
    expect(attackModes({ attacker: invis, target: orc, distanceFt: 5, targetSeesInvisible: true }).advantage).toHaveLength(0);
  });
});

describe('checks, saves, initiative, speed', () => {
  it('Poisoned gives disadvantage on checks; Blinded auto-fails sight checks', () => {
    expect(checkModes(withCond(make('a'), { condition: 'poisoned' })).disadvantage).toEqual(['Poisoned']);
    expect(checkModes(withCond(make('a'), { condition: 'blinded' }), { requires: ['sight'] }).autoFail).toBe('Blinded');
    expect(checkModes(withCond(make('a'), { condition: 'blinded' }), { requires: ['hearing'] }).autoFail).toBeUndefined();
  });

  it('feeds modes into a real check', () => {
    const c = withCond(make('a'), { condition: 'poisoned' });
    const r = skillCheck(c, 'stealth', { rng: fixed(15, 3), ...checkModes(c) });
    expect(r.d20.natural).toBe(3);
  });

  it('Stunned auto-fails Str/Dex saves; Restrained has Dex save disadvantage', () => {
    const stunned = withCond(make('a'), { condition: 'stunned' });
    expect(saveModes(stunned, 'dex').autoFail).toBe('Stunned: Dexterity');
    expect(saveModes(stunned, 'wis').autoFail).toBeUndefined();
    expect(saveModes(withCond(make('a'), { condition: 'restrained' }), 'dex').disadvantage).toEqual(['Restrained']);
  });

  it('initiative: Invisible advantage, Incapacitated disadvantage', () => {
    expect(initiativeModes(withCond(make('a'), { condition: 'invisible' })).advantage).toEqual(['Invisible']);
    expect(initiativeModes(withCond(make('a'), { condition: 'stunned' })).disadvantage).toEqual(['Incapacitated']);
  });

  it('speed: 0 when grappled, −5 per exhaustion level, crawl when prone', () => {
    expect(effectiveSpeed(withCond(make('a'), { condition: 'grappled' }))).toBe(0);
    expect(effectiveSpeed(make('a', { exhaustion: 2 }))).toBe(20);
    expect(effectiveSpeed(make('a', { exhaustion: 6 }))).toBe(0);
    expect(isCrawlOnly(withCond(make('a'), { condition: 'prone' }))).toBe(true);
  });

  it('exhaustion stacks and kills at level 6', () => {
    let r = addExhaustion(make('a'), 1);
    expect(r.creature.exhaustion).toBe(1);
    r = applyCondition(r.creature, { condition: 'exhaustion' });
    expect(r.creature.exhaustion).toBe(2);
    r = addExhaustion(r.creature, 5);
    expect(r).toMatchObject({ died: true, creature: { exhaustion: 6 } });
    expect(addExhaustion(make('a', { exhaustion: 1 }), -1).creature.exhaustion).toBe(0);
  });

  it('Charmed creatures cannot harm the charmer', () => {
    const charmed = withCond(make('a'), { condition: 'charmed', sourceId: 'vampire' });
    expect(mayHarm(charmed, 'vampire')).toBe(false);
    expect(mayHarm(charmed, 'goblin')).toBe(true);
  });
});
