/** Language drop-down (title screen and Settings → Gameplay). Each language is named in itself. */
import { LANGUAGE_NAMES, LANGUAGES, isLanguage } from '../../shared/i18n';
import { language, t } from './i18n';
import { setLanguage } from './settingsState';

export function LanguagePicker({ hint, class: cls = 'setting-row' }: { hint?: string; class?: string }) {
  return (
    <label class={cls}>
      <span>
        {t('language.label')}
        {hint && <small class="hint"> — {hint}</small>}
      </span>
      <select
        value={language.value}
        onChange={(e) => {
          const v = (e.target as HTMLSelectElement).value;
          if (isLanguage(v)) void setLanguage(v);
        }}
      >
        {LANGUAGES.map((l) => (
          <option key={l} value={l} lang={l}>
            {LANGUAGE_NAMES[l]}
          </option>
        ))}
      </select>
    </label>
  );
}
