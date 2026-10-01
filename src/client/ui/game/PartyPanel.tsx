/** Left panel: the hero, other player-made heroes (C002) and companions with HP bar, AC, level/XP, conditions and coins. */
import type { Character } from '../../../engine/core/creature';
import { totalLevel } from '../../../engine/core/creature';
import { db } from '../../data';
import { coins, t } from '../i18n';
import { canLevelUp } from '../../../engine/character/leveling';
import { MAX_COMPANIONS } from '../../../engine/party/companions';
import { send } from '../../net/gameSocket';
import { mayAddHero, partyRights, type PageSeat } from '../../net/coopView';
import { scarLabel, scarLine } from './labels';
import { srdText } from '../srdText';

function MemberCard({ c, lead, isHero, onLevelUp, loyalty, control, onToggle }: { c: Character; lead?: boolean; isHero?: boolean; onLevelUp?: () => void; loyalty?: number; control?: 'ai' | 'player'; onToggle?: () => void }) {
  const pct = Math.max(0, Math.min(100, (c.hp / c.maxHp) * 100));
  const classes = c.classes.map((cl) => `${srdText('classes', cl.classId, db.classes.get(cl.classId)?.name ?? cl.classId)} ${cl.level}`).join(' / ');
  const hpClass = pct <= 25 ? 'low' : pct <= 50 ? 'mid' : 'ok';
  const mood = loyalty === undefined ? undefined : loyalty <= 20 ? t('party.unhappy') : loyalty >= 70 ? t('party.devoted') : undefined;
  return (
    <article class={`member-card${lead ? ' lead' : ''}`} aria-label={`${c.name}, ${classes}`}>
      <header>
        <strong>{c.name}</strong>
        {isHero && !lead && <span class="tag tag-primary">{t('party.heroTag')}</span>}
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
      {(lead || isHero) && onLevelUp && canLevelUp(c, db) && (
        <button type="button" class="primary level-up" onClick={onLevelUp}>
          {t('party.levelUp')}
        </button>
      )}
    </article>
  );
}

/** Player-made heroes first, then roster companions, each group in party order (the main hero is shown above both). */
export function partyOrder(companions: Character[], origins: Record<string, string>): Character[] {
  return [...companions.filter((c) => origins[c.id] === 'hero'), ...companions.filter((c) => origins[c.id] !== 'hero')];
}

export function PartyPanel({ hero, companions, origins = {}, onLevelUp, onAddHero, loyalty, controls, seat = { role: 'host' } }: { hero: Character; companions: Character[]; origins?: Record<string, string>; onLevelUp?: (id: string) => void; onAddHero?: () => void; loyalty?: Record<string, number>; controls?: Record<string, string>; seat?: PageSeat }) {
  const heroRights = partyRights(seat, undefined, true);
  return (
    <aside class="party-panel" aria-label={t('party.title')}>
      <h2>{t('party.title')}</h2>
      <MemberCard c={hero} lead {...(onLevelUp && heroRights.levelUp && { onLevelUp: () => onLevelUp(hero.id) })} />
      {partyOrder(companions, origins).map((c) => {
        const isHero = origins[c.id] === 'hero';
        const control = controls?.[c.id] ?? 'ai';
        // A guest's hero (control seat:<id>) is theirs: the host gets no toggle or level-up for it; guests only level their own.
        const rights = partyRights(seat, control, false);
        const toggle = () => send({ type: 'companion_control', companionId: c.id, control: control === 'player' ? 'ai' : 'player' });
        return (
          <MemberCard
            key={c.id}
            c={c}
            isHero={isHero}
            {...(isHero && rights.levelUp && onLevelUp && { onLevelUp: () => onLevelUp(c.id) })}
            {...(!isHero && loyalty?.[c.id] !== undefined && { loyalty: loyalty[c.id] })}
            {...(rights.toggle && { control: control === 'player' ? ('player' as const) : ('ai' as const), onToggle: toggle })}
          />
        );
      })}
      {companions.length === 0 && <p class="hint small">{t('party.noCompanions')}</p>}
      {onAddHero && mayAddHero(seat, controls) && companions.length < MAX_COMPANIONS && (
        <button type="button" class="link-button small" onClick={onAddHero} title={t('party.addHeroTitle')}>
          {t('party.addHero')}
        </button>
      )}
    </aside>
  );
}
