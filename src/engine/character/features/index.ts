/**
 * Feature registry and queries. activeFeatures() returns the implementations a character has
 * (by class level and subclass); the query helpers merge every active feature's hooks so other
 * modules ask one question ("what are my Dex save modes?") without knowing about classes.
 */
import type { Character, Creature, Resource } from '../../core/creature';
import type { Rng } from '../../core/rng';
import type { SrdDatabase } from '../../data/srd';
import type { Ability, Condition, DamageType, Skill } from '../../rules/basics';
import type { WeaponAttack } from '../derived';
import { featureLevels } from '../featureLevels';
import { barbarianFeatures } from './barbarian';
import { bardFeatures } from './bard';
import { clericFeatures } from './cleric';
import { druidFeatures } from './druid';
import { fighterFeatures } from './fighter';
import { monkFeatures } from './monk';
import { paladinFeatures } from './paladin';
import { rangerFeatures } from './ranger';
import type { FeatureAction, FeatureActionParams, FeatureActionResult, FeatureImpl, Modes, SpellOptions, WeaponHitContext, WeaponHitRider } from './types';

export const ALL_FEATURES: FeatureImpl[] = [...barbarianFeatures, ...bardFeatures, ...clericFeatures, ...druidFeatures, ...fighterFeatures, ...monkFeatures, ...paladinFeatures, ...rangerFeatures];

/** Lowest class level at which an owner (class or subclass) grants a feature id, from the SRD data. */
function grantLevel(db: SrdDatabase, owner: string, featureId: string): number | undefined {
  const list = db.classes.get(owner)?.features ?? db.subclasses.get(owner)?.features ?? [];
  const f = list.find((x) => x.id === featureId);
  return f ? Math.min(...featureLevels(f)) : undefined;
}

export function activeFeatures(c: Character, db: SrdDatabase): FeatureImpl[] {
  const out: FeatureImpl[] = [];
  for (const cl of c.classes) {
    for (const impl of ALL_FEATURES) {
      if (impl.owner !== cl.classId && impl.owner !== cl.subclassId) continue;
      const lvl = grantLevel(db, impl.owner, impl.id);
      if (lvl !== undefined && lvl <= cl.level) out.push(impl);
    }
  }
  return out;
}

/** Feature ids gained at exactly this class level (for onGain). */
export function featuresGainedAt(db: SrdDatabase, classId: string, subclassId: string | undefined, classLevel: number): FeatureImpl[] {
  return ALL_FEATURES.filter((impl) => {
    if (impl.owner !== classId && impl.owner !== subclassId) return false;
    const list = db.classes.get(impl.owner)?.features ?? db.subclasses.get(impl.owner)?.features ?? [];
    const f = list.find((x) => x.id === impl.id);
    return f ? featureLevels(f).includes(classLevel) && Math.min(...featureLevels(f)) === classLevel : false;
  });
}

const merge = (parts: Partial<Modes>[]): Modes => ({
  advantage: parts.flatMap((p) => p.advantage ?? []),
  disadvantage: parts.flatMap((p) => p.disadvantage ?? []),
});

export const featureSaveModes = (c: Character, db: SrdDatabase, ability: Ability): Modes =>
  merge(activeFeatures(c, db).map((f) => f.saveModes?.(c, ability) ?? {}));

export const featureCheckModes = (c: Character, db: SrdDatabase, ability: Ability, skill?: Skill): Modes =>
  merge(activeFeatures(c, db).map((f) => f.checkModes?.(c, ability, skill) ?? {}));

export const featureCheckBonuses = (c: Character, db: SrdDatabase, ability: Ability, skill?: Skill) =>
  activeFeatures(c, db).flatMap((f) => f.checkBonus?.(c, ability, skill) ?? []);

export const featureInitiativeModes = (c: Character, db: SrdDatabase): Modes =>
  merge(activeFeatures(c, db).map((f) => f.initiativeModes?.(c) ?? {}));

export const featureAttackModes = (c: Character, db: SrdDatabase, attack: { melee: boolean; ability: Ability }): Modes =>
  merge(activeFeatures(c, db).map((f) => f.attackModes?.(c, attack) ?? {}));

