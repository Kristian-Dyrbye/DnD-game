import { describe, expect, it } from 'vitest';
import type { Rng } from '../../core/rng';
import type { Character } from '../../core/creature';
import { loadSrd } from '../../data/srdBundle';
import { buildCharacter, type CharacterBuildInput } from '../builder';
import { initiativeModifiers, weaponAttack } from '../derived';
import { levelUp } from '../leveling';
import {
  ALL_FEATURES,
  activeFeatures,
  canCastSpells,
  featureActions,
  featureAttackModes,
  featureAttackedModes,
  featureConditionImmunities,
  featureInitiativeModes,
  featureResistances,
  featureSaveModes,
  useFeatureAction,
  weaponHitRiders,
} from './index';
import { brutalStrikeDice, rageDamage, relentlessRage } from './barbarian';
import { bardicDie, cuttingWords, useInspiration } from './bard';
import { d20Test } from '../../rules/checks';
import { shortRest, longRest } from '../../rules/rest';

const db = loadSrd();
const fixed = (...faces: number[]): Rng => {
  const q = [...faces];
  return { int: (_min: number, max: number) => Math.min(q.shift() ?? 1, max) } as unknown as Rng;
};

const barbInput: CharacterBuildInput = {
  id: 'grog',
  name: 'Grog',
  classId: 'barbarian',
  speciesId: 'goliath',
  lineageId: 'stones_endurance',
  backgroundId: 'soldier',
  baseScores: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  backgroundBonus: { str: 2, con: 1 },
  classSkills: ['perception', 'survival'],
  classEquipment: 0,
  backgroundEquipment: 'a',
  weaponMasteries: ['greataxe', 'handaxe'],
};

const bardInput: CharacterBuildInput = {
  id: 'lark',
  name: 'Lark',
  classId: 'bard',
  speciesId: 'halfling',
  backgroundId: 'criminal',
  baseScores: { str: 8, dex: 14, con: 13, int: 12, wis: 10, cha: 15 },
  backgroundBonus: { dex: 1, con: 1, int: 1 },
  classSkills: ['persuasion', 'performance', 'insight'],
  classEquipment: 0,
  backgroundEquipment: 'b',
};

const up = (c: Character, classId: string, extra: Record<string, unknown> = {}) =>
  levelUp(c, db, { classId, hp: { mode: 'average' }, ignoreXp: true, ...extra }).character;

describe('feature registry', () => {
  it('every implementation matches a real class/subclass feature id', () => {
    for (const impl of ALL_FEATURES) {
      const list = db.classes.get(impl.owner)?.features ?? db.subclasses.get(impl.owner)?.features;
      expect(list, impl.owner).toBeDefined();
      expect(list!.some((f) => f.id === impl.id), `${impl.owner}/${impl.id}`).toBe(true);
    }
  });

  it('activates features by class level', () => {
    const barb = buildCharacter(barbInput, db);
    expect(activeFeatures(barb, db).map((f) => f.id)).toEqual(['rage']);
    const lvl2 = up(barb, 'barbarian');
    expect(activeFeatures(lvl2, db).map((f) => f.id)).toEqual(['rage', 'danger_sense', 'reckless_attack']);
  });
});

