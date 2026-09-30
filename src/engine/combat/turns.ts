/**
 * Encounter turn loop and action economy (Build Prompt §10, SRD 5.2.1 "Combat" / "Your Turn",
 * "Bonus Actions", "Reactions", "Interacting with Things", "Moving around Other Creatures",
 * "Dropping to 0 Hit Points", "Death Saving Throws").
 *
 * State (`TurnState`, zod-validated plain JSON for GameState): round, initiative order, current
 * index and a per-combatant turn budget. Creatures are kept outside, as `Record<id, Creature>`;
 * every function is pure and returns updated state/creatures plus `TurnEvent`s to narrate/log.
 *
 * Rules:
 * - On its turn a creature has one action, one bonus action, one free object interaction and
 *   movement up to its Speed (× (1 + Dashes)). A reaction is regained at the start of the
 *   creature's OWN turn only. Incapacitated creatures can't take actions, bonus actions or reactions.
 * - Start of turn: reset budget; start_of_turn effect expiry; once-per-turn effect resets and
 *   Heroism temp HP; monster recharge rolls; death save for a character at 0 HP (not stable).
 * - End of turn: lingering spell damage/saves (Acid Arrow, Sleep, Fear), condition end-of-turn
 *   saves, round countdowns (`roundsLeft`) on conditions, effects and concentration,
 *   end_of_turn effect expiry, and the Prone rule for ending a turn in another creature's space
 *   (Prone unless Tiny or larger than that creature).
 * - Turn order skips dead creatures; a monster at 0 HP is dead and leaves the order.
 */
import { z } from 'zod';
import type { Character, Creature } from '../core/creature';
import { SideSchema } from '../core/creature';
import type { Rng } from '../core/rng';
import type { SrdDatabase } from '../data/srd';
import { loadSrd } from '../data/srdBundle';
import { SIZES } from '../rules/basics';
import { onTurnEvent, tickEffects } from '../rules/activeEffects';
import { applyCondition, canAct, endOfTurnSaves, hasCondition, removeCondition, tickConditions, type ConditionTable } from '../rules/conditions';
import { needsDeathSave, rollDeathSave } from '../rules/death';
import { rollRecharges } from '../rules/monsters';
import { endConcentration } from '../rules/spellcasting';
import { revertExpiredEffects, startOfTurnEffects } from '../rules/spellHooks';
import { endOfTurnSpellEffects } from '../rules/spellHooks2';
import { deathSaveAdvantage, endOfTurnSpellEffects3, resetOncePerTurnEffects } from '../rules/spellHooks3';
import { footprintSize, type Grid } from './grid';
import { ENGLISH_MESSAGES, type Messages } from '../i18n';
import { movementBudget, standUpCost, type MoveMode } from './movement';
import { compareInitiative, type InitiativeEntry } from './initiative';

// ---------------------------------------------------------------- schema

export const TurnBudgetSchema = z.object({
  action: z.boolean(),
  bonusAction: z.boolean(),
  reaction: z.boolean(),
  movementSpentFt: z.number().int().min(0),
  dashes: z.number().int().min(0),
  disengaged: z.boolean(),
  objectInteraction: z.boolean(),
  /** Attacks left in the current Attack action (Extra Attack / Multiattack); set by the Attack action. */
  attacksLeft: z.number().int().min(0).optional(),
});
export type TurnBudget = z.infer<typeof TurnBudgetSchema>;

export const InitiativeEntrySchema = z.object({
  id: z.string(),
  side: SideSchema,
  initiative: z.number().int(),
  dexMod: z.number().int(),
  group: z.string().optional(),
});

export const TurnStateSchema = z.object({
  /** 1-based; 0 before the first turn has started. */
  round: z.number().int().min(0),
  order: z.array(InitiativeEntrySchema),
  currentIndex: z.number().int().min(0),
  budgets: z.record(z.string(), TurnBudgetSchema),
  /** Whether startTurn has run for the current creature (endTurn not yet). */
  turnActive: z.boolean(),
});
export type TurnState = z.infer<typeof TurnStateSchema>;

export type Creatures = Record<string, Creature>;

export type TurnEventKind =
  | 'round_start'
  | 'turn_start'
  | 'turn_end'
  | 'death_save'
  | 'recharge'
  | 'effect_expired'
  | 'condition_expired'
  | 'save'
  | 'concentration_ended'
  | 'prone'
  | 'died'
  | 'skipped'
  | 'log';

export interface TurnEvent {
  kind: TurnEventKind;
  creatureId?: string;
  text: string;
}

