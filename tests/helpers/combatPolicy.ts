/**
 * A simple player policy for automated playthroughs: stand up if Prone, attack a foe in reach with
 * any attack, else walk to the reachable square nearest a foe (same rules as moveCreature), else end
 * the turn.
 */
import { activeFight } from '../../src/engine/adventure/fights';
import { reachableForMove } from '../../src/engine/combat/actions';
import { attackProfiles, checkAttack } from '../../src/engine/combat/attack';
import { cellKey, distanceFt } from '../../src/engine/combat/grid';
import { reachableSquares } from '../../src/engine/combat/movement';
import { currentId, movementLeft } from '../../src/engine/combat/turns';
import { Rng } from '../../src/engine/core/rng';
import type { SrdDatabase } from '../../src/engine/data/srd';
import { hasCondition } from '../../src/engine/rules/conditions';
import type { GameSession } from '../../src/engine/session/GameSession';

export function combatStep(session: GameSession, db: SrdDatabase): Parameters<GameSession['handle']>[0] {
  const f = activeFight(session.current)!;
  const { state, roster } = f.enc;
  const ctx = { rng: Rng.fromSeed(0), db };
  const me = currentId(state.turns)!;
  const hero = state.creatures[me]!;
  const foes = Object.keys(state.creatures).filter((id) => roster[id] === 'enemy' && state.creatures[id]!.hp > 0 && state.grid.tokens[id]);
  const budget = state.turns.budgets[me];
  const left = movementLeft(state.turns, me, hero);
  if (hasCondition(hero, 'prone') && left * 2 >= hero.speed.walk && hero.speed.walk > 0) return { type: 'combat_act', action: { kind: 'stand' } };
  if (budget?.action || (budget?.attacksLeft ?? 0) > 0) {
    for (const p of attackProfiles(hero, db)) {
      const target = foes.find((t) => checkAttack(state, ctx, me, t, p).ok);
      if (target) return { type: 'combat_act', action: { kind: 'attack', targetId: target, profileId: p.id } };
    }
  }
  if (left >= 5 && !f.enc.log.at(-1)?.includes(`${hero.name} moves`)) {
    const here = state.grid.tokens[me]!;
    const nearest = foes.map((t) => state.grid.tokens[t]!).sort((a, b) => distanceFt(here, a) - distanceFt(here, b))[0];
    if (nearest) {
      const best = [...reachableForMove(state, ctx, me).values()].sort((a, b) => distanceFt({ ...a, size: hero.size }, nearest) - distanceFt({ ...b, size: hero.size }, nearest))[0];
      if (best && best.path.length && distanceFt({ ...best, size: hero.size }, nearest) < distanceFt(here, nearest)) return { type: 'combat_act', action: { kind: 'move', path: best.path } };
      // A wall in the way (B008: a fleeing goblin behind one stalled a fight for 1000 rounds): walk
      // the way that shortens the walking distance to the foe, as a player would walk around.
      const walk = reachableSquares(state.grid, nearest.id, 5000, { ignore: Object.keys(state.grid.tokens).filter((t) => t !== nearest.id) });
      const walkFrom = (p: { x: number; y: number }) => walk.get(cellKey(p))?.costFt ?? Infinity;
      const around = [...reachableForMove(state, ctx, me).values()].filter((s) => s.path.length).sort((a, b) => walkFrom(a) - walkFrom(b))[0];
      if (around && walkFrom(around) < walkFrom(here)) return { type: 'combat_act', action: { kind: 'move', path: around.path } };
    }
  }
  return { type: 'combat_act', action: { kind: 'end_turn' } };
}
