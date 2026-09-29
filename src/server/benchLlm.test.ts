import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs script helpers without type declarations
import { INTENT_TASKS, parseIntentReply, pickBest, scoreModel } from '../../scripts/bench-llm-lib.mjs';

describe('LLM benchmark helpers (A010, runnable once Ollama is installed)', () => {
  it('validates intent JSON replies, tolerating think blocks and chatter', () => {
    expect(parseIntentReply('{"action":"attack","target":"cultist"}')).toBe('attack');
    expect(parseIntentReply('<think>hmm</think> Sure! {"action": "rest"}')).toBe('rest');
    expect(parseIntentReply('{"action":"dance"}')).toBeNull();
    expect(parseIntentReply('not json')).toBeNull();
    expect(INTENT_TASKS.length).toBeGreaterThanOrEqual(5);
  });

  it('scores JSON validity first, then sense and speed, and penalises models over the memory budget', () => {
    const good = { model: 'a', jsonValid: 5, jsonTotal: 5, intentSensible: 5, tokensPerSecond: 20, firstTokenMs: 800, memoryMB: 2600 };
    const sloppy = { ...good, model: 'b', jsonValid: 3, intentSensible: 3 };
    const fat = { ...good, model: 'c', memoryMB: 5200 };
    expect(scoreModel(good)).toBeGreaterThan(scoreModel(sloppy));
    expect(scoreModel(good)).toBeGreaterThan(scoreModel(fat));
    expect(scoreModel({ ...good, error: 'x' })).toBe(-1);
    expect(pickBest([sloppy, fat, good]).model).toBe('a');
  });
});
