/**
 * Scene runner: plays an Adventure against a GameState. Pure engine code. It moves between scenes,
 * lists what the player can do, resolves checks with the seeded Rng, and applies outcomes (flags,
 * loot, coins, XP, reputation, time, encounters, endings), then fires story beats. It returns
 * fixed facts and rolls; narration is a separate step (A057).
 *
 * Progress lives in `state.extensions.adventure`. Action ids: scene actions use their own id,
 * POI actions are `<poi>.<action>`, exits are `exit.<id>`.
 */
import { roll } from '../core/dice';
import { totalLevel, type Character } from '../core/creature';
import type { Rng } from '../core/rng';
import type { SrdDatabase } from '../data/srd';
import { abilityCheck, savingThrow, type D20TestResult } from '../rules/checks';
import type { GameState } from '../session/gameState';
import { applyFlagWrites, evalCondition, inHours, timeOfDay, type ConditionContext } from './conditions';
import type { Action, Adventure, Check, Outcome, Scene } from './schema';
import { allScenes } from './validate';
import { SKILL_ABILITY } from '../rules/basics';
import type { FlagRegistry } from '../world/flags';
import { TIME_COSTS } from '../world/clock';
import { discover, getMap } from '../world/travel';
import { changeReputation, type ReputationChange } from '../world/factions';
import type { Lore } from '../world/lore';
import { trackQuests } from './quests';

export interface AdventureProgress {
  adventureId: string;
  sceneId: string;
  visited: string[];
  /** `<sceneId>/<actionId>` of finished once-only actions. */
  done: string[];
  beats: string[];
  ending?: string;
  /** Scene entries so far (improvised attempts reset on each new entry). */
  entries?: number;
  /** Deadline tracking by deadline id. */
  deadlines?: Record<string, DeadlineProgress>;
}

export interface DeadlineProgress {
  startedAt: number;
  status: 'running' | 'met' | 'missed';
  warned?: boolean;
}

export interface RunContext {
  state: GameState;
  adventure: Adventure;
  rng: Rng;
  db?: SrdDatabase;
  /** Flag types/defaults/bounds (data/adventures/flags.json + adventure docs). */
  flags?: FlagRegistry;
  /** World lore (faction relationships for reputation ripples). */
  lore?: Lore;
}

export interface StepResult {
  /** Fixed facts for the narrator, in order. */
  facts: string[];
  rolls: D20TestResult[];
  /** Scenes entered during this step (last = current). */
  entered: string[];
  /** Index in `facts` where the last scene arrival begins (facts before it happened on the way). */
  arrivalIndex?: number;
  encounter?: string;
  ending?: string;
  items: { itemId: string; quantity: number }[];
  coins: number;
  xp: number;
  /** Reputation changes (including ripples to allies/enemies). */
  reputation?: ReputationChange[];
}

export interface AvailableAction {
  id: string;
  label: string;
  kind: 'action' | 'poi' | 'exit';
  /** Shown before rolling ("Athletics DC 12"). */
  check?: string;
}

export class AdventureError extends Error {}

const emptyResult = (): StepResult => ({ facts: [], rolls: [], entered: [], items: [], coins: 0, xp: 0 });

export function getProgress(state: GameState): AdventureProgress | undefined {
  return state.extensions.adventure as AdventureProgress | undefined;
}

export function currentScene(ctx: Pick<RunContext, 'state' | 'adventure'>): Scene {
  const p = getProgress(ctx.state);
  const s = p && findScene(ctx.adventure, p.sceneId);
  if (!s) throw new AdventureError('No adventure scene is active');
  return s;
}

export function findScene(adv: Adventure, id: string): Scene | undefined {
  return allScenes(adv).find((s) => s.id === id);
}

export function conditionContext(state: GameState, progress?: AdventureProgress, registry?: FlagRegistry): ConditionContext {
  const weather = (state.extensions.weather as { kind?: string } | undefined)?.kind;
  return {
    flags: state.flags,
    ...(registry && { defaults: registry.defaults() }),
    timeOfDay: timeOfDay(state.time),
    hour: Math.floor(state.time / 60) % 24,
    ...(weather && { weather }),
    reputation: (state.extensions.reputation as Record<string, number> | undefined) ?? {},
    level: totalLevel(state.hero),
    visited: new Set(progress?.visited ?? []),
  };
}

/** Starts (or restarts) an adventure at its start scene. */
export function startAdventure(ctx: RunContext): StepResult {
  ctx.state.extensions.adventure = { adventureId: ctx.adventure.id, sceneId: ctx.adventure.start.scene, visited: [], done: [], beats: [] } satisfies AdventureProgress;
  const result = emptyResult();
  enterScene(ctx, ctx.adventure.start.scene, result);
  return result;
}

