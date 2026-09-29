/**
 * Deterministic mock LLM. Used by all tests, and by the game when Ollama is missing or
 * `llm.useMock` is on. Replies come from (in order): a scripted queue, a per-task handler,
 * or a built-in default (template narration for text, "{}" for JSON).
 */
import {
  LlmError,
  type ChatMessage,
  type ChatOptions,
  type LlmProvider,
  type LlmStatus,
  type LlmTask,
} from './types';

export type MockHandler = (messages: ChatMessage[], opts: ChatOptions) => string;

export interface MockCall {
  messages: ChatMessage[];
  opts: ChatOptions;
}

export interface MockLlmOptions {
  model?: string;
  /** Replies consumed in order, one per call, before handlers are used. An Error is thrown instead of returned. */
  script?: (string | Error)[];
  handlers?: Partial<Record<LlmTask, MockHandler>>;
  /** Delay between streamed chunks, ms (0 in tests). */
  streamDelayMs?: number;
}

const DEFAULT_NARRATION = [
  'The world holds its breath for a moment as you act.',
  'Torchlight flickers across the stones, and the moment passes.',
  'A cool wind stirs, carrying the faint smell of rain and old smoke.',
];

export class MockLlm implements LlmProvider {
  readonly name = 'mock';
  readonly calls: MockCall[] = [];
  private readonly script: (string | Error)[];
  private readonly handlers: Partial<Record<LlmTask, MockHandler>>;
  private readonly model: string;
  private readonly streamDelayMs: number;

  constructor(opts: MockLlmOptions = {}) {
    this.script = [...(opts.script ?? [])];
    this.handlers = { ...opts.handlers };
    this.model = opts.model ?? 'mock';
    this.streamDelayMs = opts.streamDelayMs ?? 0;
  }

  /** Queue more scripted replies. */
  enqueue(...replies: (string | Error)[]): void {
    this.script.push(...replies);
  }

  setHandler(task: LlmTask, handler: MockHandler): void {
    this.handlers[task] = handler;
  }

  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
    return this.reply(messages, opts);
  }

  async *stream(messages: ChatMessage[], opts: ChatOptions = {}): AsyncIterable<string> {
    const text = this.reply(messages, opts);
    // Split into word-sized chunks, keeping the whitespace, like a real token stream.
    for (const chunk of text.match(/\S+\s*|\s+/g) ?? []) {
      if (opts.signal?.aborted) throw new LlmError('aborted', 'Request aborted');
      if (this.streamDelayMs > 0) await new Promise((r) => setTimeout(r, this.streamDelayMs));
      yield chunk;
    }
  }

  async listModels(): Promise<string[]> {
    return [this.model];
  }

  async status(): Promise<LlmStatus> {
    return { provider: this.name, reachable: true, model: this.model, modelAvailable: true, modelLoaded: true };
  }

  private reply(messages: ChatMessage[], opts: ChatOptions): string {
    this.calls.push({ messages, opts });
    if (this.script.length > 0) {
      const next = this.script.shift()!;
      if (next instanceof Error) throw next;
      return next;
    }
    const handler = this.handlers[opts.task ?? 'generic'];
    if (handler) return handler(messages, opts);
    if (opts.format !== undefined) return '{}';
    // Deterministic pick based on how many calls were made.
    return DEFAULT_NARRATION[(this.calls.length - 1) % DEFAULT_NARRATION.length]!;
  }
}
