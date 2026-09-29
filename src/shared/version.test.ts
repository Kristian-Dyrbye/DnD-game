import { describe, expect, it } from 'vitest';
import { GAME_VERSION, SAVE_SCHEMA_VERSION } from './version';

describe('version constants', () => {
  it('uses semver for the game version', () => {
    expect(GAME_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('has a positive integer save schema version', () => {
    expect(Number.isInteger(SAVE_SCHEMA_VERSION)).toBe(true);
    expect(SAVE_SCHEMA_VERSION).toBeGreaterThan(0);
  });
});
