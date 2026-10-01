import { describe, expect, it } from 'vitest';
import { CharacterSchema, type Character, type Creature } from '../core/creature';
import { Rng } from '../core/rng';
import { loadSrd } from '../data/srdBundle';
import { addEffect } from '../rules/activeEffects';
import { monsterToCreature } from '../rules/monsters';
import { attackSlots, executePlan, planTurn, takeAiTurn, type AiPlan } from './ai';
import { hitChance, isFearless, moraleCheck, rankTargets } from './aiScore';
import type { CombatContext, CombatState } from './combatState';
import { cellKey, createGrid, distanceFt, placeToken, setCell } from './grid';
import { hasLineOfSight } from './los';
import { reachableSquares } from './movement';
import { currentId, livingSides, nextTurn, startCombat } from './turns';

const db = loadSrd();

function hero(id: string, over: Partial<Character> = {}): Character {
  return CharacterSchema.parse({
    id,
    name: id,
    kind: 'character',
    size: 'medium',
    creatureType: 'humanoid',
    abilities: { str: 16, dex: 14, con: 14, int: 8, wis: 10, cha: 10 },
    proficiencyBonus: 2,
    maxHp: 30,
    hp: 30,
    ac: 16,
    speed: { walk: 30 },
    classes: [{ classId: 'fighter', level: 3 }],
    speciesId: 'human',
    backgroundId: 'soldier',
    proficiencies: { weapons: ['simple', 'martial'] },
    inventory: [{ uid: 'ls', itemId: 'longsword', quantity: 1, equipped: 'main_hand' }],
    ...over,
  });
}

const mon = (statId: string, id: string, over: Partial<Creature> = {}): Creature => ({ ...monsterToCreature(db.monsters.get(statId)!, id, id), ...over });

interface Placed {
  c: Creature;
  side: 'party' | 'enemy';
  x: number;
  y: number;
}

function setup(list: Placed[], turnOf: string, size = 20): CombatState {
  const grid = createGrid(size, size);
  for (const p of list) placeToken(grid, { id: p.c.id, x: p.x, y: p.y, size: p.c.size });
  const turns = startCombat(list.map((p, i) => ({ id: p.c.id, side: p.side, initiative: 20 - i, dexMod: 0 })));
  const idx = turns.order.findIndex((e) => e.id === turnOf);
  return { grid, turns: { ...turns, round: 1, currentIndex: idx, turnActive: true }, creatures: Object.fromEntries(list.map((p) => [p.c.id, p.c])) };
}

const ctx = (seed: number | string = 1): CombatContext => ({ rng: Rng.fromSeed(seed), db });
const attacks = (plan: AiPlan) => plan.steps.filter((s) => s.kind === 'attack');
const noMovement = (s: CombatState, id: string, ft: number): CombatState => ({
  ...s,
  turns: { ...s.turns, budgets: { ...s.turns.budgets, [id]: { ...s.turns.budgets[id]!, movementSpentFt: ft } } },
});

describe('scoring helpers', () => {
  it('hit chance clamps to 5%/95% and squares for advantage/disadvantage', () => {
    expect(hitChance(5, 15)).toBeCloseTo(0.55);
    expect(hitChance(0, 30)).toBeCloseTo(0.05);
    expect(hitChance(20, 5)).toBeCloseTo(0.95);
    expect(hitChance(5, 15, 'advantage')).toBeCloseTo(1 - 0.45 * 0.45);
    expect(hitChance(5, 15, 'disadvantage')).toBeCloseTo(0.55 * 0.55);
  });

  it('beasts rank by distance, others by weakness; smart ones prefer casters and avoid Dodgers', () => {
    const near = { id: 'near', creature: hero('near', { hp: 30 }), distanceFt: 5 };
    const weak = { id: 'weak', creature: hero('weak', { hp: 6 }), distanceFt: 20 };
    const caster = {
      id: 'caster',
      creature: hero('caster', { hp: 20, spellcasting: { slots: [2, 0, 0, 0, 0, 0, 0, 0, 0], maxSlots: [2, 0, 0, 0, 0, 0, 0, 0, 0], cantrips: ['fire_bolt'], prepared: [], concentration: { spellId: 'bless', sourceId: 'x', targetIds: [] } } }),
      distanceFt: 30,
    };
    expect(rankTargets(mon('wolf', 'w'), [weak, near], { db })[0]!.id).toBe('near');
    expect(rankTargets(mon('ogre', 'o'), [near, weak, caster], { db })[0]!.id).toBe('weak');
    expect(rankTargets(mon('goblin_warrior', 'g'), [near, weak, caster], { db })[0]!.id).toBe('caster');
    const dodger = { ...weak, creature: addEffect(weak.creature, { key: 'dodge', sourceId: 'weak' }) };
    expect(rankTargets(mon('bandit', 'b'), [near, dodger], { db })[0]!.id).toBe('near');
  });

  it('Multiattack slots follow the stat block; "any combination" mixes attacks', () => {
    expect(attackSlots(mon('hell_hound', 'h'), ctx()).map((s) => s.map((p) => p.name))).toEqual([['Bite'], ['Bite']]);
    const captain = attackSlots(mon('bandit_captain', 'c'), ctx());
    expect(captain).toHaveLength(2);
    expect(captain[0]!.map((p) => p.name).sort()).toEqual(['Pistol', 'Scimitar']);
  });
});

