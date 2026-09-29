/**
 * Dungeon/building map beside the story (spec §11.1): the current map with fog of war — only rooms
 * the party has entered are drawn — and a marker in the current room. Fights in these rooms use the
 * same map.
 */
import { useMemo } from 'preact/hooks';
import { buildDungeonGrid, fogSquares, roomSquares, type DungeonView } from '../../../engine/world/dungeon';
import type { Creature } from '../../../engine/core/creature';
import { BattleMap } from '../combat/BattleMap';

export function DungeonPanel({ view, hero }: { view: DungeonView; hero: Creature }) {
  const { grid, fog } = useMemo(() => {
    const g = buildDungeonGrid(view.map);
    const room = view.map.rooms.find((r) => r.id === view.room);
    // Marker on the free square nearest the room's centre.
    const cx = room ? room.x + (room.w - 1) / 2 : 0;
    const cy = room ? room.y + (room.h - 1) / 2 : 0;
    const spot = room && roomSquares(room)
      .filter((s) => !g.cells[`${s.x},${s.y}`]?.blocking)
      .sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy))[0];
    if (spot) g.tokens[hero.id] = { id: hero.id, x: spot.x, y: spot.y, size: 'medium' };
    return { grid: g, fog: fogSquares(view.map, view.revealed) };
  }, [view, hero.id]);
  const roomName = view.map.rooms.find((r) => r.id === view.room)?.name ?? '';
  const cell = Math.max(10, Math.min(24, Math.floor(260 / Math.max(view.map.width, view.map.height))));
  return (
    <section class="dungeon-panel" aria-label={`Map: ${view.map.name}, you are in ${roomName}`}>
      <h2>
        {view.map.name} <span class="muted small">· {roomName}</span>
      </h2>
      <BattleMap grid={grid} creatures={{ [hero.id]: hero }} sides={{ [hero.id]: 'party' }} fog={fog} cell={cell} />
    </section>
  );
}
