/**
 * Background TTS narration queue (spec §13): narration and dialogue lines are synthesized one at a
 * time in the background and kept in a small cache; the game never waits for speech. When lines
 * arrive faster than they can be spoken, the oldest pending ones are dropped (the player reads
 * ahead anyway). Failures just mean "no audio" for that line.
 */
import type { TtsProvider } from './types';

export interface TtsJob {
  id: number;
  text: string;
  voice?: string;
}

export interface TtsQueueOptions {
  getProvider: () => TtsProvider;
  /** Called when a line's audio is ready. */
  onReady: (id: number) => void;
  /** Max lines waiting to be synthesized (older ones are dropped). */
  maxPending?: number;
  /** Max finished clips kept in memory. */
  cacheSize?: number;
  /** Per-line synthesis timeout. */
  timeoutMs?: number;
}

/** Strips markdown/stage directions that sound odd when read aloud. */
export function speakable(text: string): string {
  return text
    .replace(/\*+/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export class TtsQueue {
  private pending: TtsJob[] = [];
  private busy = false;
  private readonly cache = new Map<number, Uint8Array>();
  private idleWaiters: (() => void)[] = [];
  private enabled = true;

  constructor(private readonly opts: TtsQueueOptions) {}

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.pending = [];
  }

  enqueue(job: TtsJob): void {
    if (!this.enabled) return;
    const text = speakable(job.text);
    if (!text) return;
    this.pending.push({ ...job, text });
    const max = this.opts.maxPending ?? 4;
    if (this.pending.length > max) this.pending.splice(0, this.pending.length - max);
    void this.pump();
  }

  /** Drops everything waiting (the player skipped ahead). */
  clear(): void {
    this.pending = [];
  }

  get(id: number): Uint8Array | undefined {
    return this.cache.get(id);
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  /** Resolves when nothing is waiting or being synthesized (tests). */
  idle(): Promise<void> {
    if (!this.busy && this.pending.length === 0) return Promise.resolve();
    return new Promise((r) => this.idleWaiters.push(r));
  }

  private async pump(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      while (this.pending.length && this.enabled) {
        const job = this.pending.shift()!;
        try {
          const wav = await this.opts.getProvider().synthesize(job.text, { ...(job.voice && { voice: job.voice }), timeoutMs: this.opts.timeoutMs ?? 30_000 });
          this.cache.set(job.id, wav);
          const max = this.opts.cacheSize ?? 24;
          while (this.cache.size > max) this.cache.delete(this.cache.keys().next().value!);
          this.opts.onReady(job.id);
        } catch {
          // No audio for this line.
        }
      }
    } finally {
      this.busy = false;
      const waiters = this.idleWaiters;
      this.idleWaiters = [];
      waiters.forEach((w) => w());
    }
  }
}
