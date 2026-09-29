/** Creator step 5a: skills (class picks, species picks, Human feat) and the class's level-1 options. */
import { choiceValues, creationChoices, setChoiceValues } from '../../../engine/character/creator';
import { SKILLS, SKILL_ABILITY, SKILL_NAMES, ABILITY_NAMES, type Skill } from '../../../engine/rules/basics';
import { db } from '../../data';
import { creator } from '../state';
import { PickList } from './PickList';

const skillLabel = (k: Skill) => `${SKILL_NAMES[k]} (${ABILITY_NAMES[SKILL_ABILITY[k]].slice(0, 3)})`;

export function SkillsStep() {
  const s = creator.value;
  const cls = s.classId ? db.classes.get(s.classId) : undefined;
  const bg = s.backgroundId ? db.backgrounds.get(s.backgroundId) : undefined;
  if (!cls || !bg) return <p class="hint">Choose a class and background first.</p>;
  const fromBackground = new Set(bg.skills);
  const classOptions = cls.skillChoices.from.map((k) => ({ id: k, label: skillLabel(k), locked: fromBackground.has(k) }));
  const taken = new Set<Skill>([...bg.skills, ...s.classSkills]);
  const speciesPool: Skill[] | undefined = s.speciesId === 'elf' ? ['insight', 'perception', 'survival'] : s.speciesId === 'human' ? [...SKILLS] : undefined;

  return (
    <section>
      <h2>Skills and training</h2>
      <p class="hint">
        Your background already grants {bg.skills.map((k) => SKILL_NAMES[k]).join(' and ')}. Pick the rest from your class list.
      </p>
      <PickList
        title={`${cls.name} skills`}
        count={cls.skillChoices.count}
        options={classOptions}
        selected={s.classSkills}
        onChange={(ids) => (creator.value = { ...s, classSkills: ids as Skill[], expertise: s.expertise.filter((e) => ids.includes(e) || fromBackground.has(e)) })}
        compact
      />
      {speciesPool && (
        <PickList
          title={s.speciesId === 'elf' ? 'Keen Senses' : 'Skillful'}
          count={1}
          options={speciesPool.map((k) => ({ id: k, label: skillLabel(k), locked: taken.has(k) }))}
          selected={s.speciesSkills}
          onChange={(ids) => (creator.value = { ...s, speciesSkills: ids as Skill[] })}
          compact
        />
      )}
      {s.speciesId === 'human' && (
        <PickList
          title="Versatile (origin feat)"
          count={1}
          options={[...db.feats.values()].filter((f) => f.category === 'origin' && f.id !== bg.featId).map((f) => ({ id: f.id, label: f.name, detail: f.text }))}
          selected={s.speciesFeatId ? [s.speciesFeatId] : []}
          onChange={(ids) => (creator.value = { ...s, speciesFeatId: ids[0] })}
        />
      )}
      {creationChoices(s, db).map((ch) => (
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
