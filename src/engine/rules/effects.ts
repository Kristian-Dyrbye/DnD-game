/**
 * Effect executor: runs the data-driven `Effect` lists from spells, items and features
 * (engine/data/common.ts) against already-chosen targets. Area selection happens on the grid
 * (combat/aoe); here an `area` effect just applies its inner effects to every target given.
 *
 * SRD rules implemented: damage for one effect is rolled once and shared by all targets;
 * saves are per target ("half" on success halves that damage, round down); spell attacks are
 * per target and crits double dice; upcasting adds dice per slot level above the base level.
 * Unknown hooks are logged as unimplemented instead of throwing.
 */
import { parseDice, formatDice, roll, type DiceExpr, type Modifier } from '../core/dice';
import type { Creature } from '../core/creature';
import type { Rng } from '../core/rng';
import { ENGLISH_MESSAGES, type Messages } from '../i18n';
import type { Damage, Duration, Effect } from '../data/common';
import { abilityName } from '../i18n/srdNames';
import { applyCondition, attackModes, canAct, resistsAllDamage, saveModes } from './conditions';
import { applyDamage, attackRoll, grantTempHp, rollDamage, type DamageRollResult } from './damage';
import { healFromZero, resolveDamageAtZero } from './death';
import { savingThrow } from './checks';

export interface LogEntry {
  targetId?: string;
  kind: 'attack' | 'save' | 'damage' | 'heal' | 'temp_hp' | 'condition' | 'hook' | 'info';
  text: string;
}

export type HookFn = (ctx: EffectContext, targetId: string, params: Record<string, unknown> | undefined) => void;

export interface EffectContext {
  rng: Rng;
  /** Language of the log lines (default English). */
  msgs?: Messages;
  /** Caster/user. Also used for attack-roll condition modes. */
  source: Creature;
  /** All creatures touched by the effect, by id. Updated in place as effects resolve. */
  creatures: Map<string, Creature>;
  /** Save DC for saves without a fixed DC (spell save DC). */
  saveDc?: number;
  /** Spell attack bonus (total). */
  attackBonus?: number;
  /** Spellcasting ability modifier (heals that add it). */
  spellMod?: number;
  /** Slot levels above the spell's base level. */
  upcastLevels?: number;
  /** Level the spell was cast at (0 = cantrip). Hooks use it for slot-based durations. */
  slotLevel?: number;
  /** All targets of the current cast (hooks that split darts/rays use it). */
  targetIds?: string[];
  /** Player choice for the cast (Chromatic Orb damage type, Command word, condition to end...). */
  choice?: string;
  /** Per-target allocation of darts/rays chosen by the player. */
  allocations?: Record<string, number>;
  /** Scratch space shared by hooks during one cast (shared rolls). */
  scratch?: Map<string, unknown>;
  /** Last damage dealt to each creature in this cast (Vampiric Touch). */
  lastDamage?: Map<string, number>;
  /** Flat bonus added to each healing roll (Disciple of Life: 2 + slot level). */
  healBonus?: number;
  /** Healing dice count as their maximum (Supreme Healing). */
  maxHealDice?: boolean;
  /** Flat bonus added once to each damage roll (Potent Spellcasting, Empowered Evocation). */
  damageBonus?: number;
  /** Spell attack rolls have Advantage (Innate Sorcery). */
  attackAdvantage?: string;
  /** Potent Cantrip: a miss or a successful save still deals half the damage. */
  potentCantrip?: boolean;
  /** Sculpt Spells: these creatures automatically succeed on saves and take no damage on "half". */
  sculptIds?: Set<string>;
  /** Id stamped on conditions so they end with the spell/feature (concentration). */
  conditionSourceId?: string;
  /** Distances from source to each target in feet (for attack modes); default 5. */
  distances?: Map<string, number>;
  hooks?: Record<string, HookFn>;
  /** Called when a creature takes damage (concentration checks hook in here, A034). */
  onDamaged?: (ctx: EffectContext, targetId: string, amount: number) => void;
  log: LogEntry[];
}

