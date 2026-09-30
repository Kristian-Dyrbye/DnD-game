/** Creator step 6: appearance — outfit, head, build, skin tone, colour and headgear/cape (live 3D preview). */
import { OUTFITS, SKIN_TONES, defaultAppearanceFor, type Appearance, type Outfit } from '../../../engine/appearance/appearance';
import { t } from '../i18n';
import { creator } from './creatorState';

const BUILDS = ['slim', 'average', 'broad'] as const;

function set(patch: Partial<Appearance>) {
  const cur = creator.value.appearance ?? defaultAppearanceFor(creator.value.classId);
  creator.value = { ...creator.value, appearance: { ...cur, ...patch } };
}

function Pills<T extends string>({ name, label, values, labelOf, value, onPick }: { name: string; label: string; values: readonly T[]; labelOf: (v: T) => string; value: T; onPick: (v: T) => void }) {
  return (
    <fieldset>
      <legend>{label}</legend>
      <div class="option-row">
        {values.map((v) => (
          <label key={v} class={`option-pill${value === v ? ' selected' : ''}`}>
            <input type="radio" name={name} checked={value === v} onChange={() => onPick(v)} />
            {labelOf(v)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const outfitLabel = (o: Outfit) => t(`outfit.${o}`);

export function AppearanceStep() {
  const a = creator.value.appearance ?? defaultAppearanceFor(creator.value.classId);
  return (
    <section>
      <h2>{t('creator.appearance.title')}</h2>
      <p class="hint">{t('creator.appearance.hint')}</p>
      <Pills name="outfit" label={t('creator.appearance.outfit')} values={OUTFITS} labelOf={outfitLabel} value={a.outfit} onPick={(outfit) => set({ outfit })} />
      <Pills name="head" label={t('creator.appearance.head')} values={OUTFITS} labelOf={outfitLabel} value={a.head} onPick={(head) => set({ head })} />
      <Pills name="build" label={t('creator.appearance.build')} values={BUILDS} labelOf={(b) => t(`creator.build.${b}`)} value={a.build} onPick={(build) => set({ build })} />
      <fieldset>
        <legend>{t('creator.appearance.skinTone')}</legend>
        <div class="option-row">
          {SKIN_TONES.map((tone) => (
            <button key={tone} type="button" class={`swatch${a.skinTone === tone ? ' selected' : ''}`} style={{ background: tone }} aria-label={t('creator.appearance.skinToneAria', { tone })} aria-pressed={a.skinTone === tone} onClick={() => set({ skinTone: tone })} />
          ))}
          <input type="color" value={a.skinTone} aria-label={t('creator.appearance.customSkin')} onInput={(e) => set({ skinTone: (e.target as HTMLInputElement).value })} />
        </div>
      </fieldset>
      <fieldset>
        <legend>{t('creator.appearance.colours')}</legend>
        <label class="select-row">
          {t('creator.appearance.capeColour')} <input type="color" value={a.primaryColor} onInput={(e) => set({ primaryColor: (e.target as HTMLInputElement).value })} />
        </label>
        <label class="select-row">
          <input type="checkbox" checked={a.showHeadgear} onChange={() => set({ showHeadgear: !a.showHeadgear })} /> {t('creator.appearance.showHeadgear')}
        </label>
        <label class="select-row">
          <input type="checkbox" checked={a.showCape} onChange={() => set({ showCape: !a.showCape })} /> {t('creator.appearance.showCape')}
        </label>
      </fieldset>
    </section>
  );
}
