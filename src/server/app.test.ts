import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app';
import { GAME_VERSION } from '../shared/version';
import { buildCharacter } from '../engine/character/builder';
import { toBuildInput } from '../engine/character/creator';
import { quickBuild } from '../engine/character/quickBuild';
import { Rng } from '../engine/core/rng';
import { loadSrd } from '../engine/data/srdBundle';

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

  it('runs a game over the WebSocket channel: ping, new_game snapshot, save', async () => {
    const savesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-ws-'));
    try {
      app = await buildApp({ savesDir, sessionPorts: { newSeed: () => 'ws-test' } });
      await app.ready();
      const ws = await app.injectWS('/ws');
      const events: { type: string; [k: string]: unknown }[] = [];
      ws.on('message', (d: Buffer) => events.push(JSON.parse(d.toString())));
      const until = async (pred: () => boolean) => {
        for (let i = 0; i < 400 && !pred(); i++) await new Promise((r) => setTimeout(r, 5));
        expect(pred()).toBe(true);
      };
      ws.send(JSON.stringify({ type: 'ping', reqId: 'p1' }));
      await until(() => events.some((e) => e.type === 'pong'));
      expect(events[0]).toEqual({ type: 'pong', reqId: 'p1' });

      const db = loadSrd();
      const hero = buildCharacter(toBuildInput(quickBuild('fighter', db, Rng.fromSeed(1))), db);
      ws.send(JSON.stringify({ type: 'new_game', hero, mode: 'heroic' }));
      await until(() => events.some((e) => e.type === 'saved'));
      const snap = events.find((e) => e.type === 'snapshot') as unknown as { state: { hero: { name: string }; location: { name: string } } };
      expect(snap.state.hero.name).toBe(hero.name);
      expect(snap.state.location.name).toBe('Millbrook');
      expect(fs.readdirSync(savesDir)).toContain('auto-1.json');

      ws.send(JSON.stringify({ type: 'save', slot: 'slot-1', name: 'My save' }));
      await until(() => events.filter((e) => e.type === 'saved').length === 2);
      expect(fs.existsSync(path.join(savesDir, 'slot-1.json'))).toBe(true);

      ws.send(JSON.stringify({ type: 'nonsense', reqId: 'x' }));
      await until(() => events.some((e) => e.type === 'error'));
      expect(events.find((e) => e.type === 'error')).toMatchObject({ reqId: 'x' });
      ws.terminate();
    } finally {
      await app?.close();
      app = undefined;
      fs.rmSync(savesDir, { recursive: true, force: true });
    }
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

describe('asset serving', () => {
  it('serves files under /assets/models and /assets/audio only', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-assets-'));
    fs.mkdirSync(path.join(dir, 'models', 'characters'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'models', 'characters', 'x.glb'), 'glb');
    fs.mkdirSync(path.join(dir, 'voices'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'voices', 'v.onnx'), 'secret');
    const a = await buildApp({ assetsDir: dir, userDataDir: dir });
    try {
      const ok = await a.inject({ method: 'GET', url: '/assets/models/characters/x.glb' });
      expect(ok.statusCode).toBe(200);
      expect(ok.body).toBe('glb');
      expect((await a.inject({ method: 'GET', url: '/assets/voices/v.onnx' })).statusCode).toBe(404);
    } finally {
      await a.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
