/**
 * Spell hooks, batch 1: buffs and debuffs stored as active effects on creatures (key = spell id,
 * sourceId = `<caster>:<spell>` so ending concentration removes them), plus the queries the rest
 * of the engine uses: AC bonuses and Mage Armor, roll bonus dice (Bless/Bane), save modifiers
 * (Haste/Slow), attacked-roll modes (Guiding Bolt, Faerie Fire, Blur), damage riders (Hex,
 * Hunter's Mark, Divine Favor). Params come from data/srd/overrides/spells.json.
 */
import { roll, type Modifier } from '../core/dice';
import type { ActiveEffect, Creature } from '../core/creature';
import type { Rng } from '../core/rng';
import type { Damage } from '../data/common';
import { abilityModifier, type Ability, type Condition } from './basics';
import { addEffect, removeEffects } from './activeEffects';
import { grantTempHp } from './damage';
import { removeCondition } from './conditions';
import type { EffectContext, HookFn } from './effects';

type Params = Record<string, unknown> | undefined;

const num = (p: Params, key: string, fallback = 0) => (typeof p?.[key] === 'number' ? (p[key] as number) : fallback);

function source(ctx: EffectContext): string {
  return ctx.conditionSourceId ?? ctx.source.id;
}

function durationRounds(ctx: EffectContext, p: Params): number | undefined {
  if (typeof p?.durationRounds === 'number') return p.durationRounds;
  const bySlot = p?.durationHoursBySlot as Record<string, number> | undefined;
  if (bySlot && ctx.slotLevel) {
    const best = Object.entries(bySlot)
      .filter(([lvl]) => Number(lvl) <= ctx.slotLevel!)
      .sort((a, b) => Number(b[0]) - Number(a[0]))[0];
    if (best) return best[1] * 600;
  }
  if (typeof p?.durationHours === 'number') return p.durationHours * 600;
  return undefined;
}

/** Adds (or replaces, same key + source) an effect on a creature in the context. */
function put(ctx: EffectContext, targetId: string, key: string, p: Params, extra: Partial<ActiveEffect> = {}): void {
  const c = ctx.creatures.get(targetId);
  if (!c) return;
  const src = source(ctx);
  const rounds = durationRounds(ctx, p);
  const cleared = removeEffects(c, (e) => e.key === key && e.sourceId === src);
  ctx.creatures.set(targetId, addEffect(cleared, { key, sourceId: src, ...(rounds !== undefined && { roundsLeft: rounds }), data: { ...(p ?? {}) }, ...extra }));
  ctx.log.push({ targetId, kind: 'hook', text: `${c.name} is affected by ${key.replace(/_/g, ' ')}` });
}

export const SPELL_HOOKS: Record<string, HookFn> = {
  bless: (ctx, id, p) => put(ctx, id, 'bless', p),
  bane: (ctx, id, p) => put(ctx, id, 'bane', p),
  shield: (ctx, id, p) => put(ctx, id, 'shield', p, { expires: { on: 'start_of_turn', creatureId: ctx.source.id, skip: 0 } }),
  shield_of_faith: (ctx, id, p) => put(ctx, id, 'shield_of_faith', p),
  mage_armor: (ctx, id, p) => put(ctx, id, 'mage_armor', p),
  haste: (ctx, id, p) => put(ctx, id, 'haste', p),
  slow: (ctx, id, p) => put(ctx, id, 'slow_spell', p),
  heroism: (ctx, id, p) => put(ctx, id, 'heroism', { ...p, tempHpEachTurn: ctx.spellMod ?? 0 }),
  blur: (ctx, id, p) => put(ctx, id, 'blur', p),
  faerie_fire: (ctx, id, p) => put(ctx, id, 'faerie_fire', p),
  divine_favor: (ctx, id, p) => put(ctx, id, 'divine_favor', p),
  // Hex / Hunter's Mark: the rider lives on the caster, pointing at the marked target.
  hex: (ctx, id, p) => put(ctx, ctx.source.id, 'hex', p, { targetId: id }),
  hunters_mark: (ctx, id, p) => put(ctx, ctx.source.id, 'hunters_mark', p, { targetId: id }),
  guiding_bolt: (ctx, id, p) => put(ctx, id, 'guided', p, { consumeOn: 'attacked', expires: { on: 'end_of_turn', creatureId: ctx.source.id, skip: 1 } }),
  invisibility: (ctx, id, p) => put(ctx, id, 'invisibility_spell', p),
  aid: (ctx, id, p) => {
    const c = ctx.creatures.get(id);
    if (!c) return;
    const bonus = num(p, 'hpMaxBonus', 5) + num(p, 'hpMaxBonusPerUpcast', 5) * (ctx.upcastLevels ?? 0);
    ctx.creatures.set(id, { ...c, maxHp: c.maxHp + bonus, hp: c.hp + bonus });
    put(ctx, id, 'aid', { ...p, appliedBonus: bonus });
  },
  false_life: (ctx, id, p) => {
    const c = ctx.creatures.get(id);
    const extra = num(p, 'extraTempHpPerUpcast', 5) * (ctx.upcastLevels ?? 0);
    if (c && extra > 0) ctx.creatures.set(id, { ...c, tempHp: c.tempHp + extra });
  },
  heal: (ctx, id, p) => {
    let c = ctx.creatures.get(id);
    if (!c) return;
    for (const cond of (p?.endsConditions as Condition[] | undefined) ?? []) c = removeCondition(c, cond);
    ctx.creatures.set(id, c);
  },
};

