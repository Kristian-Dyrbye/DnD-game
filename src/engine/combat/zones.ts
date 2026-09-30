/**
 * Persistent spell zones on the battle grid (Build Prompt §4, §10; SRD 5.2.1 spell texts):
 * Spirit Guardians, Moonbeam, Web, Entangle, Black Tentacles, Wall of Fire, Call Lightning,
 * Flaming Sphere, Spiritual Weapon and Ice Storm's icy ground.
 *
 * A zone is plain data in `CombatState.zones` (saved with the fight). It is created by
 * castInCombat when the spell's hook has zone parameters (data/srd/overrides/spells.json), at the
 * aimed square (`aim`) or around the caster (emanations).
 *
 * - Triggers: 'enter' (a creature moves into it, or it moves onto a creature), 'start_turn' /
 *   'end_turn' (a creature starts / ends its turn inside, or within `nearFt` of it). With
 *   `oncePerTurn` a creature is affected at most once per turn (any creature's turn).
 * - Effect: a save (spell save DC) for damage (half on a success if the spell says so) and/or a
 *   condition (Restrained, sourced `<caster>:<spell>` so ending Concentration removes it).
 * - Terrain: `difficult` zones turn their squares into Difficult Terrain while they last.
 * - Lifetime: concentration zones vanish when the caster stops concentrating on the spell;
 *   `roundsLeft` counts down at the end of each of the caster's turns (Ice Storm: 2 → gone at the end
 *   of the caster's next turn).
 * - `zoneAct` (the caster's own turn): move a movable zone (Moonbeam: Magic action, 60 ft; Flaming
 *   Sphere: Bonus Action, 30 ft; Spiritual Weapon: Bonus Action, 20 ft + an attack), or call another
 *   bolt (Call Lightning: Magic action, anywhere within range).
 *
 * Simplifications (logged in brain.md): enter effects resolve after the whole move (not mid-path);
 * Spirit Guardians' half speed, Web's burning, Wall of Fire's opacity and one-sided heat (both
 * sides within 10 ft burn), Flaming Sphere ramming and Moonbeam's shapechanger rule aren't modelled.
 */
import type { Creature } from '../core/creature';
import type { Damage } from '../data/common';
import type { Spell } from '../data/schemas';
import { formatDice } from '../core/dice';
import type { Ability } from '../rules/basics';
import { createEffectContext, executeEffects, upcastDice } from '../rules/effects';
import { spellAttackBonus, spellSaveDc } from '../rules/spellcasting';
import { removeCondition } from '../rules/conditions';
import { affectedSquares, templateFromArea, templateFromCaster, type AoeTemplate } from './aoe';
import { resolveAreaEffect } from './aoeResolve';
import { areHostile, dbOf, fail, withCreature, type ActionResult, type CombatContext, type CombatEvent, type CombatState, msgsOf } from './combatState';
import { combatCheck } from './saves';
import { cellKey, distanceFt, getCell, setCell, tokenSquares, type Point } from './grid';
import { currentId, spend, type EconomyKind } from './turns';
import { ENGLISH_MESSAGES, type Messages } from '../i18n';

export type ZoneTrigger = 'enter' | 'start_turn' | 'end_turn';

