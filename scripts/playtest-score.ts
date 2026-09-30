/**
 * Probe scoring for the real-model playtest (A122): scores a free-text probe the way the game
 * handles it (sessionActions.say: validateIntent(refineIntent(parse(...)))), not by the raw LLM
 * reply alone. A missing or invalid LLM reply falls back to the keyword parser, like the game.
 */
import { IntentSchema, keywordIntent, refineIntent, validateIntent, type Intent, type IntentContext } from '../src/engine/adventure/intent';

export interface ProbeScore {
  /** The model's reply, parsed if it was JSON (null when there was no intent call). */
  raw: unknown;
  /** The intent after refineIntent + validateIntent. */
  refined: Intent;
  /** Action the game performs, if any. */
  actionId?: string;
  /** Did the raw reply alone name an expected action? null when the probe expects nothing. */
  rawUnderstood: boolean | null;
  /** Did the game end up on an expected action? null when the probe expects nothing. */
  understood: boolean | null;
}

export function scoreProbe(reply: string | undefined, text: string, ictx: IntentContext, expect: readonly string[]): ProbeScore {
  let raw: unknown = null;
  if (reply !== undefined) {
    try {
      raw = JSON.parse(reply);
    } catch {
      raw = reply;
    }
  }
  const parsed = IntentSchema.safeParse(raw);
  const intent = parsed.success ? parsed.data : keywordIntent(text, ictx);
  const v = validateIntent(refineIntent(intent, text, ictx), ictx);
  const rawId = (raw as { actionId?: unknown } | null)?.actionId;
  const scored = (id: unknown) => (expect.length ? typeof id === 'string' && expect.includes(id) : null);
  return { raw, refined: v.intent, ...(v.actionId && { actionId: v.actionId }), rawUnderstood: scored(rawId), understood: scored(v.actionId) };
}
