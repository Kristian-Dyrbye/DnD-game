/**
 * Loads and saves settings to <userDataDir>/settings.json. A missing or corrupt file never
 * crashes the game: valid fields are kept, and anything invalid falls back to defaults.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  SettingsSchema,
  defaultSettings,
  mergeSettings,
  type Settings,
} from '../shared/settings';

export const SETTINGS_FILE = 'settings.json';

export class SettingsStore {
  private current: Settings;
  private readonly file: string;

  constructor(private readonly userDataDir: string) {
    this.file = path.join(userDataDir, SETTINGS_FILE);
    this.current = this.load();
  }

  get(): Settings {
    return structuredClone(this.current);
  }

  /** Applies a partial patch. Returns the new settings, or the validation error message. */
  update(patch: unknown): { ok: true; settings: Settings } | { ok: false; error: string } {
    const result = SettingsSchema.safeParse(mergeSettings(this.current, patch));
    if (!result.success) {
      return { ok: false, error: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
    }
    this.current = result.data;
    this.save();
    return { ok: true, settings: this.get() };
  }

  private load(): Settings {
    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      return defaultSettings();
    }
    const whole = SettingsSchema.safeParse(raw);
    if (whole.success) return whole.data;
    // Salvage section by section, then field by field, so one bad value doesn't wipe everything.
    return salvage(raw);
  }

  private save(): void {
    fs.mkdirSync(this.userDataDir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.current, null, 2), 'utf8');
    fs.renameSync(tmp, this.file);
  }
}

function salvage(raw: unknown): Settings {
  let settings = defaultSettings();
  if (!raw || typeof raw !== 'object') return settings;
  for (const [section, fields] of Object.entries(raw as Record<string, unknown>)) {
    if (!fields || typeof fields !== 'object') continue;
    for (const [field, value] of Object.entries(fields as Record<string, unknown>)) {
      const attempt = SettingsSchema.safeParse(mergeSettings(settings, { [section]: { [field]: value } }));
      if (attempt.success) settings = attempt.data;
    }
  }
  return settings;
}
