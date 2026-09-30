/**
 * The combat attack pipeline (Build Prompt §10; SRD 5.2.1 "Making an Attack", "Range", "Ranged
 * Attacks in Close Combat", "Cover", "Opportunity Attacks", Attack [Action], Unarmed Strike,
 * weapon Mastery properties, Light / Heavy weapon properties).
 *
 * `resolveAttack` does one attack roll end to end:
 * 1. Validity: both alive, Charmed can't target its charmer, melee needs reach; ranged beyond long
 *    range is impossible, beyond normal range → Disadvantage; Total Cover / no line → can't target.
 * 2. Economy: 'action' starts the Attack action (spends the action, attacks = Extra Attack count or
 *    the stat block's Multiattack size) or uses up one attack left; 'opportunity'/'reaction' spend the
 *    Reaction; 'light_bonus' spends the Bonus Action; 'nick' (Nick mastery, once per turn, inside the
 *    Attack action) and 'cleave' (Cleave mastery, once per turn) cost nothing; 'free' = caller-managed.
 * 3. Roll modes: conditions (attackModes), attacker/target effects (Vex, Sap, Faerie Fire, Blur…),
 *    class features, Dodge, Help, Heavy weapon without the score, long range, a hostile within 5 ft
 *    that can see the attacker and isn't Incapacitated (ranged only).
 * 4. AC = max(effectiveAc, minAcFromEffects) + extraAcFromEffects + cover bonus; crit range from
 *    features; Sanctuary save first; Mirror Image redirect on a hit.
 * 5. Damage: weapon dice (+ riders: Hex, Hunter's Mark, Divine Favor, Bestow Curse, feature riders
 *    like Sneak Attack/Rage), crits double dice, defenses incl. effect resistances, Resistance
 *    cantrip, 0 HP, Death Ward, Warding Bond, concentration, domination save, charm ending.
 * 6. Mastery (only if the character has it): Graze on a miss; Cleave (returns `cleaveAvailable`),
 *    Push (moves the target), Sap, Slow, Topple, Vex on a hit.
 */
import type { ScarMark } from '../character/scars';
import type { Character, Creature } from '../core/creature';
import type { Modifier } from '../core/dice';
import { roll } from '../core/dice';
import type { Damage } from '../data/common';
import type { SrdDatabase } from '../data/srd';
import { equipped, unarmedStrike, weaponAttack, type WeaponAttack } from '../character/derived';
import { critOn as featureCritOn, featureAttackModes, featureAttackedModes, featureResistances, featureWeaponAttack, weaponHitRiders } from '../character/features';
import { attacksPerAction } from '../character/multiclass';
import { SIZES, abilityModifier, type Ability } from '../rules/basics';
import { addEffect, attackEffectModes, consumeAttackEffects, removeEffects } from '../rules/activeEffects';
import { attackModes, canAct, hasCondition, mayHarm, resistsAllDamage } from '../rules/conditions';
import { applyDamage, attackRoll, rollDamage, type AttackRollResult, type DamageInstance } from '../rules/damage';
import { resolveDamageAtZero } from '../rules/death';
import { createEffectContext } from '../rules/effects';
import { applyMasteryOnHit, cleaveDamageModifier, grazeDamage, type Mastery } from '../rules/mastery';
import { actionRiders, multiattackSequence } from '../rules/monsters';
import { applyActionRiders } from './saves';
import { concentrationCheck } from '../rules/spellcasting';
import { attackedEffectModes, breakInvisibility, consumeAttackedEffects, effectDamageRiders, effectiveAc, rollEffectBonuses } from '../rules/spellHooks';
import { curseDamageRider } from '../rules/spellHooks2';
import {
  applyDeathWard,
  attackedEffectModes3,
  breakSanctuary,
  dominationDamageSave,
  effectResistances,
  effectResistsAll,
  endControlOnHarm,
  extraAcFromEffects,
  invisibilityNegated,
  minAcFromEffects,
  mirrorImageRedirect,
  ownAttackEffectModes3,
  resistanceCantripReduction,
  sanctuaryCheck,
  seesInvisible,
  wardingBondDamage,
  weaponEffectMods,
} from '../rules/spellHooks3';
import { breakHiding, consumeHelpAttack, dodgeActive, hasOncePerTurnMarker, helpAttackSource } from './actionEffects';
import { areHostile, cloneGridTokens, dbOf, fail, msgsOf, withCreature, type ActionResult, type CombatContext, type CombatEvent, type CombatState } from './combatState';
import { distanceFt, footprintSize, moveToken, type Grid } from './grid';
import { computeCover, hasLineOfSight } from './los';
import { planMove } from './movement';
import { budgetOf, currentId, setAttacksLeft, spend, type TurnState } from './turns';

// ---------------------------------------------------------------- attack profiles

export interface AttackProfile {
  /** 'weapon:<uid>:melee' | 'weapon:<uid>:ranged' | 'unarmed' | 'monster:<action name>[:ranged]'. */
  id: string;
  name: string;
  melee: boolean;
  ability?: Ability;
  /** Ability modifier used for the attack roll (Graze, Topple DC, Light/Cleave damage). */
  abilityMod: number;
  toHit: Modifier[];
  damage: Damage[];
  damageModifiers: Modifier[];
  reach: number;
  range?: { normal: number; long?: number };
  mastery?: Mastery;
  properties: string[];
  weaponId?: string;
  uid?: string;
  /** A weapon or Unarmed Strike (false for natural monster attacks is not needed: they count as weapons). */
  unarmed?: boolean;
  /** The character weapon profile (for feature hit riders). */
  source?: WeaponAttack;
}

