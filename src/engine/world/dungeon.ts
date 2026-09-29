/**
 * Dungeon and building maps with fog of war (spec §11.1), built on the combat grid engine.
 *
 * A map is data inside an adventure (`maps`): rooms are rectangles of squares, doors sit on the
 * edge between two squares, pillars are blocking squares. `buildDungeonGrid` turns it into a
 * combat Grid: squares outside every room are solid rock, edges between two different rooms are
 * walls, door edges are doors (locked doors start closed).
 *
 * Scenes point at `{ map, room }`. Entering such a scene reveals that room (state.extensions.dungeon
 * [mapId].revealed); everything else stays under fog. A fight that starts in a mapped scene uses the
 * same grid (the party enters by the room's door, foes stand at the far side), so exploration flows
 * straight into combat on the same map.
 */
import { z } from 'zod';
import { cellKey, createGrid, setCell, setEdge, type Grid, type Point } from '../combat/grid';

const Id = z.string().regex(/^[a-z0-9_]+$/);

export const DungeonRoomSchema = z
  .object({
    id: Id,
    name: z.string(),
    x: z.number().int().min(0),
    y: z.number().int().min(0),
    w: z.number().int().min(1),
    h: z.number().int().min(1),
    /** Difficult squares inside the room (rubble, water). */
    difficult: z.array(z.object({ x: z.number().int(), y: z.number().int() })).default([]),
    /** Pillars / furniture that block movement and sight. */
    blocking: z.array(z.object({ x: z.number().int(), y: z.number().int() })).default([]),
  })
  .strict();

export const DungeonDoorSchema = z
  .object({
    /** The square on one side of the door and the side the door is on. */
    x: z.number().int(),
    y: z.number().int(),
    side: z.enum(['N', 'E', 'S', 'W']),
    locked: z.boolean().default(false),
  })
  .strict();

export const DungeonMapSchema = z
  .object({
    id: Id,
    name: z.string(),
    width: z.number().int().min(2).max(60),
    height: z.number().int().min(2).max(60),
    rooms: z.array(DungeonRoomSchema).min(1),
    doors: z.array(DungeonDoorSchema).default([]),
  })
  .strict();
export type DungeonMap = z.infer<typeof DungeonMapSchema>;
export type DungeonRoom = z.infer<typeof DungeonRoomSchema>;

const inRoom = (r: DungeonRoom, p: Point) => p.x >= r.x && p.y >= r.y && p.x < r.x + r.w && p.y < r.y + r.h;

/** The room a square belongs to. */
export function roomAt(map: DungeonMap, p: Point): DungeonRoom | undefined {
  return map.rooms.find((r) => inRoom(r, p));
}

export function roomSquares(r: DungeonRoom): Point[] {
  const out: Point[] = [];
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) out.push({ x, y });
  return out;
}

const STEP: Record<'N' | 'E' | 'S' | 'W', Point> = { N: { x: 0, y: -1 }, E: { x: 1, y: 0 }, S: { x: 0, y: 1 }, W: { x: -1, y: 0 } };

/** Problems with a map (rooms off the map or overlapping, doors not between two rooms). */
export function checkDungeonMap(map: DungeonMap): string[] {
  const problems: string[] = [];
  const seen = new Map<string, string>();
  for (const r of map.rooms) {
    if (r.x + r.w > map.width || r.y + r.h > map.height) problems.push(`map ${map.id}: room ${r.id} is outside the map`);
    for (const s of roomSquares(r)) {
      const k = cellKey(s);
      if (seen.has(k)) problems.push(`map ${map.id}: rooms ${seen.get(k)} and ${r.id} overlap at ${k}`);
      seen.set(k, r.id);
    }
  }
  for (const d of map.doors) {
    const a = roomAt(map, d);
    const b = roomAt(map, { x: d.x + STEP[d.side].x, y: d.y + STEP[d.side].y });
    if (!a || !b || a === b) problems.push(`map ${map.id}: door at ${d.x},${d.y},${d.side} doesn't join two rooms`);
  }
  return problems;
}

/** The combat grid for a map: rock outside rooms, walls between rooms, doors where listed. */
export function buildDungeonGrid(map: DungeonMap, opts: { unlocked?: readonly string[] } = {}): Grid {
  const g = createGrid(map.width, map.height);
  for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) if (!roomAt(map, { x, y })) setCell(g, { x, y }, { blocking: true });
  for (const r of map.rooms) {
    for (const p of r.difficult) setCell(g, p, { terrain: 'difficult' });
    for (const p of r.blocking) setCell(g, p, { blocking: true });
    // Walls where this room touches another room (east and south edges; the other room does the rest).
    for (const s of roomSquares(r)) {
      for (const side of ['E', 'S'] as const) {
        const n = { x: s.x + STEP[side].x, y: s.y + STEP[side].y };
        const other = roomAt(map, n);
        if (other && other !== r) setEdge(g, s.x, s.y, side, { kind: 'wall' });
      }
    }
  }
  for (const d of map.doors) {
    const key = doorKey(d);
    setEdge(g, d.x, d.y, d.side, { kind: 'door', open: !d.locked || (opts.unlocked ?? []).includes(key) });
  }
  return g;
}

