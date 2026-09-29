import { describe, expect, it } from 'vitest';
import type { Rng } from '../core/rng';
import { Rng as SeededRng } from '../core/rng';
import { loadSrd } from '../data/srdBundle';
import { actionAvailable, actionEffects, monsterToCreature, multiattackSequence, rollRecharges, spendAction } from './monsters';
import { savingThrow, skillCheck } from './checks';
import { createEffectContext, executeEffects } from './effects';
import { buildEncounter, encounterXp, rateEncounter, xpBudget } from '../adventure/encounters';

const db = loadSrd();
const mon = (id: string) => db.monsters.get(id)!;
const fixed = (...faces: number[]): Rng => {
  const q = [...faces];
  return { int: (_min: number, max: number) => Math.min(q.shift() ?? 1, max), next: () => 0.5, pick: <T,>(xs: T[]) => xs[0]! } as unknown as Rng;
};

describe('monsterToCreature', () => {
  it('copies the stat block and uses printed save/skill bonuses', () => {
    const dragon = monsterToCreature(mon('adult_red_dragon'), 'dragon-1');
    expect(dragon).toMatchObject({ id: 'dragon-1', kind: 'monster', size: 'huge', ac: 19, hp: 256, maxHp: 256, proficiencyBonus: 6, immunities: ['fire'], statBlockId: 'adult_red_dragon' });
    expect(savingThrow(dragon, 'dex', { rng: fixed(10) }).total).toBe(10 + 6);
    expect(skillCheck(dragon, 'perception', { rng: fixed(10) }).total).toBe(10 + 13);
    expect(dragon.resources).toMatchObject({ legendary_actions: { max: 3 }, legendary_resistance: { max: 3 }, 'recharge:Fire Breath': { current: 1 } });
    expect(monsterToCreature(mon('mage'), 'm').size).toBe('medium');
  });

  it('tracks recharge and per-day abilities', () => {
    const m = mon('adult_red_dragon');
    const breath = m.actions.find((a) => a.name === 'Fire Breath')!;
    let c = monsterToCreature(m, 'd');
    expect(actionAvailable(c, breath)).toBe(true);
    c = spendAction(c, breath);
    expect(actionAvailable(c, breath)).toBe(false);
    expect(rollRecharges(c, m, fixed(4)).recharged).toEqual([]);
    const r = rollRecharges(c, m, fixed(5));
    expect(r.recharged).toEqual(['Fire Breath']);
    expect(actionAvailable(r.creature, breath)).toBe(true);
  });

  it('expands multiattack', () => {
    expect(multiattackSequence(mon('adult_red_dragon'))).toEqual(['Rend', 'Rend', 'Rend']);
    expect(multiattackSequence(mon('goblin_warrior'))).toEqual(['Scimitar']);
  });

  it('turns actions into executable effects (attack and area save)', () => {
    const gob = mon('goblin_warrior');
    const hero = monsterToCreature(mon('bandit'), 'hero');
    const scimitar = actionEffects(gob.actions[0]!)!;
    const ctx = createEffectContext({ rng: fixed(15, 4), source: monsterToCreature(gob, 'g'), targets: [hero], attackBonus: gob.actions[0]!.attack!.bonus });
    executeEffects(scimitar, ['hero'], ctx);
    expect(ctx.creatures.get('hero')!.hp).toBe(hero.hp - (4 + 2));
    expect(ctx.log[0]!.text).toContain('+ 4 (Attack)');
    const breath = actionEffects(mon('adult_red_dragon').actions.find((a) => a.name === 'Fire Breath')!)!;
    expect(breath[0]).toMatchObject({ kind: 'area', area: { shape: 'cone', size: 60 }, effects: [{ kind: 'save', ability: 'dex', dc: 21, onSuccess: 'half' }] });
  });
});

describe('encounters', () => {
  const t = db.rules;

  it('XP budget sums per character (solo and party)', () => {
    expect(xpBudget([1], 'moderate', t)).toBe(75);
    expect(xpBudget([3, 3, 3, 3], 'high', t)).toBe(1600);
  });

  it('rates encounters', () => {
    expect(rateEncounter([1], [mon('goblin_warrior')], t)).toBe('low');
    expect(rateEncounter([1], [mon('goblin_warrior'), mon('goblin_warrior')], t)).toBe('high'); // 100 XP > moderate 75
    expect(rateEncounter([1], [mon('ogre')], t)).toBe('deadly');
  });

  it('builds encounters within budget from candidates', () => {
    const candidates = ['goblin_warrior', 'goblin_boss', 'wolf', 'bandit', 'ogre', 'orc'].map(mon).filter(Boolean);
    for (let seed = 0; seed < 20; seed++) {
      const enc = buildEncounter({ partyLevels: [3], difficulty: 'moderate', candidates, rng: SeededRng.fromSeed(seed) }, t);
      expect(enc.xp).toBeLessThanOrEqual(enc.budget);
      expect(enc.monsters.length).toBeGreaterThan(0);
      expect(enc.monsters.every((m) => m.cr <= 3)).toBe(true);
      expect(encounterXp(enc.monsters)).toBe(enc.xp);
    }
  });
});
