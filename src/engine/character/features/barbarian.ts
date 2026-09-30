/**
 * Barbarian and Path of the Berserker features (SRD 5.2). Rage is an active effect 'rage'
 * (up to 10 minutes; the combat module ends it early if not extended each turn unless the
 * barbarian has Persistent Rage). Brutal Strike, Retaliation and Intimidating Presence need the
 * action economy and are wired in combat (A063); their numbers are exported here.
 */
import type { Character } from '../../core/creature';
import type { SrdDatabase } from '../../data/srd';
import { addEffect, hasEffect, removeEffects } from '../../rules/activeEffects';
import { savingThrow, type D20TestResult } from '../../rules/checks';
import { canAct } from '../../rules/conditions';
import type { Rng } from '../../core/rng';
import { classLevel, equipped } from '../derived';
import type { FeatureImpl } from './types';
import { ENGLISH_MESSAGES, type Messages } from '../../i18n';
import { spellIdName } from '../../i18n/srdNames';

const raging = (c: Character) => hasEffect(c, 'rage');
const level = (c: Character) => classLevel(c, 'barbarian');

export function rageDamage(c: Character, db: SrdDatabase): number {
  return Number(db.classes.get('barbarian')?.columns.rage_damage?.[level(c) - 1] ?? 2);
}

function wearsHeavyArmor(c: Character, db: SrdDatabase): boolean {
  const armor = equipped(c, 'armor')[0];
  return armor ? db.armor.get(armor.itemId)?.category === 'heavy' : false;
}

export const barbarianFeatures: FeatureImpl[] = [
  {
    id: 'rage',
    owner: 'barbarian',
    resources: (c, db) => {
      const max = Number(db.classes.get('barbarian')?.columns.rages?.[level(c) - 1] ?? 2);
      return { rage: { current: max, max, recharge: 'long', shortRestRegain: 1 } };
    },
    actions: [
      {
        id: 'rage',
        name: 'Rage',
        cost: 'bonus_action',
        resource: 'rage',
        problem: (c, msgs) => (raging(c) ? msgs.m('feat.alreadyRaging') : (c.resources.rage?.current ?? 0) < 1 ? msgs.m('feat.noRage') : undefined),
        use: (c, db, { msgs = ENGLISH_MESSAGES }) => {
          if (wearsHeavyArmor(c, db)) return { character: c, log: [msgs.m('feat.heavyRage')] };
          const rage = c.resources.rage!;
          let next = addEffect({ ...c, resources: { ...c.resources, rage: { ...rage, current: rage.current - 1 } } }, { key: 'rage', sourceId: c.id, roundsLeft: 100, data: { damage: rageDamage(c, db) } });
          const log = [msgs.m('feat.rage', { name: c.name, n: rageDamage(c, db) })];
          if (next.spellcasting?.concentration) {
            const { concentration, ...rest } = next.spellcasting;
            next = { ...next, spellcasting: rest };
            log.push(msgs.m('feat.rageConc', { name: c.name, spell: spellIdName(msgs.lang, concentration.spellId) }));
          }
          return { character: next, log };
        },
      },
      {
        id: 'end_rage',
        name: 'End Rage',
        cost: 'free',
        problem: (c, msgs) => (raging(c) ? undefined : msgs.m('feat.notRaging')),
        use: (c, _db, { msgs = ENGLISH_MESSAGES }) => ({ character: removeEffects(c, (e) => e.key === 'rage'), log: [msgs.m('feat.rageEnds', { name: c.name })] }),
      },
    ],
    resistances: (c) => (raging(c) ? ['bludgeoning', 'piercing', 'slashing'] : []),
    checkModes: (c, ability) => (raging(c) && ability === 'str' ? { advantage: ['Rage'] } : {}),
    saveModes: (c, ability) => (raging(c) && ability === 'str' ? { advantage: ['Rage'] } : {}),
    onWeaponHit: (c, db, ctx) => (raging(c) && ctx.attack.ability === 'str' ? { modifiers: [{ value: rageDamage(c, db), label: 'Rage' }] } : undefined),
    blocksSpellcasting: raging,
  },
  {
    id: 'danger_sense',
    owner: 'barbarian',
    saveModes: (c, ability) => (ability === 'dex' && canAct(c) ? { advantage: ['Danger Sense'] } : {}),
  },
  {
    id: 'reckless_attack',
    owner: 'barbarian',
    actions: [
      {
        id: 'reckless_attack',
        name: 'Reckless Attack',
        cost: 'free',
        problem: (c, msgs) => (hasEffect(c, 'reckless') ? msgs.m('feat.alreadyReckless') : undefined),
        use: (c, _db, { msgs = ENGLISH_MESSAGES }) => ({
          character: addEffect(c, { key: 'reckless', sourceId: c.id, expires: { on: 'start_of_turn', creatureId: c.id, skip: 0 } }),
          log: [msgs.m('feat.reckless', { name: c.name })],
        }),
      },
    ],
    attackModes: (c, attack) => (hasEffect(c, 'reckless') && attack.melee && attack.ability === 'str' ? { advantage: ['Reckless Attack'] } : {}),
    attackedModes: (c) => (hasEffect(c, 'reckless') ? { advantage: ['Reckless Attack (target)'] } : {}),
  },
  { id: 'feral_instinct', owner: 'barbarian', initiativeModes: () => ({ advantage: ['Feral Instinct'] }) },
  {
    id: 'primal_champion',
    owner: 'barbarian',
    onGain: (c) => ({ ...c, abilities: { ...c.abilities, str: Math.min(25, c.abilities.str + 4), con: Math.min(25, c.abilities.con + 4) } }),
  },
  // Path of the Berserker
  {
    id: 'frenzy',
    owner: 'path_of_the_berserker',
    onWeaponHit: (c, db, ctx) =>
      raging(c) && hasEffect(c, 'reckless') && ctx.firstHitThisTurn && ctx.attack.ability === 'str'
        ? { extraDamage: [{ dice: `${rageDamage(c, db)}d6`, type: ctx.attack.damage[0]!.type }], text: 'Frenzy' }
        : undefined,
  },
  { id: 'mindless_rage', owner: 'path_of_the_berserker', conditionImmunities: (c) => (raging(c) ? ['charmed', 'frightened'] : []) },
];

