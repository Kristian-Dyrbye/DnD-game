/**
 * Level-up dialog: shows what the new level brings (features, HP) and asks for the choices the
 * rules require (subclass, Ability Score Improvement or feat, new cantrips/spells, weapon
 * masteries, Expertise). The server re-validates everything (leveling.levelUp).
 */
import { useMemo, useState } from 'preact/hooks';
import { featuresAtLevel, maxSpellLevelAt, pendingChoices, type PendingChoice } from '../../../engine/character/leveling';
import { classLevel } from '../../../engine/character/derived';
import type { Character } from '../../../engine/core/creature';
import { ABILITIES, SKILL_NAMES, type Ability } from '../../../engine/rules/basics';
import { db } from '../../data';
import { send } from '../../net/gameSocket';
import { PickList } from '../creator/PickList';
import { t, tn } from '../i18n';
import { srdText, skillText } from '../srdText';

export function LevelUpPanel({ hero, onClose }: { hero: Character; onClose: () => void }) {
  const classId = hero.classes[0]!.classId;
  const newLevel = classLevel(hero, classId) + 1;
  const choices = useMemo(() => pendingChoices(hero, db, classId, newLevel), [hero, classId, newLevel]);
  const [subclassId, setSubclass] = useState<string | undefined>(undefined);
  const [featId, setFeat] = useState('ability_score_improvement');
  const [asi, setAsi] = useState<Partial<Record<Ability, number>>>({});
  const [picks, setPicks] = useState<Record<string, string[]>>({});
  const [hpMode, setHpMode] = useState<'average' | 'roll'>('average');
  const cls = db.classes.get(classId)!;
  const sub = subclassId ?? hero.classes[0]!.subclassId;
  const features = featuresAtLevel(db, classId, newLevel, sub).map((f) => f.name);
  const avg = Number(cls.hitDie.slice(1)) / 2 + 1;
  const maxLevel = maxSpellLevelAt(db, classId, newLevel);

  const pickFor = (key: string) => picks[key] ?? [];
  const setPick = (key: string, ids: string[]) => setPicks({ ...picks, [key]: ids });
  const asiTotal = Object.values(asi).reduce((s, n) => s + (n ?? 0), 0);

  const optionsFor = (ch: PendingChoice): { id: string; label: string }[] => {
    if (ch.kind === 'cantrips' || ch.kind === 'spells') {
      const level = ch.kind === 'cantrips' ? 0 : undefined;
      const known = new Set([...(hero.spellcasting?.cantrips ?? []), ...(hero.spellcasting?.prepared ?? []).map((p) => p.spellId)]);
      return db
        .spellsForClass(classId, Math.max(maxLevel, 0))
        .filter((s) => (level === 0 ? s.level === 0 : s.level > 0) && !known.has(s.id))
        .map((s) => ({ id: s.id, label: s.level ? t('levelup.spellLevel', { name: s.name, level: s.level }) : s.name }));
    }
    if (ch.kind === 'weapon_mastery') return [...db.weapons.values()].filter((w) => w.mastery && !hero.weaponMasteries.includes(w.id)).map((w) => ({ id: w.id, label: srdText('weapons', w.id, w.name) }));
    if (ch.kind === 'expertise') return Object.entries(hero.skills).filter(([, v]) => v === 'proficient').map(([k]) => ({ id: k, label: skillText(k as keyof typeof SKILL_NAMES) }));
    if (ch.kind === 'skills') return Object.keys(SKILL_NAMES).filter((k) => !hero.skills[k as keyof typeof SKILL_NAMES]).map((k) => ({ id: k, label: skillText(k as keyof typeof SKILL_NAMES) }));
    return [];
  };

  const problems: string[] = [];
  for (const ch of choices) {
    if (ch.kind === 'subclass' && !subclassId) problems.push(t('levelup.problem.subclass'));
    if (ch.kind === 'feat' && featId === 'ability_score_improvement' && asiTotal !== 2) problems.push(t('levelup.problem.asi'));
    if ('count' in ch && pickFor(ch.kind).length !== ch.count) problems.push(t('levelup.problem.pick', { count: ch.count, what: t(`levelup.pick.${ch.kind}`) }));
  }

  const confirm = () => {
    const featChoice = choices.find((c) => c.kind === 'feat');
    send({
      type: 'level_up',
      classId,
      hpMode,
      ...(subclassId && { subclassId }),
      ...(featChoice && { feat: { featId, ...(featId === 'ability_score_improvement' && { increases: asi as Record<string, number> }) } }),
      ...(pickFor('cantrips').length && { cantrips: pickFor('cantrips') }),
      ...(pickFor('spells').length && { spells: pickFor('spells') }),
      ...(pickFor('weapon_mastery').length && { weaponMasteries: pickFor('weapon_mastery') }),
      ...(pickFor('expertise').length && { expertise: pickFor('expertise') }),
      ...(pickFor('skills').length && { skills: pickFor('skills') }),
    });
    onClose();
  };

  return (
    <div class="modal-backdrop" role="dialog" aria-modal="true" aria-label={t('levelup.aria')}>
      <section class="journal settings">
        <header class="journal-head">
          <h2>
            {t('levelup.title', { className: srdText('classes', cls.id, cls.name), level: newLevel })}
          </h2>
          <button type="button" onClick={onClose}>
            {t('levelup.later')}
          </button>
        </header>
        <div class="settings-body">
          <p>
            <strong>{t('levelup.new')}</strong> {features.length ? features.join(', ') : t('levelup.moreHp')}.
          </p>
          <fieldset>
            <legend>{t('levelup.hp')}</legend>
            <div class="option-row">
              <label class={`option-pill${hpMode === 'average' ? ' selected' : ''}`}>
                <input type="radio" name="hp" checked={hpMode === 'average'} onChange={() => setHpMode('average')} />
                {t('levelup.average', { avg })}
              </label>
              <label class={`option-pill${hpMode === 'roll' ? ' selected' : ''}`}>
                <input type="radio" name="hp" checked={hpMode === 'roll'} onChange={() => setHpMode('roll')} />
                {t('levelup.roll', { die: cls.hitDie })}
              </label>
            </div>
          </fieldset>
          {choices.map((ch) => {
            if (ch.kind === 'subclass') {
              return (
                <PickList
                  key="subclass"
                  title={t('levelup.subclass')}
                  count={1}
                  options={ch.options.map((id) => ({ id, label: srdText('subclasses', id, db.subclasses.get(id)?.name ?? id) }))}
                  selected={subclassId ? [subclassId] : []}
                  onChange={(ids) => setSubclass(ids[0])}
                />
              );
            }
            if (ch.kind === 'feat') {
              const feats = [...db.feats.values()].filter((f) => (ch.reason === 'epic_boon' ? f.category === 'epic_boon' : f.category === 'general'));
              return (
                <fieldset key="feat">
                  <legend>{t(ch.reason === 'asi' ? 'levelup.asiOrFeat' : 'levelup.epicBoon')}</legend>
                  <div class="option-row">
                    {feats.map((f) => (
                      <label key={f.id} class={`option-pill${featId === f.id ? ' selected' : ''}`}>
                        <input type="radio" name="feat" checked={featId === f.id} onChange={() => setFeat(f.id)} />
                        {f.name}
                      </label>
                    ))}
                  </div>
                  {featId === 'ability_score_improvement' && (
                    <div class="option-row" style={{ marginTop: '0.5rem' }}>
                      {ABILITIES.map((a) => (
                        <label key={a} class="select-row">
                          {a.toUpperCase()} {hero.abilities[a]}{' '}
                          <select value={asi[a] ?? 0} onChange={(e) => setAsi({ ...asi, [a]: Number((e.target as HTMLSelectElement).value) || undefined })}>
                            <option value={0}>+0</option>
                            <option value={1}>+1</option>
                            <option value={2}>+2</option>
                          </select>
                        </label>
                      ))}
                      <span class="hint small">{tn('levelup.pointsLeft', 2 - asiTotal)}</span>
                    </div>
                  )}
                </fieldset>
              );
            }
            return <PickList key={ch.kind} title={t(`levelup.pick.${ch.kind}`)} count={ch.count} options={optionsFor(ch)} selected={pickFor(ch.kind)} onChange={(ids) => setPick(ch.kind, ids)} />;
          })}
          {problems.length > 0 && <p class="step-problems">{problems.join(' · ')}</p>}
          <button type="button" class="primary" disabled={problems.length > 0} onClick={confirm}>
            {t('levelup.confirm')}
          </button>
        </div>
      </section>
    </div>
  );
}
