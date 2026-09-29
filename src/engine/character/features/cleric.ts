/**
 * Cleric and Life Domain features (SRD 5.2). Choices live in character.choices:
 * divine_order ['protector' | 'thaumaturge'], blessed_strikes ['divine_strike' | 'potent_spellcasting'].
 * Channel Divinity effects (Divine Spark, Turn Undead + Sear Undead, Preserve Life) spend the
 * 'channel_divinity' resource and resolve through the effect executor.
 */
import type { Character, Creature } from '../../core/creature';
import type { Effect } from '../../data/common';
import type { Rng } from '../../core/rng';
import { roll } from '../../core/dice';
import { abilityModifier } from '../../rules/basics';
import { applyCondition } from '../../rules/conditions';
import { createEffectContext, executeEffects } from '../../rules/effects';
import { spellSaveDc } from '../../rules/spellcasting';
import { savingThrow } from '../../rules/checks';
import { applyDamage, isBloodied } from '../../rules/damage';
import { classLevel } from '../derived';
import type { FeatureActionResult, FeatureImpl } from './types';

const level = (c: Character) => classLevel(c, 'cleric');
const wis = (c: Character) => abilityModifier(c.abilities.wis);
const choice = (c: Character, key: string) => c.choices[key]?.[0];

function spendChannel(c: Character): Character {
  const r = c.resources.channel_divinity!;
  return { ...c, resources: { ...c.resources, channel_divinity: { ...r, current: r.current - 1 } } };
}

const noChannel = (c: Character) => ((c.resources.channel_divinity?.current ?? 0) < 1 ? 'No Channel Divinity uses left' : undefined);

/** Divine Spark dice: 1d8, 2d8 at 7, 3d8 at 13, 4d8 at 18. */
export function divineSparkDice(c: Character): number {
  const l = level(c);
  return l >= 18 ? 4 : l >= 13 ? 3 : l >= 7 ? 2 : 1;
}

function runEffects(c: Character, targets: Creature[], effects: Effect[], rng: Rng): FeatureActionResult {
  const ctx = createEffectContext({ rng, source: c, targets, saveDc: spellSaveDc(c, 'wis'), spellMod: wis(c) });
  executeEffects(effects, targets.map((t) => t.id), ctx);
  return {
    character: (ctx.creatures.get(c.id) as Character) ?? c,
    others: targets.map((t) => ctx.creatures.get(t.id)!).filter((t) => t.id !== c.id),
    log: ctx.log.map((l) => l.text),
  };
}

