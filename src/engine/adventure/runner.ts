/**
 * Scene runner: plays an Adventure against a GameState. Pure engine code. It moves between scenes,
 * lists what the player can do, resolves checks with the seeded Rng, and applies outcomes (flags,
 * loot, coins, XP, reputation, time, encounters, endings), then fires story beats. It returns
 * fixed facts and rolls; narration is a separate step (A057).
 *
 * Progress lives in `state.extensions.adventure`. Action ids: scene actions use their own id,
 * POI actions are `<poi>.<action>`, exits are `exit.<id>`.
 */
import { hitDicePool, longRest, shortRest } from '../rules/rest';
import { giveScar, scarText } from '../character/scars';
import { revealRoom } from '../world/dungeon';
import { applyDamage, rollDamage } from '../rules/damage';
import { changeApproval, partingLine, partWithCompanion, recruitCompanion, recruitFlagsOnly, returnCompanion, type CompanionRoster } from '../party/companions';
import { applyStoryCondition } from './storyConditions';
import { roll } from '../core/dice';
import { totalLevel, type Character } from '../core/creature';
import { Rng } from '../core/rng';
import type { SrdDatabase } from '../data/srd';
import { abilityCheck, savingThrow, type D20TestResult } from '../rules/checks';
import type { GameState } from '../session/gameState';
import { applyFlagWrites, evalCondition, inHours, timeOfDay, type ConditionContext } from './conditions';
import type { Action, Adventure, Check, Condition, Outcome, Scene } from './schema';
import { allScenes } from './validate';
import { SKILL_ABILITY } from '../rules/basics';
import { FlagRegistry } from '../world/flags';
import { TIME_COSTS } from '../world/clock';
import { addItem, removeItem } from '../character/inventory';
import { discover, getMap } from '../world/travel';
import { changeReputation, type ReputationChange } from '../world/factions';
import type { Lore } from '../world/lore';
import { trackQuests } from './quests';
import { ENGLISH_MESSAGES, type Messages } from '../i18n';
import { conversationFor, conversationOffers, LEAVE_TALK, openOptions, optionFor, speakerOf, talkDoneKey, talkNode, DIALOGUE_PREFIX, TALK_PREFIX, type TalkProgress } from './conversation';

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
  /** Lore location id when the party travelled somewhere this adventure has no scene for. */
  away?: string;
  /** The open conversation, if any (only its options are offered meanwhile). */
  talk?: TalkProgress;
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
  /**
   * Companion roster: recruit / approval / companionLeaves outcomes are applied at once (so beats in
   * the same step see the new status/loyalty). Without it they are only collected in the result.
   */
  companions?: CompanionRoster;
  /** Language for engine-written facts and lines (default English). */
  msgs?: Messages;
}

export interface StepResult {
  /** Fixed facts for the narrator, in order. */
  facts: string[];
  rolls: D20TestResult[];
  /** Scenes entered during this step (last = current). */
  entered: string[];
  /** Index in `facts` where the last scene arrival begins (facts before it happened on the way). */
  arrivalIndex?: number;
  /** True when the last scene entered had been visited before (the narrator must not re-tell a first arrival). */
  returning?: boolean;
  encounter?: string;
  ending?: string;
  items: { itemId: string; quantity: number }[];
  coins: number;
  xp: number;
  /** Reputation changes (including ripples to allies/enemies). */
  reputation?: ReputationChange[];
  /** Tutorial tips to show (once each, by the session). */
  tips?: string[];
  /** Items taken from the hero by `removeItems`. */
  removed?: { itemId: string; quantity: number }[];
  /** Party changes already applied (RunContext.companions given): log lines in order. */
  partyLog?: string[];
  /** Companions to recruit / part with, when the runner had no roster (the caller applies them). */
  recruits?: string[];
  partings?: { id: string; status: 'waiting' | 'left' | 'betrayed' | 'dead' }[];
  approvals?: { companion: string; delta: number }[];
  returns?: { id: string; loyalty: number }[];
  /** Conversation lines to log verbatim as dialogue, after the narrated facts. */
  dialogue?: { speaker: string; text: string }[];
}

