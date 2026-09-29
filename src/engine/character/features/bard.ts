/**
 * Bard and College of Lore features (SRD 5.2). Bardic Inspiration is an active effect on the
 * inspired creature holding the die; it's spent after a failed D20 Test (useInspiration).
 * Cutting Words and Peerless Skill reuse the same die. Magical Secrets / Magical Discoveries
 * widen spell choices (validated by the creator/level-up UI, A046).
 */
import { roll } from '../../core/dice';
import type { Character, Creature } from '../../core/creature';
import type { Rng } from '../../core/rng';
import type { SrdDatabase } from '../../data/srd';
import { SKILLS, abilityModifier } from '../../rules/basics';
import { addEffect, removeEffects } from '../../rules/activeEffects';
import type { D20TestResult } from '../../rules/checks';
import { classLevel } from '../derived';
import type { FeatureImpl } from './types';

const level = (c: Character) => classLevel(c, 'bard');

/** Bardic die by Bard level: d6, d8 at 5, d10 at 10, d12 at 15. */
export function bardicDie(c: Character, db: SrdDatabase): string {
  const col = db.classes.get('bard')?.columns.bardic_die?.[level(c) - 1];
  return typeof col === 'string' ? col.toLowerCase() : 'd6';
}

export const bardFeatures: FeatureImpl[] = [
  {
    id: 'bardic_inspiration',
    owner: 'bard',
    resources: (c) => {
      const max = Math.max(1, abilityModifier(c.abilities.cha));
      // Font of Inspiration (level 5): regain on a Short or Long Rest.
      return { bardic_inspiration: { current: max, max, recharge: level(c) >= 5 ? 'short' : 'long' } };
    },
    actions: [
      {
        id: 'bardic_inspiration',
        name: 'Bardic Inspiration',
        cost: 'bonus_action',
        resource: 'bardic_inspiration',
        problem: (c) => ((c.resources.bardic_inspiration?.current ?? 0) < 1 ? 'No Bardic Inspiration left' : undefined),
        use: (c, db, { target }) => {
          if (!target || target.id === c.id) return { character: c, log: ['Choose another creature to inspire.'] };
          if (target.effects.some((e) => e.key === 'bardic_inspiration')) return { character: c, log: [`${target.name} is already inspired.`] };
          const die = bardicDie(c, db);
          const res = c.resources.bardic_inspiration!;
          return {
            character: { ...c, resources: { ...c.resources, bardic_inspiration: { ...res, current: res.current - 1 } } },
            others: [addEffect(target, { key: 'bardic_inspiration', sourceId: c.id, roundsLeft: 600, data: { die } })],
            log: [`${c.name} inspires ${target.name} (1${die}).`],
          };
        },
      },
    ],
  },
  {
    id: 'jack_of_all_trades',
    owner: 'bard',
    // Half proficiency on every skill without proficiency; initiative is handled in derived.initiativeModifiers.
    onGain: (c) => {
      const skills = { ...c.skills };
      for (const s of SKILLS) if (!skills[s] || skills[s] === 'none') skills[s] = 'half';
      return { ...c, skills };
    },
  },
  {
    id: 'words_of_creation',
    owner: 'bard',
    onGain: (c) => {
      if (!c.spellcasting) return c;
      const add = ['power_word_heal', 'power_word_kill'].filter((id) => !c.spellcasting!.prepared.some((p) => p.spellId === id));
      return { ...c, spellcasting: { ...c.spellcasting, prepared: [...c.spellcasting.prepared, ...add.map((spellId) => ({ spellId, classId: 'bard' }))] } };
    },
  },
];

export interface InspirationUse {
  creature: Creature;
  result: D20TestResult;
  rolled: number;
}

/** After a failed D20 Test: roll the Bardic Inspiration die and add it (the die is used up). */
export function useInspiration(c: Creature, result: D20TestResult, rng: Rng): InspirationUse | undefined {
  const insp = c.effects.find((e) => e.key === 'bardic_inspiration');
  if (!insp || result.success !== false || result.autoFail) return undefined;
  const die = String(insp.data.die ?? 'd6');
  const rolled = roll(`1${die}`, rng).total;
  const total = result.total + rolled;
  const success = result.target ? total >= result.target.value : result.success;
  return {
    creature: removeEffects(c, (e) => e.id === insp.id),
    rolled,
    result: {
      ...result,
      total,
      ...(success !== undefined && { success }),
      modifiers: [...result.modifiers, { value: rolled, label: 'Bardic Inspiration' }],
      text: `${result.text} → + ${rolled} (Bardic Inspiration) = ${total}${success ? ' — Success' : ' — Failure'}`,
    },
  };
}

/** College of Lore Cutting Words (reaction): subtract a Bardic die from a creature's roll. */
export function cuttingWords(bard: Character, db: SrdDatabase, rng: Rng): { bard: Character; penalty: number } | undefined {
  const res = bard.resources.bardic_inspiration;
  if (!res || res.current < 1 || !bard.classes.some((x) => x.subclassId === 'college_of_lore' && x.level >= 3)) return undefined;
  const penalty = roll(`1${bardicDie(bard, db)}`, rng).total;
  return { bard: { ...bard, resources: { ...bard.resources, bardic_inspiration: { ...res, current: res.current - 1 } } }, penalty };
}
