import { describe, expect, it } from 'vitest';
import { buildCharacter } from '../character/builder';
import { toBuildInput } from '../character/creator';
import { quickBuild } from '../character/quickBuild';
import { Rng } from '../core/rng';
import { loadSrd } from '../data/srdBundle';
import { parseCommand } from '../../shared/protocol';
import { playerAct, setupEncounter, type Encounter } from './encounter';
import { createGrid, moveToken } from './grid';
import { currentId } from './turns';

const db = loadSrd();

/** A fighter against one ogre, re-rolled until the hero is up first and set next to each other. */
function duel(seed: string): { enc: Encounter; ctx: { rng: Rng; db: typeof db } } {
  for (let i = 0; i < 30; i++) {
    const ctx = { rng: Rng.fromSeed(`${seed}-${i}`), db };
    const hero = buildCharacter(toBuildInput(quickBuild('fighter', db, Rng.fromSeed('f'))), db);
    const enc = setupEncounter({ hero: { ...hero, inventory: [...hero.inventory, { uid: 'pot1', itemId: 'potion_of_healing', quantity: 1 }] }, monsters: [{ id: 'ogre', count: 1 }], db, grid: createGrid(10, 8) }, ctx);
    if (enc.status !== 'ongoing' || currentId(enc.state.turns) !== 'hero' || enc.state.turns.round !== 1) continue;
    moveToken(enc.state.grid, enc.heroId, { x: 3, y: 3 });
    moveToken(enc.state.grid, 'ogre_1', { x: 4, y: 3 });
    return { enc, ctx };
  }
  throw new Error('no seed where the hero goes first');
}

describe('player combat actions through the encounter', () => {
  it('the protocol accepts the new action kinds', () => {
    for (const action of [
      { kind: 'grapple', targetId: 'x' },
      { kind: 'shove', targetId: 'x', effect: 'prone' },
      { kind: 'escape_grapple' },
      { kind: 'study', skill: 'arcana', topic: 'the foe' },
      { kind: 'influence', targetId: 'x', skill: 'intimidation' },
      { kind: 'utilize', what: 'a lever' },
      { kind: 'use_item', uid: 'p1' },
      { kind: 'ready', attackProfileId: 'weapon:a:melee' },
      { kind: 'zone', zoneId: 'moonbeam:hero', to: { x: 1, y: 2 } },
      { kind: 'escape_zone', zoneId: 'web:x' },
      { kind: 'move', path: [{ x: 1, y: 1 }], drag: ['x'] },
    ]) {
      expect(parseCommand(JSON.stringify({ type: 'combat_act', action })).ok, JSON.stringify(action)).toBe(true);
    }
    expect(parseCommand(JSON.stringify({ type: 'combat_act', action: { kind: 'study', skill: 'athletics', topic: 'x' } })).ok).toBe(false);
  });

  it('Study and a potion (Bonus Action) on the same turn', () => {
    const { enc, ctx } = duel('study');
    enc.state.creatures.hero!.hp = 3;
    expect(playerAct(enc, ctx, { kind: 'study', skill: 'nature', topic: 'the ogre' })).toBeUndefined();
    expect(enc.log.some((l) => l.includes('studies the ogre'))).toBe(true);
    expect(playerAct(enc, ctx, { kind: 'use_item', uid: 'pot1' })).toBeUndefined();
    expect(enc.state.creatures.hero!.hp).toBeGreaterThan(3);
    expect(playerAct(enc, ctx, { kind: 'utilize', what: 'a lever' })).toBeDefined(); // action already spent
  });

  it('a readied attack fires when the enemy ends its turn within reach', () => {
    const { enc, ctx } = duel('ready');
    Object.assign(enc.state.creatures.hero!, { hp: 200, maxHp: 200 });
    expect(playerAct(enc, ctx, { kind: 'ready' })).toBeUndefined();
    expect(playerAct(enc, ctx, { kind: 'end_turn' })).toBeUndefined();
    const fired = enc.log.some((l) => l.includes('readied action triggers'));
    // The ogre stays in melee (no ranged attack, doesn't flee at full HP), so the Reaction attack happens.
    expect(fired).toBe(true);
  });
});
