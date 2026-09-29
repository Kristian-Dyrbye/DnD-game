/**
 * Connects the scene runner to a GameSession (its ActionPort): choices and free text (intent parser →
 * validateIntent → resolveIntent) are resolved by the engine, rolls are shown, then the facts are
 * narrated (streamed LLM or template). Until combat (A068) exists, encounters auto-resolve as wins.
 */
import type { SrdDatabase } from '../data/srd';
import type { ActionPort, GameSession } from '../session/GameSession';
import { availableActions, getProgress, perform, resolveEncounter, startAdventure, type RunContext, type StepResult } from './runner';
import type { Adventure } from './schema';
import { intentContext, keywordIntent, validateIntent, type Intent, type IntentContext } from './intent';
import { narrateInto, type Narrator } from './narration';
import { resolveIntent } from './resolve';

export interface AdventurePortOptions {
  /** Free text → Intent (the LLM parser on the server). Defaults to the keyword parser. */
  parseIntent?: (text: string, ictx: IntentContext) => Promise<Intent>;
  /** Streams narration (the LLM on the server). Without it, template narration is used. */
  narrator?: Narrator;
}

export function adventureActionPort(adventures: ReadonlyMap<string, Adventure>, defaultId: string, db?: SrdDatabase, opts: AdventurePortOptions = {}): ActionPort {
  const parse = opts.parseIntent ?? (async (text: string, ictx: IntentContext) => keywordIntent(text, ictx));
  const ctxFor = (session: GameSession): RunContext => {
    const id = getProgress(session.current)?.adventureId ?? defaultId;
    const adventure = adventures.get(id);
    if (!adventure) throw new Error(`Adventure "${id}" is not installed`);
    return { state: session.current, adventure, rng: session.rng, ...(db && { db }) };
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

  const offer = (session: GameSession, ctx: RunContext) => {
    session.suggest(availableActions(ctx).map((a) => ({ id: a.id, label: a.check ? `${a.label} (${a.check})` : a.label })));
  };

  const finish = async (session: GameSession, ctx: RunContext, r: StepResult, playerAction?: string) => {
    await publish(session, ctx, r, playerAction);
    offer(session, ctx);
    if (r.entered.length) session.autosave();
  };

  return {
    async begin(session) {
      const ctx = ctxFor(session);
      if (!getProgress(session.current)) await publish(session, ctx, startAdventure(ctx));
      else await narrateInto(session, { kind: 'scene', facts: [], ctx }, opts.narrator);
      offer(session, ctx);
    },
    async choose(session, actionId) {
      const ctx = ctxFor(session);
      const label = availableActions(ctx).find((a) => a.id === actionId)?.label;
      await finish(session, ctx, perform(ctx, actionId), label);
    },
    async say(session, text) {
      session.addLog('player', text);
      const ctx = ctxFor(session);
      const ictx = intentContext(ctx);
      const v = validateIntent(await parse(text, ictx), ictx);
      const r = resolveIntent(ctx, v, text);
      await finish(session, ctx, r.result, r.playerAction);
    },
  };
}

function formatCoins(cp: number): string {
  const gp = Math.floor(cp / 100);
  const sp = Math.floor((cp % 100) / 10);
  const c = cp % 10;
  return [gp && `${gp} gp`, sp && `${sp} sp`, c && `${c} cp`].filter(Boolean).join(' ');
}
