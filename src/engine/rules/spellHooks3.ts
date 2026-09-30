/**
 * Spell hooks, batch 3: cantrip riders (Ray of Frost, Chill Touch, Shocking Grasp, Vicious
 * Mockery, Starry Wisp) and hook-driven cantrips (Produce Flame, Shillelagh, True Strike,
 * Sorcerous Burst); Hold/Dominate repeat saves; charm and control riders (Charm Person/Monster,
 * Fear, Suggestion, Banishment, Compulsion); common buffs (Barkskin, Enhance Ability,
 * Enlarge/Reduce, Fly, Longstrider, Mirror Image, Protection from Energy / Evil and Good,
 * Resistance, Guidance, Sanctuary, Stoneskin, Magic Weapon, Warding Bond, Death Ward, Beacon of
 * Hope, Spider Climb, See Invisibility, Darkvision).
 *
 * Same pattern as batches 1–2: every buff/debuff is an ActiveEffect keyed by the spell id (or a
 * rider key), `sourceId = ctx.conditionSourceId ?? ctx.source.id` so ending concentration removes
 * it, `data` = the hook params from data/srd/overrides/spells.json plus cast-time values. The
 * pure query helpers at the bottom are what combat calls (see each doc comment).
 */
import { roll, type Modifier } from '../core/dice';
import { totalLevel, type ActiveEffect, type Character, type Creature, type Speed } from '../core/creature';
import type { Rng } from '../core/rng';
import type { Damage } from '../data/common';
import { SIZES, type Ability, type Condition, type DamageType, type Size, type Skill } from './basics';
import { addEffect, removeEffects } from './activeEffects';
import { savingThrow, type D20TestResult } from './checks';
import { applyCondition, attackModes, saveModes } from './conditions';
import { attackRoll, rollDamage, type DamageRollResult } from './damage';
import { dealDamage, type EffectContext, type HookFn } from './effects';
import { cantripMultiplier, levelTableValue } from './spellcasting';
import { ENGLISH_MESSAGES, type Messages } from '../i18n';

type Params = Record<string, unknown> | undefined;
const num = (p: Params, key: string, fallback = 0) => (typeof p?.[key] === 'number' ? (p[key] as number) : fallback);
const src = (ctx: EffectContext) => ctx.conditionSourceId ?? ctx.source.id;
const eff = (c: Creature, key: string) => c.effects.filter((e) => e.key === key);
const strs = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : []);
const msg = (ctx: EffectContext): Messages => ctx.msgs ?? ENGLISH_MESSAGES;
/** Spread into roll options so their math lines use the cast's language. */
const lang = (ctx: EffectContext) => (ctx.msgs ? { msgs: ctx.msgs } : {});

// ---------------------------------------------------------------- shared helpers

/** Character level of the caster (cantrip scaling); non-characters count as level 1. */
function casterLevel(c: Creature): number {
  return 'classes' in c && Array.isArray((c as Character).classes) ? totalLevel(c as Character) : 1;
}

/** Dice string from a {"1": "1d8", "5": "2d8"} table (highest key ≤ level); undefined below the first key. */
export function levelTableDice(table: Record<string, string> | undefined, level: number): string | undefined {
  if (!table) return undefined;
  const keys = Object.keys(table).map(Number).filter((k) => k <= level).sort((a, b) => b - a);
  return keys.length ? table[String(keys[0])] : undefined;
}

/** "1d8" × 2 → "2d8" (leading dice term only, like scaleCantripEffects). */
function scaleDice(dice: string, mult: number): string {
  return mult <= 1 ? dice : dice.replace(/^(\d+)d(\d+)/, (_m, n: string, s: string) => `${Number(n) * mult}d${s}`);
}

/** Rounds for this cast: durationRounds, durationHours, or a by-slot table (rounds / hours / days). */
function rounds(ctx: EffectContext, p: Params): number | undefined {
  const bySlot = (key: string, factor: number) => {
    const table = p?.[key] as Record<string, number> | undefined;
    if (!table) return undefined;
    const v = levelTableValue(table, ctx.slotLevel ?? 0);
    return v > 0 ? v * factor : undefined;
  };
  return (
    bySlot('durationRoundsBySlot', 1) ??
    bySlot('durationDaysBySlot', 14_400) ??
    bySlot('durationHoursBySlot', 600) ??
    (typeof p?.durationRounds === 'number' ? p.durationRounds : typeof p?.durationHours === 'number' ? p.durationHours * 600 : undefined)
  );
}

/** Adds (or replaces, same key + source) an effect on a creature. */
function put(ctx: EffectContext, targetId: string, key: string, p: Params, extra: Partial<ActiveEffect> = {}, extraData: Record<string, unknown> = {}): void {
  const c = ctx.creatures.get(targetId);
  if (!c) return;
  const s = src(ctx);
  const r = rounds(ctx, p);
  const cleared = removeEffects(c, (e) => e.key === key && e.sourceId === s);
  ctx.creatures.set(targetId, addEffect(cleared, { key, sourceId: s, ...(r !== undefined && { roundsLeft: r }), data: { ...(p ?? {}), ...extraData }, ...extra }));
  ctx.log.push({ targetId, kind: 'hook', text: msg(ctx).m('hook.affected', { name: c.name, effect: key.replace(/_/g, ' ') }) });
}

