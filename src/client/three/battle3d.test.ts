import { describe, expect, it } from 'vitest';
import { createGrid, placeToken, setCell, setEdge } from '../../engine/combat/grid';
import type { Creatures } from '../../engine/combat/turns';
import { edgeSegments, hpColour, modelTokens, overlayFor, terrainOf, tokenCentre, worldToSquare } from './battle3d';

describe('3D battle map helpers', () => {
  it('maps squares and world points both ways', () => {
    const g = createGrid(10, 8);
    expect(worldToSquare(g, 3.7, 2.1)).toEqual({ x: 3, y: 2 });
    expect(worldToSquare(g, -0.1, 2)).toBeNull();
    expect(worldToSquare(g, 10.2, 2)).toBeNull();
    expect(tokenCentre({ x: 2, y: 3, size: 'large' })).toEqual({ x: 3, z: 4 });
    expect(tokenCentre({ x: 2, y: 3, size: 'medium' })).toEqual({ x: 2.5, z: 3.5 });
  });

  it('overlay priority: area preview > zones > reachable', () => {
    const sets = { reachable: new Set(['1,1', '2,2']), zones: new Set(['2,2', '3,3']), aoe: new Set(['3,3']) };
    expect(overlayFor('1,1', sets)?.color).toBe(0x78c8ff);
    expect(overlayFor('2,2', sets)?.color).toBe(0xaa6eff);
    expect(overlayFor('3,3', sets)?.color).toBe(0xff7828);
    expect(overlayFor('9,9', sets)).toBeNull();
  });

  it('terrain, walls and doors', () => {
    const g = createGrid(5, 5);
    setCell(g, { x: 1, y: 1 }, { blocking: true });
    setCell(g, { x: 2, y: 1 }, { terrain: 'difficult' });
    setEdge(g, 3, 3, 'N', { kind: 'wall' });
    setEdge(g, 3, 3, 'W', { kind: 'door', open: true });
    expect(terrainOf(g, 1, 1)).toBe('blocking');
    expect(terrainOf(g, 2, 1)).toBe('difficult');
    expect(terrainOf(g, 0, 0)).toBe('normal');
    expect(edgeSegments(g)).toEqual([
      { x0: 3, z0: 3, x1: 4, z1: 3, door: false, open: false },
      { x0: 3, z0: 3, x1: 3, z1: 4, door: true, open: true },
    ]);
  });

  it('full models for characters with an appearance, party first, capped', () => {
    const g = createGrid(5, 5);
    for (const [i, id] of ['foe_pc', 'hero', 'goblin'].entries()) placeToken(g, { id, x: i, y: 0, size: 'medium' });
    const creatures = {
      hero: { kind: 'character', appearance: { outfit: 'knight' } },
      foe_pc: { kind: 'character', appearance: { outfit: 'rogue' } },
      goblin: { kind: 'monster' },
    } as unknown as Creatures;
    const sides = { hero: 'party', foe_pc: 'enemy', goblin: 'enemy' };
    expect([...modelTokens(g, creatures, sides, 5)]).toEqual(['hero', 'foe_pc']);
    expect([...modelTokens(g, creatures, sides, 1)]).toEqual(['hero']);
    expect(hpColour(10, 10)).toBe(0x6fd06f);
    expect(hpColour(1, 10)).toBe(0xe0483e);
  });
});