export interface Zone {
  id: string;
  spellId: string;
  name: string;
  casterId: string;
  /** Condition/effect source id of the spell (`<caster>:<spell>`). */
  sourceId: string;
  /** Area of the zone (emanations follow their anchor). Absent for point zones. */
  template?: AoeTemplate;
  /** Point zones (Flaming Sphere, Spiritual Weapon, Call Lightning's cloud): the square it occupies. */
  point?: Point;
  /** Point zones: creatures within this distance count as "in" it (Flaming Sphere 5 ft). */
  nearFt?: number;
  triggers: ZoneTrigger[];
  oncePerTurn: boolean;
  save?: { ability: Ability; dc: number };
  damage?: Damage[];
  halfOnSuccess: boolean;
  condition?: 'restrained';
  /** Escape the condition with an action: Str (Athletics) vs the spell save DC. */
  escapeDc?: number;
  difficult: boolean;
  /** Squares this zone made Difficult Terrain (restored when it ends). */
  terrain: string[];
  /** Never affected (Spirit Guardians: the caster and its allies). */
  excludeIds: string[];
  /** Only hostiles of the caster are affected. */
  hostileOnly: boolean;
  concentration: boolean;
  /** Caster turn-ends left; absent = until concentration ends. */
  roundsLeft?: number;
  move?: { ft: number; economy: EconomyKind };
  /** Call Lightning: another bolt with the Magic action. */
  bolt?: { rangeFt: number; radiusFt: number; economy: EconomyKind };
  /** Spiritual Weapon: melee spell attack after moving. */
  attack?: { damage: Damage[]; spellMod: number; attackBonus: number; reachFt: number };
  /** `<turnStamp>` of each creature's last trigger (once per turn). */
  lastHit: Record<string, string>;
}

type HookParams = Record<string, unknown>;

const ZONE_SPELLS = new Set(['spirit_guardians', 'moonbeam', 'web', 'entangle', 'black_tentacles', 'wall_of_fire', 'call_lightning', 'flaming_sphere', 'spiritual_weapon', 'ice_storm']);

/** Hook parameters of a zone spell, or undefined for other spells. */
export function zoneParams(spell: Spell): HookParams | undefined {
  if (!ZONE_SPELLS.has(spell.id)) return undefined;
  const h = (spell.effects ?? []).find((e) => e.kind === 'hook');
  return h && h.kind === 'hook' ? (h.params ?? {}) : undefined;
}

/** Does this spell need an aimed square to place its zone (everything but self emanations)? */
export function zoneNeedsAim(spell: Spell): boolean {
  const p = zoneParams(spell);
  return !!p && (p.zone as { shape?: string } | undefined)?.shape !== 'emanation';
}

const turnStamp = (state: CombatState): string => `${state.turns.round}:${state.turns.currentIndex}`;

const zonesOf = (state: CombatState): Zone[] => state.zones ?? [];

function withZones(state: CombatState, zones: Zone[]): CombatState {
  return { ...state, zones };
}

function dmg(d: { dice: string; type: string } | undefined, perLevel: unknown, levels: number): Damage[] | undefined {
  if (!d) return undefined;
  return [{ dice: formatDice(upcastDice(d.dice, typeof perLevel === 'string' ? perLevel : undefined, levels)), type: d.type } as Damage];
}

/** Template of a zone area placed at the aimed square (cube/cylinder centred on it, line eastwards from it). */
function placedTemplate(area: { shape: string; size: number; width?: number }, aim: Point, direction: Point = { x: 1, y: 0 }): AoeTemplate {
  const c = { x: aim.x + 0.5, y: aim.y + 0.5 };
  const a = area as Parameters<typeof templateFromArea>[0];
  if (area.shape === 'cube') return templateFromArea(a, { origin: { x: c.x - area.size / 10, y: c.y }, direction: { x: 1, y: 0 } });
  if (area.shape === 'line') return templateFromArea({ ...a, width: area.width ?? 5 }, { origin: c, direction });
  return templateFromArea(a, { origin: c });
}

/**
 * Build the zone for a spell just cast (or undefined if it isn't a zone spell / needs an aim).
 * `ability` is the caster's spellcasting ability; `levels` the upcast levels.
 */