const isCharacter = (c: Creature): c is Character => c.kind === 'character' && 'classes' in c;

function fromWeaponAttack(id: string, w: WeaponAttack, melee: boolean, twoHanded: boolean): AttackProfile {
  const damage = twoHanded && w.versatileDice ? [{ ...w.damage[0]!, dice: w.versatileDice }, ...w.damage.slice(1)] : w.damage;
  return {
    id,
    name: w.name,
    melee,
    ability: w.ability,
    abilityMod: w.toHitBreakdown[0]?.value ?? 0,
    toHit: w.toHitBreakdown,
    damage,
    damageModifiers: w.damageModifiers,
    reach: w.reach,
    ...(!melee && w.range && { range: w.range }),
    ...(w.mastery && { mastery: w.mastery }),
    properties: [...w.properties],
    weaponId: w.weaponId,
    uid: w.uid,
    ...(w.uid === 'unarmed' && { unarmed: true }),
    source: w,
  };
}

/** A character's attack with an inventory weapon (uid) or 'unarmed', with feature adjustments. */
export function characterAttackProfile(
  c: Character,
  db: SrdDatabase,
  which: string,
  opts: { mode?: 'melee' | 'ranged'; twoHanded?: boolean } = {},
): AttackProfile | undefined {
  if (which === 'unarmed') return fromWeaponAttack('unarmed', featureWeaponAttack(c, db, unarmedStrike(c)), true, false);
  const item = c.inventory.find((i) => i.uid === which);
  if (!item) return undefined;
  const w = db.weapons.get(item.itemId);
  if (!w) return undefined;
  const mode = opts.mode ?? (w.kind === 'ranged' ? 'ranged' : 'melee');
  if (mode === 'ranged' && w.kind === 'melee' && !w.properties.includes('thrown')) return undefined;
  const base = weaponAttack(c, db, item, mode);
  if (!base) return undefined;
  const melee = w.kind === 'melee' && mode === 'melee';
  return fromWeaponAttack(`weapon:${item.uid}:${melee ? 'melee' : 'ranged'}`, featureWeaponAttack(c, db, base), melee, opts.twoHanded ?? false);
}

/** A monster stat-block attack action. `melee_or_ranged` actions pick the mode. */
export function monsterAttackProfile(c: Creature, db: SrdDatabase, actionName: string, mode?: 'melee' | 'ranged'): AttackProfile | undefined {
  const m = c.statBlockId ? db.monsters.get(c.statBlockId) : undefined;
  const a = m?.actions.find((x) => x.name === actionName) ?? m?.bonusActions.find((x) => x.name === actionName);
  if (!a?.attack) return undefined;
  const melee = a.attack.kind === 'melee' || (a.attack.kind === 'melee_or_ranged' && mode !== 'ranged');
  const ability: Ability = melee ? 'str' : 'dex';
  return {
    id: `monster:${a.name}${!melee && a.attack.kind === 'melee_or_ranged' ? ':ranged' : ''}`,
    name: a.name,
    melee,
    ability,
    abilityMod: abilityModifier(c.abilities[ability]),
    toHit: [{ value: a.attack.bonus, label: a.name }],
    damage: a.attack.damage,
    damageModifiers: [],
    reach: a.attack.reach ?? 5,
    ...(!melee && a.attack.range && { range: { normal: a.attack.range.normal, ...(a.attack.range.long && { long: a.attack.range.long }) } }),
    properties: [],
  };
}

/** Every attack a creature can make now: equipped weapons (melee + thrown), Unarmed Strike, stat-block attacks. */
export function attackProfiles(c: Creature, db: SrdDatabase): AttackProfile[] {
  const out: AttackProfile[] = [];
  if (isCharacter(c)) {
    for (const item of [...equipped(c, 'main_hand'), ...equipped(c, 'off_hand')]) {
      const w = db.weapons.get(item.itemId);
      if (!w) continue;
      const main = characterAttackProfile(c, db, item.uid);
      if (main) out.push(main);
      if (w.kind === 'melee' && w.properties.includes('thrown')) {
        const thrown = characterAttackProfile(c, db, item.uid, { mode: 'ranged' });
        if (thrown) out.push(thrown);
      }
    }
    const unarmed = characterAttackProfile(c, db, 'unarmed');
    if (unarmed) out.push(unarmed);
    return out;
  }
  const m = c.statBlockId ? db.monsters.get(c.statBlockId) : undefined;
  for (const a of m?.actions ?? []) {
    if (!a.attack) continue;
    const p = monsterAttackProfile(c, db, a.name, 'melee');
    if (p) out.push(p);
    if (a.attack.kind === 'melee_or_ranged') {
      const r = monsterAttackProfile(c, db, a.name, 'ranged');
      if (r) out.push(r);
    }
  }
  return out;
}

/**
 * Resolve a profile id (or pass-through a profile). Default: first melee profile, else the first one.
 * 'weapon:<uid>:<mode>' works for any carried weapon (equipping one is part of the Attack action).
 */
