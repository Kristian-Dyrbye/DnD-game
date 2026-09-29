import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { MockLlm } from '../llm/mock';
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

  it('reports Piper as missing when not installed', async () => {
    const services = new Services(new SettingsStore(dir), dir);
    const tts = await services.tts.status();
    expect(tts).toMatchObject({ provider: 'piper', ready: false, binaryFound: false });
  });
});