export interface TurnContext {
  rng: Rng;
  db?: SrdDatabase;
  table?: ConditionTable;
  /** For the end-of-turn "in another creature's space" Prone rule. */
  grid?: Grid;
  /** Fear's end-of-turn save only happens when the caster is out of sight. Default: visible. */
  casterVisible?: (creatureId: string, casterId: string) => boolean;
  /** Language of the turn lines (default English). */
  msgs?: Messages;
}

export interface TurnResult {
  state: TurnState;
  creatures: Creatures;
  events: TurnEvent[];
}

export const freshBudget = (): TurnBudget => ({
  action: true,
  bonusAction: true,
  reaction: true,
  movementSpentFt: 0,
  dashes: 0,
  disengaged: false,
  objectInteraction: true,
});

const isCharacter = (c: Creature): c is Character => c.kind === 'character' && 'deathSaves' in c;

// ---------------------------------------------------------------- setup and queries

/** New encounter from an initiative order (sorted here). Everyone starts with a reaction available. */
export function startCombat(order: readonly InitiativeEntry[]): TurnState {
  const sorted = [...order].sort(compareInitiative);
  return {
    round: 0,
    order: sorted,
    currentIndex: 0,
    budgets: Object.fromEntries(sorted.map((e) => [e.id, freshBudget()])),
    turnActive: false,
  };
}

export function currentId(state: TurnState): string | undefined {
  return state.order[state.currentIndex]?.id;
}

export function budgetOf(state: TurnState, id: string): TurnBudget {
  const b = state.budgets[id];
  if (!b) throw new Error(`${id} is not in this encounter`);
  return b;
}

const withBudget = (state: TurnState, id: string, patch: Partial<TurnBudget>): TurnState => ({
  ...state,
  budgets: { ...state.budgets, [id]: { ...budgetOf(state, id), ...patch } },
});

/** Add a combatant mid-fight (summons, reinforcements) in initiative position. */
export function addCombatant(state: TurnState, entry: InitiativeEntry): TurnState {
  const cur = currentId(state);
  const order = [...state.order.filter((e) => e.id !== entry.id), entry].sort(compareInitiative);
  const currentIndex = cur === undefined ? 0 : order.findIndex((e) => e.id === cur);
  return { ...state, order, currentIndex, budgets: { ...state.budgets, [entry.id]: freshBudget() } };
}

/**
 * Remove a combatant (dead monster, fled). If it is the current creature, the index then points at
 * the next creature and `turnActive` is cleared (call startTurn next).
 */
export function removeCombatant(state: TurnState, id: string): TurnState {
  const idx = state.order.findIndex((e) => e.id === id);
  if (idx < 0) return state;
  const order = state.order.filter((e) => e.id !== id);
  const { [id]: _gone, ...budgets } = state.budgets;
  let currentIndex = state.currentIndex;
  let turnActive = state.turnActive;
  if (idx < currentIndex) currentIndex--;
  else if (idx === currentIndex) turnActive = false;
  if (currentIndex >= order.length) currentIndex = 0;
  return { ...state, order, currentIndex, budgets, turnActive };
}

// ---------------------------------------------------------------- action economy

export type EconomyKind = 'action' | 'bonusAction' | 'reaction' | 'objectInteraction';

export type SpendResult = { ok: true; state: TurnState } | { ok: false; error: string; state: TurnState };

/**
 * Spend one piece of the action economy. Actions, Bonus Actions and object interactions only on
 * the creature's own turn; Reactions any time (once per round, regained on own turn). Passing the
 * creature also checks it can act (not Incapacitated, not dead or at 0 HP).
 */
export function spend(state: TurnState, id: string, kind: EconomyKind, creature?: Creature, table?: ConditionTable, { m }: Messages = ENGLISH_MESSAGES): SpendResult {
  const fail = (error: string): SpendResult => ({ ok: false, error, state });
  const b = state.budgets[id];
  if (!b) return fail(`${id} is not in this encounter`);
  if (kind !== 'reaction' && (currentId(state) !== id || !state.turnActive)) return fail(m('turn.notYours', { name: creature?.name ?? id }));
  if (creature && !creatureCanAct(creature, table)) return fail(m('turn.incapacitated', { name: creature.name }));
  if (!b[kind]) return fail(m(`turn.used.${kind}`));
  return { ok: true, state: withBudget(state, id, { [kind]: false }) };
}

function creatureCanAct(c: Creature, table?: ConditionTable): boolean {
  return !c.dead && c.hp > 0 && canAct(c, table);
}

/** Can this creature take a Reaction now (unused reaction, alive, not Incapacitated)? */
export function canReact(state: TurnState, id: string, creature: Creature, table?: ConditionTable): boolean {
  return (state.budgets[id]?.reaction ?? false) && creatureCanAct(creature, table);
}

