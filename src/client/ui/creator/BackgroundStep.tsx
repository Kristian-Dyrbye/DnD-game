/** Creator step 2: choose a background — shows ability score options, origin feat, skills, tool and equipment. */
import { chooseBackground } from '../../../engine/character/creator';
import { ABILITY_NAMES, SKILL_NAMES } from '../../../engine/rules/basics';
import type { Background } from '../../../engine/data/schemas';
import { db } from '../../data';
import { creator } from './creatorState';
import { firstSentence, formatCoins, itemDisplayName } from '../text';

const CHOICE_LABEL: Record<string, string> = {
  holy_symbol: 'Holy Symbol',
  gaming_set: 'Gaming Set of your choice',
  musical_instrument: 'Musical Instrument of your choice',
};

function itemName(id: string): string {
  return itemDisplayName(db.item(id)?.name ?? id);
}

function packageText(opt: Background['equipment']['a']): string {
  const items = opt.items.map(([id, n]) => (n > 1 ? `${n} × ${itemName(id)}` : itemName(id)));
  const choices = opt.choices.map((c) => CHOICE_LABEL[c] ?? c);
  return [...items, ...choices, opt.cost ? formatCoins(opt.cost) : ''].filter(Boolean).join(', ');
}

export function BackgroundStep() {
  const selected = creator.value.backgroundId;
  return (
    <section>
      <h2>Choose your background</h2>
      <p class="hint">Your background is the life you led before adventure. It improves three ability scores and grants an origin feat, two skills and a tool.</p>
      <div class="card-grid">
        {[...db.backgrounds.values()].map((bg) => {
          const feat = db.feats.get(bg.featId);
          const tool = bg.tool.startsWith('choice:') ? (CHOICE_LABEL[bg.tool.slice(7)] ?? bg.tool) : itemName(bg.tool);
          return (
            <button
              type="button"
              key={bg.id}
              class={`choice-card${selected === bg.id ? ' selected' : ''}`}
              aria-pressed={selected === bg.id}
              onClick={() => (creator.value = chooseBackground(creator.value, bg.id))}
            >
              <h3>{bg.name}</h3>
              <dl class="card-stats">
                <dt>Abilities</dt>
                <dd>{bg.abilityScores.map((a) => ABILITY_NAMES[a]).join(', ')}</dd>
                <dt>Feat</dt>
                <dd>
                  {feat?.name ?? bg.featId}
                  {bg.featOption ? ` (${bg.featOption[0]!.toUpperCase()}${bg.featOption.slice(1)})` : ''}
                </dd>
                <dt>Skills</dt>
                <dd>{bg.skills.map((s) => SKILL_NAMES[s]).join(', ')}</dd>
                <dt>Tool</dt>
                <dd>{tool}</dd>
              </dl>
              {feat && <p class="feat-text">{firstSentence(feat.text, 180)}</p>}
              <p class="equipment-line">
                <strong>Gear:</strong> {packageText(bg.equipment.a)} — or {formatCoins(bg.equipment.b.cost)}
              </p>
            </button>
          );
        })}
      </div>
    </section>
  );
}
