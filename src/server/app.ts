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
import { Services, type ServiceOverrides } from './services';
import { SaveError, SaveStore, type SaveMetaInput } from './saveStore';
import { backstoryMessages, templateBackstory, type BackstorySummary } from '../llm/prompts/backstory';

export interface AppOptions {
  /** Absolute path to the built client (dist/client). Static serving is skipped if it doesn't exist. */
  clientDir?: string;
  /** Folder for settings.json (and later other per-user data). Defaults to <cwd>/userdata. */
  userDataDir?: string;
  /** Folder with downloaded models/audio (served at /assets/). Defaults to <cwd>/assets. */
  assetsDir?: string;
  /** Folder for save files. Defaults to <cwd>/saves. */
  savesDir?: string;
  /** Project root, used to resolve relative tool paths (Piper, voices). Defaults to cwd. */
  rootDir?: string;
  /** Fixed LLM/TTS providers (tests use the mocks). */
  services?: ServiceOverrides;
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

  const services = new Services(settings, opts.rootDir ?? process.cwd(), opts.services);
  app.decorate('services', services);
  app.get('/api/status', async () => services.status());

  // Backstory suggestion for the creator: LLM text, or a template when the LLM is unavailable/mocked.
  app.post<{ Body: BackstorySummary }>('/api/llm/backstory', async (req, reply) => {
    const summary = req.body;
    if (!summary || typeof summary.className !== 'string') return reply.code(400).send({ error: 'Missing character summary' });
    const llm = services.llm;
    if (llm.name !== 'mock') {
      try {
        const text = (await llm.chat(backstoryMessages(summary), { task: 'backstory', maxTokens: 350, temperature: 0.9, timeoutMs: 60_000 })).trim();
        if (text.length > 40) return { text, source: 'llm' };
      } catch {
        // fall through to the template
      }
    }
    return { text: templateBackstory(summary), source: 'template' };
  });

  const saves = new SaveStore(opts.savesDir ?? path.join(process.cwd(), 'saves'));
  app.decorate('saves', saves);
  const saveErrorCode: Record<SaveError['kind'], number> = { invalid_slot: 400, invalid: 400, not_found: 404, corrupt: 422 };
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof SaveError) return reply.code(saveErrorCode[err.kind]).send({ error: err.message, kind: err.kind });
    return reply.send(err);
  });
  app.get('/api/saves', async () => saves.list());
  app.get<{ Params: { slot: string } }>('/api/saves/:slot', async (req) => saves.load(req.params.slot));
  app.put<{ Params: { slot: string }; Body: { meta?: SaveMetaInput; state?: unknown } | null }>('/api/saves/:slot', async (req) => {
    // meta is validated inside SaveStore.save (400 on failure).
    return saves.save(req.params.slot, req.body?.meta as SaveMetaInput, req.body?.state ?? null).meta;
  });
  app.delete<{ Params: { slot: string } }>('/api/saves/:slot', async (req, reply) => {
    saves.delete(req.params.slot);
    return reply.code(204).send();
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

  // Downloaded 3D models, music and SFX (only these sub-folders; voices stay server-side for Piper).
  const assetsDir = opts.assetsDir ?? path.join(process.cwd(), 'assets');
  for (const sub of ['models', 'audio']) {
    const dir = path.join(assetsDir, sub);
    if (fs.existsSync(dir)) {
      await app.register(fastifyStatic, { root: dir, prefix: `/assets/${sub}/`, decorateReply: false });
    }
  }

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
    services: Services;
    saves: SaveStore;
  }
}