/** Undo side effects when effects end (Aid's max-HP bonus). Returns the updated creature. */
export function revertExpiredEffects<T extends Creature>(c: T, expired: ActiveEffect[]): T {
  let next = c;
  for (const e of expired) {
    if (e.key === 'aid' && typeof e.data.appliedBonus === 'number') {
      const maxHp = Math.max(1, next.maxHp - e.data.appliedBonus);
      next = { ...next, maxHp, hp: Math.min(next.hp, maxHp) };
    }
  }
  return next;
}

// ---------------------------------------------------------------- queries

const eff = (c: Creature, key: string) => c.effects.filter((e) => e.key === key);

/** Current AC including spell effects: Mage Armor base (unarmored), Shield +5, Shield of Faith +2, Haste +2, Slow −2. */
export function effectiveAc(c: Creature, wearingArmor = false): number {
  let base = c.ac;
  const mage = eff(c, 'mage_armor')[0];
  if (mage && !wearingArmor) base = Math.max(base, num(mage.data, 'baseAc', 13) + abilityModifier(c.abilities.dex));
  let bonus = 0;
  for (const key of ['shield', 'shield_of_faith', 'haste']) for (const e of eff(c, key)) bonus += num(e.data, 'acBonus');
  for (const e of eff(c, 'slow_spell')) bonus -= num(e.data, 'acPenalty', 2);
  return base + bonus;
}

/** Rolled bonus/penalty dice for a D20 Test from Bless and Bane. */
export function rollEffectBonuses(c: Creature, kind: 'attack' | 'save' | 'check', rng: Rng): Modifier[] {
  const out: Modifier[] = [];
  for (const e of eff(c, 'bless')) if ((e.data.appliesTo as string[] | undefined)?.includes(kind)) out.push({ value: roll(String(e.data.bonusDice ?? '1d4'), rng).total, label: 'Bless' });
  for (const e of eff(c, 'bane')) if ((e.data.appliesTo as string[] | undefined)?.includes(kind)) out.push({ value: -roll(String(e.data.penaltyDice ?? '1d4'), rng).total, label: 'Bane' });
  return out;
}

/** Save modes and flat modifiers from effects (Haste: Dex advantage; Slow: −2 Dex). */
export function effectSaveAdjustments(c: Creature, ability: Ability): { advantage: string[]; modifiers: Modifier[] } {
  const advantage = eff(c, 'haste').some((e) => (e.data.saveAdvantage as string[] | undefined)?.includes(ability)) ? ['Haste'] : [];
  const modifiers: Modifier[] = ability === 'dex' ? eff(c, 'slow_spell').map((e) => ({ value: -num(e.data, 'dexSavePenalty', 2), label: 'Slow' })) : [];
  return { advantage, modifiers };
}

/** Modes for attack rolls made AGAINST this creature from its effects. */
export function attackedEffectModes(target: Creature, attacker?: Creature): { advantage: string[]; disadvantage: string[] } {
  const advantage: string[] = [];
  const disadvantage: string[] = [];
  if (eff(target, 'guided').length) advantage.push('Guiding Bolt');
  if (eff(target, 'faerie_fire').length) advantage.push('Faerie Fire');
  const seesThrough = attacker && (attacker.senses.blindsight || attacker.senses.truesight);
  if (eff(target, 'blur').length && !seesThrough) disadvantage.push('Blur');
  return { advantage, disadvantage };
}

/** Removes effects used up by being attacked (Guiding Bolt). */
export function consumeAttackedEffects<T extends Creature>(target: T): T {
  return removeEffects(target, (e) => e.consumeOn === 'attacked');
}

/** Extra damage dice on the attacker's hits from spell effects. */
export function effectDamageRiders(attacker: Creature, targetId: string, weaponAttack: boolean): Damage[] {
  const out: Damage[] = [];
  for (const key of ['hex', 'hunters_mark']) {
    for (const e of eff(attacker, key)) {
      const d = e.data.extraDamage as Damage | undefined;
      if (d && e.targetId === targetId) out.push(d);
    }
  }
  if (weaponAttack) for (const e of eff(attacker, 'divine_favor')) if (e.data.extraDamage) out.push(e.data.extraDamage as Damage);
  return out;
}

/** Start of turn: Heroism temp HP. */
export function startOfTurnEffects<T extends Creature>(c: T): T {
  const hero = eff(c, 'heroism')[0];
  return hero ? grantTempHp(c, num(hero.data, 'tempHpEachTurn')) : c;
}

/** Invisibility (the spell) ends when the creature attacks, deals damage or casts a spell. */
export function breakInvisibility<T extends Creature>(c: T): T {
  const spell = eff(c, 'invisibility_spell')[0];
  if (!spell) return c;
  const without = removeEffects(c, (e) => e.key === 'invisibility_spell');
  return { ...without, conditions: without.conditions.filter((x) => !(x.condition === 'invisible' && x.sourceId === spell.sourceId)) };
}
