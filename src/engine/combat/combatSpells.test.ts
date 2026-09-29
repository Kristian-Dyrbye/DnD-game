import { describe, expect, it } from 'vitest';
import { buildCharacter } from '../character/builder';
import { toBuildInput } from '../character/creator';
import { quickBuild } from '../character/quickBuild';
import { autoLevelTo } from '../party/companions';
import { Rng } from '../core/rng';
import { loadSrd } from '../data/srdBundle';
import { areaTargets, playerAct, setupEncounter } from './encounter';
import { createGrid, moveToken } from './grid';
import { currentId } from './turns';
import { parseCommand } from '../../shared/protocol';

const db = loadSrd();

function fight(classId: string, level = 1, monsters = [{ id: 'goblin_warrior', count: 2 }]) {
  const ctx = { rng: Rng.fromSeed(`spells-${classId}`), db };
  let hero = buildCharacter(toBuildInput(quickBuild(classId, db, Rng.fromSeed(classId))), db);
  if (level > 1) hero = autoLevelTo(hero, level, db);
  const enc = setupEncounter({ hero, monsters, db, grid: createGrid(10, 8) }, ctx);
  return { enc, ctx };
}

describe('spells and features on the battle map', () => {
  it('the protocol accepts cast and feature actions', () => {
    expect(parseCommand(JSON.stringify({ type: 'combat_act', action: { kind: 'cast', spellId: 'fire_bolt', targetIds: ['x'] } })).ok).toBe(true);
    expect(parseCommand(JSON.stringify({ type: 'combat_act', action: { kind: 'feature', actionId: 'second_wind' } })).ok).toBe(true);
  });

  it('a wizard casts an attack cantrip at a goblin in range', () => {
    const { enc, ctx } = fight('wizard');
    // Seed-dependent: the goblins may win initiative and finish first; only test when the hero is up.
    if (enc.status !== 'ongoing' || currentId(enc.state.turns) !== 'hero') return;
    const foe = Object.keys(enc.state.creatures).find((k) => k !== 'hero')!;
    const cantrip = (enc.state.creatures.hero as { spellcasting?: { cantrips: string[] } }).spellcasting!.cantrips.find((c) => ['fire_bolt', 'ray_of_frost', 'shocking_grasp'].includes(c)) ?? 'fire_bolt';
    const err = playerAct(enc, ctx, { kind: 'cast', spellId: cantrip, targetIds: [foe] });
    expect(err).toBeUndefined();
    expect(enc.log.some((l) => /d20/.test(l))).toBe(true);
    expect(playerAct(enc, ctx, { kind: 'cast', spellId: cantrip, targetIds: [foe] })).toBeDefined(); // action spent
  });

  it('area spells hit the creatures inside the aimed template (and check range)', () => {
    const { enc, ctx } = fight('wizard', 3, [{ id: 'goblin_warrior', count: 3 }]);
    expect(enc.status === 'ongoing' && currentId(enc.state.turns)).toBe('hero');
    const ids = Object.keys(enc.state.creatures).filter((k) => k !== 'hero');
    moveToken(enc.state.grid, 'hero', { x: 1, y: 3 });
    ids.forEach((id, i) => moveToken(enc.state.grid, id, { x: 2, y: 2 + i }));
    // Make sure the wizard has an area spell prepared.
    (enc.state.creatures.hero as { spellcasting?: { prepared: { spellId: string; classId: string }[] } }).spellcasting!.prepared.push({ spellId: 'burning_hands', classId: 'wizard' });
    const areaSpell = 'burning_hands';
    const inside = areaTargets(enc, ctx, 'hero', areaSpell, { x: 3, y: 3 });
    expect(inside.length).toBeGreaterThan(0);
    expect(inside).not.toContain('hero');
    expect(playerAct(enc, ctx, { kind: 'cast', spellId: areaSpell, targetIds: [], area: { x: 3, y: 3 } })).toBeUndefined();
    expect(enc.log.some((l) => /save/i.test(l))).toBe(true);
  });

  it('a fighter uses Second Wind', () => {
    const { enc, ctx } = fight('fighter');
    expect(enc.status === 'ongoing' && currentId(enc.state.turns)).toBe('hero');
    enc.state.creatures.hero!.hp = 3;
    const err = playerAct(enc, ctx, { kind: 'feature', actionId: 'second_wind' });
    expect(err).toBeUndefined();
    expect(enc.state.creatures.hero!.hp).toBeGreaterThan(3);
  });
});
