import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { MockLlm } from './mock';
import { callStructured, extractJson, parseReply, toOllamaSchema } from './structured';
import { LlmError } from './types';

const Intent = z.object({
  action: z.enum(['look', 'attack', 'talk']),
  target: z.string().optional(),
});
type Intent = z.infer<typeof Intent>;

const FALLBACK: Intent = { action: 'look' };
const messages = [{ role: 'user' as const, content: 'I swing at the goblin' }];

function run(provider: MockLlm) {
  return callStructured({ provider, messages, schema: Intent, fallback: FALLBACK, task: 'intent' });
}

describe('callStructured', () => {
  it('returns a valid model reply on the first attempt', async () => {
    const llm = new MockLlm({ script: ['{"action":"attack","target":"goblin"}'] });
    const res = await run(llm);
    expect(res).toMatchObject({ ok: true, attempts: 1, value: { action: 'attack', target: 'goblin' } });
    expect(llm.calls[0]!.opts.task).toBe('intent');
    expect(llm.calls[0]!.opts.format).toMatchObject({ type: 'object' });
  });

  it('retries once with the error, then succeeds', async () => {
    const llm = new MockLlm({ script: ['{"action":"dance"}', '{"action":"talk"}'] });
    const res = await run(llm);
    expect(res).toMatchObject({ ok: true, attempts: 2, value: { action: 'talk' } });
    const retryMsgs = llm.calls[1]!.messages;
    expect(retryMsgs.at(-1)!.content).toContain('invalid');
    expect(retryMsgs.at(-2)).toEqual({ role: 'assistant', content: '{"action":"dance"}' });
  });

  it('uses the fallback after two bad replies', async () => {
    const llm = new MockLlm({ script: ['not json at all', '{"broken":'] });
    const res = await run(llm);
    expect(res).toMatchObject({ ok: false, attempts: 2, value: FALLBACK });
    expect(res.error).toBeTruthy();
  });

  it('passes the error to a fallback function', async () => {
    const llm = new MockLlm({ script: ['nope', 'nope'] });
    const res = await callStructured({
      provider: llm,
      messages,
      schema: Intent,
      task: 'intent',
      fallback: (err): Intent => ({ action: 'look', target: err.slice(0, 7) }),
    });
    expect(res.value).toEqual({ action: 'look', target: 'no JSON' });
  });

  it('retries after a timeout', async () => {
    const llm = new MockLlm({ script: [new LlmError('timeout', 'slow'), '{"action":"look"}'] });
    expect(await run(llm)).toMatchObject({ ok: true, attempts: 2 });
  });

  it('does not retry when Ollama is unreachable, and never throws', async () => {
    const llm = new MockLlm({ script: [new LlmError('unreachable', 'down'), '{"action":"talk"}'] });
    const res = await run(llm);
    expect(res).toMatchObject({ ok: false, attempts: 1, value: FALLBACK });
    expect(llm.calls).toHaveLength(1);
  });

  it('can send plain json format instead of a schema', async () => {
    const llm = new MockLlm({ script: ['{"action":"look"}'] });
    await callStructured({ provider: llm, messages, schema: Intent, fallback: FALLBACK, task: 'intent', schemaFormat: false });
    expect(llm.calls[0]!.opts.format).toBe('json');
  });
});

describe('extractJson', () => {
  it('handles fences, chatter, think blocks and braces in strings', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(extractJson('Sure! Here it is: {"a":"}{"} hope that helps')).toBe('{"a":"}{"}');
    expect(extractJson('<think>{"no":1}</think>{"yes":2}')).toBe('{"yes":2}');
    expect(extractJson('[1,[2]] trailing')).toBe('[1,[2]]');
    expect(extractJson('no json here')).toBeNull();
    expect(extractJson('{"unclosed": 1')).toBeNull();
  });
});

describe('parseReply / toOllamaSchema', () => {
  it('reports schema errors with paths', () => {
    const res = parseReply('{"action":"fly"}', Intent);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('action');
  });

  it('builds an Ollama format schema without $schema', () => {
    const s = toOllamaSchema(Intent);
    expect(s).not.toHaveProperty('$schema');
    expect(s).toMatchObject({ type: 'object', required: ['action'] });
  });
});