/** The condition this cast put on the target (same sourceId), if any. */
function castCondition(ctx: EffectContext, c: Creature, cond: Condition) {
  return c.conditions.find((x) => x.condition === cond && x.sourceId === src(ctx));
}

/** Spell only works on these creature types: strips what this cast applied and returns false. */
function typeAllowed(ctx: EffectContext, id: string, p: Params, cond: Condition): boolean {
  const c = ctx.creatures.get(id);
  const types = strs(p?.creatureTypes);
  if (!c || types.length === 0 || types.includes(c.creatureType)) return true;
  ctx.creatures.set(id, { ...c, conditions: c.conditions.filter((x) => !(x.condition === cond && x.sourceId === src(ctx))) });
  ctx.log.push({ targetId: id, kind: 'hook', text: msg(ctx).m('hook.unaffected', { name: c.name, type: c.creatureType }) });
  return false;
}

function spellAttack(ctx: EffectContext, id: string): { hit: boolean; crit: boolean } {
  const target = ctx.creatures.get(id)!;
  const source = ctx.creatures.get(ctx.source.id) ?? ctx.source;
  const modes = attackModes({ attacker: source, target, distanceFt: ctx.distances?.get(id) ?? 30 });
  const label = msg(ctx).m('eff.spellAttack');
  const res = attackRoll({
    rng: ctx.rng,
    label,
    modifiers: [{ value: ctx.attackBonus ?? 0, label }],
    targetAc: target.ac,
    advantage: [...modes.advantage, ...(ctx.attackAdvantage ? [ctx.attackAdvantage] : [])],
    disadvantage: modes.disadvantage,
    exhaustion: source.exhaustion,
    ...(modes.autoCrit && { autoCrit: modes.autoCrit }),
    ...lang(ctx),
  });
  ctx.log.push({ targetId: id, kind: 'attack', text: `${source.name} → ${target.name}: ${res.text}` });
  return res;
}

const bonusMods = (ctx: EffectContext): Modifier[] => (ctx.damageBonus ? [{ value: ctx.damageBonus, label: msg(ctx).m('eff.bonus') }] : []);

// ---------------------------------------------------------------- hooks

/** Charm/control riders: an effect next to the core condition, only if the condition landed. */
function controlRider(key: string, cond: Condition) {
  return (ctx: EffectContext, id: string, p: Params) => {
    if (!typeAllowed(ctx, id, p, cond)) return;
    const c = ctx.creatures.get(id);
    const landed = c && castCondition(ctx, c, cond);
    if (!c || !landed) return;
    const r = rounds(ctx, p);
    if (r !== undefined) ctx.creatures.set(id, { ...c, conditions: c.conditions.map((x) => (x === landed ? { ...x, roundsLeft: r } : x)) });
    put(ctx, id, key, p, {}, { casterId: ctx.source.id, dc: ctx.saveDc ?? 10, ...(ctx.choice && { text: ctx.choice }) });
  };
}

/** Hold Person / Hold Monster: the paralysis from this cast gets a repeat Wis save at the end of each turn. */
function holdHook(ctx: EffectContext, id: string, p: Params): void {
  const cond = (p?.appliesIfCondition as Condition | undefined) ?? 'paralyzed';
  if (!typeAllowed(ctx, id, p, cond)) return;
  const c = ctx.creatures.get(id);
  const landed = c && castCondition(ctx, c, cond);
  if (!c || !landed) return;
  const ability = (p?.repeatSave as Ability | undefined) ?? 'wis';
  const endSave = { ability, dc: ctx.saveDc ?? 10 };
  ctx.creatures.set(id, { ...c, conditions: c.conditions.map((x) => (x === landed ? { ...x, endSave } : x)) });
}