export const clericFeatures: FeatureImpl[] = [
  {
    id: 'divine_order',
    owner: 'cleric',
    onGain: (c) =>
      choice(c, 'divine_order') === 'protector'
        ? {
            ...c,
            proficiencies: {
              ...c.proficiencies,
              weapons: [...new Set([...c.proficiencies.weapons, 'martial'])],
              armor: [...new Set([...c.proficiencies.armor, 'heavy'])],
            },
          }
        : c,
    checkBonus: (c, ability, skill) =>
      choice(c, 'divine_order') === 'thaumaturge' && ability === 'int' && (skill === 'arcana' || skill === 'religion')
        ? [{ value: Math.max(1, wis(c)), label: 'Thaumaturge' }]
        : [],
  },
  {
    id: 'channel_divinity',
    owner: 'cleric',
    resources: (c, db) => {
      const max = Number(db.classes.get('cleric')?.columns.channel_divinity?.[level(c) - 1] ?? 2);
      return { channel_divinity: { current: max, max, recharge: 'long', shortRestRegain: 1 } };
    },
    actions: [
      {
        id: 'divine_spark',
        name: 'Divine Spark',
        cost: 'action',
        resource: 'channel_divinity',
        problem: noChannel,
        use: (c, _db, { rng, target, choice: mode }) => {
          if (!target) return { character: c, log: ['Choose a creature within 30 feet.'] };
          const dice = `${divineSparkDice(c)}d8${wis(c) >= 0 ? '+' : ''}${wis(c)}`;
          const spent = spendChannel(c);
          const effects: Effect[] =
            mode === 'heal'
              ? [{ kind: 'heal', dice, addSpellMod: false }]
              : [{ kind: 'save', ability: 'con', onFail: [{ kind: 'damage', damage: [{ dice, type: mode === 'necrotic' ? 'necrotic' : 'radiant' }] }], onSuccess: 'half' }];
          const r = runEffects(spent, target.id === c.id ? [spent] : [target], effects, rng);
          return { ...r, log: [`${c.name} channels a Divine Spark.`, ...r.log] };
        },
      },
      {
        id: 'turn_undead',
        name: 'Turn Undead',
        cost: 'action',
        resource: 'channel_divinity',
        problem: noChannel,
        use: (c, _db, { rng, targets = [] }) => {
          const spent = spendChannel(c);
          const dc = spellSaveDc(c, 'wis');
          const sear = level(c) >= 5 ? roll(`${Math.max(1, wis(c))}d8`, rng).total : 0;
          const log = [`${c.name} presents their holy symbol: Turn Undead (DC ${dc}).`];
          const others: Creature[] = [];
          for (const t of targets.filter((x) => x.creatureType === 'undead' && !x.dead)) {
            const save = savingThrow(t, 'wis', { rng, dc });
            log.push(`${t.name} Wisdom save: ${save.text}`);
            if (save.success) continue;
            const source = `${c.id}:turn_undead`;
            let turned = applyCondition(t, { condition: 'frightened', sourceId: source, roundsLeft: 10 }).creature;
            turned = applyCondition(turned, { condition: 'incapacitated', sourceId: source, roundsLeft: 10 }).creature;
            if (sear) {
              turned = applyDamage(turned, [{ amount: sear, type: 'radiant' }]).creature;
              log.push(`Sear Undead: ${t.name} takes ${sear} Radiant damage.`);
            }
            log.push(`${t.name} is turned for 1 minute.`);
            others.push(turned);
          }
          return { character: spent, others, log };
        },
      },
    ],
  },
  {
    id: 'blessed_strikes',
    owner: 'cleric',
    onWeaponHit: (c, _db, ctx) =>
      choice(c, 'blessed_strikes') === 'divine_strike' && ctx.firstHitThisTurn
        ? { extraDamage: [{ dice: level(c) >= 14 ? '2d8' : '1d8', type: 'radiant' }], text: 'Divine Strike' }
        : undefined,
    spellOptions: (c, spell) => (choice(c, 'blessed_strikes') === 'potent_spellcasting' && spell.level === 0 && spell.damaging ? { cantripDamageBonus: wis(c) } : {}),
  },
  {
    id: 'divine_intervention',
    owner: 'cleric',
    resources: () => ({ divine_intervention: { current: 1, max: 1, recharge: 'long' } }),
  },
  // Life Domain
  {
    id: 'disciple_of_life',
    owner: 'life_domain',
    spellOptions: (_c, spell, slotLevel) => (spell.healing && slotLevel >= 1 ? { healBonus: 2 + slotLevel } : {}),
  },
  {
    id: 'preserve_life',
    owner: 'life_domain',
    actions: [
      {
        id: 'preserve_life',
        name: 'Preserve Life',
        cost: 'action',
        resource: 'channel_divinity',
        problem: noChannel,
        use: (c, _db, { targets = [] }) => {
          let pool = 5 * level(c);
          const others: Creature[] = [];
          const log = [`${c.name} channels Preserve Life (${pool} HP).`];
          for (const t of targets) {
            if (pool <= 0 || t.dead || !isBloodied(t)) continue;
            const cap = Math.max(0, Math.floor(t.maxHp / 2) - t.hp);
            const amount = Math.min(pool, cap);
            if (amount <= 0) continue;
            pool -= amount;
            others.push({ ...t, hp: t.hp + amount });
            log.push(`${t.name} regains ${amount} HP.`);
          }
          return { character: spendChannel(c), others, log };
        },
      },
    ],
  },
  { id: 'supreme_healing', owner: 'life_domain', spellOptions: (_c, spell) => (spell.healing ? { maxHealDice: true } : {}) },
];

/** Blessed Healer (Life 6): HP the cleric regains after healing another creature with a spell slot. */
export function blessedHealerAmount(c: Character, slotLevel: number): number {
  return c.classes.some((x) => x.subclassId === 'life_domain' && x.level >= 6) && slotLevel >= 1 ? 2 + slotLevel : 0;
}
