import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AUTOSAVE_SLOTS, SaveError, SaveStore, type SaveMetaInput } from './saveStore';
import { buildApp } from './app';
import { MockLlm } from '../llm/mock';
import { MockTts } from '../tts/mock';
import type { SaveListEntry } from '../shared/save';
import { SAVE_SCHEMA_VERSION } from '../shared/version';
import { newGameState } from '../engine/session/GameSession';
import { buildCharacter } from '../engine/character/builder';
import { toBuildInput } from '../engine/character/creator';
import { quickBuild } from '../engine/character/quickBuild';
import { Rng } from '../engine/core/rng';
import { loadSrd } from '../engine/data/srdBundle';

let dir: string;
let clock: number;
const meta: SaveMetaInput = { name: 'Before the crypt', characterName: 'Brenna', level: 2, location: 'Old Crypt', mode: 'heroic' };

function store() {
  return new SaveStore(dir, () => new Date(clock++ * 1000));
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-saves-'));
  clock = 1_700_000_000;
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('SaveStore', () => {
  it('saves and loads a slot', () => {
    const s = store();
    s.save('slot-1', meta, { hp: 12 });
    const loaded = s.load('slot-1');
    expect(loaded.state).toEqual({ hp: 12 });
    expect(loaded.meta).toMatchObject({ slotId: 'slot-1', kind: 'manual', characterName: 'Brenna' });
    expect(fs.existsSync(path.join(dir, 'slot-1.json.tmp'))).toBe(false);
  });

  it('lists saves newest first, with corrupt files last', () => {
    const s = store();
    s.save('a', meta, {});
    s.save('b', { ...meta, name: 'Later' }, {});
    fs.writeFileSync(path.join(dir, 'broken.json'), '{oops');
    const list = s.list();
    expect(list.map((e) => (e.ok ? e.meta.slotId : e.slotId))).toEqual(['b', 'a', 'broken']);
    expect(list[2]).toMatchObject({ ok: false });
  });

  it('migrates old saves on load', () => {
    fs.writeFileSync(path.join(dir, 'old.json'), JSON.stringify({ version: 0, hero: { name: 'Old', level: 1 }, state: {} }));
    const loaded = store().load('old');
    expect(loaded.meta.characterName).toBe('Old');
    expect(loaded.meta.slotId).toBe('old');
  });

  it('rotates autosaves', () => {
    const s = store();
    s.autosave(meta, { n: 1 });
    s.autosave(meta, { n: 2 });
    s.autosave(meta, { n: 3 });
    s.autosave(meta, { n: 4 });
    expect(AUTOSAVE_SLOTS.map((slot) => (s.load(slot).state as { n: number }).n)).toEqual([4, 3, 2]);
    expect(s.load('auto-1').meta.kind).toBe('auto');
  });

  it('rejects path traversal and bad metadata', () => {
    const s = store();
    expect(() => s.save('../evil', meta, {})).toThrow(SaveError);
    expect(() => s.load('..\\evil')).toThrow(/Invalid slot/);
    expect(() => s.save('ok', { ...meta, level: 99 }, {})).toThrow(/level/);
  });

  it('deletes saves and reports missing ones', () => {
    const s = store();
    s.save('x', meta, {});
    s.delete('x');
    expect(() => s.load('x')).toThrow(/No save/);
    expect(() => s.delete('x')).toThrow(SaveError);
  });

  it('returns an empty list when the folder does not exist', () => {
    expect(new SaveStore(path.join(dir, 'nope')).list()).toEqual([]);
  });
});

describe('save routes', () => {
  it('supports put, list, get and delete', async () => {
    const app = await buildApp({ userDataDir: dir, savesDir: path.join(dir, 'saves'), services: { llm: new MockLlm(), tts: new MockTts() } });
    try {
      const put = await app.inject({ method: 'PUT', url: '/api/saves/slot-1', payload: { meta, state: { gold: 5 } } });
      expect(put.statusCode).toBe(200);
      const list = (await app.inject({ method: 'GET', url: '/api/saves' })).json<SaveListEntry[]>();
      expect(list).toHaveLength(1);
      const got = await app.inject({ method: 'GET', url: '/api/saves/slot-1' });
      expect(got.json().state).toEqual({ gold: 5 });
      expect((await app.inject({ method: 'DELETE', url: '/api/saves/slot-1' })).statusCode).toBe(204);
      expect((await app.inject({ method: 'GET', url: '/api/saves/slot-1' })).statusCode).toBe(404);
      expect((await app.inject({ method: 'PUT', url: '/api/saves/BAD..', payload: { meta, state: {} } })).statusCode).toBe(400);
      expect((await app.inject({ method: 'PUT', url: '/api/saves/x', payload: { state: {} } })).statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('imports an exported save file after validating it', async () => {
    const app = await buildApp({ userDataDir: dir, savesDir: path.join(dir, 'saves'), services: { llm: new MockLlm(), tts: new MockTts() } });
    try {
      const db = loadSrd();
      const state = newGameState(buildCharacter(toBuildInput(quickBuild('rogue', db, Rng.fromSeed(3))), db), 'heroic', 'import');
      const file = { schemaVersion: SAVE_SCHEMA_VERSION, meta: { ...meta, slotId: 'elsewhere', kind: 'auto', savedAt: '2026-01-01T00:00:00Z' }, state };
      const res = await app.inject({ method: 'POST', url: '/api/saves/import-abc/import', payload: file });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ slotId: 'import-abc', kind: 'manual', name: meta.name });
      expect((await app.inject({ method: 'GET', url: '/api/saves/import-abc' })).json().state.hero.name).toBe(state.hero.name);
      const bad = await app.inject({ method: 'POST', url: '/api/saves/import-bad/import', payload: { ...file, state: { hero: 1 } } });
      expect(bad.statusCode).toBe(400);
      expect(bad.json().error).toMatch(/damaged/);
    } finally {
      await app.close();
    }
  });
});
