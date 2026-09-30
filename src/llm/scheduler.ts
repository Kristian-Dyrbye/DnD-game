/**
 * LlmScheduler (A119): one LLM request at a time, by priority. Ollama on a CPU answers one request
 * at a time anyway, so without this, background calls (suggestions, summaries, banter) queued
 * inside Ollama and made the player's narration time out. The scheduler wraps any provider and:
 *  - runs jobs one at a time, highest priority first (narration > intent > combat narration >
 *    suggestions > banter > summary), first come first served within a priority;
 *  - starts a job's timeouts only when it runs (the inner provider is called then);
 *  - drops stale background work: a new suggestion/banter/summary job replaces one of the same
 *    kind still waiting, and a player-facing job drops waiting suggestions and banter;
 *  - preempts a running background chat (suggest/banter/summarize) when a player-facing job
 *    arrives: suggestions and banter are dropped, a summary goes back in the queue.
 * Dropped jobs fail with LlmError('aborted'), which every caller already treats as "use the fallback".
 */
import { LlmError, type ChatMessage, type ChatOptions, type LlmJobKind, type LlmProvider, type LlmStatus } from './types';

/** Lower runs first. */
export const LLM_PRIORITY: Record<LlmJobKind, number> = {
  narrate: 0,
  intent: 1,
  dialogue: 1,
  backstory: 1,
  generic: 1,
  combat_narrate: 2,
  suggest: 3,
  banter: 4,
  summarize: 5,
};

/** Background kinds: preemptible, and only the newest waiting job of a kind is kept. */
const BACKGROUND = new Set<LlmJobKind>(['suggest', 'banter', 'summarize']);
/** Kinds whose waiting jobs a player-facing job makes stale. */
const STALE_ON_PLAYER_ACTION = new Set<LlmJobKind>(['suggest', 'banter']);
/** A preempted summary is re-queued at most this often, then dropped. */
const MAX_REQUEUES = 3;

interface Job {
  kind: LlmJobKind;
  seq: number;
  /** Starts the job; resolves when it no longer holds the slot. */
  start: () => void;
  /** Rejects a waiting job without running it. */
  drop: (reason: string) => void;
  /** Aborts a running background chat (set while it runs). */
  preempt?: () => void;
}

export function jobKind(opts: ChatOptions | undefined): LlmJobKind {
  return opts?.queueAs ?? opts?.task ?? 'generic';
}

export class LlmScheduler implements LlmProvider {
  private waiting: Job[] = [];
  private running: Job | undefined;
  private seq = 0;

  constructor(readonly inner: LlmProvider) {}

  get name(): string {
    return this.inner.name;
  }

  /** Jobs waiting for their turn (not counting the running one). */
  get queued(): LlmJobKind[] {
    return this.sorted().map((j) => j.kind);
  }

  /** The kind of the job holding the slot, if any. */
  get active(): LlmJobKind | undefined {
    return this.running?.kind;
  }

  listModels(): Promise<string[]> {
    return this.inner.listModels();
  }

  status(): Promise<LlmStatus> {
    return this.inner.status();
  }

  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
    const kind = jobKind(opts);
    const preemptible = BACKGROUND.has(kind);
    for (let requeues = 0; ; requeues++) {
      const job = await this.acquire(kind, opts.signal);
      const ctrl = new AbortController();
      let preempted = false;
      if (preemptible) {
        job.preempt = () => {
          preempted = true;
          ctrl.abort();
        };
      }
      const signal = opts.signal ? AbortSignal.any([opts.signal, ctrl.signal]) : ctrl.signal;
      try {
        return await this.inner.chat(messages, { ...opts, signal });
      } catch (err) {
        if (!preempted || opts.signal?.aborted) throw err;
        if (kind !== 'summarize' || requeues >= MAX_REQUEUES) throw new LlmError('aborted', `${kind} preempted by a player action`);
        // A summary is still worth having: back into the queue (the loop acquires again).
      } finally {
        this.release(job);
      }
    }
  }

  async *stream(messages: ChatMessage[], opts: ChatOptions = {}): AsyncIterable<string> {
    const job = await this.acquire(jobKind(opts), opts.signal);
    try {
      yield* this.inner.stream(messages, opts);
    } finally {
      this.release(job);
    }
  }

  /** Waits until this job may run. Rejects if it is dropped or the caller aborts while waiting. */
  private acquire(kind: LlmJobKind, signal?: AbortSignal): Promise<Job> {
    if (signal?.aborted) return Promise.reject(new LlmError('aborted', 'Request aborted'));
    return new Promise<Job>((resolve, reject) => {
      const onAbort = () => {
        this.remove(job);
        reject(new LlmError('aborted', 'Request aborted'));
      };
      const job: Job = {
        kind,
        seq: this.seq++,
        start: () => {
          signal?.removeEventListener('abort', onAbort);
          resolve(job);
        },
        drop: (reason) => {
          signal?.removeEventListener('abort', onAbort);
          reject(new LlmError('aborted', reason));
        },
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.admit(job);
      this.pump();
    });
  }

  private admit(job: Job): void {
    if (BACKGROUND.has(job.kind)) {
      for (const old of this.waiting.filter((j) => j.kind === job.kind)) this.dropWaiting(old, `${job.kind} replaced by a newer one`);
    } else {
      for (const old of this.waiting.filter((j) => STALE_ON_PLAYER_ACTION.has(j.kind))) this.dropWaiting(old, `${old.kind} is stale`);
      if (this.running?.preempt && LLM_PRIORITY[job.kind] < LLM_PRIORITY[this.running.kind]) this.running.preempt();
    }
    this.waiting.push(job);
  }

  private dropWaiting(job: Job, reason: string): void {
    this.remove(job);
    job.drop(reason);
  }

  private remove(job: Job): void {
    this.waiting = this.waiting.filter((j) => j !== job);
  }

  private release(job: Job): void {
    if (this.running === job) this.running = undefined;
    this.pump();
  }

  private pump(): void {
    if (this.running) return;
    const next = this.sorted()[0];
    if (!next) return;
    this.remove(next);
    this.running = next;
    next.start();
  }

  private sorted(): Job[] {
    return [...this.waiting].sort((a, b) => LLM_PRIORITY[a.kind] - LLM_PRIORITY[b.kind] || a.seq - b.seq);
  }
}
