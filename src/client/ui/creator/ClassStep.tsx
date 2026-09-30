/** Creator step 1: choose a class. Cards show role, hit die, primary ability, armor and a beginner tag. */
import { chooseClass } from '../../../engine/character/creator';
import { quickBuild } from '../../../engine/character/quickBuild';
import { Rng } from '../../../engine/core/rng';
import { ABILITY_NAMES } from '../../../engine/rules/basics';
import { db } from '../../data';
import { creator } from './creatorState';
import { CLASS_INFO } from './classInfo';

const ARMOR_LABEL: Record<string, string> = { light: 'Light', medium: 'Medium', heavy: 'Heavy', shield: 'Shields' };

export function ClassStep() {
  const selected = creator.value.classId;
  const classes = [...db.classes.values()].sort((a, b) => Number(b.beginnerFriendly) - Number(a.beginnerFriendly) || a.name.localeCompare(b.name));
  return (
    <section>
      <h2>Choose your class</h2>
      <p class="hint">Your class is your calling: how you fight, what magic you wield and how you solve problems.</p>
      {selected && (
        <p class="quick-build">
          <button type="button" onClick={() => (creator.value = quickBuild(selected, db, Rng.fromSeed(`${Date.now()}`)))}>
            Quick Build a {db.classes.get(selected)?.name}
          </button>{' '}
          <span class="hint">Fills every step with sensible choices and jumps to the review. You can still change anything.</span>
        </p>
      )}
      <div class="card-grid">
        {classes.map((c) => {
          const info = CLASS_INFO[c.id];
          const armor = c.armorTraining.length ? c.armorTraining.map((a) => ARMOR_LABEL[a]).join(', ') : 'None';
          return (
            <button
              type="button"
              key={c.id}
              class={`choice-card${selected === c.id ? ' selected' : ''}`}
              aria-pressed={selected === c.id}
              onClick={() => (creator.value = chooseClass(creator.value, c.id))}
            >
              <div class="card-head">
                <h3>{c.name}</h3>
                {c.beginnerFriendly && <span class="tag tag-beginner">Recommended for beginners</span>}
              </div>
              {info && <p class="card-role">{info.role}</p>}
              {info && <p>{info.blurb}</p>}
              <dl class="card-stats">
                <dt>Hit Die</dt>
                <dd>{c.hitDie.toUpperCase()}</dd>
                <dt>Primary</dt>
                <dd>{c.primaryAbilities.map((a) => ABILITY_NAMES[a]).join(c.multiclass.anyOf ? ' or ' : ' & ')}</dd>
                <dt>Armor</dt>
                <dd>{armor}</dd>
                <dt>Magic</dt>
                <dd>{c.spellcasting.progression === 'none' ? 'None' : c.spellcasting.progression === 'half' ? 'Some' : 'Full'}</dd>
              </dl>
              {info && (
                <p class="complexity" title="How many options you manage in play">
                  Complexity: {'●'.repeat(info.complexity)}
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
