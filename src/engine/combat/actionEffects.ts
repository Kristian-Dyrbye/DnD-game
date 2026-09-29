/**
 * Active-effect state created by combat actions and the queries other modules ask about it
 * (SRD 5.2.1 Rules Glossary: Dodge, Help, Hide, Ready, Grappling).
 *
 * Keys (stored in `Creature.effects`, so they save/load with the creature):
 * - 'dodge'       on the dodger; until the start of its next turn. Attack rolls against it have
 *                 Disadvantage if it can see the attacker; Advantage on Dex saves. No benefit while
 *                 Incapacitated or at Speed 0 (checked live, the effect stays).
 * - 'help_attack' on the ENEMY; data.helperId. The next attack roll against it by one of the
 *                 helper's allies has Advantage; removed after that roll or at the helper's next turn start.
 * - 'help_check'  on the ALLY; data.skill. Advantage on its next check with that skill; same expiry.
 * - 'hidden'      on the hider together with the Invisible condition (sourceId 'hide');
 *                 data.stealthTotal is the DC to find it. Ends when it makes an attack roll or is found.
 * - 'readied'     on the creature; data.trigger + data.action; ends at the start of its next turn.
 * - 'grappled_by' on the grappled creature (sourceId = grappler); data.dc = escape DC.
 * - 'nick_used' / 'cleave_used' on the attacker; once-per-turn markers ending at its turn end.
 * - 'hit_rider_turn' on the attacker; data.stamp = turn stamp of its last feature-rider hit.
 */
import type { Creature } from '../core/creature';
import type { Skill } from '../rules/basics';
import { removeEffects } from '../rules/activeEffects';
import { canAct, effectiveSpeed, removeCondition, type ConditionTable } from '../rules/conditions';

export const HIDE_SOURCE = 'hide';

/** Dodge benefits are on (the effect is present and the creature isn't Incapacitated or at Speed 0). */
export function dodgeActive(c: Creature, table?: ConditionTable): boolean {
  return c.effects.some((e) => e.key === 'dodge') && canAct(c, table) && effectiveSpeed(c, table) > 0;
}

/** Dodge: Advantage on Dexterity saving throws. Callers resolving Dex saves (AoE, traps) merge this in. */
export function dodgeSaveModes(c: Creature, ability: string, table?: ConditionTable): { advantage: string[]; disadvantage: string[] } {
  return { advantage: ability === 'dex' && dodgeActive(c, table) ? ['Dodge'] : [], disadvantage: [] };
}

/** Help (attack): the helper whose distraction grants `attackerId` Advantage against `target`, if any. */
export function helpAttackSource(target: Creature, isAllyOfAttacker: (helperId: string) => boolean): string | undefined {
  const e = target.effects.find((x) => x.key === 'help_attack' && typeof x.data.helperId === 'string' && isAllyOfAttacker(x.data.helperId));
  return e?.data.helperId as string | undefined;
}

export function consumeHelpAttack<T extends Creature>(target: T, helperId: string): T {
  const first = target.effects.find((e) => e.key === 'help_attack' && e.data.helperId === helperId);
  return first ? removeEffects(target, (e) => e.id === first.id) : target;
}

/** Help (ability check): Advantage on the next check with `skill`. */
export function helpCheckModes(c: Creature, skill: Skill | undefined): { advantage: string[]; disadvantage: string[] } {
  const has = skill !== undefined && c.effects.some((e) => e.key === 'help_check' && e.data.skill === skill);
  return { advantage: has ? ['Help'] : [], disadvantage: [] };
}

export function consumeHelpCheck<T extends Creature>(c: T, skill: Skill): T {
  const first = c.effects.find((e) => e.key === 'help_check' && e.data.skill === skill);
  return first ? removeEffects(c, (e) => e.id === first.id) : c;
}

export function isHidden(c: Creature): boolean {
  return c.effects.some((e) => e.key === 'hidden');
}

/** Stealth total a searcher must meet with Wisdom (Perception), or undefined when not hidden. */
export function hideDc(c: Creature): number | undefined {
  const e = c.effects.find((x) => x.key === 'hidden');
  return typeof e?.data.stealthTotal === 'number' ? e.data.stealthTotal : undefined;
}

/** Stop hiding: removes the hidden marker and the Invisible condition it granted. */
export function breakHiding<T extends Creature>(c: T): T {
  if (!isHidden(c)) return c;
  return removeCondition(removeEffects(c, (e) => e.key === 'hidden'), 'invisible', HIDE_SOURCE);
}

export function hasOncePerTurnMarker(c: Creature, key: 'nick_used' | 'cleave_used'): boolean {
  return c.effects.some((e) => e.key === key);
}
