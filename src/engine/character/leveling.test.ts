import { describe, expect, it } from 'vitest';
import type { Rng } from '../core/rng';
import { loadSrd } from '../data/srdBundle';
import { buildCharacter, type CharacterBuildInput } from './builder';
import { LevelError, applyFeat, canLevelUp, featProblems, featureLevels, featuresAtLevel, levelForXp, levelUp, pendingChoices } from './leveling';
import type { Character } from '../core/creature';

const db = loadSrd();
const fixed = (...faces: number[]): Rng => {
  const q = [...faces];
  return { int: () => q.shift() ?? 1 } as unknown as Rng;
};

const fighterInput: CharacterBuildInput = {
  id: 'hero',
  name: 'Brenna',
  classId: 'fighter',
  speciesId: 'human',
  speciesSkills: ['stealth'],
  speciesFeatId: 'alert',
  backgroundId: 'soldier',
  baseScores: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  backgroundBonus: { str: 2, con: 1 },
  classSkills: ['perception', 'survival'],
  classEquipment: 0,
  backgroundEquipment: 'a',
  weaponMasteries: ['greatsword', 'longsword', 'javelin'],
  choices: { fighting_style: ['defense'] },
};

const up = (c: Character, extra: Partial<Parameters<typeof levelUp>[2]> = {}) =>
  levelUp(c, db, { classId: 'fighter', hp: { mode: 'average' }, ignoreXp: true, ...extra });

describe('XP and features', () => {
  it('level from XP', () => {
    const xp = db.rules.xpByLevel;
    expect(levelForXp(0, xp)).toBe(1);
    expect(levelForXp(299, xp)).toBe(1);
    expect(levelForXp(300, xp)).toBe(2);
    expect(levelForXp(355_000, xp)).toBe(20);
  });

  it('knows repeat feature levels (Fighter ASI at 4, 6, 8, 12, 14, 16)', () => {
    const asi = db.classes.get('fighter')!.features.find((f) => f.name === 'Ability Score Improvement')!;
    expect(featureLevels(asi)).toEqual([4, 6, 8, 12, 14, 16]);
    expect(featuresAtLevel(db, 'fighter', 6).map((f) => f.name)).toContain('Ability Score Improvement');
    expect(featuresAtLevel(db, 'fighter', 3, 'champion').map((f) => f.name)).toEqual(expect.arrayContaining(['Fighter Subclass', 'Improved Critical']));
  });

  it('checks XP before leveling', () => {
    const c = buildCharacter(fighterInput, db);
    expect(canLevelUp(c, db)).toBe(false);
    expect(canLevelUp({ ...c, xp: 300 }, db)).toBe(true);
    expect(() => levelUp(c, db, { classId: 'fighter', hp: { mode: 'average' } })).toThrow(LevelError);
  });
});

describe('levelUp', () => {
  it('adds average HP, a hit die and features', () => {
    const c = buildCharacter(fighterInput, db);
    const r = up(c);
    expect(r.hpGained).toBe(6 + 2);
    expect(r.character.maxHp).toBe(c.maxHp + 8);
    expect(r.character.hitDice).toEqual({ d10: 2 });
    expect(r.features).toEqual(['Action Surge', 'Tactical Mind']);
  });

  it('can roll HP (minimum 1)', () => {
    const c = buildCharacter({ ...fighterInput, baseScores: { ...fighterInput.baseScores, con: 3 }, backgroundBonus: { str: 2, dex: 1 } }, db);
    expect(levelUp(c, db, { classId: 'fighter', hp: { mode: 'roll', rng: fixed(1) }, ignoreXp: true }).hpGained).toBe(1);
  });

  it('requires a subclass at 3 and an ASI/feat at 4, and updates proficiency bonus at 5', () => {
    let c = up(buildCharacter(fighterInput, db)).character;
    expect(() => up(c)).toThrow(/subclass/);
    c = up(c, { subclassId: 'champion' }).character;
    expect(c.classes[0]).toMatchObject({ level: 3, subclassId: 'champion' });
    expect(pendingChoices(c, db, 'fighter', 4)).toContainEqual({ kind: 'feat', reason: 'asi' });
    expect(() => up(c)).toThrow(/Ability Score Improvement/);
    c = up(c, { feat: { featId: 'ability_score_improvement', increases: { str: 2 } } }).character;
    expect(c.abilities.str).toBe(19);
    expect(c.proficiencyBonus).toBe(2);
    c = up(c).character;
    expect(c.proficiencyBonus).toBe(3);
  });

  it('weapon mastery and spell choices appear as pending choices', () => {
    const fighter = buildCharacter(fighterInput, db);
    expect(pendingChoices(fighter, db, 'fighter', 4)).toContainEqual({ kind: 'weapon_mastery', count: 1 });
    expect(pendingChoices(fighter, db, 'wizard', 1)).toEqual(
      expect.arrayContaining([
        { kind: 'cantrips', classId: 'wizard', count: 3 },
        { kind: 'spells', classId: 'wizard', count: 4 },
      ]),
    );
  });

  it('wizard level 3 gains level 2 slots', () => {
    const wiz = buildCharacter(
      {
        ...fighterInput,
        classId: 'wizard',
        classSkills: ['investigation', 'medicine'],
        backgroundId: 'sage',
        backgroundBonus: { int: 2, con: 1 },
        classEquipment: 0,
        weaponMasteries: [],
        choices: {},
      },
      db,
    );
    let c = levelUp(wiz, db, { classId: 'wizard', hp: { mode: 'average' }, ignoreXp: true }).character;
    c = levelUp(c, db, { classId: 'wizard', hp: { mode: 'average' }, ignoreXp: true, subclassId: 'evoker' }).character;
    expect(c.spellcasting!.maxSlots.slice(0, 2)).toEqual([4, 2]);
    expect(c.spellcasting!.slots.slice(0, 2)).toEqual([4, 2]);
  });
});

