import { describe, expect, it } from 'vitest';
import type { Rng } from '../../core/rng';
import { CreatureSchema, type Character, type Creature } from '../../core/creature';
import { loadSrd } from '../../data/srdBundle';
import { buildCharacter, type CharacterBuildInput } from '../builder';
import { armorClass, weaponAttack } from '../derived';
import { levelUp, pendingChoices } from '../leveling';
import { spellInfo, spellOptions, syncResources, useFeatureAction, weaponHitRiders } from './index';
import { cunningStrike, reliableTalent, sneakAttackDice, strokeOfLuck, uncannyDodge } from './rogue';
import { METAMAGIC_COST, arcaneRecovery, darkOnesBlessing, sorcerousRestoration } from './casters';
import { castSpell } from '../../rules/spellcasting';
import { d20Test } from '../../rules/checks';
import { hasCondition } from '../../rules/conditions';
import { attackEffectModes } from '../../rules/activeEffects';

const db = loadSrd();
const fixed = (...faces: number[]): Rng => {
  const q = [...faces];
  return { int: (_min: number, max: number) => Math.min(q.shift() ?? 1, max) } as unknown as Rng;
};

const base: CharacterBuildInput = {
  id: 'hero',
  name: 'Hero',
  classId: 'rogue',
  speciesId: 'halfling',
  backgroundId: 'criminal',
  baseScores: { str: 8, dex: 15, con: 14, int: 13, wis: 12, cha: 10 },
  backgroundBonus: { dex: 2, con: 1 },
  classSkills: ['acrobatics', 'perception', 'insight', 'deception'],
  classEquipment: 0,
  backgroundEquipment: 'b',
  weaponMasteries: ['dagger', 'shortbow'],
};

const at = (c: Character, level: number, subclassId?: string, choices: Record<string, string[]> = {}): Character =>
  syncResources({ ...c, classes: [{ classId: c.classes[0]!.classId, level, ...(subclassId && { subclassId }) }], proficiencyBonus: Math.ceil(level / 4) + 1, choices: { ...c.choices, ...choices } }, db);

const dummy = (over: Partial<Creature> = {}): Creature =>
  CreatureSchema.parse({ id: 'orc', name: 'Orc', kind: 'monster', size: 'medium', creatureType: 'humanoid', abilities: { str: 16, dex: 10, con: 10, int: 7, wis: 11, cha: 10 }, proficiencyBonus: 2, maxHp: 60, hp: 60, ac: 13, speed: { walk: 30 }, ...over });

describe('Rogue', () => {
  const rogue = buildCharacter(base, db);
  const dagger = weaponAttack(rogue, db, rogue.inventory.find((i) => i.itemId === 'dagger')!)!;
  const ctx = { attack: dagger, target: dummy(), crit: false, rng: fixed(), firstHitThisTurn: true, hadAdvantage: false };

  it('Sneak Attack needs Advantage or an adjacent ally, once per turn, finesse/ranged', () => {
    expect(weaponHitRiders(rogue, db, ctx)).toEqual([]);
    expect(weaponHitRiders(rogue, db, { ...ctx, hadAdvantage: true })).toEqual([{ extraDamage: [{ dice: '1d6', type: 'piercing' }], text: 'Sneak Attack' }]);
    expect(weaponHitRiders(rogue, db, { ...ctx, allyAdjacentToTarget: true })).toHaveLength(1);
    expect(weaponHitRiders(rogue, db, { ...ctx, allyAdjacentToTarget: true, hadDisadvantage: true })).toEqual([]);
    expect(weaponHitRiders(rogue, db, { ...ctx, hadAdvantage: true, firstHitThisTurn: false })).toEqual([]);
    expect(sneakAttackDice(at(rogue, 9))).toBe(5);
  });

  it('Cunning Strike trades dice for effects (trip, poison, knock out at 14)', () => {
    const r5 = at(rogue, 5);
    const trip = cunningStrike(r5, dummy(), 'trip', fixed(2))!;
    expect(hasCondition(trip.target, 'prone')).toBe(true);
    expect(trip.diceCost).toBe(1);
    expect(weaponHitRiders(r5, db, { ...ctx, hadAdvantage: true, sneakAttackDiceSpent: 1 })[0]!.extraDamage![0]!.dice).toBe('2d6');
    expect(cunningStrike(r5, dummy(), 'knock_out', fixed())).toBeUndefined();
    const ko = cunningStrike(at(rogue, 14), dummy(), 'knock_out', fixed(1))!;
    expect(hasCondition(ko.target, 'unconscious')).toBe(true);
  });

  it('Steady Aim gives Advantage on the next attack', () => {
    const aimed = useFeatureAction(at(rogue, 3), db, 'steady_aim', { rng: fixed() }).character;
    expect(attackEffectModes(aimed, 'orc').advantage).toEqual(['Steady Aim']);
  });

  it('Uncanny Dodge, Reliable Talent, Evasion, Slippery Mind, Stroke of Luck', () => {
    expect(uncannyDodge(13)).toBe(6);
    const check = d20Test({ rng: fixed(3), label: 'Stealth', modifiers: [{ value: 7, label: 'Stealth' }], target: { kind: 'DC', value: 15 } });
    expect(reliableTalent(at(rogue, 7), check, true)).toMatchObject({ total: 17, success: true });
    expect(reliableTalent(at(rogue, 7), check, false).total).toBe(10);
    let r = rogue;
    // Level up to 7 through real levelUp so onGain features apply.
    r = levelUp(r, db, { classId: 'rogue', hp: { mode: 'average' }, ignoreXp: true }).character;
    r = levelUp(r, db, { classId: 'rogue', hp: { mode: 'average' }, ignoreXp: true, subclassId: 'thief' }).character;
    expect(r.speed.climb).toBe(r.speed.walk);
    expect(strokeOfLuck(at(rogue, 20), check)!.result.total).toBe(27); // natural 3 → 20: total 10 + 17
  });
});

