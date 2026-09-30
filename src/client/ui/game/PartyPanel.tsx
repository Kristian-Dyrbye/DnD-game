/** Left panel: the hero (and later companions) with HP bar, AC, level/XP, conditions and coins. */
import type { Character } from '../../../engine/core/creature';
import { totalLevel } from '../../../engine/core/creature';
import { db } from '../../data';
import { coins, t } from '../i18n';
import { canLevelUp } from '../../../engine/character/leveling';
import { send } from '../../net/gameSocket';
import { scarLabel, scarLine } from './labels';
import { srdText } from '../srdText';

function MemberCard({ c, lead, onLevelUp, loyalty, control, onToggle }: { c: Character; lead?: boolean; onLevelUp?: () => void; loyalty?: number; control?: 'ai' | 'player'; onToggle?: () => void }) {
  const pct = Math.max(0, Math.min(100, (c.hp / c.maxHp) * 100));
  const classes = c.classes.map((cl) => `${srdText('classes', cl.classId, db.classes.get(cl.classId)?.name ?? cl.classId)} ${cl.level}`).join(' / ');
  const hpClass = pct <= 25 ? 'low' : pct <= 50 ? 'mid' : 'ok';
  const mood = loyalty === undefined ? undefined : loyalty <= 20 ? t('party.unhappy') : loyalty >= 70 ? t('party.devoted') : undefined;
  return (
    <article class={`member-card${lead ? ' lead' : ''}`} aria-label={`${c.name}, ${classes}`}>
      <header>
        <strong>{c.name}</strong>
        <span class="muted">{classes}</span>
      </header>
      <div class={`hp-bar hp-${hpClass}`} role="meter" aria-valuemin={0} aria-valuemax={c.maxHp} aria-valuenow={c.hp} aria-label={t('party.hpAria')}>
        <div style={{ width: `${pct}%` }} />
        <span>
          {t('party.hp', { hp: c.hp, max: c.maxHp })}
          {c.tempHp ? ` (+${c.tempHp})` : ''}
        </span>
      </div>
      <dl class="member-stats">
        <dt>{t('party.ac')}</dt>
        <dd>{c.ac}</dd>
        <dt>{t('party.level')}</dt>
        <dd>{totalLevel(c)}</dd>
        <dt>{t('party.xp')}</dt>
        <dd>{c.xp}</dd>
      </dl>
      {(c.conditions.length > 0 || c.exhaustion > 0) && (
        <p class="member-conditions">
          {[...c.conditions.map((x) => srdText('conditions', x.condition, x.condition)),...(c.exhaustion ? [t('party.exhaustion', { n: c.exhaustion })] : [])].map((x) => (
            <span key={x} class="tag tag-condition">
              {x}
            </span>
          ))}
        </p>
      )}
      {c.scars.length > 0 && (
        <p class="member-scars" aria-label={t('party.scarsAria')}>
          {c.scars.map((s) => (
            <span key={s.id} class="tag tag-scar" tabIndex={0} title={scarLine(s)}>
              ⚔ {scarLabel(s.location)}
            </span>
          ))}
        </p>
      )}
      {lead && <p class="member-coins">{coins(c.coins)}</p>}
      {onToggle && (
        <button type="button" class="link-button small" onClick={onToggle} title={t('party.controlTitle')}>
          {t('party.control', { who: t(control === 'player' ? 'party.controlPlayer' : 'party.controlAi') })}
        </button>
      )}
      {loyalty !== undefined && (
        <p class="member-coins" title={t('party.loyaltyTitle')}>
          {t('party.loyalty', { n: loyalty })}
          {mood ? ` · ${mood}` : ''}
        </p>
      )}
      {lead && onLevelUp && canLevelUp(c, db) && (
        <button type="button" class="primary level-up" onClick={onLevelUp}>
          {t('party.levelUp')}
        </button>
      )}
    </article>
  );
}

export function PartyPanel({ hero, companions, onLevelUp, loyalty, controls }: { hero: Character; companions: Character[]; onLevelUp?: () => void; loyalty?: Record<string, number>; controls?: Record<string, 'ai' | 'player'> }) {
  return (
    <aside class="party-panel" aria-label={t('party.title')}>
      <h2>{t('party.title')}</h2>
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
      {companions.length === 0 && <p class="hint small">{t('party.noCompanions')}</p>}
    </aside>
  );
}