describe('planTurn: targeting and movement', () => {
  it('melee monster closes in and attacks the weakest hostile in reach', () => {
    const s = setup(
      [
        { c: mon('ogre', 'ogre'), side: 'enemy', x: 5, y: 5 },
        { c: hero('tough'), side: 'party', x: 9, y: 5 },
        { c: hero('hurt', { hp: 7 }), side: 'party', x: 9, y: 9 },
      ],
      'ogre',
    );
    const plan = planTurn(s, ctx(), 'ogre');
    expect(plan.intent).toBe('attack');
    expect(plan.targetId).toBe('hurt');
    const move = plan.steps.find((x) => x.kind === 'move');
    expect(move).toBeDefined();
    expect(attacks(plan)).toHaveLength(1);
    const r = takeAiTurn(s, ctx(), 'ogre');
    expect(r.ok).toBe(true);
    expect(distanceFt(r.state.grid.tokens.ogre!, r.state.grid.tokens.hurt!)).toBe(5);
    expect(r.events.some((e) => e.kind === 'attack' && e.targetId === 'hurt')).toBe(true);
  });

  it('a beast attacks the closest hostile, not the weakest', () => {
    const s = setup(
      [
        { c: mon('wolf', 'wolf'), side: 'enemy', x: 0, y: 0 },
        { c: hero('close'), side: 'party', x: 3, y: 0 },
        { c: hero('weak', { hp: 3 }), side: 'party', x: 6, y: 1 },
      ],
      'wolf',
    );
    const plan = planTurn(s, ctx(), 'wolf');
    expect(plan.intent).toBe('attack');
    expect(plan.targetId).toBe('close');
  });

  it('a ranged monster stays at range and shoots', () => {
    const s = setup(
      [
        { c: mon('skeleton', 'sk'), side: 'enemy', x: 0, y: 0 },
        { c: hero('h'), side: 'party', x: 10, y: 0 },
      ],
      'sk',
    );
    const plan = planTurn(s, ctx(), 'sk');
    expect(plan.intent).toBe('attack');
    expect(plan.steps).toEqual([{ kind: 'attack', profileId: 'monster:Shortbow', targetId: 'h' }]);
  });

  it('a goblin archer adjacent to an enemy uses Nimble Escape to step back and shoot', () => {
    const s = setup(
      [
        { c: mon('goblin_warrior', 'gob'), side: 'enemy', x: 5, y: 5 },
        { c: hero('h'), side: 'party', x: 6, y: 5 },
      ],
      'gob',
    );
    const plan = planTurn(s, ctx(), 'gob');
    expect(plan.steps[0]).toEqual({ kind: 'disengage', bonus: true });
    expect(plan.steps[1]!.kind).toBe('move');
    expect(plan.steps[2]).toMatchObject({ kind: 'attack', profileId: 'monster:Shortbow', targetId: 'h' });
    const r = takeAiTurn(s, ctx(), 'gob');
    expect(r.ok).toBe(true);
    expect(distanceFt(r.state.grid.tokens.gob!, r.state.grid.tokens.h!)).toBeGreaterThan(5);
    expect(r.events.some((e) => e.text.includes('Opportunity Attack'))).toBe(false);
    expect(r.state.turns.budgets.gob!.bonusAction).toBe(false);
  });

  it('out of reach: Dashes toward the target', () => {
    const s = setup(
      [
        { c: mon('zombie', 'z'), side: 'enemy', x: 0, y: 0 },
        { c: hero('h'), side: 'party', x: 15, y: 0 },
      ],
      'z',
    );
    const plan = planTurn(s, ctx(), 'z');
    expect(plan.intent).toBe('approach');
    expect(plan.steps[0]).toEqual({ kind: 'dash' });
    const r = takeAiTurn(s, ctx(), 'z');
    expect(r.state.grid.tokens.z!.x).toBe(8);
  });

  // B008: a foe behind a wall had no square "closer" in a straight line and Dodged forever.
  const behindWall = (statId: string) => {
    const s = setup(
      [
        { c: mon(statId, 'm'), side: 'enemy', x: 4, y: 5 },
        { c: hero('h'), side: 'party', x: 6, y: 5 },
      ],
      'm',
    );
    for (let y = 0; y <= 12; y++) setCell(s.grid, { x: 5, y }, { blocking: true });
    return s;
  };
  const walkToHero = (s: CombatState, id: string) => {
    const map = reachableSquares(s.grid, 'h', 1000, { ignore: [id] });
    return map.get(cellKey(s.grid.tokens[id]!))!.costFt;
  };

  it('melee foe behind a wall walks around it instead of Dodging', () => {
    const s = behindWall('zombie');
    const plan = planTurn(s, ctx(), 'm');
    expect(plan.intent).toBe('approach');
    expect(plan.steps.some((x) => x.kind === 'dodge')).toBe(false);
    const r = takeAiTurn(s, ctx(), 'm');
    expect(r.ok).toBe(true);
    expect(walkToHero(r.state, 'm')).toBeLessThan(walkToHero(s, 'm'));
  });

  it('ranged foe behind a wall walks to a square with line of sight', () => {
    const s = behindWall('goblin_warrior');
    expect(planTurn(s, ctx(), 'm').intent).toBe('approach');
    const r = takeAiTurn(s, ctx(), 'm');
    expect(hasLineOfSight(r.state.grid, 'm', 'h')).toBe(true);
  });
});

