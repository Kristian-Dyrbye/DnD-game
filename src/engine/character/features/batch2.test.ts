import { describe, expect, it } from 'vitest';
import type { Rng } from '../../core/rng';
import { CreatureSchema, type Character, type Creature } from '../../core/creature';
import { loadSrd } from '../../data/srdBundle';
import { buildCharacter, type CharacterBuildInput } from '../builder';
import { baseSpeed, unarmedStrike, weaponAttack } from '../derived';
import { pendingChoices } from '../leveling';
import { critOn, featureInitiativeModes, featureWeaponAttack, syncResources, useFeatureAction, weaponHitRiders } from './index';
import { heroicWarrior, indomitable, studiedAttacks, survivorRegen, tacticalMind } from './fighter';
import { deflectAmount, focusSaveDc, martialArtsDie, openHandTechnique, stunningStrike, uncannyMetabolism } from './monk';
import { auraImmunities, auraOfProtection } from './paladin';
import { huntersMarkDie, preciseHunterAdvantage, tirelessShortRest } from './ranger';
import { d20Test, savingThrow } from '../../rules/checks';
import { hasCondition } from '../../rules/conditions';
import { createEffectContext, executeEffects } from '../../rules/effects';
import { attackEffectModes } from '../../rules/activeEffects';

const db = loadSrd();
const fixed = (...faces: number[]): Rng => {
  const q = [...faces];
  return { int: (_min: number, max: number) => Math.min(q.shift() ?? 1, max) } as unknown as Rng;
};

const base: CharacterBuildInput = {
  id: 'hero',
  name: 'Hero',
  classId: 'fighter',
  speciesId: 'dwarf',
  backgroundId: 'soldier',
  baseScores: { str: 15, dex: 14, con: 14, int: 8, wis: 13, cha: 12 },
  backgroundBonus: { str: 2, con: 1 },
  classSkills: ['perception', 'survival'],
  classEquipment: 0,
  backgroundEquipment: 'a',
  weaponMasteries: ['greatsword'],
  choices: { fighting_style: ['defense'] },
};

/** Sets class level/subclass and re-syncs resources (onGain features are tested separately). */
const at = (c: Character, level: number, subclassId?: string, choices: Record<string, string[]> = {}): Character =>
  syncResources({ ...c, classes: [{ classId: c.classes[0]!.classId, level, ...(subclassId && { subclassId }) }], proficiencyBonus: Math.ceil(level / 4) + 1, choices: { ...c.choices, ...choices } }, db);

const dummy = (over: Partial<Creature> = {}): Creature =>
  CreatureSchema.parse({
    id: 'dummy',
    name: 'Dummy',
    kind: 'monster',
    size: 'medium',
    creatureType: 'humanoid',
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    proficiencyBonus: 2,
    maxHp: 30,
    hp: 30,
    ac: 12,
    speed: { walk: 30 },
    ...over,
  });

describe('Fighter', () => {
  const fighter = buildCharacter(base, db);

  it('Second Wind heals 1d10 + level, uses from the table', () => {
    expect(fighter.resources.second_wind).toMatchObject({ current: 2, max: 2, shortRestRegain: 1 });
    const hurt = { ...fighter, hp: 3 };
    const r = useFeatureAction(hurt, db, 'second_wind', { rng: fixed(7) });
    expect(r.character.hp).toBe(3 + 7 + 1);
    expect(r.character.resources.second_wind!.current).toBe(1);
  });

  it('Action Surge: once per turn, short-rest resource, 2 uses at 17', () => {
    const f2 = at(fighter, 2);
    const r = useFeatureAction(f2, db, 'action_surge', { rng: fixed() });
    expect(r.character.effects[0]!.key).toBe('action_surge');
    expect(() => useFeatureAction(r.character, db, 'action_surge', { rng: fixed() })).toThrow();
    expect(at(fighter, 17).resources.action_surge!.max).toBe(2);
  });

  it('Indomitable rerolls a failed save with +level; Tactical Mind adds 1d10 to a failed check', () => {
    const f9 = at(fighter, 9);
    const failed = savingThrow(f9, 'wis', { rng: fixed(3), dc: 15 });
    const re = indomitable(f9, failed, 'wis', fixed(6))!;
    expect(re.result.total).toBe(6 + 1 + 9);
    expect(re.character.resources.indomitable!.current).toBe(0);
    const check = d20Test({ rng: fixed(8), label: 'Athletics', modifiers: [{ value: 3, label: 'Str' }], target: { kind: 'DC', value: 15 } });
    const tm = tacticalMind(at(fighter, 2), check, fixed(5))!;
    expect(tm.result.success).toBe(true);
    expect(tm.character.resources.second_wind!.current).toBe(1);
    const refunded = tacticalMind(at(fighter, 2), check, fixed(1))!;
    expect(refunded.character.resources.second_wind!.current).toBe(2);
  });

  it('Champion: crits on 19 (18 at 15), Remarkable Athlete, Heroic Warrior, Survivor', () => {
    expect(critOn(fighter, db)).toBe(20);
    expect(critOn(at(fighter, 3, 'champion'), db)).toBe(19);
    expect(critOn(at(fighter, 15, 'champion'), db)).toBe(18);
    expect(featureInitiativeModes(at(fighter, 3, 'champion'), db).advantage).toEqual(['Remarkable Athlete']);
    expect(heroicWarrior(at(fighter, 10, 'champion')).heroicInspiration).toBe(true);
    expect(survivorRegen({ ...at(fighter, 18, 'champion'), hp: 10, maxHp: 100 })).toBe(5 + 2);
    expect(studiedAttacks(at(fighter, 13), 'orc').effects[0]).toMatchObject({ key: 'vex', targetId: 'orc' });
  });
});