export const SPELL_HOOKS_3: Record<string, HookFn> = {
  // --- cantrip riders (run after the core damage) ---
  // Uses the mastery 'slow' key so effectiveSpeed() already applies the −10 ft (the two don't stack).
  ray_of_frost: (ctx, id, p) => {
    const c = ctx.creatures.get(id);
    if (!c || c.dead) return;
    const cleared = removeEffects(c, (e) => e.key === 'slow' && e.sourceId === src(ctx));
    ctx.creatures.set(id, addEffect(cleared, { key: 'slow', sourceId: src(ctx), data: { speedPenalty: num(p, 'speedReductionFt', 10), spell: 'ray_of_frost' }, expires: { on: 'start_of_turn', creatureId: ctx.source.id, skip: 0 } }));
    ctx.log.push({ targetId: id, kind: 'hook', text: msg(ctx).m('hook.speedDrops', { name: c.name, ft: num(p, 'speedReductionFt', 10) }) });
  },
  chill_touch: (ctx, id, p) => put(ctx, id, 'no_healing', p, { expires: { on: 'end_of_turn', creatureId: ctx.source.id, skip: 1 } }),
  // SRD 5.2.1: the target can't make Opportunity Attacks (not all reactions) until the start of its next turn.
  shocking_grasp: (ctx, id, p) => put(ctx, id, 'no_opportunity_attacks', p, { expires: { on: 'start_of_turn', creatureId: id, skip: 0 } }),
  vicious_mockery: (ctx, id, p) => put(ctx, id, 'vicious_mockery', p, { consumeOn: 'own_attack', expires: { on: 'end_of_turn', creatureId: id, skip: 0 } }),
  starry_wisp: (ctx, id, p) => put(ctx, id, 'starry_wisp', p, { expires: { on: 'end_of_turn', creatureId: ctx.source.id, skip: 1 } }),
  // Ignoring cover is a targeting rule (combat/aoe); nothing to store.
  sacred_flame: () => undefined,

  // --- hook-driven cantrips (scaled here: castSpell only scales core damage effects) ---
  produce_flame: (ctx, id, p) => {
    const caster = ctx.source.id;
    if (!eff(ctx.creatures.get(caster) ?? ctx.source, 'produce_flame').length) put(ctx, caster, 'produce_flame', p);
    const target = ctx.creatures.get(id);
    if (id === caster || !target || target.dead) return;
    // Hurl the flame as part of the casting (later hurls: combat re-runs this hook with the flame effect present).
    const d = (p?.damage as Damage | undefined) ?? { dice: '1d8', type: 'fire' };
    const r = spellAttack(ctx, id);
    const rolled = rollDamage(ctx.rng, [{ ...d, dice: scaleDice(d.dice, cantripMultiplier(casterLevel(ctx.source))) }], { crit: r.crit, modifiers: bonusMods(ctx), ...lang(ctx) });
    if (r.hit) dealDamage(ctx, id, rolled, false);
    else if (ctx.potentCantrip) dealDamage(ctx, id, rolled, true);
  },
  // The club/quarterstaff attack itself is a weapon attack in combat; it reads weaponEffectMods().
  shillelagh: (ctx, id, p) =>
    put(ctx, id, 'shillelagh', p, {}, {
      damageDie: levelTableDice(p?.damageDieByLevel as Record<string, string> | undefined, casterLevel(ctx.source)) ?? '1d8',
      spellMod: ctx.spellMod ?? 0,
      forceDamage: ctx.choice === 'force',
    }),
  // True Strike is cast as part of a weapon attack; the hook arms the caster's next attack (combat rolls it
  // and reads weaponEffectMods(), which consumes on own_attack via consumeAttackEffects).
  true_strike: (ctx, _id, p) => {
    const caster = ctx.source.id;
    put(ctx, caster, 'true_strike', p, { consumeOn: 'own_attack', expires: { on: 'end_of_turn', creatureId: caster, skip: 0 } }, {
      spellMod: ctx.spellMod ?? 0,
      extraRadiant: levelTableDice(p?.extraRadiantByLevel as Record<string, string> | undefined, casterLevel(ctx.source)),
      radiant: ctx.choice !== 'weapon',
    });
  },
  // Runs inside the core attack's onHit. Hooks don't see the crit flag, so a crit rolls normal dice here.
  sorcerous_burst: (ctx, id, p) => {
    const c = ctx.creatures.get(id);
    if (!c || c.dead) return;
    const types = strs(p?.damageTypes) as DamageType[];
    const type = (types.includes(ctx.choice as DamageType) ? ctx.choice : (types[0] ?? 'fire')) as DamageType;
    const dice = levelTableDice(p?.diceByLevel as Record<string, string> | undefined, casterLevel(ctx.source)) ?? String(p?.dice ?? '1d8');
    const base = rollDamage(ctx.rng, [{ dice, type }], { modifiers: bonusMods(ctx), ...lang(ctx) });
    const explodeOn = num(p, 'explodeOn', 8);
    const sides = Number(/d(\d+)/.exec(dice)?.[1] ?? 8);
    const maxExtra = p?.maxExtraDice === 'spell_mod' ? Math.max(0, ctx.spellMod ?? 0) : num(p, 'maxExtraDice', 0);
    const rolls = base.parts[0]!.roll.terms.flatMap((t) => (t.kind === 'dice' ? t.rolls : []));
    let pending = rolls.filter((r) => r >= explodeOn).length;
    const extra: number[] = [];
    while (pending > 0 && extra.length < maxExtra) {
      const r = roll(`1d${sides}`, ctx.rng).total;
      extra.push(r);
      pending += (r >= explodeOn ? 1 : 0) - 1;
    }
    const bonus = extra.reduce((s, r) => s + r, 0);
    const part = base.parts[0]!;
    const rolled: DamageRollResult = {
      parts: [{ ...part, total: part.total + bonus }],
      total: base.total + bonus,
      crit: false,
      text: `${base.text}${extra.length ? msg(ctx).m('hook.burst', { list: extra.join(', ') }) : ''}`,
    };
    dealDamage(ctx, id, rolled, false);
  },

  // --- hold / dominate ---
  hold_person: holdHook,
  hold_monster: holdHook,
  dominate_beast: controlRider('dominated', 'charmed'),
  dominate_person: controlRider('dominated', 'charmed'),
  dominate_monster: controlRider('dominated', 'charmed'),

  // --- charm / control ---
  charm_person: controlRider('charm_person', 'charmed'),
  charm_monster: controlRider('charm_monster', 'charmed'),
  fear: controlRider('fear', 'frightened'),
  suggestion: controlRider('suggested', 'charmed'),
  mass_suggestion: controlRider('suggested', 'charmed'),
  compulsion: controlRider('compelled', 'charmed'),
  banishment: (ctx, id, p) => {
    const c = ctx.creatures.get(id);
    if (!c || !castCondition(ctx, c, 'incapacitated')) return;
    put(ctx, id, 'banished', p, {}, {
      casterId: ctx.source.id,
      returnsAfterRounds: num(p, 'permanentAfterRounds', 10),
      permanentIfFullDuration: strs(p?.permanentIfTypes).includes(c.creatureType),
    });
  },

  // --- buffs ---
  barkskin: (ctx, id, p) => put(ctx, id, 'barkskin', p),
  enhance_ability: (ctx, id, p) => {
    const options = strs(p?.abilityChoice);
    put(ctx, id, 'enhance_ability', p, {}, { ability: options.includes(ctx.choice ?? '') ? ctx.choice : (options[0] ?? 'str') });
  },
  // Unwilling = a monster that isn't the caster (the UI can't tell yet); it gets the Con save.
  enlarge_reduce: (ctx, id, p) => {
    const c = ctx.creatures.get(id);
    if (!c) return;
    const mode = ctx.choice === 'reduce' ? 'reduce' : 'enlarge';
    const save = p?.unwillingSave as Ability | undefined;
    if (save && id !== ctx.source.id && c.kind === 'monster') {
      const res = savingThrow(c, save, { rng: ctx.rng, dc: ctx.saveDc ?? 10, ...saveModes(c, save), ...lang(ctx) });
      ctx.log.push({ targetId: id, kind: 'save', text: msg(ctx).m('turn.saveVs', { name: c.name, condition: mode, roll: res.text }) });
      if (res.success) return;
    }
    const opt = ((p?.options as Record<string, Record<string, unknown>> | undefined)?.[mode] ?? {}) as Record<string, unknown>;
    put(ctx, id, 'enlarge_reduce', p, {}, { mode, ...opt });
  },
  fly: (ctx, id, p) => put(ctx, id, 'fly', p),
  longstrider: (ctx, id, p) => put(ctx, id, 'longstrider', p),
  mirror_image: (ctx, id, p) => put(ctx, id, 'mirror_image', p, {}, { remaining: num(p, 'duplicates', 3) }),
  protection_from_energy: (ctx, id, p) => {
    const options = strs(p?.resistanceChoice);
    put(ctx, id, 'protection_from_energy', p, {}, { resistance: options.includes(ctx.choice ?? '') ? ctx.choice : (options[0] ?? 'fire') });
  },
  protection_from_evil_and_good: (ctx, id, p) => put(ctx, id, 'protection_from_evil_and_good', p),
  // SRD 5.2.1 Resistance: reduce damage of the chosen type by 1d4, once per turn.
  resistance: (ctx, id, p) => {
    const options = strs(p?.damageTypeChoice);
    put(ctx, id, 'resistance', p, {}, { damageType: options.includes(ctx.choice ?? '') ? ctx.choice : (options[0] ?? 'fire'), usedThisTurn: false });
  },
  // SRD 5.2.1 Guidance: +1d4 to every check with the chosen skill while it lasts (ctx.choice = skill id).
  guidance: (ctx, id, p) => put(ctx, id, 'guidance', p, {}, { skill: ctx.choice ?? 'perception' }),
  sanctuary: (ctx, id, p) => put(ctx, id, 'sanctuary', p, {}, { dc: ctx.saveDc ?? 10 }),
  stoneskin: (ctx, id, p) => put(ctx, id, 'stoneskin', p),
  // ctx.choice may name the weapon's inventory uid; otherwise the bonus applies to the target's weapon attacks.
  magic_weapon: (ctx, id, p) => {
    const table = p?.bonusBySlot as Record<string, number> | undefined;
    const bonus = table ? levelTableValue(table, ctx.slotLevel ?? 2) : num(p, 'bonus', 1);
    put(ctx, id, 'magic_weapon', p, {}, { appliedBonus: bonus || num(p, 'bonus', 1), ...(ctx.choice && { weaponUid: ctx.choice }) });
  },
  warding_bond: (ctx, id, p) => put(ctx, id, 'warding_bond', p, {}, { casterId: ctx.source.id }),
  death_ward: (ctx, id, p) => put(ctx, id, 'death_ward', p),
  beacon_of_hope: (ctx, id, p) => put(ctx, id, 'beacon_of_hope', p),
  spider_climb: (ctx, id, p) => put(ctx, id, 'spider_climb', p),
  see_invisibility: (ctx, id, p) => put(ctx, id, 'see_invisibility', p),
  darkvision: (ctx, id, p) => put(ctx, id, 'darkvision', p),
};

