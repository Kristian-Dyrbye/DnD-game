/**
 * Spellcasting: slot tables (single class, multiclass, Pact Magic), spell save DC / attack
 * bonus, casting (slot use, rituals, upcasting, cantrip scaling), concentration (one at a time,
 * Con save on damage: DC max(10, half damage) up to 30; ends on Incapacitated/death) and slot
 * recovery on rests. Casting runs the spell's data-driven effects through effects.ts.
 */
import type { Character, Creature, SpellcastingState } from '../core/creature';
import type { Rng } from '../core/rng';
import { ENGLISH_MESSAGES, type Messages } from '../i18n';
import type { Effect } from '../data/common';
import type { ClassData, RulesTables, Spell } from '../data/schemas';
import { abilityModifier, type Ability } from './basics';
import { canAct, saveModes } from './conditions';
import { savingThrow, type D20TestResult } from './checks';
import { createEffectContext, executeEffects, type EffectContext, type HookFn } from './effects';
import { SPELL_HOOKS, revertExpiredEffects } from './spellHooks';
import { SPELL_HOOKS_2 } from './spellHooks2';
import { SPELL_HOOKS_3 } from './spellHooks3';

// ---------------------------------------------------------------- slot tables

export interface CasterClass {
  progression: ClassData['spellcasting']['progression'];
  level: number;
}

/**
 * Spell slots (levels 1–9) from class levels. One spellcasting class uses its own table
 * (full or half); several use the Multiclass Spellcaster table with full levels + half
 * levels rounded up. Pact Magic is separate (see pactSlots).
 */
export function spellSlots(classes: CasterClass[], tables: RulesTables): number[] {
  const casters = classes.filter((c) => c.progression === 'full' || c.progression === 'half' || c.progression === 'third');
  if (casters.length === 0) return new Array(9).fill(0);
  if (casters.length === 1) {
    const only = casters[0]!;
    if (only.progression === 'full') return [...tables.spellSlotsFull[only.level - 1]!];
    if (only.progression === 'half') return [...tables.spellSlotsHalf[only.level - 1]!];
  }
  let level = 0;
  for (const c of casters) {
    if (c.progression === 'full') level += c.level;
    else if (c.progression === 'half') level += Math.ceil(c.level / 2);
    else level += Math.floor(c.level / 3);
  }
  if (level < 1) return new Array(9).fill(0);
  return [...tables.multiclassSlots[Math.min(20, level) - 1]!];
}

export function pactSlots(warlockLevel: number, tables: RulesTables): { max: number; level: number } | undefined {
  if (warlockLevel < 1) return undefined;
  const [max, level] = tables.pactMagic[Math.min(20, warlockLevel) - 1]!;
  return { max, level };
}

export function spellSaveDc(c: Creature, ability: Ability): number {
  return 8 + c.proficiencyBonus + abilityModifier(c.abilities[ability]);
}

export function spellAttackBonus(c: Creature, ability: Ability): number {
  return c.proficiencyBonus + abilityModifier(c.abilities[ability]);
}

/** Cantrip damage dice multiplier by character level: ×1, ×2 at 5, ×3 at 11, ×4 at 17. */
export function cantripMultiplier(characterLevel: number): number {
  return characterLevel >= 17 ? 4 : characterLevel >= 11 ? 3 : characterLevel >= 5 ? 2 : 1;
}

/** Value from a {"1": x, "5": y, ...} table for a level (highest key ≤ level). */
export function levelTableValue(table: Record<string, number>, level: number): number {
  const keys = Object.keys(table).map(Number).filter((k) => k <= level).sort((a, b) => b - a);
  return keys.length ? table[String(keys[0])]! : 0;
}

