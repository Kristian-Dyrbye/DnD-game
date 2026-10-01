/**
 * Fastify application factory. Registers the REST API, the WebSocket game channel and
 * (when a built client exists) static file serving. Kept separate from main.ts so tests
 * can build the app and call `inject()` without opening a port.
 */
import fs from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { HOST_SEAT, type SeatId } from '../engine/session/table';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import { GAME_VERSION } from '../shared/version';
import { SettingsStore } from './settingsStore';
import { Services, type ServiceOverrides } from './services';
import { SaveError, SaveStore, type SaveMetaInput } from './saveStore';
import type { GameSession, SessionPorts } from '../engine/session/GameSession';
import { createGameHost, worldTables } from '../host/gameHost';
import { parseSaveFile } from '../engine/session/saveFile';

export { STARTING_ADVENTURE } from '../host/gameHost';
import { loadSrd } from '../engine/data/srdBundle';
import { loadAdventures, loadFlagRegistry, loadTranslations } from './adventures';
import { parseIntent } from '../llm/prompts/intent';
import { llmNarrator } from './narrator';
import { TtsQueue } from '../tts/queue';
import { Notices } from './notices';
import { llmBanter } from '../llm/prompts/banter';
import { suggestIdeas } from '../llm/prompts/suggest';
import { llmSummarizer } from '../llm/prompts/summary';
import { gatherNarrationContext } from '../llm/context/gather';
import { backstoryMessages, templateBackstory, type BackstorySummary } from '../llm/prompts/backstory';

