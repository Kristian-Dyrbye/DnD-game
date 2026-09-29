/**
 * Resolving an area effect against everyone in its template (Build Prompt §10; SRD 5.2.1 "Damage
 * Rolls": "When you create a damaging effect that forces two or more targets to make saving throws
 * against it at the same time, roll the damage once for all the targets.").
 *
 * - One shared damage roll; each target saves with every combat mode source (`combatSave`: conditions,
 *   effects, features, Dodge advantage on Dex saves) plus the Dex-save bonus of cover against the
 *   point of origin (half +2, three-quarters +5; walls/low obstacles only by default — creatures in
 *   the way don't shield from a blast unless `creaturesGiveCover`).
 * - Failed save → full damage (+ optional condition); success → half (rounded down per damage type)
 *   when `halfOnSave`, else nothing. No `save` → everyone takes full damage.
 * - Damage goes through `dealCombatDamage` (resistances, 0 HP, concentration...).
 * Generic: spells, breath weapons, traps and zone ticks (A064a) all call this.
 * Not modelled yet: Evasion-style "no damage on success", per-target overrides.
 */
import type { Creature } from '../core/creature';
import { formatD20Test, type Modifier } from '../core/dice';
import type { Damage } from '../data/common';
import type { Ability, Condition } from '../rules/basics';
import type { D20TestResult } from '../rules/checks';
import { applyCondition } from '../rules/conditions';
import { rollDamage, type DamageRollResult } from '../rules/damage';
import { combatSave } from './saves';
import { dealCombatDamage } from './attack';
import { previewArea, type AoeTemplate } from './aoe';
import { withCreature, type ActionResult, type CombatContext, type CombatEvent, type CombatState } from './combatState';
import type { GridToken, Point } from './grid';
import { computeCover, type CoverGrade } from './los';

export interface AreaEffectOptions {
  /** Creature creating the effect (damage source, condition source); may be absent for traps. */
  casterId?: string;
  template: AoeTemplate;
  /** Name for the log ("Fireball"). */
  label?: string;
  save?: { ability: Ability; dc: number };
  damage?: Damage[];
  /** Half damage on a successful save (default true). */
  halfOnSave?: boolean;
  conditionOnFail?: { condition: Condition; roundsLeft?: number; endSave?: { ability: Ability; dc: number } };
  /** Source id stamped on the condition (default: the caster), e.g. `<caster>:<spell>` for concentration. */
  conditionSourceId?: string;
  /** Override the affected creatures (e.g. the player unticked an ally in the preview). */
  targetIds?: readonly string[];
  /** Creatures never affected (e.g. a caster that chose to exclude itself). */
  excludeIds?: readonly string[];
  /** Creatures between the origin and a target give half cover (default false). */
  creaturesGiveCover?: boolean;
}

export interface AreaTargetOutcome {
  id: string;
  save?: D20TestResult;
  cover: CoverGrade;
  damage: number;
}

export interface AreaEffectOutcome {
  squares: Point[];
  targets: AreaTargetOutcome[];
  damageRoll?: DamageRollResult;
}

/** Add a flat bonus (cover) to a finished save result, recomputing total, success and text. */
export function addSaveBonus(r: D20TestResult, mod: Modifier): D20TestResult {
  if (mod.value === 0) return r;
  const modifiers = [...r.modifiers, mod];
  const total = r.total + mod.value;
  const success = r.autoFail ? false : r.target ? total >= r.target.value : undefined;
  const outcome = r.autoFail ? `Automatic failure (${r.autoFail})` : success === undefined ? undefined : success ? 'Success' : 'Failure';
  return {
    ...r,
    modifiers,
    total,
    ...(success !== undefined && { success }),
    text: formatD20Test({ d20: r.d20, modifiers, total, ...(r.target && { target: r.target }), ...(outcome && { outcome }) }),
  };
}

