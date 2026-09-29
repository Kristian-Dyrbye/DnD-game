import { describe, expect, it } from 'vitest';
import { CharacterSchema, type Character } from '../core/creature';
import type { Rng } from '../core/rng';
import { loadSrd } from '../data/srdBundle';
import { monsterToCreature } from '../rules/monsters';
import { resolveAttack } from '../combat/attack';
import { createGrid, placeToken } from '../combat/grid';
import { startCombat } from '../combat/turns';
import type { CombatState } from '../combat/combatState';
import { giveScar, rollScars, scarDescription, scarLocation, scarSummary, scarText } from './scars';

const db = loadSrd();

function fixed(ints: number[], nexts: number[] = []): Rng {
  const q = [...ints];
  const n = [...nexts];
  return { int: () => q.shift() ?? 10, next: () => n.shift() ?? 0.5, pick: <T>(a: readonly T[]) => a[0]! } as unknown as Rng;
}

const pc = (id = 'hero', over: Partial<Character> = {}): Character =>
  CharacterSchema.parse({ id, name: 'Mira', kind: 'character', size: 'medium', creatureType: 'humanoid', abilities: { str: 14, dex: 12, con: 12, int: 10, wis: 10, cha: 10 }, proficiencyBonus: 2, maxHp: 12, hp: 12, ac: 12, speed: { walk: 30 }, classes: [{ classId: 'fighter', level: 1 }], speciesId: 'human', backgroundId: 'soldier', ...over });

describe('permanent scars', () => {
  it('placement fits the wound and avoids scarred spots; text names the source and origin', () => {
    expect(['left_cheek', 'right_cheek', 'brow', 'chest', 'left_arm', 'right_arm', 'back']).toContain(scarLocation('slashing', fixed([])));
    expect(scarLocation('slashing', fixed([]), ['left_cheek'])).not.toBe('left_cheek');
    expect(scarDescription({ sourceName: 'Goblin Boss', weapon: 'Scimitar', damageType: 'slashing' })).toBe('Scimitar of the Goblin Boss');
    expect(scarDescription({ sourceName: 'Young Red Dragon', damageType: 'fire' })).toBe('fire from the Young Red Dragon');
    const c = giveScar(pc(), { description: 'rope burn from the gallows', location: 'neck', origin: 'Port Sorrel', at: 60 }, fixed([]));
    expect(scarText(c.scars[0]!)).toBe('Neck: rope burn from the gallows (Port Sorrel)');
    expect(scarSummary(c)).toBe('scars: neck (rope burn from the gallows)');
  });

  it('after a fight: at most one scar per character, dropping to 0 beats a crit, chance-based', () => {
    const marks = [
      { targetId: 'hero', cause: 'crit' as const, sourceName: 'Ogre', weapon: 'Greatclub', damageType: 'bludgeoning' },
      { targetId: 'hero', cause: 'down' as const, sourceName: 'Ogre', weapon: 'Greatclub', damageType: 'bludgeoning' },
      { targetId: 'nettle', cause: 'crit' as const, sourceName: 'Goblin', weapon: 'Scimitar', damageType: 'slashing' },
    ];
    const r = rollScars([pc(), pc('nettle')], marks, fixed([], [0.5, 0.5]), 'The Old Mill', 100);
    expect(r.party[0]!.scars).toHaveLength(1); // 0.5 < 0.6 (down)
    expect(r.party[0]!.scars[0]!.cause).toBe('down');
    expect(r.party[1]!.scars).toHaveLength(0); // 0.5 ≥ 0.35 (crit)
    expect(r.lines[0]).toContain('Mira will carry a scar');
  });

  it('combat records a mark when a character takes a critical hit', () => {
    const grid = createGrid(6, 6);
    const ogre = monsterToCreature(db.monsters.get('ogre')!, 'ogre', 'Ogre');
    const hero = pc('hero', { maxHp: 200, hp: 200 });
    placeToken(grid, { id: 'ogre', x: 0, y: 0, size: 'large' });
    placeToken(grid, { id: 'hero', x: 2, y: 0, size: 'medium' });
    const turns = startCombat([{ id: 'ogre', side: 'enemy', initiative: 20, dexMod: 0 }, { id: 'hero', side: 'party', initiative: 1, dexMod: 0 }]);
    const s: CombatState = { grid, turns: { ...turns, round: 1, turnActive: true }, creatures: { ogre, hero } };
    const r = resolveAttack(s, { rng: fixed([20, 4, 4, 4, 4]), db }, { attackerId: 'ogre', targetId: 'hero', profile: 'monster:Greatclub' });
    if (!r.ok) throw new Error(r.error);
    expect(r.crit).toBe(true);
    expect(r.state.scarMarks).toEqual([{ targetId: 'hero', cause: 'crit', sourceName: 'Ogre', weapon: 'Greatclub', damageType: 'bludgeoning' }]);
  });
});
