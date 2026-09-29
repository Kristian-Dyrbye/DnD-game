import { describe, expect, it } from 'vitest';
import { createGrid, placeToken, setCell, setDoorOpen, setEdge, type Grid, type GridToken } from './grid';
import { COVER_BONUS, computeCover, hasLineOfSight, traceLine } from './los';

const tok = (id: string, x: number, y: number, size: GridToken['size'] = 'medium'): GridToken => ({ id, x, y, size });

function field(w = 10, h = 10): Grid {
  return createGrid(w, h);
}

/** Vertical wall on the line x = wx, for rows y0..y1-1. */
function wallX(g: Grid, wx: number, y0: number, y1: number): void {
  for (let y = y0; y < y1; y++) setEdge(g, wx, y, 'W', { kind: 'wall' });
}

describe('traceLine', () => {
  it('open field is clear and lists crossed squares', () => {
    const r = traceLine(field(), { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 3, y: 1 }, { x: 2, y: 0 });
    expect(r.blocked).toBe(false);
    expect(r.cells).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ]);
  });

  it('grazing a pillar corner does not block; cutting through it does', () => {
    const g = field();
    setCell(g, { x: 1, y: 1 }, { blocking: true });
    // (0,0) -> (4,2) touches the pillar's top-right corner (2,1) only
    expect(traceLine(g, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 4, y: 2 }, { x: 3, y: 1 }).blocked).toBe(false);
    const h = field();
    setCell(h, { x: 2, y: 1 }, { blocking: true });
    expect(traceLine(h, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 4, y: 2 }, { x: 3, y: 1 }).blocked).toBe(true);
  });

  it('two pillars touching diagonally seal the gap between them', () => {
    const g = field();
    setCell(g, { x: 1, y: 1 }, { blocking: true });
    setCell(g, { x: 2, y: 0 }, { blocking: true });
    expect(traceLine(g, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 4, y: 2 }, { x: 3, y: 1 }).blocked).toBe(true);
  });

  it('a line through a wall joint is blocked; past a free wall end it is not', () => {
    const g = field();
    wallX(g, 3, 0, 2); // x = 3 from y 0 to 2, joint at (3,1)
    expect(traceLine(g, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 6, y: 2 }, { x: 5, y: 1 }).blocked).toBe(true);
    const h = field();
    wallX(h, 3, 0, 1); // ends at (3,1)
    expect(traceLine(h, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 6, y: 2 }, { x: 5, y: 1 }).blocked).toBe(false);
  });

  it('a line along a wall cannot switch sides through it', () => {
    const g = field();
    wallX(g, 3, 0, 10);
    // attacker (2,4) and target (3,4) adjacent across the wall: the shared edge line is blocked
    expect(traceLine(g, { x: 3, y: 4 }, { x: 2, y: 4 }, { x: 3, y: 5 }, { x: 3, y: 4 }).blocked).toBe(true);
    expect(traceLine(g, { x: 3, y: 4 }, { x: 2, y: 4 }, { x: 3, y: 4 }, { x: 3, y: 4 }).blocked).toBe(true);
    // same side: running along the face is fine
    expect(traceLine(g, { x: 3, y: 2 }, { x: 2, y: 2 }, { x: 3, y: 5 }, { x: 2, y: 4 }).blocked).toBe(false);
  });

  it('is symmetric on random layouts', () => {
    let seed = 12345;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    for (let trial = 0; trial < 30; trial++) {
      const g = field(8, 8);
      for (let i = 0; i < 8; i++) setCell(g, { x: rnd(8), y: rnd(8) }, { blocking: true });
      for (let i = 0; i < 10; i++) setEdge(g, rnd(8), rnd(8), rnd(2) ? 'N' : 'W', { kind: 'wall' });
      for (let i = 0; i < 40; i++) {
        const p = { x: rnd(9), y: rnd(9) };
        const q = { x: rnd(9), y: rnd(9) };
        // owners: a square touching each corner (clamped into the grid)
        const po = { x: Math.min(7, p.x), y: Math.min(7, p.y) };
        const qo = { x: Math.max(0, q.x - 1), y: Math.max(0, q.y - 1) };
        const ab = traceLine(g, p, po, q, qo).blocked;
        const ba = traceLine(g, q, qo, p, po).blocked;
        expect(ab).toBe(ba);
      }
    }
  });
});

