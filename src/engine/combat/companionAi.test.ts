import { describe, expect, it } from 'vitest';
import { buildCharacter } from '../character/builder';
import { toBuildInput } from '../character/creator';
import { quickBuild } from '../character/quickBuild';
import type { Character, Creature } from '../core/creature';
import { Rng } from '../core/rng';
import { loadSrd } from '../data/srdBundle';
import { applyCondition } from '../rules/conditions';
import { monsterToCreature } from '../rules/monsters';
import { takeAiTurn, type AiPlan } from './ai';
import { castInCombat, featureInCombat } from './castAction';
import type { CombatContext, CombatState } from './combatState';
import { companionRole, planCompanionTurn, takeCompanionTurn } from './companionAi';
import { createGrid, distanceFt, placeToken } from './grid';
import { currentId, livingSides, nextTurn, startCombat } from './turns';

const db = loadSrd();

function pc(classId: string, id: string, over: Partial<Character> = {}): Character {
  const c = buildCharacter(toBuildInput(quickBuild(classId, db, Rng.fromSeed(classId))), db);
  return { ...c, id, name: id, maxHp: 30, hp: 30, ...over };
}

const down = (c: Character): Character => ({ ...applyCondition({ ...c, hp: 0 }, { condition: 'unconscious' }).creature });
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
const kinds = (plan: AiPlan) => plan.steps.map((s) => s.kind);
const castOf = (plan: AiPlan, spellId: string) => plan.steps.find((s) => s.kind === 'cast' && s.spellId === spellId);

describe('role detection', () => {
  it('cleric heals, wizard keeps range, heavy fighter defends, rogue strikes, a longbow ranger shoots', () => {
    expect(companionRole(pc('cleric', 'c'), db)).toBe('healer');
    expect(companionRole(pc('druid', 'd'), db)).toBe('healer');
    expect(companionRole(pc('wizard', 'w'), db)).toBe('ranged');
    expect(companionRole(pc('warlock', 'k'), db)).toBe('ranged');
    const fighter = pc('fighter', 'f', {
      inventory: [
        { uid: 'cm', itemId: 'chain_mail', quantity: 1, equipped: 'armor' },
        { uid: 'sh', itemId: 'shield', quantity: 1, equipped: 'shield' },
        { uid: 'ls', itemId: 'longsword', quantity: 1, equipped: 'main_hand' },
      ],
    });
    expect(companionRole(fighter, db)).toBe('defender');
    expect(companionRole(pc('paladin', 'p'), db)).toBe('defender');
    expect(companionRole(pc('rogue', 'r'), db)).toBe('striker');
    const ranger = pc('ranger', 'rg', { inventory: [{ uid: 'lb', itemId: 'longbow', quantity: 1, equipped: 'main_hand' }] });
    expect(companionRole(ranger, db)).toBe('ranged');
  });
});

