import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MODEL,
  GAME_PORT,
  configuredModel,
  modelInstalled,
  nodeIsSupported,
  nodeMajor,
  startDecision,
  type StartChecks,
} from '../scripts/check-deps-lib.mjs';
import { defaultSettings } from '../src/shared/settings';
import { DEFAULT_PORT } from '../src/server/port';

const ready: StartChecks = {
  nodeVersion: 'v22.1.0',
  nodeOk: true,
  gameAlreadyRunning: false,
  depsInstalled: true,
  ollamaInstalled: true,
  ollamaRunning: true,
  modelInstalled: true,
  model: 'qwen3:4b',
};

describe('check-deps helpers', () => {
  it('stays in sync with the game defaults', () => {
    expect(DEFAULT_MODEL).toBe(defaultSettings().llm.model);
    expect(GAME_PORT).toBe(DEFAULT_PORT);
  });

  it('parses Node versions', () => {
    expect(nodeMajor('v26.3.0')).toBe(26);
    expect(nodeIsSupported('v18.19.0')).toBe(false);
    expect(nodeIsSupported('v20.0.0')).toBe(true);
    expect(nodeMajor('garbage')).toBe(0);
  });

  it('reads the model from settings text', () => {
    expect(configuredModel('{"llm":{"model":"llama3.2:3b"}}')).toBe('llama3.2:3b');
    expect(configuredModel('{"llm":{}}')).toBe(DEFAULT_MODEL);
    expect(configuredModel('{broken')).toBe(DEFAULT_MODEL);
  });

  it('matches installed models, including :latest', () => {
    const tags = { models: [{ name: 'qwen3:4b' }, { name: 'llama3.2:latest' }] };
    expect(modelInstalled(tags, 'qwen3:4b')).toBe(true);
    expect(modelInstalled(tags, 'llama3.2')).toBe(true);
    expect(modelInstalled(tags, 'gemma3:4b')).toBe(false);
    expect(modelInstalled(null, 'qwen3:4b')).toBe(false);
  });
});

describe('startDecision', () => {
  it('starts normally when everything is ready', () => {
    const d = startDecision(ready);
    expect(d.exitCode).toBe(0);
    expect(d.messages.join('\n')).toContain('AI Dungeon Master ready');
  });

  it('still starts (with a warning) without Ollama', () => {
    const d = startDecision({ ...ready, ollamaInstalled: false, ollamaRunning: false, modelInstalled: false });
    expect(d.exitCode).toBe(0);
    expect(d.messages.join('\n')).toContain('[WARN] Ollama is not installed');
  });

  it('warns when the model is missing', () => {
    expect(startDecision({ ...ready, modelInstalled: false }).messages.join()).toContain('not downloaded');
  });

  it('asks for Setup.bat when packages are missing', () => {
    const d = startDecision({ ...ready, depsInstalled: false });
    expect(d.exitCode).toBe(1);
    expect(d.messages[0]).toContain('Setup.bat');
  });

  it('fails on old Node and detects an already running game', () => {
    expect(startDecision({ ...ready, nodeOk: false }).exitCode).toBe(1);
    expect(startDecision({ ...ready, gameAlreadyRunning: true }).exitCode).toBe(3);
  });
});
