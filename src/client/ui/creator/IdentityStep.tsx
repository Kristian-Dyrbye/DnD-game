/** Creator step 7: name, personality and backstory (with an optional AI suggestion; a template story in the web edition). */
import { useState } from 'preact/hooks';
import type { CreatorState } from '../../../engine/character/creator';
import { randomName } from '../../../engine/character/quickBuild';
import { Rng } from '../../../engine/core/rng';
import { templateBackstory } from '../../../llm/prompts/backstory';
import { db } from '../../data';
import { WEB_EDITION } from '../../edition';
import { creator } from './creatorState';

const FIELDS: { key: keyof CreatorState['personality']; label: string; placeholder: string }[] = [
  { key: 'traits', label: 'Personality traits', placeholder: 'e.g. Blunt but kind; hums while working' },
  { key: 'ideals', label: 'Ideals', placeholder: 'e.g. Loyalty to those who stand beside me' },
  { key: 'bonds', label: 'Bonds', placeholder: 'e.g. My sister is missing somewhere in the Gloamfen' },
  { key: 'flaws', label: 'Flaws', placeholder: 'e.g. I never back down from a dare' },
];

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
      homeland: 'Millbrook, a village in Aurelmark',
      ...s.personality,
    };
    if (WEB_EDITION) {
      // No AI in the web edition: the same template story the server falls back to.
      setPersonality('backstory', templateBackstory(summary));
      setNote('A starting point: edit it freely.');
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
      if (data.source === 'template') setNote('The AI Dungeon Master is offline, so this is a template story. Edit it freely.');
    } catch {
      setNote('Could not reach the game server.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <h2>Name and story</h2>
      <label class="field">
        <span>Name</span>
        <span class="field-row">
          <input type="text" maxLength={40} value={s.name} onInput={(e) => (creator.value = { ...creator.value, name: (e.target as HTMLInputElement).value })} />
          <button type="button" onClick={() => (creator.value = { ...creator.value, name: randomName(s.speciesId, Rng.fromSeed(`${Date.now()}`)) })}>
            Random name
          </button>
        </span>
      </label>
      {FIELDS.map((f) => (
        <label key={f.key} class="field">
          <span>{f.label}</span>
          <input type="text" maxLength={200} placeholder={f.placeholder} value={s.personality[f.key] ?? ''} onInput={(e) => setPersonality(f.key, (e.target as HTMLInputElement).value)} />
        </label>
      ))}
      <label class="field">
        <span>Backstory</span>
        <textarea rows={6} maxLength={2000} value={s.personality.backstory ?? ''} onInput={(e) => setPersonality('backstory', (e.target as HTMLTextAreaElement).value)} />
      </label>
      <div class="quick-actions">
        <button type="button" onClick={suggest} disabled={busy}>
          {busy ? 'Writing…' : 'Suggest a backstory'}
        </button>
        {note && <span class="hint">{note}</span>}
      </div>
    </section>
  );
}
