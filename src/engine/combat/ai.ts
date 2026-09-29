/**
 * Deterministic enemy AI (Build Prompt §10): "Enemy AI is deterministic and based on stat blocks,
 * with simple tactical behaviors (focus on weak targets, use abilities, flee when morale breaks
 * where appropriate)". Same state + same seed → same decisions and same rolls; the plan itself
 * uses no randomness at all (ties break on cost, then square, then id).
 *
 * `planTurn` (pure) decides, in order:
 * 1. Can't act / nothing hostile → idle. Prone → stand up first when movement allows.
 * 2. Morale (aiScore.moraleCheck) → flee: bonus Disengage (Nimble Escape) + Dash, else Dash when no
 *    Opportunity Attack would trigger, else Disengage + move; to the square farthest from every
 *    hostile. Cornered (no square is safer) → fight on.
 * 3. Attack options: every square it can reach with its remaining movement × every visible hostile,
 *    scoring the Attack action (Multiattack slots, each with its best stat-block attack) by expected
 *    damage from `checkAttack` (AC, cover, Advantage/Disadvantage incl. long range and adjacent
 *    enemies) − the expected damage of the Opportunity Attacks the path provokes − a threat penalty
 *    for ranged-minded creatures ending next to a hostile (a bonus-action Disengage removes the OAs).
 *    The target is picked by `rankTargets` among those with a worthwhile option (weakest focus;
 *    beasts: closest; smart: casters, not Dodgers); then its best square/attacks.
 * 4. Area actions (breath weapons: cone/line/cube/emanation from the monster) that are available
 *    (recharge/per-day): aimed at each hostile from each reachable square; never when an ally would
 *    be caught; used when ≥ 2 hostiles are in the area or it beats the attack's expected damage.
 * 5. Nothing in reach → Dash toward the preferred target (ranged: stop inside normal range);
 *    no progress possible → Dodge.
 *
 * `executePlan` carries a plan out through the normal action functions (economy, OAs via
 * moveCreature, resolveAttack with the Multiattack count, resolveAreaEffect), re-targeting when the
 * planned target has dropped and stopping if the actor drops mid-move. `takeAiTurn` = plan + execute.
 */
import type { Creature } from '../core/creature';
import type { Monster } from '../data/schemas';
import { removeCondition, canAct, hasCondition, effectiveSpeed } from '../rules/conditions';
import { actionAvailable, spendAction } from '../rules/monsters';
import { canMakeOpportunityAttacks } from '../rules/spellHooks3';
import { dash, disengage, dodge, moveCreature, type MoveOptions } from './actions';
import { attackProfiles, attacksPerActionOf, canSee, checkAttack, meleeReach, resolveAttack, type AttackProfile } from './attack';
import { AI_TUNING, averageDamage, expectedAttackDamage, expectedSaveDamage, isDown, moraleCheck, rankTargets, roughAttackDamage, type MoraleOptions, type TargetCandidate } from './aiScore';
import { previewArea, templateFromCaster } from './aoe';
import { resolveAreaEffect } from './aoeResolve';
import { areHostile, cloneGridTokens, dbOf, withCreature, type ActionResult, type CombatContext, type CombatEvent, type CombatState } from './combatState';
import { distanceFt, footprintSize, moveToken, type GridToken, type Point } from './grid';
import { planMove, reachableSquares, standUpCost, type PathOptions } from './movement';
import { addDash, canReact, movementLeft, spend, standUp } from './turns';
import type { SlotChoice } from '../rules/spellcasting';
import { castInCombat, featureInCombat } from './castAction';

// ---------------------------------------------------------------- plan shapes

export type AiStep =
  | { kind: 'stand' }
  | { kind: 'move'; path: Point[] }
  | { kind: 'dash'; bonus?: boolean }
  | { kind: 'disengage'; bonus?: boolean }
  | { kind: 'dodge' }
  | { kind: 'attack'; profileId: string; targetId: string }
  | { kind: 'area'; actionName: string; aim: Point }
  /** Cast a known spell (companions): Action or Bonus Action from its casting time. */
  | { kind: 'cast'; spellId: string; targetIds: string[]; slot?: SlotChoice }
  /** Use a class-feature action (Second Wind, Lay On Hands...). */
  | { kind: 'feature'; actionId: string; targetId?: string; choice?: string };

