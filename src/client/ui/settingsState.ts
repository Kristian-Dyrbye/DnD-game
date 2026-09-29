/** Client copy of the server settings (loaded once, updated through PUT /api/settings). */
import { signal } from '@preact/signals';
import type { Settings } from '../../shared/settings';
import { audio } from '../audio/AudioManager';

export const settings = signal<Settings | null>(null);

let loading: Promise<void> | null = null;

export function loadSettings(): Promise<void> {
  loading ??= fetch('/api/settings')
    .then((r) => r.json() as Promise<Settings>)
    .then((s) => {
      settings.value = s;
      audio.setVolumes(s.audio);
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
    audio.setVolumes(settings.value.audio);
  }
}
