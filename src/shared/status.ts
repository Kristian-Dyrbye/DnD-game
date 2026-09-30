/** System status (GET /api/status) and the pure logic that turns it into indicator lights. */
import type { LlmStatus } from '../llm/types';
import type { TtsStatus } from '../tts/types';
import { ENGLISH, type Translator } from './i18n';

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

/** Labels come from the UI catalogs; `tr` defaults to English (server-side callers and tests). */
export function llmIndicator(s: LlmStatus, tr: Translator = ENGLISH): Indicator {
  const { t } = tr;
  if (s.provider === 'mock') return { light: 'warn', label: t('status.aiMock'), detail: t('status.aiMockDetail') };
  if (!s.reachable) return { light: 'error', label: t('status.aiOffline'), detail: s.error ?? t('status.aiOfflineDetail') };
  if (!s.modelAvailable) return { light: 'error', label: t('status.aiNoModel'), detail: t('status.aiNoModelDetail', { model: s.model }) };
  if (!s.modelLoaded) return { light: 'warn', label: t('status.aiIdle'), detail: t('status.aiIdleDetail', { model: s.model }) };
  return { light: 'ok', label: t('status.aiReady'), detail: t('status.aiReadyDetail', { model: s.model }) };
}

export function ttsIndicator(s: TtsStatus, enabled: boolean, tr: Translator = ENGLISH): Indicator {
  const { t } = tr;
  if (!enabled) return { light: 'off', label: t('status.voiceOff'), detail: t('status.voiceOffDetail') };
  if (s.provider === 'mock') return { light: 'warn', label: t('status.voiceMock'), detail: t('status.voiceMockDetail') };
  if (!s.ready) return { light: 'error', label: t('status.voiceMissing'), detail: s.error ?? t('status.voiceMissingDetail') };
  return { light: 'ok', label: t('status.voiceReady'), detail: tr.tn('status.voices', s.voices.length) };
}

/** Warn when the machine is under 1 GB free, error under 400 MB. */
export function memoryIndicator(m: MemoryStatus, tr: Translator = ENGLISH): Indicator {
  const detail = tr.t('status.ramDetail', { rss: m.serverRssMB, free: m.systemFreeMB, total: m.systemTotalMB });
  const light: Light = m.systemFreeMB < 400 ? 'error' : m.systemFreeMB < 1024 ? 'warn' : 'ok';
  return { light, label: tr.t('status.ram', { free: m.systemFreeMB }), detail };
}
