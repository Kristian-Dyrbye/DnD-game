/**
 * Encounter controller: sets up a fight (grid, tokens, initiative) and runs it turn by turn. The
 * player controls the hero; companions act through the companion AI (following the hero, focusing
 * on the hero's target) and foes through the enemy AI. It is plain data + pure functions, so the client can preview and the server can run it
 * with authority (A068 wires it into the game session). Every step returns log lines with the math.
 */
import type { Character, Creature } from '../core/creature';
import type { Rng } from '../core/rng';
import type { SrdDatabase } from '../data/srd';
import { monsterToCreature } from '../rules/monsters';
import { takeAiTurn, type AiOptions } from './ai';
import { takeCompanionTurn } from './companionAi';
import { resolveAttack } from './attack';
import { dash, disengage, dodge, escapeGrapple, grapple, moveCreature, readiedOf, ready, shove, triggerReadied } from './actions';
import { checkAttack, findProfile } from './attack';
import { canReact } from './turns';
import { influence, study, useMagicItem, utilize, type InfluenceSkill, type StudySkill } from './otherActions';
import { escapeZone, zoneAct, zonesOfCaster, type Zone } from './zones';
import { reachProblem } from './castAction';
import { areHostile } from './combatState';
import type { ActionResult } from './combatState';
import { castInCombat, featureInCombat, spellRangeFt } from './castAction';
import { previewArea, templateFromArea, templateFromCaster } from './aoe';
import { dbOf } from './combatState';
import type { CombatContext, CombatEvent, CombatState } from './combatState';
import { canPlace, createGrid, distanceFt, placeToken, setCell, type Grid, type Point } from './grid';
import { rollInitiativeOrder, toEntries } from './initiative';
import { currentId, livingSides, nextTurn, startCombat } from './turns';
import { zonesAtTurn } from './zones';

export type EncounterStatus = 'ongoing' | 'won' | 'lost';

export interface Encounter {
  state: CombatState;
  heroId: string;
  /** Creatures the player controls (the hero + companions toggled to player control). */
  controlled?: string[];
  /** Initial sides (for the AI's morale rule). */
  roster: Record<string, string>;
  log: string[];
  status: EncounterStatus;
  /** The hero's last attack target (companions focus on it). */
  focusId?: string;
  /** Lines ever pushed to `log` (the log itself is capped), for picking up new lines. */
  logSeq?: number;
}

export const LOG_CAP = 200;

export type PlayerAction =
  /** `drag`: creatures the mover grapples and drags along (double movement cost). */
  | { kind: 'move'; path: Point[]; drag?: string[] }
  | { kind: 'attack'; targetId: string; profileId?: string }
  | { kind: 'dash' }
  | { kind: 'disengage' }
  | { kind: 'dodge' }
  | { kind: 'end_turn' }
  /** Cast a prepared spell; `area` = the aimed square for area spells (targets are then the creatures inside). */
  | { kind: 'cast'; spellId: string; targetIds: string[]; slotLevel?: number; area?: Point }
  | { kind: 'feature'; actionId: string; targetId?: string }
  | { kind: 'grapple'; targetId: string }
  | { kind: 'shove'; targetId: string; effect: 'push' | 'prone' }
  | { kind: 'escape_grapple' }
  | { kind: 'study'; skill: StudySkill; topic: string }
  | { kind: 'influence'; targetId: string; skill: InfluenceSkill }
  | { kind: 'utilize'; what: string }
  | { kind: 'use_item'; uid: string; targetId?: string }
  /** Ready an attack (fires when an enemy ends its turn within reach) or a spell (within range). */
  | { kind: 'ready'; attackProfileId?: string; spellId?: string }
  /** Use a zone you created: move it to `to` (Spiritual Weapon then strikes `targetId` or an adjacent foe), or a Call Lightning bolt. */
  | { kind: 'zone'; zoneId: string; to?: Point; targetId?: string }
  | { kind: 'escape_zone'; zoneId: string };

/** A simple arena: open ground with a few pillars and patches of difficult terrain (seeded). */
export function defaultArena(rng: Rng, width = 12, height = 10): Grid {
  const g = createGrid(width, height);
  for (let i = 0; i < 4; i++) setCell(g, { x: rng.int(3, width - 4), y: rng.int(1, height - 2) }, { blocking: true });
  for (let i = 0; i < 6; i++) setCell(g, { x: rng.int(2, width - 3), y: rng.int(0, height - 1) }, { terrain: 'difficult' });
  return g;
}