/** Multiplies the dice count of every damage entry in cantrip effects (Fire Bolt 1d10 → 2d10 at level 5). */
export function scaleCantripEffects(effects: Effect[], multiplier: number): Effect[] {
  if (multiplier <= 1) return effects;
  const scale = (e: Effect): Effect => {
    switch (e.kind) {
      case 'damage':
        return {
          ...e,
          damage: e.damage.map((d) => ({ ...d, dice: d.dice.replace(/^(\d+)d(\d+)/, (_m, n: string, s: string) => `${Number(n) * multiplier}d${s}`) })),
        };
      case 'save':
        return { ...e, onFail: e.onFail.map(scale), onSuccess: Array.isArray(e.onSuccess) ? e.onSuccess.map(scale) : e.onSuccess };
      case 'attack':
        return { ...e, onHit: e.onHit.map(scale) };
      case 'area':
        return { ...e, effects: e.effects.map(scale) };
      default:
        return e;
    }
  };
  return effects.map(scale);
}

// ---------------------------------------------------------------- slots

export type SlotChoice = { kind: 'slot'; level: number } | { kind: 'pact' } | { kind: 'ritual' } | { kind: 'cantrip' } | { kind: 'free' };

export class SpellError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpellError';
  }
}

/** Level the spell is cast at for a slot choice (pact slots cast at the pact slot level). */
export function castLevel(spell: Spell, choice: SlotChoice, state?: SpellcastingState): number {
  if (spell.level === 0) return 0;
  if (choice.kind === 'slot') return choice.level;
  if (choice.kind === 'pact') return state?.pact?.level ?? spell.level;
  return spell.level;
}

/** Validates a slot choice; returns an error message or undefined if castable. */
export function slotProblem(spell: Spell, choice: SlotChoice, state: SpellcastingState | undefined): string | undefined {
  if (spell.level === 0) return choice.kind === 'cantrip' || choice.kind === 'free' ? undefined : 'Cantrips need no slot';
  switch (choice.kind) {
    case 'cantrip':
      return `${spell.name} is not a cantrip`;
    case 'ritual':
      return spell.castingTime.ritual ? undefined : `${spell.name} can't be cast as a ritual`;
    case 'free':
      return undefined;
    case 'pact':
      if (!state?.pact || state.pact.current < 1) return 'No Pact Magic slots left';
      if (state.pact.level < spell.level) return `Pact slots (level ${state.pact.level}) are too low for ${spell.name}`;
      return undefined;
    case 'slot':
      if (choice.level < spell.level) return `${spell.name} needs a level ${spell.level}+ slot`;
      if (!state || (state.slots[choice.level - 1] ?? 0) < 1) return `No level ${choice.level} slots left`;
      return undefined;
  }
}

export function expendSlot(state: SpellcastingState, choice: SlotChoice): SpellcastingState {
  if (choice.kind === 'slot') {
    const slots = [...state.slots];
    slots[choice.level - 1] = Math.max(0, (slots[choice.level - 1] ?? 0) - 1);
    return { ...state, slots };
  }
  if (choice.kind === 'pact' && state.pact) return { ...state, pact: { ...state.pact, current: state.pact.current - 1 } };
  return state;
}

/** Long rest: all slots. Short rest: Pact Magic slots only. */
export function recoverSlots(state: SpellcastingState, rest: 'short' | 'long'): SpellcastingState {
  const pact = state.pact ? { ...state.pact, current: state.pact.max } : undefined;
  if (rest === 'short') return { ...state, ...(pact && { pact }) };
  return { ...state, slots: [...state.maxSlots], ...(pact && { pact }) };
}

// ---------------------------------------------------------------- concentration

/** Ends the caster's concentration: removes conditions stamped with its source id from all creatures. */
export function endConcentration(ctx: Pick<EffectContext, 'creatures'>, casterId: string): string | undefined {
  const caster = ctx.creatures.get(casterId) as Character | undefined;
  const conc = caster?.spellcasting?.concentration;
  if (!caster || !conc) return undefined;
  for (const [id, c] of ctx.creatures) {
    if (c.conditions.some((x) => x.sourceId === conc.sourceId) || c.effects.some((e) => e.sourceId === conc.sourceId)) {
      const cleaned = { ...c, conditions: c.conditions.filter((x) => x.sourceId !== conc.sourceId), effects: c.effects.filter((e) => e.sourceId !== conc.sourceId) };
      ctx.creatures.set(id, revertExpiredEffects(cleaned, c.effects.filter((e) => e.sourceId === conc.sourceId)));
    }
  }
  const fresh = ctx.creatures.get(casterId) as Character;
  const { concentration: _ended, ...rest } = fresh.spellcasting!;
  ctx.creatures.set(casterId, { ...fresh, spellcasting: rest } as Character);
  return conc.spellId;
}

