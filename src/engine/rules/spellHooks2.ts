/**
 * Spell hooks, batch 2: multi-projectile spells (Magic Missile, Scorching Ray, Chromatic Orb),
 * save-or-suck and utility spells (Command, Sleep, Hypnotic Pattern, Bestow Curse, Blindness/
 * Deafness, Dispel Magic, Counterspell, Revivify, Power Words, Lesser Restoration, Disintegrate,
 * Ice Knife, Acid Arrow, Vampiric Touch, Divine Smite). Movement-only effects (Misty Step) are
 * logged for the combat module; zone spells are A064a.
 */
import { formatDice, parseDice, roll } from '../core/dice';
import type { Creature } from '../core/creature';
import type { Rng } from '../core/rng';
import type { Damage } from '../data/common';
import { loadSrd } from '../data/srdBundle';
import type { Condition, DamageType } from './basics';
import { addEffect, removeEffects } from './activeEffects';
import { savingThrow } from './checks';
import { applyCondition, attackModes, removeCondition, saveModes } from './conditions';
import { applyDamage, attackRoll, rollDamage, type DamageRollResult } from './damage';
import { healFromZero } from './death';
import { dealDamage, upcastDice, type EffectContext, type HookFn } from './effects';

type Params = Record<string, unknown> | undefined;
const num = (p: Params, key: string, fallback = 0) => (typeof p?.[key] === 'number' ? (p[key] as number) : fallback);
const src = (ctx: EffectContext) => ctx.conditionSourceId ?? ctx.source.id;
const up = (ctx: EffectContext) => ctx.upcastLevels ?? 0;

/** How many projectiles this target gets: the player's allocation, else an even split (first targets get the remainder). */
function share(ctx: EffectContext, targetId: string, total: number): number {
  if (ctx.allocations) return ctx.allocations[targetId] ?? 0;
  const ids = ctx.targetIds ?? [targetId];
  const i = Math.max(0, ids.indexOf(targetId));
  return Math.floor(total / ids.length) + (i < total % ids.length ? 1 : 0);
}

function withUpcast(d: Damage, perLevel: unknown, levels: number): Damage[] {
  const dice = typeof perLevel === 'string' && levels > 0 ? upcastDice(d.dice, perLevel, levels) : parseDice(d.dice);
  return [{ dice: formatDice(dice), type: d.type }];
}

function spellAttack(ctx: EffectContext, id: string): { hit: boolean; crit: boolean } {
  const target = ctx.creatures.get(id)!;
  const source = ctx.creatures.get(ctx.source.id) ?? ctx.source;
  const modes = attackModes({ attacker: source, target, distanceFt: ctx.distances?.get(id) ?? 30 });
  const res = attackRoll({
    rng: ctx.rng,
    label: 'Spell attack',
    modifiers: [{ value: ctx.attackBonus ?? 0, label: 'Spell attack' }],
    targetAc: target.ac,
    advantage: [...modes.advantage, ...(ctx.attackAdvantage ? [ctx.attackAdvantage] : [])],
    disadvantage: modes.disadvantage,
  });
  ctx.log.push({ targetId: id, kind: 'attack', text: `${source.name} → ${target.name}: ${res.text}` });
  return res;
}

function sharedRoll(ctx: EffectContext, key: string, rng: Rng, damage: Damage[]): DamageRollResult {
  const cached = ctx.scratch?.get(key) as DamageRollResult | undefined;
  if (cached) return cached;
  const r = rollDamage(rng, damage);
  ctx.scratch?.set(key, r);
  return r;
}

function spellLevelOfSource(sourceId: string | undefined): number | undefined {
  const spellId = sourceId?.split(':')[1];
  return spellId ? loadSrd().spells.get(spellId)?.level : undefined;
}

