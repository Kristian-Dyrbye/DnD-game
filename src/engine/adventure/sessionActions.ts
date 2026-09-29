/**
 * Connects the scene runner to a GameSession (its ActionPort). Until narration (A057), intent
 * parsing (A055) and combat (A068) exist, scene text and fixed facts are logged as-is, free text is
 * matched against action labels/keywords, and encounters are auto-resolved as victories.
 */
import type { SrdDatabase } from '../data/srd';
import type { ActionPort, GameSession } from '../session/GameSession';
import { availableActions, describeScene, getProgress, perform, resolveEncounter, startAdventure, type RunContext, type StepResult } from './runner';
import type { Adventure } from './schema';
import { allScenes } from './validate';

export function adventureActionPort(adventures: ReadonlyMap<string, Adventure>, defaultId: string, db?: SrdDatabase): ActionPort {
  const ctxFor = (session: GameSession): RunContext => {
    const id = getProgress(session.current)?.adventureId ?? defaultId;
    const adventure = adventures.get(id);
    if (!adventure) throw new Error(`Adventure "${id}" is not installed`);
    return { state: session.current, adventure, rng: session.rng, ...(db && { db }) };
  };

  const publish = (session: GameSession, ctx: RunContext, r: StepResult) => {
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
    // Facts first, then the new scene's description (onEnter facts belong to the arrival).
    for (const f of r.facts) session.addLog('narration', f);
    if (r.entered.length) sceneText(session, ctx);
    if (r.items.length || r.coins) session.addLog('system', `Received: ${[...r.items.map((i) => `${i.quantity}× ${i.itemId.replace(/_/g, ' ')}`), ...(r.coins ? [formatCoins(r.coins)] : [])].join(', ')}`);
    if (r.xp) session.addLog('system', `+${r.xp} XP`);
    if (r.ending) {
      const end = ctx.adventure.endings.find((e) => e.id === r.ending);
      session.addLog('narration', end?.text ?? 'The adventure ends.');
    }
    if (r.encounter) {
      const name = ctx.adventure.encounters.find((e) => e.id === r.encounter)?.name ?? r.encounter;
      session.addLog('system', `Encounter: ${name}. (Tactical combat arrives in a later build; the fight is resolved as a victory.)`);
      publish(session, ctx, resolveEncounter(ctx, r.encounter, 'win'));
    }
  };

  const sceneText = (session: GameSession, ctx: RunContext) => {
    const d = describeScene(ctx);
    session.addLog('narration', [d.seed, ...d.pois.map((p) => p.seed), ...(d.npcs.length ? [`Here: ${d.npcs.join(', ')}.`] : [])].join(' '));
  };

  const offer = (session: GameSession, ctx: RunContext) => {
    session.suggest(availableActions(ctx).map((a) => ({ id: a.id, label: a.check ? `${a.label} (${a.check})` : a.label })));
  };

  const run = (session: GameSession, actionId: string) => {
    const ctx = ctxFor(session);
    const r = perform(ctx, actionId);
    publish(session, ctx, r);
    offer(session, ctx);
    if (r.entered.length) session.autosave();
  };

  return {
    async begin(session) {
      const ctx = ctxFor(session);
      if (!getProgress(session.current)) publish(session, ctx, startAdventure(ctx));
      else sceneText(session, ctx);
      offer(session, ctx);
    },
    async choose(session, actionId) {
      run(session, actionId);
    },
    async say(session, text) {
      session.addLog('player', text);
      const ctx = ctxFor(session);
      const match = matchFreeText(ctx, text);
      if (match) run(session, match);
      else {
        session.addLog('system', 'Nothing obvious comes of that. Try one of the suggested actions.');
        offer(session, ctx);
      }
    },
  };
}

/** Best available action for free text: most keyword/label word hits (ties → first). */
export function matchFreeText(ctx: RunContext, text: string): string | undefined {
  const words = new Set(text.toLowerCase().match(/[a-z']+/g) ?? []);
  const scenes = allScenes(ctx.adventure);
  let best: { id: string; score: number } | undefined;
  for (const a of availableActions(ctx)) {
    const scene = scenes.find((s) => s.id === ctx.state.location.sceneId);
    const [poi, sub] = a.id.split('.', 2);
    const def = a.kind === 'poi' ? scene?.pois.find((p) => p.id === poi)?.actions.find((x) => x.id === sub) : a.kind === 'action' ? scene?.actions.find((x) => x.id === a.id) : undefined;
    const vocab = [...(def?.keywords ?? []), ...a.label.toLowerCase().split(/\W+/).filter((w) => w.length > 3)];
    const score = vocab.filter((k) => words.has(k.toLowerCase())).length;
    if (score > 0 && (!best || score > best.score)) best = { id: a.id, score };
  }
  return best?.id;
}

function formatCoins(cp: number): string {
  const gp = Math.floor(cp / 100);
  const sp = Math.floor((cp % 100) / 10);
  const c = cp % 10;
  return [gp && `${gp} gp`, sp && `${sp} sp`, c && `${c} cp`].filter(Boolean).join(' ');
}