export interface AvailableAction {
  id: string;
  label: string;
  /** `talk` starts a conversation; `dialogue` is an option (or leaving) inside one. */
  kind: 'action' | 'poi' | 'exit' | 'talk' | 'dialogue';
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

/** Scene lookup per chapters array (shared by `{ ...adv }` copies); rebuilt on a miss so added scenes are found. */
const sceneIndex = new WeakMap<Adventure['chapters'], Map<string, Scene>>();

export function findScene(adv: Adventure, id: string): Scene | undefined {
  let index = sceneIndex.get(adv.chapters);
  if (!index?.has(id)) {
    index = new Map(allScenes(adv).map((s) => [s.id, s]));
    sceneIndex.set(adv.chapters, index);
  }
  return index.get(id);
}

const merged = new WeakMap<Adventure, { base: FlagRegistry | undefined; reg: FlagRegistry }>();

/** The flag registry with this adventure's own flag docs added (local number/string flags, defaults). */
export function flagsFor(ctx: Pick<RunContext, 'adventure' | 'flags'>): FlagRegistry | undefined {
  if (!ctx.adventure.flags.some((f) => f.type || f.default !== undefined)) return ctx.flags;
  const hit = merged.get(ctx.adventure);
  if (hit && hit.base === ctx.flags) return hit.reg;
  const reg = (ctx.flags ? ctx.flags.clone() : new FlagRegistry()).addDocs(ctx.adventure.flags.filter((f) => f.type || f.default !== undefined));
  merged.set(ctx.adventure, { base: ctx.flags, reg });
  return reg;
}

export function conditionContext(state: GameState, progress?: AdventureProgress, registry?: FlagRegistry): ConditionContext {
  const weather = (state.extensions.weather as { kind?: string } | undefined)?.kind;
  // The sets are built on first read (most conditions never look at them; the solver builds many contexts).
  let visited: Set<string> | undefined;
  let items: Set<string> | undefined;
  return {
    flags: state.flags,
    ...(registry && { defaults: registry.defaults() }),
    timeOfDay: timeOfDay(state.time),
    hour: Math.floor(state.time / 60) % 24,
    ...(weather && { weather }),
    reputation: (state.extensions.reputation as Record<string, number> | undefined) ?? {},
    level: totalLevel(state.hero),
    get visited() {
      return (visited ??= new Set(progress?.visited ?? []));
    },
    coins: state.hero.coins,
    get items() {
      return (items ??= new Set(state.hero.inventory.filter((i) => i.quantity > 0).map((i) => i.itemId)));
    },
    now: state.time,
    flagTimes: (state.extensions.flagTimes as Record<string, number> | undefined) ?? {},
  };
}

/** Starts (or restarts) an adventure at its start scene. */
export function startAdventure(ctx: RunContext): StepResult {
  ctx.state.extensions.adventure = { adventureId: ctx.adventure.id, sceneId: ctx.adventure.start.scene, visited: [], done: [], beats: [] } satisfies AdventureProgress;
  const result = emptyResult();
  enterScene(ctx, ctx.adventure.start.scene, result);
  return result;
}

/**
 * Scene text for the narrator: the seed plus any variants whose conditions hold, and visible POIs.
 * On a return visit (`visit: 'return'`) a `revisitSeed` replaces the seed (one picked per entry).
 */
export function describeScene(ctx: Pick<RunContext, 'state' | 'adventure' | 'flags'>, visit?: 'first' | 'return' | 'resume'): { name: string; seed: string; pois: { name: string; seed: string }[]; npcs: string[] } {
  const s = currentScene(ctx);
  const p = getProgress(ctx.state);
  const cc = conditionContext(ctx.state, p, flagsFor(ctx));
  const again = typeof s.revisitSeed === 'string' ? [s.revisitSeed] : s.revisitSeed;
  const seed = visit === 'return' && again ? pickText(again, `${ctx.state.campaignId}:${s.id}:${p?.entries ?? 0}`) : s.seed;
  return {
    name: s.name,
    seed: [seed, ...s.variants.filter((v) => evalCondition(v.if, cc)).map((v) => v.seed)].join(' '),
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
  const cc = conditionContext(ctx.state, getProgress(ctx.state), flagsFor(ctx));
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
  if (!p || p.ending || p.away) return [];
  const s = currentScene(ctx);
  const cc = conditionContext(ctx.state, p, flagsFor(ctx));
  if (p.talk) {
    // In a conversation: its options, plus a way out.
    const opts = openOptions(ctx.adventure, p.talk, cc).map(({ id, option }): AvailableAction => ({ id, label: option.label, kind: 'dialogue', ...(option.check && { check: checkLabel(option.check) }) }));
    return [...opts, { id: LEAVE_TALK, label: 'End the conversation', kind: 'dialogue' }];
  }
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
  for (const t of conversationOffers(ctx.adventure, npcsHere(ctx), cc, p.done)) out.push({ id: t.id, label: t.label, kind: 'talk' });
  for (const e of s.exits) if (evalCondition(e.if, cc)) out.push({ id: `exit.${e.id}`, label: e.label, kind: 'exit', ...(e.check && { check: checkLabel(e.check) }) });
  return out;
}

/** Whether one action id is offered now (same rules as availableActions, without building the list). */
function isAvailable(ctx: RunContext, actionId: string): boolean {
  const p = getProgress(ctx.state);
  if (!p || p.ending || p.away) return false;
  if (p.talk || actionId.startsWith(TALK_PREFIX) || actionId.startsWith(DIALOGUE_PREFIX)) return availableActions(ctx).some((a) => a.id === actionId);
  const s = currentScene(ctx);
  const cc = () => conditionContext(ctx.state, p, flagsFor(ctx));
  if (actionId.startsWith('exit.')) {
    const e = s.exits.find((x) => `exit.${x.id}` === actionId);
    return !!e && evalCondition(e.if, cc());
  }
  const dot = actionId.indexOf('.');
  const poi = dot >= 0 ? s.pois.find((x) => x.id === actionId.slice(0, dot)) : undefined;
  const a = dot >= 0 ? poi?.actions.find((x) => x.id === actionId.slice(dot + 1)) : s.actions.find((x) => x.id === actionId);
  if (!a || (a.once && p.done.includes(`${s.id}/${actionId}`))) return false;
  const c = cc();
  return (!poi || evalCondition(poi.if, c)) && evalCondition(a.if, c);
}

/** Performs one available action. Throws AdventureError for unknown or unavailable ids. */
export function perform(ctx: RunContext, actionId: string): StepResult {
  const p = getProgress(ctx.state);
  if (!p) throw new AdventureError('No adventure is running');
  if (!isAvailable(ctx, actionId)) throw new AdventureError(`"${actionId}" is not possible here`);
  const s = currentScene(ctx);
  const result = emptyResult();
  if (actionId.startsWith(TALK_PREFIX) || actionId.startsWith(DIALOGUE_PREFIX)) {
    converse(ctx, p, actionId, result);
    return result;
  }

  if (actionId.startsWith('exit.')) {
    const exit = s.exits.find((e) => `exit.${e.id}` === actionId)!;
    if (exit.check) {
      const r = resolveCheck(ctx, exit.check);
      result.rolls.push(...r.rolls);
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
    result.rolls.push(...r.rolls);
    applyOutcome(ctx, r.success ? action.check.success : action.check.failure, result);
  }
  if (action.outcome) applyOutcome(ctx, action.outcome, result);
  fireBeats(ctx, result);
  return result;
}

/**
 * Conversation steps: `talk.<npc>.<conv>` opens a talk at its start node; `dlg.<node>.<option>`
 * resolves the option (check, outcome) and moves to its next node; `dlg.bye` or an option without
 * `next` ends it. A step that moves the story on (scene change, fight, ending) also ends it.
 */
function converse(ctx: RunContext, p: AdventureProgress, actionId: string, result: StepResult): void {
  const say = () => {
    const at = p.talk && talkNode(ctx.adventure, p.talk);
    if (!at) return void delete p.talk;
    (result.dialogue ??= []).push({ speaker: speakerOf(ctx.adventure, at.npc, at.node), text: at.node.text });
    // A node nobody can answer ends the talk (its line still stands).
    if (openOptions(ctx.adventure, p.talk!, conditionContext(ctx.state, p, flagsFor(ctx))).length === 0) delete p.talk;
  };
  if (actionId === LEAVE_TALK) {
    delete p.talk;
    return;
  }
  const start = conversationFor(ctx.adventure, actionId);
  if (start) {
    if (start.conv.once) p.done.push(talkDoneKey(start.npc.id, start.conv.id));
    ctx.state.time += TIME_COSTS.explore_action;
    p.talk = { npc: start.npc.id, conversation: start.conv.id, node: start.conv.start, chosen: [] };
    say();
    fireBeats(ctx, result);
    return;
  }
  const talk = p.talk!;
  const option = optionFor(ctx.adventure, talk, actionId);
  if (!option) throw new AdventureError(`Unknown conversation option "${actionId}"`);
  if (option.once) talk.chosen.push(actionId);
  ctx.state.time += TIME_COSTS.quick_action;
  let next = option.next;
  if (option.check) {
    const r = resolveCheck(ctx, option.check);
    result.rolls.push(...r.rolls);
    applyOutcome(ctx, r.success ? option.check.success : option.check.failure, result);
    if (!r.success && option.nextOnFail) next = option.nextOnFail;
  }
  if (option.outcome) applyOutcome(ctx, option.outcome, result);
  fireBeats(ctx, result);
  if (p.talk !== talk || !next || result.entered.length || result.encounter || result.ending) {
    if (p.talk === talk) delete p.talk;
    return;
  }
  talk.node = next;
  say();
}

/**
 * The scene to enter when the party arrives at a lore location: a chapter's start scene there,
 * else a visited scene there, else the first scene there. Undefined when the adventure has none.
 */
export function sceneForLocation(adv: Adventure, locationId: string, visited: readonly string[] = []): string | undefined {
  const here = allScenes(adv).filter((s) => s.locationId === locationId);
  const starts = new Set(adv.chapters.map((c) => c.start));
  return (here.find((s) => starts.has(s.id)) ?? here.find((s) => visited.includes(s.id)) ?? here[0])?.id;
}

/** Arrives in a scene from outside the scene graph (travel): clears `away`, runs onEnter/beats. */
export function arriveInScene(ctx: RunContext, sceneId: string): StepResult {
  const p = getProgress(ctx.state);
  if (!p) throw new AdventureError('No adventure is running');
  delete p.away;
  const result = emptyResult();
  enterScene(ctx, sceneId, result);
  return result;
}

/** Marks the party as away from the adventure's scenes (at a lore location it has no scene for). */
export function leaveScenes(ctx: RunContext, locationId: string, locationName: string): void {
  const p = getProgress(ctx.state);
  if (!p) return;
  p.away = locationId;
  delete p.talk;
  ctx.state.location = { adventureId: ctx.adventure.id, name: locationName };
}

/** Applies an encounter's win/lose/flee outcome (called by combat, A068). */
export function resolveEncounter(ctx: RunContext, encounterId: string, how: 'win' | 'lose' | 'flee'): StepResult {
  const enc = ctx.adventure.encounters.find((e) => e.id === encounterId);
  if (!enc) throw new AdventureError(`Unknown encounter "${encounterId}"`);
  const result = emptyResult();
  // The fight's room counts as explored even when it was resolved without the map (solver, auto-resolve).
  if (enc.map && enc.room) revealRoom(ctx.state.extensions, enc.map, enc.room);
  applyOutcome(ctx, enc[how], result);
  fireBeats(ctx, result);
  return result;
}

/** The monster/ally groups of an encounter whose `if` holds now. */
export function activeGroups<T extends { id: string; count: number; if?: Condition | undefined }>(ctx: RunContext, groups: readonly T[]): { id: string; count: number }[] {
  const cc = conditionContext(ctx.state, getProgress(ctx.state), flagsFor(ctx));
  return groups.filter((g) => evalCondition(g.if, cc)).map((g) => ({ id: g.id, count: g.count }));
}

export function checkLabel(c: Check): string {
  const name = c.save ? `${cap(c.save)} save` : c.skill ? cap(c.skill.replace(/_/g, ' ')) : `${cap(c.ability ?? 'str')} check`;
  return `${c.group ? 'Group ' : ''}${name} DC ${c.dc}`;
}

function cap(s: string): string {
  return s.replace(/\b\w/g, (m) => m.toUpperCase());
}

/**
 * Rolls an authored check for the hero, or for the hero and every conscious companion when it is a
 * group check (SRD: the group succeeds if at least half its members succeed).
 */
function resolveCheck(ctx: RunContext, c: Check): { success: boolean; rolls: D20TestResult[] } {
  const cc = conditionContext(ctx.state, getProgress(ctx.state), flagsFor(ctx));
  const advantage = c.advantageIf.filter((x) => evalCondition(x.if, cc)).map((x) => x.source);
  const disadvantage = c.disadvantageIf.filter((x) => evalCondition(x.if, cc)).map((x) => x.source);
  const opts = { rng: ctx.rng, dc: c.dc, advantage, disadvantage };
  const one = (who: Character): D20TestResult => {
    if (c.save) return savingThrow(who, c.save, opts);
    const ability = c.ability ?? (c.skill ? SKILL_ABILITY[c.skill] : 'str');
    return abilityCheck(who, ability, c.skill, opts);
  };
  const hero = ctx.state.hero;
  if (!c.group) {
    const r = one(hero);
    return { success: !!r.success, rolls: [r] };
  }
  const members = [hero, ...ctx.state.companions.filter((m) => !m.dead && m.hp > 0)];
  const rolls = members.map((m) => {
    const r = one(m);
    return m === hero ? r : { ...r, label: `${m.name}: ${r.label}`, text: `${m.name}: ${r.text}` };
  });
  const passed = rolls.filter((r) => r.success).length;
  return { success: passed * 2 >= rolls.length, rolls };
}

/** One entry of a text list, picked deterministically by a seed (does not touch the dice Rng). */
export function pickText(options: readonly string[], seed: string): string {
  return options.length === 1 ? options[0]! : options[Rng.fromSeed(seed).int(0, options.length - 1)]!;
}

function enterScene(ctx: RunContext, sceneId: string, result: StepResult, depth = 0): void {
  const scene = findScene(ctx.adventure, sceneId);
  if (!scene) throw new AdventureError(`Unknown scene "${sceneId}"`);
  const p = getProgress(ctx.state)!;
  const fromRoom = findScene(ctx.adventure, p.sceneId)?.map;
  delete p.talk;
  p.sceneId = sceneId;
  p.entries = (p.entries ?? 0) + 1;
  if (scene.map) {
    // Fog of war: the room is revealed on entry; remember where we came from (fights start by that door).
    revealRoom(ctx.state.extensions, scene.map.id, scene.map.room);
    ctx.state.extensions.dungeonAt = { map: scene.map.id, room: scene.map.room, ...(fromRoom?.id === scene.map.id && { from: fromRoom.room }) };
  } else delete ctx.state.extensions.dungeonAt;
  const firstVisit = !p.visited.includes(sceneId);
  if (firstVisit) p.visited.push(sceneId);
  ctx.state.location = { adventureId: ctx.adventure.id, sceneId, name: scene.name };
  result.entered.push(sceneId);
  result.arrivalIndex = result.facts.length;
  result.returning = !firstVisit;
  if (scene.onEnter && firstVisit) applyOutcome(ctx, scene.onEnter, result, depth + 1);
  fireBeats(ctx, result, depth + 1);
}

/** Applies an outcome. `goto` is applied last so facts stay in reading order. */
export function applyOutcome(ctx: RunContext, o: Outcome, result: StepResult, depth = 0): void {
  if (depth > 8) throw new AdventureError('Outcome chain too deep (goto/beat loop?)');
  const { state } = ctx;
  const msgs = ctx.msgs ?? ENGLISH_MESSAGES;
  if (o.cost > 0) {
    if (state.hero.coins < o.cost) {
      result.facts.push(msgs.m('story.cantAfford', { coins: msgs.coins(o.cost) }));
      return;
    }
    state.hero.coins -= o.cost;
    result.coins -= o.cost;
  }
  if (o.text) result.facts.push(o.text);
  if (o.texts) result.facts.push(pickText(o.texts, `${state.campaignId}:${state.time}:${state.nextId}:${o.texts[0]}`));
  if (o.tip) (result.tips ??= []).push(o.tip);
  applyFlagWrites(state.flags, o.flags, flagsFor(ctx));
  if (o.flags.some((w) => 'set' in w && TOOTH_HOLDER.test(w.set))) recountTeeth(state.flags);
  if (o.flags.length) {
    const times = { ...((state.extensions.flagTimes as Record<string, number> | undefined) ?? {}) };
    for (const w of o.flags) times['set' in w ? w.set : 'inc' in w ? w.inc : w.clear] = state.time;
    state.extensions.flagTimes = times;
  }
  if (o.damage) storyDamage(ctx, o.damage, result);
  if (o.rest) storyRest(ctx, o.rest, result);
  if (o.revealRoom) revealRoom(state.extensions, o.revealRoom.map, o.revealRoom.room);
  if (o.scar) {
    const scene = findScene(ctx.adventure, getProgress(state)?.sceneId ?? '');
    state.hero = giveScar(state.hero, { description: o.scar.description, ...(o.scar.location && { location: o.scar.location }), ...(o.scar.damageType && { damageType: o.scar.damageType }), origin: `${scene?.name ?? state.location.name}, ${ctx.adventure.name}`, at: state.time }, ctx.rng);
    result.facts.push(msgs.m('story.scar', { name: state.hero.name, scar: scarText(state.hero.scars.at(-1)!, msgs) }));
  }
  for (const c of o.conditions) result.facts.push(...applyStoryCondition(state, c, msgs));
  if (o.exhaustion) {
    for (const c of [state.hero, ...state.companions]) c.exhaustion = Math.max(0, Math.min(6, c.exhaustion + o.exhaustion));
    result.facts.push(msgs.m('story.exhaustion', { n: o.exhaustion > 0 ? `+${o.exhaustion}` : String(o.exhaustion) }));
  }
  for (const it of o.items) giveItem(state.hero, it.itemId, it.quantity, ctx.db, result);
  for (const it of o.removeItems) takeItem(state.hero, it.itemId, it.quantity, result);
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
  if (ctx.companions) applyParty(ctx, ctx.companions, o, result);
  else {
    if (o.recruit) (result.recruits ??= []).push(o.recruit);
    if (o.approval.length) (result.approvals ??= []).push(...o.approval);
    if (o.companionLeaves) (result.partings ??= []).push(o.companionLeaves);
    if (o.companionReturns) (result.returns ??= []).push(o.companionReturns);
  }
  if (o.encounter) result.encounter = o.encounter;
  if (o.ending) {
    getProgress(state)!.ending = o.ending;
    result.ending = o.ending;
  }
  if (o.goto) enterScene(ctx, o.goto, result, depth + 1);
}

/**
 * Story damage (traps, falls, a sea hag's bargain): one roll shared by every target; a save halves
 * it (or negates it when `half` is false). Heroic mode never drops a character below 1 HP; in
 * Hardcore a character at 0 HP falls unconscious but is stable.
 */
function storyDamage(ctx: RunContext, d: NonNullable<Outcome['damage']>, result: StepResult): void {
  const { state } = ctx;
  const rolled = rollDamage(ctx.rng, [{ dice: d.dice, type: d.type }]);
  const targets = d.target === 'party' ? [state.hero, ...state.companions] : [state.hero];
  for (const c of targets) {
    let amount = rolled.total;
    if (d.save) {
      const s = savingThrow(c, d.save.ability, { rng: ctx.rng, dc: d.save.dc });
      result.rolls.push(s);
      if (s.success) amount = d.save.half ? Math.floor(amount / 2) : 0;
    }
    if (amount <= 0) continue;
    const hit = applyDamage(c, [{ amount, type: d.type }]).creature as Character;
    const floor = state.mode === 'hardcore' ? 0 : 1;
    const hp = Math.max(floor, hit.hp);
    const next: Character = { ...hit, hp, dead: false, deathSaves: hp === 0 ? { successes: 0, failures: 0, stable: true } : hit.deathSaves };
    if (c === state.hero) state.hero = next;
    else state.companions = state.companions.map((x) => (x.id === c.id ? next : x));
    result.facts.push((ctx.msgs ?? ENGLISH_MESSAGES).m(hp === 0 ? 'story.damageDown' : 'story.damage', { name: c.name, amount: c.hp - hp, type: d.type }));
  }
}

/**
 * A rest in a safe place (spec §8 resting): short = spend Hit Dice (largest first) while at least
 * one die's average is missing, recharge short-rest resources and pact slots; long = full HP, all
 * Hit Dice, spell slots and resources, −1 Exhaustion. A stable character at 0 HP wakes at 1 HP first.
 */
function storyRest(ctx: RunContext, kind: 'short' | 'long', result: StepResult): void {
  const { state } = ctx;
  const rest = (c: Character): Character => {
    if (c.dead) return c;
    let cur: Character = c.hp < 1 ? { ...c, hp: 1, conditions: c.conditions.filter((x) => x.condition !== 'unconscious'), deathSaves: { successes: 0, failures: 0, stable: false } } : c;
    if (kind === 'short') {
      const avg = (die: string) => Number(die.slice(1)) / 2 + 1;
      const spend: string[] = [];
      const pool = { ...cur.hitDice };
      let missing = cur.maxHp - cur.hp;
      for (const die of Object.keys(pool).sort((a, b) => Number(b.slice(1)) - Number(a.slice(1)))) {
        while ((pool[die] ?? 0) > 0 && missing >= avg(die)) {
          spend.push(die);
          pool[die]! -= 1;
          missing -= avg(die);
        }
      }
      cur = shortRest(cur, ctx.rng, spend).character;
      if (cur.spellcasting?.pact) cur = { ...cur, spellcasting: { ...cur.spellcasting, pact: { ...cur.spellcasting.pact, current: cur.spellcasting.pact.max } } };
      return cur;
    }
    const classes = cur.classes.map((x) => ({ hitDie: ctx.db?.classes.get(x.classId)?.hitDie ?? 'd8', level: x.level }));
    cur = longRest(cur, hitDicePool(classes));
    if (cur.spellcasting) {
      const { concentration: _c, ...sc } = cur.spellcasting;
      cur = { ...cur, spellcasting: { ...sc, slots: [...sc.maxSlots], ...(sc.pact && { pact: { ...sc.pact, current: sc.pact.max } }) } };
    }
    return cur;
  };
  const before = state.hero.hp;
  state.hero = rest(state.hero);
  state.companions = state.companions.map(rest);
  state.time += kind === 'short' ? TIME_COSTS.short_rest : TIME_COSTS.long_rest;
  const { m } = ctx.msgs ?? ENGLISH_MESSAGES;
  result.facts.push(
    kind === 'long' ? m('story.longRest') : state.hero.hp > before ? m('story.shortRestHeal', { name: state.hero.name, hp: state.hero.hp - before }) : m('story.shortRest'),
  );
}

const TOOTH_HOLDER = /^arc\.main\.tooth_[a-z]+_holder$/;
const SAFE_HOLDERS = new Set(['player', 'wardens', 'briarkin', 'red_gull', 'dawn_lance']);

/** DESIGN §3: `arc.main.teeth_secured` / `teeth_choir` follow the seven holder flags. */
export function recountTeeth(flags: GameState['flags']): void {
  const holders = Object.entries(flags).filter(([k]) => TOOTH_HOLDER.test(k)).map(([, v]) => String(v));
  flags['arc.main.teeth_secured'] = holders.filter((h) => SAFE_HOLDERS.has(h)).length;
  flags['arc.main.teeth_choir'] = holders.filter((h) => h === 'choir').length;
}

/** Recruit / approval / parting outcomes applied straight away (lines go to `result.partyLog`). */
function applyParty(ctx: RunContext, roster: CompanionRoster, o: Outcome, result: StepResult): void {
  const def = (id: string) => roster.companions.find((c) => c.id === id);
  const msgs = ctx.msgs ?? ENGLISH_MESSAGES;
  const log = (line: string | undefined) => {
    if (line) (result.partyLog ??= []).push(line);
  };
  if (o.recruit) {
    const d = def(o.recruit);
    if (d) log((ctx.db ? recruitCompanion(ctx.state, d, ctx.db, msgs) : recruitFlagsOnly(ctx.state, d, roster, msgs)).message);
  }
  for (const a of o.approval) {
    const d = def(a.companion);
    if (d) log(changeApproval(ctx.state, d, a.delta, msgs));
  }
  if (o.companionLeaves) {
    const d = def(o.companionLeaves.id);
    if (d) {
      partWithCompanion(ctx.state, d, o.companionLeaves.status);
      log(partingLine(d, o.companionLeaves.status, msgs));
    }
  }
  if (o.companionReturns) {
    const d = def(o.companionReturns.id);
    if (d) log(returnCompanion(ctx.state, d, roster, o.companionReturns.loyalty, ctx.db, msgs).message);
  }
}

/**
 * Starts, completes or fails deadlines. A missed deadline applies its `missed` outcome; a warning
 * fact is added once when `warnAt` minutes or fewer remain.
 */
export function checkDeadlines(ctx: RunContext, result: StepResult, depth = 0): void {
  const p = getProgress(ctx.state);
  if (!p) return;
  const cc = conditionContext(ctx.state, p, flagsFor(ctx));
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
      result.facts.push(d.warning ?? (ctx.msgs ?? ENGLISH_MESSAGES).m('story.deadline', { text: d.text }));
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

/** Passes over the beat list per step: a beat set up by a later beat still fires in the same step. */
const BEAT_PASSES = 5;

function fireBeats(ctx: RunContext, result: StepResult, depth = 0): void {
  const p = getProgress(ctx.state)!;
  const registry = flagsFor(ctx);
  for (let pass = 0; pass < BEAT_PASSES; pass++) {
    let fired = false;
    // Rebuilt only after a beat fires (its outcome may change flags, coins, items, time).
    let cc: ConditionContext | undefined;
    for (const b of ctx.adventure.beats) {
      if (p.beats.includes(b.id)) continue;
      if (b.scenes.length && !b.scenes.includes(getProgress(ctx.state)!.sceneId)) continue;
      if (!evalCondition(b.trigger, (cc ??= conditionContext(ctx.state, p, registry)))) continue;
      cc = undefined;
      p.beats.push(b.id);
      result.facts.push(b.text);
      applyOutcome(ctx, b.outcome, result, depth + 1);
      fired = true;
    }
    if (!fired) break;
  }
  checkDeadlines(ctx, result, depth);
  trackQuests(ctx);
}

function giveItem(hero: Character, itemId: string, quantity: number, db: SrdDatabase | undefined, result: StepResult): void {
  addItem(hero, itemId, quantity, db);
  const r = result.items.find((i) => i.itemId === itemId);
  if (r) r.quantity += quantity;
  else result.items.push({ itemId, quantity });
}

/** Takes up to `quantity` of an item from the hero (across stacks); records what was taken. */
function takeItem(hero: Character, itemId: string, quantity: number, result: StepResult): void {
  let left = quantity;
  for (const entry of [...hero.inventory].filter((i) => i.itemId === itemId)) {
    if (left <= 0) break;
    const n = Math.min(left, entry.quantity);
    removeItem(hero, entry.uid, n);
    left -= n;
  }
  const taken = quantity - left;
  if (taken > 0) (result.removed ??= []).push({ itemId, quantity: taken });
}

function giveCoins(hero: Character, cp: number, result: StepResult): void {
  hero.coins += cp;
  result.coins += cp;
}

/** 1234 cp → "12 gp 3 sp 4 cp" (in the given language). */
export function formatCoins(cp: number, msgs: Messages = ENGLISH_MESSAGES): string {
  return msgs.coins(cp);
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
