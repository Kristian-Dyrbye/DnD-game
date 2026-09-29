/**
 * Monster runtime: turns an SRD stat block into a Creature (with printed save/skill bonuses,
 * legendary actions/resistance, recharge and per-day resources) and turns its actions into
 * data-driven Effects the executor can run. Recharge abilities are re-rolled at the start of
 * the monster's turn (rollRecharges).
 */
import { CreatureSchema, type Creature, type Resource } from '../core/creature';
import type { Rng } from '../core/rng';
import type { Effect } from '../data/common';
import type { Monster } from '../data/schemas';
import { proficiencyBonusForCR } from './basics';

type MonsterAction = Monster['actions'][number];

const rechargeKey = (name: string) => `recharge:${name}`;
const perDayKey = (name: string) => `per_day:${name}`;

/** Creates a fresh combat-ready creature from a stat block. `id` must be unique in the encounter. */
export function monsterToCreature(m: Monster, id: string, name = m.name): Creature {
  const resources: Record<string, Resource> = {};
  for (const a of [...m.actions, ...m.bonusActions, ...m.reactions, ...m.traits]) {
    if (a.recharge) resources[rechargeKey(a.name)] = { current: 1, max: 1, recharge: 'never' };
    if (a.usesPerDay) resources[perDayKey(a.name)] = { current: a.usesPerDay, max: a.usesPerDay, recharge: 'dawn' };
  }
  if (m.legendary) resources.legendary_actions = { current: m.legendary.uses, max: m.legendary.uses, recharge: 'turn' };
  const lr = m.traits.find((t) => t.name.startsWith('Legendary Resistance'));
  if (lr) {
    const uses = Number(/\((\d+)\/Day/.exec(lr.text)?.[1] ?? lr.usesPerDay ?? 3);
    resources.legendary_resistance = { current: uses, max: uses, recharge: 'dawn' };
  }
  return CreatureSchema.parse({
    id,
    name,
    kind: 'monster',
    size: m.size[m.size.length - 1],
    creatureType: m.creatureType,
    abilities: m.abilities,
    proficiencyBonus: m.pb || proficiencyBonusForCR(m.cr),
    maxHp: m.hp,
    hp: m.hp,
    ac: m.ac,
    speed: m.speed,
    senses: m.senses,
    saveBonuses: m.saves,
    skillBonuses: m.skills,
    resistances: m.resistances,
    immunities: m.immunities,
    vulnerabilities: m.vulnerabilities,
    conditionImmunities: m.conditionImmunities,
    languages: m.languages === 'None' ? [] : m.languages.split(/,\s*/),
    resources,
    statBlockId: m.id,
  });
}

/** Can the monster use this action now (recharge ready, per-day uses left)? */
export function actionAvailable(c: Creature, a: MonsterAction): boolean {
  if (a.recharge && (c.resources[rechargeKey(a.name)]?.current ?? 1) < 1) return false;
  if (a.usesPerDay && (c.resources[perDayKey(a.name)]?.current ?? 1) < 1) return false;
  return true;
}

/** Marks a recharge/per-day action as used. */
export function spendAction(c: Creature, a: MonsterAction): Creature {
  const resources = { ...c.resources };
  for (const key of [a.recharge ? rechargeKey(a.name) : undefined, a.usesPerDay ? perDayKey(a.name) : undefined]) {
    if (key && resources[key]) resources[key] = { ...resources[key], current: Math.max(0, resources[key].current - 1) };
  }
  return { ...c, resources };
}

/** Start of the monster's turn: roll a d6 for each spent recharge ability; refresh legendary actions. */
export function rollRecharges(c: Creature, m: Monster, rng: Rng): { creature: Creature; recharged: string[] } {
  const resources = { ...c.resources };
  const recharged: string[] = [];
  for (const a of [...m.actions, ...m.bonusActions]) {
    const key = rechargeKey(a.name);
    if (!a.recharge || !resources[key] || resources[key].current > 0) continue;
    if (rng.int(1, 6) >= a.recharge) {
      resources[key] = { ...resources[key], current: 1 };
      recharged.push(a.name);
    }
  }
  if (resources.legendary_actions) resources.legendary_actions = { ...resources.legendary_actions, current: resources.legendary_actions.max };
  return { creature: { ...c, resources }, recharged };
}

/** The attack sequence of a Multiattack, expanded (e.g. ['Rend', 'Rend', 'Rend']). Single attack if none. */
export function multiattackSequence(m: Monster): string[] {
  const multi = m.actions.find((a) => a.name === 'Multiattack');
  if (multi?.multiattack?.length) return multi.multiattack.flatMap(([name, n]) => new Array<string>(n).fill(name));
  const first = m.actions.find((a) => a.attack);
  return first ? [first.name] : [];
}

/**
 * Effects for a monster action (the executor needs ctx.attackBonus = action.attack.bonus for
 * attacks). Returns undefined for actions with no automatable mechanics (text-only).
 */
export function actionEffects(a: MonsterAction): Effect[] | undefined {
  if (a.attack) {
    if (a.attack.damage.length === 0) return undefined;
    return [{ kind: 'attack', attack: a.attack.kind === 'ranged' ? 'ranged_weapon' : 'melee_weapon', onHit: [{ kind: 'damage', damage: a.attack.damage }] }];
  }
  if (a.save) {
    const onFail: Effect[] = a.save.damage?.length ? [{ kind: 'damage', damage: a.save.damage }] : [];
    if (onFail.length === 0) return undefined;
    const save: Effect = { kind: 'save', ability: a.save.ability, dc: a.save.dc, onFail, onSuccess: a.save.halfOnSuccess ? 'half' : 'none' };
    return a.save.area ? [{ kind: 'area', area: a.save.area, effects: [save] }] : [save];
  }
  return undefined;
}

/** Reach (melee) or normal/long range (ranged) of an attack action, in feet. */
export function actionRange(a: MonsterAction): { reach?: number; normal?: number; long?: number } {
  return { ...(a.attack?.reach && { reach: a.attack.reach }), ...(a.attack?.range && { normal: a.attack.range.normal, ...(a.attack.range.long && { long: a.attack.range.long }) }) };
}
