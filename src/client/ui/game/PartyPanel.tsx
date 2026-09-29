/** Left panel: the hero (and later companions) with HP bar, AC, level/XP, conditions and coins. */
import type { Character } from '../../../engine/core/creature';
import { totalLevel } from '../../../engine/core/creature';
import { db } from '../../data';
import { formatCoins } from '../text';

function MemberCard({ c, lead }: { c: Character; lead?: boolean }) {
  const pct = Math.max(0, Math.min(100, (c.hp / c.maxHp) * 100));
  const classes = c.classes.map((cl) => `${db.classes.get(cl.classId)?.name ?? cl.classId} ${cl.level}`).join(' / ');
  const hpClass = pct <= 25 ? 'low' : pct <= 50 ? 'mid' : 'ok';
  return (
    <article class={`member-card${lead ? ' lead' : ''}`} aria-label={`${c.name}, ${classes}`}>
      <header>
        <strong>{c.name}</strong>
        <span class="muted">{classes}</span>
      </header>
      <div class={`hp-bar hp-${hpClass}`} role="meter" aria-valuemin={0} aria-valuemax={c.maxHp} aria-valuenow={c.hp} aria-label="Hit points">
        <div style={{ width: `${pct}%` }} />
        <span>
          {c.hp}/{c.maxHp} HP{c.tempHp ? ` (+${c.tempHp})` : ''}
        </span>
      </div>
      <dl class="member-stats">
        <dt>AC</dt>
        <dd>{c.ac}</dd>
        <dt>Level</dt>
        <dd>{totalLevel(c)}</dd>
        <dt>XP</dt>
        <dd>{c.xp}</dd>
      </dl>
      {(c.conditions.length > 0 || c.exhaustion > 0) && (
        <p class="member-conditions">
          {[...c.conditions.map((x) => x.condition), ...(c.exhaustion ? [`exhaustion ${c.exhaustion}`] : [])].map((x) => (
            <span key={x} class="tag tag-condition">
              {x}
            </span>
          ))}
        </p>
      )}
      {lead && <p class="member-coins">{formatCoins(c.coins)}</p>}
    </article>
  );
}

export function PartyPanel({ hero, companions }: { hero: Character; companions: Character[] }) {
  return (
    <aside class="party-panel" aria-label="Party">
      <h2>Party</h2>
      <MemberCard c={hero} lead />
      {companions.map((c) => (
        <MemberCard key={c.id} c={c} />
      ))}
      {companions.length === 0 && <p class="hint small">No companions yet.</p>}
    </aside>
  );
}
