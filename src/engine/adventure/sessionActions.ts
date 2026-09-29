/**
 * Connects the scene runner to a GameSession (its ActionPort): choices and free text (intent parser →
 * validateIntent → resolveIntent) are resolved by the engine, rolls are shown, then the facts are
 * narrated (streamed LLM or template). Until combat (A068) exists, encounters auto-resolve as wins.
 */
import { dungeonView } from '../world/dungeon';
import { CombatNarrationQueue, pickMoments, type CombatNarrationMode } from './combatNarration';
import { logSince } from '../combat/encounter';
import type { SrdDatabase } from '../data/srd';
import type { FlagRegistry } from '../world/flags';
import { describeChange } from '../world/factions';
import { getMap, travel, type TravelEventTable } from '../world/travel';
import { buy, haggle, sell, shopView, type ShopTable } from '../world/shops';
import { equipItem, itemName, unequipItem } from '../character/inventory';
import type { Lore } from '../world/lore';
import type { ActionPort, GameSession } from '../session/GameSession';
import { arriveInScene, availableActions, findScene, formatCoins, getProgress, leaveScenes, sceneForLocation, type AvailableAction, perform, resolveEncounter, startAdventure, type RunContext, type StepResult } from './runner';
import type { Adventure } from './schema';
import { intentContext, keywordIntent, validateIntent, type Intent, type IntentContext } from './intent';
import { narrateInto, type Narrator } from './narration';
import { currentObjective } from './quests';
import { resolveIntent } from './resolve';
import { activeFight, fightAct, finishFight, startFight, type FightEnd } from './fights';
import type { DefeatTable } from './defeat';
import { canLevelUp, levelUp } from '../character/leveling';
import { banterDue, speakBanter, type BanterGenerator } from '../party/banter';
import { changeApproval, levelCompanionsWithHero, partWithCompanion, recruitCompanion, setControl, type CompanionRoster } from '../party/companions';
import { totalLevel } from '../core/creature';
import type { Ability, Skill } from '../rules/basics';
import { acceptOffer, activeSideQuest, finishActive, offerSources, offersAt, refreshOffers, roadOffer, sideQuestState, type SideQuestDeps } from './sideQuests';
import type { SideQuestTables } from './sidequestTables';
import type { SuggestedAction } from '../../shared/protocol';
import { MINUTES_PER_DAY } from '../world/clock';
import { moodFor } from '../world/mood';
import { dataSuggestions, mergeSuggestions, type SuggestionIdea } from './suggestions';
import { updateSummary, type Summarizer } from './summary';

export interface AdventurePortOptions {
  /** Free text → Intent (the LLM parser on the server). Defaults to the keyword parser. */
  parseIntent?: (text: string, ictx: IntentContext) => Promise<Intent>;
  /** Streams narration (the LLM on the server). Without it, template narration is used. */
  narrator?: Narrator;
  /** Combat narration frequency (settings.llm.combatNarration); default 'key'. */
  combatNarration?: () => CombatNarrationMode;
  /** Contextual action ideas (the LLM). Without it, only the data-driven buttons are shown. */
  suggester?: (ctx: RunContext, offered: AvailableAction[]) => Promise<SuggestionIdea[]>;
  /** Condenses the story after each scene (the LLM). Without it, the template summary is used. */
  summarizer?: Summarizer;
  /** Flag types/defaults/bounds. */
  flags?: FlagRegistry;
  /** World lore (faction relationships, names, map). */
  lore?: Lore;
  /** Random travel events table (data/tables/travel-events.json). */
  travelEvents?: TravelEventTable;
  /** Shops (data/world/shops.json). */
  shops?: ShopTable;
  /** Side-quest generator tables (data/tables/sidequests.json); enables quest boards etc. */
  sideQuests?: SideQuestTables;
  /** Heroic defeat outcomes (data/tables/defeat-outcomes.json). */
  defeats?: DefeatTable;
  /** Recruitable companions (data/companions.json). */
  companions?: CompanionRoster;
  /** Companion banter lines (the LLM); without it the roster's written lines are used. */
  banter?: BanterGenerator;
}

