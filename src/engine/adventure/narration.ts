/**
 * Narration step (spec §3): after the engine has resolved an action, the facts are narrated.
 * A Narrator (the LLM, injected by the server) streams prose; each chunk goes to the client as a
 * `narration` event and the finished text becomes one log entry. If there is no narrator, or it
 * fails or returns nothing, template narration built from the scene seed and the fixed facts is
 * used instead, so the game never stalls on the model.
 */
import type { GameSession } from '../session/GameSession';
import { describeScene, type RunContext } from './runner';

export interface NarrationJob {
  /** 'combat': brief background narration of combat moments (A069). */
  kind: 'scene' | 'outcome' | 'combat';
  playerAction?: string;
  /** Fixed facts, in order. */
  facts: string[];
  /** Index in `facts` where the scene arrival starts (scene jobs). */
  arrivalIndex?: number;
  ctx: RunContext;
}

/** Streams narration text for a job. Throwing or yielding nothing triggers the template. */
export type Narrator = (job: NarrationJob, signal?: AbortSignal) => AsyncIterable<string>;

/** Deterministic narration from data: facts on the way, the scene description, then arrival facts. */
export function templateNarration(job: NarrationJob): string {
  if (job.kind === 'outcome' || job.kind === 'combat') return job.facts.join(' ') || 'Nothing much happens.';
  const d = describeScene(job.ctx);
  const scene = [d.seed, ...d.pois.map((p) => p.seed), ...(d.npcs.length ? [`Here: ${d.npcs.join(', ')}.`] : [])].join(' ');
  const cut = job.arrivalIndex ?? 0;
  return [...job.facts.slice(0, cut), scene, ...job.facts.slice(cut)].join(' ');
}

/** Narrates a job into the session's story log (streaming if a narrator is given). Returns the text. */
export async function narrateInto(session: GameSession, job: NarrationJob, narrator?: Narrator): Promise<string> {
  const id = session.reserveId();
  let text = '';
  if (narrator) {
    let started = false;
    try {
      for await (const chunk of narrator(job)) {
        if (!started) {
          session.emit({ type: 'narration', phase: 'start', entryId: id, text: '' });
          started = true;
        }
        text += chunk;
        session.emit({ type: 'narration', phase: 'chunk', entryId: id, text: chunk });
      }
    } catch {
      text = '';
    }
    if (started) session.emit({ type: 'narration', phase: 'end', entryId: id, text: '' });
  }
  text = cleanNarration(text);
  if (!text) text = templateNarration(job);
  session.addLog('narration', text, undefined, id);
  return text;
}

/** Strips reasoning blocks and markdown clutter small models sometimes add. */
export function cleanNarration(raw: string): string {
  return raw
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^#+\s.*$/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
