/**
 * Fastify application factory. Registers the REST API, the WebSocket game channel and
 * (when a built client exists) static file serving. Kept separate from main.ts so tests
 * can build the app and call `inject()` without opening a port.
 */
import fs from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import { GAME_VERSION } from '../shared/version';
import { SettingsStore } from './settingsStore';

export interface AppOptions {
  /** Absolute path to the built client (dist/client). Static serving is skipped if it doesn't exist. */
  clientDir?: string;
  /** Folder for settings.json (and later other per-user data). Defaults to <cwd>/userdata. */
  userDataDir?: string;
  logger?: boolean;
}

export async function buildApp(opts: AppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false });

  await app.register(fastifyWebsocket);

  app.get('/api/health', async () => ({ ok: true, version: GAME_VERSION }));

  const settings = new SettingsStore(opts.userDataDir ?? path.join(process.cwd(), 'userdata'));
  app.decorate('settings', settings);
  app.get('/api/settings', async () => settings.get());
  app.put('/api/settings', async (req, reply) => {
    const res = settings.update(req.body);
    if (!res.ok) return reply.code(400).send({ error: res.error });
    return res.settings;
  });

  // Game channel. For now it echoes JSON messages back; GameSession wiring comes in A050.
  app.register(async (scope) => {
    scope.get('/ws', { websocket: true }, (socket) => {
      socket.on('message', (raw: Buffer) => {
        let payload: unknown;
        try {
          payload = JSON.parse(raw.toString());
        } catch {
          socket.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
          return;
        }
        socket.send(JSON.stringify({ type: 'echo', payload }));
      });
    });
  });

  const clientDir = opts.clientDir;
  if (clientDir && fs.existsSync(path.join(clientDir, 'index.html'))) {
    await app.register(fastifyStatic, { root: clientDir });
    // SPA fallback: unknown non-API GET routes return index.html.
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api')) {
        return reply.sendFile('index.html');
      }
      return reply.code(404).send({ error: 'Not found' });
    });
  }

  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    settings: SettingsStore;
  }
}