/** Feet of movement left this turn for the given mode (Speed × (1 + Dashes) − spent). */
export function movementLeft(state: TurnState, id: string, creature: Creature, opts: { mode?: MoveMode; table?: ConditionTable } = {}): number {
  const b = budgetOf(state, id);
  const total = movementBudget(creature, { dashes: b.dashes, ...(opts.mode && { mode: opts.mode }), ...(opts.table && { table: opts.table }) });
  return Math.max(0, total - b.movementSpentFt);
}

/** Record movement spent (e.g. `moveAlong(...).costFt`). Fails if it exceeds what's left. */
export function spendMovement(state: TurnState, id: string, feet: number, creature: Creature, opts: { mode?: MoveMode; table?: ConditionTable; msgs?: Messages } = {}): SpendResult {
  const { m } = opts.msgs ?? ENGLISH_MESSAGES;
  if (feet < 0) return { ok: false, error: 'Negative movement', state };
  if (currentId(state) !== id || !state.turnActive) return { ok: false, error: m('turn.notYours', { name: creature.name }), state };
  const left = movementLeft(state, id, creature, opts);
  if (feet > left) return { ok: false, error: m('turn.movementLeft', { ft: left }), state };
  return { ok: true, state: withBudget(state, id, { movementSpentFt: budgetOf(state, id).movementSpentFt + feet }) };
}

/** Dash: +1 × Speed of movement this turn. The action/bonus action cost is paid by the caller (A063). */
export function addDash(state: TurnState, id: string): TurnState {
  return withBudget(state, id, { dashes: budgetOf(state, id).dashes + 1 });
}

/** Disengage: no opportunity attacks for the rest of this turn. */
export function setDisengaged(state: TurnState, id: string): TurnState {
  return withBudget(state, id, { disengaged: true });
}

/** Set / decrement attacks left in the Attack action (Extra Attack, Multiattack). */
export function setAttacksLeft(state: TurnState, id: string, n: number): TurnState {
  return withBudget(state, id, { attacksLeft: Math.max(0, n) });
}

/**
 * Stand up from Prone: costs half Speed (SRD). Fails if the creature isn't Prone, its Speed is 0,
 * or not enough movement is left.
 */
export function standUp(
  state: TurnState,
  id: string,
  creature: Creature,
  table?: ConditionTable,
  msgs: Messages = ENGLISH_MESSAGES,
): { ok: true; state: TurnState; creature: Creature; costFt: number } | { ok: false; error: string } {
  const { m } = msgs;
  if (!hasCondition(creature, 'prone', table)) return { ok: false, error: m('turn.notProne', { name: creature.name }) };
  if (hasCondition(creature, 'unconscious', table)) return { ok: false, error: m('turn.isUnconscious', { name: creature.name }) };
  const cost = standUpCost(creature, table);
  if (cost === null) return { ok: false, error: m('turn.speedZero', { name: creature.name }) };
  const r = spendMovement(state, id, cost, creature, { ...(table && { table }), msgs });
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, state: r.state, creature: removeCondition(creature, 'prone'), costFt: cost };
}

// ---------------------------------------------------------------- turn hooks

/** Monsters at 0 HP die; characters at 0 HP who aren't yet Unconscious fall Unconscious. */
function settleZeroHp(c: Creature, events: TurnEvent[], { m }: Messages): Creature {
  if (c.dead || c.hp > 0) return c;
  if (!isCharacter(c)) {
    events.push({ kind: 'died', creatureId: c.id, text: m('turn.dies', { name: c.name }) });
    return { ...c, dead: true };
  }
  if (c.conditions.some((x) => x.condition === 'unconscious')) return c;
  events.push({ kind: 'log', creatureId: c.id, text: m('turn.unconscious', { name: c.name }) });
  const down = applyCondition(c, { condition: 'unconscious' }).creature as Character;
  const reset: Character = { ...down, deathSaves: { successes: 0, failures: 0, stable: false } };
  return reset;
}

function applyTurnEvent(creatures: Creatures, event: 'start_of_turn' | 'end_of_turn', id: string, events: TurnEvent[], { m }: Messages): Creatures {
  const { creatures: list, expired } = onTurnEvent(Object.values(creatures), event, id);
  const out: Creatures = Object.fromEntries(list.map((c) => [c.id, c]));
  for (const { creatureId, effect } of expired) {
    const c = out[creatureId];
    if (!c) continue;
    out[creatureId] = revertExpiredEffects(c, [effect]);
    events.push({ kind: 'effect_expired', creatureId, text: m('turn.effectEnds', { effect: effect.key, name: c.name }) });
  }
  return out;
}

