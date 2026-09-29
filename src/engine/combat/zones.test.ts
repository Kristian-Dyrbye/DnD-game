import { describe, expect, it } from 'vitest';
import { buildCharacter } from '../character/builder';
import { toBuildInput } from '../character/creator';
import { quickBuild } from '../character/quickBuild';
import type { Character, Creature } from '../core/creature';
import type { Rng } from '../core/rng';
import { Rng as RealRng } from '../core/rng';
import { loadSrd } from '../data/srdBundle';
import { autoLevelTo } from '../party/companions';
import { hasCondition } from '../rules/conditions';
import { monsterToCreature } from '../rules/monsters';
import { moveCreature } from './actions';
import { castInCombat } from './castAction';
import type { CombatContext, CombatState } from './combatState';
import { createGrid, getCell, placeToken } from './grid';
import { startCombat } from './turns';
import { escapeZone, inZone, pruneZones, zoneAct, zonesAtTurn } from './zones';

const db = loadSrd();

function fixed(...faces: number[]): Rng {
  const q = [...faces];
  return { int: () => q.shift() ?? 10 } as unknown as Rng;
}
const ctx = (...faces: number[]): CombatContext => ({ rng: fixed(...faces), db });

function caster(classId: string, level: number, spells: string[]): Character {
  const c = autoLevelTo(buildCharacter(toBuildInput(quickBuild(classId, db, RealRng.fromSeed(classId))), db), level, db);
  return { ...c, id: 'me', spellcasting: { ...c.spellcasting!, prepared: [...c.spellcasting!.prepared, ...spells.map((spellId) => ({ spellId, classId }))] } };
}

const goblin = (id: string): Creature => monsterToCreature(db.monsters.get('goblin_warrior')!, id, id);

function setup(list: { c: Creature; side: 'party' | 'enemy'; x: number; y: number }[]): CombatState {
  const grid = createGrid(20, 20);
  for (const p of list) placeToken(grid, { id: p.c.id, x: p.x, y: p.y, size: p.c.size });
  const turns = startCombat(list.map((p, i) => ({ id: p.c.id, side: p.side, initiative: 20 - i, dexMod: 0 })));
  return { grid, turns: { ...turns, round: 1, currentIndex: 0, turnActive: true }, creatures: Object.fromEntries(list.map((p) => [p.c.id, p.c])) };
}

/** Make it `id`'s turn (fresh round stamp so once-per-turn resets). */
function turnOf(s: CombatState, id: string, round = s.turns.round + 1): CombatState {
  const idx = s.turns.order.findIndex((e) => e.id === id);
  return { ...s, turns: { ...s.turns, round, currentIndex: idx, turnActive: true, budgets: { ...s.turns.budgets, [id]: { action: true, bonusAction: true, reaction: true, movementSpentFt: 0, dashes: 0, disengaged: false, objectInteraction: true } } } };
}

describe('Web', () => {
  it('fills a 20-ft cube: difficult terrain, Restrained on entering / starting a turn there, ends with concentration', () => {
    const s = setup([
      { c: caster('wizard', 3, ['web']), side: 'party', x: 0, y: 5 },
      { c: goblin('g1'), side: 'enemy', x: 12, y: 5 },
    ]);
    const cast = castInCombat(s, ctx(), { casterId: 'me', spellId: 'web', targetIds: [], aim: { x: 8, y: 5 } });
    if (!cast.ok) throw new Error(cast.error);
    expect(cast.state.zones).toHaveLength(1);
    expect(getCell(cast.state.grid, { x: 8, y: 5 }).terrain).toBe('difficult');
    expect(getCell(cast.state.grid, { x: 11, y: 5 }).terrain).toBeUndefined();

    // The goblin walks in and fails its Dex save.
    const gt = turnOf(cast.state, 'g1');
    const m = moveCreature(gt, ctx(1), 'g1', [{ x: 11, y: 5 }, { x: 10, y: 5 }]);
    if (!m.ok) throw new Error(m.error);
    expect(m.events.some((e) => e.text.includes('enters Web'))).toBe(true);
    expect(hasCondition(m.state.creatures.g1!, 'restrained')).toBe(true);

    // Escape: Str (Athletics) vs the spell save DC.
    const esc = escapeZone(turnOf(m.state, 'g1'), ctx(20), 'g1', 'web:me');
    expect(esc.ok && esc.success).toBe(true);
    expect(esc.ok && hasCondition(esc.state.creatures.g1!, 'restrained')).toBe(false);

    // Starting a turn in the web: another save.
    const start = zonesAtTurn(turnOf(esc.ok ? esc.state : m.state, 'g1'), ctx(1), 'g1', 'start');
    expect(hasCondition(start.state.creatures.g1!, 'restrained')).toBe(true);

    // Concentration ends: the zone and its terrain go.
    const me = start.state.creatures.me as Character;
    const dropped = { ...start.state, creatures: { ...start.state.creatures, me: { ...me, spellcasting: { ...me.spellcasting!, concentration: undefined } } } };
    const pruned = pruneZones(dropped);
    expect(pruned.state.zones).toHaveLength(0);
    expect(getCell(pruned.state.grid, { x: 8, y: 5 }).terrain).toBeUndefined();
    expect(pruned.events[0]!.text).toBe('Web ends.');
  });
});

