/**
 * Save browser (spec §9, §12): every save with its thumbnail (the hero with gear and scars),
 * character, level, place, mode and time. From the title screen it loads; in game it can also save
 * to a new slot or overwrite a manual one. Autosaves can be loaded but not overwritten or deleted.
 */
import { useEffect, useState } from 'preact/hooks';
import type { SaveListEntry, SaveMeta } from '../../shared/save';
import { send } from '../net/gameSocket';
import { screen } from './state';

async function fetchSaves(): Promise<SaveMeta[]> {
  const res = await fetch('/api/saves');
  if (!res.ok) return [];
  const list = (await res.json()) as SaveListEntry[];
  return list.flatMap((e) => (e.ok ? [e.meta] : [])).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export function SaveBrowser({ mode, onClose }: { mode: 'load' | 'save'; onClose: () => void }) {
  const [saves, setSaves] = useState<SaveMeta[] | null>(null);
  const [name, setName] = useState('');
  const refresh = () => void fetchSaves().then(setSaves);
  useEffect(refresh, []);

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
    await fetch(`/api/saves/${slot}`, { method: 'DELETE' });
    refresh();
  };

  return (
    <div class="modal-backdrop" role="dialog" aria-modal="true" aria-label={mode === 'load' ? 'Load game' : 'Save game'}>
      <section class="journal save-browser">
        <header class="journal-head">
          <h2>{mode === 'load' ? 'Load game' : 'Save game'}</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            Close
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
            <input type="text" maxLength={80} placeholder="Name this save (optional)" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
            <button type="submit" class="primary">
              Save as new
            </button>
          </form>
        )}
        {saves === null && <p class="hint">Loading saves…</p>}
        {saves?.length === 0 && <p class="hint">No saves yet.</p>}
        <ul class="save-list">
          {saves?.map((s) => (
            <li key={s.slotId} class={`save-card${s.kind === 'auto' ? ' auto' : ''}`}>
              {s.thumbnail ? <img class="save-thumb" src={s.thumbnail} alt={`${s.characterName}`} width={96} height={96} /> : <div class="save-thumb empty" aria-hidden="true" />}
              <div class="save-info">
                <strong>{s.name}</strong>
                <span class="muted small">
                  {s.characterName} · level {s.level} · {s.location}
                </span>
                <span class="muted small">
                  {new Date(s.savedAt).toLocaleString()} · {s.mode === 'hardcore' ? 'Hardcore' : 'Heroic'}
                  {s.kind === 'auto' ? ' · autosave' : ''}
                </span>
              </div>
              <div class="save-actions">
                <button type="button" onClick={() => load(s.slotId)}>
                  Load
                </button>
                {mode === 'save' && s.kind === 'manual' && (
                  <button type="button" onClick={() => saveTo(s.slotId, s.name)}>
                    Overwrite
                  </button>
                )}
                {s.kind === 'manual' && (
                  <button type="button" class="link-button" onClick={() => void remove(s.slotId)}>
                    Delete
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