/** Start the current creature's turn: budget reset (incl. reaction) and start-of-turn hooks. */
export function startTurn(state: TurnState, creatures: Creatures, ctx: TurnContext): TurnResult {
  const id = currentId(state);
  if (id === undefined) return { state, creatures, events: [] };
  const events: TurnEvent[] = [];
  const msgs = ctx.msgs ?? ENGLISH_MESSAGES;
  const { m } = msgs;
  const next = withBudget({ ...state, round: Math.max(1, state.round), turnActive: true }, id, freshBudget());
  let all = applyTurnEvent(creatures, 'start_of_turn', id, events, msgs);
  let c = all[id];
  if (!c) return { state: next, creatures: all, events };
  events.unshift({ kind: 'turn_start', creatureId: id, text: m('turn.start', { name: c.name, round: next.round }) });

  c = startOfTurnEffects(resetOncePerTurnEffects(c));

  if (c.kind === 'monster' && c.statBlockId) {
    const block = (ctx.db ?? loadSrd()).monsters.get(c.statBlockId);
    if (block) {
      const r = rollRecharges(c, block, ctx.rng);
      c = r.creature;
      for (const name of r.recharged) events.push({ kind: 'recharge', creatureId: id, text: m('turn.recharge', { name: c.name, ability: name }) });
    }
  }

  if (isCharacter(c) && needsDeathSave(c)) {
    // Beacon of Hope gives Advantage on Death Saving Throws.
    const ds = rollDeathSave(c, ctx.rng, [], deathSaveAdvantage(c) ? 'advantage' : 'normal', msgs);
    c = ds.character;
    events.push({ kind: 'death_save', creatureId: id, text: m('turn.deathSave', { name: c.name, roll: ds.text }) });
    if (ds.outcome === 'died') events.push({ kind: 'died', creatureId: id, text: m('turn.dies', { name: c.name }) });
    // A creature revived by a natural 20 regains 1 HP but stays Prone; it can act this turn.
  }

  all = { ...all, [id]: c };
  return { state: next, creatures: all, events };
}

function tickConcentration(all: Creatures, id: string, events: TurnEvent[], { m }: Messages): Creatures {
  const c = all[id];
  if (!c || !isCharacter(c)) return all;
  const conc = c.spellcasting?.concentration;
  if (!conc || conc.roundsLeft === undefined) return all;
  if (conc.roundsLeft > 1) {
    const ticked: Character = { ...c, spellcasting: { ...c.spellcasting!, concentration: { ...conc, roundsLeft: conc.roundsLeft - 1 } } };
    return { ...all, [id]: ticked };
  }
  const map = new Map(Object.entries(all));
  const spellId = endConcentration({ creatures: map }, id);
  events.push({ kind: 'concentration_ended', creatureId: id, text: m('turn.concentrationEnds', { name: c.name, spell: spellId ?? m('turn.spell') }) });
  return Object.fromEntries(map);
}

/** SRD: ending a turn in another creature's space → Prone, unless Tiny or larger than that creature. */
function proneInSpace(all: Creatures, id: string, grid: Grid, table: ConditionTable | undefined, events: TurnEvent[], { m }: Messages): Creatures {
  const me = grid.tokens[id];
  const c = all[id];
  if (!me || !c || me.size === 'tiny') return all;
  const overlapping = Object.values(grid.tokens).filter((o) => {
    if (o.id === id || all[o.id]?.dead) return false;
    const a = footprintSize(me.size);
    const b = footprintSize(o.size);
    return me.x < o.x + b && o.x < me.x + a && me.y < o.y + b && o.y < me.y + a;
  });
  const sharesWithBiggerOrEqual = overlapping.some((o) => SIZES.indexOf(me.size) <= SIZES.indexOf(o.size));
  if (!sharesWithBiggerOrEqual || hasCondition(c, 'prone', table)) return all;
  const r = applyCondition(c, { condition: 'prone' }, table);
  if (!r.applied) return all;
  events.push({ kind: 'prone', creatureId: id, text: m('turn.prone', { name: c.name }) });
  return { ...all, [id]: r.creature };
}