/** Scene text for the narrator: the seed plus any variants whose conditions hold, and visible POIs. */
export function describeScene(ctx: Pick<RunContext, 'state' | 'adventure' | 'flags'>): { name: string; seed: string; pois: { name: string; seed: string }[]; npcs: string[] } {
  const s = currentScene(ctx);
  const cc = conditionContext(ctx.state, getProgress(ctx.state), ctx.flags);
  return {
    name: s.name,
    seed: [s.seed, ...s.variants.filter((v) => evalCondition(v.if, cc)).map((v) => v.seed)].join(' '),
    pois: s.pois.filter((p) => evalCondition(p.if, cc)).map((p) => ({ name: p.name, seed: p.seed })),
    npcs: npcsHere(ctx).map((id) => ctx.adventure.npcs.find((n) => n.id === id)?.name ?? id),
  };
}

/**
 * NPC ids present in the current scene now: unscheduled NPCs listed by the scene, plus scheduled
 * NPCs whose schedule puts them here at this hour (and whose entry condition holds).
 */
export function npcsHere(ctx: Pick<RunContext, 'state' | 'adventure' | 'flags'>): string[] {
  const s = currentScene(ctx);
  const cc = conditionContext(ctx.state, getProgress(ctx.state), ctx.flags);
  const hour = cc.hour ?? 12;
  const out: string[] = [];
  for (const id of s.npcs) {
    const npc = ctx.adventure.npcs.find((n) => n.id === id);
    if (!npc || npc.schedule.length === 0) out.push(id);
  }
  for (const npc of ctx.adventure.npcs) {
    if (out.includes(npc.id)) continue;
    if (npc.schedule.some((e) => e.scene === s.id && inHours(hour, e.from, e.to) && evalCondition(e.if, cc))) out.push(npc.id);
  }
  return out;
}

export function availableActions(ctx: RunContext): AvailableAction[] {
  const p = getProgress(ctx.state);
  if (!p || p.ending) return [];
  const s = currentScene(ctx);
  const cc = conditionContext(ctx.state, p, ctx.flags);
  const open = (a: Action, id: string) => evalCondition(a.if, cc) && !(a.once && p.done.includes(`${s.id}/${id}`));
  const out: AvailableAction[] = [];
  for (const a of s.actions) if (open(a, a.id)) out.push({ id: a.id, label: a.label, kind: 'action', ...(a.check && { check: checkLabel(a.check) }) });
  for (const poi of s.pois) {
    if (!evalCondition(poi.if, cc)) continue;
    for (const a of poi.actions) {
      const id = `${poi.id}.${a.id}`;
      if (open(a, id)) out.push({ id, label: a.label, kind: 'poi', ...(a.check && { check: checkLabel(a.check) }) });
    }
  }
  for (const e of s.exits) if (evalCondition(e.if, cc)) out.push({ id: `exit.${e.id}`, label: e.label, kind: 'exit', ...(e.check && { check: checkLabel(e.check) }) });
  return out;
}

/** Performs one available action. Throws AdventureError for unknown or unavailable ids. */
export function perform(ctx: RunContext, actionId: string): StepResult {
  const p = getProgress(ctx.state);
  if (!p) throw new AdventureError('No adventure is running');
  if (!availableActions(ctx).some((a) => a.id === actionId)) throw new AdventureError(`"${actionId}" is not possible here`);
  const s = currentScene(ctx);
  const result = emptyResult();

  if (actionId.startsWith('exit.')) {
    const exit = s.exits.find((e) => `exit.${e.id}` === actionId)!;
    if (exit.check) {
      const r = resolveCheck(ctx, exit.check);
      result.rolls.push(r);
      if (!r.success) {
        applyOutcome(ctx, exit.check.failure, result);
        fireBeats(ctx, result);
        return result;
      }
      applyOutcome(ctx, exit.check.success, result);
    }
    ctx.state.time += exit.minutes;
    enterScene(ctx, exit.to, result);
    return result;
  }

  const [poiId, sub] = actionId.includes('.') ? actionId.split('.', 2) : [undefined, actionId];
  const action = poiId ? s.pois.find((x) => x.id === poiId)?.actions.find((a) => a.id === sub) : s.actions.find((a) => a.id === actionId);
  if (!action) throw new AdventureError(`Unknown action "${actionId}"`);
  if (action.once) p.done.push(`${s.id}/${actionId}`);
  ctx.state.time += TIME_COSTS.explore_action;
  if (action.check) {
    const r = resolveCheck(ctx, action.check);
    result.rolls.push(r);
    applyOutcome(ctx, r.success ? action.check.success : action.check.failure, result);
  }
  if (action.outcome) applyOutcome(ctx, action.outcome, result);
  fireBeats(ctx, result);
  return result;
}

