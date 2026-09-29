/**
 * Deterministic companion AI (Build Prompt §6: "AI combat tactics should be sensible and role-aware:
 * healers heal, casters keep distance, melee characters protect allies. Tactics are deterministic
 * code, not LLM decisions."). Same state + same seed → same plan and same rolls; the plan itself uses
 * no randomness (ties break on move cost, then square, then id).
 *
 * Roles (`companionRole`, from the sheet; first match wins):
 * - healer: main class is a full caster and a healing spell is prepared (cleric, druid, bard).
 * - ranged: main class is a full/pact caster with a damage cantrip, or the best ranged weapon beats
 *   the best melee weapon (a ranger with a longbow).
 * - defender: heavy armor or a shield, fighting in melee.
 * - striker: everything else (rogue, barbarian, monk...).
 *
 * `planCompanionTurn` scores every square the companion can reach this turn (no Dash) with the best
 * Action + Bonus Action pair there, in expected-HP units, plus positional terms:
 * - Action: the Attack action (enemy AI's `attackAt`: Extra Attack, cover, Advantage/Disadvantage),
 *   a damage cantrip (spell attack or save, scaled by level), an Action heal (Cure Wounds), or Dodge
 *   (worth a little per enemy threatening the square).
 * - Bonus Action: a Bonus Action heal (Healing Word, Lay On Hands, Second Wind), or Cunning Action
 *   Disengage (rogue 2+) to cancel the path's Opportunity Attacks.
 * - Heal value = expected healing capped at missing HP, only for an ally that is down (a large
 *   bonus + ¼ per HP: top priority, the cheapest heal that gets them up wins) or at ≤ 30% HP (self
 *   Second Wind: ≤ 50%). The last spell slot is kept unless someone is down. One slot spell per turn (SRD 5.2.1), so Healing Word pairs with a cantrip or a
 *   weapon attack.
 * - Attack value = expected damage capped at the target's HP, + a kill bonus, + focus fire on
 *   `opts.focusId`, + a guard bonus for enemies next to the protected ally, + a tiny rank tie-break.
 * - Position: − Opportunity Attack damage along the path; ranged/healer roles: − a penalty per enemy
 *   threatening the square, + a little per foot from the nearest enemy (≤ 30 ft), + cover from
 *   enemies; defenders: + a protect bonus for standing between the most vulnerable caster ally and
 *   the closest melee-minded enemy to it (archers can't be blocked: charge them); everyone: − a
 *   penalty per foot beyond `leashFt` from `leaderId`.
 * Fallbacks: a downed ally out of reach → Dash + move + Bonus Action heal; nothing to do → defenders
 * guard their ward (move + Dodge), others close in like the enemy AI (casters stop inside cantrip
 * range). Characters never flee (no morale). Non-characters fall back to the enemy AI's `planTurn`.
 */
import type { Character, Creature } from '../core/creature';
import type { DiceExpr } from '../core/dice';
import type { Damage, Effect } from '../data/common';
import type { Spell } from '../data/schemas';
import type { SrdDatabase } from '../data/srd';
import { equipped, classLevel } from '../character/derived';
import { featureActions, spellInfo, spellOptions } from '../character/features';
import { abilityModifier } from '../rules/basics';
import { effectiveSpeed } from '../rules/conditions';
import { upcastDice } from '../rules/effects';
import { cantripMultiplier, levelTableValue, scaleCantripEffects, spellAttackBonus, spellSaveDc, type SlotChoice } from '../rules/spellcasting';
import {
  attackAt,
  attackSlots,
  destinations,
  executePlan,
  idle,
  minHostileDistance,
  movedState,
  oaCost,
  planApproach,
  planTurn,
  prefersRange,
  setupTurn,
  threatsAt,
  type AiOptions,
  type AiPlan,
  type AiStep,
  type Dest,
  type Planner,
} from './ai';
import { averageDamage, expectedAttackDamage, expectedSaveDamage, isDown, rankTargets } from './aiScore';
import { attackProfiles, canSee, checkAttack, type AttackProfile } from './attack';
import { knowsSpell, lowestSlotFor, reachProblem, slotsLeft, spellcastingSource, spellEconomy, spellRangeFt } from './castAction';
import { areHostile, dbOf, type ActionResult, type CombatContext, type CombatState } from './combatState';
import { distanceFt, type GridToken, type Point } from './grid';
import { computeCover } from './los';

