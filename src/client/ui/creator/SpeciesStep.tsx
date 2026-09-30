/** Creator step 3: choose a species, then its lineage/ancestry and size where the species offers a choice. */
import { chooseSpecies } from '../../../engine/character/creator';
import { db } from '../../data';
import { t } from '../i18n';
import { creator } from './creatorState';
import { firstSentence } from '../text';

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);
const sizeName = (z: string) => (z === 'small' ? t('creator.size.small') : z === 'medium' ? t('creator.size.medium') : cap(z));

export function SpeciesStep() {
  const s = creator.value;
  const selected = s.speciesId ? db.species.get(s.speciesId) : undefined;
  return (
    <section>
      <h2>{t('creator.species.title')}</h2>
      <p class="hint">{t('creator.species.hint')}</p>
      <div class="card-grid">
        {[...db.species.values()].map((sp) => (
          <button
            type="button"
            key={sp.id}
            class={`choice-card${s.speciesId === sp.id ? ' selected' : ''}`}
            aria-pressed={s.speciesId === sp.id}
            onClick={() => (creator.value = chooseSpecies(creator.value, sp.id))}
          >
            <h3>{sp.name}</h3>
            <dl class="card-stats">
              <dt>{t('creator.species.size')}</dt>
              <dd>{sp.sizes.map(sizeName).join(t('creator.or'))}</dd>
              <dt>{t('creator.species.speed')}</dt>
              <dd>{t('creator.feet', { n: sp.speed })}</dd>
              <dt>{t('creator.species.darkvision')}</dt>
              <dd>{sp.darkvision ? t('creator.feet', { n: sp.darkvision }) : t('creator.none')}</dd>
            </dl>
            <ul class="trait-list">
              {sp.traits
                .filter((tr) => tr.name !== 'Darkvision')
                .map((tr) => (
                  <li key={tr.name}>
                    <strong>{tr.name}.</strong> {firstSentence(tr.text, 110)}
                  </li>
                ))}
            </ul>
          </button>
        ))}
      </div>

      {selected && (selected.lineages?.length || selected.sizes.length > 1) ? (
        <div class="sub-choice">
          {selected.lineages?.length ? (
            <fieldset>
              <legend>{selected.lineageLabel ?? t('creator.species.lineage')}</legend>
              <div class="option-row">
                {selected.lineages.map((l) => (
                  <label key={l.id} class={`option-pill${s.lineageId === l.id ? ' selected' : ''}`}>
                    <input type="radio" name="lineage" checked={s.lineageId === l.id} onChange={() => (creator.value = { ...creator.value, lineageId: l.id })} />
                    {l.name}
                    {l.damageType ? ` · ${cap(l.damageType)}` : ''}
                  </label>
                ))}
              </div>
              {(() => {
                const l = selected.lineages.find((x) => x.id === s.lineageId);
                return l?.text ? <p class="hint">{firstSentence(l.text, 220)}</p> : null;
              })()}
            </fieldset>
          ) : null}
          {selected.sizes.length > 1 && (
            <fieldset>
              <legend>{t('creator.species.size')}</legend>
              <div class="option-row">
                {selected.sizes.map((z) => (
                  <label key={z} class={`option-pill${s.size === z ? ' selected' : ''}`}>
                    <input type="radio" name="size" checked={s.size === z} onChange={() => (creator.value = { ...creator.value, size: z as 'small' | 'medium' })} />
                    {sizeName(z)}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
        </div>
      ) : null}
    </section>
  );
}