export function createEffectContext(init: Omit<EffectContext, 'creatures' | 'log'> & { targets: Creature[] }): EffectContext {
  const creatures = new Map<string, Creature>([[init.source.id, init.source]]);
  for (const t of init.targets) creatures.set(t.id, t);
  const { targets: _t, ...rest } = init;
  return { ...rest, creatures, log: [] };
}

/** Runs effects against targets. Returns the context (updated creatures + log). */
export function executeEffects(effects: Effect[], targetIds: string[], ctx: EffectContext): EffectContext {
  ctx.targetIds ??= targetIds;
  ctx.scratch ??= new Map();
  ctx.lastDamage ??= new Map();
  for (const effect of effects) runEffect(effect, targetIds, ctx, {});
  return ctx;
}

interface RunState {
  /** Damage multiplier for this branch (0.5 after a successful save with "half"). */
  half?: boolean;
  crit?: boolean;
  /** Pre-rolled damage shared across targets. */
  sharedDamage?: Map<Effect, DamageRollResult>;
}

function runEffect(effect: Effect, targetIds: string[], ctx: EffectContext, state: RunState): void {
  const { m } = ctx.msgs ?? ENGLISH_MESSAGES;
  switch (effect.kind) {
    case 'area':
      for (const e of effect.effects) runEffect(e, targetIds, ctx, { ...state, sharedDamage: state.sharedDamage ?? new Map() });
      return;
    case 'damage': {
      const shared = state.sharedDamage;
      for (const id of targetIds) {
        let rolled = shared?.get(effect);
        if (!rolled || state.crit) {
          rolled = rollDamage(ctx.rng, upcastDamage(effect.damage, effect.upcast, ctx.upcastLevels), {
            crit: state.crit ?? false,
            ...(ctx.damageBonus && { modifiers: [{ value: ctx.damageBonus, label: m('eff.bonus') }] }),
            ...(ctx.msgs && { msgs: ctx.msgs }),
          });
          if (shared && !state.crit) shared.set(effect, rolled);
        }
        dealDamage(ctx, id, rolled, state.half ?? false);
      }
      return;
    }
    case 'save': {
      // Damage inside a save is rolled once for everyone (area spells), then halved per success.
      const shared = state.sharedDamage ?? new Map<Effect, DamageRollResult>();
      for (const id of targetIds) {
        const target = ctx.creatures.get(id);
        if (!target || target.dead) continue;
        const dc = effect.dc ?? ctx.saveDc ?? 10;
        if (ctx.sculptIds?.has(id)) {
          ctx.log.push({ targetId: id, kind: 'save', text: m('eff.sculpt', { name: target.name }) });
          if (Array.isArray(effect.onSuccess)) for (const e of effect.onSuccess) runEffect(e, [id], ctx, { ...state, sharedDamage: shared });
          continue;
        }
        const res = savingThrow(target, effect.ability, { rng: ctx.rng, dc, ...saveModes(target, effect.ability), ...(ctx.msgs && { msgs: ctx.msgs }) });
        ctx.log.push({ targetId: id, kind: 'save', text: m('eff.save', { name: target.name, ability: abilityName((ctx.msgs ?? ENGLISH_MESSAGES).lang, effect.ability), roll: res.text }) });
        // Evasion (Monk/Rogue 7): Dex saves for half damage → none on a success, half on a failure.
        const evasion = effect.ability === 'dex' && effect.onSuccess === 'half' && target.effects.some((e) => e.key === 'evasion') && canAct(target);
        if (evasion) {
          if (!res.success) for (const e of effect.onFail) runEffect(e, [id], ctx, { ...state, half: e.kind === 'damage' ? true : state.half, sharedDamage: shared });
          else ctx.log.push({ targetId: id, kind: 'info', text: m('eff.evasion', { name: target.name }) });
          continue;
        }
        if (!res.success) {
          for (const e of effect.onFail) runEffect(e, [id], ctx, { ...state, sharedDamage: shared });
        } else if (effect.onSuccess === 'half' || (effect.onSuccess === 'none' && ctx.potentCantrip)) {
          for (const e of effect.onFail) if (e.kind === 'damage') runEffect(e, [id], ctx, { ...state, half: true, sharedDamage: shared });
        } else if (Array.isArray(effect.onSuccess)) {
          for (const e of effect.onSuccess) runEffect(e, [id], ctx, { ...state, sharedDamage: shared });
        }
      }
      return;
    }
    case 'attack': {
      for (const id of targetIds) {
        const target = ctx.creatures.get(id);
        if (!target || target.dead) continue;
        const source = ctx.creatures.get(ctx.source.id) ?? ctx.source;
        const modes = attackModes({ attacker: source, target, distanceFt: ctx.distances?.get(id) ?? 5 });
        const label = m(effect.attack.endsWith('spell') ? 'eff.spellAttack' : 'eff.attack');
        const mods: Modifier[] = [{ value: ctx.attackBonus ?? 0, label }];
        const advantage = [...modes.advantage, ...(ctx.attackAdvantage ? [ctx.attackAdvantage] : [])];
        const res = attackRoll({ rng: ctx.rng, label, modifiers: mods, targetAc: target.ac, advantage, disadvantage: modes.disadvantage, exhaustion: source.exhaustion, ...(modes.autoCrit && { autoCrit: modes.autoCrit }), ...(ctx.msgs && { msgs: ctx.msgs }) });
        ctx.log.push({ targetId: id, kind: 'attack', text: `${source.name} → ${target.name}: ${res.text}` });
        if (res.hit) for (const e of effect.onHit) runEffect(e, [id], ctx, { ...state, crit: res.crit, sharedDamage: new Map() });
        else if (ctx.potentCantrip) for (const e of effect.onHit) if (e.kind === 'damage') runEffect(e, [id], ctx, { ...state, half: true, sharedDamage: new Map() });
      }
      return;
    }
    case 'heal': {
      const expr = upcastDice(effect.dice, effect.upcast, ctx.upcastLevels);
      for (const id of targetIds) {
        const target = ctx.creatures.get(id);
        if (!target || target.dead) continue;
        const r = roll(expr, ctx.rng);
        const diceTotal = ctx.maxHealDice
          ? expr.terms.reduce((s, t) => s + (t.kind === 'dice' ? t.sign * t.count * t.sides : t.sign * t.value), 0)
          : r.total;
        const amount = Math.max(0, diceTotal + (effect.addSpellMod ? (ctx.spellMod ?? 0) : 0) + (ctx.healBonus ?? 0));
        const { creature, healed } = healFromZero(target, amount);
        ctx.creatures.set(id, creature);
        const extras = `${effect.addSpellMod ? ` + ${ctx.spellMod ?? 0}` : ''}${ctx.healBonus ? ` + ${ctx.healBonus}` : ''}`;
        ctx.log.push({ targetId: id, kind: 'heal', text: m('eff.heal', { name: target.name, n: healed, roll: `${r.notation}: ${diceTotal}${ctx.maxHealDice ? m('eff.max') : ''}${extras}` }) });
      }
      return;
    }
    case 'temp_hp': {
      for (const id of targetIds) {
        const target = ctx.creatures.get(id);
        if (!target) continue;
        const amount = roll(effect.dice, ctx.rng).total;
        ctx.creatures.set(id, grantTempHp(target, amount));
        ctx.log.push({ targetId: id, kind: 'temp_hp', text: m('eff.tempHp', { name: target.name, n: amount }) });
      }
      return;
    }
    case 'condition': {
      for (const id of targetIds) {
        const target = ctx.creatures.get(id);
        if (!target || target.dead) continue;
        const rounds = durationRounds(effect.duration);
        const res = applyCondition(target, {
          condition: effect.condition,
          ...(ctx.conditionSourceId && { sourceId: ctx.conditionSourceId }),
          ...(rounds !== undefined && { roundsLeft: rounds }),
        });
        ctx.creatures.set(id, res.creature);
        ctx.log.push({ targetId: id, kind: 'condition', text: m(res.applied ? 'cond.has' : 'cond.immune', { name: target.name, condition: effect.condition }) });
      }
      return;
    }
    case 'hook': {
      const fn = ctx.hooks?.[effect.hook];
      for (const id of targetIds) {
        if (fn) fn(ctx, id, effect.params);
        else ctx.log.push({ targetId: id, kind: 'hook', text: m('eff.notImplemented', { hook: effect.hook }) });
      }
      return;
    }
  }
}