describe('Monk', () => {
  const monkInput: CharacterBuildInput = {
    ...base,
    classId: 'monk',
    baseScores: { str: 10, dex: 15, con: 13, int: 8, wis: 15, cha: 10 },
    backgroundBonus: { dex: 2, con: 1 },
    classSkills: ['acrobatics', 'stealth'],
    classEquipment: 1,
    weaponMasteries: [],
    choices: {},
  };
  const monk = buildCharacter(monkInput, db);

  it('Martial Arts: unarmed strike uses Dex and the d6 die', () => {
    const fist = featureWeaponAttack(monk, db, unarmedStrike(monk));
    expect(fist).toMatchObject({ ability: 'dex', damage: [{ dice: '1d6', type: 'bludgeoning' }] });
    expect(fist.toHit).toBe(3 + 2);
    expect(martialArtsDie(at(monk, 17), db)).toBe('1d12');
    const lvl6 = featureWeaponAttack(at(monk, 6), db, unarmedStrike(at(monk, 6)));
    expect(lvl6.damage[0]!.type).toBe('force');
  });

  it('Focus Points: Flurry, Patient Defense, Step of the Wind', () => {
    const m2 = at(monk, 2);
    expect(m2.resources.focus_points).toMatchObject({ current: 2, max: 2, recharge: 'short' });
    const r = useFeatureAction(m2, db, 'flurry_of_blows', { rng: fixed() });
    expect(r.character.resources.focus_points!.current).toBe(1);
    expect(r.character.effects.some((e) => e.key === 'flurry_of_blows')).toBe(true);
  });

  it('Uncanny Metabolism, Deflect Attacks, Stunning Strike', () => {
    const m5 = { ...at(monk, 5), hp: 5, maxHp: 38, resources: { ...at(monk, 5).resources, focus_points: { current: 0, max: 5, recharge: 'short' as const } } };
    const um = uncannyMetabolism(m5, db, fixed(4));
    expect(um.resources.focus_points!.current).toBe(5);
    expect(um.hp).toBe(5 + 4 + 5);
    expect(deflectAmount(m5, fixed(6))).toBe(6 + 3 + 5); // 1d10 + Dex (17 → +3) + Monk level
    expect(focusSaveDc(m5)).toBe(8 + 2 + 3);
    const stun = stunningStrike(um, dummy(), fixed(3))!;
    expect(hasCondition(stun.target, 'stunned')).toBe(true);
    const resisted = stunningStrike(um, dummy(), fixed(20))!;
    expect(attackEffectModes(resisted.monk, 'dummy').advantage).toEqual(['Vex']);
  });

  it('Evasion (7): no damage on a successful Dex save, half on a failure', () => {
    const m7 = { ...at(monk, 7), effects: [{ id: 'evasion-1', key: 'evasion', data: {} }] };
    const fb = db.spells.get('fireball')!.effects!;
    const ok = createEffectContext({ rng: fixed(20, ...new Array(8).fill(4)), source: dummy(), targets: [m7], saveDc: 10 });
    executeEffects(fb, [m7.id], ok);
    expect(ok.creatures.get(m7.id)!.hp).toBe(m7.hp);
    const fail = createEffectContext({ rng: fixed(1, ...new Array(8).fill(4)), source: dummy(), targets: [{ ...m7, hp: 40, maxHp: 40 }], saveDc: 30 });
    executeEffects(fb, [m7.id], fail);
    expect(fail.creatures.get(m7.id)!.hp).toBe(40 - 16);
  });

  it('Open Hand Technique: topple on a failed Dex save', () => {
    const r = openHandTechnique(at(monk, 3, 'warrior_of_the_open_hand'), dummy(), 'topple', fixed(2));
    expect(hasCondition(r.target, 'prone')).toBe(true);
    expect(openHandTechnique(monk, dummy(), 'push', fixed(2)).pushFt).toBe(15);
  });
});

