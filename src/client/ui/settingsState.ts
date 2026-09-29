/** Client copy of the server settings (loaded once, updated through PUT /api/settings). */
import { signal } from '@preact/signals';
import type { Settings } from '../../shared/settings';
import { audio } from '../audio/AudioManager';
import { ttsPlayer } from '../audio/ttsPlayer';

export const settings = signal<Settings | null>(null);

function applyAudioSettings(s: Settings): void {
  audio.setVolumes(s.audio);
  ttsPlayer.setVolume(s.audio.master * s.audio.narration);
  ttsPlayer.setEnabled(s.tts.enabled);
  applyAccessibility(s);
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
  loading ??= fetch('/api/settings')
    .then((r) => r.json() as Promise<Settings>)
    .then((s) => {
      settings.value = s;
      applyAudioSettings(s);
    })
    .catch(() => {
      loading = null; // retry next time
    });
  return loading;
}

/** Sends a partial settings patch (deep-merged on the server) and stores the result. */
export async function updateSettings(patch: Record<string, unknown>): Promise<void> {
  const res = await fetch('/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) });
  if (res.ok) {
    settings.value = (await res.json()) as Settings;
    applyAudioSettings(settings.value);
  }
}
