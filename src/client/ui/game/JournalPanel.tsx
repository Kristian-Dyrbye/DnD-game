/**
 * Journal (spec §15): the player's own notebook — free-form pages they write, reorder and delete.
 * Saved with the game on the server; there is no automatic quest log here.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { timeOfDay } from '../../../engine/world/clock';
import type { JournalPage } from '../../../engine/session/journal';
import { gameState, lastSavedPage, send } from '../../net/gameSocket';
import { formatClock } from '../text';

export function JournalPanel({ onClose }: { onClose: () => void }) {
  const pages: JournalPage[] = gameState.value?.journal.pages ?? [];
  const [selected, setSelected] = useState<string | null>(pages[0]?.id ?? null);
  const current = pages.find((p) => p.id === selected);
  const [title, setTitle] = useState(current?.title ?? '');
  const [body, setBody] = useState(current?.body ?? '');
  const dirty = current ? title !== current.title || body !== current.body : title.trim() !== '' || body.trim() !== '';

  // Load the page into the editor when the selection changes.
  useEffect(() => {
    setTitle(current?.title ?? '');
    setBody(current?.body ?? '');
  }, [selected]);
  // A newly created page arrives with a fresh id: select it.
  const saved = lastSavedPage.value;
  const awaitingNew = useRef(false);
  useEffect(() => {
    if (saved && awaitingNew.current) {
      awaitingNew.current = false;
      setSelected(saved.id);
    }
  }, [saved?.at]);

  const save = () => {
    if (!current) awaitingNew.current = true;
    send({ type: 'journal_save', page: { ...(current && { id: current.id }), title, body } });
  };
  const newPage = () => {
    if (dirty) save();
    setSelected(null);
    setTitle('');
    setBody('');
  };
  const move = (id: string, by: -1 | 1) => {
    const ids = pages.map((p) => p.id);
    const i = ids.indexOf(id);
    const j = i + by;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    send({ type: 'journal_reorder', ids });
  };
  const remove = (id: string) => {
    if (!confirm('Delete this page?')) return;
    send({ type: 'journal_delete', id });
    if (selected === id) setSelected(null);
  };

  return (
    <div class="modal-backdrop" role="dialog" aria-modal="true" aria-label="Journal">
      <section class="journal">
        <header class="journal-head">
          <h2>Journal</h2>
          <button type="button" onClick={newPage}>
            New page
          </button>
          <button type="button" onClick={onClose} aria-label="Close journal">
            Close
          </button>
        </header>
        <div class="journal-body">
          <ol class="journal-pages">
            {pages.length === 0 && <li class="hint small">Your notebook is empty. Write down names, clues and plans.</li>}
            {pages.map((p, i) => (
              <li key={p.id} class={p.id === selected ? 'selected' : ''}>
                <button type="button" class="page-link" onClick={() => setSelected(p.id)}>
                  <strong>{p.title}</strong>
                  <small>{formatClock(p.updatedAt, timeOfDay(p.updatedAt))}</small>
                </button>
                <span class="page-tools">
                  <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => move(p.id, -1)}>
                    ↑
                  </button>
                  <button type="button" aria-label="Move down" disabled={i === pages.length - 1} onClick={() => move(p.id, 1)}>
                    ↓
                  </button>
                  <button type="button" aria-label="Delete page" onClick={() => remove(p.id)}>
                    ✕
                  </button>
                </span>
              </li>
            ))}
          </ol>
          <div class="journal-editor">
            <input type="text" value={title} maxLength={80} placeholder="Page title" aria-label="Page title" onInput={(e) => setTitle((e.target as HTMLInputElement).value)} />
            <textarea value={body} maxLength={20000} placeholder="Write anything…" aria-label="Page text" onInput={(e) => setBody((e.target as HTMLTextAreaElement).value)} />
            <div class="journal-actions">
              <button type="button" class="primary" disabled={!dirty} onClick={save}>
                {current ? 'Save page' : 'Add page'}
              </button>
              {dirty && <span class="hint small">Unsaved changes</span>}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
