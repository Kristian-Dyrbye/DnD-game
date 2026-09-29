/**
 * Active effects: short-lived rules effects stored on creatures (weapon mastery riders now,
 * spell buffs later). Handles adding, turn-event expiry, round countdowns, and attack-roll
 * advantage/disadvantage that is consumed by the next attack.
 * Known keys: 'sap' (Disadvantage on own next attack), 'vex' (Advantage on next attack vs
 * targetId), 'slow' (−10 ft speed, doesn't stack).
 */
import type { ActiveEffect, Creature } from '../core/creature';

/** Next free id on this creature ("sap-3"). Ids only need to be unique per creature and survive save/load. */
function nextEffectId(c: Creature, key: string): string {
  const used = c.effects.map((e) => Number(/-(\d+)$/.exec(e.id)?.[1] ?? 0));
  return `${key}-${Math.max(0, ...used) + 1}`;
}

export function addEffect<T extends Creature>(c: T, e: Omit<ActiveEffect, 'id' | 'data'> & Partial<Pick<ActiveEffect, 'id' | 'data'>>): T {
  const effect: ActiveEffect = { data: {}, ...e, id: e.id ?? nextEffectId(c, e.key) };
  return { ...c, effects: [...c.effects, effect] };
}

export function hasEffect(c: Creature, key: string, targetId?: string): boolean {
  return c.effects.some((e) => e.key === key && (targetId === undefined || e.targetId === targetId));
}

export function removeEffects<T extends Creature>(c: T, pred: (e: ActiveEffect) => boolean): T {
  return c.effects.some(pred) ? { ...c, effects: c.effects.filter((e) => !pred(e)) } : c;
}

/**
 * Turn event for `creatureId` (start or end of its turn). Every creature's effects that expire on
 * that event count down their `skip`, or are removed. Returns updated creatures and expired effects.
 */
export function onTurnEvent(
  creatures: Creature[],
  event: 'start_of_turn' | 'end_of_turn',
  creatureId: string,
): { creatures: Creature[]; expired: { creatureId: string; effect: ActiveEffect }[] } {
  const expired: { creatureId: string; effect: ActiveEffect }[] = [];
  const updated = creatures.map((c) => {
    let changed = false;
    const effects: ActiveEffect[] = [];
    for (const e of c.effects) {
      if (e.expires?.on === event && e.expires.creatureId === creatureId) {
        changed = true;
        if (e.expires.skip > 0) effects.push({ ...e, expires: { ...e.expires, skip: e.expires.skip - 1 } });
        else expired.push({ creatureId: c.id, effect: e });
        continue;
      }
      effects.push(e);
    }
    return changed ? { ...c, effects } : c;
  });
  return { creatures: updated, expired };
}

/** Round countdown (call once per round per creature). */
export function tickEffects(c: Creature): { creature: Creature; expired: ActiveEffect[] } {
  const expired: ActiveEffect[] = [];
  const effects: ActiveEffect[] = [];
  for (const e of c.effects) {
    if (e.roundsLeft === undefined) effects.push(e);
    else if (e.roundsLeft <= 1) expired.push(e);
    else effects.push({ ...e, roundsLeft: e.roundsLeft - 1 });
  }
  return { creature: c.effects.some((e) => e.roundsLeft !== undefined) ? { ...c, effects } : c, expired };
}

/** Advantage/disadvantage from the attacker's own effects for an attack against `targetId`. */
export function attackEffectModes(attacker: Creature, targetId: string): { advantage: string[]; disadvantage: string[] } {
  const advantage: string[] = [];
  const disadvantage: string[] = [];
  for (const e of attacker.effects) {
    if (e.key === 'sap') disadvantage.push('Sapped');
    if (e.key === 'vex' && e.targetId === targetId) advantage.push('Vex');
    if (e.key === 'steady_aim') advantage.push('Steady Aim');
  }
  return { advantage, disadvantage };
}

/** Removes the effects used up by an attack roll against `targetId`. */
export function consumeAttackEffects<T extends Creature>(attacker: T, targetId: string): T {
  return removeEffects(attacker, (e) => e.consumeOn === 'own_attack' || (e.consumeOn === 'own_attack_vs_target' && e.targetId === targetId));
}

/** Speed penalty from effects (Slow: 10 ft, never more than 10 from Slow). */
export function effectSpeedPenalty(c: Creature): number {
  return c.effects.some((e) => e.key === 'slow') ? 10 : 0;
}
