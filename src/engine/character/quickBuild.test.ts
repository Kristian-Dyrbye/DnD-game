import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import { loadSrd } from '../data/srdBundle';
import { quickBuild, randomName } from './quickBuild';
import { stepProblems, stepsFor, toBuildInput } from './creator';
import { buildCharacter } from './builder';

const db = loadSrd();

describe('Quick Build', () => {
  it('produces a complete, valid character for every class', () => {
    for (const classId of db.classes.keys()) {
      const s = quickBuild(classId, db, Rng.fromSeed(classId));
      for (const step of stepsFor(s, db)) expect(stepProblems(s, step, db), `${classId}/${step}`).toEqual([]);
      const c = buildCharacter(toBuildInput(s), db);
      expect(c.classes[0]!.classId).toBe(classId);
      expect(c.name.length).toBeGreaterThan(0);
    }
  });

  it('puts the best scores in primary abilities and uses curated picks', () => {
    const f = quickBuild('fighter', db, Rng.fromSeed(1));
    expect(f.baseScores.str).toBe(15);
    expect(f.choices.fighting_style).toEqual(['defense']);
    expect(f.weaponMasteries).toEqual(['greatsword', 'longsword', 'javelin']);
    const w = quickBuild('wizard', db, Rng.fromSeed(1));
    expect(w.cantrips).toEqual(['fire_bolt', 'light', 'mage_hand']);
    expect(w.preparedSpells).toContain('magic_missile');
  });

  it('generates species-appropriate names deterministically', () => {
    expect(randomName('dwarf', Rng.fromSeed(3))).toBe(randomName('dwarf', Rng.fromSeed(3)));
  });
});