// ---------------------------------------------------------------- queries: healing, reactions, invisibility

/** Chill Touch: false while the creature can't regain HP. Healing code must check it before healing. */
export function canRegainHp(c: Creature): boolean {
  return !c.effects.some((e) => e.key === 'no_healing');
}

/** Shocking Grasp: false while the creature can't make Opportunity Attacks. */
export function canMakeOpportunityAttacks(c: Creature): boolean {
  return !c.effects.some((e) => e.key === 'no_opportunity_attacks');
}

/** Starry Wisp: the creature gains no benefit from the Invisible condition (attack modes should ignore it). */
export function invisibilityNegated(c: Creature): boolean {
  return c.effects.some((e) => e.key === 'starry_wisp');
}

/** See Invisibility: the creature sees Invisible creatures (pass as attackerSeesInvisible/targetSeesInvisible). */
export function seesInvisible(c: Creature): boolean {
  return c.effects.some((e) => e.key === 'see_invisibility');
}

/** Senses including spell effects (Darkvision spell: 150 ft). */
export function effectSenses(c: Creature): Creature['senses'] {
  const dv = Math.max(c.senses.darkvision ?? 0, ...eff(c, 'darkvision').map((e) => num(e.data, 'darkvisionFt', 150)));
  return { ...c.senses, ...(dv > 0 && { darkvision: dv }) };
}

