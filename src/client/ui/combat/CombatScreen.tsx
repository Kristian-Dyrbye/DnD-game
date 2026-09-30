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
import { grappledBy, reachableForMove } from '../../../engine/combat/actions';
import { hasCondition } from '../../../engine/rules/conditions';
import { zoneNeedsAim, zoneSquares, zonesOfCaster } from '../../../engine/combat/zones';
import { budgetOf, currentId, movementLeft } from '../../../engine/combat/turns';
import type { Character } from '../../../engine/core/creature';
import { db } from '../../data';
import { BattleMap } from './BattleMap';
import { BattleMap3D } from '../../three/LazyBattleMap3D';
import { settings } from '../settingsState';
import { language, t } from '../i18n';
import { srdText } from '../srdText';
import { messages } from '../../../engine/i18n';

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
    return reachableForMove(state, ctx, heroId, { drag: dragging });
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
  const features = hero ? featureActions(hero, db, messages(language.value)).filter((f) => f.action.cost !== 'reaction') : [];
  const aoe = useMemo(() => {
    if (mode.kind !== 'area' || !hover) return undefined;
    const spell = db.spells.get(mode.spellId);
    if (!spell?.area) return undefined;
    const selfShape = ['cone', 'line', 'emanation'].includes(spell.area.shape) || spell.range?.kind === 'self';
    const tpl = selfShape ? templateFromCaster(state.grid, heroId, spell.area, { x: hover.x + 0.5, y: hover.y + 0.5 }) : templateFromArea(spell.area, { origin: { x: hover.x + 0.5, y: hover.y + 0.5 } });
    return new Set(previewArea(state.grid, tpl).squares.map((s) => cellKey(s)));
  }, [mode, hover, state]);

  const hoverPath = mode.kind === 'move' && hover ? reach.get(cellKey(hover))?.path : undefined;
  const fogKeys = useMemo(() => (enc.fog?.length ? new Set(enc.fog) : undefined), [enc.fog]);
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
          <strong>{t('combat.title')}</strong>
          <span class="muted">{t('combat.round', { n: state.turns.round })}</span>
          {enc.status !== 'ongoing' && <span class={`tag ${enc.status === 'won' ? 'tag-advantage' : 'tag-disadvantage'}`}>{t(enc.status === 'won' ? 'combat.victory' : 'combat.defeat')}</span>}
        </div>
        <nav class="game-menu">
          {onLeave && (
            <button type="button" onClick={onLeave}>
              {leaveLabel ?? t(enc.status === 'ongoing' ? 'combat.leave' : 'combat.continue')}
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
              ...(fogKeys && { fog: fogKeys }),
              ...(hoverPath && { path: [{ x: state.grid.tokens[heroId]!.x, y: state.grid.tokens[heroId]!.y }, ...hoverPath] }),
              onSquare,
              onHover: setHover,
            };
            return view === '3d' ? <BattleMap3D {...mapProps} onUnavailable={() => setView('2d')} /> : <BattleMap {...mapProps} />;
          })()}
          <button type="button" class="view-toggle" onClick={() => setView(view === '3d' ? '2d' : '3d')} title={t('combat.viewTitle')}>
            {t(view === '3d' ? 'combat.view2d' : 'combat.view3d')}
          </button>
        </div>
        {narration && (
          <p class="combat-narration" aria-live="polite">
            {narration}
          </p>
        )}
        <section class="action-bar" aria-label={t('combat.actionsAria')}>
          {!myTurn ? (
            <p class="hint small">{t(enc.status === 'ongoing' ? 'combat.waiting' : enc.status === 'won' ? 'combat.won' : 'combat.fallen')}</p>
          ) : (
            <>
              <span class={`econ ${budget.action ? 'on' : ''}`}>{t('combat.econ.action')}</span>
              <span class={`econ ${budget.bonusAction ? 'on' : ''}`}>{t('combat.econ.bonus')}</span>
              <span class={`econ ${budget.reaction ? 'on' : ''}`}>{t('combat.econ.reaction')}</span>
              <span class="econ acting">{hero?.name}</span>
              <span class="econ on">{t('combat.moveLeft', { n: hero ? movementLeft(state.turns, heroId, hero) : 0 })}</span>
              <button type="button" class={mode.kind === 'move' ? 'selected' : ''} onClick={() => setMode({ kind: 'move' })}>
                {t('combat.move')}
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
                    title={[sp.level === 0 ? t('combat.spell.cantrip') : t('combat.spell.level', { n: sp.level }), t(econ === 'bonusAction' ? 'combat.spell.bonusAction' : 'combat.spell.action'), ...(sp.area ? [t('combat.spell.area')] : [])].join(' · ')}
                    onClick={() => (selfOnly ? run({ kind: 'cast', spellId: sp.id, targetIds: [heroId] }) : setMode(sp.area || zoneNeedsAim(sp) ? { kind: 'area', spellId: sp.id } : { kind: 'spell', spellId: sp.id }))}
                  >
                    ✦ {srdText('spells', sp.id, sp.name)}
                  </button>
                );
              })}
              {features.map((f) => (
                <button key={f.action.id} type="button" class="feature" disabled={!!f.problem} title={f.problem ?? f.action.name} onClick={() => (f.action.id === 'lay_on_hands' ? setMode({ kind: 'feature', actionId: f.action.id }) : run({ kind: 'feature', actionId: f.action.id }))}>
                  ◆ {f.action.name}
                </button>
              ))}
              <button type="button" disabled={!budget.action} onClick={() => run({ kind: 'dash' })}>
                {t('combat.dash')}
              </button>
              <button type="button" disabled={!budget.action} onClick={() => run({ kind: 'disengage' })}>
                {t('combat.disengage')}
              </button>
              <button type="button" disabled={!budget.action} onClick={() => run({ kind: 'dodge' })}>
                {t('combat.dodge')}
              </button>
              <button type="button" class="primary" onClick={() => run({ kind: 'end_turn' })}>
                {t('combat.endTurn')}
              </button>
              <div class="action-row-more">
                {hero && hasCondition(hero, 'prone') && (
                  <button type="button" class="primary" title={t('combat.standTitle')} onClick={() => run({ kind: 'stand' })}>
                    {t('combat.stand')}
                  </button>
                )}
                <button type="button" class={mode.kind === 'grapple' ? 'selected' : ''} disabled={!budget.action && !(budget.attacksLeft ?? 0)} title={t('combat.grappleTitle')} onClick={() => setMode({ kind: 'grapple' })}>
                  {t('combat.grapple')}
                </button>
                <button type="button" class={mode.kind === 'shove' && mode.effect === 'prone' ? 'selected' : ''} disabled={!budget.action && !(budget.attacksLeft ?? 0)} onClick={() => setMode({ kind: 'shove', effect: 'prone' })}>
                  {t('combat.shoveProne')}
                </button>
                <button type="button" class={mode.kind === 'shove' && mode.effect === 'push' ? 'selected' : ''} disabled={!budget.action && !(budget.attacksLeft ?? 0)} onClick={() => setMode({ kind: 'shove', effect: 'push' })}>
                  {t('combat.shoveAway')}
                </button>
                {grappled && (
                  <button type="button" disabled={!budget.action} onClick={() => run({ kind: 'escape_grapple' })}>
                    {t('combat.escapeGrapple')}
                  </button>
                )}
                {grappling.length > 0 && (
                  <label class="small">
                    <input type="checkbox" checked={drag} onChange={(e) => setDrag((e.target as HTMLInputElement).checked)} /> {t('combat.drag')}
                  </label>
                )}
                {holdingZones.map((z) => (
                  <button key={z.id} type="button" disabled={!budget.action} onClick={() => run({ kind: 'escape_zone', zoneId: z.id })}>
                    {t('combat.breakFree', { zone: srdText('spells', z.spellId, z.name) })}
                  </button>
                ))}
                {myZones.map((z) => (
                  <button key={z.id} type="button" class={`spell${mode.kind === 'zone' && mode.zoneId === z.id ? ' selected' : ''}`} disabled={z.bolt || z.move?.economy === 'action' ? !budget.action : !budget.bonusAction} title={t('combat.clickSquare')} onClick={() => setMode({ kind: 'zone', zoneId: z.id })}>
                    ✦ {t(z.bolt ? 'combat.zoneBolt' : 'combat.zoneMove', { zone: srdText('spells', z.spellId, z.name) })}
                  </button>
                ))}
                {items.map((it) => (
                  <span key={it.uid} class="item-use">
                    <button type="button" disabled={it.bonusAction ? !budget.bonusAction : !budget.action} onClick={() => run({ kind: 'use_item', uid: it.uid })}>
                      ⚗ {it.name}
                    </button>
                    {it.bonusAction && (
                      <button type="button" class={mode.kind === 'item' && mode.uid === it.uid ? 'selected' : ''} disabled={!budget.bonusAction} title={t('combat.giveTitle')} onClick={() => setMode({ kind: 'item', uid: it.uid })}>
                        {t('combat.give')}
                      </button>
                    )}
                  </span>
                ))}
                <span class="skill-pick">
                  <select value={studySkill} aria-label={t('combat.studyAria')} onChange={(e) => setStudySkill((e.target as HTMLSelectElement).value as StudySkill)}>
                    {STUDY_SKILLS.map((s) => (
                      <option key={s} value={s}>
                        {SKILL_NAME(s)}
                      </option>
                    ))}
                  </select>
                  <button type="button" disabled={!budget.action} onClick={() => run({ kind: 'study', skill: studySkill })}>
                    {t('combat.study')}
                  </button>
                </span>
                <span class="skill-pick">
                  <select value={influenceSkill} aria-label={t('combat.influenceAria')} onChange={(e) => setInfluenceSkill((e.target as HTMLSelectElement).value as InfluenceSkill)}>
                    {INFLUENCE_SKILLS.map((s) => (
                      <option key={s} value={s}>
                        {SKILL_NAME(s)}
                      </option>
                    ))}
                  </select>
                  <button type="button" class={mode.kind === 'influence' ? 'selected' : ''} disabled={!budget.action} title={t('combat.influenceTitle')} onClick={() => setMode({ kind: 'influence', skill: influenceSkill })}>
                    {t('combat.influence')}
                  </button>
                </span>
                {readyProfile && (
                  <button type="button" disabled={!budget.action} title={t('combat.readyTitle')} onClick={() => run({ kind: 'ready', attackProfileId: readyProfile.id })}>
                    {t('combat.ready', { attack: readyProfile.name })}
                  </button>
                )}
              </div>
            </>
          )}
          {error && <p class="game-error">{error}</p>}
        </section>
      </main>
      <aside class="combat-side">
        <section class="turn-tracker" aria-label={t('combat.orderAria')}>
          <h2>{t('combat.initiative')}</h2>
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
        <section class="combat-log" aria-label={t('combat.log')} aria-live="polite">
          <h2>{t('combat.log')}</h2>
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