describe('feats', () => {
  it('ASI: +2 to one or +1/+1, max 20', () => {
    const c = buildCharacter(fighterInput, db);
    const lvl4 = { ...c, classes: [{ classId: 'fighter', level: 4 }] };
    expect(featProblems(lvl4, db, { featId: 'ability_score_improvement', increases: { str: 1, dex: 1 } })).toEqual([]);
    expect(featProblems(lvl4, db, { featId: 'ability_score_improvement', increases: { str: 3 } })).toContain('ASI: at most +2 to one score');
    expect(featProblems({ ...lvl4, abilities: { ...lvl4.abilities, str: 20 } }, db, { featId: 'ability_score_improvement', increases: { str: 2 } })).toContain("str can't exceed 20");
  });

  it('prerequisites (level, abilities) and repeatability', () => {
    const c = buildCharacter(fighterInput, db);
    expect(featProblems(c, db, { featId: 'grappler', increases: { str: 1 } })).toContain('Grappler requires level 4');
    expect(featProblems(c, db, { featId: 'alert' })).toContain("Alert can't be taken twice");
    expect(featProblems(c, db, { featId: 'boon_of_fate', increases: { cha: 1 } })).toContain('Boon of Fate requires level 19');
  });

  it('Constitution increase raises max HP retroactively', () => {
    const c = { ...buildCharacter(fighterInput, db), classes: [{ classId: 'fighter', level: 4 }] };
    const conBefore = c.abilities.con; // 15
    const after = applyFeat({ ...c, abilities: { ...c.abilities, con: conBefore } }, db, { featId: 'ability_score_improvement', increases: { con: 1, str: 1 } });
    expect(after.maxHp).toBe(c.maxHp + 4); // Con 15 → 16: +1 modifier × 4 levels
  });

  it('Skilled adds three proficiencies; Magic Initiate adds spells', () => {
    const c = buildCharacter(fighterInput, db);
    const skilled = applyFeat(c, db, { featId: 'skilled', skills: ['arcana', 'history'], tools: ['thieves_tools'] });
    expect(skilled.skills).toMatchObject({ arcana: 'proficient', history: 'proficient' });
    expect(skilled.proficiencies.tools).toContain('thieves_tools');
    const mi = applyFeat(c, db, { featId: 'magic_initiate', spellList: 'wizard', cantrips: ['fire_bolt', 'light'], spells: ['magic_missile'] });
    expect(mi.spellcasting).toMatchObject({ cantrips: ['fire_bolt', 'light'], prepared: [{ spellId: 'magic_missile', classId: 'feat:magic_initiate:wizard' }] });
    expect(featProblems(c, db, { featId: 'magic_initiate', spellList: 'cleric', cantrips: ['fire_bolt', 'light'], spells: ['bless'] })).toContain('fire_bolt is not on the cleric list');
  });
});
