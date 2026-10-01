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
import { narrateInto, type NarrationJob, type NarrationSink, type Narrator } from './narration';
import { ENGLISH_MESSAGES, messages, type Messages } from '../i18n';
import { LANGUAGES, type Language } from '../../shared/i18nCore';

export type CombatNarrationMode = 'every' | 'key' | 'off';

export interface CombatMoment {
  key: boolean;
  fact: string;
}

const NUMBERS = /\s*\(?\b(?:d20|DC|AC|SG|RK)\b[^—]*|\[[^\]]*\]|\d+d\d+(?:[+-]\d+)?|=\s*\d+/g;

/** A catalog text as a regex: `{name}` → a lazy group (`{n}`/`{level}` → digits); anchored at the start. */
function templateRegex(text: string, end: boolean): RegExp {
  const body = text
    .split(/(\{\w+\})/)
    .map((part) => (/^\{(n|level)\}$/.test(part) ? '\\d+' : /^\{\w+\}$/.test(part) ? '(.+?)' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('');
  return new RegExp(`^${body}${end ? '$' : ''}`);
}

/** The fixed start of an outcome text ("Critical Hit!" / "Critical Hit ({reason})" → "Critical Hit"). */
const head = (text: string) => text.split(/[({!]/)[0]!.trim();

interface Patterns {
  takes: RegExp[];
  attack: RegExp;
  casts: RegExp[];
  dies: string;
  down: string;
  crit: string;
  hit: string;
  miss: string;
  victory: string;
  defeat: string;
  start: string;
}

const patternCache = new Map<Language, Patterns>();

/** Line patterns built from one language's catalog (the log keeps the language each line was written in). */
function patternsFor(lang: Language): Patterns {
  const hit = patternCache.get(lang);
  if (hit) return hit;
  const { m } = messages(lang);
  const made: Patterns = {
    takes: [templateRegex(m('combat.takes'), false), templateRegex(m('combat.takesHalf'), false)],
    attack: templateRegex(m('combat.attack'), false),
    casts: [templateRegex(m('combat.castsLevel'), true), templateRegex(m('combat.castsRitual'), true), templateRegex(m('combat.casts'), true)],
    dies: `— ${m('combat.dies')}`,
    down: `— ${m('combat.fallsUnconscious')}`,
    crit: `— ${head(m('roll.crit'))}`,
    hit: `— ${head(m('roll.hit'))}`,
    miss: `— ${head(m('roll.miss'))}`,
    victory: m('combat.victory'),
    defeat: m('combat.defeat'),
    start: m('combat.initiative'),
  };
  patternCache.set(lang, made);
  return made;
}

function momentOf(line: string, p: Patterns, { m }: Messages): CombatMoment | undefined {
  let r: RegExpExecArray | null | undefined;
  if ((r = p.takes.map((x) => x.exec(line)).find(Boolean))) {
    if (line.includes(p.dies)) return { key: true, fact: m('moment.slain', { name: r[1]! }) };
    if (line.includes(p.down)) return { key: true, fact: m('moment.down', { name: r[1]! }) };
    return undefined;
  }
  if ((r = p.attack.exec(line))) {
    const names = { attacker: r[1]!, target: r[2]!, weapon: r[3]! };
    if (line.includes(p.crit)) return { key: true, fact: m('moment.crit', names) };
    if (line.includes(p.hit)) return { key: false, fact: m('moment.hit', names) };
    if (line.includes(p.miss)) return { key: false, fact: m('moment.miss', names) };
    return undefined;
  }
  if ((r = p.casts.map((x) => x.exec(line)).find(Boolean))) return { key: false, fact: m('moment.casts', { caster: r[1]!, spell: r[2]! }) };
  if (line === p.victory) return { key: true, fact: m('moment.victory') };
  if (line === p.defeat) return { key: true, fact: m('moment.defeat') };
  if (line === p.start) return { key: true, fact: m('moment.start') };
  return undefined;
}

/**
 * "Ogre attacks Sabine with Greatclub: d20 … — Critical Hit" → facts without the numbers, in `msgs`'
 * language. Lines are recognised by the catalog texts of every language (not English regexes), so
 * a fight logged in Danish (or switched mid-fight) is still narrated.
 */
export function combatMoments(lines: readonly string[], msgs: Messages = ENGLISH_MESSAGES): CombatMoment[] {
  const out: CombatMoment[] = [];
  const order = [msgs.lang, ...LANGUAGES.filter((l) => l !== msgs.lang)].map(patternsFor);
  for (const line of lines) {
    for (const p of order) {
      const found = momentOf(line, p, msgs);
      if (found) {
        out.push(found);
        break;
      }
    }
  }
  return out.map((x) => ({ ...x, fact: x.fact.replace(NUMBERS, '').replace(/\s{2,}/g, ' ') }));
}

/** Facts worth narrating for this mode (max 4, in order). */
export function pickMoments(lines: readonly string[], mode: CombatNarrationMode, msgs: Messages = ENGLISH_MESSAGES): string[] {
  if (mode === 'off') return [];
  const all = combatMoments(lines, msgs);
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
/** How long a fight's end waits for a narrator that ignores the abort before its late output is dropped. */
export const SETTLE_TIMEOUT_MS = 2000;

export class CombatNarrationQueue {
  private running: Promise<void> | undefined;
  private pending: Pending | undefined;
  private current: { ctrl: AbortController; guard: { alive: boolean } } | undefined;
  private generation = 0;
  private settling = false;

  constructor(
    private readonly narrator?: Narrator,
    private readonly settleTimeoutMs = SETTLE_TIMEOUT_MS,
  ) {}

  /** Queue a job; returns immediately. */
  push(session: GameSession, job: NarrationJob): void {
    this.pending = { session, job };
    if (!this.running) this.running = this.drain();
  }

  /** Resolves when everything queued so far has been narrated (tests, shutdown). */
  async idle(): Promise<void> {
    while (this.running) await this.running;
  }

  /**
   * Fight over: stops the model mid-stream (the complete sentences so far are kept) and narrates the
   * waiting job from its facts, so no combat line lands after the victory/defeat line. A narrator
   * that ignores the abort is given settleTimeoutMs, then its late output is dropped.
   */
  async settle(): Promise<void> {
    this.settling = true;
    try {
      this.current?.ctrl.abort();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<'timeout'>((resolve) => (timer = setTimeout(() => resolve('timeout'), this.settleTimeoutMs)));
      const result = await Promise.race([this.idle().then(() => 'idle' as const), timeout]);
      clearTimeout(timer);
      if (result === 'timeout') this.orphan();
    } finally {
      this.settling = false;
    }
  }

  /** Abandons the stuck job: its late output is dropped and the queue starts afresh. */
  private orphan(): void {
    if (this.current) this.current.guard.alive = false;
    this.generation++;
    this.current = undefined;
    this.pending = undefined;
    this.running = undefined;
  }

  private async drain(): Promise<void> {
    const gen = this.generation;
    try {
      while (this.pending && gen === this.generation) {
        const { session, job } = this.pending;
        this.pending = undefined;
        const ctrl = new AbortController();
        if (this.settling) ctrl.abort();
        const guard = { alive: true };
        this.current = { ctrl, guard };
        await narrateInto(guarded(session, guard), job, this.narrator, ctrl.signal).catch(() => undefined);
      }
    } finally {
      if (gen === this.generation) {
        this.current = undefined;
        this.running = undefined;
      }
    }
  }
}

/** The session, or silence once the guard is dead (an orphaned job must not write after the fight). */
function guarded(session: GameSession, guard: { alive: boolean }): NarrationSink {
  return {
    reserveId: () => session.reserveId(),
    emit: (e) => {
      if (guard.alive) session.emit(e);
    },
    addLog: (kind, text, speaker, id) => (guard.alive ? session.addLog(kind, text, speaker, id) : { id: id ?? -1, kind, text, ...(speaker !== undefined && { speaker }) }),
  };
}