export function findProfile(c: Creature, db: SrdDatabase, which?: AttackProfile | string, opts: { twoHanded?: boolean } = {}): AttackProfile | undefined {
  if (which && typeof which !== 'string') return which;
  const w = which ? /^weapon:(.+):(melee|ranged)$/.exec(which) : null;
  if (w && isCharacter(c)) return characterAttackProfile(c, db, w[1]!, { mode: w[2] as 'melee' | 'ranged', ...(opts.twoHanded && { twoHanded: true }) });
  if (which === 'unarmed' && isCharacter(c)) return characterAttackProfile(c, db, 'unarmed');
  const all = attackProfiles(c, db);
  if (which === undefined) return all.find((p) => p.melee) ?? all[0];
  return all.find((p) => p.id === which);
}

/** Longest melee reach among the creature's attacks (Opportunity Attack reach). 0 = no melee attack. */
export function meleeReach(c: Creature, db: SrdDatabase): number {
  return Math.max(0, ...attackProfiles(c, db).filter((p) => p.melee).map((p) => p.reach));
}

// ---------------------------------------------------------------- perception helpers

/** Can `viewer` see `target`: not Blinded (without Blindsight), target not unseen-Invisible, a clear line. */
export function canSee(state: CombatState, ctx: CombatContext, viewer: Creature, target: Creature): boolean {
  if (hasCondition(viewer, 'blinded', ctx.table) && !viewer.senses.blindsight) return false;
  if (hasCondition(target, 'invisible', ctx.table) && !invisibilityNegated(target) && !seesInvisible(viewer) && !viewer.senses.truesight) return false;
  if (state.grid.tokens[viewer.id] && state.grid.tokens[target.id]) return hasLineOfSight(state.grid, viewer.id, target.id);
  return true;
}

/** Target AC for an attack: max(effectiveAc, minAcFromEffects) + extraAcFromEffects (cover added separately). */
export function targetAc(target: Creature): number {
  const wearingArmor = isCharacter(target) && equipped(target, 'armor').length > 0;
  return Math.max(effectiveAc(target, wearingArmor), minAcFromEffects(target)) + extraAcFromEffects(target);
}

// ---------------------------------------------------------------- validity and modes

export interface AttackCheck {
  ok: boolean;
  error?: string;
  distanceFt: number;
  coverBonus: number;
  cover: string;
  advantage: string[];
  disadvantage: string[];
  autoCrit?: string;
  ac: number;
  /** Helper whose Help action grants this attack Advantage. */
  helperId?: string;
}

/**
 * Everything decided before the d20 is rolled: can the attack be made, the target's AC with cover,
 * and all Advantage/Disadvantage sources. Pure (no rolls) so the UI/AI can preview an attack.
 */
export function checkAttack(state: CombatState, ctx: CombatContext, attackerId: string, targetId: string, profile: AttackProfile): AttackCheck {
  const db = dbOf(ctx);
  const attacker = state.creatures[attackerId];
  const target = state.creatures[targetId];
  const at = state.grid.tokens[attackerId];
  const tt = state.grid.tokens[targetId];
  const bad = (error: string): AttackCheck => ({ ok: false, error, distanceFt: 0, coverBonus: 0, cover: 'none', advantage: [], disadvantage: [], ac: 0 });
  if (!attacker || !target) return bad('Unknown creature');
  if (!at || !tt) return bad('Both creatures must be on the battle map');
  if (attackerId === targetId) return bad("Can't attack yourself");
  if (target.dead) return bad(`${target.name} is dead`);
  if (!mayHarm(attacker, targetId, ctx.table)) return bad(`${attacker.name} is Charmed by ${target.name}`);

  const dist = distanceFt(at, tt);
  const advantage: string[] = [];
  const disadvantage: string[] = [];
  if (profile.melee) {
    if (dist > profile.reach) return bad(`${target.name} is out of reach (${dist} ft > ${profile.reach} ft)`);
  } else {
    const normal = profile.range?.normal ?? 5;
    const long = profile.range?.long ?? normal;
    if (dist > long) return bad(`${target.name} is out of range (${dist} ft > ${long} ft)`);
    if (dist > normal) disadvantage.push('Long range');
    const threat = Object.values(state.grid.tokens).find((t) => {
      if (t.id === attackerId) return false;
      const c = state.creatures[t.id];
      return (
        !!c &&
        !c.dead &&
        c.hp > 0 &&
        areHostile(state, ctx, attackerId, t.id) &&
        distanceFt(at, t) <= 5 &&
        canAct(c, ctx.table) &&
        canSee(state, ctx, c, attacker)
      );
    });
    if (threat) disadvantage.push(`Enemy within 5 ft (${state.creatures[threat.id]?.name ?? threat.id})`);
  }

  const cover = computeCover(state.grid, attackerId, targetId);
  if (!cover.los) return bad(`${target.name} has Total Cover`);

  const modes = attackModes(
    {
      attacker,
      target,
      distanceFt: dist,
      attackerSeesInvisible: seesInvisible(attacker) || !!attacker.senses.truesight || invisibilityNegated(target),
      targetSeesInvisible: seesInvisible(target) || !!target.senses.truesight || invisibilityNegated(attacker),
    },
    ctx.table,
  );
  advantage.push(...modes.advantage);
  disadvantage.push(...modes.disadvantage);
  for (const m of [attackEffectModes(attacker, targetId), attackedEffectModes(target, attacker), attackedEffectModes3(target, attacker), ownAttackEffectModes3(attacker)]) {
    advantage.push(...m.advantage);
    disadvantage.push(...m.disadvantage);
  }
  if (isCharacter(attacker) && profile.ability) {
    const f = featureAttackModes(attacker, db, { melee: profile.melee, ability: profile.ability });
    advantage.push(...f.advantage);
    disadvantage.push(...f.disadvantage);
    if (profile.properties.includes('heavy')) {
      const score = profile.melee ? attacker.abilities.str : attacker.abilities.dex;
      if (score < 13) disadvantage.push(`Heavy weapon (${profile.melee ? 'Str' : 'Dex'} < 13)`);
    }
  }
  if (isCharacter(target)) {
    const f = featureAttackedModes(target, db, profile.melee);
    advantage.push(...f.advantage);
    disadvantage.push(...f.disadvantage);
  }
  if (dodgeActive(target, ctx.table) && canSee(state, ctx, target, attacker)) disadvantage.push('Dodge');
  const helperId = helpAttackSource(target, (h) => h !== attackerId && !areHostile(state, ctx, attackerId, h));
  if (helperId) advantage.push(`Help (${state.creatures[helperId]?.name ?? helperId})`);

  return {
    ok: true,
    distanceFt: dist,
    coverBonus: cover.acBonus,
    cover: cover.cover,
    advantage,
    disadvantage,
    ...(modes.autoCrit && { autoCrit: modes.autoCrit }),
    ac: targetAc(target) + cover.acBonus,
    ...(helperId && { helperId }),
  };
}

