/**
 * Rolling story summary (spec §3): after each scene change, the story log entries since the last
 * summary are condensed into `state.summary`, which prompts use instead of a long transcript.
 * The condensing is done by an injected Summarizer (the LLM); if it is missing or fails, a
 * deterministic template keeps the first sentence of each new narration line.
 */
import { ENGLISH_MESSAGES, type Messages } from '../i18n';
import type { GameState, LogEntry } from '../session/gameState';
import type { Language } from '../../shared/i18nCore';

/** (previous summary, new story lines, session language) → new summary in that language. */
export type Summarizer = (previous: string, lines: string[], lang?: Language) => Promise<string>;

export const SUMMARY_MAX_CHARS = 1500;

export function linesSince(state: GameState, msgs: Messages = ENGLISH_MESSAGES): { lines: string[]; lastId: number } {
  const { m } = msgs;
  const fresh = state.log.filter((e) => e.id > state.summaryUpTo && (e.kind === 'narration' || e.kind === 'player' || e.kind === 'dialogue'));
  const label = (e: LogEntry) => (e.kind === 'player' ? m('summary.hero', { text: e.text }) : e.kind === 'dialogue' ? `${e.speaker ?? m('summary.someone')}: ${e.text}` : e.text);
  return { lines: fresh.map(label), lastId: state.log.at(-1)?.id ?? state.summaryUpTo };
}

function firstSentence(text: string): string {
  const m = /^[\s\S]*?[.!?](\s|$)/.exec(text.trim());
  return (m ? m[0] : text).trim();
}

/** Template summary: previous text + one sentence per new line, trimmed from the front to the cap. */
export function templateSummary(previous: string, lines: string[]): string {
  const sentences = [previous, ...lines.map(firstSentence)].filter(Boolean).join(' ');
  return clampSummary(sentences);
}

/** Keeps the most recent part of an over-long summary, starting at a sentence boundary. */
export function clampSummary(text: string, max = SUMMARY_MAX_CHARS): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const tail = t.slice(t.length - max);
  const cut = tail.search(/[.!?]\s/);
  return cut >= 0 ? tail.slice(cut + 2) : tail;
}

/** Folds new log lines into the summary. Never throws; a bad summarizer result falls back to the template. */
export async function updateSummary(state: GameState, summarizer?: Summarizer, msgs: Messages = ENGLISH_MESSAGES): Promise<void> {
  const { lines, lastId } = linesSince(state, msgs);
  if (lines.length === 0) {
    state.summaryUpTo = lastId;
    return;
  }
  const previous = state.summary;
  let next = '';
  if (summarizer) {
    try {
      next = (await summarizer(previous, lines, msgs.lang)).trim();
    } catch {
      next = '';
    }
    if (next.length < 20 || next.length > SUMMARY_MAX_CHARS * 2) next = '';
  }
  state.summary = next ? clampSummary(next) : templateSummary(previous, lines);
  state.summaryUpTo = lastId;
}
