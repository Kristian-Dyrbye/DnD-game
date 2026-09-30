/**
 * A125: web edition saves + settings. IndexedDB-backed save slots (fake-indexeddb stands in for the
 * browser), rotating autosaves and thumbnails surviving a reopen, Export/Import validation, the
 * memory-only fallback, localStorage settings with defaults on failure, and the web edition wiring.
 */
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { openBrowserSaves } from '../src/host/indexedDbSaves';
import { MemorySaves, type SaveBackend } from '../src/host/memorySaves';
import { browserSaveLibrary, exportFileName, saveLibrary } from '../src/client/net/saveLibrary';
import { LOCAL_SETTINGS_KEY, localSettingsBackend } from '../src/client/ui/settingsState';
import { startWebEdition } from '../src/client/webEdition';
import { newGameState, type SessionSaveMeta } from '../src/engine/session/GameSession';
import { parseSaveText } from '../src/engine/session/saveFile';
import { buildCharacter } from '../src/engine/character/builder';
import { toBuildInput } from '../src/engine/character/creator';
import { quickBuild } from '../src/engine/character/quickBuild';
import { Rng } from '../src/engine/core/rng';
import { loadSrd } from '../src/engine/data/srdBundle';
import { SAVE_SCHEMA_VERSION } from '../src/shared/version';
import type { ServerEvent } from '../src/shared/protocol';

const db = loadSrd();
const hero = buildCharacter(toBuildInput(quickBuild('fighter', db, Rng.fromSeed(7))), db);
const state = newGameState(hero, 'heroic', 'browser-saves');
const meta = (name: string, thumbnail?: string): SessionSaveMeta => ({ name, characterName: hero.name, level: 1, location: 'Millbrook', mode: 'heroic', playTimeMinutes: 3, ...(thumbnail && { thumbnail }) });

let clock = Date.parse('2026-09-30T10:00:00Z');
const now = () => new Date((clock += 1000));

function memoryStorage(): Storage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    key: (i) => [...data.keys()][i] ?? null,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, String(v)),
    removeItem: (k) => void data.delete(k),
  };
}

