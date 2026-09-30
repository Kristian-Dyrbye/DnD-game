/**
 * Save browser (spec §9, §12): every save with its thumbnail (the hero with gear and scars),
 * character, level, place, mode and time. From the title screen it loads; in game it can also save
 * to a new slot or overwrite a manual one. Autosaves can be loaded but not overwritten or deleted.
 */
import { useEffect, useState } from 'preact/hooks';
import type { SaveMeta } from '../../shared/save';
import { send } from '../net/gameSocket';
import { downloadSave, saveLibrary } from '../net/saveLibrary';
import { language, t } from './i18n';
import { screen } from './state';

export function SaveBrowser({ mode, onClose }: { mode: 'load' | 'save'; onClose: () => void }) {
  const [saves, setSaves] = useState<SaveMeta[] | null>(null);
  const [name, setName] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const refresh = () => void saveLibrary().list().then(setSaves, () => setSaves([]));
  useEffect(refresh, []);

  const exportSave = async (slot: string) => {
    try {
      downloadSave(await saveLibrary().exportFile(slot));
    } catch (err) {
      setMessage(t('saves.exportFailed', { error: (err as Error).message }));
    }
  };
  const importSave = async (input: HTMLInputElement) => {
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    try {
      const meta = await saveLibrary().importText(await f.text());
      setMessage(t('saves.imported', { name: meta.name }));
    } catch (err) {
      setMessage(t('saves.importFailed', { error: (err as Error).message }));
    }
    refresh();
  };

  const load = (slot: string) => {
    send({ type: 'load', slot });
    screen.value = 'game';
    onClose();
  };
  const saveTo = (slot: string, label?: string) => {
    send({ type: 'save', slot, ...(label && { name: label }) });
    setTimeout(refresh, 400);
  };
  const remove = async (slot: string) => {
    await saveLibrary().remove(slot).catch(() => undefined);
    refresh();
  };
  const heading = t(mode === 'load' ? 'saves.load' : 'saves.save');

  return (
    <div class="modal-backdrop" role="dialog" aria-modal="true" aria-label={heading}>
      <section class="journal save-browser">
        <header class="journal-head">
          <h2>{heading}</h2>
          <button type="button" onClick={onClose} aria-label={t('common.close')}>
            {t('common.close')}
          </button>
        </header>
        {mode === 'save' && (
          <form
            class="save-new"
            onSubmit={(e) => {
              e.preventDefault();
              saveTo(`save-${Date.now().toString(36)}`, name.trim() || undefined);
              setName('');
            }}
          >
            <input type="text" maxLength={80} placeholder={t('saves.namePlaceholder')} value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
            <button type="submit" class="primary">
              {t('saves.saveAsNew')}
            </button>
          </form>
        )}
        <div class="save-import">
          <label class="button-like">
            {t('saves.import')}
            <input type="file" accept=".json,application/json" class="visually-hidden" onChange={(e) => void importSave(e.target as HTMLInputElement)} />
          </label>
          {message && (
            <span class="muted small" role="status">
              {message}
            </span>
          )}
        </div>
        {saves === null && <p class="hint">{t('saves.loading')}</p>}
        {saves?.length === 0 && <p class="hint">{t('saves.none')}</p>}
        <ul class="save-list">
          {saves?.map((s) => (
            <li key={s.slotId} class={`save-card${s.kind === 'auto' ? ' auto' : ''}`}>
              {s.thumbnail ? <img class="save-thumb" src={s.thumbnail} alt={`${s.characterName}`} width={96} height={96} /> : <div class="save-thumb empty" aria-hidden="true" />}
              <div class="save-info">
                <strong>{s.name}</strong>
                <span class="muted small">{t('saves.meta', { name: s.characterName, level: s.level, location: s.location })}</span>
                <span class="muted small">
                  {[new Date(s.savedAt).toLocaleString(language.value), t(s.mode === 'hardcore' ? 'creator.difficulty.hardcore' : 'creator.difficulty.heroic'), ...(s.kind === 'auto' ? [t('saves.autosave')] : [])].join(' · ')}
                </span>
              </div>
              <div class="save-actions">
                <button type="button" onClick={() => load(s.slotId)}>
                  {t('saves.loadButton')}
                </button>
                <button type="button" onClick={() => void exportSave(s.slotId)} title={t('saves.exportTitle')}>
                  {t('saves.export')}
                </button>
                {mode === 'save' && s.kind === 'manual' && (
                  <button type="button" onClick={() => saveTo(s.slotId, s.name)}>
                    {t('saves.overwrite')}
                  </button>
                )}
                {s.kind === 'manual' && (
                  <button type="button" class="link-button" onClick={() => void remove(s.slotId)}>
                    {t('saves.delete')}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
