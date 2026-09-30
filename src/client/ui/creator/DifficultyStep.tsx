/** Creator step 8: Heroic (defeat, not death) or Hardcore (real death, world continues). */
import { creator } from './creatorState';

const MODES = [
  {
    id: 'heroic' as const,
    name: 'Heroic',
    tag: 'Recommended',
    text: 'Death saves still matter, but failing them means defeat, not death: you are captured, robbed, rescued or wake somewhere with consequences. The story always goes on.',
  },
  {
    id: 'hardcore' as const,
    name: 'Hardcore',
    tag: 'For veterans',
    text: 'Standard 5e death. If your hero dies, you can create a new hero who continues in the same world, with everything you changed still in place.',
  },
];

export function DifficultyStep() {
  const s = creator.value;
  return (
    <section>
      <h2>Difficulty</h2>
      <p class="hint">Both modes autosave and let you keep manual saves.</p>
      <div class="card-grid two">
        {MODES.map((m) => (
          <button type="button" key={m.id} class={`choice-card${s.difficulty === m.id ? ' selected' : ''}`} aria-pressed={s.difficulty === m.id} onClick={() => (creator.value = { ...creator.value, difficulty: m.id })}>
            <div class="card-head">
              <h3>{m.name}</h3>
              <span class={`tag ${m.id === 'heroic' ? 'tag-beginner' : 'tag-primary'}`}>{m.tag}</span>
            </div>
            <p>{m.text}</p>
          </button>
        ))}
      </div>
    </section>
  );
}