describe('healing', () => {
  const clericScene = (allyHp: 'down' | number, slots = 2) => {
    const cleric = pc('cleric', 'cleric');
    const withSlots = { ...cleric, spellcasting: { ...cleric.spellcasting!, slots: [slots, 0, 0, 0, 0, 0, 0, 0, 0] } };
    const ally = pc('fighter', 'ally');
    return setup(
      [
        { c: withSlots, side: 'party', x: 5, y: 5 },
        { c: allyHp === 'down' ? down(ally) : { ...ally, hp: allyHp }, side: 'party', x: 5, y: 11 },
        { c: mon('goblin_warrior', 'gob'), side: 'enemy', x: 6, y: 5 },
      ],
      'cleric',
    );
  };

  it('a downed ally gets Healing Word (Bonus Action) and the action still attacks or casts a cantrip', () => {
    const s = clericScene('down');
    const plan = planCompanionTurn(s, ctx(), 'cleric');
    expect(plan.intent).toBe('heal');
    expect(castOf(plan, 'healing_word')).toMatchObject({ kind: 'cast', targetIds: ['ally'] });
    const offense = plan.steps.filter((x) => x.kind === 'attack' || (x.kind === 'cast' && x.spellId !== 'healing_word'));
    expect(offense.length).toBeGreaterThan(0);
    expect(offense.every((x) => (x.kind === 'attack' ? x.targetId : x.kind === 'cast' ? x.targetIds[0] : '') === 'gob')).toBe(true);
    const r = takeCompanionTurn(s, ctx(), 'cleric');
    expect(r.ok).toBe(true);
    const ally = r.state.creatures.ally!;
    expect(ally.hp).toBeGreaterThan(0);
    expect(ally.conditions.some((c) => c.condition === 'unconscious')).toBe(false);
    expect(r.state.turns.budgets.cleric).toMatchObject({ bonusAction: false, action: false });
    expect((r.state.creatures.cleric as Character).spellcasting!.slots[0]).toBe(1);
  });

  it('does not heal a healthy ally', () => {
    const plan = planCompanionTurn(clericScene(25), ctx(), 'cleric');
    expect(plan.steps.some((x) => x.kind === 'cast' && ['healing_word', 'cure_wounds'].includes(x.spellId))).toBe(false);
    expect(plan.intent).toBe('attack');
  });

  it('heals a badly hurt ally, but keeps the last slot unless someone is down', () => {
    expect(planCompanionTurn(clericScene(5, 2), ctx(), 'cleric').intent).toBe('heal');
    const last = planCompanionTurn(clericScene(5, 1), ctx(), 'cleric');
    expect(last.intent).toBe('attack');
    expect(planCompanionTurn(clericScene('down', 1), ctx(), 'cleric').intent).toBe('heal');
  });

  it('Dashes to a downed ally beyond reach and heals with a Bonus Action', () => {
    const cleric = pc('cleric', 'cleric');
    const s = setup(
      [
        { c: cleric, side: 'party', x: 0, y: 0 },
        { c: down(pc('fighter', 'ally')), side: 'party', x: 19, y: 19 },
        { c: mon('goblin_warrior', 'gob'), side: 'enemy', x: 19, y: 0 },
      ],
      'cleric',
    );
    // 95 ft away: Healing Word (60 ft) needs 35 ft of movement → Dash.
    const plan = planCompanionTurn(s, ctx(), 'cleric');
    expect(kinds(plan)[0]).toBe('dash');
    expect(castOf(plan, 'healing_word')).toBeDefined();
    const r = takeCompanionTurn(s, ctx(), 'cleric');
    expect(r.state.creatures.ally!.hp).toBeGreaterThan(0);
  });

  it('a paladin lays hands on a downed ally next to them (it wakes up)', () => {
    const s = setup(
      [
        { c: pc('paladin', 'pal'), side: 'party', x: 5, y: 5 },
        { c: down(pc('wizard', 'ally')), side: 'party', x: 6, y: 5 },
        { c: mon('goblin_warrior', 'gob'), side: 'enemy', x: 5, y: 6 },
      ],
      'pal',
    );
    const plan = planCompanionTurn(s, ctx(), 'pal');
    expect(plan.steps.find((x) => x.kind === 'feature')).toMatchObject({ actionId: 'lay_on_hands', targetId: 'ally' });
    const r = takeCompanionTurn(s, ctx(), 'pal');
    expect(r.state.creatures.ally!.hp).toBeGreaterThan(0);
    expect(r.state.creatures.ally!.conditions.some((c) => c.condition === 'unconscious')).toBe(false);
  });
});

describe('keeping distance', () => {
  it('a wizard steps away from an adjacent enemy, then casts from range', () => {
    const s = setup(
      [
        { c: pc('wizard', 'wiz'), side: 'party', x: 5, y: 5 },
        { c: mon('goblin_warrior', 'gob'), side: 'enemy', x: 6, y: 5 },
      ],
      'wiz',
    );
    const plan = planCompanionTurn(s, ctx(), 'wiz');
    expect(kinds(plan)).toEqual(['move', 'cast']);
    expect(plan.steps[1]).toMatchObject({ kind: 'cast', spellId: 'fire_bolt', targetIds: ['gob'] });
    const r = takeCompanionTurn(s, ctx(), 'wiz');
    expect(distanceFt(r.state.grid.tokens.wiz!, r.state.grid.tokens.gob!)).toBeGreaterThan(5);
    expect(r.events.some((e) => e.text.includes('casts Fire Bolt'))).toBe(true);
  });

  it('a rogue archer uses Cunning Action to Disengage, steps back and shoots', () => {
    const rogue = pc('rogue', 'rog', { classes: [{ classId: 'rogue', level: 2 }], inventory: [{ uid: 'sb', itemId: 'shortbow', quantity: 1, equipped: 'main_hand' }] });
    const s = setup(
      [
        { c: rogue, side: 'party', x: 5, y: 5 },
        { c: mon('goblin_warrior', 'gob'), side: 'enemy', x: 6, y: 5 },
      ],
      'rog',
    );
    const plan = planCompanionTurn(s, ctx(), 'rog');
    expect(plan.steps[0]).toEqual({ kind: 'disengage', bonus: true });
    expect(plan.steps[1]!.kind).toBe('move');
    expect(plan.steps[2]).toMatchObject({ kind: 'attack', targetId: 'gob' });
    const r = takeCompanionTurn(s, ctx(), 'rog');
    expect(r.events.some((e) => e.text.includes('Opportunity Attack'))).toBe(false);
    expect(distanceFt(r.state.grid.tokens.rog!, r.state.grid.tokens.gob!)).toBeGreaterThan(5);
  });
});

