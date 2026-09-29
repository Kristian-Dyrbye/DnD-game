import { describe, expect, it } from 'vitest';
import {
  GridSchema,
  canPlace,
  canStep,
  createGrid,
  distanceFt,
  distanceSquares,
  edgeKey,
  footprintSize,
  getCell,
  inBounds,
  isAdjacent,
  isDifficult,
  isOccupied,
  isSolidEdge,
  isWallEdge,
  moveToken,
  occupantsAt,
  placeToken,
  removeToken,
  setCell,
  setDoorOpen,
  setEdge,
  tokenSquares,
  withinReach,
  type GridToken,
} from './grid';

const tok = (id: string, x: number, y: number, size: GridToken['size'] = 'medium'): GridToken => ({ id, x, y, size });

describe('grid basics', () => {
  it('bounds', () => {
    const g = createGrid(5, 4);
    expect(inBounds(g, { x: 0, y: 0 })).toBe(true);
    expect(inBounds(g, { x: 4, y: 3 })).toBe(true);
    expect(inBounds(g, { x: 5, y: 0 })).toBe(false);
    expect(inBounds(g, { x: 0, y: 4 })).toBe(false);
    expect(inBounds(g, { x: -1, y: 2 })).toBe(false);
  });

  it('cells are sparse and merge patches', () => {
    const g = createGrid(5, 5);
    expect(getCell(g, { x: 1, y: 1 })).toEqual({});
    setCell(g, { x: 1, y: 1 }, { terrain: 'difficult', hazards: ['fire'] });
    expect(isDifficult(g, { x: 1, y: 1 })).toBe(true);
    setCell(g, { x: 1, y: 1 }, { terrain: undefined, hazards: undefined });
    expect(g.cells).toEqual({});
  });

  it('canonical edge keys: E/S map onto the neighbour W/N', () => {
    expect(edgeKey(2, 3, 'E')).toBe(edgeKey(3, 3, 'W'));
    expect(edgeKey(2, 3, 'S')).toBe(edgeKey(2, 4, 'N'));
    const g = createGrid(5, 5);
    setEdge(g, 2, 2, 'E', { kind: 'wall' });
    expect(isWallEdge(g, 3, 2, 'W')).toBe(true);
    setEdge(g, 3, 2, 'W', undefined);
    expect(isWallEdge(g, 2, 2, 'E')).toBe(false);
  });

  it('doors block only while closed; blocking squares make their faces solid', () => {
    const g = createGrid(5, 5);
    setEdge(g, 1, 1, 'N', { kind: 'door' });
    expect(isWallEdge(g, 1, 1, 'N')).toBe(true);
    expect(setDoorOpen(g, 1, 0, 'S', true)).toBe(true);
    expect(isWallEdge(g, 1, 1, 'N')).toBe(false);
    expect(setDoorOpen(g, 3, 3, 'N', true)).toBe(false);
    setCell(g, { x: 3, y: 3 }, { blocking: true });
    expect(isSolidEdge(g, 2, 3, 'E')).toBe(true);
    expect(isSolidEdge(g, 3, 4, 'N')).toBe(true);
    expect(isWallEdge(g, 2, 3, 'E')).toBe(false);
  });

  it('round-trips through JSON and the schema', () => {
    const g = createGrid(6, 6);
    setCell(g, { x: 2, y: 2 }, { blocking: true });
    setEdge(g, 1, 1, 'E', { kind: 'door', open: false });
    placeToken(g, tok('hero', 0, 0));
    const back = GridSchema.parse(JSON.parse(JSON.stringify(g)));
    expect(back).toEqual(g);
  });
});

describe('tokens', () => {
  it('footprint by size', () => {
    expect(footprintSize('tiny')).toBe(1);
    expect(footprintSize('small')).toBe(1);
    expect(footprintSize('medium')).toBe(1);
    expect(footprintSize('large')).toBe(2);
    expect(footprintSize('huge')).toBe(3);
    expect(footprintSize('gargantuan')).toBe(4);
    expect(tokenSquares(tok('o', 2, 3, 'large'))).toEqual([
      { x: 2, y: 3 },
      { x: 3, y: 3 },
      { x: 2, y: 4 },
      { x: 3, y: 4 },
    ]);
    expect(tokenSquares(tok('g', 0, 0, 'gargantuan'))).toHaveLength(16);
  });

  it('occupancy, placement and movement', () => {
    const g = createGrid(8, 8);
    placeToken(g, tok('ogre', 2, 2, 'large'));
    expect(occupantsAt(g, { x: 3, y: 3 })).toEqual(['ogre']);
    expect(isOccupied(g, { x: 4, y: 3 })).toBe(false);
    expect(isOccupied(g, { x: 3, y: 3 }, ['ogre'])).toBe(false);
    expect(canPlace(g, 'medium', { x: 1, y: 1 })).toBe(true);
    expect(canPlace(g, 'large', { x: 1, y: 1 })).toBe(false);
    expect(canPlace(g, 'large', { x: 1, y: 1 }, ['ogre'])).toBe(true);
    expect(canPlace(g, 'huge', { x: 6, y: 0 })).toBe(false); // off-grid
    setCell(g, { x: 5, y: 5 }, { blocking: true });
    expect(canPlace(g, 'medium', { x: 5, y: 5 })).toBe(false);
    moveToken(g, 'ogre', { x: 5, y: 0 });
    expect(isOccupied(g, { x: 2, y: 2 })).toBe(false);
    expect(isOccupied(g, { x: 6, y: 1 })).toBe(true);
    removeToken(g, 'ogre');
    expect(Object.keys(g.tokens)).toEqual([]);
    expect(() => moveToken(g, 'ogre', { x: 0, y: 0 })).toThrow();
  });
});