/** Brutal Strike extra damage by Barbarian level (9: 1d10, 17: 2d10). */
export function brutalStrikeDice(c: Character): string | undefined {
  const l = level(c);
  return l >= 17 ? '2d10' : l >= 9 ? '1d10' : undefined;
}

/**
 * Relentless Rage (level 11): dropping to 0 HP while raging → DC 10 Con save (+5 per use until a
 * rest) to drop to twice the Barbarian level instead. Uses are counted in resources.relentless_rage.
 */
export function relentlessRage(c: Character, rng: Rng, msgs: Messages = ENGLISH_MESSAGES): { character: Character; save?: D20TestResult } {
  if (level(c) < 11 || !raging(c) || c.hp > 0 || c.dead) return { character: c };
  const uses = c.resources.relentless_rage?.current ?? 0;
  const save = savingThrow(c, 'con', { rng, dc: 10 + 5 * uses, msgs });
  // Counter resource: max 0 so a Short/Long Rest resets it to 0 uses.
  const resources = { ...c.resources, relentless_rage: { current: uses + 1, max: 0, recharge: 'short' as const } };
  if (!save.success) return { character: { ...c, resources }, save };
  const hp = 2 * level(c);
  return {
    character: { ...c, resources, hp, conditions: c.conditions.filter((x) => x.condition !== 'unconscious'), deathSaves: { successes: 0, failures: 0, stable: false } },
    save,
  };
}

/** Indomitable Might (18): a Strength check or save total below the Strength score uses the score. */
export function indomitableMight(c: Character, total: number): number {
  return level(c) >= 18 ? Math.max(total, c.abilities.str) : total;
}