export type AiIntent = 'attack' | 'area' | 'approach' | 'flee' | 'defend' | 'heal' | 'protect' | 'idle';

export interface AiPlan {
  actorId: string;
  intent: AiIntent;
  targetId?: string;
  steps: AiStep[];
  /** Short explanation for the combat log / debugging. */
  reason: string;
  /** Expected damage of the chosen option (attack/area). */
  expected?: number;
}

export interface AiOptions extends MoraleOptions {
  /** Whether a creature takes an Opportunity Attack against the AI mover (default: yes). */
  takeOpportunity?: MoveOptions['takeOpportunity'];
}

type MonsterAction = Monster['actions'][number];

// ---------------------------------------------------------------- stat-block helpers

/** Bonus-action mobility a creature has (e.g. goblin Nimble Escape: Disengage or Hide). */
export function bonusMobility(c: Creature, ctx: CombatContext): { disengage: boolean; dash: boolean } {
  const m = c.statBlockId ? dbOf(ctx).monsters.get(c.statBlockId) : undefined;
  const text = (m?.bonusActions ?? []).map((a) => a.text).join(' ');
  return { disengage: /\bDisengage\b/.test(text), dash: /\bDash\b/.test(text) };
}

/**
 * Attack slots of one Attack action: for each attack, the profiles allowed there. Multiattack entries
 * name the attack; "X or Y" / "in any combination" wording makes the named attacks interchangeable.
 * Characters (and monsters without Multiattack): Extra Attack count × every profile.
 */
export function attackSlots(c: Creature, ctx: CombatContext): AttackProfile[][] {
  const db = dbOf(ctx);
  const profiles = attackProfiles(c, db);
  if (profiles.length === 0) return [];
  const m = c.statBlockId ? db.monsters.get(c.statBlockId) : undefined;
  const multi = m?.actions.find((a) => a.name === 'Multiattack');
  if (!m || !multi?.multiattack?.length) return new Array<AttackProfile[]>(attacksPerActionOf(c, db)).fill(profiles);
  const attackNames = new Set(m.actions.filter((a) => a.attack).map((a) => a.name));
  const mix = /\bor\b|any combination/i.test(multi.text) ? [...attackNames].filter((n) => multi.text.includes(n)) : [];
  const slots: AttackProfile[][] = [];
  for (const [name, n] of multi.multiattack) {
    if (!attackNames.has(name)) continue;
    const allowed = new Set([name, ...mix]);
    for (let i = 0; i < n; i++) slots.push(profiles.filter((p) => allowed.has(p.name)));
  }
  return slots.length ? slots : [profiles];
}

/** Area actions (save + damage + area) the monster can use right now. */
function areaActions(c: Creature, ctx: CombatContext): MonsterAction[] {
  const m = c.statBlockId ? dbOf(ctx).monsters.get(c.statBlockId) : undefined;
  return (m?.actions ?? []).filter((a) => a.save?.area && a.save.damage?.length && ['cone', 'line', 'cube', 'emanation'].includes(a.save.area.shape) && actionAvailable(c, a));
}

/** Does it fight better at range (best ranged average ≥ best melee average)? */
export function prefersRange(profiles: readonly AttackProfile[]): boolean {
  const best = (melee: boolean) => Math.max(-1, ...profiles.filter((p) => p.melee === melee).map((p) => averageDamage(p.damage, p.damageModifiers)));
  const ranged = best(false);
  return ranged >= 0 && ranged >= best(true);
}

// ---------------------------------------------------------------- planning context

export interface Dest {
  x: number;
  y: number;
  costFt: number;
  path: Point[];
}

export interface Planner {
  state: CombatState;
  ctx: CombatContext;
  opts: AiOptions;
  id: string;
  actor: Creature;
  token: GridToken;
  hostiles: string[];
  pathOpts: PathOptions;
}

const centerOf = (t: Pick<GridToken, 'x' | 'y' | 'size'>): Point => ({ x: t.x + footprintSize(t.size) / 2, y: t.y + footprintSize(t.size) / 2 });
const at = (p: Planner, d: Point): GridToken => ({ ...p.token, x: d.x, y: d.y });

