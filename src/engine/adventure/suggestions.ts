/**
 * Suggested action buttons (spec §3/§8). The data-driven list (offered actions and exits) is always
 * available and shown at once. The LLM may then propose 3–5 contextual ideas: ideas that name an
 * offered action become that action's button; others become free-text buttons (sent through
 * intent parsing like typed text). Offered exits and actions are never hidden by the model.
 */
import type { SuggestedAction } from '../../shared/protocol';
import { ENGLISH_MESSAGES, type Messages } from '../i18n';
import type { AvailableAction } from './runner';

export interface SuggestionIdea {
  label: string;
  actionId?: string;
}

/**
 * Max buttons when the model adds ideas. The scene's real options are never dropped: free-text ideas
 * only fill whatever room is left under this cap.
 */
export const MAX_SUGGESTIONS = 7;
const MAX_LABEL = 60;

const button = (a: AvailableAction): SuggestedAction => ({ id: a.id, label: a.check ? `${a.label} (${a.check})` : a.label });

/** Offered actions first (non-exits, then exits), padded with "Look around" when there are fewer than 3. */
export function dataSuggestions(offered: AvailableAction[], msgs: Messages = ENGLISH_MESSAGES): SuggestedAction[] {
  const ordered = [...offered.filter((a) => a.kind !== 'exit'), ...offered.filter((a) => a.kind === 'exit')].map(button);
  if (ordered.length < 3) ordered.push({ id: 'say:look', label: msgs.m('suggest.look'), say: msgs.m('suggest.lookSay') });
  return ordered;
}

/**
 * Merges validated LLM ideas with the offered actions: ideas come first (in the model's order),
 * then any offered action the model left out. Unknown action ids are treated as free text;
 * duplicates and overlong labels are dropped.
 */
export function mergeSuggestions(offered: AvailableAction[], ideas: SuggestionIdea[]): SuggestedAction[] {
  const byId = new Map(offered.map((a) => [a.id, a]));
  const out: SuggestedAction[] = [];
  const seen = new Set<string>();
  const labels = new Set<string>();
  let n = 0;
  // Free-text ideas only use the room the real options leave (every offered action stays).
  let freeRoom = Math.max(0, MAX_SUGGESTIONS - offered.length);
  for (const idea of ideas.slice(0, 5)) {
    const label = idea.label.trim().replace(/\s+/g, ' ');
    if (!label || label.length > MAX_LABEL || labels.has(label.toLowerCase())) continue;
    const real = idea.actionId ? byId.get(idea.actionId) : undefined;
    if (real) {
      if (seen.has(real.id)) continue;
      seen.add(real.id);
      out.push(button(real));
    } else {
      if (freeRoom <= 0) continue;
      freeRoom--;
      out.push({ id: `say:${n++}`, label, say: label });
    }
    labels.add(label.toLowerCase());
  }
  for (const a of dataSuggestions(offered)) if (!seen.has(a.id) && !a.say) out.push(a);
  return out;
}