export type CompanionRole = 'healer' | 'ranged' | 'defender' | 'striker';

/** Tunable weights (≈ HP points). */
export const COMPANION_TUNING = {
  /** Allies at or below this HP fraction are worth healing. */
  healThreshold: 0.3,
  /** Second Wind on yourself at or below this fraction. */
  selfHealThreshold: 0.5,
  /** Extra value of getting a downed ally back up (dominates any attack). */
  downedBonus: 25,
  /** Weight of each HP restored to a downed ally (getting up matters, not the amount). */
  downedHpWeight: 0.25,
  /** Ranged/healer: penalty per enemy threatening the square. */
  keepDistancePenalty: 4,
  /** Ranged/healer: bonus per foot from the nearest enemy, up to `keepDistanceCapFt`. */
  distanceBonusPerFt: 0.03,
  keepDistanceCapFt: 30,
  /** Ranged/healer: bonus per point of cover AC against each enemy. */
  coverBonusPerAc: 0.25,
  /** Defender: standing between the ward and its nearest enemy. */
  protectBonus: 3,
  /** Defender: attacking an enemy within 5 ft of the ward. */
  guardTargetBonus: 3,
  /** Attacking the hero's target. */
  focusBonus: 2,
  /** Expected damage ≥ remaining HP. */
  killBonus: 2,
  /** Dodge value per enemy threatening the square. */
  dodgePerThreat: 0.75,
  /** Stay within this distance of the leader (hero). */
  leashFt: 60,
  leashPenaltyPerFt: 0.1,
} as const;

export interface CompanionOptions extends AiOptions {
  /** The hero's current target: focus fire. */
  focusId?: string;
  /** The hero: stay within `leashFt` of them. */
  leaderId?: string;
  leashFt?: number;
  /** Override the detected role. */
  role?: CompanionRole;
}

const isCharacter = (c: Creature | undefined): c is Character => !!c && c.kind === 'character' && 'classes' in c;
const at = (p: Planner, d: Point): GridToken => ({ ...p.token, x: d.x, y: d.y });

// ---------------------------------------------------------------- sheet analysis

const topEffects = (s: Spell): Effect[] => s.effects ?? [];
const isHealSpell = (s: Spell): boolean => topEffects(s).some((e) => e.kind === 'heal');

function knownSpells(c: Character, db: SrdDatabase): Spell[] {
  const ids = [...(c.spellcasting?.cantrips ?? []), ...(c.spellcasting?.prepared.map((p) => p.spellId) ?? [])];
  return [...new Set(ids)]
    .sort()
    .map((id) => db.spells.get(id))
    .filter((s): s is Spell => !!s);
}

/** The class with the most levels (first listed on ties). */
function mainClass(c: Character): string {
  return [...c.classes].sort((a, b) => b.level - a.level)[0]!.classId;
}

const characterLevel = (c: Character) => c.classes.reduce((s, x) => s + x.level, 0);

