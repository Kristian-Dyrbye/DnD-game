import { describe, expect, it } from 'vitest';
import { loadSrd } from './srdBundle';
import { abilityModifier } from '../rules/basics';

const db = loadSrd();
const mon = (id: string) => db.monsters.get(id)!;

describe('monsters data', () => {
  it('has all 330 SRD stat blocks (235 monsters + 95 animals)', () => {
    const all = [...db.monsters.values()];
    expect(all).toHaveLength(330);
    expect(all.filter((m) => m.source === 'animals')).toHaveLength(95);
  });

  it('parses core stats', () => {
    expect(mon('goblin_warrior')).toMatchObject({ size: ['small'], creatureType: 'fey', tags: ['goblinoid'], ac: 15, hp: 10, hpDice: '3d6', cr: 0.25, xp: 50, pb: 2 });
    expect(mon('adult_red_dragon')).toMatchObject({ size: ['huge'], speed: { walk: 40, climb: 40, fly: 80 }, immunities: ['fire'], passivePerception: 23, cr: 17 });
    expect(mon('adult_red_dragon').abilities).toEqual({ str: 27, dex: 10, con: 25, int: 16, wis: 13, cha: 23 });
    expect(mon('mage').size).toEqual(['small', 'medium']);
    expect(mon('swarm_of_rats')).toMatchObject({ creatureType: 'beast', tags: ['swarm'] });
    expect(mon('will_o_wisp').speed).toMatchObject({ fly: 50, hover: true });
  });

  it('parses attacks, saves, recharge, multiattack and legendary actions', () => {
    expect(mon('goblin_warrior').actions[0]!.attack).toEqual({ kind: 'melee', bonus: 4, reach: 5, damage: [{ dice: '1d6+2', type: 'slashing' }] });
    const red = mon('adult_red_dragon');
    expect(red.actions.find((a) => a.name === 'Fire Breath')).toMatchObject({
      recharge: 5,
      save: { ability: 'dex', dc: 21, halfOnSuccess: true, area: { shape: 'cone', size: 60 }, damage: [{ dice: '17d6', type: 'fire' }] },
    });
    expect(red.actions.find((a) => a.name === 'Multiattack')!.multiattack).toEqual([['Rend', 3]]);
    expect(red.legendary!.uses).toBe(3);
    expect(red.spellcasting).toMatchObject({ ability: 'cha', dc: 20, perDay: { '1': ['fireball'] } });
  });

  it('every multiattack names real actions, and every monster spell exists', () => {
    for (const m of db.monsters.values()) {
      for (const a of m.actions) {
        if (a.name !== 'Multiattack') continue;
        expect(a.multiattack, m.id).toBeDefined();
        for (const [name] of a.multiattack!) expect(m.actions.some((x) => x.name === name), `${m.id}: ${name}`).toBe(true);
      }
      const spells = m.spellcasting ? [...m.spellcasting.atWill, ...Object.values(m.spellcasting.perDay).flat()] : [];
      for (const s of spells) expect(db.spells.has(s), `${m.id} → ${s}`).toBe(true);
    }
  });

  it('XP matches CR and saves are at least the ability modifier', () => {
    const xp = new Map(db.rules.xpByCR);
    for (const m of db.monsters.values()) {
      if (m.cr > 0) expect(m.xp, m.id).toBe(xp.get(m.cr));
      for (const ab of ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const) {
        expect(m.saves[ab], `${m.id} ${ab}`).toBeGreaterThanOrEqual(abilityModifier(m.abilities[ab]));
      }
    }
  });
});
