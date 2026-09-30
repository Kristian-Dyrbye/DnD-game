/** Creator step 7: name, personality and backstory (with an optional AI suggestion; a template story in the web edition). */
import { useState } from 'preact/hooks';
import type { CreatorState } from '../../../engine/character/creator';
import { randomName } from '../../../engine/character/quickBuild';
import { Rng } from '../../../engine/core/rng';
import { templateBackstory } from '../../../llm/prompts/backstory';
import { db } from '../../data';
import { WEB_EDITION } from '../../edition';
import { language, t } from '../i18n';
import { creator } from './creatorState';

const FIELDS = ['traits', 'ideals', 'bonds', 'flaws'] as const;

export function IdentityStep() {
  const s = creator.value;
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const setPersonality = (key: keyof CreatorState['personality'], value: string) => (creator.value = { ...creator.value, personality: { ...creator.value.personality, [key]: value } });

  const suggest = async () => {
    const summary = {
      name: s.name,
      species: db.species.get(s.speciesId ?? '')?.name ?? 'Human',
      className: db.classes.get(s.classId ?? '')?.name ?? 'Adventurer',
      background: db.backgrounds.get(s.backgroundId ?? '')?.name ?? 'Wanderer',
      homeland: t('creator.identity.homeland'),
      language: language.value,
      ...s.personality,
    };
    if (WEB_EDITION) {
      // No AI in the web edition: the same template story the server falls back to.
      setPersonality('backstory', templateBackstory(summary));
      setNote(t('creator.identity.noteTemplate'));
      return;
    }
    setBusy(true);
    setNote('');
    try {
      const res = await fetch('/api/llm/backstory', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(summary),
      });
      const data = (await res.json()) as { text: string; source: string };
      setPersonality('backstory', data.text);
      if (data.source === 'template') setNote(t('creator.identity.noteOffline'));
    } catch {
      setNote(t('creator.identity.noteNoServer'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <h2>{t('creator.identity.title')}</h2>
      <label class="field">
        <span>{t('creator.identity.name')}</span>
        <span class="field-row">
          <input type="text" maxLength={40} value={s.name} onInput={(e) => (creator.value = { ...creator.value, name: (e.target as HTMLInputElement).value })} />
          <button type="button" onClick={() => (creator.value = { ...creator.value, name: randomName(s.speciesId, Rng.fromSeed(`${Date.now()}`)) })}>
            {t('creator.identity.randomName')}
          </button>
        </span>
      </label>
      {FIELDS.map((f) => (
        <label key={f} class="field">
          <span>{t(`creator.identity.${f}`)}</span>
          <input type="text" maxLength={200} placeholder={t(`creator.identity.${f}Placeholder`)} value={s.personality[f] ?? ''} onInput={(e) => setPersonality(f, (e.target as HTMLInputElement).value)} />
        </label>
      ))}
      <label class="field">
        <span>{t('creator.identity.backstory')}</span>
        <textarea rows={6} maxLength={2000} value={s.personality.backstory ?? ''} onInput={(e) => setPersonality('backstory', (e.target as HTMLTextAreaElement).value)} />
      </label>
      <div class="quick-actions">
        <button type="button" onClick={suggest} disabled={busy}>
          {busy ? t('creator.identity.writing') : t('creator.identity.suggest')}
        </button>
        {note && <span class="hint">{note}</span>}
      </div>
    </section>
  );
}