describe('protecting and focus fire', () => {
  const tank = () =>
    pc('fighter', 'tank', {
      inventory: [
        { uid: 'cm', itemId: 'chain_mail', quantity: 1, equipped: 'armor' },
        { uid: 'sh', itemId: 'shield', quantity: 1, equipped: 'shield' },
        { uid: 'ls', itemId: 'longsword', quantity: 1, equipped: 'main_hand' },
      ],
    });

  it('a defender with no enemy in reach moves between a melee enemy and the wizard', () => {
    const s = setup(
      [
        { c: tank(), side: 'party', x: 5, y: 12 },
        { c: pc('wizard', 'wiz'), side: 'party', x: 5, y: 5 },
        { c: mon('zombie', 'gob'), side: 'enemy', x: 18, y: 5 },
      ],
      'tank',
    );
    const plan = planCompanionTurn(s, ctx(), 'tank');
    expect(plan.intent).toBe('protect');
    expect(plan.targetId).toBe('wiz');
    const r = takeCompanionTurn(s, ctx(), 'tank');
    const t = r.state.grid.tokens;
    expect(distanceFt(t.tank!, t.wiz!)).toBeLessThanOrEqual(10);
    expect(distanceFt(t.tank!, t.gob!)).toBeLessThan(distanceFt(t.wiz!, t.gob!));
    expect(r.state.creatures.tank!.effects.some((e) => e.key === 'dodge')).toBe(true);
  });

  it('archers cannot be blocked: the defender charges them instead', () => {
    const s = setup(
      [
        { c: tank(), side: 'party', x: 5, y: 12 },
        { c: pc('wizard', 'wiz'), side: 'party', x: 5, y: 5 },
        { c: mon('goblin_warrior', 'gob'), side: 'enemy', x: 18, y: 5 },
      ],
      'tank',
    );
    const plan = planCompanionTurn(s, ctx(), 'tank');
    expect(plan.intent).toBe('approach');
    expect(plan.targetId).toBe('gob');
  });

  it("a defender attacks the enemy next to the wizard rather than one next to itself", () => {
    const s = setup(
      [
        { c: tank(), side: 'party', x: 5, y: 10 },
        { c: pc('wizard', 'wiz'), side: 'party', x: 5, y: 5 },
        { c: mon('goblin_warrior', 'a'), side: 'enemy', x: 6, y: 5 },
        { c: mon('goblin_warrior', 'b'), side: 'enemy', x: 5, y: 11 },
      ],
      'tank',
    );
    expect(planCompanionTurn(s, ctx(), 'tank').targetId).toBe('a');
  });

  it("focus fire: joins the hero's target", () => {
    const s = setup(
      [
        { c: pc('barbarian', 'barb'), side: 'party', x: 5, y: 5 },
        { c: mon('goblin_warrior', 'g1'), side: 'enemy', x: 6, y: 5 },
        { c: mon('goblin_warrior', 'g2'), side: 'enemy', x: 4, y: 5 },
      ],
      'barb',
    );
    const free = planCompanionTurn(s, ctx(), 'barb').targetId;
    const other = free === 'g1' ? 'g2' : 'g1';
    expect(planCompanionTurn(s, ctx(), 'barb', { focusId: other }).targetId).toBe(other);
  });

  it('stays near the leader when attacking', () => {
    const s = setup(
      [
        { c: pc('barbarian', 'barb'), side: 'party', x: 5, y: 5 },
        { c: pc('fighter', 'hero'), side: 'party', x: 0, y: 5 },
        { c: mon('goblin_warrior', 'near'), side: 'enemy', x: 5, y: 7 },
        { c: mon('goblin_warrior', 'far'), side: 'enemy', x: 12, y: 5 },
      ],
      'barb',
    );
    expect(planCompanionTurn(s, ctx(), 'barb', { focusId: 'far' }).targetId).toBe('far');
    expect(planCompanionTurn(s, ctx(), 'barb', { focusId: 'far', leaderId: 'hero', leashFt: 30 }).targetId).toBe('near');
  });
});