describe('line of sight', () => {
  it('open field', () => {
    const g = field();
    placeToken(g, tok('a', 0, 0));
    placeToken(g, tok('t', 7, 3));
    expect(hasLineOfSight(g, 'a', 't')).toBe(true);
    expect(computeCover(g, 'a', 't')).toEqual({ cover: 'none', acBonus: 0, dexSaveBonus: 0, los: true });
  });

  it('a full wall blocks sight both ways', () => {
    const g = field();
    wallX(g, 3, 0, 10);
    placeToken(g, tok('a', 1, 4));
    placeToken(g, tok('t', 5, 4));
    expect(hasLineOfSight(g, 'a', 't')).toBe(false);
    expect(hasLineOfSight(g, 't', 'a')).toBe(false);
    expect(computeCover(g, 'a', 't').cover).toBe('total');
    expect(computeCover(g, 'a', 't').los).toBe(false);
  });

  it('adjacent creatures separated by a wall cannot see each other', () => {
    const g = field();
    wallX(g, 3, 0, 10);
    placeToken(g, tok('a', 2, 4));
    placeToken(g, tok('t', 3, 4));
    expect(hasLineOfSight(g, 'a', 't')).toBe(false);
  });

  it('closed door blocks, open door does not', () => {
    const g = field();
    wallX(g, 3, 0, 10);
    setEdge(g, 3, 4, 'W', { kind: 'door', open: false });
    placeToken(g, tok('a', 1, 4));
    placeToken(g, tok('t', 5, 4));
    expect(hasLineOfSight(g, 'a', 't')).toBe(false);
    setDoorOpen(g, 3, 4, 'W', true);
    expect(hasLineOfSight(g, 'a', 't')).toBe(true);
    expect(computeCover(g, 'a', 't').cover).toBe('none');
    // well off to the side of the doorway: still hidden
    placeToken(g, tok('t2', 4, 0));
    expect(hasLineOfSight(g, 'a', 't2')).toBe(false);
  });

  it('seeing around a pillar', () => {
    const g = field();
    setCell(g, { x: 3, y: 3 }, { blocking: true });
    placeToken(g, tok('a', 1, 3));
    placeToken(g, tok('t', 5, 3));
    expect(hasLineOfSight(g, 'a', 't')).toBe(true); // along the pillar faces
    // a long thick wall hides completely
    for (let y = 0; y < 10; y++) setCell(g, { x: 3, y }, { blocking: true });
    expect(hasLineOfSight(g, 'a', 't')).toBe(false);
  });
});

