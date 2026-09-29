/**
 * Combat screen (spec §10): 2D battle map, turn tracker, action bar and combat log. Moving: click a
 * highlighted square. Attacking: pick an attack, then a highlighted enemy. Area spells can be
 * cast: area spells show their template under the cursor; click to cast. Zone spells (Web,
 * Spiritual Weapon...) are placed by clicking a square and can be moved later. A second row holds
 * Grapple/Shove, Study/Influence, potions, Ready and escaping. Previews use the same engine code as
 * the rules (reachableSquares, checkAttack, previewArea).
 */
import { useMemo, useState } from 'preact/hooks';
import { templateFromArea, templateFromCaster, previewArea } from '../../../engine/combat/aoe';
import { attackProfiles, checkAttack, type AttackProfile } from '../../../engine/combat/attack';
import type { CombatContext } from '../../../engine/combat/combatState';
import { isControlled, type Encounter, type PlayerAction } from '../../../engine/combat/encounter';
import { cellKey, type Point } from '../../../engine/combat/grid';
import { reachableSquares } from '../../../engine/combat/movement';
import { lowestSlotFor, reachProblem, spellEconomy, spellRangeFt } from '../../../engine/combat/castAction';
import { featureActions } from '../../../engine/character/features';
import { INFLUENCE_SKILLS, STUDY_SKILLS, usableMagicItems, type InfluenceSkill, type StudySkill } from '../../../engine/combat/otherActions';
import { grappledBy } from '../../../engine/combat/actions';
import { zoneNeedsAim, zoneSquares, zonesOfCaster } from '../../../engine/combat/zones';
import { budgetOf, currentId, movementLeft } from '../../../engine/combat/turns';
import type { Character } from '../../../engine/core/creature';
import { db } from '../../data';
import { BattleMap } from './BattleMap';
import { BattleMap3D } from '../../three/LazyBattleMap3D';
import { settings } from '../settingsState';

type Mode =
  | { kind: 'move' }
  | { kind: 'attack'; profile: AttackProfile }
  | { kind: 'area'; spellId: string }
  | { kind: 'spell'; spellId: string }
  | { kind: 'feature'; actionId: string }
  | { kind: 'grapple' }
  | { kind: 'shove'; effect: 'push' | 'prone' }
  | { kind: 'influence'; skill: InfluenceSkill }
  | { kind: 'item'; uid: string }
  | { kind: 'zone'; zoneId: string };

const SKILL_NAME = (s: string) => s.replace('_', ' ').replace(/^./, (m) => m.toUpperCase());

