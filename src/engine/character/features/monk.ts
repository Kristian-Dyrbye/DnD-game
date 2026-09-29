/**
 * Monk and Warrior of the Open Hand features (SRD 5.2). Martial Arts adjusts Unarmed Strikes and
 * Monk weapons (die, Dexterity, force damage from Empowered Strikes). Focus actions spend Focus
 * Points and leave active effects ('flurry_of_blows', 'patient_defense', 'step_of_the_wind')
 * that the combat turn manager turns into extra attacks / Dodge / Disengage / Dash.
 */
import { roll } from '../../core/dice';
import type { Character, Creature } from '../../core/creature';
import type { Rng } from '../../core/rng';
import type { SrdDatabase } from '../../data/srd';
import { abilityModifier } from '../../rules/basics';
import { addEffect } from '../../rules/activeEffects';
import { savingThrow, type D20TestResult } from '../../rules/checks';
import { applyCondition, saveModes } from '../../rules/conditions';
import { heal } from '../../rules/damage';
import { classLevel, equipped, type WeaponAttack } from '../derived';
import type { FeatureAction, FeatureImpl } from './types';

const level = (c: Character) => classLevel(c, 'monk');
const wis = (c: Character) => abilityModifier(c.abilities.wis);

export function martialArtsDie(c: Character, db: SrdDatabase): string {
  const col = db.classes.get('monk')?.columns.martial_arts?.[level(c) - 1];
  return typeof col === 'string' ? col : '1d6';
}

export function focusSaveDc(c: Character): number {
  return 8 + wis(c) + c.proficiencyBonus;
}

/** Martial Arts applies while unarmored and without a shield. */
function martialArtsActive(c: Character): boolean {
  return equipped(c, 'armor').length === 0 && equipped(c, 'shield').length === 0;
}

function isMonkWeapon(db: SrdDatabase, a: WeaponAttack): boolean {
  if (a.weaponId === 'unarmed_strike') return true;
  const w = db.weapons.get(a.weaponId);
  return Boolean(w && w.kind === 'melee' && (w.category === 'simple' || w.properties.includes('light')));
}

const dieSize = (dice: string) => Number(/d(\d+)/.exec(dice)?.[1] ?? 0) * Number(/^(\d+)/.exec(dice)?.[1] ?? 1);

const spendFocus = (c: Character, n = 1): Character => {
  const r = c.resources.focus_points!;
  return { ...c, resources: { ...c.resources, focus_points: { ...r, current: r.current - n } } };
};
const needFocus = (n: number) => (c: Character) => ((c.resources.focus_points?.current ?? 0) < n ? 'Not enough Focus Points' : undefined);

function focusAction(id: string, name: string, effectKey: string, text: string): FeatureAction {
  return {
    id,
    name,
    cost: 'bonus_action',
    resource: 'focus_points',
    problem: needFocus(1),
    use: (c) => ({
      character: addEffect(spendFocus(c), { key: effectKey, sourceId: c.id, expires: { on: 'start_of_turn', creatureId: c.id, skip: 0 } }),
      log: [`${c.name}: ${text}`],
    }),
  };
}

