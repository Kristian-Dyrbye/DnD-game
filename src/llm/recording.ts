/**
 * RecordingLlm: wraps any provider and records every call (task, timing, reply, error, JSON
 * validity). Used by the real-model playtest (scripts/playtest-llm.ts, A115b) to measure speed and
 * reply quality without touching the game code; summarizeCalls() turns the records into a report.
 */
import { extractJson } from './structured';
import { LlmError, type ChatMessage, type ChatOptions, type LlmProvider, type LlmStatus, type LlmTask } from './types';

export interface LlmCallRecord {
  task: LlmTask;
  streamed: boolean;
  /** Asked for JSON (format set). */
  json: boolean;
  startedAt: number;
  ms: number;
  /** Time to the first streamed chunk (streams only). */
  firstChunkMs?: number;
  /** The last user message (what was asked), shortened. */
  prompt: string;
  reply: string;
  error?: string;
  errorKind?: string;
  /** For JSON calls: the reply held a parseable JSON value. */
  jsonValid?: boolean;
}

export class RecordingLlm implements LlmProvider {
  readonly calls: LlmCallRecord[] = [];
  private inFlight = 0;

  constructor(
    private readonly inner: LlmProvider,
    private readonly now: () => number = () => performance.now(),
  ) {}

  get name(): string {
    return this.inner.name;
  }

  /** Calls still running (background narration, suggestions, summaries). */
  get pending(): number {
    return this.inFlight;
  }

  async chat(messages: ChatMessage[], opts?: ChatOptions): Promise<string> {
    const rec = this.begin(messages, opts, false);
    try {
      rec.reply = await this.inner.chat(messages, opts);
      return rec.reply;
    } catch (err) {
      this.fail(rec, err);
      throw err;
    } finally {
      this.end(rec);
    }
  }

  async *stream(messages: ChatMessage[], opts?: ChatOptions): AsyncIterable<string> {
    const rec = this.begin(messages, opts, true);
    try {
      for await (const chunk of this.inner.stream(messages, opts)) {
        rec.firstChunkMs ??= this.now() - rec.startedAt;
        rec.reply += chunk;
        yield chunk;
      }
    } catch (err) {
      this.fail(rec, err);
      throw err;
    } finally {
      this.end(rec);
    }
  }

  listModels(): Promise<string[]> {
    return this.inner.listModels();
  }

  status(): Promise<LlmStatus> {
    return this.inner.status();
  }

  private begin(messages: ChatMessage[], opts: ChatOptions | undefined, streamed: boolean): LlmCallRecord {
    this.inFlight++;
    const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
    return { task: opts?.task ?? 'generic', streamed, json: opts?.format !== undefined, startedAt: this.now(), ms: 0, prompt: lastUser.slice(-600), reply: '' };
  }

  private fail(rec: LlmCallRecord, err: unknown): void {
    rec.error = err instanceof Error ? err.message : String(err);
    if (err instanceof LlmError) rec.errorKind = err.kind;
  }

  private end(rec: LlmCallRecord): void {
    this.inFlight--;
    rec.ms = this.now() - rec.startedAt;
    if (rec.json && rec.error === undefined) rec.jsonValid = isJson(rec.reply);
    this.calls.push(rec);
  }
}

function isJson(reply: string): boolean {
  const text = extractJson(reply);
  if (text === null) return false;
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

export interface TaskSummary {
  task: LlmTask;
  calls: number;
  errors: number;
  timeouts: number;
  avgMs: number;
  maxMs: number;
  /** Median time to first chunk (streams only). */
  medianFirstChunkMs?: number;
  /** Share of JSON calls whose reply parsed (0–1). */
  jsonValidRate?: number;
}

/** Per-task counts and timings, busiest task first. */
export function summarizeCalls(calls: readonly LlmCallRecord[]): TaskSummary[] {
  const byTask = new Map<LlmTask, LlmCallRecord[]>();
  for (const c of calls) byTask.set(c.task, [...(byTask.get(c.task) ?? []), c]);
  return [...byTask.entries()]
    .map(([task, list]): TaskSummary => {
      const ms = list.map((c) => c.ms);
      const firsts = list.flatMap((c) => (c.firstChunkMs === undefined ? [] : [c.firstChunkMs]));
      const json = list.filter((c) => c.jsonValid !== undefined);
      return {
        task,
        calls: list.length,
        errors: list.filter((c) => c.error !== undefined).length,
        timeouts: list.filter((c) => c.errorKind === 'timeout').length,
        avgMs: Math.round(ms.reduce((a, b) => a + b, 0) / list.length),
        maxMs: Math.round(Math.max(...ms)),
        ...(firsts.length > 0 && { medianFirstChunkMs: Math.round(median(firsts)) }),
        ...(json.length > 0 && { jsonValidRate: json.filter((c) => c.jsonValid).length / json.length }),
      };
    })
    .sort((a, b) => b.calls - a.calls);
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}