describe('Spirit Guardians', () => {
  it('follows the caster; hostiles that end their turn inside save for damage once per turn; allies are spared', () => {
    const s = setup([
      { c: caster('cleric', 5, ['spirit_guardians']), side: 'party', x: 5, y: 5 },
      { c: goblin('g1'), side: 'enemy', x: 7, y: 5 },
      { c: { ...goblin('ally'), name: 'Ally' }, side: 'party', x: 4, y: 5 },
      { c: goblin('far'), side: 'enemy', x: 14, y: 5 },
    ]);
    const cast = castInCombat(s, ctx(), { casterId: 'me', spellId: 'spirit_guardians', targetIds: [] });
    if (!cast.ok) throw new Error(cast.error);
    const z = cast.state.zones![0]!;
    expect(inZone(cast.state, z, 'g1')).toBe(true);
    expect(inZone(cast.state, z, 'far')).toBe(false);

    const g = turnOf(cast.state, 'g1');
    const end = zonesAtTurn(g, ctx(1, 4, 4, 4), 'g1', 'end');
    expect(end.state.creatures.g1!.hp).toBeLessThan(g.creatures.g1!.hp);
    // Once per turn: a second trigger in the same turn does nothing.
    const again = zonesAtTurn(end.state, ctx(1, 4, 4, 4), 'g1', 'end');
    expect(again.state.creatures.g1!.hp).toBe(end.state.creatures.g1!.hp);
    const allyEnd = zonesAtTurn(turnOf(cast.state, 'ally'), ctx(1, 4, 4, 4), 'ally', 'end');
    expect(allyEnd.state.creatures.ally!.hp).toBe(cast.state.creatures.ally!.hp);

    // The caster walks up to the far goblin: it is now inside (emanation moves with the caster).
    const mine = turnOf(cast.state, 'me');
    const walk = moveCreature(mine, ctx(1, 4, 4, 4), 'me', [{ x: 6, y: 5 }, { x: 7, y: 6 }, { x: 8, y: 6 }, { x: 9, y: 6 }, { x: 10, y: 6 }, { x: 11, y: 6 }]);
    if (!walk.ok) throw new Error(walk.error);
    expect(walk.events.some((e) => e.text.includes('far enters Spirit Guardians'))).toBe(true);
    expect(walk.state.creatures.far!.hp).toBeLessThan(cast.state.creatures.far!.hp);
  });
});

