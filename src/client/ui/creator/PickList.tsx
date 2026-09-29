/** Reusable "pick N of these" list: radio-like when N = 1, checkbox-like otherwise (extra picks disabled at the limit). */
import { plain } from '../text';

export interface PickOption {
  id: string;
  label: string;
  detail?: string;
  /** Shown as already granted and not selectable (e.g. background skills). */
  locked?: boolean;
}

export function PickList({ title, count, options, selected, onChange, compact }: { title: string; count: number; options: PickOption[]; selected: string[]; onChange: (ids: string[]) => void; compact?: boolean }) {
  const toggle = (id: string) => {
    if (count === 1) return onChange([id]);
    if (selected.includes(id)) onChange(selected.filter((x) => x !== id));
    else if (selected.length < count) onChange([...selected, id]);
  };
  return (
    <fieldset class="pick-list">
      <legend>
        {title} <span class="pick-count">{selected.length}/{count}</span>
      </legend>
      <div class={compact ? 'option-row' : 'pick-grid'}>
        {options.map((o) => {
          const on = selected.includes(o.id);
          const full = !on && count > 1 && selected.length >= count;
          return (
            <label key={o.id} class={`${compact ? 'option-pill' : 'pick-item'}${on || o.locked ? ' selected' : ''}${o.locked ? ' locked' : ''}`} title={o.detail ? plain(o.detail) : undefined}>
              <input type={count === 1 ? 'radio' : 'checkbox'} checked={on || o.locked} disabled={o.locked || full} onChange={() => toggle(o.id)} />
              <span>{o.label}</span>
              {!compact && o.detail && <small>{plain(o.detail).slice(0, 140)}{plain(o.detail).length > 140 ? '…' : ''}</small>}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
