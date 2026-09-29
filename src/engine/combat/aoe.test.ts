import { describe, expect, it } from 'vitest';
import { CharacterSchema, type Character, type Creature } from '../core/creature';
import type { Rng } from '../core/rng';
import { loadSrd } from '../data/srdBundle';
import { addEffect } from '../rules/activeEffects';
import { hasCondition } from '../rules/conditions';
import { monsterToCreature } from '../rules/monsters';
import { affectedCreatures, affectedSquares, hasLineOfEffect, previewArea, templateFromArea, templateFromCaster, type AoeTemplate } from './aoe';
import { addSaveBonus, resolveAreaEffect } from './aoeResolve';
import type { CombatContext, CombatState } from './combatState';
import { createGrid, moveToken, placeToken, setCell, setEdge, type Grid, type Point } from './grid';
import { startCombat } from './turns';

const db = loadSrd();

function fixed(...faces: number[]): Rng {
  const q = [...faces];
  return { int: () => q.shift() ?? 10 } as unknown as Rng;
}
const ctx = (...faces: number[]): CombatContext => ({ rng: fixed(...faces), db });

const key = (p: Point) => `${p.x},${p.y}`;
const keys = (ps: Point[]) => ps.map(key).sort();
const rect = (x0: number, y0: number, x1: number, y1: number): string[] => {
  const out: string[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push(`${x},${y}`);
  return out.sort();
};

function withCaster(width = 20, height = 20, at: Point = { x: 10, y: 10 }): Grid {
  const g = createGrid(width, height);
  placeToken(g, { id: 'c', x: at.x, y: at.y, size: 'medium' });
  return g;
}

describe('template shapes on an open grid', () => {
  it('Fireball: 20-ft sphere from an intersection covers 8×8 squares (grid metric)', () => {
    const g = createGrid(20, 20);
    const sq = affectedSquares(g, templateFromArea({ shape: 'sphere', size: 20 }, { origin: { x: 10, y: 10 } }));
    expect(keys(sq)).toEqual(rect(6, 6, 13, 13));
  });

  it('euclidean metric rounds the corners (52 squares)', () => {
    const g = createGrid(20, 20);
    const sq = affectedSquares(g, templateFromArea({ shape: 'sphere', size: 20 }, { origin: { x: 10, y: 10 }, metric: 'euclidean' }));
    expect(sq).toHaveLength(52);
    expect(keys(sq)).not.toContain('6,6');
    expect(keys(sq)).toContain('6,9');
  });

  it('sphere centred on a square counts squares outward from it (9×9 for 20 ft)', () => {
    const g = createGrid(20, 20);
    const sq = affectedSquares(g, templateFromArea({ shape: 'sphere', size: 20 }, { origin: { x: 10.5, y: 10.5 } }));
    expect(keys(sq)).toEqual(rect(6, 6, 14, 14));
  });

  it('Burning Hands: 15-ft cone east from the caster', () => {
    const g = withCaster();
    const tpl = templateFromCaster(g, 'c', { shape: 'cone', size: 15 }, { x: 15, y: 10.5 });
    expect(tpl.origin).toEqual({ x: 11, y: 10.5 });
    expect(keys(affectedSquares(g, tpl))).toEqual(['11,10', '12,10', '13,10', '13,11', '13,9'].sort());
  });

  it('cones in all 8 directions: 5 squares orthogonally, 6 diagonally, never the caster', () => {
    const g = withCaster();
    const dirs: [number, number][] = [
      [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
    ];
    for (const [dx, dy] of dirs) {
      const aim = { x: 10.5 + 5 * dx, y: 10.5 + 5 * dy };
      const sq = affectedSquares(g, templateFromCaster(g, 'c', { shape: 'cone', size: 15 }, aim));
      expect(sq).toHaveLength(dx !== 0 && dy !== 0 ? 6 : 5);
      expect(keys(sq)).not.toContain('10,10');
      // every square lies on the aimed side of the caster
      for (const p of sq) {
        if (dx) expect(Math.sign(p.x - 10)).toBe(dx);
        if (dy) expect(Math.sign(p.y - 10)).toBe(dy);
      }
    }
  });

  it('Lightning Bolt: 100 × 5 ft line is 20 squares in a row', () => {
    const g = withCaster(30, 20, { x: 0, y: 10 });
    const tpl = templateFromCaster(g, 'c', { shape: 'line', size: 100, width: 5 }, { x: 25, y: 10.5 });
    expect(tpl.widthFt).toBe(5);
    expect(keys(affectedSquares(g, tpl))).toEqual(rect(1, 10, 20, 10));
  });

  it('a line is clipped at the map edge and a diagonal line is a staircase', () => {
    const g = withCaster();
    expect(affectedSquares(g, templateFromCaster(g, 'c', { shape: 'line', size: 100, width: 5 }, { x: 0, y: 10.5 }))).toHaveLength(10);
    const diag = affectedSquares(g, templateFromCaster(g, 'c', { shape: 'line', size: 30, width: 5 }, { x: 15, y: 15 }));
    expect(keys(diag)).toEqual(['11,11', '12,12', '13,13', '14,14']);
  });

  it('Thunderwave: 15-ft cube from you is the 3×3 block in front of the caster', () => {
    const g = withCaster();
    const tpl = templateFromCaster(g, 'c', { shape: 'cube', size: 15 }, { x: 15, y: 10.5 });
    expect(keys(affectedSquares(g, tpl))).toEqual(rect(11, 9, 13, 11));
    // origin anywhere on a face: shifted 5 ft to the right (south when facing east)
    const shifted = templateFromCaster(g, 'c', { shape: 'cube', size: 15 }, { x: 15, y: 10.5 }, { offsetFt: 5 });
    expect(keys(affectedSquares(g, shifted))).toEqual(rect(11, 10, 13, 12));
  });

  it('Flame Strike: 10-ft-radius, 40-ft-high cylinder', () => {
    const g = createGrid(20, 20);
    const tpl = templateFromArea({ shape: 'cylinder', size: 10, width: 40 }, { origin: { x: 5, y: 5 } });
    expect(tpl.heightFt).toBe(40);
    expect(keys(affectedSquares(g, tpl))).toEqual(rect(3, 3, 6, 6));
  });

  it('templates without a direction are rejected for directional shapes', () => {
    const g = createGrid(10, 10);
    expect(() => affectedSquares(g, { shape: 'cone', sizeFt: 15, origin: { x: 1, y: 1 } })).toThrow(/direction/);
  });
});

describe('line of effect and creatures', () => {
  it('a wall cuts off part of a sphere', () => {
    const g = createGrid(20, 20);
    for (let y = 0; y < 20; y++) setEdge(g, 12, y, 'W', { kind: 'wall' });
    placeToken(g, { id: 'near', x: 11, y: 10, size: 'medium' });
    placeToken(g, { id: 'far', x: 12, y: 10, size: 'medium' });
    const tpl = templateFromArea({ shape: 'sphere', size: 20 }, { origin: { x: 10, y: 10 } });
    const p = previewArea(g, tpl);
    expect(keys(p.squares)).toEqual(rect(6, 6, 11, 13));
    expect(keys(p.blocked)).toEqual(rect(12, 6, 13, 13));
    expect(p.creatureIds).toEqual(['near']);
    expect(hasLineOfEffect(g, tpl, { x: 12, y: 10 })).toBe(false);
  });

  it('an open door lets the blast through, a closed one does not', () => {
    const g = createGrid(20, 20);
    for (let y = 0; y < 20; y++) setEdge(g, 12, y, 'W', { kind: y === 10 ? 'door' : 'wall', open: false });
    const tpl = templateFromArea({ shape: 'sphere', size: 20 }, { origin: { x: 10, y: 10 } });
    expect(affectedSquares(g, tpl)).toHaveLength(48);
    setEdge(g, 12, 10, 'W', { kind: 'door', open: true });
    const opened = keys(affectedSquares(g, tpl));
    expect(opened.length).toBeGreaterThan(48);
    expect(opened).toContain('13,10');
  });

  it('blocking squares are never part of the area', () => {
    const g = createGrid(20, 20);
    setCell(g, { x: 11, y: 11 }, { blocking: true });
    expect(keys(affectedSquares(g, templateFromArea({ shape: 'sphere', size: 20 }, { origin: { x: 10, y: 10 } })))).not.toContain('11,11');
  });

  it('a Large creature partly inside the area is affected', () => {
    const g = createGrid(20, 20);
    placeToken(g, { id: 'ogre', x: 13, y: 6, size: 'large' });
    placeToken(g, { id: 'ogre2', x: 14, y: 6, size: 'large' });
    placeToken(g, { id: 'gob', x: 2, y: 2, size: 'small' });
    const tpl = templateFromArea({ shape: 'sphere', size: 20 }, { origin: { x: 10, y: 10 } });
    expect(affectedCreatures(g, tpl)).toEqual(['ogre']);
    expect(affectedCreatures(g, tpl, { excludeIds: ['ogre'] })).toEqual([]);
  });

  it('an emanation moves with its creature and excludes it unless chosen', () => {
    const g = createGrid(20, 20);
    placeToken(g, { id: 'cleric', x: 5, y: 5, size: 'medium' });
    placeToken(g, { id: 'g1', x: 8, y: 5, size: 'small' });
    placeToken(g, { id: 'g2', x: 9, y: 5, size: 'small' });
    const tpl: AoeTemplate = templateFromCaster(g, 'cleric', { shape: 'emanation', size: 15 });
    const p = previewArea(g, tpl);
    expect(p.squares).toHaveLength(48);
    expect(keys(p.squares)).not.toContain('5,5');
    expect(p.creatureIds).toEqual(['g1']);
    moveToken(g, 'cleric', { x: 6, y: 5 });
    expect(affectedCreatures(g, tpl)).toEqual(['g1', 'g2']);
    expect(affectedCreatures(g, { ...tpl, includeOrigin: true })).toEqual(['cleric', 'g1', 'g2']);
  });

  it('an emanation from a Large creature extends from its whole footprint', () => {
    const g = createGrid(20, 20);
    placeToken(g, { id: 'big', x: 5, y: 5, size: 'large' });
    expect(affectedSquares(g, templateFromCaster(g, 'big', { shape: 'emanation', size: 10 }))).toHaveLength(6 * 6 - 4);
  });
});

// ---------------------------------------------------------------- resolution

function hero(): Character {
  return CharacterSchema.parse({
    id: 'wiz',
    name: 'Ilsa',
    kind: 'character',
    size: 'medium',
    creatureType: 'humanoid',
    abilities: { str: 8, dex: 14, con: 14, int: 16, wis: 10, cha: 10 },
    proficiencyBonus: 2,
    maxHp: 30,
    hp: 30,
    ac: 12,
    speed: { walk: 30 },
    classes: [{ classId: 'wizard', level: 5 }],
    speciesId: 'human',
    backgroundId: 'sage',
  });
}
const goblin = (id: string): Creature => monsterToCreature(db.monsters.get('goblin_warrior')!, id, id);

function battle(): CombatState {
  const grid = createGrid(20, 20);
  const list: [Creature, Point, 'party' | 'enemy'][] = [
    [hero(), { x: 0, y: 0 }, 'party'],
    [goblin('g1'), { x: 9, y: 9 }, 'enemy'],
    [addEffect(goblin('g2'), { key: 'dodge' }), { x: 8, y: 11 }, 'enemy'],
    [goblin('g3'), { x: 13, y: 10 }, 'enemy'],
  ];
  for (const [c, p] of list) placeToken(grid, { id: c.id, x: p.x, y: p.y, size: c.size });
  setCell(grid, { x: 12, y: 10 }, { coverObstacle: 'half' });
  const turns = startCombat(list.map(([c, , side], i) => ({ id: c.id, side, initiative: 20 - i, dexMod: 0 })));
  return { grid, turns: { ...turns, round: 1, currentIndex: 0, turnActive: true }, creatures: Object.fromEntries(list.map(([c]) => [c.id, c])) };
}

const fireball = (): AoeTemplate => templateFromArea({ shape: 'sphere', size: 20 }, { origin: { x: 10, y: 10 } });

describe('resolveAreaEffect', () => {
  it('one shared damage roll, half on a save, Dodge advantage and cover bonus on Dex saves', () => {
    const s = battle();
    // 8d6 all 1s = 8; g1 d20 10 (+2 = 12 fail); g2 Dodge adv 5,12 → 14 success; g3 d20 9 + 2 + 2 cover = 13 success
    const r = resolveAreaEffect(s, ctx(1, 1, 1, 1, 1, 1, 1, 1, 10, 5, 12, 9), {
      casterId: 'wiz',
      label: 'Fireball',
      template: fireball(),
      save: { ability: 'dex', dc: 13 },
      damage: [{ dice: '8d6', type: 'fire' }],
    });
    if (!r.ok) throw new Error(r.error);
    expect(r.damageRoll?.total).toBe(8);
    expect(r.events.filter((e) => e.text.includes('rolled once'))).toHaveLength(1);
    const by = Object.fromEntries(r.targets.map((t) => [t.id, t]));
    expect(Object.keys(by).sort()).toEqual(['g1', 'g2', 'g3']);
    expect(by.g1!.save?.success).toBe(false);
    expect(by.g1!.damage).toBe(8);
    expect(by.g2!.save?.mode).toBe('advantage');
    expect(by.g2!.save?.advantage).toContain('Dodge');
    expect(by.g2!.damage).toBe(4);
    expect(by.g3!.cover).toBe('half');
    expect(by.g3!.save?.total).toBe(13);
    expect(by.g3!.save?.text).toContain('Half Cover');
    expect(by.g3!.damage).toBe(4);
    expect(r.state.creatures.g1!.hp).toBe(2);
    expect(r.state.creatures.g2!.hp).toBe(6);
    expect(r.state.creatures.wiz!.hp).toBe(30);
    expect(s.creatures.g1!.hp).toBe(10); // input untouched
  });

  it('no save: everyone takes full damage; halfOnSave false: success takes nothing', () => {
    const s = battle();
    const full = resolveAreaEffect(s, ctx(2, 2), { template: fireball(), label: 'Trap', damage: [{ dice: '2d6', type: 'fire' }] });
    if (!full.ok) throw new Error(full.error);
    expect(full.targets.map((t) => t.damage)).toEqual([4, 4, 4]);
    const none = resolveAreaEffect(s, ctx(2, 2, 20, 20, 20, 20), {
      template: fireball(),
      save: { ability: 'con', dc: 10 },
      damage: [{ dice: '2d6', type: 'poison' }],
      halfOnSave: false,
    });
    if (!none.ok) throw new Error(none.error);
    expect(none.targets.every((t) => t.save?.success && t.damage === 0)).toBe(true);
  });

  it('condition on a failed save, target override and exclusions', () => {
    const s = battle();
    const r = resolveAreaEffect(s, ctx(1, 20), {
      casterId: 'wiz',
      template: fireball(),
      save: { ability: 'wis', dc: 12 },
      conditionOnFail: { condition: 'frightened', roundsLeft: 10 },
      targetIds: ['g1', 'g3', 'wiz'],
      excludeIds: ['wiz'],
    });
    if (!r.ok) throw new Error(r.error);
    expect(r.targets.map((t) => t.id)).toEqual(['g1', 'g3']);
    expect(hasCondition(r.state.creatures.g1!, 'frightened')).toBe(true);
    expect(hasCondition(r.state.creatures.g3!, 'frightened')).toBe(false);
    expect(r.targets.every((t) => t.cover === 'none')).toBe(true); // cover only helps Dex saves
  });

  it('addSaveBonus recomputes total, outcome and text', () => {
    const s = battle();
    const r = resolveAreaEffect(s, ctx(8), { template: fireball(), save: { ability: 'dex', dc: 13 }, targetIds: ['g3'] });
    if (!r.ok) throw new Error(r.error);
    const save = r.targets[0]!.save!;
    expect(save.total).toBe(12);
    expect(save.success).toBe(false);
    const bumped = addSaveBonus(save, { value: 5, label: 'Three-Quarters Cover' });
    expect(bumped.total).toBe(17);
    expect(bumped.success).toBe(true);
    expect(bumped.text).toMatch(/\+ 5 \(Three-Quarters Cover\) = 17 vs DC 13 — Success/);
  });
});
