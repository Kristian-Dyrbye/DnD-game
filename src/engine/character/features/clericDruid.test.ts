import { describe, expect, it } from 'vitest';
import type { Rng } from '../../core/rng';
import { CreatureSchema, type Character, type Creature } from '../../core/creature';
import { loadSrd } from '../../data/srdBundle';
import { buildCharacter, type CharacterBuildInput } from '../builder';
import { weaponAttack } from '../derived';
import { featureCheckBonuses, featureConditionImmunities, featureResistances, spellOptions, syncResources, useFeatureAction, weaponHitRiders } from './index';
import { blessedHealerAmount, divineSparkDice } from './cleric';
import { landSpells } from './druid';
import { castSpell } from '../../rules/spellcasting';
import { hasCondition } from '../../rules/conditions';

const db = loadSrd();
const fixed = (...faces: number[]): Rng => {
  const q = [...faces];
  return { int: (_min: number, max: number) => Math.min(q.shift() ?? 1, max) } as unknown as Rng;
};

const clericInput: CharacterBuildInput = {
  id: 'mara',
  name: 'Mara',
  classId: 'cleric',
  speciesId: 'dwarf',
  backgroundId: 'acolyte',
  baseScores: { str: 14, dex: 10, con: 14, int: 10, wis: 15, cha: 12 },
  backgroundBonus: { wis: 2, int: 1 },
  classSkills: ['medicine', 'history'],
  classEquipment: 0,
  backgroundEquipment: 'b',
  choices: { divine_order: ['protector'] },
  cantrips: ['sacred_flame', 'guidance', 'spare_the_dying'],
  preparedSpells: ['cure_wounds', 'bless', 'healing_word', 'guiding_bolt'],
};

const withLevel = (c: Character, level: number, subclassId?: string, choices: Record<string, string[]> = {}): Character => ({
  ...c,
  classes: [{ classId: c.classes[0]!.classId, level, ...(subclassId && { subclassId }) }],
  choices: { ...c.choices, ...choices },
});

const zombie = (id: string): Creature =>
  CreatureSchema.parse({
    id,
    name: id,
    kind: 'monster',
    size: 'medium',
    creatureType: 'undead',
    abilities: { str: 13, dex: 6, con: 16, int: 3, wis: 6, cha: 5 },
    proficiencyBonus: 2,
    maxHp: 15,
    hp: 15,
    ac: 8,
    speed: { walk: 20 },
  });

describe('Cleric', () => {
  const cleric = buildCharacter(clericInput, db);

  it('Protector: martial weapons and heavy armor training', () => {
    expect(cleric.proficiencies.weapons).toContain('martial');
    expect(cleric.proficiencies.armor).toContain('heavy');
  });

  it('Thaumaturge: +Wis (min 1) to Arcana/Religion checks', () => {
    const t = buildCharacter({ ...clericInput, choices: { divine_order: ['thaumaturge'] } }, db);
    expect(t.proficiencies.armor).not.toContain('heavy');
    expect(featureCheckBonuses(t, db, 'int', 'religion')).toEqual([{ value: 3, label: 'Thaumaturge' }]);
    expect(featureCheckBonuses(t, db, 'int', 'history')).toEqual([]);
  });

  it('Channel Divinity uses scale with level; Divine Spark heals or harms', () => {
    const lvl2 = { ...withLevel(cleric, 2), resources: { channel_divinity: { current: 2, max: 2, recharge: 'long' as const, shortRestRegain: 1 } } };
    const ally = { ...zombie('ally'), creatureType: 'humanoid' as const, hp: 5 };
    const heal = useFeatureAction(lvl2, db, 'divine_spark', { rng: fixed(6), target: ally, choice: 'heal' });
    expect(heal.others![0]!.hp).toBe(5 + 6 + 3);
    expect(heal.character.resources.channel_divinity!.current).toBe(1);
    const harm = useFeatureAction(lvl2, db, 'divine_spark', { rng: fixed(2, 8), target: zombie('z'), choice: 'radiant' });
    expect(harm.others![0]!.hp).toBe(15 - 11);
    expect(divineSparkDice(withLevel(cleric, 13))).toBe(3);
  });

  it('Turn Undead frightens + incapacitates undead that fail; Sear Undead damages them at 5', () => {
    const lvl5 = { ...withLevel(cleric, 5), resources: { channel_divinity: { current: 2, max: 2, recharge: 'long' as const } } };
    const r = useFeatureAction(lvl5, db, 'turn_undead', { rng: fixed(5, 5, 5, 3, 20), targets: [zombie('a'), zombie('b')] }); // Sear 3d8 first, then saves
    const [a] = r.others!;
    expect(r.others).toHaveLength(1);
    expect(hasCondition(a!, 'frightened')).toBe(true);
    expect(hasCondition(a!, 'incapacitated')).toBe(true);
    expect(a!.hp).toBe(0); // 15 radiant from Sear Undead
  });

  it('Divine Strike adds 1d8 radiant once per turn; Potent Spellcasting adds Wis to cantrips', () => {
    const lvl7 = withLevel(cleric, 7, 'life_domain', { blessed_strikes: ['divine_strike'] });
    const mace = weaponAttack(lvl7, db, { uid: 'm', itemId: 'mace', quantity: 1 })!;
    const ctx = { attack: mace, target: zombie('z'), crit: false, rng: fixed(), hadAdvantage: false };
    expect(weaponHitRiders(lvl7, db, { ...ctx, firstHitThisTurn: true })).toContainEqual({ extraDamage: [{ dice: '1d8', type: 'radiant' }], text: 'Divine Strike' });
    expect(weaponHitRiders(lvl7, db, { ...ctx, firstHitThisTurn: false })).toEqual([]);
    const potent = withLevel(cleric, 7, undefined, { blessed_strikes: ['potent_spellcasting'] });
    expect(spellOptions(potent, db, { level: 0, healing: false, damaging: true }, 0)).toEqual({ cantripDamageBonus: 3 });
  });

  it('Life Domain: Disciple of Life adds 2 + slot level; Supreme Healing maxes dice', () => {
    const life = withLevel(cleric, 3, 'life_domain');
    const opts = spellOptions(life, db, { level: 1, healing: true, damaging: false }, 2);
    expect(opts).toEqual({ healBonus: 4 });
    const r = castSpell({ rng: fixed(1, 1, 1, 1), caster: { ...life, spellcasting: { ...life.spellcasting!, slots: [4, 2, 0, 0, 0, 0, 0, 0, 0] } }, spell: db.spells.get('cure_wounds')!, slot: { kind: 'slot', level: 2 }, ability: 'wis', targets: [{ ...zombie('ally'), creatureType: 'humanoid', hp: 1, maxHp: 60 }], characterLevel: 3, ...opts });
    expect(r.ctx.creatures.get('ally')!.hp).toBe(1 + 4 + 3 + 4);
    expect(spellOptions(withLevel(cleric, 17, 'life_domain'), db, { level: 1, healing: true, damaging: false }, 1)).toMatchObject({ maxHealDice: true, healBonus: 3 });
    expect(blessedHealerAmount(withLevel(cleric, 6, 'life_domain'), 3)).toBe(5);
    expect(blessedHealerAmount(withLevel(cleric, 5, 'life_domain'), 3)).toBe(0);
  });

  it('Preserve Life heals Bloodied creatures up to half their HP', () => {
    const life = { ...withLevel(cleric, 3, 'life_domain'), resources: { channel_divinity: { current: 2, max: 2, recharge: 'long' as const } } };
    const hurt = { ...zombie('a'), creatureType: 'humanoid' as const, maxHp: 40, hp: 4 };
    const fine = { ...zombie('b'), creatureType: 'humanoid' as const, maxHp: 40, hp: 30 };
    const r = useFeatureAction(life, db, 'preserve_life', { rng: fixed(), targets: [hurt, fine] });
    expect(r.others).toEqual([{ ...hurt, hp: 19 }]);
  });
});

