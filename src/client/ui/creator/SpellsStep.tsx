/** Creator step 5c: cantrips and level 1 spells from the class list (counts from the class table). */
import { useState } from 'preact/hooks';
import { spellCounts } from '../../../engine/character/creator';
import type { Spell } from '../../../engine/data/schemas';
import { db } from '../../data';
import { t } from '../i18n';
import { ruleText, srdText } from '../srdText';
import { creator } from './creatorState';
import { firstSentence } from '../text';

const spellName = (sp: Spell): string => srdText('spells', sp.id, sp.name);

function castTime(sp: Spell): string {
  const c = sp.castingTime;
  const unit = t(`creator.cast.${c.unit}`);
  return `${c.unit === 'minute' || c.unit === 'hour' ? `${c.amount} ` : ''}${unit}${c.ritual ? ` ${t('creator.spells.ritual')}` : ''}`;
}

function range(sp: Spell): string {
  const r = sp.range;
  return r.kind === 'feet' || r.kind === 'miles' ? t(`creator.range.${r.kind}`, { n: r.amount ?? 0 }) : t(`creator.range.${r.kind}`);
}

function SpellGrid({ title, spells, count, selected, onChange }: { title: string; spells: Spell[]; count: number; selected: string[]; onChange: (ids: string[]) => void }) {
  const [filter, setFilter] = useState('');
  const shown = spells.filter((sp) => spellName(sp).toLowerCase().includes(filter.toLowerCase()));
  return (
    <fieldset>
      <legend>
        {title} <span class="pick-count">{selected.length}/{count}</span>
      </legend>
      <input class="search" type="search" placeholder={t('creator.spells.filter')} value={filter} onInput={(e) => setFilter((e.target as HTMLInputElement).value)} aria-label={t('creator.spells.filterAria', { title })} />
      <div class="spell-grid">
        {shown.map((sp) => {
          const on = selected.includes(sp.id);
          const full = !on && selected.length >= count;
          return (
            <label key={sp.id} class={`spell-card${on ? ' selected' : ''}${full ? ' disabled' : ''}`}>
              <input type="checkbox" checked={on} disabled={full} onChange={() => onChange(on ? selected.filter((x) => x !== sp.id) : [...selected, sp.id])} />
              <span class="spell-name">{spellName(sp)}</span>
              <span class="spell-meta">
                {ruleText('school', sp.school, sp.school[0]!.toUpperCase() + sp.school.slice(1))} ·{castTime(sp)} · {range(sp)}
                {sp.duration.concentration ? ` · ${t('creator.spells.concentration')}` : ''}
              </span>
              <small>{firstSentence(sp.text, 150)}</small>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function SpellsStep() {
  const s = creator.value;
  const cls = s.classId ? db.classes.get(s.classId) : undefined;
  if (!cls) return <p class="hint">{t('creator.needClass')}</p>;
  const need = spellCounts(s, db);
  const all = db.spellsForClass(cls.id, 1).sort((a, b) => spellName(a).localeCompare(spellName(b)));
  return (
    <section>
      <h2>{t('creator.spells.title')}</h2>
      <p class="hint">{t('creator.spells.hint')}</p>
      {need.cantrips > 0 && (
        <SpellGrid title={t('creator.spells.cantrips')} spells={all.filter((sp) => sp.level === 0)} count={need.cantrips} selected={s.cantrips} onChange={(ids) => (creator.value = { ...s, cantrips: ids })} />
      )}
      {need.spells > 0 && (
        <SpellGrid title={t('creator.spells.level1')} spells={all.filter((sp) => sp.level === 1)} count={need.spells} selected={s.preparedSpells} onChange={(ids) => (creator.value = { ...s, preparedSpells: ids })} />
      )}
    </section>
  );
}