export interface DamageCantrip {
  spell: Spell;
  kind: 'attack' | 'save';
  /** Pseudo attack profile: range/LOS checks and (attack cantrips) the to-hit bonus. */
  profile: AttackProfile;
  damage: Damage[];
  /** Eldritch Blast beams. */
  beams: number;
  save?: { ability: 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha'; dc: number; half: boolean };
}

/** Action cantrips that deal damage to one creature (spell attack or save), scaled to the character's level. */
export function damageCantrips(c: Character, db: SrdDatabase): DamageCantrip[] {
  const out: DamageCantrip[] = [];
  for (const spell of knownSpells(c, db)) {
    if (spell.level !== 0 || spellEconomy(spell) !== 'action' || !c.spellcasting?.cantrips.includes(spell.id)) continue;
    const range = spellRangeFt(spell);
    if (range === undefined || range === 0) continue;
    const base = topEffects(spell);
    const beamHook = base.find((e) => e.kind === 'hook' && e.params?.beamsByLevel);
    const noScale = base.some((e) => e.kind === 'hook' && e.params?.noDiceScaling === true);
    const effects = noScale ? base : scaleCantripEffects(base, cantripMultiplier(characterLevel(c)));
    const src = spellcastingSource(c, spell, db);
    const opts = spellOptions(c, db, spellInfo(spell, src.classId), 0);
    const bonus = (opts.cantripDamageBonus ?? 0) + (opts.damageBonus ?? 0);
    const mods = bonus ? [{ value: bonus, label: 'Bonus' }] : [];
    const beams = beamHook?.kind === 'hook' ? levelTableValue(beamHook.params!.beamsByLevel as Record<string, number>, characterLevel(c)) : 1;
    const dmgOf = (list: Effect[]): Damage[] => list.flatMap((e) => (e.kind === 'damage' ? e.damage : []));
    const profile = (melee: boolean, damage: Damage[]): AttackProfile => ({
      id: `spell:${spell.id}`,
      name: spell.name,
      melee,
      ability: src.ability,
      abilityMod: abilityModifier(c.abilities[src.ability]),
      toHit: [{ value: spellAttackBonus(c, src.ability), label: 'Spell attack' }],
      damage,
      damageModifiers: mods,
      reach: 5,
      ...(!melee && { range: { normal: range } }),
      properties: [],
    });
    const atk = effects.find((e) => e.kind === 'attack');
    if (atk?.kind === 'attack') {
      const damage = dmgOf(atk.onHit);
      if (damage.length) out.push({ spell, kind: 'attack', profile: profile(atk.attack.startsWith('melee'), damage), damage, beams });
      continue;
    }
    const save = effects.find((e) => e.kind === 'save');
    if (save?.kind === 'save') {
      const damage = dmgOf(save.onFail);
      if (!damage.length) continue;
      const dc = spellSaveDc(c, src.ability) + (opts.saveDcBonus ?? 0);
      out.push({ spell, kind: 'save', profile: profile(false, damage), damage, beams: 1, save: { ability: save.ability, dc, half: save.onSuccess === 'half' || !!opts.potentCantrip } });
    }
  }
  return out;
}

export interface HealSource {
  id: string;
  name: string;
  economy: 'action' | 'bonusAction';
  /** Touch 5, Self 0, else feet. */
  rangeFt: number;
  usesSlot: boolean;
  /** Expected healing before the missing-HP cap (Lay On Hands: its pool). */
  expected: number;
  step: (targetId: string, amount: number) => AiStep;
  selfOnly?: boolean;
}

function average(expr: DiceExpr, max: boolean): number {
  return expr.terms.reduce((s, t) => s + (t.kind === 'dice' ? t.sign * t.count * (max ? t.sides : (t.sides + 1) / 2) : t.sign * t.value), 0);
}

/** Healing the character can do right now (spells with a slot left, feature actions with uses left). */
export function healSources(c: Character, db: SrdDatabase): HealSource[] {
  const out: HealSource[] = [];
  for (const spell of knownSpells(c, db)) {
    const economy = spellEconomy(spell);
    const range = spellRangeFt(spell);
    const eff = topEffects(spell).find((e) => e.kind === 'heal');
    if (!economy || range === undefined || eff?.kind !== 'heal' || !knowsSpell(c, spell.id)) continue;
    const slot = lowestSlotFor(c, spell);
    if (!slot) continue;
    const level = slot.kind === 'slot' ? slot.level : slot.kind === 'pact' ? (c.spellcasting?.pact?.level ?? spell.level) : spell.level;
    const src = spellcastingSource(c, spell, db);
    const opts = spellOptions(c, db, spellInfo(spell, src.classId), level);
    const expected = average(upcastDice(eff.dice, eff.upcast, level - spell.level), !!opts.maxHealDice) + (eff.addSpellMod ? abilityModifier(c.abilities[src.ability]) : 0) + (opts.healBonus ?? 0);
    const slotChoice: SlotChoice = slot;
    out.push({
      id: spell.id,
      name: spell.name,
      economy,
      rangeFt: range,
      usesSlot: spell.level > 0,
      expected,
      step: (targetId) => ({ kind: 'cast', spellId: spell.id, targetIds: [targetId], slot: slotChoice }),
      ...(range === 0 && { selfOnly: true }),
    });
  }
  for (const a of featureActions(c, db)) {
    if (a.problem) continue;
    if (a.action.id === 'lay_on_hands') {
      out.push({ id: 'lay_on_hands', name: a.action.name, economy: 'bonusAction', rangeFt: 5, usesSlot: false, expected: c.resources.lay_on_hands?.current ?? 0, step: (targetId, amount) => ({ kind: 'feature', actionId: 'lay_on_hands', targetId, choice: String(Math.max(1, Math.round(amount))) }) });
    } else if (a.action.id === 'second_wind') {
      out.push({ id: 'second_wind', name: a.action.name, economy: 'bonusAction', rangeFt: 0, usesSlot: false, expected: 5.5 + classLevel(c, 'fighter'), step: () => ({ kind: 'feature', actionId: 'second_wind' }), selfOnly: true });
    }
  }
  return out;
}

function wearsHeavyOrShield(c: Character, db: SrdDatabase): boolean {
  if (equipped(c, 'shield').length > 0) return true;
  return equipped(c, 'armor').some((i) => db.armor.get(i.itemId)?.category === 'heavy');
}

/** Tactical role from the character sheet (see the module doc). Deterministic. */
export function companionRole(c: Character, db: SrdDatabase): CompanionRole {
  const progression = db.classes.get(mainClass(c))?.spellcasting.progression ?? 'none';
  const spells = knownSpells(c, db);
  if (progression === 'full' && spells.some(isHealSpell)) return 'healer';
  const weapons = attackProfiles(c, db).filter((p) => !p.unarmed);
  if ((progression === 'full' || progression === 'pact') && damageCantrips(c, db).length > 0) return 'ranged';
  const best = (melee: boolean) => Math.max(0, ...weapons.filter((p) => p.melee === melee).map((p) => averageDamage(p.damage, p.damageModifiers)));
  if (best(false) > best(true)) return 'ranged';
  if (wearsHeavyOrShield(c, db) && best(true) > 0) return 'defender';
  return 'striker';
}

// ---------------------------------------------------------------- options

interface Option {
  value: number;
  steps: AiStep[];
  usesSlot: boolean;
  kind: 'attack' | 'cantrip' | 'heal' | 'dodge' | 'dash';
  targetId?: string;
  label: string;
}

interface HealNeed {
  id: string;
  down: boolean;
  missing: number;
}

/** Healing worth: HP restored (capped at missing HP); a downed ally is worth mostly getting up at all. */
function healValue(src: HealSource, need: HealNeed, maxHp: number): number {
  if (need.down) return COMPANION_TUNING.downedBonus + Math.min(src.expected, maxHp) * COMPANION_TUNING.downedHpWeight;
  return Math.min(src.expected, need.missing);
}

/** Heal options from square `dest` for one economy slot. */
function healOptions(p: Planner, dest: Point, sources: readonly HealSource[], needs: readonly HealNeed[], economy: 'action' | 'bonusAction', lastSlot: boolean): Option[] {
  const out: Option[] = [];
  const hyp = movedState(p, dest);
  for (const src of sources) {
    if (src.economy !== economy) continue;
    for (const need of needs) {
      if (src.selfOnly && need.id !== p.id) continue;
      if (src.usesSlot && lastSlot && !need.down) continue;
      if (src.id === 'second_wind' && need.id !== p.id) continue;
      if (reachProblem(hyp, p.id, need.id, src.rangeFt)) continue;
      const target = p.state.creatures[need.id]!;
      const value = healValue(src, need, target.maxHp);
      const amount = need.down ? Math.min(src.expected, target.maxHp) : Math.min(src.expected, need.missing);
      out.push({ value, steps: [src.step(need.id, amount)], usesSlot: src.usesSlot, kind: 'heal', targetId: need.id, label: `${src.name} on ${target.name}` });
    }
  }
  return out;
}

// ---------------------------------------------------------------- planning

/** The most vulnerable conscious caster ally (ranged/healer role) other than the actor: lowest AC, then HP, then id. */
export function pickWard(state: CombatState, ctx: CombatContext, actorId: string): string | undefined {
  const db = dbOf(ctx);
  const cands = Object.keys(state.creatures)
    .filter((id) => id !== actorId && state.grid.tokens[id] && !areHostile(state, ctx, actorId, id))
    .map((id) => state.creatures[id]!)
    .filter((c): c is Character => isCharacter(c) && !isDown(c) && ['ranged', 'healer'].includes(companionRole(c, db)));
  cands.sort((a, b) => a.ac - b.ac || a.hp - b.hp || (a.id < b.id ? -1 : 1));
  return cands[0]?.id;
}

/** Plan a companion's whole turn (its turn must have started). Pure. */
export function planCompanionTurn(state: CombatState, ctx: CombatContext, actorId: string, opts: CompanionOptions = {}): AiPlan {
  const db = dbOf(ctx);
  if (!isCharacter(state.creatures[actorId])) return planTurn(state, ctx, actorId, opts);
  const setup = setupTurn(state, ctx, actorId, opts);
  if ('intent' in setup) return setup;
  const { p, prefix, budgetFt } = setup;
  const T = COMPANION_TUNING;
  const actor = p.actor as Character;
  const base = p.state;
  const b = base.turns.budgets[actorId]!;
  if (!b.action && !b.bonusAction) return { ...idle(actorId, 'has already acted'), steps: prefix };
  const role = opts.role ?? companionRole(actor, db);
  const keepAway = role === 'ranged' || role === 'healer';
  const liveHostiles = p.hostiles.filter((h) => !isDown(base.creatures[h]!));
  const visible = liveHostiles.filter((h) => canSee(base, ctx, actor, base.creatures[h]!));

  // Who needs healing.
  const needs: HealNeed[] = Object.keys(base.creatures)
    .sort()
    .filter((id) => base.grid.tokens[id] && !areHostile(base, ctx, actorId, id))
    .map((id) => base.creatures[id]!)
    .filter((c) => !c.dead && (c.hp <= 0 || c.hp / Math.max(1, c.maxHp) <= (c.id === actorId ? T.selfHealThreshold : T.healThreshold)))
    .map((c) => ({ id: c.id, down: c.hp <= 0, missing: c.maxHp - c.hp }));
  const sources = healSources(actor, db).filter((s) => (s.economy === 'action' ? b.action : b.bonusAction));
  const lastSlot = slotsLeft(actor) <= 1;

  // Offense.
  const slots = b.action ? attackSlots(actor, ctx) : [];
  const cantrips = b.action ? damageCantrips(actor, db) : [];
  const ranked = rankTargets(
    actor,
    visible.map((h) => ({ id: h, creature: base.creatures[h]!, distanceFt: distanceFt(p.token, base.grid.tokens[h]!) })),
    { db, ...(ctx.table && { table: ctx.table }) },
  ).map((t) => t.id);

  // Protect.
  const wardId = role === 'defender' ? pickWard(base, ctx, actorId) : undefined;
  const ward = wardId ? base.grid.tokens[wardId] : undefined;
  let threatId: string | undefined;
  if (ward) {
    // Only melee-minded enemies can be blocked; archers are better charged.
    let min = Infinity;
    for (const h of liveHostiles.filter((x) => !prefersRange(attackProfiles(base.creatures[x]!, db)))) {
      const d = distanceFt(ward, base.grid.tokens[h]!);
      if (d < min) [min, threatId] = [d, h];
    }
  }
  const nearWard = new Set(ward ? liveHostiles.filter((h) => distanceFt(ward, base.grid.tokens[h]!) <= 5) : []);
  const protectAt = (d: Point): number => {
    if (!ward || !threatId) return 0;
    const me = at(p, d);
    const tt = base.grid.tokens[threatId]!;
    const dw = distanceFt(me, ward);
    return dw <= 10 && distanceFt(me, tt) < distanceFt(ward, tt) ? T.protectBonus + (dw <= 5 ? 1 : 0) : 0;
  };

  const leader = opts.leaderId && opts.leaderId !== actorId ? base.grid.tokens[opts.leaderId] : undefined;
  const leash = opts.leashFt ?? T.leashFt;
  const cunning = b.bonusAction && !b.disengaged && classLevel(actor, 'rogue') >= 2;

  const targetBonus = (h: string, expected: number): number => {
    const c = base.creatures[h]!;
    const idx = ranked.indexOf(h);
    return (
      Math.min(expected, c.hp + c.tempHp) +
      (expected >= c.hp + c.tempHp ? T.killBonus : 0) +
      (h === opts.focusId ? T.focusBonus : 0) +
      (nearWard.has(h) ? T.guardTargetBonus : 0) +
      (idx >= 0 ? (ranked.length - idx) * 0.05 : 0)
    );
  };

  const actionOptions = (dest: Dest): Option[] => {
    const out: Option[] = [];
    if (!b.action) return out;
    const hyp = movedState(p, dest);
    for (const h of visible) {
      const target = base.creatures[h]!;
      if (slots.length) {
        const a = attackAt(p, h, dest, slots);
        if (a) out.push({ value: targetBonus(h, a.expected), steps: a.attacks.map((x): AiStep => ({ kind: 'attack', profileId: x.profileId, targetId: h })), usesSlot: false, kind: 'attack', targetId: h, label: `attacks ${target.name}` });
      }
      for (const ct of cantrips) {
        const check = checkAttack(hyp, ctx, actorId, h, ct.profile);
        if (!check.ok) continue;
        const e = ct.kind === 'attack' ? expectedAttackDamage(ct.profile, check, target) * ct.beams : expectedSaveDamage(ct.damage, target, ct.save!.ability, ct.save!.dc, ct.save!.half);
        if (e > 0) out.push({ value: targetBonus(h, e), steps: [{ kind: 'cast', spellId: ct.spell.id, targetIds: [h] }], usesSlot: false, kind: 'cantrip', targetId: h, label: `casts ${ct.spell.name} at ${target.name}` });
      }
    }
    out.push(...healOptions(p, dest, sources, needs, 'action', lastSlot));
    const threats = threatsAt(p, dest);
    if (threats > 0) out.push({ value: threats * T.dodgePerThreat, steps: [{ kind: 'dodge' }], usesSlot: false, kind: 'dodge', label: 'Dodges' });
    return out;
  };

  const positional = (dest: Dest): number => {
    let v = -dest.costFt * 0.001;
    if (keepAway) {
      v -= threatsAt(p, dest) * T.keepDistancePenalty;
      v += Math.min(minHostileDistance(p, dest), T.keepDistanceCapFt) * T.distanceBonusPerFt;
      const hyp = movedState(p, dest);
      for (const h of liveHostiles) v += computeCover(hyp.grid, h, actorId).acBonus * T.coverBonusPerAc;
    }
    v += protectAt(dest);
    if (leader) {
      const d = distanceFt(at(p, dest), leader);
      if (d > leash) v -= (d - leash) * T.leashPenaltyPerFt;
    }
    return v;
  };

  interface Choice {
    total: number;
    dest: Dest;
    action?: Option;
    bonus?: Option;
    bonusDisengage: boolean;
    guard: number;
  }
  let best: Choice | undefined;
  const dests = destinations(p, budgetFt);
  for (const dest of dests) {
    const acts: (Option | undefined)[] = [undefined, ...actionOptions(dest)];
    const bonuses: (Option | undefined)[] = [undefined, ...(b.bonusAction ? healOptions(p, dest, sources, needs, 'bonusAction', lastSlot) : [])];
    const oa = oaCost(p, dest.path, budgetFt, b.disengaged);
    const pos = positional(dest);
    for (const a of acts) {
      for (const bo of bonuses) {
        if (a?.usesSlot && bo?.usesSlot) continue;
        if (a?.kind === 'heal' && bo?.kind === 'heal' && a.targetId === bo.targetId) continue;
        const dis = !bo && cunning && oa > 0;
        const total = (a?.value ?? 0) + (bo?.value ?? 0) + pos - (dis ? 0 : oa);
        if (!best || total > best.total + 1e-9) best = { total, dest, ...(a && { action: a }), ...(bo && { bonus: bo }), bonusDisengage: dis, guard: protectAt(dest) };
      }
    }
  }

  // A downed ally beyond reach: Dash there and heal with a Bonus Action.
  const downed = needs.filter((n) => n.down);
  const bonusHeals = sources.filter((s) => s.economy === 'bonusAction' && !s.selfOnly);
  if (downed.length && b.action && bonusHeals.length && !best?.bonus && best?.action?.kind !== 'heal') {
    const dashFt = budgetFt + effectiveSpeed(actor, ctx.table);
    for (const dest of destinations(p, dashFt)) {
      const bo = healOptions(p, dest, bonusHeals, downed, 'bonusAction', lastSlot)[0];
      if (!bo) continue;
      const total = bo.value + positional(dest) - oaCost(p, dest.path, dashFt, b.disengaged);
      if (!best || total > best.total + 1e-9) {
        best = { total, dest, action: { value: 0, steps: [{ kind: 'dash' }], usesSlot: false, kind: 'dash', label: 'Dashes' }, bonus: bo, bonusDisengage: false, guard: 0 };
      }
    }
  }

  const hasPurpose = !!best && (!!best.bonus || (!!best.action && best.action.kind !== 'dodge'));
  if (!best || !hasPurpose) {
    // Nothing to attack or heal this turn.
    if (best && best.guard > 0 && b.action) {
      return {
        actorId,
        intent: 'protect',
        ...(wardId && { targetId: wardId }),
        steps: [...prefix, ...(best.dest.path.length ? [{ kind: 'move', path: best.dest.path } as AiStep] : []), { kind: 'dodge' }],
        reason: `guards ${base.creatures[wardId!]!.name}`,
      };
    }
    if (best?.action?.kind === 'dodge') {
      return { actorId, intent: 'defend', steps: [...prefix, ...(best.dest.path.length ? [{ kind: 'move', path: best.dest.path } as AiStep] : []), { kind: 'dodge' }], reason: 'Dodges' };
    }
    if (!b.action) return { ...idle(actorId, 'has already used its action'), steps: prefix };
    const cantripProfiles = cantrips.map((c) => c.profile);
    const approachSlots = cantripProfiles.length ? [[...cantripProfiles, ...slots.flat()]] : slots;
    return planApproach(p, prefix, budgetFt, keepAway || prefersRange(approachSlots.flat()), approachSlots);
  }

  // Assemble.
  const steps: AiStep[] = [...prefix];
  const bonusFirst = !!best.bonus && best.bonus.targetId !== undefined && !reachProblem(base, actorId, best.bonus.targetId, sources.find((s) => stepMatches(s, best!.bonus!))?.rangeFt ?? 5);
  if (best.bonusDisengage) steps.push({ kind: 'disengage', bonus: true });
  if (best.action?.kind === 'dash') steps.push({ kind: 'dash' });
  if (best.bonus && bonusFirst) steps.push(...best.bonus.steps);
  if (best.dest.path.length) steps.push({ kind: 'move', path: best.dest.path });
  if (best.bonus && !bonusFirst) steps.push(...best.bonus.steps);
  if (best.action && best.action.kind !== 'dash') steps.push(...best.action.steps);
  const healStep = [best.bonus, best.action].find((o) => o?.kind === 'heal');
  const offense = best.action && (best.action.kind === 'attack' || best.action.kind === 'cantrip') ? best.action : undefined;
  const parts = [best.bonus?.label && best.bonus.kind === 'heal' ? `uses ${best.bonus.label}` : undefined, best.action?.kind === 'heal' ? `uses ${best.action.label}` : best.action?.kind === 'dash' ? 'Dashes' : best.action?.label].filter((x): x is string => !!x);
  return {
    actorId,
    intent: healStep ? 'heal' : offense ? 'attack' : best.guard > 0 ? 'protect' : 'defend',
    ...((healStep?.targetId ?? offense?.targetId) && { targetId: (healStep?.targetId ?? offense?.targetId)! }),
    steps,
    reason: `${parts.join(' and ') || 'repositions'}${best.bonusDisengage ? ' (Cunning Action: Disengage)' : ''}`,
    ...(offense && { expected: offense.value }),
  };
}

function stepMatches(src: HealSource, o: Option): boolean {
  const s = o.steps[0];
  return !!s && ((s.kind === 'cast' && s.spellId === src.id) || (s.kind === 'feature' && s.actionId === src.id));
}

/** Plan and play a companion's turn (its turn must have been started with startTurn/nextTurn). */
export function takeCompanionTurn(state: CombatState, ctx: CombatContext, actorId: string, opts: CompanionOptions = {}): ActionResult<{ plan: AiPlan; halted: boolean }> {
  return executePlan(state, ctx, planCompanionTurn(state, ctx, actorId, opts), opts);
}