describe('Barbarian', () => {
  const barb = buildCharacter(barbInput, db);

  it('has Rage uses from the class table and regains 1 on a short rest', () => {
    expect(barb.resources.rage).toMatchObject({ current: 2, max: 2, recharge: 'long', shortRestRegain: 1 });
    const spent = { ...barb, hp: barb.maxHp - 1, resources: { ...barb.resources, rage: { ...barb.resources.rage!, current: 0 } } };
    expect(shortRest(spent, fixed()).character.resources.rage!.current).toBe(1);
    expect(longRest(spent, { d12: 1 }).resources.rage!.current).toBe(2);
  });

  it('Rage: bonus action, +2 damage on Strength hits, B/P/S resistance, Str advantage, no spells', () => {
    const r = useFeatureAction(barb, db, 'rage', { rng: fixed() });
    const raging = r.character;
    expect(raging.resources.rage!.current).toBe(1);
    expect(featureResistances(raging, db)).toEqual(['bludgeoning', 'piercing', 'slashing']);
    expect(featureSaveModes(raging, db, 'str').advantage).toEqual(['Rage']);
    expect(canCastSpells(raging, db)).toBe(false);
    const axe = weaponAttack(raging, db, raging.inventory.find((i) => i.itemId === 'greataxe')!)!;
    const riders = weaponHitRiders(raging, db, { attack: axe, target: raging, crit: false, rng: fixed(), firstHitThisTurn: true, hadAdvantage: false });
    expect(riders).toEqual([{ modifiers: [{ value: 2, label: 'Rage' }] }]);
    expect(() => useFeatureAction(raging, db, 'rage', { rng: fixed() })).toThrow(/Already raging/);
    const calm = useFeatureAction(raging, db, 'end_rage', { rng: fixed() }).character;
    expect(featureResistances(calm, db)).toEqual([]);
  });

  it('Reckless Attack, Danger Sense, Feral Instinct and rage damage scaling', () => {
    let c = up(barb, 'barbarian');
    const reckless = useFeatureAction(c, db, 'reckless_attack', { rng: fixed() }).character;
    expect(featureAttackModes(reckless, db, { melee: true, ability: 'str' }).advantage).toEqual(['Reckless Attack']);
    expect(featureAttackModes(reckless, db, { melee: false, ability: 'dex' }).advantage).toEqual([]);
    expect(featureAttackedModes(reckless, db, true).advantage).toEqual(['Reckless Attack (target)']);
    expect(featureSaveModes(c, db, 'dex').advantage).toEqual(['Danger Sense']);
    for (let i = 0; i < 5; i++) c = up(c, 'barbarian', i === 0 ? { subclassId: 'path_of_the_berserker' } : i === 1 ? { feat: { featId: 'ability_score_improvement', increases: { str: 1, con: 1 } } } : {});
    expect(c.classes[0]!.level).toBe(7);
    expect(featureInitiativeModes(c, db).advantage).toEqual(['Feral Instinct']);
    expect(rageDamage(c, db)).toBe(2);
    expect(brutalStrikeDice(c)).toBeUndefined();
  });

  it('Berserker: Frenzy adds Nd6 on the first reckless raging hit; Mindless Rage blocks charm/fear', () => {
    let c = up(up(barb, 'barbarian'), 'barbarian', { subclassId: 'path_of_the_berserker' });
    c = useFeatureAction(c, db, 'rage', { rng: fixed() }).character;
    c = useFeatureAction(c, db, 'reckless_attack', { rng: fixed() }).character;
    const axe = weaponAttack(c, db, c.inventory.find((i) => i.itemId === 'greataxe')!)!;
    const riders = weaponHitRiders(c, db, { attack: axe, target: c, crit: false, rng: fixed(), firstHitThisTurn: true, hadAdvantage: true });
    expect(riders).toContainEqual({ extraDamage: [{ dice: '2d6', type: 'slashing' }], text: 'Frenzy' });
    expect(featureConditionImmunities(c, db)).toEqual([]); // Mindless Rage is level 6
  });

  it('Relentless Rage keeps a raging level 11 barbarian up on a Con save', () => {
    const lvl11: Character = { ...barb, classes: [{ classId: 'barbarian', level: 11, subclassId: 'path_of_the_berserker' }], hp: 0 };
    const raging = useFeatureAction({ ...lvl11, hp: 5 }, db, 'rage', { rng: fixed() }).character;
    const down = { ...raging, hp: 0 };
    const saved = relentlessRage(down, fixed(15));
    expect(saved.character.hp).toBe(22);
    const again = relentlessRage({ ...saved.character, hp: 0 }, fixed(12));
    expect(again.save!.text).toContain('DC 15');
  });

  it('Primal Champion raises Str and Con by 4 (max 25) on gain', () => {
    const impl = ALL_FEATURES.find((f) => f.id === 'primal_champion')!;
    const c = impl.onGain!({ ...barb, abilities: { ...barb.abilities, str: 20, con: 23 } }, db);
    expect(c.abilities).toMatchObject({ str: 24, con: 25 });
  });
});

