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

  async *stream(messages: ChatMessage[], opts: ChatOptions = {}): AsyncIterable<string> {
    const res = await this.post('/api/chat', this.chatBody(messages, opts, true), opts);
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
        if (text) yield text;
      }
    }
    const tail = parseChunk(buffer.trim());
    if (tail) yield tail;
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
    return this.request(pathname, { method: 'GET' }, 5000);
  }

  private post(pathname: string, body: unknown, opts: ChatOptions): Promise<Response> {
    return this.request(
      pathname,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
      opts.timeoutMs ?? this.config.timeoutMs ?? 120_000,
      opts.signal,
    );
  }

  private async request(pathname: string, init: RequestInit, timeoutMs: number, signal?: AbortSignal): Promise<Response> {
    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let res: Response;
    try {
      res = await this.fetchFn(new URL(pathname, this.config.baseUrl), { ...init, signal: combined });
    } catch (err) {
      if (signal?.aborted) throw new LlmError('aborted', 'Request aborted');
      if (timeout.aborted) throw new LlmError('timeout', `Ollama did not answer within ${timeoutMs} ms`);
      throw new LlmError('unreachable', `Cannot reach Ollama at ${this.config.baseUrl}: ${String(err)}`);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new LlmError('http', `Ollama HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    return res;
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
