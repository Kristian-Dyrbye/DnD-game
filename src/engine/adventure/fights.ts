/**
 * Combat ↔ story (spec §9, §10): starts an adventure encounter on the battle map, runs hero
 * actions, and when the fight ends hands the result back to the story — the hero's HP and
 * resources, XP for defeated monsters, the encounter's win/lose/flee outcome, and in Heroic mode a
 * defeat outcome instead of death (Hardcore: the hero dies; a new hero can continue the world).
 */
import type { Character } from '../core/creature';
import type { SrdDatabase } from '../data/srd';
import type { CombatContext } from '../combat/combatState';
import { playerAct, setupEncounter, type Encounter, type PlayerAction } from '../combat/encounter';
import type { GameState } from '../session/gameState';
import { getMap } from '../world/travel';
import type { Lore } from '../world/lore';
import type { FlagRegistry } from '../world/flags';
import type { Rng } from '../core/rng';
import { applyDefeat, pickDefeatOutcome, recordFallen, type DefeatResult, type DefeatTable } from './defeat';
import { getProgress, resolveEncounter, type RunContext, type StepResult } from './runner';
import { scaleMonsters } from './encounters';

export interface ActiveFight {
  adventureId: string;
  encounterId: string;
  enc: Encounter;
}

export function activeFight(state: GameState): ActiveFight | undefined {
  return state.extensions.combat as ActiveFight | undefined;
}

/** Starts the adventure encounter as a tactical fight with the hero and companions. */
export function startFight(ctx: RunContext, encounterId: string, rng: Rng, db: SrdDatabase): ActiveFight {
  const def = ctx.adventure.encounters.find((e) => e.id === encounterId);
  if (!def) throw new Error(`Unknown encounter ${encounterId}`);
  const cctx: CombatContext = { rng, db };
  // Scale to the real party with SRD budgets (authored lists assume a party of four).
  const party = [ctx.state.hero, ...ctx.state.companions].filter((c) => !c.dead);
  const monsters = db.tables ? scaleMonsters(def.monsters, party.map((c) => c.classes.reduce((s, x) => s + x.level, 0)), db, db.tables, { pool: def.scaling?.pool ?? [] }) : def.monsters;
  const enc = setupEncounter({ hero: ctx.state.hero, companions: ctx.state.companions, monsters, db }, cctx);
  const fight: ActiveFight = { adventureId: ctx.adventure.id, encounterId, enc };
  ctx.state.extensions.combat = fight;
  return fight;
}

/** One hero action. Returns an error message when refused. */
export function fightAct(state: GameState, action: PlayerAction, rng: Rng, db: SrdDatabase): string | undefined {
  const f = activeFight(state);
  if (!f) return 'There is no fight going on.';
  return playerAct(f.enc, { rng, db }, action);
}

export type FightEnd = 'win' | 'lose' | 'flee';

export interface FightResult {
  how: FightEnd;
  xp: number;
  step: StepResult;
  defeat?: DefeatResult;
  /** Hardcore: the hero died. */
  heroDied?: boolean;
}

/** Copies the combat versions of the party (HP, conditions, resources, slots) back into the story. */
function syncParty(state: GameState, enc: Encounter): void {
  const back = (c: Character): Character => {
    const fought = enc.state.creatures[c.id] as Character | undefined;
    return fought ? { ...c, ...fought, inventory: c.inventory, coins: c.coins, xp: c.xp } : c;
  };
  state.hero = back(state.hero);
  state.companions = state.companions.map(back);
}

/**
 * Ends the fight: party synced, XP for defeated foes on a win (SRD XP, split among the party),
 * the encounter outcome applied, and for a loss either a Heroic defeat outcome or Hardcore death.
 */
export function finishFight(ctx: RunContext, how: FightEnd, deps: { db: SrdDatabase; rng: Rng; lore?: Lore; flags?: FlagRegistry; defeats?: DefeatTable }): FightResult {
  const f = activeFight(ctx.state);
  if (!f) throw new Error('There is no fight going on.');
  const { state } = ctx;
  syncParty(state, f.enc);
  delete state.extensions.combat;

  let xp = 0;
  if (how === 'win') {
    const foes = Object.values(f.enc.state.creatures).filter((c) => f.enc.roster[c.id] === 'enemy');
    const total = foes.reduce((s, c) => s + (deps.db.monsters.get(c.statBlockId ?? '')?.xp ?? 0), 0);
    const party = [state.hero, ...state.companions].filter((c) => !c.dead);
    xp = Math.floor(total / Math.max(1, party.length));
    for (const c of party) c.xp += xp;
  }

  if (how === 'lose' && state.mode === 'hardcore') {
    state.hero.dead = true;
    state.hero.hp = 0;
    recordFallen(state, state.hero, f.enc.log.at(-2) ?? 'fell in battle');
    return { how, xp, step: { facts: [`${state.hero.name} has fallen.`], rolls: [], entered: [], items: [], coins: 0, xp: 0 }, heroDied: true };
  }

  const def = ctx.adventure.encounters.find((e) => e.id === f.encounterId);
  const authoredLoss = how === 'lose' && def && (def.lose.text || def.lose.goto);
  let defeat: DefeatResult | undefined;
  if (how === 'lose') {
    const map = getMap(state);
    const loc = map?.current ?? ctx.adventure.chapters.flatMap((c) => c.scenes).find((s) => s.id === getProgress(state)?.sceneId)?.locationId;
    const regionId = deps.lore?.locations.find((l) => l.id === loc)?.regionId ?? ctx.adventure.regionId;
    const enemies = Object.values(f.enc.state.creatures).filter((c) => f.enc.roster[c.id] === 'enemy').map((c) => c.statBlockId ?? '');
    if (deps.defeats && !authoredLoss) {
      defeat = applyDefeat(state, pickDefeatOutcome(deps.defeats, { ...(loc && { locationId: loc }), ...(regionId && { regionId }), enemies }, deps.db, state, deps.flags), { rng: deps.rng, ...(deps.lore && { lore: deps.lore }), ...(deps.flags && { flags: deps.flags }), ...(regionId && { regionId }) });
    } else {
      // Authored defeat: the adventure says what happens; the hero still survives at 1 HP.
      state.hero.hp = Math.max(1, state.hero.hp);
      state.hero.dead = false;
      state.hero.deathSaves = { successes: 0, failures: 0, stable: false };
      state.hero.conditions = state.hero.conditions.filter((c) => c.condition !== 'unconscious');
    }
  }
  const step = resolveEncounter(ctx, f.encounterId, how);
  if (defeat) step.facts.unshift(...defeat.facts);
  return { how, xp, step, ...(defeat && { defeat }) };
}
