/**
 * Combat narration (spec §10): attacks and kills are narrated briefly and in the background, so a
 * fight never waits on the model. The player picks the frequency (settings.llm.combatNarration):
 * - 'every': each player action and each enemy/ally turn gets a line;
 * - 'key': only key moments — critical hits, someone dropping or dying, the fight starting/ending;
 * - 'off': nothing (the combat log still has every roll).
 *
 * `combatMoments` turns new combat-log lines (the engine's math lines) into short facts.
 * `CombatNarrationQueue` runs narration jobs one at a time and keeps at most one waiting (newer
 * moments replace an older waiting job), so a slow model can't build up a backlog.
 */
import type { GameSession } from '../session/GameSession';
import { narrateInto, type NarrationJob, type Narrator } from './narration';

export type CombatNarrationMode = 'every' | 'key' | 'off';

export interface CombatMoment {
  key: boolean;
  fact: string;
}

const NUMBERS = /\s*\(?\b(?:d20|DC|AC)\b[^—]*|\[[^\]]*\]|\d+d\d+(?:[+-]\d+)?|=\s*\d+/g;

/** "Ogre attacks Sabine with Greatclub: d20 … — Critical Hit" → facts without the numbers. */
export function combatMoments(lines: readonly string[]): CombatMoment[] {
  const out: CombatMoment[] = [];
  for (const line of lines) {
    let m: RegExpExecArray | null;
    if ((m = /^(.+?) takes \d+ .*— dies!/.exec(line))) out.push({ key: true, fact: `${m[1]} is slain.` });
    else if ((m = /^(.+?) takes \d+ .*— falls unconscious!/.exec(line))) out.push({ key: true, fact: `${m[1]} falls, unconscious.` });
    else if ((m = /^(.+?) attacks (.+?) with (.+?):.*— Critical Hit/.exec(line))) out.push({ key: true, fact: `${m[1]} lands a critical hit on ${m[2]} with ${m[3]}.` });
    else if ((m = /^(.+?) attacks (.+?) with (.+?):.*— Hit/.exec(line))) out.push({ key: false, fact: `${m[1]} hits ${m[2]} with ${m[3]}.` });
    else if ((m = /^(.+?) attacks (.+?) with (.+?):.*— Miss/.exec(line))) out.push({ key: false, fact: `${m[1]} swings at ${m[2]} with ${m[3]} and misses.` });
    else if ((m = /^(.+?) casts (.+?)(?: \(level \d+\))?$/.exec(line))) out.push({ key: false, fact: `${m[1]} casts ${m[2]}.` });
    else if (line === 'Victory!') out.push({ key: true, fact: 'The last foe falls: the fight is won.' });
    else if (line === 'Defeat…') out.push({ key: true, fact: 'The party is overwhelmed.' });
    else if (line === 'Roll for initiative!') out.push({ key: true, fact: 'Steel is drawn: the fight begins.' });
  }
  return out.map((x) => ({ ...x, fact: x.fact.replace(NUMBERS, '').replace(/\s{2,}/g, ' ') }));
}

/** Facts worth narrating for this mode (max 4, in order). */
export function pickMoments(lines: readonly string[], mode: CombatNarrationMode): string[] {
  if (mode === 'off') return [];
  const all = combatMoments(lines);
  const chosen = mode === 'key' ? all.filter((m) => m.key) : all;
  return chosen.slice(-4).map((m) => m.fact);
}

/** Short template line for a combat job (used when the model is off or fails). */
export function combatTemplate(facts: readonly string[]): string {
  return facts.join(' ');
}

interface Pending {
  session: GameSession;
  job: NarrationJob;
}

/** Runs combat narration in the background: one at a time, at most one waiting. */
export class CombatNarrationQueue {
  private running: Promise<void> | undefined;
  private pending: Pending | undefined;

  constructor(private readonly narrator?: Narrator) {}

  /** Queue a job; returns immediately. */
  push(session: GameSession, job: NarrationJob): void {
    this.pending = { session, job };
    if (!this.running) this.running = this.drain();
  }

  /** Resolves when everything queued so far has been narrated (tests, shutdown). */
  async idle(): Promise<void> {
    while (this.running) await this.running;
  }

  private async drain(): Promise<void> {
    try {
      while (this.pending) {
        const { session, job } = this.pending;
        this.pending = undefined;
        await narrateInto(session, job, this.narrator).catch(() => undefined);
      }
    } finally {
      this.running = undefined;
    }
  }
}
