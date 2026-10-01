/**
 * Campaign picker (B001): one card per campaign from src/host/campaigns.ts with its name, level range
 * and blurb (en + da). Shown on the title screen and in the creator's Review step; both edit the same
 * `campaignChoice` signal that `new_game` sends. Campaigns without a first chapter yet are greyed out.
 */
import { CAMPAIGNS, campaignKeys, campaignOf, DEFAULT_CAMPAIGN } from '../../host/campaigns';
import type { MessageKey } from '../../shared/i18n';
import { t } from './i18n';
import { campaignChoice } from './state';

/** Name of a save's campaign (old saves without the field are starter-arc games). */
export function campaignName(adventure: string | undefined): string {
  const c = campaignOf(adventure) ?? (adventure === undefined ? DEFAULT_CAMPAIGN : undefined);
  return c ? t(campaignKeys(c.id).name as MessageKey) : adventure!;
}

export function CampaignPicker({ class: cls }: { class?: string }) {
  return (
    <div class={`campaign-picker${cls ? ` ${cls}` : ''}`} role="radiogroup" aria-label={t('campaign.pick')}>
      <span>{t('campaign.pick')}</span>
      <div class="campaign-cards">
        {CAMPAIGNS.map((c) => {
          const keys = campaignKeys(c.id);
          const selected = campaignChoice.value === c.adventure;
          return (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={selected}
              class={`campaign-card${selected ? ' selected' : ''}`}
              disabled={!c.playable}
              onClick={() => (campaignChoice.value = c.adventure)}
            >
              <strong>{t(keys.name as MessageKey)}</strong>
              <span class="small">{c.playable ? t('campaign.levels', { from: c.levels[0], to: c.levels[1] }) : t('campaign.comingSoon')}</span>
              <p>{t(keys.blurb as MessageKey)}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