export function movedState(p: Planner, d: Point): CombatState {
  if (d.x === p.token.x && d.y === p.token.y) return p.state;
  const grid = cloneGridTokens(p.state.grid);
  moveToken(grid, p.id, d);
  return { ...p.state, grid };
}

export function destinations(p: Planner, budgetFt: number): Dest[] {
  const out: Dest[] = [{ x: p.token.x, y: p.token.y, costFt: 0, path: [] }];
  if (budgetFt > 0) {
    const reach = [...reachableSquares(p.state.grid, p.id, budgetFt, p.pathOpts).values()];
    reach.sort((a, b) => a.costFt - b.costFt || a.y - b.y || a.x - b.x);
    out.push(...reach.map((r) => ({ x: r.x, y: r.y, costFt: r.costFt, path: r.path })));
  }
  return out;
}

/** Expected damage the mover takes from Opportunity Attacks along a path. */
export function oaCost(p: Planner, path: readonly Point[], budgetFt: number, disengaged: boolean): number {
  if (path.length === 0 || disengaged) return 0;
  const db = dbOf(p.ctx);
  const plan = planMove(p.state.grid, p.id, path, {
    ...p.pathOpts,
    budgetFt,
    reachOf: (x) => {
      const c = p.state.creatures[x];
      return c ? meleeReach(c, db) : 0;
    },
    canReact: (x) => {
      const c = p.state.creatures[x];
      return !!c && !isDown(c) && canReact(p.state.turns, x, c, p.ctx.table) && canMakeOpportunityAttacks(c) && meleeReach(c, db) > 0;
    },
  });
  let cost = 0;
  for (const t of plan.triggers) {
    const c = p.state.creatures[t.attackerId];
    if (!c) continue;
    cost += Math.max(0, ...attackProfiles(c, db).filter((x) => x.melee).map((x) => roughAttackDamage(x, p.actor)));
  }
  return cost;
}

/** Conscious hostiles able to act that threaten (are within reach of) a square. */
export function threatsAt(p: Planner, d: Point): number {
  const db = dbOf(p.ctx);
  const me = at(p, d);
  return p.hostiles.filter((h) => {
    const c = p.state.creatures[h];
    const t = p.state.grid.tokens[h];
    return !!c && !!t && !isDown(c) && canAct(c, p.ctx.table) && distanceFt(me, t) <= Math.max(5, meleeReach(c, db));
  }).length;
}

// ---------------------------------------------------------------- options

interface AttackOption {
  targetId: string;
  dest: Dest;
  attacks: { profileId: string; expected: number }[];
  expected: number;
  score: number;
  bonusDisengage: boolean;
}

/** The Attack action on `targetId` from square `dest`: best profile per slot by expected damage. */
export function attackAt(p: Planner, targetId: string, dest: Point, slots: readonly AttackProfile[][]): { attacks: { profileId: string; expected: number }[]; expected: number } | undefined {
  const target = p.state.creatures[targetId];
  if (!target) return undefined;
  const hyp = movedState(p, dest);
  const attacks: { profileId: string; expected: number }[] = [];
  let expected = 0;
  for (const slot of slots) {
    let pick: { profileId: string; expected: number } | undefined;
    for (const prof of slot) {
      const e = expectedAttackDamage(prof, checkAttack(hyp, p.ctx, p.id, targetId, prof), target);
      if (e > 0 && (!pick || e > pick.expected)) pick = { profileId: prof.id, expected: e };
    }
    if (pick) {
      attacks.push(pick);
      expected += pick.expected;
    }
  }
  return attacks.length ? { attacks, expected } : undefined;
}

function bestAttackOn(p: Planner, targetId: string, dests: readonly Dest[], slots: readonly AttackProfile[][], budgetFt: number, rangedMind: boolean, canBonusDisengage: boolean, disengaged: boolean): AttackOption | undefined {
  const target = p.state.creatures[targetId];
  const tt = p.state.grid.tokens[targetId];
  if (!target || !tt) return undefined;
  const maxRange = Math.max(0, ...slots.flat().map((x) => (x.melee ? x.reach : (x.range?.long ?? x.range?.normal ?? 5))));
  let best: AttackOption | undefined;
  for (const dest of dests) {
    if (distanceFt(at(p, dest), tt) > maxRange) continue;
    const a = attackAt(p, targetId, dest, slots);
    if (!a) continue;
    const { attacks, expected } = a;
    const oa = oaCost(p, dest.path, budgetFt, disengaged);
    const useBonus = oa > 0 && canBonusDisengage;
    const threat = rangedMind ? threatsAt(p, dest) * AI_TUNING.rangedThreatPenalty : 0;
    const score = expected - (useBonus ? 0 : oa) - threat - dest.costFt * 0.001;
    if (!best || score > best.score + 1e-9) best = { targetId, dest, attacks, expected, score, bonusDisengage: useBonus };
  }
  return best;
}

