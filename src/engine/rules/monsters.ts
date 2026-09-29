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
import { CONDITIONS, proficiencyBonusForCR, type Ability, type Condition, type Size } from './basics';

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

// ---------------------------------------------------------------- stat-block riders

/** A condition an action's text gives on a hit / failed save (parsed from the SRD wording). */
export interface ActionRider {
  condition: Condition;
  /** "If the target is a Large or smaller creature" / "one Large or smaller creature". */
  maxSize?: Size;
  /** Grappled: "(escape DC 14)". */
  escapeDc?: number;
  /** "until the end of the <monster>'s next turn" (approximated as 1 round on the target). */
  untilEndOfNextTurn?: boolean;
  /** "until the grapple ends": ends together with the grapple from the same creature. */
  whileGrappled?: boolean;
  /** "repeats the save at the end of each of its turns" (save actions only). */
  endSave?: { ability: Ability; dc: number };
  /** A hit that subjects the target to a follow-up save ("_Constitution Saving Throw:_ DC 10"). */
  save?: { ability: Ability; dc: number };
  /** Creature types unaffected ("a creature that isn't an Undead", "a non-Undead creature"). */
  excludeTypes?: string[];
}

const ABILITY_WORDS: Record<string, Ability> = { strength: 'str', dexterity: 'dex', constitution: 'con', intelligence: 'int', wisdom: 'wis', charisma: 'cha' };

interface RiderPart {
  text: string;
  save?: { ability: Ability; dc: number };
  excludeTypes?: string[];
}

/**
 * The parts of an action's text that apply conditions: the hit text of an attack (split at a
 * nested "_X Saving Throw:_ DC n. _Failure:_" follow-up) or the failure text of a save action.
 */
function riderParts(a: MonsterAction): RiderPart[] {
  const t = a.text.replace(/\s+/g, ' ');
  if (!a.attack) return a.save ? [{ text: /_Failure:_(.*?)(?:_Success:_|_Failure or Success:_|$)/.exec(t)?.[1] ?? '' }] : [];
  const hit = /_Hit:_(.*?)(?:_Miss:_|$)/.exec(t)?.[1] ?? '';
  const nested = /_(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) Saving Throw:_ DC (\d+)[^_]*_Failure:_(.*?)(?:_Success:_|_Failure or Success:_|$)/.exec(hit);
  if (!nested) return [{ text: hit }];
  const before = hit.slice(0, nested.index);
  const types = [
    ...[...before.matchAll(/isn't an? (\w+)(?: or an? \w+)?/gi)].map((m) => m[1]!.toLowerCase()),
    ...[...before.matchAll(/\bnon-(\w+) creature/gi)].map((m) => m[1]!.toLowerCase()),
  ];
  return [
    { text: before },
    { text: nested[3]!, save: { ability: ABILITY_WORDS[nested[1]!.toLowerCase()]!, dc: Number(nested[2]) }, ...(types.length && { excludeTypes: types }) },
  ];
}

/**
 * Conditions an attack/save action applies on a hit / failed save, parsed from sentences like
 * "If the target is a Large or smaller creature, it has the Grappled condition (escape DC 14)".
 * Optional or conditional wording ("can", "instead", "if it fails…", "While …") and durations
 * other than "until the end of … next turn" / "until the grapple ends" are skipped: those need
 * hand-written hooks.
 */
export function actionRiders(a: MonsterAction): ActionRider[] {
  const whole = a.text.replace(/\s+/g, ' ');
  const targetSize = /\bone (Tiny|Small|Medium|Large|Huge|Gargantuan) or smaller creature\b/.exec(whole)?.[1];
  const repeat = !!a.save && !a.attack && /repeats? the save at the end of each of its turns/i.test(whole);
  const riders: ActionRider[] = [];
  for (const part of riderParts(a)) {
    for (const sentence of part.text.split(/(?<=\.)\s+/)) {
      if (/\bcan\b|\binstead\b|\bif it (?:fails|succeeds)\b|\bwould\b|\bfails? by\b|^\s*While\b/i.test(sentence)) continue;
      const size = /If the target is a (Tiny|Small|Medium|Large|Huge|Gargantuan) or smaller creature/i.exec(sentence)?.[1] ?? targetSize;
      for (const m of sentence.matchAll(/\b(?:it|the target) (?:also )?has the (\w+) condition(?: \(escape DC (\d+)\))?([^,.;]*)/gi)) {
        const condition = m[1]!.toLowerCase() as Condition;
        if (!(CONDITIONS as readonly string[]).includes(condition)) continue;
        const tail = m[3] ?? '';
        const nextTurn = /until the end of (?:the [\w' ]+'s|its) next turn/i.test(tail);
        const whileGrappled = condition !== 'grappled' && /until the grapple ends|while (?:it is )?grappled/i.test(tail);
        if (/\buntil\b/i.test(tail) && !nextTurn && !whileGrappled) continue;
        riders.push({
          condition,
          ...(size && { maxSize: size.toLowerCase() as Size }),
          ...(m[2] && { escapeDc: Number(m[2]) }),
          ...(nextTurn && { untilEndOfNextTurn: true }),
          ...(whileGrappled && { whileGrappled: true }),
          ...(repeat && a.save && { endSave: { ability: a.save.ability, dc: a.save.dc } }),
          ...(part.save && { save: part.save }),
          ...(part.excludeTypes && { excludeTypes: part.excludeTypes }),
        });
      }
    }
  }
  return riders;
}

/** Range of a single-target save action ("one creature … within 60 feet"), in feet; 5 if unstated. */
export function saveActionRange(a: MonsterAction): number {
  return Number(/within (\d+) (?:feet|ft)/.exec(a.text)?.[1] ?? 5);
}

/** Save actions that hit one creature (not an area): usable as a Multiattack entry or on their own. */
export function isSingleTargetSave(a: MonsterAction): boolean {
  return !!a.save && !a.save.area && !a.attack;
}