/** The ActionPort plus a hook for tests to wait for background suggestion/summary work. */
export interface AdventureActionPort extends ActionPort {
  idle(): Promise<void>;
}

export function adventureActionPort(adventures: ReadonlyMap<string, Adventure>, defaultId: string, db?: SrdDatabase, opts: AdventurePortOptions = {}): AdventureActionPort {
  const parse = opts.parseIntent ?? (async (text: string, ictx: IntentContext) => keywordIntent(text, ictx));
  let pendingIdeas: Promise<void> = Promise.resolve();
  let pendingSummary: Promise<void> = Promise.resolve();
  const ctxFor = (session: GameSession): RunContext => {
    // A just-accepted side quest has no progress yet; otherwise progress names the adventure.
    const pending = (session.current.extensions.sideQuests as { active?: { adventure: Adventure } } | undefined)?.active?.adventure.id;
    const id = getProgress(session.current)?.adventureId ?? pending ?? defaultId;
    const adventure = adventures.get(id) ?? activeSideQuest(session.current, id);
    if (!adventure) throw new Error(`Adventure "${id}" is not installed`);
    return { state: session.current, adventure, rng: session.rng, ...(db && { db }), ...(opts.flags && { flags: opts.flags }), ...(opts.lore && { lore: opts.lore }), ...(opts.companions && { companions: opts.companions }) };
  };

  const publish = async (session: GameSession, ctx: RunContext, r: StepResult, playerAction?: string): Promise<void> => {
    // Dice first, so the tray animates while the narration is written.
    for (const roll of r.rolls) {
      session.addRoll({
        label: roll.label,
        dice: roll.d20.rolls,
        mode: roll.mode,
        modifier: roll.total - roll.d20.natural,
        total: roll.total,
        math: roll.text,
        ...(roll.success !== undefined && { success: roll.success }),
      });
    }
    if (r.entered.length || r.facts.length) {
      await narrateInto(
        session,
        {
          kind: r.entered.length ? 'scene' : 'outcome',
          facts: r.facts,
          ctx,
          ...(playerAction && { playerAction }),
          ...(r.arrivalIndex !== undefined && { arrivalIndex: r.arrivalIndex }),
        },
        opts.narrator,
      );
    }
    if (r.items.length || r.coins > 0) session.addLog('system', `Received: ${[...r.items.map((i) => `${i.quantity}× ${i.itemId.replace(/_/g, ' ')}`), ...(r.coins > 0 ? [formatCoins(r.coins)] : [])].join(', ')}`);
    if (r.coins < 0) session.addLog('system', `Paid ${formatCoins(-r.coins)}.`);
    if (r.removed?.length) session.addLog('system', `Handed over: ${r.removed.map((i) => `${i.quantity}× ${i.itemId.replace(/_/g, ' ')}`).join(', ')}`);
    if (r.xp) session.addLog('system', `+${r.xp} XP`);
    for (const line of r.partyLog ?? []) session.addLog('system', line);
    for (const id of r.recruits ?? []) {
      const def = opts.companions?.companions.find((c) => c.id === id);
      if (!def || !db) continue;
      session.addLog('system', recruitCompanion(session.current, def, db).message);
    }
    for (const a of r.approvals ?? []) {
      const def = opts.companions?.companions.find((c) => c.id === a.companion);
      const line = def && changeApproval(session.current, def, a.delta);
      if (line) session.addLog('system', line);
    }
    for (const p of r.partings ?? []) {
      const def = opts.companions?.companions.find((c) => c.id === p.id);
      if (!def) continue;
      partWithCompanion(session.current, def, p.status);
      session.addLog('system', p.status === 'waiting' ? `${def.name} will wait for you.` : p.status === 'left' ? `${def.name} leaves the party.` : p.status === 'betrayed' ? `${def.name} has betrayed you!` : `${def.name} is dead.`);
    }
    for (const c of r.reputation ?? []) if (!c.ripple || c.newTier) session.addLog('system', describeChange(c, opts.lore));
    if (r.ending) {
      const end = ctx.adventure.endings.find((e) => e.id === r.ending);
      session.addLog('narration', end?.text ?? 'The adventure ends.');
    }
    if (r.encounter) {
      const def = ctx.adventure.encounters.find((e) => e.id === r.encounter);
      if (!db) {
        // No rules data (tests without SRD): resolve as a victory.
        await publish(session, ctx, resolveEncounter(ctx, r.encounter, 'win'));
        return;
      }
      session.autosave(); // before combat (spec §9)
      const fight = startFight(ctx, r.encounter, session.rng, db);
      session.addLog('system', `Combat! ${def?.name ?? 'Enemies'} attack.`);
      session.emit({ type: 'mood', mood: 'battle', ambience: null });
      narrateCombat(session, ctx, fight.enc.log);
      emitFight(session);
      if (fight.enc.status !== 'ongoing') await endFight(session, ctx, fight.enc.status === 'won' ? 'win' : 'lose');
    }
  };

  // Combat narration runs in the background; the command returns at once (A069).
  const combatVoice = new CombatNarrationQueue(opts.narrator);
  const narrateCombat = (session: GameSession, ctx: RunContext, lines: readonly string[]) => {
    const facts = pickMoments(lines, opts.combatNarration?.() ?? 'key');
    if (facts.length) combatVoice.push(session, { kind: 'combat', facts, ctx });
  };

  const emitFight = (session: GameSession) => {
    const f = activeFight(session.current);
    const def = f && adventures.get(f.adventureId)?.encounters.find((e) => e.id === f.encounterId);
    session.emit({ type: 'combat', encounter: f ? structuredClone(f.enc) : null, ...(def && { canFlee: def.canFlee }) });
  };

  const endFight = async (session: GameSession, ctx: RunContext, how: FightEnd) => {
    const res = finishFight(ctx, how, { db: db!, rng: session.rng, ...(opts.lore && { lore: opts.lore }), ...(opts.flags && { flags: opts.flags }), ...(opts.defeats && { defeats: opts.defeats }) });
    emitFight(session);
    if (res.heroDied) {
      session.addLog('narration', `${session.current.hero.name} has fallen. The world goes on without them…`);
      session.emit({ type: 'hero_fallen', name: session.current.hero.name });
      return;
    }
    session.addLog('system', how === 'win' ? `Victory! +${res.xp} XP` : how === 'flee' ? 'You escape the fight.' : 'Defeat…');
    if (how === 'win' && db && canLevelUp(session.current.hero, db)) session.addLog('system', 'You have enough experience to level up!');
    await publish(session, ctx, res.step);
  };

  // Data-driven buttons at once; LLM ideas replace them when they arrive, unless the player has
  // acted in the meantime (the log moved on). Never awaited, so it never slows a turn down.
  const sqDeps = (): SideQuestDeps | undefined =>
    opts.sideQuests && opts.lore && db ? { tables: opts.sideQuests, lore: opts.lore, db, ...(opts.flags && { flags: opts.flags }) } : undefined;

  /** Job buttons: look for work where quests are offered, or take an offered job. */
  const jobButtons = (session: GameSession): SuggestedAction[] => {
    const deps = sqDeps();
    const here = getMap(session.current)?.current;
    if (!deps || !here || sideQuestState(session.current).active) return [];
    const day = Math.floor(session.current.time / MINUTES_PER_DAY);
    const out: SuggestedAction[] = offersAt(session.current, here).map((o) => ({ id: `sq:take:${o.id}`, label: `Take a job from ${o.sourceLabel}: ${o.adventure.name}` }));
    if (offerSources(session.current, deps, here).length && !sideQuestState(session.current).checked.includes(`${here}:${day}`)) out.push({ id: 'sq:look', label: 'Look for work' });
    return out;
  };

  const offer = (session: GameSession, ctx: RunContext) => {
    session.emit({ type: 'objective', text: currentObjective(ctx) ?? null });
    session.emit({ type: 'dungeon', view: dungeonView(ctx.adventure.maps, session.current.extensions) });
    if (opts.lore) {
      const p = getProgress(ctx.state);
      const scene = p && !p.away ? findScene(ctx.adventure, p.sceneId) : undefined;
      const place = scene?.locationId ?? getMap(ctx.state)?.current;
      session.emit({ type: 'mood', ...moodFor(opts.lore, { ...(scene?.mood && { sceneMood: scene.mood }), ...(place && { locationId: place }) }) });
    }
    const offered = availableActions(ctx);
    const jobs = jobButtons(session);
    session.suggest([...dataSuggestions(offered), ...jobs]);
    if (!opts.suggester || offered.length === 0) return;
    const stamp = session.current.nextId;
    pendingIdeas = opts
      .suggester(ctx, offered)
      .then((ideas) => {
        if (ideas.length && session.running && session.current.nextId === stamp) session.suggest([...mergeSuggestions(offered, ideas), ...jobs]);
      })
      .catch(() => undefined);
  };

  // Occasional companion banter, in the background so it never delays a turn.
  let pendingBanter: Promise<void> = Promise.resolve();
  const maybeBanter = (session: GameSession) => {
    if (!opts.companions || activeFight(session.current)) return;
    const who = banterDue(session.current, opts.companions);
    if (!who) return;
    const state = session.current;
    const context = state.log.slice(-4).map((e) => e.text).join('\n');
    pendingBanter = pendingBanter
      .then(async () => {
        const line = await speakBanter(state, who, context, opts.banter);
        if (line && session.running && session.current === state) session.addLog('dialogue', line, who.name);
      })
      .catch(() => undefined);
  };

  const finish = async (session: GameSession, ctx: RunContext, r: StepResult, playerAction?: string) => {
    await publish(session, ctx, r, playerAction);
    maybeBanter(session);
    // A finished side quest hands control back to the main adventure.
    const done = finishActive(session.current);
    if (done) {
      session.addLog('system', `Job ${done.ending === 'done' ? 'complete' : 'over'}: ${done.name}.`);
      ctx = ctxFor(session);
    }
    offer(session, ctx);
    if (r.entered.length) {
      session.autosave();
      // Condense the finished scene in the background (chained so updates never overlap).
      const state = session.current;
      pendingSummary = pendingSummary.then(() => updateSummary(state, opts.summarizer)).catch(() => undefined);
    }
  };

  const sideQuestChoice = async (session: GameSession, actionId: string) => {
    const deps = sqDeps();
    const here = getMap(session.current)?.current;
    if (!deps || !here) throw new Error('No work is offered here.');
    if (actionId === 'sq:look') {
      const added = refreshOffers(session.current, deps, here);
      const all = offersAt(session.current, here);
      session.addLog('narration', all.length ? `You ask around for work. ${all.map((o) => `From ${o.sourceLabel}: "${o.adventure.summary}"`).join(' ')}` : 'You ask around, but nobody has work for you today.');
      if (added.length === 0 && all.length === 0) session.addLog('system', 'Try again another day.');
      offer(session, ctxFor(session));
      return;
    }
    const offerId = actionId.slice('sq:take:'.length);
    acceptOffer(session.current, offerId);
    const ctx = ctxFor(session);
    await publish(session, ctx, startAdventure(ctx));
    offer(session, ctx);
    session.autosave();
  };

  return {
    idle: async () => {
      await pendingIdeas;
      await pendingSummary;
      await pendingBanter;
      await combatVoice.idle();
    },
    async begin(session) {
      const ctx = ctxFor(session);
      if (activeFight(session.current)) {
        session.addLog('system', 'The fight is still on!');
        emitFight(session);
        return;
      }
      const p = getProgress(session.current);
      const awayAt = p?.away ? opts.lore?.locations.find((l) => l.id === p.away) : undefined;
      if (!p) await publish(session, ctx, startAdventure(ctx));
      else if (awayAt) await narrateInto(session, { kind: 'outcome', facts: [`You are in ${awayAt.name}. ${awayAt.summary}`], ctx }, opts.narrator);
      else await narrateInto(session, { kind: 'scene', facts: [], ctx }, opts.narrator);
      offer(session, ctx);
    },
    async travel(session, to, pace) {
      if (activeFight(session.current)) throw new Error('You cannot travel in the middle of a fight!');
      const lore = opts.lore;
      if (!lore) throw new Error('Travel needs the world map');
      const ctx = ctxFor(session);
      const before = ctx.state.time;
      const dest = lore.locations.find((l) => l.id === to);
      if (!dest) throw new Error('Unknown place');
      let res = travel({ state: ctx.state, lore, rng: session.rng, ...(opts.travelEvents && { events: opts.travelEvents }) }, to, pace);
      if (!res.ok) throw new Error(res.error ?? 'You cannot travel there.');
      for (let guard = 0; ; guard++) {
        for (const roll of res.rolls) session.addRoll({ label: roll.label, dice: roll.d20.rolls, mode: roll.mode, modifier: roll.total - roll.d20.natural, total: roll.total, math: roll.text, ...(roll.success !== undefined && { success: roll.success }) });
        for (const l of res.log) session.addLog('narration', l.text);
        const deps = sqDeps();
        const met = res.log.find((l) => l.eventId && opts.travelEvents?.events.find((e) => e.id === l.eventId)?.kind === 'discovery');
        if (deps && met && res.arrived) {
          const o = roadOffer(ctx.state, deps, to);
          if (o) session.addLog('system', `A traveler you met on the road asks for help: ${o.adventure.name}.`);
        }
        if (!res.encounter || guard >= 3) break;
        session.addLog('system', 'Travel encounter! (Tactical combat arrives in a later build; you fight them off.)');
        res = travel({ state: ctx.state, lore, rng: session.rng, ...(opts.travelEvents && { events: opts.travelEvents }) }, to, pace);
        if (!res.ok) break;
      }
      const days = Math.round((ctx.state.time - before) / 1440);
      session.addLog('system', `You travel to ${dest.name}${days >= 1 ? ` (${days} day${days > 1 ? 's' : ''})` : ''}.`);
      const sceneId = sceneForLocation(ctx.adventure, to, getProgress(ctx.state)?.visited ?? []);
      if (sceneId) {
        await publish(session, ctx, arriveInScene(ctx, sceneId));
      } else {
        leaveScenes(ctx, to, dest.name);
        await narrateInto(session, { kind: 'outcome', facts: [`You arrive at ${dest.name}. ${dest.summary}`], ctx }, opts.narrator);
      }
      offer(session, ctx);
      session.timePassed(before);
      session.autosave();
    },
    async command(session, cmd) {
      if (cmd.type === 'companion_control') {
        if (activeFight(session.current)) throw new Error('Change control outside of combat.');
        setControl(session.current, cmd.companionId, cmd.control);
        const c = session.current.companions.find((x) => x.id === cmd.companionId)!;
        session.addLog('system', `${c.name} is now ${cmd.control === 'player' ? 'controlled by you' : 'controlled by the AI'} in combat.`);
        return;
      }
      if (cmd.type === 'level_up') {
        if (!db) throw new Error('Leveling needs the SRD data');
        if (activeFight(session.current)) throw new Error('Finish the fight first.');
        const before = totalLevel(session.current.hero);
        const res = levelUp(session.current.hero, db, {
          classId: cmd.classId,
          hp: cmd.hpMode === 'roll' ? { mode: 'roll', rng: session.rng } : { mode: 'average' },
          ...(cmd.subclassId && { subclassId: cmd.subclassId }),
          ...(cmd.feat && { feat: { featId: cmd.feat.featId, ...(cmd.feat.increases && { increases: cmd.feat.increases as Partial<Record<Ability, number>> }) } }),
          ...(cmd.cantrips && { cantrips: cmd.cantrips }),
          ...(cmd.spells && { spells: cmd.spells }),
          ...(cmd.weaponMasteries && { weaponMasteries: cmd.weaponMasteries }),
          ...(cmd.expertise && { expertise: cmd.expertise as Skill[] }),
          ...(cmd.skills && { skills: cmd.skills as Skill[] }),
        });
        session.current.hero = res.character;
        session.addLog('system', `Level ${before + 1}! +${res.hpGained} HP${res.features.length ? `. New: ${res.features.join(', ')}` : ''}.`);
        if (opts.companions) for (const line of levelCompanionsWithHero(session.current, opts.companions, db)) session.addLog('system', line);
        return;
      }
      if (cmd.type === 'combat_act' || cmd.type === 'combat_flee') {
        if (!db) throw new Error('Combat needs the SRD data');
        const f = activeFight(session.current);
        if (!f) throw new Error('There is no fight going on.');
        const ctx = ctxFor(session);
        if (cmd.type === 'combat_flee') {
          const def = ctx.adventure.encounters.find((e) => e.id === f.encounterId);
          if (def && !def.canFlee) throw new Error('There is no escape from this fight!');
          await endFight(session, ctx, 'flee');
        } else {
          const seq = f.enc.logSeq ?? f.enc.log.length;
          const err = fightAct(session.current, cmd.action, session.rng, db);
          if (err) throw new Error(err);
          const now = activeFight(session.current);
          if (now) narrateCombat(session, ctx, logSince(now.enc, seq));
          const status = activeFight(session.current)!.enc.status;
          if (status === 'ongoing') emitFight(session);
          else await endFight(session, ctx, status === 'won' ? 'win' : 'lose');
        }
        offer(session, ctxFor(session));
        return;
      }
      const hero = session.current.hero;
      if (cmd.type === 'equip' || cmd.type === 'unequip') {
        if (!db) throw new Error('Equipment needs the SRD data');
        const r = cmd.type === 'equip' ? equipItem(hero, cmd.uid, db, cmd.slot) : unequipItem(hero, cmd.uid, db);
        if (!r.ok) throw new Error(r.error);
        return;
      }
      if (!db || !opts.lore || !opts.shops) throw new Error('Shops are not available');
      const here = getMap(session.current)?.current;
      const shop = opts.shops.shops.find((s) => s.id === cmd.shopId);
      if (!shop || shop.locationId !== here) throw new Error('That shop is not here.');
      const sctx = { state: session.current, db, lore: opts.lore, table: opts.shops };
      if (cmd.type === 'shop_buy') {
        const r = buy(sctx, cmd.shopId, cmd.itemId, cmd.qty);
        if (!r.ok) throw new Error(r.error);
        session.addLog('system', `Bought ${cmd.qty}× ${itemName(cmd.itemId, db)} for ${formatCoins(-r.coins)}.`);
      } else if (cmd.type === 'shop_sell') {
        const entry = hero.inventory.find((i) => i.uid === cmd.uid);
        const r = sell(sctx, cmd.shopId, cmd.uid, cmd.qty);
        if (!r.ok) throw new Error(r.error);
        session.addLog('system', `Sold ${cmd.qty}× ${entry ? itemName(entry.itemId, db) : 'item'} for ${formatCoins(r.coins)}.`);
      } else if (cmd.type === 'shop_haggle') {
        const r = haggle({ ...sctx, rng: session.rng }, cmd.shopId);
        if (!r.ok) throw new Error(r.error);
        session.addRoll({ label: r.roll.label, dice: r.roll.d20.rolls, mode: r.roll.mode, modifier: r.roll.total - r.roll.d20.natural, total: r.roll.total, math: r.roll.text, ...(r.roll.success !== undefined && { success: r.roll.success }) });
        session.addLog('system', r.success ? `${shop.name}: the shopkeeper grudgingly offers better prices today.` : `${shop.name}: the shopkeeper will not budge.`);
      }
      const view = shopView(sctx, cmd.shopId);
      if (view) session.emit({ type: 'shop', shop: view });
    },
    async choose(session, actionId) {
      if (activeFight(session.current)) throw new Error('You are in the middle of a fight!');
      if (actionId.startsWith('sq:')) return sideQuestChoice(session, actionId);
      const ctx = ctxFor(session);
      const label = availableActions(ctx).find((a) => a.id === actionId)?.label;
      const before = ctx.state.time;
      const r = perform(ctx, actionId);
      await finish(session, ctx, r, label);
      session.timePassed(before);
    },
    async say(session, text) {
      if (activeFight(session.current)) throw new Error('You are in the middle of a fight!');
      session.addLog('player', text);
      const ctx = ctxFor(session);
      const ictx = intentContext(ctx);
      const v = validateIntent(await parse(text, ictx), ictx);
      const before = ctx.state.time;
      const r = resolveIntent(ctx, v, text);
      await finish(session, ctx, r.result, r.playerAction);
      session.timePassed(before);
    },
  };
}

