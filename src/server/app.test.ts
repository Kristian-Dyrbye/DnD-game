import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app';
import { GAME_VERSION } from '../shared/version';

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('server app', () => {
  it('GET /api/health returns ok and version', async () => {
    app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, version: GAME_VERSION });
  });

  it('echoes JSON over the WebSocket channel', async () => {
    app = await buildApp();
    await app.ready();
    const ws = await app.injectWS('/ws');
    const reply = new Promise<string>((resolve) => ws.once('message', (d) => resolve(d.toString())));
    ws.send(JSON.stringify({ hello: 'world' }));
    expect(JSON.parse(await reply)).toEqual({ type: 'echo', payload: { hello: 'world' } });
    ws.terminate();
  });

  it('reports invalid JSON on the WebSocket channel', async () => {
    app = await buildApp();
    await app.ready();
    const ws = await app.injectWS('/ws');
    const reply = new Promise<string>((resolve) => ws.once('message', (d) => resolve(d.toString())));
    ws.send('not json');
    expect(JSON.parse(await reply)).toMatchObject({ type: 'error' });
    ws.terminate();
  });

  it('serves the built client with SPA fallback', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-client-'));
    fs.writeFileSync(path.join(dir, 'index.html'), '<html>game</html>');
    try {
      app = await buildApp({ clientDir: dir });
      const root = await app.inject({ method: 'GET', url: '/' });
      expect(root.statusCode).toBe(200);
      expect(root.body).toContain('game');
      const deep = await app.inject({ method: 'GET', url: '/some/route' });
      expect(deep.body).toContain('game');
      const api = await app.inject({ method: 'GET', url: '/api/missing' });
      expect(api.statusCode).toBe(404);
    } finally {
      await app?.close();
      app = undefined;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