function place(grid: Grid, c: Creature, cols: number[], rng: Rng): void {
  for (let tries = 0; tries < 200; tries++) {
    const p = { x: rng.pick(cols), y: rng.int(0, grid.height - 1) };
    if (canPlace(grid, c.size, p)) {
      placeToken(grid, { id: c.id, x: p.x, y: p.y, size: c.size });
      return;
    }
  }
  throw new Error(`No room to place ${c.name}`);
}

const push = (enc: Encounter, lines: string[]) => {
  const kept = lines.filter(Boolean);
  enc.logSeq = (enc.logSeq ?? enc.log.length) + kept.length;
  enc.log.push(...kept);
  if (enc.log.length > LOG_CAP) enc.log.splice(0, enc.log.length - LOG_CAP);
};

export interface EncounterSetup {
  hero: Character;
  companions?: Character[];
  /** Companion ids the player controls in this fight (default: all AI). */
  playerControlled?: string[];
  monsters: { id: string; count: number }[];
  /** Friendly stat blocks on the party's side (AI-controlled with the companion AI). */
  allies?: { id: string; count: number }[];
  db: SrdDatabase;
  grid?: Grid;
}

/** Places everyone, rolls initiative and runs AI turns until the hero is up (or it's over). */
export function setupEncounter(setup: EncounterSetup, ctx: CombatContext): Encounter {
  const grid = setup.grid ?? defaultArena(ctx.rng);
  const spawn = (list: { id: string; count: number }[], prefix = '', label = '') =>
    list.flatMap((m) => {
      const data = setup.db.monsters.get(m.id);
      if (!data) throw new Error(`Unknown monster ${m.id}`);
      return Array.from({ length: m.count }, (_, i) => monsterToCreature(data, `${prefix}${m.id}_${i + 1}`, `${label}${data.name}${m.count > 1 ? ` ${i + 1}` : ''}`));
    });
  const allies = spawn(setup.allies ?? [], 'ally_', 'Allied ');
  const party: Creature[] = [setup.hero, ...(setup.companions ?? []), ...allies];
  const foes: Creature[] = spawn(setup.monsters);
  for (const c of party) place(grid, c, [0, 1], ctx.rng);
  for (const c of foes) place(grid, c, [grid.width - 2, grid.width - 1], ctx.rng);
  const rolls = rollInitiativeOrder(
    [...party.map((c) => ({ creature: c, side: 'party' as const })), ...foes.map((c) => ({ creature: c, side: 'enemy' as const, group: c.id.replace(/_\d+$/, '') }))],
    { rng: ctx.rng, ...(ctx.db && { db: ctx.db }) },
  );
  const creatures = Object.fromEntries([...party, ...foes].map((c) => [c.id, c]));
  const turns = startCombat(toEntries(rolls));
  const enc: Encounter = {
    state: { grid, turns, creatures },
    heroId: setup.hero.id,
    controlled: [setup.hero.id, ...(setup.playerControlled ?? []).filter((id) => (setup.companions ?? []).some((c) => c.id === id))],
    roster: Object.fromEntries(turns.order.map((e) => [e.id, e.side])),
    log: ['Roll for initiative!', ...rolls.map((r) => `${creatures[r.id]?.name ?? r.id}: ${r.text}`)],
    status: 'ongoing',
  };
  advance(enc, ctx);
  return enc;
}

function turnCtx(enc: Encounter, ctx: CombatContext) {
  return { rng: ctx.rng, grid: enc.state.grid, ...(ctx.db && { db: ctx.db }), ...(ctx.table && { table: ctx.table }) };
}

function checkEnd(enc: Encounter): boolean {
  const sides = livingSides(enc.state.turns, enc.state.creatures);
  const hero = enc.state.creatures[enc.heroId];
  if (!sides.has('enemy')) enc.status = 'won';
  else if (!sides.has('party') || (hero && hero.dead)) enc.status = 'lost';
  if (enc.status !== 'ongoing') push(enc, [enc.status === 'won' ? 'Victory!' : 'Defeat…']);
  return enc.status !== 'ongoing';
}