describe('Druid', () => {
  const druidInput: CharacterBuildInput = {
    ...clericInput,
    id: 'fen',
    name: 'Fen',
    classId: 'druid',
    speciesId: 'elf',
    lineageId: 'wood_elf',
    speciesSkills: ['perception'],
    backgroundId: 'sage',
    backgroundBonus: { wis: 2, con: 1 },
    classSkills: ['nature', 'survival'],
    choices: { primal_order: ['warden'] },
    cantrips: ['druidcraft', 'produce_flame'],
    preparedSpells: ['cure_wounds', 'entangle', 'thunderwave', 'faerie_fire'],
  };
  const druid = buildCharacter(druidInput, db);

  it('Warden: martial weapons and medium armor; Magician: Wis bonus to Nature', () => {
    expect(druid.proficiencies.armor).toContain('medium');
    const mage = buildCharacter({ ...druidInput, choices: { primal_order: ['magician'] } }, db);
    expect(featureCheckBonuses(mage, db, 'int', 'nature')).toEqual([{ value: 3, label: 'Magician' }]);
  });

  it('Wild Shape uses from the class table (2 at level 2)', () => {
    expect(syncResources(withLevel(druid, 2), db).resources.wild_shape).toMatchObject({ current: 2, max: 2, shortRestRegain: 1 });
  });

  it('Primal Strike adds elemental damage; Land spells, Nature\'s Ward', () => {
    const d7 = withLevel(druid, 7, 'circle_of_the_land', { elemental_fury: ['primal_strike'], primal_strike_type: ['fire'], land: ['arid'] });
    const sickle = weaponAttack(d7, db, { uid: 's', itemId: 'sickle', quantity: 1 })!;
    expect(weaponHitRiders(d7, db, { attack: sickle, target: zombie('z'), crit: false, rng: fixed(), firstHitThisTurn: true, hadAdvantage: false })).toContainEqual({ extraDamage: [{ dice: '1d8', type: 'fire' }], text: 'Primal Strike' });
    expect(landSpells(d7, db)).toEqual(['blur', 'burning_hands', 'fire_bolt', 'fireball', 'blight']);
    const d10 = withLevel(druid, 10, 'circle_of_the_land', { land: ['polar'] });
    expect(featureResistances(d10, db)).toEqual(['cold']);
    expect(featureConditionImmunities(d10, db)).toEqual(['poisoned']);
  });

  it("Land's Aid damages enemies (Con save) and heals one creature", () => {
    const d3 = { ...withLevel(druid, 3, 'circle_of_the_land'), resources: { wild_shape: { current: 2, max: 2, recharge: 'long' as const } } };
    const ally = { ...zombie('ally'), creatureType: 'humanoid' as const, hp: 2 };
    const r = useFeatureAction(d3, db, 'lands_aid', { rng: fixed(2, 6, 6, 4, 4), targets: [zombie('z')], target: ally });
    expect(r.character.resources.wild_shape!.current).toBe(1);
    expect(r.others!.find((o) => o.id === 'z')!.hp).toBe(3);
    expect(r.others!.find((o) => o.id === 'ally')!.hp).toBe(10);
  });
});
