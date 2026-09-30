/**
 * Ollama HTTP client (http://127.0.0.1:11434 by default). Uses /api/chat for chat and
 * streaming (NDJSON), /api/tags for installed models and /api/ps for loaded models.
 * `fetch` is injectable so tests never need a running Ollama.
 */
import {
  LlmError,
  type ChatMessage,
  type ChatOptions,
  type LlmProvider,
  type LlmStatus,
} from './types';

export interface OllamaConfig {
  baseUrl: string;
  model: string;
  temperature?: number;
  keepAlive?: string | number;
  /** Default request timeout for chat calls, ms. */
  timeoutMs?: number;
  /** Context window (Ollama num_ctx). Smaller = less RAM; prompts are budgeted to fit 4096. */
  numCtx?: number;
  fetch?: typeof fetch;
}

/** Models with a reasoning mode that must be switched off (it's slow and pollutes JSON). */
const THINKING_MODELS = /^(qwen3|deepseek-r1|magistral|gpt-oss)/i;

export function supportsThinkFlag(model: string): boolean {
  return THINKING_MODELS.test(model);
}

interface OllamaChatChunk {
  message?: { content?: string };
  done?: boolean;
  error?: string;
}

export class OllamaClient implements LlmProvider {
  readonly name = 'ollama';
  private readonly fetchFn: typeof fetch;

  constructor(private readonly config: OllamaConfig) {
    this.fetchFn = config.fetch ?? globalThis.fetch.bind(globalThis);
  }