/** Applies an already-rolled damage result to a creature (defenses, 0 HP, concentration). Exported for hooks. */
export function dealDamage(ctx: EffectContext, id: string, rolled: DamageRollResult, half: boolean): void {
  const target = ctx.creatures.get(id);
  if (!target || target.dead) return;
  const instances = rolled.parts.map((p) => ({ type: p.type, amount: half ? Math.floor(p.total / 2) : p.total }));
  const { creature, report } = applyDamage(target, instances, { resistAll: resistsAllDamage(target) });
  const outcome = resolveDamageAtZero(target, creature, report, { crit: rolled.crit });
  ctx.creatures.set(id, outcome.creature);
  ctx.lastDamage?.set(id, report.totalAfterDefenses);
  const notes = report.adjusted.filter((a) => a.note).map((a) => `${a.type} ${a.note}`);
  const { m } = ctx.msgs ?? ENGLISH_MESSAGES;
  const fate = outcome.event === 'died' ? ` — ${m('combat.dies')}` : outcome.event === 'unconscious' ? ` — ${m('combat.fallsUnconscious')}` : '';
  ctx.log.push({
    targetId: id,
    kind: 'damage',
    text: `${m(half ? 'combat.takesHalf' : 'combat.takes', { name: target.name, n: report.totalAfterDefenses })} — ${rolled.text}${notes.length ? ` [${notes.join(', ')}]` : ''}${fate}`,
  });
  if (report.totalAfterDefenses > 0) ctx.onDamaged?.(ctx, id, report.totalAfterDefenses);
}