interface AreaOption {
  action: MonsterAction;
  dest: Dest;
  aim: Point;
  hostiles: string[];
  expected: number;
  score: number;
}

function bestArea(p: Planner, dests: readonly Dest[], budgetFt: number, disengaged: boolean): AreaOption | undefined {
  let best: AreaOption | undefined;
  for (const action of areaActions(p.actor, p.ctx)) {
    const save = action.save!;
    const area = save.area!;
    for (const dest of dests) {
      const hyp = movedState(p, dest);
      const aims = area.shape === 'emanation' ? [centerOf(at(p, dest))] : p.hostiles.map((h) => centerOf(hyp.grid.tokens[h]!));
      let oa: number | undefined;
      for (const aim of aims) {
        const tpl = area.shape === 'emanation' ? templateFromCaster(hyp.grid, p.id, area) : templateFromCaster(hyp.grid, p.id, area, aim);
        const ids = previewArea(hyp.grid, tpl, { excludeIds: [p.id] }).creatureIds.filter((x) => {
          const c = hyp.creatures[x];
          return !!c && !c.dead;
        });
        if (ids.some((x) => !areHostile(hyp, p.ctx, p.id, x))) continue;
        const hit = ids.filter((x) => !isDown(hyp.creatures[x]!)).sort();
        if (hit.length === 0) continue;
        const expected = hit.reduce((s, x) => s + expectedSaveDamage(save.damage!, hyp.creatures[x]!, save.ability, save.dc, save.halfOnSuccess), 0);
        oa ??= oaCost(p, dest.path, budgetFt, disengaged);
        const score = expected - oa - dest.costFt * 0.001;
        if (!best || hit.length > best.hostiles.length || (hit.length === best.hostiles.length && score > best.score + 1e-9)) {
          best = { action, dest, aim, hostiles: hit, expected, score };
        }
      }
    }
  }
  return best;
}

// ---------------------------------------------------------------- flee and approach

export function minHostileDistance(p: Planner, d: Point): number {
  const me = at(p, d);
  let min = Infinity;
  for (const h of p.hostiles) {
    const c = p.state.creatures[h];
    const t = p.state.grid.tokens[h];
    if (c && t && !isDown(c)) min = Math.min(min, distanceFt(me, t));
  }
  return min;
}

function planFlee(p: Planner, prefix: AiStep[], budgetFt: number, reason: string): AiPlan | undefined {
  const b = p.state.turns.budgets[p.id]!;
  const bonus = bonusMobility(p.actor, p.ctx);
  const speed = effectiveSpeed(p.actor, p.ctx.table);
  type Choice = { steps: AiStep[]; budget: number; disengaged: boolean };
  const choices: Choice[] = [];
  if (b.bonusAction && bonus.disengage && b.action) choices.push({ steps: [{ kind: 'disengage', bonus: true }, { kind: 'dash' }], budget: budgetFt + speed, disengaged: true });
  if (b.action) {
    choices.push({ steps: [{ kind: 'dash' }], budget: budgetFt + speed, disengaged: b.disengaged });
    choices.push({ steps: [{ kind: 'disengage' }], budget: budgetFt, disengaged: true });
  }
  choices.push({ steps: [], budget: budgetFt, disengaged: b.disengaged });
  const here = minHostileDistance(p, p.token);
  let best: { key: number[]; steps: AiStep[] } | undefined;
  for (const ch of choices) {
    for (const d of destinations(p, ch.budget)) {
      if (d.path.length === 0) continue;
      const oa = oaCost(p, d.path, ch.budget, ch.disengaged);
      const key = [oa > 0 ? 1 : 0, -minHostileDistance(p, d), oa, d.costFt, ch.steps.length];
      if (!best || lexLess(key, best.key)) best = { key, steps: [...ch.steps, { kind: 'move', path: d.path }] };
    }
  }
  if (!best || -best.key[1]! <= here) return undefined;
  return { actorId: p.id, intent: 'flee', steps: [...prefix, ...best.steps], reason: `flees (${reason})` };
}