export const monkFeatures: FeatureImpl[] = [
  {
    id: 'martial_arts',
    owner: 'monk',
    modifyAttack: (c, db, a) => {
      if (!martialArtsActive(c) || !isMonkWeapon(db, a)) return a;
      const dexMod = abilityModifier(c.abilities.dex);
      const strMod = abilityModifier(c.abilities.str);
      const useDex = dexMod > strMod;
      const mod = useDex ? dexMod : strMod;
      const label = useDex ? 'Dexterity' : 'Strength';
      const die = martialArtsDie(c, db);
      const base = a.damage[0]!;
      const damageType = a.weaponId === 'unarmed_strike' && level(c) >= 6 ? 'force' : base.type;
      const toHitBreakdown = a.toHitBreakdown.map((m) => (m.label === 'Strength' || m.label === 'Dexterity' ? { value: mod, label } : m));
      return {
        ...a,
        ability: useDex ? 'dex' : 'str',
        toHitBreakdown,
        toHit: toHitBreakdown.reduce((s, m) => s + m.value, 0),
        damage: [{ dice: dieSize(die) > dieSize(base.dice) ? die : base.dice, type: damageType }],
        damageModifiers: a.damageModifiers.map((m) => (m.label === 'Strength' || m.label === 'Dexterity' ? { value: mod, label } : m)),
      };
    },
  },
  {
    id: 'monks_focus',
    owner: 'monk',
    resources: (c, db) => {
      const max = Number(db.classes.get('monk')?.columns.focus_points?.[level(c) - 1] ?? 0);
      return { focus_points: { current: max, max, recharge: 'short' } };
    },
    actions: [
      focusAction('flurry_of_blows', 'Flurry of Blows', 'flurry_of_blows', 'Flurry of Blows — two Unarmed Strikes as a Bonus Action.'),
      focusAction('patient_defense', 'Patient Defense', 'patient_defense', 'Patient Defense — Disengage and Dodge.'),
      focusAction('step_of_the_wind', 'Step of the Wind', 'step_of_the_wind', 'Step of the Wind — Disengage and Dash, jump distance doubled.'),
    ],
  },
  {
    id: 'uncanny_metabolism',
    owner: 'monk',
    resources: () => ({ uncanny_metabolism: { current: 1, max: 1, recharge: 'long' } }),
  },
  {
    id: 'evasion',
    owner: 'monk',
    onGain: (c) => (c.effects.some((e) => e.key === 'evasion') ? c : addEffect(c, { key: 'evasion', sourceId: c.id })),
  },
  {
    id: 'disciplined_survivor',
    owner: 'monk',
    onGain: (c) => ({ ...c, saveProficiencies: ['str', 'dex', 'con', 'int', 'wis', 'cha'] }),
  },
  {
    id: 'body_and_mind',
    owner: 'monk',
    onGain: (c) => ({ ...c, abilities: { ...c.abilities, dex: Math.min(25, c.abilities.dex + 4), wis: Math.min(25, c.abilities.wis + 4) } }),
  },
  // Warrior of the Open Hand
  {
    id: 'wholeness_of_body',
    owner: 'warrior_of_the_open_hand',
    resources: (c) => {
      const max = Math.max(1, wis(c));
      return { wholeness_of_body: { current: max, max, recharge: 'long' } };
    },
    actions: [
      {
        id: 'wholeness_of_body',
        name: 'Wholeness of Body',
        cost: 'bonus_action',
        resource: 'wholeness_of_body',
        problem: (c) => ((c.resources.wholeness_of_body?.current ?? 0) < 1 ? 'No uses left' : undefined),
        use: (c, db, { rng }) => {
          const r = c.resources.wholeness_of_body!;
          const rolled = roll(martialArtsDie(c, db), rng).total;
          const { creature, healed } = heal({ ...c, resources: { ...c.resources, wholeness_of_body: { ...r, current: r.current - 1 } } }, rolled + wis(c));
          return { character: creature as Character, log: [`${c.name} regains ${healed} HP (Wholeness of Body).`] };
        },
      },
    ],
  },
];

/** Uncanny Metabolism (2): when rolling Initiative, regain all Focus and heal martial arts die + Monk level (once per Long Rest). */
export function uncannyMetabolism(c: Character, db: SrdDatabase, rng: Rng): Character {
  const r = c.resources.uncanny_metabolism;
  if (!r || r.current < 1) return c;
  const focus = c.resources.focus_points!;
  const amount = roll(martialArtsDie(c, db), rng).total + level(c);
  return heal({ ...c, resources: { ...c.resources, uncanny_metabolism: { ...r, current: 0 }, focus_points: { ...focus, current: focus.max } } }, amount).creature as Character;
}

/** Deflect Attacks (3): reaction damage reduction = 1d10 + Dex mod + Monk level. */
export function deflectAmount(c: Character, rng: Rng): number {
  return roll('1d10', rng).total + abilityModifier(c.abilities.dex) + level(c);
}

/** Stunning Strike (5): after a hit, 1 Focus: Con save or Stunned until the start of the monk's next turn; on a success, Speed halved and the next attack against it has Advantage. */
export function stunningStrike(c: Character, target: Creature, rng: Rng): { monk: Character; target: Creature; save: D20TestResult } | undefined {
  if (level(c) < 5 || (c.resources.focus_points?.current ?? 0) < 1) return undefined;
  const save = savingThrow(target, 'con', { rng, dc: focusSaveDc(c), ...saveModes(target, 'con') });
  const monk = spendFocus(c);
  if (!save.success) {
    return { monk, target: applyCondition(target, { condition: 'stunned', sourceId: `${c.id}:stunning_strike`, roundsLeft: 1 }).creature, save };
  }
  return { monk: addEffect(monk, { key: 'vex', sourceId: c.id, targetId: target.id, consumeOn: 'own_attack_vs_target', expires: { on: 'start_of_turn', creatureId: c.id, skip: 0 } }), target, save };
}

/** Open Hand Technique (3): a Flurry of Blows hit can Addle (no reactions), Push 15 ft (Str save), or Topple (Dex save → Prone). */
export function openHandTechnique(c: Character, target: Creature, technique: 'addle' | 'push' | 'topple', rng: Rng): { target: Creature; pushFt?: number; save?: D20TestResult } {
  if (technique === 'addle') return { target: addEffect(target, { key: 'no_reactions', sourceId: c.id, expires: { on: 'start_of_turn', creatureId: c.id, skip: 0 } }) };
  const ability = technique === 'push' ? 'str' : 'dex';
  const save = savingThrow(target, ability, { rng, dc: focusSaveDc(c), ...saveModes(target, ability) });
  if (save.success) return { target, save };
  return technique === 'push' ? { target, pushFt: 15, save } : { target: applyCondition(target, { condition: 'prone' }).creature, save };
}
