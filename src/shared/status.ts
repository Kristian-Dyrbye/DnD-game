/** System status (GET /api/status) and the pure logic that turns it into indicator lights. */
import type { LlmStatus } from '../llm/types';
import type { TtsStatus } from '../tts/types';

export interface MemoryStatus {
  /** Game server process resident memory. */
  serverRssMB: number;
  systemTotalMB: number;
  systemFreeMB: number;
}

export interface SystemStatus {
  llm: LlmStatus;
  tts: TtsStatus;
  memory: MemoryStatus;
}

export type Light = 'ok' | 'warn' | 'error' | 'off';

export interface Indicator {
  light: Light;
  label: string;
  detail: string;
}

export function llmIndicator(s: LlmStatus): Indicator {
  if (s.provider === 'mock') return { light: 'warn', label: 'AI: mock', detail: 'Using template narration (mock AI).' };
  if (!s.reachable) return { light: 'error', label: 'AI: offline', detail: s.error ?? 'Ollama is not running.' };
  if (!s.modelAvailable)
    return { light: 'error', label: 'AI: no model', detail: `Model ${s.model} is not pulled. Run Setup.bat.` };
  if (!s.modelLoaded) return { light: 'warn', label: 'AI: idle', detail: `${s.model} loads on first use (a few seconds).` };
  return { light: 'ok', label: 'AI: ready', detail: `${s.model} is loaded.` };
}

export function ttsIndicator(s: TtsStatus, enabled: boolean): Indicator {
  if (!enabled) return { light: 'off', label: 'Voice: off', detail: 'Narration voice is turned off in settings.' };
  if (s.provider === 'mock') return { light: 'warn', label: 'Voice: mock', detail: 'Silent mock voice.' };
  if (!s.ready) return { light: 'error', label: 'Voice: missing', detail: s.error ?? 'Piper is not installed.' };
  return { light: 'ok', label: 'Voice: ready', detail: `${s.voices.length} voice(s) installed.` };
}

/** Warn when the machine is under 1 GB free, error under 400 MB. */
export function memoryIndicator(m: MemoryStatus): Indicator {
  const detail = `Server ${m.serverRssMB} MB · ${m.systemFreeMB} of ${m.systemTotalMB} MB free`;
  const light: Light = m.systemFreeMB < 400 ? 'error' : m.systemFreeMB < 1024 ? 'warn' : 'ok';
  return { light, label: `RAM ${m.systemFreeMB} MB free`, detail };
}