describe('combat helpers', () => {
  it('castInCombat checks range and pays the Bonus Action; featureInCombat pays the feature cost', () => {
    const cleric = pc('cleric', 'c');
    const s = setup(
      [
        { c: cleric, side: 'party', x: 0, y: 0 },
        { c: down(pc('fighter', 'far')), side: 'party', x: 19, y: 0 },
        { c: mon('goblin_warrior', 'g'), side: 'enemy', x: 19, y: 19 },
      ],
      'c',
    );
    const r = castInCombat(s, ctx(), { casterId: 'c', spellId: 'healing_word', targetIds: ['far'] });
    expect(r.ok).toBe(false);
    const near = { ...s, grid: { ...s.grid, tokens: { ...s.grid.tokens, far: { ...s.grid.tokens.far!, x: 10 } } } };
    const ok = castInCombat(near, ctx(), { casterId: 'c', spellId: 'healing_word', targetIds: ['far'] });
    expect(ok.ok && ok.state.turns.budgets.c!.bonusAction).toBe(false);
    expect(ok.state.creatures.far!.hp).toBeGreaterThan(0);
    const f = setup([{ c: pc('fighter', 'f', { hp: 5 }), side: 'party', x: 0, y: 0 }, { c: mon('goblin_warrior', 'g'), side: 'enemy', x: 9, y: 9 }], 'f');
    const sw = featureInCombat(f, ctx(), { actorId: 'f', actionId: 'second_wind' });
    expect(sw.ok && sw.state.creatures.f!.hp).toBeGreaterThan(5);
    expect(sw.state.turns.budgets.f!.bonusAction).toBe(false);
  });
});

describe('determinism and a party fight', () => {
  const party = (): CombatState => {
    const s = setup(
      [
        { c: pc('fighter', 'hero'), side: 'party', x: 4, y: 6 },
        { c: pc('cleric', 'cleric'), side: 'party', x: 2, y: 5 },
        { c: pc('wizard', 'wizard'), side: 'party', x: 1, y: 7 },
        { c: pc('rogue', 'rogue', { classes: [{ classId: 'rogue', level: 2 }] }), side: 'party', x: 3, y: 8 },
        { c: mon('goblin_warrior', 'g1'), side: 'enemy', x: 12, y: 4 },
        { c: mon('goblin_warrior', 'g2'), side: 'enemy', x: 13, y: 6 },
        { c: mon('goblin_warrior', 'g3'), side: 'enemy', x: 12, y: 9 },
        { c: mon('goblin_boss', 'boss'), side: 'enemy', x: 14, y: 7 },
      ],
      'hero',
      16,
    );
    return { ...s, turns: { ...s.turns, round: 0, currentIndex: 0, turnActive: false } };
  };

  it('same state + same seed → the same plan and events', () => {
    const s = setup(
      [
        { c: pc('wizard', 'wiz'), side: 'party', x: 5, y: 5 },
        { c: down(pc('fighter', 'ally')), side: 'party', x: 5, y: 8 },
        { c: pc('cleric', 'cl'), side: 'party', x: 3, y: 5 },
        { c: mon('goblin_warrior', 'gob'), side: 'enemy', x: 6, y: 5 },
      ],
      'cl',
    );
    const a = takeCompanionTurn(s, ctx('x'), 'cl');
    const b = takeCompanionTurn(s, ctx('x'), 'cl');
    expect(a.events.map((e) => e.text)).toEqual(b.events.map((e) => e.text));
    expect(a.ok && a.plan).toEqual(b.ok && b.plan);
  });

  it('plays a party-vs-goblins fight to the end with nextTurn (bounded, deterministic)', () => {
    const run = (seed: number) => {
      const c = ctx(seed);
      const roster = { hero: 'party', cleric: 'party', wizard: 'party', rogue: 'party', g1: 'enemy', g2: 'enemy', g3: 'enemy', boss: 'enemy' };
      let s = party();
      const log: string[] = [];
      for (let i = 0; i < 500; i++) {
        const n = nextTurn(s.turns, s.creatures, { rng: c.rng, db, grid: s.grid });
        s = { ...s, turns: n.state, creatures: n.creatures };
        if (livingSides(s.turns, s.creatures).size <= 1 || s.turns.round > 30) break;
        const id = currentId(s.turns)!;
        const r = s.creatures[id]!.kind === 'character' ? takeCompanionTurn(s, c, id, { leaderId: 'hero', ...(id !== 'hero' && { focusId: undefined }) }) : takeAiTurn(s, c, id, { roster });
        expect(r.ok).toBe(true);
        s = r.state;
        log.push(...r.events.map((e) => e.text));
      }
      return { s, log };
    };
    const a = run(7);
    expect(livingSides(a.s.turns, a.s.creatures).has('party')).toBe(true);
    expect(a.log.some((t) => /Healing Word|Cure Wounds/.test(t))).toBe(true);
    expect(a.s.turns.round).toBeLessThanOrEqual(30);
    expect(livingSides(a.s.turns, a.s.creatures).size).toBeLessThanOrEqual(1);
    expect(a.log.some((t) => t.includes('casts'))).toBe(true);
    expect(run(7).log).toEqual(a.log);
  });
});
