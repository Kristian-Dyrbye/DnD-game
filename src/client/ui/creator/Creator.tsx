/**
 * Character creator shell: step rail, current step, summary panel and Back/Next navigation.
 * Steps not built yet show a placeholder (filled in by A044–A049).
 */
import type { ComponentType } from 'preact';
import { STEP_LABELS, canAdvance, goToStep, nextStep, prevStep, stepProblems, stepsFor, type CreatorStep } from '../../../engine/character/creator';
import { db } from '../../data';
import { creator, screen } from '../state';
import { ClassStep } from './ClassStep';

const STEP_COMPONENTS: Partial<Record<CreatorStep, ComponentType>> = {
  class: ClassStep,
};

function Placeholder({ step }: { step: CreatorStep }) {
  return (
    <section>
      <h2>{STEP_LABELS[step]}</h2>
      <p class="hint">This step is coming soon.</p>
    </section>
  );
}

function Summary() {
  const s = creator.value;
  const cls = s.classId ? db.classes.get(s.classId) : undefined;
  const bg = s.backgroundId ? db.backgrounds.get(s.backgroundId) : undefined;
  const sp = s.speciesId ? db.species.get(s.speciesId) : undefined;
  return (
    <aside class="creator-summary" aria-label="Character summary">
      <div class="preview-slot" aria-hidden="true">
        <span>3D preview</span>
      </div>
      <h3>{s.name.trim() || 'Unnamed hero'}</h3>
      <dl>
        <dt>Class</dt>
        <dd>{cls?.name ?? '—'}</dd>
        <dt>Background</dt>
        <dd>{bg?.name ?? '—'}</dd>
        <dt>Species</dt>
        <dd>{sp?.name ?? '—'}</dd>
      </dl>
    </aside>
  );
}

export function Creator() {
  const s = creator.value;
  const steps = stepsFor(s, db);
  const problems = stepProblems(s, s.step, db);
  const Step = STEP_COMPONENTS[s.step];
  const isLast = steps.indexOf(s.step) === steps.length - 1;
  return (
    <div class="creator">
      <nav class="step-rail" aria-label="Creation steps">
        <button type="button" class="link-button" onClick={() => (screen.value = 'title')}>
          ← Title
        </button>
        <ol>
          {steps.map((st, i) => {
            const done = stepProblems(s, st, db).length === 0 && steps.indexOf(s.step) > i;
            return (
              <li key={st} class={`${st === s.step ? 'current' : ''}${done ? ' done' : ''}`}>
                <button type="button" onClick={() => (creator.value = goToStep(s, st, db))} aria-current={st === s.step ? 'step' : undefined}>
                  <span class="step-num">{done ? '✓' : i + 1}</span> {STEP_LABELS[st]}
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
          Back
        </button>
        <span class="step-problems" role="status">
          {problems[0] ?? ''}
        </span>
        <button type="button" class="primary" onClick={() => (creator.value = nextStep(s, db))} disabled={!canAdvance(s, db) || isLast}>
          {isLast ? 'Begin adventure' : 'Next'}
        </button>
      </footer>
    </div>
  );
}