describe('planTurn: abilities', () => {
  const breathSetup = (withAlly: boolean) =>
    noMovement(
      setup(
        [
          { c: mon('hell_hound', 'hound'), side: 'enemy', x: 5, y: 5 },
          { c: hero('a'), side: 'party', x: 6, y: 5 },
          { c: hero('b'), side: 'party', x: 7, y: 5 },
          ...(withAlly ? [{ c: mon('hell_hound', 'pal'), side: 'enemy' as const, x: 8, y: 5 }] : []),
        ],
        'hound',
      ),
      'hound',
      50,
    );

  it('uses a breath weapon when 2+ hostiles are in the cone', () => {
    const s = breathSetup(false);
    const plan = planTurn(s, ctx(), 'hound');
    expect(plan.intent).toBe('area');
    expect(plan.steps.at(-1)).toMatchObject({ kind: 'area', actionName: 'Fire Breath' });
    const r = takeAiTurn(s, ctx(3), 'hound');
    expect(r.ok).toBe(true);
    expect(r.events.some((e) => e.text.includes('uses Fire Breath'))).toBe(true);
    expect(r.state.creatures.hound!.resources['recharge:Fire Breath']!.current).toBe(0);
    expect(r.state.creatures.a!.hp).toBeLessThan(30);
    expect(r.state.creatures.b!.hp).toBeLessThan(30);
  });

  it('holds the breath weapon when an ally would be caught', () => {
    const plan = planTurn(breathSetup(true), ctx(), 'hound');
    expect(plan.intent).toBe('attack');
    expect(attacks(plan)).toHaveLength(2);
  });

  it('recharge not available → Multiattack, and every attack is made', () => {
    let s = breathSetup(false);
    s = { ...s, creatures: { ...s.creatures, a: hero('a', { hp: 200, maxHp: 200 }), hound: { ...s.creatures.hound!, resources: { ...s.creatures.hound!.resources, 'recharge:Fire Breath': { current: 0, max: 1, recharge: 'never' } } } } };
    const plan = planTurn(s, ctx(), 'hound');
    expect(plan.intent).toBe('attack');
    expect(attacks(plan)).toEqual([
      { kind: 'attack', profileId: 'monster:Bite', targetId: 'a' },
      { kind: 'attack', profileId: 'monster:Bite', targetId: 'a' },
    ]);
    const r = takeAiTurn(s, ctx(5), 'hound');
    expect(r.events.filter((e) => e.kind === 'attack')).toHaveLength(2);
    expect(r.state.turns.budgets.hound!.action).toBe(false);
  });

  it('re-targets when the first target drops mid-Multiattack', () => {
    let s = breathSetup(false);
    s = { ...s, creatures: { ...s.creatures, a: hero('a', { hp: 1 }), b: hero('b', { hp: 100, maxHp: 100 }), hound: { ...s.creatures.hound!, resources: { ...s.creatures.hound!.resources, 'recharge:Fire Breath': { current: 0, max: 1, recharge: 'never' } } } } };
    s = { ...s, grid: { ...s.grid, tokens: { ...s.grid.tokens, b: { ...s.grid.tokens.b!, x: 6, y: 6 } } } };
    expect(planTurn(s, ctx(), 'hound').targetId).toBe('a');
    // Find a seed where the first Bite drops `a`: the second Bite must then go to `b`.
    let checked = false;
    for (let seed = 1; seed <= 50 && !checked; seed++) {
      const r = takeAiTurn(s, ctx(seed), 'hound');
      const atk = r.events.filter((e) => e.kind === 'attack');
      if (r.state.creatures.a!.hp > 0 || atk.length !== 2 || !r.events.some((e) => e.kind === 'damage' && e.targetId === 'a')) continue;
      if (atk[1]!.targetId === 'a') continue; // first Bite missed, second dropped a
      expect(atk[0]!.targetId).toBe('a');
      expect(atk[1]!.targetId).toBe('b');
      checked = true;
    }
    expect(checked).toBe(true);
  });

  it('stops gracefully when the mover drops to an Opportunity Attack', () => {
    const s = setup(
      [
        { c: mon('ogre', 'ogre', { hp: 1 }), side: 'enemy', x: 5, y: 5 },
        { c: hero('guard'), side: 'party', x: 7, y: 5 },
        { c: hero('far', { hp: 2 }), side: 'party', x: 5, y: 1 },
      ],
      'ogre',
    );
    const plan = { actorId: 'ogre', intent: 'attack' as const, steps: [{ kind: 'move' as const, path: [{ x: 5, y: 4 }, { x: 5, y: 3 }, { x: 5, y: 2 }] }, { kind: 'attack' as const, profileId: 'monster:Greatclub', targetId: 'far' }], reason: 'test' };
    // Every die rolls its maximum: the guard's Opportunity Attack hits and drops the ogre.
    const rng = { int: (_lo: number, hi: number) => hi } as unknown as Rng;
    const e = executePlan(s, { rng, db }, plan);
    expect(e.ok && e.halted).toBe(true);
    expect(e.state.creatures.ogre!.hp).toBe(0);
    expect(e.events.some((x) => x.kind === 'attack' && x.actorId === 'ogre')).toBe(false);
    expect(e.events.some((x) => x.text.includes('can no longer act'))).toBe(true);
  });
});

