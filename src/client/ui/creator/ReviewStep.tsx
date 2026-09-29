/** Creator final step: the finished character sheet built by the engine, ready to begin. */
import { buildCharacter, validateBuild } from '../../../engine/character/builder';
import { toBuildInput } from '../../../engine/character/creator';
import { armorClass, initiativeModifiers, weaponAttack } from '../../../engine/character/derived';
import { ABILITIES, ABILITY_NAMES, SKILL_NAMES, abilityModifier, formatModifier, type Skill } from '../../../engine/rules/basics';
import { db } from '../../data';
import { creator } from '../state';
import { formatCoins, groupNames, itemDisplayName } from '../text';

export function ReviewStep() {
  const s = creator.value;
  const input = toBuildInput(s);
  const problems = validateBuild(input, db);
  if (problems.length) {
    return (
      <section>
        <h2>Review</h2>
        <p class="hint">A few things still need attention:</p>
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
        Level 1 {db.species.get(c.speciesId)?.name} {cls.name} · {db.backgrounds.get(c.backgroundId)?.name} · {s.difficulty === 'hardcore' ? 'Hardcore' : 'Heroic'}
      </p>
      <div class="sheet">
        <div class="sheet-block vitals">
          <div>
            <span>HP</span>
            <strong>{c.maxHp}</strong>
          </div>
          <div>
            <span>AC</span>
            <strong>{armorClass(c, db).ac}</strong>
          </div>
          <div>
            <span>Speed</span>
            <strong>{c.speed.walk} ft</strong>
          </div>
          <div>
            <span>Initiative</span>
            <strong>{formatModifier(init)}</strong>
          </div>
          <div>
            <span>Prof.</span>
            <strong>+{c.proficiencyBonus}</strong>
          </div>
        </div>
        <div class="sheet-block abilities">
          {ABILITIES.map((a) => (
            <div key={a}>
              <span>{ABILITY_NAMES[a].slice(0, 3).toUpperCase()}</span>
              <strong>{c.abilities[a]}</strong>
              <small>{formatModifier(abilityModifier(c.abilities[a]))}</small>
            </div>
          ))}
        </div>
        <div class="sheet-block">
          <h3>Skills</h3>
          <p>
            {(Object.entries(c.skills) as [Skill, string][])
              .filter(([, v]) => v === 'proficient' || v === 'expertise')
              .map(([k, v]) => `${SKILL_NAMES[k]}${v === 'expertise' ? ' (expertise)' : ''}`)
              .join(', ')}
          </p>
          <h3>Attacks</h3>
          <ul>
            {attacks.map((a) => (
              <li key={a!.uid}>
                {a!.name}: {formatModifier(a!.toHit)} to hit, {a!.damage[0]!.dice}
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
          <h3>Gear</h3>
          <p>
            {groupNames(c.inventory.map((i) => ({ name: itemDisplayName(db.item(i.itemId)?.name ?? i.itemId), quantity: i.quantity, ...(i.equipped && { note: 'equipped' }) }))).join(', ')}
          </p>
          <p>Coins: {formatCoins(c.coins)}</p>
          {c.spellcasting && (
            <>
              <h3>Spells</h3>
              <p>
                {[...c.spellcasting.cantrips, ...c.spellcasting.prepared.map((p) => p.spellId)].map((id) => db.spells.get(id)?.name ?? id).join(', ')}
              </p>
            </>
          )}
          <h3>Feats</h3>
          <p>{c.featIds.map((f) => db.feats.get(f)?.name ?? f).join(', ')}</p>
        </div>
      </div>
      {s.personality.backstory && (
        <blockquote class="backstory">{s.personality.backstory}</blockquote>
      )}
    </section>
  );
}
