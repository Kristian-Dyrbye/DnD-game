/**
 * Input area: suggested action buttons (in a conversation: the NPC's line above its reply options) plus a free-text box (free text goes through intent parsing;
 * in the web edition keyword matching only, so the box says the buttons work best).
 */
import { useState } from 'preact/hooks';
import { WEB_EDITION } from '../../edition';
import { connection, dialogue, send, suggestions } from '../../net/gameSocket';

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
  const talk = dialogue.value;
  return (
    <section class="action-input" aria-label="Your actions">
      {talk && (
        <div class="dialogue-panel" role="group" aria-label={`Conversation with ${talk.npc}`}>
          <p class="dialogue-line">
            <strong>{talk.speaker}:</strong> “{talk.text}”
          </p>
        </div>
      )}
      <div class={talk ? 'suggestions dialogue-options' : 'suggestions'}>
        {suggestions.value.map((a) => (
          <button key={a.id} type="button" disabled={offline} class={a.say ? 'idea' : undefined} onClick={() => send(a.say ? { type: 'say', text: a.say } : { type: 'choose', actionId: a.id })}>
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
      {WEB_EDITION && <p class="hint small free-text-hint">Use the buttons for best results: typed text is matched by keywords only.</p>}
    </section>
  );
}