// ---------------------------------------------------------------- action economy

export type AttackKind = 'action' | 'opportunity' | 'reaction' | 'light_bonus' | 'nick' | 'cleave' | 'free';

/** Attacks per Attack action: Extra Attack for characters, the Multiattack size for stat blocks. */
export function attacksPerActionOf(c: Creature, db: SrdDatabase): number {
  if (isCharacter(c)) return attacksPerAction(c);
  const m = c.statBlockId ? db.monsters.get(c.statBlockId) : undefined;
  return m ? Math.max(1, multiattackSequence(m).length) : 1;
}

const onOwnTurn = (turns: TurnState, id: string): boolean => currentId(turns) === id && turns.turnActive;

/**
 * Pay for one attack (see module doc). Unarmed Strike Grapple/Shove use this too, since they
 * replace an attack. Returns the new turn state or an error.
 */
export function spendAttack(
  turns: TurnState,
  ctx: CombatContext,
  attacker: Creature,
  kind: AttackKind,
  profile?: AttackProfile,
): { ok: true; turns: TurnState; attacker: Creature } | { ok: false; error: string } {
  const db = dbOf(ctx);
  switch (kind) {
    case 'free':
      return { ok: true, turns, attacker };
    case 'opportunity':
    case 'reaction': {
      const r = spend(turns, attacker.id, 'reaction', attacker, ctx.table);
      return r.ok ? { ok: true, turns: r.state, attacker } : { ok: false, error: r.error };
    }
    case 'light_bonus': {
      if (profile && !profile.properties.includes('light')) return { ok: false, error: `${profile.name} isn't a Light weapon` };
      const needs = lightExtraAttackError(attacker, profile);
      if (needs) return { ok: false, error: needs };
      const r = spend(turns, attacker.id, 'bonusAction', attacker, ctx.table);
      return r.ok ? { ok: true, turns: r.state, attacker } : { ok: false, error: r.error };
    }
    case 'nick': {
      if (!onOwnTurn(turns, attacker.id)) return { ok: false, error: `It isn't ${attacker.id}'s turn` };
      if (!profile || profile.mastery !== 'nick' || !profile.properties.includes('light')) return { ok: false, error: 'Nick needs a Light weapon with the Nick mastery' };
      const needs = lightExtraAttackError(attacker, profile);
      if (needs) return { ok: false, error: needs };
      if (budgetOf(turns, attacker.id).action) return { ok: false, error: 'Nick attacks are part of the Attack action' };
      if (hasOncePerTurnMarker(attacker, 'nick_used')) return { ok: false, error: 'Nick already used this turn' };
      const marked = addEffect(attacker, { key: 'nick_used', sourceId: attacker.id, expires: { on: 'end_of_turn', creatureId: attacker.id, skip: 0 } });
      return { ok: true, turns, attacker: marked };
    }
    case 'cleave': {
      if (hasOncePerTurnMarker(attacker, 'cleave_used')) return { ok: false, error: 'Cleave already used this turn' };
      const endsOn = currentId(turns) ?? attacker.id;
      const marked = addEffect(attacker, { key: 'cleave_used', sourceId: attacker.id, expires: { on: 'end_of_turn', creatureId: endsOn, skip: 0 } });
      return { ok: true, turns, attacker: marked };
    }
    case 'action': {
      const left = turns.budgets[attacker.id]?.attacksLeft ?? 0;
      if (left > 0 && onOwnTurn(turns, attacker.id)) {
        if (!canAct(attacker, ctx.table)) return { ok: false, error: `${attacker.name} can't act (Incapacitated)` };
        return { ok: true, turns: setAttacksLeft(turns, attacker.id, left - 1), attacker: markLightAttack(attacker, profile) };
      }
      const r = spend(turns, attacker.id, 'action', attacker, ctx.table);
      if (!r.ok) return { ok: false, error: r.error };
      return { ok: true, turns: setAttacksLeft(r.state, attacker.id, attacksPerActionOf(attacker, db) - 1), attacker: markLightAttack(attacker, profile) };
    }
  }
}

