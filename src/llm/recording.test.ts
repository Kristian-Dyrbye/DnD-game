import { describe, expect, it } from 'vitest';
import { MockLlm } from './mock';
import { RecordingLlm, summarizeCalls, type LlmCallRecord } from './recording';
import { LlmError } from './types';

function clock(step: number) {
  let t = 0;
  return () => (t += step);
}

describe('RecordingLlm', () => {
  it('records chat calls with task, timing, prompt, reply and JSON validity', async () => {
    const rec = new RecordingLlm(new MockLlm({ script: ['Sure: {"action":"look"}', 'not json'] }), clock(10));
    await rec.chat([{ role: 'system', content: 'sys' }, { role: 'user', content: 'look around' }], { task: 'intent', format: 'json' });
    await rec.chat([{ role: 'user', content: 'again' }], { task: 'intent', format: 'json' });
    expect(rec.calls).toHaveLength(2);
    expect(rec.calls[0]).toMatchObject({ task: 'intent', json: true, streamed: false, prompt: 'look around', jsonValid: true, ms: 10 });
    expect(rec.calls[1]!.jsonValid).toBe(false);
    expect(rec.pending).toBe(0);
  });

  it('records streams with first-chunk time and errors with their kind', async () => {
    const rec = new RecordingLlm(new MockLlm({ script: ['The rain falls.', new LlmError('timeout', 'too slow')] }), clock(5));
    let text = '';
    for await (const c of rec.stream([{ role: 'user', content: 'narrate' }], { task: 'narrate' })) text += c;
    expect(text).toBe('The rain falls.');
    expect(rec.calls[0]).toMatchObject({ task: 'narrate', streamed: true, reply: 'The rain falls.' });
    expect(rec.calls[0]!.firstChunkMs).toBeGreaterThan(0);
    await expect(rec.chat([{ role: 'user', content: 'x' }], { task: 'suggest' })).rejects.toThrow('too slow');
    expect(rec.calls[1]).toMatchObject({ task: 'suggest', error: 'too slow', errorKind: 'timeout' });
    expect(rec.calls[1]!.jsonValid).toBeUndefined();
  });

  it('passes the provider name through', () => {
    expect(new RecordingLlm(new MockLlm()).name).toBe('mock');
  });
});

describe('summarizeCalls', () => {
  const call = (task: LlmCallRecord['task'], ms: number, extra: Partial<LlmCallRecord> = {}): LlmCallRecord => ({ task, streamed: false, json: false, startedAt: 0, ms, prompt: '', reply: '', ...extra });

  it('groups by task with averages, maxima, timeouts and JSON rate', () => {
    const s = summarizeCalls([
      call('narrate', 1000, { streamed: true, firstChunkMs: 300 }),
      call('narrate', 3000, { streamed: true, firstChunkMs: 500 }),
      call('narrate', 90_000, { error: 'timeout', errorKind: 'timeout' }),
      call('intent', 800, { json: true, jsonValid: true }),
      call('intent', 1200, { json: true, jsonValid: false }),
    ]);
    expect(s[0]).toEqual({ task: 'narrate', calls: 3, errors: 1, timeouts: 1, avgMs: 31_333, maxMs: 90_000, medianFirstChunkMs: 400 });
    expect(s[1]).toEqual({ task: 'intent', calls: 2, errors: 0, timeouts: 0, avgMs: 1000, maxMs: 1200, jsonValidRate: 0.5 });
  });
});
