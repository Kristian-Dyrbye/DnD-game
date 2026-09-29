/** Centre panel: the story log (narration, dialogue, player lines, system notes) with live streaming text. */
import { useEffect, useRef } from 'preact/hooks';
import { storyLog, streaming } from '../../net/gameSocket';

export function StoryLog() {
  const end = useRef<HTMLDivElement>(null);
  const entries = storyLog.value;
  const live = streaming.value;
  // Keep the newest text in view.
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end' });
  }, [entries.length, live?.text]);
  return (
    <section class="story-log" aria-label="Story" aria-live="polite">
      {entries.length === 0 && !live && <p class="hint">The story is about to begin…</p>}
      {entries.map((e) => (
        <p key={e.id} class={`log-entry log-${e.kind}`}>
          {e.kind === 'dialogue' && e.speaker && <strong class="speaker">{e.speaker}: </strong>}
          {e.kind === 'player' && <span class="speaker">› </span>}
          {e.text}
        </p>
      ))}
      {live && <p class="log-entry log-narration streaming">{live.text}</p>}
      <div ref={end} />
    </section>
  );
}