const weaponKey = (p: AttackProfile): string => p.uid ?? p.id;

/** Light property: attacking with a Light weapon as part of the Attack action enables the extra attack. */
function markLightAttack(attacker: Creature, profile: AttackProfile | undefined): Creature {
  if (!profile?.properties.includes('light') || attacker.effects.some((e) => e.key === 'light_attacked')) return attacker;
  return addEffect(attacker, {
    key: 'light_attacked',
    sourceId: attacker.id,
    data: { weapon: weaponKey(profile) },
    expires: { on: 'end_of_turn', creatureId: attacker.id, skip: 0 },
  });
}

/** The Light extra attack needs a prior Attack with a Light weapon this turn, made with a different weapon. */
function lightExtraAttackError(attacker: Creature, profile: AttackProfile | undefined): string | undefined {
  const mark = attacker.effects.find((e) => e.key === 'light_attacked');
  if (!mark) return 'The Light extra attack needs an Attack with a Light weapon first this turn';
  if (profile && mark.data.weapon === weaponKey(profile)) return 'The Light extra attack must use a different Light weapon';
  return undefined;
}

// ---------------------------------------------------------------- damage

export interface DamageOutcome {
  state: CombatState;
  events: CombatEvent[];
  /** Damage after defenses (before temp HP). */
  dealt: number;
}

/**
 * Apply damage instances from `sourceId` to `targetId` with every defense and aftermath rule:
 * resistances (own, conditions, effects, features), the Resistance cantrip, 0 HP / death,
 * Death Ward, Warding Bond, concentration saves, Dominate repeat saves and charm-ending.
 */
export function dealCombatDamage(
  state: CombatState,
  ctx: CombatContext,
  sourceId: string,
  targetId: string,
  instances: DamageInstance[],
  opts: { crit?: boolean; text?: string; weapon?: string } = {},
): DamageOutcome {
  const events: CombatEvent[] = [];
  const found = state.creatures[targetId];
  if (!found || found.dead) return { state, events, dealt: 0 };
  let target: Creature = found;
  const db = dbOf(ctx);
  const reduced: DamageInstance[] = [];
  for (const inst of instances) {
    const r = resistanceCantripReduction(target, inst.type, ctx.rng);
    target = r.creature;
    reduced.push(r.reduction > 0 ? { ...inst, amount: Math.max(0, inst.amount - r.reduction) } : inst);
    if (r.reduction > 0) events.push({ kind: 'effect', targetId, text: `Resistance reduces the ${inst.type} damage by ${r.reduction}` });
  }
  const before = target;
  const extra = [...effectResistances(target), ...(isCharacter(target) ? featureResistances(target, db) : [])];
  const { creature, report } = applyDamage(target, reduced, { resistAll: resistsAllDamage(target, ctx.table) || effectResistsAll(target), extraResistances: extra });
  const zero = resolveDamageAtZero(before, creature, report, { ...(opts.crit && { crit: true }) });
  const warded = applyDeathWard(before, zero.creature);
  let after = warded.creature;
  const notes = report.adjusted.filter((a) => a.note).map((a) => `${a.type} ${a.note}`);
  const { m } = msgsOf(ctx);
  const fate = warded.triggered ? ` — ${m('combat.deathWard')}` : zero.event === 'died' ? ` — ${m('combat.dies')}` : zero.event === 'unconscious' ? ` — ${m('combat.fallsUnconscious')}` : '';
  events.push({
    kind: 'damage',
    actorId: sourceId,
    targetId,
    text: `${m('combat.takes', { name: before.name, n: report.totalAfterDefenses })}${opts.text ? ` — ${opts.text}` : ''}${notes.length ? ` [${notes.join(', ')}]` : ''}${fate}`,
  });
  if (report.totalAfterDefenses > 0) {
    after = endControlOnHarm(after, sourceId);
    const dom = dominationDamageSave(after, ctx.rng);
    after = dom.creature;
    if (dom.save) events.push({ kind: 'save', targetId, text: `${after.name} fights the domination: ${dom.save.text}` });
  }
  let next = withCreature(state, after);

  // Armor wear: hits from attacks on characters (character/armorWear.ts).
  if (isCharacter(after) && report.totalAfterDefenses > 0 && opts.weapon && sourceId !== targetId) {
    const prev = next.armorHits?.[targetId] ?? { hits: 0, crits: 0 };
    next = { ...next, armorHits: { ...(next.armorHits ?? {}), [targetId]: { hits: prev.hits + 1, crits: prev.crits + (opts.crit ? 1 : 0) } } };
  }

  // Dramatic moments for permanent scars (character/scars.ts): a crit taken or dropping to 0 HP.
  if (isCharacter(after) && report.totalAfterDefenses > 0 && (opts.crit || zero.event === 'unconscious' || zero.event === 'died')) {
    const source = state.creatures[sourceId];
    const mark: ScarMark = {
      targetId,
      cause: zero.event === 'unconscious' || zero.event === 'died' ? 'down' : 'crit',
      sourceName: source?.name ?? 'foe',
      ...(opts.weapon && { weapon: opts.weapon }),
      ...(instances[0] && { damageType: instances[0].type }),
    };
    next = { ...next, scarMarks: [...(next.scarMarks ?? []), mark] };
  }

  if (report.totalAfterDefenses > 0) {
    for (const share of wardingBondDamage(before, report.totalAfterDefenses)) {
      const caster = next.creatures[share.casterId];
      if (!caster || caster.dead) continue;
      const shared = dealCombatDamage(next, ctx, targetId, share.casterId, [{ amount: share.amount, type: 'force' }], { text: 'Warding Bond' });
      next = shared.state;
      events.push(...shared.events);
    }
    const hit = next.creatures[targetId] as Creature;
    if (isCharacter(hit) && hit.spellcasting?.concentration) {
      const ectx = createEffectContext({ rng: ctx.rng, ...(ctx.msgs && { msgs: ctx.msgs }), source: hit, targets: Object.values(next.creatures) });
      concentrationCheck(ectx, targetId, report.totalAfterDefenses, ctx.rng);
      next = { ...next, creatures: Object.fromEntries(ectx.creatures) };
      for (const l of ectx.log) events.push({ kind: l.kind === 'save' ? 'save' : 'info', targetId, text: l.text });
    }
  }
  return { state: next, events, dealt: report.totalAfterDefenses };
}

