import { describe, expect, it } from 'vitest';
import type { Rng } from '../core/rng';
import { CharacterSchema, CreatureSchema, type Character, type Creature } from '../core/creature';
import { loadSrd } from '../data/srdBundle';
import { castSpell } from './spellcasting';
import { effectiveSpeed, hasCondition } from './conditions';
import { applyDamage } from './damage';
import { resolveDamageAtZero } from './death';
import { consumeAttackEffects } from './activeEffects';
import {
  applyDeathWard,
  attackedEffectModes3,
  canMakeOpportunityAttacks,
  canRegainHp,
  dominationDamageSave,
  effectCheckBonuses,
  effectCheckModes,
  effectResistances,
  effectSpeeds,
  effectiveSize,
  endControlOnHarm,
  invisibilityNegated,
  isBanished,
  maxHealingFromEffects,
  minAcFromEffects,
  mirrorImageRedirect,
  ownAttackEffectModes3,
  resetOncePerTurnEffects,
  resistanceCantripReduction,
  sanctuaryCheck,
  weaponEffectMods,
} from './spellHooks3';

const db = loadSrd();
const spell = (id: string) => db.spells.get(id)!;
const fixed = (...faces: number[]): Rng => {
  const q = [...faces];
  return { int: (_min: number, max: number) => Math.min(q.shift() ?? 1, max) } as unknown as Rng;
};

const caster = (level = 9): Character =>
  CharacterSchema.parse({
    id: 'wiz',
    name: 'Ilsa',
    kind: 'character',
    size: 'medium',
    creatureType: 'humanoid',
    abilities: { str: 8, dex: 14, con: 12, int: 18, wis: 12, cha: 10 },
    proficiencyBonus: 4,
    maxHp: 40,
    hp: 20,
    ac: 12,
    speed: { walk: 30 },
    classes: [{ classId: 'wizard', level }],
    speciesId: 'elf',
    backgroundId: 'sage',
    spellcasting: { slots: [4, 3, 3, 3, 3, 1, 1, 1, 1], maxSlots: [4, 3, 3, 3, 3, 1, 1, 1, 1] },
  });

const foe = (id: string, over: Partial<Creature> = {}): Creature =>
  CreatureSchema.parse({ id, name: id, kind: 'monster', size: 'medium', creatureType: 'humanoid', abilities: { str: 12, dex: 10, con: 12, int: 10, wis: 10, cha: 10 }, proficiencyBonus: 2, maxHp: 60, hp: 60, ac: 13, speed: { walk: 30 }, ...over });

const cast = (id: string, targets: Creature[], slot: number, faces: number[] = [], extra: Record<string, unknown> = {}) =>
  castSpell({ rng: fixed(...faces), caster: caster(), spell: spell(id), slot: slot === 0 ? { kind: 'cantrip' } : { kind: 'slot', level: slot }, ability: 'int', targets, characterLevel: 9, ...extra });

describe('cantrip riders', () => {
  it('Ray of Frost: damage and −10 ft Speed', () => {
    const a = cast('ray_of_frost', [foe('a')], 0, [18, 4, 4]).ctx.creatures.get('a')!;
    expect(a.hp).toBe(52);
    expect(effectiveSpeed(a)).toBe(20);
  });

  it('Chill Touch blocks healing; Shocking Grasp blocks Opportunity Attacks; Starry Wisp negates Invisible', () => {
    expect(canRegainHp(cast('chill_touch', [foe('a')], 0, [18, 3, 3]).ctx.creatures.get('a')!)).toBe(false);
    expect(canMakeOpportunityAttacks(cast('shocking_grasp', [foe('a')], 0, [18, 3, 3]).ctx.creatures.get('a')!)).toBe(false);
    expect(invisibilityNegated(cast('starry_wisp', [foe('a')], 0, [18, 3, 3]).ctx.creatures.get('a')!)).toBe(true);
    expect(canRegainHp(cast('chill_touch', [foe('a')], 0, [1]).ctx.creatures.get('a')!)).toBe(true);
  });

  it('Vicious Mockery: Disadvantage on own next attack, then consumed', () => {
    const a = cast('vicious_mockery', [foe('a')], 0, [2, 3, 3]).ctx.creatures.get('a')!;
    expect(ownAttackEffectModes3(a).disadvantage).toEqual(['Vicious Mockery']);
    expect(ownAttackEffectModes3(consumeAttackEffects(a, 'wiz')).disadvantage).toEqual([]);
  });

  it('Produce Flame hurls on cast with level-scaled dice', () => {
    const r = cast('produce_flame', [foe('a')], 0, [18, 5, 5]);
    expect(r.ctx.creatures.get('a')!.hp).toBe(50); // 2d8 at level 9
    expect(r.caster.effects.some((e) => e.key === 'produce_flame')).toBe(true);
  });

  it('Sorcerous Burst: chosen type, 8s explode up to spell mod extra dice', () => {
    // hit, 2d8 = [8, 2], burst d8 = 8 → another 3 (spell mod 4 caps at 4 dice)
    const r = cast('sorcerous_burst', [foe('a', { resistances: ['cold'] })], 0, [18, 8, 2, 8, 3], { choice: 'cold' });
    expect(r.ctx.creatures.get('a')!.hp).toBe(60 - Math.floor(21 / 2));
  });

  it('Shillelagh and True Strike arm weapon attacks', () => {
    const s = cast('shillelagh', [caster()], 0, [], { choice: 'force' }).caster;
    expect(weaponEffectMods(s, 'quarterstaff')).toMatchObject({ damageDie: '1d10', spellMod: 4, damageType: 'force' });
    expect(weaponEffectMods(s, 'longsword').damageDie).toBeUndefined();
    const t = cast('true_strike', [foe('a')], 0).caster;
    expect(weaponEffectMods(t).extraDamage).toEqual([{ dice: '1d6', type: 'radiant' }]);
    expect(weaponEffectMods(consumeAttackEffects(t, 'a')).extraDamage).toEqual([]);
  });
});

