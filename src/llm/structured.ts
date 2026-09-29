/**
 * Structured (JSON) LLM calls that feed the engine. Every call:
 *  1. sends the zod schema as an Ollama JSON-schema `format`,
 *  2. extracts and validates the JSON reply with zod,
 *  3. retries once with the validation error if it fails,
 *  4. returns a typed fallback if it still fails.
 * It never throws, so a bad model reply can't crash or stall the game (spec §3).
 */
import { z } from 'zod';
import { LlmError, type ChatMessage, type ChatOptions, type LlmProvider, type LlmTask } from './types';

export interface StructuredRequest<T> {
  provider: LlmProvider;
  messages: ChatMessage[];
  schema: z.ZodType<T>;
  /** Used when both attempts fail. A function receives the last error message. */
  fallback: T | ((error: string) => T);
  task: LlmTask;
  opts?: Omit<ChatOptions, 'format' | 'task'>;
  /** Send the JSON schema as the Ollama format (default true). False sends plain 'json'. */
  schemaFormat?: boolean;
}

export interface StructuredResult<T> {
  value: T;
  /** True if the value came from the model, false if it's the fallback. */
  ok: boolean;
  attempts: number;
  error?: string;
  raw?: string;
}

export const MAX_ATTEMPTS = 2;

export async function callStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
  const format = req.schemaFormat === false ? 'json' : toOllamaSchema(req.schema);
  const messages = [...req.messages];
  let lastError = 'no attempt made';
  let raw: string | undefined;
  let attempts = 0;

  while (attempts < MAX_ATTEMPTS) {
    attempts++;
    try {
      raw = await req.provider.chat(messages, { ...req.opts, task: req.task, format });
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      // Retrying won't help if the service is down or the player cancelled.
      if (err instanceof LlmError && (err.kind === 'unreachable' || err.kind === 'aborted')) break;
      continue;
    }
    const parsed = parseReply(raw, req.schema);
    if (parsed.ok) return { value: parsed.value, ok: true, attempts, raw };
    lastError = parsed.error;
    messages.push(
      { role: 'assistant', content: raw },
      {
        role: 'user',
        content: `That reply was invalid (${parsed.error}). Reply again with ONLY valid JSON that matches the required format.`,
      },
    );
  }

  const value = typeof req.fallback === 'function' ? (req.fallback as (e: string) => T)(lastError) : req.fallback;
  return { value, ok: false, attempts, error: lastError, ...(raw !== undefined && { raw }) };
}

/** JSON Schema for Ollama's `format`, without the $schema meta key. */
export function toOllamaSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema, { unrepresentable: 'any' }) as Record<string, unknown>;
  return rest;
}

type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function parseReply<T>(raw: string, schema: z.ZodType<T>): ParseResult<T> {
  const text = extractJson(raw);
  if (text === null) return { ok: false, error: 'no JSON found' };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: `invalid JSON: ${(err as Error).message}` };
  }
  const result = schema.safeParse(data);
  if (!result.success) {
    return {
      ok: false,
      error: result.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; '),
    };
  }
  return { ok: true, value: result.data };
}

/**
 * Pulls the JSON value out of a model reply: strips ```json fences, <think> blocks and
 * leading chatter, then takes the first balanced {...} or [...] block.
 */
export function extractJson(raw: string): string | null {
  let text = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fence?.[1]) text = fence[1].trim();
  const start = text.search(/[{[]/);
  if (start < 0) return null;
  const open = text[start]!;
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth++;
    else if (ch === close && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}
