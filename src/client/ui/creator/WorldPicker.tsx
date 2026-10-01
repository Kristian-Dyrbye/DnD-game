/**
 * "New hero, same world" picker (B002), shown in the creator's Review step under the campaign cards when
 * the chosen campaign can import a world: "A new world" or one of the saves whose story reached an
 * ending (save meta `ending`). The choice goes out as `new_game.worldFrom` (creatorState.beginAdventure).
 */
import { useEffect, useState } from 'preact/hooks';
import type { SaveMeta } from '../../../shared/save';
import { campaignOf } from '../../../host/campaigns';
import { saveLibrary } from '../../net/saveLibrary';
import { campaignName } from '../CampaignPicker';
import { language, t } from '../i18n';
import { campaignChoice, worldFromChoice } from '../state';

/** Saves a new hero's world can come from: those whose story reached an ending (list order kept). */
export function finishedWorlds(saves: readonly SaveMeta[]): SaveMeta[] {
  return saves.filter((s) => s.ending !== undefined);
}

export function WorldPicker() {
  const [saves, setSaves] = useState<SaveMeta[] | null>(null);
  const imports = campaignOf(campaignChoice.value)?.importsWorld ?? false;
  useEffect(() => {
    if (imports && saves === null) void saveLibrary().list().then((l) => setSaves(finishedWorlds(l)), () => setSaves([]));
  }, [imports]);
  if (!imports) return null;
  const chosen = worldFromChoice.value;
  const option = (slot: string | null, title: string, detail: string) => (
    <button
      key={slot ?? 'new'}
      type="button"
      role="radio"
      aria-checked={chosen === slot}
      class={`campaign-card${chosen === slot ? ' selected' : ''}`}
      onClick={() => (worldFromChoice.value = slot)}
    >
      <strong>{title}</strong>
      <p>{detail}</p>
    </button>
  );
  return (
    <div class="campaign-picker review-world" role="radiogroup" aria-label={t('world.pick')}>
      <span>{t('world.pick')}</span>
      <div class="campaign-cards">
        {option(null, t('world.fresh'), t('world.freshBlurb'))}
        {(saves ?? []).map((s) =>
          option(
            s.slotId,
            t('world.from', { name: s.characterName, campaign: campaignName(s.campaign) }),
            t('world.fromBlurb', { level: s.level, date: new Date(s.savedAt).toLocaleDateString(language.value) }),
          ),
        )}
      </div>
      {saves !== null && saves.length === 0 && <p class="small">{t('world.none')}</p>}
    </div>
  );
}
