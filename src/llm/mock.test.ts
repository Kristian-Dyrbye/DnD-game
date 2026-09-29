import { describe, expect, it } from 'vitest';
import { MockLlm } from './mock';
import { createLlmProvider } from './provider';
import { defaultSettings } from '../shared/settings';
import { LlmError } from './types';

const msg = [{ role: 'user' as const, content: 'Look around' }];

describe('MockLlm', () => {
  it('returns scripted replies in order, then falls back to defaults', async () => {
    const m = new MockLlm({ script: ['one', 'two'] });
    expect(await m.chat(msg)).toBe('one');
    expect(await m.chat(msg)).toBe('two');
    expect(typeof (await m.chat(msg))).toBe('string');
    expect(m.calls).toHaveLength(3);
  });

  it('throws scripted errors', async () => {
    const m = new MockLlm({ script: [new LlmError('timeout', 'slow')] });
    await expect(m.chat(msg)).rejects.toMatchObject({ kind: 'timeout' });
  });

  it('routes by task to handlers', async () => {
    const m = new MockLlm({ handlers: { intent: () => '{"action":"look"}' } });
    expect(await m.chat(msg, { task: 'intent' })).toBe('{"action":"look"}');
  });

  it('returns {} for JSON calls without a handler', async () => {
    expect(await new MockLlm().chat(msg, { format: 'json' })).toBe('{}');
  });

  it('is deterministic', async () => {
    const a = new MockLlm();
    const b = new MockLlm();
    expect(await a.chat(msg)).toBe(await b.chat(msg));
  });

  it('streams text that joins back to the full reply', async () => {
    const m = new MockLlm({ script: ['The old door creaks open.'] });
    const parts: string[] = [];
    for await (const p of m.stream(msg)) parts.push(p);
    expect(parts.join('')).toBe('The old door creaks open.');
    expect(parts.length).toBe(5);
  });

  it('always reports a ready status', async () => {
    expect(await new MockLlm().status()).toMatchObject({ reachable: true, modelLoaded: true });
  });
});

describe('createLlmProvider', () => {
  it('picks the mock when useMock is on, Ollama otherwise', () => {
    const s = defaultSettings();
    expect(createLlmProvider(s.llm).name).toBe('ollama');
    expect(createLlmProvider({ ...s.llm, useMock: true }).name).toBe('mock');
  });
});
