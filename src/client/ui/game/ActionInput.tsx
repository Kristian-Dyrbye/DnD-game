/** Input area: suggested action buttons plus a free-text box (free text goes through intent parsing). */
import { useState } from 'preact/hooks';
import { connection, send, suggestions } from '../../net/gameSocket';

export function ActionInput() {
  const [text, setText] = useState('');
  const offline = connection.value !== 'open';
  const submit = (e: Event) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    send({ type: 'say', text: t.slice(0, 500) });
    setText('');
  };
  return (
    <section class="action-input" aria-label="Your actions">
      <div class="suggestions">
        {suggestions.value.map((a) => (
          <button key={a.id} type="button" disabled={offline} onClick={() => send({ type: 'choose', actionId: a.id })}>
            {a.label}
          </button>
        ))}
      </div>
      <form class="free-text" onSubmit={submit}>
        <input
          type="text"
          value={text}
          maxLength={500}
          placeholder="Or describe what you do…"
          aria-label="Describe what you do"
          onInput={(e) => setText((e.target as HTMLInputElement).value)}
        />
        <button type="submit" class="primary" disabled={offline || !text.trim()}>
          Act
        </button>
      </form>
    </section>
  );
}
