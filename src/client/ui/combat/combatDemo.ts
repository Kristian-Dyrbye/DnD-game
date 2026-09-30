/**
 * Local combat sandbox for testing the battle map without the server (`#combat-<class>` URL):
 * a Quick Build hero against a few goblins on a seeded arena. In the real game the server runs
 * the encounter (A068) and the screen renders what it sends.
 */
import { signal } from '@preact/signals';
import { buildCharacter } from '../../../engine/character/builder';
import { toBuildInput } from '../../../engine/character/creator';
import { quickBuild } from '../../../engine/character/quickBuild';
import type { CombatContext } from '../../../engine/combat/combatState';
import { playerAct, setupEncounter, type Encounter, type PlayerAction } from '../../../engine/combat/encounter';
import { Rng } from '../../../engine/core/rng';
import { db } from '../../data';
import { messages } from '../../../engine/i18n';
import { language } from '../i18n';

export const demoCombat = signal<{ enc: Encounter; ctx: CombatContext } | null>(null);

export function startDemoCombat(classId: string): void {
  const ctx: CombatContext = { rng: Rng.fromSeed(`demo-${classId}`), db, msgs: messages(language.value) };
  const hero = buildCharacter(toBuildInput(quickBuild(classId, db, Rng.fromSeed(classId))), db);
  const enc = setupEncounter({ hero, monsters: [{ id: 'goblin_warrior', count: 3 }], db }, ctx);
  demoCombat.value = { enc, ctx };
}

export function demoAct(a: PlayerAction): string | undefined {
  const cur = demoCombat.value;
  if (!cur) return 'No fight';
  const err = playerAct(cur.enc, cur.ctx, a);
  // The encounter is updated in place: publish a new wrapper so the UI re-renders.
  demoCombat.value = { enc: { ...cur.enc }, ctx: cur.ctx };
  return err;
}