/** Applies an encounter's win/lose/flee outcome (called by combat, A068). */
export function resolveEncounter(ctx: RunContext, encounterId: string, how: 'win' | 'lose' | 'flee'): StepResult {
  const enc = ctx.adventure.encounters.find((e) => e.id === encounterId);
  if (!enc) throw new AdventureError(`Unknown encounter "${encounterId}"`);
  const result = emptyResult();
  applyOutcome(ctx, enc[how], result);
  fireBeats(ctx, result);
  return result;
}

export function checkLabel(c: Check): string {
  const name = c.save ? `${cap(c.save)} save` : c.skill ? cap(c.skill.replace(/_/g, ' ')) : `${cap(c.ability ?? 'str')} check`;
  return `${name} DC ${c.dc}`;
}

function cap(s: string): string {
  return s.replace(/\b\w/g, (m) => m.toUpperCase());
}

function resolveCheck(ctx: RunContext, c: Check): D20TestResult {
  const cc = conditionContext(ctx.state, getProgress(ctx.state), ctx.flags);
  const advantage = c.advantageIf.filter((x) => evalCondition(x.if, cc)).map((x) => x.source);
  const disadvantage = c.disadvantageIf.filter((x) => evalCondition(x.if, cc)).map((x) => x.source);
  const opts = { rng: ctx.rng, dc: c.dc, advantage, disadvantage };
  const hero = ctx.state.hero;
  if (c.save) return savingThrow(hero, c.save, opts);
  const ability = c.ability ?? (c.skill ? SKILL_ABILITY[c.skill] : 'str');
  return abilityCheck(hero, ability, c.skill, opts);
}

function enterScene(ctx: RunContext, sceneId: string, result: StepResult, depth = 0): void {
  const scene = findScene(ctx.adventure, sceneId);
  if (!scene) throw new AdventureError(`Unknown scene "${sceneId}"`);
  const p = getProgress(ctx.state)!;
  p.sceneId = sceneId;
  p.entries = (p.entries ?? 0) + 1;
  const firstVisit = !p.visited.includes(sceneId);
  if (firstVisit) p.visited.push(sceneId);
  ctx.state.location = { adventureId: ctx.adventure.id, sceneId, name: scene.name };
  result.entered.push(sceneId);
  result.arrivalIndex = result.facts.length;
  if (scene.onEnter && firstVisit) applyOutcome(ctx, scene.onEnter, result, depth + 1);
  fireBeats(ctx, result, depth + 1);
}

/** Applies an outcome. `goto` is applied last so facts stay in reading order. */
export function applyOutcome(ctx: RunContext, o: Outcome, result: StepResult, depth = 0): void {
  if (depth > 8) throw new AdventureError('Outcome chain too deep (goto/beat loop?)');
  const { state } = ctx;
  if (o.text) result.facts.push(o.text);
  applyFlagWrites(state.flags, o.flags, ctx.flags);
  for (const it of o.items) giveItem(state.hero, it.itemId, it.quantity, ctx.db, result);
  if (o.coins) giveCoins(state.hero, o.coins, result);
  if (o.loot) rollLoot(ctx, o.loot, result);
  if (o.xp) {
    state.hero.xp += o.xp;
    result.xp += o.xp;
  }
  for (const r of o.reputation) (result.reputation ??= []).push(...changeReputation(state, r.faction, r.delta, ctx.lore));
  state.time += o.minutes;
  const map = getMap(state);
  if (o.discover.length && map) discover(map, o.discover);
  if (o.encounter) result.encounter = o.encounter;
  if (o.ending) {
    getProgress(state)!.ending = o.ending;
    result.ending = o.ending;
  }
  if (o.goto) enterScene(ctx, o.goto, result, depth + 1);
}

/**
 * Starts, completes or fails deadlines. A missed deadline applies its `missed` outcome; a warning
 * fact is added once when `warnAt` minutes or fewer remain.
 */
