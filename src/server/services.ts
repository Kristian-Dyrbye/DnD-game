/**
 * Holds the LLM and TTS providers. Providers are rebuilt when their settings section changes
 * (e.g. the player picks another model). Tests can inject fixed providers instead.
 */
import os from 'node:os';
import type { LlmProvider } from '../llm/types';
import { createLlmProvider } from '../llm/provider';
import type { TtsProvider } from '../tts/types';
import { createTtsProvider } from '../tts/provider';
import type { SystemStatus } from '../shared/status';
import type { SettingsStore } from './settingsStore';

export interface ServiceOverrides {
  llm?: LlmProvider;
  tts?: TtsProvider;
}

export class Services {
  private llmCache?: { key: string; provider: LlmProvider };
  private ttsCache?: { key: string; provider: TtsProvider };

  constructor(
    private readonly settings: SettingsStore,
    private readonly rootDir: string,
    private readonly overrides: ServiceOverrides = {},
  ) {}

  get llm(): LlmProvider {
    if (this.overrides.llm) return this.overrides.llm;
    const cfg = this.settings.get().llm;
    const key = JSON.stringify(cfg);
    if (this.llmCache?.key !== key) this.llmCache = { key, provider: createLlmProvider(cfg) };
    return this.llmCache.provider;
  }

  get tts(): TtsProvider {
    if (this.overrides.tts) return this.overrides.tts;
    const cfg = this.settings.get().tts;
    const key = JSON.stringify(cfg);
    if (this.ttsCache?.key !== key) this.ttsCache = { key, provider: createTtsProvider(cfg, this.rootDir) };
    return this.ttsCache.provider;
  }

  async status(): Promise<SystemStatus> {
    const [llm, tts] = await Promise.all([this.llm.status(), this.tts.status()]);
    const mb = (bytes: number) => Math.round(bytes / 1024 / 1024);
    return {
      llm,
      tts,
      memory: {
        serverRssMB: mb(process.memoryUsage().rss),
        systemTotalMB: mb(os.totalmem()),
        systemFreeMB: mb(os.freemem()),
      },
    };
  }
}
