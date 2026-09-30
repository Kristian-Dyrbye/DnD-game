/** Creator final step: the finished character sheet built by the engine, ready to begin. */
import { buildCharacter, validateBuild } from '../../../engine/character/builder';
import { toBuildInput } from '../../../engine/character/creator';
import { armorClass, initiativeModifiers, weaponAttack } from '../../../engine/character/derived';
import { ABILITIES, abilityModifier, formatModifier, type Skill } from '../../../engine/rules/basics';
import { db } from '../../data';
import { coins, t } from '../i18n';
import { creator } from './creatorState';
import { groupNames, itemDisplayName } from '../text';
import { srdText, abilityAbbr, skillText } from '../srdText';

export function ReviewStep() {
  const s = creator.value;
  const input = toBuildInput(s);
  const problems = validateBuild(input, db);
  if (problems.length) {
    return (
      <section>
        <h2>{t('creator.review.title')}</h2>
        <p class="hint">{t('creator.review.problems')}</p>
        <ul>
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      </section>
    );
  }
  const c = buildCharacter(input, db);
  const init = initiativeModifiers(c).reduce((a, m) => a + m.value, 0);
  const attacks = c.inventory.filter((i) => i.equipped === 'main_hand' || db.weapons.get(i.itemId)?.kind === 'ranged').map((i) => weaponAttack(c, db, i)).filter((a) => a !== undefined);
  const cls = db.classes.get(c.classes[0]!.classId)!;
  return (
    <section class="review">
      <h2>{c.name}</h2>
      <p class="hint">
        {t('creator.review.line', {
          species: srdText('species', c.speciesId, db.species.get(c.speciesId)?.name ?? c.speciesId),
          className: srdText('classes', cls.id, cls.name),
          background: srdText('backgrounds', c.backgroundId, db.backgrounds.get(c.backgroundId)?.name ?? c.backgroundId),
          mode: t(s.difficulty === 'hardcore' ? 'creator.difficulty.hardcore' : 'creator.difficulty.heroic'),
        })}
      </p>
      <div class="sheet">
        <div class="sheet-block vitals">
          <div>
            <span>{t('creator.review.hp')}</span>
            <strong>{c.maxHp}</strong>
          </div>
          <div>
            <span>{t('creator.review.ac')}</span>
            <strong>{armorClass(c, db).ac}</strong>
          </div>
          <div>
            <span>{t('creator.review.speed')}</span>
            <strong>{t('creator.review.speedValue', { n: c.speed.walk })}</strong>
          </div>
          <div>
            <span>{t('creator.review.initiative')}</span>
            <strong>{formatModifier(init)}</strong>
          </div>
          <div>
            <span>{t('creator.review.prof')}</span>
            <strong>+{c.proficiencyBonus}</strong>
          </div>
        </div>
        <div class="sheet-block abilities">
          {ABILITIES.map((a) => (
            <div key={a}>
              <span>{abilityAbbr(a).toUpperCase()}</span>
              <strong>{c.abilities[a]}</strong>
              <small>{formatModifier(abilityModifier(c.abilities[a]))}</small>
            </div>
          ))}
        </div>
        <div class="sheet-block">
          <h3>{t('creator.review.skills')}</h3>
          <p>
            {(Object.entries(c.skills) as [Skill, string][])
              .filter(([, v]) => v === 'proficient' || v === 'expertise')
              .map(([k, v]) => `${skillText(k)}${v === 'expertise' ? ` ${t('creator.review.expertise')}` : ''}`)
              .join(', ')}
          </p>
          <h3>{t('creator.review.attacks')}</h3>
          <ul>
            {attacks.map((a) => (
              <li key={a!.uid}>
                {a!.name}: {t('creator.review.toHit', { bonus: formatModifier(a!.toHit) })}, {a!.damage[0]!.dice}
                {(() => {
                  const mod = a!.damageModifiers.reduce((x, m) => x + m.value, 0);
                  return mod ? formatModifier(mod) : '';
                })()}{' '}
                {a!.damage[0]!.type}
                {a!.mastery ? ` · ${a!.mastery[0]!.toUpperCase()}${a!.mastery.slice(1)}` : ''}
              </li>
            ))}
          </ul>
        </div>
        <div class="sheet-block">
          <h3>{t('creator.review.gear')}</h3>
          <p>
            {groupNames(c.inventory.map((i) => ({ name: itemDisplayName(db.item(i.itemId)?.name ?? i.itemId), quantity: i.quantity, ...(i.equipped && { note: t('creator.review.equipped') }) }))).join(', ')}
          </p>
          <p>{t('creator.review.coins', { coins: coins(c.coins) })}</p>
          {c.spellcasting && (
            <>
              <h3>{t('creator.review.spells')}</h3>
              <p>
                {[...c.spellcasting.cantrips, ...c.spellcasting.prepared.map((p) => p.spellId)].map((id) => db.spells.get(id)?.name ?? id).join(', ')}
              </p>
            </>
          )}
          <h3>{t('creator.review.feats')}</h3>
          <p>{c.featIds.map((f) => srdText('feats', f, db.feats.get(f)?.name ?? f)).join(', ')}</p>
        </div>
      </div>
      {s.personality.backstory && (
        <blockquote class="backstory">{s.personality.backstory}</blockquote>
      )}
    </section>
  );
}