/** 1×1 footprint (or the emanation's anchor) that cover is measured from. */
function originFootprint(state: CombatState, tpl: AoeTemplate): Pick<GridToken, 'x' | 'y' | 'size'> {
  if (tpl.shape === 'emanation' && tpl.anchorId !== undefined) {
    const t = state.grid.tokens[tpl.anchorId];
    if (t) return t;
  }
  const sq = tpl.originSquare ?? { x: Math.floor(tpl.origin.x), y: Math.floor(tpl.origin.y) };
  return { x: sq.x, y: sq.y, size: 'medium' };
}

export function resolveAreaEffect(state: CombatState, ctx: CombatContext, o: AreaEffectOptions): ActionResult<AreaEffectOutcome> {
  const label = o.label ?? 'Area effect';
  const source = o.casterId ?? label;
  const preview = previewArea(state.grid, o.template, { ...(o.excludeIds && { excludeIds: o.excludeIds }) });
  const exclude = new Set(o.excludeIds ?? []);
  const ids = (o.targetIds ?? preview.creatureIds).filter((id) => !exclude.has(id) && state.creatures[id] && !state.creatures[id]!.dead);
  const events: CombatEvent[] = [];
  const casterName = o.casterId ? state.creatures[o.casterId]?.name : undefined;
  events.push({
    kind: 'effect',
    ...(o.casterId && { actorId: o.casterId }),
    text: `${casterName ? `${casterName}: ` : ''}${label} (${o.template.sizeFt}-ft ${o.template.shape}) — ${ids.length} creature${ids.length === 1 ? '' : 's'} in the area`,
  });
  const damageRoll = o.damage?.length ? rollDamage(ctx.rng, o.damage) : undefined;
  if (damageRoll) events.push({ kind: 'effect', ...(o.casterId && { actorId: o.casterId }), text: `${label} damage (rolled once for all targets): ${damageRoll.text}` });

  const from = originFootprint(state, o.template);
  let next = state;
  const targets: AreaTargetOutcome[] = [];
  for (const id of ids) {
    const c = next.creatures[id] as Creature;
    let cover: CoverGrade = 'none';
    let save: D20TestResult | undefined;
    if (o.save) {
      if (o.save.ability === 'dex') {
        const cr = computeCover(next.grid, from, id, { creaturesGiveCover: o.creaturesGiveCover ?? false, ...(o.casterId && { ignoreIds: [o.casterId] }) });
        if (cr.cover === 'half' || cr.cover === 'three_quarters') cover = cr.cover;
      }
      save = combatSave(next, ctx, id, o.save.ability, o.save.dc);
      if (cover !== 'none') save = addSaveBonus(save, { value: cover === 'half' ? 2 : 5, label: cover === 'half' ? 'Half Cover' : 'Three-Quarters Cover' });
      events.push({ kind: 'save', targetId: id, text: `${c.name} ${save.label}: ${save.text}` });
    }
    const failed = !save || !save.success;
    let dealt = 0;
    if (damageRoll && (failed || (o.halfOnSave ?? true))) {
      const half = !failed;
      const instances = damageRoll.parts.map((p) => ({ type: p.type, amount: half ? Math.floor(p.total / 2) : p.total }));
      const r = dealCombatDamage(next, ctx, source, id, instances, { text: `${label}${half ? ' (half)' : ''}` });
      next = r.state;
      events.push(...r.events);
      dealt = r.dealt;
    }
    if (failed && o.conditionOnFail) {
      const target = next.creatures[id] as Creature;
      if (!target.dead) {
        const cf = o.conditionOnFail;
        const res = applyCondition(
          target,
          {
            condition: cf.condition,
            ...((o.conditionSourceId ?? o.casterId) && { sourceId: o.conditionSourceId ?? o.casterId }),
            ...(cf.roundsLeft !== undefined && { roundsLeft: cf.roundsLeft }),
            ...(cf.endSave && { endSave: cf.endSave }),
          },
          ctx.table,
        );
        next = withCreature(next, res.creature);
        events.push({ kind: 'condition', targetId: id, text: res.applied ? `${target.name} has the ${cf.condition} condition (${label})` : `${target.name} is immune to ${cf.condition}` });
      }
    }
    targets.push({ id, ...(save && { save }), cover, damage: dealt });
  }
  return { ok: true, state: next, events, squares: preview.squares, targets, ...(damageRoll && { damageRoll }) };
}