export function checkDeadlines(ctx: RunContext, result: StepResult, depth = 0): void {
  const p = getProgress(ctx.state);
  if (!p) return;
  const cc = conditionContext(ctx.state, p, ctx.flags);
  p.deadlines ??= {};
  for (const d of ctx.adventure.deadlines) {
    let rec = p.deadlines[d.id];
    if (!rec) {
      if (!evalCondition(d.start, cc)) continue;
      rec = p.deadlines[d.id] = { startedAt: ctx.state.time, status: 'running' };
    }
    if (rec.status !== 'running') continue;
    if (evalCondition(d.met, cc)) {
      rec.status = 'met';
      continue;
    }
    // Once the adventure has ended, nothing more can be missed.
    if (p.ending) continue;
    const left = rec.startedAt + d.within - ctx.state.time;
    if (left <= 0) {
      rec.status = 'missed';
      applyOutcome(ctx, d.missed, result, depth + 1);
    } else if (d.warnAt !== undefined && left <= d.warnAt && !rec.warned) {
      rec.warned = true;
      result.facts.push(d.warning ?? `Time is running short: ${d.text}`);
    }
  }
}

/** Running deadlines with minutes left (journal/UI). */
export function activeDeadlines(ctx: Pick<RunContext, 'state' | 'adventure'>): { id: string; text: string; minutesLeft: number }[] {
  const recs = getProgress(ctx.state)?.deadlines ?? {};
  return ctx.adventure.deadlines
    .filter((d) => recs[d.id]?.status === 'running')
    .map((d) => ({ id: d.id, text: d.text, minutesLeft: recs[d.id]!.startedAt + d.within - ctx.state.time }));
}

function fireBeats(ctx: RunContext, result: StepResult, depth = 0): void {
  const p = getProgress(ctx.state)!;
  for (const b of ctx.adventure.beats) {
    if (p.beats.includes(b.id)) continue;
    if (b.scenes.length && !b.scenes.includes(p.sceneId)) continue;
    if (!evalCondition(b.trigger, conditionContext(ctx.state, p, ctx.flags))) continue;
    p.beats.push(b.id);
    result.facts.push(b.text);
    applyOutcome(ctx, b.outcome, result, depth + 1);
  }
  checkDeadlines(ctx, result, depth);
  trackQuests(ctx);
}

function giveItem(hero: Character, itemId: string, quantity: number, db: SrdDatabase | undefined, result: StepResult): void {
  const unique = db ? db.weapons.has(itemId) || db.armor.has(itemId) || db.magicItems.has(itemId) : false;
  const existing = hero.inventory.find((i) => i.itemId === itemId && !i.equipped);
  const nextUid = () => `i${hero.inventory.reduce((m, i) => Math.max(m, Number(i.uid.replace(/\D/g, '')) || 0), 0) + 1}`;
  if (existing && !unique) existing.quantity += quantity;
  else if (unique) for (let i = 0; i < quantity; i++) hero.inventory.push({ uid: nextUid(), itemId, quantity: 1 });
  else hero.inventory.push({ uid: nextUid(), itemId, quantity });
  const r = result.items.find((i) => i.itemId === itemId);
  if (r) r.quantity += quantity;
  else result.items.push({ itemId, quantity });
}

function giveCoins(hero: Character, cp: number, result: StepResult): void {
  hero.coins += cp;
  result.coins += cp;
}

const COIN_CP = { cp: 1, sp: 10, gp: 100 } as const;

function rollLoot(ctx: RunContext, tableId: string, result: StepResult): void {
  const table = ctx.adventure.lootTables.find((t) => t.id === tableId);
  if (!table) throw new AdventureError(`Unknown loot table "${tableId}"`);
  const times = typeof table.rolls === 'number' ? table.rolls : roll(table.rolls, ctx.rng).total;
  const totalWeight = table.entries.reduce((s, e) => s + e.weight, 0);
  for (let i = 0; i < times; i++) {
    let pick = ctx.rng.int(1, totalWeight);
    const entry = table.entries.find((e) => (pick -= e.weight) <= 0)!;
    if (entry.itemId) giveItem(ctx.state.hero, entry.itemId, entry.quantity, ctx.db, result);
    if (entry.coins !== undefined) {
      const n = typeof entry.coins === 'number' ? entry.coins : roll(entry.coins, ctx.rng).total;
      giveCoins(ctx.state.hero, n * COIN_CP[entry.coinUnit], result);
    }
  }
}

/** Lore region the party is in: the current scene's lore location, else the adventure's region. */
export function regionOfState(state: GameState, adventures: ReadonlyMap<string, Adventure>, lore: { locations: { id: string; regionId: string }[] }): string | undefined {
  const adv = state.location.adventureId ? adventures.get(state.location.adventureId) : undefined;
  const scene = adv && state.location.sceneId ? findScene(adv, state.location.sceneId) : undefined;
  return lore.locations.find((l) => l.id === scene?.locationId)?.regionId ?? adv?.regionId;
}
