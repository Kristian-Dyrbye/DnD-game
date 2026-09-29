import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { MockLlm } from '../llm/mock';
import type { LlmProvider } from '../llm/types';
import { applyPreset, defaultSettings, PERFORMANCE_PRESETS } from '../shared/settings';
import { MockTts } from '../tts/mock';
import { buildApp } from './app';

let app: FastifyInstance | undefined;
let dir = '';
afterEach(async () => {
  await app?.close();
  app = undefined;
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

async function build(llm: LlmProvider) {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-settings-'));
  app = await buildApp({ userDataDir: dir, savesDir: dir, services: { llm, tts: new MockTts(['en_GB-cori-medium', 'en_US-amy-low']) } });
  return app;
}

describe('performance presets', () => {
  it('low is light enough for 8 GB machines; custom keeps values', () => {
    expect(PERFORMANCE_PRESETS.low).toMatchObject({ gridMode: '2d', shadows: 'off', fpsCap: 30 });
    const cur = defaultSettings().performance;
    expect(applyPreset(cur, 'high')).toMatchObject({ preset: 'high', shadows: 'high' });
    expect(applyPreset({ ...cur, fpsCap: 45 }, 'custom')).toMatchObject({ preset: 'custom', fpsCap: 45 });
  });
});

describe('settings helper routes', () => {
  it('lists models and voices', async () => {
    const a = await build(new MockLlm({ model: 'qwen3:4b' }));
    expect((await a.inject({ method: 'GET', url: '/api/llm/models' })).json()).toEqual({ models: ['qwen3:4b'] });
    expect((await a.inject({ method: 'GET', url: '/api/tts/voices' })).json()).toEqual({ voices: ['en_GB-cori-medium', 'en_US-amy-low'] });
  });

  it('tests the LLM connection and explains failures', async () => {
    const ok = await build(new MockLlm({ script: ['ready'] }));
    expect((await ok.inject({ method: 'POST', url: '/api/llm/test' })).json()).toMatchObject({ ok: true, provider: 'mock', reply: 'ready' });
    await app!.close();
    fs.rmSync(dir, { recursive: true, force: true });

    const down: LlmProvider = {
      name: 'ollama',
      chat: async () => '',
      stream: async function* () {},
      listModels: async () => {
        throw new Error('down');
      },
      status: async () => ({ provider: 'ollama', reachable: false, model: 'qwen3:4b', modelAvailable: false, modelLoaded: false, error: 'Ollama is not running at http://127.0.0.1:11434' }),
    };
    const bad = await build(down);
    expect((await bad.inject({ method: 'POST', url: '/api/llm/test' })).json()).toEqual({ ok: false, provider: 'ollama', error: 'Ollama is not running at http://127.0.0.1:11434' });
    expect((await bad.inject({ method: 'GET', url: '/api/llm/models' })).json()).toEqual({ models: [] });
  });

  it('saves partial settings patches (accessibility, performance)', async () => {
    const a = await build(new MockLlm());
    const res = await a.inject({ method: 'PUT', url: '/api/settings', payload: { accessibility: { textScale: 1.5, dyslexiaFont: true } } });
    expect(res.json()).toMatchObject({ accessibility: { textScale: 1.5, dyslexiaFont: true, colorblindOverlays: false } });
    const bad = await a.inject({ method: 'PUT', url: '/api/settings', payload: { accessibility: { textScale: 5 } } });
    expect(bad.statusCode).toBe(400);
  });
});
