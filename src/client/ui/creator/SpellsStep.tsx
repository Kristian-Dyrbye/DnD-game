/** Creator step 5c: cantrips and level 1 spells from the class list (counts from the class table). */
import { useState } from 'preact/hooks';
import { spellCounts } from '../../../engine/character/creator';
import type { Spell } from '../../../engine/data/schemas';
import { db } from '../../data';
import { creator } from '../state';
import { firstSentence } from '../text';

function castTime(sp: Spell): string {
  const c = sp.castingTime;
  const unit = { action: 'Action', bonus_action: 'Bonus Action', reaction: 'Reaction', minute: 'min', hour: 'h' }[c.unit];
  return `${c.unit === 'minute' || c.unit === 'hour' ? `${c.amount} ` : ''}${unit}${c.ritual ? ' (ritual)' : ''}`;
}

function range(sp: Spell): string {
  const r = sp.range;
  return r.kind === 'feet' ? `${r.amount} ft` : r.kind === 'miles' ? `${r.amount} mi` : r.kind[0]!.toUpperCase() + r.kind.slice(1);
}

function SpellGrid({ title, spells, count, selected, onChange }: { title: string; spells: Spell[]; count: number; selected: string[]; onChange: (ids: string[]) => void }) {
  const [filter, setFilter] = useState('');
  const shown = spells.filter((sp) => sp.name.toLowerCase().includes(filter.toLowerCase()));
  return (
    <fieldset>
      <legend>
        {title} <span class="pick-count">{selected.length}/{count}</span>
      </legend>
      <input class="search" type="search" placeholder="Filter…" value={filter} onInput={(e) => setFilter((e.target as HTMLInputElement).value)} aria-label={`Filter ${title}`} />
      <div class="spell-grid">
        {shown.map((sp) => {
          const on = selected.includes(sp.id);
          const full = !on && selected.length >= count;
          return (
            <label key={sp.id} class={`spell-card${on ? ' selected' : ''}${full ? ' disabled' : ''}`}>
              <input type="checkbox" checked={on} disabled={full} onChange={() => onChange(on ? selected.filter((x) => x !== sp.id) : [...selected, sp.id])} />
              <span class="spell-name">{sp.name}</span>
              <span class="spell-meta">
                {sp.school[0]!.toUpperCase() + sp.school.slice(1)} · {castTime(sp)} · {range(sp)}
                {sp.duration.concentration ? ' · Concentration' : ''}
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
  if (!cls) return <p class="hint">Choose a class first.</p>;
  const need = spellCounts(s, db);
  const all = db.spellsForClass(cls.id, 1).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <section>
      <h2>Spells</h2>
      <p class="hint">Choose the magic you start with. You can change prepared spells as you level up.</p>
      {need.cantrips > 0 && (
        <SpellGrid title="Cantrips" spells={all.filter((sp) => sp.level === 0)} count={need.cantrips} selected={s.cantrips} onChange={(ids) => (creator.value = { ...s, cantrips: ids })} />
      )}
      {need.spells > 0 && (
        <SpellGrid title="Level 1 spells" spells={all.filter((sp) => sp.level === 1)} count={need.spells} selected={s.preparedSpells} onChange={(ids) => (creator.value = { ...s, preparedSpells: ids })} />
      )}
    </section>
  );
}