/** Ends the current turn and lets the AI act until it is the hero's turn again (or the fight ends). */
function advance(enc: Encounter, ctx: CombatContext, aiOpts: AiOptions = {}): void {
  for (let guard = 0; guard < 200; guard++) {
    if (checkEnd(enc)) return;
    const ending = enc.state.turns.turnActive ? currentId(enc.state.turns) : undefined;
    if (ending) zoneTurn(enc, ctx, ending, 'end');
    const r = nextTurn(enc.state.turns, enc.state.creatures, turnCtx(enc, ctx));
    enc.state = { ...enc.state, turns: r.state, creatures: r.creatures };
    push(enc, r.events.map((e) => e.text));
    const id = currentId(enc.state.turns);
    if (!id) return;
    zoneTurn(enc, ctx, id, 'start');
    if (checkEnd(enc)) return;
    if (isControlled(enc, id)) {
      const pc = enc.state.creatures[id];
      // A downed character rolls death saves in startTurn; nothing else to do this turn.
      if (pc && pc.hp > 0) return;
      continue;
    }
    const c = enc.state.creatures[id];
    if (!c || c.hp <= 0) continue;
    // Companions follow the hero and focus on the hero's target; everyone else is the enemy AI.
    const res =
      enc.roster[id] === 'party'
        ? takeCompanionTurn(enc.state, ctx, id, { roster: enc.roster, leaderId: enc.heroId, ...(enc.focusId && { focusId: enc.focusId }), ...aiOpts })
        : takeAiTurn(enc.state, ctx, id, { roster: enc.roster, ...aiOpts });
    enc.state = res.state;
    push(enc, res.events.map((e: CombatEvent) => e.text));
    if (enc.roster[id] === 'party') companionZones(enc, ctx, id);
    else fireReadied(enc, ctx, id);
  }
}

/**
 * Readied actions of player-controlled creatures fire when an enemy ends its turn in reach (attack)
 * or range (spell) — checked after each enemy turn rather than mid-move (simplification).
 */
function fireReadied(enc: Encounter, ctx: CombatContext, foeId: string): void {
  const foe = enc.state.creatures[foeId];
  if (!foe || foe.hp <= 0) return;
  for (const pcId of enc.controlled ?? [enc.heroId]) {
    const pc = enc.state.creatures[pcId];
    const r = pc ? readiedOf(pc) : undefined;
    if (!pc || !r || pc.hp <= 0 || !areHostile(enc.state, ctx, pcId, foeId) || !canReact(enc.state.turns, pcId, pc, ctx.table)) continue;
    let fire = false;
    if (r.action.kind === 'attack') {
      const profile = findProfile(pc, dbOf(ctx), r.action.profileId);
      fire = !!profile && checkAttack(enc.state, ctx, pcId, foeId, profile).ok;
    }
    else if (r.action.kind === 'spell') {
      const spell = dbOf(ctx).spells.get(r.action.spellId);
      fire = !!spell && !reachProblem(enc.state, pcId, foeId, spellRangeFt(spell));
    }
    if (!fire) continue;
    const t = triggerReadied(enc.state, ctx, pcId, { targetId: foeId, targetIds: [foeId] });
    push(enc, t.events.map((x) => x.text));
    if (t.ok) enc.state = t.state;
  }
}

/** AI companions keep using their zones: Spiritual Weapon moves next to the nearest foe and strikes. */
function companionZones(enc: Encounter, ctx: CombatContext, id: string): void {
  for (const z of zonesOfCaster(enc.state, id)) {
    if (!z.attack || !enc.state.turns.budgets[id]?.bonusAction) continue;
    const pick = strikeSpot(enc, ctx, z, id);
    if (!pick) continue;
    const r = zoneAct(enc.state, ctx, id, z.id, pick);
    push(enc, r.events.map((x) => x.text));
    if (r.ok) enc.state = r.state;
  }
}

/** A square next to the nearest hostile within the zone's move range, and that hostile. */
function strikeSpot(enc: Encounter, ctx: CombatContext, z: Zone, casterId: string): { to: Point; targetId: string } | undefined {
  if (!z.point || !z.move) return undefined;
  const foes = Object.keys(enc.state.creatures)
    .filter((f) => (enc.state.creatures[f]?.hp ?? 0) > 0 && enc.state.grid.tokens[f] && areHostile(enc.state, ctx, casterId, f))
    .sort((a, b) => distanceFt({ ...z.point!, size: 'medium' }, enc.state.grid.tokens[a]!) - distanceFt({ ...z.point!, size: 'medium' }, enc.state.grid.tokens[b]!));
  for (const f of foes) {
    const t = enc.state.grid.tokens[f]!;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const to = { x: t.x + dx, y: t.y + dy };
        if (to.x < 0 || to.y < 0 || to.x >= enc.state.grid.width || to.y >= enc.state.grid.height) continue;
        if (distanceFt({ ...z.point, size: 'medium' }, { ...to, size: 'medium' }) <= z.move.ft && distanceFt({ ...to, size: 'medium' }, t) <= (z.attack?.reachFt ?? 5)) return { to, targetId: f };
      }
  }
  return undefined;
}