export function createZone(
  state: CombatState,
  ctx: CombatContext,
  o: { caster: Creature; spell: Spell; ability: Ability; levels: number; aim?: Point; direction?: Point },
): Zone | undefined {
  const p = zoneParams(o.spell);
  if (!p) return undefined;
  const caster = o.caster;
  const area = p.zone as { shape: string; size: number; width?: number } | undefined;
  const wall = p.wall as { lengthFt: number } | undefined;
  const isSelf = area?.shape === 'emanation';
  if (!isSelf && !o.aim) return undefined;
  const dc = spellSaveDc(caster, o.ability);
  const triggers = ((p.triggers as string[] | undefined) ?? []).flatMap((t): ZoneTrigger[] =>
    t === 'enter' || t === 'zone_moves_in' || t === 'ram' ? ['enter'] : t === 'start_turn' ? ['start_turn'] : t.startsWith('end_turn') ? ['end_turn'] : [],
  );
  const saveAbility = (typeof p.save === 'string' ? p.save : undefined) as Ability | undefined;
  let template: AoeTemplate | undefined;
  let point: Point | undefined;
  let nearFt: number | undefined;
  if (isSelf) template = templateFromCaster(state.grid, caster.id, area as Parameters<typeof templateFromCaster>[2]);
  else if (area) template = placedTemplate(area, o.aim!, o.direction);
  else if (wall) {
    template = placedTemplate({ shape: 'line', size: wall.lengthFt, width: 5 }, o.aim!, o.direction);
    nearFt = typeof p.hotSideRangeFt === 'number' ? p.hotSideRangeFt : undefined;
  } else {
    point = { ...o.aim! };
    nearFt = typeof p.triggerRadiusFt === 'number' ? p.triggerRadiusFt : undefined;
  }
  const spellMod = Math.floor((caster.abilities[o.ability] - 10) / 2);
  const conc = o.spell.duration.concentration;
  const zone: Zone = {
    id: `${o.spell.id}:${caster.id}`,
    spellId: o.spell.id,
    name: o.spell.name,
    casterId: caster.id,
    sourceId: `${caster.id}:${o.spell.id}`,
    ...(template && { template }),
    ...(point && { point }),
    ...(nearFt !== undefined && { nearFt }),
    triggers: [...new Set(triggers)],
    oncePerTurn: p.oncePerTurn === true || o.spell.id === 'wall_of_fire',
    ...(saveAbility && { save: { ability: saveAbility, dc } }),
    ...(p.damage !== undefined && o.spell.id !== 'spiritual_weapon' && o.spell.id !== 'call_lightning' && { damage: dmg(p.damage as { dice: string; type: string }, p.upcast, o.levels)! }),
    halfOnSuccess: p.onSuccess === 'half' || ['moonbeam', 'wall_of_fire', 'flaming_sphere', 'spirit_guardians'].includes(o.spell.id),
    ...((o.spell.id === 'web' || o.spell.id === 'entangle' || o.spell.id === 'black_tentacles') && { condition: 'restrained' as const, escapeDc: dc }),
    difficult: p.difficultTerrain === true,
    terrain: [],
    excludeIds: isSelf ? [caster.id] : [],
    hostileOnly: p.excludeChosen === true,
    concentration: conc,
    ...(o.spell.id === 'ice_storm' ? { roundsLeft: 2 } : !conc && typeof p.durationRounds === 'number' ? { roundsLeft: p.durationRounds } : {}),
    ...(typeof p.moveFt === 'number' && { move: { ft: p.moveFt, economy: (p.moveAction ?? p.repeatAction) === 'bonus' ? 'bonusAction' : 'action' } }),
    ...(o.spell.id === 'call_lightning' && { bolt: { rangeFt: 120, radiusFt: (p.radiusFt as number) ?? 5, economy: 'action' as const } }),
    ...(o.spell.id === 'spiritual_weapon' && {
      attack: { damage: dmg(p.damage as { dice: string; type: string }, p.upcast, o.levels)!, spellMod, attackBonus: spellAttackBonus(caster, o.ability), reachFt: (p.reachFt as number) ?? 5 },
    }),
    lastHit: {},
  };
  if (o.spell.id === 'call_lightning') zone.damage = dmg(p.damage as { dice: string; type: string }, p.upcast, o.levels)!;
  return zone;
}

/** Squares a zone covers (point zones: their square). */
export function zoneSquares(state: CombatState, z: Zone): Point[] {
  if (z.template) return affectedSquares(state.grid, z.template);
  return z.point ? [z.point] : [];
}