export const featureAttackedModes = (c: Character, db: SrdDatabase, attackerIsMelee: boolean): Modes =>
  merge(activeFeatures(c, db).map((f) => f.attackedModes?.(c, attackerIsMelee) ?? {}));

export const featureResistances = (c: Character, db: SrdDatabase): DamageType[] => [...new Set(activeFeatures(c, db).flatMap((f) => f.resistances?.(c) ?? []))];

export const featureConditionImmunities = (c: Character, db: SrdDatabase): Condition[] => [
  ...new Set(activeFeatures(c, db).flatMap((f) => f.conditionImmunities?.(c) ?? [])),
];

export function weaponHitRiders(c: Character, db: SrdDatabase, ctx: WeaponHitContext): WeaponHitRider[] {
  return activeFeatures(c, db).flatMap((f) => {
    const r = f.onWeaponHit?.(c, db, ctx);
    return r ? [r] : [];
  });
}

/** Merged spell options from features for a spell cast at `slotLevel` (0 for cantrips). */
export function spellOptions(c: Character, db: SrdDatabase, spell: { level: number; healing: boolean; damaging: boolean }, slotLevel: number): SpellOptions {
  const out: SpellOptions = {};
  for (const f of activeFeatures(c, db)) {
    const o = f.spellOptions?.(c, spell, slotLevel);
    if (!o) continue;
    if (o.healBonus) out.healBonus = (out.healBonus ?? 0) + o.healBonus;
    if (o.maxHealDice) out.maxHealDice = true;
    if (o.cantripDamageBonus) out.cantripDamageBonus = (out.cantripDamageBonus ?? 0) + o.cantripDamageBonus;
  }
  return out;
}

/** Lowest natural roll that scores a critical hit for this character (default 20). */
export function critOn(c: Character, db: SrdDatabase): number {
  return Math.min(20, ...activeFeatures(c, db).map((f) => f.critOn?.(c) ?? 20));
}

/** Weapon attack profile with every feature adjustment applied. */
export function featureWeaponAttack(c: Character, db: SrdDatabase, attack: WeaponAttack): WeaponAttack {
  return activeFeatures(c, db).reduce((a, f) => f.modifyAttack?.(c, db, a) ?? a, attack);
}

export const featureSaveBonuses = (c: Character, db: SrdDatabase) => activeFeatures(c, db).flatMap((f) => f.saveBonus?.(c) ?? []);

export function canCastSpells(c: Character, db: SrdDatabase): boolean {
  return !activeFeatures(c, db).some((f) => f.blocksSpellcasting?.(c));
}

/** Resource pools from features. Existing current values are kept (capped at the new max); new pools start full. */
export function syncResources(c: Character, db: SrdDatabase): Character {
  const next: Record<string, Resource> = { ...c.resources };
  for (const f of activeFeatures(c, db)) {
    for (const [key, r] of Object.entries(f.resources?.(c, db) ?? {})) {
      const cur = c.resources[key];
      next[key] = cur ? { ...r, current: Math.min(r.max, cur.current + Math.max(0, r.max - cur.max)) } : r;
    }
  }
  return { ...c, resources: next };
}

/** Runs onGain for features gained at `classLevel` of `classId`. */
export function applyOnGain(c: Character, db: SrdDatabase, classId: string, classLevel: number): Character {
  const sub = c.classes.find((x) => x.classId === classId)?.subclassId;
  return featuresGainedAt(db, classId, sub, classLevel).reduce((acc, f) => f.onGain?.(acc, db) ?? acc, c);
}

export interface AvailableAction {
  action: FeatureAction;
  featureId: string;
  problem?: string;
}

export function featureActions(c: Character, db: SrdDatabase): AvailableAction[] {
  return activeFeatures(c, db).flatMap((f) =>
    (f.actions ?? []).map((a) => {
      const problem = a.problem?.(c);
      return { action: a, featureId: f.id, ...(problem && { problem }) };
    }),
  );
}

export class FeatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FeatureError';
  }
}

export function useFeatureAction(c: Character, db: SrdDatabase, actionId: string, params: FeatureActionParams): FeatureActionResult {
  const found = featureActions(c, db).find((a) => a.action.id === actionId);
  if (!found) throw new FeatureError(`${c.name} doesn't have ${actionId}`);
  if (found.problem) throw new FeatureError(found.problem);
  return found.action.use(c, db, params);
}