describe('distance (every square 5 ft, diagonals included)', () => {
  it('orthogonal and diagonal', () => {
    expect(distanceFt(tok('a', 0, 0), tok('b', 3, 0))).toBe(15);
    expect(distanceFt(tok('a', 0, 0), tok('b', 3, 3))).toBe(15);
    expect(distanceFt(tok('a', 0, 0), tok('b', 2, 5))).toBe(25);
    expect(distanceFt(tok('a', 4, 4), tok('b', 1, 2))).toBe(15);
  });

  it('measures between the closest squares of large footprints', () => {
    const ogre = tok('o', 2, 2, 'large'); // covers 2..3
    expect(distanceSquares(ogre, tok('h', 4, 3))).toBe(1);
    expect(distanceFt(ogre, tok('h', 6, 0))).toBe(15);
    expect(distanceFt(ogre, tok('h', 0, 0))).toBe(10);
    expect(distanceFt(tok('d', 0, 0, 'huge'), tok('g', 5, 5, 'gargantuan'))).toBe(15);
    expect(distanceSquares(ogre, tok('in', 3, 3))).toBe(0);
  });

  it('adjacency and reach', () => {
    const a = tok('a', 3, 3);
    expect(isAdjacent(a, tok('b', 4, 4))).toBe(true);
    expect(isAdjacent(a, tok('b', 5, 3))).toBe(false);
    expect(withinReach(a, tok('b', 5, 3), 5)).toBe(false);
    expect(withinReach(a, tok('b', 5, 5), 10)).toBe(true);
    expect(withinReach(tok('o', 0, 0, 'large'), tok('b', 3, 1), 10)).toBe(true);
    expect(isAdjacent(tok('o', 0, 0, 'large'), tok('b', 2, 2))).toBe(true);
  });
});

describe('canStep', () => {
  it('walls, doors and blocking squares stop orthogonal steps', () => {
    const g = createGrid(5, 5);
    expect(canStep(g, { x: 1, y: 1 }, { x: 2, y: 1 })).toBe(true);
    expect(canStep(g, { x: 1, y: 1 }, { x: 3, y: 1 })).toBe(false); // not adjacent
    expect(canStep(g, { x: 0, y: 0 }, { x: -1, y: 0 })).toBe(false);
    setEdge(g, 1, 1, 'E', { kind: 'door' });
    expect(canStep(g, { x: 1, y: 1 }, { x: 2, y: 1 })).toBe(false);
    expect(canStep(g, { x: 2, y: 1 }, { x: 1, y: 1 })).toBe(false);
    setDoorOpen(g, 1, 1, 'E', true);
    expect(canStep(g, { x: 2, y: 1 }, { x: 1, y: 1 })).toBe(true);
    setCell(g, { x: 1, y: 2 }, { blocking: true });
    expect(canStep(g, { x: 1, y: 1 }, { x: 1, y: 2 })).toBe(false);
  });

  it('diagonal steps squeeze past one corner but not through a sealed corner', () => {
    const g = createGrid(5, 5);
    setCell(g, { x: 2, y: 1 }, { blocking: true });
    expect(canStep(g, { x: 1, y: 1 }, { x: 2, y: 2 })).toBe(true); // grazes one pillar corner
    setCell(g, { x: 1, y: 2 }, { blocking: true });
    expect(canStep(g, { x: 1, y: 1 }, { x: 2, y: 2 })).toBe(false); // two pillars touching
    const w = createGrid(5, 5);
    setEdge(w, 2, 1, 'W', { kind: 'wall' });
    setEdge(w, 2, 2, 'W', { kind: 'wall' });
    expect(canStep(w, { x: 1, y: 1 }, { x: 2, y: 2 })).toBe(false); // straight wall
  });
});