  get model(): string {
    return this.config.model;
  }

  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
    const res = await this.post('/api/chat', this.chatBody(messages, opts, false), opts);
    const data = (await res.json().catch(() => null)) as OllamaChatChunk | null;
    if (!data || typeof data.message?.content !== 'string') {
      throw new LlmError('bad_response', data?.error ?? 'Ollama returned no message');
    }
    return data.message.content;
  }

  /**
   * Streams the reply. Timeouts: a total deadline (timeoutMs), or with firstChunkTimeoutMs a wait
   * for the first chunk plus an idle limit between chunks, so a slow but steady reply is not cut.
   * Failures while reading the body (including the abort) become LlmError too.
   */
  async *stream(messages: ChatMessage[], opts: ChatOptions = {}): AsyncIterable<string> {
    const deadline =
      opts.firstChunkTimeoutMs !== undefined
        ? new StreamDeadline(opts.firstChunkTimeoutMs, `no reply from Ollama within ${opts.firstChunkTimeoutMs} ms`, opts.idleTimeoutMs)
        : new StreamDeadline(this.timeoutFor(opts), `Ollama did not finish within ${this.timeoutFor(opts)} ms`);
    try {
      const res = await this.request('/api/chat', this.postInit(this.chatBody(messages, opts, true)), deadline, opts.signal);
      if (!res.body) throw new LlmError('bad_response', 'Ollama returned no stream');
      const decoder = new TextDecoder();
      let buffer = '';
      for await (const bytes of res.body as unknown as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(bytes, { stream: true });
        let newline: number;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          const text = parseChunk(line);
          if (text) {
            deadline.chunk();
            yield text;
          }
        }
      }
      const tail = parseChunk(buffer.trim());
      if (tail) yield tail;
    } catch (err) {
      if (err instanceof LlmError) throw err;
      if (opts.signal?.aborted) throw new LlmError('aborted', 'Request aborted');
      if (deadline.signal.aborted) throw new LlmError('timeout', deadline.message());
      throw new LlmError('bad_response', `Ollama stream failed: ${String(err)}`);
    } finally {
      deadline.stop();
    }
  }

  async listModels(): Promise<string[]> {
    const res = await this.get('/api/tags');
    const data = (await res.json()) as { models?: { name: string }[] };
    return (data.models ?? []).map((m) => m.name);
  }

  async status(): Promise<LlmStatus> {
    const base: LlmStatus = {
      provider: this.name,
      reachable: false,
      model: this.config.model,
      modelAvailable: false,
      modelLoaded: false,
    };
    try {
      const installed = await this.listModels();
      const loadedRes = await this.get('/api/ps');
      const loaded = ((await loadedRes.json()) as { models?: { name: string }[] }).models ?? [];
      return {
        ...base,
        reachable: true,
        modelAvailable: installed.some((n) => sameModel(n, this.config.model)),
        modelLoaded: loaded.some((m) => sameModel(m.name, this.config.model)),
      };
    } catch (err) {
      return { ...base, error: err instanceof Error ? err.message : String(err) };
    }
  }

  private chatBody(messages: ChatMessage[], opts: ChatOptions, stream: boolean) {
    const model = opts.model ?? this.config.model;
    const options: Record<string, number> = {};
    const temperature = opts.temperature ?? this.config.temperature;
    if (temperature !== undefined) options.temperature = temperature;
    if (opts.maxTokens !== undefined) options.num_predict = opts.maxTokens;
    if (this.config.numCtx !== undefined) options.num_ctx = this.config.numCtx;
    const keepAlive = opts.keepAlive ?? this.config.keepAlive;
    return {
      model,
      messages,
      stream,
      options,
      ...(opts.format !== undefined && { format: opts.format }),
      ...(keepAlive !== undefined && { keep_alive: keepAlive }),
      ...(supportsThinkFlag(model) && { think: false }),
    };
  }

  private get(pathname: string): Promise<Response> {
    return this.request(pathname, { method: 'GET' }, fixedDeadline(5000));
  }

  private post(pathname: string, body: unknown, opts: ChatOptions): Promise<Response> {
    return this.request(pathname, this.postInit(body), fixedDeadline(this.timeoutFor(opts)), opts.signal);
  }

  private postInit(body: unknown): RequestInit {
    return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
  }

  private timeoutFor(opts: ChatOptions): number {
    return opts.timeoutMs ?? this.config.timeoutMs ?? 120_000;
  }

  private async request(pathname: string, init: RequestInit, deadline: Deadline, signal?: AbortSignal): Promise<Response> {
    const combined = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal;
    let res: Response;
    try {
      res = await this.fetchFn(new URL(pathname, this.config.baseUrl), { ...init, signal: combined });
    } catch (err) {
      if (signal?.aborted) throw new LlmError('aborted', 'Request aborted');
      if (deadline.signal.aborted) throw new LlmError('timeout', deadline.message());
      throw new LlmError('unreachable', `Cannot reach Ollama at ${this.config.baseUrl}: ${String(err)}`);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new LlmError('http', `Ollama HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    return res;
  }
}

interface Deadline {
  readonly signal: AbortSignal;
  message(): string;
}

function fixedDeadline(ms: number): Deadline {
  return { signal: AbortSignal.timeout(ms), message: () => `Ollama did not answer within ${ms} ms` };
}

/** Aborts after `firstMs` unless re-armed: with `idleMs`, every chunk restarts the clock at `idleMs`. */
class StreamDeadline implements Deadline {
  private readonly ctrl = new AbortController();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private text: string;

  constructor(firstMs: number, firstText: string, private readonly idleMs?: number) {
    this.text = firstText;
    this.arm(firstMs);
  }

  get signal(): AbortSignal {
    return this.ctrl.signal;
  }

  message(): string {
    return this.text;
  }

  chunk(): void {
    if (this.idleMs === undefined) return;
    this.text = `Ollama stream stalled for ${this.idleMs} ms`;
    this.arm(this.idleMs);
  }

  stop(): void {
    clearTimeout(this.timer);
  }

  private arm(ms: number): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.ctrl.abort(), ms);
    (this.timer as { unref?: () => void }).unref?.();
  }
}

function parseChunk(line: string): string {
  if (!line) return '';
  let chunk: OllamaChatChunk;
  try {
    chunk = JSON.parse(line) as OllamaChatChunk;
  } catch {
    throw new LlmError('bad_response', `Bad stream line from Ollama: ${line.slice(0, 80)}`);
  }
  if (chunk.error) throw new LlmError('bad_response', chunk.error);
  return chunk.message?.content ?? '';
}

/** "qwen3:4b" matches "qwen3:4b"; "llama3.2" matches "llama3.2:latest". */
function sameModel(a: string, b: string): boolean {
  const norm = (s: string) => (s.includes(':') ? s : `${s}:latest`);
  return norm(a) === norm(b);
}
