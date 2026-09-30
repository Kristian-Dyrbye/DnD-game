/**
 * Initiative (Build Prompt §10, SRD 5.2.1 "Initiative", "Surprise", conditions Invisible /
 * Incapacitated).
 *
 * - Initiative is a Dexterity check: d20 + Dex modifier (+ Alert / Jack of All Trades for
 *   characters via `initiativeModifiers`; monsters use the stat block's printed Initiative bonus),
 *   with Exhaustion applying like any D20 Test.
 * - Advantage/disadvantage: condition initiative modes (Invisible → advantage, Incapacitated →
 *   disadvantage), Dex-check condition modes (Poisoned...), feature modes (Feral Instinct,
 *   Remarkable Athlete, Dex checks), effect Dex-check modes (Enhance Ability) and Surprise
 *   (SRD: a surprised combatant has Disadvantage on its Initiative roll).
 * - Ties (SRD leaves them to the GM/players): broken deterministically by higher Dex modifier,
 *   then party before others, then id.
 * - Groups: combatants with the same `group` share one roll (SRD: the GM may roll once for a group
 *   of identical creatures); the first member of the group rolls.
 */
import type { Character, Creature, Side } from '../core/creature';
import type { Modifier } from '../core/dice';
import type { Rng } from '../core/rng';
import { ENGLISH_MESSAGES, type Messages } from '../i18n';
import type { SrdDatabase } from '../data/srd';
import { loadSrd } from '../data/srdBundle';
import { initiativeModifiers } from '../character/derived';
import { featureCheckModes, featureInitiativeModes } from '../character/features';
import { abilityModifier } from '../rules/basics';
import { d20Test, type D20TestResult } from '../rules/checks';
import { checkModes, initiativeModes, type ConditionTable } from '../rules/conditions';
import { effectCheckModes } from '../rules/spellHooks3';

export interface InitiativeParticipant {
  creature: Creature;
  side: Side;
  /** Surprised when combat starts: Disadvantage on the roll. */
  surprised?: boolean;
  /** Shared-roll group key (e.g. "goblin"): every member uses the first member's roll. */
  group?: string;
}

/** One slot of the turn order. Plain JSON, stored in the turn state. */
export interface InitiativeEntry {
  id: string;
  side: Side;
  initiative: number;
  /** Tie-break key (Dex modifier). */
  dexMod: number;
  group?: string;
}

export interface InitiativeRoll extends InitiativeEntry {
  roll: D20TestResult;
  /** Visible math line, e.g. "Goblin initiative: d20: 12 + 2 (Initiative) = 14". */
  text: string;
  /** True when this entry reused its group's roll. */
  sharedRoll?: boolean;
}

export interface InitiativeOptions {
  rng: Rng;
  db?: SrdDatabase;
  table?: ConditionTable;
  /** Language of the roll lines (default English). */
  msgs?: Messages;
}

const isCharacter = (c: Creature): c is Character => c.kind === 'character' && 'classes' in c;

/** Flat modifiers to a creature's initiative roll. */
export function initiativeBonus(c: Creature, db: SrdDatabase = loadSrd()): Modifier[] {
  if (isCharacter(c)) return initiativeModifiers(c);
  const printed = c.statBlockId ? db.monsters.get(c.statBlockId)?.initiative : undefined;
  if (printed !== undefined) return [{ value: printed, label: 'Initiative' }];
  return [{ value: abilityModifier(c.abilities.dex), label: 'Dexterity' }];
}