describe('Bard', () => {
  const bard = buildCharacter(bardInput, db);

  it('Bardic Inspiration: uses = Cha mod, gives a d6 to an ally, recharges on long rest until level 5', () => {
    expect(bard.resources.bardic_inspiration).toMatchObject({ current: 2, max: 2, recharge: 'long' });
    const ally = buildCharacter(barbInput, db);
    const r = useFeatureAction(bard, db, 'bardic_inspiration', { rng: fixed(), target: ally });
    expect(r.character.resources.bardic_inspiration!.current).toBe(1);
    expect(r.others![0]!.effects[0]).toMatchObject({ key: 'bardic_inspiration', data: { die: 'd6' } });
    expect(bardicDie(bard, db)).toBe('d6');
  });

  it('inspiration turns a failed test into a success', () => {
    const ally = buildCharacter(barbInput, db);
    const inspired = useFeatureAction(bard, db, 'bardic_inspiration', { rng: fixed(), target: ally }).others![0]!;
    const fail = d20Test({ rng: fixed(9), label: 'Athletics', modifiers: [{ value: 3, label: 'Str' }], target: { kind: 'DC', value: 15 } });
    const used = useInspiration(inspired, fail, fixed(5))!;
    expect(used.result).toMatchObject({ total: 17, success: true });
    expect(used.creature.effects).toHaveLength(0);
    expect(useInspiration(used.creature, fail, fixed(5))).toBeUndefined();
  });

  it('Jack of All Trades at 2: half proficiency on untrained skills and initiative; Expertise choice required', () => {
    expect(() => up(bard, 'bard')).toThrow(/Expertise/);
    const c = up(bard, 'bard', { expertise: ['persuasion', 'performance'] });
    expect(c.skills.arcana).toBe('half');
    expect(c.skills.persuasion).toBe('expertise');
    // Criminal background grants Alert (full PB to initiative), so Jack of All Trades doesn't also apply.
    expect(initiativeModifiers(c).map((m) => m.label)).toEqual(['Dexterity', 'Alert']);
    const sage = up(buildCharacter({ ...bardInput, backgroundId: 'sage', backgroundBonus: { con: 1, int: 1, wis: 1 } }, db), 'bard', { expertise: ['persuasion', 'performance'] });
    expect(initiativeModifiers(sage).map((m) => m.label)).toEqual(['Dexterity', 'Jack of All Trades']);
  });

  it('Font of Inspiration makes it a short-rest resource at 5; Cutting Words for Lore bards', () => {
    let c = up(bard, 'bard', { expertise: ['persuasion', 'performance'] });
    c = up(c, 'bard', { subclassId: 'college_of_lore', skills: ['arcana', 'history', 'nature'] });
    expect(c.skills.arcana).toBe('proficient');
    c = up(c, 'bard', { feat: { featId: 'ability_score_improvement', increases: { cha: 2 } } });
    c = up(c, 'bard');
    expect(c.resources.bardic_inspiration).toMatchObject({ recharge: 'short', max: 3 });
    const cw = cuttingWords(c, db, fixed(6))!;
    expect(cw.penalty).toBe(6);
    expect(cw.bard.resources.bardic_inspiration!.current).toBe(c.resources.bardic_inspiration!.current - 1);
    expect(featureActions(c, db).map((a) => a.action.id)).toContain('bardic_inspiration');
  });
});