/** Zone effects at the start/end of a creature's turn (Spirit Guardians, Web, Black Tentacles...). */
function zoneTurn(enc: Encounter, ctx: CombatContext, id: string, when: 'start' | 'end'): void {
  if (!enc.state.zones?.length) return;
  const z = zonesAtTurn(enc.state, ctx, id, when);
  enc.state = z.state;
  push(enc, z.events.map((e) => e.text));
}

/** Creatures inside an area spell aimed at `aim` (self-centred shapes start at the caster). */
export function areaTargets(enc: Encounter, ctx: CombatContext, casterId: string, spellId: string, aim: Point): string[] {
  const spell = dbOf(ctx).spells.get(spellId);
  if (!spell?.area) return [];
  const fromSelf = ['cone', 'line', 'emanation'].includes(spell.area.shape) || spell.range.kind === 'self';
  const centre = { x: aim.x + 0.5, y: aim.y + 0.5 };
  const tpl = fromSelf ? templateFromCaster(enc.state.grid, casterId, spell.area, centre) : templateFromArea(spell.area, { origin: centre });
  return previewArea(enc.state.grid, tpl, { excludeIds: fromSelf ? [casterId] : [] }).creatureIds.filter((id) => (enc.state.creatures[id]?.hp ?? 0) > 0);
}

/** Spiritual Weapon: the foes next to where it appears (it strikes the first). */
function foesNextTo(enc: Encounter, ctx: CombatContext, casterId: string, spellId: string, aim: Point): string[] {
  if (spellId !== 'spiritual_weapon') return [];
  return Object.keys(enc.state.creatures).filter((f) => (enc.state.creatures[f]?.hp ?? 0) > 0 && enc.state.grid.tokens[f] && areHostile(enc.state, ctx, casterId, f) && distanceFt({ ...aim, size: 'medium' }, enc.state.grid.tokens[f]!) <= 5);
}

/** Log lines added since `seq` (a previous `logSeq`), as far as the capped log still holds them. */
export function logSince(enc: Encounter, seq: number): string[] {
  const n = Math.min(enc.log.length, (enc.logSeq ?? enc.log.length) - seq);
  return n > 0 ? enc.log.slice(-n) : [];
}

/** Does the player control this creature (the hero, or a companion toggled to player control)? */
export function isControlled(enc: Encounter, id: string): boolean {
  return id === enc.heroId || (enc.controlled ?? []).includes(id);
}

