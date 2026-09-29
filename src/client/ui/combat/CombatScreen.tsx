/**
 * Combat screen (spec §10): 2D battle map, turn tracker, action bar and combat log. Moving: click a
 * highlighted square. Attacking: pick an attack, then a highlighted enemy. Area spells can be
 * previewed on the map (casting arrives with spell casting in combat). Previews use the same
 * engine code as the rules (reachableSquares, checkAttack, previewArea).
 */
import { useMemo, useState } from 'preact/hooks';
import { templateFromArea, templateFromCaster, previewArea } from '../../../engine/combat/aoe';
import { attackProfiles, checkAttack, type AttackProfile } from '../../../engine/combat/attack';
import type { CombatContext } from '../../../engine/combat/combatState';
import { isControlled, type Encounter, type PlayerAction } from '../../../engine/combat/encounter';
import { cellKey, type Point } from '../../../engine/combat/grid';
import { reachableSquares } from '../../../engine/combat/movement';
import { budgetOf, currentId, movementLeft } from '../../../engine/combat/turns';
import type { Character } from '../../../engine/core/creature';
import { db } from '../../data';
import { BattleMap } from './BattleMap';

type Mode = { kind: 'move' } | { kind: 'attack'; profile: AttackProfile } | { kind: 'area'; spellId: string };

