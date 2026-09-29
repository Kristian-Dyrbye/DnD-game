import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SETTINGS_FILE, SettingsStore } from './settingsStore';
import { buildApp } from './app';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-settings-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('SettingsStore', () => {
  it('returns defaults when no file exists', () => {
    expect(new SettingsStore(dir).get().llm.model).toBe('qwen3:4b');
  });

  it('persists updates and reloads them', () => {
    const store = new SettingsStore(dir);
    const res = store.update({ audio: { music: 0.1 } });
    expect(res.ok).toBe(true);
    expect(new SettingsStore(dir).get().audio.music).toBe(0.1);
  });

  it('rejects invalid updates without changing settings', () => {
    const store = new SettingsStore(dir);
    const res = store.update({ audio: { music: 7 } });
    expect(res.ok).toBe(false);
    expect(store.get().audio.music).toBe(0.6);
  });

  it('survives a corrupt file', () => {
    fs.writeFileSync(path.join(dir, SETTINGS_FILE), '{not json');
    expect(new SettingsStore(dir).get().llm.model).toBe('qwen3:4b');
  });

  it('keeps valid fields when some fields are invalid', () => {
    fs.writeFileSync(
      path.join(dir, SETTINGS_FILE),
      JSON.stringify({ audio: { music: 0.3, sfx: 99 }, llm: { model: 'mine:3b' } }),
    );
    const s = new SettingsStore(dir).get();
    expect(s.audio.music).toBe(0.3);
    expect(s.audio.sfx).toBe(0.8);
    expect(s.llm.model).toBe('mine:3b');
  });
});

describe('settings routes', () => {
  it('GET and PUT /api/settings', async () => {
    const app = await buildApp({ userDataDir: dir });
    try {
      const get = await app.inject({ method: 'GET', url: '/api/settings' });
      expect(get.json().gameplay.objectiveHint).toBe(false);

      const put = await app.inject({ method: 'PUT', url: '/api/settings', payload: { gameplay: { objectiveHint: true } } });
      expect(put.statusCode).toBe(200);
      expect(put.json().gameplay.objectiveHint).toBe(true);

      const bad = await app.inject({ method: 'PUT', url: '/api/settings', payload: { audio: { master: -1 } } });
      expect(bad.statusCode).toBe(400);
      expect(bad.json().error).toContain('audio.master');
    } finally {
      await app.close();
    }
  });
});