describe('movable and repeatable zones', () => {
  it('Moonbeam moves up to 60 ft with the Magic action and burns whoever it moves onto', () => {
    const s = setup([
      { c: caster('druid', 3, ['moonbeam']), side: 'party', x: 0, y: 0 },
      { c: goblin('g1'), side: 'enemy', x: 10, y: 10 },
    ]);
    const cast = castInCombat(s, ctx(), { casterId: 'me', spellId: 'moonbeam', targetIds: [], aim: { x: 3, y: 3 } });
    if (!cast.ok) throw new Error(cast.error);
    const next = turnOf(cast.state, 'me');
    expect(zoneAct(next, ctx(), 'me', 'moonbeam:me', { to: { x: 19, y: 19 } }).ok).toBe(false); // > 60 ft
    const moved = zoneAct(next, ctx(1, 5, 5), 'me', 'moonbeam:me', { to: { x: 10, y: 10 } });
    if (!moved.ok) throw new Error(moved.error);
    expect(moved.state.turns.budgets.me!.action).toBe(false);
    expect(moved.state.creatures.g1!.hp).toBeLessThan(next.creatures.g1!.hp);
  });

  it('Spiritual Weapon attacks when cast and again with a Bonus Action after moving', () => {
    const s = setup([
      { c: caster('cleric', 3, ['spiritual_weapon']), side: 'party', x: 0, y: 0 },
      { c: goblin('g1'), side: 'enemy', x: 6, y: 0 },
    ]);
    const cast = castInCombat(s, ctx(19, 6), { casterId: 'me', spellId: 'spiritual_weapon', targetIds: ['g1'], aim: { x: 5, y: 0 } });
    if (!cast.ok) throw new Error(cast.error);
    expect(cast.events.some((e) => e.text.includes('Spiritual Weapon strikes at g1'))).toBe(true);
    expect(cast.state.creatures.g1!.hp).toBeLessThan(s.creatures.g1!.hp);
    const next = turnOf(cast.state, 'me');
    const act = zoneAct(next, ctx(19, 1), 'me', 'spiritual_weapon:me', { to: { x: 7, y: 1 }, targetId: 'g1' });
    if (!act.ok) throw new Error(act.error);
    expect(act.state.turns.budgets.me!.bonusAction).toBe(false);
  });

  it('Call Lightning: another bolt with the Magic action on a later turn', () => {
    const s = setup([
      { c: caster('druid', 5, ['call_lightning']), side: 'party', x: 0, y: 0 },
      { c: goblin('g1'), side: 'enemy', x: 10, y: 0 },
    ]);
    const cast = castInCombat(s, ctx(), { casterId: 'me', spellId: 'call_lightning', targetIds: [], aim: { x: 15, y: 15 } });
    if (!cast.ok) throw new Error(cast.error);
    const bolt = zoneAct(turnOf(cast.state, 'me'), ctx(1, 5, 5, 5), 'me', 'call_lightning:me', { to: { x: 10, y: 0 } });
    if (!bolt.ok) throw new Error(bolt.error);
    expect(bolt.state.creatures.g1!.hp).toBeLessThan(s.creatures.g1!.hp);
  });

  it("Ice Storm's icy ground lasts until the end of the caster's next turn", () => {
    const s = setup([
      { c: caster('wizard', 7, ['ice_storm']), side: 'party', x: 0, y: 0 },
      { c: goblin('g1'), side: 'enemy', x: 15, y: 15 },
    ]);
    const cast = castInCombat(s, ctx(), { casterId: 'me', spellId: 'ice_storm', targetIds: [], aim: { x: 10, y: 10 } });
    if (!cast.ok) throw new Error(cast.error);
    expect(getCell(cast.state.grid, { x: 10, y: 10 }).terrain).toBe('difficult');
    const end1 = zonesAtTurn(cast.state, ctx(), 'me', 'end');
    expect(end1.state.zones).toHaveLength(1);
    const end2 = zonesAtTurn(turnOf(end1.state, 'me'), ctx(), 'me', 'end');
    expect(end2.state.zones).toHaveLength(0);
    expect(getCell(end2.state.grid, { x: 10, y: 10 }).terrain).toBeUndefined();
  });
});

describe('damaging zones', () => {
  it('Black Tentacles: entering deals damage and Restrains on a failed Str save; Wall of Fire burns those ending a turn within 10 ft', () => {
    const s = setup([
      { c: caster('wizard', 7, ['black_tentacles', 'wall_of_fire']), side: 'party', x: 0, y: 0 },
      { c: goblin('g1'), side: 'enemy', x: 12, y: 5 },
      { c: goblin('g2'), side: 'enemy', x: 5, y: 12 },
    ]);
    const bt = castInCombat(s, ctx(), { casterId: 'me', spellId: 'black_tentacles', targetIds: [], aim: { x: 8, y: 5 } });
    if (!bt.ok) throw new Error(bt.error);
    const m = moveCreature(turnOf(bt.state, 'g1'), ctx(1, 3, 3, 3), 'g1', [{ x: 11, y: 5 }, { x: 10, y: 5 }]);
    if (!m.ok) throw new Error(m.error);
    expect(m.state.creatures.g1!.hp).toBeLessThan(s.creatures.g1!.hp);
    expect(hasCondition(m.state.creatures.g1!, 'restrained')).toBe(true);

    const wf = castInCombat(turnOf(s, 'me'), ctx(), { casterId: 'me', spellId: 'wall_of_fire', targetIds: [], aim: { x: 0, y: 10 } });
    if (!wf.ok) throw new Error(wf.error);
    const end = zonesAtTurn(turnOf(wf.state, 'g2'), ctx(1, 4, 4, 4, 4, 4), 'g2', 'end');
    expect(end.state.creatures.g2!.hp).toBeLessThan(s.creatures.g2!.hp);
  });
});
