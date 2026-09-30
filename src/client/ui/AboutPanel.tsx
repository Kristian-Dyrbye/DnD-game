/**
 * About (spec §17): what the game is, the SRD 5.2.1 CC-BY-4.0 attribution (required wording), and
 * where the free assets come from. The full list with licenses is CREDITS.md in the game folder.
 */
import { GAME_TITLE, GAME_VERSION } from '../../shared/version';
import { WEB_EDITION } from '../edition';
import { t } from './i18n';

export function AboutPanel({ onClose }: { onClose: () => void }) {
  return (
    <div class="modal-backdrop" role="dialog" aria-modal="true" aria-label={t('title.about')}>
      <section class="journal about-panel">
        <header class="journal-head">
          <h2>
            {GAME_TITLE} <span class="muted small">v{GAME_VERSION}</span>
          </h2>
          <button type="button" onClick={onClose} aria-label={t('common.close')}>
            {t('common.close')}
          </button>
        </header>
        <div class="about-body">
          <p>{t(WEB_EDITION ? 'about.textWeb' : 'about.textLocal')}</p>
          <h3>{t('about.rules')}</h3>
          {/* Required CC-BY-4.0 attribution: kept in its official English wording in every language. */}
          <p class="attribution" lang="en">
            This work includes material from the System Reference Document 5.2.1 ("SRD 5.2.1") by Wizards of the Coast LLC, available at{' '}
            <a href="https://www.dndbeyond.com/srd" target="_blank" rel="noreferrer">
              https://www.dndbeyond.com/srd
            </a>
            . The SRD 5.2.1 is licensed under the Creative Commons Attribution 4.0 International License, available at{' '}
            <a href="https://creativecommons.org/licenses/by/4.0/legalcode" target="_blank" rel="noreferrer">
              https://creativecommons.org/licenses/by/4.0/legalcode
            </a>
            .
          </p>
          <h3>{t('about.art')}</h3>
          <ul class="plain-list">
            <li>{t('about.art.models')}</li>
            <li>{t('about.art.monsters')}</li>
            <li>{t('about.art.audio')}</li>
            <li>{t(WEB_EDITION ? 'about.art.voiceWeb' : 'about.art.voiceLocal')}</li>
          </ul>
          <p class="muted small">{t(WEB_EDITION ? 'about.creditsWeb' : 'about.creditsLocal')}</p>
          <h3>{t('about.world')}</h3>
          <p>{t('about.worldText')}</p>
        </div>
      </section>
    </div>
  );
}
