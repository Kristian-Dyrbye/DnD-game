/**
 * LLM provider contract. The game talks to the language model only through this interface,
 * so Ollama and the mock are interchangeable. Providers return text; they never touch game state.
 */

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

/** What a call is for. Used for logging, and by the mock to pick a scripted reply. */
export type LlmTask =
  | 'narrate'
  | 'intent'
  | 'suggest'
  | 'summarize'
  | 'dialogue'
  | 'banter'
  | 'backstory'
  | 'generic';

export interface ChatOptions {
  task?: LlmTask;
  /** Overrides the provider's default model. */
  model?: string;
  temperature?: number;
  /** Max tokens to generate (Ollama num_predict). */
  maxTokens?: number;
  /** 'json' for free-form JSON, or a JSON Schema object for Ollama structured outputs. */
  format?: 'json' | Record<string, unknown>;
  /** Ollama keep_alive (e.g. "5m", 0 to unload right after). */
  keepAlive?: string | number;
  /** Request timeout in ms (default is provider-specific). For streams: the total time, unless firstChunkTimeoutMs is set. */
  timeoutMs?: number;
  /** Streams only: max wait for the first text chunk (prompt evaluation on a CPU is the slow part). Replaces timeoutMs. */
  firstChunkTimeoutMs?: number;
  /** Streams only, with firstChunkTimeoutMs: max silence between two chunks after the first. */
  idleTimeoutMs?: number;
  signal?: AbortSignal;
}

export interface LlmStatus {
  provider: string;
  /** The service answered. Always true for the mock. */
  reachable: boolean;
  model: string;
  /** The model is pulled/installed. */
  modelAvailable: boolean;
  /** The model is currently in memory. */
  modelLoaded: boolean;
  error?: string;
}

export interface LlmProvider {
  readonly name: string;
  /** Full reply as one string. Throws LlmError on failure. */
  chat(messages: ChatMessage[], opts?: ChatOptions): Promise<string>;
  /** Reply streamed as text chunks. Throws LlmError on failure. */
  stream(messages: ChatMessage[], opts?: ChatOptions): AsyncIterable<string>;
  listModels(): Promise<string[]>;
  status(): Promise<LlmStatus>;
}

export type LlmErrorKind = 'unreachable' | 'timeout' | 'http' | 'bad_response' | 'aborted';

export class LlmError extends Error {
  constructor(
    readonly kind: LlmErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}
