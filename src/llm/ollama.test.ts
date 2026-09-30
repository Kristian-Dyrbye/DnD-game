import { describe, expect, it } from 'vitest';
import { OllamaClient, supportsThinkFlag } from './ollama';
import { LlmError } from './types';

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

function fakeFetch(handler: Handler) {
  const calls: { url: string; body: unknown }[] = [];
  const fn = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, body: init.body ? JSON.parse(String(init.body)) : undefined });
    return handler(url, init);
  }) as typeof fetch;
  return { fn, calls };
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

function client(handler: Handler, model = 'qwen3:4b') {
  const f = fakeFetch(handler);
  return { c: new OllamaClient({ baseUrl: 'http://127.0.0.1:11434', model, fetch: f.fn }), calls: f.calls };
}

describe('OllamaClient', () => {
  it('sends a chat request and returns the message content', async () => {
    const { c, calls } = client(() => json({ message: { content: 'Hello, traveller.' }, done: true }));
    const text = await c.chat([{ role: 'user', content: 'hi' }], { temperature: 0.2, maxTokens: 50, format: 'json' });
    expect(text).toBe('Hello, traveller.');
    expect(calls[0]!.url).toBe('http://127.0.0.1:11434/api/chat');
    expect(calls[0]!.body).toMatchObject({
      model: 'qwen3:4b',
      stream: false,
      format: 'json',
      think: false,
      options: { temperature: 0.2, num_predict: 50 },
    });
  });

  it('caps the context window (num_ctx) for the memory budget', async () => {
    const f = fakeFetch(() => json({ message: { content: 'x' } }));
    const c = new OllamaClient({ baseUrl: 'http://127.0.0.1:11434', model: 'qwen3:4b', numCtx: 4096, fetch: f.fn });
    await c.chat([{ role: 'user', content: 'hi' }]);
    expect(f.calls[0]!.body).toMatchObject({ options: { num_ctx: 4096 } });
  });

  it('does not send think for models without a reasoning mode', async () => {
    const { c, calls } = client(() => json({ message: { content: 'x' } }), 'llama3.2:3b');
    await c.chat([{ role: 'user', content: 'hi' }]);
    expect(calls[0]!.body).not.toHaveProperty('think');
  });

  it('streams NDJSON chunks, including lines split across reads', async () => {
    const lines = [
      '{"message":{"content":"The "},"done":false}\n{"message":{"con',
      'tent":"door "},"done":false}\n',
      '{"message":{"content":"creaks."},"done":false}\n{"done":true}',
    ];
    const { c } = client(() => {
      const body = new ReadableStream<Uint8Array>({
        start(ctrl) {
          for (const l of lines) ctrl.enqueue(new TextEncoder().encode(l));
          ctrl.close();
        },
      });
      return new Response(body, { status: 200 });
    });
    const parts: string[] = [];
    for await (const p of c.stream([{ role: 'user', content: 'go' }])) parts.push(p);
    expect(parts.join('')).toBe('The door creaks.');
    expect(parts.length).toBe(3);
  });

  describe('stream timeouts', () => {
    /** A body sending chunks after the given delays (ms, each from the previous), then staying open until aborted. */
    function slowStream(delays: number[], close = false): Handler {
      return (_url, init) => {
        const body = new ReadableStream<Uint8Array>({
          start(ctrl) {
            const timers: ReturnType<typeof setTimeout>[] = [];
            init.signal?.addEventListener('abort', () => {
              timers.forEach(clearTimeout);
              ctrl.error(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
            });
            let at = 0;
            delays.forEach((d, i) => {
              at += d;
              timers.push(setTimeout(() => ctrl.enqueue(new TextEncoder().encode(`{"message":{"content":"w${i} "}}\n`)), at));
            });
            if (close) timers.push(setTimeout(() => ctrl.close(), at + 5));
          },
        });
        return new Response(body, { status: 200 });
      };
    }

    async function drain(c: OllamaClient, opts: Parameters<OllamaClient['stream']>[1]) {
      const parts: string[] = [];
      try {
        for await (const p of c.stream([{ role: 'user', content: 'go' }], opts)) parts.push(p);
        return { parts };
      } catch (error) {
        return { parts, error };
      }
    }

    it('times out waiting for the first chunk', async () => {
      const { c } = client(slowStream([]));
      const r = await drain(c, { firstChunkTimeoutMs: 30, idleTimeoutMs: 1000 });
      expect(r.error).toBeInstanceOf(LlmError);
      expect(r.error).toMatchObject({ kind: 'timeout', message: expect.stringMatching(/no reply/) });
    });

    it('lets a slow but steady stream run past the first-chunk and idle limits', async () => {
      // Wide margins (each gap is 300 ms under the limits) so a loaded machine doesn't flake it.
      const { c } = client(slowStream([20, 200, 200, 200, 200], true));
      const r = await drain(c, { firstChunkTimeoutMs: 500, idleTimeoutMs: 500 });
      expect(r.error).toBeUndefined();
      expect(r.parts.join('')).toBe('w0 w1 w2 w3 w4 ');
    });

    it('times out when the stream stalls between chunks, after yielding what came', async () => {
      const { c } = client(slowStream([5, 5]));
      const r = await drain(c, { firstChunkTimeoutMs: 1000, idleTimeoutMs: 40 });
      expect(r.parts).toEqual(['w0 ', 'w1 ']);
      expect(r.error).toMatchObject({ kind: 'timeout', message: expect.stringMatching(/stalled/) });
    });

    it('turns a total timeout during body reading into LlmError(timeout)', async () => {
      const { c } = client(slowStream([5]));
      const r = await drain(c, { timeoutMs: 40 });
      expect(r.parts).toEqual(['w0 ']);
      expect(r.error).toBeInstanceOf(LlmError);
      expect((r.error as LlmError).kind).toBe('timeout');
    });

    it('reports a caller abort mid-stream as aborted', async () => {
      const { c } = client(slowStream([5]));
      const ctrl = new AbortController();
      setTimeout(() => ctrl.abort(), 30);
      const r = await drain(c, { timeoutMs: 5000, signal: ctrl.signal });
      expect(r.error).toMatchObject({ kind: 'aborted' });
    });
  });

  it('maps HTTP errors to LlmError(http)', async () => {
    const { c } = client(() => new Response('model not found', { status: 404 }));
    await expect(c.chat([{ role: 'user', content: 'x' }])).rejects.toMatchObject({ kind: 'http' });
  });

  it('maps network failures to LlmError(unreachable)', async () => {
    const { c } = client(() => {
      throw new TypeError('fetch failed');
    });
    const err = await c.chat([{ role: 'user', content: 'x' }]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect((err as LlmError).kind).toBe('unreachable');
  });

  it('maps timeouts to LlmError(timeout)', async () => {
    const { c } = client(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    await expect(c.chat([{ role: 'user', content: 'x' }], { timeoutMs: 20 })).rejects.toMatchObject({ kind: 'timeout' });
  });

  it('reports bad responses', async () => {
    const { c } = client(() => json({ nothing: true }));
    await expect(c.chat([{ role: 'user', content: 'x' }])).rejects.toMatchObject({ kind: 'bad_response' });
  });

  it('lists models and reports status', async () => {
    const { c } = client((url) =>
      url.endsWith('/api/tags')
        ? json({ models: [{ name: 'qwen3:4b' }, { name: 'llama3.2:latest' }] })
        : json({ models: [{ name: 'qwen3:4b' }] }),
    );
    expect(await c.listModels()).toEqual(['qwen3:4b', 'llama3.2:latest']);
    expect(await c.status()).toMatchObject({ reachable: true, modelAvailable: true, modelLoaded: true });
  });

  it('reports an unreachable status instead of throwing', async () => {
    const { c } = client(() => {
      throw new TypeError('ECONNREFUSED');
    });
    const s = await c.status();
    expect(s.reachable).toBe(false);
    expect(s.error).toBeTruthy();
  });

  it('knows which models need think:false', () => {
    expect(supportsThinkFlag('qwen3:4b')).toBe(true);
    expect(supportsThinkFlag('llama3.2:3b')).toBe(false);
  });
});