// ---------------------------------------------------------------- queries: control

/** Banishment: the creature is off the battlefield (skip its turns, untargetable). */
export function isBanished(c: Creature): boolean {
  return c.effects.some((e) => e.key === 'banished');
}

/** Controlling effect data (Suggestion text, Fear dash-away, Dominate commands, Compulsion) for the AI/narrator. */
export function controlEffects(c: Creature): ActiveEffect[] {
  return c.effects.filter((e) => ['dominated', 'charm_person', 'charm_monster', 'fear', 'suggested', 'compelled'].includes(e.key));
}

/**
 * Charm Person/Monster and Suggestion end when the caster or its allies damage the creature.
 * Combat calls this with the caster id of each such effect when that side deals damage. Removes the
 * effect and the condition with the same source.
 */
export function endControlOnHarm<T extends Creature>(c: T, casterId: string): T {
  const ending = c.effects.filter((e) => e.data.endsOnDamage === true && e.data.casterId === casterId).map((e) => e.sourceId);
  if (ending.length === 0) return c;
  const without = removeEffects(c, (e) => ending.includes(e.sourceId));
  return { ...without, conditions: without.conditions.filter((x) => !ending.includes(x.sourceId)) };
}

/** Dominate X: a dominated creature repeats the Wis save each time it takes damage; success ends the spell on it. */
export function dominationDamageSave<T extends Creature>(c: T, rng: Rng, msgs?: Messages): { creature: T; save?: D20TestResult } {
  const dom = c.effects.find((e) => e.key === 'dominated' && e.data.repeatSaveOnDamage === true);
  if (!dom) return { creature: c };
  const save = savingThrow(c, 'wis', { rng, dc: num(dom.data, 'dc', 10), ...saveModes(c, 'wis'), ...(msgs && { msgs }) });
  if (!save.success) return { creature: c, save };
  const without = removeEffects(c, (e) => e.sourceId === dom.sourceId);
  return { creature: { ...without, conditions: without.conditions.filter((x) => x.sourceId !== dom.sourceId) }, save };
}

/**
 * End of the creature's turn: Fear's repeat Wis save only when the caster is out of line of sight
 * (`casterVisible(casterId)` from combat). Success ends frightened + the fear effect.
 */
export function endOfTurnSpellEffects3<T extends Creature>(c: T, rng: Rng, casterVisible: (casterId: string) => boolean, msgs: Messages = ENGLISH_MESSAGES): { creature: T; log: string[] } {
  let next = c;
  const log: string[] = [];
  for (const e of c.effects) {
    if (e.key !== 'fear' || casterVisible(String(e.data.casterId))) continue;
    const save = savingThrow(next, 'wis', { rng, dc: num(e.data, 'dc', 10), ...saveModes(next, 'wis'), msgs });
    if (save.success) {
      const without = removeEffects(next, (x) => x.sourceId === e.sourceId && x.key === 'fear');
      next = { ...without, conditions: without.conditions.filter((x) => !(x.condition === 'frightened' && x.sourceId === e.sourceId)) };
      log.push(msgs.m('hook.fearShaken', { name: c.name, roll: save.text }));
    } else log.push(msgs.m('hook.fearStill', { name: c.name, roll: save.text }));
  }
  return { creature: next, log };
}

