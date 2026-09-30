/** Creator step 5b: starting equipment — class package (A/B/C) and background package (A or 50 GP), plus generic item picks. */
import type { CreatorState } from '../../../engine/character/creator';
import type { ClassData } from '../../../engine/data/schemas';
import type { MessageKey } from '../../../shared/i18n';
import { db } from '../../data';
import { coins, t } from '../i18n';
import { creator } from './creatorState';
import { itemDisplayName } from '../text';
import { srdText } from '../srdText';

type Pkg = ClassData['startingEquipment'][number];

const CHOICE_OPTIONS: Record<string, { label: MessageKey; ids: () => string[] }> = {
  holy_symbol: { label: 'creator.item.holySymbol', ids: () => [...db.gear.values()].filter((g) => g.category === 'holy_symbol').map((g) => g.id) },
  gaming_set: { label: 'creator.item.gamingSet', ids: () => [...db.gear.values()].filter((g) => g.tags.includes('gaming_set')).map((g) => g.id) },
  musical_instrument: { label: 'creator.item.instrument', ids: () => [...db.gear.values()].filter((g) => g.tags.includes('musical_instrument')).map((g) => g.id) },
  artisans_tools_or_musical_instrument: {
    label: 'creator.item.toolOrInstrument',
    ids: () => [...db.gear.values()].filter((g) => g.category === 'tool').map((g) => g.id),
  },
};

const letter = (i: number) => String.fromCharCode(65 + i);
const choiceLabel = (tag: string) => (CHOICE_OPTIONS[tag] ? t(CHOICE_OPTIONS[tag].label) : tag);

function PackageText({ pkg }: { pkg: Pkg }) {
  const items = pkg.items.map(([id, n]) => `${n > 1 ? `${n} × ` : ''}${itemDisplayName(db.item(id)?.name ?? id)}`);
  const choices = pkg.choices.map(choiceLabel);
  const parts = [...items, ...choices];
  return <span>{parts.length ? `${parts.join(', ')}${pkg.cost ? `, ${coins(pkg.cost)}` : ''}` : coins(pkg.cost)}</span>;
}

const update = (patch: Partial<CreatorState>) => (creator.value = { ...creator.value, ...patch });

export function EquipmentStep() {
  const s = creator.value;
  const cls = s.classId ? db.classes.get(s.classId) : undefined;
  const bg = s.backgroundId ? db.backgrounds.get(s.backgroundId) : undefined;
  if (!cls || !bg) return <p class="hint">{t('creator.needClassAndBackground')}</p>;
  const chosen: Pkg[] = [cls.startingEquipment[s.classEquipment ?? -1], s.backgroundEquipment ? bg.equipment[s.backgroundEquipment] : undefined].filter((p): p is Pkg => Boolean(p));
  const pending = [...new Set(chosen.flatMap((p) => p.choices))];
  const toolChoice = bg.tool.startsWith('choice:') ? bg.tool.slice(7) : undefined;
  const picks = [...new Set([...pending, ...(toolChoice ? [toolChoice] : [])])];

  return (
    <section>
      <h2>{t('creator.equipment.title')}</h2>
      <p class="hint">{t('creator.equipment.hint')}</p>
      <fieldset>
        <legend>{t('creator.equipment.of', { name: srdText('classes', cls.id, cls.name) })}</legend>
        {cls.startingEquipment.map((pkg, i) => (
          <label key={i} class={`package${s.classEquipment === i ? ' selected' : ''}`}>
            <input type="radio" name="class-equipment" checked={s.classEquipment === i} onChange={() => update({ classEquipment: i })} />
            <strong>({letter(i)})</strong> <PackageText pkg={pkg} />
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend>{t('creator.equipment.of', { name: srdText('backgrounds', bg.id, bg.name) })}</legend>
        {(['a', 'b'] as const).map((k) => (
          <label key={k} class={`package${s.backgroundEquipment === k ? ' selected' : ''}`}>
            <input type="radio" name="bg-equipment" checked={s.backgroundEquipment === k} onChange={() => update({ backgroundEquipment: k })} />
            <strong>({k.toUpperCase()})</strong> <PackageText pkg={bg.equipment[k]} />
          </label>
        ))}
      </fieldset>
      {picks.length > 0 && (
        <fieldset>
          <legend>{t('creator.equipment.picks')}</legend>
          {picks.map((tag) => {
            const opt = CHOICE_OPTIONS[tag];
            if (!opt) return null;
            return (
              <label key={tag} class="select-row">
                {t(opt.label)}:{' '}
                <select value={s.choiceItems[tag] ?? ''} onChange={(e) => update({ choiceItems: { ...s.choiceItems, [tag]: (e.target as HTMLSelectElement).value } })}>
                  <option value="">{t('creator.equipment.default')}</option>
                  {opt.ids().map((id) => (
                    <option key={id} value={id}>
                      {itemDisplayName(db.item(id)?.name ?? id)}
                    </option>
                  ))}
                </select>
              </label>
            );
          })}
        </fieldset>
      )}
    </section>
  );
}
