import { describe, expect, it } from 'vitest';
import defeatsJson from '../../../data/tables/defeat-outcomes.json';
import demo from '../../../data/adventures/demo/millbrook_demo.json';
import flagsJson from '../../../data/adventures/flags.json';
import loreJson from '../../../data/world/lore.json';
import type { ServerEvent } from '../../shared/protocol';
import { DefeatTableSchema } from '../adventure/defeat';
import { activeFight } from '../adventure/fights';
import { adventureActionPort } from '../adventure/sessionActions';
import { validateAdventure } from '../adventure/validate';
import { buildCharacter } from '../character/builder';
import { toBuildInput } from '../character/creator';
import { quickBuild } from '../character/quickBuild';
import { canStep, getEdge, isBlockingSquare } from '../combat/grid';
import { Rng } from '../core/rng';
import { loadSrd } from '../data/srdBundle';
import { GameSession } from '../session/GameSession';
import { createDefaultRegistry } from '../systems';
import { buildDungeonGrid, checkDungeonMap, DungeonMapSchema, fogSquares, roomAt, roomSpawns, type DungeonMap } from './dungeon';
import { FlagRegistry } from './flags';
import { LoreSchema } from './lore';

const db = loadSrd();
const adventure = validateAdventure(structuredClone(demo), db).adventure!;
const mill = adventure.maps.find((m) => m.id === 'old_mill')!;

describe('dungeon maps', () => {
  it('builds a grid: rock outside rooms, doors between rooms, pillars and rubble', () => {
    const g = buildDungeonGrid(mill);
    expect(isBlockingSquare(g, { x: 0, y: 0 })).toBe(true); // rock
    expect(isBlockingSquare(g, { x: 2, y: 2 })).toBe(false); // mill floor
    expect(isBlockingSquare(g, { x: 4, y: 2 })).toBe(true); // pillar
    expect(g.cells['5,10']?.terrain).toBe('difficult');
    expect(getEdge(g, 4, 5, 'S')).toMatchObject({ kind: 'door', open: true });
    expect(canStep(g, { x: 4, y: 5 }, { x: 4, y: 6 })).toBe(true);
    expect(canStep(g, { x: 3, y: 5 }, { x: 3, y: 6 })).toBe(false); // rock below the mill floor
  });

  it('locked doors start closed; the validator catches overlapping rooms and doors that join nothing', () => {
    const locked: DungeonMap = { ...mill, doors: [{ x: 4, y: 5, side: 'S', locked: true }] };
    expect(getEdge(buildDungeonGrid(locked), 4, 5, 'S')).toMatchObject({ kind: 'door', open: false });
    expect(getEdge(buildDungeonGrid(locked, { unlocked: ['4,5,S'] }), 4, 5, 'S')).toMatchObject({ open: true });
    const bad = DungeonMapSchema.parse({
      id: 'bad',
      name: 'Bad',
      width: 6,
      height: 6,
      rooms: [
        { id: 'a', name: 'A', x: 0, y: 0, w: 3, h: 3 },
        { id: 'b', name: 'B', x: 2, y: 2, w: 3, h: 3 },
      ],
      doors: [{ x: 5, y: 5, side: 'E' }],
    });
    const problems = checkDungeonMap(bad);
    expect(problems.some((p) => p.includes('overlap'))).toBe(true);
    expect(problems.some((p) => p.includes("doesn't join two rooms"))).toBe(true);
  });

  it('fog hides unrevealed rooms and far rock; revealed rooms show their outline', () => {
    const none = fogSquares(mill, []);
    expect(none.size).toBe(mill.width * mill.height);
    const some = fogSquares(mill, ['mill_floor']);
    expect(some.has('2,2')).toBe(false);
    expect(some.has('0,0')).toBe(false); // rock touching the room
    expect(some.has('2,8')).toBe(true); // cellar still hidden
    expect(roomAt(mill, { x: 2, y: 8 })?.id).toBe('cellar');
  });

  it('fight spawns: party by the door they came through, foes at the far side', () => {
    const s = roomSpawns(mill, 'cellar', 'stairs');
    expect(s.party[0]).toEqual({ x: 4, y: 7 });
    const far = s.foes[0]!;
    expect(Math.max(Math.abs(far.x - 4), Math.abs(far.y - 7))).toBeGreaterThanOrEqual(4);
  });
});

describe('exploration flows into combat on the same map', () => {
  it('rooms are revealed as the party explores; the cellar fight uses the dungeon grid with fog', async () => {
    const session = new GameSession({
      actions: adventureActionPort(new Map([[adventure.id, adventure]]), adventure.id, db, {
        lore: LoreSchema.parse(loreJson),
        flags: FlagRegistry.fromJson(flagsJson),
        defeats: DefeatTableSchema.parse(defeatsJson),
      }),
      systems: createDefaultRegistry({ lore: LoreSchema.parse(loreJson) }),
      newSeed: () => 'dungeon',
      saves: {
        save: () => {
          throw new Error('no');
        },
        autosave: (m) => ({ ...m, slotId: 'auto-1', kind: 'auto', savedAt: 'now' }),
        load: () => {
          throw new Error('no');
        },
      },
    });
    const events: ServerEvent[] = [];
    session.on((e) => events.push(e));
    await session.handle({ type: 'new_game', hero: buildCharacter(toBuildInput(quickBuild('fighter', db, Rng.fromSeed('d'))), db), mode: 'heroic' });
    const lastView = () => [...events].reverse().find((e): e is Extract<ServerEvent, { type: 'dungeon' }> => e.type === 'dungeon')?.view;
    expect(lastView()).toBeNull(); // the square has no map
    await session.handle({ type: 'choose', actionId: 'talk_mayor' });
    await session.handle({ type: 'choose', actionId: 'exit.to_mill' });
    expect(lastView()).toMatchObject({ room: 'mill_floor', revealed: ['mill_floor'] });
    await session.handle({ type: 'choose', actionId: 'exit.unlock' });
    const f = activeFight(session.current);
    expect(f).toBeDefined();
    const grid = f!.enc.state.grid;
    expect(grid.width).toBe(mill.width);
    // Everyone stands in the cellar.
    for (const t of Object.values(grid.tokens)) expect(roomAt(mill, t)?.id).toBe('cellar');
    // The mill floor and cellar are revealed; the stairs square is still under fog.
    expect(f!.enc.fog).toContain('4,6');
    expect(f!.enc.fog).not.toContain('2,8');
    expect(f!.enc.fog).not.toContain('2,2');
  });
});
