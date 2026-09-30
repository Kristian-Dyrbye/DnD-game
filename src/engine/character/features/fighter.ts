/**
 * Fighter and Champion features (SRD 5.2). Action Surge and Studied Attacks are active effects
 * the combat turn manager reads; Indomitable and Tactical Mind are helpers applied to results.
 */
import { roll } from '../../core/dice';
import type { Character } from '../../core/creature';
import type { Rng } from '../../core/rng';
import { addEffect } from '../../rules/activeEffects';
import { savingThrow, type D20TestResult } from '../../rules/checks';
import type { Ability } from '../../rules/basics';
import { heal } from '../../rules/damage';
import { classLevel } from '../derived';
import type { FeatureImpl } from './types';
import { ENGLISH_MESSAGES, type Messages } from '../../i18n';

const level = (c: Character) => classLevel(c, 'fighter');
const champion = (c: Character) => c.classes.some((x) => x.subclassId === 'champion');

const spend = (c: Character, key: string): Character => {
  const r = c.resources[key]!;
  return { ...c, resources: { ...c.resources, [key]: { ...r, current: r.current - 1 } } };
};

export const fighterFeatures: FeatureImpl[] = [
  {
    id: 'second_wind',
    owner: 'fighter',
    resources: (c, db) => {
      const max = Number(db.classes.get('fighter')?.columns.second_wind?.[level(c) - 1] ?? 2);
      return { second_wind: { current: max, max, recharge: 'long', shortRestRegain: 1 } };
    },
    actions: [
      {
        id: 'second_wind',
        name: 'Second Wind',
        cost: 'bonus_action',
        resource: 'second_wind',
        problem: (c, msgs) => ((c.resources.second_wind?.current ?? 0) < 1 ? msgs.m('feat.noSecondWind') : undefined),
        use: (c, _db, { rng, msgs = ENGLISH_MESSAGES }) => {
          const rolled = roll('1d10', rng).total;
          const { creature, healed } = heal(spend(c, 'second_wind'), rolled + level(c));
          return { character: creature as Character, log: [msgs.m('feat.secondWind', { name: c.name, n: healed, roll: rolled, level: level(c) })] };
        },
      },
    ],
  },
  {
    id: 'action_surge',
    owner: 'fighter',
    resources: (c) => {
      const max = level(c) >= 17 ? 2 : 1;
      return { action_surge: { current: max, max, recharge: 'short' } };
    },
    actions: [
      {
        id: 'action_surge',
        name: 'Action Surge',
        cost: 'free',
        resource: 'action_surge',
        problem: (c, msgs) =>
          (c.resources.action_surge?.current ?? 0) < 1 ? msgs.m('feat.noActionSurge') : c.effects.some((e) => e.key === 'action_surge') ? msgs.m('feat.oncePerTurn') : undefined,
        use: (c, _db, { msgs = ENGLISH_MESSAGES }) => ({
          character: addEffect(spend(c, 'action_surge'), { key: 'action_surge', sourceId: c.id, expires: { on: 'end_of_turn', creatureId: c.id, skip: 0 } }),
          log: [msgs.m('feat.actionSurge', { name: c.name })],
        }),
      },
    ],
  },
  {
    id: 'indomitable',
    owner: 'fighter',
    resources: (c) => {
      const max = level(c) >= 17 ? 3 : level(c) >= 13 ? 2 : 1;
      return { indomitable: { current: max, max, recharge: 'long' } };
    },
  },
  // Champion
  { id: 'improved_critical', owner: 'champion', critOn: (c) => (level(c) >= 15 ? 18 : 19) },
  {
    id: 'remarkable_athlete',
    owner: 'champion',
    initiativeModes: () => ({ advantage: ['Remarkable Athlete'] }),
    checkModes: (_c, ability, skill) => (ability === 'str' && skill === 'athletics' ? { advantage: ['Remarkable Athlete'] } : {}),
  },
];

/** Indomitable: reroll a failed save with a bonus equal to the Fighter level (must use the new roll). */
export function indomitable(c: Character, failed: D20TestResult, ability: Ability, rng: Rng, msgs: Messages = ENGLISH_MESSAGES): { character: Character; result: D20TestResult } | undefined {
  if (failed.success !== false || (c.resources.indomitable?.current ?? 0) < 1 || !failed.target) return undefined;
  const result = savingThrow(c, ability, { rng, dc: failed.target.value, bonuses: [{ value: level(c), label: 'Indomitable' }], msgs });
  return { character: spend(c, 'indomitable'), result };
}

/** Tactical Mind (2): after a failed ability check, spend Second Wind to add 1d10; refunded if it still fails. */
export function tacticalMind(c: Character, failed: D20TestResult, rng: Rng, msgs: Messages = ENGLISH_MESSAGES): { character: Character; result: D20TestResult } | undefined {
  if (level(c) < 2 || failed.success !== false || !failed.target || (c.resources.second_wind?.current ?? 0) < 1) return undefined;
  const bonus = roll('1d10', rng).total;
  const total = failed.total + bonus;
  const success = total >= failed.target.value;
  return {
    character: success ? spend(c, 'second_wind') : c,
    result: { ...failed, total, success, modifiers: [...failed.modifiers, { value: bonus, label: 'Tactical Mind' }], text: msgs.m('feat.tacticalMind', { text: failed.text, n: bonus, total, outcome: msgs.m(success ? 'roll.success' : 'feat.failureRefunded') }) },
  };
}

/** Studied Attacks (13): after missing, Advantage on the next attack against that creature. */
export function studiedAttacks(c: Character, targetId: string): Character {
  if (level(c) < 13) return c;
  return addEffect(c, { key: 'vex', sourceId: c.id, targetId, consumeOn: 'own_attack_vs_target', expires: { on: 'end_of_turn', creatureId: c.id, skip: 1 } });
}

/** Heroic Warrior (Champion 10): Heroic Inspiration at the start of each turn if you have none. */
export function heroicWarrior(c: Character): Character {
  return champion(c) && level(c) >= 10 && !c.heroicInspiration ? { ...c, heroicInspiration: true } : c;
}

/** Survivor (Champion 18): regain 5 + Con mod at the start of the turn while Bloodied (not at 0 HP). */
export function survivorRegen(c: Character): number {
  if (!champion(c) || level(c) < 18 || c.hp === 0 || c.hp > Math.floor(c.maxHp / 2)) return 0;
  return 5 + Math.floor((c.abilities.con - 10) / 2);
}
