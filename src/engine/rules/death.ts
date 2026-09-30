/**
 * Dropping to 0 HP, death saving throws and stabilizing (SRD 5.2 "Dropping to 0 Hit Points").
 * Monsters die at 0 HP; characters fall Unconscious and make death saves. Heroic-mode "defeat
 * instead of death" is decided by the game session (A068), not here.
 */
import { rollD20, type Modifier, type RollMode } from '../core/dice';
import { mathLine } from '../i18n/srdLabels';
import type { Character, Creature } from '../core/creature';
import type { Rng } from '../core/rng';
import { ENGLISH_MESSAGES, type Messages } from '../i18n';
import { applyCondition, removeCondition } from './conditions';
import { heal } from './damage';
import type { DamageReport } from './damage';

type AnyCreature = Creature | Character;

const isCharacter = (c: AnyCreature): c is Character => c.kind === 'character' && 'deathSaves' in c;

const RESET = { successes: 0, failures: 0, stable: false };

export interface ZeroHpOutcome<T extends AnyCreature> {
  creature: T;
  /** What happened, for the log/narrator. */
  event: 'none' | 'unconscious' | 'death_save_failure' | 'died';
  cause?: 'monster_at_zero' | 'massive_damage' | 'failed_death_saves';
}

/**
 * Call after applyDamage. Handles monster death, falling unconscious, massive damage and
 * damage taken while already at 0 HP (1 failure, 2 on a crit, death if ≥ max HP).
 */
export function resolveDamageAtZero<T extends AnyCreature>(
  before: T,
  after: T,
  report: DamageReport,
  opts: { crit?: boolean; monstersFallUnconscious?: boolean } = {},
): ZeroHpOutcome<T> {
  if (after.dead || report.totalAfterDefenses - report.absorbedByTempHp <= 0) return { creature: after, event: 'none' };
  const die = (cause: ZeroHpOutcome<T>['cause']): ZeroHpOutcome<T> => ({ creature: { ...after, dead: true }, event: 'died', cause });

  if (report.instantDeath) return die('massive_damage');

  if (report.droppedToZero) {
    if (!isCharacter(after) && !opts.monstersFallUnconscious) return die('monster_at_zero');
    const down = applyCondition(after, { condition: 'unconscious' }).creature as T;
    return { creature: isCharacter(down) ? ({ ...down, deathSaves: { ...RESET } } as T) : down, event: 'unconscious' };
  }

  if (before.hp === 0 && isCharacter(after)) {
    const failures = after.deathSaves.failures + (opts.crit ? 2 : 1);
    const next = { ...after, deathSaves: { ...after.deathSaves, failures: Math.min(3, failures), stable: false } } as T;
    return failures >= 3 ? { creature: { ...next, dead: true }, event: 'died', cause: 'failed_death_saves' } : { creature: next, event: 'death_save_failure' };
  }
  return { creature: after, event: 'none' };
}

export interface DeathSaveResult {
  character: Character;
  natural: number;
  total: number;
  outcome: 'success' | 'failure' | 'double_failure' | 'revived' | 'stable' | 'died';
  text: string;
}

/** Start-of-turn death save: d20 ≥ 10 succeeds; 1 = two failures; 20 = regain 1 HP. Exhaustion applies (it's a D20 Test). */
export function rollDeathSave(c: Character, rng: Rng, bonuses: Modifier[] = [], mode: RollMode = 'normal', msgs: Messages = ENGLISH_MESSAGES): DeathSaveResult {
  const d20 = rollD20(rng, mode);
  const modifiers = [...bonuses];
  if (c.exhaustion > 0) modifiers.push({ value: -2 * c.exhaustion, label: msgs.m('mod.exhaustion') });
  const total = d20.natural + modifiers.reduce((s, m) => s + m.value, 0);
  let saves = { ...c.deathSaves };
  let outcome: DeathSaveResult['outcome'];
  let character: Character;

  if (d20.natural === 20) {
    const revived = reviveAt(c, 1);
    return { character: revived, natural: 20, total, outcome: 'revived', text: `${mathLine({ d20, modifiers, total, target: { kind: 'DC', value: 10 } }, msgs)} — ${msgs.m('roll.death.revived')}` };
  }
  if (d20.natural === 1) {
    saves.failures += 2;
    outcome = 'double_failure';
  } else if (total >= 10) {
    saves.successes += 1;
    outcome = 'success';
  } else {
    saves.failures += 1;
    outcome = 'failure';
  }
  if (saves.failures >= 3) {
    saves = { ...saves, failures: 3 };
    character = { ...c, deathSaves: saves, dead: true };
    outcome = 'died';
  } else if (saves.successes >= 3) {
    character = { ...c, deathSaves: { successes: 0, failures: 0, stable: true } };
    outcome = 'stable';
  } else {
    character = { ...c, deathSaves: saves };
  }
  const label: Record<DeathSaveResult['outcome'], string> = {
    success: msgs.m('roll.success'),
    failure: msgs.m('roll.failure'),
    double_failure: msgs.m('roll.death.double'),
    revived: '',
    stable: msgs.m('roll.death.stable'),
    died: msgs.m('roll.death.died'),
  };
  return {
    character,
    natural: d20.natural,
    total,
    outcome,
    text: `${mathLine({ d20, modifiers, total, target: { kind: 'DC', value: 10 }, outcome: label[outcome] }, msgs)} (${saves.successes}✓ ${Math.min(3, saves.failures)}✗)`,
  };
}

/** Stabilize (Help + DC 10 Medicine, Spare the Dying...): no more death saves; still Unconscious at 0 HP. */
export function stabilize(c: Character): Character {
  return { ...c, deathSaves: { successes: 0, failures: 0, stable: true } };
}

/** Any healing at 0 HP: regain HP, reset death saves, end Unconscious (the creature stays Prone). */
export function healFromZero<T extends AnyCreature>(c: T, amount: number): { creature: T; healed: number } {
  if (c.dead) return { creature: c, healed: 0 };
  const wasDown = c.hp === 0;
  const { creature, healed } = heal(c, amount);
  if (!wasDown || healed === 0) return { creature: creature as T, healed };
  let up = removeCondition(creature, 'unconscious') as T;
  if (isCharacter(up)) up = { ...up, deathSaves: { ...RESET } } as T;
  return { creature: up, healed };
}

function reviveAt(c: Character, hp: number): Character {
  return healFromZero(c, hp).creature;
}

/** Whether this character must roll a death save at the start of its turn. */
export function needsDeathSave(c: Character): boolean {
  return c.hp === 0 && !c.dead && !c.deathSaves.stable;
}