describe('morale', () => {
  const roster = { gob1: 'enemy', gob2: 'enemy', h: 'party' };

  it('a Bloodied goblin whose ally is down flees (Nimble Escape + Dash)', () => {
    const s = setup(
      [
        { c: mon('goblin_warrior', 'gob1', { hp: 4 }), side: 'enemy', x: 5, y: 5 },
        { c: mon('goblin_warrior', 'gob2', { hp: 0, dead: true }), side: 'enemy', x: 0, y: 19 },
        { c: hero('h'), side: 'party', x: 6, y: 5 },
      ],
      'gob1',
    );
    expect(moraleCheck(s, ctx(), 'gob1', { roster }).flee).toBe(true);
    const plan = planTurn(s, ctx(), 'gob1', { roster });
    expect(plan.intent).toBe('flee');
    expect(plan.steps.slice(0, 2)).toEqual([{ kind: 'disengage', bonus: true }, { kind: 'dash' }]);
    const r = takeAiTurn(s, ctx(), 'gob1', { roster });
    expect(distanceFt(r.state.grid.tokens.gob1!, r.state.grid.tokens.h!)).toBeGreaterThanOrEqual(50);
    expect(r.events.some((e) => e.text.includes('Opportunity Attack'))).toBe(false);
  });

  it('a healthy goblin, or one whose side is intact, keeps fighting', () => {
    const s = setup(
      [
        { c: mon('goblin_warrior', 'gob1', { hp: 4 }), side: 'enemy', x: 5, y: 5 },
        { c: mon('goblin_warrior', 'gob2'), side: 'enemy', x: 0, y: 19 },
        { c: hero('h'), side: 'party', x: 6, y: 5 },
      ],
      'gob1',
    );
    expect(moraleCheck(s, ctx(), 'gob1', { roster }).flee).toBe(false);
    expect(planTurn(s, ctx(), 'gob1', { roster }).intent).toBe('attack');
  });

  it('the leader falling breaks a Bloodied follower', () => {
    const s = setup(
      [
        { c: mon('goblin_warrior', 'gob1', { hp: 5 }), side: 'enemy', x: 5, y: 5 },
        { c: mon('goblin_boss', 'boss', { hp: 0, dead: true }), side: 'enemy', x: 0, y: 19 },
        { c: mon('goblin_warrior', 'gob2'), side: 'enemy', x: 1, y: 19 },
        { c: mon('goblin_warrior', 'gob3'), side: 'enemy', x: 2, y: 19 },
        { c: hero('h'), side: 'party', x: 6, y: 5 },
      ],
      'gob1',
    );
    expect(moraleCheck(s, ctx(), 'gob1').reason).toBe('its leader has fallen');
  });

  it('undead and mindless creatures never flee; morale can be disabled', () => {
    expect(isFearless(mon('skeleton', 's'))).toBe(true);
    expect(isFearless(mon('wolf', 'w'))).toBe(true);
    expect(isFearless(mon('goblin_warrior', 'g'))).toBe(false);
    const s = setup(
      [
        { c: mon('skeleton', 'sk', { hp: 1 }), side: 'enemy', x: 5, y: 5 },
        { c: mon('skeleton', 'sk2', { hp: 0, dead: true }), side: 'enemy', x: 0, y: 19 },
        { c: hero('h'), side: 'party', x: 6, y: 5 },
      ],
      'sk',
    );
    expect(planTurn(s, ctx(), 'sk', { roster: { sk: 'enemy', sk2: 'enemy', h: 'party' } }).intent).toBe('attack');
    const g = setup(
      [
        { c: mon('goblin_warrior', 'gob1', { hp: 2 }), side: 'enemy', x: 5, y: 5 },
        { c: hero('h'), side: 'party', x: 6, y: 5 },
      ],
      'gob1',
    );
    expect(moraleCheck(g, ctx(), 'gob1').flee).toBe(true);
    expect(moraleCheck(g, ctx(), 'gob1', { morale: { enabled: false } }).flee).toBe(false);
  });
});

