/**
 * Loads and saves settings to <userDataDir>/settings.json. A missing or corrupt file never
 * crashes the game: valid fields are kept, and anything invalid falls back to defaults.
 */
import fs from 'node:fs';
import path from 'node:path';
import { defaultSettings, patchSettings, salvageSettings, type Settings } from '../shared/settings';

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
    const result = patchSettings(this.current, patch);
    if (!result.ok) return result;
    this.current = result.settings;
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
    // Salvage section by section, then field by field, so one bad value doesn't wipe everything.
    return salvageSettings(raw);
  }

  private save(): void {
    fs.mkdirSync(this.userDataDir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.current, null, 2), 'utf8');
    fs.renameSync(tmp, this.file);
  }
}
