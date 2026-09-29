import { describe, expect, it } from 'vitest';
import { llmIndicator, memoryIndicator, ttsIndicator } from './status';
import type { LlmStatus } from '../llm/types';

const llm = (p: Partial<LlmStatus>): LlmStatus => ({
  provider: 'ollama',
  reachable: true,
  model: 'qwen3:4b',
  modelAvailable: true,
  modelLoaded: true,
  ...p,
});

describe('status indicators', () => {
  it('maps LLM states to lights', () => {
    expect(llmIndicator(llm({})).light).toBe('ok');
    expect(llmIndicator(llm({ modelLoaded: false })).light).toBe('warn');
    expect(llmIndicator(llm({ modelAvailable: false })).label).toBe('AI: no model');
    expect(llmIndicator(llm({ reachable: false })).light).toBe('error');
    expect(llmIndicator(llm({ provider: 'mock' })).label).toBe('AI: mock');
  });

  it('maps TTS states to lights', () => {
    const ready = { provider: 'piper', ready: true, binaryFound: true, voices: ['a'] };
    expect(ttsIndicator(ready, true).light).toBe('ok');
    expect(ttsIndicator(ready, false).light).toBe('off');
    expect(ttsIndicator({ ...ready, ready: false }, true).light).toBe('error');
  });

  it('warns on low free memory', () => {
    const m = { serverRssMB: 100, systemTotalMB: 8192 };
    expect(memoryIndicator({ ...m, systemFreeMB: 3000 }).light).toBe('ok');
    expect(memoryIndicator({ ...m, systemFreeMB: 800 }).light).toBe('warn');
    expect(memoryIndicator({ ...m, systemFreeMB: 300 }).light).toBe('error');
  });
});
