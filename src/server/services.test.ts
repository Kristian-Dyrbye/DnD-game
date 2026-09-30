import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { MockLlm } from '../llm/mock';
import { LlmScheduler } from '../llm/scheduler';
import type { OllamaClient } from '../llm/ollama';
import { defaultSettings, modelFor } from '../shared/settings';
import { MockTts } from '../tts/mock';
import { Services } from './services';
import { SettingsStore } from './settingsStore';
import type { SystemStatus } from '../shared/status';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-status-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('GET /api/status', () => {
  it('reports LLM, TTS and memory', async () => {
    const app = await buildApp({ userDataDir: dir, services: { llm: new MockLlm(), tts: new MockTts() } });
    try {
      const res = await app.inject({ method: 'GET', url: '/api/status' });
      expect(res.statusCode).toBe(200);
      const body = res.json<SystemStatus>();
      expect(body.llm).toMatchObject({ provider: 'mock', reachable: true });
      expect(body.tts).toMatchObject({ provider: 'mock', ready: true });
      expect(body.memory.serverRssMB).toBeGreaterThan(0);
      expect(body.memory.systemTotalMB).toBeGreaterThan(body.memory.systemFreeMB - 1);
    } finally {
      await app.close();
    }
  });
});

describe('Services', () => {
  it('rebuilds the LLM provider when llm settings change', () => {
    const store = new SettingsStore(dir);
    const services = new Services(store, dir);
    const first = services.llm;
    expect(services.llm).toBe(first);
    store.update({ llm: { useMock: true } });
    expect(services.llm).not.toBe(first);
    expect(services.llm.name).toBe('mock');
  });

  it('uses the game language\'s own model (A150: Danish → qwen3:4b-instruct by default)', () => {
    const store = new SettingsStore(dir);
    const services = new Services(store, dir);
    const model = () => ((services.llm as LlmScheduler).inner as OllamaClient).model;
    expect(model()).toBe('llama3.2:3b');
    store.update({ gameplay: { language: 'da' } });
    expect(model()).toBe('qwen3:4b-instruct');
    store.update({ llm: { modelByLanguage: { da: '' } } });
    expect(model()).toBe('llama3.2:3b');
    expect(modelFor(defaultSettings().llm, 'da')).toBe('qwen3:4b-instruct');
    expect(modelFor(defaultSettings().llm)).toBe('llama3.2:3b');
  });

  it('hands out the LLM behind one scheduler (injected providers too)', () => {
    const mock = new MockLlm();
    const services = new Services(new SettingsStore(dir), dir, { llm: mock });
    expect(services.llm).toBeInstanceOf(LlmScheduler);
    expect(services.llm).toBe(services.llm);
    expect((services.llm as LlmScheduler).inner).toBe(mock);
    expect(new Services(new SettingsStore(dir), dir).llm).toBeInstanceOf(LlmScheduler);
  });

  it('reports Piper as missing when not installed', async () => {
    const services = new Services(new SettingsStore(dir), dir);
    const tts = await services.tts.status();
    expect(tts).toMatchObject({ provider: 'piper', ready: false, binaryFound: false });
  });
});

describe('POST /api/llm/backstory', () => {
  it('uses the LLM when available and a template with the mock', async () => {
    const llm = new MockLlm({ handlers: { backstory: () => 'You grew up under the grey peaks of the north, hauling ore until the mine collapsed.' } });
    const withLlm = await buildApp({ userDataDir: dir, services: { llm: Object.assign(Object.create(Object.getPrototypeOf(llm)), llm, { name: 'ollama' }), tts: new MockTts() } });
    const body = { name: 'Brenna', species: 'Dwarf', className: 'Fighter', background: 'Soldier' };
    try {
      const r = await withLlm.inject({ method: 'POST', url: '/api/llm/backstory', payload: body });
      expect(r.json()).toMatchObject({ source: 'llm', text: expect.stringContaining('grey peaks') });
    } finally {
      await withLlm.close();
    }
    const mock = await buildApp({ userDataDir: dir, services: { llm: new MockLlm(), tts: new MockTts() } });
    try {
      const r = await mock.inject({ method: 'POST', url: '/api/llm/backstory', payload: body });
      expect(r.json()).toMatchObject({ source: 'template', text: expect.stringContaining('Brenna') });
      expect((await mock.inject({ method: 'POST', url: '/api/llm/backstory', payload: {} })).statusCode).toBe(400);
    } finally {
      await mock.close();
    }
  });
});