describe('hold and dominate', () => {
  it('Hold Person: paralysis gets a repeat Wis save at the spell DC', () => {
    const a = cast('hold_person', [foe('a')], 2, [2]).ctx.creatures.get('a')!;
    const para = a.conditions.find((c) => c.condition === 'paralyzed');
    expect(para?.endSave).toEqual({ ability: 'wis', dc: 16 });
  });

  it('Hold Person does nothing to non-humanoids; a successful save leaves nothing', () => {
    expect(hasCondition(cast('hold_person', [foe('b', { creatureType: 'beast' })], 2, [2]).ctx.creatures.get('b')!, 'paralyzed')).toBe(false);
    expect(hasCondition(cast('hold_monster', [foe('c')], 5, [20]).ctx.creatures.get('c')!, 'paralyzed')).toBe(false);
  });

  it('Dominate Person: charmed + dominated; a save on damage can end it', () => {
    const a = cast('dominate_person', [foe('a')], 6, [2]).ctx.creatures.get('a')!;
    expect(hasCondition(a, 'charmed')).toBe(true);
    const dom = a.effects.find((e) => e.key === 'dominated')!;
    expect(dom.roundsLeft).toBe(100);
    expect(a.conditions.find((c) => c.condition === 'charmed')!.roundsLeft).toBe(100);
    const freed = dominationDamageSave(a, fixed(20)).creature;
    expect(hasCondition(freed, 'charmed')).toBe(false);
    expect(freed.effects.some((e) => e.key === 'dominated')).toBe(false);
  });
});

describe('charm and control', () => {
  it('Charm Person ends when the caster side harms the target', () => {
    const a = cast('charm_person', [foe('a')], 1, [2]).ctx.creatures.get('a')!;
    const charm = a.conditions.find((c) => c.condition === 'charmed')!;
    expect(charm.sourceId).toBe('wiz:charm_person');
    expect(charm.roundsLeft).toBe(600);
    expect(hasCondition(endControlOnHarm(a, 'wiz'), 'charmed')).toBe(false);
    expect(hasCondition(endControlOnHarm(a, 'other'), 'charmed')).toBe(true);
  });

  it('Suggestion stores the suggested text; Fear stores dash-away', () => {
    const s = cast('suggestion', [foe('a')], 2, [2], { choice: 'Leave the tower' }).ctx.creatures.get('a')!;
    expect(s.effects.find((e) => e.key === 'suggested')!.data.text).toBe('Leave the tower');
    const f = cast('fear', [foe('b')], 3, [2]).ctx.creatures.get('b')!;
    expect(hasCondition(f, 'frightened')).toBe(true);
    expect(f.effects.find((e) => e.key === 'fear')!.data.dashAway).toBe(true);
  });

  it('Banishment marks the creature banished', () => {
    const a = cast('banishment', [foe('a', { creatureType: 'fiend' })], 4, [2]).ctx.creatures.get('a')!;
    expect(isBanished(a)).toBe(true);
    expect(a.effects.find((e) => e.key === 'banished')!.data.permanentIfFullDuration).toBe(true);
    expect(isBanished(cast('banishment', [foe('b')], 4, [20]).ctx.creatures.get('b')!)).toBe(false);
  });
});