export function CombatScreen({ enc, ctx, act, onLeave, leaveLabel }: { enc: Encounter; ctx: CombatContext; act: (a: PlayerAction) => string | undefined; onLeave?: () => void; leaveLabel?: string }) {
  const [mode, setMode] = useState<Mode>({ kind: 'move' });
  const [hover, setHover] = useState<Point | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { state } = enc;
  // The player acts for the hero and any companion toggled to player control.
  const upNow = currentId(state.turns);
  const heroId = upNow && isControlled(enc, upNow) ? upNow : enc.heroId;
  const hero = state.creatures[heroId] as Character | undefined;
  const myTurn = enc.status === 'ongoing' && upNow === heroId && isControlled(enc, heroId);
  const budget = budgetOf(state.turns, heroId);
  const sides = enc.roster;

  const reach = useMemo(() => {
    if (!myTurn || !hero || mode.kind !== 'move') return new Map<string, { x: number; y: number; path: Point[] }>();
    const left = movementLeft(state.turns, heroId, hero);
    return reachableSquares(state.grid, heroId, left, { isHostile: (a, b) => (sides[a] ?? 'x') !== (sides[b] ?? 'y') });
  }, [state, mode, myTurn]);
  const reachKeys = useMemo(() => new Set([...reach.values()].map((r) => cellKey(r))), [reach]);

  const profiles = hero ? attackProfiles(hero, db) : [];
  const targets = useMemo(() => {
    if (!myTurn || mode.kind !== 'attack') return new Set<string>();
    return new Set(Object.keys(state.creatures).filter((id) => sides[id] === 'enemy' && state.creatures[id]!.hp > 0 && checkAttack(state, ctx, heroId, id, mode.profile).ok));
  }, [state, mode, myTurn]);

  const areaSpells = hero ? [...(hero.spellcasting?.cantrips ?? []), ...(hero.spellcasting?.prepared ?? []).map((p) => p.spellId)].map((id) => db.spells.get(id)).filter((s) => s?.area) : [];
  const aoe = useMemo(() => {
    if (mode.kind !== 'area' || !hover) return undefined;
    const spell = db.spells.get(mode.spellId);
    if (!spell?.area) return undefined;
    const selfShape = ['cone', 'line', 'emanation'].includes(spell.area.shape) || spell.range?.kind === 'self';
    const tpl = selfShape ? templateFromCaster(state.grid, heroId, spell.area, { x: hover.x + 0.5, y: hover.y + 0.5 }) : templateFromArea(spell.area, { origin: { x: hover.x + 0.5, y: hover.y + 0.5 } });
    return new Set(previewArea(state.grid, tpl).squares.map((s) => cellKey(s)));
  }, [mode, hover, state]);

  const hoverPath = mode.kind === 'move' && hover ? reach.get(cellKey(hover))?.path : undefined;

  const run = (a: PlayerAction) => {
    setError(act(a) ?? null);
    setMode({ kind: 'move' });
  };

  const onSquare = (p: Point) => {
    if (!myTurn) return;
    if (mode.kind === 'move') {
      const r = reach.get(cellKey(p));
      if (r) run({ kind: 'move', path: r.path });
      return;
    }
    if (mode.kind === 'attack') {
      const id = Object.values(state.grid.tokens).find((t) => t.x <= p.x && p.x < t.x + (t.size === 'large' ? 2 : t.size === 'huge' ? 3 : t.size === 'gargantuan' ? 4 : 1) && t.y <= p.y && p.y < t.y + (t.size === 'large' ? 2 : t.size === 'huge' ? 3 : t.size === 'gargantuan' ? 4 : 1))?.id;
      if (id && targets.has(id)) run({ kind: 'attack', targetId: id, profileId: mode.profile.id });
    }
  };

  const order = state.turns.order;
  const activeId = currentId(state.turns);

  return (
    <div class="combat-screen">
      <header class="game-bar">
        <div class="game-where">
          <strong>Combat</strong>
          <span class="muted">Round {state.turns.round}</span>
          {enc.status !== 'ongoing' && <span class={`tag ${enc.status === 'won' ? 'tag-advantage' : 'tag-disadvantage'}`}>{enc.status === 'won' ? 'Victory' : 'Defeat'}</span>}
        </div>
        <nav class="game-menu">
          {onLeave && (
            <button type="button" onClick={onLeave}>
              {leaveLabel ?? (enc.status === 'ongoing' ? 'Leave' : 'Continue')}
            </button>
          )}
        </nav>
      </header>
      <main class="combat-main">
        <div class="battle-wrap">
          <BattleMap
            grid={state.grid}
            creatures={state.creatures}
            sides={sides}
            {...(activeId && { activeId })}
            reachable={reachKeys}
            targets={targets}
            {...(aoe && { aoe })}
            {...(hoverPath && { path: [{ x: state.grid.tokens[heroId]!.x, y: state.grid.tokens[heroId]!.y }, ...hoverPath] })}
            onSquare={onSquare}
            onHover={setHover}
          />
        </div>
        <section class="action-bar" aria-label="Actions">
          {!myTurn ? (
            <p class="hint small">{enc.status === 'ongoing' ? 'Waiting…' : enc.status === 'won' ? 'The fight is won.' : 'You have fallen.'}</p>
          ) : (
            <>
              <span class={`econ ${budget.action ? 'on' : ''}`}>Action</span>
              <span class={`econ ${budget.bonusAction ? 'on' : ''}`}>Bonus</span>
              <span class={`econ ${budget.reaction ? 'on' : ''}`}>Reaction</span>
              <span class="econ acting">{hero?.name}</span>
              <span class="econ on">Move {hero ? movementLeft(state.turns, heroId, hero) : 0} ft</span>
              <button type="button" class={mode.kind === 'move' ? 'selected' : ''} onClick={() => setMode({ kind: 'move' })}>
                Move
              </button>
              {profiles.map((pr) => (
                <button key={pr.id} type="button" class={mode.kind === 'attack' && mode.profile.id === pr.id ? 'selected' : ''} disabled={!budget.action && !(budget.attacksLeft ?? 0)} onClick={() => setMode({ kind: 'attack', profile: pr })}>
                  {pr.name}
                </button>
              ))}
              {areaSpells.map((s) => (
                <button key={s!.id} type="button" class={mode.kind === 'area' && mode.spellId === s!.id ? 'selected' : ''} onClick={() => setMode({ kind: 'area', spellId: s!.id })} title="Preview the area (casting in combat comes later)">
                  ◎ {s!.name}
                </button>
              ))}
              <button type="button" disabled={!budget.action} onClick={() => run({ kind: 'dash' })}>
                Dash
              </button>
              <button type="button" disabled={!budget.action} onClick={() => run({ kind: 'disengage' })}>
                Disengage
              </button>
              <button type="button" disabled={!budget.action} onClick={() => run({ kind: 'dodge' })}>
                Dodge
              </button>
              <button type="button" class="primary" onClick={() => run({ kind: 'end_turn' })}>
                End turn
              </button>
            </>
          )}
          {error && <p class="game-error">{error}</p>}
        </section>
      </main>
      <aside class="combat-side">
        <section class="turn-tracker" aria-label="Turn order">
          <h2>Initiative</h2>
          <ol>
            {order.map((e) => {
              const c = state.creatures[e.id];
              if (!c) return null;
              return (
                <li key={e.id} class={`${e.id === activeId ? 'active' : ''} side-${e.side}${c.hp <= 0 ? ' down' : ''}`}>
                  <span class="init">{e.initiative}</span>
                  <span class="who">{c.name}</span>
                  <span class="hp">
                    {c.hp}/{c.maxHp}
                  </span>
                </li>
              );
            })}
          </ol>
        </section>
        <section class="combat-log" aria-label="Combat log" aria-live="polite">
          <h2>Combat log</h2>
          <ol reversed>
            {[...enc.log].reverse().map((l, i) => (
              <li key={enc.log.length - i}>{l}</li>
            ))}
          </ol>
        </section>
      </aside>
    </div>
  );
}
