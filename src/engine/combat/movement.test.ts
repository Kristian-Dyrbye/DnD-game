import { describe, expect, it } from 'vitest';
import { CreatureSchema, type Creature } from '../core/creature';
import { applyCondition } from '../rules/conditions';
import { createGrid, placeToken, setCell, setEdge, type Grid, type GridToken, type Point } from './grid';
import { moveAlong, movementBudget, planMove, reachableSquares, standUpCost, teleport } from './movement';

const tok = (id: string, x: number, y: number, size: GridToken['size'] = 'medium'): GridToken => ({ id, x, y, size });

function make(over: Partial<Creature> = {}): Creature {
  return CreatureSchema.parse({
    id: 'hero',
    name: 'hero',
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

function gridWith(...tokens: GridToken[]): Grid {
  const g = createGrid(20, 20);
  for (const t of tokens) placeToken(g, t);
  return g;
}

const line = (from: Point, dx: number, dy: number, n: number): Point[] =>
  Array.from({ length: n }, (_, i) => ({ x: from.x + dx * (i + 1), y: from.y + dy * (i + 1) }));

/** Heroes vs monsters: ids starting with "h" are one side. */
const sides = (a: string, b: string) => a.startsWith('h') !== b.startsWith('h');

describe('movementBudget / standUpCost', () => {
  it('uses walking speed, doubles with Dash', () => {
    const c = make();
    expect(movementBudget(c)).toBe(30);
    expect(movementBudget(c, { dashes: 1 })).toBe(60);
    expect(movementBudget(c, { dashes: 2 })).toBe(90);
  });
  it('is 0 when Grappled or Restrained, even with Dash', () => {
    const g = applyCondition(make(), { condition: 'grappled', sourceId: 'm1' }).creature;
    expect(movementBudget(g, { dashes: 1 })).toBe(0);
    const r = applyCondition(make(), { condition: 'restrained' }).creature;
    expect(movementBudget(r)).toBe(0);
  });
  it('other modes use their own speed or 0', () => {
    const c = make({ speed: { walk: 30, fly: 60 } });
    expect(movementBudget(c, { mode: 'fly' })).toBe(60);
    expect(movementBudget(c, { mode: 'swim' })).toBe(0);
  });
  it('standing up costs half speed; impossible at speed 0', () => {
    expect(standUpCost(make())).toBe(15);
    expect(standUpCost(make({ speed: { walk: 25 } }))).toBe(12);
    const g = applyCondition(make(), { condition: 'grappled' }).creature;
    expect(standUpCost(g)).toBeNull();
  });
});

describe('reachableSquares', () => {
  it('30 ft reaches 6 squares in every direction (diagonals cost 5)', () => {
    const g = gridWith(tok('h', 10, 10));
    const r = reachableSquares(g, 'h', 30);
    expect(r.size).toBe(13 * 13 - 1);
    expect(r.get('16,16')?.costFt).toBe(30);
    expect(r.has('17,10')).toBe(false);
    expect(r.has('10,10')).toBe(false);
    const p = r.get('13,10');
    expect(p?.path).toEqual(line({ x: 10, y: 10 }, 1, 0, 3));
  });
  it('walls block; path goes around', () => {
    const g = gridWith(tok('h', 5, 5));
    for (let y = 0; y < 20; y++) if (y !== 9) setEdge(g, 5, y, 'E', { kind: 'wall' });
    const r = reachableSquares(g, 'h', 30);
    expect(r.has('6,5')).toBe(false);
    // around the gap at y=9: 4 steps to (5,9)? diagonal (6,9) reachable via (5,8)->(6,9)
    const around = reachableSquares(g, 'h', 100).get('6,5');
    expect(around?.costFt).toBeGreaterThan(5);
    expect(around?.path.some((p) => p.y >= 8)).toBe(true);
  });
  it('difficult terrain costs double', () => {
    const g = gridWith(tok('h', 0, 0));
    for (let x = 1; x < 20; x++) setCell(g, { x, y: 0 }, { terrain: 'difficult' });
    for (let x = 1; x < 20; x++) setCell(g, { x, y: 1 }, { terrain: 'difficult' });
    const r = reachableSquares(g, 'h', 30);
    expect(r.get('3,0')?.costFt).toBe(30);
    expect(r.has('4,0')).toBe(false);
  });
  it('crawling costs +5 per square (15 in difficult terrain)', () => {
    const g = gridWith(tok('h', 0, 0));
    setCell(g, { x: 2, y: 0 }, { terrain: 'difficult' });
    const r = reachableSquares(g, 'h', 30, { crawling: true });
    expect(r.get('1,0')?.costFt).toBe(10);
    expect(r.get('3,0')?.costFt).toBe(30); // around the difficult square: 3 crawled squares × 10
    const straight = planMove(g, 'h', line({ x: 0, y: 0 }, 1, 0, 2), { budgetFt: 30, crawling: true });
    expect(straight.costFt).toBe(25);
  });
  it('large creature cannot squeeze through a 1-square corridor', () => {
    const g = gridWith(tok('ogre', 0, 4, 'large'), tok('h', 0, 10));
    // wall of pillars at x=5 except a 1-square gap at y=5
    for (let y = 0; y < 20; y++) if (y !== 5) setCell(g, { x: 5, y }, { blocking: true });
    const big = reachableSquares(g, 'ogre', 100);
    expect([...big.values()].some((s) => s.x > 5)).toBe(false);
    const small = reachableSquares(g, 'h', 100);
    expect([...small.values()].some((s) => s.x > 5)).toBe(true);
  });
  it('large creature: any difficult square in the new footprint makes the step difficult', () => {
    const g = gridWith(tok('ogre', 0, 0, 'large'));
    setCell(g, { x: 2, y: 1 }, { terrain: 'difficult' });
    const p = planMove(g, 'ogre', [{ x: 1, y: 0 }], { budgetFt: 30 });
    expect(p.costFt).toBe(10);
  });
  it('can move through an ally (not difficult) but not end there', () => {
    const g = gridWith(tok('h1', 0, 0), tok('h2', 1, 0));
    for (let y = 1; y < 20; y++) setCell(g, { x: 1, y }, { blocking: true });
    const r = reachableSquares(g, 'h1', 30, { isHostile: sides });
    expect(r.has('1,0')).toBe(false);
    expect(r.get('2,0')?.costFt).toBe(10);
  });
  it('hostile space blocks unless two sizes different; that space is difficult', () => {
    const g = gridWith(tok('h1', 0, 0), tok('m1', 1, 0));
    for (let y = 1; y < 20; y++) setCell(g, { x: 1, y }, { blocking: true });
    expect(reachableSquares(g, 'h1', 30, { isHostile: sides }).has('2,0')).toBe(false);
    // Huge monster: two sizes larger than Medium → passable, difficult terrain
    const g2 = gridWith(tok('h1', 0, 0), tok('m1', 1, 0, 'huge'));
    const r2 = reachableSquares(g2, 'h1', 40, { isHostile: sides });
    expect(r2.get('4,0')?.costFt).toBe(35); // 3 squares of its space at 10 each, then 5
    expect(r2.has('2,0')).toBe(false); // can't end inside it
  });
  it('tiny and incapacitated hostiles can be passed; tiny is not difficult', () => {
    const g = gridWith(tok('h1', 0, 0), tok('m1', 1, 0, 'tiny'));
    for (let y = 1; y < 20; y++) setCell(g, { x: 1, y }, { blocking: true });
    expect(reachableSquares(g, 'h1', 30, { isHostile: sides }).get('2,0')?.costFt).toBe(10);
    const g2 = gridWith(tok('h1', 0, 0), tok('m1', 1, 0));
    for (let y = 1; y < 20; y++) setCell(g2, { x: 1, y }, { blocking: true });
    const r = reachableSquares(g2, 'h1', 30, { isHostile: sides, isIncapacitated: (id) => id === 'm1' });
    expect(r.get('2,0')?.costFt).toBe(15);
  });
  it('ignored tokens do not block', () => {
    const g = gridWith(tok('h1', 0, 0), tok('m1', 1, 0));
    expect(reachableSquares(g, 'h1', 5, { ignore: ['m1'] }).has('1,0')).toBe(true);
  });
});

describe('planMove / moveAlong', () => {
  it('moves the token and spends movement', () => {
    const g = gridWith(tok('h', 0, 0));
    const res = moveAlong(g, 'h', line({ x: 0, y: 0 }, 1, 1, 3), { budgetFt: 30 });
    expect(res).toMatchObject({ ok: true, stepsTaken: 3, costFt: 15, halted: false, position: { x: 3, y: 3 } });
    expect(g.tokens.h).toMatchObject({ x: 3, y: 3 });
  });
  it('rejects over-budget, non-adjacent, blocked and occupied-end paths without moving', () => {
    const g = gridWith(tok('h', 0, 0), tok('h2', 2, 0));
    expect(moveAlong(g, 'h', line({ x: 0, y: 0 }, 0, 1, 7), { budgetFt: 30 }).ok).toBe(false);
    expect(planMove(g, 'h', [{ x: 2, y: 2 }], { budgetFt: 30 }).ok).toBe(false);
    setEdge(g, 0, 0, 'S', { kind: 'wall' });
    expect(planMove(g, 'h', [{ x: 0, y: 1 }], { budgetFt: 30 }).ok).toBe(false);
    const end = planMove(g, 'h', line({ x: 0, y: 0 }, 1, 0, 2), { budgetFt: 30, isHostile: sides });
    expect(end.ok).toBe(false);
    expect(g.tokens.h).toMatchObject({ x: 0, y: 0 });
  });
  it('speed 0 (grappled budget) means no step', () => {
    const c = applyCondition(make(), { condition: 'grappled' }).creature;
    const g = gridWith(tok('h', 0, 0));
    expect(planMove(g, 'h', [{ x: 1, y: 0 }], { budgetFt: movementBudget(c) }).ok).toBe(false);
  });
  it('forced movement ignores budget', () => {
    const g = gridWith(tok('h', 0, 0));
    expect(planMove(g, 'h', line({ x: 0, y: 0 }, 1, 0, 3), { budgetFt: 0, forced: true }).ok).toBe(true);
  });
});

describe('opportunity attack triggers', () => {
  const setup = () => gridWith(tok('h', 5, 5), tok('m1', 6, 5), tok('m2', 4, 5));

  it('leaving reach provokes; moving within reach does not', () => {
    const g = gridWith(tok('h', 5, 5), tok('m1', 6, 5));
    const within = planMove(g, 'h', [{ x: 5, y: 6 }, { x: 6, y: 6 }], { budgetFt: 30 });
    expect(within.triggers).toEqual([]);
    const away = planMove(g, 'h', [{ x: 5, y: 6 }, { x: 4, y: 7 }], { budgetFt: 30 });
    expect(away.triggers).toEqual([{ attackerId: 'm1', targetId: 'h', atStep: 1 }]);
  });
  it('allies do not provoke', () => {
    const g = gridWith(tok('h', 5, 5), tok('h2', 6, 5));
    expect(planMove(g, 'h', line({ x: 5, y: 5 }, -1, 0, 2), { budgetFt: 30, isHostile: sides }).triggers).toEqual([]);
  });
  it('no triggers with Disengage or forced movement', () => {
    const path = line({ x: 5, y: 5 }, 0, 1, 3);
    expect(planMove(setup(), 'h', path, { budgetFt: 30, disengaged: true }).triggers).toEqual([]);
    expect(planMove(setup(), 'h', path, { budgetFt: 30, forced: true }).triggers).toEqual([]);
  });
  it('teleport never provokes and ignores paths', () => {
    const g = setup();
    expect(teleport(g, 'h', { x: 15, y: 15 })).toBe(true);
    expect(g.tokens.h).toMatchObject({ x: 15, y: 15 });
    expect(teleport(g, 'h', { x: 6, y: 5 })).toBe(false);
  });
  it('respects 10-ft reach', () => {
    const path = line({ x: 5, y: 5 }, 0, 1, 3);
    const p = planMove(setup(), 'h', path, { budgetFt: 30, reachOf: (id) => (id === 'm1' ? 10 : 5) });
    expect(p.triggers).toEqual([
      { attackerId: 'm2', targetId: 'h', atStep: 1 },
      { attackerId: 'm1', targetId: 'h', atStep: 2 },
    ]);
  });
  it('skips attackers that cannot react or cannot see', () => {
    const path = line({ x: 5, y: 5 }, 0, 1, 2);
    expect(planMove(setup(), 'h', path, { budgetFt: 30, canReact: (id) => id !== 'm1' }).triggers.map((t) => t.attackerId)).toEqual(['m2']);
    expect(planMove(setup(), 'h', path, { budgetFt: 30, canSee: (a) => a !== 'm2' }).triggers.map((t) => t.attackerId)).toEqual(['m1']);
  });
  it('multiple triggers on one step keep token order; beforeStep receives them before the step', () => {
    const g = setup();
    const seen: { i: number; ids: string[]; at: Point }[] = [];
    const res = moveAlong(g, 'h', line({ x: 5, y: 5 }, 0, 1, 3), {
      budgetFt: 30,
      beforeStep: (_s, i, tr) => {
        seen.push({ i, ids: tr.map((t) => t.attackerId), at: { x: g.tokens.h!.x, y: g.tokens.h!.y } });
        return true;
      },
    });
    expect(res.triggers.map((t) => [t.attackerId, t.atStep])).toEqual([
      ['m1', 1],
      ['m2', 1],
    ]);
    expect(seen[1]).toEqual({ i: 1, ids: ['m1', 'm2'], at: { x: 5, y: 6 } });
  });
  it('caller can halt mid-path (target dropped); reaction use re-checked live', () => {
    const g = setup();
    const used = new Set<string>();
    const res = moveAlong(g, 'h', line({ x: 5, y: 5 }, 0, 1, 3), {
      budgetFt: 30,
      canReact: (id) => !used.has(id),
      beforeStep: (_s, _i, tr) => {
        for (const t of tr) used.add(t.attackerId);
        return tr.length === 0;
      },
    });
    expect(res).toMatchObject({ ok: true, halted: true, stepsTaken: 1, costFt: 5, position: { x: 5, y: 6 } });
    expect(g.tokens.h).toMatchObject({ x: 5, y: 6 });
  });
  it('an attacker with a spent reaction does not trigger again when the mover re-leaves reach', () => {
    const g = gridWith(tok('h', 5, 5), tok('m1', 6, 5));
    const used = new Set<string>();
    // leave, come back, leave again
    const path: Point[] = [{ x: 4, y: 5 }, { x: 3, y: 5 }, { x: 4, y: 5 }, { x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }];
    const plan = planMove(g, 'h', path, { budgetFt: 30 });
    expect(plan.triggers.map((t) => t.atStep)).toEqual([0, 4]);
    const res = moveAlong(g, 'h', path, {
      budgetFt: 30,
      canReact: (id) => !used.has(id),
      beforeStep: (_s, _i, tr) => {
        for (const t of tr) used.add(t.attackerId);
        return true;
      },
    });
    expect(res.triggers).toEqual([{ attackerId: 'm1', targetId: 'h', atStep: 0 }]);
  });
  it('large mover: reach measured from its whole footprint', () => {
    const g = gridWith(tok('ogre', 5, 5, 'large'), tok('h', 7, 6));
    // step west: footprint x 4..5, hero at x7 is 2 squares away → leaves 5-ft reach of h
    const p = planMove(g, 'ogre', [{ x: 4, y: 5 }], { budgetFt: 40, isHostile: sides });
    expect(p.triggers).toEqual([{ attackerId: 'h', targetId: 'ogre', atStep: 0 }]);
  });
});