describe('Sorcerer', () => {
  const sorc = buildCharacter(
    { ...base, classId: 'sorcerer', speciesId: 'dragonborn', lineageId: 'red', backgroundId: 'sage', baseScores: { str: 8, dex: 14, con: 14, int: 10, wis: 12, cha: 15 }, backgroundBonus: { con: 1, int: 1, wis: 1 }, classSkills: ['persuasion', 'insight'], classEquipment: 0, weaponMasteries: [], cantrips: ['fire_bolt', 'light', 'mage_hand', 'prestidigitation'], preparedSpells: ['magic_missile', 'shield'] },
    db,
  );

  it('Innate Sorcery: +1 DC and Advantage on Sorcerer spell attacks', () => {
    const on = useFeatureAction(sorc, db, 'innate_sorcery', { rng: fixed() }).character;
    const opts = spellOptions(on, db, spellInfo(db.spells.get('fire_bolt')!, 'sorcerer'), 0);
    expect(opts).toEqual({ saveDcBonus: 1, attackAdvantage: 'Innate Sorcery' });
    const r = castSpell({ rng: fixed(3, 15, 5), caster: on, spell: db.spells.get('fire_bolt')!, slot: { kind: 'cantrip' }, ability: 'cha', targets: [dummy()], characterLevel: 1, ...opts });
    expect(r.ctx.log.some((l) => l.text.includes('adv: 3, 15'))).toBe(true);
  });

  it('Font of Magic converts slots and points; Metamagic costs; Sorcerous Restoration', () => {
    const s2 = at(sorc, 2);
    expect(s2.resources.sorcery_points).toMatchObject({ current: 2, max: 2 });
    const withSlots = { ...s2, spellcasting: { ...s2.spellcasting!, slots: [3, 0, 0, 0, 0, 0, 0, 0, 0] } };
    const created = useFeatureAction(withSlots, db, 'create_spell_slot', { rng: fixed(), choice: '1' }).character;
    expect(created.spellcasting!.slots[0]).toBe(4);
    expect(created.resources.sorcery_points!.current).toBe(0);
    const converted = useFeatureAction(created, db, 'convert_spell_slot', { rng: fixed(), choice: '1' }).character;
    expect(converted.resources.sorcery_points!.current).toBe(1);
    expect(METAMAGIC_COST.quickened_spell).toBe(2);
    const s5 = { ...at(sorc, 5), resources: { ...at(sorc, 5).resources, sorcery_points: { current: 0, max: 5, recharge: 'long' as const } } };
    expect(sorcerousRestoration(s5).resources.sorcery_points!.current).toBe(2);
  });

  it('Draconic Resilience: AC 10 + Dex + Cha and +3 HP then +1 per level', () => {
    let c = levelUp(sorc, db, { classId: 'sorcerer', hp: { mode: 'average' }, ignoreXp: true }).character;
    const before = c.maxHp;
    c = levelUp(c, db, { classId: 'sorcerer', hp: { mode: 'average' }, ignoreXp: true, subclassId: 'draconic_sorcery' }).character;
    expect(c.maxHp).toBe(before + 4 + 2 + 3);
    expect(armorClass(c, db).ac).toBe(10 + 2 + 2);
    const lvl4 = levelUp(c, db, { classId: 'sorcerer', hp: { mode: 'average' }, ignoreXp: true, feat: { featId: 'ability_score_improvement', increases: { cha: 2 } } }).character;
    expect(lvl4.maxHp).toBe(c.maxHp + 4 + 2 + 1);
  });
});