// ---------------------------------------------------------------- forced movement

/**
 * Push `targetId` up to `feet` straight away from `fromId` (square by square, stopping at the first
 * blocked square). Returns the new grid (copied) and the distance moved. Forced movement never
 * provokes Opportunity Attacks.
 */
export function pushAway(grid: Grid, fromId: string, targetId: string, feet: number): { grid: Grid; movedFt: number } {
  const from = grid.tokens[fromId];
  const t = grid.tokens[targetId];
  if (!from || !t || feet < 5) return { grid, movedFt: 0 };
  const cx = (x: number, size: typeof t.size) => 2 * x + footprintSize(size);
  const dx = Math.sign(cx(t.x, t.size) - cx(from.x, from.size));
  const dy = Math.sign(cx(t.y, t.size) - cx(from.y, from.size));
  if (dx === 0 && dy === 0) return { grid, movedFt: 0 };
  const g = cloneGridTokens(grid);
  let moved = 0;
  for (let i = 0; i < Math.floor(feet / 5); i++) {
    const cur = g.tokens[targetId]!;
    const next = { x: cur.x + dx, y: cur.y + dy };
    if (!planMove(g, targetId, [next], { budgetFt: 0, forced: true }).ok) break;
    moveToken(g, targetId, next);
    moved += 5;
  }
  return { grid: moved > 0 ? g : grid, movedFt: moved };
}

// ---------------------------------------------------------------- the attack

export interface AttackOptions {
  attackerId: string;
  targetId: string;
  /** Profile or profile id (see attackProfiles). Default: the attacker's first melee attack. */
  profile?: AttackProfile | string;
  kind?: AttackKind;
  /** Use the weapon's mastery property when it is optional (Push/Topple/Slow). Default true. */
  useMastery?: boolean;
  /** Push mastery distance (0–10 ft, default 10). */
  pushFt?: number;
  /** Cleave: the creature hit by the first attack (the second target must be within 5 ft of it). */
  cleaveFromId?: string;
  /** Versatile weapon used with two hands (when resolving a profile id). */
  twoHanded?: boolean;
  /** Extra Advantage/Disadvantage sources from the caller (e.g. Reckless Attack UI toggles). */
  advantage?: string[];
  disadvantage?: string[];
}

export interface AttackOutcome {
  hit: boolean;
  crit: boolean;
  /** Damage dealt to the target after defenses. */
  damage: number;
  roll?: AttackRollResult;
  /** A Cleave follow-up attack is available (call again with kind 'cleave'). */
  cleaveAvailable?: boolean;
  /** Attacks left in the current Attack action. */
  attacksLeft: number;
}

function turnStamp(turns: TurnState): string {
  return `${turns.round}:${turns.currentIndex}`;
}