export function lexLess(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! < b[i]!;
  return false;
}

export function planApproach(p: Planner, prefix: AiStep[], budgetFt: number, rangedMind: boolean, slots: readonly AttackProfile[][]): AiPlan {
  const db = dbOf(p.ctx);
  const b = p.state.turns.budgets[p.id]!;
  const cands: TargetCandidate[] = p.hostiles
    .filter((h) => !isDown(p.state.creatures[h]!))
    .map((h) => ({ id: h, creature: p.state.creatures[h]!, distanceFt: distanceFt(p.token, p.state.grid.tokens[h]!) }));
  const pool = cands.length ? cands : p.hostiles.map((h) => ({ id: h, creature: p.state.creatures[h]!, distanceFt: distanceFt(p.token, p.state.grid.tokens[h]!) }));
  const target = rankTargets(p.actor, pool, { db, ...(p.ctx.table && { table: p.ctx.table }) })[0];
  const defend: AiPlan = { actorId: p.id, intent: 'defend', steps: b.action ? [...prefix, { kind: 'dodge' }] : prefix, reason: 'no way to reach an enemy: Dodges' };
  if (!target) return defend;
  const tt = p.state.grid.tokens[target.id]!;
  const dashFt = b.action ? movementLeft(addDash(p.state.turns, p.id), p.id, p.actor, { ...(p.ctx.table && { table: p.ctx.table }) }) - (movementLeft(p.state.turns, p.id, p.actor, { ...(p.ctx.table && { table: p.ctx.table }) }) - budgetFt) : budgetFt;
  const normal = Math.max(5, ...slots.flat().filter((x) => !x.melee).map((x) => x.range?.normal ?? 5));
  let best: { key: number[]; d: Dest } | undefined;
  for (const d of destinations(p, dashFt)) {
    const dist = distanceFt(at(p, d), tt);
    const oa = oaCost(p, d.path, dashFt, b.disengaged);
    const key = rangedMind ? [dist > normal ? dist : 0, dist <= normal ? -dist : 0, oa, d.costFt] : [dist, oa, d.costFt];
    if (!best || lexLess(key, best.key)) best = { key, d };
  }
  if (!best || best.d.path.length === 0) return defend;
  const needDash = best.d.costFt > budgetFt;
  return {
    actorId: p.id,
    intent: 'approach',
    targetId: target.id,
    steps: [...prefix, ...(needDash ? [{ kind: 'dash' } as AiStep] : []), { kind: 'move', path: best.d.path }],
    reason: `closes in on ${target.creature.name}${needDash ? ' (Dash)' : ''}`,
  };
}

// ---------------------------------------------------------------- planTurn

export const idle = (actorId: string, reason: string): AiPlan => ({ actorId, intent: 'idle', steps: [], reason });

export interface TurnSetup {
  p: Planner;
  /** Steps every plan starts with (stand up from Prone). */
  prefix: AiStep[];
  /** Movement left after the prefix. */
  budgetFt: number;
}

/**
 * Shared start of a turn plan: idle when down / can't act / no enemies; stands up from Prone when
 * movement allows. Returns the planning context, or the idle plan.
 */