/** Advantage / disadvantage sources for a creature's initiative roll. */
export function initiativeRollModes(
  c: Creature,
  opts: { surprised?: boolean; db?: SrdDatabase; table?: ConditionTable } = {},
): { advantage: string[]; disadvantage: string[] } {
  const db = opts.db ?? loadSrd();
  const init = initiativeModes(c, opts.table);
  const check = checkModes(c, {}, opts.table);
  const eff = effectCheckModes(c, 'dex');
  const feat = isCharacter(c) ? mergeModes(featureInitiativeModes(c, db), featureCheckModes(c, db, 'dex')) : { advantage: [], disadvantage: [] };
  const advantage = [...init.advantage, ...check.advantage, ...eff.advantage, ...feat.advantage];
  const disadvantage = [...init.disadvantage, ...check.disadvantage, ...eff.disadvantage, ...feat.disadvantage];
  if (opts.surprised) disadvantage.push('Surprised');
  return { advantage: [...new Set(advantage)], disadvantage: [...new Set(disadvantage)] };
}

function mergeModes(a: { advantage: string[]; disadvantage: string[] }, b: { advantage: string[]; disadvantage: string[] }) {
  return { advantage: [...a.advantage, ...b.advantage], disadvantage: [...a.disadvantage, ...b.disadvantage] };
}

/** Roll one creature's initiative. */
export function rollInitiative(p: InitiativeParticipant, opts: InitiativeOptions): InitiativeRoll {
  const c = p.creature;
  const modes = initiativeRollModes(c, { ...(p.surprised && { surprised: true }), ...(opts.db && { db: opts.db }), ...(opts.table && { table: opts.table }) });
  const roll = d20Test({
    rng: opts.rng,
    label: 'Initiative',
    modifiers: initiativeBonus(c, opts.db),
    exhaustion: c.exhaustion,
    advantage: modes.advantage,
    disadvantage: modes.disadvantage,
    ...(opts.msgs && { msgs: opts.msgs }),
  });
  const { m } = opts.msgs ?? ENGLISH_MESSAGES;
  const reasons = [...modes.advantage.map((s) => `${m('roll.adv')}: ${s}`), ...modes.disadvantage.map((s) => `${m('roll.dis')}: ${s}`)];
  return {
    id: c.id,
    side: p.side,
    initiative: roll.total,
    dexMod: abilityModifier(c.abilities.dex),
    ...(p.group && { group: p.group }),
    roll,
    text: `${m('combat.initiativeRoll', { name: c.name, roll: roll.text })}${reasons.length ? ` [${reasons.join('; ')}]` : ''}`,
  };
}

/** Deterministic order: higher initiative, then higher Dex modifier, then party first, then id. */
export function compareInitiative(a: InitiativeEntry, b: InitiativeEntry): number {
  if (a.initiative !== b.initiative) return b.initiative - a.initiative;
  if (a.dexMod !== b.dexMod) return b.dexMod - a.dexMod;
  const pa = a.side === 'party' ? 0 : 1;
  const pb = b.side === 'party' ? 0 : 1;
  if (pa !== pb) return pa - pb;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Roll initiative for everyone (in the given order, so a seeded Rng is deterministic) and sort.
 * Grouped members reuse the group's first roll; they then sort together by the tie-breaks.
 */
export function rollInitiativeOrder(participants: readonly InitiativeParticipant[], opts: InitiativeOptions): InitiativeRoll[] {
  const groups = new Map<string, InitiativeRoll>();
  const out: InitiativeRoll[] = [];
  for (const p of participants) {
    const shared = p.group !== undefined ? groups.get(p.group) : undefined;
    if (shared) {
      out.push({
        ...shared,
        id: p.creature.id,
        side: p.side,
        dexMod: abilityModifier(p.creature.abilities.dex),
        sharedRoll: true,
        text: (opts.msgs ?? ENGLISH_MESSAGES).m('combat.initiativeShared', { name: p.creature.name, n: shared.initiative }),
      });
      continue;
    }
    const r = rollInitiative(p, opts);
    if (p.group !== undefined) groups.set(p.group, r);
    out.push(r);
  }
  return out.sort(compareInitiative);
}

/** Strip roll details for storage in the turn state. */
export function toEntries(rolls: readonly InitiativeRoll[]): InitiativeEntry[] {
  return rolls.map((r) => ({ id: r.id, side: r.side, initiative: r.initiative, dexMod: r.dexMod, ...(r.group && { group: r.group }) }));
}
