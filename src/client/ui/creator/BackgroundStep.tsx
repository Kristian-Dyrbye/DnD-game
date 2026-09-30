/** Creator step 2: choose a background — shows ability score options, origin feat, skills, tool and equipment. */
import { chooseBackground } from '../../../engine/character/creator';
import type { Background } from '../../../engine/data/schemas';
import type { MessageKey } from '../../../shared/i18n';
import { db } from '../../data';
import { coins, t } from '../i18n';
import { creator } from './creatorState';
import { firstSentence, itemDisplayName } from '../text';
import { srdText, abilityText, itemText, skillText } from '../srdText';

const CHOICE_KEYS: Record<string, MessageKey> = {
  holy_symbol: 'creator.item.holySymbol',
  gaming_set: 'creator.item.gamingSetChoice',
  musical_instrument: 'creator.item.instrumentChoice',
};

const choiceLabel = (tag: string) => (CHOICE_KEYS[tag] ? t(CHOICE_KEYS[tag]) : tag);

function itemName(id: string): string {
  return itemDisplayName(itemText(id));
}

function packageText(opt: Background['equipment']['a']): string {
  const items = opt.items.map(([id, n]) => (n > 1 ? `${n} × ${itemName(id)}` : itemName(id)));
  const choices = opt.choices.map(choiceLabel);
  return [...items, ...choices, opt.cost ? coins(opt.cost) : ''].filter(Boolean).join(', ');
}

export function BackgroundStep() {
  const selected = creator.value.backgroundId;
  return (
    <section>
      <h2>{t('creator.background.title')}</h2>
      <p class="hint">{t('creator.background.hint')}</p>
      <div class="card-grid">
        {[...db.backgrounds.values()].map((bg) => {
          const feat = db.feats.get(bg.featId);
          const tool = bg.tool.startsWith('choice:') ? choiceLabel(bg.tool.slice(7)) : itemName(bg.tool);
          return (
            <button
              type="button"
              key={bg.id}
              class={`choice-card${selected === bg.id ? ' selected' : ''}`}
              aria-pressed={selected === bg.id}
              onClick={() => (creator.value = chooseBackground(creator.value, bg.id))}
            >
              <h3>{srdText('backgrounds', bg.id, bg.name)}</h3>
              <dl class="card-stats">
                <dt>{t('creator.background.abilities')}</dt>
                <dd>{bg.abilityScores.map((a) => abilityText(a)).join(', ')}</dd>
                <dt>{t('creator.background.feat')}</dt>
                <dd>
                  {srdText('feats', bg.featId, feat?.name ?? bg.featId)}
                  {bg.featOption ? ` (${bg.featOption[0]!.toUpperCase()}${bg.featOption.slice(1)})` : ''}
                </dd>
                <dt>{t('creator.background.skills')}</dt>
                <dd>{bg.skills.map((s) => skillText(s)).join(', ')}</dd>
                <dt>{t('creator.background.tool')}</dt>
                <dd>{tool}</dd>
              </dl>
              {feat && <p class="feat-text">{firstSentence(feat.text, 180)}</p>}
              <p class="equipment-line">
                <strong>{t('creator.background.gear')}</strong> {packageText(bg.equipment.a)} {t('creator.background.orCoins', { coins: coins(bg.equipment.b.cost) })}
              </p>
            </button>
          );
        })}
      </div>
    </section>
  );
}