describe('Warlock and Wizard', () => {
  const lock = buildCharacter(
    { ...base, classId: 'warlock', speciesId: 'tiefling', lineageId: 'infernal', backgroundId: 'sage', baseScores: { str: 8, dex: 14, con: 14, int: 10, wis: 12, cha: 15 }, backgroundBonus: { con: 1, int: 1, wis: 1 }, classSkills: ['deception', 'intimidation'], classEquipment: 0, weaponMasteries: [], cantrips: ['eldritch_blast', 'minor_illusion'], preparedSpells: ['hex', 'hellish_rebuke'], choices: { eldritch_invocation: ['agonizing_blast'] } },
    db,
  );

  it('Agonizing Blast adds Cha to Eldritch Blast; Magical Cunning restores half the pact slots', () => {
    expect(spellOptions(lock, db, spellInfo(db.spells.get('eldritch_blast')!, 'warlock'), 0)).toEqual({ cantripDamageBonus: 2 });
    const w5 = at(lock, 5);
    const spent = { ...w5, spellcasting: { ...w5.spellcasting!, pact: { current: 0, max: 2, level: 3 } } };
    const r = useFeatureAction(spent, db, 'magical_cunning', { rng: fixed() });
    expect(r.character.spellcasting!.pact!.current).toBe(1);
  });

  it("Dark One's Blessing grants Cha + warlock level temp HP", () => {
    expect(darkOnesBlessing(at(lock, 3, 'fiend_patron')).tempHp).toBe(2 + 3);
    expect(darkOnesBlessing(lock).tempHp).toBe(0);
  });

  it('Wizard: Scholar expertise at 2, Arcane Recovery, Evoker Potent Cantrip + Empowered Evocation', () => {
    const wiz = buildCharacter({ ...base, classId: 'wizard', backgroundId: 'sage', baseScores: { str: 8, dex: 14, con: 14, int: 15, wis: 12, cha: 10 }, backgroundBonus: { int: 2, con: 1 }, classSkills: ['investigation', 'medicine'], classEquipment: 0, weaponMasteries: [] }, db);
    expect(pendingChoices(wiz, db, 'wizard', 2)).toContainEqual({ kind: 'expertise', count: 1 });
    const w4 = { ...at(wiz, 4), spellcasting: { ...wiz.spellcasting!, slots: [1, 1, 0, 0, 0, 0, 0, 0, 0], maxSlots: [4, 3, 0, 0, 0, 0, 0, 0, 0] } };
    expect(arcaneRecovery(w4, [2])!.spellcasting!.slots).toEqual([1, 2, 0, 0, 0, 0, 0, 0, 0]);
    expect(arcaneRecovery(w4, [2, 1])).toBeUndefined();
    const evoker = at(wiz, 10, 'evoker');
    expect(spellOptions(evoker, db, spellInfo(db.spells.get('fireball')!, 'wizard'), 3)).toEqual({ damageBonus: 3 });
    expect(spellOptions(evoker, db, spellInfo(db.spells.get('fire_bolt')!, 'wizard'), 0)).toMatchObject({ potentCantrip: true });
    const potent = castSpell({ rng: fixed(20, 8), caster: evoker, spell: db.spells.get('sacred_flame')!, slot: { kind: 'cantrip' }, ability: 'int', targets: [dummy()], characterLevel: 10, potentCantrip: true });
    expect(potent.ctx.creatures.get('orc')!.hp).toBe(60 - 4); // save succeeded: half of 1d8 (8)
  });
});