export function setupTurn(state: CombatState, ctx: CombatContext, actorId: string, opts: AiOptions = {}): TurnSetup | AiPlan {
  let actor = state.creatures[actorId];
  const token = state.grid.tokens[actorId];
  const b = state.turns.budgets[actorId];
  if (!actor || !token || !b || isDown(actor)) return idle(actorId, 'is down');
  if (!canAct(actor, ctx.table)) return idle(actorId, "can't act");
  const hostiles = Object.keys(state.creatures)
    .filter((h) => areHostile(state, ctx, actorId, h) && !state.creatures[h]!.dead && state.grid.tokens[h])
    .sort();
  if (hostiles.length === 0) return idle(actorId, 'has no enemies left');

  const tableOpt = ctx.table ? { table: ctx.table } : {};
  let budgetFt = movementLeft(state.turns, actorId, actor, tableOpt);
  const prefix: AiStep[] = [];
  let base = state;
  if (hasCondition(actor, 'prone', ctx.table)) {
    const cost = standUpCost(actor, ctx.table);
    if (cost !== null && cost <= budgetFt) {
      prefix.push({ kind: 'stand' });
      budgetFt -= cost;
      actor = removeCondition(actor, 'prone');
      base = withCreature(state, actor);
    } else budgetFt = 0;
  }
  const p: Planner = {
    state: base,
    ctx,
    opts,
    id: actorId,
    actor,
    token,
    hostiles,
    pathOpts: {
      isHostile: (a, x) => areHostile(base, ctx, a, x),
      isIncapacitated: (x) => {
        const c = base.creatures[x];
        return !!c && (c.dead || !canAct(c, ctx.table));
      },
    },
  };
  return { p, prefix, budgetFt };
}

/** Decide the whole turn for `actorId` (whose turn must have started). Pure. */
export function planTurn(state: CombatState, ctx: CombatContext, actorId: string, opts: AiOptions = {}): AiPlan {
  const db = dbOf(ctx);
  const setup = setupTurn(state, ctx, actorId, opts);
  if ('intent' in setup) return setup;
  const { p, prefix, budgetFt } = setup;
  const { actor, token, state: base, hostiles } = p;
  const b = state.turns.budgets[actorId]!;
  const tableOpt = ctx.table ? { table: ctx.table } : {};

  const morale = moraleCheck(base, ctx, actorId, opts);
  if (morale.flee) {
    const f = planFlee(p, prefix, budgetFt, morale.reason);
    if (f) return f;
  }
  if (!b.action) return { ...idle(actorId, 'has already used its action'), steps: prefix };

  const slots = attackSlots(actor, ctx);
  const rangedMind = prefersRange(slots.flat());
  const dests = destinations(p, budgetFt);
  const bonusDis = b.bonusAction && bonusMobility(actor, ctx).disengage && !b.disengaged;

  const visible = hostiles.filter((h) => canSee(base, ctx, actor, base.creatures[h]!));
  const options = new Map<string, AttackOption>();
  if (slots.length) {
    for (const h of visible) {
      const o = bestAttackOn(p, h, dests, slots, budgetFt, rangedMind, bonusDis, b.disengaged);
      if (o) options.set(h, o);
    }
  }
  const cands = (ids: string[]): TargetCandidate[] => ids.map((h) => ({ id: h, creature: base.creatures[h]!, distanceFt: distanceFt(token, base.grid.tokens[h]!) }));
  const worthwhile = [...options.values()].filter((o) => o.score > 0).map((o) => o.targetId);
  const ranked = rankTargets(actor, cands(worthwhile.length ? worthwhile : [...options.keys()]), { db, ...tableOpt });
  const attack = ranked[0] ? options.get(ranked[0].id) : undefined;

  const area = bestArea(p, dests, budgetFt, b.disengaged);
  if (area && (area.hostiles.length >= 2 || !attack || area.expected > attack.expected)) {
    return {
      actorId,
      intent: 'area',
      targetId: area.hostiles[0]!,
      steps: [...prefix, ...(area.dest.path.length ? [{ kind: 'move', path: area.dest.path } as AiStep] : []), { kind: 'area', actionName: area.action.name, aim: area.aim }],
      reason: `uses ${area.action.name} on ${area.hostiles.map((h) => base.creatures[h]!.name).join(', ')}`,
      expected: area.expected,
    };
  }
  if (attack) {
    const target = base.creatures[attack.targetId]!;
    return {
      actorId,
      intent: 'attack',
      targetId: attack.targetId,
      steps: [
        ...prefix,
        ...(attack.bonusDisengage ? [{ kind: 'disengage', bonus: true } as AiStep] : []),
        ...(attack.dest.path.length ? [{ kind: 'move', path: attack.dest.path } as AiStep] : []),
        ...attack.attacks.map((a): AiStep => ({ kind: 'attack', profileId: a.profileId, targetId: attack.targetId })),
      ],
      reason: `attacks ${target.name}`,
      expected: attack.expected,
    };
  }
  return planApproach(p, prefix, budgetFt, rangedMind, slots);
}

