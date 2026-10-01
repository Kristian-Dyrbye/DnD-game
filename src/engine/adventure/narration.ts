/**
 * Narration step (spec §3): after the engine has resolved an action, the facts are narrated.
 * A Narrator (the LLM, injected by the server) streams prose; each chunk goes to the client as a
 * `narration` event and the finished text becomes one log entry. A reply cut short keeps its
 * complete sentences. If there is no narrator, or it fails before a full sentence or returns
 * nothing, template narration built from the scene seed and the fixed facts is used instead, so
 * the game never stalls on the model.
 */
import { ENGLISH_MESSAGES } from '../i18n';
import type { GameSession } from '../session/GameSession';
import { describeScene, type RunContext } from './runner';

export interface NarrationJob {
  /** 'combat': brief background narration of combat moments (A069). */
  kind: 'scene' | 'outcome' | 'combat';
  playerAction?: string;
  /** Name of the extra hero (co-op/duo) who took the action; absent = the main hero ("you"). */
  actor?: string;
  /** Fixed facts, in order. */
  facts: string[];
  /** Index in `facts` where the scene arrival starts (scene jobs). */
  arrivalIndex?: number;
  /** Scene jobs: first arrival, a return to a visited scene, or resuming a loaded game in place. */
  visit?: NarrationVisit;
  ctx: RunContext;
}

export type NarrationVisit = 'first' | 'return' | 'resume';

/** Streams narration text for a job. Throwing or yielding nothing triggers the template. */
export type Narrator = (job: NarrationJob, signal?: AbortSignal) => AsyncIterable<string>;

/** Where narration lands: the session, or a guard around it that can drop late output. */
export type NarrationSink = Pick<GameSession, 'reserveId' | 'emit' | 'addLog'>;

/**
 * Deterministic narration from data: facts on the way, the scene description, then arrival facts.
 * An action taken by an extra hero opens with a line naming them (authored facts say "you").
 */
export function templateNarration(job: NarrationJob): string {
  const { m } = job.ctx.msgs ?? ENGLISH_MESSAGES;
  if (job.kind === 'combat') return job.facts.join(' ') || m('tpl.nothingHappens');
  const who = job.actor ? [m('tpl.actorActs', { name: job.actor })] : [];
  if (job.kind === 'outcome') return [...who, ...job.facts].join(' ') || m('tpl.nothingHappens');
  const d = describeScene(job.ctx, job.visit);
  const scene = [d.seed, ...d.pois.map((p) => p.seed), ...(d.npcs.length ? [m('tpl.here', { list: d.npcs.join(', ') })] : [])].join(' ');
  const cut = job.arrivalIndex ?? 0;
  return [...who, ...job.facts.slice(0, cut), scene, ...job.facts.slice(cut)].join(' ');
}

/**
 * Narrates a job into the session's story log (streaming if a narrator is given). Returns the text.
 * An aborted `signal` stops the stream (the complete sentences so far are kept) or, before it
 * started, skips the model and logs the template text.
 */
export async function narrateInto(session: NarrationSink, job: NarrationJob, narrator?: Narrator, signal?: AbortSignal): Promise<string> {
  const id = session.reserveId();
  let text = '';
  if (narrator && !signal?.aborted) {
    let started = false;
    let failed = false;
    try {
      for await (const chunk of narrator(job, signal)) {
        if (signal?.aborted) throw new Error('aborted');
        if (!started) {
          session.emit({ type: 'narration', phase: 'start', entryId: id, text: '' });
          started = true;
        }
        text += chunk;
        session.emit({ type: 'narration', phase: 'chunk', entryId: id, text: chunk });
      }
    } catch {
      failed = true;
    }
    if (started) session.emit({ type: 'narration', phase: 'end', entryId: id, text: '' });
    // A reply cut off (timeout or token limit) keeps its whole sentences; the client replaces the
    // streamed text with the logged entry.
    text = failed ? wholeSentences(cleanNarration(text)) : dropTrailingFragment(cleanNarration(text));
  }
  if (!text) text = templateNarration(job);
  session.addLog('narration', text, undefined, id);
  return text;
}

const SENTENCE_END = /[.!?…]["'”’)\]]*(?=\s|$)/g;

/** The text up to its last complete sentence ('' when there is none). */
export function wholeSentences(text: string): string {
  let end = 0;
  for (const m of text.matchAll(SENTENCE_END)) end = m.index + m[0].length;
  return text.slice(0, end).trim();
}

/** Drops an unfinished last sentence (a reply stopped by the token limit); text without any sentence end stays. */
export function dropTrailingFragment(text: string): string {
  return wholeSentences(text) || text;
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