describe('determinism and a full fight', () => {
  const fight = (): CombatState => {
    const s = setup(
      [
        { c: mon('goblin_warrior', 'g1'), side: 'enemy', x: 2, y: 2 },
        { c: mon('goblin_warrior', 'g2'), side: 'enemy', x: 3, y: 4 },
        { c: mon('goblin_warrior', 'g3'), side: 'enemy', x: 1, y: 6 },
        { c: mon('wolf', 'w1'), side: 'party', x: 12, y: 3 },
        { c: mon('wolf', 'w2'), side: 'party', x: 13, y: 6 },
      ],
      'g1',
      16,
    );
    return { ...s, turns: { ...s.turns, round: 0, currentIndex: 0, turnActive: false } };
  };

  it('same state + same seed → the same plan and the same events', () => {
    const s = setup(
      [
        { c: mon('ogre', 'ogre'), side: 'enemy', x: 5, y: 5 },
        { c: hero('a'), side: 'party', x: 8, y: 5 },
        { c: hero('b'), side: 'party', x: 8, y: 7 },
      ],
      'ogre',
    );
    const r1 = takeAiTurn(s, ctx('same'), 'ogre');
    const r2 = takeAiTurn(s, ctx('same'), 'ogre');
    expect(r1.events.map((e) => e.text)).toEqual(r2.events.map((e) => e.text));
    expect(r1.ok && r2.ok && r1.plan).toEqual(r2.ok && r2.plan);
  });

  it('plays a small fight to the end with nextTurn (bounded)', () => {
    const run = (seed: number) => {
      const c = ctx(seed);
      const roster = { g1: 'enemy', g2: 'enemy', g3: 'enemy', w1: 'party', w2: 'party' };
      let s = fight();
      const log: string[] = [];
      for (let i = 0; i < 400; i++) {
        const n = nextTurn(s.turns, s.creatures, { rng: c.rng, db, grid: s.grid });
        s = { ...s, turns: n.state, creatures: n.creatures };
        if (livingSides(s.turns, s.creatures).size <= 1 || s.turns.round > 40) break;
        const id = currentId(s.turns)!;
        const r = takeAiTurn(s, c, id, { roster });
        expect(r.ok).toBe(true);
        s = r.state;
        log.push(...r.events.map((e) => e.text));
      }
      return { s, log };
    };
    const a = run(11);
    expect(a.s.turns.round).toBeLessThanOrEqual(40);
    expect(livingSides(a.s.turns, a.s.creatures).size).toBeLessThanOrEqual(1);
    expect(a.log.some((t) => t.includes('attacks'))).toBe(true);
    expect(run(11).log).toEqual(a.log);
  });
});