export interface AppOptions {
  /** Absolute path to the built client (dist/client). Static serving is skipped if it doesn't exist. */
  clientDir?: string;
  /** Folder for settings.json (and later other per-user data). Defaults to <cwd>/userdata. */
  userDataDir?: string;
  /** Folder with downloaded models/audio (served at /assets/). Defaults to <cwd>/assets. */
  assetsDir?: string;
  /** Folder with adventure JSON. Defaults to <rootDir>/data/adventures. */
  adventuresDir?: string;
  /** Folder for save files. Defaults to <cwd>/saves. */
  savesDir?: string;
  /** Project root, used to resolve relative tool paths (Piper, voices). Defaults to cwd. */
  rootDir?: string;
  /** Fixed LLM/TTS providers (tests use the mocks). */
  services?: ServiceOverrides;
  /** Overrides for the game session (tests inject actions/seeds). */
  sessionPorts?: Partial<SessionPorts>;
  logger?: boolean;
  /**
   * The table seat a new game channel plays (co-op, C003). Default: every channel is the host's.
   * C005's join codes will choose it; tests pass one to put two sockets at one table.
   */
  seatFor?: (req: FastifyRequest) => SeatId;
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
  // Settings panel helpers: model/voice lists and a quick connection test.
  app.get('/api/llm/models', async () => {
    try {
      return { models: await services.llm.listModels() };
    } catch {
      return { models: [] };
    }
  });
  app.get('/api/tts/voices', async () => {
    try {
      return { voices: await services.tts.listVoices() };
    } catch {
      return { voices: [] };
    }
  });
  app.post('/api/llm/test', async () => {
    const llm = services.llm;
    const start = Date.now();
    const status = await llm.status();
    if (!status.reachable) return { ok: false, provider: llm.name, error: status.error ?? 'Ollama is not running.' };
    if (!status.modelAvailable) return { ok: false, provider: llm.name, error: `Model "${status.model}" is not installed. Run: ollama pull ${status.model}` };
    try {
      const reply = await llm.chat([{ role: 'user', content: 'Reply with the single word: ready' }], { task: 'generic', maxTokens: 8, timeoutMs: 60_000 });
      return { ok: true, provider: llm.name, model: status.model, latencyMs: Date.now() - start, reply: reply.trim().slice(0, 40) };
    } catch (err) {
      return { ok: false, provider: llm.name, error: err instanceof Error ? err.message : String(err) };
    }
  });

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
  // Import save: the body is an exported save file (migrated + validated before it is stored).
  app.post<{ Params: { slot: string }; Body: unknown }>('/api/saves/:slot/import', async (req, reply) => {
    let file;
    try {
      file = parseSaveFile(req.body);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message, kind: 'invalid' });
    }
    return saves.save(req.params.slot, file.meta, file.state).meta;
  });
  app.delete<{ Params: { slot: string } }>('/api/saves/:slot', async (req, reply) => {
    saves.delete(req.params.slot);
    return reply.code(204).send();
  });

  // Game channel: one GameSession per server (single player). Every socket sees its events, so a
  // reloaded page can reconnect and ask for a snapshot. Commands run one at a time, in order.
  // Adventures: the default one starts on new_game (the demo until the starter arc exists, A099).
  const srd = loadSrd();
  // Assigned once the session exists (the ports below report failures through it).
  let notices: Notices | undefined;
  const tables = worldTables();
  const { lore } = tables;
  const adventuresDir = opts.adventuresDir ?? path.join(opts.rootDir ?? process.cwd(), 'data', 'adventures');
  const flagRegistry = loadFlagRegistry(adventuresDir);
  const { adventures, problems } = loadAdventures(adventuresDir, srd, flagRegistry, tables.companions);
  for (const p of problems) app.log.warn({ file: p.file, errors: p.errors }, 'Skipping invalid adventure');
  // Content translations live next to the adventures folder (data/i18n/<lang>/<key>.json).
  const i18n = loadTranslations(path.join(path.dirname(adventuresDir), 'i18n'));
  for (const p of i18n.problems) app.log.warn({ file: p.file, errors: p.errors }, 'Skipping invalid translation');
  // The session wiring is shared with the in-browser web edition (src/host); the server adds the AI ports.
  const host = createGameHost({
    srd,
    adventures,
    flags: flagRegistry,
    tables,
    translations: i18n.translations,
    ai: {
      parseIntent: async (text, ictx) => (await parseIntent(services.llm, text, ictx)).intent,
      narrator: llmNarrator(() => services.llm, lore, srd, (err) => notices?.report('llm', err)),
      combatNarration: () => settings.get().llm.combatNarration,
      summarizer: llmSummarizer(() => services.llm),
      banter: llmBanter(() => services.llm),
      suggester: (ctx, offered) => suggestIdeas(services.llm, gatherNarrationContext(ctx.state, lore, ctx.adventure, srd, ctx.msgs?.lang), offered, ctx.msgs?.lang),
    },
    saves: {
      save: (slot, meta, state) => saves.save(slot, meta, state).meta,
      autosave: (meta, state) => saves.autosave(meta, state).meta,
      load: (slot) => saves.load(slot).state,
    },
    ...(opts.sessionPorts && { sessionPorts: opts.sessionPorts }),
  });
  const session = host.session;
  app.decorate('session', session);

  // Spoken narration: narration/dialogue lines are voiced in the background (never blocking play).
  notices = new Notices(session);
  const tts = new TtsQueue({ getProvider: () => services.tts, onReady: (entryId) => session.emit({ type: 'tts', entryId }), onError: (err) => notices?.report('tts', err) });
  app.decorate('tts', tts);
  session.on((e) => {
    if (e.type !== 'log' || (e.entry.kind !== 'narration' && e.entry.kind !== 'dialogue')) return;
    const cfg = settings.get().tts;
    tts.setEnabled(cfg.enabled && services.tts.name !== 'mock');
    tts.enqueue({ id: e.entry.id, text: e.entry.text, voice: cfg.narratorVoice });
  });
  app.get<{ Params: { id: string } }>('/api/tts/:id', async (req, reply) => {
    const wav = tts.get(Number.parseInt(req.params.id, 10));
    if (!wav) return reply.code(404).send({ error: 'No audio for that line' });
    return reply.type('audio/wav').send(Buffer.from(wav));
  });
  app.post('/api/tts/skip', async () => {
    tts.clear();
    return { ok: true };
  });
  app.register(async (scope) => {
    scope.get('/ws', { websocket: true }, (socket, req) => {
      // Browsers let any web page open a WebSocket to localhost, so only pages served from this
      // machine may drive the game (non-browser clients send no Origin).
      if (!originAllowed(req.headers.origin)) {
        app.log.warn({ origin: req.headers.origin }, 'Refused a game channel from a foreign origin');
        socket.close(1008, 'Origin not allowed');
        return;
      }
      const seat = opts.seatFor?.(req) ?? HOST_SEAT;
      const off = host.on((e) => socket.send(JSON.stringify(e)));
      // A guest who drops out leaves their characters to the AI until they are back (C003).
      if (seat !== HOST_SEAT) void host.setSeatAway(seat, false);
      socket.on('close', () => {
        off();
        if (seat !== HOST_SEAT) void host.setSeatAway(seat, true);
      });
      socket.on('message', (raw: Buffer) => {
        const err = host.receive(raw.toString(), seat);
        if (err) socket.send(JSON.stringify(err));
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

/** True for no Origin header (non-browser clients) or a page served from this machine (any port). */
export function originAllowed(origin: string | undefined): boolean {
  if (origin === undefined) return true;
  try {
    const host = new URL(origin).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
  } catch {
    return false;
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    settings: SettingsStore;
    services: Services;
    saves: SaveStore;
    session: GameSession;
    tts: TtsQueue;
  }
}