// ---------------------------------------------------------------- queries: defense

/** Barkskin: AC can't be lower than this (0 = no floor). Combat uses max(effectiveAc(c), minAcFromEffects(c)) + extraAcFromEffects(c). */
export function minAcFromEffects(c: Creature): number {
  return Math.max(0, ...eff(c, 'barkskin').map((e) => num(e.data, 'minAc', 17)));
}

/** Flat AC bonuses not covered by spellHooks.effectiveAc (Warding Bond +1). */
export function extraAcFromEffects(c: Creature): number {
  return eff(c, 'warding_bond').reduce((s, e) => s + num(e.data, 'acBonus', 1), 0);
}

/** Damage types resisted from effects (Protection from Energy, Stoneskin). Pass as applyDamage extraResistances. */
export function effectResistances(c: Creature): DamageType[] {
  const out = new Set<DamageType>();
  for (const e of eff(c, 'protection_from_energy')) if (e.data.resistance) out.add(e.data.resistance as DamageType);
  for (const e of eff(c, 'stoneskin')) for (const t of strs(e.data.resistances)) out.add(t as DamageType);
  return [...out];
}

/** Warding Bond: resistance to all damage (pass as applyDamage resistAll). */
export function effectResistsAll(c: Creature): boolean {
  return eff(c, 'warding_bond').some((e) => e.data.resistAll === true);
}

/** Warding Bond: after the warded creature takes `amount` damage, each linked caster takes the same amount. */
export function wardingBondDamage(c: Creature, amount: number): { casterId: string; amount: number }[] {
  if (amount <= 0) return [];
  return eff(c, 'warding_bond').filter((e) => e.data.shareDamage === true && typeof e.data.casterId === 'string').map((e) => ({ casterId: e.data.casterId as string, amount }));
}

/**
 * Resistance cantrip: when the creature takes damage of the chosen type, reduce it by 1d4 once per
 * turn. Returns the reduction and the creature with the use marked. Call resetOncePerTurnEffects at each turn start.
 */
export function resistanceCantripReduction<T extends Creature>(c: T, type: DamageType, rng: Rng): { creature: T; reduction: number } {
  const e = c.effects.find((x) => x.key === 'resistance' && x.data.damageType === type && x.data.usedThisTurn !== true);
  if (!e) return { creature: c, reduction: 0 };
  const reduction = roll(String(e.data.reduceDice ?? '1d4'), rng).total;
  return { creature: { ...c, effects: c.effects.map((x) => (x === e ? { ...x, data: { ...x.data, usedThisTurn: true } } : x)) }, reduction };
}

/** Clears once-per-turn markers (Resistance). Call at the start of every turn. */
export function resetOncePerTurnEffects<T extends Creature>(c: T): T {
  if (!c.effects.some((e) => e.data.usedThisTurn === true)) return c;
  return { ...c, effects: c.effects.map((e) => (e.data.usedThisTurn === true ? { ...e, data: { ...e.data, usedThisTurn: false } } : e)) };
}

/**
 * Death Ward: call after damage is resolved (applyDamage + resolveDamageAtZero). If the creature
 * just dropped from >0 to 0 HP (or died from it), it stays at 1 HP instead and the ward ends.
 */
export function applyDeathWard<T extends Creature>(before: Creature, after: T): { creature: T; triggered: boolean } {
  const ward = after.effects.find((e) => e.key === 'death_ward');
  if (!ward || before.hp <= 0 || after.hp > 0) return { creature: after, triggered: false };
  const cleaned = removeEffects(after, (e) => e.id === ward.id);
  return { creature: { ...cleaned, hp: 1, dead: false, conditions: cleaned.conditions.filter((x) => x.condition !== 'unconscious') }, triggered: true };
}

/** Death Ward: an instant-death effect that deals no damage is negated (and ends the ward). */
export function negatesInstantDeath(c: Creature): boolean {
  return eff(c, 'death_ward').some((e) => e.data.negatesInstantDeath === true);
}

/**
 * Mirror Image: call when an attack roll hits the creature. Rolls 1d6 per remaining duplicate; any
 * roll ≥ redirectOn destroys a duplicate instead (the attack misses the creature). Attackers that are
 * Blinded or have Blindsight/Truesight ignore the duplicates.
 */