export function concentrationDc(damage: number): number {
  return Math.min(30, Math.max(10, Math.floor(damage / 2)));
}

/** Con save after taking damage while concentrating. Fails → concentration ends. */
export function concentrationCheck(ctx: EffectContext, casterId: string, damage: number, rng: Rng): D20TestResult | undefined {
  const caster = ctx.creatures.get(casterId) as Character | undefined;
  if (!caster?.spellcasting?.concentration) return undefined;
  if (caster.dead || !canAct(caster)) {
    const spell = endConcentration(ctx, casterId);
    ctx.log.push({ targetId: casterId, kind: 'info', text: `${caster.name} loses concentration on ${spell}` });
    return undefined;
  }
  const res = savingThrow(caster, 'con', { rng, dc: concentrationDc(damage), ...saveModes(caster, 'con'), ...(ctx.msgs && { msgs: ctx.msgs }) });
  ctx.log.push({ targetId: casterId, kind: 'save', text: `${caster.name} concentration: ${res.text}` });
  if (!res.success) {
    const spell = endConcentration(ctx, casterId);
    ctx.log.push({ targetId: casterId, kind: 'info', text: `${caster.name} loses concentration on ${spell}` });
  }
  return res;
}

// ---------------------------------------------------------------- casting

export interface CastOptions {
  rng: Rng;
  /** Language of the log lines (default English). */
  msgs?: Messages;
  caster: Character;
  spell: Spell;
  slot: SlotChoice;
  /** Spellcasting ability for this spell (from the class it's prepared through). */
  ability: Ability;
  targets: Creature[];
  /** Total character level (cantrip scaling). */
  characterLevel: number;
  distances?: Map<string, number>;
  hooks?: Record<string, HookFn>;
  /** From class features (features.spellOptions). */
  healBonus?: number;
  maxHealDice?: boolean;
  cantripDamageBonus?: number;
  damageBonus?: number;
  saveDcBonus?: number;
  attackAdvantage?: string;
  potentCantrip?: boolean;
  /** Creatures shielded by Sculpt Spells. */
  sculptTargetIds?: string[];
  /** Player choice passed to hooks (damage type, command word...). */
  choice?: string;
  /** Darts/rays per target (Magic Missile, Scorching Ray). */
  allocations?: Record<string, number>;
}

export interface CastResult {
  ctx: EffectContext;
  caster: Character;
  castAtLevel: number;
}

