/**
 * Character creator shell: step rail, current step, summary panel and Back/Next navigation.
 * Steps not built yet show a placeholder (filled in by A044–A049).
 */
import type { ComponentType } from 'preact';
import { canAdvance, goToStep, nextStep, prevStep, stepLabel, stepProblems, stepsFor, type CreatorStep } from '../../../engine/character/creator';
import { db } from '../../data';
import { addingHero, screen } from '../state';
import { currentTranslator, t } from '../i18n';
import { beginAdventure, creator } from './creatorState';
import { AbilitiesStep } from './AbilitiesStep';
import { BackgroundStep } from './BackgroundStep';
import { ClassStep } from './ClassStep';
import { EquipmentStep } from './EquipmentStep';
import { SkillsStep } from './SkillsStep';
import { SpeciesStep } from './SpeciesStep';
import { SpellsStep } from './SpellsStep';
import { IdentityStep } from './IdentityStep';
import { DifficultyStep } from './DifficultyStep';
import { ReviewStep } from './ReviewStep';
import { AppearanceStep } from './AppearanceStep';
import { CharacterPreview } from '../../three/LazyCharacterPreview';
import { defaultAppearanceFor } from '../../../engine/appearance/appearance';
import { srdText } from '../srdText';

const STEP_COMPONENTS: Partial<Record<CreatorStep, ComponentType>> = {
  class: ClassStep,
  background: BackgroundStep,
  species: SpeciesStep,
  abilities: AbilitiesStep,
  skills: SkillsStep,
  equipment: EquipmentStep,
  spells: SpellsStep,
  appearance: AppearanceStep,
  identity: IdentityStep,
  difficulty: DifficultyStep,
  review: ReviewStep,
};

function Placeholder({ step }: { step: CreatorStep }) {
  return (
    <section>
      <h2>{stepLabel(step, currentTranslator())}</h2>
      <p class="hint">{t('creator.comingSoon')}</p>
    </section>
  );
}

function Summary() {
  const s = creator.value;
  const cls = s.classId ? db.classes.get(s.classId) : undefined;
  const bg = s.backgroundId ? db.backgrounds.get(s.backgroundId) : undefined;
  const sp = s.speciesId ? db.species.get(s.speciesId) : undefined;
  return (
    <aside class="creator-summary" aria-label={t('creator.summaryAria')}>
      <CharacterPreview appearance={s.appearance ?? defaultAppearanceFor(s.classId)} size={s.size ?? sp?.sizes[0] ?? 'medium'} />
      <h3>{s.name.trim() || t('creator.unnamed')}</h3>
      <dl>
        <dt>{t('creator.step.class')}</dt>
        <dd>{cls ? srdText('classes', cls.id, cls.name) : '—'}</dd>
        <dt>{t('creator.step.background')}</dt>
        <dd>{bg ? srdText('backgrounds', bg.id, bg.name) : '—'}</dd>
        <dt>{t('creator.step.species')}</dt>
        <dd>{sp ? srdText('species', sp.id, sp.name) : '—'}</dd>
      </dl>
    </aside>
  );
}

export function Creator() {
  const s = creator.value;
  const steps = stepsFor(s, db);
  const tr = currentTranslator();
  const problems = stepProblems(s, s.step, db, tr);
  const Step = STEP_COMPONENTS[s.step];
  const isLast = steps.indexOf(s.step) === steps.length - 1;
  return (
    <div class="creator">
      <nav class="step-rail" aria-label={t('creator.stepsAria')}>
        <button type="button" class="link-button" onClick={() => (addingHero.value ? ((addingHero.value = false), (screen.value = 'game')) : (screen.value = 'title'))}>
          {t(addingHero.value ? 'creator.backToGame' : 'creator.backToTitle')}
        </button>
        <ol>
          {steps.map((st, i) => {
            const done = stepProblems(s, st, db).length === 0 && steps.indexOf(s.step) > i;
            return (
              <li key={st} class={`${st === s.step ? 'current' : ''}${done ? ' done' : ''}`}>
                <button type="button" onClick={() => (creator.value = goToStep(s, st, db))} aria-current={st === s.step ? 'step' : undefined}>
                  <span class="step-num">{done ? '✓' : i + 1}</span> {stepLabel(st, tr)}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>
      <main class="step-main">{Step ? <Step /> : <Placeholder step={s.step} />}</main>
      <Summary />
      <footer class="step-nav">
        <button type="button" onClick={() => (creator.value = prevStep(s, db))} disabled={steps.indexOf(s.step) === 0}>
          {t('creator.back')}
        </button>
        <span class="step-problems" role="status">
          {problems[0] ?? ''}
        </span>
        <button type="button" class="primary" onClick={() => (isLast ? beginAdventure() : (creator.value = nextStep(s, db)))} disabled={!canAdvance(s, db)}>
          {isLast ? t(addingHero.value ? 'creator.addHero' : 'creator.begin') : t('creator.next')}
        </button>
      </footer>
    </div>
  );
}
