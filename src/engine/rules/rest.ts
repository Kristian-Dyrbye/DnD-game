/**
 * Short and Long Rests (SRD 5.2). Short Rest: spend Hit Point Dice (die + Con mod, minimum 1 HP
 * each) and recharge short-rest resources. Long Rest: regain all HP and all spent Hit Point Dice,
 * lose Temporary HP, reduce Exhaustion by 1, recharge short- and long-rest resources.
 * Both need at least 1 HP to start. Spell slot recovery hooks in from the spellcasting module.
 */
import { roll } from '../core/dice';
import type { Character, Creature, Resource } from '../core/creature';
import type { Rng } from '../core/rng';
import { abilityModifier } from './basics';

export class RestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RestError';
  }
}

export interface HitDieRoll {
  die: string;
  rolled: number;
  conMod: number;
  healed: number;
}

/** Recharges resources whose recharge type is in `kinds`. */
export function rechargeResources(resources: Record<string, Resource>, kinds: Resource['recharge'][]): Record<string, Resource> {
  const shortRest = kinds.includes('short') && !kinds.includes('long');
  return Object.fromEntries(
    Object.entries(resources).map(([k, r]) => {
      if (kinds.includes(r.recharge)) return [k, { ...r, current: r.max }];
      if (shortRest && r.shortRestRegain) return [k, { ...r, current: Math.min(r.max, r.current + r.shortRestRegain) }];
      return [k, r];
    }),
  );
}

/**
 * Short Rest. `spend` lists hit dice to spend in order, e.g. ['d10', 'd10', 'd8'].
 * Stops spending once HP is full. Throws if the character is at 0 HP or lacks a die.
 */
export function shortRest(c: Character, rng: Rng, spend: string[] = []): { character: Character; rolls: HitDieRoll[] } {
  if (c.hp < 1 || c.dead) throw new RestError('You need at least 1 Hit Point to rest.');
  const hitDice = { ...c.hitDice };
  const conMod = abilityModifier(c.abilities.con);
  let hp = c.hp;
  const rolls: HitDieRoll[] = [];
  for (const die of spend) {
    if (hp >= c.maxHp) break;
    if (!hitDice[die]) throw new RestError(`No ${die} Hit Point Dice left.`);
    hitDice[die] -= 1;
    const rolled = roll(`1${die}`, rng).total;
    const healed = Math.min(Math.max(1, rolled + conMod), c.maxHp - hp);
    hp += healed;
    rolls.push({ die, rolled, conMod, healed });
  }
  return {
    character: { ...c, hp, hitDice, resources: rechargeResources(c.resources, ['short', 'turn']) },
    rolls,
  };
}

/**
 * Long Rest. `maxHitDice` is the character's full hit dice per die size (from class levels);
 * all spent dice are regained (SRD 5.2).
 */
export function longRest(c: Character, maxHitDice: Record<string, number>): Character {
  if (c.hp < 1 || c.dead) throw new RestError('You need at least 1 Hit Point to start a Long Rest.');
  return {
    ...c,
    hp: c.maxHp,
    tempHp: 0,
    hitDice: { ...maxHitDice },
    exhaustion: Math.max(0, c.exhaustion - 1),
    resources: rechargeResources(c.resources, ['short', 'long', 'turn', 'dawn']),
    deathSaves: { successes: 0, failures: 0, stable: false },
  };
}

/** Full hit dice pool per die size from class levels, e.g. [{d10, 3}, {d8, 2}] → { d10: 3, d8: 2 }. */
export function hitDicePool(classes: { hitDie: string; level: number }[]): Record<string, number> {
  const pool: Record<string, number> = {};
  for (const c of classes) pool[c.hitDie] = (pool[c.hitDie] ?? 0) + c.level;
  return pool;
}

/** Monsters and NPCs: a long rest simply restores them. */
export function restoreCreature(c: Creature): Creature {
  return { ...c, hp: c.maxHp, tempHp: 0, exhaustion: Math.max(0, c.exhaustion - 1), resources: rechargeResources(c.resources, ['short', 'long', 'turn', 'dawn']) };
}
