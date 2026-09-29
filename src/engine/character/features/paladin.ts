/**
 * Paladin and Oath of Devotion features (SRD 5.2). Auras need positions, so they are exposed as
 * helpers the combat module calls with distances (auraOfProtection, auraOfCourage...).
 */
import type { Character, Creature } from '../../core/creature';
import { abilityModifier, type Condition } from '../../rules/basics';
import { addEffect, hasEffect } from '../../rules/activeEffects';
import { canAct, removeCondition } from '../../rules/conditions';
import { heal } from '../../rules/damage';
import { classLevel } from '../derived';
import type { FeatureImpl } from './types';

const level = (c: Character) => classLevel(c, 'paladin');
const cha = (c: Character) => abilityModifier(c.abilities.cha);

const addPrepared = (c: Character, spellId: string): Character => {
  if (!c.spellcasting || c.spellcasting.prepared.some((p) => p.spellId === spellId)) return c;
  return { ...c, spellcasting: { ...c.spellcasting, prepared: [...c.spellcasting.prepared, { spellId, classId: 'paladin' }] } };
};

export const paladinFeatures: FeatureImpl[] = [
  {
    id: 'lay_on_hands',
    owner: 'paladin',
    resources: (c) => ({ lay_on_hands: { current: 5 * level(c), max: 5 * level(c), recharge: 'long' } }),
    actions: [
      {
        id: 'lay_on_hands',
        name: 'Lay On Hands',
        cost: 'bonus_action',
        resource: 'lay_on_hands',
        problem: (c) => ((c.resources.lay_on_hands?.current ?? 0) < 1 ? 'Lay On Hands pool is empty' : undefined),
        // choice: number of HP to restore, or 'cure_poison' (costs 5, removes Poisoned).
        use: (c, _db, { target, choice }) => {
          const pool = c.resources.lay_on_hands!;
          const who = target ?? c;
          const cure = choice === 'cure_poison';
          const want = cure ? 5 : Math.max(1, Number(choice ?? pool.current));
          const spend = Math.min(pool.current, want);
          if (cure && spend < 5) return { character: c, log: ['Curing poison costs 5 points.'] };
          const payer: Character = { ...c, resources: { ...c.resources, lay_on_hands: { ...pool, current: pool.current - spend } } };
          let patient: Creature = who.id === c.id ? payer : who;
          let text: string;
          if (cure) {
            patient = removeCondition(patient, 'poisoned');
            text = `${c.name} cures ${who.name}'s poison.`;
          } else {
            const r = heal(patient, spend);
            patient = r.creature;
            text = `${c.name} lays hands on ${who.name}: +${r.healed} HP.`;
          }
          return who.id === c.id ? { character: patient as Character, log: [text] } : { character: payer, others: [patient], log: [text] };
        },
      },
    ],
  },
  {
    id: 'paladins_smite',
    owner: 'paladin',
    resources: () => ({ free_divine_smite: { current: 1, max: 1, recharge: 'long' } }),
    onGain: (c) => addPrepared(c, 'divine_smite'),
  },
  {
    id: 'channel_divinity',
    owner: 'paladin',
    resources: (c) => {
      const max = level(c) >= 11 ? 3 : 2;
      return { channel_divinity: { current: max, max, recharge: 'long', shortRestRegain: 1 } };
    },
  },
  {
    id: 'faithful_steed',
    owner: 'paladin',
    resources: () => ({ free_find_steed: { current: 1, max: 1, recharge: 'long' } }),
    onGain: (c) => addPrepared(c, 'find_steed'),
  },
  {
    id: 'radiant_strikes',
    owner: 'paladin',
    onWeaponHit: (_c, _db, ctx) => (ctx.attack.range && !ctx.attack.properties.includes('thrown') ? undefined : { extraDamage: [{ dice: '1d8', type: 'radiant' }], text: 'Radiant Strikes' }),
  },
  // Oath of Devotion
  {
    id: 'sacred_weapon',
    owner: 'oath_of_devotion',
    actions: [
      {
        id: 'sacred_weapon',
        name: 'Sacred Weapon',
        cost: 'free',
        resource: 'channel_divinity',
        problem: (c) => ((c.resources.channel_divinity?.current ?? 0) < 1 ? 'No Channel Divinity uses left' : undefined),
        use: (c) => {
          const r = c.resources.channel_divinity!;
          const spent: Character = { ...c, resources: { ...c.resources, channel_divinity: { ...r, current: r.current - 1 } } };
          const cleared: Character = { ...spent, effects: spent.effects.filter((e) => e.key !== 'sacred_weapon') };
          return { character: addEffect(cleared, { key: 'sacred_weapon', sourceId: c.id, roundsLeft: 100 }), log: [`${c.name}'s weapon blazes with holy light (+${Math.max(1, cha(c))} to hit, Radiant).`] };
        },
      },
    ],
    modifyAttack: (c, _db, a) => {
      if (!hasEffect(c, 'sacred_weapon') || a.range) return a;
      const bonus = Math.max(1, cha(c));
      const toHitBreakdown = [...a.toHitBreakdown, { value: bonus, label: 'Sacred Weapon' }];
      return { ...a, toHitBreakdown, toHit: a.toHit + bonus };
    },
  },
];

/** Aura radius: 10 ft, 30 ft from Paladin level 18 (Aura Expansion). */
export function auraRadius(p: Character): number {
  return level(p) >= 18 ? 30 : 10;
}

/** Aura of Protection (6): save bonus = Cha mod (min +1) for the paladin and allies within the aura, while the paladin can act. */
export function auraOfProtection(paladin: Character, distanceFt: number): number {
  if (level(paladin) < 6 || !canAct(paladin) || distanceFt > auraRadius(paladin)) return 0;
  return Math.max(1, cha(paladin));
}

/** Conditions allies in the aura are immune to: Frightened (Aura of Courage, 10), Charmed (Aura of Devotion, Devotion 7). */
export function auraImmunities(paladin: Character, distanceFt: number): Condition[] {
  if (!canAct(paladin) || distanceFt > auraRadius(paladin)) return [];
  const out: Condition[] = [];
  if (level(paladin) >= 10) out.push('frightened');
  if (level(paladin) >= 7 && paladin.classes.some((x) => x.subclassId === 'oath_of_devotion')) out.push('charmed');
  return out;
}