describe('cover', () => {
  it('bonuses', () => {
    expect(COVER_BONUS).toEqual({ none: 0, half: 2, three_quarters: 5, total: 0 });
  });

  it('a creature in between gives half cover (optional, ignorable)', () => {
    const g = field();
    placeToken(g, tok('a', 0, 4));
    placeToken(g, tok('ally', 2, 4));
    placeToken(g, tok('t', 4, 4));
    expect(computeCover(g, 'a', 't')).toEqual({ cover: 'half', acBonus: 2, dexSaveBonus: 2, los: true });
    expect(computeCover(g, 'a', 't', { creaturesGiveCover: false }).cover).toBe('none');
    expect(computeCover(g, 'a', 't', { ignoreIds: ['ally'] }).cover).toBe('none');
    // creatures never block sight
    expect(hasLineOfSight(g, 'a', 't')).toBe(true);
  });

  it('a large creature in between still gives only half cover', () => {
    const g = field();
    placeToken(g, tok('a', 0, 4));
    placeToken(g, tok('ogre', 2, 3, 'large'));
    placeToken(g, tok('t', 5, 4));
    expect(computeCover(g, 'a', 't').cover).toBe('half');
  });

  it('a pillar squarely between gives half cover', () => {
    const g = field();
    setCell(g, { x: 2, y: 4 }, { blocking: true });
    placeToken(g, tok('a', 0, 4));
    placeToken(g, tok('t', 4, 4));
    expect(computeCover(g, 'a', 't').cover).toBe('half');
    expect(computeCover(g, 't', 'a').cover).toBe('half');
  });

  it('a low wall grants its cover grade without blocking sight', () => {
    const g = field();
    for (let y = 0; y < 10; y++) setCell(g, { x: 3, y }, { coverObstacle: 'half' });
    placeToken(g, tok('a', 0, 4));
    placeToken(g, tok('t', 5, 4));
    expect(computeCover(g, 'a', 't').cover).toBe('half');
    setCell(g, { x: 3, y: 4 }, { coverObstacle: 'three_quarters' });
    expect(computeCover(g, 'a', 't').cover).toBe('three_quarters');
    expect(hasLineOfSight(g, 'a', 't')).toBe(true);
  });

  it('an arrow slit in a thick wall gives three-quarters cover', () => {
    const g = field();
    for (let y = 0; y < 10; y++) if (y !== 4) setCell(g, { x: 3, y }, { blocking: true });
    placeToken(g, tok('archer', 2, 4));
    placeToken(g, tok('t', 4, 2));
    expect(computeCover(g, 'archer', 't').cover).toBe('three_quarters');
    expect(computeCover(g, 't', 'archer')).toEqual({ cover: 'three_quarters', acBonus: 5, dexSaveBonus: 5, los: true });
    placeToken(g, tok('far', 5, 0));
    expect(computeCover(g, 'far', 'archer').cover).toBe('total');
    // straight through the slit: clear
    placeToken(g, tok('front', 6, 4));
    expect(computeCover(g, 'front', 'archer').cover).toBe('none');
  });

  it('large target partly behind a wall: the attacker uses the best square', () => {
    const g = field();
    wallX(g, 4, 0, 4); // wall on x = 4, rows 0..3
    placeToken(g, tok('a', 1, 2));
    placeToken(g, tok('ogre', 5, 3, 'large')); // rows 3..4; row 4 is visible under the wall end
    const c = computeCover(g, 'a', 'ogre');
    expect(c.los).toBe(true);
    expect(c.cover).not.toBe('total');
    // move the ogre fully behind the wall
    placeToken(g, tok('ogre', 5, 0, 'large'));
    expect(computeCover(g, 'a', 'ogre').cover).toBe('total');
  });

  it('accepts bare footprints', () => {
    const g = field();
    expect(computeCover(g, { x: 0, y: 0, size: 'medium' }, { x: 5, y: 5, size: 'huge' }).cover).toBe('none');
  });
});

describe('map border', () => {
  it('acts like a wall: no line slips round a wall end that touches the edge', () => {
    const g = field();
    // Wall along the top of row 5 from the west border to x = 5.
    for (let x = 0; x < 5; x++) setEdge(g, x, 5, 'N', { kind: 'wall' });
    expect(hasLineOfSight(g, tok('a', 0, 7), tok('t', 0, 2))).toBe(false);
    expect(computeCover(g, tok('a', 0, 7), tok('t', 0, 2)).cover).toBe('total');
    // The open end of the wall still lets lines through.
    expect(hasLineOfSight(g, tok('a', 6, 7), tok('t', 6, 2))).toBe(true);
  });

  it('lines along the border itself are not blocked', () => {
    const g = field();
    expect(computeCover(g, tok('a', 0, 0), tok('t', 0, 9)).cover).toBe('none');
    expect(computeCover(g, tok('a', 0, 0), tok('t', 9, 0)).cover).toBe('none');
  });
});