export function mirrorImageRedirect<T extends Creature>(target: T, attacker: Creature, rng: Rng): { creature: T; redirected: boolean } {
  const e = target.effects.find((x) => x.key === 'mirror_image' && num(x.data, 'remaining') > 0);
  if (!e) return { creature: target, redirected: false };
  const ignored = strs(e.data.ignoredBy);
  if (
    (ignored.includes('blinded') && attacker.conditions.some((x) => x.condition === 'blinded')) ||
    (ignored.includes('blindsight') && attacker.senses.blindsight) ||
    (ignored.includes('truesight') && attacker.senses.truesight)
  )
    return { creature: target, redirected: false };
  const remaining = num(e.data, 'remaining');
  let redirected = false;
  for (let i = 0; i < remaining; i++) if (roll(String(e.data.redirectDie ?? '1d6'), rng).total >= num(e.data, 'redirectOn', 3)) redirected = true;
  if (!redirected) return { creature: target, redirected };
  const left = remaining - 1;
  const effects = left > 0 ? target.effects.map((x) => (x === e ? { ...x, data: { ...x.data, remaining: left } } : x)) : target.effects.filter((x) => x !== e);
  return { creature: { ...target, effects }, redirected };
}

/**
 * Sanctuary: call when `attacker` targets the warded creature with an attack or a damaging spell.
 * The attacker makes a Wis save; on a failure it must choose another target or lose the attack.
 */
export function sanctuaryCheck(target: Creature, attacker: Creature, rng: Rng, msgs?: Messages): { allowed: boolean; save?: D20TestResult } {
  const e = eff(target, 'sanctuary')[0];
  if (!e || attacker.id === target.id) return { allowed: true };
  const ability = (e.data.save as Ability | undefined) ?? 'wis';
  const save = savingThrow(attacker, ability, { rng, dc: num(e.data, 'dc', 10), ...saveModes(attacker, ability), ...(msgs && { msgs }) });
  return { allowed: save.success === true, save };
}

/** Sanctuary ends when the warded creature makes an attack roll, casts a spell or deals damage. */
export function breakSanctuary<T extends Creature>(c: T): T {
  return removeEffects(c, (e) => e.key === 'sanctuary');
}

/** Protection from Evil and Good: the protected creature can't be Charmed/Frightened by a creature of a listed type. */
export function blocksConditionFrom(c: Creature, cond: Condition, source: Creature): boolean {
  return eff(c, 'protection_from_evil_and_good').some((e) => strs(e.data.creatureTypes).includes(source.creatureType) && strs(e.data.immuneConditionsFrom).includes(cond));
}

// ---------------------------------------------------------------- queries: rolls

/** Modes for attacks made AGAINST this creature from batch-3 effects (Protection from Evil and Good). */
export function attackedEffectModes3(target: Creature, attacker: Creature): { advantage: string[]; disadvantage: string[] } {
  const disadvantage = eff(target, 'protection_from_evil_and_good').some((e) => strs(e.data.creatureTypes).includes(attacker.creatureType)) ? ['Protection from Evil and Good'] : [];
  return { advantage: [], disadvantage };
}

/** Modes for the creature's OWN attack rolls (Vicious Mockery: Disadvantage, consumed by consumeAttackEffects). */
export function ownAttackEffectModes3(attacker: Creature): { advantage: string[]; disadvantage: string[] } {
  return { advantage: [], disadvantage: eff(attacker, 'vicious_mockery').length ? ['Vicious Mockery'] : [] };
}

/** Ability-check modes from effects (Enhance Ability; Enlarge: Str advantage; Reduce: Str disadvantage). */
export function effectCheckModes(c: Creature, ability: Ability): { advantage: string[]; disadvantage: string[] } {
  const advantage: string[] = [];
  const disadvantage: string[] = [];
  for (const e of eff(c, 'enhance_ability')) if (e.data.ability === ability && e.data.checkAdvantage !== false) advantage.push('Enhance Ability');
  if (ability === 'str') enlargeModes(c, advantage, disadvantage);
  return { advantage, disadvantage };
}

function enlargeModes(c: Creature, advantage: string[], disadvantage: string[]): void {
  for (const e of eff(c, 'enlarge_reduce')) {
    if (e.data.strAdvantage === true) advantage.push('Enlarge');
    if (e.data.strDisadvantage === true) disadvantage.push('Reduce');
  }
}

/** Ability-check bonus dice (Guidance on the chosen skill). */
export function effectCheckBonuses(c: Creature, skill: Skill | undefined, rng: Rng): Modifier[] {
  if (!skill) return [];
  return eff(c, 'guidance').filter((e) => e.data.skill === skill).map((e) => ({ value: roll(String(e.data.bonusDice ?? '1d4'), rng).total, label: 'Guidance' }));
}

