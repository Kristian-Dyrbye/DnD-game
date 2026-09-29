/**
 * Sorcerer (+Draconic Sorcery), Warlock (+Fiend Patron) and Wizard (+Evoker) features (SRD 5.2).
 * Choices: character.choices.metamagic [ids], eldritch_invocation [ids], elemental_affinity
 * [damage type], fiendish_resilience [damage type].
 */
import { roll } from '../../core/dice';
import type { Character } from '../../core/creature';
import type { Rng } from '../../core/rng';
import { abilityModifier, type DamageType } from '../../rules/basics';
import { addEffect, hasEffect } from '../../rules/activeEffects';
import { grantTempHp } from '../../rules/damage';
import { classLevel } from '../derived';
import type { FeatureImpl } from './types';

const lvl = (c: Character, cls: string) => classLevel(c, cls);
const mod = (c: Character, a: 'int' | 'cha') => abilityModifier(c.abilities[a]);
const choice = (c: Character, key: string) => c.choices[key] ?? [];

// ---------------------------------------------------------------- Sorcerer

/** Sorcery Points needed to create a spell slot of each level (Font of Magic). */
export const SLOT_COST: Record<number, number> = { 1: 2, 2: 3, 3: 5, 4: 6, 5: 7 };

/** Metamagic option costs in Sorcery Points (SRD 5.2). */
export const METAMAGIC_COST: Record<string, number> = {
  careful_spell: 1,
  distant_spell: 1,
  empowered_spell: 1,
  extended_spell: 1,
  heightened_spell: 2,
  quickened_spell: 2,
  seeking_spell: 1,
  subtle_spell: 1,
  transmuted_spell: 1,
  twinned_spell: 1,
};

const sorcererFeatures: FeatureImpl[] = [
  {
    id: 'innate_sorcery',
    owner: 'sorcerer',
    resources: () => ({ innate_sorcery: { current: 2, max: 2, recharge: 'long' } }),
    actions: [
      {
        id: 'innate_sorcery',
        name: 'Innate Sorcery',
        cost: 'bonus_action',
        resource: 'innate_sorcery',
        problem: (c) => ((c.resources.innate_sorcery?.current ?? 0) < 1 ? 'No uses left' : hasEffect(c, 'innate_sorcery') ? 'Already active' : undefined),
        use: (c) => {
          const r = c.resources.innate_sorcery!;
          return {
            character: addEffect({ ...c, resources: { ...c.resources, innate_sorcery: { ...r, current: r.current - 1 } } }, { key: 'innate_sorcery', sourceId: c.id, roundsLeft: 10 }),
            log: [`${c.name} unleashes Innate Sorcery (+1 spell save DC, Advantage on Sorcerer spell attacks).`],
          };
        },
      },
    ],
    spellOptions: (c, spell) => (hasEffect(c, 'innate_sorcery') && spell.classId === 'sorcerer' ? { saveDcBonus: 1, attackAdvantage: 'Innate Sorcery' } : {}),
  },
  {
    id: 'font_of_magic',
    owner: 'sorcerer',
    resources: (c, db) => {
      const max = Number(db.classes.get('sorcerer')?.columns.sorcery_points?.[lvl(c, 'sorcerer') - 1] ?? 0);
      return { sorcery_points: { current: max, max, recharge: 'long' } };
    },
    actions: [
      {
        id: 'create_spell_slot',
        name: 'Create Spell Slot',
        cost: 'bonus_action',
        resource: 'sorcery_points',
        // choice: slot level 1–5
        use: (c, _db, { choice: level }) => {
          const n = Number(level);
          const cost = SLOT_COST[n];
          const sp = c.resources.sorcery_points;
          if (!cost || !sp || sp.current < cost || !c.spellcasting) return { character: c, log: ['Not enough Sorcery Points.'] };
          const slots = [...c.spellcasting.slots];
          slots[n - 1] = (slots[n - 1] ?? 0) + 1;
          return {
            character: { ...c, spellcasting: { ...c.spellcasting, slots }, resources: { ...c.resources, sorcery_points: { ...sp, current: sp.current - cost } } },
            log: [`${c.name} shapes ${cost} Sorcery Points into a level ${n} spell slot.`],
          };
        },
      },
      {
        id: 'convert_spell_slot',
        name: 'Convert Spell Slot',
        cost: 'free',
        use: (c, _db, { choice: level }) => {
          const n = Number(level);
          const sp = c.resources.sorcery_points;
          if (!sp || !c.spellcasting || (c.spellcasting.slots[n - 1] ?? 0) < 1) return { character: c, log: ['No slot of that level.'] };
          const slots = [...c.spellcasting.slots];
          slots[n - 1]! -= 1;
          return {
            character: { ...c, spellcasting: { ...c.spellcasting, slots }, resources: { ...c.resources, sorcery_points: { ...sp, current: Math.min(sp.max, sp.current + n) } } },
            log: [`${c.name} converts a level ${n} slot into ${n} Sorcery Points.`],
          };
        },
      },
    ],
  },
  { id: 'sorcerous_restoration', owner: 'sorcerer', resources: () => ({ sorcerous_restoration: { current: 1, max: 1, recharge: 'long' } }) },
  // Draconic Sorcery
  {
    id: 'draconic_resilience',
    owner: 'draconic_sorcery',
    onGain: (c) => ({ ...c, maxHp: c.maxHp + 3, hp: c.hp + 3 }),
    onLevelUp: (c) => ({ ...c, maxHp: c.maxHp + 1, hp: c.hp + 1 }),
  },
  {
    id: 'elemental_affinity',
    owner: 'draconic_sorcery',
    // Resistance to the chosen type; the +Cha damage bonus is elementalAffinityBonus() (needs the spell's damage types).
    resistances: (c) => choice(c, 'elemental_affinity') as DamageType[],
  },
  { id: 'dragon_wings', owner: 'draconic_sorcery', resources: () => ({ dragon_wings: { current: 1, max: 1, recharge: 'long' } }) },
];

