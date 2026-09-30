/** Creator step 8: Heroic (defeat, not death) or Hardcore (real death, world continues). */
import { t } from '../i18n';
import { creator } from './creatorState';

const MODES = ['heroic', 'hardcore'] as const;

export function DifficultyStep() {
  const s = creator.value;
  return (
    <section>
      <h2>{t('creator.difficulty.title')}</h2>
      <p class="hint">{t('creator.difficulty.hint')}</p>
      <div class="card-grid two">
        {MODES.map((m) => (
          <button type="button" key={m} class={`choice-card${s.difficulty === m ? ' selected' : ''}`} aria-pressed={s.difficulty === m} onClick={() => (creator.value = { ...creator.value, difficulty: m })}>
            <div class="card-head">
              <h3>{t(`creator.difficulty.${m}`)}</h3>
              <span class={`tag ${m === 'heroic' ? 'tag-beginner' : 'tag-primary'}`}>{t(`creator.difficulty.${m}Tag`)}</span>
            </div>
            <p>{t(`creator.difficulty.${m}Text`)}</p>
          </button>
        ))}
      </div>
    </section>
  );
}
