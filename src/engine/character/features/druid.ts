/**
 * Druid and Circle of the Land features (SRD 5.2), except Wild Shape itself (A039c).
 * Choices in character.choices: primal_order ['magician' | 'warden'],
 * elemental_fury ['potent_spellcasting' | 'primal_strike'], primal_strike_type [damage type],
 * land ['arid' | 'polar' | 'temperate' | 'tropical'] (chosen after each Long Rest).
 */
import type { Character, Creature } from '../../core/creature';
import type { SrdDatabase } from '../../data/srd';
import { abilityModifier, type DamageType } from '../../rules/basics';
import { createEffectContext, executeEffects } from '../../rules/effects';
import { spellSaveDc } from '../../rules/spellcasting';
import { classLevel } from '../derived';
import type { FeatureImpl } from './types';
import { ENGLISH_MESSAGES } from '../../i18n';
import { wildShapeActions } from './wildShape';

const level = (c: Character) => classLevel(c, 'druid');
const wis = (c: Character) => abilityModifier(c.abilities.wis);
const choice = (c: Character, key: string) => c.choices[key]?.[0];

export const LAND_DAMAGE: Record<string, DamageType> = { arid: 'fire', polar: 'cold', temperate: 'lightning', tropical: 'poison' };

/** Circle spells always prepared for the chosen land at this Druid level. */
export function landSpells(c: Character, db: SrdDatabase): string[] {
  const land = choice(c, 'land');
  const spells = db.subclasses.get('circle_of_the_land')?.spells ?? {};
  if (!land) return [];
  return Object.entries(spells)
    .filter(([key]) => key.startsWith(`${land}:`) && Number(key.split(':')[1]) <= level(c))
    .flatMap(([, ids]) => ids);
}

export const druidFeatures: FeatureImpl[] = [
  {
    id: 'primal_order',
    owner: 'druid',
    onGain: (c) =>
      choice(c, 'primal_order') === 'warden'
        ? {
            ...c,
            proficiencies: {
              ...c.proficiencies,
              weapons: [...new Set([...c.proficiencies.weapons, 'martial'])],
              armor: [...new Set([...c.proficiencies.armor, 'medium'])],
            },
          }
        : c,
    checkBonus: (c, ability, skill) =>
      choice(c, 'primal_order') === 'magician' && ability === 'int' && (skill === 'arcana' || skill === 'nature')
        ? [{ value: Math.max(1, wis(c)), label: 'Magician' }]
        : [],
  },
  {
    id: 'wild_shape',
    owner: 'druid',
    resources: (c, db) => {
      const max = Number(db.classes.get('druid')?.columns.wild_shape?.[level(c) - 1] ?? 2);
      return { wild_shape: { current: max, max, recharge: 'long', shortRestRegain: 1 } };
    },
    actions: wildShapeActions,
    blocksSpellcasting: (c) => c.effects.some((e) => e.key === 'wild_shape'),
  },
  {
    id: 'elemental_fury',
    owner: 'druid',
    onWeaponHit: (c, _db, ctx) =>
      choice(c, 'elemental_fury') === 'primal_strike' && ctx.firstHitThisTurn
        ? { extraDamage: [{ dice: level(c) >= 15 ? '2d8' : '1d8', type: (choice(c, 'primal_strike_type') as DamageType | undefined) ?? 'thunder' }], text: 'Primal Strike' }
        : undefined,
    spellOptions: (c, spell) => (choice(c, 'elemental_fury') === 'potent_spellcasting' && spell.level === 0 && spell.damaging ? { cantripDamageBonus: wis(c) } : {}),
  },
  // Circle of the Land
  {
    id: 'lands_aid',
    owner: 'circle_of_the_land',
    actions: [
      {
        id: 'lands_aid',
        name: "Land's Aid",
        cost: 'action',
        resource: 'wild_shape',
        problem: (c, msgs) => ((c.resources.wild_shape?.current ?? 0) < 1 ? msgs.m('feat.noWildShape') : undefined),
        use: (c, _db, { rng, targets = [], target, msgs = ENGLISH_MESSAGES }) => {
          // 10-ft sphere: enemies (targets) make a Con save vs 2d6 necrotic (half on success); one creature (target) heals 2d6.
          const dice = level(c) >= 14 ? '4d6' : level(c) >= 10 ? '3d6' : '2d6';
          const ws = c.resources.wild_shape!;
          const spent: Character = { ...c, resources: { ...c.resources, wild_shape: { ...ws, current: ws.current - 1 } } };
          const all: Creature[] = [...targets, ...(target && !targets.some((t) => t.id === target.id) ? [target] : [])];
          const ctx = createEffectContext({ rng, source: spent, targets: all, saveDc: spellSaveDc(spent, 'wis'), msgs });
          executeEffects([{ kind: 'save', ability: 'con', onFail: [{ kind: 'damage', damage: [{ dice, type: 'necrotic' }] }], onSuccess: 'half' }], targets.map((t) => t.id), ctx);
          if (target) executeEffects([{ kind: 'heal', dice, addSpellMod: false }], [target.id], ctx);
          return {
            character: (ctx.creatures.get(c.id) as Character) ?? spent,
            others: all.map((t) => ctx.creatures.get(t.id)!),
            log: [msgs.m('feat.landsAid', { name: c.name, dice }), ...ctx.log.map((l) => l.text)],
          };
        },
      },
    ],
  },
  {
    id: 'natural_recovery',
    owner: 'circle_of_the_land',
    resources: () => ({ natural_recovery: { current: 1, max: 1, recharge: 'long' } }),
  },
  {
    id: 'natures_ward',
    owner: 'circle_of_the_land',
    conditionImmunities: () => ['poisoned'],
    resistances: (c) => {
      const type = LAND_DAMAGE[choice(c, 'land') ?? ''];
      return type ? [type] : [];
    },
  },
];
