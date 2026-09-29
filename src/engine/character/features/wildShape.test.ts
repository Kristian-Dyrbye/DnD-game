import { describe, expect, it } from 'vitest';
import type { Rng } from '../../core/rng';
import type { Character } from '../../core/creature';
import { loadSrd } from '../../data/srdBundle';
import { buildCharacter } from '../builder';
import { canCastSpells, syncResources, useFeatureAction } from './index';
import { beastShapeLimits, checkWildShapeEnds, eligibleForms, evergreenWildShape, isEligibleForm, knownFormProblems, wildShapeCombatant } from './wildShape';
import { savingThrow, skillCheck } from '../../rules/checks';
import { actionEffects } from '../../rules/monsters';

const db = loadSrd();
const fixed = (...faces: number[]): Rng => {
  const q = [...faces];
  return { int: (_min: number, max: number) => Math.min(q.shift() ?? 10, max) } as unknown as Rng;
};

const druid1 = buildCharacter(
  {
    id: 'fen',
    name: 'Fen',
    classId: 'druid',
    speciesId: 'human',
    speciesSkills: ['stealth'],
    speciesFeatId: 'alert',
    backgroundId: 'sage',
    baseScores: { str: 10, dex: 14, con: 14, int: 10, wis: 15, cha: 10 },
    backgroundBonus: { wis: 2, con: 1 },
    classSkills: ['nature', 'perception'],
    classEquipment: 0,
    backgroundEquipment: 'b',
    cantrips: ['druidcraft', 'produce_flame'],
    preparedSpells: ['cure_wounds', 'entangle', 'thunderwave', 'faerie_fire'],
  },
  db,
);

const at = (level: number, forms: string[]): Character =>
  syncResources({ ...druid1, classes: [{ classId: 'druid', level }], proficiencyBonus: Math.ceil(level / 4) + 1, choices: { wild_shape_forms: forms } }, db);

describe('Wild Shape', () => {
  it('Beast Shapes limits by level', () => {
    expect(beastShapeLimits(2)).toEqual({ known: 4, maxCr: 0.25, fly: false });
    expect(beastShapeLimits(4)).toEqual({ known: 6, maxCr: 0.5, fly: false });
    expect(beastShapeLimits(8)).toEqual({ known: 8, maxCr: 1, fly: true });
  });

  it('eligible forms: beasts within CR, no fly before 8, no swarms', () => {
    const wolf = db.monsters.get('wolf')!;
    const bear = db.monsters.get('brown_bear')!;
    expect(isEligibleForm(wolf, 2)).toBe(true);
    expect(isEligibleForm(bear, 2)).toBe(false);
    expect(isEligibleForm(bear, 8)).toBe(true);
    const lvl2 = eligibleForms(db, 2);
    expect(lvl2.length).toBeGreaterThan(10);
    expect(lvl2.every((m) => m.cr <= 0.25 && !m.speed.fly && m.creatureType === 'beast')).toBe(true);
    expect(knownFormProblems(at(2, []), db, ['wolf', 'brown_bear'])).toEqual(["Brown Bear isn't an eligible form at Druid level 2"]);
  });

  it('shifting spends a use, gives temp HP = druid level, blocks spellcasting; reverting ends it', () => {
    const d = at(2, ['wolf', 'rat', 'spider', 'riding_horse']);
    const r = useFeatureAction(d, db, 'wild_shape', { rng: fixed(), choice: 'wolf' });
    expect(r.character.resources.wild_shape!.current).toBe(1);
    expect(r.character.tempHp).toBe(2);
    expect(canCastSpells(r.character, db)).toBe(false);
    expect(useFeatureAction(d, db, 'wild_shape', { rng: fixed(), choice: 'brown_bear' }).log[0]).toContain('known forms');
    const back = useFeatureAction(r.character, db, 'revert_form', { rng: fixed() }).character;
    expect(canCastSpells(back, db)).toBe(true);
  });

  it('merged combatant: beast Str/Dex/Con/AC/speed/attacks, druid HP and mind, best bonuses', () => {
    const shifted = useFeatureAction(at(2, ['wolf']), db, 'wild_shape', { rng: fixed(), choice: 'wolf' }).character;
    const wolf = db.monsters.get('wolf')!;
    const c = wildShapeCombatant(shifted, db);
    expect(c.abilities).toMatchObject({ str: wolf.abilities.str, dex: wolf.abilities.dex, con: wolf.abilities.con, wis: shifted.abilities.wis });
    expect(c).toMatchObject({ ac: wolf.ac, speed: wolf.speed, hp: shifted.hp, creatureType: 'humanoid', statBlockId: 'wolf' });
    // Perception: druid is proficient (Wis 17 +3, PB 2 = 5) vs wolf +5 → 5; Stealth: wolf +4 vs druid Dex 15 (+2) + PB 2 = 4.
    expect(skillCheck(c, 'perception', { rng: fixed(10) }).total).toBe(15);
    expect(savingThrow(c, 'wis', { rng: fixed(10) }).total).toBe(10 + 3 + 2);
    expect(actionEffects(wolf.actions[0]!)).toBeDefined();
    expect(wildShapeCombatant(druid1, db)).toBe(druid1);
  });

  it('ends when incapacitated; Archdruid regains a use on initiative', () => {
    const shifted = useFeatureAction(at(2, ['wolf']), db, 'wild_shape', { rng: fixed(), choice: 'wolf' }).character;
    expect(checkWildShapeEnds({ ...shifted, conditions: [{ condition: 'stunned' }] }).effects.some((e) => e.key === 'wild_shape')).toBe(false);
    const d20 = { ...at(20, []), resources: { wild_shape: { current: 0, max: 4, recharge: 'long' as const } } };
    expect(evergreenWildShape(d20).resources.wild_shape!.current).toBe(1);
  });
});
