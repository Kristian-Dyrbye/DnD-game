import { describe, expect, it } from 'vitest';
import { LlmScheduler } from './scheduler';
import { LlmError, type ChatMessage, type ChatOptions, type LlmProvider } from './types';

/** A provider whose calls stay open until the test finishes them. */
function fakeProvider() {
  const calls: { kind: string; opts: ChatOptions; finish: (text?: string) => void; fail: (err: unknown) => void; startedAt: number }[] = [];
  const started: string[] = [];
  let clock = 0;
  const provider: LlmProvider = {
    name: 'fake',
    chat(_m: ChatMessage[], opts: ChatOptions = {}) {
      const kind = opts.queueAs ?? opts.task ?? 'generic';
      started.push(kind);
      return new Promise<string>((resolve, reject) => {
        const call = { kind, opts, finish: (t: string = kind) => resolve(t), fail: reject, startedAt: clock };
        calls.push(call);
        opts.signal?.addEventListener('abort', () => reject(new LlmError('aborted', 'Request aborted')));
      });
    },
    async *stream(_m: ChatMessage[], opts: ChatOptions = {}) {
      const kind = opts.queueAs ?? opts.task ?? 'generic';
      started.push(kind);
      const text = await new Promise<string>((resolve, reject) => calls.push({ kind, opts, finish: (t: string = kind) => resolve(t), fail: reject, startedAt: clock }));
      yield text;
    },
    listModels: async () => [],
    status: async () => ({ provider: 'fake', reachable: true, model: 'm', modelAvailable: true, modelLoaded: true }),
  };
  return { provider, calls, started, tick: (n: number) => (clock += n) };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const msgs: ChatMessage[] = [{ role: 'user', content: 'x' }];

async function drain(it: AsyncIterable<string>): Promise<string> {
  let s = '';
  for await (const c of it) s += c;
  return s;
}

describe('LlmScheduler', () => {
  it('runs one request at a time, highest priority first', async () => {
    const f = fakeProvider();
    const s = new LlmScheduler(f.provider);
    const summary = s.chat(msgs, { task: 'summarize' });
    await tick();
    expect(s.active).toBe('summarize');
    const results: string[] = [];
    const combat = drain(s.stream(msgs, { task: 'narrate', queueAs: 'combat_narrate' })).then((t) => results.push(t));
    const intent = s.chat(msgs, { task: 'intent' }).then((t) => results.push(t));
    await tick();
    // The summary was preempted by the player-facing jobs and waits again, behind them.
    expect(f.started).toEqual(['summarize', 'intent']);
    expect(s.queued).toEqual(['combat_narrate', 'summarize']);
    f.calls.at(-1)!.finish();
    await tick();
    expect(s.active).toBe('combat_narrate');
    f.calls.at(-1)!.finish();
    await Promise.all([combat, intent]);
    await tick();
    expect(results).toEqual(['intent', 'combat_narrate']);
    expect(s.active).toBe('summarize');
    f.calls.at(-1)!.finish('the story so far');
    expect(await summary).toBe('the story so far');
    expect(f.started).toEqual(['summarize', 'intent', 'combat_narrate', 'summarize']);
  });

  it('starts a job only when it runs, so its timeout counts from then', async () => {
    const f = fakeProvider();
    const s = new LlmScheduler(f.provider);
    const narration = drain(s.stream(msgs, { task: 'narrate', firstChunkTimeoutMs: 60_000 }));
    await tick();
    const suggest = s.chat(msgs, { task: 'suggest', timeoutMs: 45_000 });
    await tick();
    f.tick(50_000);
    expect(f.started).toEqual(['narrate']);
    f.calls[0]!.finish('You step in.');
    expect(await narration).toBe('You step in.');
    await tick();
    expect(f.calls[1]).toMatchObject({ kind: 'suggest', startedAt: 50_000, opts: { timeoutMs: 45_000 } });
    f.calls[1]!.finish('{}');
    expect(await suggest).toBe('{}');
  });

  it('keeps only the newest waiting job of a background kind', async () => {
    const f = fakeProvider();
    const s = new LlmScheduler(f.provider);
    const narration = drain(s.stream(msgs, { task: 'narrate' }));
    await tick();
    const old = s.chat(msgs, { task: 'suggest' });
    const fresh = s.chat(msgs, { task: 'suggest' });
    await expect(old).rejects.toMatchObject({ kind: 'aborted' });
    expect(s.queued).toEqual(['suggest']);
    f.calls[0]!.finish();
    await narration;
    await tick();
    f.calls[1]!.finish('new ideas');
    expect(await fresh).toBe('new ideas');
  });

  it('drops waiting suggestions and banter when the player acts, but keeps a waiting summary', async () => {
    const f = fakeProvider();
    const s = new LlmScheduler(f.provider);
    const first = drain(s.stream(msgs, { task: 'narrate' }));
    await tick();
    const suggest = s.chat(msgs, { task: 'suggest' });
    const banter = s.chat(msgs, { task: 'banter' });
    const summary = s.chat(msgs, { task: 'summarize' });
    const intent = s.chat(msgs, { task: 'intent' });
    await expect(suggest).rejects.toMatchObject({ kind: 'aborted' });
    await expect(banter).rejects.toMatchObject({ kind: 'aborted' });
    expect(s.queued).toEqual(['intent', 'summarize']);
    f.calls[0]!.finish();
    await first;
    await tick();
    f.calls[1]!.finish('{"action":"look"}');
    await intent;
    await tick();
    f.calls[2]!.finish('sum');
    expect(await summary).toBe('sum');
  });

  it('drops a running suggestion preempted by the player', async () => {
    const f = fakeProvider();
    const s = new LlmScheduler(f.provider);
    const suggest = s.chat(msgs, { task: 'suggest' });
    await tick();
    const narration = drain(s.stream(msgs, { task: 'narrate' }));
    await expect(suggest).rejects.toMatchObject({ kind: 'aborted', message: expect.stringMatching(/preempted/) });
    await tick();
    expect(s.active).toBe('narrate');
    f.calls[1]!.finish('Story.');
    expect(await narration).toBe('Story.');
    expect(s.active).toBeUndefined();
  });

  it('never preempts combat narration or a player-facing job', async () => {
    const f = fakeProvider();
    const s = new LlmScheduler(f.provider);
    const intent = s.chat(msgs, { task: 'intent' });
    await tick();
    const narration = drain(s.stream(msgs, { task: 'narrate' }));
    await tick();
    expect(s.active).toBe('intent');
    f.calls[0]!.finish('{}');
    await intent;
    await tick();
    f.calls[1]!.finish('Story.');
    await narration;
  });

  it('passes errors through and frees the slot', async () => {
    const f = fakeProvider();
    const s = new LlmScheduler(f.provider);
    const a = s.chat(msgs, { task: 'intent' });
    const b = s.chat(msgs, { task: 'intent' });
    await tick();
    f.calls[0]!.fail(new LlmError('timeout', 'slow'));
    await expect(a).rejects.toMatchObject({ kind: 'timeout' });
    await tick();
    f.calls[1]!.finish('ok');
    expect(await b).toBe('ok');
  });

  it("removes a waiting job when the caller's signal aborts", async () => {
    const f = fakeProvider();
    const s = new LlmScheduler(f.provider);
    const running = s.chat(msgs, { task: 'intent' });
    await tick();
    const ctrl = new AbortController();
    const waiting = s.chat(msgs, { task: 'backstory', signal: ctrl.signal });
    ctrl.abort();
    await expect(waiting).rejects.toMatchObject({ kind: 'aborted' });
    expect(s.queued).toEqual([]);
    f.calls[0]!.finish();
    await running;
    expect(f.started).toEqual(['intent']);
  });

  it('frees the slot when a stream consumer stops early', async () => {
    const f = fakeProvider();
    const s = new LlmScheduler(f.provider);
    const it = s.stream(msgs, { task: 'narrate' })[Symbol.asyncIterator]();
    const first = it.next();
    await tick();
    f.calls[0]!.finish('A.');
    expect((await first).value).toBe('A.');
    await it.return?.();
    expect(s.active).toBeUndefined();
  });

  it('passes name, status and models through', async () => {
    const f = fakeProvider();
    const s = new LlmScheduler(f.provider);
    expect(s.name).toBe('fake');
    expect((await s.status()).reachable).toBe(true);
    expect(await s.listModels()).toEqual([]);
  });
});