/** End the current creature's turn: end-of-turn saves, lingering effects, countdowns, Prone-in-space. */
export function endTurn(state: TurnState, creatures: Creatures, ctx: TurnContext): TurnResult {
  const id = currentId(state);
  if (id === undefined || !state.turnActive) return { state, creatures, events: [] };
  const events: TurnEvent[] = [];
  const msgs = ctx.msgs ?? ENGLISH_MESSAGES;
  const { m } = msgs;
  let all = { ...creatures };
  let c = all[id];
  if (c && !c.dead) {
    const s2 = endOfTurnSpellEffects(c, ctx.rng);
    const s3 = endOfTurnSpellEffects3(s2.creature, ctx.rng, (casterId) => ctx.casterVisible?.(id, casterId) ?? true);
    c = s3.creature;
    for (const text of [...s2.log, ...s3.log]) events.push({ kind: 'log', creatureId: id, text });

    const saves = endOfTurnSaves(c, ctx.rng, ctx.table, msgs);
    c = saves.creature;
    for (const r of saves.results) {
      events.push({ kind: 'save', creatureId: id, text: `${m('turn.saveVs', { name: c.name, condition: r.condition, roll: r.roll.text })}${r.roll.success ? ` — ${m('turn.conditionEnds', { condition: r.condition })}` : ''}` });
    }

    const tc = tickConditions(c);
    c = tc.creature;
    for (const cond of tc.expired) events.push({ kind: 'condition_expired', creatureId: id, text: m('turn.noLonger', { name: c.name, condition: cond }) });
    const te = tickEffects(c);
    c = revertExpiredEffects(te.creature, te.expired);
    for (const e of te.expired) events.push({ kind: 'effect_expired', creatureId: id, text: m('turn.effectEnds', { effect: e.key, name: c.name }) });

    c = settleZeroHp(c, events, msgs);
    all[id] = c;
    all = tickConcentration(all, id, events, msgs);
    if (ctx.grid) all = proneInSpace(all, id, ctx.grid, ctx.table, events, msgs);
  }
  all = applyTurnEvent(all, 'end_of_turn', id, events, msgs);
  events.push({ kind: 'turn_end', creatureId: id, text: m('turn.end', { name: all[id]?.name ?? id }) });
  return { state: { ...state, turnActive: false }, creatures: all, events };
}

/** Whether a creature takes turns (not dead, still in the encounter). */
const takesTurns = (c: Creature | undefined): boolean => !!c && !c.dead;

/**
 * End the current turn (if active), mark monsters at 0 HP dead and remove them from the order,
 * advance to the next living creature (new round when wrapping) and start its turn. Dead
 * characters stay in the order but are skipped. The first call after startCombat starts round 1.
 */
export function nextTurn(state: TurnState, creatures: Creatures, ctx: TurnContext): TurnResult {
  const events: TurnEvent[] = [];
  const msgs = ctx.msgs ?? ENGLISH_MESSAGES;
  const { m } = msgs;
  let s = state;
  let all = creatures;
  if (s.turnActive) {
    const r = endTurn(s, all, ctx);
    s = r.state;
    all = r.creatures;
    events.push(...r.events);
  }

  const dying: string[] = [];
  for (const e of s.order) {
    const c = all[e.id];
    if (!c || c.kind === 'character') continue;
    const settled = settleZeroHp(c, events, msgs);
    if (settled !== c) all = { ...all, [e.id]: settled };
    if (settled.dead) dying.push(e.id);
  }

  const hadTurn = s.round > 0;
  const n = s.order.length;
  const from = hadTurn ? s.currentIndex : -1;
  let round = Math.max(1, s.round);
  let chosen: string | undefined;
  for (let step = 1; step <= n; step++) {
    const i = from + step;
    const entry = s.order[i % n]!;
    const c = all[entry.id];
    if (takesTurns(c)) {
      chosen = entry.id;
      if (i >= n) round++;
      break;
    }
    if (c && c.kind === 'character') events.push({ kind: 'skipped', creatureId: c.id, text: m('turn.skippedDead', { name: c.name }) });
  }
  for (const id of dying) {
    events.push({ kind: 'skipped', creatureId: id, text: m('turn.removed', { name: all[id]?.name ?? id }) });
    s = removeCombatant(s, id);
  }
  if (chosen === undefined) return { state: { ...s, turnActive: false }, creatures: all, events };
  if (!hadTurn || round > s.round) events.push({ kind: 'round_start', text: m('turn.round', { round }) });
  const currentIndex = s.order.findIndex((e) => e.id === chosen);
  const started = startTurn({ ...s, currentIndex, round, turnActive: false }, all, ctx);
  return { state: started.state, creatures: started.creatures, events: [...events, ...started.events] };
}

/** Everyone still standing on each side (for "combat over" checks). */
export function livingSides(state: TurnState, creatures: Creatures): Set<string> {
  return new Set(state.order.filter((e) => takesTurns(creatures[e.id])).map((e) => e.side));
}