/** Sorcerous Restoration (5): on a Short Rest regain Sorcery Points up to half the Sorcerer level (round down), once per Long Rest. */
export function sorcerousRestoration(c: Character): Character {
  const r = c.resources.sorcerous_restoration;
  const sp = c.resources.sorcery_points;
  if (!r || r.current < 1 || !sp || lvl(c, 'sorcerer') < 5) return c;
  const gain = Math.min(Math.floor(lvl(c, 'sorcerer') / 2), sp.max - sp.current);
  return { ...c, resources: { ...c.resources, sorcerous_restoration: { ...r, current: 0 }, sorcery_points: { ...sp, current: sp.current + gain } } };
}

/** Elemental Affinity bonus to one damage roll of a spell dealing the chosen type. */
export function elementalAffinityBonus(c: Character, damageTypes: DamageType[]): number {
  const t = choice(c, 'elemental_affinity')[0] as DamageType | undefined;
  return t && damageTypes.includes(t) && c.classes.some((x) => x.subclassId === 'draconic_sorcery' && x.level >= 6) ? mod(c, 'cha') : 0;
}

// ---------------------------------------------------------------- Warlock

const warlockFeatures: FeatureImpl[] = [
  {
    id: 'eldritch_invocations',
    owner: 'warlock',
    // Agonizing Blast: +Cha to Eldritch Blast damage.
    spellOptions: (c, spell) => (spell.id === 'eldritch_blast' && choice(c, 'eldritch_invocation').includes('agonizing_blast') ? { cantripDamageBonus: mod(c, 'cha') } : {}),
  },
  {
    id: 'magical_cunning',
    owner: 'warlock',
    resources: () => ({ magical_cunning: { current: 1, max: 1, recharge: 'long' } }),
    actions: [
      {
        id: 'magical_cunning',
        name: 'Magical Cunning',
        cost: 'free',
        resource: 'magical_cunning',
        problem: (c) => ((c.resources.magical_cunning?.current ?? 0) < 1 ? 'Already used' : !c.spellcasting?.pact ? 'No Pact Magic' : undefined),
        use: (c) => {
          const pact = c.spellcasting!.pact!;
          const regained = Math.min(Math.ceil(pact.max / 2), pact.max - pact.current);
          return {
            character: {
              ...c,
              spellcasting: { ...c.spellcasting!, pact: { ...pact, current: pact.current + regained } },
              resources: { ...c.resources, magical_cunning: { ...c.resources.magical_cunning!, current: 0 } },
            },
            log: [`${c.name} performs an eldritch rite and regains ${regained} Pact Magic slot(s).`],
          };
        },
      },
    ],
  },
  // Fiend Patron
  { id: 'fiendish_resilience', owner: 'fiend_patron', resistances: (c) => choice(c, 'fiendish_resilience') as DamageType[] },
  { id: 'dark_ones_own_luck', owner: 'fiend_patron', resources: (c) => ({ dark_ones_own_luck: { current: Math.max(1, mod(c, 'cha')), max: Math.max(1, mod(c, 'cha')), recharge: 'long' } }) },
];

/** Dark One's Blessing (Fiend 3): temp HP when an enemy drops to 0 near you = Cha mod + Warlock level (min 1). */
export function darkOnesBlessing(c: Character): Character {
  if (!c.classes.some((x) => x.subclassId === 'fiend_patron')) return c;
  return grantTempHp(c, Math.max(1, mod(c, 'cha') + lvl(c, 'warlock')));
}

// ---------------------------------------------------------------- Wizard

const wizardFeatures: FeatureImpl[] = [
  { id: 'arcane_recovery', owner: 'wizard', resources: () => ({ arcane_recovery: { current: 1, max: 1, recharge: 'long' } }) },
  // Evoker
  {
    id: 'potent_cantrip',
    owner: 'evoker',
    spellOptions: (_c, spell) => (spell.level === 0 && spell.damaging ? { potentCantrip: true } : {}),
  },
  {
    id: 'empowered_evocation',
    owner: 'evoker',
    spellOptions: (c, spell) => (spell.school === 'evocation' && spell.classId === 'wizard' && spell.damaging ? { damageBonus: mod(c, 'int') } : {}),
  },
];

/**
 * Arcane Recovery: after a Short Rest recover slots totalling ≤ half the Wizard level (round up),
 * none of level 6+. `levels` lists the slot levels to recover.
 */
export function arcaneRecovery(c: Character, levels: number[]): Character | undefined {
  const r = c.resources.arcane_recovery;
  const sc = c.spellcasting;
  if (!r || r.current < 1 || !sc) return undefined;
  const budget = Math.ceil(lvl(c, 'wizard') / 2);
  if (levels.some((l) => l >= 6 || l < 1) || levels.reduce((a, b) => a + b, 0) > budget) return undefined;
  const slots = [...sc.slots];
  for (const l of levels) {
    if ((slots[l - 1] ?? 0) >= (sc.maxSlots[l - 1] ?? 0)) return undefined;
    slots[l - 1]! += 1;
  }
  return { ...c, spellcasting: { ...sc, slots }, resources: { ...c.resources, arcane_recovery: { ...r, current: 0 } } };
}

export const casterFeatures: FeatureImpl[] = [...sorcererFeatures, ...warlockFeatures, ...wizardFeatures];

/** Dark One's Own Luck (Fiend 6): add a d10 to an ability check or saving throw. */
export function darkOnesOwnLuck(rng: Rng): number {
  return roll('1d10', rng).total;
}