describe('IndexedDB saves', () => {
  it('keeps slots, rotating autosaves and thumbnails across a reopen', async () => {
    const idb = new IDBFactory();
    const first = await openBrowserSaves(idb, { now });
    expect(first.persistent).toBe(true);
    first.saves.save('slot-1', meta('Manual', 'data:image/png;base64,AAA'), state);
    for (let i = 1; i <= 4; i++) first.saves.autosave(meta(`Auto ${i}`), state);
    await first.saves.flush();

    const again = await openBrowserSaves(idb, { now });
    const list = again.saves.list().map((e) => (e.ok ? [e.meta.slotId, e.meta.name] : ['bad', e.slotId]));
    expect(list).toEqual([
      ['auto-1', 'Auto 4'],
      ['auto-2', 'Auto 3'],
      ['auto-3', 'Auto 2'],
      ['slot-1', 'Manual'],
    ]);
    expect(again.saves.file('slot-1').meta.thumbnail).toBe('data:image/png;base64,AAA');
    expect(again.saves.file('auto-1').schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    expect(again.saves.load('slot-1')).toEqual(JSON.parse(JSON.stringify(state)));

    again.saves.delete('slot-1');
    await again.saves.flush();
    const third = await openBrowserSaves(idb, { now });
    expect(third.saves.list().map((e) => (e.ok ? e.meta.slotId : e.slotId))).not.toContain('slot-1');
    expect(() => third.saves.delete('slot-1')).toThrow(/No save/);
  });

  it('falls back to memory-only saves when IndexedDB is missing or refused', async () => {
    expect((await openBrowserSaves(undefined)).persistent).toBe(false);
    const refusing = { open: () => { throw new Error('SecurityError'); } } as unknown as IDBFactory;
    const fallback = await openBrowserSaves(refusing);
    expect(fallback.persistent).toBe(false);
    fallback.saves.save('slot-1', meta('Still works'), state);
    expect(fallback.saves.list()).toHaveLength(1);
  });

  it('a failing backend write is reported but never stops play', async () => {
    const errors: unknown[] = [];
    const backend: SaveBackend = { readAll: async () => [], write: async () => { throw new Error('QuotaExceededError'); }, remove: async () => undefined };
    const saves = await MemorySaves.open(backend, { onError: (e) => errors.push(e) });
    saves.autosave(meta('A'), state);
    saves.autosave(meta('B'), state);
    await saves.flush();
    expect(errors.length).toBeGreaterThan(0);
    expect(saves.list()).toHaveLength(2);
  });
});

describe('export / import', () => {
  it('an exported file imports as a new manual save', async () => {
    const saves = new MemorySaves({ now });
    saves.autosave(meta('Road', 'data:image/png;base64,BBB'), state);
    const lib = browserSaveLibrary(saves);
    const exported = await lib.exportFile('auto-1');
    expect(exportFileName(exported.meta)).toMatch(/^solo-dnd-[a-z0-9-]+-\d{4}-\d{2}-\d{2}\.json$/);
    const imported = await lib.importText(JSON.stringify(exported, null, 2));
    expect(imported).toMatchObject({ kind: 'manual', name: 'Road', thumbnail: 'data:image/png;base64,BBB' });
    expect(imported.slotId).toMatch(/^import-/);
    expect((await lib.list()).map((m) => m.slotId)).toContain(imported.slotId);
    expect(saves.load(imported.slotId)).toEqual(saves.load('auto-1'));
  });

  it('refuses files that are not valid saves', async () => {
    const lib = browserSaveLibrary(new MemorySaves());
    const good = { schemaVersion: SAVE_SCHEMA_VERSION, meta: { ...meta('x'), slotId: 'slot-1', kind: 'manual', savedAt: new Date().toISOString() }, state };
    await expect(lib.importText('{ not json')).rejects.toThrow(/not valid JSON/);
    await expect(lib.importText('[1,2]')).rejects.toThrow(/not a JSON object/);
    await expect(lib.importText(JSON.stringify({ ...good, meta: { name: 'x' } }))).rejects.toThrow(/Not a save file/);
    await expect(lib.importText(JSON.stringify({ ...good, state: { hero: 'bad' } }))).rejects.toThrow(/damaged/);
    await expect(lib.importText(JSON.stringify({ ...good, schemaVersion: SAVE_SCHEMA_VERSION + 1 }))).rejects.toThrow(/newer game version/);
    expect(parseSaveText(JSON.stringify(good)).meta.name).toBe('x');
    expect(await lib.list()).toEqual([]);
  });
});

describe('localStorage settings', () => {
  it('defaults, persists patches and salvages bad fields', async () => {
    const storage = memoryStorage();
    const first = localSettingsBackend(storage);
    const defaults = await first.load();
    expect(defaults.gameplay.objectiveHint).toBe(false);
    const updated = await first.update({ gameplay: { objectiveHint: true }, audio: { music: 0.25 } });
    expect(updated?.gameplay.objectiveHint).toBe(true);
    expect(await first.update({ audio: { music: 7 } })).toBeNull(); // out of range → refused
    expect(JSON.parse(storage.data.get(LOCAL_SETTINGS_KEY)!).audio.music).toBe(0.25);

    const stored = JSON.parse(storage.data.get(LOCAL_SETTINGS_KEY)!);
    stored.audio.master = 'loud';
    storage.data.set(LOCAL_SETTINGS_KEY, JSON.stringify(stored));
    const salvaged = await localSettingsBackend(storage).load();
    expect(salvaged.audio.music).toBe(0.25);
    expect(salvaged.audio.master).toBe(defaults.audio.master);
    expect(salvaged.gameplay.objectiveHint).toBe(true);
  });

  it('works with broken or blocked storage', async () => {
    const broken = { getItem: () => { throw new Error('SecurityError'); }, setItem: () => { throw new Error('QuotaExceededError'); } };
    const b = localSettingsBackend(broken);
    expect((await b.load()).gameplay.objectiveHint).toBe(false);
    expect((await b.update({ gameplay: { objectiveHint: true } }))?.gameplay.objectiveHint).toBe(true);
    expect((await b.load()).gameplay.objectiveHint).toBe(true);
    const garbage = memoryStorage();
    garbage.data.set(LOCAL_SETTINGS_KEY, '{oops');
    expect(await localSettingsBackend(garbage).load()).toEqual(await localSettingsBackend(memoryStorage()).load());
    expect((await localSettingsBackend(undefined).load()).gameplay.objectiveHint).toBe(false);
  });
});

describe('web edition wiring', () => {
  it('the in-page game autosaves into IndexedDB and the save browser sees it after a reload', async () => {
    const idb = new IDBFactory();
    const { transport, saves, persistent } = await startWebEdition({ indexedDB: idb, storage: memoryStorage() });
    expect(persistent).toBe(true);
    const events: ServerEvent[] = [];
    transport.connect({ onEvent: (e) => events.push(e), onStatus: () => undefined });
    transport.send({ type: 'new_game', hero, mode: 'heroic', seed: 'web-edition' });
    await until(() => events.some((e) => e.type === 'saved'));
    await transport.idle();
    expect(events.filter((e) => e.type === 'error')).toEqual([]);
    transport.send({ type: 'save', slot: 'slot-1', name: 'Before the barrow' });
    await transport.idle();
    // The save browser reads the same store the game writes to.
    expect((await saveLibrary().list()).map((m) => m.slotId).sort()).toEqual(['auto-1', 'slot-1']);

    // A "reload": a fresh web edition over the same database.
    await saves.flush();
    const reloaded = await startWebEdition({ indexedDB: idb, storage: memoryStorage() });
    expect((await saveLibrary().list()).map((m) => m.name)).toContain('Before the barrow');
    const loadEvents: ServerEvent[] = [];
    reloaded.transport.connect({ onEvent: (e) => loadEvents.push(e), onStatus: () => undefined });
    reloaded.transport.send({ type: 'load', slot: 'slot-1' });
    await until(() => loadEvents.some((e) => e.type === 'snapshot'));
    await reloaded.transport.idle();
    expect(loadEvents.filter((e) => e.type === 'error')).toEqual([]);
    const snap = loadEvents.find((e): e is Extract<ServerEvent, { type: 'snapshot' }> => e.type === 'snapshot')!;
    expect(snap.state.hero.name).toBe(hero.name);
  });
});

async function until(cond: () => boolean | Promise<boolean>, ms = 15_000): Promise<void> {
  const start = Date.now();
  while (!(await cond())) {
    if (Date.now() - start > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}