// ---------------------------------------------------------------- upcasting and durations

/** "8d6" + "1d6" × 2 → "10d6"; mixed dice are appended ("3d6+2d4"). */
export function upcastDice(base: string, perLevel: string | undefined, levels = 0): DiceExpr {
  const expr = parseDice(base);
  if (!perLevel || levels <= 0) return expr;
  const extra = parseDice(perLevel);
  const terms = [...expr.terms];
  for (const t of extra.terms) {
    if (t.kind !== 'dice') {
      terms.push({ ...t, value: t.value * levels });
      continue;
    }
    const same = terms.findIndex((x) => x.kind === 'dice' && x.sides === t.sides && x.sign === t.sign && !x.keep);
    if (same >= 0) {
      const cur = terms[same]!;
      if (cur.kind === 'dice') terms[same] = { ...cur, count: cur.count + t.count * levels };
    } else terms.push({ ...t, count: t.count * levels });
  }
  return { terms };
}

function upcastDamage(damage: Damage[], perLevel: string | undefined, levels = 0): Damage[] {
  if (!perLevel || levels <= 0) return damage;
  const [first, ...rest] = damage;
  if (!first) return damage;
  return [{ ...first, dice: formatDice(upcastDice(first.dice, perLevel, levels)) }, ...rest];
}

/** Duration → rounds (1 minute = 10 rounds). Undefined = no fixed end. */
export function durationRounds(d: Duration | undefined): number | undefined {
  if (!d || !d.amount) return undefined;
  switch (d.unit) {
    case 'round':
      return d.amount;
    case 'minute':
      return d.amount * 10;
    case 'hour':
      return d.amount * 600;
    case 'day':
      return d.amount * 14_400;
    default:
      return undefined;
  }
}
