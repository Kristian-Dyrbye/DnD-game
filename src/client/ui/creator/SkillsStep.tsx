/** Creator step 5a: skills (class picks, species picks, Human feat) and the class's level-1 options. */
import { choiceValues, creationChoices, setChoiceValues } from '../../../engine/character/creator';
import { SKILLS, SKILL_ABILITY, SKILL_NAMES, ABILITY_NAMES, type Skill } from '../../../engine/rules/basics';
import { db } from '../../data';
import { currentTranslator, t } from '../i18n';
import { creator } from './creatorState';
import { PickList } from './PickList';

const skillLabel = (k: Skill) => `${SKILL_NAMES[k]} (${ABILITY_NAMES[SKILL_ABILITY[k]].slice(0, 3)})`;

export function SkillsStep() {
  const s = creator.value;
  const cls = s.classId ? db.classes.get(s.classId) : undefined;
  const bg = s.backgroundId ? db.backgrounds.get(s.backgroundId) : undefined;
  if (!cls || !bg) return <p class="hint">{t('creator.needClassAndBackground')}</p>;
  const fromBackground = new Set(bg.skills);
  const classOptions = cls.skillChoices.from.map((k) => ({ id: k, label: skillLabel(k), locked: fromBackground.has(k) }));
  const taken = new Set<Skill>([...bg.skills, ...s.classSkills]);
  const speciesPool: Skill[] | undefined = s.speciesId === 'elf' ? ['insight', 'perception', 'survival'] : s.speciesId === 'human' ? [...SKILLS] : undefined;

  return (
    <section>
      <h2>{t('creator.skills.title')}</h2>
      <p class="hint">{t('creator.skills.hint', { skills: bg.skills.map((k) => SKILL_NAMES[k]).join(t('creator.and')) })}</p>
      <PickList
        title={t('creator.skills.classSkills', { name: cls.name })}
        count={cls.skillChoices.count}
        options={classOptions}
        selected={s.classSkills}
        onChange={(ids) => (creator.value = { ...s, classSkills: ids as Skill[], expertise: s.expertise.filter((e) => ids.includes(e) || fromBackground.has(e)) })}
        compact
      />
      {speciesPool && (
        <PickList
          title={s.speciesId === 'elf' ? t('creator.skills.keenSenses') : t('creator.skills.skillful')}
          count={1}
          options={speciesPool.map((k) => ({ id: k, label: skillLabel(k), locked: taken.has(k) }))}
          selected={s.speciesSkills}
          onChange={(ids) => (creator.value = { ...s, speciesSkills: ids as Skill[] })}
          compact
        />
      )}
      {s.speciesId === 'human' && (
        <PickList
          title={t('creator.skills.versatile')}
          count={1}
          options={[...db.feats.values()].filter((f) => f.category === 'origin' && f.id !== bg.featId).map((f) => ({ id: f.id, label: f.name, detail: f.text }))}
          selected={s.speciesFeatId ? [s.speciesFeatId] : []}
          onChange={(ids) => (creator.value = { ...s, speciesFeatId: ids[0], choices: Object.fromEntries(Object.entries(s.choices).filter(([k]) => !k.startsWith('feat_sp_'))) })}
        />
      )}
      {creationChoices(s, db, currentTranslator()).map((ch) => (
        <PickList
          key={ch.key}
          title={ch.label[0]!.toUpperCase() + ch.label.slice(1)}
          count={ch.count}
          options={ch.options}
          selected={choiceValues(s, ch.key)}
          onChange={(ids) => (creator.value = setChoiceValues(creator.value, ch.key, ids))}
          compact={ch.key === 'weapon_mastery' || ch.key === 'expertise' || ch.key === 'tool_proficiencies'}
        />
      ))}
    </section>
  );
}
