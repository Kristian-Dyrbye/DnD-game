/**
 * Client copy of the settings. The local edition loads them from the server (PUT /api/settings,
 * deep-merged there); the web edition keeps them in localStorage (setSettingsBackend).
 */
import { signal } from '@preact/signals';
import { defaultSettings, patchSettings, salvageSettings, type Settings } from '../../shared/settings';
import { audio } from '../audio/AudioManager';
import { ttsPlayer } from '../audio/ttsPlayer';
import { applyLanguage } from './i18n';
import type { Language } from '../../shared/i18n';

export const settings = signal<Settings | null>(null);

/** Where settings live. `update` returns the new settings, or null if the patch was refused. */
export interface SettingsBackend {
  load(): Promise<Settings>;
  update(patch: Record<string, unknown>): Promise<Settings | null>;
}

export const serverSettingsBackend: SettingsBackend = {
  async load() {
    return (await (await fetch('/api/settings')).json()) as Settings;
  },
  async update(patch) {
    const res = await fetch('/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) });
    return res.ok ? ((await res.json()) as Settings) : null;
  },
};

export const LOCAL_SETTINGS_KEY = 'solo-dnd.settings';

/**
 * Settings in localStorage. Storage can be missing, full or blocked (private windows): reads then
 * give the defaults (bad fields salvaged one by one) and writes keep the settings for this page only.
 */
export function localSettingsBackend(storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = globalThis.localStorage): SettingsBackend {
  let current: Settings | null = null;
  const read = (): Settings => {
    try {
      const text = storage?.getItem(LOCAL_SETTINGS_KEY);
      return text ? salvageSettings(JSON.parse(text)) : defaultSettings();
    } catch {
      return defaultSettings();
    }
  };
  return {
    async load() {
      current ??= read();
      return structuredClone(current);
    },
    async update(patch) {
      const result = patchSettings((current ??= read()), patch);
      if (!result.ok) return null;
      current = result.settings;
      try {
        storage?.setItem(LOCAL_SETTINGS_KEY, JSON.stringify(current));
      } catch {
        // Not stored (quota/blocked); the change still applies until the page closes.
      }
      return structuredClone(current);
    },
  };
}

let backend: SettingsBackend = serverSettingsBackend;

/** Switches where settings are stored (web edition); the next loadSettings reads from it. */
export function setSettingsBackend(b: SettingsBackend): void {
  backend = b;
  loading = null;
}

function applyAudioSettings(s: Settings): void {
  audio.setVolumes(s.audio);
  ttsPlayer.setVolume(s.audio.master * s.audio.narration);
  ttsPlayer.setEnabled(s.tts.enabled);
  ttsPlayer.setVoice(s.tts.browserVoice);
  applyAccessibility(s);
  applyLanguage(s.gameplay.language);
}

/** Text size, readable font and colour-blind helpers are applied to the whole page. */
export function applyAccessibility(s: Settings): void {
  if (typeof document === 'undefined') return;
  document.documentElement.style.setProperty('--text-scale', String(s.accessibility.textScale));
  document.body.classList.toggle('readable-font', s.accessibility.dyslexiaFont);
  document.body.classList.toggle('cb-helpers', s.accessibility.colorblindOverlays);
}

let loading: Promise<void> | null = null;

export function loadSettings(): Promise<void> {
  loading ??= backend
    .load()
    .then((s) => {
      settings.value = s;
      applyAudioSettings(s);
    })
    .catch(() => {
      loading = null; // retry next time
    });
  return loading;
}

/** Switches the UI language at once (no reload) and stores the choice. */
export async function setLanguage(lang: Language): Promise<void> {
  applyLanguage(lang);
  await updateSettings({ gameplay: { language: lang } });
}

/** Sends a partial settings patch (deep-merged by the backend) and stores the result. */
export async function updateSettings(patch: Record<string, unknown>): Promise<void> {
  const next = await backend.update(patch);
  if (next) {
    settings.value = next;
    applyAudioSettings(next);
  }
}
