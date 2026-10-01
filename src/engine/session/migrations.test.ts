import { describe, expect, it } from 'vitest';
import { MIGRATIONS, MigrationError, migrateSave, saveVersion, type Migration } from './migrations';
import { SaveFileSchema } from '../../shared/save';
import { SAVE_SCHEMA_VERSION } from '../../shared/version';

/** Fixture: the v0 prototype save format. */
const V0_FIXTURE = {
  version: 0,
  slot: 'slot-1',
  savedAt: '2026-01-02T03:04:05.000Z',
  location: 'Mossgate Inn',
  hardcore: true,
  hero: { name: 'Brenna', level: 3 },
  state: { flags: { 'world.met_innkeeper': true } },
};

describe('save migrations', () => {
  it('detects versions', () => {
    expect(saveVersion({ schemaVersion: 4 })).toBe(4);
    expect(saveVersion({ version: 0 })).toBe(0);
    expect(saveVersion({})).toBe(0);
  });

  it('migrates the v0 fixture to a valid current save', () => {
    const { save, fromVersion, applied } = migrateSave(V0_FIXTURE);
    expect(fromVersion).toBe(0);
    expect(applied[0]).toBe('0→1');
    expect(save.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    const parsed = SaveFileSchema.parse(save);
    expect(parsed.meta).toMatchObject({ characterName: 'Brenna', level: 3, mode: 'hardcore', location: 'Mossgate Inn' });
    expect(parsed.state).toEqual({ flags: { 'world.met_innkeeper': true }, origins: {} });
  });

  it('v1 → v2 (C002): existing companions are marked as roster companions', () => {
    const v1 = { schemaVersion: 1, meta: { slotId: 'slot-1' }, state: { companions: [{ id: 'nettle' }, { id: 'rook' }], flags: {} } };
    const { save, applied } = migrateSave(v1);
    expect(applied).toEqual(['1→2']);
    expect((save.state as Record<string, unknown>).origins).toEqual({ nettle: 'companion', rook: 'companion' });
    // A state without companions gets an empty map.
    expect((migrateSave({ schemaVersion: 1, meta: {}, state: {} }).save.state as Record<string, unknown>).origins).toEqual({});
  });

  it('does not mutate the input', () => {
    const input = structuredClone(V0_FIXTURE);
    migrateSave(input);
    expect(input).toEqual(V0_FIXTURE);
  });

  it('leaves current saves untouched', () => {
    const current = { schemaVersion: SAVE_SCHEMA_VERSION, meta: {}, state: { a: 1 } };
    expect(migrateSave(current)).toEqual({ save: current, fromVersion: SAVE_SCHEMA_VERSION, applied: [] });
  });

  it('chains multiple steps in order', () => {
    const chain: Migration[] = [
      { from: 0, to: 1, description: '', migrate: (s) => ({ ...s, trail: ['a'] }) },
      { from: 1, to: 2, description: '', migrate: (s) => ({ ...s, trail: [...(s.trail as string[]), 'b'] }) },
    ];
    const { save, applied } = migrateSave({}, chain, 2);
    expect(save.trail).toEqual(['a', 'b']);
    expect(save.schemaVersion).toBe(2);
    expect(applied).toEqual(['0→1', '1→2']);
  });

  it('rejects saves from newer versions, gaps and non-objects', () => {
    expect(() => migrateSave({ schemaVersion: 999 })).toThrow(MigrationError);
    expect(() => migrateSave({ schemaVersion: 1 }, [], 2)).toThrow(/No migration from schema 1/);
    expect(() => migrateSave('nope')).toThrow(MigrationError);
    expect(() => migrateSave([1, 2])).toThrow(MigrationError);
  });

  it('has a contiguous chain up to the current version', () => {
    for (let v = 0; v < SAVE_SCHEMA_VERSION; v++) {
      expect(MIGRATIONS.find((m) => m.from === v)?.to).toBe(v + 1);
    }
  });
});