export const doorKey = (d: { x: number; y: number; side: string }): string => `${d.x},${d.y},${d.side}`;

// ---------------------------------------------------------------- fog of war

export interface DungeonProgress {
  revealed: string[];
}

type Ext = Record<string, DungeonProgress>;

export function dungeonProgress(extensions: Record<string, unknown>, mapId: string): DungeonProgress {
  return ((extensions.dungeon as Ext | undefined) ?? {})[mapId] ?? { revealed: [] };
}

/** Reveal a room (first visit). Returns true if it was new. */
export function revealRoom(extensions: Record<string, unknown>, mapId: string, roomId: string): boolean {
  const all = { ...((extensions.dungeon as Ext | undefined) ?? {}) };
  const p = all[mapId] ?? { revealed: [] };
  if (p.revealed.includes(roomId)) return false;
  all[mapId] = { revealed: [...p.revealed, roomId] };
  extensions.dungeon = all;
  return true;
}

/**
 * Squares hidden by fog: squares of unrevealed rooms, and rock that doesn't touch a revealed room
 * (so revealed rooms show their outline).
 */
export function fogSquares(map: DungeonMap, revealed: readonly string[]): Set<string> {
  const open = new Set(map.rooms.filter((r) => revealed.includes(r.id)).flatMap((r) => roomSquares(r).map(cellKey)));
  const hidden = new Set<string>();
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const k = cellKey({ x, y });
      if (open.has(k)) continue;
      const room = roomAt(map, { x, y });
      if (room) {
        hidden.add(k);
        continue;
      }
      let touches = false;
      for (let dy = -1; dy <= 1 && !touches; dy++) for (let dx = -1; dx <= 1 && !touches; dx++) touches = open.has(cellKey({ x: x + dx, y: y + dy }));
      if (!touches) hidden.add(k);
    }
  }
  return hidden;
}

// ---------------------------------------------------------------- fight placement

/** Doors of a room (as the square inside the room next to the door). */
function roomDoorSquares(map: DungeonMap, r: DungeonRoom): Point[] {
  const out: Point[] = [];
  for (const d of map.doors) {
    const other = { x: d.x + STEP[d.side].x, y: d.y + STEP[d.side].y };
    if (inRoom(r, d)) out.push({ x: d.x, y: d.y });
    else if (inRoom(r, other)) out.push(other);
  }
  return out;
}

/**
 * Where a fight in `roomId` starts: the party by the door they came through (`fromRoom`, else the
 * first door, else the room's west edge), foes on the squares farthest from it.
 */
export function roomSpawns(map: DungeonMap, roomId: string, fromRoom?: string): { party: Point[]; foes: Point[] } {
  const r = map.rooms.find((x) => x.id === roomId);
  if (!r) return { party: [], foes: [] };
  const grid = buildDungeonGrid(map);
  const free = roomSquares(r).filter((s) => !grid.cells[cellKey(s)]?.blocking);
  const doors = roomDoorSquares(map, r);
  const from = fromRoom ? map.rooms.find((x) => x.id === fromRoom) : undefined;
  const entry =
    (from && doors.find((d) => [STEP.N, STEP.E, STEP.S, STEP.W].some((s) => inRoom(from, { x: d.x + s.x, y: d.y + s.y })))) ?? doors[0] ?? { x: r.x, y: r.y + Math.floor(r.h / 2) };
  const dist = (p: Point) => Math.max(Math.abs(p.x - entry.x), Math.abs(p.y - entry.y));
  const near = [...free].sort((a, b) => dist(a) - dist(b) || a.y - b.y || a.x - b.x);
  const far = [...free].sort((a, b) => dist(b) - dist(a) || a.y - b.y || a.x - b.x);
  return { party: near, foes: far };
}

/** What the client needs to draw the current map: the map, revealed rooms and where the party is. */
export interface DungeonView {
  map: DungeonMap;
  revealed: string[];
  room: string;
}

/** The view for the party's current mapped scene (extensions.dungeonAt), if any. */
export function dungeonView(maps: readonly DungeonMap[], extensions: Record<string, unknown>): DungeonView | null {
  const at = extensions.dungeonAt as { map: string; room: string } | undefined;
  const map = at && maps.find((m) => m.id === at.map);
  if (!at || !map) return null;
  return { map, revealed: dungeonProgress(extensions, map.id).revealed, room: at.room };
}
