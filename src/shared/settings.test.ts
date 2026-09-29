import { describe, expect, it } from 'vitest';
import { defaultSettings, mergeSettings, parseSettings, SettingsSchema } from './settings';

describe('settings schema', () => {
  it('fills every field from an empty object', () => {
    const s = defaultSettings();
    expect(s.llm.model).toBe('qwen3:4b');
    expect(s.audio.music).toBe(0.6);
    expect(s.performance.gridMode).toBe('3d');
    expect(s.accessibility.dyslexiaFont).toBe(false);
  });

  it('keeps the objective hint off by default (owner decision)', () => {
    expect(defaultSettings().gameplay.objectiveHint).toBe(false);
  });

  it('fills missing fields inside a partial section', () => {
    const s = parseSettings({ audio: { master: 0.2 } });
    expect(s.audio.master).toBe(0.2);
    expect(s.audio.sfx).toBe(0.8);
  });

  it('rejects out-of-range values', () => {
    expect(SettingsSchema.safeParse({ audio: { master: 1.5 } }).success).toBe(false);
    expect(SettingsSchema.safeParse({ llm: { combatNarration: 'sometimes' } }).success).toBe(false);
  });

  it('merges a patch section by section and ignores unknown sections', () => {
    const merged = parseSettings(mergeSettings(defaultSettings(), { llm: { model: 'x:1b' }, bogus: { a: 1 } }));
    expect(merged.llm.model).toBe('x:1b');
    expect(merged.llm.fallbackModel).toBe('llama3.2:3b');
    expect(merged).not.toHaveProperty('bogus');
  });
});