export function CombatScreen({ enc, ctx, act, onLeave, leaveLabel, narration }: { enc: Encounter; ctx: CombatContext; act: (a: PlayerAction) => string | undefined; onLeave?: () => void; leaveLabel?: string; narration?: string | undefined }) {
  const [mode, setMode] = useState<Mode>({ kind: 'move' });
  const [hover, setHover] = useState<Point | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [studySkill, setStudySkill] = useState<StudySkill>('arcana');
  const [influenceSkill, setInfluenceSkill] = useState<InfluenceSkill>('intimidation');
  const [drag, setDrag] = useState(false);
  // The player's toggle wins; until then follow the performance setting (it may load after mount).
  const [chosenView, setView] = useState<'2d' | '3d' | null>(null);
  const view = chosenView ?? settings.value?.performance.gridMode ?? '2d';
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
    const dragging = drag ? grappledBy(state, heroId) : [];
    const left = movementLeft(state.turns, heroId, hero);
    return reachableSquares(state.grid, heroId, dragging.length ? Math.floor(left / 2) : left, { isHostile: (a, b) => (sides[a] ?? 'x') !== (sides[b] ?? 'y'), ...(dragging.length && { ignore: dragging }) });
  }, [state, mode, myTurn, drag]);
  const reachKeys = useMemo(() => new Set([...reach.values()].map((r) => cellKey(r))), [reach]);

  const profiles = hero ? attackProfiles(hero, db) : [];
  const targets = useMemo(() => {
    if (!myTurn) return new Set<string>();
    if (mode.kind === 'attack') return new Set(Object.keys(state.creatures).filter((id) => sides[id] === 'enemy' && state.creatures[id]!.hp > 0 && checkAttack(state, ctx, heroId, id, mode.profile).ok));
    if (mode.kind === 'spell') {
      const spell = db.spells.get(mode.spellId);
      if (!spell) return new Set<string>();
      const healing = (spell.effects ?? []).some((e) => e.kind === 'heal' || e.kind === 'temp_hp');
      return new Set(Object.keys(state.creatures).filter((id) => (healing ? sides[id] === 'party' : sides[id] === 'enemy' && state.creatures[id]!.hp > 0) && !reachProblem(state, heroId, id, spellRangeFt(spell))));
    }
    if (mode.kind === 'feature' || mode.kind === 'item') return new Set(Object.keys(state.creatures).filter((id) => sides[id] === 'party' && !reachProblem(state, heroId, id, 5)));
    const foes = (maxFt: number) => new Set(Object.keys(state.creatures).filter((id) => sides[id] === 'enemy' && state.creatures[id]!.hp > 0 && !reachProblem(state, heroId, id, maxFt)));
    if (mode.kind === 'grapple' || mode.kind === 'shove') return foes(5);
    if (mode.kind === 'influence') return foes(60);
    return new Set<string>();
  }, [state, mode, myTurn]);

  const knownSpells = hero ? [...new Set([...(hero.spellcasting?.cantrips ?? []), ...(hero.spellcasting?.prepared ?? []).map((p) => p.spellId)])].map((id) => db.spells.get(id)).filter((s): s is NonNullable<typeof s> => !!s && !!spellEconomy(s) && (s.effects?.length ?? 0) > 0) : [];
  const features = hero ? featureActions(hero, db).filter((f) => f.action.cost !== 'reaction') : [];
  const aoe = useMemo(() => {
    if (mode.kind !== 'area' || !hover) return undefined;
    const spell = db.spells.get(mode.spellId);
    if (!spell?.area) return undefined;
    const selfShape = ['cone', 'line', 'emanation'].includes(spell.area.shape) || spell.range?.kind === 'self';
    const tpl = selfShape ? templateFromCaster(state.grid, heroId, spell.area, { x: hover.x + 0.5, y: hover.y + 0.5 }) : templateFromArea(spell.area, { origin: { x: hover.x + 0.5, y: hover.y + 0.5 } });
    return new Set(previewArea(state.grid, tpl).squares.map((s) => cellKey(s)));
  }, [mode, hover, state]);

  const hoverPath = mode.kind === 'move' && hover ? reach.get(cellKey(hover))?.path : undefined;
  const zoneKeys = useMemo(() => new Set((state.zones ?? []).flatMap((z) => zoneSquares(state, z).map((s) => cellKey(s)))), [state]);
  const myZones = hero ? zonesOfCaster(state, heroId) : [];
  const holdingZones = hero ? (state.zones ?? []).filter((z) => z.condition && hero.conditions.some((x) => x.condition === z.condition && x.sourceId === z.sourceId)) : [];
  const items = hero ? usableMagicItems(hero, ctx) : [];
  const grappling = hero ? grappledBy(state, heroId) : [];
  const grappled = !!hero?.effects.some((e) => e.key === 'grappled_by');
  const readyProfile = profiles[0];

  const run = (a: PlayerAction) => {
    setError(act(a) ?? null);
    setMode({ kind: 'move' });
  };

  const onSquare = (p: Point) => {
    if (!myTurn) return;
    if (mode.kind === 'move') {
      const r = reach.get(cellKey(p));
      if (r) run({ kind: 'move', path: r.path, ...(drag && grappling.length && { drag: grappling }) });
      return;
    }
    if (mode.kind === 'zone') {
      run({ kind: 'zone', zoneId: mode.zoneId, to: p });
      return;
    }
    if (mode.kind === 'area') {
      run({ kind: 'cast', spellId: mode.spellId, targetIds: [], area: p });
      return;
    }
    const clicked = Object.values(state.grid.tokens).find((t) => { const n = t.size === 'large' ? 2 : t.size === 'huge' ? 3 : t.size === 'gargantuan' ? 4 : 1; return t.x <= p.x && p.x < t.x + n && t.y <= p.y && p.y < t.y + n; })?.id;
    if (mode.kind === 'spell' && clicked && targets.has(clicked)) {
      run({ kind: 'cast', spellId: mode.spellId, targetIds: [clicked] });
      return;
    }
    if (mode.kind === 'grapple' && clicked && targets.has(clicked)) return run({ kind: 'grapple', targetId: clicked });
    if (mode.kind === 'shove' && clicked && targets.has(clicked)) return run({ kind: 'shove', targetId: clicked, effect: mode.effect });
    if (mode.kind === 'influence' && clicked && targets.has(clicked)) return run({ kind: 'influence', targetId: clicked, skill: mode.skill });
    if (mode.kind === 'item' && clicked && targets.has(clicked)) return run({ kind: 'use_item', uid: mode.uid, targetId: clicked });
    if (mode.kind === 'feature' && clicked && targets.has(clicked)) {
      run({ kind: 'feature', actionId: mode.actionId, targetId: clicked });
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
          {(() => {
            const mapProps = {
              grid: state.grid,
              creatures: state.creatures,
              sides,
              ...(activeId && { activeId }),
              reachable: reachKeys,
              targets,
              ...(aoe && { aoe }),
              zones: zoneKeys,
              ...(hoverPath && { path: [{ x: state.grid.tokens[heroId]!.x, y: state.grid.tokens[heroId]!.y }, ...hoverPath] }),
              onSquare,
              onHover: setHover,
            };
            return view === '3d' ? <BattleMap3D {...mapProps} onUnavailable={() => setView('2d')} /> : <BattleMap {...mapProps} />;
          })()}
          <button type="button" class="view-toggle" onClick={() => setView(view === '3d' ? '2d' : '3d')} title="Switch between the 3D map and the 2D token map">
            {view === '3d' ? '2D map' : '3D map'}
          </button>
        </div>
        {narration && (
          <p class="combat-narration" aria-live="polite">
            {narration}
          </p>
        )}
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
              {knownSpells.map((sp) => {
                const econ = spellEconomy(sp)!;
                const usable = econ === 'action' ? budget.action : budget.bonusAction;
                const noSlot = sp.level > 0 && hero && !lowestSlotFor(hero, sp);
                const selfOnly = !sp.area && sp.range.kind === 'self';
                const selected = (mode.kind === 'spell' || mode.kind === 'area') && mode.spellId === sp.id;
                return (
                  <button
                    key={sp.id}
                    type="button"
                    class={`spell${selected ? ' selected' : ''}`}
                    disabled={!usable || !!noSlot}
                    title={`${sp.level === 0 ? 'Cantrip' : `Level ${sp.level}`} · ${econ === 'bonusAction' ? 'bonus action' : 'action'}${sp.area ? ' · area: click a square' : ''}`}
                    onClick={() => (selfOnly ? run({ kind: 'cast', spellId: sp.id, targetIds: [heroId] }) : setMode(sp.area || zoneNeedsAim(sp) ? { kind: 'area', spellId: sp.id } : { kind: 'spell', spellId: sp.id }))}
                  >
                    ✦ {sp.name}
                  </button>
                );
              })}
              {features.map((f) => (
                <button key={f.action.id} type="button" class="feature" disabled={!!f.problem} title={f.problem ?? f.action.name} onClick={() => (f.action.id === 'lay_on_hands' ? setMode({ kind: 'feature', actionId: f.action.id }) : run({ kind: 'feature', actionId: f.action.id }))}>
                  ◆ {f.action.name}
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
              <div class="action-row-more">
                <button type="button" class={mode.kind === 'grapple' ? 'selected' : ''} disabled={!budget.action && !(budget.attacksLeft ?? 0)} title="Unarmed Strike: grab a creature within 5 ft (needs a free hand)" onClick={() => setMode({ kind: 'grapple' })}>
                  Grapple
                </button>
                <button type="button" class={mode.kind === 'shove' && mode.effect === 'prone' ? 'selected' : ''} disabled={!budget.action && !(budget.attacksLeft ?? 0)} onClick={() => setMode({ kind: 'shove', effect: 'prone' })}>
                  Shove prone
                </button>
                <button type="button" class={mode.kind === 'shove' && mode.effect === 'push' ? 'selected' : ''} disabled={!budget.action && !(budget.attacksLeft ?? 0)} onClick={() => setMode({ kind: 'shove', effect: 'push' })}>
                  Shove away
                </button>
                {grappled && (
                  <button type="button" disabled={!budget.action} onClick={() => run({ kind: 'escape_grapple' })}>
                    Escape grapple
                  </button>
                )}
                {grappling.length > 0 && (
                  <label class="small">
                    <input type="checkbox" checked={drag} onChange={(e) => setDrag((e.target as HTMLInputElement).checked)} /> Drag grappled (double cost)
                  </label>
                )}
                {holdingZones.map((z) => (
                  <button key={z.id} type="button" disabled={!budget.action} onClick={() => run({ kind: 'escape_zone', zoneId: z.id })}>
                    Break free of {z.name}
                  </button>
                ))}
                {myZones.map((z) => (
                  <button key={z.id} type="button" class={`spell${mode.kind === 'zone' && mode.zoneId === z.id ? ' selected' : ''}`} disabled={z.bolt || z.move?.economy === 'action' ? !budget.action : !budget.bonusAction} title="Click a square" onClick={() => setMode({ kind: 'zone', zoneId: z.id })}>
                    ✦ {z.bolt ? `${z.name}: new bolt` : `Move ${z.name}`}
                  </button>
                ))}
                {items.map((it) => (
                  <span key={it.uid} class="item-use">
                    <button type="button" disabled={it.bonusAction ? !budget.bonusAction : !budget.action} onClick={() => run({ kind: 'use_item', uid: it.uid })}>
                      ⚗ {it.name}
                    </button>
                    {it.bonusAction && (
                      <button type="button" class={mode.kind === 'item' && mode.uid === it.uid ? 'selected' : ''} disabled={!budget.bonusAction} title="Give it to an ally within 5 ft" onClick={() => setMode({ kind: 'item', uid: it.uid })}>
                        give
                      </button>
                    )}
                  </span>
                ))}
                <span class="skill-pick">
                  <select value={studySkill} aria-label="Study skill" onChange={(e) => setStudySkill((e.target as HTMLSelectElement).value as StudySkill)}>
                    {STUDY_SKILLS.map((s) => (
                      <option key={s} value={s}>
                        {SKILL_NAME(s)}
                      </option>
                    ))}
                  </select>
                  <button type="button" disabled={!budget.action} onClick={() => run({ kind: 'study', skill: studySkill, topic: 'the foes and the battlefield' })}>
                    Study
                  </button>
                </span>
                <span class="skill-pick">
                  <select value={influenceSkill} aria-label="Influence skill" onChange={(e) => setInfluenceSkill((e.target as HTMLSelectElement).value as InfluenceSkill)}>
                    {INFLUENCE_SKILLS.map((s) => (
                      <option key={s} value={s}>
                        {SKILL_NAME(s)}
                      </option>
                    ))}
                  </select>
                  <button type="button" class={mode.kind === 'influence' ? 'selected' : ''} disabled={!budget.action} title="Then click a foe within 60 ft" onClick={() => setMode({ kind: 'influence', skill: influenceSkill })}>
                    Influence
                  </button>
                </span>
                {readyProfile && (
                  <button type="button" disabled={!budget.action} title="Attack when an enemy comes within reach (uses your Reaction)" onClick={() => run({ kind: 'ready', attackProfileId: readyProfile.id })}>
                    Ready {readyProfile.name}
                  </button>
                )}
              </div>
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
