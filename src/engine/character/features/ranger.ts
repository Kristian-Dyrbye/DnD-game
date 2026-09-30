/**
 * Ranger and Hunter features (SRD 5.2). Favored Enemy gives free Hunter's Mark casts; the mark
 * itself is a spell hook (A042a) — Precise Hunter and Foe Slayer read it here.
 * Choices: character.choices.hunters_prey ['colossus_slayer' | 'horde_breaker'].
 */
import { roll } from '../../core/dice';
import type { Character } from '../../core/creature';
import { abilityModifier } from '../../rules/basics';
import { applyCondition } from '../../rules/conditions';
import { grantTempHp } from '../../rules/damage';
import { classLevel } from '../derived';
import type { FeatureImpl } from './types';
import { ENGLISH_MESSAGES } from '../../i18n';

const level = (c: Character) => classLevel(c, 'ranger');
const wisUses = (c: Character) => Math.max(1, abilityModifier(c.abilities.wis));

const addPrepared = (c: Character, spellId: string): Character => {
  if (!c.spellcasting || c.spellcasting.prepared.some((p) => p.spellId === spellId)) return c;
  return { ...c, spellcasting: { ...c.spellcasting, prepared: [...c.spellcasting.prepared, { spellId, classId: 'ranger' }] } };
};

const spend = (c: Character, key: string): Character => {
  const r = c.resources[key]!;
  return { ...c, resources: { ...c.resources, [key]: { ...r, current: r.current - 1 } } };
};

/** Hunter's Mark damage die (Foe Slayer, level 20: d10). */
export function huntersMarkDie(c: Character): string {
  return level(c) >= 20 ? '1d10' : '1d6';
}

export const rangerFeatures: FeatureImpl[] = [
  {
    id: 'favored_enemy',
    owner: 'ranger',
    resources: (c, db) => {
      const max = Number(db.classes.get('ranger')?.columns.favored_enemy?.[level(c) - 1] ?? 2);
      return { favored_enemy: { current: max, max, recharge: 'long' } };
    },
    onGain: (c) => addPrepared(c, 'hunters_mark'),
  },
  {
    id: 'tireless',
    owner: 'ranger',
    resources: (c) => ({ tireless: { current: wisUses(c), max: wisUses(c), recharge: 'long' } }),
    actions: [
      {
        id: 'tireless',
        name: 'Tireless',
        cost: 'action',
        resource: 'tireless',
        problem: (c, msgs) => ((c.resources.tireless?.current ?? 0) < 1 ? msgs.m('feat.noUses') : undefined),
        use: (c, _db, { rng, msgs = ENGLISH_MESSAGES }) => {
          const amount = Math.max(1, roll('1d8', rng).total + abilityModifier(c.abilities.wis));
          return { character: grantTempHp(spend(c, 'tireless'), amount), log: [msgs.m('feat.tireless', { name: c.name, n: amount })] };
        },
      },
    ],
  },
  {
    id: 'natures_veil',
    owner: 'ranger',
    resources: (c) => ({ natures_veil: { current: wisUses(c), max: wisUses(c), recharge: 'long' } }),
    actions: [
      {
        id: 'natures_veil',
        name: "Nature's Veil",
        cost: 'bonus_action',
        resource: 'natures_veil',
        problem: (c, msgs) => ((c.resources.natures_veil?.current ?? 0) < 1 ? msgs.m('feat.noUses') : undefined),
        use: (c, _db, { msgs = ENGLISH_MESSAGES }) => ({
          // Invisible until the end of the ranger's next turn (2 end-of-turn ticks counting this one).
          character: applyCondition(spend(c, 'natures_veil'), { condition: 'invisible', sourceId: `${c.id}:natures_veil`, roundsLeft: 2 }).creature,
          log: [msgs.m('feat.naturesVeil', { name: c.name })],
        }),
      },
    ],
  },
  {
    id: 'feral_senses',
    owner: 'ranger',
    onGain: (c) => ({ ...c, senses: { ...c.senses, blindsight: Math.max(30, c.senses.blindsight ?? 0) } }),
  },
  // Hunter
  {
    id: 'hunters_prey',
    owner: 'hunter',
    onWeaponHit: (c, _db, ctx) =>
      (c.choices.hunters_prey?.[0] ?? 'colossus_slayer') === 'colossus_slayer' && ctx.firstHitThisTurn && ctx.target.hp < ctx.target.maxHp
        ? { extraDamage: [{ dice: '1d8', type: ctx.attack.damage[0]!.type }], text: 'Colossus Slayer' }
        : undefined,
  },
];

/** Precise Hunter (17): Advantage against the ranger's Hunter's Mark target. */
export function preciseHunterAdvantage(c: Character, targetId: string): boolean {
  return level(c) >= 17 && c.effects.some((e) => e.key === 'hunters_mark' && e.targetId === targetId);
}

/** Tireless (10): Exhaustion −1 on a Short Rest. */
export function tirelessShortRest(c: Character): Character {
  return level(c) >= 10 && c.exhaustion > 0 ? { ...c, exhaustion: c.exhaustion - 1 } : c;
}

/** Relentless Hunter (13): damage can't break concentration on Hunter's Mark. */
export function relentlessHunter(c: Character): boolean {
  return level(c) >= 13 && c.spellcasting?.concentration?.spellId === 'hunters_mark';
}
