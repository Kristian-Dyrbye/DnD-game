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
import { dash, disengage, dodge, moveCreature } from './actions';
import { castInCombat, featureInCombat, spellRangeFt } from './castAction';
import { previewArea, templateFromArea, templateFromCaster } from './aoe';
import { dbOf } from './combatState';
import type { CombatContext, CombatEvent, CombatState } from './combatState';
import { canPlace, createGrid, distanceFt, placeToken, setCell, type Grid, type Point } from './grid';
import { rollInitiativeOrder, toEntries } from './initiative';
import { currentId, livingSides, nextTurn, startCombat } from './turns';

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
}

export const LOG_CAP = 200;

export type PlayerAction =
  | { kind: 'move'; path: Point[] }
  | { kind: 'attack'; targetId: string; profileId?: string }
  | { kind: 'dash' }
  | { kind: 'disengage' }
  | { kind: 'dodge' }
  | { kind: 'end_turn' }
  /** Cast a prepared spell; `area` = the aimed square for area spells (targets are then the creatures inside). */
  | { kind: 'cast'; spellId: string; targetIds: string[]; slotLevel?: number; area?: Point }
  | { kind: 'feature'; actionId: string; targetId?: string };

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
  enc.log.push(...lines.filter(Boolean));
  if (enc.log.length > LOG_CAP) enc.log.splice(0, enc.log.length - LOG_CAP);
};

export interface EncounterSetup {
  hero: Character;
  companions?: Character[];
  /** Companion ids the player controls in this fight (default: all AI). */
  playerControlled?: string[];
  monsters: { id: string; count: number }[];
  db: SrdDatabase;
  grid?: Grid;
}

/** Places everyone, rolls initiative and runs AI turns until the hero is up (or it's over). */
export function setupEncounter(setup: EncounterSetup, ctx: CombatContext): Encounter {
  const grid = setup.grid ?? defaultArena(ctx.rng);
  const party: Creature[] = [setup.hero, ...(setup.companions ?? [])];
  const foes: Creature[] = setup.monsters.flatMap((m) => {
    const data = setup.db.monsters.get(m.id);
    if (!data) throw new Error(`Unknown monster ${m.id}`);
    return Array.from({ length: m.count }, (_, i) => monsterToCreature(data, `${m.id}_${i + 1}`, m.count > 1 ? `${data.name} ${i + 1}` : data.name));
  });
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
    const r = nextTurn(enc.state.turns, enc.state.creatures, turnCtx(enc, ctx));
    enc.state = { ...enc.state, turns: r.state, creatures: r.creatures };
    push(enc, r.events.map((e) => e.text));
    const id = currentId(enc.state.turns);
    if (!id) return;
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
  }
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
        : castInCombat(enc.state, ctx, { casterId: id, spellId: a.spellId, targetIds: a.area ? areaTargets(enc, ctx, id, a.spellId, a.area) : a.targetIds, ...(a.area && { areaTargets: true }), ...(a.slotLevel && { slot: { kind: 'slot' as const, level: a.slotLevel } }) });
    push(enc, r.events.map((e) => e.text));
    if (!r.ok) return r.error;
    enc.state = r.state;
    if (a.kind === 'cast' && a.targetIds[0]) enc.focusId = a.targetIds[0];
    checkEnd(enc);
    return undefined;
  }
  const res =
    a.kind === 'move'
      ? moveCreature(enc.state, ctx, id, a.path)
      : a.kind === 'attack'
        ? resolveAttack(enc.state, ctx, { attackerId: id, targetId: a.targetId, kind: 'action', ...(a.profileId && { profile: a.profileId }) })
        : a.kind === 'dash'
          ? dash(enc.state, ctx, id)
          : a.kind === 'disengage'
            ? disengage(enc.state, ctx, id)
            : dodge(enc.state, ctx, id);
  push(enc, res.events.map((e) => e.text));
  if (!res.ok) return res.error;
  enc.state = res.state;
  if (a.kind === 'attack') enc.focusId = a.targetId;
  if (checkEnd(enc)) return undefined;
  // Dropping on your own turn (e.g. an Opportunity Attack) ends it.
  if ((enc.state.creatures[id]?.hp ?? 0) <= 0) advance(enc, ctx);
  return undefined;
}
