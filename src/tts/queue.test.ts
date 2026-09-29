import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../server/app';
import { buildCharacter } from '../engine/character/builder';
import { toBuildInput } from '../engine/character/creator';
import { quickBuild } from '../engine/character/quickBuild';
import { Rng } from '../engine/core/rng';
import { loadSrd } from '../engine/data/srdBundle';
import { MockTts } from './mock';
import { speakable, TtsQueue } from './queue';
import { TtsError, type TtsProvider } from './types';

/** A controllable provider: each synthesize() waits until released. */
function slowProvider() {
  const calls: string[] = [];
  const gates: (() => void)[] = [];
  const provider: TtsProvider = {
    name: 'slow',
    synthesize: (text) =>
      new Promise((resolve) => {
        calls.push(text);
        gates.push(() => resolve(new Uint8Array([1, 2, 3])));
      }),
    listVoices: async () => ['v'],
    status: async () => ({ provider: 'slow', ready: true, binaryFound: true, voices: ['v'] }),
  };
  return { provider, calls, release: () => gates.shift()?.() };
}

describe('TtsQueue', () => {
  it('synthesizes in order in the background and caches the audio', async () => {
    const ready: number[] = [];
    const q = new TtsQueue({ getProvider: () => new MockTts(), onReady: (id) => ready.push(id) });
    q.enqueue({ id: 1, text: 'The rain falls.' });
    q.enqueue({ id: 2, text: 'A door creaks.' });
    await q.idle();
    expect(ready).toEqual([1, 2]);
    expect(q.get(1)).toBeInstanceOf(Uint8Array);
  });

  it('drops the oldest pending lines when narration outpaces speech, and can be cleared', async () => {
    const p = slowProvider();
    const ready: number[] = [];
    const q = new TtsQueue({ getProvider: () => p.provider, onReady: (id) => ready.push(id), maxPending: 2 });
    for (let i = 1; i <= 5; i++) q.enqueue({ id: i, text: `line ${i}` });
    // Line 1 is being synthesized; only the newest 2 of the rest wait.
    expect(q.pendingCount).toBe(2);
    p.release();
    await new Promise((r) => setTimeout(r, 0));
    q.clear();
    p.release();
    await q.idle();
    expect(p.calls).toEqual(['line 1', 'line 4']);
    expect(ready).toEqual([1, 4]);
  });

  it('never throws on provider errors and does nothing when disabled', async () => {
    const failing: TtsProvider = { ...new MockTts(), name: 'fail', synthesize: async () => Promise.reject(new TtsError('process', 'boom')), listVoices: async () => [], status: async () => ({ provider: 'fail', ready: false, binaryFound: false, voices: [] }) };
    const ready: number[] = [];
    const q = new TtsQueue({ getProvider: () => failing, onReady: (id) => ready.push(id) });
    q.enqueue({ id: 1, text: 'x' });
    await q.idle();
    expect(ready).toEqual([]);
    q.setEnabled(false);
    q.enqueue({ id: 2, text: 'y' });
    expect(q.pendingCount).toBe(0);
  });

  it('cleans text for speech', () => {
    expect(speakable('**Mayor Hobb** says [nervously]  hello   friend')).toBe('Mayor Hobb says hello friend');
  });
});

describe('TTS in the server', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('voices narration lines, announces them and serves the WAV', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-tts-'));
    try {
      const voice: TtsProvider = { ...new MockTts(), name: 'test-voice', synthesize: (t, o) => new MockTts().synthesize(t, o), listVoices: async () => ['v'], status: async () => ({ provider: 'test-voice', ready: true, binaryFound: true, voices: ['v'] }) };
      app = await buildApp({ savesDir: dir, userDataDir: dir, services: { tts: voice }, sessionPorts: { newSeed: () => 'tts' } });
      await app.ready();
      const events: { type: string; entryId?: number }[] = [];
      app.session.on((e) => events.push(e as { type: string; entryId?: number }));
      const db = loadSrd();
      const hero = buildCharacter(toBuildInput(quickBuild('bard', db, Rng.fromSeed(1))), db);
      await app.session.handle({ type: 'new_game', hero, mode: 'heroic' });
      await app.tts.idle();
      const tts = events.find((e) => e.type === 'tts');
      expect(tts?.entryId).toBeGreaterThan(0);
      const res = await app.inject({ method: 'GET', url: `/api/tts/${tts!.entryId}` });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('audio/wav');
      expect((await app.inject({ method: 'GET', url: '/api/tts/99999' })).statusCode).toBe(404);
      expect((await app.inject({ method: 'POST', url: '/api/tts/skip' })).json()).toEqual({ ok: true });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