describe('buffs', () => {
  const self = (id: string, slot: number, extra: Record<string, unknown> = {}, faces: number[] = []) => cast(id, [caster()], slot, faces, extra).caster;

  it('Barkskin: AC floor 17', () => {
    expect(minAcFromEffects(self('barkskin', 2))).toBe(17);
    expect(minAcFromEffects(caster())).toBe(0);
  });

  it('Protection from Energy and Stoneskin grant resistances', () => {
    expect(effectResistances(self('protection_from_energy', 3, { choice: 'cold' }))).toEqual(['cold']);
    expect(effectResistances(self('stoneskin', 4))).toEqual(['bludgeoning', 'piercing', 'slashing']);
  });

  it('Death Ward keeps a creature at 1 HP once', () => {
    const warded = self('death_ward', 4);
    const hit = applyDamage(warded, [{ amount: 50, type: 'slashing' }]);
    const zero = resolveDamageAtZero(warded, hit.creature, hit.report).creature;
    const saved = applyDeathWard(warded, zero);
    expect(saved.triggered).toBe(true);
    expect(saved.creature.hp).toBe(1);
    expect(hasCondition(saved.creature, 'unconscious')).toBe(false);
    expect(saved.creature.effects.some((e) => e.key === 'death_ward')).toBe(false);
  });

  it('Guidance: +1d4 to checks with the chosen skill only; Enhance Ability gives check Advantage', () => {
    const g = self('guidance', 0, { choice: 'stealth' });
    expect(effectCheckBonuses(g, 'stealth', fixed(3))).toEqual([{ value: 3, label: 'Guidance' }]);
    expect(effectCheckBonuses(g, 'athletics', fixed(3))).toEqual([]);
    expect(effectCheckModes(self('enhance_ability', 2, { choice: 'dex' }), 'dex').advantage).toEqual(['Enhance Ability']);
  });

  it('Resistance cantrip: 1d4 reduction once per turn', () => {
    const r = self('resistance', 0, { choice: 'fire' });
    const first = resistanceCantripReduction(r, 'fire', fixed(3));
    expect(first.reduction).toBe(3);
    expect(resistanceCantripReduction(first.creature, 'fire', fixed(3)).reduction).toBe(0);
    expect(resistanceCantripReduction(resetOncePerTurnEffects(first.creature), 'fire', fixed(2)).reduction).toBe(2);
  });

  it('Movement: Longstrider, Fly, Spider Climb; Enlarge size and damage die', () => {
    expect(effectSpeeds(self('longstrider', 1)).walk).toBe(40);
    expect(effectSpeeds(self('fly', 3))).toMatchObject({ fly: 60, hover: true });
    expect(effectSpeeds(self('spider_climb', 2)).climb).toBe(30);
    const big = self('enlarge_reduce', 2, { choice: 'enlarge' });
    expect(effectiveSize(big)).toBe('large');
    expect(weaponEffectMods(big).extraDice).toEqual(['1d4']);
    expect(effectCheckModes(big, 'str').advantage).toEqual(['Enlarge']);
  });

  it('Enlarge/Reduce on a hostile monster allows a Con save', () => {
    expect(effectiveSize(cast('enlarge_reduce', [foe('a')], 2, [20], { choice: 'reduce' }).ctx.creatures.get('a')!)).toBe('medium');
    expect(effectiveSize(cast('enlarge_reduce', [foe('a')], 2, [2], { choice: 'reduce' }).ctx.creatures.get('a')!)).toBe('small');
  });

  it('Magic Weapon bonus scales by slot', () => {
    expect(weaponEffectMods(self('magic_weapon', 2)).attackBonus).toBe(1);
    expect(weaponEffectMods(self('magic_weapon', 4)).attackBonus).toBe(2);
    expect(weaponEffectMods(self('magic_weapon', 6)).damageBonus).toBe(3);
  });

  it('Protection from Evil and Good, Sanctuary, Mirror Image, Beacon of Hope', () => {
    const p = self('protection_from_evil_and_good', 1);
    expect(attackedEffectModes3(p, foe('d', { creatureType: 'fiend' })).disadvantage).toHaveLength(1);
    expect(attackedEffectModes3(p, foe('o')).disadvantage).toHaveLength(0);
    const s = self('sanctuary', 1);
    expect(sanctuaryCheck(s, foe('o'), fixed(2)).allowed).toBe(false);
    expect(sanctuaryCheck(s, foe('o'), fixed(20)).allowed).toBe(true);
    const m = self('mirror_image', 2);
    const hit = mirrorImageRedirect(m, foe('o'), fixed(1, 1, 5));
    expect(hit.redirected).toBe(true);
    expect(hit.creature.effects.find((e) => e.key === 'mirror_image')!.data.remaining).toBe(2);
    expect(mirrorImageRedirect(m, foe('o', { senses: { truesight: 60 } }), fixed(6, 6, 6)).redirected).toBe(false);
    expect(maxHealingFromEffects(self('beacon_of_hope', 3))).toBe(true);
  });
});