describe('Paladin', () => {
  const pal = buildCharacter(
    { ...base, classId: 'paladin', classSkills: ['insight', 'religion'], baseScores: { str: 15, dex: 10, con: 14, int: 8, wis: 12, cha: 14 }, weaponMasteries: ['longsword', 'javelin'], choices: {} },
    db,
  );

  it('Lay On Hands pool = 5 × level; heals or cures poison', () => {
    expect(pal.resources.lay_on_hands).toMatchObject({ current: 5, max: 5 });
    const ally = dummy({ hp: 10 });
    const r = useFeatureAction(pal, db, 'lay_on_hands', { rng: fixed(), target: ally, choice: '4' });
    expect(r.others![0]!.hp).toBe(14);
    expect(r.character.resources.lay_on_hands!.current).toBe(1);
    const poisoned = dummy({ conditions: [{ condition: 'poisoned' }] });
    const cured = useFeatureAction(pal, db, 'lay_on_hands', { rng: fixed(), target: poisoned, choice: 'cure_poison' });
    expect(hasCondition(cured.others![0]!, 'poisoned')).toBe(false);
  });

  it('Divine Smite always prepared at 2 with one free cast; Channel Divinity 2 → 3 at 11', () => {
    expect(at(pal, 3).resources.channel_divinity!.max).toBe(2);
    expect(at(pal, 11).resources.channel_divinity!.max).toBe(3);
    expect(at(pal, 2).resources.free_divine_smite).toMatchObject({ current: 1 });
  });

  it('Aura of Protection adds Cha (min 1) to saves within 10 ft; Aura of Courage at 10', () => {
    expect(auraOfProtection(at(pal, 6), 10)).toBe(2);
    expect(auraOfProtection(at(pal, 6), 15)).toBe(0);
    expect(auraOfProtection(at(pal, 18), 30)).toBe(2);
    expect(auraOfProtection(at(pal, 5), 5)).toBe(0);
    expect(auraImmunities(at(pal, 10, 'oath_of_devotion'), 5)).toEqual(['frightened', 'charmed']);
  });

  it('Radiant Strikes (11) on melee hits; Sacred Weapon adds Cha to hit', () => {
    const p11 = at(pal, 11, 'oath_of_devotion');
    const sword = weaponAttack(p11, db, p11.inventory.find((i) => i.itemId === 'longsword')!)!;
    expect(weaponHitRiders(p11, db, { attack: sword, target: dummy(), crit: false, rng: fixed(), firstHitThisTurn: true, hadAdvantage: false })).toContainEqual({ extraDamage: [{ dice: '1d8', type: 'radiant' }], text: 'Radiant Strikes' });
    const sacred = useFeatureAction(p11, db, 'sacred_weapon', { rng: fixed() }).character;
    expect(featureWeaponAttack(sacred, db, sword).toHit).toBe(sword.toHit + 2);
  });
});

describe('Ranger', () => {
  const rng = buildCharacter(
    { ...base, classId: 'ranger', speciesId: 'elf', lineageId: 'wood_elf', speciesSkills: ['insight'], classSkills: ['stealth', 'nature', 'animal_handling'], weaponMasteries: ['longbow', 'shortsword'], choices: {} },
    db,
  );

  it("Favored Enemy: Hunter's Mark free casts; Deft Explorer expertise at 2", () => {
    expect(rng.resources.favored_enemy).toMatchObject({ current: 2 });
    expect(pendingChoices(rng, db, 'ranger', 2)).toContainEqual({ kind: 'expertise', count: 1 });
  });

  it('Roving +10 ft at 6; Tireless temp HP and exhaustion; Foe Slayer d10', () => {
    expect(baseSpeed(at(rng, 6), db)).toBe(45);
    const r = useFeatureAction(at(rng, 10), db, 'tireless', { rng: fixed(5) });
    expect(r.character.tempHp).toBe(5 + 1);
    expect(tirelessShortRest({ ...at(rng, 10), exhaustion: 2 }).exhaustion).toBe(1);
    expect(huntersMarkDie(at(rng, 20))).toBe('1d10');
    expect(preciseHunterAdvantage({ ...at(rng, 17), effects: [{ id: 'hm', key: 'hunters_mark', targetId: 'orc', data: {} }] }, 'orc')).toBe(true);
  });

  it('Colossus Slayer: +1d8 once per turn against a wounded target', () => {
    const hunter = at(rng, 3, 'hunter');
    const bow = weaponAttack(hunter, db, { uid: 'b', itemId: 'longbow', quantity: 1 })!;
    const ctx = { attack: bow, crit: false, rng: fixed(), firstHitThisTurn: true, hadAdvantage: false };
    expect(weaponHitRiders(hunter, db, { ...ctx, target: dummy({ hp: 20 }) })).toContainEqual({ extraDamage: [{ dice: '1d8', type: 'piercing' }], text: 'Colossus Slayer' });
    expect(weaponHitRiders(hunter, db, { ...ctx, target: dummy() })).toEqual([]);
  });

  it("Nature's Veil makes the ranger invisible", () => {
    const r = useFeatureAction(at(rng, 14), db, 'natures_veil', { rng: fixed() });
    expect(hasCondition(r.character, 'invisible')).toBe(true);
  });
});