/** Applies one action for the player-controlled creature whose turn it is. Returns an error message if refused. */
export function playerAct(enc: Encounter, ctx: CombatContext, a: PlayerAction): string | undefined {
  if (enc.status !== 'ongoing') return 'The fight is over.';
  const id = currentId(enc.state.turns);
  if (!id || !isControlled(enc, id)) return 'It is not your turn.';
  if (a.kind === 'end_turn') {
    advance(enc, ctx);
    return undefined;
  }
  if (a.kind === 'cast' && a.area) {
    const spell = dbOf(ctx).spells.get(a.spellId);
    const range = spell ? spellRangeFt(spell) : undefined;
    const me = enc.state.grid.tokens[id];
    if (spell && range !== undefined && range > 0 && me && distanceFt(me, { x: a.area.x, y: a.area.y, size: 'medium' }) > range) return `${spell.name}: that point is out of range (${range} ft).`;
  }
  if (a.kind === 'cast' || a.kind === 'feature') {
    const r =
      a.kind === 'feature'
        ? featureInCombat(enc.state, ctx, { actorId: id, actionId: a.actionId, ...(a.targetId && { targetId: a.targetId }) })
        : castInCombat(enc.state, ctx, {
            casterId: id,
            spellId: a.spellId,
            targetIds: a.area ? [...areaTargets(enc, ctx, id, a.spellId, a.area), ...a.targetIds, ...foesNextTo(enc, ctx, id, a.spellId, a.area)] : a.targetIds,
            ...(a.area && { areaTargets: true, aim: a.area }),
            ...(a.slotLevel && { slot: { kind: 'slot' as const, level: a.slotLevel } }),
          });
    push(enc, r.events.map((e) => e.text));
    if (!r.ok) return r.error;
    enc.state = r.state;
    if (a.kind === 'cast' && a.targetIds[0]) enc.focusId = a.targetIds[0];
    checkEnd(enc);
    return undefined;
  }
  if (a.kind === 'zone') {
    const z = enc.state.zones?.find((x) => x.id === a.zoneId);
    let targetId = a.targetId;
    if (z?.attack && a.to && !targetId) {
      // Strike the first foe next to the new spot.
      const to = a.to;
      targetId = Object.keys(enc.state.creatures).find((f) => (enc.state.creatures[f]?.hp ?? 0) > 0 && enc.state.grid.tokens[f] && areHostile(enc.state, ctx, id, f) && distanceFt({ ...to, size: 'medium' }, enc.state.grid.tokens[f]!) <= (z.attack?.reachFt ?? 5));
    }
    return finish(enc, ctx, id, zoneAct(enc.state, ctx, id, a.zoneId, { ...(a.to && { to: a.to }), ...(targetId && { targetId }) }));
  }
  const other = otherAction(enc, ctx, id, a);
  if (other) return finish(enc, ctx, id, other);
  const res =
    a.kind === 'move'
      ? moveCreature(enc.state, ctx, id, a.path, { ...(a.drag?.length && { drag: a.drag }) })
      : a.kind === 'attack'
        ? resolveAttack(enc.state, ctx, { attackerId: id, targetId: a.targetId, kind: 'action', ...(a.profileId && { profile: a.profileId }) })
        : a.kind === 'dash'
          ? dash(enc.state, ctx, id)
          : a.kind === 'disengage'
            ? disengage(enc.state, ctx, id)
            : a.kind === 'dodge'
              ? dodge(enc.state, ctx, id)
              : undefined;
  if (!res) return 'Unknown action.';
  push(enc, res.events.map((e) => e.text));
  if (!res.ok) return res.error;
  enc.state = res.state;
  if (a.kind === 'attack') enc.focusId = a.targetId;
  if (checkEnd(enc)) return undefined;
  // Dropping on your own turn (e.g. an Opportunity Attack) ends it.
  if ((enc.state.creatures[id]?.hp ?? 0) <= 0) advance(enc, ctx);
  return undefined;
}

/** The new combat actions (grapple, shove, study, influence, items, ready, zones). */
function otherAction(enc: Encounter, ctx: CombatContext, id: string, a: PlayerAction): ActionResult | undefined {
  const s = enc.state;
  switch (a.kind) {
    case 'grapple':
      return grapple(s, ctx, id, a.targetId);
    case 'shove':
      return shove(s, ctx, id, a.targetId, { effect: a.effect });
    case 'escape_grapple':
      return escapeGrapple(s, ctx, id);
    case 'study':
      return study(s, ctx, id, { skill: a.skill, topic: a.topic });
    case 'influence':
      return influence(s, ctx, id, a.targetId, { skill: a.skill });
    case 'utilize':
      return utilize(s, ctx, id, a.what);
    case 'use_item':
      return useMagicItem(s, ctx, id, a.uid, a.targetId);
    case 'ready':
      if (a.spellId) return ready(s, ctx, id, 'an enemy comes within range', { kind: 'spell', spellId: a.spellId });
      return ready(s, ctx, id, 'an enemy comes within reach', { kind: 'attack', ...(a.attackProfileId && { profileId: a.attackProfileId }) });
    case 'escape_zone':
      return escapeZone(s, ctx, id, a.zoneId);
    default:
      return undefined;
  }
}

/** Log, apply and check the end of a player action result. */
function finish(enc: Encounter, ctx: CombatContext, id: string, r: ActionResult): string | undefined {
  push(enc, r.events.map((e) => e.text));
  if (!r.ok) return r.error;
  enc.state = r.state;
  if (checkEnd(enc)) return undefined;
  if ((enc.state.creatures[id]?.hp ?? 0) <= 0) advance(enc, ctx);
  return undefined;
}