/** Is the creature in the zone (or within `nearFt` of it for point zones and walls)? */
export function inZone(state: CombatState, z: Zone, id: string): boolean {
  const t = state.grid.tokens[id];
  if (!t) return false;
  const squares = zoneSquares(state, z);
  const mine = new Set(tokenSquares(t).map(cellKey));
  if (squares.some((s) => mine.has(cellKey(s)))) return true;
  if (z.nearFt !== undefined) return squares.some((s) => distanceFt(t, { x: s.x, y: s.y, size: 'medium' }) <= z.nearFt!);
  return false;
}

function affects(state: CombatState, ctx: CombatContext, z: Zone, id: string): boolean {
  const c = state.creatures[id];
  if (!c || c.dead || z.excludeIds.includes(id)) return false;
  if (z.hostileOnly && !areHostile(state, ctx, z.casterId, id)) return false;
  return true;
}

function applyTerrain(state: CombatState, z: Zone): CombatState {
  if (!z.difficult || z.terrain.length) return state;
  const grid = { ...state.grid, cells: { ...state.grid.cells } };
  const changed: string[] = [];
  for (const s of zoneSquares(state, z)) {
    if (getCell(grid, s).terrain === 'difficult') continue;
    setCell(grid, s, { terrain: 'difficult' });
    changed.push(cellKey(s));
  }
  z.terrain = changed;
  return { ...state, grid };
}

function clearTerrain(state: CombatState, z: Zone): CombatState {
  if (!z.terrain.length) return state;
  const grid = { ...state.grid, cells: { ...state.grid.cells } };
  for (const k of z.terrain) {
    const [x, y] = k.split(',').map(Number);
    // Keep squares another live zone also makes difficult.
    if (zonesOf(state).some((o) => o !== z && o.terrain.includes(k))) continue;
    setCell(grid, { x: x!, y: y! }, { terrain: undefined });
  }
  return { ...state, grid };
}

/** Add a zone (replacing the caster's earlier zone of the same spell) and apply its terrain. */
export function addZone(state: CombatState, z: Zone): CombatState {
  let next = state;
  for (const old of zonesOf(state).filter((o) => o.id === z.id)) next = removeZone(next, old.id);
  next = withZones(next, [...zonesOf(next), z]);
  return applyTerrain(next, z);
}

export function removeZone(state: CombatState, id: string): CombatState {
  const z = zonesOf(state).find((o) => o.id === id);
  if (!z) return state;
  const cleared = clearTerrain(state, z);
  return withZones(cleared, zonesOf(cleared).filter((o) => o.id !== id));
}

/** Drop zones whose caster is gone or no longer concentrating on the spell. */
export function pruneZones(state: CombatState, msgs: Messages = ENGLISH_MESSAGES): { state: CombatState; events: CombatEvent[] } {
  let next = state;
  const events: CombatEvent[] = [];
  for (const z of zonesOf(state)) {
    const caster = state.creatures[z.casterId];
    const concOk = !z.concentration || (caster && !caster.dead && caster.kind === 'character' && (caster as { spellcasting?: { concentration?: { spellId: string } } }).spellcasting?.concentration?.spellId === z.spellId);
    if (caster && !caster.dead && concOk) continue;
    next = removeZone(next, z.id);
    events.push({ kind: 'info', actorId: z.casterId, text: msgs.m('zone.ends', { spell: z.name }) });
  }
  return { state: next, events };
}

