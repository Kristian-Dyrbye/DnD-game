/**
 * Connects the scene runner to a GameSession (its ActionPort): choices and free text (intent parser →
 * validateIntent → resolveIntent) are resolved by the engine, rolls are shown, then the facts are
 * narrated (streamed LLM or template). Until combat (A068) exists, encounters auto-resolve as wins.
 */
import { mendYourself, repairAtSmith } from '../character/armorWear';
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
import { arriveInScene, availableActions, findScene, getProgress, leaveScenes, sceneForLocation, type AvailableAction, perform, resolveEncounter, startAdventure, type RunContext, type StepResult } from './runner';
import type { Adventure } from './schema';
import { intentContext, keywordIntent, refineIntent, validateIntent, type Intent, type IntentContext } from './intent';
import { narrateInto, type Narrator } from './narration';
import { dialogueView, DIALOGUE_PREFIX, LEAVE_TALK } from './conversation';
import { currentObjective } from './quests';
import { resolveIntent } from './resolve';
import { activeFight, fightAct, finishFight, startFight, type FightEnd } from './fights';
import type { DefeatTable } from './defeat';
import { canLevelUp, levelUp } from '../character/leveling';
import { banterDue, speakBanter, type BanterGenerator } from '../party/banter';
import { changeApproval, levelCompanionsWithHero, partingLine, partWithCompanion,recruitCompanion, returnCompanion, setControl, type CompanionRoster } from '../party/companions';
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
    return { state: session.current, adventure, rng: session.rng, msgs: session.msgs, ...(db && { db }), ...(opts.flags && { flags: opts.flags }), ...(opts.lore && { lore: opts.lore }), ...(opts.companions && { companions: opts.companions }) };
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
          ...(r.entered.length > 0 && { visit: r.returning ? 'return' : 'first' }),
        },
        opts.narrator,
      );
    }
    // Authored conversation lines, verbatim (TTS voices them as dialogue).
    for (const d of r.dialogue ?? []) session.addLog('dialogue', d.text, d.speaker);
    const { m, coins, lang } = session.msgs;
    // English keeps its lower-case id words ("potion of healing"); other languages show the SRD name overlay.
    const itemLine = (i: { quantity: number; itemId: string }) =>
      m('story.item', { qty: i.quantity, item: db && lang !== 'en' ? itemName(i.itemId, db, lang) : i.itemId.replace(/_/g, ' ') });
    if (r.items.length || r.coins > 0) session.addLog('system', m('story.received', { list: [...r.items.map(itemLine), ...(r.coins > 0 ? [coins(r.coins)] : [])].join(', ') }));
    if (r.coins < 0) session.addLog('system', m('story.paid', { coins: coins(-r.coins) }));
    if (r.removed?.length) session.addLog('system', m('story.handedOver', { list: r.removed.map(itemLine).join(', ') }));
    if (r.xp) session.addLog('system', m('story.xp', { xp: r.xp }));
    for (const line of r.partyLog ?? []) session.addLog('system', line);
    for (const id of r.recruits ?? []) {
      const def = opts.companions?.companions.find((c) => c.id === id);
      if (!def || !db) continue;
      session.addLog('system', recruitCompanion(session.current, def, db, session.msgs).message);
    }
    for (const a of r.approvals ?? []) {
      const def = opts.companions?.companions.find((c) => c.id === a.companion);
      const line = def && changeApproval(session.current, def, a.delta, session.msgs);
      if (line) session.addLog('system', line);
    }
    for (const p of r.partings ?? []) {
      const def = opts.companions?.companions.find((c) => c.id === p.id);
      if (!def) continue;
      partWithCompanion(session.current, def, p.status);
      session.addLog('system', partingLine(def, p.status, session.msgs));
    }
    for (const back of r.returns ?? []) {
      const def = opts.companions?.companions.find((c) => c.id === back.id);
      if (def) session.addLog('system', returnCompanion(session.current, def, opts.companions!, back.loyalty, db, session.msgs).message);
    }
    for (const c of r.reputation ?? []) if (!c.ripple || c.newTier) session.addLog('system', describeChange(c, opts.lore, session.msgs));
    for (const tip of r.tips ?? []) {
      const seen = (session.current.extensions.tipsSeen as string[] | undefined) ?? [];
      if (seen.includes(tip)) continue;
      session.current.extensions.tipsSeen = [...seen, tip];
      session.addLog('system', m('story.tip', { tip }));
    }
    if (r.ending) {
      const end = ctx.adventure.endings.find((e) => e.id === r.ending);
      session.addLog('narration', end?.text ?? m('story.adventureEnds'));
      // The campaign goes on: the next chapter starts where this one ended (spec §7.2).
      const next = end?.next ? adventures.get(end.next) : undefined;
      if (next) {
        const done = (session.current.extensions.completedAdventures as { id: string; ending: string }[] | undefined) ?? [];
        session.current.extensions.completedAdventures = [...done, { id: ctx.adventure.id, ending: r.ending }];
        session.addLog('system', `— ${next.name} —`);
        const nextCtx: RunContext = { ...ctx, adventure: next };
        await publish(session, nextCtx, startAdventure(nextCtx));
        session.autosave();
        return;
      }
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
      session.addLog('system', m('fight.start', { name: def?.name ?? m('fight.enemies') }));
      session.emit({ type: 'mood', mood: 'battle', ambience: null });
      narrateCombat(session, ctx, fight.enc.log);
      emitFight(session);
      if (fight.enc.status !== 'ongoing') await endFight(session, ctx, fight.enc.status === 'won' ? 'win' : 'lose');
    }
  };

  // Combat narration runs in the background; the command returns at once (A069).
  const combatVoice = new CombatNarrationQueue(opts.narrator);
  const narrateCombat = (session: GameSession, ctx: RunContext, lines: readonly string[]) => {
    const facts = pickMoments(lines, opts.combatNarration?.() ?? 'key', session.msgs);
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
    const { m } = session.msgs;
    for (const line of res.scars ?? []) session.addLog('system', line);
    if (res.heroDied) {
      session.addLog('narration', m('fight.heroFallen', { name: session.current.hero.name }));
      session.emit({ type: 'hero_fallen', name: session.current.hero.name });
      return;
    }
    session.addLog('system', how === 'win' ? m('fight.victory', { xp: res.xp }) : how === 'flee' ? m('fight.escaped') : m('fight.defeat'));
    if (how === 'win' && db && canLevelUp(session.current.hero, db)) session.addLog('system', m('fight.canLevelUp'));
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
    const { m } = session.msgs;
    const out: SuggestedAction[] = offersAt(session.current, here).map((o) => ({ id: `sq:take:${o.id}`, label: m('job.take', { source: o.sourceLabel, name: o.adventure.name }) }));
    if (offerSources(session.current, deps, here, session.msgs).length && !sideQuestState(session.current).checked.includes(`${here}:${day}`)) out.push({ id: 'sq:look', label: m('job.look') });
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
    const talk = getProgress(ctx.state)?.talk;
    session.emit({ type: 'dialogue', view: dialogueView(ctx.adventure, talk) });
    const offered = availableActions(ctx);
    // In a conversation the options stay authored: no job buttons, no model ideas.
    if (talk) return session.suggest(offered.map((a) => ({ id: a.id, label: a.check ? `${a.label} (${a.check})` : a.label })));
    const jobs = jobButtons(session);
    session.suggest([...dataSuggestions(offered, session.msgs), ...jobs]);
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
        const line = await speakBanter(state, who, context, opts.banter, session.msgs.lang);
        if (line && session.running && session.current === state) session.addLog('dialogue', line, who.name);
      })
      .catch(() => undefined);
  };

  const finish = async (session: GameSession, ctx: RunContext, r: StepResult, playerAction?: string) => {
    await publish(session, ctx, r, playerAction);
    maybeBanter(session);
    // A finished side quest hands control back to the main adventure.
    const done = finishActive(session.current);
    if (done) session.addLog('system', session.msgs.m(done.ending === 'done' ? 'job.complete' : 'job.over', { name: done.name }));
    // A finished side quest or a chained next chapter changes the active adventure: re-read it.
    ctx = ctxFor(session);
    offer(session, ctx);
    if (r.entered.length) {
      session.autosave();
      // Condense the finished scene in the background (chained so updates never overlap).
      const state = session.current;
      const msgs = session.msgs;
      pendingSummary = pendingSummary.then(() => updateSummary(state, opts.summarizer, msgs)).catch(() => undefined);
    }
  };

  const sideQuestChoice = async (session: GameSession, actionId: string) => {
    const deps = sqDeps();
    const here = getMap(session.current)?.current;
    const { m } = session.msgs;
    if (!deps || !here) throw new Error(m('job.noneHere'));
    if (actionId === 'sq:look') {
      const added = refreshOffers(session.current, deps, here, session.msgs);
      const all = offersAt(session.current, here);
      session.addLog('narration', all.length ? m('job.askAround', { offers: all.map((o) => m('job.offer', { source: o.sourceLabel, summary: o.adventure.summary })).join(' ') }) : m('job.nobody'));
      if (added.length === 0 && all.length === 0) session.addLog('system', m('job.tryLater'));
      offer(session, ctxFor(session));
      return;
    }
    const offerId = actionId.slice('sq:take:'.length);
    acceptOffer(session.current, offerId, session.msgs);
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
        session.addLog('system', session.msgs.m('story.fightStillOn'));
        emitFight(session);
        return;
      }
      const p = getProgress(session.current);
      const awayAt = p?.away ? opts.lore?.locations.find((l) => l.id === p.away) : undefined;
      if (!p) await publish(session, ctx, startAdventure(ctx));
      else if (awayAt) await narrateInto(session, { kind: 'outcome', facts: [session.msgs.m('story.youAreIn', { name: awayAt.name, summary: awayAt.summary })], ctx }, opts.narrator);
      else await narrateInto(session, { kind: 'scene', facts: [], ctx, visit: 'resume' }, opts.narrator);
      offer(session, ctx);
    },
    async travel(session, to, pace) {
      const { m, mn } = session.msgs;
      if (activeFight(session.current)) throw new Error(m('travel.inFight'));
      const lore = opts.lore;
      if (!lore) throw new Error(m('travel.noMap'));
      const ctx = ctxFor(session);
      const before = ctx.state.time;
      const dest = lore.locations.find((l) => l.id === to);
      if (!dest) throw new Error(m('travel.unknown'));
      const tctx = { state: ctx.state, lore, rng: session.rng, msgs: session.msgs, ...(opts.travelEvents && { events: opts.travelEvents }) };
      let res = travel(tctx, to, pace);
      if (!res.ok) throw new Error(res.error ?? m('travel.cannot'));
      for (let guard = 0; ; guard++) {
        for (const roll of res.rolls) session.addRoll({ label: roll.label, dice: roll.d20.rolls, mode: roll.mode, modifier: roll.total - roll.d20.natural, total: roll.total, math: roll.text, ...(roll.success !== undefined && { success: roll.success }) });
        for (const l of res.log) session.addLog('narration', l.text);
        const deps = sqDeps();
        const met = res.log.find((l) => l.eventId && opts.travelEvents?.events.find((e) => e.id === l.eventId)?.kind === 'discovery');
        if (deps && met && res.arrived) {
          const o = roadOffer(ctx.state, deps, to, session.msgs);
          if (o) session.addLog('system', m('job.roadOffer', { name: o.adventure.name }));
        }
        if (!res.encounter || guard >= 3) break;
        session.addLog('system', m('travel.encounter'));
        res = travel(tctx, to, pace);
        if (!res.ok) break;
      }
      const days = Math.round((ctx.state.time - before) / 1440);
      session.addLog('system', days >= 1 ? mn('travel.doneDays', days, { name: dest.name }) : m('travel.done', { name: dest.name }));
      const sceneId = sceneForLocation(ctx.adventure, to, getProgress(ctx.state)?.visited ?? []);
      if (sceneId) {
        await publish(session, ctx, arriveInScene(ctx, sceneId));
      } else {
        leaveScenes(ctx, to, dest.name);
        await narrateInto(session, { kind: 'outcome', facts: [m('travel.arrive', { name: dest.name, summary: dest.summary })], ctx }, opts.narrator);
      }
      offer(session, ctx);
      session.timePassed(before);
      session.autosave();
    },
    async command(session, cmd) {
      const { m, coins } = session.msgs;
      if (cmd.type === 'companion_control') {
        if (activeFight(session.current)) throw new Error(m('companion.controlOutsideCombat'));
        setControl(session.current, cmd.companionId, cmd.control, session.msgs);
        const c = session.current.companions.find((x) => x.id === cmd.companionId)!;
        session.addLog('system', m(cmd.control === 'player' ? 'companion.controlPlayer' : 'companion.controlAi', { name: c.name }));
        return;
      }
      if (cmd.type === 'level_up') {
        if (!db) throw new Error(m('level.needsSrd'));
        if (activeFight(session.current)) throw new Error(m('level.finishFight'));
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
        session.addLog('system', res.features.length ? m('level.upNew', { level: before + 1, hp: res.hpGained, features: res.features.join(', ') }) : m('level.up', { level: before + 1, hp: res.hpGained }));
        if (opts.companions) for (const line of levelCompanionsWithHero(session.current, opts.companions, db, session.msgs)) session.addLog('system', line);
        return;
      }
      if (cmd.type === 'combat_act' || cmd.type === 'combat_flee') {
        if (!db) throw new Error(m('fight.needsSrd'));
        const f = activeFight(session.current);
        if (!f) throw new Error(m('fight.none'));
        const ctx = ctxFor(session);
        if (cmd.type === 'combat_flee') {
          const def = ctx.adventure.encounters.find((e) => e.id === f.encounterId);
          if (def && !def.canFlee) throw new Error(m('fight.noEscape'));
          await endFight(session, ctx, 'flee');
        } else {
          const seq = f.enc.logSeq ?? f.enc.log.length;
          const err = fightAct(session.current, cmd.action, session.rng, db, session.msgs);
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
        if (!db) throw new Error(m('equip.needsSrd'));
        const r = cmd.type === 'equip' ? equipItem(hero, cmd.uid, db, cmd.slot, session.msgs) : unequipItem(hero, cmd.uid, db, session.msgs);
        if (!r.ok) throw new Error(r.error);
        return;
      }
      if (cmd.type === 'repair') {
        if (!db) throw new Error(m('repair.needsSrd'));
        if (activeFight(session.current)) throw new Error(m('repair.inFight'));
        let r;
        if (cmd.how === 'smith') {
          const here = getMap(session.current)?.current;
          const smith = opts.shops?.shops.find((s) => s.id === cmd.shopId && s.kind === 'smith');
          if (!smith || smith.locationId !== here) throw new Error(m('repair.noSmith'));
          r = repairAtSmith(hero, cmd.uid, db, session.msgs);
        } else r = mendYourself(hero, cmd.uid, session.msgs);
        if (!r.ok) throw new Error(r.error);
        const before = session.current.time;
        session.current.hero = r.character;
        session.current.time += r.minutes;
        session.addLog('system', r.coins ? m('repair.done', { text: r.text, coins: coins(r.coins) }) : r.text);
        session.timePassed(before);
        return;
      }
      if (!db || !opts.lore || !opts.shops) throw new Error(m('shop.unavailable'));
      const here = getMap(session.current)?.current;
      const shop = opts.shops.shops.find((s) => s.id === cmd.shopId);
      if (!shop || shop.locationId !== here) throw new Error(m('shop.notHere'));
      const sctx = { state: session.current, db, lore: opts.lore, table: opts.shops, msgs: session.msgs };
      if (cmd.type === 'shop_buy') {
        const r = buy(sctx, cmd.shopId, cmd.itemId, cmd.qty);
        if (!r.ok) throw new Error(r.error);
        session.addLog('system', m('shop.bought', { qty: cmd.qty, item: itemName(cmd.itemId, db, session.msgs.lang), coins: coins(-r.coins) }));
      } else if (cmd.type === 'shop_sell') {
        const entry = hero.inventory.find((i) => i.uid === cmd.uid);
        const r = sell(sctx, cmd.shopId, cmd.uid, cmd.qty);
        if (!r.ok) throw new Error(r.error);
        session.addLog('system', m('shop.sold', { qty: cmd.qty, item: entry ? itemName(entry.itemId, db, session.msgs.lang) : m('shop.item'), coins: coins(r.coins) }));
      } else if (cmd.type === 'shop_haggle') {
        const r = haggle({ ...sctx, rng: session.rng }, cmd.shopId);
        if (!r.ok) throw new Error(r.error);
        session.addRoll({ label: r.roll.label, dice: r.roll.d20.rolls, mode: r.roll.mode, modifier: r.roll.total - r.roll.d20.natural, total: r.roll.total, math: r.roll.text, ...(r.roll.success !== undefined && { success: r.roll.success }) });
        session.addLog('system', m(r.success ? 'shop.haggleWon' : 'shop.haggleLost', { shop: shop.name }));
      }
      const view = shopView(sctx, cmd.shopId);
      if (view) session.emit({ type: 'shop', shop: view });
    },
    async choose(session, actionId) {
      if (activeFight(session.current)) throw new Error(session.msgs.m('story.inFight'));
      if (actionId.startsWith('sq:')) return sideQuestChoice(session, actionId);
      const ctx = ctxFor(session);
      const label = availableActions(ctx).find((a) => a.id === actionId)?.label;
      // A picked conversation reply shows as the hero's line.
      if (label && actionId.startsWith(DIALOGUE_PREFIX) && actionId !== LEAVE_TALK) session.addLog('player', label);
      const before = ctx.state.time;
      const r = perform(ctx, actionId);
      await finish(session, ctx, r, label);
      session.timePassed(before);
    },
    async say(session, text) {
      if (activeFight(session.current)) throw new Error(session.msgs.m('story.inFight'));
      session.addLog('player', text);
      const ctx = ctxFor(session);
      const ictx = intentContext(ctx);
      const v = validateIntent(refineIntent(await parse(text, ictx), text, ictx), ictx);
      const before = ctx.state.time;
      const r = resolveIntent(ctx, v, text);
      await finish(session, ctx, r.result, r.playerAction);
      session.timePassed(before);
    },
  };
}

