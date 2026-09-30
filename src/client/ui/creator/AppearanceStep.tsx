/** Creator step 6: appearance — outfit, head, build, skin tone, colour and headgear/cape (live 3D preview). */
import { OUTFITS, OUTFIT_LABELS, SKIN_TONES, defaultAppearanceFor, type Appearance } from '../../../engine/appearance/appearance';
import { creator } from './creatorState';

function set(patch: Partial<Appearance>) {
  const cur = creator.value.appearance ?? defaultAppearanceFor(creator.value.classId);
  creator.value = { ...creator.value, appearance: { ...cur, ...patch } };
}

function Pills<T extends string>({ label, values, labels, value, onPick }: { label: string; values: readonly T[]; labels: Record<T, string>; value: T; onPick: (v: T) => void }) {
  return (
    <fieldset>
      <legend>{label}</legend>
      <div class="option-row">
        {values.map((v) => (
          <label key={v} class={`option-pill${value === v ? ' selected' : ''}`}>
            <input type="radio" name={label} checked={value === v} onChange={() => onPick(v)} />
            {labels[v]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function AppearanceStep() {
  const a = creator.value.appearance ?? defaultAppearanceFor(creator.value.classId);
  return (
    <section>
      <h2>Appearance</h2>
      <p class="hint">Shape your hero. The preview on the right updates as you go — drag it to turn the model.</p>
      <Pills label="Outfit" values={OUTFITS} labels={OUTFIT_LABELS} value={a.outfit} onPick={(outfit) => set({ outfit })} />
      <Pills label="Head and hair" values={OUTFITS} labels={OUTFIT_LABELS} value={a.head} onPick={(head) => set({ head })} />
      <Pills label="Build" values={['slim', 'average', 'broad'] as const} labels={{ slim: 'Slim', average: 'Average', broad: 'Broad' }} value={a.build} onPick={(build) => set({ build })} />
      <fieldset>
        <legend>Skin tone</legend>
        <div class="option-row">
          {SKIN_TONES.map((t) => (
            <button key={t} type="button" class={`swatch${a.skinTone === t ? ' selected' : ''}`} style={{ background: t }} aria-label={`Skin tone ${t}`} aria-pressed={a.skinTone === t} onClick={() => set({ skinTone: t })} />
          ))}
          <input type="color" value={a.skinTone} aria-label="Custom skin tone" onInput={(e) => set({ skinTone: (e.target as HTMLInputElement).value })} />
        </div>
      </fieldset>
      <fieldset>
        <legend>Colours</legend>
        <label class="select-row">
          Cape and headgear: <input type="color" value={a.primaryColor} onInput={(e) => set({ primaryColor: (e.target as HTMLInputElement).value })} />
        </label>
        <label class="select-row">
          <input type="checkbox" checked={a.showHeadgear} onChange={() => set({ showHeadgear: !a.showHeadgear })} /> Show headgear
        </label>
        <label class="select-row">
          <input type="checkbox" checked={a.showCape} onChange={() => set({ showCape: !a.showCape })} /> Show cape
        </label>
      </fieldset>
    </section>
  );
}