/** Casts a spell: checks and spends the slot, handles concentration, runs effects. Throws SpellError if it can't be cast. */
export function castSpell(o: CastOptions): CastResult {
  if (!canAct(o.caster)) throw new SpellError(`${o.caster.name} can't cast spells while incapacitated`);
  const state = o.caster.spellcasting;
  const problem = slotProblem(o.spell, o.slot, state);
  if (problem) throw new SpellError(problem);

  const level = castLevel(o.spell, o.slot, state);
  const sourceId = `${o.caster.id}:${o.spell.id}`;
  const ctx = createEffectContext({
    rng: o.rng,
    ...(o.msgs && { msgs: o.msgs }),
    source: o.caster,
    targets: o.targets,
    saveDc: spellSaveDc(o.caster, o.ability) + (o.saveDcBonus ?? 0),
    attackBonus: spellAttackBonus(o.caster, o.ability),
    spellMod: abilityModifier(o.caster.abilities[o.ability]),
    upcastLevels: o.spell.level > 0 ? level - o.spell.level : 0,
    slotLevel: level,
    ...(o.choice && { choice: o.choice }),
    ...(o.allocations && { allocations: o.allocations }),
    conditionSourceId: sourceId,
    ...(o.healBonus && { healBonus: o.healBonus }),
    ...(o.maxHealDice && { maxHealDice: true }),
    ...((o.damageBonus || (o.spell.level === 0 && o.cantripDamageBonus)) && {
      damageBonus: (o.damageBonus ?? 0) + (o.spell.level === 0 ? (o.cantripDamageBonus ?? 0) : 0),
    }),
    ...(o.attackAdvantage && { attackAdvantage: o.attackAdvantage }),
    ...(o.potentCantrip && o.spell.level === 0 && { potentCantrip: true }),
    ...(o.sculptTargetIds?.length && { sculptIds: new Set(o.sculptTargetIds) }),
    ...(o.distances && { distances: o.distances }),
    hooks: { ...SPELL_HOOKS, ...SPELL_HOOKS_2, ...SPELL_HOOKS_3, ...(o.hooks ?? {}) },
    onDamaged: (c, id, amount) => concentrationCheck(c, id, amount, o.rng),
  });

  // A new concentration spell ends the old one first.
  if (o.spell.duration.concentration && state?.concentration) {
    const ended = endConcentration(ctx, o.caster.id);
    ctx.log.push({ targetId: o.caster.id, kind: 'info', text: `${o.caster.name} stops concentrating on ${ended}` });
  }

  // Spend the slot before effects so reactions/logs see the new state.
  const casterNow = ctx.creatures.get(o.caster.id) as Character;
  if (casterNow.spellcasting) {
    ctx.creatures.set(o.caster.id, { ...casterNow, spellcasting: expendSlot(casterNow.spellcasting, o.slot) } as Character);
  }

  const baseEffects = o.spell.effects ?? [];
  // Cantrips whose hook says noDiceScaling (Eldritch Blast) scale by extra beams instead of bigger dice.
  const beamHook = baseEffects.find((e) => e.kind === 'hook' && e.params?.beamsByLevel) as Extract<Effect, { kind: 'hook' }> | undefined;
  const noDiceScaling = baseEffects.some((e) => e.kind === 'hook' && e.params?.noDiceScaling === true);
  const effects = o.spell.level === 0 && !noDiceScaling ? scaleCantripEffects(baseEffects, cantripMultiplier(o.characterLevel)) : baseEffects;
  ctx.log.push({
    targetId: o.caster.id,
    kind: 'info',
    text: (o.msgs ?? ENGLISH_MESSAGES).m(o.spell.level === 0 ? 'combat.casts' : o.slot.kind === 'ritual' ? 'combat.castsRitual' : 'combat.castsLevel', { caster: o.caster.name, spell: o.spell.name, level }),
  });
  if (effects.length === 0) ctx.log.push({ kind: 'info', text: `(${o.spell.name} has no automated effects yet)` });
  if (beamHook) {
    // One attack per beam; beams go to targets by allocation or round-robin.
    const beams = levelTableValue(beamHook.params!.beamsByLevel as Record<string, number>, o.characterLevel);
    const core = effects.filter((e) => e.kind !== 'hook');
    const ids = o.targets.map((t) => t.id);
    const order = o.allocations ? ids.flatMap((id) => new Array<string>(o.allocations![id] ?? 0).fill(id)) : Array.from({ length: beams }, (_, i) => ids[i % ids.length]!);
    ctx.targetIds = ids;
    for (const id of order.slice(0, beams)) executeEffects(core, [id], ctx);
  } else {
    executeEffects(effects, o.targets.map((t) => t.id), ctx);
  }

  if (o.spell.duration.concentration) {
    const after = ctx.creatures.get(o.caster.id) as Character;
    if (after.spellcasting && !after.dead) {
      const rounds = o.spell.duration.unit === 'minute' ? (o.spell.duration.amount ?? 1) * 10 : o.spell.duration.unit === 'round' ? o.spell.duration.amount : undefined;
      ctx.creatures.set(o.caster.id, {
        ...after,
        spellcasting: {
          ...after.spellcasting,
          concentration: { spellId: o.spell.id, sourceId, targetIds: o.targets.map((t) => t.id), ...(rounds !== undefined && { roundsLeft: rounds }) },
        },
      } as Character);
    }
  }
  return { ctx, caster: ctx.creatures.get(o.caster.id) as Character, castAtLevel: level };
}