/** Resolve a zone's effect on one creature (save, damage, condition), honouring once-per-turn. */
function hit(state: CombatState, ctx: CombatContext, z: Zone, id: string, why: 'zone.enters' | 'zone.startsIn' | 'zone.endsIn'): { state: CombatState; events: CombatEvent[] } {
  if (!affects(state, ctx, z, id)) return { state, events: [] };
  const stamp = turnStamp(state);
  if (z.oncePerTurn && z.lastHit[id] === stamp) return { state, events: [] };
  if (!z.save && !z.damage && !z.condition) return { state, events: [] };
  const zones = zonesOf(state).map((o) => (o.id === z.id ? { ...o, lastHit: { ...o.lastHit, [id]: stamp } } : o));
  let next = withZones(state, zones);
  const name = next.creatures[id]?.name ?? id;
  const events: CombatEvent[] = [{ kind: 'effect', actorId: z.casterId, targetId: id, text: msgsOf(ctx).m(why, { name, spell: z.name }) }];
  if (z.condition && next.creatures[id]!.conditions.some((c) => c.condition === z.condition && c.sourceId === z.sourceId) && !z.damage) return { state: next, events: [] };
  const template = z.template ?? templateFromArea({ shape: 'sphere', size: 5 } as Parameters<typeof templateFromArea>[0], { origin: { x: z.point!.x + 0.5, y: z.point!.y + 0.5 } });
  const r = resolveAreaEffect(next, ctx, {
    casterId: z.casterId,
    template,
    label: z.name,
    ...(z.save && { save: z.save }),
    ...(z.damage && { damage: z.damage }),
    halfOnSave: z.halfOnSuccess,
    ...(z.condition && { conditionOnFail: { condition: z.condition } }),
    conditionSourceId: z.sourceId,
    targetIds: [id],
  });
  if (!r.ok) return { state: next, events };
  next = r.state;
  events.push(...r.events);
  return { state: next, events };
}

/** Zones whose area the creature is in that fire on this trigger. */
function firing(state: CombatState, trigger: ZoneTrigger, id: string): Zone[] {
  return zonesOf(state).filter((z) => z.triggers.includes(trigger) && inZone(state, z, id));
}

/** Start/end of a creature's turn: zone effects on it; the caster's turn end ticks its zones. */
export function zonesAtTurn(state: CombatState, ctx: CombatContext, id: string, when: 'start' | 'end'): { state: CombatState; events: CombatEvent[] } {
  const msgs = msgsOf(ctx);
  let next = pruneZones(state, msgs);
  const events = [...next.events];
  let cur = next.state;
  for (const z of firing(cur, when === 'start' ? 'start_turn' : 'end_turn', id)) {
    const live = zonesOf(cur).find((o) => o.id === z.id);
    if (!live) continue;
    const r = hit(cur, ctx, live, id, when === 'start' ? 'zone.startsIn' : 'zone.endsIn');
    cur = r.state;
    events.push(...r.events);
  }
  if (when === 'end') {
    for (const z of zonesOf(cur).filter((o) => o.casterId === id && o.roundsLeft !== undefined)) {
      if (z.roundsLeft! <= 1) {
        cur = removeZone(cur, z.id);
        events.push({ kind: 'info', actorId: id, text: msgs.m('zone.ends', { spell: z.name }) });
      } else cur = withZones(cur, zonesOf(cur).map((o) => (o.id === z.id ? { ...o, roundsLeft: o.roundsLeft! - 1 } : o)));
    }
  }
  next = pruneZones(cur, msgs);
  return { state: next.state, events: [...events, ...next.events] };
}

/** Who is in which zone now (for 'enter' detection). */
export function zoneMembership(state: CombatState): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const z of zonesOf(state)) m.set(z.id, new Set(Object.keys(state.grid.tokens).filter((id) => inZone(state, z, id))));
  return m;
}

/**
 * After movement (a creature walked, or a zone's anchor/position moved): creatures that are now in a
 * zone with an 'enter' trigger but weren't before (`before` from zoneMembership), plus the mover if its
 * path crossed into the zone, are affected.
 */