// ---------------------------------------------------------------- execution

/** Best attack now (current positions) with any of the actor's profiles, by target preference. */
function fallbackAttack(state: CombatState, ctx: CombatContext, id: string): { profileId: string; targetId: string } | undefined {
  const actor = state.creatures[id];
  const token = state.grid.tokens[id];
  if (!actor || !token) return undefined;
  const db = dbOf(ctx);
  const profiles = attackProfiles(actor, db);
  const picks = new Map<string, { profileId: string; expected: number }>();
  for (const h of Object.keys(state.creatures).sort()) {
    const c = state.creatures[h]!;
    if (c.dead || !areHostile(state, ctx, id, h) || !state.grid.tokens[h]) continue;
    for (const prof of profiles) {
      const e = expectedAttackDamage(prof, checkAttack(state, ctx, id, h, prof), c);
      const cur = picks.get(h);
      if (e > 0 && (!cur || e > cur.expected)) picks.set(h, { profileId: prof.id, expected: e });
    }
  }
  const ranked = rankTargets(
    actor,
    [...picks.keys()].map((h) => ({ id: h, creature: state.creatures[h]!, distanceFt: distanceFt(token, state.grid.tokens[h]!) })),
    { db, ...(ctx.table && { table: ctx.table }) },
  );
  const first = ranked[0];
  return first ? { profileId: picks.get(first.id)!.profileId, targetId: first.id } : undefined;
}

function useArea(state: CombatState, ctx: CombatContext, id: string, actionName: string, aim: Point): ActionResult | undefined {
  const actor = state.creatures[id]!;
  const m = actor.statBlockId ? dbOf(ctx).monsters.get(actor.statBlockId) : undefined;
  const action = m?.actions.find((a) => a.name === actionName);
  const save = action?.save;
  if (!action || !save?.area || !save.damage || !actionAvailable(actor, action)) return undefined;
  const me = state.grid.tokens[id]!;
  const c = centerOf(me);
  if (save.area.shape !== 'emanation' && Math.abs(aim.x - c.x) < 1e-9 && Math.abs(aim.y - c.y) < 1e-9) return undefined;
  const tpl = save.area.shape === 'emanation' ? templateFromCaster(state.grid, id, save.area) : templateFromCaster(state.grid, id, save.area, aim);
  const ids = previewArea(state.grid, tpl, { excludeIds: [id] }).creatureIds.filter((x) => state.creatures[x] && !state.creatures[x]!.dead);
  if (ids.length === 0 || ids.some((x) => !areHostile(state, ctx, id, x))) return undefined;
  const paid = spend(state.turns, id, 'action', actor, ctx.table);
  if (!paid.ok) return undefined;
  const next = { ...withCreature(state, spendAction(actor, action)), turns: paid.state };
  const r = resolveAreaEffect(next, ctx, { casterId: id, template: tpl, label: action.name, save: { ability: save.ability, dc: save.dc }, damage: save.damage, halfOnSave: save.halfOnSuccess, excludeIds: [id] });
  if (!r.ok) return undefined;
  return { ok: true, state: r.state, events: [{ kind: 'action', actorId: id, text: `${actor.name} uses ${action.name}!` }, ...r.events] };
}

function oaProfileFor(state: CombatState, ctx: CombatContext, moverId: string) {
  return (attackerId: string): string | undefined => {
    const a = state.creatures[attackerId];
    const t = state.creatures[moverId];
    if (!a || !t) return undefined;
    let best: { id: string; e: number } | undefined;
    for (const prof of attackProfiles(a, dbOf(ctx)).filter((x) => x.melee)) {
      const e = roughAttackDamage(prof, t);
      if (!best || e > best.e) best = { id: prof.id, e };
    }
    return best?.id;
  };
}

/**
 * Carry out a plan with the normal action functions. Failed steps are logged and skipped; attacks
 * whose target is gone or out of reach are re-targeted; everything stops if the actor drops.
 */
