/** Left panel: the hero (and later companions) with HP bar, AC, level/XP, conditions and coins. */
import type { Character } from '../../../engine/core/creature';
import { totalLevel } from '../../../engine/core/creature';
import { db } from '../../data';
import { formatCoins } from '../text';
import { canLevelUp } from '../../../engine/character/leveling';
import { send } from '../../net/gameSocket';

function MemberCard({ c, lead, onLevelUp, loyalty, control, onToggle }: { c: Character; lead?: boolean; onLevelUp?: () => void; loyalty?: number; control?: 'ai' | 'player'; onToggle?: () => void }) {
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
      {onToggle && (
        <button type="button" class="link-button small" onClick={onToggle} title="Who decides this companion's actions in combat">
          Combat: {control === 'player' ? 'you control' : 'AI'} ⇄
        </button>
      )}
      {loyalty !== undefined && (
        <p class="member-coins" title="Companion approval (0–100)">
          Loyalty {loyalty}
          {loyalty <= 20 ? ' · unhappy' : loyalty >= 70 ? ' · devoted' : ''}
        </p>
      )}
      {lead && onLevelUp && canLevelUp(c, db) && (
        <button type="button" class="primary level-up" onClick={onLevelUp}>
          Level up!
        </button>
      )}
    </article>
  );
}

export function PartyPanel({ hero, companions, onLevelUp, loyalty, controls }: { hero: Character; companions: Character[]; onLevelUp?: () => void; loyalty?: Record<string, number>; controls?: Record<string, 'ai' | 'player'> }) {
  return (
    <aside class="party-panel" aria-label="Party">
      <h2>Party</h2>
      <MemberCard c={hero} lead {...(onLevelUp && { onLevelUp })} />
      {companions.map((c) => (
        <MemberCard
          key={c.id}
          c={c}
          {...(loyalty?.[c.id] !== undefined && { loyalty: loyalty[c.id] })}
          control={controls?.[c.id] ?? 'ai'}
          onToggle={() => send({ type: 'companion_control', companionId: c.id, control: controls?.[c.id] === 'player' ? 'ai' : 'player' })}
        />
      ))}
      {companions.length === 0 && <p class="hint small">No companions yet.</p>}
    </aside>
  );
}