export function zonesAfterMove(
  state: CombatState,
  ctx: CombatContext,
  before: Map<string, Set<string>>,
  mover?: { id: string; path: readonly Point[] },
): { state: CombatState; events: CombatEvent[] } {
  let cur = pruneZones(state, msgsOf(ctx)).state;
  const events: CombatEvent[] = [];
  for (const z of zonesOf(cur).filter((o) => o.triggers.includes('enter'))) {
    const was = before.get(z.id) ?? new Set<string>();
    const entered = Object.keys(cur.grid.tokens).filter((id) => !was.has(id) && inZone(cur, z, id));
    if (mover && !was.has(mover.id) && !entered.includes(mover.id)) {
      // Passed through: any path square inside the zone counts.
      const squares = new Set(zoneSquares(cur, z).map(cellKey));
      if (mover.path.some((p) => squares.has(cellKey(p)))) entered.push(mover.id);
    }
    for (const id of entered) {
      const live = zonesOf(cur).find((o) => o.id === z.id);
      if (!live) break;
      const r = hit(cur, ctx, live, id, 'zone.enters');
      cur = r.state;
      events.push(...r.events);
    }
  }
  return { state: cur, events };
}

/** Escape a zone's Restrained condition: an action, Str (Athletics) vs the spell save DC. */
export function escapeZone(state: CombatState, ctx: CombatContext, id: string, zoneId: string): ActionResult<{ success: boolean }> {
  const z = zonesOf(state).find((o) => o.id === zoneId);
  const c = state.creatures[id];
  const { m } = msgsOf(ctx);
  if (!z || !c || !z.condition || !c.conditions.some((x) => x.condition === z.condition && x.sourceId === z.sourceId)) return fail(state, m('zone.notHeld', { name: c?.name ?? id }));
  const paid = spend(state.turns, id, 'action', c, ctx.table, msgsOf(ctx));
  if (!paid.ok) return fail(state, paid.error);
  const r = combatCheck({ ...state, turns: paid.state }, ctx, id, 'str', 'athletics', z.escapeDc ?? 10);
  const success = r.result.success === true;
  let next = r.state;
  if (success) next = withCreature(next, removeCondition(next.creatures[id]!, z.condition, z.sourceId));
  return { ok: true, state: next, events: [{ kind: 'check', actorId: id, text: m('zone.struggles', { name: c.name, spell: z.name, roll: r.result.text }) }], success };
}

export interface ZoneActOptions {
  /** New square for a movable zone / the bolt's target square. */
  to?: Point;
  /** Spiritual Weapon: the creature to attack after moving. */
  targetId?: string;
}

