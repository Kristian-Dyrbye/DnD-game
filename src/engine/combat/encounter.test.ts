import { describe, expect, it } from 'vitest';
import { buildCharacter } from '../character/builder';
import { toBuildInput } from '../character/creator';
import { quickBuild } from '../character/quickBuild';
import { Rng } from '../core/rng';
import { loadSrd } from '../data/srdBundle';
import { attackProfiles } from './attack';
import { createGrid, isAdjacent, moveToken } from './grid';
import { defaultArena, playerAct, setupEncounter } from './encounter';
import { currentId } from './turns';

const db = loadSrd();
const hero = () => buildCharacter(toBuildInput(quickBuild('fighter', db, Rng.fromSeed('f'))), db);

describe('encounter controller', () => {
  it('sets up tokens, initiative and hands the turn to the hero', () => {
    const ctx = { rng: Rng.fromSeed(1), db };
    const enc = setupEncounter({ hero: hero(), monsters: [{ id: 'goblin_warrior', count: 2 }], db }, ctx);
    expect(Object.keys(enc.state.grid.tokens).sort()).toEqual(['goblin_warrior_1', 'goblin_warrior_2', 'hero']);
    expect(enc.log[0]).toBe('Roll for initiative!');
    expect(enc.log.some((l) => /d20/.test(l))).toBe(true);
    expect(enc.status === 'ongoing' ? currentId(enc.state.turns) : enc.heroId).toBe('hero');
  });

  it('merges split groups of the same monster so every creature id is unique', () => {
    const ctx = { rng: Rng.fromSeed(1), db };
    const enc = setupEncounter({ hero: hero(), monsters: [{ id: 'goblin_warrior', count: 2 }, { id: 'goblin_boss', count: 1 }, { id: 'goblin_warrior', count: 1 }], db }, ctx);
    expect(Object.keys(enc.state.creatures).sort()).toEqual(['goblin_boss_1', 'goblin_warrior_1', 'goblin_warrior_2', 'goblin_warrior_3', 'hero']);
    expect(enc.state.turns.order.length).toBe(5);
  });

  it('refuses actions out of turn and runs to a conclusion deterministically', () => {
    const run = (seed: number) => {
      const ctx = { rng: Rng.fromSeed(seed), db };
      const enc = setupEncounter({ hero: hero(), monsters: [{ id: 'goblin_warrior', count: 1 }], db }, ctx);
      for (let i = 0; i < 60 && enc.status === 'ongoing'; i++) {
        const me = enc.state.grid.tokens.hero!;
        const foe = Object.values(enc.state.grid.tokens).find((t) => t.id !== 'hero');
        if (foe && isAdjacent(me, foe)) {
          const profile = attackProfiles(enc.state.creatures.hero!, db).find((p) => p.melee);
          playerAct(enc, ctx, { kind: 'attack', targetId: foe.id, ...(profile && { profileId: profile.id }) });
        }
        playerAct(enc, ctx, { kind: 'end_turn' });
      }
      return enc;
    };
    const a = run(7);
    expect(['won', 'lost']).toContain(a.status);
    expect(run(7).log).toEqual(a.log);
    expect(playerAct(a, { rng: Rng.fromSeed(1), db }, { kind: 'dodge' })).toBe('The fight is over.');
  });

  it('attacks resolve with visible math when adjacent', () => {
    const ctx = { rng: Rng.fromSeed(2), db };
    const grid = createGrid(8, 6);
    const enc = setupEncounter({ hero: hero(), monsters: [{ id: 'goblin_warrior', count: 1 }], db, grid }, ctx);
    if (enc.status !== 'ongoing') return;
    const foe = Object.keys(enc.state.grid.tokens).find((k) => k !== 'hero')!;
    const f = enc.state.grid.tokens[foe]!;
    moveToken(enc.state.grid, 'hero', { x: f.x - 1, y: f.y });
    const err = playerAct(enc, ctx, { kind: 'attack', targetId: foe });
    expect(err).toBeUndefined();
    expect(enc.log.some((l) => /vs AC/.test(l))).toBe(true);
    expect(playerAct(enc, ctx, { kind: 'attack', targetId: foe })).toBeDefined(); // action already used (or no attacks left)
  });

  it('default arena is seeded', () => {
    expect(defaultArena(Rng.fromSeed(3))).toEqual(defaultArena(Rng.fromSeed(3)));
  });
});