export const SPELL_HOOKS_2: Record<string, HookFn> = {
  magic_missile: (ctx, id, p) => {
    const darts = share(ctx, id, num(p, 'darts', 3) + num(p, 'dartsPerUpcast', 1) * up(ctx));
    const dmg = (p?.damage as Damage | undefined) ?? { dice: '1d4+1', type: 'force' };
    for (let i = 0; i < darts; i++) dealDamage(ctx, id, rollDamage(ctx.rng, [dmg]), false);
  },
  scorching_ray: (ctx, id, p) => {
    const rays = share(ctx, id, num(p, 'rays', 3) + num(p, 'raysPerUpcast', 1) * up(ctx));
    const dmg = (p?.damage as Damage | undefined) ?? { dice: '2d6', type: 'fire' };
    for (let i = 0; i < rays; i++) {
      if (!ctx.creatures.get(id) || ctx.creatures.get(id)!.dead) break;
      const r = spellAttack(ctx, id);
      if (r.hit) dealDamage(ctx, id, rollDamage(ctx.rng, [dmg], { crit: r.crit }), false);
    }
  },
  chromatic_orb: (ctx, id, p) => {
    const types = (p?.damageTypes as DamageType[] | undefined) ?? ['fire'];
    const type = (types.includes(ctx.choice as DamageType) ? ctx.choice : types[0]) as DamageType;
    dealDamage(ctx, id, rollDamage(ctx.rng, withUpcast({ dice: String(p?.dice ?? '3d8'), type }, p?.upcast, up(ctx))), false);
  },
  disintegrate: (ctx, id) => {
    const c = ctx.creatures.get(id);
    if (c && c.hp === 0 && !c.dead) ctx.creatures.set(id, { ...c, dead: true });
    if (c && c.hp === 0) ctx.log.push({ targetId: id, kind: 'hook', text: `${c.name} is reduced to dust.` });
  },
  power_word_kill: (ctx, id, p) => {
    const c = ctx.creatures.get(id);
    if (!c) return;
    if (c.hp <= num(p, 'hpThreshold', 100)) {
      ctx.creatures.set(id, { ...c, hp: 0, dead: true });
      ctx.log.push({ targetId: id, kind: 'hook', text: `${c.name} dies instantly (Power Word Kill).` });
    } else dealDamage(ctx, id, rollDamage(ctx.rng, [(p?.otherwise as Damage | undefined) ?? { dice: '12d12', type: 'psychic' }]), false);
  },
  power_word_heal: (ctx, id, p) => {
    let c = ctx.creatures.get(id);
    if (!c || c.dead) return;
    c = healFromZero(c, c.maxHp).creature;
    for (const cond of (p?.endsConditions as Condition[] | undefined) ?? []) c = removeCondition(c, cond);
    ctx.creatures.set(id, c);
    ctx.log.push({ targetId: id, kind: 'heal', text: `${c.name} is fully healed (Power Word Heal).` });
  },
  lesser_restoration: (ctx, id, p) => {
    const c = ctx.creatures.get(id);
    if (!c) return;
    const options = (p?.endsOneOf as Condition[] | undefined) ?? [];
    const pick = options.find((o) => o === ctx.choice && c.conditions.some((x) => x.condition === o)) ?? options.find((o) => c.conditions.some((x) => x.condition === o));
    if (pick) {
      ctx.creatures.set(id, removeCondition(c, pick));
      ctx.log.push({ targetId: id, kind: 'hook', text: `${c.name} is no longer ${pick}.` });
    }
  },
  revivify: (ctx, id, p) => {
    const c = ctx.creatures.get(id);
    if (!c || !c.dead) return;
    ctx.creatures.set(id, { ...c, dead: false, hp: num(p, 'hp', 1), conditions: c.conditions.filter((x) => x.condition !== 'unconscious') });
    ctx.log.push({ targetId: id, kind: 'heal', text: `${c.name} returns to life with ${num(p, 'hp', 1)} HP.` });
  },
  command: (ctx, id, p) => {
    const c = ctx.creatures.get(id);
    if (!c) return;
    const word = (p?.options as string[] | undefined)?.includes(ctx.choice ?? '') ? ctx.choice! : 'halt';
    let next = addEffect(c, { key: 'commanded', sourceId: src(ctx), data: { word }, expires: { on: 'end_of_turn', creatureId: id, skip: 0 } });
    if (word === 'grovel') next = applyCondition(next, { condition: 'prone' }).creature;
    ctx.creatures.set(id, next);
    ctx.log.push({ targetId: id, kind: 'hook', text: `${c.name} obeys: "${word}".` });
  },
  sleep: (ctx, id, p) => {
    const c = ctx.creatures.get(id);
    if (!c) return;
    // Incapacitated now (core effect); repeat the save at the end of its next turn or fall Unconscious.
    ctx.creatures.set(id, addEffect(c, { key: 'sleep_pending', sourceId: src(ctx), data: { ...(p ?? {}), dc: ctx.saveDc ?? 10 }, expires: { on: 'end_of_turn', creatureId: id, skip: 0 } }));
  },
  hypnotic_pattern: (ctx, id, p) => {
    const c = ctx.creatures.get(id);
    if (c) ctx.creatures.set(id, addEffect(c, { key: 'hypnotized', sourceId: src(ctx), data: { ...(p ?? {}) } }));
  },
  bestow_curse: (ctx, id, p) => {
    const c = ctx.creatures.get(id);
    if (!c) return;
    const option = (p?.options as string[] | undefined)?.includes(ctx.choice ?? '') ? ctx.choice! : 'extra_damage';
    ctx.creatures.set(id, addEffect(c, { key: 'cursed', sourceId: src(ctx), roundsLeft: num(p, 'durationRounds', 10), data: { ...(p ?? {}), option, casterId: ctx.source.id } }));
    ctx.log.push({ targetId: id, kind: 'hook', text: `${c.name} is cursed (${option.replace(/_/g, ' ')}).` });
  },
  blindness_deafness: (ctx, id, p) => {
    const c = ctx.creatures.get(id);
    if (!c) return;
    const cond = ctx.choice === 'deafened' ? 'deafened' : 'blinded';
    const dc = ctx.saveDc ?? 10;
    ctx.creatures.set(id, applyCondition(c, { condition: cond, sourceId: src(ctx), roundsLeft: num(p, 'durationRounds', 10), endSave: { ability: 'con', dc } }).creature);
  },
  dispel_magic: (ctx, id, p) => {
    const c = ctx.creatures.get(id);
    if (!c) return;
    const autoMax = num(p, 'autoEndMaxLevel', 3) + num(p, 'autoEndMaxLevelPerUpcast', 1) * up(ctx);
    const sources = new Set([...c.conditions.map((x) => x.sourceId), ...c.effects.map((e) => e.sourceId)].filter((s): s is string => Boolean(s && s.includes(':'))));
    let next = c;
    for (const s of sources) {
      const level = spellLevelOfSource(s);
      if (level === undefined) continue;
      let ends = level <= autoMax;
      if (!ends) {
        const check = roll('1d20', ctx.rng).total + (ctx.spellMod ?? 0);
        ends = check >= num(p, 'checkDcBase', 10) + level;
        ctx.log.push({ targetId: id, kind: 'hook', text: `Dispel check vs DC ${10 + level}: ${check}${ends ? ' — success' : ' — failure'}` });
      }
      if (ends) {
        next = { ...removeEffects(next, (e) => e.sourceId === s), conditions: next.conditions.filter((x) => x.sourceId !== s) };
        ctx.log.push({ targetId: id, kind: 'hook', text: `${s.split(':')[1]!.replace(/_/g, ' ')} ends on ${c.name}.` });
      }
    }
    ctx.creatures.set(id, next);
  },
  counterspell: (ctx, id) => {
    const c = ctx.creatures.get(id);
    if (c) ctx.creatures.set(id, addEffect(c, { key: 'counterspelled', sourceId: src(ctx), expires: { on: 'end_of_turn', creatureId: id, skip: 0 } }));
    ctx.log.push({ targetId: id, kind: 'hook', text: 'The spell is countered (the slot is not spent).' });
  },
  vampiric_touch: (ctx, id, p) => {
    const dealt = ctx.lastDamage?.get(id) ?? 0;
    const caster = ctx.creatures.get(ctx.source.id);
    if (!caster || dealt <= 0) return;
    const amount = Math.floor(dealt * num(p, 'healFractionOfDamage', 0.5));
    ctx.creatures.set(ctx.source.id, healFromZero(caster, amount).creature);
    ctx.log.push({ targetId: ctx.source.id, kind: 'heal', text: `${caster.name} drains ${amount} HP.` });
  },
  divine_smite: (ctx, id, p) => {
    const c = ctx.creatures.get(id);
    if (!c || !(p?.bonusVsCreatureTypes as string[] | undefined)?.includes(c.creatureType)) return;
    dealDamage(ctx, id, rollDamage(ctx.rng, [{ dice: String(p?.bonusDice ?? '1d8'), type: (p?.bonusType as DamageType | undefined) ?? 'radiant' }]), false);
  },
  ice_knife: (ctx, id, p) => {
    const ex = p?.explosion as Record<string, unknown> | undefined;
    const c = ctx.creatures.get(id);
    if (!ex || !c || c.dead) return;
    const dmg = withUpcast((ex.damage as Damage | undefined) ?? { dice: '2d6', type: 'cold' }, ex.upcast, up(ctx));
    const rolled = sharedRoll(ctx, 'ice_knife', ctx.rng, dmg);
    const save = savingThrow(c, 'dex', { rng: ctx.rng, dc: ctx.saveDc ?? 10, ...saveModes(c, 'dex') });
    ctx.log.push({ targetId: id, kind: 'save', text: `${c.name} Dexterity save (Ice Knife burst): ${save.text}` });
    if (!save.success) dealDamage(ctx, id, rolled, false);
  },
  acid_arrow: (ctx, id, p) => {
    const dmg = withUpcast((p?.damage as Damage | undefined) ?? { dice: '4d4', type: 'acid' }, p?.upcast, up(ctx));
    const r = spellAttack(ctx, id);
    dealDamage(ctx, id, rollDamage(ctx.rng, dmg, { crit: r.crit }), !r.hit);
    const c = ctx.creatures.get(id);
    if (r.hit && c && !c.dead) {
      const delayed = p?.delayed as Record<string, unknown> | undefined;
      const later = withUpcast({ dice: String(delayed?.dice ?? '2d4'), type: 'acid' }, delayed?.upcast, up(ctx));
      ctx.creatures.set(id, addEffect(c, { key: 'acid_arrow', sourceId: src(ctx), data: { damage: later[0] }, expires: { on: 'end_of_turn', creatureId: id, skip: 0 } }));
    }
  },
  misty_step: (ctx, id, p) => {
    ctx.log.push({ targetId: id, kind: 'hook', text: `Teleport up to ${num(p, 'teleportFt', 30)} ft to a space you can see.` });
  },
};