/** The caster uses its zone this turn: move it, call a bolt, or attack with it (see module doc). */
export function zoneAct(state: CombatState, ctx: CombatContext, casterId: string, zoneId: string, o: ZoneActOptions): ActionResult {
  const z = zonesOf(state).find((x) => x.id === zoneId && x.casterId === casterId);
  const caster = state.creatures[casterId];
  const { m } = msgsOf(ctx);
  if (!z || !caster) return fail(state, m('zone.none'));
  if (currentId(state.turns) !== casterId || !state.turns.turnActive) return fail(state, m('turn.notYours', { name: caster.name }));
  const economy = z.bolt?.economy ?? z.move?.economy;
  if (!economy) return fail(state, m('zone.cantMove', { spell: z.name }));
  const paid = spend(state.turns, casterId, economy, caster, ctx.table, msgsOf(ctx));
  if (!paid.ok) return fail(state, paid.error);
  let cur: CombatState = { ...state, turns: paid.state };
  const events: CombatEvent[] = [];

  if (z.bolt) {
    const me = cur.grid.tokens[casterId];
    if (!o.to || !me || distanceFt(me, { ...o.to, size: 'medium' }) > z.bolt.rangeFt) return fail(state, m('zone.pointWithin', { ft: z.bolt.rangeFt }));
    const r = resolveAreaEffect(cur, ctx, {
      casterId,
      template: templateFromArea({ shape: 'sphere', size: z.bolt.radiusFt } as Parameters<typeof templateFromArea>[0], { origin: { x: o.to.x + 0.5, y: o.to.y + 0.5 } }),
      label: z.name,
      ...(z.save && { save: z.save }),
      ...(z.damage && { damage: z.damage }),
      halfOnSave: true,
    });
    if (!r.ok) return fail(state, r.error);
    return { ok: true, state: r.state, events: [{ kind: 'action', actorId: casterId, text: m('zone.bolt', { name: caster.name, spell: z.name }) }, ...r.events] };
  }

  if (o.to) {
    const from = z.point ?? (z.template ? { x: Math.floor(z.template.origin.x), y: Math.floor(z.template.origin.y) } : undefined);
    if (!from) return fail(state, m('zone.cantMove', { spell: z.name }));
    const moved = distanceFt({ ...from, size: 'medium' }, { ...o.to, size: 'medium' });
    if (moved > z.move!.ft) return fail(state, m('zone.movesMax', { spell: z.name, ft: z.move!.ft }));
    const before = zoneMembership(cur);
    cur = clearTerrain(cur, z);
    const dx = o.to.x - from.x;
    const dy = o.to.y - from.y;
    const movedZone: Zone = {
      ...z,
      terrain: [],
      ...(z.point && { point: { ...o.to } }),
      ...(z.template && { template: { ...z.template, origin: { x: z.template.origin.x + dx, y: z.template.origin.y + dy } } }),
    };
    cur = applyTerrain(withZones(cur, zonesOf(cur).map((x) => (x.id === z.id ? movedZone : x))), movedZone);
    events.push({ kind: 'move', actorId: casterId, text: m('zone.moves', { name: caster.name, spell: z.name, ft: moved }) });
    const after = zonesAfterMove(cur, ctx, before);
    cur = after.state;
    events.push(...after.events);
  }

  if (z.attack && o.targetId) {
    const s = zoneStrike(cur, ctx, z.id, o.targetId);
    if (!s.ok) return fail(state, s.error);
    cur = s.state;
    events.push(...s.events);
  }
  return { ok: true, state: cur, events };
}

/** Spiritual Weapon: a melee spell attack from the zone's square (no action cost here). */
export function zoneStrike(state: CombatState, ctx: CombatContext, zoneId: string, targetId: string): ActionResult {
  const z = zonesOf(state).find((x) => x.id === zoneId);
  const target = state.creatures[targetId];
  const caster = z ? state.creatures[z.casterId] : undefined;
  const { m } = msgsOf(ctx);
  if (!z?.attack || !z.point || !target || !caster || target.dead) return fail(state, m('act.invalidTarget'));
  const tt = state.grid.tokens[targetId];
  if (!tt || distanceFt({ ...z.point, size: 'medium' }, tt) > z.attack.reachFt) return fail(state, m('zone.notWithin', { name: target.name, ft: z.attack.reachFt, spell: z.name }));
  const ectx = createEffectContext({ rng: ctx.rng, ...(ctx.msgs && { msgs: ctx.msgs }), source: caster, targets: [target], attackBonus: z.attack.attackBonus, spellMod: z.attack.spellMod, damageBonus: z.attack.spellMod });
  executeEffects([{ kind: 'attack', attack: 'melee_spell', onHit: [{ kind: 'damage', damage: z.attack.damage }] }], [targetId], ectx);
  const creatures = { ...state.creatures };
  for (const [id, c] of ectx.creatures) creatures[id] = c;
  const events = ectx.log.map((l): CombatEvent => ({ kind: 'attack', actorId: z.casterId, ...(l.targetId && { targetId: l.targetId }), text: l.text }));
  return { ok: true, state: { ...state, creatures }, events: [{ kind: 'action', actorId: z.casterId, targetId, text: m('zone.strikes', { spell: z.name, name: target.name }) }, ...events] };
}

/** Zones the creature controls that it can act with (for the UI / AI). */
export function zonesOfCaster(state: CombatState, casterId: string): Zone[] {
  return zonesOf(state).filter((z) => z.casterId === casterId && (z.move || z.bolt));
}

export { ZONE_SPELLS };
