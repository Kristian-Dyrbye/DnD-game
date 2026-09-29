import { describe, expect, it } from 'vitest';
import { CharacterSchema, CreatureSchema, type Character, type Creature } from '../core/creature';
import type { Rng } from '../core/rng';
import { loadSrd } from '../data/srdBundle';
import { addEffect } from '../rules/activeEffects';
import { applyCondition, hasCondition } from '../rules/conditions';
import { monsterToCreature } from '../rules/monsters';
import { createGrid, placeToken } from './grid';
import type { InitiativeEntry } from './initiative';
import {
  TurnStateSchema,
  addCombatant,
  addDash,
  budgetOf,
  canReact,
  currentId,
  endTurn,
  livingSides,
  movementLeft,
  nextTurn,
  spend,
  spendMovement,
  standUp,
  startCombat,
  type Creatures,
  type TurnState,
} from './turns';

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

function mon(id: string, over: Partial<Creature> = {}): Creature {
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

const entry = (id: string, initiative: number, side: InitiativeEntry['side'] = 'enemy'): InitiativeEntry => ({ id, side, initiative, dexMod: 0 });

function setup(extra: Creature[] = []): { state: TurnState; creatures: Creatures } {
  const creatures: Creatures = { hero: pc(), a: mon('a'), b: mon('b') };
  for (const c of extra) creatures[c.id] = c;
  const state = startCombat([entry('a', 15), entry('hero', 20, 'party'), entry('b', 10), ...extra.map((c) => entry(c.id, 5))]);
  return { state, creatures };
}

const ctx = { rng: fixed() };

describe('turn cycle', () => {
  it('starts round 1 with the highest initiative and wraps into round 2', () => {
    let { state, creatures } = setup();
    expect(state.round).toBe(0);
    let r = nextTurn(state, creatures, ctx);
    expect(r.state.round).toBe(1);
    expect(currentId(r.state)).toBe('hero');
    expect(r.events[0]).toMatchObject({ kind: 'round_start', text: 'Round 1 begins.' });
    const seen: string[] = [currentId(r.state)!];
    for (let i = 0; i < 3; i++) {
      r = nextTurn(r.state, r.creatures, ctx);
      seen.push(`${r.state.round}:${currentId(r.state)}`);
    }
    expect(seen).toEqual(['hero', '1:a', '1:b', '2:hero']);
    expect(r.events.some((e) => e.kind === 'round_start' && e.text === 'Round 2 begins.')).toBe(true);
    ({ state, creatures } = r);
    expect(() => TurnStateSchema.parse(state)).not.toThrow();
    expect(creatures.hero).toBeDefined();
  });

  it('resets the budget at the start of each own turn', () => {
    const { state, creatures } = setup();
    let r = nextTurn(state, creatures, ctx);
    let s = spend(r.state, 'hero', 'action').state;
    s = spend(s, 'hero', 'bonusAction').state;
    s = spendMovement(s, 'hero', 20, creatures.hero!).state;
    expect(budgetOf(s, 'hero')).toMatchObject({ action: false, bonusAction: false, movementSpentFt: 20 });
    r = nextTurn(s, r.creatures, ctx); // a
    r = nextTurn(r.state, r.creatures, ctx); // b
    r = nextTurn(r.state, r.creatures, ctx); // hero
    expect(budgetOf(r.state, 'hero')).toMatchObject({ action: true, bonusAction: true, reaction: true, movementSpentFt: 0, dashes: 0, disengaged: false, objectInteraction: true });
  });

  it('skips dead characters and removes monsters at 0 HP', () => {
    const { state, creatures } = setup();
    creatures.b = { ...creatures.b!, hp: 0 };
    let r = nextTurn(state, creatures, ctx); // hero
    r = nextTurn(r.state, { ...r.creatures, hero: { ...r.creatures.hero!, dead: true } }, ctx); // a; b removed
    expect(currentId(r.state)).toBe('a');
    expect(r.state.order.map((e) => e.id)).toEqual(['hero', 'a']);
    expect(r.creatures.b!.dead).toBe(true);
    r = nextTurn(r.state, r.creatures, ctx); // hero dead → a again, round 2
    expect(currentId(r.state)).toBe('a');
    expect(r.state.round).toBe(2);
    expect(r.events.some((e) => e.kind === 'skipped' && e.creatureId === 'hero')).toBe(true);
    expect([...livingSides(r.state, r.creatures)]).toEqual(['enemy']);
  });

  it('removing the current monster (killed on its own turn) advances correctly', () => {
    const { state, creatures } = setup();
    let r = nextTurn(state, creatures, ctx); // hero
    r = nextTurn(r.state, r.creatures, ctx); // a
    r = nextTurn(r.state, { ...r.creatures, a: { ...r.creatures.a!, hp: 0 } }, ctx);
    expect(currentId(r.state)).toBe('b');
    expect(r.state.order.map((e) => e.id)).toEqual(['hero', 'b']);
  });

  it('addCombatant slots a summon into the order without changing the current creature', () => {
    const { state, creatures } = setup();
    const r = nextTurn(nextTurn(state, creatures, ctx).state, creatures, ctx); // a
    const s = addCombatant(r.state, entry('wolf', 18, 'party'));
    expect(s.order.map((e) => e.id)).toEqual(['hero', 'wolf', 'a', 'b']);
    expect(currentId(s)).toBe('a');
  });
});

describe('action economy', () => {
  it('actions only on own turn and once per turn', () => {
    const { state, creatures } = setup();
    const r = nextTurn(state, creatures, ctx);
    const s = spend(r.state, 'hero', 'action');
    expect(s.ok).toBe(true);
    const again = spend(s.state, 'hero', 'action');
    expect(again).toMatchObject({ ok: false, error: 'action already used this turn' });
    expect(spend(s.state, 'a', 'action')).toMatchObject({ ok: false, error: "It isn't a's turn" });
    expect(spend(s.state, 'a', 'bonusAction').ok).toBe(false);
    expect(spend(s.state, 'hero', 'objectInteraction').ok).toBe(true);
    expect(spend(s.state, 'ghost', 'action')).toMatchObject({ ok: false, error: 'ghost is not in this encounter' });
  });

  it('reaction: usable off-turn once, refreshed only at the start of own turn', () => {
    const { state, creatures } = setup();
    let r = nextTurn(state, creatures, ctx); // hero
    const used = spend(r.state, 'a', 'reaction', creatures.a);
    expect(used.ok).toBe(true);
    expect(spend(used.state, 'a', 'reaction')).toMatchObject({ ok: false, error: 'Reaction already used this round' });
    expect(canReact(used.state, 'a', creatures.a!)).toBe(false);
    r = nextTurn(used.state, r.creatures, ctx); // a's turn → refreshed
    expect(canReact(r.state, 'a', r.creatures.a!)).toBe(true);
    const heroUsed = spend(r.state, 'hero', 'reaction');
    r = nextTurn(heroUsed.state, r.creatures, ctx); // b
    expect(canReact(r.state, 'hero', r.creatures.hero!)).toBe(false);
    r = nextTurn(r.state, r.creatures, ctx); // hero
    expect(canReact(r.state, 'hero', r.creatures.hero!)).toBe(true);
  });

  it('Incapacitated creatures can’t act or react', () => {
    const { state, creatures } = setup();
    const stunned = applyCondition(creatures.hero!, { condition: 'stunned' }).creature;
    const r = nextTurn(state, { ...creatures, hero: stunned }, ctx);
    expect(spend(r.state, 'hero', 'action', r.creatures.hero)).toMatchObject({ ok: false, error: "Brenna can't act (Incapacitated)" });
    expect(canReact(r.state, 'hero', r.creatures.hero!)).toBe(false);
    expect(canReact(r.state, 'a', { ...creatures.a!, hp: 0 })).toBe(false);
  });

  it('movement: spend, Dash doubles, stand up costs half Speed', () => {
    const { state, creatures } = setup();
    const r = nextTurn(state, creatures, ctx);
    const hero = applyCondition(creatures.hero!, { condition: 'prone' }).creature;
    expect(movementLeft(r.state, 'hero', hero)).toBe(30);
    const up = standUp(r.state, 'hero', hero);
    if (!up.ok) throw new Error(up.error);
    expect(up.costFt).toBe(15);
    expect(hasCondition(up.creature, 'prone')).toBe(false);
    expect(movementLeft(up.state, 'hero', up.creature)).toBe(15);
    expect(spendMovement(up.state, 'hero', 20, up.creature)).toMatchObject({ ok: false, error: 'Only 15 ft of movement left' });
    const dashed = addDash(up.state, 'hero');
    expect(movementLeft(dashed, 'hero', up.creature)).toBe(45);
    const moved = spendMovement(dashed, 'hero', 45, up.creature);
    expect(moved.ok).toBe(true);
    expect(movementLeft(moved.state, 'hero', up.creature)).toBe(0);
    expect(standUp(r.state, 'hero', creatures.hero!)).toMatchObject({ ok: false });
    expect(spendMovement(r.state, 'a', 5, creatures.a!).ok).toBe(false);
  });

  it('standing up fails without enough movement', () => {
    const { state, creatures } = setup();
    const r = nextTurn(state, creatures, ctx);
    const hero = applyCondition(creatures.hero!, { condition: 'prone' }).creature;
    const s = spendMovement(r.state, 'hero', 20, hero).state;
    expect(standUp(s, 'hero', hero)).toMatchObject({ ok: false, error: 'Only 10 ft of movement left' });
  });
});

describe('start / end of turn hooks', () => {
  it('rolls a death save at the start of a 0 HP character’s turn', () => {
    const { state, creatures } = setup();
    const down = applyCondition(pc({ hp: 0 }), { condition: 'unconscious' }).creature;
    let r = nextTurn(state, { ...creatures, hero: down }, { rng: fixed(4) });
    const ds = r.events.find((e) => e.kind === 'death_save');
    expect(ds?.text).toMatch(/Brenna death save: d20: 4 = 4 vs DC 10 — Failure/);
    expect((r.creatures.hero as Character).deathSaves.failures).toBe(1);
    // Stable characters don't roll.
    const stable: Character = { ...(r.creatures.hero as Character), deathSaves: { successes: 0, failures: 0, stable: true } };
    r = nextTurn(r.state, r.creatures, ctx);
    r = nextTurn(r.state, r.creatures, ctx);
    r = nextTurn(r.state, { ...r.creatures, hero: stable }, ctx);
    expect(currentId(r.state)).toBe('hero');
    expect(r.events.some((e) => e.kind === 'death_save')).toBe(false);
  });

  it('Beacon of Hope gives Advantage on death saves', () => {
    const { state, creatures } = setup();
    const down = applyCondition(pc({ hp: 0 }), { condition: 'unconscious' }).creature;
    const hoped = addEffect(down, { key: 'beacon_of_hope', data: { deathSaveAdvantage: true, maxHealing: true } });
    const r = nextTurn(state, { ...creatures, hero: hoped }, { rng: fixed(4, 15) });
    expect(r.events.find((e) => e.kind === 'death_save')?.text).toMatch(/adv: 4, 15 → 15.*Success/);
    expect((r.creatures.hero as Character).deathSaves.successes).toBe(1);
  });

  it('a character dropped to 0 HP by an end-of-turn effect falls Unconscious', () => {
    const { state, creatures } = setup();
    let r = nextTurn(state, creatures, ctx);
    const acid = addEffect({ ...r.creatures.hero!, hp: 1 }, { key: 'acid_arrow', data: { damage: { dice: '2d4', type: 'acid' } }, expires: { on: 'end_of_turn', creatureId: 'hero', skip: 0 } });
    r = endTurn(r.state, { ...r.creatures, hero: acid }, { rng: fixed(2, 2) });
    expect(r.creatures.hero!.hp).toBe(0);
    expect(hasCondition(r.creatures.hero!, 'unconscious')).toBe(true);
    expect(r.creatures.hero!.effects).toHaveLength(0);
  });

  it('counts down effect and condition durations at the end of the creature’s own turn', () => {
    const { state, creatures } = setup();
    let hero = addEffect(creatures.hero!, { key: 'bless', roundsLeft: 2 });
    hero = applyCondition(hero, { condition: 'blinded', roundsLeft: 1 }).creature;
    let r = nextTurn(state, { ...creatures, hero }, ctx); // hero's turn 1
    r = nextTurn(r.state, r.creatures, ctx); // end hero's turn → blinded gone, bless 1
    expect(hasCondition(r.creatures.hero!, 'blinded')).toBe(false);
    expect(r.creatures.hero!.effects[0]?.roundsLeft).toBe(1);
    expect(r.events.some((e) => e.kind === 'condition_expired' && e.creatureId === 'hero')).toBe(true);
    r = nextTurn(r.state, r.creatures, ctx); // b
    r = nextTurn(r.state, r.creatures, ctx); // hero round 2
    expect(r.creatures.hero!.effects).toHaveLength(1);
    r = nextTurn(r.state, r.creatures, ctx); // end hero's turn → bless gone
    expect(r.creatures.hero!.effects).toHaveLength(0);
    expect(r.events.some((e) => e.kind === 'effect_expired' && e.text.startsWith('bless'))).toBe(true);
  });

  it('expires start_of_turn effects keyed to the creature whose turn starts', () => {
    const { state, creatures } = setup();
    const a = addEffect(creatures.a!, { key: 'vex', sourceId: 'hero', targetId: 'b', expires: { on: 'start_of_turn', creatureId: 'hero', skip: 0 } });
    let r = nextTurn(state, { ...creatures, a }, ctx);
    expect(r.creatures.a!.effects).toHaveLength(0);
    expect(r.events.some((e) => e.kind === 'effect_expired' && e.creatureId === 'a')).toBe(true);
    r = nextTurn(r.state, r.creatures, ctx);
    expect(currentId(r.state)).toBe('a');
  });

  it('rolls end-of-turn saves for conditions', () => {
    const { state, creatures } = setup();
    const hero = applyCondition(creatures.hero!, { condition: 'poisoned', endSave: { ability: 'con', dc: 12 } }).creature;
    let r = nextTurn(state, { ...creatures, hero }, ctx);
    r = endTurn(r.state, r.creatures, { rng: fixed(15) });
    expect(hasCondition(r.creatures.hero!, 'poisoned')).toBe(false);
    expect(r.events.find((e) => e.kind === 'save')?.text).toMatch(/Constitution save|save vs poisoned/);
  });

  it('rolls monster recharges at the start of its turn', () => {
    const db = loadSrd();
    const m = db.monsters.get('air_elemental')!;
    const el = monsterToCreature(m, 'a');
    const spent: Creature = { ...el, resources: { ...el.resources, 'recharge:Whirlwind': { current: 0, max: 1, recharge: 'never' } } };
    const { state, creatures } = setup();
    let r = nextTurn(state, { ...creatures, a: spent }, ctx); // hero
    r = nextTurn(r.state, r.creatures, { rng: fixed(6), db });
    expect(currentId(r.state)).toBe('a');
    expect(r.creatures.a!.resources['recharge:Whirlwind']?.current).toBe(1);
    expect(r.events.some((e) => e.kind === 'recharge' && e.text.includes('Whirlwind'))).toBe(true);
  });

  it('a creature ending its turn in another creature’s space falls Prone unless larger', () => {
    const grid = createGrid(10, 10);
    placeToken(grid, { id: 'hero', x: 2, y: 2, size: 'medium' });
    placeToken(grid, { id: 'a', x: 5, y: 5, size: 'medium' });
    const { state, creatures } = setup();
    let r = nextTurn(state, creatures, ctx);
    grid.tokens.hero = { id: 'hero', x: 5, y: 5, size: 'medium' }; // halted mid-path in a's space
    r = endTurn(r.state, r.creatures, { rng: fixed(), grid });
    expect(hasCondition(r.creatures.hero!, 'prone')).toBe(true);
    expect(r.events.some((e) => e.kind === 'prone')).toBe(true);

    const big = createGrid(10, 10);
    placeToken(big, { id: 'a', x: 5, y: 5, size: 'medium' });
    big.tokens.hero = { id: 'hero', x: 4, y: 4, size: 'large' };
    let r2 = nextTurn(state, creatures, ctx);
    r2 = endTurn(r2.state, r2.creatures, { rng: fixed(), grid: big });
    expect(hasCondition(r2.creatures.hero!, 'prone')).toBe(false);
  });
});