/** One attack roll (weapon, Unarmed Strike damage option, or stat-block attack) with everything around it. */
export function resolveAttack(state: CombatState, ctx: CombatContext, o: AttackOptions): ActionResult<AttackOutcome> {
  const db = dbOf(ctx);
  const kind = o.kind ?? 'action';
  let attacker = state.creatures[o.attackerId];
  let target = state.creatures[o.targetId];
  if (!attacker || !target) return fail(state, 'Unknown creature');
  const profile = findProfile(attacker, db, o.profile, { ...(o.twoHanded && { twoHanded: true }) });
  if (!profile) return fail(state, `${attacker.name} has no such attack`);
  if (kind === 'opportunity' && !profile.melee) return fail(state, 'Opportunity Attacks are melee attacks');
  if (kind === 'cleave') {
    const first = o.cleaveFromId ? state.grid.tokens[o.cleaveFromId] : undefined;
    const second = state.grid.tokens[o.targetId];
    if (profile.mastery !== 'cleave' || !profile.melee) return fail(state, 'Cleave needs a melee weapon with the Cleave mastery');
    if (!first || !second || o.cleaveFromId === o.targetId || distanceFt(first, second) > 5) return fail(state, 'The second target must be within 5 ft of the first');
  }

  const check = checkAttack(state, ctx, o.attackerId, o.targetId, profile);
  if (!check.ok) return fail(state, check.error ?? 'Invalid attack');

  const paid = spendAttack(state.turns, ctx, attacker, kind, profile);
  if (!paid.ok) return fail(state, paid.error);
  attacker = paid.attacker;
  let next: CombatState = { ...withCreature(state, attacker), turns: paid.turns };
  const events: CombatEvent[] = [];
  const attacksLeft = () => next.turns.budgets[o.attackerId]?.attacksLeft ?? 0;

  // Sanctuary: the attacker must succeed on the save or lose the attack.
  const sanctuary = sanctuaryCheck(target, attacker, ctx.rng);
  if (!sanctuary.allowed) {
    events.push({ kind: 'save', actorId: attacker.id, targetId: target.id, text: `${attacker.name} is turned aside by Sanctuary: ${sanctuary.save?.text ?? ''}` });
    return { ok: true, state: next, events, hit: false, crit: false, damage: 0, attacksLeft: attacksLeft() };
  }

  // Effect-driven weapon changes (Magic Weapon, Shillelagh, True Strike, Enlarge/Reduce).
  const wm = weaponEffectMods(attacker, profile.weaponId, profile.uid);
  const swapAbility = (mods: Modifier[]): Modifier[] =>
    wm.spellMod === undefined ? mods : mods.map((m, i) => (i === 0 && (m.label === 'Strength' || m.label === 'Dexterity') ? { value: wm.spellMod!, label: 'Spellcasting' } : m));
  const toHit: Modifier[] = [...swapAbility(profile.toHit), ...rollEffectBonuses(attacker, 'attack', ctx.rng)];
  if (wm.attackBonus) toHit.push({ value: wm.attackBonus, label: 'Magic Weapon' });
  const abilityMod = wm.spellMod ?? profile.abilityMod;

  const advantage = [...check.advantage, ...(o.advantage ?? [])];
  const disadvantage = [...check.disadvantage, ...(o.disadvantage ?? [])];
  const res = attackRoll({
    rng: ctx.rng,
    label: profile.name,
    modifiers: toHit,
    targetAc: check.ac,
    advantage,
    disadvantage,
    exhaustion: attacker.exhaustion,
    ...(isCharacter(attacker) && { critOn: featureCritOn(attacker, db) }),
    ...(check.autoCrit && { autoCrit: check.autoCrit }),
    ...(ctx.msgs && { msgs: ctx.msgs }),
  });
  const { m } = msgsOf(ctx);
  const modeNote = [advantage.length ? m('combat.advantage', { list: advantage.join(', ') }) : '', disadvantage.length ? m('combat.disadvantage', { list: disadvantage.join(', ') }) : ''].filter(Boolean).join('; ');
  const coverNote = check.coverBonus ? ` (${m(check.cover === 'half' ? 'combat.cover.half' : 'combat.cover.three_quarters', { n: check.coverBonus })})` : '';
  events.push({
    kind: 'attack',
    actorId: attacker.id,
    targetId: target.id,
    text: `${m('combat.attack', { attacker: attacker.name, target: target.name, weapon: profile.name, roll: res.text })}${coverNote}${modeNote ? ` [${modeNote}]` : ''}`,
  });

  // Things used up or broken by making an attack roll.
  attacker = breakHiding(breakInvisibility(breakSanctuary(consumeAttackEffects(attacker, target.id))));
  target = consumeAttackedEffects(target);
  if (check.helperId) target = consumeHelpAttack(target, check.helperId);
  next = withCreature(withCreature(next, attacker), target);

  let hit = res.hit;
  if (hit) {
    const mirror = mirrorImageRedirect(target, attacker, ctx.rng);
    if (mirror.redirected) {
      hit = false;
      target = mirror.creature;
      next = withCreature(next, target);
      events.push({ kind: 'effect', targetId: target.id, text: `The attack strikes one of ${target.name}'s illusory duplicates instead.` });
    }
  }

  const mastery = profile.mastery;
  const useMastery = o.useMastery ?? true;
  if (!hit) {
    if (mastery === 'graze' && useMastery && !mirrorMiss(res, hit)) {
      const amount = grazeDamage(abilityMod);
      if (amount > 0) {
        const d = dealCombatDamage(next, ctx, attacker.id, target.id, [{ amount, type: profile.damage[0]?.type ?? 'slashing' }], { text: `Graze: ${amount}` });
        next = d.state;
        events.push(...d.events);
        return { ok: true, state: next, events, hit: false, crit: false, damage: d.dealt, roll: res, attacksLeft: attacksLeft() };
      }
    }
    return { ok: true, state: next, events, hit: false, crit: false, damage: 0, roll: res, attacksLeft: attacksLeft() };
  }

  // ---- damage
  const base = profile.damage.map((d, i) => (i === 0 ? { ...d, ...(wm.damageDie && { dice: wm.damageDie }), ...(wm.damageType && { type: wm.damageType }) } : d));
  const mainType = base[0]?.type ?? 'bludgeoning';
  const dice: Damage[] = [...base, ...wm.extraDice.map((x) => ({ dice: x, type: mainType })), ...wm.extraDamage];
  let damageMods = swapAbility(profile.damageModifiers);
  if (kind === 'cleave') damageMods = damageMods.map((m, i) => (i === 0 ? { ...m, value: cleaveDamageModifier(m.value) } : m));
  if ((kind === 'light_bonus' || kind === 'nick') && !(isCharacter(attacker) && attacker.featIds.includes('two_weapon_fighting'))) {
    damageMods = damageMods.map((m, i) => (i === 0 ? { ...m, value: Math.min(0, m.value) } : m));
  }
  if (wm.damageBonus) damageMods.push({ value: wm.damageBonus, label: 'Magic Weapon' });
  for (const p of wm.penaltyDice) damageMods.push({ value: -roll(p, ctx.rng).total, label: `Reduce ${p}` });
  dice.push(...effectDamageRiders(attacker, target.id, true), ...curseDamageRider(attacker.id, target));

  if (isCharacter(attacker) && profile.source) {
    const stamp = turnStamp(next.turns);
    const firstHitThisTurn = !attacker.effects.some((e) => e.key === 'hit_rider_turn' && e.data.stamp === stamp);
    const ta = next.grid.tokens[target.id]!;
    const allyAdjacentToTarget = Object.values(next.grid.tokens).some((t) => {
      const c = next.creatures[t.id];
      return !!c && t.id !== attacker!.id && t.id !== target!.id && !c.dead && canAct(c, ctx.table) && !areHostile(next, ctx, attacker!.id, t.id) && distanceFt(t, ta) <= 5;
    });
    const riders = weaponHitRiders(attacker, db, {
      attack: profile.source,
      target,
      crit: res.crit,
      rng: ctx.rng,
      firstHitThisTurn,
      hadAdvantage: res.mode === 'advantage',
      hadDisadvantage: res.mode === 'disadvantage',
      allyAdjacentToTarget,
    });
    for (const r of riders) {
      dice.push(...(r.extraDamage ?? []));
      damageMods.push(...(r.modifiers ?? []));
      if (r.text) events.push({ kind: 'effect', actorId: attacker.id, text: r.text });
    }
    if (riders.length > 0) {
      attacker = addEffect(
        removeEffects(attacker, (e) => e.key === 'hit_rider_turn'),
        { key: 'hit_rider_turn', sourceId: attacker.id, data: { stamp } },
      );
      next = withCreature(next, attacker);
    }
  }

  const rolled = rollDamage(ctx.rng, dice, { crit: res.crit, modifiers: damageMods });
  const dealt = dealCombatDamage(
    next,
    ctx,
    attacker.id,
    target.id,
    rolled.parts.map((p) => ({ amount: p.total, type: p.type })),
    { crit: res.crit, text: rolled.text, weapon: profile.unarmed ? 'fist' : profile.name },
  );
  next = dealt.state;
  events.push(...dealt.events);

  // ---- stat-block riders on a hit (Grappled with escape DC, Prone, Paralyzed after a save...)
  if (profile.id.startsWith('monster:') && next.creatures[target.id] && !next.creatures[target.id]!.dead) {
    const m = attacker.statBlockId ? db.monsters.get(attacker.statBlockId) : undefined;
    const action = m?.actions.find((x) => x.name === profile.name) ?? m?.bonusActions.find((x) => x.name === profile.name);
    const riders = action ? actionRiders(action) : [];
    if (riders.length > 0) {
      const r = applyActionRiders(next, ctx, attacker.id, target.id, riders, profile.name);
      next = r.state;
      events.push(...r.events);
    }
  }

  // ---- mastery riders on a hit
  let cleaveAvailable = false;
  target = next.creatures[target.id]!;
  attacker = next.creatures[attacker.id]!;
  if (mastery && useMastery && !target.dead) {
    if (mastery === 'cleave') {
      cleaveAvailable = profile.melee && kind !== 'cleave' && !hasOncePerTurnMarker(attacker, 'cleave_used');
    } else if (mastery !== 'nick' && mastery !== 'graze') {
      const pushWanted = Math.min(10, o.pushFt ?? 10);
      const m = applyMasteryOnHit({
        mastery,
        attacker,
        target,
        abilityMod,
        damageDealt: dealt.dealt,
        rng: ctx.rng,
        onOwnTurn: onOwnTurn(next.turns, attacker.id),
        use: mastery === 'push' ? pushWanted >= 5 : true,
      });
      next = withCreature(withCreature(next, m.attacker), m.target);
      if (m.save) events.push({ kind: 'save', targetId: target.id, text: m.text ?? m.save.text });
      else if (m.text && !m.pushFt) events.push({ kind: 'effect', actorId: attacker.id, targetId: target.id, text: m.text });
      if (m.pushFt) {
        const pushed = pushAway(next.grid, attacker.id, target.id, Math.min(m.pushFt, pushWanted));
        next = { ...next, grid: pushed.grid };
        events.push({ kind: 'move', actorId: attacker.id, targetId: target.id, text: `Push: ${target.name} is pushed ${pushed.movedFt} ft` });
      }
    }
  } else if (mastery === 'cleave' && useMastery) {
    cleaveAvailable = profile.melee && kind !== 'cleave' && !hasOncePerTurnMarker(attacker, 'cleave_used');
  }

  return { ok: true, state: next, events, hit: true, crit: res.crit, damage: dealt.dealt, roll: res, ...(cleaveAvailable && { cleaveAvailable }), attacksLeft: attacksLeft() };
}

/** Graze applies to a real miss (not to an attack that hit a Mirror Image duplicate). */
function mirrorMiss(res: AttackRollResult, hit: boolean): boolean {
  return res.hit && !hit;
}

/** Size check shared by Grapple and Shove: the target is no more than one size larger. */
export function withinOneSizeLarger(attacker: Creature, target: Creature): boolean {
  return SIZES.indexOf(target.size) <= SIZES.indexOf(attacker.size) + 1;
}