/** Save modes and flat bonuses from batch-3 effects (Beacon of Hope Wis advantage, Enlarge/Reduce Str, Warding Bond +1). */
export function effectSaveAdjustments3(c: Creature, ability: Ability): { advantage: string[]; disadvantage: string[]; modifiers: Modifier[] } {
  const advantage: string[] = [];
  const disadvantage: string[] = [];
  if (ability === 'wis' && eff(c, 'beacon_of_hope').some((e) => e.data.wisSaveAdvantage === true)) advantage.push('Beacon of Hope');
  if (ability === 'str') enlargeModes(c, advantage, disadvantage);
  const modifiers = eff(c, 'warding_bond').map((e) => ({ value: num(e.data, 'saveBonus', 1), label: 'Warding Bond' }));
  return { advantage, disadvantage, modifiers };
}

/** Beacon of Hope: Advantage on Death Saving Throws. */
export function deathSaveAdvantage(c: Creature): boolean {
  return eff(c, 'beacon_of_hope').some((e) => e.data.deathSaveAdvantage === true);
}

/** Beacon of Hope: healing dice count as their maximum (pass as maxHealDice). */
export function maxHealingFromEffects(c: Creature): boolean {
  return eff(c, 'beacon_of_hope').some((e) => e.data.maxHealing === true);
}

// ---------------------------------------------------------------- queries: movement and size

/** Speeds with effects: Longstrider +10 walk, Fly (fly speed + hover), Spider Climb (climb = walk). Feed .walk into effectiveSpeed(c, table, base). */
export function effectSpeeds(c: Creature): Speed {
  const bonus = eff(c, 'longstrider').reduce((s, e) => s + num(e.data, 'speedBonusFt', 10), 0);
  const speed: Speed = { ...c.speed, walk: c.speed.walk + bonus };
  for (const e of eff(c, 'fly')) {
    speed.fly = Math.max(speed.fly ?? 0, num(e.data, 'flySpeedFt', 60));
    if (e.data.hover === true) speed.hover = true;
  }
  if (eff(c, 'spider_climb').length) speed.climb = Math.max(speed.climb ?? 0, speed.walk);
  return speed;
}

/** Size after Enlarge/Reduce (one step, clamped). */
export function effectiveSize(c: Creature): Size {
  const steps = eff(c, 'enlarge_reduce').reduce((s, e) => s + num(e.data, 'sizeSteps'), 0);
  const i = Math.min(SIZES.length - 1, Math.max(0, SIZES.indexOf(c.size) + steps));
  return SIZES[i]!;
}

// ---------------------------------------------------------------- queries: weapon attacks

export interface WeaponEffectMods {
  /** Flat attack bonus (Magic Weapon). */
  attackBonus: number;
  /** Flat damage bonus (Magic Weapon). */
  damageBonus: number;
  /** Use this ability modifier for attack and damage instead of Str/Dex (Shillelagh, True Strike). */
  spellMod?: number;
  /** Replace the weapon damage die (Shillelagh). */
  damageDie?: string;
  /** Change the weapon damage type (Shillelagh force, True Strike radiant). */
  damageType?: DamageType;
  /** Dice added (Enlarge +1d4) or subtracted (Reduce −1d4) in the weapon's damage type. */
  extraDice: string[];
  penaltyDice: string[];
  /** Extra typed damage (True Strike radiant). */
  extraDamage: Damage[];
}

/**
 * Everything batch-3 effects change about the attacker's next weapon attack. `weaponId` is the base
 * weapon (Shillelagh needs club/quarterstaff); `weaponUid` the inventory item (Magic Weapon).
 * True Strike is consumed by consumeAttackEffects (consumeOn own_attack).
 */
export function weaponEffectMods(attacker: Creature, weaponId?: string, weaponUid?: string): WeaponEffectMods {
  const out: WeaponEffectMods = { attackBonus: 0, damageBonus: 0, extraDice: [], penaltyDice: [], extraDamage: [] };
  for (const e of eff(attacker, 'magic_weapon')) {
    if (e.data.weaponUid && weaponUid && e.data.weaponUid !== weaponUid) continue;
    const b = num(e.data, 'appliedBonus', 1);
    out.attackBonus = Math.max(out.attackBonus, b);
    out.damageBonus = Math.max(out.damageBonus, b);
  }
  for (const e of eff(attacker, 'shillelagh')) {
    if (weaponId && !strs(e.data.weapons).includes(weaponId)) continue;
    out.spellMod = num(e.data, 'spellMod');
    if (typeof e.data.damageDie === 'string') out.damageDie = e.data.damageDie;
    if (e.data.forceDamage === true) out.damageType = 'force';
  }
  for (const e of eff(attacker, 'true_strike')) {
    out.spellMod = num(e.data, 'spellMod');
    if (e.data.radiant === true) out.damageType = 'radiant';
    if (typeof e.data.extraRadiant === 'string') out.extraDamage.push({ dice: e.data.extraRadiant, type: 'radiant' });
  }
  for (const e of eff(attacker, 'enlarge_reduce')) {
    if (typeof e.data.extraDamage === 'string') out.extraDice.push(e.data.extraDamage);
    if (typeof e.data.damagePenalty === 'string') out.penaltyDice.push(e.data.damagePenalty);
  }
  return out;
}
