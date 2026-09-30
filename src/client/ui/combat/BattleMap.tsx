/**
 * 2D battle map (spec §10, §14 "2D top-down token fallback"): a canvas grid with terrain, walls,
 * tokens (side colour, initials, HP ring), the active creature, reachable squares, valid targets
 * an area-of-effect preview and lasting spell zones. Pure rendering + click/hover callbacks; rules live in the engine.
 */
import { useEffect, useRef } from 'preact/hooks';
import { cellKey, footprintSize, type Grid, type Point } from '../../../engine/combat/grid';
import type { Creatures } from '../../../engine/combat/turns';
import { t } from '../i18n';

export const CELL = 48;
const CELL_DEFAULT = CELL;

export interface BattleMapProps {
  grid: Grid;
  creatures: Creatures;
  sides: Record<string, string>;
  activeId?: string;
  reachable?: ReadonlySet<string>;
  targets?: ReadonlySet<string>;
  aoe?: ReadonlySet<string>;
  /** Squares covered by lasting spell zones (Web, Spirit Guardians...). */
  zones?: ReadonlySet<string>;
  /** Squares under fog of war: drawn black, tokens there hidden. */
  fog?: ReadonlySet<string>;
  /** Draw each square this many pixels wide (default CELL). */
  cell?: number;
  path?: readonly Point[];
  onSquare?: (p: Point) => void;
  onHover?: (p: Point | null) => void;
}

const COLORS = { party: '#3f7fbf', enemy: '#b8453c', neutral: '#8a8a5a' } as const;

function initials(name: string): string {
  return name
    .replace(/[^A-Za-z0-9 ]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => (/^\d+$/.test(w) ? w : w[0]!.toUpperCase()))
    .join('');
}

export function BattleMap(p: BattleMapProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const CELL = p.cell ?? CELL_DEFAULT;
  const w = p.grid.width * CELL;
  const h = p.grid.height * CELL;

  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    // Ground + grid.
    ctx.fillStyle = '#2b2a22';
    ctx.fillRect(0, 0, w, h);
    for (let y = 0; y < p.grid.height; y++) {
      for (let x = 0; x < p.grid.width; x++) {
        const cell = p.grid.cells[cellKey({ x, y })];
        const key = cellKey({ x, y });
        if (cell?.blocking) {
          ctx.fillStyle = '#12110d';
          ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
        } else if (cell?.terrain === 'difficult') {
          ctx.fillStyle = '#3a3624';
          ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
          ctx.strokeStyle = 'rgba(200,180,120,0.25)';
          for (let i = -CELL; i < CELL; i += 10) {
            ctx.beginPath();
            ctx.moveTo(x * CELL + i, y * CELL + CELL);
            ctx.lineTo(x * CELL + i + CELL, y * CELL);
            ctx.stroke();
          }
        }
        if (p.zones?.has(key)) {
          ctx.fillStyle = 'rgba(170,110,255,0.22)';
          ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
        }
        if (p.reachable?.has(key)) {
          ctx.fillStyle = 'rgba(120,200,255,0.18)';
          ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
        }
        if (p.aoe?.has(key)) {
          ctx.fillStyle = 'rgba(255,120,40,0.35)';
          ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
        }
      }
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= p.grid.width; x++) {
      ctx.beginPath();
      ctx.moveTo(x * CELL + 0.5, 0);
      ctx.lineTo(x * CELL + 0.5, h);
      ctx.stroke();
    }
    for (let y = 0; y <= p.grid.height; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * CELL + 0.5);
      ctx.lineTo(w, y * CELL + 0.5);
      ctx.stroke();
    }
    // Walls and doors on edges ("x,y,N" / "x,y,W").
    for (const [k, e] of Object.entries(p.grid.edges)) {
      const [xs, ys, side] = k.split(',');
      const x = Number(xs) * CELL;
      const y = Number(ys) * CELL;
      ctx.strokeStyle = e.kind === 'door' ? (e.open ? '#8a6a3a' : '#c8913a') : '#d8d0c0';
      ctx.lineWidth = e.kind === 'door' ? 5 : 4;
      ctx.beginPath();
      if (side === 'N') {
        ctx.moveTo(x, y);
        ctx.lineTo(x + CELL, y);
      } else {
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + CELL);
      }
      ctx.stroke();
    }
    // Planned path.
    if (p.path?.length) {
      ctx.strokeStyle = 'rgba(255,215,106,0.8)';
      ctx.lineWidth = 3;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      p.path.forEach((pt, i) => (i === 0 ? ctx.moveTo(pt.x * CELL + CELL / 2, pt.y * CELL + CELL / 2) : ctx.lineTo(pt.x * CELL + CELL / 2, pt.y * CELL + CELL / 2)));
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // Fog of war.
    if (p.fog?.size) {
      ctx.fillStyle = '#0b0a08';
      for (const k of p.fog) {
        const [fx, fy] = k.split(',').map(Number);
        ctx.fillRect(fx! * CELL, fy! * CELL, CELL, CELL);
      }
    }
    // Tokens.
    for (const t of Object.values(p.grid.tokens)) {
      const c = p.creatures[t.id];
      if (!c) continue;
      if (p.fog?.has(cellKey({ x: t.x, y: t.y }))) continue;
      const n = footprintSize(t.size);
      const cx = t.x * CELL + (n * CELL) / 2;
      const cy = t.y * CELL + (n * CELL) / 2;
      const r = (n * CELL) / 2 - 5;
      const down = c.hp <= 0;
      ctx.globalAlpha = down ? 0.45 : 1;
      ctx.fillStyle = COLORS[(p.sides[t.id] as keyof typeof COLORS) ?? 'neutral'] ?? COLORS.neutral;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      // HP ring.
      const frac = Math.max(0, Math.min(1, c.hp / c.maxHp));
      ctx.strokeStyle = frac > 0.5 ? '#6fd06f' : frac > 0.25 ? '#e0b040' : '#e0483e';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(cx, cy, r + 2, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
      ctx.stroke();
      if (t.id === p.activeId) {
        ctx.strokeStyle = '#ffd76a';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(cx, cy, r + 7, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (p.targets?.has(t.id)) {
        ctx.strokeStyle = '#ff5a4a';
        ctx.lineWidth = 3;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.arc(cx, cy, r + 7, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.round(14 * n)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(down ? '✕' : initials(c.name), cx, cy);
      ctx.globalAlpha = 1;
    }
  }, [p.grid, p.creatures, p.activeId, p.reachable, p.targets, p.aoe, p.zones, p.fog, p.path, CELL]);

  const toSquare = (e: MouseEvent): Point | null => {
    const el = canvas.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * p.grid.width);
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * p.grid.height);
    return x >= 0 && y >= 0 && x < p.grid.width && y < p.grid.height ? { x, y } : null;
  };

  return (
    <canvas
      ref={canvas}
      class="battle-canvas"
      width={w}
      height={h}
      role="img"
      aria-label={t('combat.mapAria')}
      onClick={(e) => {
        const sq = toSquare(e);
        if (sq) p.onSquare?.(sq);
      }}
      onMouseMove={(e) => p.onHover?.(toSquare(e))}
      onMouseLeave={() => p.onHover?.(null)}
    />
  );
}