/**
 * End of a creature's turn: Acid Arrow's delayed damage, Sleep's second save. Call before
 * onTurnEvent('end_of_turn') removes the effects.
 */
export function endOfTurnSpellEffects<T extends Creature>(c: T, rng: Rng): { creature: T; log: string[] } {
  let next = c;
  const log: string[] = [];
  for (const e of c.effects) {
    if (e.key === 'acid_arrow' && e.data.damage) {
      const d = e.data.damage as Damage;
      const amount = roll(d.dice, rng).total;
      next = applyDamage(next, [{ amount, type: d.type }]).creature as T;
      log.push(`${c.name} takes ${amount} acid damage from the lingering acid.`);
    }
    if (e.key === 'sleep_pending') {
      const save = savingThrow(next, 'wis', { rng, dc: num(e.data, 'dc', 10), ...saveModes(next, 'wis') });
      if (!save.success) {
        next = applyCondition(next, { condition: 'unconscious', ...(e.sourceId && { sourceId: e.sourceId }), roundsLeft: num(e.data, 'durationRounds', 10) }).creature as T;
        log.push(`${c.name} falls asleep (${save.text}).`);
      } else log.push(`${c.name} fights off the sleep (${save.text}).`);
    }
  }
  return { creature: next, log };
}

/** Bestow Curse "extra damage": the caster's hits on the cursed target deal +1d8 necrotic. */
export function curseDamageRider(attackerId: string, target: Creature): Damage[] {
  return target.effects
    .filter((e) => e.key === 'cursed' && e.data.option === 'extra_damage' && e.data.casterId === attackerId)
    .map((e) => (e.data.extraDamage as Damage | undefined) ?? { dice: '1d8', type: 'necrotic' });
}
