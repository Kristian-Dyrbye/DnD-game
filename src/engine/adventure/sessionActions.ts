/**
 * Connects the scene runner to a GameSession (its ActionPort): choices and free text (intent parser →
 * validateIntent → resolveIntent) are resolved by the engine, rolls are shown, then the facts are
 * narrated (streamed LLM or template). Until combat (A068) exists, encounters auto-resolve as wins.
 */
import type { SrdDatabase } from '../data/srd';
import type { FlagRegistry } from '../world/flags';
import type { ActionPort, GameSession } from '../session/GameSession';
import { availableActions, getProgress, type AvailableAction, perform, resolveEncounter, startAdventure, type RunContext, type StepResult } from './runner';
import type { Adventure } from './schema';
import { intentContext, keywordIntent, validateIntent, type Intent, type IntentContext } from './intent';
import { narrateInto, type Narrator } from './narration';
import { currentObjective } from './quests';
import { resolveIntent } from './resolve';
import { dataSuggestions, mergeSuggestions, type SuggestionIdea } from './suggestions';
import { updateSummary, type Summarizer } from './summary';

export interface AdventurePortOptions {
  /** Free text → Intent (the LLM parser on the server). Defaults to the keyword parser. */
  parseIntent?: (text: string, ictx: IntentContext) => Promise<Intent>;
  /** Streams narration (the LLM on the server). Without it, template narration is used. */
  narrator?: Narrator;
  /** Contextual action ideas (the LLM). Without it, only the data-driven buttons are shown. */
  suggester?: (ctx: RunContext, offered: AvailableAction[]) => Promise<SuggestionIdea[]>;
  /** Condenses the story after each scene (the LLM). Without it, the template summary is used. */
  summarizer?: Summarizer;
  /** Flag types/defaults/bounds. */
  flags?: FlagRegistry;
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
    const id = getProgress(session.current)?.adventureId ?? defaultId;
    const adventure = adventures.get(id);
    if (!adventure) throw new Error(`Adventure "${id}" is not installed`);
    return { state: session.current, adventure, rng: session.rng, ...(db && { db }), ...(opts.flags && { flags: opts.flags }) };
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
    if (r.items.length || r.coins) session.addLog('system', `Received: ${[...r.items.map((i) => `${i.quantity}× ${i.itemId.replace(/_/g, ' ')}`), ...(r.coins ? [formatCoins(r.coins)] : [])].join(', ')}`);
    if (r.xp) session.addLog('system', `+${r.xp} XP`);
    if (r.ending) {
      const end = ctx.adventure.endings.find((e) => e.id === r.ending);
      session.addLog('narration', end?.text ?? 'The adventure ends.');
    }
    if (r.encounter) {
      const name = ctx.adventure.encounters.find((e) => e.id === r.encounter)?.name ?? r.encounter;
      session.addLog('system', `Encounter: ${name}. (Tactical combat arrives in a later build; the fight is resolved as a victory.)`);
      await publish(session, ctx, resolveEncounter(ctx, r.encounter, 'win'));
    }
  };

  // Data-driven buttons at once; LLM ideas replace them when they arrive, unless the player has
  // acted in the meantime (the log moved on). Never awaited, so it never slows a turn down.
  const offer = (session: GameSession, ctx: RunContext) => {
    session.emit({ type: 'objective', text: currentObjective(ctx) ?? null });
    const offered = availableActions(ctx);
    session.suggest(dataSuggestions(offered));
    if (!opts.suggester || offered.length === 0) return;
    const stamp = session.current.nextId;
    pendingIdeas = opts
      .suggester(ctx, offered)
      .then((ideas) => {
        if (ideas.length && session.running && session.current.nextId === stamp) session.suggest(mergeSuggestions(offered, ideas));
      })
      .catch(() => undefined);
  };

  const finish = async (session: GameSession, ctx: RunContext, r: StepResult, playerAction?: string) => {
    await publish(session, ctx, r, playerAction);
    offer(session, ctx);
    if (r.entered.length) {
      session.autosave();
      // Condense the finished scene in the background (chained so updates never overlap).
      const state = session.current;
      pendingSummary = pendingSummary.then(() => updateSummary(state, opts.summarizer)).catch(() => undefined);
    }
  };

  return {
    idle: async () => {
      await pendingIdeas;
      await pendingSummary;
    },
    async begin(session) {
      const ctx = ctxFor(session);
      if (!getProgress(session.current)) await publish(session, ctx, startAdventure(ctx));
      else await narrateInto(session, { kind: 'scene', facts: [], ctx }, opts.narrator);
      offer(session, ctx);
    },
    async choose(session, actionId) {
      const ctx = ctxFor(session);
      const label = availableActions(ctx).find((a) => a.id === actionId)?.label;
      const before = ctx.state.time;
      const r = perform(ctx, actionId);
      await finish(session, ctx, r, label);
      session.timePassed(before);
    },
    async say(session, text) {
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

function formatCoins(cp: number): string {
  const gp = Math.floor(cp / 100);
  const sp = Math.floor((cp % 100) / 10);
  const c = cp % 10;
  return [gp && `${gp} gp`, sp && `${sp} sp`, c && `${c} cp`].filter(Boolean).join(' ');
}
