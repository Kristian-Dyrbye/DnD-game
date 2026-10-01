/**
 * End-to-end fallback checks (spec §17): with Ollama down and Piper missing, the game still plays —
 * template narration, keyword intents, data suggestions, template summaries — and the player gets
 * one friendly notice per problem instead of errors.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildCharacter } from '../engine/character/builder';
import { toBuildInput } from '../engine/character/creator';
import { quickBuild } from '../engine/character/quickBuild';
import { Rng } from '../engine/core/rng';
import { loadSrd } from '../engine/data/srdBundle';
import { GameSession } from '../engine/session/GameSession';
import { LlmError, type LlmProvider } from '../llm/types';
import type { ServerEvent } from '../shared/protocol';
import { TtsError, type TtsProvider } from '../tts/types';
import { buildApp } from './app';
import { llmNoticeText, Notices, ttsNoticeText } from './notices';

const downLlm: LlmProvider = {
  name: 'ollama',
  chat: async () => {
    throw new LlmError('unreachable', 'connect ECONNREFUSED 127.0.0.1:11434');
  },
  stream: async function* () {
    throw new LlmError('unreachable', 'connect ECONNREFUSED 127.0.0.1:11434');
  },
  listModels: async () => {
    throw new LlmError('unreachable', 'down');
  },
  status: async () => ({ provider: 'ollama', reachable: false, model: 'qwen3:4b', modelAvailable: false, modelLoaded: false, error: 'down' }),
};
const noPiper: TtsProvider = {
  name: 'piper',
  synthesize: async () => {
    throw new TtsError('not_installed', 'tools/piper/piper.exe not found');
  },
  listVoices: async () => [],
  status: async () => ({ provider: 'piper', ready: false, binaryFound: false, voices: [] }),
};

let app: FastifyInstance | undefined;
let dir = '';
afterEach(async () => {
  await app?.close();
  app = undefined;
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

describe('fallbacks end to end', () => {
  it('plays on with Ollama down and Piper missing, with one notice each', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-fallback-'));
    app = await buildApp({ userDataDir: dir, savesDir: dir, services: { llm: downLlm, tts: noPiper }, sessionPorts: { newSeed: () => 'fallback' } });
    await app.ready();
    const events: ServerEvent[] = [];
    app.session.on((e) => events.push(e));
    const db = loadSrd();
    const hero = buildCharacter(toBuildInput(quickBuild('fighter', db, Rng.fromSeed(1))), db);

    await app.session.handle({ type: 'new_game', hero, mode: 'heroic' });
    await app.tts.idle();
    const logs = () => events.filter((e): e is Extract<ServerEvent, { type: 'log' }> => e.type === 'log').map((e) => e.entry.text);
    // Template narration of the opening scene.
    expect(logs().some((t) => t.includes("Millbrook's green at dusk"))).toBe(true);
    // Friendly notices, once each.
    expect(logs().filter((t) => t === llmNoticeText(new LlmError('unreachable', 'x')))).toHaveLength(1);
    expect(logs().filter((t) => t === ttsNoticeText(new TtsError('not_installed', 'x')))).toHaveLength(1);
    // Data-driven suggestions still arrive.
    expect(events.some((e) => e.type === 'suggestions' && e.actions.length > 0)).toBe(true);

    // Free text → keyword intent fallback → the action happens.
    await app.session.handle({ type: 'say', text: 'I examine the chalk on the stones' });
    await app.tts.idle();
    expect(app.session.current.flags['arc.starter.sigil_found']).toBe(true);
    // Still just one notice each after more failures.
    expect(logs().filter((t) => t === llmNoticeText(new LlmError('unreachable', 'x')))).toHaveLength(1);
    expect(events.filter((e) => e.type === 'error')).toEqual([]);

    // Scene change → summary falls back to the template.
    await app.session.handle({ type: 'choose', actionId: 'exit.tavern' });
    await new Promise((r) => setTimeout(r, 20));
    expect(app.session.current.summary.length).toBeGreaterThan(0);

    // The status endpoint explains the state for the status lights.
    const status = (await app.inject({ method: 'GET', url: '/api/status' })).json() as { llm: { reachable: boolean }; tts: { ready: boolean } };
    expect(status.llm.reachable).toBe(false);
    expect(status.tts.ready).toBe(false);
  });
});

describe('notices', () => {
  it('are throttled per kind and explain the likely fix', () => {
    const session = new GameSession();
    session.start({ campaignId: 'c', mode: 'heroic', rng: [1, 2, 3, 4], hero: buildCharacter(toBuildInput(quickBuild('wizard', loadSrd(), Rng.fromSeed(2))), loadSrd()), location: { name: 'x' } });
    let now = 0;
    const n = new Notices(session, 1000, () => now);
    n.report('llm', new LlmError('timeout', 'slow'));
    n.report('llm', new LlmError('timeout', 'slow'));
    now = 2000;
    n.report('llm', new LlmError('unreachable', 'down'));
    n.report('tts', new TtsError('no_voice', 'missing'));
    const lines = session.current.log.map((l) => l.text);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/taking too long/);
    expect(lines[1]).toMatch(/not running/);
    expect(lines[2]).toMatch(/voice is missing/);
    expect(llmNoticeText(new LlmError('http', 'model "x" not found, try pulling it first'))).toMatch(/not installed/);
  });

  it('stay silent for aborts the game chose itself (B013)', () => {
    const session = new GameSession();
    session.start({ campaignId: 'c', mode: 'heroic', rng: [1, 2, 3, 4], hero: buildCharacter(toBuildInput(quickBuild('wizard', loadSrd(), Rng.fromSeed(2))), loadSrd()), location: { name: 'x' } });
    const n = new Notices(session);
    n.report('llm', new LlmError('aborted', 'Request aborted'));
    n.report('tts', new TtsError('aborted', 'TTS aborted'));
    expect(session.current.log).toHaveLength(0);
    n.report('llm', new LlmError('timeout', 'slow'));
    expect(session.current.log).toHaveLength(1);
  });
});
