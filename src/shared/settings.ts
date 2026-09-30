/**
 * Player settings schema (shared by client and server). Every field has a default, so
 * `parseSettings({})` returns a complete settings object. Stored in userdata/settings.json.
 */
import { z } from 'zod';

const volume = z.number().min(0).max(1);

export const LlmSettingsSchema = z.object({
  /** Ollama model tag used for narration and JSON calls. */
  model: z.string().min(1).default('llama3.2:3b'),
  /** Used if the main model isn't pulled. */
  fallbackModel: z.string().min(1).default('qwen3:4b-instruct'),
  baseUrl: z.string().url().default('http://127.0.0.1:11434'),
  /** Force the mock LLM even if Ollama is available (development, low-memory play). */
  useMock: z.boolean().default(false),
  responseLength: z.enum(['short', 'medium', 'long']).default('medium'),
  temperature: z.number().min(0).max(2).default(0.8),
  /** How often combat actions get narrated. */
  combatNarration: z.enum(['every', 'key', 'off']).default('key'),
  /** Let Ollama unload the model when idle, to free RAM. */
  unloadWhenIdle: z.boolean().default(false),
  /** Ollama keep_alive in minutes when unloadWhenIdle is on. */
  idleMinutes: z.number().int().min(1).max(120).default(5),
});

export const TtsSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  piperPath: z.string().default('tools/piper/piper.exe'),
  voiceDir: z.string().default('assets/voices'),
  narratorVoice: z.string().default('en_GB-cori-medium'),
  unloadWhenIdle: z.boolean().default(true),
});

export const AudioSettingsSchema = z.object({
  master: volume.default(0.8),
  music: volume.default(0.6),
  sfx: volume.default(0.8),
  narration: volume.default(0.9),
});

export const PerformanceSettingsSchema = z.object({
  preset: z.enum(['low', 'medium', 'high', 'custom']).default('medium'),
  gridMode: z.enum(['3d', '2d']).default('3d'),
  shadows: z.enum(['off', 'low', 'high']).default('low'),
  textureQuality: z.enum(['low', 'medium', 'high']).default('medium'),
  maxNpcModels: z.number().int().min(0).max(50).default(12),
  fpsCap: z.number().int().min(15).max(240).default(60),
});

export const AccessibilitySettingsSchema = z.object({
  textScale: z.number().min(0.75).max(2).default(1),
  dyslexiaFont: z.boolean().default(false),
  colorblindOverlays: z.boolean().default(false),
});

export const GameplaySettingsSchema = z.object({
  /** Owner decision: small "current objective" hint, default off (spec §15). */
  objectiveHint: z.boolean().default(false),
});

export const SettingsSchema = z.object({
  llm: LlmSettingsSchema.prefault({}),
  tts: TtsSettingsSchema.prefault({}),
  audio: AudioSettingsSchema.prefault({}),
  performance: PerformanceSettingsSchema.prefault({}),
  accessibility: AccessibilitySettingsSchema.prefault({}),
  gameplay: GameplaySettingsSchema.prefault({}),
});

export type Settings = z.infer<typeof SettingsSchema>;

/** A partial settings patch: any section, any subset of fields. */
export type SettingsPatch = { [K in keyof Settings]?: Partial<Settings[K]> };

type PerformanceSettings = z.infer<typeof PerformanceSettingsSchema>;

/**
 * Performance presets (spec §14). "low" suits 8 GB machines with integrated graphics: 2D tokens,
 * no shadows, low textures, few NPC models, 30 fps.
 */
export const PERFORMANCE_PRESETS: Record<'low' | 'medium' | 'high', Omit<PerformanceSettings, 'preset'>> = {
  low: { gridMode: '2d', shadows: 'off', textureQuality: 'low', maxNpcModels: 4, fpsCap: 30 },
  medium: { gridMode: '3d', shadows: 'low', textureQuality: 'medium', maxNpcModels: 12, fpsCap: 60 },
  high: { gridMode: '3d', shadows: 'high', textureQuality: 'high', maxNpcModels: 30, fpsCap: 120 },
};

/** The performance settings for a preset (custom keeps the current values). */
export function applyPreset(current: PerformanceSettings, preset: PerformanceSettings['preset']): PerformanceSettings {
  return preset === 'custom' ? { ...current, preset } : { preset, ...PERFORMANCE_PRESETS[preset] };
}

export function defaultSettings(): Settings {
  return SettingsSchema.parse({});
}

export function parseSettings(input: unknown): Settings {
  return SettingsSchema.parse(input);
}

/** Merges a patch into settings section by section. Unknown sections are ignored. Does not validate. */
export function mergeSettings(base: Settings, patch: unknown): unknown {
  if (!patch || typeof patch !== 'object') return base;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    if (!(key in base)) continue;
    const current = (base as Record<string, unknown>)[key];
    out[key] =
      value && typeof value === 'object' && !Array.isArray(value)
        ? { ...(current as object), ...(value as object) }
        : value;
  }
  return out;
}
