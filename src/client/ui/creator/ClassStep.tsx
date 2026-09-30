/** Creator step 1: choose a class. Cards show role, hit die, primary ability, armor and a beginner tag. */
import { chooseClass } from '../../../engine/character/creator';
import { quickBuild } from '../../../engine/character/quickBuild';
import { Rng } from '../../../engine/core/rng';
import { db } from '../../data';
import { t } from '../i18n';
import { creator } from './creatorState';
import { CLASS_INFO, classText } from './classInfo';
import { srdText, abilityText } from '../srdText';

const ARMOR_KEYS = { light: 'creator.armor.light', medium: 'creator.armor.medium', heavy: 'creator.armor.heavy', shield: 'creator.armor.shield' } as const;

export function ClassStep() {
  const selected = creator.value.classId;
  const classes = [...db.classes.values()].sort((a, b) => Number(b.beginnerFriendly) - Number(a.beginnerFriendly) || a.name.localeCompare(b.name));
  return (
    <section>
      <h2>{t('creator.class.title')}</h2>
      <p class="hint">{t('creator.class.hint')}</p>
      {selected && (
        <p class="quick-build">
          <button type="button" onClick={() => (creator.value = quickBuild(selected, db, Rng.fromSeed(`${Date.now()}`)))}>
            {t('creator.class.quickBuild', { name: srdText('classes', selected, db.classes.get(selected)?.name ?? selected) })}
          </button>{' '}
          <span class="hint">{t('creator.class.quickBuildHint')}</span>
        </p>
      )}
      <div class="card-grid">
        {classes.map((c) => {
          const info = CLASS_INFO[c.id];
          const armor = c.armorTraining.length ? c.armorTraining.map((a) => (a in ARMOR_KEYS ? t(ARMOR_KEYS[a as keyof typeof ARMOR_KEYS]) : a)).join(', ') : t('creator.none');
          return (
            <button
              type="button"
              key={c.id}
              class={`choice-card${selected === c.id ? ' selected' : ''}`}
              aria-pressed={selected === c.id}
              onClick={() => (creator.value = chooseClass(creator.value, c.id))}
            >
              <div class="card-head">
                <h3>{srdText('classes', c.id, c.name)}</h3>
                {c.beginnerFriendly && <span class="tag tag-beginner">{t('creator.class.beginner')}</span>}
              </div>
              {info && <p class="card-role">{classText(c.id, 'role')}</p>}
              {info && <p>{classText(c.id, 'blurb')}</p>}
              <dl class="card-stats">
                <dt>{t('creator.class.hitDie')}</dt>
                <dd>{c.hitDie.toUpperCase()}</dd>
                <dt>{t('creator.class.primary')}</dt>
                <dd>{c.primaryAbilities.map((a) => abilityText(a)).join(c.multiclass.anyOf ? t('creator.or') : ' & ')}</dd>
                <dt>{t('creator.class.armor')}</dt>
                <dd>{armor}</dd>
                <dt>{t('creator.class.magic')}</dt>
                <dd>{c.spellcasting.progression === 'none' ? t('creator.none') : c.spellcasting.progression === 'half' ? t('creator.class.magicSome') : t('creator.class.magicFull')}</dd>
              </dl>
              {info && (
                <p class="complexity" title={t('creator.class.complexityTitle')}>
                  {t('creator.class.complexity')} {'●'.repeat(info.complexity)}
                  {'○'.repeat(3 - info.complexity)}
                </p>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}