export function executePlan(state: CombatState, ctx: CombatContext, plan: AiPlan, opts: AiOptions = {}): ActionResult<{ plan: AiPlan; halted: boolean }> {
  const id = plan.actorId;
  const name = state.creatures[id]?.name ?? id;
  const events: CombatEvent[] = [{ kind: 'info', actorId: id, text: `${name} ${plan.reason}.` }];
  let cur = state;
  let halted = false;
  const note = (text: string) => events.push({ kind: 'info', actorId: id, text });
  for (const step of plan.steps) {
    const actor = cur.creatures[id];
    if (!actor || isDown(actor) || !canAct(actor, ctx.table)) {
      halted = true;
      note(`${name} can no longer act.`);
      break;
    }
    switch (step.kind) {
      case 'stand': {
        const r = standUp(cur.turns, id, actor, ctx.table);
        if (!r.ok) note(r.error);
        else {
          cur = { ...withCreature(cur, r.creature), turns: r.state };
          events.push({ kind: 'move', actorId: id, text: `${name} stands up (${r.costFt} ft).` });
        }
        break;
      }
      case 'move': {
        const r = moveCreature(cur, ctx, id, step.path, { oaProfile: oaProfileFor(cur, ctx, id), ...(opts.takeOpportunity && { takeOpportunity: opts.takeOpportunity }) });
        if (!r.ok) note(r.error);
        events.push(...r.events);
        cur = r.state;
        if (r.ok && r.halted) halted = true;
        break;
      }
      case 'dash':
      case 'disengage':
      case 'dodge': {
        const fn = step.kind === 'dash' ? dash : step.kind === 'disengage' ? disengage : dodge;
        const r = fn(cur, ctx, id, { ...('bonus' in step && step.bonus && { bonus: true }) });
        if (!r.ok) note(r.error);
        events.push(...r.events);
        cur = r.state;
        break;
      }
      case 'attack': {
        const target = cur.creatures[step.targetId];
        let pick: { profileId: string; targetId: string } | undefined = { profileId: step.profileId, targetId: step.targetId };
        if (!target || isDown(target) || !cur.grid.tokens[step.targetId]) pick = fallbackAttack(cur, ctx, id);
        let r = pick ? resolveAttack(cur, ctx, { attackerId: id, targetId: pick.targetId, profile: pick.profileId, kind: 'action' }) : undefined;
        if (r && !r.ok) {
          const alt = fallbackAttack(cur, ctx, id);
          r = alt ? resolveAttack(cur, ctx, { attackerId: id, targetId: alt.targetId, profile: alt.profileId, kind: 'action' }) : r;
        }
        if (!r) note(`${name} has no one to attack.`);
        else if (!r.ok) note(r.error);
        else {
          events.push(...r.events);
          cur = r.state;
        }
        break;
      }
      case 'cast':
      case 'feature': {
        const r =
          step.kind === 'cast'
            ? castInCombat(cur, ctx, { casterId: id, spellId: step.spellId, targetIds: step.targetIds, ...(step.slot && { slot: step.slot }) })
            : featureInCombat(cur, ctx, { actorId: id, actionId: step.actionId, ...(step.targetId && { targetId: step.targetId }), ...(step.choice && { choice: step.choice }) });
        if (!r.ok) note(r.error);
        events.push(...r.events);
        cur = r.state;
        break;
      }
      case 'area': {
        const r = useArea(cur, ctx, id, step.actionName, step.aim);
        if (r) {
          events.push(...r.events);
          cur = r.state;
          break;
        }
        // The area would now catch an ally or nothing: fall back to the Attack action.
        note(`${name} holds its ${step.actionName}.`);
        const n = Math.max(1, attackSlots(actor, ctx).length);
        for (let i = 0; i < n; i++) {
          const alt = fallbackAttack(cur, ctx, id);
          const a = alt ? resolveAttack(cur, ctx, { attackerId: id, targetId: alt.targetId, profile: alt.profileId, kind: 'action' }) : undefined;
          if (!a || !a.ok) break;
          events.push(...a.events);
          cur = a.state;
        }
        break;
      }
    }
  }
  return { ok: true, state: cur, events, plan, halted };
}

/** Plan and play the current creature's turn (its turn must have been started with startTurn/nextTurn). */
export function takeAiTurn(state: CombatState, ctx: CombatContext, actorId: string, opts: AiOptions = {}): ActionResult<{ plan: AiPlan; halted: boolean }> {
  return executePlan(state, ctx, planTurn(state, ctx, actorId, opts), opts);
}
